/**
 * Barbell Curl Analysis - Forma Canonical Heuristics Implementation
 *
 * Detects and evaluates standing barbell curls using 8 reliable joint angles
 * with real-time, deterministic feedback on form, safety, and rep quality.
 * Aligned with Forma Barbell Curl Heuristics Specification.
 */

import { Keypoint, calculateAngle, getKeypoint, isVisible } from './poseAnalysis';

export interface BarbellCurlState {
  phase: 'start' | 'concentric' | 'top' | 'eccentric' | 'idle';
  repCount: number;
  formScore: number;
  feedback: string | null;
  phaseStartTime: number;
  lastFeedbackTime: number;

  // Angle tracking
  leftElbowAngle: number | null;
  rightElbowAngle: number | null;
  leftShoulderAngle: number | null;
  rightShoulderAngle: number | null;
  leftHipAngle: number | null;
  rightHipAngle: number | null;
  leftKneeAngle: number | null;
  rightKneeAngle: number | null;

  // Phase tracking - upper body
  phaseStartAngles: {
    leftElbow: number;
    rightElbow: number;
    leftShoulder: number;
    rightShoulder: number;
    leftHip: number;
    rightHip: number;
    leftKnee: number;
    rightKnee: number;
  } | null;

  // Rep-level tracking for validity
  repStartElbow: number;
  repTopElbow: number;
  repMaxShoulder: number;

  // Anti-drop (eccentric): frame-to-frame elbow change
  lastElbowAngle: number;
  lastElbowAngleTime: number;

  // Body stability at setup
  setupStableStartTime: number | null;

  // Quality metrics
  rangeOfMotion: number;
  upperArmStability: number;
  symmetry: number;
  tempoControl: number;
  bodyStability: number;
}

export interface BarbellCurlFeedback {
  message: string;
  priority: number; // 1 = safety, 2 = form, 3 = performance
}

const FEEDBACK_DURATION_MS = 2000;
const MIN_FEEDBACK_INTERVAL_MS = 1000;
const MIN_PHASE_DURATION_MS = 250; // 0.25 seconds per spec
const SETUP_STABILITY_DURATION_MS = 300; // 0.3 seconds
const SETUP_STABILITY_TOLERANCE = 5; // ±5°
const ANTI_DROP_MAX_DEG_PER_100MS = 18;

/** Lower threshold to accept MediaPipe's estimated landmarks when limb is occluded (e.g. side-on view) */
const VISIBILITY_THRESHOLD = 0.1;

/**
 * Calculate all joint angles for barbell curl analysis
 */
function calculateJointAngles(keypoints: Keypoint[]): {
  leftElbow: number | null;
  rightElbow: number | null;
  leftShoulder: number | null;
  rightShoulder: number | null;
  leftHip: number | null;
  rightHip: number | null;
  leftKnee: number | null;
  rightKnee: number | null;
} {
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');
  const leftElbow = getKeypoint(keypoints, 'left_elbow');
  const rightElbow = getKeypoint(keypoints, 'right_elbow');
  const leftWrist = getKeypoint(keypoints, 'left_wrist');
  const rightWrist = getKeypoint(keypoints, 'right_wrist');
  const leftHip = getKeypoint(keypoints, 'left_hip');
  const rightHip = getKeypoint(keypoints, 'right_hip');
  const leftKnee = getKeypoint(keypoints, 'left_knee');
  const rightKnee = getKeypoint(keypoints, 'right_knee');
  const leftAnkle = getKeypoint(keypoints, 'left_ankle');
  const rightAnkle = getKeypoint(keypoints, 'right_ankle');

  const leftShoulderAngle = (leftElbow && leftShoulder && leftHip && isVisible(leftElbow, VISIBILITY_THRESHOLD) && isVisible(leftShoulder, VISIBILITY_THRESHOLD) && isVisible(leftHip, VISIBILITY_THRESHOLD))
    ? calculateAngle(leftElbow, leftShoulder, leftHip)
    : null;

  const rightShoulderAngle = (rightElbow && rightShoulder && rightHip && isVisible(rightElbow, VISIBILITY_THRESHOLD) && isVisible(rightShoulder, VISIBILITY_THRESHOLD) && isVisible(rightHip, VISIBILITY_THRESHOLD))
    ? calculateAngle(rightElbow, rightShoulder, rightHip)
    : null;

  const leftElbowAngle = (leftShoulder && leftElbow && leftWrist && isVisible(leftShoulder, VISIBILITY_THRESHOLD) && isVisible(leftElbow, VISIBILITY_THRESHOLD) && isVisible(leftWrist, VISIBILITY_THRESHOLD))
    ? calculateAngle(leftShoulder, leftElbow, leftWrist)
    : null;

  const rightElbowAngle = (rightShoulder && rightElbow && rightWrist && isVisible(rightShoulder, VISIBILITY_THRESHOLD) && isVisible(rightElbow, VISIBILITY_THRESHOLD) && isVisible(rightWrist, VISIBILITY_THRESHOLD))
    ? calculateAngle(rightShoulder, rightElbow, rightWrist)
    : null;

  const leftHipAngle = (leftShoulder && leftHip && leftKnee && isVisible(leftShoulder, VISIBILITY_THRESHOLD) && isVisible(leftHip, VISIBILITY_THRESHOLD) && isVisible(leftKnee, VISIBILITY_THRESHOLD))
    ? calculateAngle(leftShoulder, leftHip, leftKnee)
    : null;

  const rightHipAngle = (rightShoulder && rightHip && rightKnee && isVisible(rightShoulder, VISIBILITY_THRESHOLD) && isVisible(rightHip, VISIBILITY_THRESHOLD) && isVisible(rightKnee, VISIBILITY_THRESHOLD))
    ? calculateAngle(rightShoulder, rightHip, rightKnee)
    : null;

  const leftKneeAngle = (leftHip && leftKnee && leftAnkle && isVisible(leftHip, VISIBILITY_THRESHOLD) && isVisible(leftKnee, VISIBILITY_THRESHOLD) && isVisible(leftAnkle, VISIBILITY_THRESHOLD))
    ? calculateAngle(leftHip, leftKnee, leftAnkle)
    : null;

  const rightKneeAngle = (rightHip && rightKnee && rightAnkle && isVisible(rightHip, VISIBILITY_THRESHOLD) && isVisible(rightKnee, VISIBILITY_THRESHOLD) && isVisible(rightAnkle, VISIBILITY_THRESHOLD))
    ? calculateAngle(rightHip, rightKnee, rightAnkle)
    : null;

  return {
    leftElbow: leftElbowAngle,
    rightElbow: rightElbowAngle,
    leftShoulder: leftShoulderAngle,
    rightShoulder: rightShoulderAngle,
    leftHip: leftHipAngle,
    rightHip: rightHipAngle,
    leftKnee: leftKneeAngle,
    rightKnee: rightKneeAngle,
  };
}

/**
 * When one side is occluded (e.g. side-on view), use the visible limb's angle
 * as an estimate for the occluded side. Barbell curls are symmetric, so both
 * arms move together. Returns effective angles for analysis (nulls filled from mirror).
 */
function getEffectiveAngles(
  raw: ReturnType<typeof calculateJointAngles>
): {
  leftElbow: number;
  rightElbow: number;
  leftShoulder: number;
  rightShoulder: number;
  leftHip: number;
  rightHip: number;
  leftKnee: number;
  rightKnee: number;
  canAnalyze: boolean;
} {
  const elbow = raw.leftElbow !== null || raw.rightElbow !== null
    ? { left: raw.leftElbow ?? raw.rightElbow!, right: raw.rightElbow ?? raw.leftElbow! }
    : null;
  const shoulder = raw.leftShoulder !== null || raw.rightShoulder !== null
    ? { left: raw.leftShoulder ?? raw.rightShoulder!, right: raw.rightShoulder ?? raw.leftShoulder! }
    : null;
  const hip = raw.leftHip !== null || raw.rightHip !== null
    ? { left: raw.leftHip ?? raw.rightHip!, right: raw.rightHip ?? raw.leftHip! }
    : null;
  const knee = raw.leftKnee !== null || raw.rightKnee !== null
    ? { left: raw.leftKnee ?? raw.rightKnee!, right: raw.rightKnee ?? raw.leftKnee! }
    : null;

  const canAnalyze = elbow !== null && shoulder !== null;

  return {
    leftElbow: elbow?.left ?? 0,
    rightElbow: elbow?.right ?? 0,
    leftShoulder: shoulder?.left ?? 0,
    rightShoulder: shoulder?.right ?? 0,
    leftHip: hip?.left ?? 170,
    rightHip: hip?.right ?? 170,
    leftKnee: knee?.left ?? 170,
    rightKnee: knee?.right ?? 170,
    canAnalyze,
  };
}

/**
 * Check if the pose matches barbell curl classification criteria (Spec §1)
 * Body position: hip 155-185°, knee 155-185°
 * Shoulder: stable, below 30° for start position
 * Uses effective angles (with mirror estimation for occluded limbs).
 */
function classifyExercise(effective: ReturnType<typeof getEffectiveAngles>): boolean {
  if (!effective.canAnalyze) return false;

  const { leftHip, rightHip, leftKnee, rightKnee, leftShoulder, rightShoulder } = effective;
  const meanHipAngle = (leftHip + rightHip) / 2;
  const meanKneeAngle = (leftKnee + rightKnee) / 2;
  const meanShoulder = (leftShoulder + rightShoulder) / 2;

  if (meanHipAngle < 155 || meanHipAngle > 185) return false;
  if (meanKneeAngle < 155 || meanKneeAngle > 185) return false;
  if (meanShoulder > 30) return false;

  return true;
}

/**
 * Generate feedback based on current state and angles (Spec §3-7, §11)
 * Uses effective angles (with mirror estimation for occluded limbs).
 */
function generateFeedback(
  state: BarbellCurlState,
  effective: ReturnType<typeof getEffectiveAngles>,
  currentTime: number
): BarbellCurlFeedback | null {
  if (currentTime - state.lastFeedbackTime < MIN_FEEDBACK_INTERVAL_MS) return null;
  if (!effective.canAnalyze) return null;

  const { leftElbow, rightElbow, leftShoulder, rightShoulder, leftHip, rightHip, leftKnee, rightKnee } = effective;

  const meanElbow = (leftElbow + rightElbow) / 2;
  const meanShoulder = (leftShoulder + rightShoulder) / 2;
  const meanHip = (leftHip + rightHip) / 2;
  const meanKnee = (leftKnee + rightKnee) / 2;
  const phaseDurationSec = (currentTime - state.phaseStartTime) / 1000;

  // Priority 1: Safety and form breakdown
  if (state.phaseStartAngles) {
    const hipChange = Math.abs(meanHip - (state.phaseStartAngles.leftHip + state.phaseStartAngles.rightHip) / 2);
    const kneeChange = Math.abs(meanKnee - (state.phaseStartAngles.leftKnee + state.phaseStartAngles.rightKnee) / 2);

    if (hipChange > 25 || kneeChange > 25) {
      return { message: "No swinging—curl strictly.", priority: 1 };
    }
    if (hipChange > 15 || kneeChange > 15) {
      return { message: "Keep your body still.", priority: 1 };
    }

    if (state.phase === 'concentric') {
      const shoulderChange = Math.abs(meanShoulder - (state.phaseStartAngles.leftShoulder + state.phaseStartAngles.rightShoulder) / 2);
      if (shoulderChange > 10) {
        return { message: "Keep your upper arms still—don't swing the bar.", priority: 1 };
      }
      const concentricHipChange = Math.abs(meanHip - (state.phaseStartAngles.leftHip + state.phaseStartAngles.rightHip) / 2);
      const concentricKneeChange = Math.abs(meanKnee - (state.phaseStartAngles.leftKnee + state.phaseStartAngles.rightKnee) / 2);
      if (concentricHipChange > 8 || concentricKneeChange > 10) {
        return { message: "No body swing—curl strictly.", priority: 1 };
      }
    }
  }

  // Priority 2: Major form errors
  if (state.phase === 'start') {
    if (meanElbow < 165 || meanElbow > 180) {
      return { message: "Start with your arms fully extended at your sides.", priority: 2 };
    }
    if (meanShoulder >= 20) {
      return { message: "Start with your arms fully extended at your sides.", priority: 2 };
    }
    const elbowDiff = Math.abs(leftElbow - rightElbow);
    const shoulderDiff = Math.abs(leftShoulder - rightShoulder);
    if (elbowDiff > 6 || shoulderDiff > 6) {
      return { message: "Set both arms evenly before curling.", priority: 2 };
    }
  }

  if (state.phase === 'top') {
    if (meanElbow > 75) {
      return { message: "Curl the bar higher and squeeze at the top.", priority: 2 };
    }
    if (meanShoulder >= 30) {
      return { message: "Keep your upper arms still—don't swing the bar.", priority: 2 };
    }
    const elbowDiff = Math.abs(leftElbow - rightElbow);
    const shoulderDiff = Math.abs(leftShoulder - rightShoulder);
    if (elbowDiff > 7 || shoulderDiff > 7) {
      return { message: "Curl evenly with both arms.", priority: 2 };
    }
  }

  if (state.phase === 'start' && state.setupStableStartTime === null) {
    if (state.phaseStartAngles) {
      const hipStable = Math.abs(meanHip - (state.phaseStartAngles.leftHip + state.phaseStartAngles.rightHip) / 2) <= SETUP_STABILITY_TOLERANCE;
      const kneeStable = Math.abs(meanKnee - (state.phaseStartAngles.leftKnee + state.phaseStartAngles.rightKnee) / 2) <= SETUP_STABILITY_TOLERANCE;
      if (!hipStable || !kneeStable) {
        return { message: "Stand tall and steady before curling.", priority: 2 };
      }
    }
  }

  // Priority 3: Performance cues (tempo)
  if (state.phase === 'concentric') {
    if (phaseDurationSec < 0.5 && phaseDurationSec > 0.1) {
      return { message: "Curl the bar more slowly.", priority: 3 };
    }
    if (phaseDurationSec > 2.0) {
      return { message: "Curl the bar more quickly.", priority: 3 };
    }
  }

  if (state.phase === 'eccentric') {
    if (phaseDurationSec < 0.8 && phaseDurationSec > 0.1) {
      return { message: "Lower the bar under control.", priority: 3 };
    }
    if (phaseDurationSec > 3.0) {
      return { message: "Lower the bar under control.", priority: 3 };
    }
  }

  return null;
}

/**
 * Check for anti-drop: frame-to-frame elbow change must not exceed 18° per 100ms (Spec §6)
 */
function checkAntiDrop(
  state: BarbellCurlState,
  meanElbow: number,
  currentTime: number
): BarbellCurlFeedback | null {
  if (currentTime - state.lastFeedbackTime < MIN_FEEDBACK_INTERVAL_MS) return null;
  if (state.phase !== 'eccentric') return null;

  const dtMs = currentTime - state.lastElbowAngleTime;
  if (dtMs < 50) return null;

  const elbowChange = Math.abs(meanElbow - state.lastElbowAngle);
  const maxAllowed = (dtMs / 100) * ANTI_DROP_MAX_DEG_PER_100MS;
  if (elbowChange > maxAllowed) {
    return { message: "Don't drop the bar—control the descent.", priority: 1 };
  }
  return null;
}

/**
 * Calculate form score (Spec §9): ROM 30%, upper-arm 25%, symmetry 20%, tempo 15%, body 10%
 */
function calculateFormScore(state: BarbellCurlState): number {
  const romScore = state.rangeOfMotion * 0.3;
  const stabilityScore = state.upperArmStability * 0.25;
  const symmetryScore = state.symmetry * 0.2;
  const tempoScore = state.tempoControl * 0.15;
  const bodyScore = state.bodyStability * 0.1;
  return Math.min(100, Math.max(0, romScore + stabilityScore + symmetryScore + tempoScore + bodyScore));
}

/**
 * Validate rep per Spec §8 before counting
 */
function isRepValid(state: BarbellCurlState): boolean {
  if (state.repStartElbow < 165) return false;
  if (state.repTopElbow > 70) return false;
  if (state.repMaxShoulder >= 30) return false;
  return true;
}

export function initializeBarbellCurlState(): BarbellCurlState {
  return {
    phase: 'idle',
    repCount: 0,
    formScore: 0,
    feedback: null,
    phaseStartTime: Date.now(),
    lastFeedbackTime: 0,

    leftElbowAngle: null,
    rightElbowAngle: null,
    leftShoulderAngle: null,
    rightShoulderAngle: null,
    leftHipAngle: null,
    rightHipAngle: null,
    leftKneeAngle: null,
    rightKneeAngle: null,

    phaseStartAngles: null,

    repStartElbow: 180,
    repTopElbow: 180,
    repMaxShoulder: 0,

    lastElbowAngle: 180,
    lastElbowAngleTime: Date.now(),

    setupStableStartTime: null,

    rangeOfMotion: 100,
    upperArmStability: 100,
    symmetry: 100,
    tempoControl: 100,
    bodyStability: 100,
  };
}

export function updateBarbellCurlState(
  keypoints: Keypoint[],
  currentState: BarbellCurlState
): BarbellCurlState {
  const rawAngles = calculateJointAngles(keypoints);
  const effective = getEffectiveAngles(rawAngles);
  const currentTime = Date.now();

  const newState: BarbellCurlState = {
    ...currentState,
    leftElbowAngle: effective.canAnalyze ? effective.leftElbow : null,
    rightElbowAngle: effective.canAnalyze ? effective.rightElbow : null,
    leftShoulderAngle: effective.canAnalyze ? effective.leftShoulder : null,
    rightShoulderAngle: effective.canAnalyze ? effective.rightShoulder : null,
    leftHipAngle: effective.canAnalyze ? effective.leftHip : null,
    rightHipAngle: effective.canAnalyze ? effective.rightHip : null,
    leftKneeAngle: effective.canAnalyze ? effective.leftKnee : null,
    rightKneeAngle: effective.canAnalyze ? effective.rightKnee : null,
  };

  if (!effective.canAnalyze || !classifyExercise(effective)) {
    return { ...newState, feedback: null };
  }

  const { leftElbow, rightElbow, leftShoulder, rightShoulder, leftHip, rightHip, leftKnee, rightKnee } = effective;

  const meanElbow = (leftElbow + rightElbow) / 2;
  const meanShoulder = (leftShoulder + rightShoulder) / 2;

  newState.lastElbowAngle = meanElbow;
  newState.lastElbowAngleTime = currentTime;

  const phaseDurationMs = currentTime - currentState.phaseStartTime;

  // Phase transitions (Spec §2)
  if (currentState.phase === 'idle') {
    if (meanElbow >= 165 && meanElbow <= 180 && meanShoulder < 20) {
      newState.phase = 'start';
      newState.phaseStartTime = currentTime;
      newState.phaseStartAngles = {
        leftElbow,
        rightElbow,
        leftShoulder,
        rightShoulder,
        leftHip,
        rightHip,
        leftKnee,
        rightKnee,
      };
      newState.setupStableStartTime = null;
    }
  } else if (currentState.phase === 'start') {
    newState.repMaxShoulder = Math.max(currentState.repMaxShoulder, meanShoulder);
    if (phaseDurationMs >= SETUP_STABILITY_DURATION_MS && newState.phaseStartAngles) {
      const meanHip = (leftHip + rightHip) / 2;
      const meanKnee = (leftKnee + rightKnee) / 2;
      const startMeanHip = (newState.phaseStartAngles.leftHip + newState.phaseStartAngles.rightHip) / 2;
      const startMeanKnee = (newState.phaseStartAngles.leftKnee + newState.phaseStartAngles.rightKnee) / 2;
      if (Math.abs(meanHip - startMeanHip) <= SETUP_STABILITY_TOLERANCE && Math.abs(meanKnee - startMeanKnee) <= SETUP_STABILITY_TOLERANCE) {
        if (newState.setupStableStartTime === null) {
          newState.setupStableStartTime = currentTime;
        }
      }
    }
    if (meanElbow < 160 && phaseDurationMs >= MIN_PHASE_DURATION_MS) {
      newState.phase = 'concentric';
      newState.phaseStartTime = currentTime;
      newState.repStartElbow = currentState.phaseStartAngles ? (currentState.phaseStartAngles.leftElbow + currentState.phaseStartAngles.rightElbow) / 2 : meanElbow;
      newState.phaseStartAngles = {
        leftElbow,
        rightElbow,
        leftShoulder,
        rightShoulder,
        leftHip,
        rightHip,
        leftKnee,
        rightKnee,
      };
    }
  } else if (currentState.phase === 'concentric') {
    newState.repMaxShoulder = Math.max(currentState.repMaxShoulder, meanShoulder);
    if (meanElbow <= 80 && phaseDurationMs >= MIN_PHASE_DURATION_MS) {
      newState.phase = 'top';
      newState.phaseStartTime = currentTime;
      newState.repTopElbow = meanElbow;
      const startElbow = currentState.phaseStartAngles ? (currentState.phaseStartAngles.leftElbow + currentState.phaseStartAngles.rightElbow) / 2 : 180;
      const rom = startElbow - meanElbow;
      newState.rangeOfMotion = Math.min(100, Math.max(0, (rom / 110) * 100));
      newState.phaseStartAngles = {
        leftElbow,
        rightElbow,
        leftShoulder,
        rightShoulder,
        leftHip,
        rightHip,
        leftKnee,
        rightKnee,
      };
    }
  } else if (currentState.phase === 'top') {
    newState.repMaxShoulder = Math.max(currentState.repMaxShoulder, meanShoulder);
    if (phaseDurationMs >= MIN_PHASE_DURATION_MS && meanElbow > 75) {
      newState.phase = 'eccentric';
      newState.phaseStartTime = currentTime;
      newState.phaseStartAngles = {
        leftElbow,
        rightElbow,
        leftShoulder,
        rightShoulder,
        leftHip,
        rightHip,
        leftKnee,
        rightKnee,
      };
    }
  } else if (currentState.phase === 'eccentric') {
    newState.repMaxShoulder = Math.max(currentState.repMaxShoulder, meanShoulder);
    if (meanElbow >= 165 && phaseDurationMs >= MIN_PHASE_DURATION_MS) {
      const valid = isRepValid(currentState);
      if (valid) {
        newState.repCount = currentState.repCount + 1;
        newState.formScore = calculateFormScore(currentState);
      }
      newState.phase = 'start';
      newState.phaseStartTime = currentTime;
      newState.repStartElbow = 180;
      newState.repTopElbow = 180;
      newState.repMaxShoulder = 0;
      newState.phaseStartAngles = {
        leftElbow,
        rightElbow,
        leftShoulder,
        rightShoulder,
        leftHip,
        rightHip,
        leftKnee,
        rightKnee,
      };
      newState.setupStableStartTime = null;
      newState.rangeOfMotion = 100;
      newState.upperArmStability = 100;
      newState.symmetry = 100;
      newState.tempoControl = 100;
      newState.bodyStability = 100;
    }
  }

  let feedbackResult = generateFeedback(newState, effective, currentTime);
  if (!feedbackResult) {
    feedbackResult = checkAntiDrop(currentState, meanElbow, currentTime);
  }
  if (feedbackResult) {
    newState.feedback = feedbackResult.message;
    newState.lastFeedbackTime = currentTime;
  } else if (currentTime - newState.lastFeedbackTime > FEEDBACK_DURATION_MS) {
    newState.feedback = null;
  }

  return newState;
}
