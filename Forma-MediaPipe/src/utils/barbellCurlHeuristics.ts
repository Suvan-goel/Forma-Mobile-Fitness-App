/**
 * Barbell Curl Heuristics - Forma Specification
 *
 * Implements deterministic barbell curl detection and form coaching using ONLY
 * 8 precomputed joint angles. Uses per-arm FSM with two-arm synchronization.
 */

import {
  Keypoint,
  calculateAngle,
  calculateAngle2D,
  calculateVerticalAngle,
  calculateShoulderFlexionAngle,
  getKeypoint,
  isVisible,
} from './poseAnalysis';

// ============================================================================
// CONSTANTS & THRESHOLDS
// ============================================================================

/** FSM thresholds (degrees) */
export const THRESHOLDS = {
  EXTENDED_ENTER: 155,
  EXTENDED_EXIT: 145,
  FLEXED_ENTER: 65,
  FLEXED_EXIT: 75,
  MIN_REP_TIME: 0.60, // seconds
  SYNC_WINDOW: 0.25, // seconds between arms
  ROM_MIN: 80, // degrees
} as const;

/** Form heuristic thresholds (degrees) - relaxed for fewer false positives */
export const FORM_THRESHOLDS = {
  SHOULDER_WARN: 30,
  SHOULDER_FAIL: 45,
  TORSO_WARN: 15,
  TORSO_FAIL: 25,
  WRIST_NEUTRAL: 180, // straight wrist reference
  WRIST_DEV_WARN: 25,
  WRIST_DEV_DURATION: 0.5, // 50% of rep (trigger only if bent for half the rep)
  TEMPO_UP_MIN: 0.30,
  TEMPO_DOWN_MIN: 0.35,
  SYMMETRY_MIN: 20,
  SYMMETRY_ROM: 25,
} as const;

/** Smoothing parameters */
const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.3;
const VISIBILITY_THRESHOLD = 0.1;

/** Scoring penalties */
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

export interface BarbellCurlState {
  leftArm: ArmFSM;
  rightArm: ArmFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  angleHistory: { [key: keyof AngleSet]: number[] }; // For median filter
  smoothed: SmoothedAngles | null; // EMA smoothed angles
  displayAngles: AngleSet | null; // Smoothed angles for UI
  feedback: string | null;
  lastFeedbackTime: number;
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
      leftWrist: [],
      rightWrist: [],
    },
    smoothed: null,
    displayAngles: null,
    feedback: null,
    lastFeedbackTime: 0,
  };
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

  // Elbow angles (2D for accuracy)
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

  // Torso angles (hip-shoulder vertical)
  const leftTorsoAngle = leftOk
    ? calculateVerticalAngle(getPoint(leftHip)!, getPoint(leftShoulder)!)
    : NaN;
  const rightTorsoAngle = rightOk
    ? calculateVerticalAngle(getPoint(rightHip)!, getPoint(rightShoulder)!)
    : NaN;

  // Wrist angles (elbow-wrist-index as proxy for wrist angle)
  const leftWristAngle =
    leftOk && leftIndex && isVisible(leftIndex, VISIBILITY_THRESHOLD)
      ? calculateAngle(getPoint(leftElbow)!, getPoint(leftWrist)!, getPoint(leftIndex)!)
      : 180; // neutral if not visible
  const rightWristAngle =
    rightOk && rightIndex && isVisible(rightIndex, VISIBILITY_THRESHOLD)
      ? calculateAngle(getPoint(rightElbow)!, getPoint(rightWrist)!, getPoint(rightIndex)!)
      : 180;

  return {
    leftElbow: leftElbowAngle,
    rightElbow: rightElbowAngle,
    leftShoulder: leftShoulderAngle,
    rightShoulder: rightShoulderAngle,
    leftTorso: leftTorsoAngle,
    rightTorso: rightTorsoAngle,
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
  rightArm: ArmFSM
): { score: number; messages: string[] } {
  const { minAngles, maxAngles, frameCount, wristDevFrames } = repWindow;
  let score = 100;
  const messages: string[] = [];

  // 1. ROM
  const romL = maxAngles.leftElbow - minAngles.leftElbow;
  const romR = maxAngles.rightElbow - minAngles.rightElbow;
  if (romL < THRESHOLDS.ROM_MIN || romR < THRESHOLDS.ROM_MIN) {
    score -= PENALTIES.INCOMPLETE_ROM;
    messages.push('Incomplete rep — curl all the way up and fully extend.');
  }

  // 2. Shoulder takeover (using shoulder angle change)
  const deltaShL = maxAngles.leftShoulder - minAngles.leftShoulder;
  const deltaShR = maxAngles.rightShoulder - minAngles.rightShoulder;
  const maxDeltaSh = Math.max(deltaShL, deltaShR);
  if (maxDeltaSh > FORM_THRESHOLDS.SHOULDER_FAIL) {
    score -= PENALTIES.SHOULDER_FAIL;
    messages.push('Too much shoulder involvement — reduce the weight.');
  } else if (maxDeltaSh > FORM_THRESHOLDS.SHOULDER_WARN) {
    score -= PENALTIES.SHOULDER_WARN;
    messages.push('Upper arms moving — keep elbows pinned to your sides.');
  }

  // 3. Torso swing
  const deltaTL = maxAngles.leftTorso - minAngles.leftTorso;
  const deltaTR = maxAngles.rightTorso - minAngles.rightTorso;
  const maxDeltaT = Math.max(deltaTL, deltaTR);
  if (maxDeltaT > FORM_THRESHOLDS.TORSO_FAIL) {
    score -= PENALTIES.TORSO_FAIL;
    messages.push('Excessive body swing — this is cheating the rep.');
  } else if (maxDeltaT > FORM_THRESHOLDS.TORSO_WARN) {
    score -= PENALTIES.TORSO_WARN;
    messages.push("Don't swing your torso — stay upright and controlled.");
  }

  // 4. Wrist neutrality (disabled - no feedback)

  // 5. Tempo
  const tUp = leftArm.tUpToTop && leftArm.tRestToUp ? leftArm.tUpToTop - leftArm.tRestToUp : 0;
  const tDown =
    leftArm.tDownToRest && leftArm.tTopToDown ? leftArm.tDownToRest - leftArm.tTopToDown : 0;

  if (tUp < FORM_THRESHOLDS.TEMPO_UP_MIN && tUp > 0) {
    score -= PENALTIES.TEMPO_ISSUE;
    messages.push('Slow down — control the curl.');
  }
  if (tDown < FORM_THRESHOLDS.TEMPO_DOWN_MIN && tDown > 0) {
    score -= PENALTIES.TEMPO_ISSUE;
    messages.push("Control the lowering — don't drop the weight.");
  }

  // 6. Symmetry
  const deltaMin = Math.abs(minAngles.leftElbow - minAngles.rightElbow);
  const deltaRom = Math.abs(romL - romR);
  if (deltaMin > FORM_THRESHOLDS.SYMMETRY_MIN || deltaRom > FORM_THRESHOLDS.SYMMETRY_ROM) {
    score -= PENALTIES.ASYMMETRY;
    messages.push('Arms are uneven — curl both sides together.');
  }

  return { score: Math.max(0, Math.min(100, score)), messages };
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

export function updateBarbellCurlState(
  keypoints: Keypoint[],
  currentState: BarbellCurlState
): BarbellCurlState {
  const t = Date.now() / 1000; // seconds

  // Calculate raw angles
  const rawAngles = calculateJointAngles(keypoints);
  if (!rawAngles) {
    return { ...currentState, displayAngles: null };
  }

  // Apply smoothing
  const smoothed = applySmoothing(rawAngles, currentState.angleHistory, currentState.smoothed);

  // Update display angles (use smoothed for stable UI)
  const newState: BarbellCurlState = {
    ...currentState,
    smoothed,
    displayAngles: smoothed,
  };

  // Skip FSM if angles are NaN
  if (isNaN(smoothed.leftElbow) || isNaN(smoothed.rightElbow)) {
    return newState;
  }

  // Update per-arm FSMs
  const prevLeftState = currentState.leftArm.state;
  const prevRightState = currentState.rightArm.state;
  newState.leftArm = updateArmFSM(currentState.leftArm, smoothed.leftElbow, t);
  newState.rightArm = updateArmFSM(currentState.rightArm, smoothed.rightElbow, t);

  // Track rep window (accumulate data while either arm is not in REST)
  const inRep = newState.leftArm.state !== 'REST' || newState.rightArm.state !== 'REST';
  if (inRep && !currentState.repWindow) {
    // Start new rep window
    newState.repWindow = initRepWindow(t);
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update min/max for all 8 angles
    const keys: (keyof AngleSet)[] = [
      'leftElbow',
      'rightElbow',
      'leftShoulder',
      'rightShoulder',
      'leftTorso',
      'rightTorso',
      'leftWrist',
      'rightWrist',
    ];
    for (const key of keys) {
      const val = smoothed[key];
      if (!isNaN(val)) {
        window.minAngles[key] = Math.min(window.minAngles[key], val);
        window.maxAngles[key] = Math.max(window.maxAngles[key], val);
      }
    }

    // Track wrist deviation duration
    if (Math.abs(smoothed.leftWrist - FORM_THRESHOLDS.WRIST_NEUTRAL) > FORM_THRESHOLDS.WRIST_DEV_WARN) {
      window.wristDevFrames.left++;
    }
    if (Math.abs(smoothed.rightWrist - FORM_THRESHOLDS.WRIST_NEUTRAL) > FORM_THRESHOLDS.WRIST_DEV_WARN) {
      window.wristDevFrames.right++;
    }
  }

  // Check for rep completion: both arms in REST, transition just happened, valid reps, within sync window
  const bothInRest = newState.leftArm.state === 'REST' && newState.rightArm.state === 'REST';
  const leftJustFinished = prevLeftState === 'DOWN' && newState.leftArm.state === 'REST';
  const rightJustFinished = prevRightState === 'DOWN' && newState.rightArm.state === 'REST';

  if (bothInRest && (leftJustFinished || rightJustFinished) && newState.repWindow) {
    // Check if both arms completed valid reps
    const leftValid = isValidRep(newState.leftArm);
    const rightValid = isValidRep(newState.rightArm);

    if (leftValid && rightValid) {
      // Check sync window
      const leftEndTime = newState.leftArm.tDownToRest ?? t;
      const rightEndTime = newState.rightArm.tDownToRest ?? t;
      const syncDelta = Math.abs(leftEndTime - rightEndTime);

      if (syncDelta <= THRESHOLDS.SYNC_WINDOW) {
        // Valid synchronized rep
        newState.repCount++;

        const romL = newState.leftArm.maxElbow - newState.leftArm.minElbow;
        const romR = newState.rightArm.maxElbow - newState.rightArm.minElbow;
        const tUp =
          newState.leftArm.tUpToTop && newState.leftArm.tRestToUp
            ? newState.leftArm.tUpToTop - newState.leftArm.tRestToUp
            : 0;
        const tDown =
          newState.leftArm.tDownToRest && newState.leftArm.tTopToDown
            ? newState.leftArm.tDownToRest - newState.leftArm.tTopToDown
            : 0;

        const { score, messages } = evaluateForm(
          newState.repWindow,
          newState.leftArm,
          newState.rightArm
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

        // Set feedback (first message if any, otherwise "Great rep!")
        if (messages.length > 0) {
          newState.feedback = messages[0];
        } else {
          newState.feedback = 'Great rep!';
        }
        newState.lastFeedbackTime = t;

        // Reset rep window and arms
        newState.repWindow = null;
        newState.leftArm = initArmFSM();
        newState.rightArm = initArmFSM();
      } else {
        // Not synced - reset
        newState.repWindow = null;
        newState.leftArm = initArmFSM();
        newState.rightArm = initArmFSM();
      }
    } else if (!inRep) {
      // Both arms in REST but rep not valid or not synced - reset
      newState.repWindow = null;
      newState.leftArm = initArmFSM();
      newState.rightArm = initArmFSM();
    }
  }

  // Clear feedback after duration
  if (newState.feedback && t - newState.lastFeedbackTime > 2.0) {
    newState.feedback = null;
  }

  return newState;
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
