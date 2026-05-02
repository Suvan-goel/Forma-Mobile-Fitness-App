import { lateralRaiseDefinition } from '../definitions/lateralRaise';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Orientation = 'front' | 'mirrored';
type Posture = 'upright' | 'leaned' | 'shrug';
type ArmStyle = 'straight' | 'bent';

const FRAME_MS = 50;
const SHOULDER_Y = 0.4;
const HIP_Y = 1.0;
const TORSO_HEIGHT = HIP_Y - SHOULDER_Y;

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
    ...Array(18).fill(0),
    ...interpolate(0, 1, 34),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 44),
    ...Array(8).fill(0),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(18).fill(0),
    ...interpolate(0, 0.38, 10),
    ...interpolate(0.38, 0, 10),
    ...Array(8).fill(0),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(18).fill(0),
    ...interpolate(0, 0.58, 16),
    ...interpolate(0.58, 0, 20),
    ...Array(8).fill(0),
  ];
}

function fastLowerPath(): number[] {
  return [
    ...Array(18).fill(0),
    ...interpolate(0, 1, 34),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 4),
    ...Array(8).fill(0),
  ];
}

function overRaisePath(): number[] {
  return [
    ...Array(18).fill(0),
    ...interpolate(0, 1.32, 34),
    ...Array(4).fill(1.32),
    ...interpolate(1.32, 0, 44),
    ...Array(8).fill(0),
  ];
}

function sidePoints(
  side: 'left' | 'right',
  heightRatio: number,
  orientation: Orientation,
  posture: Posture,
  armStyle: ArmStyle,
) {
  const mirror = orientation === 'mirrored' ? -1 : 1;
  const sideSign = side === 'left' ? -1 : 1;
  const shoulderBaseX = sideSign * 0.22 * mirror;
  const hipBaseX = sideSign * 0.18 * mirror;
  const leanX = posture === 'leaned' ? 0.08 * mirror : 0;
  const shrugY = posture === 'shrug' ? -0.1 : 0;
  const shoulder = {
    x: shoulderBaseX + leanX,
    y: SHOULDER_Y + shrugY,
  };
  const hip = {
    x: hipBaseX,
    y: HIP_Y,
  };
  const wrist = {
    x: shoulder.x + sideSign * mirror * (0.04 + 0.48 * heightRatio),
    y: HIP_Y - TORSO_HEIGHT * heightRatio,
  };
  const midpoint = {
    x: (shoulder.x + wrist.x) / 2,
    y: (shoulder.y + wrist.y) / 2,
  };
  const bend = armStyle === 'bent' ? 0.22 : 0;
  const elbow = {
    x: midpoint.x,
    y: midpoint.y + bend,
  };

  return { shoulder, elbow, wrist, hip };
}

function makeFrame(
  timestamp: number,
  leftRatio: number,
  rightRatio: number,
  options: {
    orientation: Orientation;
    posture: Posture;
    armStyle: ArmStyle;
  },
): LandmarkRecording['frames'][number] {
  const left = sidePoints('left', leftRatio, options.orientation, options.posture, options.armStyle);
  const right = sidePoints('right', rightRatio, options.orientation, options.posture, options.armStyle);

  return {
    timestamp,
    keypoints: [
      kp('left_shoulder', left.shoulder.x, left.shoulder.y),
      kp('left_elbow', left.elbow.x, left.elbow.y),
      kp('left_wrist', left.wrist.x, left.wrist.y),
      kp('left_hip', left.hip.x, left.hip.y),
      kp('right_shoulder', right.shoulder.x, right.shoulder.y),
      kp('right_elbow', right.elbow.x, right.elbow.y),
      kp('right_wrist', right.wrist.x, right.wrist.y),
      kp('right_hip', right.hip.x, right.hip.y),
    ],
  };
}

function buildRecording(
  description: string,
  path: number[],
  options: {
    orientation?: Orientation;
    posture?: Posture | ((index: number) => Posture);
    armStyle?: ArmStyle | ((index: number) => ArmStyle);
    rightScale?: number;
  } = {},
): LandmarkRecording {
  const {
    orientation = 'front',
    posture = 'upright',
    armStyle = 'straight',
    rightScale = 1,
  } = options;

  return {
    exerciseName: 'Standing Dumbbell Lateral Raises',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (path.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: path.map((heightRatio, index) => {
      const framePosture = typeof posture === 'function' ? posture(index) : posture;
      const frameArmStyle = typeof armStyle === 'function' ? armStyle(index) : armStyle;
      return makeFrame(index * FRAME_MS, heightRatio, heightRatio * rightScale, {
        orientation,
        posture: framePosture,
        armStyle: frameArmStyle,
      });
    }),
  };
}

describe('Lateral Raise synthetic replay coverage', () => {
  it.each<Orientation>(['front', 'mirrored'])(
    'counts a clean full rep in %s orientation',
    orientation => {
      const result = replayRecording(
        lateralRaiseDefinition,
        buildRecording(`synthetic clean lateral raise ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('does not count a tiny lateral raise pulse', () => {
    const result = replayRecordingVerbose(
      lateralRaiseDefinition,
      buildRecording('synthetic tiny lateral raise pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial lateral raise and records ROM feedback', () => {
    const clean = replayRecording(lateralRaiseDefinition, buildRecording('synthetic clean lateral raise', fullRepPath()));
    const result = replayRecording(lateralRaiseDefinition, buildRecording('synthetic half lateral raise', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Raise higher — aim for shoulder level.');
  });

  it('flags excessive elbow bend without punishing straight arms', () => {
    const clean = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic straight lateral raise', fullRepPath(), { armStyle: 'straight' }),
    );
    const bent = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic bent lateral raise', fullRepPath(), {
        armStyle: index => (index < 18 ? 'straight' : 'bent'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your arms straighter — avoid excessive elbow bend.');
    expect(bent.finalRepCount).toBe(1);
    expect(bent.feedbackMessages).toContain('Keep your arms straighter — avoid excessive elbow bend.');
  });

  it('flags torso lean without punishing upright raises', () => {
    const clean = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic upright lateral raise', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic leaned lateral raise', fullRepPath(), {
        posture: index => (index < 18 ? 'upright' : 'leaned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Stay upright — avoid swaying or leaning.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Stay upright — avoid swaying or leaning.');
  });

  it('flags asymmetric raise height', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic asymmetric lateral raise', fullRepPath(), { rightScale: 0.78 }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Even it out — raise both arms to the same height.');
  });

  it('flags shrugging without punishing relaxed shoulders', () => {
    const clean = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic relaxed lateral raise', fullRepPath(), { posture: 'upright' }),
    );
    const shrug = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic shrug lateral raise', fullRepPath().map(height => height * 1.18), {
        posture: index => (index < 18 ? 'upright' : 'shrug'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain("Relax your traps — don't shrug the weight up.");
    expect(shrug.finalRepCount).toBe(1);
    expect(shrug.feedbackMessages).toContain("Relax your traps — don't shrug the weight up.");
  });

  it('flags over-raising above shoulder height without punishing shoulder-level reps', () => {
    const clean = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic shoulder-level lateral raise', fullRepPath()),
    );
    const overRaised = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic over-raised lateral raise', overRaisePath()),
    );

    expect(clean.feedbackMessages).not.toContain('Stop around shoulder height — avoid lifting too high.');
    expect(overRaised.finalRepCount).toBe(1);
    expect(overRaised.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(overRaised.feedbackMessages).toContain('Stop around shoulder height — avoid lifting too high.');
  });

  it('still flags a true fast descent', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic fast descent lateral raise', fastLowerPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Control the descent — lower the weights slowly.');
  });
});
