import { pushupDefinition } from '../definitions/pushup';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type PushupSide = 'left' | 'right';
type PushupOrientation = 'facing-right' | 'facing-left';
type PushupPosture = 'neutral' | 'sag' | 'pike';

const FRAME_MS = 50;
const EXTENDED_ELBOW_X = 0;
const BOTTOM_ELBOW_X = 0.58;
const PULSE_ELBOW_X = 0.12;

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

function pulsePath(): number[] {
  return [
    ...Array(22).fill(EXTENDED_ELBOW_X),
    ...interpolate(EXTENDED_ELBOW_X, PULSE_ELBOW_X, 8),
    ...interpolate(PULSE_ELBOW_X, EXTENDED_ELBOW_X, 8),
    ...Array(8).fill(EXTENDED_ELBOW_X),
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
): Keypoint[] {
  const { shoulder, hip, ankle } = bodyPoints(orientation, posture);
  const elbowDirection = orientation === 'facing-right' ? -1 : 1;
  const xOffset = side === 'left' ? -0.02 : 0.02;
  const elbow = {
    x: shoulder.x + xOffset + elbowDirection * elbowOffsetX,
    y: 0.63,
  };
  const wrist = {
    x: shoulder.x + xOffset,
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

function makeFrameWithScores(
  timestamp: number,
  elbowOffsetX: number,
  orientation: PushupOrientation,
  posture: PushupPosture,
  leftScore: number,
  rightScore: number,
): LandmarkRecording['frames'][number] {
  const { shoulder } = bodyPoints(orientation, posture);
  return {
    timestamp,
    keypoints: [
      kp('nose', shoulder.x + (orientation === 'facing-right' ? -0.12 : 0.12), shoulder.y - 0.02),
      ...sideKeypoints('left', elbowOffsetX, orientation, posture, leftScore),
      ...sideKeypoints('right', elbowOffsetX, orientation, posture, rightScore),
    ],
  };
}

function makeFrame(
  timestamp: number,
  elbowOffsetX: number,
  side: PushupSide,
  orientation: PushupOrientation,
  posture: PushupPosture,
  hiddenSideScore = 0.05,
): LandmarkRecording['frames'][number] {
  const otherSide: PushupSide = side === 'left' ? 'right' : 'left';
  const { shoulder } = bodyPoints(orientation, posture);
  return {
    timestamp,
    keypoints: [
      kp('nose', shoulder.x + (orientation === 'facing-right' ? -0.12 : 0.12), shoulder.y - 0.02),
      ...sideKeypoints(side, elbowOffsetX, orientation, posture, 0.99),
      ...sideKeypoints(otherSide, elbowOffsetX, orientation, posture, hiddenSideScore),
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
    sideSwitchFrame?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'neutral',
    sideSwitchFrame,
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
          ? makeFrameWithScores(index * FRAME_MS, elbowOffsetX, orientation, posture, 0.7, 0.99)
          : makeFrameWithScores(index * FRAME_MS, elbowOffsetX, orientation, posture, 0.99, 0.7);
      }
      return makeFrame(index * FRAME_MS, elbowOffsetX, side, orientation, posture);
    }),
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
      return makeFrame(index * FRAME_MS, elbowOffsetX, 'left', orientation, activePosture);
    }),
  };
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
    },
  );

  it('does not count a small pulse that never reaches bottom', () => {
    const result = replayRecordingVerbose(
      pushupDefinition,
      buildRecording('synthetic shallow pushup pulse', pulsePath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
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
    },
  );

  it.each<PushupOrientation>(['facing-right', 'facing-left'])(
    'flags hip pike consistently when %s',
    orientation => {
      const result = replayRecording(
        pushupDefinition,
        buildRecordingWithPostureDuringRep(`synthetic pike pushup ${orientation}`, fullRepPath(), 'pike', orientation),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.feedbackMessages.join('\n')).toContain('Hips are piking');
    },
  );

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
  });
});
