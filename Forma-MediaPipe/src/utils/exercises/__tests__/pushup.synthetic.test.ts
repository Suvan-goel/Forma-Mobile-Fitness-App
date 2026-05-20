import { pushupDefinition } from '../definitions/pushup';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type PushupSide = 'left' | 'right';
type PushupOrientation = 'facing-right' | 'facing-left';
type PushupPosture = 'neutral' | 'sag' | 'pike';
type PushupHeadPosture = 'neutral' | 'dropped';

const FRAME_MS = 50;
const EXTENDED_ELBOW_X = 0;
const BOTTOM_ELBOW_X = 0.58;
const NEAR_DEPTH_ELBOW_X = 0.14;
const NEAR_LOCKOUT_ELBOW_X = 0.052;
const PULSE_ELBOW_X = 0.04;
const HALF_ELBOW_X = 0.12;
const SOFT_LOCKOUT_ELBOW_X = 0.04;
const LOW_LOCKOUT_ELBOW_X = 0.06;

function kp(name: string, x: number, y: number, score = 0.99): Keypoint {
  return { name, x, y, z: 0, score };
}

function interpolate(from: number, to: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => {
    const p = frames <= 1 ? 1 : index / (frames - 1);
    return from + (to - from) * p;
  });
}

function fullRepPath(): number[] {
  return [
    ...Array(22).fill(EXTENDED_ELBOW_X),
    ...interpolate(EXTENDED_ELBOW_X, BOTTOM_ELBOW_X, 50),
    ...Array(4).fill(BOTTOM_ELBOW_X),
    ...interpolate(BOTTOM_ELBOW_X, EXTENDED_ELBOW_X, 18),
    ...Array(8).fill(EXTENDED_ELBOW_X),
  ];
}

function nearDepthFullRepPath(): number[] {
  return [
    ...Array(22).fill(EXTENDED_ELBOW_X),
    ...interpolate(EXTENDED_ELBOW_X, NEAR_DEPTH_ELBOW_X, 24),
    ...Array(4).fill(NEAR_DEPTH_ELBOW_X),
    ...interpolate(NEAR_DEPTH_ELBOW_X, EXTENDED_ELBOW_X, 18),
    ...Array(8).fill(EXTENDED_ELBOW_X),
  ];
}

function nearLockoutFullRepPath(): number[] {
  return [
    ...Array(22).fill(NEAR_LOCKOUT_ELBOW_X),
    ...interpolate(NEAR_LOCKOUT_ELBOW_X, BOTTOM_ELBOW_X, 50),
    ...Array(4).fill(BOTTOM_ELBOW_X),
    ...interpolate(BOTTOM_ELBOW_X, NEAR_LOCKOUT_ELBOW_X, 18),
    ...Array(8).fill(NEAR_LOCKOUT_ELBOW_X),
  ];
}

function noisySetupThenFullRepPath(): number[] {
  return [
    ...Array(22).fill(EXTENDED_ELBOW_X),
    ...[0.07, 0.075, 0.07, 0.075, 0.07, 0.075, 0.07, 0.075, 0.07, 0.075],
    ...Array(10).fill(EXTENDED_ELBOW_X),
    ...interpolate(EXTENDED_ELBOW_X, BOTTOM_ELBOW_X, 50),
    ...Array(4).fill(BOTTOM_ELBOW_X),
    ...interpolate(BOTTOM_ELBOW_X, EXTENDED_ELBOW_X, 18),
    ...Array(8).fill(EXTENDED_ELBOW_X),
  ];
}

function pulsePath(): number[] {
  return [
    ...Array(22).fill(EXTENDED_ELBOW_X),
    ...interpolate(EXTENDED_ELBOW_X, PULSE_ELBOW_X, 8),
    ...interpolate(PULSE_ELBOW_X, EXTENDED_ELBOW_X, 8),
    ...Array(8).fill(EXTENDED_ELBOW_X),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(22).fill(EXTENDED_ELBOW_X),
    ...interpolate(EXTENDED_ELBOW_X, HALF_ELBOW_X, 18),
    ...interpolate(HALF_ELBOW_X, EXTENDED_ELBOW_X, 18),
    ...Array(8).fill(EXTENDED_ELBOW_X),
  ];
}

function lowLockoutHalfRepPath(): number[] {
  return [
    ...Array(22).fill(LOW_LOCKOUT_ELBOW_X),
    ...interpolate(LOW_LOCKOUT_ELBOW_X, HALF_ELBOW_X, 18),
    ...interpolate(HALF_ELBOW_X, LOW_LOCKOUT_ELBOW_X, 18),
    ...Array(8).fill(LOW_LOCKOUT_ELBOW_X),
  ];
}

function fastDescentPath(): number[] {
  return [
    ...Array(22).fill(EXTENDED_ELBOW_X),
    ...interpolate(EXTENDED_ELBOW_X, BOTTOM_ELBOW_X, 3),
    ...Array(4).fill(BOTTOM_ELBOW_X),
    ...interpolate(BOTTOM_ELBOW_X, EXTENDED_ELBOW_X, 18),
    ...Array(8).fill(EXTENDED_ELBOW_X),
  ];
}

function immediateConsecutiveRepPath(): number[] {
  return [
    ...Array(22).fill(EXTENDED_ELBOW_X),
    ...interpolate(EXTENDED_ELBOW_X, BOTTOM_ELBOW_X, 50),
    ...Array(4).fill(BOTTOM_ELBOW_X),
    ...interpolate(BOTTOM_ELBOW_X, EXTENDED_ELBOW_X, 18),
    ...interpolate(EXTENDED_ELBOW_X, BOTTOM_ELBOW_X, 2),
    ...Array(12).fill(BOTTOM_ELBOW_X),
    ...interpolate(BOTTOM_ELBOW_X, EXTENDED_ELBOW_X, 18),
    ...Array(8).fill(EXTENDED_ELBOW_X),
  ];
}

function bodyPoints(orientation: PushupOrientation, posture: PushupPosture) {
  const shoulder = { x: 0.3, y: 0.48 };
  const ankle = { x: orientation === 'facing-right' ? 0.9 : -0.3, y: 0.48 };
  const hipMidX = (shoulder.x + ankle.x) / 2;
  const hipY =
    posture === 'sag'
      ? 0.59
      : posture === 'pike'
        ? 0.37
        : 0.48;
  return {
    shoulder,
    hip: { x: hipMidX, y: hipY },
    ankle,
  };
}

function sideKeypoints(
  side: PushupSide,
  elbowOffsetX: number,
  orientation: PushupOrientation,
  posture: PushupPosture,
  score: number,
  sideOffset = 0.02,
  wristShiftX = 0,
): Keypoint[] {
  const { shoulder, hip, ankle } = bodyPoints(orientation, posture);
  const elbowDirection = orientation === 'facing-right' ? -1 : 1;
  const xOffset = side === 'left' ? -sideOffset : sideOffset;
  const elbow = {
    x: shoulder.x + xOffset + elbowDirection * elbowOffsetX,
    y: 0.63,
  };
  const wrist = {
    x: shoulder.x + xOffset + wristShiftX,
    y: 0.78,
  };
  const prefix = side;

  return [
    kp(`${prefix}_shoulder`, shoulder.x + xOffset, shoulder.y, score),
    kp(`${prefix}_elbow`, elbow.x, elbow.y, score),
    kp(`${prefix}_wrist`, wrist.x, wrist.y, score),
    kp(`${prefix}_hip`, hip.x + xOffset, hip.y, score),
    kp(`${prefix}_ankle`, ankle.x + xOffset, ankle.y, score),
  ];
}

function nosePoint(
  shoulder: { x: number; y: number },
  orientation: PushupOrientation,
  headPosture: PushupHeadPosture,
) {
  const direction = orientation === 'facing-right' ? -1 : 1;
  return headPosture === 'dropped'
    ? { x: shoulder.x + direction * 0.12, y: shoulder.y + 0.14 }
    : { x: shoulder.x + direction * 0.12, y: shoulder.y - 0.02 };
}

function makeFrameWithScores(
  timestamp: number,
  elbowOffsetX: number,
  orientation: PushupOrientation,
  posture: PushupPosture,
  headPosture: PushupHeadPosture,
  leftScore: number,
  rightScore: number,
  sideOffset = 0.02,
  wristShiftX = 0,
): LandmarkRecording['frames'][number] {
  const { shoulder } = bodyPoints(orientation, posture);
  const nose = nosePoint(shoulder, orientation, headPosture);
  return {
    timestamp,
    keypoints: [
        kp('nose', nose.x, nose.y),
        ...sideKeypoints('left', elbowOffsetX, orientation, posture, leftScore, sideOffset, wristShiftX),
        ...sideKeypoints('right', elbowOffsetX, orientation, posture, rightScore, sideOffset, wristShiftX),
      ],
    };
  }

function makeFrame(
  timestamp: number,
  elbowOffsetX: number,
  side: PushupSide,
  orientation: PushupOrientation,
  posture: PushupPosture,
  headPosture: PushupHeadPosture,
  hiddenSideScore = 0.05,
  sideOffset = 0.02,
  wristShiftX = 0,
): LandmarkRecording['frames'][number] {
  const otherSide: PushupSide = side === 'left' ? 'right' : 'left';
  const { shoulder } = bodyPoints(orientation, posture);
  const nose = nosePoint(shoulder, orientation, headPosture);
  return {
    timestamp,
    keypoints: [
        kp('nose', nose.x, nose.y),
        ...sideKeypoints(side, elbowOffsetX, orientation, posture, 0.99, sideOffset, wristShiftX),
        ...sideKeypoints(otherSide, elbowOffsetX, orientation, posture, hiddenSideScore, sideOffset, wristShiftX),
      ],
    };
  }

function buildRecording(
  description: string,
  elbowPath: number[],
  options: {
    side?: PushupSide;
    orientation?: PushupOrientation;
    posture?: PushupPosture;
      headPosture?: PushupHeadPosture;
      sideSwitchFrame?: number;
      hiddenSideScore?: number;
      sideOffset?: number;
      wristShiftX?: number;
    } = {},
  ): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'neutral',
      headPosture = 'neutral',
      sideSwitchFrame,
      hiddenSideScore = 0.05,
      sideOffset = 0.02,
      wristShiftX = 0,
    } = options;

  return {
    exerciseName: 'Push-Up',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (elbowPath.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: elbowPath.map((elbowOffsetX, index) => {
        if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
          return side === 'left'
            ? makeFrameWithScores(index * FRAME_MS, elbowOffsetX, orientation, posture, headPosture, 0.7, 0.99, sideOffset, wristShiftX)
            : makeFrameWithScores(index * FRAME_MS, elbowOffsetX, orientation, posture, headPosture, 0.99, 0.7, sideOffset, wristShiftX);
        }
        return makeFrame(index * FRAME_MS, elbowOffsetX, side, orientation, posture, headPosture, hiddenSideScore, sideOffset, wristShiftX);
      }),
    };
  }

function invalidSetupThenNearLockoutFullRepRecording(): LandmarkRecording {
  const invalidSetup = buildRecording(
    'synthetic invalid extended setup before near-lockout pushup',
    Array(12).fill(EXTENDED_ELBOW_X),
    { hiddenSideScore: 0.99, sideOffset: 0.14 },
  );
  const rep = buildRecording('synthetic near-lockout pushup after invalid setup', nearLockoutFullRepPath());
  const offsetMs = invalidSetup.frames.length * FRAME_MS;

  return {
    ...rep,
    metadata: {
      ...rep.metadata,
      description: 'synthetic near-lockout pushup after invalid pre-setup frames',
      duration: ((invalidSetup.frames.length + rep.frames.length) * FRAME_MS) / 1000,
    },
    frames: [
      ...invalidSetup.frames,
      ...rep.frames.map(frame => ({ ...frame, timestamp: frame.timestamp + offsetMs })),
    ],
  };
}

function buildRecordingWithPostureDuringRep(
  description: string,
  elbowPath: number[],
  posture: PushupPosture,
  orientation: PushupOrientation,
): LandmarkRecording {
  return {
    ...buildRecording(description, elbowPath, { orientation }),
    frames: elbowPath.map((elbowOffsetX, index) => {
      const activePosture = index < 22 ? 'neutral' : posture;
      return makeFrame(index * FRAME_MS, elbowOffsetX, 'left', orientation, activePosture, 'neutral');
    }),
  };
}

function withKeypointUpdates(
  recording: LandmarkRecording,
  update: (point: Keypoint, frameIndex: number) => Keypoint,
): LandmarkRecording {
  return {
    ...recording,
    frames: recording.frames.map((frame, frameIndex) => ({
      ...frame,
      keypoints: frame.keypoints.map(point => update(point, frameIndex)),
    })),
  };
}

function withExplicitImageAndWorld(recording: LandmarkRecording): LandmarkRecording {
  return {
    ...recording,
    frames: recording.frames.map(frame => {
      const imageKeypoints = frame.keypoints.map(point => ({ ...point }));
      const worldKeypoints = frame.keypoints.map(point => ({ ...point }));
      return {
        ...frame,
        keypoints: worldKeypoints.map(point => ({ ...point })),
        imageKeypoints,
        worldKeypoints,
      };
    }),
  };
}

function expectMetricRatioBounded(value: unknown) {
  expect(typeof value).toBe('number');
  expect(value as number).toBeGreaterThanOrEqual(0);
  expect(value as number).toBeLessThanOrEqual(1);
}

function expectStaysIdle(recording: LandmarkRecording) {
  const result = replayRecordingVerbose(pushupDefinition, recording);
  expect(result.finalRepCount).toBe(0);
  expect(result.frameTraces.every(trace => trace.phase === 'IDLE')).toBe(true);
  return result;
}

function collectLiveWarnings(recording: LandmarkRecording): string[] {
  let state = pushupDefinition.createState();
  const warnings = new Set<string>();
  const originalDateNow = Date.now;

  try {
    for (const frame of recording.frames) {
      Date.now = () => frame.timestamp;
      state = pushupDefinition.update(frame.keypoints, state, {
        worldKeypoints: frame.worldKeypoints,
        imageKeypoints: frame.imageKeypoints ?? frame.keypoints,
        primarySource: frame.worldKeypoints ? 'world' : 'image',
        timestampMs: frame.timestamp,
      });
      state.liveQualityWarnings?.forEach(warning => warnings.add(warning));
    }
  } finally {
    Date.now = originalDateNow;
  }

  return [...warnings];
}

describe('Push-Up synthetic replay coverage', () => {
  it.each<PushupOrientation>(['facing-right', 'facing-left'])(
    'counts a clean side-view full rep when %s',
    orientation => {
      const result = replayRecording(
        pushupDefinition,
        buildRecording(`synthetic clean pushup ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
      expect(result.reps[0].diagnostics?.metrics.frameCount.value).toBeGreaterThan(0);
      expect(result.reps[0].diagnostics?.metrics.bodyJudgeableRate.value).toBeGreaterThanOrEqual(0.6);
      expect(result.reps[0].diagnostics?.metrics.headJudgeableRate.value).toBeGreaterThanOrEqual(0.6);
      expect(result.reps[0].diagnostics?.cues['push-up.depth_short'].triggered).toBe(false);
      expect(result.reps[0].diagnostics?.cues['push-up.lockout_short'].triggered).toBe(false);
      expect(result.reps[0].diagnostics?.cues['push-up.camera_setup'].triggered).toBe(false);
    },
  );

  it('counts a clean full rep with explicit image and world landmark sources', () => {
    const result = replayRecording(
      pushupDefinition,
      withExplicitImageAndWorld(buildRecording('synthetic clean explicit-source pushup', fullRepPath())),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].diagnostics?.scorable).toBe(true);
    expect(result.feedbackMessages).toEqual([]);
    expect(result.reps[0].diagnostics?.cues['push-up.depth_short'].triggered).toBe(false);
    expect(result.reps[0].diagnostics?.cues['push-up.lockout_short'].triggered).toBe(false);
    expect(result.reps[0].diagnostics?.cues['push-up.camera_setup'].triggered).toBe(false);
  });

  it('does not count a small pulse that never reaches bottom', () => {
    const result = replayRecordingVerbose(
      pushupDefinition,
      buildRecording('synthetic shallow pushup pulse', pulsePath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('does not double-count top-threshold jitter before a full rep', () => {
    const result = replayRecordingVerbose(
      pushupDefinition,
      buildRecording('synthetic noisy setup before pushup', noisySetupThenFullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repTraces).toHaveLength(1);
  });

  it('holds a soft-lockout plank without starting repeated low-ROM rep windows', () => {
    const result = replayRecordingVerbose(
      pushupDefinition,
      buildRecording(
        'synthetic static soft-lockout pushup plank',
        Array(80).fill(SOFT_LOCKOUT_ELBOW_X),
      ),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.frameTraces.some(trace => trace.phase === 'PLANK')).toBe(true);
    expect(result.frameTraces.every(trace => trace.phase === 'IDLE' || trace.phase === 'PLANK')).toBe(true);
    expect(result.frameTraces.map(trace => trace.feedback).filter(Boolean)).not.toContain(
      'Use more range for this rep to count.',
    );
  });

  it('does not leave idle when setup is not side-on enough', () => {
    const recording = buildRecording('synthetic front-ish pushup setup', fullRepPath(), {
      hiddenSideScore: 0.99,
      sideOffset: 0.14,
    });
    const result = expectStaysIdle(recording);

    expect(result.frameTraces.some(trace => (
      Array.isArray(trace.debugInfo.setupWarnings) &&
      trace.debugInfo.setupWarnings.includes('not_side_view')
    ))).toBe(true);
    expect(collectLiveWarnings(recording)).toContain('side_view_uncertain');
  });

  it('ignores low-confidence opposite-side width when checking side-view setup', () => {
    const recording = withKeypointUpdates(
      buildRecording('synthetic side-view pushup with hallucinated hidden side width', fullRepPath()),
      point => {
        if (point.name === 'right_shoulder') return { ...point, x: 0.78, score: 0.05 };
        if (point.name === 'right_hip') return { ...point, x: 0.78, score: 0.05 };
        return point;
      },
    );
    const result = replayRecordingVerbose(pushupDefinition, recording);

    expect(result.finalRepCount).toBe(1);
    expect(result.frameTraces.some(trace => (
      Array.isArray(trace.debugInfo.setupWarnings) &&
      trace.debugInfo.setupWarnings.includes('not_side_view')
    ))).toBe(false);
  });

  it('does not leave idle when the arm or lower-body chain is hidden', () => {
    const hiddenWrist = withKeypointUpdates(
      buildRecording('synthetic hidden wrist pushup setup', fullRepPath()),
      point => point.name === 'left_wrist' ? { ...point, score: 0.05 } : point,
    );
    const hiddenAnkle = withKeypointUpdates(
      buildRecording('synthetic hidden ankle pushup setup', fullRepPath()),
      point => point.name === 'left_ankle' ? { ...point, score: 0.05 } : point,
    );

    expectStaysIdle(hiddenWrist);
    expectStaysIdle(hiddenAnkle);
  });

  it('does not leave idle when the full body is cropped at the frame edge', () => {
    const cropped = withKeypointUpdates(
      buildRecording('synthetic cropped pushup setup', fullRepPath()),
      point => point.name === 'left_ankle' ? { ...point, x: 0.99 } : point,
    );

    const result = expectStaysIdle(cropped);
    expect(result.frameTraces.some(trace => (
      Array.isArray(trace.debugInfo.setupWarnings) &&
      trace.debugInfo.setupWarnings.includes('full_body_not_visible')
    ))).toBe(true);
  });

  it('counts a meaningful partial push-up and records depth feedback', () => {
    const clean = replayRecording(pushupDefinition, buildRecording('synthetic clean pushup', fullRepPath()));
    const result = replayRecording(pushupDefinition, buildRecording('synthetic half pushup', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Go deeper — aim for elbows at 90 degrees.');
    expect(result.reps[0].diagnostics?.metrics.frameCount.value).toBeGreaterThan(0);
    expectMetricRatioBounded(result.reps[0].diagnostics?.metrics.bodyJudgeableRate.value);
    expectMetricRatioBounded(result.reps[0].diagnostics?.metrics.headJudgeableRate.value);
    expectMetricRatioBounded(result.reps[0].diagnostics?.metrics.setupWarningRate.value);
  });

  it('uses the terminal completion frame for full-rep tempo diagnostics', () => {
    const result = replayRecordingVerbose(
      pushupDefinition,
      buildRecording('synthetic clean pushup tempo diagnostics', fullRepPath()),
    );

    const rep = result.reps[0];
    const repTrace = result.repTraces[0];
    const startTransition = repTrace.transitions.find(transition => (
      transition.fromPhase === 'PLANK' && transition.toPhase === 'DESCENDING'
    ));
    const bottomTransition = repTrace.transitions.find(transition => (
      transition.fromPhase === 'DESCENDING' && transition.toPhase === 'BOTTOM'
    ));
    const completionTransition = repTrace.transitions.find(transition => (
      transition.fromPhase === 'ASCENDING' && transition.toPhase === 'PLANK'
    ));

    expect(startTransition).toBeDefined();
    expect(bottomTransition).toBeDefined();
    expect(completionTransition).toBeDefined();
    expect(rep.diagnostics?.metrics.tDown.value).toBeCloseTo(
      ((bottomTransition!.timestamp - startTransition!.timestamp) / 1000),
      5,
    );
    expect(rep.diagnostics?.metrics.tUp.value).toBeCloseTo(
      ((completionTransition!.timestamp - bottomTransition!.timestamp) / 1000),
      5,
    );
    expect(rep.completedAt).toBe(completionTransition!.timestamp);
  });

  it('counts a near-depth full rep while still exposing depth feedback', () => {
    const result = replayRecording(
      pushupDefinition,
      buildRecording('synthetic near-depth counted pushup', nearDepthFullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Go deeper — aim for elbows at 90 degrees.');
    expect(result.reps[0].diagnostics?.cues['push-up.depth_short'].triggered).toBe(true);
  });

  it('counts a near-lockout full rep while still exposing lockout feedback', () => {
    const result = replayRecording(
      pushupDefinition,
      buildRecording('synthetic near-lockout counted pushup', nearLockoutFullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Lock out your arms fully at the top.');
    expect(result.reps[0].diagnostics?.cues['push-up.lockout_short'].triggered).toBe(true);
  });

  it('does not let invalid idle setup seed first-rep lockout', () => {
    const result = replayRecording(pushupDefinition, invalidSetupThenNearLockoutFullRepRecording());

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Lock out your arms fully at the top.');
    expect(result.reps[0].diagnostics?.cues['push-up.lockout_short'].triggered).toBe(true);
  });

  it('marks counted reps unscorable with a side-view warning when setup degrades during the rep', () => {
    const frontishDuringRep = withKeypointUpdates(
      buildRecording('synthetic front-ish pushup during active rep', fullRepPath()),
      (point, index) => {
        if (index >= 22 && index < 94 && (point.name === 'right_shoulder' || point.name === 'right_hip')) {
          return { ...point, x: 0.75, score: 0.99 };
        }
        return point;
      },
    );

    const result = replayRecording(pushupDefinition, frontishDuringRep, { confidenceGating: true });

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('unknown');
    expect(result.feedbackMessages[0]).toContain('Turn side-on');
  });

  it('does not duplicate endpoint ROM diagnostics with fallback incomplete_rom', () => {
    const diagnosticVariant = pushupDefinition.createVariant?.({
      thresholds: {
        PLANK_REENTER: 0.92,
        PARTIAL_REP_RESET: 0.925,
      },
    });
    expect(diagnosticVariant).toBeDefined();

    const result = replayRecording(
      diagnosticVariant!,
      buildRecording('synthetic endpoint-limited partial pushup', lowLockoutHalfRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].diagnostics?.cues['push-up.depth_short'].triggered).toBe(true);
    expect(result.reps[0].diagnostics?.cues['push-up.lockout_short'].triggered).toBe(true);
    expect(result.reps[0].diagnostics?.cues['push-up.incomplete_rom'].triggered).toBe(false);
  });

  it('flags persistent shoulder and wrist misalignment as low-priority form feedback', () => {
    const clean = replayRecording(
      pushupDefinition,
      buildRecording('synthetic clean pushup for shoulder stack comparison', fullRepPath()),
    );
    const result = replayRecording(
      pushupDefinition,
      buildRecording('synthetic shoulder wrist offset pushup', fullRepPath(), {
        wristShiftX: 0.09,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Stack your shoulders over your hands.');
    expect(result.feedbackMessages).not.toContain('Set the camera side-on with your full body in frame.');
    expect(result.reps[0].diagnostics?.cues['push-up.shoulder_stack'].triggered).toBe(true);
    expect(result.reps[0].diagnostics?.cues['push-up.camera_setup'].triggered).toBe(false);
  });

  it('does not flag shoulder stack from a low-confidence image wrist', () => {
    const recording = withExplicitImageAndWorld(
      buildRecording('synthetic pushup with low-confidence shifted image wrist', fullRepPath()),
    );
    const shiftedLowConfidenceImageWrist = {
      ...recording,
      frames: recording.frames.map((frame, index) => index >= 22 && index <= 94
        ? {
            ...frame,
            imageKeypoints: frame.imageKeypoints?.map(point => (
              point.name === 'left_wrist'
                ? { ...point, x: point.x + 0.09, score: 0.05 }
                : point
            )),
          }
        : frame),
    };

    const result = replayRecording(pushupDefinition, shiftedLowConfidenceImageWrist);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Stack your shoulders over your hands.');
    expect(result.reps[0].diagnostics?.cues['push-up.shoulder_stack'].triggered).toBe(false);
  });

  it.each<PushupOrientation>(['facing-right', 'facing-left'])(
    'flags hip sag consistently when %s',
    orientation => {
      const result = replayRecording(
        pushupDefinition,
        buildRecordingWithPostureDuringRep(`synthetic sag pushup ${orientation}`, fullRepPath(), 'sag', orientation),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.feedbackMessages.join('\n')).toContain('Hips are sagging');
      expect(result.reps[0].diagnostics?.cues['push-up.hip_sag'].triggered).toBe(true);
    },
  );

  it('flags body-line feedback with explicit image and world landmark sources', () => {
    const result = replayRecording(
      pushupDefinition,
      withExplicitImageAndWorld(
        buildRecordingWithPostureDuringRep(
          'synthetic sag explicit-source pushup',
          fullRepPath(),
          'sag',
          'facing-right',
        ),
      ),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages.join('\n')).toContain('Hips are sagging');
    expect(result.reps[0].diagnostics?.cues['push-up.hip_sag'].triggered).toBe(true);
  });

  it.each<PushupOrientation>(['facing-right', 'facing-left'])(
    'flags hip pike consistently when %s',
    orientation => {
      const result = replayRecording(
        pushupDefinition,
        buildRecordingWithPostureDuringRep(`synthetic pike pushup ${orientation}`, fullRepPath(), 'pike', orientation),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.feedbackMessages.join('\n')).toContain('Hips are piking');
      expect(result.reps[0].diagnostics?.cues['push-up.hip_pike'].triggered).toBe(true);
    },
  );

  it('flags head position without punishing neutral neck alignment', () => {
    const clean = replayRecording(
      pushupDefinition,
      buildRecording('synthetic neutral head pushup', fullRepPath()),
    );
    const dropped = replayRecording(
      pushupDefinition,
      buildRecording('synthetic dropped head pushup', fullRepPath(), { headPosture: 'dropped' }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your head neutral — align your neck with your spine.');
    expect(dropped.finalRepCount).toBe(1);
    expect(dropped.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(dropped.feedbackMessages).toContain('Keep your head neutral — align your neck with your spine.');
    expect(dropped.reps[0].diagnostics?.cues['push-up.head_position'].triggered).toBe(true);
  });

  it('does not create hip or head feedback from low-confidence body landmarks', () => {
    const noisy = buildRecordingWithPostureDuringRep(
      'synthetic low-confidence sagging dropped-head pushup',
      fullRepPath(),
      'sag',
      'facing-right',
    );
    const droppedNose = nosePoint(bodyPoints('facing-right', 'sag').shoulder, 'facing-right', 'dropped');
    noisy.frames = noisy.frames.map((frame, index) => index >= 22 && index <= 94
      ? {
          ...frame,
          keypoints: frame.keypoints.map(point => (
            point.name === 'nose'
              ? { ...point, x: droppedNose.x, y: droppedNose.y, score: 0.25 }
              : point.name.includes('_hip') || point.name.includes('_ankle')
              ? { ...point, score: 0.25 }
              : point
          )),
        }
      : frame);

    const result = replayRecording(pushupDefinition, noisy);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages.join('\n')).not.toContain('Hips are sagging');
    expect(result.feedbackMessages).not.toContain('Keep your head neutral — align your neck with your spine.');
    expect(result.reps[0].diagnostics?.scorable).toBe(false);
    expect(result.reps[0].diagnostics?.metrics.bodyJudgeableRate.value).toBeLessThan(0.6);
    expect(result.reps[0].diagnostics?.metrics.headJudgeableRate.value).toBeLessThan(0.6);
  });

  it('counts and scores reps with hidden head tracking while skipping the optional head cue', () => {
    const hiddenHead = withKeypointUpdates(
      buildRecording('synthetic hidden head during pushup', fullRepPath()),
      (point, index) => index >= 22 && index <= 94 && point.name === 'nose'
        ? { ...point, score: 0.05 }
        : point,
    );

    const result = replayRecording(pushupDefinition, hiddenHead, { confidenceGating: true });

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].diagnostics?.scorable).toBe(true);
    expect(result.reps[0].diagnostics?.metrics.headJudgeableRate.value).toBeLessThan(0.6);
    expect(result.reps[0].diagnostics?.cues['push-up.head_position'].eligible).toBe(false);
    expect(result.feedbackMessages).not.toContain("I couldn't judge your form there.");
  });

  it('keeps the active side locked through a rep even if visibility flips', () => {
    const result = replayRecordingVerbose(
      pushupDefinition,
      buildRecording('synthetic pushup side visibility flip', fullRepPath(), {
        side: 'left',
        sideSwitchFrame: 34,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => trace.phase !== 'IDLE' && trace.phase !== 'PLANK');
    expect(activeFrames.every(trace => trace.debugInfo.side === 'left')).toBe(true);
  });

  it('still flags a true fast descent', () => {
    const result = replayRecording(
      pushupDefinition,
      buildRecording('synthetic fast descent pushup', fastDescentPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Control the descent — don't drop into the pushup.");
    expect(result.reps[0].diagnostics?.cues['push-up.tempo_down'].triggered).toBe(true);
  });

  it('preserves top lockout for immediate consecutive reps without a top hold', () => {
    const result = replayRecording(
      pushupDefinition,
      buildRecording('synthetic immediate consecutive pushups', immediateConsecutiveRepPath()),
    );

    expect(result.finalRepCount).toBe(2);
    expect(result.feedbackMessages).not.toContain('Lock out your arms fully at the top.');
    expect(result.reps.map(rep => rep.diagnostics?.cues['push-up.lockout_short'].triggered)).toEqual([false, false]);
  });
});
