import { POSE_LANDMARK_NAMES } from '../../pose/landmarkReliability';
import {
  formatLandmarkRecordingReliabilityReport,
  poseStateFromLandmarkRecordingFrame,
  summarizeLandmarkRecordingReliability,
} from '../replay/reliabilityReport';
import type { ExerciseLabelFile } from '../dataset';
import type {
  LandmarkRecording,
  LandmarkRecordingFrame,
  LandmarkRecordingPoseLandmarkMetadata,
} from '../replay';

type JointOverrides<T> = Partial<Record<string, Partial<T>>>;

function keypoints(overrides: JointOverrides<LandmarkRecordingFrame['keypoints'][number]> = {}) {
  return POSE_LANDMARK_NAMES.map((name, index) => ({
    name,
    x: 0.1 + index * 0.01,
    y: 0.2 + index * 0.01,
    z: index * 0.001,
    score: 0.9,
    ...overrides[name],
  }));
}

function metadata(
  source: 'image' | 'world',
  overrides: JointOverrides<LandmarkRecordingPoseLandmarkMetadata> = {},
): LandmarkRecordingPoseLandmarkMetadata[] {
  return POSE_LANDMARK_NAMES.map((name) => ({
    name,
    source,
    visibility: 0.9,
    presence: 0.9,
    visibilityState: 'present',
    presenceState: 'present',
    scoreSource: 'visibility',
    ...overrides[name],
  }));
}

function v2Frame({
  timestamp = 0,
  keypointOverrides = {},
  metadataOverrides = {},
  frameContext,
}: {
  timestamp?: number;
  keypointOverrides?: JointOverrides<LandmarkRecordingFrame['keypoints'][number]>;
  metadataOverrides?: JointOverrides<LandmarkRecordingPoseLandmarkMetadata>;
  frameContext?: LandmarkRecordingFrame['frameContext'];
} = {}): LandmarkRecordingFrame {
  const worldKeypoints = keypoints(keypointOverrides);
  const imageKeypoints = keypoints(keypointOverrides);
  return {
    timestamp,
    timestampMs: timestamp,
    status: 'poseDetected',
    keypoints: worldKeypoints,
    primarySource: 'world',
    worldKeypoints,
    imageKeypoints,
    frameContext,
    poseMetadata: {
      worldLandmarks: metadata('world', metadataOverrides),
      imageLandmarks: metadata('image', metadataOverrides),
    },
  };
}

function recording(frames: LandmarkRecordingFrame[], schemaVersion: LandmarkRecording['schemaVersion'] = 2): LandmarkRecording {
  return {
    schemaVersion,
    exerciseName: 'Barbell Curl',
    metadata: {},
    frames,
  };
}

function label(reps: ExerciseLabelFile['reps']): Pick<ExerciseLabelFile, 'exerciseName' | 'sourceVideo' | 'expectedReps' | 'reps'> {
  return {
    exerciseName: 'Barbell Curl',
    sourceVideo: 'videos/training/barbell-curl/train001.mp4',
    expectedReps: reps.length,
    reps,
  };
}

describe('recording reliability report', () => {
  it('builds PoseState from v2 metadata without collapsing visibility into keypoint score', () => {
    const frame = v2Frame({
      keypointOverrides: {
        left_wrist: { score: 1.0 },
      },
      metadataOverrides: {
        left_wrist: { visibility: 0.2, presence: 0.9 },
      },
    });

    const state = poseStateFromLandmarkRecordingFrame(frame, {
      schemaVersion: 2,
      metadataMode: 'v2RichMetadata',
    });

    expect(state.primarySource).toBe('world');
    expect(state.joints.left_wrist.visibility).toBe(0.2);
    expect(state.joints.left_wrist.presence).toBe(0.9);
    expect(state.joints.left_wrist.confidence).toBe(1.0);
    expect(state.joints.left_wrist.reliability).toBe('lowVisibility');
    expect(state.joints.left_wrist.reasons).toContain('low_visibility');
  });

  it('builds approximate PoseState from v1 frames using legacy keypoint scores', () => {
    const frame: LandmarkRecordingFrame = {
      timestamp: 0,
      keypoints: keypoints({ left_wrist: { score: 0.2 } }),
    };

    const state = poseStateFromLandmarkRecordingFrame(frame, {
      schemaVersion: 1,
      metadataMode: 'legacyApproximate',
    });
    const summary = summarizeLandmarkRecordingReliability(recording([frame], 1));

    expect(state.joints.left_wrist.visibility).toBe(0.2);
    expect(state.joints.left_wrist.presence).toBeNull();
    expect(state.joints.left_wrist.reliability).toBe('lowVisibility');
    expect(state.joints.left_wrist.reasons).toContain('low_visibility');
    expect(state.joints.left_wrist.reasons).not.toContain('presence_unknown');
    expect(summary.metadataMode).toBe('legacyApproximate');
  });

  it('distinguishes v2 visibility=1.0 from missing visibility with legacy score=1.0', () => {
    const frame = v2Frame({
      keypointOverrides: {
        left_wrist: { score: 1.0 },
        right_wrist: { score: 1.0 },
      },
      metadataOverrides: {
        left_wrist: { visibility: 1.0, presence: 1.0 },
        right_wrist: { visibility: null, visibilityState: 'missing', presence: 1.0 },
      },
    });

    const state = poseStateFromLandmarkRecordingFrame(frame, {
      schemaVersion: 2,
      metadataMode: 'v2RichMetadata',
    });

    expect(state.joints.left_wrist.reliability).toBe('reliable');
    expect(state.joints.right_wrist.visibility).toBeNull();
    expect(state.joints.right_wrist.reliability).toBe('lowVisibility');
    expect(state.joints.right_wrist.reasons).toContain('visibility_unknown');
  });

  it('reports unavailable v2 presence without treating it as low presence', () => {
    const frame = v2Frame({
      metadataOverrides: {
        left_wrist: { presence: null, presenceState: 'unavailable' },
      },
    });

    const state = poseStateFromLandmarkRecordingFrame(frame, {
      schemaVersion: 2,
      metadataMode: 'v2RichMetadata',
    });
    const summary = summarizeLandmarkRecordingReliability(recording([frame]));

    expect(state.joints.left_wrist.presence).toBeNull();
    expect(state.joints.left_wrist.reliability).toBe('reliable');
    expect(state.joints.left_wrist.reasons).not.toContain('presence_unknown');
    expect(state.joints.left_wrist.reasons).not.toContain('low_presence');
    expect(summary.jointSummaries.left_wrist.presenceUnavailableFrames).toBe(1);
    expect(summary.jointSummaries.left_wrist.lowPresenceReasonFrames).toBe(0);
  });

  it('reports unavailable v2 visibility without falling back to a reliable score', () => {
    const frame = v2Frame({
      keypointOverrides: {
        right_wrist: { score: 1.0 },
      },
      metadataOverrides: {
        right_wrist: { visibility: null, visibilityState: 'unavailable', presence: 1.0 },
      },
    });

    const state = poseStateFromLandmarkRecordingFrame(frame, {
      schemaVersion: 2,
      metadataMode: 'v2RichMetadata',
    });
    const summary = summarizeLandmarkRecordingReliability(recording([frame]));

    expect(state.joints.right_wrist.visibility).toBeNull();
    expect(state.joints.right_wrist.reliability).toBe('lowVisibility');
    expect(state.joints.right_wrist.reasons).toContain('visibility_unknown');
    expect(summary.jointSummaries.right_wrist.visibilityUnavailableFrames).toBe(1);
    expect(summary.jointSummaries.right_wrist.visibilityUnknownFrames).toBe(1);
  });

  it('summarizes recording-level reliability, chains, focus joints, gaps, and malformed landmarks', () => {
    const reliable = v2Frame({ timestamp: 0 });
    const lowWristVisibility = v2Frame({
      timestamp: 33,
      metadataOverrides: {
        left_wrist: { visibility: 0.1, presence: 0.9 },
      },
    });
    const interrupted = v2Frame({
      timestamp: 1533,
      frameContext: { trackingInterrupted: true, silentGapMs: 1500, reacquisitionFrameIndex: 0 },
    });
    const malformedKnee = v2Frame({
      timestamp: 1566,
      keypointOverrides: {
        right_knee: { x: Number.NaN },
      },
      metadataOverrides: {
        right_knee: { malformedFields: ['x'] },
      },
    });
    const lost: LandmarkRecordingFrame = {
      timestamp: 1600,
      timestampMs: 1600,
      status: 'trackingLost',
      keypoints: [],
      primarySource: 'image',
    };

    const summary = summarizeLandmarkRecordingReliability(recording([
      reliable,
      lowWristVisibility,
      interrupted,
      malformedKnee,
      lost,
    ]));

    expect(summary.frameCount).toBe(5);
    expect(summary.metadataMode).toBe('v2RichMetadata');
    expect(summary.poseStateSummary.statusCounts.tracked).toBe(1);
    expect(summary.poseStateSummary.statusCounts.partial).toBe(3);
    expect(summary.poseStateSummary.statusCounts.lost).toBe(1);
    expect(summary.jointSummaries.left_wrist.lowVisibilityReasonFrames).toBe(1);
    expect(summary.jointSummaries.left_wrist.missing).toBe(1);
    expect(summary.jointSummaries.right_knee.malformed).toBe(1);
    expect(summary.chainStatusCounts.leftArm.partial).toBeGreaterThan(0);
    expect(summary.chainStatusCounts.leftArm.unreliable).toBeGreaterThan(0);
    expect(summary.focusJointSummaries.left_wrist.unreliable).toBeGreaterThan(0);
    expect(summary.gapSummary.trackingInterruptedFrames).toBe(1);
    expect(summary.gapSummary.reacquisitionFrames).toBeGreaterThanOrEqual(1);
    expect(summary.gapSummary.maxSilentGapMs).toBe(1500);
    expect(summary.gapSummary.gapsOver1000Ms).toBe(1);

    const formatted = formatLandmarkRecordingReliabilityReport(summary, 'train001.json');
    expect(formatted).toContain('schemaVersion=2');
    expect(formatted).toContain('mode=v2RichMetadata');
    expect(formatted).toContain('focus wrists');
    expect(formatted).toContain('chains arms');
    expect(formatted).toContain('trackingInterrupted=1');
  });

  it('adds labelled rep window summaries for v2 frames without changing the no-label report path', () => {
    const noLabelReport = summarizeLandmarkRecordingReliability(recording([v2Frame({ timestamp: 0 })]));
    expect(noLabelReport.labelledRepReliability).toBeUndefined();

    const report = summarizeLandmarkRecordingReliability(
      recording([
        v2Frame({ timestamp: 0 }),
        v2Frame({
          timestamp: 100,
          metadataOverrides: {
            left_wrist: { visibility: 0.1, presence: 0.9 },
          },
        }),
        v2Frame({ timestamp: 200 }),
      ]),
      {
        label: label([
          {
            index: 1,
            startMs: 50,
            endMs: 150,
            issueIds: ['barbell-curl.torso_swing'],
            scorable: true,
            expectedScoreRange: [70, 90],
            issueSeverities: { 'barbell-curl.torso_swing': 'mild' },
            view: 'front',
          },
        ]),
      },
    );

    const rep = report.labelledRepReliability?.reps[0];
    expect(rep?.frameCount).toBe(1);
    expect(rep?.label.issueIds).toEqual(['barbell-curl.torso_swing']);
    expect(rep?.label.scorable).toBe(true);
    expect(rep?.label.expectedScoreRange).toEqual([70, 90]);
    expect(rep?.label.issueSeverities).toEqual({ 'barbell-curl.torso_swing': 'mild' });
    expect(rep?.label.view).toBe('front');
    expect(rep?.jointSummaries.left_wrist.lowVisibilityReasonFrames).toBe(1);
    expect(rep?.chainStatusCounts.leftArm.partial).toBe(1);
    expect(report.labelledRepReliability?.aggregate.repsWithMajorFocusJointLowConfidence).toBe(1);
    expect(JSON.stringify(report)).toContain('labelledRepReliability');

    const formatted = formatLandmarkRecordingReliabilityReport(report, 'train001.json');
    expect(formatted).toContain('[LabelledRepReliability] rep=1');
    expect(formatted).toContain('issues=barbell-curl.torso_swing');
    expect(formatted).toContain('expectedScoreRange=[70,90]');
  });

  it('adds labelled rep window summaries for v1 legacy frames', () => {
    const legacyFrame: LandmarkRecordingFrame = {
      timestamp: 100,
      keypoints: keypoints({ right_wrist: { score: 0.2 } }),
    };

    const report = summarizeLandmarkRecordingReliability(
      recording([legacyFrame], 1),
      {
        label: label([
          { index: 1, startMs: 0, endMs: 200, issueIds: [], scorable: true, view: 'side' },
        ]),
      },
    );

    const rep = report.labelledRepReliability?.reps[0];
    expect(report.metadataMode).toBe('legacyApproximate');
    expect(rep?.frameCount).toBe(1);
    expect(rep?.jointSummaries.right_wrist.lowVisibilityReasonFrames).toBe(1);
    expect(rep?.jointSummaries.right_wrist.presenceUnknownFrames).toBe(0);
  });

  it('reports labelled rep windows with no matching frames', () => {
    const report = summarizeLandmarkRecordingReliability(
      recording([v2Frame({ timestamp: 100 })]),
      {
        label: label([
          { index: 1, startMs: 1000, endMs: 1200, issueIds: [], scorable: false, view: 'unknown' },
        ]),
      },
    );

    const rep = report.labelledRepReliability?.reps[0];
    expect(rep?.frameCount).toBe(0);
    expect(rep?.poseStateSummary.totalFrames).toBe(0);
    expect(report.labelledRepReliability?.aggregate.repsWithNoFrames).toBe(1);
  });

  it('reports tracking interruption inside labelled rep windows', () => {
    const report = summarizeLandmarkRecordingReliability(
      recording([
        v2Frame({ timestamp: 0 }),
        v2Frame({
          timestamp: 1500,
          frameContext: { trackingInterrupted: true, silentGapMs: 1500, reacquisitionFrameIndex: 0 },
        }),
      ]),
      {
        label: label([
          { index: 1, startMs: 1000, endMs: 1600, issueIds: [], scorable: true, view: 'front' },
        ]),
      },
    );

    const rep = report.labelledRepReliability?.reps[0];
    expect(rep?.gapSummary.trackingInterruptedFrames).toBe(1);
    expect(rep?.gapSummary.reacquisitionFrames).toBe(1);
    expect(report.labelledRepReliability?.aggregate.repsWithTrackingInterruption).toBe(1);
  });
});
