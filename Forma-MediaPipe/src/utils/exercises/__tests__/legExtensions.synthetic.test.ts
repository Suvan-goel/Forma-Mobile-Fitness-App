import { legExtensionsDefinition } from '../definitions/legExtensions';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type Posture = 'upright' | 'leaned' | 'more-leaned' | 'hip-lift' | 'hip-rise';

type Point = { x: number; y: number };

const FRAME_MS = 50;

const BENT = {
  shoulder: { x: 0, y: 0.08 },
  hip: { x: 0, y: 0.6 },
  knee: { x: 0.45, y: 0.7 },
  ankle: { x: 0.18, y: 1.02 },
};

const EXTENDED = {
  shoulder: { x: 0, y: 0.08 },
  hip: { x: 0, y: 0.6 },
  knee: { x: 0.45, y: 0.7 },
  ankle: { x: 0.9, y: 0.8 },
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
    ...interpolate(0, 1, 26),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 58),
    ...Array(8).fill(0),
  ];
}

function loweringOnlyFromExtendedPath(): number[] {
  return [
    ...Array(16).fill(1),
    ...interpolate(1, 0, 58),
    ...Array(8).fill(0),
  ];
}

function borderlineBentFullRepPath(): number[] {
  return [
    ...Array(16).fill(0.1),
    ...interpolate(0.1, 1, 26),
    ...Array(4).fill(1),
    ...interpolate(1, 0.1, 58),
    ...Array(8).fill(0.1),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.12, 8),
    ...interpolate(0.12, 0, 8),
    ...Array(8).fill(0),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.50, 16),
    ...interpolate(0.50, 0, 20),
    ...Array(8).fill(0),
  ];
}

function shallowKneePartialPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.2, 14),
    ...interpolate(0.2, 0, 20),
    ...Array(8).fill(0),
  ];
}

function fastReturnPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 26),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 4),
    ...Array(8).fill(0),
  ];
}

function fastNoHoldPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 18),
    ...interpolate(0.98, 0, 58),
    ...Array(8).fill(0),
  ];
}

function bounceThroughPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.99, 28),
    1,
    0.82,
    ...interpolate(0.82, 0, 50),
    ...Array(8).fill(0),
  ];
}

function earlyFsmSlowLockoutPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.5, 4),
    ...interpolate(0.5, 1, 60),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 58),
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
  const shoulder = lerpPoint(BENT.shoulder, EXTENDED.shoulder, progress, mirror);
  const hip = lerpPoint(BENT.hip, EXTENDED.hip, progress, mirror);
  const knee = lerpPoint(BENT.knee, EXTENDED.knee, progress, mirror);
  const ankle = lerpPoint(BENT.ankle, EXTENDED.ankle, progress, mirror);

  if (posture === 'leaned') {
    shoulder.x += 0.45 * mirror;
  }

  if (posture === 'more-leaned') {
    shoulder.x += 2.0 * mirror;
  }

  if (posture === 'hip-lift') {
    hip.y -= 0.14;
  }

  if (posture === 'hip-rise') {
    shoulder.y -= 0.14;
    hip.y -= 0.14;
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
  const offset = side === 'left' ? -sideOffset : sideOffset;
  const withOffset = (point: Point) => ({ x: point.x + offset, y: point.y });

  return [
    kp(`${side}_shoulder`, withOffset(pose.shoulder), score),
    kp(`${side}_hip`, withOffset(pose.hip), score),
    kp(`${side}_knee`, withOffset(pose.knee), score),
    kp(`${side}_ankle`, withOffset(pose.ankle), score),
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
    distortedWorld?: boolean;
    shoulderScore?: number;
    sideOffset?: number;
    keypointMutator?: (keypoint: Keypoint, index: number, progress: number) => Keypoint;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'upright',
    sideSwitchFrame,
    distortedWorld = false,
    shoulderScore,
    sideOffset = 0.015,
    keypointMutator,
  } = options;

  return {
    exerciseName: 'Leg Extensions',
    metadata: {
      recordedAt: '2026-04-30T00:00:00.000Z',
      duration: (path.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: path.map((progress, index) => {
      const framePosture = typeof posture === 'function' ? posture(index) : posture;
      let frame: LandmarkRecording['frames'][number];
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        frame = side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.7, 0.99, sideOffset)
          : makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.99, 0.7, sideOffset);
      } else {
        frame = makeFrame(index * FRAME_MS, progress, side, orientation, framePosture, 0.3, sideOffset);
      }

      if (shoulderScore !== undefined) {
        frame.keypoints = frame.keypoints.map(keypoint =>
          keypoint.name.includes('_shoulder') ? { ...keypoint, score: shoulderScore } : keypoint,
        );
      }

      if (keypointMutator) {
        frame.keypoints = frame.keypoints.map(keypoint => keypointMutator(keypoint, index, progress));
      }

      if (distortedWorld) {
        const worldFrame = makeFrame(index * FRAME_MS, 0, side, orientation, 'upright', 0.3, sideOffset);
        return {
          timestamp: frame.timestamp,
          keypoints: worldFrame.keypoints,
          worldKeypoints: worldFrame.keypoints,
          imageKeypoints: frame.keypoints,
        };
      }

      return frame;
    }),
  };
}

function buildSegmentedRecording(
  description: string,
  segments: Array<{ path: number[]; gapAfterMs?: number }>,
  options: Parameters<typeof buildRecording>[2] = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'upright',
    sideSwitchFrame,
    distortedWorld = false,
    shoulderScore,
    sideOffset = 0.015,
    keypointMutator,
  } = options;
  const frames: LandmarkRecording['frames'] = [];
  let timestamp = 0;
  let frameIndex = 0;

  for (const segment of segments) {
    for (const progress of segment.path) {
      const framePosture = typeof posture === 'function' ? posture(frameIndex) : posture;
      let frame: LandmarkRecording['frames'][number];
      if (sideSwitchFrame !== undefined && frameIndex >= sideSwitchFrame) {
        frame = side === 'left'
          ? makeFrameWithScores(timestamp, progress, orientation, framePosture, 0.7, 0.99, sideOffset)
          : makeFrameWithScores(timestamp, progress, orientation, framePosture, 0.99, 0.7, sideOffset);
      } else {
        frame = makeFrame(timestamp, progress, side, orientation, framePosture, 0.3, sideOffset);
      }

      if (shoulderScore !== undefined) {
        frame.keypoints = frame.keypoints.map(keypoint =>
          keypoint.name.includes('_shoulder') ? { ...keypoint, score: shoulderScore } : keypoint,
        );
      }

      if (keypointMutator) {
        frame.keypoints = frame.keypoints.map(keypoint => keypointMutator(keypoint, frameIndex, progress));
      }

      if (distortedWorld) {
        const worldFrame = makeFrame(timestamp, 0, side, orientation, 'upright', 0.3, sideOffset);
        frames.push({
          timestamp: frame.timestamp,
          keypoints: worldFrame.keypoints,
          worldKeypoints: worldFrame.keypoints,
          imageKeypoints: frame.keypoints,
        });
      } else {
        frames.push(frame);
      }

      timestamp += FRAME_MS;
      frameIndex++;
    }

    if (segment.gapAfterMs !== undefined) {
      timestamp += Math.max(0, segment.gapAfterMs - FRAME_MS);
    }
  }

  return {
    exerciseName: 'Leg Extensions',
    metadata: {
      recordedAt: '2026-04-30T00:00:00.000Z',
      duration: timestamp / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames,
  };
}

function buildMultiRepRecording(
  description: string,
  repCount: number,
  gapsAfterRep: Record<number, number> = {},
): LandmarkRecording {
  return buildSegmentedRecording(
    description,
    Array.from({ length: repCount }, (_, repIndex) => ({
      path: fullRepPath(),
      gapAfterMs: gapsAfterRep[repIndex],
    })),
  );
}

function buildInterruptedMidRepRecording(): LandmarkRecording {
  return buildSegmentedRecording('synthetic interrupted mid-rep leg extension with recovery', [
    {
      path: [
        ...Array(16).fill(0),
        ...interpolate(0, 0.5, 16),
      ],
      gapAfterMs: 6000,
    },
    {
      path: [
        ...Array(16).fill(0),
        ...fullRepPath(),
      ],
    },
  ]);
}

describe('Leg Extension synthetic replay coverage', () => {
  it.each<Orientation>(['facing-right', 'facing-left'])(
    'counts a clean full rep when %s',
    orientation => {
      const result = replayRecording(
        legExtensionsDefinition,
        buildRecording(`synthetic clean leg extension ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
      expect(result.reps[0].scorable).toBe(true);
      expect(result.reps[0].qualityWarnings ?? []).not.toContain('side_view_uncertain');
      expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('side_confirmed');
      expect(result.reps[0].diagnostics?.metrics.kneeExtensionAngle.value).toBeGreaterThan(160);
      expect(result.reps[0].diagnostics?.metrics.hipRiseRatio.value).toBeGreaterThanOrEqual(0);
      expect(result.reps[0].diagnostics?.metrics.topHoldMs.value).toBeGreaterThanOrEqual(100);
    },
  );

  it('counts front-ish leg extensions but marks them unscorable for side-view uncertainty', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic front-ish leg extension', fullRepPath(), { sideOffset: 0.25 }),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.feedbackMessages[0]).toContain('Turn side-on so I can judge your form.');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('frontish_confirmed');
    expect(result.reps[0].diagnostics?.metrics.sideViewConfidence.value).toBeLessThan(0.45);
  });

  it('keeps one clear side-view leg chain scorable when the far side is hidden', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic one-sided leg extension', fullRepPath(), {
        keypointMutator: keypoint => (
          keypoint.name.startsWith('right_') ? { ...keypoint, score: 0.05 } : keypoint
        ),
      }),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings ?? []).not.toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('side');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('side_confirmed');
    expect(result.reps[0].diagnostics?.viewQuality?.sampleCount).toBeGreaterThanOrEqual(5);
  });

  it('uses image landmarks for leg-extension motion when world landmarks are distorted', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic clean leg extension with distorted world landmarks', fullRepPath(), {
        distortedWorld: true,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('does not count when the clip starts extended and only lowers to rest', () => {
    const result = replayRecordingVerbose(
      legExtensionsDefinition,
      buildRecording('synthetic lowering-only leg extension from lockout', loweringOnlyFromExtendedPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('does not count a tiny leg-extension pulse', () => {
    const result = replayRecordingVerbose(
      legExtensionsDefinition,
      buildRecording('synthetic tiny leg-extension pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('does not let a one-frame ankle spike rescue a short-lockout rep', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic short lockout with one noisy ankle spike', halfRepPath(), {
        keypointMutator: (keypoint, index) => (
          index === 25 && keypoint.name === 'left_ankle'
            ? { ...keypoint, x: EXTENDED.ankle.x - 0.015, y: EXTENDED.ankle.y }
            : keypoint
        ),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Extend fully — straighten your legs completely at the top.');
    expect(result.reps[0].diagnostics?.metrics.extensionRatioRaw.value).toBeGreaterThanOrEqual(0.93);
    expect(result.reps[0].diagnostics?.metrics.extensionRatio.value).toBeLessThan(0.93);
  });

  it('does not let a one-frame knee-angle spike rescue a short-lockout rep', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic short lockout with one noisy knee-angle spike', halfRepPath(), {
        keypointMutator: (keypoint, index) => (
          index === 26 && keypoint.name === 'left_ankle'
            ? { ...keypoint, x: EXTENDED.ankle.x - 0.015, y: EXTENDED.ankle.y }
            : keypoint
        ),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Extend fully — straighten your legs completely at the top.');
    expect(result.reps[0].diagnostics?.metrics.kneeExtensionAngleRaw.value).toBeGreaterThan(160);
    expect(result.reps[0].diagnostics?.metrics.kneeExtensionAngle.value).toBeLessThan(160);
  });

  it('lets robust ROM override a sustained raw lockout artifact on a short-lockout rep', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic short lockout with sustained raw lockout artifact', halfRepPath(), {
        keypointMutator: (keypoint, index) => (
          index >= 25 && index < 28 && keypoint.name === 'left_ankle'
            ? { ...keypoint, x: EXTENDED.ankle.x - 0.015, y: EXTENDED.ankle.y }
            : keypoint
        ),
      }),
    );
    const diagnostics = result.reps[0].diagnostics;

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages[0]).toBe('Extend fully — straighten your legs completely at the top.');
    expect(result.feedbackMessages).toContain('Extend fully — straighten your legs completely at the top.');
    expect(result.feedbackMessages).not.toContain('Pause briefly at full extension.');
    expect(diagnostics?.metrics.extensionRatioRaw.value).toBeGreaterThanOrEqual(0.93);
    expect(diagnostics?.metrics.kneeExtensionAngleRaw.value).toBeGreaterThan(160);
    expect(diagnostics?.metrics.extensionRatio.value).toBeLessThan(0.93);
    expect(diagnostics?.metrics.kneeExtensionAngle.value).toBeLessThan(160);
    expect(diagnostics?.metrics.tExtend.value).not.toBeNull();
    expect(diagnostics?.cues['leg-extensions.lockout_short'].triggered).toBe(true);
    expect(diagnostics?.cues['leg-extensions.lockout_short'].thresholdPath).toEqual([
      'formThresholds.EXTENSION_FAIL',
      'formThresholds.KNEE_EXTENSION_FAIL',
    ]);
  });

  it('does not add a top-hold score penalty when lockout is already short', () => {
    const recording = buildRecording('synthetic short lockout with sustained raw lockout artifact', halfRepPath(), {
      keypointMutator: (keypoint, index) => (
        index >= 25 && index < 28 && keypoint.name === 'left_ankle'
          ? { ...keypoint, x: EXTENDED.ankle.x - 0.015, y: EXTENDED.ankle.y }
          : keypoint
      ),
    });
    const defaultResult = replayRecording(legExtensionsDefinition, recording);
    const noTopHoldPenalty = replayRecording(
      legExtensionsDefinition,
      recording,
      { heuristicConfig: { penaltyConfigs: { TOP_HOLD: { cap: 0 } } } },
    );

    expect(defaultResult.feedbackMessages).toContain('Extend fully — straighten your legs completely at the top.');
    expect(defaultResult.feedbackMessages).not.toContain('Pause briefly at full extension.');
    expect(defaultResult.repScores[0]).toBe(noTopHoldPenalty.repScores[0]);
  });

  it('counts a meaningful partial leg extension and records ROM feedback', () => {
    const clean = replayRecording(legExtensionsDefinition, buildRecording('synthetic clean leg extension', fullRepPath()));
    const result = replayRecording(legExtensionsDefinition, buildRecording('synthetic half leg extension', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Extend fully — straighten your legs completely at the top.');
    expect(result.reps[0].diagnostics?.metrics.kneeExtensionAngle.value).toBeLessThan(160);
  });

  it('uses knee-angle lockout support to avoid a ratio-only false positive', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic ratio threshold stricter than knee lockout', fullRepPath()),
      { heuristicConfig: { formThresholds: { EXTENSION_FAIL: 1.01 } } },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Extend fully — straighten your legs completely at the top.');
  });

  it('uses knee-angle bottom support to avoid a ratio-only bottom-ROM false positive', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic flexion ratio threshold stricter than knee bend', fullRepPath()),
      { heuristicConfig: { formThresholds: { FLEXION_FAIL: 0.45 } } },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Lower the weight more — start from a deeper bend.');
  });

  it('keeps the visible side locked through a rep when visibility flips', () => {
    const result = replayRecordingVerbose(
      legExtensionsDefinition,
      buildRecording('synthetic leg extension side visibility flip', fullRepPath(), {
        side: 'left',
        sideSwitchFrame: 30,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => trace.phase !== 'REST');
    expect(activeFrames.every(trace => trace.debugInfo.side === 'left')).toBe(true);
  });

  it('keeps clean four-rep leg extensions unchanged with normal frame intervals', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildMultiRepRecording('synthetic clean four leg extensions', 4),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it.each([200, 700])('keeps leg extension counting unchanged for a %sms frame gap', (gapMs) => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildMultiRepRecording(`synthetic four leg extensions with ${gapMs}ms gap`, 4, { 1: gapMs }),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it('does not add a false leg extension rep across a long silent gap between reps', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildMultiRepRecording('synthetic four leg extensions with walk-out gap', 4, { 1: 6000 }),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it('does not complete a stale active leg extension rep after a long silent gap', () => {
    const result = replayRecordingVerbose(
      legExtensionsDefinition,
      buildInterruptedMidRepRecording(),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repTraces).toHaveLength(1);
  });

  it('counts a real leg extension after a long gap once stable frames rebuild', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildSegmentedRecording('synthetic long gap then clean leg extension', [
        { path: Array(20).fill(0), gapAfterMs: 6000 },
        { path: fullRepPath() },
      ]),
    );

    expect(result.finalRepCount).toBe(1);
  });

  it('flags hip lift without punishing seated hips', () => {
    const clean = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic seated leg extension', fullRepPath(), { posture: 'upright' }),
    );
    const hipLift = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic hip lift leg extension', fullRepPath(), {
        posture: index => (index >= 20 && index < 60 ? 'hip-lift' : 'upright'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain("Keep your hips on the seat — don't lift off the pad.");
    expect(hipLift.finalRepCount).toBe(1);
    expect(hipLift.feedbackMessages).toContain("Keep your hips on the seat — don't lift off the pad.");
  });

  it('ignores one-frame hip and torso compensation spikes', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic leg extension with one-frame compensation spikes', fullRepPath(), {
        posture: index => (index === 30 ? 'leaned' : index === 31 ? 'hip-rise' : 'upright'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Keep your back against the pad — avoid leaning forward.');
    expect(result.feedbackMessages).not.toContain("Keep your hips on the seat — don't lift off the pad.");
    expect(result.reps[0].diagnostics?.metrics.torsoDeviationRaw.value).toBeGreaterThan(30);
    expect(result.reps[0].diagnostics?.metrics.torsoDeviation.value).toBeLessThanOrEqual(30);
  });

  it('flags torso lean without punishing an upright setup', () => {
    const clean = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic upright leg extension', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic leaned leg extension', fullRepPath(), {
        posture: index => (index < 30 ? 'upright' : 'leaned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your back against the pad — avoid leaning forward.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Keep your back against the pad — avoid leaning forward.');
  });

  it('uses REST baselines so the first active frame cannot hide torso movement', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic torso lean from the first active frame', fullRepPath(), {
        posture: index => (index < 16 ? 'upright' : 'leaned'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your back against the pad — avoid leaning forward.');
    expect(result.reps[0].diagnostics?.metrics.torsoBaselineSource.label).toBe('rest');
    expect(result.reps[0].diagnostics?.metrics.baselineSampleCount.value).toBeGreaterThanOrEqual(5);
  });

  it('uses REST baselines from a borderline bent setup above the extension clock threshold', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic borderline bent setup with immediate torso lean', borderlineBentFullRepPath(), {
        posture: index => (index < 16 ? 'upright' : 'leaned'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your back against the pad — avoid leaning forward.');
    expect(result.reps[0].diagnostics?.metrics.torsoBaselineSource.label).toBe('rest');
    expect(result.reps[0].diagnostics?.metrics.baselineSampleCount.value).toBeGreaterThanOrEqual(5);
  });

  it('does not warn for an already leaned setup unless the torso moves farther', () => {
    const leanedSetup = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic already leaned leg extension setup', fullRepPath(), {
        posture: 'leaned',
      }),
    );
    const movesFarther = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic leaned setup that moves farther', fullRepPath(), {
        posture: index => (index < 30 ? 'leaned' : 'more-leaned'),
      }),
    );

    expect(leanedSetup.finalRepCount).toBe(1);
    expect(leanedSetup.feedbackMessages).not.toContain('Keep your back against the pad — avoid leaning forward.');
    expect(movesFarther.finalRepCount).toBe(1);
    expect(movesFarther.feedbackMessages).toContain('Keep your back against the pad — avoid leaning forward.');
  });

  it('still flags a true fast return', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic fast return leg extension', fastReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Control the return — don't let the weight drop.");
  });

  it('does not flag fast extension when only the early FSM extension threshold is reached quickly', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic fast early extension with slow true lockout', earlyFsmSlowLockoutPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Slow down the extension — control the lift.');
  });

  it('applies a tempo score penalty whenever tempo feedback fires', () => {
    const strictTempo = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic fast return leg extension with default tempo', fastReturnPath()),
    );
    const relaxedTempo = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic fast return leg extension with relaxed tempo', fastReturnPath()),
      { heuristicConfig: { formThresholds: { TEMPO_RETURN_MIN: 0.05 } } },
    );

    expect(strictTempo.feedbackMessages).toContain("Control the return — don't let the weight drop.");
    expect(relaxedTempo.feedbackMessages).not.toContain("Control the return — don't let the weight drop.");
    expect(strictTempo.repScores[0]).toBeLessThan(relaxedTempo.repScores[0]);
  });

  it('confirms sustained lockout by elapsed time and records lockout tempo', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic sustained lockout', bounceThroughPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].diagnostics?.metrics.tExtend.value).not.toBeNull();
    expect(result.reps[0].diagnostics?.metrics.topHoldMs.value).toBeLessThan(120);
  });

  it('flags bounce-through lockout but not a brief controlled hold', () => {
    const bounce = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic bounce-through leg extension', bounceThroughPath()),
    );
    const held = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic held leg extension', fullRepPath()),
    );

    expect(bounce.finalRepCount).toBe(1);
    expect(bounce.feedbackMessages).toContain('Pause briefly at full extension.');
    expect(held.feedbackMessages).not.toContain('Pause briefly at full extension.');
  });

  it('flags near-peak movement with no stable dwell as a short top hold', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic no-hold top position leg extension', fastNoHoldPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Pause briefly at full extension.');
  });

  it('detects normalized hip rise even when the torso angle is mostly preserved', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic hip-rise leg extension', fullRepPath(), {
        posture: index => (index >= 30 && index < 60 ? 'hip-rise' : 'upright'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Keep your hips on the seat — don't lift off the pad.");
    expect(result.reps[0].diagnostics?.metrics.hipRiseRatio.value).toBeGreaterThan(0.04);
    expect(result.reps[0].diagnostics?.metrics.hipDeltaRaw.value).toBeGreaterThanOrEqual(
      result.reps[0].diagnostics?.metrics.hipDelta.value ?? 0,
    );
  });

  it('uses knee ROM to reject shallow partial reps even when ratio ROM is noisy', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic shallow knee partial leg extension', shallowKneePartialPath()),
    );

    expect(result.finalRepCount).toBe(0);
  });

  it('uses knee ROM to count a partial rep when ratio ROM is configured borderline', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic knee-supported partial leg extension', halfRepPath()),
      { heuristicConfig: { thresholds: { MIN_PARTIAL_ROM: 0.5 } } },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Extend fully — straighten your legs completely at the top.');
  });

  it('gates form scoring when shoulder context is hidden through the rep', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic leg extension with hidden shoulders', fullRepPath(), {
        shoulderScore: 0.05,
      }),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.feedbackMessages[0]).toContain("I couldn't judge your form there.");
  });
});
