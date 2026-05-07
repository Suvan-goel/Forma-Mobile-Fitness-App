import { cablePushdownDefinition } from '../definitions/cablePushdown';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type Posture = 'upright' | 'slightLean' | 'leaned';
type ElbowPosition = 'pinned' | 'forward' | 'drifted';

type Point = { x: number; y: number };

const FRAME_MS = 50;

const BENT = {
  shoulder: { x: 0, y: 0.42 },
  elbow: { x: 0, y: 0.72 },
  wrist: { x: 0.32, y: 0.62 },
  hip: { x: 0, y: 1.05 },
};

const EXTENDED = {
  shoulder: { x: 0, y: 0.42 },
  elbow: { x: 0, y: 0.72 },
  wrist: { x: 0, y: 1.02 },
  hip: { x: 0, y: 1.05 },
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
    ...interpolate(1, 0, 38),
    ...Array(8).fill(0),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.22, 8),
    ...interpolate(0.22, 0, 8),
    ...Array(8).fill(0),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.62, 14),
    ...interpolate(0.62, 0, 18),
    ...Array(8).fill(0),
  ];
}

function shallowTopFullRepPath(): number[] {
  return [
    ...Array(16).fill(0.35),
    ...interpolate(0.35, 1, 26),
    ...Array(4).fill(1),
    ...interpolate(1, 0.35, 38),
    ...Array(8).fill(0.35),
  ];
}

function staticShallowTopPath(): number[] {
  return Array(80).fill(0.35);
}

function briefLockoutPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.2, 12),
    ...Array(4).fill(0.2),
    ...Array(3).fill(1),
    ...interpolate(1, 0, 4),
    ...Array(42).fill(0),
  ];
}

function fastPushPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 4),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 38),
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

function lerpPoint(a: Point, b: Point, t: number, mirror: number): Point {
  return {
    x: (a.x + (b.x - a.x) * t) * mirror,
    y: a.y + (b.y - a.y) * t,
  };
}

function poseAt(
  progress: number,
  orientation: Orientation,
  posture: Posture,
  elbowPosition: ElbowPosition,
) {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const shoulder = lerpPoint(BENT.shoulder, EXTENDED.shoulder, progress, mirror);
  const elbow = lerpPoint(BENT.elbow, EXTENDED.elbow, progress, mirror);
  const wrist = lerpPoint(BENT.wrist, EXTENDED.wrist, progress, mirror);
  const hip = lerpPoint(BENT.hip, EXTENDED.hip, progress, mirror);

  if (posture === 'slightLean') {
    shoulder.x += 0.08 * mirror;
  } else if (posture === 'leaned') {
    shoulder.x += 0.18 * mirror;
  }

  if (elbowPosition === 'forward') {
    elbow.x += 0.16 * mirror;
    wrist.x += 0.16 * mirror;
  } else if (elbowPosition === 'drifted') {
    elbow.x += 0.18 * mirror;
    wrist.x += 0.18 * mirror;
  }

  return { shoulder, elbow, wrist, hip };
}

function sideKeypoints(
  side: Side,
  progress: number,
  orientation: Orientation,
  posture: Posture,
  elbowPosition: ElbowPosition,
  score: number,
  sideGap = 0.03,
): Keypoint[] {
  const pose = poseAt(progress, orientation, posture, elbowPosition);
  const offset = side === 'left' ? -sideGap * 0.5 : sideGap * 0.5;
  const withOffset = (point: Point) => ({ x: point.x + offset, y: point.y });

  return [
    kp(`${side}_shoulder`, withOffset(pose.shoulder), score),
    kp(`${side}_elbow`, withOffset(pose.elbow), score),
    kp(`${side}_wrist`, withOffset(pose.wrist), score),
    kp(`${side}_hip`, withOffset(pose.hip), score),
  ];
}

function makeFrameWithScores(
  timestamp: number,
  progress: number,
  orientation: Orientation,
  posture: Posture,
  elbowPosition: ElbowPosition,
  leftScore: number,
  rightScore: number,
  sideGap = 0.03,
): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints('left', progress, orientation, posture, elbowPosition, leftScore, sideGap),
      ...sideKeypoints('right', progress, orientation, posture, elbowPosition, rightScore, sideGap),
    ],
  };
}

function makeFrame(
  timestamp: number,
  progress: number,
  side: Side,
  orientation: Orientation,
  posture: Posture,
  elbowPosition: ElbowPosition,
  hiddenSideScore = 0.3,
  sideGap = 0.03,
): LandmarkRecording['frames'][number] {
  return side === 'left'
    ? makeFrameWithScores(timestamp, progress, orientation, posture, elbowPosition, 0.99, hiddenSideScore, sideGap)
    : makeFrameWithScores(timestamp, progress, orientation, posture, elbowPosition, hiddenSideScore, 0.99, sideGap);
}

function buildRecording(
  description: string,
  path: number[],
  options: {
    side?: Side;
    orientation?: Orientation;
    posture?: Posture | ((index: number) => Posture);
    elbowPosition?: ElbowPosition | ((index: number) => ElbowPosition);
    sideSwitchFrame?: number;
    sideGap?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'upright',
    elbowPosition = 'pinned',
    sideSwitchFrame,
    sideGap = 0.03,
  } = options;

  return {
    exerciseName: 'Cable Pushdowns',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (path.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: path.map((progress, index) => {
      const framePosture = typeof posture === 'function' ? posture(index) : posture;
      const frameElbowPosition = typeof elbowPosition === 'function' ? elbowPosition(index) : elbowPosition;
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        return side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, frameElbowPosition, 0.7, 0.99, sideGap)
          : makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, frameElbowPosition, 0.99, 0.7, sideGap);
      }
      return makeFrame(index * FRAME_MS, progress, side, orientation, framePosture, frameElbowPosition, 0.3, sideGap);
    }),
  };
}

function buildWorldImageMismatchRecording(): LandmarkRecording {
  const dynamicImage = buildRecording('synthetic image-driven cable pushdown', fullRepPath());
  const staticWorld = buildRecording('synthetic static world cable pushdown', Array(fullRepPath().length).fill(0));
  return {
    ...dynamicImage,
    metadata: {
      ...dynamicImage.metadata,
      description: 'synthetic image/world mismatch cable pushdown',
    },
    frames: dynamicImage.frames.map((frame, index) => ({
      timestamp: frame.timestamp,
      keypoints: staticWorld.frames[index].keypoints,
      worldKeypoints: staticWorld.frames[index].keypoints,
      imageKeypoints: frame.keypoints,
    })),
  };
}

describe('Cable Pushdown synthetic replay coverage', () => {
  it.each<Orientation>(['facing-right', 'facing-left'])(
    'counts a clean full rep when %s',
    orientation => {
      const result = replayRecording(
        cablePushdownDefinition,
        buildRecording(`synthetic clean cable pushdown ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('does not count a tiny pushdown pulse', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildRecording('synthetic tiny cable pushdown pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial pushdown and records ROM feedback', () => {
    const clean = replayRecording(cablePushdownDefinition, buildRecording('synthetic clean cable pushdown', fullRepPath()));
    const result = replayRecording(cablePushdownDefinition, buildRecording('synthetic half cable pushdown', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Extend fully — lock out at the bottom of each rep.');
  });

  it('counts a shallow-top full pushdown and records top-ROM feedback', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic shallow top cable pushdown', shallowTopFullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Start with a deeper bend — bring your forearms closer to your biceps.');
  });

  it('does not start a rep while statically holding a shallow top position', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildRecording('synthetic static shallow top cable pushdown', staticShallowTopPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.fsmTransitions.every(transition => transition.toPhase !== 'EXTENDING')).toBe(true);
  });

  it('keeps the visible side locked through a rep when visibility flips', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildRecording('synthetic cable pushdown side visibility flip', fullRepPath(), {
        side: 'left',
        sideSwitchFrame: 30,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => trace.phase !== 'REST');
    expect(activeFrames.every(trace => trace.debugInfo.side === 'left')).toBe(true);
  });

  it('marks poor side-view reps unscorable and shows setup guidance', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildRecording('synthetic poor side view cable pushdown', fullRepPath(), {
        sideGap: 0.42,
      }),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.frameTraces.some(trace => trace.feedback === 'Turn side-on so I can judge your pushdown.')).toBe(true);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
  });

  it('uses image-space motion when world landmarks are static', () => {
    const result = replayRecording(cablePushdownDefinition, buildWorldImageMismatchRecording());

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
  });

  it('flags elbow drift without punishing pinned elbows', () => {
    const clean = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic pinned elbow pushdown', fullRepPath(), { elbowPosition: 'pinned' }),
    );
    const drifted = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic drifted elbow pushdown', fullRepPath(), {
        elbowPosition: index => (index >= 20 && index < 50 ? 'drifted' : 'pinned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your elbows pinned to your sides — avoid letting them drift.');
    expect(drifted.finalRepCount).toBe(1);
    expect(drifted.feedbackMessages).toContain('Keep your elbows pinned to your sides — avoid letting them drift.');
  });

  it('flags elbows that start too far forward separately from elbow drift', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic forward-elbow cable pushdown', fullRepPath(), {
        elbowPosition: 'forward',
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Start with your elbows tucked by your sides.');
  });

  it('flags torso lean without punishing upright pushdowns', () => {
    const clean = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic upright cable pushdown', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic leaned cable pushdown', fullRepPath(), {
        posture: index => (index < 16 ? 'upright' : 'leaned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Stay upright — avoid leaning into the pushdown.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Stay upright — avoid leaning into the pushdown.');
  });

  it('allows a slight static lean but flags dynamic torso rocking', () => {
    const slightLean = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic slight lean cable pushdown', fullRepPath(), { posture: 'slightLean' }),
    );
    const rocking = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic rocking cable pushdown', fullRepPath(), {
        posture: index => (index >= 34 && index < 58 ? 'leaned' : 'upright'),
      }),
    );

    expect(slightLean.finalRepCount).toBe(1);
    expect(slightLean.feedbackMessages).not.toContain('Stay upright — avoid leaning into the pushdown.');
    expect(slightLean.feedbackMessages).not.toContain('Keep your torso steady through the pushdown.');
    expect(rocking.finalRepCount).toBe(1);
    expect(rocking.feedbackMessages).toContain('Keep your torso steady through the pushdown.');
  });

  it('does not create elbow-drift or torso-lean feedback from low-confidence active frames', () => {
    const noisy = buildRecording('synthetic low-confidence cable pushdown form metrics', fullRepPath(), {
      posture: index => (index < 16 ? 'upright' : 'leaned'),
      elbowPosition: index => (index >= 20 && index < 50 ? 'drifted' : 'pinned'),
    });
    noisy.frames = noisy.frames.map((frame, index) => index >= 16
      ? { ...frame, keypoints: frame.keypoints.map(point => ({ ...point, score: 0.25 })) }
      : frame);

    const result = replayRecording(cablePushdownDefinition, noisy);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Keep your elbows pinned to your sides — avoid letting them drift.');
    expect(result.feedbackMessages).not.toContain('Stay upright — avoid leaning into the pushdown.');
  });

  it('still flags a true fast return', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic fast return cable pushdown', fastReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Control the return — don't let the weight snap back.");
  });

  it('flags a rushed push and a bouncy lockout', () => {
    const fastPush = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic fast push cable pushdown', fastPushPath()),
    );
    const bouncyLockout = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic bouncy lockout cable pushdown', briefLockoutPath()),
    );

    expect(fastPush.finalRepCount).toBe(1);
    expect(fastPush.feedbackMessages).toContain('Slow down the push — control the extension.');
    expect(bouncyLockout.finalRepCount).toBe(1);
    expect(bouncyLockout.feedbackMessages).toContain('Extend fully — lock out at the bottom of each rep.');
    expect(bouncyLockout.reps[0].diagnostics?.metrics.lockoutHoldMs.value).toBeLessThan(300);
    expect(bouncyLockout.reps[0].diagnostics?.metrics.lockoutHoldMs.value).toBeGreaterThanOrEqual(0);
  });

  it('records clear production diagnostic keys for torso and velocity support', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic diagnostic cable pushdown', fullRepPath()),
    );
    const metrics = result.reps[0].diagnostics?.metrics ?? {};

    expect(metrics.torsoDeltaFromBaseline).toBeDefined();
    expect(metrics.torsoForwardDelta).toBeUndefined();
    expect(metrics.pushVelocitySpikeRatio.sampleCount).toBeGreaterThanOrEqual(4);
    expect(metrics.returnVelocitySpikeRatio.sampleCount).toBeGreaterThanOrEqual(4);
  });
});
