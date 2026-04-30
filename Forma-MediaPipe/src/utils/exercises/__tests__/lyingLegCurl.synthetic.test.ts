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

function partialPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.68, 16),
    ...interpolate(0.68, 0, 16),
    ...Array(8).fill(0),
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
    posture = 'flat',
    sideSwitchFrame,
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
          ? makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.7, 0.99)
          : makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.99, 0.7);
      }
      return makeFrame(index * FRAME_MS, progress, side, orientation, framePosture);
    }),
  };
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

  it('does not count a partial curl that never reaches peak flexion', () => {
    const result = replayRecordingVerbose(
      lyingLegCurlDefinition,
      buildRecording('synthetic partial lying leg curl', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
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

  it('still flags a true fast lower', () => {
    const result = replayRecording(
      lyingLegCurlDefinition,
      buildRecording('synthetic fast lower lying leg curl', fastLowerPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Control the descent — lower the weight slowly.');
  });
});
