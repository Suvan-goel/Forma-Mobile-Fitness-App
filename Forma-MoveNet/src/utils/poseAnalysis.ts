/**
 * Pose Analysis Utilities
 * 
 * Provides functions for analyzing pose keypoints to detect exercises and count reps.
 */

export type Keypoint = {
  name: string;
  x: number;
  y: number;
  score: number;
};

export type ExerciseState = {
  name: string | null;
  repCount: number;
  phase: 'up' | 'down' | 'idle';
  lastPhaseChange: number;
};

/**
 * Calculate angle between three points (in degrees)
 * @param a First point (e.g., shoulder)
 * @param b Middle point (e.g., elbow) - the vertex of the angle
 * @param c Third point (e.g., wrist)
 * @returns Angle in degrees (0-180)
 */
export function calculateAngle(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);

  if (angle > 180.0) {
    angle = 360 - angle;
  }

  return angle;
}

/**
 * Get keypoint by name from array
 */
export function getKeypoint(keypoints: Keypoint[], name: string): Keypoint | null {
  return keypoints.find(kp => kp.name === name) || null;
}

/**
 * Check if keypoint is visible (confidence > threshold)
 * Thunder Quantized provides good confidence scores
 */
export function isVisible(keypoint: Keypoint | null, threshold = 0.25): boolean {
  return keypoint !== null && keypoint.score > threshold;
}

// Adaptive angle smoothing for stable detection
let lastLeftElbowAngle: number | null = null;
let lastRightElbowAngle: number | null = null;
let lastPushupAngle: number | null = null;
let lastSquatAngle: number | null = null;

// Lightweight smoothing: only 10% to maintain responsiveness
const ANGLE_SMOOTHING = 0.10;

/**
 * Detect if person is doing bicep curls
 * Uses relative positioning (not fixed pixels) for scale-independence
 * Applies angle smoothing for stable detection
 */
export function detectBicepCurl(keypoints: Keypoint[]): {
  detected: boolean;
  side: 'left' | 'right' | 'both' | null;
  angle: number | null;
} {
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const leftElbow = getKeypoint(keypoints, 'left_elbow');
  const leftWrist = getKeypoint(keypoints, 'left_wrist');
  const leftHip = getKeypoint(keypoints, 'left_hip');
  
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');
  const rightElbow = getKeypoint(keypoints, 'right_elbow');
  const rightWrist = getKeypoint(keypoints, 'right_wrist');
  const rightHip = getKeypoint(keypoints, 'right_hip');

  let leftCurl = false;
  let rightCurl = false;
  let leftAngle: number | null = null;
  let rightAngle: number | null = null;

  // Calculate torso height for relative measurements (scale-independent)
  let torsoHeight = 200; // Default fallback
  if (isVisible(leftShoulder, 0.2) && isVisible(leftHip, 0.2)) {
    torsoHeight = Math.abs(leftHip.y - leftShoulder.y);
  } else if (isVisible(rightShoulder, 0.2) && isVisible(rightHip, 0.2)) {
    torsoHeight = Math.abs(rightHip.y - rightShoulder.y);
  }
  
  // Use relative thresholds based on torso size
  const elbowTolerance = torsoHeight * 0.35; // Slightly relaxed for better detection
  const sideWidthTolerance = torsoHeight * 0.85; // Slightly wider tolerance

  // Check left arm bicep curl (Thunder Quantized provides excellent accuracy)
  if (isVisible(leftShoulder, 0.15) && isVisible(leftElbow, 0.15) && isVisible(leftWrist, 0.15)) {
    const rawAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
    
    // Light smoothing for stability without sacrificing responsiveness
    const angle = lastLeftElbowAngle !== null
      ? lastLeftElbowAngle * ANGLE_SMOOTHING + rawAngle * (1 - ANGLE_SMOOTHING)
      : rawAngle;
    lastLeftElbowAngle = angle;
    
    // Bicep curl characteristics (using relative measurements):
    // 1. Elbow below or near shoulder level (not overhead press)
    // 2. Elbow above hip level (standing position)
    // 3. Elbow relatively close to body (not lateral raise)
    
    const elbowBelowShoulder = leftElbow.y >= leftShoulder.y - elbowTolerance;
    const elbowAtSide = Math.abs(leftElbow.x - leftShoulder.x) < sideWidthTolerance;
    
    // Relaxed angle range for better detection
    const validAngleRange = angle >= 20 && angle <= 175;
    
    if (elbowBelowShoulder && elbowAtSide && validAngleRange) {
      leftCurl = true;
      leftAngle = angle;
    }
  } else {
    lastLeftElbowAngle = null;
  }

  // Check right arm bicep curl
  if (isVisible(rightShoulder, 0.15) && isVisible(rightElbow, 0.15) && isVisible(rightWrist, 0.15)) {
    const rawAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
    
    // Light smoothing for stability
    const angle = lastRightElbowAngle !== null
      ? lastRightElbowAngle * ANGLE_SMOOTHING + rawAngle * (1 - ANGLE_SMOOTHING)
      : rawAngle;
    lastRightElbowAngle = angle;
    
    const elbowBelowShoulder = rightElbow.y >= rightShoulder.y - elbowTolerance;
    const elbowAtSide = Math.abs(rightElbow.x - rightShoulder.x) < sideWidthTolerance;
    const validAngleRange = angle >= 20 && angle <= 175;
    
    if (elbowBelowShoulder && elbowAtSide && validAngleRange) {
      rightCurl = true;
      rightAngle = angle;
    }
  } else {
    lastRightElbowAngle = null;
  }

  const detected = leftCurl || rightCurl;
  const side = leftCurl && rightCurl ? 'both' : leftCurl ? 'left' : rightCurl ? 'right' : null;
  
  // Use average angle if both arms detected, otherwise use whichever is available
  let angle: number | null = null;
  if (leftAngle !== null && rightAngle !== null) {
    angle = (leftAngle + rightAngle) / 2;
  } else if (leftAngle !== null) {
    angle = leftAngle;
  } else if (rightAngle !== null) {
    angle = rightAngle;
  }

  return { detected, side, angle };
}

/**
 * Detect if person is doing push-ups
 * Looks for plank position with arm extension/flexion
 */
export function detectPushup(keypoints: Keypoint[]): {
  detected: boolean;
  angle: number | null;
} {
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const leftElbow = getKeypoint(keypoints, 'left_elbow');
  const leftWrist = getKeypoint(keypoints, 'left_wrist');
  const leftHip = getKeypoint(keypoints, 'left_hip');
  const leftKnee = getKeypoint(keypoints, 'left_knee');
  
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');
  const rightElbow = getKeypoint(keypoints, 'right_elbow');
  const rightWrist = getKeypoint(keypoints, 'right_wrist');
  const rightHip = getKeypoint(keypoints, 'right_hip');

  // Need to see upper body clearly
  if (!isVisible(leftShoulder) || !isVisible(leftElbow) || !isVisible(leftWrist) ||
      !isVisible(rightShoulder) || !isVisible(rightElbow) || !isVisible(rightWrist)) {
    lastPushupAngle = null;
    return { detected: false, angle: null };
  }

  // Calculate arm angles with light smoothing
  const leftArmAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
  const rightArmAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
  const rawAngle = (leftArmAngle + rightArmAngle) / 2;
  
  const avgArmAngle = lastPushupAngle !== null
    ? lastPushupAngle * ANGLE_SMOOTHING + rawAngle * (1 - ANGLE_SMOOTHING)
    : rawAngle;
  lastPushupAngle = avgArmAngle;

  // Push-up position checks:
  // 1. Body roughly horizontal (shoulders and hips at similar Y-level)
  // 2. Shoulders below or near hip level (plank position)
  // 3. Arms in valid range (50° to 180°)
  
  let isPlankPosition = false;
  
  if (isVisible(leftHip) && isVisible(rightHip)) {
    const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const avgHipY = (leftHip.y + rightHip.y) / 2;
    
    // In push-up, shoulders are at or below hip level
    const shouldersAtHipLevel = avgShoulderY >= avgHipY - 100;
    
    // Body should be roughly horizontal (not too much vertical distance)
    const bodyHorizontal = Math.abs(avgShoulderY - avgHipY) < 200;
    
    // Check knees if visible - should be in line with body (not bent at 90°)
    let kneesExtended = true;
    if (isVisible(leftKnee)) {
      kneesExtended = leftKnee.y >= leftHip.y - 50; // Knees not pulled up
    }
    
    isPlankPosition = shouldersAtHipLevel && bodyHorizontal && kneesExtended;
  }

  // Valid push-up if in plank position with appropriate arm angle
  const detected = isPlankPosition && avgArmAngle > 50 && avgArmAngle < 180;

  return { detected, angle: detected ? avgArmAngle : null };
}

/**
 * Detect if person is doing squats
 * Looks for standing posture with knee bending motion
 */
export function detectSquat(keypoints: Keypoint[]): {
  detected: boolean;
  angle: number | null;
} {
  const leftHip = getKeypoint(keypoints, 'left_hip');
  const leftKnee = getKeypoint(keypoints, 'left_knee');
  const leftAnkle = getKeypoint(keypoints, 'left_ankle');
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  
  const rightHip = getKeypoint(keypoints, 'right_hip');
  const rightKnee = getKeypoint(keypoints, 'right_knee');
  const rightAnkle = getKeypoint(keypoints, 'right_ankle');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');

  // Need to see lower body
  if (!isVisible(leftHip) || !isVisible(leftKnee) || !isVisible(leftAnkle) ||
      !isVisible(rightHip) || !isVisible(rightKnee) || !isVisible(rightAnkle)) {
    lastSquatAngle = null;
    return { detected: false, angle: null };
  }

  // Calculate knee angles with light smoothing
  const leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  const rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
  const rawAngle = (leftKneeAngle + rightKneeAngle) / 2;
  
  const avgKneeAngle = lastSquatAngle !== null
    ? lastSquatAngle * ANGLE_SMOOTHING + rawAngle * (1 - ANGLE_SMOOTHING)
    : rawAngle;
  lastSquatAngle = avgKneeAngle;

  // Squat position checks:
  // 1. Upright posture (hips above knees, knees above ankles)
  // 2. Shoulders above hips (not bent forward like deadlift)
  // 3. Body vertical (not horizontal like push-up)
  
  const uprightPosture = 
    leftHip.y < leftKnee.y && 
    leftKnee.y < leftAnkle.y &&
    rightHip.y < rightKnee.y && 
    rightKnee.y < rightAnkle.y;
  
  // Check shoulders are above hips (standing, not lying)
  let verticalBody = true;
  if (isVisible(leftShoulder) && isVisible(rightShoulder)) {
    const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const avgHipY = (leftHip.y + rightHip.y) / 2;
    
    // Shoulders should be above hips in standing position
    verticalBody = avgShoulderY < avgHipY + 100;
  }

  // Squat detected if:
  // 1. Person is in upright standing posture
  // 2. Body is vertical (not horizontal)
  // 3. Knee angle between 60° (deep squat) and 175° (standing)
  const detected = uprightPosture && verticalBody && avgKneeAngle > 60 && avgKneeAngle < 175;

  return { detected, angle: detected ? avgKneeAngle : null };
}

// Minimal temporal consistency: 2-frame confirmation for stable detection
let exerciseDetectionHistory: string[] = [];
const DETECTION_HISTORY_SIZE = 2;

/**
 * Detect current exercise based on pose keypoints
 * Uses minimal temporal consistency (2 frames) for accuracy without sacrificing responsiveness
 */
export function detectExercise(keypoints: Keypoint[]): {
  exercise: 'Bicep Curl' | 'Push-up' | 'Squat' | null;
  confidence: number;
  angle: number | null;
} {
  // Check for each exercise type (all weighted equally)
  const bicepCurl = detectBicepCurl(keypoints);
  const pushup = detectPushup(keypoints);
  const squat = detectSquat(keypoints);

  // Collect all detected exercises
  const detectedExercises: Array<{
    name: 'Bicep Curl' | 'Push-up' | 'Squat';
    angle: number;
  }> = [];

  if (bicepCurl.detected && bicepCurl.angle !== null) {
    detectedExercises.push({ name: 'Bicep Curl', angle: bicepCurl.angle });
  }
  if (pushup.detected && pushup.angle !== null) {
    detectedExercises.push({ name: 'Push-up', angle: pushup.angle });
  }
  if (squat.detected && squat.angle !== null) {
    detectedExercises.push({ name: 'Squat', angle: squat.angle });
  }

  // Determine current frame's detection
  let currentExercise: string | null = null;
  let currentAngle: number | null = null;
  
  if (detectedExercises.length > 0) {
    // Sort alphabetically for consistent tie-breaking
    detectedExercises.sort((a, b) => a.name.localeCompare(b.name));
    currentExercise = detectedExercises[0].name;
    currentAngle = detectedExercises[0].angle;
  }

  // Add to history
  exerciseDetectionHistory.push(currentExercise || 'none');
  if (exerciseDetectionHistory.length > DETECTION_HISTORY_SIZE) {
    exerciseDetectionHistory.shift();
  }

  // Require 2 consecutive frames for confirmation (minimal but effective)
  if (exerciseDetectionHistory.length < DETECTION_HISTORY_SIZE) {
    return { exercise: null, confidence: 0, angle: null };
  }

  // Check for consistency in last 2 frames
  const lastTwo = exerciseDetectionHistory.slice(-2);
  if (lastTwo[0] === lastTwo[1] && lastTwo[0] !== 'none') {
    const stableExercise = lastTwo[0] as 'Bicep Curl' | 'Push-up' | 'Squat';
    
    // If current frame matches, use its angle; otherwise use matching detector
    if (currentExercise === stableExercise) {
      return { exercise: stableExercise, confidence: 0.90, angle: currentAngle };
    } else {
      // Get angle from the appropriate detector
      const matchingAngle = 
        stableExercise === 'Bicep Curl' ? bicepCurl.angle :
        stableExercise === 'Squat' ? squat.angle :
        stableExercise === 'Push-up' ? pushup.angle : null;
      return { exercise: stableExercise, confidence: 0.85, angle: matchingAngle };
    }
  }

  return { exercise: null, confidence: 0, angle: null };
}

/**
 * Count reps based on exercise-specific angle thresholds
 * Uses relaxed thresholds for reliable detection
 */
export function updateRepCount(
  exercise: string,
  angle: number,
  currentPhase: 'up' | 'down' | 'idle',
  currentRepCount: number
): {
  phase: 'up' | 'down' | 'idle';
  repCount: number;
  formScore: number;
} {
  let newPhase = currentPhase;
  let newRepCount = currentRepCount;
  let formScore = 85; // Default good form

  switch (exercise) {
    case 'Bicep Curl':
      // State machine for bicep curl rep counting
      // Relaxed thresholds for better detection:
      // Start position (extended): angle > 120° (was 135°)
      // Contracted position (curled): angle < 90° (was 70°)
      
      if (currentPhase === 'idle' || currentPhase === 'down') {
        // Waiting for arm to extend (start position)
        if (angle > 120) {
          newPhase = 'up'; // Arm is extended, ready for curl
        }
      }
      
      if (currentPhase === 'up') {
        // Arm is extended, waiting for curl (contraction)
        if (angle < 90) {
          newPhase = 'down'; // Curl completed
          newRepCount += 1; // Count the rep
          
          // Form score based on depth of curl (range of motion)
          // Better form = deeper curl (smaller angle)
          if (angle < 50) {
            formScore = 95; // Excellent - full contraction
          } else if (angle < 70) {
            formScore = 90; // Good - solid contraction
          } else {
            formScore = 80; // Acceptable - partial contraction
          }
        }
      }
      break;

    case 'Push-up':
      // State machine for push-up rep counting
      // Extended (up): angle > 140° (arms straight)
      // Bent (down): angle < 100° (chest near ground)
      
      if (currentPhase === 'idle' || currentPhase === 'down') {
        // Waiting for arms to extend
        if (angle > 140) {
          newPhase = 'up'; // Arms extended, ready to descend
        }
      }
      
      if (currentPhase === 'up') {
        // Arms extended, waiting for descent
        if (angle < 100) {
          newPhase = 'down'; // Push-up completed
          newRepCount += 1;
          
          // Form score based on depth (lower angle = deeper push-up)
          if (angle < 70) {
            formScore = 95; // Excellent - chest to ground
          } else if (angle < 85) {
            formScore = 90; // Good - deep push-up
          } else {
            formScore = 80; // Acceptable - partial depth
          }
        }
      }
      break;

    case 'Squat':
      // State machine for squat rep counting
      // Standing (up): angle > 150° (legs straight)
      // Squatting (down): angle < 120° (knees bent)
      
      if (currentPhase === 'idle' || currentPhase === 'down') {
        // Waiting for full standing position
        if (angle > 150) {
          newPhase = 'up'; // Standing, ready to squat
        }
      }
      
      if (currentPhase === 'up') {
        // Standing, waiting for squat
        if (angle < 120) {
          newPhase = 'down'; // Squat completed
          newRepCount += 1;
          
          // Form score based on depth (lower angle = deeper squat)
          if (angle < 90) {
            formScore = 95; // Excellent - parallel or below
          } else if (angle < 105) {
            formScore = 90; // Good - near parallel
          } else {
            formScore = 80; // Acceptable - partial squat
          }
        }
      }
      break;
  }

  return { phase: newPhase, repCount: newRepCount, formScore };
}
