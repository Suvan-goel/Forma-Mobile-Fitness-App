import { latPulldownDefinition } from '../definitions/latPulldown';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'front' | 'mirrored';
type TorsoPosture = 'upright' | 'leaned';
type ArmPath = 'normal' | 'arm-dominant' | 'short-extension';

const FRAME_MS = 50;
const EXTENDED_ELBOW_Y = 0.24;
const BOTTOM_ELBOW_Y = 0.76;
const TINY_ELBOW_Y = 0.34;
const PARTIAL_ELBOW_Y = 0.66;
const EXTENDED_WRIST_Y = 0.0;
const BOTTOM_WRIST_Y = 0.7;

function kp(name: string, x: number, y: number, score = 0.99, z = 0): Keypoint {
  return { name, x, y, z, score };
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

function fastPullPath(): number[] {
  return [
    ...Array(14).fill(EXTENDED_ELBOW_Y),
    ...interpolate(EXTENDED_ELBOW_Y, BOTTOM_ELBOW_Y, 4),
    ...Array(4).fill(BOTTOM_ELBOW_Y),
    ...interpolate(BOTTOM_ELBOW_Y, EXTENDED_ELBOW_Y, 60),
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
  options: {
    armPath?: ArmPath;
    sideGap?: number;
    shoulderShrug?: boolean;
    torsoRock?: boolean;
  } = {},
): Keypoint[] {
  const mirror = orientation === 'mirrored' ? -1 : 1;
  const baseGap = options.sideGap ?? 0.18;
  const baseX = side === 'left' ? -baseGap : baseGap;
  const x = baseX * mirror;
  const leanX = posture === 'leaned' ? 0.32 * mirror : 0;
  const p = Math.max(0, Math.min(1, (elbowY - EXTENDED_ELBOW_Y) / (BOTTOM_ELBOW_Y - EXTENDED_ELBOW_Y)));
  const shoulderY = 0.62 - (options.shoulderShrug ? 0.05 * p : 0);
  const shoulderX = x + leanX;
  const armPath = options.armPath ?? 'normal';
  const elbowX = armPath === 'short-extension'
    ? shoulderX + 0.15 * (1 - p) * mirror
    : shoulderX;
  const wristX = shoulderX;
  const effectiveElbowY = armPath === 'arm-dominant' ? EXTENDED_ELBOW_Y : elbowY;
  const wristY = armPath === 'arm-dominant'
    ? EXTENDED_WRIST_Y + (BOTTOM_WRIST_Y - EXTENDED_WRIST_Y) * p
    : wristYForElbow(elbowY);
  const shoulderZ = options.torsoRock ? 0.26 * p : 0;

  return [
    kp(`${side}_shoulder`, shoulderX, shoulderY, score, shoulderZ),
    kp(`${side}_elbow`, elbowX, effectiveElbowY, score, shoulderZ),
    kp(`${side}_wrist`, wristX, wristY, score, shoulderZ),
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
  options: {
    armPath?: ArmPath;
    sideGap?: number;
    shoulderShrug?: boolean;
    torsoRock?: boolean;
  } = {},
): LandmarkRecording['frames'][number] {
  const otherSide: Side = side === 'left' ? 'right' : 'left';
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints(side, elbowY, orientation, posture, 0.99, options),
      ...sideKeypoints(otherSide, elbowY, orientation, posture, hiddenSideScore, options),
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
  options: {
    armPath?: ArmPath;
    sideGap?: number;
    shoulderShrug?: boolean;
    torsoRock?: boolean;
  } = {},
): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints('left', elbowY, orientation, posture, leftScore, options),
      ...sideKeypoints('right', elbowY, orientation, posture, rightScore, options),
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
    hiddenSideScore?: number;
    sideGap?: number;
    armPath?: ArmPath;
    shoulderShrug?: boolean;
    torsoRock?: boolean;
  } = {},
): LandmarkRecording {
  const {
    side = 'right',
    orientation = 'front',
    posture = 'upright',
    sideSwitchFrame,
    hiddenSideScore = 0.05,
    sideGap,
    armPath,
    shoulderShrug,
    torsoRock,
  } = options;
  const frameOptions = { armPath, sideGap, shoulderShrug, torsoRock };

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
          ? makeFrameWithScores(index * FRAME_MS, elbowY, orientation, posture, 0.7, 0.99, frameOptions)
          : makeFrameWithScores(index * FRAME_MS, elbowY, orientation, posture, 0.99, 0.7, frameOptions);
      }
      return makeFrame(index * FRAME_MS, elbowY, side, orientation, posture, hiddenSideScore, frameOptions);
    }),
  };
}

function buildWorldStaticImageRecording(description: string, elbowPath: number[]): LandmarkRecording {
  const staticWorld = buildRecording(`${description} static world`, Array(elbowPath.length).fill(EXTENDED_ELBOW_Y));
  const movingImage = buildRecording(`${description} moving image`, elbowPath);
  return {
    ...movingImage,
    metadata: {
      ...movingImage.metadata,
      description,
    },
    frames: movingImage.frames.map((frame, index) => ({
      timestamp: frame.timestamp,
      keypoints: staticWorld.frames[index].keypoints,
      worldKeypoints: staticWorld.frames[index].keypoints,
      imageKeypoints: frame.keypoints,
    })),
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

  it('does not overcount jitter around the extended position', () => {
    const jitterPath = [
      ...Array(14).fill(EXTENDED_ELBOW_Y),
      ...Array.from({ length: 40 }, (_, index) => index % 2 === 0 ? EXTENDED_ELBOW_Y : TINY_ELBOW_Y),
      ...Array(8).fill(EXTENDED_ELBOW_Y),
    ];
    const result = replayRecordingVerbose(
      latPulldownDefinition,
      buildRecording('synthetic jitter-only lat pulldown', jitterPath),
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

  it('uses image landmarks for the FSM when world landmarks are static', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildWorldStaticImageRecording('synthetic image-driven lat pulldown', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('counts but marks front-ish pulldowns unscorable when side-view confidence is too low', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic poor side view lat pulldown', fullRepPath(), {
        hiddenSideScore: 0.99,
        sideGap: 0.36,
      }),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('front');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('frontish_confirmed');
    expect(result.reps[0].diagnostics?.metrics.frontishViewConfirmed.value).toBe(1);
    expect(result.feedbackMessages[0]).toContain('Turn side-on so I can judge your form.');
  });

  it('records unknown side-view quality without blocking scoring when the far side is hidden', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic single-side visible lat pulldown', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings).not.toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('unknown');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('view_unknown');
    expect(result.reps[0].diagnostics?.metrics.viewUnknown.value).toBe(1);
    expect(result.reps[0].diagnostics?.metrics.bilateralRomAsymmetry.eligible).toBe(false);
  });

  it('records side-confirmed view quality and passive bilateral ROM diagnostics when both arms are visible', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic two-arm visible side-view lat pulldown', fullRepPath(), {
        hiddenSideScore: 0.99,
        sideGap: 0.04,
      }),
    );

    const metrics = result.reps[0].diagnostics?.metrics;
    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings).not.toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('side');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('side_confirmed');
    expect(metrics?.sideViewConfirmed.value).toBe(1);
    expect(metrics?.bilateralSampleCount.value).toBeGreaterThanOrEqual(5);
    expect(metrics?.leftRomRatio.eligible).toBe(true);
    expect(metrics?.rightRomRatio.eligible).toBe(true);
    expect(metrics?.bilateralRomAsymmetry.value).toBeLessThan(0.001);
    expect(metrics?.bilateralPullDepthAsymmetry.value).toBeLessThan(0.001);
    expect(metrics?.bilateralExtensionAsymmetry.value).toBeLessThan(0.001);
  });

  it('flags short top extension while still counting the rep', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic short extension lat pulldown', fullRepPath(), {
        armPath: 'short-extension',
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Extend fully — reach all the way up at the top.');
  });

  it('flags arm-dominant pulls with poor elbow drive', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic arm dominant lat pulldown', fullRepPath(), {
        armPath: 'arm-dominant',
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Drive your elbows down — pull with your lats, not just your arms.');
  });

  it('flags shrugging during the pull', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic shrugging lat pulldown', fullRepPath(), {
        shoulderShrug: true,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your shoulders down as you pull.');
  });

  it('flags torso rocking separately from a stable slight lean', () => {
    const stableLean = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic stable leaned lat pulldown', fullRepPath(), {
        posture: 'leaned',
      }),
    );
    const rocking = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic torso rocking lat pulldown', fullRepPath(), {
        torsoRock: true,
      }),
    );

    expect(stableLean.feedbackMessages).not.toContain('Keep your torso steady through the pulldown.');
    expect(rocking.finalRepCount).toBe(1);
    expect(rocking.feedbackMessages).toContain('Keep your torso steady through the pulldown.');
  });

  it('flags a fast pull', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic fast pull lat pulldown', fastPullPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Slow down the pull — control the descent.');
  });
});
