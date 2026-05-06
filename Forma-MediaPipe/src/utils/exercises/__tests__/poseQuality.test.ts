import type { Keypoint } from '../../poseAnalysis';
import type { ExerciseDefinition, ExerciseState } from '../types';
import {
  POSE_QUALITY_LATENCY_TARGET_MS,
  PoseQualityTracker,
  RepQualityAccumulator,
  RepQualityWindowAccumulator,
  getPoseQualityMessage,
  resolveExerciseQualityProfile,
  summarizeSetTrackingQuality,
} from '../shared/poseQuality';
import type { PoseQualitySnapshot, PoseQualityWarning } from '../shared/poseQuality';

const JOINTS = [
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

function keypoints(score = 0.99, overrides: Partial<Record<string, Partial<Keypoint>>> = {}): Keypoint[] {
  return JOINTS.map((name, index) => {
    const sideOffset = name.startsWith('left') ? -0.08 : 0.08;
    const row = Math.floor(index / 2);
    return {
      name,
      x: 0.5 + sideOffset,
      y: 0.18 + row * 0.08,
      z: 0,
      score,
      ...overrides[name],
    };
  });
}

function definition(name: string, requiredView: ExerciseDefinition['requiredView']): ExerciseDefinition {
  return {
    name,
    requiredView,
    createState: (): ExerciseState => ({
      repCount: 0,
      lastRepResult: null,
      feedback: null,
      feedbackTimestamp: null,
      debugInfo: {},
      _internal: {},
    }),
    update: (_keypoints, state) => state,
    ttsConfig: { feedbackToIssue: {} },
    summaryConfig: {},
  };
}

function qualitySnapshot(
  status: PoseQualitySnapshot['status'],
  confidence: number,
  warnings: PoseQualityWarning[] = [],
): PoseQualitySnapshot {
  return {
    status,
    confidence,
    rawConfidence: confidence,
    visibilityConfidence: confidence,
    stabilityConfidence: confidence,
    dropoutRate: status === 'lost' ? 1 : 0,
    jitter: 0,
    missingRequiredJoints: [],
    warnings,
    message: '',
    canJudgeForm: status === 'high' || status === 'medium',
    canScoreRep: status === 'high' || status === 'medium',
    sampleCount: 1,
    lowConfidenceFrameCount: status === 'low' || status === 'lost' ? 1 : 0,
  };
}

function settleTracker(tracker: PoseQualityTracker, frames: Keypoint[][], exerciseName = 'Barbell Curl') {
  const profile = resolveExerciseQualityProfile(definition(exerciseName, exerciseName === 'Barbell Curl' ? 'front' : 'side'));
  let snapshot = tracker.update(frames[0] ?? [], profile);
  for (let i = 1; i < frames.length; i++) {
    snapshot = tracker.update(frames[i], profile);
  }
  return snapshot;
}

describe('PoseQualityTracker', () => {
  it('reports high confidence when required joints stay visible', () => {
    const tracker = new PoseQualityTracker();
    const snapshot = settleTracker(tracker, Array.from({ length: 18 }, () => keypoints()));

    expect(snapshot.status).toBe('high');
    expect(snapshot.canJudgeForm).toBe(true);
    expect(snapshot.confidence).toBeGreaterThan(0.85);
  });

  it('reports low confidence with actionable missing-joint warnings', () => {
    const tracker = new PoseQualityTracker();
    const lowKnees = keypoints(0.99, {
      left_knee: { score: 0.01 },
      right_knee: { score: 0.01 },
    });
    const snapshot = settleTracker(tracker, Array.from({ length: 18 }, () => lowKnees), 'Barbell Squat');

    expect(snapshot.status).toBe('low');
    expect(snapshot.canScoreRep).toBe(false);
    expect(snapshot.warnings).toContain('knees_hidden');
  });

  it('smooths short occlusion without dropping to lost', () => {
    const tracker = new PoseQualityTracker();
    const occluded = keypoints(0.99, {
      left_elbow: { score: 0 },
      right_elbow: { score: 0 },
      left_wrist: { score: 0 },
      right_wrist: { score: 0 },
    });
    const frames = [
      ...Array.from({ length: 10 }, () => keypoints()),
      ...Array.from({ length: 2 }, () => occluded),
      ...Array.from({ length: 10 }, () => keypoints()),
    ];
    const snapshot = settleTracker(tracker, frames);

    expect(snapshot.status).not.toBe('lost');
    expect(snapshot.canJudgeForm).toBe(true);
  });

  it('reports lost tracking after sustained missing frames', () => {
    const tracker = new PoseQualityTracker();
    const snapshot = settleTracker(tracker, Array.from({ length: 18 }, () => []));

    expect(snapshot.status).toBe('lost');
    expect(snapshot.warnings).toContain('tracking_lost');
  });

  it('flags unstable tracking when landmarks jump between frames', () => {
    const tracker = new PoseQualityTracker();
    const frames = Array.from({ length: 18 }, (_, index) => {
      const jump = index % 2 === 0 ? -0.22 : 0.22;
      return keypoints(0.99, Object.fromEntries(
        JOINTS.map((joint) => [joint, { x: 0.5 + jump }]),
      ));
    });
    const snapshot = settleTracker(tracker, frames);

    expect(snapshot.warnings).toContain('unstable_tracking');
  });

  it('uses image keypoints for frame-bound warnings while scoring world keypoints', () => {
    const tracker = new PoseQualityTracker();
    const profile = resolveExerciseQualityProfile(definition('Barbell Curl', 'front'));
    const worldFrame = keypoints(0.99, Object.fromEntries(
      JOINTS.map((joint, index) => [joint, { x: index * 0.04, y: 0.2 + index * 0.01, z: index * 0.02 }]),
    ));
    const imageFrame = keypoints(0.99, Object.fromEntries(
      JOINTS.map((joint) => [
        joint,
        {
          x: joint.startsWith('left') ? 0.01 : 0.99,
          y: joint.includes('ankle') ? 0.98 : 0.5,
        },
      ]),
    ));
    let snapshot = tracker.update(worldFrame, profile, { frameBoundsKeypoints: imageFrame });
    for (let i = 0; i < 17; i++) {
      snapshot = tracker.update(worldFrame, profile, { frameBoundsKeypoints: imageFrame });
    }

    expect(snapshot.canJudgeForm).toBe(true);
    expect(snapshot.warnings).toContain('keep_full_body_in_frame');
    expect(snapshot.warnings).toContain('move_camera_back');
  });

  it('surfaces actionable warnings before generic high-confidence messaging', () => {
    const message = getPoseQualityMessage({
      status: 'high',
      warnings: ['move_camera_back'],
    });

    expect(message).toBe('Move camera back');
  });

  it('recovers confidence after the user re-enters frame', () => {
    const tracker = new PoseQualityTracker();
    settleTracker(tracker, Array.from({ length: 18 }, () => []));
    const snapshot = settleTracker(tracker, Array.from({ length: 24 }, () => keypoints()));

    expect(snapshot.status).toBe('high');
    expect(snapshot.canScoreRep).toBe(true);
  });

  it('marks reps unscorable when most of the rep window is low confidence', () => {
    const tracker = new PoseQualityTracker();
    const accumulator = new RepQualityAccumulator();
    const profile = resolveExerciseQualityProfile(definition('Barbell Squat', 'side'));
    const hiddenKnees = keypoints(0.99, {
      left_knee: { score: 0 },
      right_knee: { score: 0 },
    });

    for (const frame of Array.from({ length: 18 }, () => hiddenKnees)) {
      accumulator.record(tracker.update(frame, profile));
    }
    const summary = accumulator.consume();

    expect(summary.scorable).toBe(false);
    expect(summary.message).toContain('Tracking uncertain');
  });

  it('accumulates rep quality only while the explicit active window is open', () => {
    const accumulator = new RepQualityWindowAccumulator();
    const low = qualitySnapshot('low', 0.25, ['keep_full_body_in_frame']);
    const high = qualitySnapshot('high', 0.95);

    accumulator.recordFrame(low, { repCount: 0, repQualityWindowActive: false });
    accumulator.recordFrame(low, { repCount: 0, repQualityWindowActive: false });
    accumulator.recordFrame(high, { repCount: 0, repQualityWindowActive: true });
    accumulator.recordFrame(high, { repCount: 0, repQualityWindowActive: true });
    const summary = accumulator.recordFrame(high, { repCount: 1, repQualityWindowActive: false });

    expect(summary?.scorable).toBe(true);
    expect(summary?.totalFrames).toBe(3);
    expect(summary?.lowConfidenceFrames).toBe(0);
  });

  it('resets an aborted active quality window before the next counted rep', () => {
    const accumulator = new RepQualityWindowAccumulator();
    const low = qualitySnapshot('low', 0.25, ['arms_hidden']);
    const high = qualitySnapshot('high', 0.95);

    accumulator.recordFrame(low, { repCount: 0, repQualityWindowActive: true });
    accumulator.recordFrame(low, { repCount: 0, repQualityWindowActive: true });
    accumulator.recordFrame(high, { repCount: 0, repQualityWindowActive: false });
    accumulator.recordFrame(high, { repCount: 0, repQualityWindowActive: true });
    const summary = accumulator.recordFrame(high, { repCount: 1, repQualityWindowActive: false });

    expect(summary?.scorable).toBe(true);
    expect(summary?.totalFrames).toBe(2);
    expect(summary?.warnings).not.toContain('arms_hidden');
  });

  it('preserves whole-window accumulation when no active flag is provided', () => {
    const accumulator = new RepQualityWindowAccumulator();
    const low = qualitySnapshot('low', 0.25, ['feet_hidden']);
    const high = qualitySnapshot('high', 0.95);

    accumulator.recordFrame(low, { repCount: 0 });
    accumulator.recordFrame(low, { repCount: 0 });
    accumulator.recordFrame(high, { repCount: 0 });
    const summary = accumulator.recordFrame(high, { repCount: 1 });

    expect(summary?.totalFrames).toBe(4);
    expect(summary?.lowConfidenceFrames).toBe(2);
    expect(summary?.scorable).toBe(false);
  });

  it('summarizes set-level scorable and unscored reps', () => {
    const summary = summarizeSetTrackingQuality([
      { status: 'high', confidence: 0.95, scorable: true, totalFrames: 20, lowConfidenceFrames: 0, warnings: [], message: 'Tracking good' },
      { status: 'low', confidence: 0.35, scorable: false, totalFrames: 20, lowConfidenceFrames: 18, warnings: ['knees_hidden'], message: 'Tracking uncertain - keep knees visible' },
    ]);

    expect(summary.scoredReps).toBe(1);
    expect(summary.unscoredReps).toBe(1);
    expect(summary.message).toContain('Form score based on 1 of 2 reps');
  });

  it('keeps evaluation within the realtime latency budget', () => {
    const tracker = new PoseQualityTracker();
    const profile = resolveExerciseQualityProfile(definition('Barbell Curl', 'front'));
    const frames = Array.from({ length: 500 }, () => keypoints());
    const startedAt = Date.now();
    for (const frame of frames) {
      tracker.update(frame, profile);
    }
    const avgMs = (Date.now() - startedAt) / frames.length;

    expect(avgMs).toBeLessThan(POSE_QUALITY_LATENCY_TARGET_MS);
  });
});
