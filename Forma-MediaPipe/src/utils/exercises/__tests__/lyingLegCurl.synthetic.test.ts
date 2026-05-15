import { lyingLegCurlDefinition } from '../definitions/lyingLegCurl';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type Posture = 'flat' | 'hip-lift';

type Point = { x: number; y: number };

const FRAME_MS = 50;

const EXTENDED = {
  shoulder: { x: -0.45, y: 0.55 },
  hip: { x: 0, y: 0.55 },
  knee: { x: 0.45, y: 0.55 },
  ankle: { x: 0.9, y: 0.55 },
};

const CURLED = {
  shoulder: { x: -0.45, y: 0.55 },
  hip: { x: 0, y: 0.55 },
  knee: { x: 0.45, y: 0.55 },
  ankle: { x: 0.25, y: 0.2 },
};

function kp(name: string, point: Point, score = 0.99): Keypoint {
  return { name, x: point.x, y: point.y, z: 0, score };
}

function interpolate(from: number, to: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => {
    const p = frames <= 1 ? 1 : index / (frames - 1);
    return from + (to - from) * p;
  });
}

function fullRepPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 32),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 48),
    ...Array(8).fill(0),
  ];
}

function noTopHoldPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 32),
    ...interpolate(1, 0, 48),
    ...Array(8).fill(0),
  ];
}

function longTopHoldPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 32),
    ...Array(64).fill(1),
    ...interpolate(1, 0, 48),
    ...Array(8).fill(0),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.25, 8),
    ...interpolate(0.25, 0, 8),
    ...Array(8).fill(0),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.68, 18),
    ...interpolate(0.68, 0, 22),
    ...Array(8).fill(0),
  ];
}

function halfRepWithOneFrameFullCurlSpikePath(): number[] {
  const path = halfRepPath();
  path[26] = 1;
  return path;
}

function shortReturnPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 32),
    ...Array(4).fill(1),
    ...interpolate(1, 0.48, 48),
    ...Array(12).fill(0.48),
  ];
}

function fastLowerPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 32),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 4),
    ...Array(8).fill(0),
  ];
}

function jerkyPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 32),
    ...Array(4).fill(1),
    ...interpolate(1, 0.55, 4),
    ...interpolate(0.55, 1, 4),
    ...interpolate(1, 0, 48),
    ...Array(8).fill(0),
  ];
}

function lerpPoint(a: Point, b: Point, t: number, mirror: number): Point {
  return {
    x: (a.x + (b.x - a.x) * t) * mirror,
    y: a.y + (b.y - a.y) * t,
  };
}

function poseAt(progress: number, orientation: Orientation, posture: Posture) {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const shoulder = lerpPoint(EXTENDED.shoulder, CURLED.shoulder, progress, mirror);
  const hip = lerpPoint(EXTENDED.hip, CURLED.hip, progress, mirror);
  const knee = lerpPoint(EXTENDED.knee, CURLED.knee, progress, mirror);
  const ankle = lerpPoint(EXTENDED.ankle, CURLED.ankle, progress, mirror);

  if (posture === 'hip-lift') {
    hip.y -= 0.13;
  }

  return { shoulder, hip, knee, ankle };
}

function sideKeypoints(
  side: Side,
  progress: number,
  orientation: Orientation,
  posture: Posture,
  score: number,
  sideOffset = 0.015,
): Keypoint[] {
  const pose = poseAt(progress, orientation, posture);
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const offset = side === 'left' ? -sideOffset : sideOffset;
  const withOffset = (point: Point) => ({ x: point.x + offset, y: point.y });
  const heel = {
    x: pose.ankle.x - 0.02 * mirror,
    y: pose.ankle.y + 0.01,
  };
  const footIndex = {
    x: pose.ankle.x + 0.04 * mirror,
    y: pose.ankle.y + 0.01,
  };

  return [
    kp(`${side}_shoulder`, withOffset(pose.shoulder), score),
    kp(`${side}_hip`, withOffset(pose.hip), score),
    kp(`${side}_knee`, withOffset(pose.knee), score),
    kp(`${side}_ankle`, withOffset(pose.ankle), score),
    kp(`${side}_heel`, withOffset(heel), score),
    kp(`${side}_foot_index`, withOffset(footIndex), score),
  ];
}

function makeFrameWithScores(
  timestamp: number,
  progress: number,
  orientation: Orientation,
  posture: Posture,
  leftScore: number,
  rightScore: number,
  sideOffset = 0.015,
): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints('left', progress, orientation, posture, leftScore, sideOffset),
      ...sideKeypoints('right', progress, orientation, posture, rightScore, sideOffset),
    ],
  };
}

function makeFrame(
  timestamp: number,
  progress: number,
  side: Side,
  orientation: Orientation,
  posture: Posture,
  hiddenSideScore = 0.3,
  sideOffset = 0.015,
): LandmarkRecording['frames'][number] {
  return side === 'left'
    ? makeFrameWithScores(timestamp, progress, orientation, posture, 0.99, hiddenSideScore, sideOffset)
    : makeFrameWithScores(timestamp, progress, orientation, posture, hiddenSideScore, 0.99, sideOffset);
}

function buildRecording(
  description: string,
  path: number[],
  options: {
    side?: Side;
    orientation?: Orientation;
    posture?: Posture | ((index: number) => Posture);
    sideSwitchFrame?: number;
    hiddenSideScore?: number;
    sideOffset?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'flat',
    sideSwitchFrame,
    hiddenSideScore = 0.3,
    sideOffset = 0.015,
  } = options;

  return {
    exerciseName: 'Lying Leg Curl',
    metadata: {
      recordedAt: '2026-04-30T00:00:00.000Z',
      duration: (path.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: path.map((progress, index) => {
      const framePosture = typeof posture === 'function' ? posture(index) : posture;
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        return side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.7, 0.99, sideOffset)
          : makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.99, 0.7, sideOffset);
      }
      return makeFrame(index * FRAME_MS, progress, side, orientation, framePosture, hiddenSideScore, sideOffset);
    }),
  };
}

function mapRecordingKeypoints(
  recording: LandmarkRecording,
  mapper: (point: Keypoint, frameIndex: number) => Keypoint,
): LandmarkRecording {
  return {
    ...recording,
    frames: recording.frames.map((frame, frameIndex) => ({
      ...frame,
      keypoints: frame.keypoints.map(point => mapper(point, frameIndex)),
    })),
  };
}

function setKeypointScores(
  recording: LandmarkRecording,
  names: string[],
  score: number,
): LandmarkRecording {
  const nameSet = new Set(names);
  return mapRecordingKeypoints(recording, point => (
    nameSet.has(point.name) ? { ...point, score } : point
  ));
}

describe('Lying Leg Curl synthetic replay coverage', () => {
  it.each<Orientation>(['facing-right', 'facing-left'])(
    'counts a clean full rep when %s',
    orientation => {
      const result = replayRecording(
        lyingLegCurlDefinition,
        buildRecording(`synthetic clean lying leg curl ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('does not count a tiny lying-leg-curl pulse', () => {
    const result = replayRecordingVerbose(
      lyingLegCurlDefinition,
      buildRecording('synthetic tiny lying leg curl pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial lying leg curl and records ROM feedback', () => {
    const clean = replayRecording(lyingLegCurlDefinition, buildRecording('synthetic clean lying leg curl', fullRepPath()));
    const result = replayRecording(lyingLegCurlDefinition, buildRecording('synthetic half lying leg curl', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Curl higher — bring your heels closer to your glutes.');
  });

  it('keeps sustained curl ROM feedback despite a one-frame full-curl spike', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic half lying leg curl with one-frame full-curl spike', halfRepWithOneFrameFullCurlSpikePath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Curl higher — bring your heels closer to your glutes.');
  });

  it('does not create false ROM feedback from a one-frame knee-angle spike', () => {
    const spiked = mapRecordingKeypoints(
      buildRecording('synthetic clean lying leg curl with knee-angle spike', fullRepPath()),
      (point, index) => (
        index === 42 && point.name.endsWith('_knee')
          ? { ...point, y: point.y - 0.35 }
          : point
      ),
    );

    const result = replayRecording(lyingLegCurlDefinition, spiked);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Curl higher — bring your heels closer to your glutes.');
    expect(result.feedbackMessages).not.toContain('Extend fully — straighten your legs at the bottom.');
  });

  it('uses knee flexion angle as a corroborating curl-depth signal', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic knee-angle curl depth check', fullRepPath()),
      {
        heuristicConfig: {
          formThresholds: {
            FLEXION_FAIL: 1.1,
            KNEE_FLEXION_FAIL: 50,
          },
        },
      },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Curl higher — bring your heels closer to your glutes.');
    expect(result.reps[0].diagnostics?.metrics.kneeFlexionAngle.value).not.toBeNull();
  });

  it('uses knee extension angle as a corroborating bottom-extension signal', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic knee-angle extension check', fullRepPath()),
      {
        heuristicConfig: {
          formThresholds: {
            EXTENSION_FAIL: 0.5,
            KNEE_EXTENSION_FAIL: 181,
          },
        },
      },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Extend fully — straighten your legs at the bottom.');
    expect(result.reps[0].diagnostics?.metrics.kneeExtensionAngle.value).not.toBeNull();
  });

  it('flags short return extension using the lowering phase instead of the starting posture', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic short-return lying leg curl', shortReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Extend fully — straighten your legs at the bottom.');
    expect(result.reps[0].diagnostics?.metrics.extensionRatio.value).toBeLessThan(0.93);
  });

  it('keeps the visible side locked through a rep when visibility flips', () => {
    const result = replayRecordingVerbose(
      lyingLegCurlDefinition,
      buildRecording('synthetic lying leg curl side visibility flip', fullRepPath(), {
        side: 'left',
        sideSwitchFrame: 44,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => trace.phase !== 'REST');
    expect(activeFrames.every(trace => trace.debugInfo.side === 'left')).toBe(true);
  });

  it('flags hip lift without punishing flat hips', () => {
    const clean = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic flat lying leg curl', fullRepPath(), { posture: 'flat' }),
    );
    const hipLift = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic hip lift lying leg curl', fullRepPath(), {
        posture: index => (index >= 24 && index < 68 ? 'hip-lift' : 'flat'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your hips down — avoid lifting off the pad.');
    expect(hipLift.finalRepCount).toBe(1);
    expect(hipLift.feedbackMessages).toContain('Keep your hips down — avoid lifting off the pad.');
  });

  it('flags hip lift that starts with the curl by using the REST baseline', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic early hip lift lying leg curl', fullRepPath(), {
        posture: index => (index >= 32 ? 'hip-lift' : 'flat'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your hips down — avoid lifting off the pad.');
    expect(result.reps[0].diagnostics?.metrics.hipRiseRatio.value).toBeGreaterThan(0.04);
  });

  it('uses normalized hip rise as a second hip-lift signal', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic hip rise lying leg curl', fullRepPath(), {
        posture: index => (index >= 44 && index < 68 ? 'hip-lift' : 'flat'),
      }),
      {
        heuristicConfig: {
          formThresholds: {
            HIP_LIFT_WARN: 90,
          },
        },
      },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your hips down — avoid lifting off the pad.');
    expect(result.reps[0].diagnostics?.metrics.hipRiseRatio.value).toBeGreaterThan(0.04);
  });

  it('does not flag thigh movement for a clean fixed-thigh rep', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic clean fixed-thigh lying leg curl', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Keep your thighs down — only your lower legs should move.');
    expect(result.reps[0].diagnostics?.metrics.thighDriftRatio.value).toBeLessThanOrEqual(0.01);
  });

  it('flags sustained knee/thigh drift as thigh movement', () => {
    const clean = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic clean fixed-thigh lying leg curl', fullRepPath()),
    );
    const drift = mapRecordingKeypoints(
      buildRecording('synthetic thigh drift lying leg curl', fullRepPath()),
      (point, index) => (
        index >= 32 && index < 68 && point.name.endsWith('_knee')
          ? { ...point, y: point.y - 0.09 }
          : point
      ),
    );

    const result = replayRecording(lyingLegCurlDefinition, drift);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your thighs down — only your lower legs should move.');
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.reps[0].diagnostics?.metrics.thighDriftRatio.value).toBeGreaterThan(0.06);
  });

  it('flags thigh movement that starts with the curl by using the REST baseline', () => {
    const drift = mapRecordingKeypoints(
      buildRecording('synthetic early thigh drift lying leg curl', fullRepPath()),
      (point, index) => (
        index >= 32 && point.name.endsWith('_knee')
          ? { ...point, y: point.y - 0.09 }
          : point
      ),
    );

    const result = replayRecording(lyingLegCurlDefinition, drift);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your thighs down — only your lower legs should move.');
    expect(result.reps[0].diagnostics?.metrics.thighDriftRatio.value).toBeGreaterThan(0.06);
  });

  it('does not create hip-lift feedback from low-confidence hip-chain frames', () => {
    const noisy = buildRecording('synthetic low-confidence hip lift lying leg curl', fullRepPath(), {
      posture: index => (index >= 24 && index < 68 ? 'hip-lift' : 'flat'),
    });
    noisy.frames = noisy.frames.map((frame, index) => index >= 20 && index < 76
      ? { ...frame, keypoints: frame.keypoints.map(point => ({ ...point, score: 0.25 })) }
      : frame);

    const result = replayRecording(lyingLegCurlDefinition, noisy);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Keep your hips down — avoid lifting off the pad.');
  });

  it('marks hip-angle diagnostics ineligible when no confident hip-angle samples exist', () => {
    const noisy = buildRecording('synthetic missing hip-angle lying leg curl', fullRepPath());
    noisy.frames = noisy.frames.map((frame, index) => index >= 16
      ? { ...frame, keypoints: frame.keypoints.map(point => ({ ...point, score: 0.25 })) }
      : frame);

    const result = replayRecording(lyingLegCurlDefinition, noisy);

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].diagnostics?.metrics.hipDelta.eligible).toBe(false);
    expect(result.reps[0].diagnostics?.metrics.hipDelta.skippedReason).toBe('insufficient_hip_angle_samples');
  });

  it('keeps lower-body-scorable reps scorable when shoulders are hidden', () => {
    const recording = setKeypointScores(
      buildRecording('synthetic shoulder-hidden lying leg curl', fullRepPath()),
      ['left_shoulder', 'right_shoulder'],
      0.05,
    );

    const result = replayRecording(lyingLegCurlDefinition, recording);

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).not.toBe(false);
    expect(result.reps[0].qualityWarnings ?? []).not.toContain('missing_required_joints');
    expect(result.feedbackMessages).not.toContain('Keep your hips, knees, and lower legs visible so I can judge your curl.');
    expect(result.reps[0].diagnostics?.metrics.hipDelta.eligible).toBe(false);
    expect(result.reps[0].diagnostics?.view).toBe('side');
  });

  it('uses heel fallback when the ankle is hidden by the roller pad', () => {
    const recording = setKeypointScores(
      buildRecording('synthetic heel fallback lying leg curl', fullRepPath()),
      ['left_ankle', 'right_ankle'],
      0.05,
    );

    const result = replayRecording(lyingLegCurlDefinition, recording);

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).not.toBe(false);
    expect(result.reps[0].diagnostics?.metrics.distalEndpoint.label).toBe('heel');
  });

  it('uses foot-index fallback when ankle and heel are hidden', () => {
    const recording = setKeypointScores(
      buildRecording('synthetic foot fallback lying leg curl', fullRepPath()),
      ['left_ankle', 'right_ankle', 'left_heel', 'right_heel'],
      0.05,
    );

    const result = replayRecording(lyingLegCurlDefinition, recording);

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).not.toBe(false);
    expect(result.reps[0].diagnostics?.metrics.distalEndpoint.label).toBe('foot_index');
  });

  it('marks reps unscorable when all distal endpoint evidence is low confidence', () => {
    const recording = setKeypointScores(
      buildRecording('synthetic low-confidence distal endpoint lying leg curl', fullRepPath()),
      [
        'left_ankle',
        'right_ankle',
        'left_heel',
        'right_heel',
        'left_foot_index',
        'right_foot_index',
      ],
      0.25,
    );

    const result = replayRecording(lyingLegCurlDefinition, recording);

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('missing_required_joints');
    expect(result.feedbackMessages).toContain('Keep your hips, knees, and lower legs visible so I can judge your curl.');
  });

  it('marks reps unscorable when form-critical lower-body landmarks are low confidence', () => {
    const noisy = buildRecording('synthetic low-confidence lying leg curl', fullRepPath());
    noisy.frames = noisy.frames.map((frame, index) => index >= 20 && index < 76
      ? { ...frame, keypoints: frame.keypoints.map(point => ({ ...point, score: 0.25 })) }
      : frame);

    const result = replayRecording(lyingLegCurlDefinition, noisy);

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('missing_required_joints');
    expect(result.feedbackMessages).toContain('Keep your hips, knees, and lower legs visible so I can judge your curl.');
    expect(result.feedbackMessages).not.toContain('Keep your hips down — avoid lifting off the pad.');
  });

  it('marks counted reps unscorable when the distal endpoint drops out mid-rep', () => {
    const distalEndpoints = new Set([
      'left_ankle',
      'right_ankle',
      'left_heel',
      'right_heel',
      'left_foot_index',
      'right_foot_index',
    ]);
    const dropout = mapRecordingKeypoints(
      buildRecording('synthetic distal-endpoint dropout lying leg curl', longTopHoldPath()),
      (point, index) => (
        index >= 52 && index < 104 && distalEndpoints.has(point.name)
          ? { ...point, score: 0.05 }
          : point
      ),
    );

    const result = replayRecording(lyingLegCurlDefinition, dropout);

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('missing_required_joints');
    expect(result.feedbackMessages).toContain('Keep your hips, knees, and lower legs visible so I can judge your curl.');
  });

  it('counts a front-ish view but marks it unscorable for side-view uncertainty', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic front-ish lying leg curl', fullRepPath(), {
        hiddenSideScore: 0.99,
        sideOffset: 0.25,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.feedbackMessages).toContain('Turn fully side-on so I can judge your leg curl.');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('frontish_confirmed');
  });

  it('treats one-side-only captures as side-view scorable when not clearly front-ish', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic one-side-only lying leg curl', fullRepPath(), {
        hiddenSideScore: 0.05,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).not.toBe(false);
    expect(result.reps[0].qualityWarnings ?? []).not.toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('side');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('side_confirmed');
  });

  it('flags a missing top squeeze when the user reverses immediately', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic no-top-hold lying leg curl', noTopHoldPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Pause briefly at the top — squeeze your hamstrings.');
  });

  it('respects top-hold tunable overrides', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic no-top-hold override lying leg curl', noTopHoldPath()),
      {
        heuristicConfig: {
          formThresholds: {
            TOP_HOLD_MIN: 0,
          },
        },
      },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Pause briefly at the top — squeeze your hamstrings.');
  });

  it('still flags a true fast lower', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic fast lower lying leg curl', fastLowerPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Control the descent — lower the weight slowly.');
    expect(result.feedbackMessages).not.toContain('Move smoothly — avoid bouncing the weight.');
  });

  it('flags a jerky bounced rep separately from ordinary tempo feedback', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic jerky lying leg curl', jerkyPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Move smoothly — avoid bouncing the weight.');
    expect(result.reps[0].diagnostics?.metrics.velocitySpikeRatio.value).not.toBeNull();
  });

  it('respects velocity sample tunable overrides for jerk detection', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic jerky velocity override lying leg curl', jerkyPath()),
      {
        heuristicConfig: {
          formThresholds: {
            VELOCITY_SAMPLE_MIN: 99,
          },
        },
      },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Move smoothly — avoid bouncing the weight.');
    expect(result.reps[0].diagnostics?.metrics.velocitySpikeRatio.value).toBeNull();
  });
});
