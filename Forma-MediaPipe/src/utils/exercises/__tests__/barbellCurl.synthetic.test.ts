import { barbellCurlDefinition } from '../definitions/barbellCurl';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type CurlView = 'front' | 'side-left' | 'side-right';
type WristStyle = 'neutral' | 'curled';

const EXTENDED_WRIST_Y = 0.6;
const TOP_WRIST_Y = 1.2;
const PULSE_WRIST_Y = 0.78;
const HALF_WRIST_Y = 1.08;
const FRAME_MS = 50;

function kp(name: string, x: number, y: number, z: number, score = 0.99): Keypoint {
  return { name, x, y, z, score };
}

function sideGeometry(view: CurlView) {
  switch (view) {
    case 'side-left':
      return {
        leftX: -0.035,
        rightX: 0.035,
        leftZ: -0.25,
        rightZ: 0.25,
        visibleArm: 'left' as const,
      };
    case 'side-right':
      return {
        leftX: -0.035,
        rightX: 0.035,
        leftZ: 0.25,
        rightZ: -0.25,
        visibleArm: 'right' as const,
      };
    case 'front':
    default:
      return {
        leftX: -0.22,
        rightX: 0.22,
        leftZ: 0,
        rightZ: 0,
        visibleArm: 'both' as const,
      };
  }
}

function armKeypoints(
  side: 'left' | 'right',
  x: number,
  z: number,
  wristY: number,
  visible: boolean,
  wristStyle: WristStyle,
): Keypoint[] {
  const score = visible ? 0.99 : 0.05;
  const shoulderY = 1.4;
  const elbowY = 1.0;
  const indexY = wristY + (wristY - elbowY) * 0.2;
  const indexX = wristStyle === 'curled'
    ? x + (side === 'left' ? -0.18 : 0.18)
    : x;

  return [
    kp(`${side}_shoulder`, x, shoulderY, z, 0.99),
    kp(`${side}_elbow`, x, elbowY, z, score),
    kp(`${side}_wrist`, x, wristY, z, score),
    kp(`${side}_index`, indexX, indexY, z, score),
    kp(`${side}_hip`, x, 0.5, z, 0.99),
  ];
}

function makeFrame(
  timestamp: number,
  wristY: number,
  view: CurlView,
  wristStyle: WristStyle,
): LandmarkRecording['frames'][number] {
  const geom = sideGeometry(view);
  const leftVisible = geom.visibleArm === 'both' || geom.visibleArm === 'left';
  const rightVisible = geom.visibleArm === 'both' || geom.visibleArm === 'right';

  return {
    timestamp,
    keypoints: [
      kp('nose', 0, 1.72, -0.05, 0.99),
      ...armKeypoints('left', geom.leftX, geom.leftZ, wristY, leftVisible, wristStyle),
      ...armKeypoints('right', geom.rightX, geom.rightZ, wristY, rightVisible, wristStyle),
    ],
  };
}

function buildRecording(
  description: string,
  wristPath: number[],
  view: CurlView = 'front',
  options: {
    wristStyle?: WristStyle | ((index: number) => WristStyle);
  } = {},
): LandmarkRecording {
  const { wristStyle = 'neutral' } = options;

  return {
    exerciseName: 'Barbell Curl',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (wristPath.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: wristPath.map((wristY, index) => {
      const frameWristStyle = typeof wristStyle === 'function' ? wristStyle(index) : wristStyle;
      return makeFrame(index * FRAME_MS, wristY, view, frameWristStyle);
    }),
  };
}

function interpolate(from: number, to: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => {
    const p = frames <= 1 ? 1 : index / (frames - 1);
    return from + (to - from) * p;
  });
}

function fullRepPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
    ...Array(4).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 18),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function pulsePath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, PULSE_WRIST_Y, 10),
    ...interpolate(PULSE_WRIST_Y, EXTENDED_WRIST_Y, 10),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function fastLoweringPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
    ...Array(20).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 3),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, HALF_WRIST_Y, 16),
    ...interpolate(HALF_WRIST_Y, EXTENDED_WRIST_Y, 18),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function mirrorFrontRecording(recording: LandmarkRecording): LandmarkRecording {
  return {
    ...recording,
    metadata: {
      ...recording.metadata,
      description: `${recording.metadata.description} mirrored`,
    },
    frames: recording.frames.map(frame => ({
      ...frame,
      keypoints: frame.keypoints.map(point => ({ ...point, x: -point.x })),
    })),
  };
}

describe('Barbell Curl synthetic replay coverage', () => {
  it('counts a clean front-facing full rep', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic clean front curl', fullRepPath(), 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('counts the same front-facing rep when horizontally mirrored', () => {
    const recording = buildRecording('synthetic clean front curl', fullRepPath(), 'front');
    const result = replayRecording(barbellCurlDefinition, mirrorFrontRecording(recording));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
  });

  it.each<CurlView>(['side-left', 'side-right'])(
    'counts a clean full rep from %s view using the visible arm',
    view => {
      const result = replayRecording(
        barbellCurlDefinition,
        buildRecording(`synthetic clean ${view} curl`, fullRepPath(), view),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(80);
    },
  );

  it('does not count a small pulse that never reaches the top threshold', () => {
    const result = replayRecordingVerbose(
      barbellCurlDefinition,
      buildRecording('synthetic partial pulse', pulsePath(), 'front'),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial curl and records ROM feedback', () => {
    const clean = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic clean front curl', fullRepPath(), 'front'),
    );
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic half front curl', halfRepPath(), 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Flex more at the top of the curl.');
  });

  it('flags wrist curling without punishing neutral wrists', () => {
    const clean = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic neutral wrist curl', fullRepPath(), 'front'),
    );
    const curled = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic curled wrist curl', fullRepPath(), 'front', {
        wristStyle: index => (index < 16 ? 'neutral' : 'curled'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your wrists neutral — avoid curling them in.');
    expect(curled.finalRepCount).toBe(1);
    expect(curled.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(curled.feedbackMessages).toContain('Keep your wrists neutral — avoid curling them in.');
  });

  it('still flags a true fast lowering after a top pause', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic fast lowering after top pause', fastLoweringPath(), 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Control the lowering — don't drop the weight.");
  });
});
