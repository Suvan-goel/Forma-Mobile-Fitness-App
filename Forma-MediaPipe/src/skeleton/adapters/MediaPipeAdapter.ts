import type { Keypoint } from '../../utils/poseAnalysis';
import { CANONICAL_JOINTS, CanonicalJoint } from '../CanonicalJoint';
import type { Joint2D, Joint3D, SkeletonFrame, SkeletonViewHint } from '../SkeletonFrame';

const MEDIAPIPE_NAME_BY_CANONICAL: Partial<Record<CanonicalJoint, string>> = {
  [CanonicalJoint.HEAD]: 'nose',
  [CanonicalJoint.LEFT_SHOULDER]: 'left_shoulder',
  [CanonicalJoint.RIGHT_SHOULDER]: 'right_shoulder',
  [CanonicalJoint.LEFT_ELBOW]: 'left_elbow',
  [CanonicalJoint.RIGHT_ELBOW]: 'right_elbow',
  [CanonicalJoint.LEFT_WRIST]: 'left_wrist',
  [CanonicalJoint.RIGHT_WRIST]: 'right_wrist',
  [CanonicalJoint.LEFT_HIP]: 'left_hip',
  [CanonicalJoint.RIGHT_HIP]: 'right_hip',
  [CanonicalJoint.LEFT_KNEE]: 'left_knee',
  [CanonicalJoint.RIGHT_KNEE]: 'right_knee',
  [CanonicalJoint.LEFT_ANKLE]: 'left_ankle',
  [CanonicalJoint.RIGHT_ANKLE]: 'right_ankle',
  [CanonicalJoint.LEFT_FOOT]: 'left_foot_index',
  [CanonicalJoint.RIGHT_FOOT]: 'right_foot_index',
};

export interface MediaPipeAdapter {
  update(keypoints: Keypoint[], timestamp?: number, viewHint?: SkeletonViewHint): SkeletonFrame;
}

function createJoint3D(isSynthetic: boolean): Joint3D {
  return { x: 0, y: 0, z: 0, confidence: 0, isSynthetic };
}

function createJoint2D(): Joint2D {
  return { x: 0, y: 0, confidence: 0 };
}

function createEmptyFrame(): SkeletonFrame {
  const joints = {} as Record<CanonicalJoint, Joint3D>;
  const joints2D = {} as Record<CanonicalJoint, Joint2D>;

  for (const joint of CANONICAL_JOINTS) {
    const isSynthetic =
      joint === CanonicalJoint.NECK ||
      joint === CanonicalJoint.CHEST_CENTER ||
      joint === CanonicalJoint.PELVIS_CENTER;
    joints[joint] = createJoint3D(isSynthetic);
    joints2D[joint] = createJoint2D();
  }

  return {
    joints,
    joints2D,
    profile: null,
    source: 'mediapipe',
    sourceQuality: 'image_only',
    timestamp: 0,
    viewHint: 'unknown',
    globalConfidence: 0,
  };
}

function setDirectJoint(
  target3D: Joint3D,
  target2D: Joint2D,
  keypoint: Keypoint | undefined,
  pelvis: Keypoint | null
): number {
  if (!keypoint) {
    target3D.x = 0;
    target3D.y = 0;
    target3D.z = 0;
    target3D.confidence = 0;
    target2D.x = 0;
    target2D.y = 0;
    target2D.confidence = 0;
    return 0;
  }

  const pelvisX = pelvis?.x ?? 0;
  const pelvisY = pelvis?.y ?? 0;
  const pelvisZ = pelvis?.z ?? 0;
  const z = keypoint.z ?? 0;

  target3D.x = keypoint.x - pelvisX;
  target3D.y = -(keypoint.y - pelvisY);
  target3D.z = z - pelvisZ;
  target3D.confidence = keypoint.score;
  target2D.x = keypoint.x;
  target2D.y = keypoint.y;
  target2D.confidence = keypoint.score;

  return keypoint.score;
}

function setMidpoint3D(target: Joint3D, a: Joint3D, b: Joint3D): void {
  target.x = (a.x + b.x) / 2;
  target.y = (a.y + b.y) / 2;
  target.z = (a.z + b.z) / 2;
  target.confidence = Math.min(a.confidence, b.confidence);
}

function setMidpoint2D(target: Joint2D, a: Joint2D, b: Joint2D): void {
  target.x = (a.x + b.x) / 2;
  target.y = (a.y + b.y) / 2;
  target.confidence = Math.min(a.confidence, b.confidence);
}

export function createMediaPipeAdapter(): MediaPipeAdapter {
  const frame = createEmptyFrame();
  const keypointByName = new Map<string, Keypoint>();

  return {
    update(keypoints: Keypoint[], timestamp = Date.now(), viewHint = 'unknown') {
      keypointByName.clear();
      let confidenceSum = 0;
      let confidenceCount = 0;

      for (const keypoint of keypoints) {
        keypointByName.set(keypoint.name, keypoint);
      }

      const leftHip = keypointByName.get('left_hip');
      const rightHip = keypointByName.get('right_hip');
      const pelvis = leftHip && rightHip
        ? {
            name: 'pelvis_center',
            x: (leftHip.x + rightHip.x) / 2,
            y: (leftHip.y + rightHip.y) / 2,
            z: ((leftHip.z ?? 0) + (rightHip.z ?? 0)) / 2,
            score: Math.min(leftHip.score, rightHip.score),
          }
        : null;

      for (const joint of CANONICAL_JOINTS) {
        const mediapipeName = MEDIAPIPE_NAME_BY_CANONICAL[joint];
        if (!mediapipeName) continue;
        const confidence = setDirectJoint(
          frame.joints[joint],
          frame.joints2D[joint],
          keypointByName.get(mediapipeName),
          pelvis
        );
        confidenceSum += confidence;
        confidenceCount += 1;
      }

      setMidpoint3D(frame.joints[CanonicalJoint.PELVIS_CENTER], frame.joints[CanonicalJoint.LEFT_HIP], frame.joints[CanonicalJoint.RIGHT_HIP]);
      setMidpoint2D(frame.joints2D[CanonicalJoint.PELVIS_CENTER], frame.joints2D[CanonicalJoint.LEFT_HIP], frame.joints2D[CanonicalJoint.RIGHT_HIP]);
      setMidpoint3D(frame.joints[CanonicalJoint.NECK], frame.joints[CanonicalJoint.LEFT_SHOULDER], frame.joints[CanonicalJoint.RIGHT_SHOULDER]);
      setMidpoint2D(frame.joints2D[CanonicalJoint.NECK], frame.joints2D[CanonicalJoint.LEFT_SHOULDER], frame.joints2D[CanonicalJoint.RIGHT_SHOULDER]);
      setMidpoint3D(frame.joints[CanonicalJoint.CHEST_CENTER], frame.joints[CanonicalJoint.LEFT_SHOULDER], frame.joints[CanonicalJoint.RIGHT_SHOULDER]);
      setMidpoint2D(frame.joints2D[CanonicalJoint.CHEST_CENTER], frame.joints2D[CanonicalJoint.LEFT_SHOULDER], frame.joints2D[CanonicalJoint.RIGHT_SHOULDER]);

      frame.timestamp = timestamp;
      frame.viewHint = viewHint;
      frame.globalConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;

      return frame;
    },
  };
}
