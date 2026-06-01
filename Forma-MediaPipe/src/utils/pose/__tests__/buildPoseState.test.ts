import type { RawPoseLandmark } from '../parsePoseFrame';
import { parsePoseFrame } from '../parsePoseFrame';
import {
  buildPoseState,
  createPoseStateReliabilityAggregator,
  formatPoseStateReliabilitySummary,
} from '../buildPoseState';

const LANDMARK_COUNT = 33;

function rawLandmark(index: number, overrides: Partial<RawPoseLandmark> = {}): RawPoseLandmark {
  return {
    x: 0.1 + index * 0.01,
    y: 0.2 + index * 0.01,
    z: index * 0.001,
    visibility: 0.9,
    presence: 0.9,
    ...overrides,
  };
}

function rawLandmarks(overrides: Record<number, Partial<RawPoseLandmark>> = {}): RawPoseLandmark[] {
  return Array.from({ length: LANDMARK_COUNT }, (_, index) => rawLandmark(index, overrides[index]));
}

function poseState(payload: unknown, options: Parameters<typeof buildPoseState>[1] = {}) {
  const parsed = parsePoseFrame(payload);
  expect(parsed).not.toBeNull();
  return buildPoseState(parsed!, options);
}

describe('buildPoseState', () => {
  it('classifies reliable landmarks as reliable and preserves keypoint compatibility', () => {
    const state = poseState({ timestampMs: 100, landmarks: rawLandmarks() });

    expect(state.status).toBe('tracked');
    expect(state.timestampMs).toBe(100);
    expect(state.primarySource).toBe('image');
    expect(state.keypoints).toHaveLength(33);
    expect(state.joints.left_wrist).toMatchObject({
      name: 'left_wrist',
      visibility: 0.9,
      presence: 0.9,
      confidence: 0.9,
      reliability: 'reliable',
      reasons: [],
      source: 'image',
    });
    expect(state.chains.leftArm.status).toBe('reliable');
  });

  it('classifies low visibility landmarks as lowVisibility', () => {
    const state = poseState({
      landmarks: rawLandmarks({
        15: { visibility: 0.2, presence: 0.9 },
      }),
    });

    expect(state.joints.left_wrist.reliability).toBe('lowVisibility');
    expect(state.joints.left_wrist.reasons).toContain('low_visibility');
    expect(state.diagnostics.lowConfidenceJoints).toContain('left_wrist');
  });

  it('classifies low presence landmarks as lowPresence', () => {
    const state = poseState({
      landmarks: rawLandmarks({
        16: { visibility: 0.9, presence: 0.2 },
      }),
    });

    expect(state.joints.right_wrist.reliability).toBe('lowPresence');
    expect(state.joints.right_wrist.reasons).toContain('low_presence');
    expect(state.diagnostics.lowConfidenceJoints).toContain('right_wrist');
  });

  it('classifies malformed coordinates as malformed', () => {
    const state = poseState({
      landmarks: rawLandmarks({
        25: { x: Infinity, y: NaN, z: -Infinity },
      }),
    });

    expect(state.joints.left_knee.reliability).toBe('malformed');
    expect(state.joints.left_knee.reasons).toContain('malformed_coordinate');
    expect(state.diagnostics.malformedJoints).toContain('left_knee');
    expect(state.chains.leftLeg.status).toBe('unreliable');
  });

  it('classifies missing landmarks as missing', () => {
    const state = poseState({
      status: 'trackingLost',
      timestampMs: 500,
      landmarks: [],
      worldLandmarks: [],
    });

    expect(state.status).toBe('lost');
    expect(state.joints.left_wrist.reliability).toBe('missing');
    expect(state.joints.left_wrist.reasons).toContain('missing');
    expect(state.diagnostics.missingJoints).toContain('left_wrist');
    expect(state.chains.leftArm.status).toBe('unreliable');
  });

  it('marks joints stale during tracking interruption and reacquisition frames', () => {
    const interrupted = poseState(
      { timestampMs: 1200, landmarks: rawLandmarks() },
      { trackingInterrupted: true, silentGapMs: 1200, reacquisitionFrameIndex: 0 },
    );

    expect(interrupted.status).toBe('partial');
    expect(interrupted.joints.left_wrist.reliability).toBe('stale');
    expect(interrupted.joints.left_wrist.reasons).toEqual(
      expect.arrayContaining(['tracking_interrupted', 'reacquisition_frame']),
    );
    expect(interrupted.diagnostics.trackingInterrupted).toBe(true);
    expect(interrupted.diagnostics.reacquisitionFrameIndex).toBe(0);

    const reacquiring = poseState(
      { timestampMs: 1250, landmarks: rawLandmarks() },
      { reacquisitionFrameIndex: 2, previousPoseState: interrupted },
    );
    expect(reacquiring.joints.right_wrist.reliability).toBe('stale');
    expect(reacquiring.joints.right_wrist.reasons).toContain('reacquisition_frame');
  });

  it('marks large frame-to-frame jumps as outlierCandidate', () => {
    const previous = poseState({
      timestampMs: 0,
      landmarks: rawLandmarks({
        15: { x: 0.2, y: 0.3, z: 0 },
      }),
    });
    const current = poseState(
      {
        timestampMs: 33,
        landmarks: rawLandmarks({
          15: { x: 0.9, y: 0.9, z: 0 },
        }),
      },
      { previousPoseState: previous },
    );

    expect(current.joints.left_wrist.reliability).toBe('outlierCandidate');
    expect(current.joints.left_wrist.reasons).toContain('large_delta');
    expect(current.joints.left_wrist.previousFrameDelta).toBeGreaterThan(0.35);
    expect(current.joints.left_wrist.ageMs).toBe(33);
  });

  it('marks bone-length jumps as outlierCandidate diagnostics', () => {
    const previous = poseState({
      landmarks: rawLandmarks({
        11: { x: 0.2, y: 0.2 },
        13: { x: 0.3, y: 0.2 },
      }),
    });
    const current = poseState(
      {
        landmarks: rawLandmarks({
          11: { x: 0.2, y: 0.2 },
          13: { x: 0.8, y: 0.2 },
        }),
      },
      { previousPoseState: previous },
    );

    expect(current.joints.left_shoulder.reasons).toContain('bone_length_jump');
    expect(current.joints.left_elbow.reasons).toContain('bone_length_jump');
    expect(current.chains.leftArm.outlierCandidateJoints).toEqual(
      expect.arrayContaining(['left_shoulder', 'left_elbow']),
    );
  });

  it('marks chain reliability partial when one joint is low-confidence', () => {
    const state = poseState({
      landmarks: rawLandmarks({
        13: { visibility: 0.2, presence: 0.9 },
      }),
    });

    expect(state.chains.leftArm.status).toBe('partial');
    expect(state.chains.leftArm.lowConfidenceJoints).toContain('left_elbow');
    expect(state.chains.leftArm.missingJoints).toEqual([]);
  });

  it('marks chain reliability unreliable when a critical joint is missing or malformed', () => {
    const state = poseState([
      { name: 'left_shoulder', x: 0.4, y: 0.4, z: 0, score: 0.9 },
      { name: 'left_elbow', x: 0.45, y: 0.5, z: 0, score: 0.9 },
    ]);

    expect(state.joints.left_wrist.reliability).toBe('missing');
    expect(state.chains.leftArm.status).toBe('unreliable');
    expect(state.chains.leftArm.missingJoints).toContain('left_wrist');
  });

  it('aggregates and formats compact reliability summaries', () => {
    const aggregator = createPoseStateReliabilityAggregator();
    aggregator.observe(poseState({ landmarks: rawLandmarks() }));
    aggregator.observe(poseState({
      landmarks: rawLandmarks({
        15: { visibility: 0.1, presence: 0.9 },
      }),
    }));

    const summary = aggregator.snapshot();
    expect(summary.totalFrames).toBe(2);
    expect(summary.statusCounts.tracked).toBe(1);
    expect(summary.statusCounts.partial).toBe(1);
    expect(summary.unreliableJointCounts.left_wrist).toBe(1);

    const formatted = formatPoseStateReliabilitySummary(summary);
    expect(formatted).toContain('[PoseStateDiagnostics] frames=2 tracked=1 partial=1 lost=0');
    expect(formatted).toContain('topUnreliableJoints=left_wrist:1');
    expect(formatted).toContain('chains arms');
    expect(formatted).toContain('focus left_wrist:unreliable=1/outlier=0');
  });
});
