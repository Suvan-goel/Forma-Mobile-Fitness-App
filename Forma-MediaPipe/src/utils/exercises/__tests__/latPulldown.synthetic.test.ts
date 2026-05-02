import { latPulldownDefinition } from '../definitions/latPulldown';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'front' | 'mirrored';
type TorsoPosture = 'upright' | 'leaned';

const FRAME_MS = 50;
const EXTENDED_ELBOW_Y = 0.24;
const BOTTOM_ELBOW_Y = 0.76;
const TINY_ELBOW_Y = 0.34;
const PARTIAL_ELBOW_Y = 0.66;
const EXTENDED_WRIST_Y = 0.0;
const BOTTOM_WRIST_Y = 0.7;

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
    ...Array(14).fill(EXTENDED_ELBOW_Y),
    ...interpolate(EXTENDED_ELBOW_Y, BOTTOM_ELBOW_Y, 18),
    ...Array(4).fill(BOTTOM_ELBOW_Y),
    ...interpolate(BOTTOM_ELBOW_Y, EXTENDED_ELBOW_Y, 60),
    ...Array(8).fill(EXTENDED_ELBOW_Y),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(14).fill(EXTENDED_ELBOW_Y),
    ...interpolate(EXTENDED_ELBOW_Y, TINY_ELBOW_Y, 8),
    ...interpolate(TINY_ELBOW_Y, EXTENDED_ELBOW_Y, 8),
    ...Array(8).fill(EXTENDED_ELBOW_Y),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(14).fill(EXTENDED_ELBOW_Y),
    ...interpolate(EXTENDED_ELBOW_Y, PARTIAL_ELBOW_Y, 14),
    ...interpolate(PARTIAL_ELBOW_Y, EXTENDED_ELBOW_Y, 18),
    ...Array(8).fill(EXTENDED_ELBOW_Y),
  ];
}

function fastReturnPath(): number[] {
  return [
    ...Array(14).fill(EXTENDED_ELBOW_Y),
    ...interpolate(EXTENDED_ELBOW_Y, BOTTOM_ELBOW_Y, 18),
    ...Array(4).fill(BOTTOM_ELBOW_Y),
    ...interpolate(BOTTOM_ELBOW_Y, EXTENDED_ELBOW_Y, 4),
    ...Array(8).fill(EXTENDED_ELBOW_Y),
  ];
}

function wristYForElbow(elbowY: number): number {
  const p = Math.max(0, Math.min(1, (elbowY - EXTENDED_ELBOW_Y) / (BOTTOM_ELBOW_Y - EXTENDED_ELBOW_Y)));
  return EXTENDED_WRIST_Y + (BOTTOM_WRIST_Y - EXTENDED_WRIST_Y) * p;
}

function sideKeypoints(
  side: Side,
  elbowY: number,
  orientation: Orientation,
  posture: TorsoPosture,
  score: number,
): Keypoint[] {
  const mirror = orientation === 'mirrored' ? -1 : 1;
  const baseX = side === 'left' ? -0.18 : 0.18;
  const x = baseX * mirror;
  const leanX = posture === 'leaned' ? 0.32 * mirror : 0;
  const shoulderY = 0.62;
  const shoulderX = x + leanX;
  const elbowX = shoulderX;
  const wristX = shoulderX;

  return [
    kp(`${side}_shoulder`, shoulderX, shoulderY, score),
    kp(`${side}_elbow`, elbowX, elbowY, score),
    kp(`${side}_wrist`, wristX, wristYForElbow(elbowY), score),
    kp(`${side}_hip`, x, 1.1, score),
  ];
}

function makeFrame(
  timestamp: number,
  elbowY: number,
  side: Side,
  orientation: Orientation,
  posture: TorsoPosture,
  hiddenSideScore = 0.05,
): LandmarkRecording['frames'][number] {
  const otherSide: Side = side === 'left' ? 'right' : 'left';
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints(side, elbowY, orientation, posture, 0.99),
      ...sideKeypoints(otherSide, elbowY, orientation, posture, hiddenSideScore),
    ],
  };
}

function makeFrameWithScores(
  timestamp: number,
  elbowY: number,
  orientation: Orientation,
  posture: TorsoPosture,
  leftScore: number,
  rightScore: number,
): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints('left', elbowY, orientation, posture, leftScore),
      ...sideKeypoints('right', elbowY, orientation, posture, rightScore),
    ],
  };
}

function buildRecording(
  description: string,
  elbowPath: number[],
  options: {
    side?: Side;
    orientation?: Orientation;
    posture?: TorsoPosture;
    sideSwitchFrame?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'right',
    orientation = 'front',
    posture = 'upright',
    sideSwitchFrame,
  } = options;

  return {
    exerciseName: 'Cable Lat Pulldowns',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (elbowPath.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: elbowPath.map((elbowY, index) => {
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        return side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, elbowY, orientation, posture, 0.7, 0.99)
          : makeFrameWithScores(index * FRAME_MS, elbowY, orientation, posture, 0.99, 0.7);
      }
      return makeFrame(index * FRAME_MS, elbowY, side, orientation, posture);
    }),
  };
}

describe('Lat Pulldown synthetic replay coverage', () => {
  it.each<Orientation>(['front', 'mirrored'])(
    'counts a clean full rep in %s orientation',
    orientation => {
      const result = replayRecording(
        latPulldownDefinition,
        buildRecording(`synthetic clean lat pulldown ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('does not count a tiny pulldown pulse', () => {
    const result = replayRecordingVerbose(
      latPulldownDefinition,
      buildRecording('synthetic tiny lat pulldown pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial pulldown and records ROM feedback', () => {
    const clean = replayRecording(latPulldownDefinition, buildRecording('synthetic clean lat pulldown', fullRepPath()));
    const result = replayRecording(latPulldownDefinition, buildRecording('synthetic half lat pulldown', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Pull deeper — bring the bar to your upper chest.');
  });

  it('keeps the active side locked through a rep when visibility flips', () => {
    const result = replayRecordingVerbose(
      latPulldownDefinition,
      buildRecording('synthetic lat pulldown side visibility flip', fullRepPath(), {
        side: 'right',
        sideSwitchFrame: 34,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => {
      const phase = String(trace.phase);
      return phase !== 'REST' && !phase.endsWith(':REST');
    });
    expect(activeFrames.every(trace => trace.debugInfo.activeSide === 'right')).toBe(true);
  });

  it('flags excessive lean without treating an upright setup as leaning', () => {
    const clean = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic upright lat pulldown', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic leaned lat pulldown', fullRepPath(), { posture: 'leaned' }),
    );

    expect(clean.feedbackMessages).not.toContain('Stay upright — avoid leaning back excessively.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Stay upright — avoid leaning back excessively.');
  });

  it('still flags a true fast return', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic fast return lat pulldown', fastReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Control the return — resist the weight on the way up.');
  });
});
