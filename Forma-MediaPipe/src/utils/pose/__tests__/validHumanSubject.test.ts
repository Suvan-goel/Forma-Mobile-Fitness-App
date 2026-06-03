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

function transformedKeypoints(args: {
  offsetX?: number;
  offsetY?: number;
  scale?: number;
} = {}): Keypoint[] {
  const { offsetX = 0, offsetY = 0, scale = 1 } = args;
  return keypoints(Object.fromEntries(
    MAJOR_JOINTS.map((name) => {
      const base = BASE_POINTS[name];
      return [name, {
        x: 0.5 + (base.x - 0.5) * scale + offsetX,
        y: 0.55 + (base.y - 0.55) * scale + offsetY,
      }];
    }),
  ));
}

function validSubject(frameKeypoints: Keypoint[]) {
  return evaluateValidHumanSubject({
    poseState: poseState(frameKeypoints),
    imageKeypoints: frameKeypoints,
  });
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
  it('keeps a normal valid user valid across frames', () => {
    const tracker = new ValidHumanSubjectTracker({ invalidFrameThreshold: 3 });
    const first = tracker.update(validSubject(keypoints()));
    const second = tracker.update(validSubject(transformedKeypoints({ offsetX: 0.02 })));

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    expect(second.sustainedInvalid).toBe(false);
  });

  it('treats a normal one-limb occlusion as a valid subject', () => {
    const frameKeypoints = keypoints({
      left_elbow: { score: 0 },
      left_wrist: { score: 0 },
    });
    const result = validSubject(frameKeypoints);

    expect(result.valid).toBe(true);
    expect(result.usableChains).toEqual(expect.arrayContaining(['torso', 'rightArm']));
  });

  it('keeps a real user valid when moving closer or farther', () => {
    const tracker = new ValidHumanSubjectTracker({ invalidFrameThreshold: 3 });
    tracker.update(validSubject(keypoints()));

    const closer = tracker.update(validSubject(transformedKeypoints({ scale: 1.8 })));
    const farther = tracker.update(validSubject(transformedKeypoints({ scale: 0.55 })));

    expect(closer.valid).toBe(true);
    expect(farther.valid).toBe(true);
    expect(farther.sustainedInvalid).toBe(false);
  });

  it('keeps exercise-like arm posture changes valid', () => {
    const tracker = new ValidHumanSubjectTracker({ invalidFrameThreshold: 3 });
    tracker.update(validSubject(keypoints()));
    const armsRaised = keypoints({
      left_elbow: { x: 0.36, y: 0.2 },
      right_elbow: { x: 0.64, y: 0.2 },
      left_wrist: { x: 0.34, y: 0.12 },
      right_wrist: { x: 0.66, y: 0.12 },
    });

    const result = tracker.update(validSubject(armsRaised));

    expect(result.valid).toBe(true);
    expect(result.sustainedInvalid).toBe(false);
    expect(result.rejectedAsLikelyFalseSubject).toBe(false);
  });

  it('lets strong torso and major-limb evidence override a moderate continuity jump', () => {
    const tracker = new ValidHumanSubjectTracker({ invalidFrameThreshold: 2 });
    tracker.update(validSubject(keypoints()));
    const movedSubject = validSubject(transformedKeypoints({
      offsetX: 0.44,
      scale: 0.45,
    }));

    const result = tracker.update(movedSubject);

    expect(result.valid).toBe(true);
    expect(result.strongHumanEvidence).toBe(true);
    expect(result.continuityOverride).toBe(true);
    expect(result.sustainedInvalid).toBe(false);
  });

  it('rejects collapsed object-like poses', () => {
    const frameKeypoints = keypoints(Object.fromEntries(
      MAJOR_JOINTS.map((name) => [name, { x: 0.5, y: 0.5, z: 0 }]),
    ));
    const result = validSubject(frameKeypoints);

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

  it('marks tracking lost when the user leaves and no valid pose remains', () => {
    const tracker = new ValidHumanSubjectTracker({ invalidFrameThreshold: 3 });
    tracker.update(validSubject(keypoints()));
    const invalid = validSubject([]);

    expect(tracker.update(invalid).sustainedInvalid).toBe(false);
    expect(tracker.update(invalid).sustainedInvalid).toBe(false);
    const lost = tracker.update(invalid);
    expect(lost.sustainedInvalid).toBe(true);
    expect(lost.reason).toBe('pose_lost');
  });

  it('marks tracking lost when a false tiny object pose appears after the user leaves', () => {
    const tracker = new ValidHumanSubjectTracker({ invalidFrameThreshold: 3 });
    tracker.update(validSubject(keypoints()));
    const falseObject = validSubject(keypoints(Object.fromEntries(
      MAJOR_JOINTS.map((name) => [name, { x: 0.84, y: 0.18, z: 0 }]),
    )));

    tracker.update(falseObject);
    tracker.update(falseObject);
    const lost = tracker.update(falseObject);
    expect(lost.sustainedInvalid).toBe(true);
    expect(lost.reason).toBe('subject_too_small');
  });

  it('rejects a sudden center and scale jump to a different false subject', () => {
    const tracker = new ValidHumanSubjectTracker({ invalidFrameThreshold: 2 });
    tracker.update(validSubject(keypoints()));
    const falseSubject = validSubject(transformedKeypoints({
      offsetX: 0.55,
      offsetY: -0.08,
      scale: 0.45,
    }));

    const first = tracker.update(falseSubject);
    const second = tracker.update(falseSubject);
    expect(first.valid).toBe(false);
    expect(first.rejectedAsLikelyFalseSubject).toBe(true);
    expect(first.reason).toBe('active_subject_jump');
    expect(second.sustainedInvalid).toBe(true);
  });

  it('reacquires the user after enough stable plausible frames', () => {
    const tracker = new ValidHumanSubjectTracker({
      invalidFrameThreshold: 2,
      reacquisitionFrameThreshold: 3,
    });
    tracker.update(validSubject(keypoints()));
    const invalid = validSubject([]);
    tracker.update(invalid);
    expect(tracker.update(invalid).sustainedInvalid).toBe(true);

    const returning = validSubject(transformedKeypoints({ offsetX: 0.02 }));
    expect(tracker.update(returning).valid).toBe(false);
    expect(tracker.update(returning).valid).toBe(false);
    const reacquired = tracker.update(returning);
    expect(reacquired.valid).toBe(true);
    expect(reacquired.sustainedInvalid).toBe(false);
  });

  it('does not reject fast but plausible movement', () => {
    const tracker = new ValidHumanSubjectTracker({ invalidFrameThreshold: 3 });
    tracker.update(validSubject(keypoints()));

    let latest = tracker.update(validSubject(transformedKeypoints({ offsetX: 0.08 })));
    latest = tracker.update(validSubject(transformedKeypoints({ offsetX: 0.16 })));
    latest = tracker.update(validSubject(transformedKeypoints({ offsetX: 0.24 })));

    expect(latest.valid).toBe(true);
    expect(latest.sustainedInvalid).toBe(false);
    expect(latest.rejectedAsLikelyFalseSubject).toBe(false);
  });

  it('does not flicker lost on short temporary bad frames', () => {
    const tracker = new ValidHumanSubjectTracker({
      invalidFrameThreshold: 3,
      validFrameThreshold: 2,
    });
    tracker.update(validSubject(keypoints()));
    const invalid = validSubject([]);

    expect(tracker.update(invalid).sustainedInvalid).toBe(false);
    expect(tracker.update(invalid).sustainedInvalid).toBe(false);
    expect(tracker.update(validSubject(keypoints())).sustainedInvalid).toBe(false);
    const recovered = tracker.update(validSubject(keypoints()));
    expect(recovered.invalidFrameCount).toBe(0);
    expect(recovered.sustainedInvalid).toBe(false);
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

    tracker.update(valid);
    tracker.update(invalid);
    tracker.update(invalid);
    expect(tracker.update(valid).invalidFrameCount).toBe(2);
    expect(tracker.update(valid).invalidFrameCount).toBe(0);
  });
});
