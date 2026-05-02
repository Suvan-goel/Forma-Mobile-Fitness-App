import type { Keypoint } from '../../../utils/poseAnalysis';
import { CANONICAL_JOINTS, CanonicalJoint } from '../../CanonicalJoint';
import { createMediaPipeAdapter } from '../MediaPipeAdapter';
import type { SkeletonFrame } from '../../SkeletonFrame';

const MEDIAPIPE_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
  'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee',
  'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index',
];

function makeKeypoints(): Keypoint[] {
  return MEDIAPIPE_NAMES.map((name, index) => ({
    name,
    x: index * 0.01,
    y: index * 0.02,
    z: index * -0.03,
    score: 0.5 + index * 0.01,
  }));
}

function cloneFrame(frame: SkeletonFrame): SkeletonFrame {
  return JSON.parse(JSON.stringify(frame)) as SkeletonFrame;
}

describe('MediaPipeAdapter', () => {
  it('maps every canonical joint and synthesizes midpoint joints', () => {
    const adapter = createMediaPipeAdapter();
    const frame = adapter.update(makeKeypoints(), 1234);

    for (const joint of CANONICAL_JOINTS) {
      expect(frame.joints[joint]).toBeDefined();
      expect(frame.joints2D[joint]).toBeDefined();
    }

    const midpointCases = [
      [CanonicalJoint.PELVIS_CENTER, CanonicalJoint.LEFT_HIP, CanonicalJoint.RIGHT_HIP],
      [CanonicalJoint.NECK, CanonicalJoint.LEFT_SHOULDER, CanonicalJoint.RIGHT_SHOULDER],
      [CanonicalJoint.CHEST_CENTER, CanonicalJoint.LEFT_SHOULDER, CanonicalJoint.RIGHT_SHOULDER],
    ] as const;

    for (const [target, a, b] of midpointCases) {
      expect(frame.joints[target].x).toBeCloseTo((frame.joints[a].x + frame.joints[b].x) / 2, 12);
      expect(frame.joints[target].y).toBeCloseTo((frame.joints[a].y + frame.joints[b].y) / 2, 12);
      expect(frame.joints[target].z).toBeCloseTo((frame.joints[a].z + frame.joints[b].z) / 2, 12);
      expect(frame.joints[target].confidence).toBeCloseTo(
        Math.min(frame.joints[a].confidence, frame.joints[b].confidence),
        12
      );
    }
  });

  it('reuses a pooled frame without leaking prior values', () => {
    const adapter = createMediaPipeAdapter();
    const keypoints = makeKeypoints();
    const firstFrame = adapter.update(keypoints, 1000);
    const firstSnapshot = cloneFrame(firstFrame);
    const secondFrame = adapter.update(keypoints, 1000);
    const secondSnapshot = cloneFrame(secondFrame);

    expect(secondFrame).toBe(firstFrame);
    expect(secondSnapshot).toEqual(firstSnapshot);
  });
});
