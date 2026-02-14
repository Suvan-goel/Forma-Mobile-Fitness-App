/**
 * Barbell Curl Heuristics - Forma Specification
 *
 * Implements deterministic barbell curl detection and form coaching using ONLY
 * 8 precomputed joint angles. Uses per-arm FSM with two-arm synchronization.
 */

import {
  Keypoint,
  calculateAngle2D,
  calculateSignedVerticalAngle,
  calculateSignedVerticalAngleSagittal,
  calculateShoulderFlexionAngle,
  getKeypoint,
  isVisible,
} from './poseAnalysis';

// ============================================================================
// CONSTANTS & THRESHOLDS
// ============================================================================

/** FSM thresholds (degrees) */
export const THRESHOLDS = {
  EXTENDED_ENTER: 150,
  EXTENDED_EXIT: 145,
  FLEXED_ENTER: 70,
  FLEXED_EXIT: 75,
  MIN_REP_TIME: 0.45, // seconds
  SYNC_WINDOW: 0.35, // seconds between arms
  ROM_MIN: 80, // degrees
} as const;

/** Form heuristic thresholds (degrees) - relaxed for fewer false positives */
export const FORM_THRESHOLDS = {
  SHOULDER_WARN: 45,
  SHOULDER_FAIL: 65,
  TORSO_WARN: 10,
  TORSO_FAIL: 22,
  WRIST_NEUTRAL: 180, // straight wrist reference
  WRIST_DEV_WARN: 25,
  WRIST_DEV_DURATION: 0.5, // 50% of rep (trigger only if bent for half the rep)
  TEMPO_UP_MIN: 0.05,
  TEMPO_DOWN_MIN: 0.20,
  SYMMETRY_MIN: 50,
  SYMMETRY_ROM: 55,
} as const;

/** Smoothing parameters */
const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.3;
const VISIBILITY_THRESHOLD = 0.15;

/** Warm-up: require N consecutive stable frames before enabling FSM */
const WARMUP_REQUIRED = 12;          // ~0.6s at 20fps
const WARMUP_VISIBILITY_MIN = 0.3;   // avg visibility of 8 key joints must exceed this

/** Scoring penalties (legacy — kept for reference) */
const PENALTIES = {
  INCOMPLETE_ROM: 30,
  SHOULDER_WARN: 15,
  SHOULDER_FAIL: 25,
  TORSO_WARN: 15,
  TORSO_FAIL: 25,
  WRIST_BEND: 10,
  TEMPO_ISSUE: 10,
  ASYMMETRY: 10,
} as const;

// ============================================================================
// CONTINUOUS PENALTY FUNCTIONS
// All use quadratic ramps: penalty(x) = min(cap, scale * max(0, x - deadzone)²)
// ============================================================================

/** Torso swing penalty — max 35 pts. Deadzone 3° (breathing/sway noise). */
function penaltyTorso(delta: number): number {
  const d = Math.max(0, delta - 3);
  return Math.min(35, 0.55 * d * d);
}

/** Shoulder movement penalty — max 30 pts. Deadzone 10° (normal stabilisation). */
function penaltyShoulder(delta: number): number {
  const d = Math.max(0, delta - 10);
  return Math.min(30, 0.018 * d * d);
}

/** ROM shortfall penalty — max 35 pts. Flex + extension sub-components. Adjusted for foreshortening. */
function penaltyROM(minFlex: number, maxExt: number, viewAngle: ViewAngle): number {
  const adjFlexTarget = 50 + viewAngle.smoothedAngleDeg * FORESHORTENING_FACTOR;
  const adjExtTarget = 140 - viewAngle.smoothedAngleDeg * FORESHORTENING_FACTOR;
  const flexShortfall = Math.max(0, minFlex - adjFlexTarget);
  const flexPenalty = Math.min(20, 0.03 * flexShortfall * flexShortfall);
  const extShortfall = Math.max(0, adjExtTarget - maxExt);
  const extPenalty = Math.min(20, 0.03 * extShortfall * extShortfall);
  return Math.min(35, flexPenalty + extPenalty);
}

/** Tempo penalty — max 20 pts. Concentric < 0.4s or eccentric < 0.5s. */
function penaltyTempo(tUp: number, tDown: number): number {
  let upPenalty = 0;
  if (tUp > 0 && tUp < 0.4) {
    const deficit = 0.4 - tUp;
    upPenalty = Math.min(10, 60 * deficit * deficit);
  }
  let downPenalty = 0;
  if (tDown > 0 && tDown < 0.5) {
    const deficit = 0.5 - tDown;
    downPenalty = Math.min(10, 40 * deficit * deficit);
  }
  return Math.min(20, upPenalty + downPenalty);
}

/** Asymmetry penalty — max 15 pts. Min-angle + ROM asymmetry. */
function penaltyAsymmetry(deltaMin: number, deltaRom: number): number {
  const minPenalty = Math.min(10, 0.005 * deltaMin * deltaMin);
  const romPenalty = Math.min(10, 0.004 * deltaRom * deltaRom);
  return Math.min(15, minPenalty + romPenalty);
}

/** Compute a continuous rep score from raw measurements. */
function computeRepScore(
  repWindow: RepWindow,
  leftArm: ArmFSM,
  _rightArm: ArmFSM,
  viewAngle: ViewAngle = { angleDeg: 0, smoothedAngleDeg: 0, zone: 'frontal', primarySide: 'both' }
): number {
  const { minAngles, maxAngles } = repWindow;
  const isFrontal = viewAngle.zone === 'frontal';
  const isSide = viewAngle.zone === 'side';
  const primaryIsLeft = viewAngle.primarySide !== 'right';

  const leftElbowOk = isFinite(minAngles.leftElbow) && isFinite(maxAngles.leftElbow);
  const rightElbowOk = isFinite(minAngles.rightElbow) && isFinite(maxAngles.rightElbow);

  // Torso penalty (works at all angles)
  const deltaTorso = isFinite(maxAngles.torso - minAngles.torso)
    ? maxAngles.torso - minAngles.torso
    : 0;
  const torsoP = penaltyTorso(deltaTorso);

  // Shoulder penalty (skip at side angles)
  let shoulderP = 0;
  if (!isSide) {
    const deltaShL = maxAngles.leftShoulder - minAngles.leftShoulder;
    const deltaShR = maxAngles.rightShoulder - minAngles.rightShoulder;
    const shValues: number[] = [];
    if (isFinite(deltaShL)) shValues.push(deltaShL);
    if (isFinite(deltaShR)) shValues.push(deltaShR);
    const maxDeltaSh = shValues.length > 0 ? Math.max(...shValues) : 0;
    shoulderP = penaltyShoulder(maxDeltaSh);
  }

  // ROM penalty (use primary arm in non-frontal)
  let minFlex: number;
  let maxExt: number;
  if (isFrontal) {
    minFlex = Math.min(
      leftElbowOk ? minAngles.leftElbow : Infinity,
      rightElbowOk ? minAngles.rightElbow : Infinity
    );
    maxExt = Math.max(
      leftElbowOk ? maxAngles.leftElbow : -Infinity,
      rightElbowOk ? maxAngles.rightElbow : -Infinity
    );
  } else {
    minFlex = primaryIsLeft
      ? (leftElbowOk ? minAngles.leftElbow : 50)
      : (rightElbowOk ? minAngles.rightElbow : 50);
    maxExt = primaryIsLeft
      ? (leftElbowOk ? maxAngles.leftElbow : 140)
      : (rightElbowOk ? maxAngles.rightElbow : 140);
  }
  const romP = penaltyROM(isFinite(minFlex) ? minFlex : 50, isFinite(maxExt) ? maxExt : 140, viewAngle);

  // Tempo penalty (use primary arm in non-frontal)
  const tempoArm = isFrontal ? leftArm : (primaryIsLeft ? leftArm : _rightArm);
  const tUp =
    tempoArm.tUpToTop && tempoArm.tRestToUp
      ? tempoArm.tUpToTop - tempoArm.tRestToUp
      : 0;
  const tDown =
    tempoArm.tDownToRest && tempoArm.tTopToDown
      ? tempoArm.tDownToRest - tempoArm.tTopToDown
      : 0;
  const tempoP = penaltyTempo(tUp, tDown);

  // Asymmetry penalty (only frontal — can't compare when one arm is occluded)
  let asymmetryP = 0;
  if (isFrontal && leftElbowOk && rightElbowOk) {
    const romL = maxAngles.leftElbow - minAngles.leftElbow;
    const romR = maxAngles.rightElbow - minAngles.rightElbow;
    const deltaMin = Math.abs(minAngles.leftElbow - minAngles.rightElbow);
    const deltaRom = Math.abs(romL - romR);
    asymmetryP = penaltyAsymmetry(deltaMin, deltaRom);
  }

  const total = torsoP + shoulderP + romP + tempoP + asymmetryP;
  return Math.max(0, Math.min(100, Math.round(100 - total)));
}

// ============================================================================
// TYPES
// ============================================================================

export type ArmState = 'REST' | 'UP' | 'TOP' | 'DOWN';

export interface ArmFSM {
  state: ArmState;
  /** Time when transitioned to REST (for MIN_REP_TIME check) */
  tRestEntry: number | null;
  /** Min/max elbow angle during current rep */
  minElbow: number;
  maxElbow: number;
  /** Timestamps for tempo calculation */
  tRestToUp: number | null;
  tUpToTop: number | null;
  tTopToDown: number | null;
  tDownToRest: number | null;
}

export interface RepWindow {
  /** Rolling min/max for all 8 angles during the rep */
  minAngles: AngleSet;
  maxAngles: AngleSet;
  /** Start/end timestamps */
  tStart: number;
  tEnd: number;
  /** Frame count for duration calculations */
  frameCount: number;
  /** Wrist deviation history (for duration check) */
  wristDevFrames: { left: number; right: number };
}

export interface AngleSet {
  leftElbow: number;
  rightElbow: number;
  leftShoulder: number;
  rightShoulder: number;
  leftTorso: number;
  rightTorso: number;
  torso: number; // midline (hip center -> shoulder center) for better swing detection
  leftWrist: number;
  rightWrist: number;
}

export interface SmoothedAngles extends AngleSet {}

export interface RepResult {
  repIndex: number;
  romL: number;
  romR: number;
  tUp: number;
  tDown: number;
  score: number;
  messages: string[];
}

export type ViewZone = 'frontal' | 'oblique' | 'side';

export interface ViewAngle {
  /** Estimated rotation from frontal, 0° = facing camera, 90° = side */
  angleDeg: number;
  /** Smoothed angle (EMA) for stable zone classification */
  smoothedAngleDeg: number;
  /** Which zone the user is in */
  zone: ViewZone;
  /** Which side faces the camera ('both' when frontal) */
  primarySide: 'left' | 'right' | 'both';
}

export interface BarbellCurlState {
  leftArm: ArmFSM;
  rightArm: ArmFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  angleHistory: { [K in keyof AngleSet]: number[] }; // For median filter
  smoothed: SmoothedAngles | null; // EMA smoothed angles
  displayAngles: AngleSet | null; // Smoothed angles for UI
  feedback: string | null;
  lastFeedbackTime: number;
  viewAngle: ViewAngle;
  /** Consecutive stable frames seen — FSM disabled until >= WARMUP_REQUIRED */
  warmupFrames: number;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initArmFSM(): ArmFSM {
  return {
    state: 'REST',
    tRestEntry: null,
    minElbow: Infinity,
    maxElbow: -Infinity,
    tRestToUp: null,
    tUpToTop: null,
    tTopToDown: null,
    tDownToRest: null,
  };
}

function initRepWindow(tStart: number): RepWindow {
  return {
    minAngles: {
      leftElbow: Infinity,
      rightElbow: Infinity,
      leftShoulder: Infinity,
      rightShoulder: Infinity,
      leftTorso: Infinity,
      rightTorso: Infinity,
      torso: Infinity,
      leftWrist: Infinity,
      rightWrist: Infinity,
    },
    maxAngles: {
      leftElbow: -Infinity,
      rightElbow: -Infinity,
      leftShoulder: -Infinity,
      rightShoulder: -Infinity,
      leftTorso: -Infinity,
      rightTorso: -Infinity,
      torso: -Infinity,
      leftWrist: -Infinity,
      rightWrist: -Infinity,
    },
    tStart,
    tEnd: tStart,
    frameCount: 0,
    wristDevFrames: { left: 0, right: 0 },
  };
}

export function initializeBarbellCurlState(): BarbellCurlState {
  return {
    leftArm: initArmFSM(),
    rightArm: initArmFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    angleHistory: {
      leftElbow: [],
      rightElbow: [],
      leftShoulder: [],
      rightShoulder: [],
      leftTorso: [],
      rightTorso: [],
      torso: [],
      leftWrist: [],
      rightWrist: [],
    },
    smoothed: null,
    displayAngles: null,
    feedback: null,
    lastFeedbackTime: 0,
    viewAngle: { angleDeg: 0, smoothedAngleDeg: 0, zone: 'frontal', primarySide: 'both' },
    warmupFrames: 0,
  };
}

// ============================================================================
// VIEW-ANGLE ESTIMATION
// ============================================================================

const VIEW_ANGLE_EMA = 0.25; // Smoothing for view angle (lower = more stable)
const FRONTAL_MAX = 20;      // 0-20° = frontal
const OBLIQUE_MAX = 55;      // 20-55° = oblique, 55+ = side

/**
 * Estimate how rotated the user is from frontal view using shoulder geometry.
 * World landmarks: X = left-right (meters), Z = depth (meters).
 * At frontal view, shoulder X-distance is large, Z-distance ~0.
 * As user rotates, X shrinks and Z grows.
 */
function estimateViewAngle(
  keypoints: Keypoint[],
  prevSmoothed: number
): ViewAngle {
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');

  // Need both shoulders with reasonable visibility
  if (
    !leftShoulder || !rightShoulder ||
    !isVisible(leftShoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(rightShoulder, VISIBILITY_THRESHOLD)
  ) {
    // Can't estimate — hold previous smoothed value
    return classifyViewAngle(prevSmoothed, prevSmoothed, 'both');
  }

  const dx = Math.abs(rightShoulder.x - leftShoulder.x);
  const dz = Math.abs((rightShoulder.z ?? 0) - (leftShoulder.z ?? 0));

  // atan2(depth, width) → 0° when flat (frontal), 90° when one shoulder behind the other
  const rawAngleDeg = Math.atan2(dz, dx) * 57.29577951308232;

  // EMA smooth to avoid jitter
  const smoothed = VIEW_ANGLE_EMA * rawAngleDeg + (1 - VIEW_ANGLE_EMA) * prevSmoothed;

  // Determine which side faces the camera: the shoulder with smaller Z is closer.
  // In world coords, smaller Z = closer to camera.
  const leftZ = leftShoulder.z ?? 0;
  const rightZ = rightShoulder.z ?? 0;
  const closerSide: 'left' | 'right' | 'both' =
    Math.abs(leftZ - rightZ) < 0.02 ? 'both' : leftZ < rightZ ? 'left' : 'right';

  return classifyViewAngle(rawAngleDeg, smoothed, closerSide);
}

function classifyViewAngle(
  rawDeg: number,
  smoothedDeg: number,
  closerSide: 'left' | 'right' | 'both'
): ViewAngle {
  let zone: ViewZone;
  if (smoothedDeg < FRONTAL_MAX) {
    zone = 'frontal';
  } else if (smoothedDeg < OBLIQUE_MAX) {
    zone = 'oblique';
  } else {
    zone = 'side';
  }

  const primarySide = zone === 'frontal' ? 'both' : closerSide;

  return { angleDeg: rawDeg, smoothedAngleDeg: smoothedDeg, zone, primarySide };
}

// ============================================================================
// FRAME STABILITY CHECK
// ============================================================================

/** Check if the current frame has sufficient average visibility across key joints. */
function isFrameStable(keypoints: Keypoint[]): boolean {
  const names = [
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist',
    'left_hip', 'right_hip',
  ];
  let totalVis = 0;
  for (const name of names) {
    const kp = getKeypoint(keypoints, name);
    totalVis += kp?.score ?? 0;
  }
  return (totalVis / names.length) >= WARMUP_VISIBILITY_MIN;
}

// ============================================================================
// FORESHORTENING COMPENSATION
// ============================================================================

/**
 * At oblique angles, 2D-projected elbow angles are compressed by foreshortening.
 * Extension angles appear lower, flexion angles appear higher than reality.
 * Factor: ~0.4° adjustment per degree of body rotation (empirically derived).
 */
const FORESHORTENING_FACTOR = 0.4;

function adjustExtensionThreshold(base: number, viewAngle: ViewAngle): number {
  return base - viewAngle.smoothedAngleDeg * FORESHORTENING_FACTOR;
}

function adjustFlexionThreshold(base: number, viewAngle: ViewAngle): number {
  return base + viewAngle.smoothedAngleDeg * FORESHORTENING_FACTOR;
}

// ============================================================================
// ANGLE CALCULATION
// ============================================================================

type Point3D = { x: number; y: number; z?: number };

function getPoint(kp: Keypoint | null): Point3D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y, z: kp.z };
}

/**
 * Calculate all 8 joint angles from keypoints.
 * Uses existing calculation functions.
 */
function calculateJointAngles(keypoints: Keypoint[]): AngleSet | null {
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');
  const leftElbow = getKeypoint(keypoints, 'left_elbow');
  const rightElbow = getKeypoint(keypoints, 'right_elbow');
  const leftWrist = getKeypoint(keypoints, 'left_wrist');
  const rightWrist = getKeypoint(keypoints, 'right_wrist');
  const leftHip = getKeypoint(keypoints, 'left_hip');
  const rightHip = getKeypoint(keypoints, 'right_hip');
  const leftIndex = getKeypoint(keypoints, 'left_index');
  const rightIndex = getKeypoint(keypoints, 'right_index');
  const nose = getKeypoint(keypoints, 'nose');
  const leftEar = getKeypoint(keypoints, 'left_ear');
  const rightEar = getKeypoint(keypoints, 'right_ear');

  const leftOk =
    leftShoulder &&
    leftElbow &&
    leftWrist &&
    leftHip &&
    isVisible(leftShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(leftElbow, VISIBILITY_THRESHOLD) &&
    isVisible(leftWrist, VISIBILITY_THRESHOLD) &&
    isVisible(leftHip, VISIBILITY_THRESHOLD);

  const rightOk =
    rightShoulder &&
    rightElbow &&
    rightWrist &&
    rightHip &&
    isVisible(rightShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(rightElbow, VISIBILITY_THRESHOLD) &&
    isVisible(rightWrist, VISIBILITY_THRESHOLD) &&
    isVisible(rightHip, VISIBILITY_THRESHOLD);

  if (!leftOk && !rightOk) return null;

  // Elbow angles (2D projection — FSM thresholds are tuned for XY-projected angles)
  const leftElbowAngle = leftOk
    ? calculateAngle2D(getPoint(leftShoulder)!, getPoint(leftElbow)!, getPoint(leftWrist)!)
    : NaN;
  const rightElbowAngle = rightOk
    ? calculateAngle2D(getPoint(rightShoulder)!, getPoint(rightElbow)!, getPoint(rightWrist)!)
    : NaN;

  // Shoulder angles (flexion only) - project upper arm onto sagittal plane, exclude abduction/adduction
  const leftShoulderAngle =
    leftOk && rightShoulder && isVisible(rightShoulder, VISIBILITY_THRESHOLD)
      ? calculateShoulderFlexionAngle(
          getPoint(leftHip)!,
          getPoint(leftShoulder)!,
          getPoint(leftElbow)!,
          getPoint(rightShoulder)!
        )
      : NaN;
  const rightShoulderAngle =
    rightOk && leftShoulder && isVisible(leftShoulder, VISIBILITY_THRESHOLD)
      ? calculateShoulderFlexionAngle(
          getPoint(rightHip)!,
          getPoint(rightShoulder)!,
          getPoint(rightElbow)!,
          getPoint(leftShoulder)!
        )
      : NaN;

  // Torso angles (hip-shoulder, signed: + = forward, - = back)
  const leftTorsoAngle = leftOk
    ? calculateSignedVerticalAngle(getPoint(leftHip)!, getPoint(leftShoulder)!)
    : NaN;
  const rightTorsoAngle = rightOk
    ? calculateSignedVerticalAngle(getPoint(rightHip)!, getPoint(rightShoulder)!)
    : NaN;

  // Midline torso angle: hip center -> head (nose or mid-ear). Projected onto sagittal plane.
  // Uses head instead of shoulder center because shoulder landmarks drift with arm movement
  // during curls; the head stays relatively stable.
  const hipCenter =
    leftHip && rightHip && isVisible(leftHip, VISIBILITY_THRESHOLD) && isVisible(rightHip, VISIBILITY_THRESHOLD)
      ? {
          x: (leftHip.x + rightHip.x) / 2,
          y: (leftHip.y + rightHip.y) / 2,
          z: ((leftHip.z ?? 0) + (rightHip.z ?? 0)) / 2,
        }
      : null;
  const shoulderCenter =
    leftShoulder &&
    rightShoulder &&
    isVisible(leftShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(rightShoulder, VISIBILITY_THRESHOLD)
      ? {
          x: (leftShoulder.x + rightShoulder.x) / 2,
          y: (leftShoulder.y + rightShoulder.y) / 2,
          z: ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0)) / 2,
        }
      : null;
  const headPoint =
    nose && isVisible(nose, VISIBILITY_THRESHOLD)
      ? getPoint(nose)
      : leftEar &&
          rightEar &&
          isVisible(leftEar, VISIBILITY_THRESHOLD) &&
          isVisible(rightEar, VISIBILITY_THRESHOLD)
        ? {
            x: (leftEar.x + rightEar.x) / 2,
            y: (leftEar.y + rightEar.y) / 2,
            z: ((leftEar.z ?? 0) + (rightEar.z ?? 0)) / 2,
          }
        : null;
  const torsoUpperPoint = headPoint ?? shoulderCenter;
  const torsoAngle =
    hipCenter && torsoUpperPoint && (leftShoulder && rightShoulder)
      ? (() => {
          const angle = calculateSignedVerticalAngleSagittal(
            hipCenter,
            torsoUpperPoint,
            getPoint(leftHip)!,
            getPoint(rightHip)!,
            getPoint(leftShoulder)!,
            getPoint(rightShoulder)!
          );
          return Number.isNaN(angle) ? calculateSignedVerticalAngle(hipCenter, torsoUpperPoint) : angle;
        })()
      : NaN;

  // Wrist angles (elbow-wrist-index as proxy for wrist angle)
  const leftWristAngle =
    leftOk && leftIndex && isVisible(leftIndex, VISIBILITY_THRESHOLD)
      ? calculateAngle2D(getPoint(leftElbow)!, getPoint(leftWrist)!, getPoint(leftIndex)!)
      : 180; // neutral if not visible
  const rightWristAngle =
    rightOk && rightIndex && isVisible(rightIndex, VISIBILITY_THRESHOLD)
      ? calculateAngle2D(getPoint(rightElbow)!, getPoint(rightWrist)!, getPoint(rightIndex)!)
      : 180;

  return {
    leftElbow: leftElbowAngle,
    rightElbow: rightElbowAngle,
    leftShoulder: leftShoulderAngle,
    rightShoulder: rightShoulderAngle,
    leftTorso: leftTorsoAngle,
    rightTorso: rightTorsoAngle,
    torso: torsoAngle,
    leftWrist: leftWristAngle,
    rightWrist: rightWristAngle,
  };
}

// ============================================================================
// SMOOTHING
// ============================================================================

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function applySmoothing(
  rawAngles: AngleSet,
  history: BarbellCurlState['angleHistory'],
  prevSmoothed: SmoothedAngles | null
): SmoothedAngles {
  const keys: (keyof AngleSet)[] = [
    'leftElbow',
    'rightElbow',
    'leftShoulder',
    'rightShoulder',
    'leftTorso',
    'rightTorso',
    'torso',
    'leftWrist',
    'rightWrist',
  ];

  const medianFiltered: Partial<SmoothedAngles> = {};

  for (const key of keys) {
    const value = rawAngles[key];
    if (isNaN(value)) {
      medianFiltered[key] = prevSmoothed?.[key] ?? NaN;
      continue;
    }

    // Update circular buffer
    history[key].push(value);
    if (history[key].length > MEDIAN_WINDOW) {
      history[key].shift();
    }

    // Apply median filter
    const medianValue = median(history[key]);

    // Apply EMA
    const prev = prevSmoothed?.[key];
    medianFiltered[key] =
      prev !== undefined && !isNaN(prev)
        ? EMA_ALPHA * medianValue + (1 - EMA_ALPHA) * prev
        : medianValue;
  }

  return medianFiltered as SmoothedAngles;
}

// ============================================================================
// FSM LOGIC
// ============================================================================

function updateArmFSM(arm: ArmFSM, elbowAngle: number, t: number): ArmFSM {
  const newArm = { ...arm };

  switch (arm.state) {
    case 'REST':
      if (elbowAngle < THRESHOLDS.EXTENDED_EXIT) {
        newArm.state = 'UP';
        newArm.tRestEntry = null;
        newArm.tRestToUp = t;
        newArm.minElbow = elbowAngle;
        newArm.maxElbow = elbowAngle;
      }
      break;

    case 'UP':
      newArm.minElbow = Math.min(newArm.minElbow, elbowAngle);
      newArm.maxElbow = Math.max(newArm.maxElbow, elbowAngle);
      if (elbowAngle < THRESHOLDS.FLEXED_ENTER) {
        newArm.state = 'TOP';
        newArm.tUpToTop = t;
      }
      break;

    case 'TOP':
      newArm.minElbow = Math.min(newArm.minElbow, elbowAngle);
      newArm.maxElbow = Math.max(newArm.maxElbow, elbowAngle);
      if (elbowAngle > THRESHOLDS.FLEXED_EXIT) {
        newArm.state = 'DOWN';
        newArm.tTopToDown = t;
      }
      break;

    case 'DOWN':
      newArm.minElbow = Math.min(newArm.minElbow, elbowAngle);
      newArm.maxElbow = Math.max(newArm.maxElbow, elbowAngle);
      if (
        elbowAngle > THRESHOLDS.EXTENDED_ENTER &&
        newArm.tRestToUp !== null &&
        t - newArm.tRestToUp >= THRESHOLDS.MIN_REP_TIME
      ) {
        newArm.state = 'REST';
        newArm.tRestEntry = t;
        newArm.tDownToRest = t;
      }
      break;
  }

  return newArm;
}

function isValidRep(arm: ArmFSM): boolean {
  return (
    arm.minElbow <= THRESHOLDS.FLEXED_ENTER &&
    arm.maxElbow >= THRESHOLDS.EXTENDED_ENTER &&
    arm.maxElbow - arm.minElbow >= THRESHOLDS.ROM_MIN
  );
}

// ============================================================================
// FORM EVALUATION
// ============================================================================

function evaluateForm(
  repWindow: RepWindow,
  leftArm: ArmFSM,
  rightArm: ArmFSM,
  viewAngle: ViewAngle
): { score: number; messages: string[] } {
  const { minAngles, maxAngles } = repWindow;
  const messages: string[] = [];
  const isFrontal = viewAngle.zone === 'frontal';
  const isSide = viewAngle.zone === 'side';

  // Helper: get elbow values based on view — use primary arm only for non-frontal
  const leftElbowOk = isFinite(minAngles.leftElbow) && isFinite(maxAngles.leftElbow);
  const rightElbowOk = isFinite(minAngles.rightElbow) && isFinite(maxAngles.rightElbow);
  const primaryIsLeft = viewAngle.primarySide !== 'right';

  // For frontal: use both arms as before. For oblique/side: use primary arm only.
  const minFlex = isFrontal
    ? Math.min(
        leftElbowOk ? minAngles.leftElbow : Infinity,
        rightElbowOk ? minAngles.rightElbow : Infinity
      )
    : primaryIsLeft
      ? (leftElbowOk ? minAngles.leftElbow : Infinity)
      : (rightElbowOk ? minAngles.rightElbow : Infinity);

  const maxExt = isFrontal
    ? Math.max(
        leftElbowOk ? maxAngles.leftElbow : -Infinity,
        rightElbowOk ? maxAngles.rightElbow : -Infinity
      )
    : primaryIsLeft
      ? (leftElbowOk ? maxAngles.leftElbow : -Infinity)
      : (rightElbowOk ? maxAngles.rightElbow : -Infinity);

  // 1. Flex/extend depth — adjust thresholds for 2D foreshortening at oblique angles
  const adjFlexed = adjustFlexionThreshold(THRESHOLDS.FLEXED_ENTER, viewAngle);
  const adjExtended = adjustExtensionThreshold(THRESHOLDS.EXTENDED_ENTER, viewAngle);

  if (isFinite(minFlex) && minFlex > adjFlexed) {
    messages.push('Flex more at the top of the curl.');
  }
  if (isFinite(maxExt) && maxExt < adjExtended) {
    messages.push('Extend fully at the bottom.');
  }

  // 2. ROM
  const romL = leftElbowOk ? maxAngles.leftElbow - minAngles.leftElbow : 0;
  const romR = rightElbowOk ? maxAngles.rightElbow - minAngles.rightElbow : 0;
  const primaryRom = primaryIsLeft ? romL : romR;

  if (isFrontal) {
    if ((romL < THRESHOLDS.ROM_MIN || romR < THRESHOLDS.ROM_MIN) && messages.length === 0) {
      messages.push('Incomplete rep — curl all the way up and fully extend.');
    }
  } else {
    if (primaryRom < THRESHOLDS.ROM_MIN && messages.length === 0) {
      messages.push('Incomplete rep — curl all the way up and fully extend.');
    }
  }

  // 3. Shoulder takeover (skip at side angles — cross-arm data unreliable)
  const deltaShL = maxAngles.leftShoulder - minAngles.leftShoulder;
  const deltaShR = maxAngles.rightShoulder - minAngles.rightShoulder;
  if (!isSide) {
    // Use only finite values (NaN shoulder means that side's data is missing)
    const shValues: number[] = [];
    if (isFinite(deltaShL)) shValues.push(deltaShL);
    if (isFinite(deltaShR)) shValues.push(deltaShR);
    const maxDeltaSh = shValues.length > 0 ? Math.max(...shValues) : 0;

    if (maxDeltaSh > FORM_THRESHOLDS.SHOULDER_FAIL) {
      messages.push('Too much shoulder involvement — reduce the weight.');
    } else if (maxDeltaSh > FORM_THRESHOLDS.SHOULDER_WARN) {
      messages.push('Upper arms moving — keep elbows pinned to your sides.');
    }
  }

  // 4. Torso swing (works at all angles — sagittal projection is rotation-invariant)
  const deltaTorso = maxAngles.torso - minAngles.torso;
  if (isFinite(deltaTorso)) {
    if (deltaTorso > FORM_THRESHOLDS.TORSO_FAIL) {
      messages.push('Excessive body swing — this is cheating the rep.');
    } else if (deltaTorso > FORM_THRESHOLDS.TORSO_WARN) {
      messages.push("Don't swing your torso — stay upright and controlled.");
    }
  }

  // 5. Wrist neutrality (disabled - no feedback)

  // 6. Tempo (use primary arm in non-frontal)
  const tempoArm = isFrontal ? leftArm : (primaryIsLeft ? leftArm : rightArm);
  const tUp = tempoArm.tUpToTop && tempoArm.tRestToUp ? tempoArm.tUpToTop - tempoArm.tRestToUp : 0;
  const tDown =
    tempoArm.tDownToRest && tempoArm.tTopToDown ? tempoArm.tDownToRest - tempoArm.tTopToDown : 0;

  if (tUp < FORM_THRESHOLDS.TEMPO_UP_MIN && tUp > 0) {
    messages.push('Slow down — control the curl.');
  }
  if (tDown < FORM_THRESHOLDS.TEMPO_DOWN_MIN && tDown > 0) {
    messages.push("Control the lowering — don't drop the weight.");
  }

  // 7. Symmetry (only in frontal — can't compare arms when one is occluded)
  if (isFrontal && leftElbowOk && rightElbowOk) {
    const deltaMin = Math.abs(minAngles.leftElbow - minAngles.rightElbow);
    const deltaRom = Math.abs(romL - romR);
    if (deltaMin > FORM_THRESHOLDS.SYMMETRY_MIN || deltaRom > FORM_THRESHOLDS.SYMMETRY_ROM) {
      messages.push('Arms are uneven — curl both sides together.');
    }
  }

  // ── Score: continuous penalty curves ──
  const score = computeRepScore(repWindow, leftArm, rightArm, viewAngle);

  return { score, messages };
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

export function updateBarbellCurlState(
  keypoints: Keypoint[],
  currentState: BarbellCurlState
): BarbellCurlState {
  const t = Date.now() / 1000; // seconds

  // Estimate view angle (Fix 1)
  const viewAngle = estimateViewAngle(keypoints, currentState.viewAngle.smoothedAngleDeg);

  // Calculate raw angles
  const rawAngles = calculateJointAngles(keypoints);
  if (!rawAngles) {
    return { ...currentState, displayAngles: null, viewAngle };
  }

  // Apply smoothing
  const smoothed = applySmoothing(rawAngles, currentState.angleHistory, currentState.smoothed);

  // Warm-up gate: require consecutive stable frames before enabling FSM
  const frameStable = isFrameStable(keypoints);
  let warmupFrames = currentState.warmupFrames;
  if (frameStable) {
    warmupFrames = Math.min(warmupFrames + 1, WARMUP_REQUIRED + 1);
  } else {
    warmupFrames = Math.max(0, warmupFrames - 2); // decay faster than accumulate
  }

  // Update display angles (use smoothed for stable UI)
  const newState: BarbellCurlState = {
    ...currentState,
    smoothed,
    displayAngles: smoothed,
    viewAngle,
    warmupFrames,
  };

  // Skip FSM until skeleton is stable
  if (warmupFrames < WARMUP_REQUIRED) {
    return newState;
  }

  // Determine which arms have valid elbow angles (Fix 2: single-arm fallback)
  const leftValid = !isNaN(smoothed.leftElbow);
  const rightValid = !isNaN(smoothed.rightElbow);

  // If neither arm is valid, bail
  if (!leftValid && !rightValid) {
    return newState;
  }

  const isSingleArm = !leftValid || !rightValid;

  // Update per-arm FSMs (only for valid arms)
  const prevLeftState = currentState.leftArm.state;
  const prevRightState = currentState.rightArm.state;
  if (leftValid) {
    newState.leftArm = updateArmFSM(currentState.leftArm, smoothed.leftElbow, t);
  }
  if (rightValid) {
    newState.rightArm = updateArmFSM(currentState.rightArm, smoothed.rightElbow, t);
  }

  // Track rep window (accumulate data while any active arm is not in REST)
  const leftInRep = leftValid && newState.leftArm.state !== 'REST';
  const rightInRep = rightValid && newState.rightArm.state !== 'REST';
  const inRep = leftInRep || rightInRep;
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(t);
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update min/max for all angles (NaN-safe — only updates if value is valid)
    const keys: (keyof AngleSet)[] = [
      'leftElbow', 'rightElbow',
      'leftShoulder', 'rightShoulder',
      'leftTorso', 'rightTorso',
      'torso',
      'leftWrist', 'rightWrist',
    ];
    for (const key of keys) {
      const val = smoothed[key];
      if (!isNaN(val)) {
        window.minAngles[key] = Math.min(window.minAngles[key], val);
        window.maxAngles[key] = Math.max(window.maxAngles[key], val);
      }
    }

    // Track wrist deviation duration
    if (leftValid && Math.abs(smoothed.leftWrist - FORM_THRESHOLDS.WRIST_NEUTRAL) > FORM_THRESHOLDS.WRIST_DEV_WARN) {
      window.wristDevFrames.left++;
    }
    if (rightValid && Math.abs(smoothed.rightWrist - FORM_THRESHOLDS.WRIST_NEUTRAL) > FORM_THRESHOLDS.WRIST_DEV_WARN) {
      window.wristDevFrames.right++;
    }
  }

  // ── Rep completion logic ──
  if (viewAngle.zone === 'frontal' && !isSingleArm) {
    // FRONTAL MODE: unchanged two-arm sync logic
    const bothInRest = newState.leftArm.state === 'REST' && newState.rightArm.state === 'REST';
    const leftJustFinished = prevLeftState === 'DOWN' && newState.leftArm.state === 'REST';
    const rightJustFinished = prevRightState === 'DOWN' && newState.rightArm.state === 'REST';

    if (bothInRest && (leftJustFinished || rightJustFinished) && newState.repWindow) {
      const leftEndTime = newState.leftArm.tDownToRest ?? t;
      const rightEndTime = newState.rightArm.tDownToRest ?? t;
      const syncDelta = Math.abs(leftEndTime - rightEndTime);

      if (syncDelta <= THRESHOLDS.SYNC_WINDOW) {
        completeRep(newState, t, viewAngle);
      } else {
        // Not synced — reset
        newState.repWindow = null;
        newState.leftArm = initArmFSM();
        newState.rightArm = initArmFSM();
      }
    }
  } else {
    // OBLIQUE/SIDE MODE or single-arm: count rep from the primary (visible) arm
    const primaryArm = getPrimaryArm(viewAngle, leftValid, rightValid);
    const armState = primaryArm === 'left' ? newState.leftArm : newState.rightArm;
    const prevArmState = primaryArm === 'left' ? prevLeftState : prevRightState;

    const justFinished = prevArmState === 'DOWN' && armState.state === 'REST';

    if (justFinished && newState.repWindow) {
      completeRep(newState, t, viewAngle);
    }
  }

  // Clear feedback after duration
  if (newState.feedback && t - newState.lastFeedbackTime > 2.0) {
    newState.feedback = null;
  }

  return newState;
}

/** Determine which arm to use as primary for rep counting in non-frontal modes. */
function getPrimaryArm(
  viewAngle: ViewAngle,
  leftValid: boolean,
  rightValid: boolean
): 'left' | 'right' {
  // If only one arm is valid, use that one
  if (leftValid && !rightValid) return 'left';
  if (rightValid && !leftValid) return 'right';
  // Both valid — use the side facing the camera
  if (viewAngle.primarySide === 'left') return 'left';
  if (viewAngle.primarySide === 'right') return 'right';
  // Default to left
  return 'left';
}

/** Complete a rep: evaluate form, update state, reset FSMs. */
function completeRep(
  newState: BarbellCurlState,
  t: number,
  viewAngle: ViewAngle
): void {
  newState.repCount++;

  const romL = newState.leftArm.maxElbow - newState.leftArm.minElbow;
  const romR = newState.rightArm.maxElbow - newState.rightArm.minElbow;

  // Use primary arm for tempo in non-frontal modes
  const tempoArm = viewAngle.zone === 'frontal'
    ? newState.leftArm
    : (viewAngle.primarySide === 'right' ? newState.rightArm : newState.leftArm);

  const tUp =
    tempoArm.tUpToTop && tempoArm.tRestToUp
      ? tempoArm.tUpToTop - tempoArm.tRestToUp
      : 0;
  const tDown =
    tempoArm.tDownToRest && tempoArm.tTopToDown
      ? tempoArm.tDownToRest - tempoArm.tTopToDown
      : 0;

  const { score, messages } = evaluateForm(
    newState.repWindow!,
    newState.leftArm,
    newState.rightArm,
    viewAngle
  );

  newState.lastRepResult = {
    repIndex: newState.repCount,
    romL,
    romR,
    tUp,
    tDown,
    score,
    messages,
  };

  if (messages.length > 0) {
    newState.feedback = messages.join('\n');
  } else {
    newState.feedback = viewAngle.zone === 'frontal' ? 'Great rep!' : 'Good rep.';
  }
  newState.lastFeedbackTime = t;

  // Reset rep window and arms
  newState.repWindow = null;
  newState.leftArm = initArmFSM();
  newState.rightArm = initArmFSM();
}

// ============================================================================
// UI HELPERS
// ============================================================================

export function getDisplayAnglesForUI(state: BarbellCurlState): {
  leftElbow: number | null;
  rightElbow: number | null;
  leftShoulder: number | null;
  rightShoulder: number | null;
  leftHip: number | null;
  rightHip: number | null;
  leftKnee: number | null;
  rightKnee: number | null;
} {
  const angles = state.displayAngles;
  return {
    leftElbow: angles?.leftElbow ?? null,
    rightElbow: angles?.rightElbow ?? null,
    leftShoulder: angles?.leftShoulder ?? null,
    rightShoulder: angles?.rightShoulder ?? null,
    leftHip: null, // Not tracked
    rightHip: null,
    leftKnee: null,
    rightKnee: null,
  };
}

export function getCurrentFormScore(state: BarbellCurlState): number {
  return state.lastRepResult?.score ?? 0;
}

export function getCurrentFeedback(state: BarbellCurlState): string | null {
  return state.feedback;
}

export function getRepCount(state: BarbellCurlState): number {
  return state.repCount;
}

/** Debug: returns torso angles used for swing detection (for on-screen debugging) */
export function getTorsoDebugInfo(state: BarbellCurlState): {
  torso: number | null;
  leftTorso: number | null;
  rightTorso: number | null;
  torsoDelta: number | null;
  leftTorsoDelta: number | null;
  rightTorsoDelta: number | null;
} {
  const angles = state.displayAngles;
  const window = state.repWindow;
  const format = (v: number) =>
    typeof v === 'number' && !isNaN(v) && isFinite(v) ? v : null;
  const safeDelta = (min: number, max: number) =>
    format(
      min !== Infinity && max !== -Infinity ? max - min : NaN
    );
  return {
    torso: format(angles?.torso ?? NaN),
    leftTorso: format(angles?.leftTorso ?? NaN),
    rightTorso: format(angles?.rightTorso ?? NaN),
    torsoDelta: window ? safeDelta(window.minAngles.torso, window.maxAngles.torso) : null,
    leftTorsoDelta: window
      ? safeDelta(window.minAngles.leftTorso, window.maxAngles.leftTorso)
      : null,
    rightTorsoDelta: window
      ? safeDelta(window.minAngles.rightTorso, window.maxAngles.rightTorso)
      : null,
  };
}
