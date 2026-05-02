import { legExtensionsDefinition } from '../definitions/legExtensions';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type Posture = 'upright' | 'leaned' | 'hip-lift';

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

function poseAt(progress: number, orientation: Orientation, posture: Posture) {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const shoulder = lerpPoint(BENT.shoulder, EXTENDED.shoulder, progress, mirror);
  const hip = lerpPoint(BENT.hip, EXTENDED.hip, progress, mirror);
  const knee = lerpPoint(BENT.knee, EXTENDED.knee, progress, mirror);
  const ankle = lerpPoint(BENT.ankle, EXTENDED.ankle, progress, mirror);

  if (posture === 'leaned') {
    shoulder.x += 0.45 * mirror;
  }

  if (posture === 'hip-lift') {
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
): Keypoint[] {
  const pose = poseAt(progress, orientation, posture);
  const offset = side === 'left' ? -0.015 : 0.015;
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
): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints('left', progress, orientation, posture, leftScore),
      ...sideKeypoints('right', progress, orientation, posture, rightScore),
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
): LandmarkRecording['frames'][number] {
  return side === 'left'
    ? makeFrameWithScores(timestamp, progress, orientation, posture, 0.99, hiddenSideScore)
    : makeFrameWithScores(timestamp, progress, orientation, posture, hiddenSideScore, 0.99);
}

function buildRecording(
  description: string,
  path: number[],
  options: {
    side?: Side;
    orientation?: Orientation;
    posture?: Posture | ((index: number) => Posture);
    sideSwitchFrame?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'upright',
    sideSwitchFrame,
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
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        return side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.7, 0.99)
          : makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.99, 0.7);
      }
      return makeFrame(index * FRAME_MS, progress, side, orientation, framePosture);
    }),
  };
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
    },
  );

  it('does not count a tiny leg-extension pulse', () => {
    const result = replayRecordingVerbose(
      legExtensionsDefinition,
      buildRecording('synthetic tiny leg-extension pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial leg extension and records ROM feedback', () => {
    const clean = replayRecording(legExtensionsDefinition, buildRecording('synthetic clean leg extension', fullRepPath()));
    const result = replayRecording(legExtensionsDefinition, buildRecording('synthetic half leg extension', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Extend fully — straighten your legs completely at the top.');
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

  it('flags torso lean without punishing an upright setup', () => {
    const clean = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic upright leg extension', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic leaned leg extension', fullRepPath(), {
        posture: index => (index < 16 ? 'upright' : 'leaned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your back against the pad — avoid leaning forward.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Keep your back against the pad — avoid leaning forward.');
  });

  it('still flags a true fast return', () => {
    const result = replayRecording(
      legExtensionsDefinition,
      buildRecording('synthetic fast return leg extension', fastReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Control the return — don't let the weight drop.");
  });
});
