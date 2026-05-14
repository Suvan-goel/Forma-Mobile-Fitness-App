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

function twoRepPathWithTopTimeout(): number[] {
  return [
    ...fullRepPath(),
    ...Array(40).fill(EXTENDED_ELBOW_Y),
    ...fullRepPath(),
  ];
}

function wristYForElbow(elbowY: number): number {
  const p = Math.max(0, Math.min(1, (elbowY - EXTENDED_ELBOW_Y) / (BOTTOM_ELBOW_Y - EXTENDED_ELBOW_Y)));
  return EXTENDED_WRIST_Y + (BOTTOM_WRIST_Y - EXTENDED_WRIST_Y) * p;
}

function torsoRockZForFrame(elbowPath: number[], index: number): number {
  const current = elbowPath[index] ?? EXTENDED_ELBOW_Y;
  if (current <= EXTENDED_ELBOW_Y + 0.02) return 0;

  const previous = elbowPath[Math.max(0, index - 1)] ?? current;
  const next = elbowPath[Math.min(elbowPath.length - 1, index + 1)] ?? current;
  const direction = next - previous;
  if (direction > 0.001 && current < 0.69) return 0;
  if (direction < -0.001) {
    return current > 0.62 ? -0.13 : 0.13;
  }
  return -0.13;
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
    torsoRockZ?: number;
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
  const shoulderZ = options.torsoRockZ ?? 0;

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
    torsoRockZ?: number;
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
    torsoRockZ?: number;
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
      const torsoRockZ = torsoRock ? torsoRockZForFrame(elbowPath, index) : undefined;
      const indexedFrameOptions = { ...frameOptions, torsoRockZ };
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        return side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, elbowY, orientation, posture, 0.7, 0.99, indexedFrameOptions)
          : makeFrameWithScores(index * FRAME_MS, elbowY, orientation, posture, 0.99, 0.7, indexedFrameOptions);
      }
      return makeFrame(index * FRAME_MS, elbowY, side, orientation, posture, hiddenSideScore, indexedFrameOptions);
    }),
  };
}

function buildWorldStaticImageRecording(
  description: string,
  elbowPath: number[],
  options: Parameters<typeof buildRecording>[2] = {},
): LandmarkRecording {
  const staticWorld = buildRecording(`${description} static world`, Array(elbowPath.length).fill(EXTENDED_ELBOW_Y));
  const movingImage = buildRecording(`${description} moving image`, elbowPath, options);
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

function mapRecordingKeypointSources(
  recording: LandmarkRecording,
  transform: (keypoints: Keypoint[], frameIndex: number) => Keypoint[],
): LandmarkRecording {
  return {
    ...recording,
    frames: recording.frames.map((frame, frameIndex) => {
      const nextFrame = {
        ...frame,
        keypoints: transform(frame.keypoints, frameIndex),
      };
      if (frame.worldKeypoints) {
        nextFrame.worldKeypoints = transform(frame.worldKeypoints, frameIndex);
      }
      if (frame.imageKeypoints) {
        nextFrame.imageKeypoints = transform(frame.imageKeypoints, frameIndex);
      }
      return nextFrame;
    }),
  };
}

function withKeypointScore(
  recording: LandmarkRecording,
  keypointName: string,
  score: number,
  startFrame: number,
): LandmarkRecording {
  return mapRecordingKeypointSources(recording, (keypoints, frameIndex) =>
    keypoints.map(keypoint =>
      frameIndex >= startFrame && keypoint.name === keypointName
        ? { ...keypoint, score }
        : keypoint,
    ),
  );
}

function withDegenerateTorsoHeightExcept(
  recording: LandmarkRecording,
  side: Side,
  validFrameIndexes: number[],
): LandmarkRecording {
  const validFrames = new Set(validFrameIndexes);
  return mapRecordingKeypointSources(recording, (keypoints, frameIndex) => {
    if (validFrames.has(frameIndex)) return keypoints;
    const shoulderY = keypoints.find(keypoint => keypoint.name === `${side}_shoulder`)?.y;
    if (shoulderY === undefined) return keypoints;
    return keypoints.map(keypoint =>
      keypoint.name === `${side}_hip`
        ? { ...keypoint, y: shoulderY }
        : keypoint,
    );
  });
}

const TORSO_ONLY_SCORING_DEFINITION = latPulldownDefinition.createVariant!({
  penaltyConfigs: {
    PULL_ROM: { cap: 0 },
    EXTENSION_ROM: { cap: 0 },
    ELBOW_DRIVE: { cap: 0 },
    SHOULDER_SHRUG: { cap: 0 },
    TEMPO_PULL: { cap: 0 },
    TEMPO_RETURN: { cap: 0 },
  },
});

const SHOULDER_ONLY_SCORING_DEFINITION = latPulldownDefinition.createVariant!({
  penaltyConfigs: {
    PULL_ROM: { cap: 0 },
    EXTENSION_ROM: { cap: 0 },
    ELBOW_DRIVE: { cap: 0 },
    TORSO_LEAN: { cap: 0 },
    TORSO_ABSOLUTE: { cap: 0 },
    TORSO_ROCK: { cap: 0 },
    TEMPO_PULL: { cap: 0 },
    TEMPO_RETURN: { cap: 0 },
  },
});

const LOOSE_TEMPO_SCORING_DEFINITION = latPulldownDefinition.createVariant!({
  formThresholds: {
    TEMPO_PULL_MIN: 0.05,
    TEMPO_RETURN_MIN: 0.05,
  },
  penaltyConfigs: {
    PULL_ROM: { cap: 0 },
    EXTENSION_ROM: { cap: 0 },
    ELBOW_DRIVE: { cap: 0 },
    TORSO_LEAN: { cap: 0 },
    TORSO_ABSOLUTE: { cap: 0 },
    TORSO_ROCK: { cap: 0 },
    SHOULDER_SHRUG: { cap: 0 },
  },
});

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

  it('keeps stale-world clean image form clean', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildWorldStaticImageRecording('synthetic clean image lat pulldown with stale world', fullRepPath(), {
        posture: 'upright',
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('uses image torso lean when world landmarks are stale', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildWorldStaticImageRecording('synthetic leaned image lat pulldown with stale world', fullRepPath(), {
        posture: 'leaned',
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Stay upright — avoid leaning back excessively.');
  });

  it('uses image torso rocking when world landmarks are stale', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildWorldStaticImageRecording('synthetic rocking image lat pulldown with stale world', fullRepPath(), {
        torsoRock: true,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your torso steady through the pulldown.');
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

  it('does not treat one-arm visible front-ish geometry as a scorable side view', () => {
    let recording = buildRecording('synthetic one-arm visible front-ish lat pulldown', fullRepPath(), {
      side: 'right',
      hiddenSideScore: 0.99,
      sideGap: 0.36,
    });
    recording = withKeypointScore(recording, 'left_elbow', 0.05, 0);
    recording = withKeypointScore(recording, 'left_wrist', 0.05, 0);

    const result = replayRecording(
      latPulldownDefinition,
      recording,
      { confidenceGating: true },
    );

    const metrics = result.reps[0].diagnostics?.metrics;
    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].diagnostics?.view).toBe('front');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('frontish_confirmed');
    expect(metrics?.bilateralSampleCount.value).toBe(0);
    expect(metrics?.frontishViewConfirmed.value).toBe(1);
    expect(result.feedbackMessages[0]).toContain('Turn side-on so I can judge your form.');
  });

  it('infers side-view quality from the selected side when the far side is hidden', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic single-side visible lat pulldown', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings).not.toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('side');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('side_confirmed');
    expect(result.reps[0].diagnostics?.metrics.sideViewConfirmed.value).toBe(1);
    expect(result.reps[0].diagnostics?.metrics.viewUnknown.value).toBe(0);
    expect(result.reps[0].diagnostics?.metrics.selectedSideSampleCount.value).toBeGreaterThanOrEqual(5);
    expect(result.reps[0].diagnostics?.metrics.bilateralRomAsymmetry.eligible).toBe(false);
  });

  it('counts but marks unknown-view pulldowns unscorable when selected-side support is insufficient', () => {
    const result = replayRecording(
      latPulldownDefinition,
      withKeypointScore(
        buildRecording('synthetic unknown-view lat pulldown with weak selected-side hip', fullRepPath()),
        'right_hip',
        0.23,
        0,
      ),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('unknown');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('view_unknown');
    expect(result.reps[0].diagnostics?.metrics.viewUnknown.value).toBe(1);
    expect(result.feedbackMessages[0]).toContain('Turn side-on so I can judge your form.');
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

  it('counts repeated short-extension reps after the top timeout', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic repeated short extension lat pulldown', twoRepPathWithTopTimeout(), {
        armPath: 'short-extension',
      }),
    );

    expect(result.finalRepCount).toBe(2);
    expect(
      result.feedbackMessages.filter(message => message === 'Extend fully — reach all the way up at the top.'),
    ).toHaveLength(2);
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

  it('keeps elbow-drive cue ineligible when active-side hip confidence drops after warmup', () => {
    let recording = withKeypointScore(
      buildRecording('synthetic lat pulldown with weak active hip for drive', fullRepPath(), {
        sideGap: 0.04,
      }),
      'right_hip',
      0.23,
      14,
    );
    for (const keypointName of ['left_shoulder', 'left_elbow', 'left_wrist', 'left_hip']) {
      recording = withKeypointScore(recording, keypointName, 0.99, 40);
    }

    const result = replayRecording(
      latPulldownDefinition,
      recording,
    );

    const metrics = result.reps[0].diagnostics?.metrics;
    const cues = result.reps[0].diagnostics?.cues;
    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].diagnostics?.scorable).toBe(true);
    expect(result.feedbackMessages).not.toContain('Drive your elbows down — pull with your lats, not just your arms.');
    expect(metrics?.upperArmDriveDelta.eligible).toBe(false);
    expect(metrics?.upperArmDriveDelta.sampleCount).toBeLessThan(3);
    expect(metrics?.upperArmDriveDelta.skippedReason).toBe('insufficient_upper_arm_drive_samples');
    expect(cues?.['cable-lat-pulldowns.elbow_drive'].eligible).toBe(false);
    expect(cues?.['cable-lat-pulldowns.elbow_drive'].triggered).toBe(false);
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

  it('keeps shoulder-shrug cue ineligible and unpenalized with too few valid shrug samples', () => {
    const result = replayRecording(
      SHOULDER_ONLY_SCORING_DEFINITION,
      withDegenerateTorsoHeightExcept(
        buildRecording('synthetic shrugging lat pulldown with sparse shrug samples', fullRepPath(), {
          shoulderShrug: true,
        }),
        'right',
        [22, 23],
      ),
    );

    const metrics = result.reps[0].diagnostics?.metrics;
    const cues = result.reps[0].diagnostics?.cues;
    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBe(100);
    expect(result.feedbackMessages).not.toContain('Keep your shoulders down as you pull.');
    expect(metrics?.shoulderShrugRatio.eligible).toBe(false);
    expect(metrics?.shoulderShrugRatio.sampleCount).toBeLessThan(3);
    expect(metrics?.shoulderShrugRatio.skippedReason).toBe('insufficient_shoulder_shrug_samples');
    expect(cues?.['cable-lat-pulldowns.shoulder_shrug'].eligible).toBe(false);
    expect(cues?.['cable-lat-pulldowns.shoulder_shrug'].triggered).toBe(false);
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
    expect(stableLean.reps[0].diagnostics?.metrics.torsoRockDelta.value).toBe(0);
    expect(rocking.finalRepCount).toBe(1);
    expect(rocking.feedbackMessages).toContain('Keep your torso steady through the pulldown.');
    expect(rocking.feedbackMessages).not.toContain('Stay upright — avoid leaning back excessively.');
  });

  it('keeps torso cues ineligible and unpenalized with insufficient torso samples', () => {
    const result = replayRecording(
      TORSO_ONLY_SCORING_DEFINITION,
      withKeypointScore(
        buildRecording('synthetic rocking lat pulldown with unavailable torso samples', fullRepPath(), {
          torsoRock: true,
        }),
        'right_hip',
        0.05,
        14,
      ),
    );

    const metrics = result.reps[0].diagnostics?.metrics;
    const cues = result.reps[0].diagnostics?.cues;
    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBe(100);
    expect(result.feedbackMessages).not.toContain('Stay upright — avoid leaning back excessively.');
    expect(result.feedbackMessages).not.toContain('Keep your torso steady through the pulldown.');
    expect(metrics?.torsoLeanBackDelta.eligible).toBe(false);
    expect(metrics?.torsoRockDelta.eligible).toBe(false);
    expect(metrics?.torsoAbsoluteBackLean.eligible).toBe(false);
    expect(metrics?.torsoRockDelta.sampleCount).toBeLessThan(3);
    expect(metrics?.torsoRockDelta.skippedReason).toBe('insufficient_torso_deviation_samples');
    expect(cues?.['cable-lat-pulldowns.torso_warn'].eligible).toBe(false);
    expect(cues?.['cable-lat-pulldowns.torso_warn'].triggered).toBe(false);
    expect(cues?.['cable-lat-pulldowns.torso_rocking'].eligible).toBe(false);
    expect(cues?.['cable-lat-pulldowns.torso_rocking'].triggered).toBe(false);
  });

  it('flags a fast pull', () => {
    const result = replayRecording(
      latPulldownDefinition,
      buildRecording('synthetic fast pull lat pulldown', fastPullPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Slow down the pull — control the descent.');
  });

  it('scores tempo from the tuned tempo thresholds instead of fixed penalty deadzones', () => {
    const result = replayRecording(
      LOOSE_TEMPO_SCORING_DEFINITION,
      buildRecording('synthetic loose-tempo lat pulldown', fastReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBe(100);
    expect(result.feedbackMessages).not.toContain('Control the return — resist the weight on the way up.');
  });
});
