/**
 * Barbell Curl Analysis - Canonical Heuristics Implementation
 * 
 * Detects and evaluates standing barbell curls using 8 reliable joint angles
 * with real-time, deterministic feedback on form, safety, and rep quality.
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
  
  // Phase tracking
  phaseStartAngles: {
    leftElbow: number;
    rightElbow: number;
    leftShoulder: number;
    rightShoulder: number;
  } | null;
  
  // Quality metrics
  rangeOfMotion: number;
  upperArmStability: number;
  symmetry: number;
  tempoControl: number;
  bodyStability: number;
}

export interface BarbellCurlFeedback {
  message: string;
  priority: number; // 1 = highest (safety), 2 = form, 3 = performance
}

const FEEDBACK_DURATION_MS = 2000;
const MIN_FEEDBACK_INTERVAL_MS = 1000;

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

  // For shoulder angle: we measure elbow-shoulder-hip angle to detect if arm is raised
  // When arm is at side, this should be close to 180° (straight line)
  // When arm is raised forward/up, this angle decreases
  const leftShoulderAngle = (leftElbow && leftShoulder && leftHip && isVisible(leftElbow, 0.3) && isVisible(leftShoulder, 0.3) && isVisible(leftHip, 0.3))
    ? calculateAngle(leftElbow, leftShoulder, leftHip)
    : null;
  
  const rightShoulderAngle = (rightElbow && rightShoulder && rightHip && isVisible(rightElbow, 0.3) && isVisible(rightShoulder, 0.3) && isVisible(rightHip, 0.3))
    ? calculateAngle(rightElbow, rightShoulder, rightHip)
    : null;

  // Elbow angle: shoulder-elbow-wrist
  const leftElbowAngle = (leftShoulder && leftElbow && leftWrist && isVisible(leftShoulder, 0.3) && isVisible(leftElbow, 0.3) && isVisible(leftWrist, 0.3))
    ? calculateAngle(leftShoulder, leftElbow, leftWrist)
    : null;
  
  const rightElbowAngle = (rightShoulder && rightElbow && rightWrist && isVisible(rightShoulder, 0.3) && isVisible(rightElbow, 0.3) && isVisible(rightWrist, 0.3))
    ? calculateAngle(rightShoulder, rightElbow, rightWrist)
    : null;

  // Hip angle: shoulder-hip-knee
  const leftHipAngle = (leftShoulder && leftHip && leftKnee && isVisible(leftShoulder, 0.3) && isVisible(leftHip, 0.3) && isVisible(leftKnee, 0.3))
    ? calculateAngle(leftShoulder, leftHip, leftKnee)
    : null;
  
  const rightHipAngle = (rightShoulder && rightHip && rightKnee && isVisible(rightShoulder, 0.3) && isVisible(rightHip, 0.3) && isVisible(rightKnee, 0.3))
    ? calculateAngle(rightShoulder, rightHip, rightKnee)
    : null;

  // Knee angle: hip-knee-ankle
  const leftKneeAngle = (leftHip && leftKnee && leftAnkle && isVisible(leftHip, 0.3) && isVisible(leftKnee, 0.3) && isVisible(leftAnkle, 0.3))
    ? calculateAngle(leftHip, leftKnee, leftAnkle)
    : null;
  
  const rightKneeAngle = (rightHip && rightKnee && rightAnkle && isVisible(rightHip, 0.3) && isVisible(rightKnee, 0.3) && isVisible(rightAnkle, 0.3))
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
 * Check if the pose matches barbell curl classification criteria
 */
function classifyExercise(angles: ReturnType<typeof calculateJointAngles>): boolean {
  const { leftHip, rightHip, leftKnee, rightKnee, leftElbow, rightElbow, leftShoulder, rightShoulder } = angles;

  // Need valid angles (at least one side must be visible)
  if ((leftElbow === null && rightElbow === null) || (leftShoulder === null && rightShoulder === null)) {
    console.log('[Barbell Curl] Missing elbow or shoulder angles');
    return false;
  }

  // Body position: upright standing (relaxed requirements)
  if (leftHip !== null && rightHip !== null && leftKnee !== null && rightKnee !== null) {
    const meanHipAngle = (leftHip + rightHip) / 2;
    const meanKneeAngle = (leftKnee + rightKnee) / 2;
    
    if (meanHipAngle < 150 || meanHipAngle > 190) {
      console.log(`[Barbell Curl] Hip angle out of range: ${meanHipAngle.toFixed(1)}°`);
      return false;
    }
    if (meanKneeAngle < 150 || meanKneeAngle > 190) {
      console.log(`[Barbell Curl] Knee angle out of range: ${meanKneeAngle.toFixed(1)}°`);
      return false;
    }
  }

  // Shoulder should be relatively stable
  // When arms hang at sides (elbows below shoulders), elbow-shoulder-hip angle is ~5-60°
  // When arms are raised forward/up, this angle increases toward 90-180°
  // For barbell curl start position (arms hanging), accept 5-90°
  if (leftShoulder !== null && (leftShoulder < 5 || leftShoulder > 90)) {
    console.log(`[Barbell Curl] Left shoulder angle out of range: ${leftShoulder.toFixed(1)}°`);
    return false;
  }
  if (rightShoulder !== null && (rightShoulder < 5 || rightShoulder > 90)) {
    console.log(`[Barbell Curl] Right shoulder angle out of range: ${rightShoulder.toFixed(1)}°`);
    return false;
  }

  console.log('[Barbell Curl] Classification passed');
  return true;
}

/**
 * Generate feedback based on current state and angles
 */
function generateFeedback(
  state: BarbellCurlState,
  angles: ReturnType<typeof calculateJointAngles>,
  currentTime: number
): BarbellCurlFeedback | null {
  // Respect feedback cooldown
  if (currentTime - state.lastFeedbackTime < MIN_FEEDBACK_INTERVAL_MS) {
    return null;
  }

  const { leftElbow, rightElbow, leftShoulder, rightShoulder, leftHip, rightHip, leftKnee, rightKnee } = angles;
  
  if (leftElbow === null || rightElbow === null || leftShoulder === null || rightShoulder === null) return null;
  if (leftHip === null || rightHip === null || leftKnee === null || rightKnee === null) return null;

  // Priority 1: Safety and form breakdown
  const meanHipChange = state.phaseStartAngles 
    ? Math.abs(((leftHip + rightHip) / 2) - ((state.phaseStartAngles.leftShoulder + state.phaseStartAngles.rightShoulder) / 2)) 
    : 0;
  
  if (meanHipChange > 25) {
    return { message: "No swinging—curl strictly.", priority: 1 };
  }

  // Upper-arm stability during curl
  if (state.phase === 'concentric') {
    const shoulderChange = Math.abs(leftShoulder - (state.phaseStartAngles?.leftShoulder || leftShoulder));
    if (shoulderChange > 10) {
      return { message: "Keep your upper arms still—don't swing the bar.", priority: 1 };
    }
  }

  // Priority 2: Major form errors
  if (state.phase === 'start') {
    // Check start position
    const meanElbow = (leftElbow + rightElbow) / 2;
    if (meanElbow < 165) {
      return { message: "Start with your arms fully extended at your sides.", priority: 2 };
    }
    
    // Check symmetry
    const elbowDiff = Math.abs(leftElbow - rightElbow);
    const shoulderDiff = Math.abs(leftShoulder - rightShoulder);
    if (elbowDiff > 6 || shoulderDiff > 6) {
      return { message: "Set both arms evenly before curling.", priority: 2 };
    }
  }

  if (state.phase === 'top') {
    // Check top contraction
    const meanElbow = (leftElbow + rightElbow) / 2;
    if (meanElbow > 75) {
      return { message: "Curl the bar higher and squeeze at the top.", priority: 2 };
    }
    
    // Check top symmetry
    const elbowDiff = Math.abs(leftElbow - rightElbow);
    if (elbowDiff > 7) {
      return { message: "Curl evenly with both arms.", priority: 2 };
    }
  }

  // Priority 3: Performance cues
  if (state.phase === 'concentric') {
    const phaseDuration = (currentTime - state.phaseStartTime) / 1000;
    if (phaseDuration < 0.5 && phaseDuration > 0.2) {
      return { message: "Curl the bar more slowly.", priority: 3 };
    }
  }

  if (state.phase === 'eccentric') {
    const phaseDuration = (currentTime - state.phaseStartTime) / 1000;
    if (phaseDuration < 0.8 && phaseDuration > 0.3) {
      return { message: "Lower the bar under control.", priority: 3 };
    }
  }

  return null;
}

/**
 * Calculate form score based on quality metrics
 */
function calculateFormScore(state: BarbellCurlState): number {
  // Weighting:
  // Range of motion: 30%
  // Upper-arm stability: 25%
  // Symmetry: 20%
  // Tempo control: 15%
  // Body stability: 10%
  
  const romScore = state.rangeOfMotion * 0.3;
  const stabilityScore = state.upperArmStability * 0.25;
  const symmetryScore = state.symmetry * 0.2;
  const tempoScore = state.tempoControl * 0.15;
  const bodyScore = state.bodyStability * 0.1;
  
  return Math.min(100, Math.max(0, romScore + stabilityScore + symmetryScore + tempoScore + bodyScore));
}

/**
 * Initialize barbell curl state
 */
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
    
    rangeOfMotion: 100,
    upperArmStability: 100,
    symmetry: 100,
    tempoControl: 100,
    bodyStability: 100,
  };
}

/**
 * Update barbell curl state based on current pose
 */
export function updateBarbellCurlState(
  keypoints: Keypoint[],
  currentState: BarbellCurlState
): BarbellCurlState {
  const angles = calculateJointAngles(keypoints);
  const currentTime = Date.now();

  // Log angles for debugging
  if (angles.leftElbow !== null || angles.rightElbow !== null) {
    console.log('[Barbell Curl] Angles:', {
      leftElbow: angles.leftElbow?.toFixed(1),
      rightElbow: angles.rightElbow?.toFixed(1),
      leftShoulder: angles.leftShoulder?.toFixed(1),
      rightShoulder: angles.rightShoulder?.toFixed(1),
    });
  }

  // Always update angles in state for debugging, even if classification fails
  const newState = { 
    ...currentState,
    leftElbowAngle: angles.leftElbow,
    rightElbowAngle: angles.rightElbow,
    leftShoulderAngle: angles.leftShoulder,
    rightShoulderAngle: angles.rightShoulder,
    leftHipAngle: angles.leftHip,
    rightHipAngle: angles.rightHip,
    leftKneeAngle: angles.leftKnee,
    rightKneeAngle: angles.rightKnee,
  };

  // Check if this is a valid barbell curl pose
  if (!classifyExercise(angles)) {
    return { ...newState, feedback: null };
  }

  const { leftElbow, rightElbow, leftShoulder, rightShoulder } = angles;

  // Use whichever elbow is visible, prefer average if both visible
  let meanElbow: number;
  if (leftElbow !== null && rightElbow !== null) {
    meanElbow = (leftElbow + rightElbow) / 2;
  } else if (leftElbow !== null) {
    meanElbow = leftElbow;
  } else if (rightElbow !== null) {
    meanElbow = rightElbow;
  } else {
    return newState;
  }

  // Update current angles (already done above, but keeping for consistency)
  newState.leftElbowAngle = leftElbow;
  newState.rightElbowAngle = rightElbow;
  newState.leftShoulderAngle = leftShoulder;
  newState.rightShoulderAngle = rightShoulder;
  newState.leftHipAngle = angles.leftHip;
  newState.rightHipAngle = angles.rightHip;
  newState.leftKneeAngle = angles.leftKnee;
  newState.rightKneeAngle = angles.rightKnee;

  console.log(`[Barbell Curl] Phase: ${currentState.phase}, Mean Elbow: ${meanElbow.toFixed(1)}°, Reps: ${currentState.repCount}`);

  // Phase transitions
  if (currentState.phase === 'idle') {
    // Looking for start position (arms extended) - only from idle, not from eccentric!
    console.log(`[Barbell Curl] Checking start position from IDLE: meanElbow=${meanElbow.toFixed(1)}, threshold=150`);
    if (meanElbow >= 150) {
      console.log('[Barbell Curl] ✓ Entering START phase from IDLE');
      newState.phase = 'start';
      newState.phaseStartTime = currentTime;
      newState.phaseStartAngles = {
        leftElbow: leftElbow || 180,
        rightElbow: rightElbow || 180,
        leftShoulder: leftShoulder || 180,
        rightShoulder: rightShoulder || 180,
      };
    }
  } else if (currentState.phase === 'start') {
    // Looking for concentric phase (elbow flexion starts)
    console.log(`[Barbell Curl] Checking concentric: meanElbow=${meanElbow.toFixed(1)}, threshold=145`);
    if (meanElbow < 145) {
      console.log('[Barbell Curl] ✓ Entering CONCENTRIC phase');
      newState.phase = 'concentric';
      newState.phaseStartTime = currentTime;
    }
  } else if (currentState.phase === 'concentric') {
    // Looking for top position (maximum flexion)
    console.log(`[Barbell Curl] Checking top: meanElbow=${meanElbow.toFixed(1)}, threshold=80`);
    if (meanElbow <= 80) {
      console.log('[Barbell Curl] ✓ Entering TOP phase');
      newState.phase = 'top';
      newState.phaseStartTime = currentTime;

      // Calculate range of motion score
      const startElbow = currentState.phaseStartAngles?.leftElbow || 180;
      const rom = startElbow - meanElbow;
      newState.rangeOfMotion = Math.min(100, (rom / 110) * 100); // 110° is ideal ROM
    }
  } else if (currentState.phase === 'top') {
    // Looking for eccentric phase (elbow extension starts)
    const phaseDuration = (currentTime - currentState.phaseStartTime) / 1000;
    console.log(`[Barbell Curl] Checking eccentric: meanElbow=${meanElbow.toFixed(1)}, duration=${phaseDuration.toFixed(2)}s, threshold=85`);
    if (phaseDuration > 0.15 && meanElbow > 85) {
      console.log('[Barbell Curl] ✓ Entering ECCENTRIC phase');
      newState.phase = 'eccentric';
      newState.phaseStartTime = currentTime;
    }
  } else if (currentState.phase === 'eccentric') {
    // Looking for completion (back to start position)
    console.log(`[Barbell Curl] Checking completion: meanElbow=${meanElbow.toFixed(1)}, threshold=150`);
    if (meanElbow >= 150) {
      // Rep completed!
      console.log('[Barbell Curl] ✓✓✓ REP COMPLETED! ✓✓✓');
      newState.repCount = currentState.repCount + 1;
      newState.formScore = calculateFormScore(currentState);
      newState.phase = 'start';
      newState.phaseStartTime = currentTime;
      newState.phaseStartAngles = {
        leftElbow: leftElbow || 180,
        rightElbow: rightElbow || 180,
        leftShoulder: leftShoulder || 180,
        rightShoulder: rightShoulder || 180,
      };

      // Reset quality metrics for next rep
      newState.rangeOfMotion = 100;
      newState.upperArmStability = 100;
      newState.symmetry = 100;
      newState.tempoControl = 100;
      newState.bodyStability = 100;
    }
  }

  // Generate feedback
  const feedbackResult = generateFeedback(newState, angles, currentTime);
  if (feedbackResult) {
    console.log(`[Barbell Curl] Feedback: ${feedbackResult.message}`);
    newState.feedback = feedbackResult.message;
    newState.lastFeedbackTime = currentTime;
  } else if (currentTime - newState.lastFeedbackTime > FEEDBACK_DURATION_MS) {
    // Clear old feedback
    newState.feedback = null;
  }

  return newState;
}
