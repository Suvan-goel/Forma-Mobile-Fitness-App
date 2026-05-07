import { machineAbCrunchDefinition } from '../definitions/machineAbCrunch';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Orientation = 'facing-right' | 'facing-left';
type NeckPosture = 'neutral' | 'forward';
type SideView = 'side' | 'front';

type Point = { x: number; y: number };
type OptionValue<T> = T | ((index: number, progress: number) => T);

const FRAME_MS = 50;

const TOP_SHOULDER = { x: -0.15, y: 0.1 };
const BOTTOM_SHOULDER = { x: 0.18, y: 0.25 };
const HIP = { x: 0, y: 0.6 };
const KNEE = { x: 0.5, y: 0.85 };

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
    ...interpolate(0, 1, 34),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 68),
    ...Array(8).fill(0),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.25, 8),
    ...interpolate(0.25, 0, 8),
    ...Array(8).fill(0),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.48, 18),
    ...interpolate(0.48, 0, 22),
    ...Array(8).fill(0),
  ];
}

function fastReturnPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 34),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 4),
    ...Array(8).fill(0),
  ];
}

function incompleteReturnPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 34),
    ...Array(4).fill(1),
    ...interpolate(1, 0.45, 24),
    ...Array(14).fill(0.45),
  ];
}

function jerkyCrunchPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 5),
    ...Array(8).fill(1),
    ...interpolate(1, 0, 68),
    ...Array(8).fill(0),
  ];
}

function lerpPoint(a: Point, b: Point, t: number, mirror: number): Point {
  return {
    x: (a.x + (b.x - a.x) * t) * mirror,
    y: a.y + (b.y - a.y) * t,
  };
}

function resolveOption<T>(value: OptionValue<T>, index: number, progress: number): T {
  return typeof value === 'function'
    ? (value as (index: number, progress: number) => T)(index, progress)
    : value;
}

function framePoints(
  progress: number,
  orientation: Orientation,
  neck: NeckPosture,
  options: {
    armPull?: boolean;
    hipShift?: boolean;
    oppositeNoise?: boolean;
  } = {},
) {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const shoulder = lerpPoint(TOP_SHOULDER, BOTTOM_SHOULDER, progress, mirror);
  const hip = {
    x: HIP.x * mirror + (options.hipShift ? 0.09 * mirror : 0),
    y: HIP.y + (options.hipShift ? -0.04 : 0),
  };
  const knee = {
    x: KNEE.x * mirror + (options.oppositeNoise ? -0.35 * mirror : 0),
    y: KNEE.y + (options.oppositeNoise ? -0.12 : 0),
  };
  const neutralEar = {
    x: shoulder.x + (shoulder.x - hip.x) * 0.22,
    y: shoulder.y + (shoulder.y - hip.y) * 0.22,
  };
  const ear = neck === 'forward'
    ? { x: shoulder.x + 0.9 * mirror, y: shoulder.y }
    : neutralEar;
  const elbow = {
    x: shoulder.x + (options.armPull ? 0.18 : 0.02) * mirror,
    y: shoulder.y + (options.armPull ? 0.08 : 0.17),
  };
  const wrist = {
    x: shoulder.x + (options.armPull ? 0.30 : 0.04) * mirror,
    y: shoulder.y + (options.armPull ? 0.12 : 0.31),
  };

  return { shoulder, hip, knee, ear, elbow, wrist };
}

function makeFrame(
  timestamp: number,
  progress: number,
  orientation: Orientation,
  neck: NeckPosture,
  options: {
    sideView?: SideView;
    armPull?: boolean;
    hipShift?: boolean;
    oppositeNoise?: boolean;
    score?: number;
  } = {},
): LandmarkRecording['frames'][number] {
  const left = framePoints(progress, orientation, neck, {
    armPull: options.armPull,
    hipShift: options.hipShift,
  });
  const right = framePoints(progress, orientation, neck, {
    armPull: options.armPull,
    hipShift: options.hipShift,
    oppositeNoise: options.oppositeNoise,
  });
  const sideOffset = options.sideView === 'front' ? 0.22 : 0.015;
  const offsetPoint = (point: Point, offset: number) => ({ x: point.x + offset, y: point.y });
  const score = options.score ?? 0.99;

  return {
    timestamp,
    keypoints: [
      kp('left_shoulder', offsetPoint(left.shoulder, -sideOffset), score),
      kp('left_hip', offsetPoint(left.hip, -sideOffset), score),
      kp('left_knee', offsetPoint(left.knee, -sideOffset), score),
      kp('left_ear', offsetPoint(left.ear, -sideOffset), score),
      kp('left_elbow', offsetPoint(left.elbow, -sideOffset), score),
      kp('left_wrist', offsetPoint(left.wrist, -sideOffset), score),
      kp('right_shoulder', offsetPoint(right.shoulder, sideOffset), score),
      kp('right_hip', offsetPoint(right.hip, sideOffset), score),
      kp('right_knee', offsetPoint(right.knee, sideOffset), score),
      kp('right_ear', offsetPoint(right.ear, sideOffset), score),
      kp('right_elbow', offsetPoint(right.elbow, sideOffset), score),
      kp('right_wrist', offsetPoint(right.wrist, sideOffset), score),
    ],
  };
}

function buildRecording(
  description: string,
  path: number[],
  options: {
    orientation?: Orientation;
    neck?: OptionValue<NeckPosture>;
    sideView?: OptionValue<SideView>;
    armPull?: OptionValue<boolean>;
    hipShift?: OptionValue<boolean>;
    oppositeNoise?: OptionValue<boolean>;
    score?: OptionValue<number>;
  } = {},
): LandmarkRecording {
  const {
    orientation = 'facing-right',
    neck = 'neutral',
    sideView = 'side',
    armPull = false,
    hipShift = false,
    oppositeNoise = false,
    score = 0.99,
  } = options;

  return {
    exerciseName: 'Machine Ab Crunches',
    metadata: {
      recordedAt: '2026-04-30T00:00:00.000Z',
      duration: (path.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: path.map((progress, index) => {
      const frameNeck = resolveOption(neck, index, progress);
      return makeFrame(index * FRAME_MS, progress, orientation, frameNeck, {
        sideView: resolveOption(sideView, index, progress),
        armPull: resolveOption(armPull, index, progress),
        hipShift: resolveOption(hipShift, index, progress),
        oppositeNoise: resolveOption(oppositeNoise, index, progress),
        score: resolveOption(score, index, progress),
      });
    }),
  };
}

describe('Machine Ab Crunch synthetic replay coverage', () => {
  it.each<Orientation>(['facing-right', 'facing-left'])(
    'counts a clean full rep when %s',
    orientation => {
      const result = replayRecording(
        machineAbCrunchDefinition,
        buildRecording(`synthetic clean machine ab crunch ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('does not count a tiny crunch pulse', () => {
    const result = replayRecordingVerbose(
      machineAbCrunchDefinition,
      buildRecording('synthetic tiny machine ab crunch pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial crunch and records ROM feedback', () => {
    const clean = replayRecording(machineAbCrunchDefinition, buildRecording('synthetic clean machine ab crunch', fullRepPath()));
    const result = replayRecording(machineAbCrunchDefinition, buildRecording('synthetic half machine ab crunch', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Crunch deeper — bring your chest closer to your knees.');
  });

  it('counts an incomplete return and records returned-extension feedback', () => {
    const clean = replayRecording(machineAbCrunchDefinition, buildRecording('synthetic clean machine ab crunch', fullRepPath()));
    const result = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic incomplete-return machine ab crunch', incompleteReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Extend fully — return to the upright position.');
    expect(result.reps[0].diagnostics?.metrics.extensionAngle.value).toBeLessThan(122);
    expect(result.reps[0].diagnostics?.metrics.returnDeficitAngle.value).toBeGreaterThan(0);
    expect(result.reps[0].diagnostics?.metrics.returnCompletionRatio.value).toBeLessThan(1);
  });

  it('flags neck pulling without punishing neutral neck position', () => {
    const clean = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic neutral neck machine ab crunch', fullRepPath(), { neck: 'neutral' }),
    );
    const forward = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic forward neck machine ab crunch', fullRepPath(), {
        neck: index => (index < 16 ? 'neutral' : 'forward'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your neck neutral — avoid pulling with your head.');
    expect(forward.finalRepCount).toBe(1);
    expect(forward.feedbackMessages).toContain('Keep your neck neutral — avoid pulling with your head.');
    expect(forward.reps[0].diagnostics?.metrics.neckForwardP90.value).toBeGreaterThan(45);
    expect(forward.reps[0].diagnostics?.metrics.neckForwardOverThresholdFrames.value).toBeGreaterThan(0);
  });

  it('does not create neck-forward feedback from low-confidence ear frames', () => {
    const noisy = buildRecording('synthetic low-confidence neck machine ab crunch', fullRepPath(), {
      neck: index => (index < 16 ? 'neutral' : 'forward'),
    });
    noisy.frames = noisy.frames.map((frame, index) => index >= 16
      ? {
          ...frame,
          keypoints: frame.keypoints.map(point => (
            point.name?.endsWith('_ear') ? { ...point, score: 0.25 } : point
          )),
        }
      : frame);

    const result = replayRecording(machineAbCrunchDefinition, noisy);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Keep your neck neutral — avoid pulling with your head.');
  });

  it('still flags a true fast return', () => {
    const result = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic fast return machine ab crunch', fastReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Control the return — resist on the way back.');
  });

  it('marks a poor side-view rep unscorable while still counting clear movement', () => {
    const result = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic front-ish machine ab crunch', fullRepPath(), { sideView: 'front' }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Turn fully side-on so I can judge your crunch.');
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
  });

  it('keeps the selected side locked when the opposite side gets noisy mid-rep', () => {
    const result = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic noisy opposite side machine ab crunch', fullRepPath(), {
        oppositeNoise: index => index >= 28 && index <= 95,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Crunch deeper — bring your chest closer to your knees.');
    expect(result.feedbackMessages).not.toContain('Extend fully — return to the upright position.');
  });

  it('freezes movement advancement during sustained low-confidence hip-chain frames', () => {
    const result = replayRecordingVerbose(
      machineAbCrunchDefinition,
      buildRecording('synthetic low-confidence hip-chain machine ab crunch', fullRepPath(), {
        score: index => (index >= 18 && index <= 115 ? 0.25 : 0.99),
      }),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('does not break a clean rep for intermittent low-confidence hip-chain frames', () => {
    const result = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic intermittent low-confidence machine ab crunch', fullRepPath(), {
        score: index => ([34, 35, 36, 72, 73].includes(index) ? 0.25 : 0.99),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('flags jerky crunch movement', () => {
    const result = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic jerky machine ab crunch', jerkyCrunchPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Move smoothly — avoid jerking the weight.');
    expect(result.reps[0].diagnostics?.metrics.angularVelocityP95DegPerSec.value).toBeGreaterThan(0);
    expect(result.reps[0].diagnostics?.metrics.angularVelocityOverThresholdFrames.value).toBeGreaterThan(0);
  });

  it('flags arm pulling only when arm travel is high and reliable', () => {
    const stable = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic stable arms machine ab crunch', fullRepPath()),
    );
    const pulling = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic arm-pull machine ab crunch', fullRepPath(), {
        armPull: (index, progress) => index >= 24 && index <= 78 && progress > 0.2,
      }),
    );
    const unreliable = buildRecording('synthetic unreliable arm-pull machine ab crunch', fullRepPath(), {
      armPull: (index, progress) => index >= 24 && index <= 78 && progress > 0.2,
    });
    unreliable.frames = unreliable.frames.map(frame => ({
      ...frame,
      keypoints: frame.keypoints.map(point => (
        point.name?.endsWith('_elbow') || point.name?.endsWith('_wrist')
          ? { ...point, score: 0.25 }
          : point
      )),
    }));

    const unreliableResult = replayRecording(machineAbCrunchDefinition, unreliable);

    expect(stable.feedbackMessages).not.toContain('Use your abs, not your arms — keep the handles light.');
    expect(pulling.finalRepCount).toBe(1);
    expect(pulling.feedbackMessages).toContain('Use your abs, not your arms — keep the handles light.');
    expect(pulling.reps[0].diagnostics?.metrics.armPullP90Ratio.value).toBeGreaterThan(0.25);
    expect(pulling.reps[0].diagnostics?.metrics.armPullOverThresholdFrames.value).toBeGreaterThan(0);
    expect(unreliableResult.finalRepCount).toBe(1);
    expect(unreliableResult.feedbackMessages).not.toContain('Use your abs, not your arms — keep the handles light.');
  });

  it('flags hip movement only when the hip shift is high and reliable', () => {
    const stable = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic stable hips machine ab crunch', fullRepPath()),
    );
    const shifting = replayRecording(
      machineAbCrunchDefinition,
      buildRecording('synthetic shifting hips machine ab crunch', fullRepPath(), {
        hipShift: (index, progress) => index >= 45 && index <= 122 && progress > 0.2,
      }),
    );

    expect(stable.feedbackMessages).not.toContain('Keep your hips planted — flex from your waist.');
    expect(shifting.finalRepCount).toBe(1);
    expect(shifting.feedbackMessages).toContain('Keep your hips planted — flex from your waist.');
    expect(shifting.reps[0].diagnostics?.metrics.hipShiftP90Ratio.value).toBeGreaterThan(0.12);
    expect(shifting.reps[0].diagnostics?.metrics.hipShiftOverThresholdFrames.value).toBeGreaterThan(0);
  });
});
