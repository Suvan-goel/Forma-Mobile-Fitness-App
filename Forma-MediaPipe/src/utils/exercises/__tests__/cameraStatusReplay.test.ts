import type { Keypoint } from '../../poseAnalysis';
import {
  fullFeedbackCameraStatus,
  limitedFeedbackCameraStatus,
  type CameraAnalysisStatus,
} from '../shared/cameraAnalysisStatus';
import type { PoseQualityWarning } from '../shared/poseQuality';
import type { ExerciseDefinition, ExerciseState } from '../types';
import {
  replayCameraAnalysisStatus,
  type LandmarkRecording,
} from '../replay';

type StatusFactory = (frameIndex: number) => CameraAnalysisStatus | null;
type WarningFactory = (frameIndex: number) => PoseQualityWarning[];

function keypoint(name: string, x: number, y: number, z = 0, score = 0.95): Keypoint {
  return { name, x, y, z, score };
}

function fullBodyKeypoints(offsetX = 0): Keypoint[] {
  return [
    keypoint('left_shoulder', 0.42 + offsetX, 0.28),
    keypoint('right_shoulder', 0.58 + offsetX, 0.28),
    keypoint('left_elbow', 0.36 + offsetX, 0.43),
    keypoint('right_elbow', 0.64 + offsetX, 0.43),
    keypoint('left_wrist', 0.32 + offsetX, 0.58),
    keypoint('right_wrist', 0.68 + offsetX, 0.58),
    keypoint('left_hip', 0.44 + offsetX, 0.56),
    keypoint('right_hip', 0.56 + offsetX, 0.56),
    keypoint('left_knee', 0.43 + offsetX, 0.74),
    keypoint('right_knee', 0.57 + offsetX, 0.74),
    keypoint('left_ankle', 0.42 + offsetX, 0.90),
    keypoint('right_ankle', 0.58 + offsetX, 0.90),
    keypoint('left_heel', 0.40 + offsetX, 0.92),
    keypoint('right_heel', 0.60 + offsetX, 0.92),
    keypoint('left_foot_index', 0.39 + offsetX, 0.94),
    keypoint('right_foot_index', 0.61 + offsetX, 0.94),
  ];
}

function makeRecording(timestamps: number[], args: {
  schemaVersion?: LandmarkRecording['schemaVersion'];
  exerciseName?: string;
} = {}): LandmarkRecording {
  return {
    ...(args.schemaVersion ? { schemaVersion: args.schemaVersion } : {}),
    exerciseName: args.exerciseName ?? 'Camera Status Replay Test',
    metadata: {
      duration: timestamps.length > 0 ? timestamps[timestamps.length - 1] - timestamps[0] : 0,
    },
    frames: timestamps.map((timestamp) => ({
      timestamp,
      timestampMs: timestamp,
      status: 'poseDetected',
      keypoints: fullBodyKeypoints(),
      imageKeypoints: fullBodyKeypoints(),
      primarySource: 'image',
    })),
  };
}

function makeState(): ExerciseState {
  return {
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: { frameIndex: 0 },
  };
}

function makeDefinition(args: {
  status?: CameraAnalysisStatus | StatusFactory;
  warnings?: PoseQualityWarning[] | WarningFactory;
} = {}): ExerciseDefinition {
  const statusArg = args.status;
  const warningsArg = args.warnings;
  const statusFactory: StatusFactory =
    typeof statusArg === 'function'
      ? statusArg
      : () => statusArg ?? fullFeedbackCameraStatus('exercise');
  const warningFactory: WarningFactory =
    typeof warningsArg === 'function'
      ? warningsArg
      : () => warningsArg ?? [];

  return {
    name: 'Camera Status Replay Test',
    requiredView: 'any',
    qualityProfile: {
      requiredView: 'any',
      requiredJoints: ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'],
      importantJoints: ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_knee', 'right_knee'],
      framingScope: 'full_body',
      windowSize: 3,
    },
    createState: makeState,
    update: (_keypoints, currentState) => {
      const internal = currentState._internal as { frameIndex: number };
      const frameIndex = internal.frameIndex;
      return {
        ...currentState,
        liveAnalysisStatus: statusFactory(frameIndex),
        liveQualityWarnings: warningFactory(frameIndex),
        _internal: { frameIndex: frameIndex + 1 },
      };
    },
    ttsConfig: { feedbackToIssue: {} },
    summaryConfig: {},
  };
}

describe('camera status replay', () => {
  it('reports stable full feedback on a clean v2 recording', () => {
    const report = replayCameraAnalysisStatus(
      makeDefinition(),
      makeRecording([0, 33, 66, 99, 132, 165], { schemaVersion: 2 }),
    );

    expect(report.syntheticNoPoseFrameCount).toBe(0);
    expect(report.timeline.some((entry) => entry.status?.message === 'Full feedback available')).toBe(true);
    expect(report.timeByFeedbackMode.full).toBeGreaterThan(0);
  });

  it('lets limited feedback beat generic tracking-good status', () => {
    const report = replayCameraAnalysisStatus(
      makeDefinition({ status: limitedFeedbackCameraStatus() }),
      makeRecording([0, 33, 66, 99, 132], { schemaVersion: 2 }),
    );

    expect(report.timeline.at(-1)?.status?.message).toBe('Limited feedback - adjust angle for full analysis');
    expect(report.timeByFeedbackMode.limited).toBeGreaterThan(0);
  });

  it('lets critical exercise framing warnings beat limited feedback', () => {
    const report = replayCameraAnalysisStatus(
      makeDefinition({
        status: limitedFeedbackCameraStatus(),
        warnings: ['move_camera_back'],
      }),
      makeRecording([0, 33, 66, 99, 132], { schemaVersion: 2 }),
    );

    expect(report.timeline.at(-1)?.status?.message).toBe('Move the camera back.');
    expect(report.timeline.at(-1)?.status?.category).toBe('framing');
  });

  it('synthesizes diagnostic no-pose samples for long silent gaps and reports tracking-lost latency', () => {
    const timestamps = [0, 33, 66, 2500, 2533, 2566, 2599, 2632, 2665, 2698, 2731, 2764];
    const report = replayCameraAnalysisStatus(
      makeDefinition(),
      makeRecording(timestamps, { schemaVersion: 2 }),
    );

    expect(report.syntheticNoPoseFrameCount).toBeGreaterThan(0);
    expect(report.silentGaps).toHaveLength(1);
    expect(report.silentGaps[0].trackingLostAppeared).toBe(true);
    expect(report.silentGaps[0].trackingLostLatencyMs).toBeGreaterThan(0);
    expect(report.silentGaps[0].trackingLostLatencyMs).toBeLessThanOrEqual(500);
    expect(report.recoveryLatenciesMs[0]).toBeGreaterThanOrEqual(0);
  });

  it('does not flicker to tracking lost for a short temporary gap', () => {
    const report = replayCameraAnalysisStatus(
      makeDefinition(),
      makeRecording([0, 33, 66, 666, 699, 732], { schemaVersion: 2 }),
    );

    expect(report.syntheticNoPoseFrameCount).toBe(0);
    expect(report.silentGaps).toHaveLength(0);
    expect(report.timeline.some((entry) => entry.status?.message === 'Tracking was lost.')).toBe(false);
  });

  it('compresses consecutive frame statuses into timeline windows', () => {
    const report = replayCameraAnalysisStatus(
      makeDefinition(),
      makeRecording([0, 33, 66, 99, 132, 165], { schemaVersion: 2 }),
      { smoothing: { stableFrames: 1, holdMs: 0 }, includeFrames: true },
    );

    expect(report.frames).toHaveLength(6);
    expect(report.timeline).toHaveLength(1);
    expect(report.timeline[0].durationMs).toBeGreaterThan(0);
  });

  it('counts rapid status alternation as flicker', () => {
    const report = replayCameraAnalysisStatus(
      makeDefinition({
        status: (frameIndex) => (
          frameIndex % 2 === 0
            ? fullFeedbackCameraStatus('exercise')
            : limitedFeedbackCameraStatus()
        ),
      }),
      makeRecording([0, 100, 200, 300], { schemaVersion: 2 }),
      { smoothing: { stableFrames: 1, holdMs: 0 } },
    );

    expect(report.flickerCount).toBeGreaterThanOrEqual(1);
  });

  it('handles legacy v1-style recordings with approximate pose reliability', () => {
    const report = replayCameraAnalysisStatus(
      makeDefinition(),
      makeRecording([0, 33, 66, 99, 132]),
    );

    expect(report.schemaVersion).toBe('legacy');
    expect(report.processedFrameCount).toBe(5);
    expect(report.timeline.some((entry) => entry.status?.message === 'Full feedback available')).toBe(true);
  });
});
