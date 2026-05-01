import { squatDefinition } from '../definitions/squat';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type TorsoPosture = 'upright' | 'leaned';

type Pose = {
  shoulder: { x: number; y: number };
  hip: { x: number; y: number };
  knee: { x: number; y: number };
  ankle: { x: number; y: number };
};

const FRAME_MS = 50;

const STANDING: Pose = {
  shoulder: { x: 0, y: 0 },
  hip: { x: 0, y: 0.5 },
  knee: { x: 0, y: 1.0 },
  ankle: { x: 0, y: 1.5 },
};

const BOTTOM: Pose = {
  shoulder: { x: -0.14, y: 0.28 },
  hip: { x: -0.22, y: 0.85 },
  knee: { x: 0.35, y: 1.05 },
  ankle: { x: 0, y: 1.5 },
};

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
    ...Array(20).fill(0),
    ...interpolate(0, 1, 50),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 35),
    ...Array(8).fill(0),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(20).fill(0),
    ...interpolate(0, 0.5, 14),
    ...interpolate(0.5, 0, 14),
    ...Array(8).fill(0),
  ];
}

function fastDescentPath(): number[] {
  return [
    ...Array(20).fill(0),
    ...interpolate(0, 1, 5),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 28),
    ...Array(8).fill(0),
  ];
}

function poseAt(depth: number, orientation: Orientation, posture: TorsoPosture): Pose {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const lerpPoint = (a: Pose[keyof Pose], b: Pose[keyof Pose]) => ({
    x: (a.x + (b.x - a.x) * depth) * mirror,
    y: a.y + (b.y - a.y) * depth,
  });
  const pose = {
    shoulder: lerpPoint(STANDING.shoulder, BOTTOM.shoulder),
    hip: lerpPoint(STANDING.hip, BOTTOM.hip),
    knee: lerpPoint(STANDING.knee, BOTTOM.knee),
    ankle: lerpPoint(STANDING.ankle, BOTTOM.ankle),
  };

  if (posture === 'leaned') {
    pose.shoulder.x = pose.hip.x + 0.72 * mirror;
    pose.shoulder.y = pose.hip.y - 0.38;
  }

  return pose;
}

function sideKeypoints(
  side: Side,
  depth: number,
  orientation: Orientation,
  posture: TorsoPosture,
  score: number,
): Keypoint[] {
  const pose = poseAt(depth, orientation, posture);
  const offset = side === 'left' ? -0.015 : 0.015;

  return [
    kp(`${side}_shoulder`, pose.shoulder.x + offset, pose.shoulder.y, score),
    kp(`${side}_hip`, pose.hip.x + offset, pose.hip.y, score),
    kp(`${side}_knee`, pose.knee.x + offset, pose.knee.y, score),
    kp(`${side}_ankle`, pose.ankle.x + offset, pose.ankle.y, score),
  ];
}

function makeFrameWithScores(
  timestamp: number,
  depth: number,
  orientation: Orientation,
  posture: TorsoPosture,
  leftScore: number,
  rightScore: number,
): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints('left', depth, orientation, posture, leftScore),
      ...sideKeypoints('right', depth, orientation, posture, rightScore),
    ],
  };
}

function makeFrame(
  timestamp: number,
  depth: number,
  side: Side,
  orientation: Orientation,
  posture: TorsoPosture,
  hiddenSideScore = 0.05,
): LandmarkRecording['frames'][number] {
  return side === 'left'
    ? makeFrameWithScores(timestamp, depth, orientation, posture, 0.99, hiddenSideScore)
    : makeFrameWithScores(timestamp, depth, orientation, posture, hiddenSideScore, 0.99);
}

function buildRecording(
  description: string,
  depthPath: number[],
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
    exerciseName: 'Barbell Squat',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (depthPath.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: depthPath.map((depth, index) => {
      const framePosture = typeof posture === 'function' ? posture(index) : posture;
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        return side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, depth, orientation, framePosture, 0.7, 0.99)
          : makeFrameWithScores(index * FRAME_MS, depth, orientation, framePosture, 0.99, 0.7);
      }
      return makeFrame(index * FRAME_MS, depth, side, orientation, framePosture);
    }),
  };
}

describe('Barbell Squat synthetic replay coverage', () => {
  it.each<Orientation>(['facing-right', 'facing-left'])(
    'counts a clean full rep when %s',
    orientation => {
      const result = replayRecording(
        squatDefinition,
        buildRecording(`synthetic clean squat ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('does not count a partial squat that never reaches depth', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic shallow squat pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('keeps the visible side locked through a rep when visibility flips', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic squat side visibility flip', fullRepPath(), {
        side: 'left',
        sideSwitchFrame: 55,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => {
      const phase = String(trace.phase);
      return phase !== 'IDLE' && phase !== 'STANDING';
    });
    expect(activeFrames.every(trace => trace.debugInfo.side === 'left')).toBe(true);
  });

  it('flags excessive torso lean without punishing an upright squat', () => {
    const clean = replayRecording(
      squatDefinition,
      buildRecording('synthetic upright squat', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      squatDefinition,
      buildRecording('synthetic leaned squat', fullRepPath(), {
        posture: index => (index < 20 ? 'upright' : 'leaned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Too much forward lean — keep your chest up.');
    expect(clean.feedbackMessages).not.toContain('Stay more upright — brace your core.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Too much forward lean — keep your chest up.');
  });

  it('still flags a true fast descent', () => {
    const result = replayRecording(
      squatDefinition,
      buildRecording('synthetic fast descent squat', fastDescentPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Slow the descent — control the weight down.');
  });
});
