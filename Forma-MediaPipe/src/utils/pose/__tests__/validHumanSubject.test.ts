import type { Keypoint } from '../../poseAnalysis';
import { buildPoseState } from '../buildPoseState';
import {
  ValidHumanSubjectTracker,
  evaluateValidHumanSubject,
} from '../validHumanSubject';

const MAJOR_JOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

const BASE_POINTS: Record<string, Pick<Keypoint, 'x' | 'y' | 'z'>> = {
  left_shoulder: { x: 0.42, y: 0.24, z: 0 },
  right_shoulder: { x: 0.58, y: 0.24, z: 0 },
  left_elbow: { x: 0.37, y: 0.38, z: 0 },
  right_elbow: { x: 0.63, y: 0.38, z: 0 },
  left_wrist: { x: 0.34, y: 0.52, z: 0 },
  right_wrist: { x: 0.66, y: 0.52, z: 0 },
  left_hip: { x: 0.44, y: 0.52, z: 0 },
  right_hip: { x: 0.56, y: 0.52, z: 0 },
  left_knee: { x: 0.44, y: 0.72, z: 0 },
  right_knee: { x: 0.56, y: 0.72, z: 0 },
  left_ankle: { x: 0.44, y: 0.9, z: 0 },
  right_ankle: { x: 0.56, y: 0.9, z: 0 },
};

function keypoints(overrides: Partial<Record<string, Partial<Keypoint>>> = {}): Keypoint[] {
  return MAJOR_JOINTS.map((name) => ({
    name,
    score: 0.99,
    ...BASE_POINTS[name],
    ...overrides[name],
  }));
}

function poseState(frameKeypoints: Keypoint[]) {
  return buildPoseState({
    status: frameKeypoints.length > 0 ? 'ok' : 'trackingLost',
    keypoints: frameKeypoints,
    worldKeypoints: undefined,
    imageKeypoints: frameKeypoints,
    primarySource: 'image',
    timestampMs: 1000,
    metadata: {},
    diagnostics: {},
  } as any);
}

describe('valid human subject status helper', () => {
  it('treats a normal one-limb occlusion as a valid subject', () => {
    const frameKeypoints = keypoints({
      left_elbow: { score: 0 },
      left_wrist: { score: 0 },
    });
    const result = evaluateValidHumanSubject({
      poseState: poseState(frameKeypoints),
      imageKeypoints: frameKeypoints,
    });

    expect(result.valid).toBe(true);
    expect(result.usableChains).toEqual(expect.arrayContaining(['torso', 'rightArm']));
  });

  it('rejects collapsed object-like poses', () => {
    const frameKeypoints = keypoints(Object.fromEntries(
      MAJOR_JOINTS.map((name) => [name, { x: 0.5, y: 0.5, z: 0 }]),
    ));
    const result = evaluateValidHumanSubject({
      poseState: poseState(frameKeypoints),
      imageKeypoints: frameKeypoints,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('subject_too_small');
  });

  it('requires sustained invalid frames before reporting sustained invalidity', () => {
    const tracker = new ValidHumanSubjectTracker({ invalidFrameThreshold: 3 });
    const invalid = evaluateValidHumanSubject({
      poseState: poseState(keypoints(Object.fromEntries(
        MAJOR_JOINTS.map((name) => [name, { x: 0.5, y: 0.5, z: 0 }]),
      ))),
      imageKeypoints: keypoints(Object.fromEntries(
        MAJOR_JOINTS.map((name) => [name, { x: 0.5, y: 0.5, z: 0 }]),
      )),
    });

    expect(tracker.update(invalid).sustainedInvalid).toBe(false);
    expect(tracker.update(invalid).sustainedInvalid).toBe(false);
    expect(tracker.update(invalid).sustainedInvalid).toBe(true);
  });

  it('clears invalid history after stable valid frames', () => {
    const tracker = new ValidHumanSubjectTracker({
      invalidFrameThreshold: 3,
      validFrameThreshold: 2,
    });
    const invalid = evaluateValidHumanSubject({
      poseState: poseState([]),
      imageKeypoints: [],
    });
    const valid = evaluateValidHumanSubject({
      poseState: poseState(keypoints()),
      imageKeypoints: keypoints(),
    });

    tracker.update(invalid);
    tracker.update(invalid);
    expect(tracker.update(valid).invalidFrameCount).toBe(2);
    expect(tracker.update(valid).invalidFrameCount).toBe(0);
  });
});
