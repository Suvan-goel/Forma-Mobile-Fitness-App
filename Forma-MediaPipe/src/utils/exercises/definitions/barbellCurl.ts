/**
 * Barbell Curl — Exercise Definition (Exercise Framework)
 *
 * Uses ratio-based metrics for camera-angle-invariant form detection.
 * Primary metric: reach ratio = dist(shoulder,wrist) / (dist(shoulder,elbow) + dist(elbow,wrist))
 *   - Fully extended arm: ~0.95-1.0
 *   - Fully curled (top of curl): ~0.40-0.50
 *   - Camera-invariant: foreshortening scales numerator and denominator equally
 *
 * The only export is `barbellCurlDefinition`.
 */

import {
  Keypoint,
  calculateAngle2D,
  calculateSignedVerticalAngle,
  calculateSignedVerticalAngleSagittal,
  calculateShoulderFlexionAngle,
  getKeypoint,
  isVisible,
} from '../../poseAnalysis';

import type { ExerciseDefinition, ExerciseState, RepResult as FrameworkRepResult } from '../types';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/**
 * FSM thresholds — ratio-based (camera-angle invariant).
 * Reach ratio: dist(shoulder,wrist) / (dist(shoulder,elbow) + dist(elbow,wrist))
 *   1.0 = perfectly straight arm, 0.0 = wrist at shoulder
 */
const THRESHOLDS = {
  /** Reach ratio above which arm is considered fully extended → rep complete */
  EXTENDED_ENTER: 0.92,
  /** Reach ratio below which we start detecting upward motion from REST */
  EXTENDED_EXIT: 0.88,
  /** Reach ratio below which arm is considered fully curled → top of curl */
  FLEXED_ENTER: 0.54,
  /** Reach ratio above which we start detecting downward motion from TOP */
  FLEXED_EXIT: 0.57,
  MIN_REP_TIME: 0.25, // seconds
  SYNC_WINDOW: 0.75, // seconds between arms
  /** Minimum reach ratio ROM (max - min) for a valid rep */
  ROM_MIN: 0.38,
  /** Min seconds the arm must be in DOWN state before normal completion.
   *  Filters pose-estimation noise spikes. */
  MIN_DOWN_GUARD: 0.10,
} as const;

/** Form heuristic thresholds — ratios where applicable, degrees for angular metrics */
const FORM_THRESHOLDS = {
  // Shoulder movement delta (degrees) — already camera-invariant as a delta
  SHOULDER_WARN: 45,
  SHOULDER_FAIL: 65,
  // Torso swing delta (degrees) — already camera-invariant (sagittal projection)
  TORSO_WARN: 15,
  TORSO_FAIL: 22,
  WRIST_NEUTRAL: 180, // straight wrist reference
  WRIST_DEV_WARN: 25,
  WRIST_DEV_DURATION: 0.5, // 50% of rep
  /** Tempo thresholds for visual feedback. These are intentionally lower than
   * scoring thresholds because phase timestamps measure threshold-crossing time,
   * not the user's full bottom-to-top / top-to-bottom movement. */
  TEMPO_UP_FEEDBACK_MIN: 0.25,
  TEMPO_DOWN_FEEDBACK_MIN: 0.30,
  TEMPO_DOWN_ESCAPE_MIN: 0.15,
  TEMPO_UP_SCORE_WARN: 0.4,
  TEMPO_DOWN_SCORE_WARN: 0.5,
  /** Symmetry: max allowed ratio difference between arms */
  SYMMETRY_MIN_RATIO: 0.10, // min reach ratio difference between arms
  SYMMETRY_ROM_RATIO: 0.12, // ROM ratio difference between arms
  /** Elbow flare: angle of the upper arm from vertical in the frontal plane. */
  ELBOW_FLARE_WARN: 30,
  ELBOW_FLARE_FAIL: 45,
  /** Reach ratio thresholds for form messages */
  FLEX_RATIO_WARN: 0.55,  // min ratio above this → "flex more at top"
  EXTEND_RATIO_WARN: 0.90, // max ratio below this → "extend fully"
} as const;

/** Reliability gates for per-rep feedback. */
const QUALITY_THRESHOLDS = {
  MIN_METRIC_COVERAGE: 0.60,
  MIN_PRIMARY_RATIO_COVERAGE: 0.70,
  MIN_BILATERAL_RATIO_COVERAGE: 0.60,
  MIN_FRONTAL_COVERAGE: 0.70,
  MIN_TORSO_COVERAGE: 0.60,
  UNCERTAIN_SCORE_CAP: 80,
} as const;

/** Smoothing parameters */
const MEDIAN_WINDOW = 4;
const EMA_ALPHA = 0.4;
const VISIBILITY_THRESHOLD = 0.15;

/** Warm-up: require N consecutive stable frames before enabling FSM */
const WARMUP_REQUIRED = 12;          // ~0.6s at 20fps
const WARMUP_VISIBILITY_MIN = 0.3;   // avg visibility of 8 key joints must exceed this

// ============================================================================
// CONTINUOUS PENALTY FUNCTIONS (ratio-based where applicable)
// All use quadratic ramps: penalty(x) = min(cap, scale * max(0, x - deadzone)^2)
// ============================================================================

/** Torso swing penalty — max 35 pts. Deadzone 10deg (shoulder drift + breathing/sway/noise).
 *  Already camera-invariant: measures delta within a single rep. */
function penaltyTorso(delta: number): number {
  const d = Math.max(0, delta - 10);
  return Math.min(35, 0.40 * d * d);
}

/** Shoulder movement penalty — max 30 pts. Deadzone 10deg (normal stabilisation).
 *  Already camera-invariant: measures delta within a single rep. */
function penaltyShoulder(delta: number): number {
  const d = Math.max(0, delta - 10);
  return Math.min(30, 0.018 * d * d);
}

/** ROM shortfall penalty — ratio-based, no foreshortening compensation needed.
 *  max 35 pts. Flex (min ratio too high) + extension (max ratio too low).
 *
 *  Target: minRatio ≤ 0.48 (fully curled), maxRatio ≥ 0.93 (fully extended).
 *  Ratios are inherently camera-invariant. */
function penaltyROM(minRatio: number, maxRatio: number): number {
  // Flex shortfall: penalize if min ratio is above 0.48 (didn't curl enough)
  const FLEX_TARGET = 0.48;
  const flexShortfall = Math.max(0, minRatio - FLEX_TARGET);
  // Scale: at ratio 0.58 (10% short), penalty = 300 * 0.10^2 = 3pts
  // At ratio 0.68 (20% short), penalty = 300 * 0.20^2 = 12pts
  const flexPenalty = Math.min(20, 300 * flexShortfall * flexShortfall);

  // Extension shortfall: penalize if max ratio is below 0.93 (didn't extend enough)
  const EXT_TARGET = 0.93;
  const extShortfall = Math.max(0, EXT_TARGET - maxRatio);
  // Scale: at ratio 0.83 (10% short), penalty = 300 * 0.10^2 = 3pts
  const extPenalty = Math.min(20, 300 * extShortfall * extShortfall);

  return Math.min(35, flexPenalty + extPenalty);
}

/** Tempo penalty — max 20 pts. Concentric < 0.4s or eccentric < 0.5s. */
function penaltyTempo(tUp: number, tDown: number): number {
  let upPenalty = 0;
  if (tUp > 0 && tUp < FORM_THRESHOLDS.TEMPO_UP_SCORE_WARN) {
    const deficit = FORM_THRESHOLDS.TEMPO_UP_SCORE_WARN - tUp;
    upPenalty = Math.min(10, 60 * deficit * deficit);
  }
  let downPenalty = 0;
  if (tDown > 0 && tDown < FORM_THRESHOLDS.TEMPO_DOWN_SCORE_WARN) {
    const deficit = FORM_THRESHOLDS.TEMPO_DOWN_SCORE_WARN - tDown;
    downPenalty = Math.min(10, 40 * deficit * deficit);
  }
  return Math.min(20, upPenalty + downPenalty);
}

/** Elbow flare penalty — max 20 pts. Deadzone 15deg (some natural abduction is normal). */
function penaltyElbowFlare(maxFlareDeg: number): number {
  const d = Math.max(0, maxFlareDeg - 15);
  return Math.min(20, 0.022 * d * d);
}

/** Asymmetry penalty — ratio-based. max 15 pts.
 *  Compares reach ratio differences between arms (camera-invariant). */
function penaltyAsymmetry(deltaMinRatio: number, deltaRomRatio: number): number {
  // Scale: at 0.10 diff, penalty = 500 * 0.10^2 = 5pts. At 0.20 diff = 20pts (capped at 10).
  const minPenalty = Math.min(10, 500 * deltaMinRatio * deltaMinRatio);
  const romPenalty = Math.min(10, 500 * deltaRomRatio * deltaRomRatio);
  return Math.min(15, minPenalty + romPenalty);
}

/** Compute a continuous rep score from ratio-based measurements. */
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
  const frameCount = Math.max(1, repWindow.frameCount);
  const coverage = (frames: number) => frames / frameCount;
  const leftRatioCoverage = coverage(repWindow.quality.leftRatioFrames);
  const rightRatioCoverage = coverage(repWindow.quality.rightRatioFrames);
  const primaryRatioCoverage = primaryIsLeft ? leftRatioCoverage : rightRatioCoverage;
  const hasPrimaryRatioQuality = primaryRatioCoverage >= QUALITY_THRESHOLDS.MIN_PRIMARY_RATIO_COVERAGE;
  const hasBilateralRatioQuality =
    leftRatioCoverage >= QUALITY_THRESHOLDS.MIN_BILATERAL_RATIO_COVERAGE &&
    rightRatioCoverage >= QUALITY_THRESHOLDS.MIN_BILATERAL_RATIO_COVERAGE;
  const hasRatioQuality = isFrontal ? hasBilateralRatioQuality : hasPrimaryRatioQuality;
  const hasFrontalQuality = isFrontal && coverage(repWindow.quality.frontalFrames) >= QUALITY_THRESHOLDS.MIN_FRONTAL_COVERAGE;
  const hasTorsoQuality = coverage(repWindow.quality.torsoFrames) >= QUALITY_THRESHOLDS.MIN_TORSO_COVERAGE;
  const leftShoulderQuality = coverage(repWindow.quality.leftShoulderFrames) >= QUALITY_THRESHOLDS.MIN_METRIC_COVERAGE;
  const rightShoulderQuality = coverage(repWindow.quality.rightShoulderFrames) >= QUALITY_THRESHOLDS.MIN_METRIC_COVERAGE;

  // Torso penalty (delta-based, already camera-invariant)
  const deltaTorso = isFinite(maxAngles.torso - minAngles.torso)
    ? maxAngles.torso - minAngles.torso
    : 0;
  const torsoP = hasTorsoQuality ? penaltyTorso(deltaTorso) : 0;

  // Shoulder penalty (delta-based, skip at side angles)
  let shoulderP = 0;
  if (!isSide) {
    const deltaShL = maxAngles.leftShoulder - minAngles.leftShoulder;
    const deltaShR = maxAngles.rightShoulder - minAngles.rightShoulder;
    const shValues: number[] = [];
    if (leftShoulderQuality && isFinite(deltaShL)) shValues.push(deltaShL);
    if (rightShoulderQuality && isFinite(deltaShR)) shValues.push(deltaShR);
    const maxDeltaSh = shValues.length > 0 ? Math.max(...shValues) : 0;
    shoulderP = penaltyShoulder(maxDeltaSh);
  }

  // ROM penalty — ratio-based (camera-invariant, no foreshortening compensation)
  const leftRatioOk = isFinite(repWindow.ratios.minLeftRatio) && isFinite(repWindow.ratios.maxLeftRatio);
  const rightRatioOk = isFinite(repWindow.ratios.minRightRatio) && isFinite(repWindow.ratios.maxRightRatio);
  let minRatio: number;
  let maxRatio: number;
  if (isFrontal) {
    minRatio = Math.min(
      leftRatioOk ? repWindow.ratios.minLeftRatio : Infinity,
      rightRatioOk ? repWindow.ratios.minRightRatio : Infinity
    );
    maxRatio = Math.max(
      leftRatioOk ? repWindow.ratios.maxLeftRatio : -Infinity,
      rightRatioOk ? repWindow.ratios.maxRightRatio : -Infinity
    );
  } else {
    minRatio = primaryIsLeft
      ? (leftRatioOk ? repWindow.ratios.minLeftRatio : 0.45)
      : (rightRatioOk ? repWindow.ratios.minRightRatio : 0.45);
    maxRatio = primaryIsLeft
      ? (leftRatioOk ? repWindow.ratios.maxLeftRatio : 0.95)
      : (rightRatioOk ? repWindow.ratios.maxRightRatio : 0.95);
  }
  const romP = hasRatioQuality
    ? penaltyROM(
        isFinite(minRatio) ? minRatio : 0.45,
        isFinite(maxRatio) ? maxRatio : 0.95
      )
    : 0;

  // Tempo penalty — average across both arms in frontal mode
  const tUpL = leftArm.tUpToTop && leftArm.tRestToUp ? leftArm.tUpToTop - leftArm.tRestToUp : 0;
  const tUpR = _rightArm.tUpToTop && _rightArm.tRestToUp ? _rightArm.tUpToTop - _rightArm.tRestToUp : 0;
  const tDownL = leftArm.tDownToRest && leftArm.tTopToDown ? leftArm.tDownToRest - leftArm.tTopToDown : 0;
  const tDownR = _rightArm.tDownToRest && _rightArm.tTopToDown ? _rightArm.tDownToRest - _rightArm.tTopToDown : 0;
  let tUp: number;
  let tDown: number;
  if (isFrontal) {
    tUp   = tUpL > 0 && tUpR > 0   ? (tUpL + tUpR) / 2   : Math.max(tUpL, tUpR);
    tDown = tDownL > 0 && tDownR > 0 ? (tDownL + tDownR) / 2 : Math.max(tDownL, tDownR);
  } else {
    const tempoArm = primaryIsLeft ? leftArm : _rightArm;
    tUp   = tempoArm.tUpToTop   && tempoArm.tRestToUp  ? tempoArm.tUpToTop   - tempoArm.tRestToUp  : 0;
    tDown = tempoArm.tDownToRest && tempoArm.tTopToDown ? tempoArm.tDownToRest - tempoArm.tTopToDown : 0;
  }
  const tempoP = penaltyTempo(tUp, tDown);

  // Asymmetry penalty — ratio-based (camera-invariant)
  let asymmetryP = 0;
  if (hasFrontalQuality && hasBilateralRatioQuality && leftRatioOk && rightRatioOk) {
    const romLRatio = repWindow.ratios.maxLeftRatio - repWindow.ratios.minLeftRatio;
    const romRRatio = repWindow.ratios.maxRightRatio - repWindow.ratios.minRightRatio;
    const deltaMinRatio = Math.abs(repWindow.ratios.minLeftRatio - repWindow.ratios.minRightRatio);
    const deltaRomRatio = Math.abs(romLRatio - romRRatio);
    asymmetryP = penaltyAsymmetry(deltaMinRatio, deltaRomRatio);
  }

  // Elbow flare penalty (frontal only)
  let elbowFlareP = 0;
  if (hasFrontalQuality) {
    const leftFlareOk = isFinite(repWindow.elbowFlare.maxLeftFlareDeg);
    const rightFlareOk = isFinite(repWindow.elbowFlare.maxRightFlareDeg);
    const maxFlare = Math.max(
      leftFlareOk ? repWindow.elbowFlare.maxLeftFlareDeg : 0,
      rightFlareOk ? repWindow.elbowFlare.maxRightFlareDeg : 0,
    );
    elbowFlareP = penaltyElbowFlare(maxFlare);
  }

  const total = torsoP + shoulderP + romP + tempoP + asymmetryP + elbowFlareP;
  return Math.max(0, Math.min(100, Math.round(100 - total)));
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type ArmState = 'REST' | 'UP' | 'TOP' | 'DOWN';

interface ArmFSM {
  state: ArmState;
  /** Time when transitioned to REST (for MIN_REP_TIME check) */
  tRestEntry: number | null;
  /** Min/max reach ratio during current rep */
  minRatio: number;
  maxRatio: number;
  /** Timestamps for tempo calculation */
  tRestToUp: number | null;
  tUpToTop: number | null;
  tTopToDown: number | null;
  tDownToRest: number | null;
  /** Guard: arm must reach full extension (ratio >= EXTENDED_EXIT) while in REST before a new rep
   *  can start. Prevents cascade false reps after a premature noise-spike completion. */
  hasReachedExtension: boolean;
}

interface RepWindow {
  /** Rolling min/max for angular metrics during the rep (torso, shoulder, wrist — still angle-based) */
  minAngles: AngleSet;
  maxAngles: AngleSet;
  /** Rolling min/max reach ratios per arm — the primary metric for ROM/flex/extend evaluation */
  ratios: {
    minLeftRatio: number;
    maxLeftRatio: number;
    minRightRatio: number;
    maxRightRatio: number;
  };
  /** Start/end timestamps */
  tStart: number;
  tEnd: number;
  /** Frame count for duration calculations */
  frameCount: number;
  /** Wrist deviation history (for duration check) */
  wristDevFrames: { left: number; right: number };
  /** Max elbow flare angle (upper arm from vertical, coronal plane) per arm during the rep.
   *  Frontal view only — lateral deviation is most accurate when facing the camera. */
  elbowFlare: { maxLeftFlareDeg: number; maxRightFlareDeg: number };
  /** Per-rep signal coverage. Used to avoid giving form criticism from weak/stale landmarks. */
  quality: {
    leftRatioFrames: number;
    rightRatioFrames: number;
    leftShoulderFrames: number;
    rightShoulderFrames: number;
    torsoFrames: number;
    leftWristFrames: number;
    rightWristFrames: number;
    frontalFrames: number;
  };
}

interface AngleSet {
  leftElbow: number;
  rightElbow: number;
  leftShoulder: number;
  rightShoulder: number;
  leftTorso: number;
  rightTorso: number;
  torso: number; // midline (hip center -> shoulder center) for better swing detection
  leftWrist: number;
  rightWrist: number;
  /** Reach ratio: dist(shoulder,wrist) / (dist(shoulder,elbow) + dist(elbow,wrist)).
   *  ~1.0 = fully extended, ~0.4 = fully curled. Camera-angle invariant. */
  leftRatio: number;
  rightRatio: number;
}

interface SmoothedAngles extends AngleSet {}

/** Exercise-specific RepResult (richer than framework RepResult) */
interface RepResult {
  repIndex: number;
  /** ROM as ratio delta (maxRatio - minRatio) per arm */
  romLRatio: number;
  romRRatio: number;
  tUp: number;
  tDown: number;
  score: number;
  messages: string[];
}

type ViewZone = 'frontal' | 'oblique' | 'side';

interface ViewAngle {
  /** Estimated rotation from frontal, 0deg = facing camera, 90deg = side */
  angleDeg: number;
  /** Smoothed angle (EMA) for stable zone classification */
  smoothedAngleDeg: number;
  /** Which zone the user is in */
  zone: ViewZone;
  /** Which side faces the camera ('both' when frontal) */
  primarySide: 'left' | 'right' | 'both';
}

interface BarbellCurlState {
  leftArm: ArmFSM;
  rightArm: ArmFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  angleHistory: { [K in keyof AngleSet]: number[] }; // For median filter
  smoothed: SmoothedAngles | null; // EMA smoothed angles
  /** Median-only values (no EMA) — fed to FSM to avoid smoothing lag at extremes. */
  fast: SmoothedAngles | null;
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
    minRatio: Infinity,
    maxRatio: -Infinity,
    tRestToUp: null,
    tUpToTop: null,
    tTopToDown: null,
    tDownToRest: null,
    hasReachedExtension: false,
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
      leftRatio: Infinity,
      rightRatio: Infinity,
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
      leftRatio: -Infinity,
      rightRatio: -Infinity,
    },
    ratios: {
      minLeftRatio: Infinity,
      maxLeftRatio: -Infinity,
      minRightRatio: Infinity,
      maxRightRatio: -Infinity,
    },
    tStart,
    tEnd: tStart,
    frameCount: 0,
    wristDevFrames: { left: 0, right: 0 },
    elbowFlare: { maxLeftFlareDeg: -Infinity, maxRightFlareDeg: -Infinity },
    quality: {
      leftRatioFrames: 0,
      rightRatioFrames: 0,
      leftShoulderFrames: 0,
      rightShoulderFrames: 0,
      torsoFrames: 0,
      leftWristFrames: 0,
      rightWristFrames: 0,
      frontalFrames: 0,
    },
  };
}

function initializeBarbellCurlState(): BarbellCurlState {
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
      leftRatio: [],
      rightRatio: [],
    },
    smoothed: null,
    fast: null,
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
const FRONTAL_MAX = 20;      // 0-20deg = frontal
const OBLIQUE_MAX = 55;      // 20-55deg = oblique, 55+ = side

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

  // atan2(depth, width) -> 0deg when flat (frontal), 90deg when one shoulder behind the other
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
// ANGLE CALCULATION
// ============================================================================

type Point3D = { x: number; y: number; z?: number };

function getPoint(kp: Keypoint | null): Point3D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y, z: kp.z };
}

/** Euclidean distance using only x, y (ignores z). */
function dist2D(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute normalized arm reach ratio for one arm.
 * reach = dist2D(shoulder, wrist) / (dist2D(shoulder, elbow) + dist2D(elbow, wrist))
 *
 * ~0.95-1.0  = arm nearly straight (full extension)
 * ~0.70-0.85 = forearm foreshortened (pointing into depth axis)
 */
function computeArmReachRatio(keypoints: Keypoint[], side: 'left' | 'right'): number {
  // Reach ratio is calibrated on world (3D) landmarks. Image landmarks lack z and
  // produce foreshortened distances that make the ratio unreliable for front-on curls.
  if (keypoints.length === 0 || keypoints[0].z === undefined) return NaN;

  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const elbow = getKeypoint(keypoints, `${side}_elbow`);
  const wrist = getKeypoint(keypoints, `${side}_wrist`);

  if (
    !shoulder || !elbow || !wrist ||
    !isVisible(shoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(elbow, VISIBILITY_THRESHOLD) ||
    !isVisible(wrist, VISIBILITY_THRESHOLD)
  ) {
    return NaN;
  }

  const segmentLength = dist2D(shoulder, elbow) + dist2D(elbow, wrist);
  if (segmentLength < 1e-6) return NaN;

  return dist2D(shoulder, wrist) / segmentLength;
}

/**
 * Compute elbow flare angle for one arm: angle of the upper arm from vertical in the
 * frontal (coronal) plane. 0° = elbow directly below shoulder; increases as elbow flares out.
 */
function computeElbowFlareDeg(keypoints: Keypoint[], side: 'left' | 'right'): number {
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const elbow = getKeypoint(keypoints, `${side}_elbow`);

  if (
    !shoulder || !elbow ||
    !isVisible(shoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(elbow, VISIBILITY_THRESHOLD)
  ) return NaN;

  const dx = Math.abs(elbow.x - shoulder.x);
  const dy = Math.abs(elbow.y - shoulder.y);
  if (dx < 1e-6 && dy < 1e-6) return 0;

  return Math.atan2(dx, dy) * 57.29577951308232;
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

  // Elbow angles (2D — reliable for FSM rep counting at all views)
  const leftElbowAngle = leftOk
    ? calculateAngle2D(getPoint(leftShoulder)!, getPoint(leftElbow)!, getPoint(leftWrist)!)
    : NaN;
  const rightElbowAngle = rightOk
    ? calculateAngle2D(getPoint(rightShoulder)!, getPoint(rightElbow)!, getPoint(rightWrist)!)
    : NaN;

  // Shoulder angles (flexion only) - project upper arm onto sagittal plane
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
  const torsoAngle =
    hipCenter && shoulderCenter && leftShoulder && rightShoulder
      ? (() => {
          const angle = calculateSignedVerticalAngleSagittal(
            hipCenter,
            shoulderCenter,
            getPoint(leftHip)!,
            getPoint(rightHip)!,
            getPoint(leftShoulder)!,
            getPoint(rightShoulder)!
          );
          return Number.isNaN(angle) ? 0 : angle;
        })()
      : NaN;

  // Wrist angles (2D — elbow-wrist-index as proxy for wrist deviation)
  const leftWristAngle =
    leftOk && leftIndex && isVisible(leftIndex, VISIBILITY_THRESHOLD)
      ? calculateAngle2D(getPoint(leftElbow)!, getPoint(leftWrist)!, getPoint(leftIndex)!)
      : 180; // neutral if not visible
  const rightWristAngle =
    rightOk && rightIndex && isVisible(rightIndex, VISIBILITY_THRESHOLD)
      ? calculateAngle2D(getPoint(rightElbow)!, getPoint(rightWrist)!, getPoint(rightIndex)!)
      : 180;

  // Reach ratios — the primary camera-invariant metric for curl detection
  const leftRatio = leftOk
    ? computeArmReachRatio(keypoints, 'left')
    : NaN;
  const rightRatio = rightOk
    ? computeArmReachRatio(keypoints, 'right')
    : NaN;

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
    leftRatio,
    rightRatio,
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
): { smoothed: SmoothedAngles; fast: SmoothedAngles } {
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
    'leftRatio',
    'rightRatio',
  ];

  const smoothedResult: Partial<SmoothedAngles> = {};
  const fastResult: Partial<SmoothedAngles> = {};

  for (const key of keys) {
    const value = rawAngles[key];
    if (isNaN(value)) {
      const fallback = prevSmoothed?.[key] ?? NaN;
      smoothedResult[key] = fallback;
      fastResult[key] = fallback;
      continue;
    }

    history[key].push(value);
    if (history[key].length > MEDIAN_WINDOW) {
      history[key].shift();
    }

    const medianValue = median(history[key]);
    // fast = median only: used for FSM transitions to avoid EMA lag at extremes
    fastResult[key] = medianValue;

    const prev = prevSmoothed?.[key];
    smoothedResult[key] =
      prev !== undefined && !isNaN(prev)
        ? EMA_ALPHA * medianValue + (1 - EMA_ALPHA) * prev
        : medianValue;
  }

  return {
    smoothed: smoothedResult as SmoothedAngles,
    fast: fastResult as SmoothedAngles,
  };
}

// ============================================================================
// FSM LOGIC
// ============================================================================

/**
 * Update arm FSM using reach ratio (camera-angle invariant).
 * Ratio: 1.0 = fully extended, ~0.4 = fully curled.
 * Transitions are inverted vs angle: low ratio = curled (was low angle), high ratio = extended.
 */
function updateArmFSM(arm: ArmFSM, reachRatio: number, t: number): ArmFSM {
  const newArm = { ...arm };

  switch (arm.state) {
    case 'REST':
      // Track whether the arm has returned to full extension since the last rep.
      // Prevents cascade false reps: a noise spike causes premature completion,
      // FSMs reset, and the arm (still curled at ~0.5) would immediately re-enter UP.
      if (reachRatio >= THRESHOLDS.EXTENDED_EXIT) {
        newArm.hasReachedExtension = true;
      }
      if (newArm.hasReachedExtension && reachRatio < THRESHOLDS.EXTENDED_EXIT) {
        newArm.state = 'UP';
        newArm.tRestEntry = null;
        newArm.tRestToUp = t;
        newArm.minRatio = reachRatio;
        newArm.maxRatio = reachRatio;
        newArm.hasReachedExtension = false;
      }
      break;

    case 'UP':
      newArm.minRatio = Math.min(newArm.minRatio, reachRatio);
      newArm.maxRatio = Math.max(newArm.maxRatio, reachRatio);
      if (reachRatio < THRESHOLDS.FLEXED_ENTER) {
        newArm.state = 'TOP';
        newArm.tUpToTop = t;
      } else if (reachRatio >= THRESHOLDS.EXTENDED_EXIT) {
        // Arm returned to near-full extension without curling deep enough — reset cleanly.
        // Prevents the FSM from getting permanently stuck in UP if the EMA-smoothed ratio
        // never reaches FLEXED_ENTER (e.g. abandoned or partial curl).
        newArm.state = 'REST';
        newArm.hasReachedExtension = true;
        newArm.tRestToUp = null;
        newArm.tUpToTop = null;
      }
      break;

    case 'TOP':
      newArm.minRatio = Math.min(newArm.minRatio, reachRatio);
      newArm.maxRatio = Math.max(newArm.maxRatio, reachRatio);
      if (reachRatio > THRESHOLDS.FLEXED_EXIT) {
        newArm.state = 'DOWN';
        newArm.tTopToDown = t;
      }
      break;

    case 'DOWN':
      newArm.minRatio = Math.min(newArm.minRatio, reachRatio);
      newArm.maxRatio = Math.max(newArm.maxRatio, reachRatio);
      if (
        reachRatio > THRESHOLDS.EXTENDED_ENTER &&
        newArm.tRestToUp !== null &&
        t - newArm.tRestToUp >= THRESHOLDS.MIN_REP_TIME &&
        // Require minimum dwell in DOWN before completing — filters noise spikes
        (newArm.tTopToDown === null || t - newArm.tTopToDown >= THRESHOLDS.MIN_DOWN_GUARD)
      ) {
        // Normal completion: full extension reached
        newArm.state = 'REST';
        newArm.tRestEntry = t;
        newArm.tDownToRest = t;
      } else if (
        reachRatio < THRESHOLDS.FLEXED_EXIT &&
        newArm.tRestToUp !== null &&
        t - newArm.tRestToUp >= THRESHOLDS.MIN_REP_TIME &&
        newArm.tTopToDown !== null && t - newArm.tTopToDown >= FORM_THRESHOLDS.TEMPO_DOWN_ESCAPE_MIN
      ) {
        // Re-flexion escape: arm is curling again without full extension.
        // Force completion — rep will be counted and penalized for incomplete ROM.
        newArm.state = 'REST';
        newArm.tRestEntry = t;
        newArm.tDownToRest = t;
      }
      break;
  }

  return newArm;
}

// ============================================================================
// FORM EVALUATION
// ============================================================================

function evaluateForm(
  repWindow: RepWindow,
  leftArm: ArmFSM,
  rightArm: ArmFSM,
  viewAngle: ViewAngle,
  repIndex: number = 0
): { score: number; messages: string[] } {
  const { minAngles, maxAngles, ratios } = repWindow;
  const messages: string[] = [];
  const isFrontal = viewAngle.zone === 'frontal';
  const isSide = viewAngle.zone === 'side';
  const primaryIsLeft = viewAngle.primarySide !== 'right';
  const frameCount = Math.max(1, repWindow.frameCount);
  const coverage = (frames: number) => frames / frameCount;
  const leftRatioCoverage = coverage(repWindow.quality.leftRatioFrames);
  const rightRatioCoverage = coverage(repWindow.quality.rightRatioFrames);
  const primaryRatioCoverage = primaryIsLeft ? leftRatioCoverage : rightRatioCoverage;
  const leftShoulderCoverage = coverage(repWindow.quality.leftShoulderFrames);
  const rightShoulderCoverage = coverage(repWindow.quality.rightShoulderFrames);
  const torsoCoverage = coverage(repWindow.quality.torsoFrames);
  const frontalCoverage = coverage(repWindow.quality.frontalFrames);
  const leftWristCoverage = coverage(repWindow.quality.leftWristFrames);
  const rightWristCoverage = coverage(repWindow.quality.rightWristFrames);
  const hasPrimaryRatioQuality = primaryRatioCoverage >= QUALITY_THRESHOLDS.MIN_PRIMARY_RATIO_COVERAGE;
  const hasBilateralRatioQuality =
    leftRatioCoverage >= QUALITY_THRESHOLDS.MIN_BILATERAL_RATIO_COVERAGE &&
    rightRatioCoverage >= QUALITY_THRESHOLDS.MIN_BILATERAL_RATIO_COVERAGE;
  const hasRatioQuality = isFrontal ? hasBilateralRatioQuality : hasPrimaryRatioQuality;
  const hasFrontalQuality = isFrontal && frontalCoverage >= QUALITY_THRESHOLDS.MIN_FRONTAL_COVERAGE;
  const hasTorsoQuality = torsoCoverage >= QUALITY_THRESHOLDS.MIN_TORSO_COVERAGE;

  const leftRatioOk = isFinite(ratios.minLeftRatio) && isFinite(ratios.maxLeftRatio);
  const rightRatioOk = isFinite(ratios.minRightRatio) && isFinite(ratios.maxRightRatio);

  // Determine min/max ratios based on view
  let minRatio: number;
  let maxRatio: number;
  if (isFrontal) {
    minRatio = Math.min(
      leftRatioOk ? ratios.minLeftRatio : Infinity,
      rightRatioOk ? ratios.minRightRatio : Infinity
    );
    maxRatio = Math.max(
      leftRatioOk ? ratios.maxLeftRatio : -Infinity,
      rightRatioOk ? ratios.maxRightRatio : -Infinity
    );
  } else {
    minRatio = primaryIsLeft
      ? (leftRatioOk ? ratios.minLeftRatio : Infinity)
      : (rightRatioOk ? ratios.minRightRatio : Infinity);
    maxRatio = primaryIsLeft
      ? (leftRatioOk ? ratios.maxLeftRatio : -Infinity)
      : (rightRatioOk ? ratios.maxRightRatio : -Infinity);
  }

  // 1. Flex depth — ratio-based (no foreshortening compensation needed)
  if (hasRatioQuality && isFinite(minRatio) && minRatio > FORM_THRESHOLDS.FLEX_RATIO_WARN) {
    messages.push('Flex more at the top of the curl.');
  }

  // 2. Extension — ratio-based
  if (hasRatioQuality && isFinite(maxRatio) && maxRatio < FORM_THRESHOLDS.EXTEND_RATIO_WARN) {
    messages.push('Extend fully at the bottom.');
  }

  // 3. ROM — ratio-based
  const romLRatio = leftRatioOk ? ratios.maxLeftRatio - ratios.minLeftRatio : 0;
  const romRRatio = rightRatioOk ? ratios.maxRightRatio - ratios.minRightRatio : 0;
  const primaryRomRatio = primaryIsLeft ? romLRatio : romRRatio;

  if (hasRatioQuality && isFrontal) {
    if ((romLRatio < THRESHOLDS.ROM_MIN || romRRatio < THRESHOLDS.ROM_MIN) && messages.length === 0) {
      messages.push('Incomplete rep — curl all the way up and fully extend.');
    }
  } else if (hasRatioQuality) {
    if (primaryRomRatio < THRESHOLDS.ROM_MIN && messages.length === 0) {
      messages.push('Incomplete rep — curl all the way up and fully extend.');
    }
  }

  // 4. Shoulder takeover (delta-based, already camera-invariant; skip at side angles)
  const deltaShL = maxAngles.leftShoulder - minAngles.leftShoulder;
  const deltaShR = maxAngles.rightShoulder - minAngles.rightShoulder;
  if (!isSide) {
    const shValues: number[] = [];
    if (isFinite(deltaShL) && leftShoulderCoverage >= QUALITY_THRESHOLDS.MIN_METRIC_COVERAGE) shValues.push(deltaShL);
    if (isFinite(deltaShR) && rightShoulderCoverage >= QUALITY_THRESHOLDS.MIN_METRIC_COVERAGE) shValues.push(deltaShR);
    const maxDeltaSh = shValues.length > 0 ? Math.max(...shValues) : 0;

    if (maxDeltaSh > FORM_THRESHOLDS.SHOULDER_FAIL) {
      messages.push('Too much shoulder involvement — reduce the weight.');
    } else if (maxDeltaSh > FORM_THRESHOLDS.SHOULDER_WARN) {
      messages.push('Upper arms moving — keep elbows pinned to your sides.');
    }
  }

  // 4b. Elbow flare (frontal only)
  if (hasFrontalQuality) {
    const leftFlareOk = isFinite(repWindow.elbowFlare.maxLeftFlareDeg);
    const rightFlareOk = isFinite(repWindow.elbowFlare.maxRightFlareDeg);
    const maxFlare = Math.max(
      leftFlareOk ? repWindow.elbowFlare.maxLeftFlareDeg : 0,
      rightFlareOk ? repWindow.elbowFlare.maxRightFlareDeg : 0,
    );
    if (maxFlare > FORM_THRESHOLDS.ELBOW_FLARE_FAIL) {
      messages.push("Keep your elbows in — don't flare them out to the sides.");
    } else if (maxFlare > FORM_THRESHOLDS.ELBOW_FLARE_WARN) {
      messages.push('Tuck your elbows in — they\'re drifting outward.');
    }
  }

  // 5. Torso swing (delta-based, already camera-invariant)
  const deltaTorso = maxAngles.torso - minAngles.torso;
  const torsoWarnThreshold = repIndex === 0
    ? FORM_THRESHOLDS.TORSO_FAIL
    : FORM_THRESHOLDS.TORSO_WARN;
  if (hasTorsoQuality && isFinite(deltaTorso)) {
    if (deltaTorso > FORM_THRESHOLDS.TORSO_FAIL) {
      messages.push('Excessive body swing — this is cheating the rep.');
    } else if (deltaTorso > torsoWarnThreshold) {
      messages.push("Don't swing your torso — stay upright and controlled.");
    }
  }

  // 6. Tempo — average across both arms in frontal mode
  const tUpL = leftArm.tUpToTop && leftArm.tRestToUp ? leftArm.tUpToTop - leftArm.tRestToUp : 0;
  const tUpR = rightArm.tUpToTop && rightArm.tRestToUp ? rightArm.tUpToTop - rightArm.tRestToUp : 0;
  const tDownL = leftArm.tDownToRest && leftArm.tTopToDown ? leftArm.tDownToRest - leftArm.tTopToDown : 0;
  const tDownR = rightArm.tDownToRest && rightArm.tTopToDown ? rightArm.tDownToRest - rightArm.tTopToDown : 0;

  let tUp: number;
  let tDown: number;
  if (isFrontal) {
    tUp   = tUpL > 0 && tUpR > 0   ? (tUpL + tUpR) / 2   : Math.max(tUpL, tUpR);
    tDown = tDownL > 0 && tDownR > 0 ? (tDownL + tDownR) / 2 : Math.max(tDownL, tDownR);
  } else {
    const tempoArm = primaryIsLeft ? leftArm : rightArm;
    tUp   = tempoArm.tUpToTop   && tempoArm.tRestToUp  ? tempoArm.tUpToTop   - tempoArm.tRestToUp  : 0;
    tDown = tempoArm.tDownToRest && tempoArm.tTopToDown ? tempoArm.tDownToRest - tempoArm.tTopToDown : 0;
  }

  if (tUp < FORM_THRESHOLDS.TEMPO_UP_FEEDBACK_MIN && tUp > 0) {
    messages.push('Slow down — control the curl.');
  }
  if (tDown >= 0.05 && tDown < FORM_THRESHOLDS.TEMPO_DOWN_FEEDBACK_MIN) {
    messages.push("Control the lowering — don't drop the weight.");
  }

  // 7. Wrist position — only if the wrist signal was readable for most of the rep
  const leftWristReadable = leftWristCoverage >= QUALITY_THRESHOLDS.MIN_METRIC_COVERAGE;
  const rightWristReadable = rightWristCoverage >= QUALITY_THRESHOLDS.MIN_METRIC_COVERAGE;
  const leftWristDeviated =
    leftWristReadable &&
    repWindow.wristDevFrames.left / Math.max(1, repWindow.quality.leftWristFrames) >= FORM_THRESHOLDS.WRIST_DEV_DURATION;
  const rightWristDeviated =
    rightWristReadable &&
    repWindow.wristDevFrames.right / Math.max(1, repWindow.quality.rightWristFrames) >= FORM_THRESHOLDS.WRIST_DEV_DURATION;
  if (leftWristDeviated || rightWristDeviated) {
    messages.push('Keep your wrists neutral through the curl.');
  }

  // 8. Symmetry — ratio-based (only frontal)
  if (hasFrontalQuality && hasBilateralRatioQuality && leftRatioOk && rightRatioOk) {
    const deltaMinRatio = Math.abs(ratios.minLeftRatio - ratios.minRightRatio);
    const deltaRomRatio = Math.abs(romLRatio - romRRatio);
    if (deltaMinRatio > FORM_THRESHOLDS.SYMMETRY_MIN_RATIO || deltaRomRatio > FORM_THRESHOLDS.SYMMETRY_ROM_RATIO) {
      messages.push('Arms are uneven — curl both sides together.');
    }
  }

  // Score: continuous penalty curves
  let score = computeRepScore(repWindow, leftArm, rightArm, viewAngle);
  if (!hasRatioQuality) {
    messages.unshift("Couldn't read that rep clearly.");
    score = Math.min(score, QUALITY_THRESHOLDS.UNCERTAIN_SCORE_CAP);
  }

  return { score, messages };
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateBarbellCurlState(
  keypoints: Keypoint[],
  currentState: BarbellCurlState
): BarbellCurlState {
  const t = Date.now() / 1000; // seconds

  // Estimate view angle
  const viewAngle = estimateViewAngle(keypoints, currentState.viewAngle.smoothedAngleDeg);

  // Calculate raw angles
  const rawAngles = calculateJointAngles(keypoints);
  if (!rawAngles) {
    return { ...currentState, displayAngles: null, viewAngle };
  }

  // Apply smoothing — returns fast (median-only) and smoothed (median+EMA)
  const { smoothed, fast } = applySmoothing(rawAngles, currentState.angleHistory, currentState.smoothed);

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
    fast,
    displayAngles: smoothed,
    viewAngle,
    warmupFrames,
  };

  // Skip FSM until skeleton is stable
  if (warmupFrames < WARMUP_REQUIRED) {
    return newState;
  }

  // Use fast (median-only) ratios for FSM: avoids EMA lag that prevents reaching extremes
  const leftValid = !isNaN(fast.leftRatio);
  const rightValid = !isNaN(fast.rightRatio);

  // If neither arm is valid, bail
  if (!leftValid && !rightValid) {
    return newState;
  }

  const isSingleArm = !leftValid || !rightValid;

  // Update per-arm FSMs using fast (median-only) reach ratios
  const prevLeftState = currentState.leftArm.state;
  const prevRightState = currentState.rightArm.state;
  if (leftValid) {
    newState.leftArm = updateArmFSM(currentState.leftArm, fast.leftRatio, t);
  }
  if (rightValid) {
    newState.rightArm = updateArmFSM(currentState.rightArm, fast.rightRatio, t);
  }

  // Track rep window (accumulate data while any active arm is not in REST)
  const leftInRep = leftValid && newState.leftArm.state !== 'REST';
  const rightInRep = rightValid && newState.rightArm.state !== 'REST';
  const inRep = leftInRep || rightInRep;
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(t);
  }

  // Include the transition frame (DOWN→REST): the angle that triggered completion
  // must be recorded so evaluateForm sees the actual peak extension, not the prior frame.
  const leftWasInRep = leftValid && currentState.leftArm.state !== 'REST';
  const rightWasInRep = rightValid && currentState.rightArm.state !== 'REST';
  const shouldAccumulate = inRep || leftWasInRep || rightWasInRep;

  if (newState.repWindow && shouldAccumulate) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update min/max for all angles + ratios (NaN-safe)
    const keys: (keyof AngleSet)[] = [
      'leftElbow', 'rightElbow',
      'leftShoulder', 'rightShoulder',
      'leftTorso', 'rightTorso',
      'torso',
      'leftWrist', 'rightWrist',
      'leftRatio', 'rightRatio',
    ];
    for (const key of keys) {
      const val = smoothed[key];
      if (!isNaN(val)) {
        window.minAngles[key] = Math.min(window.minAngles[key], val);
        window.maxAngles[key] = Math.max(window.maxAngles[key], val);
      }
    }

    // Track reach ratios using fast (median-only) values to capture true depth/lockout
    if (!isNaN(fast.leftRatio)) {
      window.ratios.minLeftRatio = Math.min(window.ratios.minLeftRatio, fast.leftRatio);
      window.ratios.maxLeftRatio = Math.max(window.ratios.maxLeftRatio, fast.leftRatio);
      window.quality.leftRatioFrames++;
    }
    if (!isNaN(fast.rightRatio)) {
      window.ratios.minRightRatio = Math.min(window.ratios.minRightRatio, fast.rightRatio);
      window.ratios.maxRightRatio = Math.max(window.ratios.maxRightRatio, fast.rightRatio);
      window.quality.rightRatioFrames++;
    }
    if (!isNaN(rawAngles.leftShoulder)) {
      window.quality.leftShoulderFrames++;
    }
    if (!isNaN(rawAngles.rightShoulder)) {
      window.quality.rightShoulderFrames++;
    }
    if (!isNaN(rawAngles.torso)) {
      window.quality.torsoFrames++;
    }
    if (!isNaN(rawAngles.leftWrist)) {
      window.quality.leftWristFrames++;
    }
    if (!isNaN(rawAngles.rightWrist)) {
      window.quality.rightWristFrames++;
    }
    if (viewAngle.zone === 'frontal') {
      window.quality.frontalFrames++;
    }

    // Track wrist deviation duration
    if (leftValid && Math.abs(smoothed.leftWrist - FORM_THRESHOLDS.WRIST_NEUTRAL) > FORM_THRESHOLDS.WRIST_DEV_WARN) {
      window.wristDevFrames.left++;
    }
    if (rightValid && Math.abs(smoothed.rightWrist - FORM_THRESHOLDS.WRIST_NEUTRAL) > FORM_THRESHOLDS.WRIST_DEV_WARN) {
      window.wristDevFrames.right++;
    }

    // Track elbow flare (frontal only — lateral deviation is visible facing the camera)
    if (viewAngle.zone === 'frontal') {
      const leftFlare = computeElbowFlareDeg(keypoints, 'left');
      const rightFlare = computeElbowFlareDeg(keypoints, 'right');
      if (!isNaN(leftFlare)) {
        window.elbowFlare.maxLeftFlareDeg = Math.max(window.elbowFlare.maxLeftFlareDeg, leftFlare);
      }
      if (!isNaN(rightFlare)) {
        window.elbowFlare.maxRightFlareDeg = Math.max(window.elbowFlare.maxRightFlareDeg, rightFlare);
      }
    }
  }

  // Rep completion logic
  if (viewAngle.zone === 'frontal' && !isSingleArm) {
    // FRONTAL MODE: two-arm sync logic
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
  if (leftValid && !rightValid) return 'left';
  if (rightValid && !leftValid) return 'right';
  if (viewAngle.primarySide === 'left') return 'left';
  if (viewAngle.primarySide === 'right') return 'right';
  return 'left';
}

/** Complete a rep: evaluate form, update state, reset FSMs. */
function completeRep(
  newState: BarbellCurlState,
  t: number,
  viewAngle: ViewAngle
): void {
  newState.repCount++;

  const romLRatio = newState.leftArm.maxRatio - newState.leftArm.minRatio;
  const romRRatio = newState.rightArm.maxRatio - newState.rightArm.minRatio;

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
    viewAngle,
    newState.repCount
  );

  newState.lastRepResult = {
    repIndex: newState.repCount,
    romLRatio,
    romRRatio,
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
// DEBUG HELPERS (module-private — exposed via debugInfo in ExerciseState)
// ============================================================================

const _formatAngle = (v: number) =>
  typeof v === 'number' && !isNaN(v) && isFinite(v) ? v : null;
const _safeDelta = (min: number, max: number) =>
  _formatAngle(min !== Infinity && max !== -Infinity ? max - min : NaN);

function getBarbellCurlDebugInfo(state: BarbellCurlState): {
  leftArmState: string;
  rightArmState: string;
  current: {
    leftElbow: number | null;
    rightElbow: number | null;
    leftRatio: number | null;
    rightRatio: number | null;
    leftShoulder: number | null;
    rightShoulder: number | null;
    torso: number | null;
  };
  repRatios: {
    minLeft: number | null;
    maxLeft: number | null;
    minRight: number | null;
    maxRight: number | null;
    romLeft: number | null;
    romRight: number | null;
  } | null;
  repDelta: {
    leftShoulder: number | null;
    rightShoulder: number | null;
    torso: number | null;
  } | null;
} {
  const angles = state.displayAngles;
  const window = state.repWindow;
  const current = {
    leftElbow: _formatAngle(angles?.leftElbow ?? NaN),
    rightElbow: _formatAngle(angles?.rightElbow ?? NaN),
    leftRatio: _formatAngle(angles?.leftRatio ?? NaN),
    rightRatio: _formatAngle(angles?.rightRatio ?? NaN),
    leftShoulder: _formatAngle(angles?.leftShoulder ?? NaN),
    rightShoulder: _formatAngle(angles?.rightShoulder ?? NaN),
    torso: _formatAngle(angles?.torso ?? NaN),
  };
  const repRatios = window
    ? {
        minLeft: _formatAngle(window.ratios.minLeftRatio),
        maxLeft: _formatAngle(window.ratios.maxLeftRatio),
        minRight: _formatAngle(window.ratios.minRightRatio),
        maxRight: _formatAngle(window.ratios.maxRightRatio),
        romLeft: isFinite(window.ratios.maxLeftRatio) && isFinite(window.ratios.minLeftRatio)
          ? _formatAngle(window.ratios.maxLeftRatio - window.ratios.minLeftRatio) : null,
        romRight: isFinite(window.ratios.maxRightRatio) && isFinite(window.ratios.minRightRatio)
          ? _formatAngle(window.ratios.maxRightRatio - window.ratios.minRightRatio) : null,
      }
    : null;
  const repDelta = window
    ? {
        leftShoulder: _safeDelta(window.minAngles.leftShoulder, window.maxAngles.leftShoulder),
        rightShoulder: _safeDelta(window.minAngles.rightShoulder, window.maxAngles.rightShoulder),
        torso: _safeDelta(window.minAngles.torso, window.maxAngles.torso),
      }
    : null;
  return {
    leftArmState: state.leftArm.state,
    rightArmState: state.rightArm.state,
    current,
    repRatios,
    repDelta,
  };
}

// ============================================================================
// EXERCISE DEFINITION — the only export
// ============================================================================

export const barbellCurlDefinition: ExerciseDefinition = {
  name: 'Barbell Curl',
  requiredView: 'front',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: initializeBarbellCurlState(),
  }),

  update: (keypoints, state) => {
    const internal = state._internal as BarbellCurlState;
    const newInternal = updateBarbellCurlState(keypoints, internal);

    // Map internal RepResult to framework RepResult
    const lastRepResult: FrameworkRepResult | null = newInternal.lastRepResult
      ? {
          repIndex: newInternal.lastRepResult.repIndex,
          score: newInternal.lastRepResult.score,
          messages: newInternal.lastRepResult.messages,
        }
      : null;

    return {
      repCount: newInternal.repCount,
      lastRepResult,
      feedback: newInternal.feedback,
      feedbackTimestamp: newInternal.lastFeedbackTime > 0 ? newInternal.lastFeedbackTime : null,
      debugInfo: getBarbellCurlDebugInfo(newInternal) as Record<string, unknown>,
      _internal: newInternal,
    };
  },

  ttsConfig: {
    feedbackToIssue: {
      'Flex more at the top of the curl.': 'incomplete_flex',
      'Extend fully at the bottom.': 'incomplete_extend',
      'Incomplete rep — curl all the way up and fully extend.': 'incomplete_rom',
      'Too much shoulder involvement — reduce the weight.': 'shoulder_fail',
      'Upper arms moving — keep elbows pinned to your sides.': 'shoulder_warn',
      'Excessive body swing — this is cheating the rep.': 'torso_fail',
      "Don't swing your torso — stay upright and controlled.": 'torso_warn',
      'Slow down — control the curl.': 'tempo_up',
      "Control the lowering — don't drop the weight.": 'tempo_down',
      'Arms are uneven — curl both sides together.': 'asymmetry',
      "Keep your elbows in — don't flare them out to the sides.": 'elbow_flare',
      "Tuck your elbows in — they're drifting outward.": 'elbow_flare',
      'Keep your wrists neutral through the curl.': 'wrist_neutral',
      "Couldn't read that rep clearly.": 'tracking_uncertain',
    },
    issueDefinitions: [
      {
        issueType: 'elbow_flare',
        priority: 15,
        messages: [
          'Keep your elbows tucked.',
          'Bring your elbows closer to your sides.',
          'Do not let your elbows flare out.',
        ],
      },
      {
        issueType: 'wrist_neutral',
        priority: 8,
        messages: [
          'Keep your wrists neutral.',
          'Straight wrists on the curl.',
          'Lock your wrists in line.',
        ],
      },
      {
        issueType: 'tracking_uncertain',
        priority: 5,
        messages: [
          'I lost the read on that rep.',
          'Make sure your arms stay visible.',
          'Stay in frame so I can track the rep.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Flex more at the top of the curl.': 'Full ROM at top — contract the bicep fully before lowering.',
    'Extend fully at the bottom.': 'Extend arms completely at the bottom for a full stretch.',
    'Incomplete rep — curl all the way up and fully extend.': 'Achieve complete range of motion in both directions.',
    'Too much shoulder involvement — reduce the weight.': 'Reduce weight and focus on isolating the bicep.',
    'Upper arms moving — keep elbows pinned to your sides.': 'Minimize elbow drift — keep elbows close to your body.',
    'Excessive body swing — this is cheating the rep.': 'Reduce torso momentum — use strict, controlled form.',
    "Don't swing your torso — stay upright and controlled.": 'Brace your core and keep torso stationary throughout.',
    'Slow down — control the curl.': 'Slow the concentric phase — aim for 1-2 seconds up.',
    "Control the lowering — don't drop the weight.": 'Slow the eccentric phase — 2-3 seconds down.',
    'Arms are uneven — curl both sides together.': 'Focus on symmetry — curl both arms at the same speed.',
    "Keep your elbows in — don't flare them out to the sides.": 'Keep elbows pinned to your sides — flaring reduces bicep isolation.',
    "Tuck your elbows in — they're drifting outward.": 'Focus on keeping elbows close to your body throughout the curl.',
    'Keep your wrists neutral through the curl.': 'Keep wrists stacked and neutral rather than curling or bending them.',
    "Couldn't read that rep clearly.": 'Keep your full upper body and both arms clearly visible to improve tracking accuracy.',
  },
};
