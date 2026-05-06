import { machineAbCrunchDefinition } from '../definitions/machineAbCrunch';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Orientation = 'facing-right' | 'facing-left';
type NeckPosture = 'neutral' | 'forward';

type Point = { x: number; y: number };

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

function lerpPoint(a: Point, b: Point, t: number, mirror: number): Point {
  return {
    x: (a.x + (b.x - a.x) * t) * mirror,
    y: a.y + (b.y - a.y) * t,
  };
}

function framePoints(progress: number, orientation: Orientation, neck: NeckPosture) {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const shoulder = lerpPoint(TOP_SHOULDER, BOTTOM_SHOULDER, progress, mirror);
  const hip = { x: HIP.x * mirror, y: HIP.y };
  const knee = { x: KNEE.x * mirror, y: KNEE.y };
  const neutralEar = {
    x: shoulder.x + (shoulder.x - hip.x) * 0.22,
    y: shoulder.y + (shoulder.y - hip.y) * 0.22,
  };
  const ear = neck === 'forward'
    ? { x: shoulder.x + 0.9 * mirror, y: shoulder.y }
    : neutralEar;

  return { shoulder, hip, knee, ear };
}

function makeFrame(
  timestamp: number,
  progress: number,
  orientation: Orientation,
  neck: NeckPosture,
): LandmarkRecording['frames'][number] {
  const left = framePoints(progress, orientation, neck);
  const right = framePoints(progress, orientation, neck);
  const offsetPoint = (point: Point, offset: number) => ({ x: point.x + offset, y: point.y });

  return {
    timestamp,
    keypoints: [
      kp('left_shoulder', offsetPoint(left.shoulder, -0.015)),
      kp('left_hip', offsetPoint(left.hip, -0.015)),
      kp('left_knee', offsetPoint(left.knee, -0.015)),
      kp('left_ear', offsetPoint(left.ear, -0.015)),
      kp('right_shoulder', offsetPoint(right.shoulder, 0.015)),
      kp('right_hip', offsetPoint(right.hip, 0.015)),
      kp('right_knee', offsetPoint(right.knee, 0.015)),
      kp('right_ear', offsetPoint(right.ear, 0.015)),
    ],
  };
}

function buildRecording(
  description: string,
  path: number[],
  options: {
    orientation?: Orientation;
    neck?: NeckPosture | ((index: number) => NeckPosture);
  } = {},
): LandmarkRecording {
  const {
    orientation = 'facing-right',
    neck = 'neutral',
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
      const frameNeck = typeof neck === 'function' ? neck(index) : neck;
      return makeFrame(index * FRAME_MS, progress, orientation, frameNeck);
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
  });

  it('does not create neck-forward feedback from low-confidence ear frames', () => {
    const noisy = buildRecording('synthetic low-confidence neck machine ab crunch', fullRepPath(), {
      neck: index => (index < 16 ? 'neutral' : 'forward'),
    });
    noisy.frames = noisy.frames.map((frame, index) => index >= 16 && index < 90
      ? { ...frame, keypoints: frame.keypoints.map(point => ({ ...point, score: 0.25 })) }
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
});
