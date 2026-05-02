import { cableRowDefinition } from '../definitions/cableRow';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type TorsoPosture = 'upright' | 'leaned';

type Point = { x: number; y: number; z?: number };

const FRAME_MS = 50;

const EXTENDED = {
  shoulder: { x: 0, y: 0.5, z: 0 },
  elbow: { x: 0.36, y: 0.55, z: 0 },
  wrist: { x: 0.72, y: 0.6, z: 0 },
  hip: { x: 0, y: 1.1, z: 0 },
};

const CONTRACTED = {
  shoulder: { x: 0, y: 0.5, z: 0 },
  elbow: { x: -0.18, y: 0.75, z: 0 },
  wrist: { x: 0.02, y: 0.64, z: 0 },
  hip: { x: 0, y: 1.1, z: 0 },
};

function kp(name: string, point: Point, score = 0.99): Keypoint {
  return { name, x: point.x, y: point.y, z: point.z ?? 0, score };
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
    ...interpolate(0, 1, 24),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 50),
    ...Array(8).fill(0),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.15, 8),
    ...interpolate(0.15, 0, 8),
    ...Array(8).fill(0),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.62, 16),
    ...interpolate(0.62, 0, 20),
    ...Array(8).fill(0),
  ];
}

function fastReturnPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 24),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 4),
    ...Array(8).fill(0),
  ];
}

function lerpPoint(a: Point, b: Point, t: number, mirror: number): Point {
  return {
    x: (a.x + (b.x - a.x) * t) * mirror,
    y: a.y + (b.y - a.y) * t,
    z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
  };
}

function poseAt(progress: number, orientation: Orientation, posture: TorsoPosture) {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const shoulder = lerpPoint(EXTENDED.shoulder, CONTRACTED.shoulder, progress, mirror);
  const elbow = lerpPoint(EXTENDED.elbow, CONTRACTED.elbow, progress, mirror);
  const wrist = lerpPoint(EXTENDED.wrist, CONTRACTED.wrist, progress, mirror);
  const hip = lerpPoint(EXTENDED.hip, CONTRACTED.hip, progress, mirror);

  if (posture === 'leaned') {
    shoulder.z = -0.34;
  }

  return { shoulder, elbow, wrist, hip };
}

function sideKeypoints(
  side: Side,
  progress: number,
  orientation: Orientation,
  posture: TorsoPosture,
  score: number,
): Keypoint[] {
  const pose = poseAt(progress, orientation, posture);
  const offset = side === 'left' ? -0.015 : 0.015;
  const withOffset = (point: Point) => ({ ...point, x: point.x + offset });

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
  posture: TorsoPosture,
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
  posture: TorsoPosture,
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
    posture?: TorsoPosture | ((index: number) => TorsoPosture);
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
    exerciseName: 'Cable Row',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
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

describe('Cable Row synthetic replay coverage', () => {
  it.each<Orientation>(['facing-right', 'facing-left'])(
    'counts a clean full rep when %s',
    orientation => {
      const result = replayRecording(
        cableRowDefinition,
        buildRecording(`synthetic clean cable row ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('does not count a tiny row pulse', () => {
    const result = replayRecordingVerbose(
      cableRowDefinition,
      buildRecording('synthetic tiny cable row pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial row and records ROM feedback', () => {
    const clean = replayRecording(cableRowDefinition, buildRecording('synthetic clean cable row', fullRepPath()));
    const result = replayRecording(cableRowDefinition, buildRecording('synthetic half cable row', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Pull further back — squeeze your shoulder blades together.');
  });

  it('keeps the visible side locked through a rep when visibility flips', () => {
    const result = replayRecordingVerbose(
      cableRowDefinition,
      buildRecording('synthetic cable row side visibility flip', fullRepPath(), {
        side: 'left',
        sideSwitchFrame: 34,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => trace.phase !== 'REST');
    expect(activeFrames.every(trace => trace.debugInfo.side === 'left')).toBe(true);
  });

  it('flags torso lean without punishing an upright row', () => {
    const clean = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic upright cable row', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic leaned cable row', fullRepPath(), {
        posture: index => (index < 32 ? 'upright' : 'leaned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Stay upright — avoid leaning back during the pull.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Stay upright — avoid leaning back during the pull.');
  });

  it('still flags a true fast return', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic fast return cable row', fastReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Control the return — don't let the weight pull you forward.");
  });
});
