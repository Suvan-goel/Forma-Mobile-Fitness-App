/**
 * Pose Analysis Utilities
 * 
 * Provides functions for analyzing pose keypoints to detect exercises and count reps.
 * Updated for MediaPipe Pose Full model (33 landmarks)
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
 * Calculate angle between three points (in degrees) - optimized
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
  // Optimized: pre-compute differences
  const dx1 = a.x - b.x;
  const dy1 = a.y - b.y;
  const dx2 = c.x - b.x;
  const dy2 = c.y - b.y;
  
  const radians = Math.atan2(dy2, dx2) - Math.atan2(dy1, dx1);
  let angle = Math.abs(radians * 57.29577951308232); // 180/PI pre-calculated

  if (angle > 180.0) {
    angle = 360 - angle;
  }

  return angle;
}

/**
 * Get keypoint by name from array
 * Works with both MoveNet (17) and MediaPipe (33) keypoint arrays
 */
export function getKeypoint(keypoints: Keypoint[], name: string): Keypoint | null {
  return keypoints.find(kp => kp.name === name) || null;
}

/**
 * Check if keypoint is visible (confidence > threshold)
 * MediaPipe uses visibility scores (0-1), lower threshold for better detection
 * Optimized inline for performance
 */
export function isVisible(keypoint: Keypoint | null, threshold = 0.8): boolean {
  return keypoint !== null && keypoint.score > threshold;
}

/**
 * Calculate torso height with caching to avoid redundant computation
 */
function getTorsoHeight(keypoints: Keypoint[]): number {
  const now = Date.now();
  
  // Return cached value if still valid
  if (now - geometryCache.lastUpdate < geometryCache.CACHE_DURATION) {
    return geometryCache.torsoHeight;
  }
  
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const leftHip = getKeypoint(keypoints, 'left_hip');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');
  const rightHip = getKeypoint(keypoints, 'right_hip');
  
  let torsoHeight = 200; // Default fallback
  
  if (isVisible(leftShoulder, 0.2) && isVisible(leftHip, 0.2)) {
    torsoHeight = Math.abs(leftHip!.y - leftShoulder!.y);
  } else if (isVisible(rightShoulder, 0.2) && isVisible(rightHip, 0.2)) {
    torsoHeight = Math.abs(rightHip!.y - rightShoulder!.y);
  }
  
  // Update cache
  geometryCache.torsoHeight = torsoHeight;
  geometryCache.lastUpdate = now;
  
  return torsoHeight;
}

// Store smoothed angles for stable detection
let smoothedLeftElbowAngle: number | null = null;
let smoothedRightElbowAngle: number | null = null;
let smoothedPushupAngle: number | null = null;
let smoothedSquatAngle: number | null = null;
const ANGLE_SMOOTHING = 0.1; // Reduced from 0.15 - even faster response for minimal lag (90% current, 10% previous)

// Cache for calculated values to avoid redundant computation
const geometryCache = {
  torsoHeight: 200,
  lastUpdate: 0,
  CACHE_DURATION: 100, // Cache torso height for 100ms
};

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

  // Use cached torso height for relative measurements (scale-independent)
  const torsoHeight = getTorsoHeight(keypoints);
  
  // Use relative thresholds based on torso size
  const elbowTolerance = torsoHeight * 0.3; // 30% of torso height
  const sideWidthTolerance = torsoHeight * 0.8; // 80% of torso height

  // Check left arm bicep curl (Thunder model provides better keypoint quality)
  if (isVisible(leftShoulder, 0.25) && isVisible(leftElbow, 0.25) && isVisible(leftWrist, 0.25)) {
    const rawAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
    
    // Smooth the angle to reduce noise
    if (smoothedLeftElbowAngle === null) {
      smoothedLeftElbowAngle = rawAngle;
    } else {
      smoothedLeftElbowAngle = smoothedLeftElbowAngle * ANGLE_SMOOTHING + rawAngle * (1 - ANGLE_SMOOTHING);
    }
    const angle = smoothedLeftElbowAngle;
    
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
    smoothedLeftElbowAngle = null; // Reset if keypoints not visible
  }

  // Check right arm bicep curl
  if (isVisible(rightShoulder, 0.25) && isVisible(rightElbow, 0.25) && isVisible(rightWrist, 0.25)) {
    const rawAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
    
    // Smooth the angle
    if (smoothedRightElbowAngle === null) {
      smoothedRightElbowAngle = rawAngle;
    } else {
      smoothedRightElbowAngle = smoothedRightElbowAngle * ANGLE_SMOOTHING + rawAngle * (1 - ANGLE_SMOOTHING);
    }
    const angle = smoothedRightElbowAngle;
    
    const elbowBelowShoulder = rightElbow.y >= rightShoulder.y - elbowTolerance;
    const elbowAtSide = Math.abs(rightElbow.x - rightShoulder.x) < sideWidthTolerance;
    const validAngleRange = angle >= 20 && angle <= 175;
    
    if (elbowBelowShoulder && elbowAtSide && validAngleRange) {
      rightCurl = true;
      rightAngle = angle;
    }
  } else {
    smoothedRightElbowAngle = null; // Reset if keypoints not visible
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
    smoothedPushupAngle = null;
    return { detected: false, angle: null };
  }

  // Calculate arm angles
  const leftArmAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
  const rightArmAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
  const rawAngle = (leftArmAngle + rightArmAngle) / 2;
  
  // Smooth the angle
  if (smoothedPushupAngle === null) {
    smoothedPushupAngle = rawAngle;
  } else {
    smoothedPushupAngle = smoothedPushupAngle * ANGLE_SMOOTHING + rawAngle * (1 - ANGLE_SMOOTHING);
  }
  const avgArmAngle = smoothedPushupAngle;

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
    smoothedSquatAngle = null;
    return { detected: false, angle: null };
  }

  // Calculate knee angles
  const leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  const rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
  const rawAngle = (leftKneeAngle + rightKneeAngle) / 2;
  
  // Smooth the angle
  if (smoothedSquatAngle === null) {
    smoothedSquatAngle = rawAngle;
  } else {
    smoothedSquatAngle = smoothedSquatAngle * ANGLE_SMOOTHING + rawAngle * (1 - ANGLE_SMOOTHING);
  }
  const avgKneeAngle = smoothedSquatAngle;

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

// Track exercise detection stability
let exerciseDetectionHistory: string[] = [];
const DETECTION_HISTORY_SIZE = 2; // Reduced from 3 - fastest detection response (requires 2/2 consensus)

/**
 * Detect current exercise based on pose keypoints
 * Uses temporal consistency to avoid flickering between exercises
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
  // If multiple exercises detected, use alphabetical order for consistent tie-breaking
  // This ensures no exercise has priority over others
  let currentExercise: string | null = null;
  let angle: number | null = null;
  
  if (detectedExercises.length > 0) {
    // Sort alphabetically for consistent tie-breaking (Bicep Curl, Push-up, Squat)
    detectedExercises.sort((a, b) => a.name.localeCompare(b.name));
    currentExercise = detectedExercises[0].name;
    angle = detectedExercises[0].angle;
  }

  // Add to history
  exerciseDetectionHistory.push(currentExercise || 'none');
  if (exerciseDetectionHistory.length > DETECTION_HISTORY_SIZE) {
    exerciseDetectionHistory.shift();
  }

  // Use majority vote from recent history for stable detection
  const counts: Record<string, number> = {};
  for (const ex of exerciseDetectionHistory) {
    counts[ex] = (counts[ex] || 0) + 1;
  }
  
  let stableExercise: 'Bicep Curl' | 'Push-up' | 'Squat' | null = null;
  let maxCount = 0;
  for (const [ex, count] of Object.entries(counts)) {
    if (count > maxCount && ex !== 'none') {
      maxCount = count;
      stableExercise = ex as 'Bicep Curl' | 'Push-up' | 'Squat';
    }
  }

  // Require at least 2 out of 2 frames to confirm exercise (immediate response)
  if (maxCount < 2) {
    stableExercise = null;
  }

  // Return the angle from current frame if exercise matches stable detection
  if (stableExercise === currentExercise) {
    return { exercise: stableExercise, confidence: 0.85, angle };
  } else if (stableExercise) {
    // Return stable exercise but with angle from matching detector
    const matchingAngle = 
      stableExercise === 'Bicep Curl' ? bicepCurl.angle :
      stableExercise === 'Squat' ? squat.angle :
      stableExercise === 'Push-up' ? pushup.angle : null;
    return { exercise: stableExercise, confidence: 0.80, angle: matchingAngle };
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
