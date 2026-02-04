/**
 * Barbell Bicep Curl Analysis - Forma Heuristics Implementation
 *
 * Counts reps using a Finite State Machine and analyzes form in real-time
 * using geometric heuristics. Triggers immediate feedback for form errors
 * (Momentum/Swinging, Elbow Drift, ROM).
 *
 * Uses MediaPipe 3D World Coordinates when available for accurate angles.
 */

import {
  Keypoint,
  calculateAngle,
  calculateAngle2D,
  calculateVerticalAngle,
  getKeypoint,
  isVisible,
} from './poseAnalysis';

// Configuration constants (elbow at top of curl typically ~90° in practice)
export const BICEP_CURL_CONFIG = {
  FULL_EXTENSION_THRESHOLD: 160,
  PEAK_CONTRACTION_THRESHOLD: 95,
  TOP_TO_ECCENTRIC_THRESHOLD: 105,
  START_TO_CONCENTRIC_THRESHOLD: 150,
  MAX_TORSO_SWING: 15,
  MAX_ELBOW_DRIFT: 30,
} as const;

const FEEDBACK_DURATION_MS = 2000;
const MIN_FEEDBACK_INTERVAL_MS = 1000;
const VISIBILITY_THRESHOLD = 0.1;

export type CurlPhase = 'START' | 'CONCENTRIC' | 'TOP' | 'ECCENTRIC';

export interface BarbellCurlState {
  currentPhase: CurlPhase;
  phase: 'start' | 'concentric' | 'top' | 'eccentric';
  repCount: number;
  errors: Set<string>;
  lowestAngleObserved: number;
  highestAngleObserved: number;

  feedback: string | null;
  lastFeedbackTime: number;

  leftElbowAngle: number | null;
  rightElbowAngle: number | null;
  leftShoulderAngle: number | null;
  rightShoulderAngle: number | null;
  leftHipAngle: number | null;
  rightHipAngle: number | null;
  leftKneeAngle: number | null;
  rightKneeAngle: number | null;

  formScore: number;
}

export interface BarbellCurlFeedback {
  message: string;
  priority: number;
}

type Point3D = { x: number; y: number; z?: number };

function getPoint(kp: Keypoint | null): Point3D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y, z: kp.z };
}

/**
 * Compute kinematics for bicep curl from keypoints.
 * Averages left and right when both visible; otherwise uses the visible side.
 */
function computeKinematics(keypoints: Keypoint[]): {
  elbowAngle: number;
  torsoAngle: number;
  shoulderFlexion: number;
  canAnalyze: boolean;
} | null {
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');
  const leftElbow = getKeypoint(keypoints, 'left_elbow');
  const rightElbow = getKeypoint(keypoints, 'right_elbow');
  const leftWrist = getKeypoint(keypoints, 'left_wrist');
  const rightWrist = getKeypoint(keypoints, 'right_wrist');
  const leftHip = getKeypoint(keypoints, 'left_hip');
  const rightHip = getKeypoint(keypoints, 'right_hip');

  const leftOk =
    leftShoulder && leftElbow && leftWrist && leftHip &&
    isVisible(leftShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(leftElbow, VISIBILITY_THRESHOLD) &&
    isVisible(leftWrist, VISIBILITY_THRESHOLD) &&
    isVisible(leftHip, VISIBILITY_THRESHOLD);
  const rightOk =
    rightShoulder && rightElbow && rightWrist && rightHip &&
    isVisible(rightShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(rightElbow, VISIBILITY_THRESHOLD) &&
    isVisible(rightWrist, VISIBILITY_THRESHOLD) &&
    isVisible(rightHip, VISIBILITY_THRESHOLD);

  if (!leftOk && !rightOk) return null;

  let elbowAngle: number;
  let torsoAngle: number;
  let shoulderFlexion: number;

  if (leftOk && rightOk) {
    // Inner elbow angle: use 2D (xy only) - avoids z-scale issues with MediaPipe coords
    // Gives flexion angle: small when flexed (~30–50°), ~180° when extended
    const leftElbowAng = calculateAngle2D(
      getPoint(leftShoulder)!,
      getPoint(leftElbow)!,
      getPoint(leftWrist)!
    );
    const rightElbowAng = calculateAngle2D(
      getPoint(rightShoulder)!,
      getPoint(rightElbow)!,
      getPoint(rightWrist)!
    );
    elbowAngle = (leftElbowAng + rightElbowAng) / 2;

    const leftTorso = calculateVerticalAngle(
      getPoint(leftHip)!,
      getPoint(leftShoulder)!
    );
    const rightTorso = calculateVerticalAngle(
      getPoint(rightHip)!,
      getPoint(rightShoulder)!
    );
    torsoAngle = (leftTorso + rightTorso) / 2;

    const leftDrift = calculateAngle(
      getPoint(leftHip)!,
      getPoint(leftShoulder)!,
      getPoint(leftElbow)!
    );
    const rightDrift = calculateAngle(
      getPoint(rightHip)!,
      getPoint(rightShoulder)!,
      getPoint(rightElbow)!
    );
    shoulderFlexion = (leftDrift + rightDrift) / 2;
  } else if (leftOk) {
    elbowAngle = calculateAngle2D(
      getPoint(leftShoulder)!,
      getPoint(leftElbow)!,
      getPoint(leftWrist)!
    );
    torsoAngle = calculateVerticalAngle(
      getPoint(leftHip)!,
      getPoint(leftShoulder)!
    );
    shoulderFlexion = calculateAngle(
      getPoint(leftHip)!,
      getPoint(leftShoulder)!,
      getPoint(leftElbow)!
    );
  } else {
    elbowAngle = calculateAngle2D(
      getPoint(rightShoulder)!,
      getPoint(rightElbow)!,
      getPoint(rightWrist)!
    );
    torsoAngle = calculateVerticalAngle(
      getPoint(rightHip)!,
      getPoint(rightShoulder)!
    );
    shoulderFlexion = calculateAngle(
      getPoint(rightHip)!,
      getPoint(rightShoulder)!,
      getPoint(rightElbow)!
    );
  }

  return {
    elbowAngle,
    torsoAngle,
    shoulderFlexion,
    canAnalyze: true,
  };
}

/**
 * Calculate joint angles for UI display (legacy compatibility).
 */
function calculateJointAnglesForDisplay(keypoints: Keypoint[]): {
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

  // Inner elbow angle: use 2D projection for accuracy (avoids z-scale issues)
  const leftElbowAngle =
    leftShoulder && leftElbow && leftWrist && isVisible(leftElbow, VISIBILITY_THRESHOLD)
      ? calculateAngle2D(getPoint(leftShoulder)!, getPoint(leftElbow)!, getPoint(leftWrist)!)
      : null;
  const rightElbowAngle =
    rightShoulder && rightElbow && rightWrist && isVisible(rightElbow, VISIBILITY_THRESHOLD)
      ? calculateAngle2D(getPoint(rightShoulder)!, getPoint(rightElbow)!, getPoint(rightWrist)!)
      : null;
  const leftShoulderAngle =
    leftElbow && leftShoulder && leftHip && isVisible(leftShoulder, VISIBILITY_THRESHOLD)
      ? calculateAngle(getPoint(leftElbow)!, getPoint(leftShoulder)!, getPoint(leftHip)!)
      : null;
  const rightShoulderAngle =
    rightElbow && rightShoulder && rightHip && isVisible(rightShoulder, VISIBILITY_THRESHOLD)
      ? calculateAngle(getPoint(rightElbow)!, getPoint(rightShoulder)!, getPoint(rightHip)!)
      : null;

  const leftHipAngle =
    leftShoulder && leftHip && leftKnee && isVisible(leftHip, VISIBILITY_THRESHOLD)
      ? calculateAngle(getPoint(leftShoulder)!, getPoint(leftHip)!, getPoint(leftKnee)!)
      : null;
  const rightHipAngle =
    rightShoulder && rightHip && rightKnee && isVisible(rightHip, VISIBILITY_THRESHOLD)
      ? calculateAngle(getPoint(rightShoulder)!, getPoint(rightHip)!, getPoint(rightKnee)!)
      : null;
  const leftKneeAngle =
    leftHip && leftKnee && leftAnkle && isVisible(leftKnee, VISIBILITY_THRESHOLD)
      ? calculateAngle(getPoint(leftHip)!, getPoint(leftKnee)!, getPoint(leftAnkle)!)
      : null;
  const rightKneeAngle =
    rightHip && rightKnee && rightAnkle && isVisible(rightKnee, VISIBILITY_THRESHOLD)
      ? calculateAngle(getPoint(rightHip)!, getPoint(rightKnee)!, getPoint(rightAnkle)!)
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

export function initializeBarbellCurlState(): BarbellCurlState {
  return {
    currentPhase: 'START',
    phase: 'start',
    repCount: 0,
    errors: new Set(),
    lowestAngleObserved: 180,
    highestAngleObserved: 0,

    feedback: null,
    lastFeedbackTime: 0,

    leftElbowAngle: null,
    rightElbowAngle: null,
    leftShoulderAngle: null,
    rightShoulderAngle: null,
    leftHipAngle: null,
    rightHipAngle: null,
    leftKneeAngle: null,
    rightKneeAngle: null,

    formScore: 0,
  };
}

function getFeedbackMessage(errors: Set<string>): string | null {
  if (errors.has('SWING')) return "Don't swing your back!";
  if (errors.has('DRIFT')) return 'Keep your elbows pinned to your sides.';
  if (errors.has('ROM_TOP')) return 'Squeeze all the way up.';
  if (errors.has('ROM_BOTTOM')) return 'Fully extend your arms at the bottom.';
  return null;
}

function calculateFormScoreFromErrors(errors: Set<string>): number {
  if (errors.size === 0) return 100;
  if (errors.size === 1) return 85;
  if (errors.size === 2) return 70;
  return 55;
}

export function updateBarbellCurlState(
  keypoints: Keypoint[],
  currentState: BarbellCurlState
): BarbellCurlState {
  const displayAngles = calculateJointAnglesForDisplay(keypoints);
  const kinematics = computeKinematics(keypoints);

  const newState: BarbellCurlState = {
    ...currentState,
    leftElbowAngle: displayAngles.leftElbow,
    rightElbowAngle: displayAngles.rightElbow,
    leftShoulderAngle: displayAngles.leftShoulder,
    rightShoulderAngle: displayAngles.rightShoulder,
    leftHipAngle: displayAngles.leftHip,
    rightHipAngle: displayAngles.rightHip,
    leftKneeAngle: displayAngles.leftKnee,
    rightKneeAngle: displayAngles.rightKnee,
  };

  if (!kinematics) {
    newState.feedback = null;
    return newState;
  }

  const { elbowAngle, torsoAngle, shoulderFlexion } = kinematics;
  const currentTime = Date.now();

  newState.lowestAngleObserved = Math.min(
    currentState.lowestAngleObserved,
    elbowAngle
  );
  newState.highestAngleObserved = Math.max(
    currentState.highestAngleObserved,
    elbowAngle
  );

  const errors = new Set(currentState.errors);

  switch (currentState.currentPhase) {
    case 'START':
      if (elbowAngle < BICEP_CURL_CONFIG.START_TO_CONCENTRIC_THRESHOLD) {
        newState.currentPhase = 'CONCENTRIC';
        errors.clear();
      }
      break;

    case 'CONCENTRIC':
      if (Math.abs(torsoAngle - 0) > BICEP_CURL_CONFIG.MAX_TORSO_SWING) {
        errors.add('SWING');
      }
      if (shoulderFlexion > BICEP_CURL_CONFIG.MAX_ELBOW_DRIFT) {
        errors.add('DRIFT');
      }
      // Transition to TOP when elbow flexes below 70°. If 60°–70°, flag ROM_TOP (didn't fully squeeze).
      if (elbowAngle < BICEP_CURL_CONFIG.TOP_TO_ECCENTRIC_THRESHOLD) {
        if (elbowAngle >= BICEP_CURL_CONFIG.PEAK_CONTRACTION_THRESHOLD) {
          errors.add('ROM_TOP');
        }
        newState.currentPhase = 'TOP';
      }
      break;

    case 'TOP':
      if (elbowAngle > BICEP_CURL_CONFIG.TOP_TO_ECCENTRIC_THRESHOLD) {
        newState.currentPhase = 'ECCENTRIC';
      }
      break;

    case 'ECCENTRIC':
      if (elbowAngle > BICEP_CURL_CONFIG.FULL_EXTENSION_THRESHOLD) {
        const errorsBeforeClear = new Set(errors);
        newState.currentPhase = 'START';
        newState.repCount = currentState.repCount + 1;
        newState.formScore = calculateFormScoreFromErrors(errorsBeforeClear);
        newState.lowestAngleObserved = 180;
        newState.highestAngleObserved = 0;
        errors.clear();

        const repFeedback =
          errorsBeforeClear.size === 0 ? 'Good form!' : getFeedbackMessage(errorsBeforeClear);
        if (
          repFeedback &&
          currentTime - currentState.lastFeedbackTime > MIN_FEEDBACK_INTERVAL_MS
        ) {
          newState.feedback = repFeedback;
          newState.lastFeedbackTime = currentTime;
        }
      }
      break;
  }

  newState.errors = errors;

  newState.phase = newState.currentPhase.toLowerCase() as
    | 'start'
    | 'concentric'
    | 'top'
    | 'eccentric';

  const liveFeedback = getFeedbackMessage(errors);
  if (
    liveFeedback &&
    newState.currentPhase === 'CONCENTRIC' &&
    currentTime - currentState.lastFeedbackTime > MIN_FEEDBACK_INTERVAL_MS
  ) {
    newState.feedback = liveFeedback;
    newState.lastFeedbackTime = currentTime;
  } else if (
    !newState.feedback &&
    currentTime - newState.lastFeedbackTime > FEEDBACK_DURATION_MS
  ) {
    newState.feedback = null;
  }

  return newState;
}
