import { cablePushdownDefinition } from '../definitions/cablePushdown';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type Posture = 'upright' | 'slightLean' | 'leaned';
type ElbowPosition = 'pinned' | 'forward' | 'drifted';

type Point = { x: number; y: number };

const FRAME_MS = 50;

const BENT = {
  shoulder: { x: 0, y: 0.42 },
  elbow: { x: 0, y: 0.72 },
  wrist: { x: 0.32, y: 0.62 },
  hip: { x: 0, y: 1.05 },
};

const EXTENDED = {
  shoulder: { x: 0, y: 0.42 },
  elbow: { x: 0, y: 0.72 },
  wrist: { x: 0, y: 1.02 },
  hip: { x: 0, y: 1.05 },
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
    ...interpolate(0, 1, 26),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 38),
    ...Array(8).fill(0),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.22, 8),
    ...interpolate(0.22, 0, 8),
    ...Array(8).fill(0),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.62, 14),
    ...interpolate(0.62, 0, 18),
    ...Array(8).fill(0),
  ];
}

function shallowTopFullRepPath(): number[] {
  return [
    ...Array(16).fill(0.35),
    ...interpolate(0.35, 1, 26),
    ...Array(4).fill(1),
    ...interpolate(1, 0.35, 38),
    ...Array(8).fill(0.35),
  ];
}

function staticShallowTopPath(): number[] {
  return Array(80).fill(0.35);
}

function briefLockoutPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.2, 12),
    ...Array(4).fill(0.2),
    ...Array(3).fill(1),
    ...interpolate(1, 0, 4),
    ...Array(42).fill(0),
  ];
}

function fastPushPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 4),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 38),
    ...Array(8).fill(0),
  ];
}

function fastReturnPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 26),
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

function poseAt(
  progress: number,
  orientation: Orientation,
  posture: Posture,
  elbowPosition: ElbowPosition,
) {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const shoulder = lerpPoint(BENT.shoulder, EXTENDED.shoulder, progress, mirror);
  const elbow = lerpPoint(BENT.elbow, EXTENDED.elbow, progress, mirror);
  const wrist = lerpPoint(BENT.wrist, EXTENDED.wrist, progress, mirror);
  const hip = lerpPoint(BENT.hip, EXTENDED.hip, progress, mirror);

  if (posture === 'slightLean') {
    shoulder.x += 0.08 * mirror;
  } else if (posture === 'leaned') {
    shoulder.x += 0.18 * mirror;
  }

  if (elbowPosition === 'forward') {
    elbow.x += 0.16 * mirror;
    wrist.x += 0.16 * mirror;
  } else if (elbowPosition === 'drifted') {
    elbow.x += 0.18 * mirror;
    wrist.x += 0.18 * mirror;
  }

  return { shoulder, elbow, wrist, hip };
}

function sideKeypoints(
  side: Side,
  progress: number,
  orientation: Orientation,
  posture: Posture,
  elbowPosition: ElbowPosition,
  score: number,
  sideGap = 0.03,
): Keypoint[] {
  const pose = poseAt(progress, orientation, posture, elbowPosition);
  const offset = side === 'left' ? -sideGap * 0.5 : sideGap * 0.5;
  const withOffset = (point: Point) => ({ x: point.x + offset, y: point.y });

  return [
    kp(`${side}_shoulder`, withOffset(pose.shoulder), score),
    kp(`${side}_elbow`, withOffset(pose.elbow), score),
    kp(`${side}_wrist`, withOffset(pose.wrist), score),
    kp(`${side}_hip`, withOffset(pose.hip), score),
  ];
}

function makeFrameWithScores(
  timestamp: number,
  progress: number,
  orientation: Orientation,
  posture: Posture,
  elbowPosition: ElbowPosition,
  leftScore: number,
  rightScore: number,
  sideGap = 0.03,
): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints('left', progress, orientation, posture, elbowPosition, leftScore, sideGap),
      ...sideKeypoints('right', progress, orientation, posture, elbowPosition, rightScore, sideGap),
    ],
  };
}

function makeFrame(
  timestamp: number,
  progress: number,
  side: Side,
  orientation: Orientation,
  posture: Posture,
  elbowPosition: ElbowPosition,
  hiddenSideScore = 0.3,
  sideGap = 0.03,
): LandmarkRecording['frames'][number] {
  return side === 'left'
    ? makeFrameWithScores(timestamp, progress, orientation, posture, elbowPosition, 0.99, hiddenSideScore, sideGap)
    : makeFrameWithScores(timestamp, progress, orientation, posture, elbowPosition, hiddenSideScore, 0.99, sideGap);
}

function buildRecording(
  description: string,
  path: number[],
  options: {
    side?: Side;
    orientation?: Orientation;
    posture?: Posture | ((index: number) => Posture);
    elbowPosition?: ElbowPosition | ((index: number) => ElbowPosition);
    sideSwitchFrame?: number;
    sideGap?: number;
    hiddenSideScore?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'upright',
    elbowPosition = 'pinned',
    sideSwitchFrame,
    sideGap = 0.03,
    hiddenSideScore = 0.3,
  } = options;

  return {
    exerciseName: 'Cable Pushdowns',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (path.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: path.map((progress, index) => {
      const framePosture = typeof posture === 'function' ? posture(index) : posture;
      const frameElbowPosition = typeof elbowPosition === 'function' ? elbowPosition(index) : elbowPosition;
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        return side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, frameElbowPosition, 0.7, 0.99, sideGap)
          : makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, frameElbowPosition, 0.99, 0.7, sideGap);
      }
      return makeFrame(index * FRAME_MS, progress, side, orientation, framePosture, frameElbowPosition, hiddenSideScore, sideGap);
    }),
  };
}

function buildWorldImageMismatchRecording(): LandmarkRecording {
  const dynamicImage = buildRecording('synthetic image-driven cable pushdown', fullRepPath());
  const staticWorld = buildRecording('synthetic static world cable pushdown', Array(fullRepPath().length).fill(0));
  return {
    ...dynamicImage,
    metadata: {
      ...dynamicImage.metadata,
      description: 'synthetic image/world mismatch cable pushdown',
    },
    frames: dynamicImage.frames.map((frame, index) => ({
      timestamp: frame.timestamp,
      keypoints: staticWorld.frames[index].keypoints,
      worldKeypoints: staticWorld.frames[index].keypoints,
      imageKeypoints: frame.keypoints,
    })),
  };
}

function buildWorldStaticImageBadFormRecording(): LandmarkRecording {
  const dynamicImage = buildRecording('synthetic bad-form image cable pushdown', fullRepPath(), {
    posture: index => (index < 16 ? 'upright' : 'leaned'),
    elbowPosition: index => (index >= 20 && index < 50 ? 'drifted' : 'pinned'),
  });
  const staticWorld = buildRecording('synthetic stale clean world cable pushdown', Array(fullRepPath().length).fill(0));
  return {
    ...dynamicImage,
    metadata: {
      ...dynamicImage.metadata,
      description: 'synthetic stale-world image-bad-form cable pushdown',
    },
    frames: dynamicImage.frames.map((frame, index) => ({
      timestamp: frame.timestamp,
      keypoints: staticWorld.frames[index].keypoints,
      worldKeypoints: staticWorld.frames[index].keypoints,
      imageKeypoints: frame.keypoints,
    })),
  };
}

function buildImageZBadFormRecording(): LandmarkRecording {
  const recording = buildWorldStaticImageBadFormRecording();
  return {
    ...recording,
    metadata: {
      ...recording.metadata,
      description: 'synthetic image-z bad-form cable pushdown',
    },
    frames: recording.frames.map((frame, frameIndex) => ({
      ...frame,
      imageKeypoints: frame.imageKeypoints?.map(point => {
        const extraElbowDrift =
          frameIndex >= 20 &&
          frameIndex < 50 &&
          (point.name.endsWith('_elbow') || point.name.endsWith('_wrist'))
            ? 0.18
            : 0;
        return { ...point, x: point.x + extraElbowDrift, z: 0.2 };
      }),
    })),
  };
}

function buildMildlyNoisyCleanRecording(): LandmarkRecording {
  const recording = buildRecording('synthetic mildly noisy clean cable pushdown', fullRepPath());
  const noise = [-0.0015, 0.001, -0.0005, 0.0015, -0.001];
  return {
    ...recording,
    frames: recording.frames.map((frame, frameIndex) => ({
      ...frame,
      keypoints: frame.keypoints.map((point, pointIndex) => ({
        ...point,
        x: point.x + noise[(frameIndex + pointIndex) % noise.length],
        y: point.y + noise[(frameIndex * 2 + pointIndex) % noise.length],
        score: 0.99,
      })),
    })),
  };
}

function recordingWithV2PoseMetadata(
  recording: LandmarkRecording,
  options: {
    lowVisibilityJoints?: Set<string>;
    lowPresenceJoints?: Set<string>;
  } = {},
): LandmarkRecording {
  const lowVisibilityJoints = options.lowVisibilityJoints ?? new Set<string>();
  const lowPresenceJoints = options.lowPresenceJoints ?? new Set<string>();

  const metadataFor = (
    keypoints: Keypoint[] | undefined,
    source: 'image' | 'world',
  ) => keypoints?.map((point) => ({
    name: point.name,
    source,
    visibility: lowVisibilityJoints.has(point.name) ? 0.2 : point.score,
    presence: lowPresenceJoints.has(point.name) ? 0.2 : 1.0,
    visibilityState: 'present' as const,
    presenceState: 'present' as const,
    scoreSource: 'visibility' as const,
    malformedFields: [],
  }));

  return {
    ...recording,
    schemaVersion: 2,
    frames: recording.frames.map((frame) => {
      const imageKeypoints = frame.imageKeypoints ?? frame.keypoints;
      const worldKeypoints = frame.worldKeypoints;
      return {
        ...frame,
        timestampMs: frame.timestamp,
        status: 'poseDetected' as const,
        primarySource: frame.primarySource ?? (worldKeypoints?.length ? 'world' : 'image'),
        imageKeypoints,
        ...(worldKeypoints ? { worldKeypoints } : {}),
        poseMetadata: {
          imageLandmarks: metadataFor(imageKeypoints, 'image'),
          ...(worldKeypoints ? { worldLandmarks: metadataFor(worldKeypoints, 'world') } : {}),
        },
      };
    }),
  };
}

function buildSegmentedRecording(
  description: string,
  segments: Array<{ path: number[]; gapAfterMs?: number }>,
  options: {
    side?: Side;
    orientation?: Orientation;
    posture?: Posture;
    elbowPosition?: ElbowPosition;
    sideGap?: number;
    hiddenSideScore?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'upright',
    elbowPosition = 'pinned',
    sideGap = 0.03,
    hiddenSideScore = 0.3,
  } = options;
  const frames: LandmarkRecording['frames'] = [];
  let timestamp = 0;

  for (const segment of segments) {
    for (const progress of segment.path) {
      frames.push(makeFrame(timestamp, progress, side, orientation, posture, elbowPosition, hiddenSideScore, sideGap));
      timestamp += FRAME_MS;
    }
    if (segment.gapAfterMs !== undefined) {
      timestamp += Math.max(0, segment.gapAfterMs - FRAME_MS);
    }
  }

  return {
    exerciseName: 'Cable Pushdowns',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: timestamp / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames,
  };
}

function buildMultiRepRecording(
  description: string,
  repCount: number,
  gapsAfterRep: Record<number, number> = {},
): LandmarkRecording {
  return buildSegmentedRecording(
    description,
    Array.from({ length: repCount }, (_, repIndex) => ({
      path: fullRepPath(),
      gapAfterMs: gapsAfterRep[repIndex],
    })),
  );
}

function buildInterruptedMidRepRecording(): LandmarkRecording {
  return buildSegmentedRecording('synthetic interrupted mid-rep cable pushdown with recovery', [
    {
      path: [
        ...Array(16).fill(0),
        ...interpolate(0, 1, 26),
        ...Array(4).fill(1),
      ],
      gapAfterMs: 6000,
    },
    {
      path: [
        ...Array(16).fill(0),
        ...fullRepPath(),
      ],
    },
  ]);
}

describe('Cable Pushdown synthetic replay coverage', () => {
  it.each<Orientation>(['facing-right', 'facing-left'])(
    'counts a clean full rep when %s',
    orientation => {
      const result = replayRecording(
        cablePushdownDefinition,
        buildRecording(`synthetic clean cable pushdown ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('does not count a tiny pushdown pulse', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildRecording('synthetic tiny cable pushdown pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial pushdown and records ROM feedback', () => {
    const clean = replayRecording(cablePushdownDefinition, buildRecording('synthetic clean cable pushdown', fullRepPath()));
    const result = replayRecording(cablePushdownDefinition, buildRecording('synthetic half cable pushdown', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Extend fully — lock out at the bottom of each rep.');
  });

  it('counts a shallow-top full pushdown and records top-ROM feedback', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic shallow top cable pushdown', shallowTopFullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Start with a deeper bend — bring your forearms closer to your biceps.');
  });

  it('does not start a rep while statically holding a shallow top position', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildRecording('synthetic static shallow top cable pushdown', staticShallowTopPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.fsmTransitions.every(transition => transition.toPhase !== 'EXTENDING')).toBe(true);
  });

  it('keeps the visible side locked through a rep when visibility flips', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildRecording('synthetic cable pushdown side visibility flip', fullRepPath(), {
        side: 'left',
        sideSwitchFrame: 30,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => trace.phase !== 'REST');
    expect(activeFrames.every(trace => trace.debugInfo.side === 'left')).toBe(true);
  });

  it('marks poor side-view reps unscorable and shows setup guidance', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildRecording('synthetic poor side view cable pushdown', fullRepPath(), {
        sideGap: 0.42,
      }),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.frameTraces.some(trace => trace.feedback === 'Turn side-on so I can judge your pushdown.')).toBe(true);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('front');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('frontish_confirmed');
    expect(result.reps[0].issueIds).toEqual([]);
  });

  it('keeps one-side-only side captures scorable when the selected side chain is clear', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic one-side-only cable pushdown', fullRepPath(), {
        hiddenSideScore: 0.01,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings ?? []).not.toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('side');
    expect(result.reps[0].diagnostics?.viewQuality?.status).toBe('side_confirmed');
    expect(result.reps[0].diagnostics?.metrics.sideViewConfidence.value).toBeGreaterThanOrEqual(0.45);
  });

  it('does not leak form feedback or praise for poor side-view reps without replay gating', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildRecording('synthetic ungated poor side view cable pushdown', fullRepPath(), {
        sideGap: 0.42,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].score).toBe(0);
    expect(result.reps[0].messages).toEqual([]);
    expect(result.feedbackMessages).toEqual([]);
    expect(result.frameTraces.some(trace => trace.feedback === 'Turn side-on so I can judge your pushdown.')).toBe(true);
    expect(result.frameTraces.every(trace => trace.feedback !== 'Great rep!')).toBe(true);
    expect(result.frameTraces.every(trace => trace.feedback !== 'Good rep.')).toBe(true);
  });

  it('counts a mildly noisy clean pushdown without form feedback', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildMildlyNoisyCleanRecording(),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('keeps clean v2 PoseState cable pushdowns fully scoreable', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      recordingWithV2PoseMetadata(
        buildRecording('synthetic clean full-reliability v2 cable pushdown', fullRepPath(), {
          hiddenSideScore: 0.99,
        }),
      ),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
    expect(result.feedbackMessages).toEqual([]);
    expect(result.reps[0].diagnostics?.reliability).toMatchObject({
      countabilityCandidate: 'countable',
      scoreabilityCandidate: 'fullyScoreable',
      usableChains: expect.arrayContaining(['leftArm', 'rightArm', 'torso']),
      weakChains: [],
      safeCueFamilies: expect.arrayContaining([
        'repCount',
        'tempo',
        'torsoControl',
        'visibleArmPath',
        'handlePath',
        'elbowPath',
        'wristSpecific',
        'bilateralSymmetry',
      ]),
      unsafeCueFamilies: [],
      suppressedIssueIds: [],
    });
  });

  it('keeps one weak hidden arm countable when the selected side and torso are reliable', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      recordingWithV2PoseMetadata(
        buildRecording('synthetic selected-side reliable v2 cable pushdown', fullRepPath(), {
          hiddenSideScore: 0.99,
        }),
        {
          lowVisibilityJoints: new Set(['right_elbow', 'right_wrist']),
        },
      ),
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.feedbackMessages).toEqual([]);
    expect(diagnostics.selectedSide).toBe('left');
    expect(diagnostics.reliability).toMatchObject({
      countabilityCandidate: 'countable',
      scoreabilityCandidate: 'partiallyScoreable',
      usableChains: expect.arrayContaining(['leftArm', 'torso']),
      weakChains: expect.arrayContaining(['rightArm']),
      safeCueFamilies: expect.arrayContaining(['handlePath', 'wristSpecific', 'elbowPath', 'torsoControl']),
      unsafeCueFamilies: expect.arrayContaining(['bilateralSymmetry']),
      suppressedIssueIds: [],
    });
  });

  it('suppresses weak selected-arm path cues while leaving torso feedback safe in v2 replay', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      recordingWithV2PoseMetadata(
        buildRecording('synthetic selected-arm weak v2 cable pushdown', shallowTopFullRepPath(), {
          hiddenSideScore: 0.99,
          posture: index => (index < 16 ? 'upright' : 'leaned'),
          elbowPosition: index => (index >= 20 && index < 50 ? 'drifted' : 'pinned'),
        }),
        {
          lowVisibilityJoints: new Set(['left_elbow', 'left_wrist']),
        },
      ),
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.repScores[0]).toBe(0);
    expect(result.reps[0].messages).toContain('Stay upright — avoid leaning into the pushdown.');
    expect(result.reps[0].messages).not.toContain('Start with a deeper bend — bring your forearms closer to your biceps.');
    expect(result.reps[0].messages).not.toContain('Keep your elbows pinned to your sides — avoid letting them drift.');
    expect(diagnostics.reliability).toMatchObject({
      countabilityCandidate: 'maybe',
      scoreabilityCandidate: 'partiallyScoreable',
      usableChains: expect.arrayContaining(['rightArm', 'torso']),
      weakChains: expect.arrayContaining(['leftArm']),
      safeCueFamilies: expect.arrayContaining(['torsoControl']),
      unsafeCueFamilies: expect.arrayContaining(['handlePath', 'wristSpecific', 'elbowPath']),
      suppressedIssueIds: expect.arrayContaining([
        'cable-pushdowns.rom_short',
        'cable-pushdowns.elbow_drift',
      ]),
    });
    expect(diagnostics.cues['cable-pushdowns.rom_short']).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'reliability_unsafe_handlePath',
    });
    expect(diagnostics.cues['cable-pushdowns.elbow_drift']).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'reliability_unsafe_elbowPath',
    });
    expect(diagnostics.cues['cable-pushdowns.torso_warn'].triggered).toBe(true);
  });

  it('counts but marks both weak arm chains unscorable or partial in v2 replay', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      recordingWithV2PoseMetadata(
        buildRecording('synthetic both-arm weak v2 cable pushdown', fullRepPath(), {
          hiddenSideScore: 0.99,
        }),
        {
          lowVisibilityJoints: new Set([
            'left_elbow',
            'left_wrist',
            'right_elbow',
            'right_wrist',
          ]),
        },
      ),
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.repScores[0]).toBe(0);
    expect(['partiallyScoreable', 'notScoreable']).toContain(
      diagnostics.reliability?.scoreabilityCandidate,
    );
    expect(diagnostics.reliability).toMatchObject({
      usableChains: expect.arrayContaining(['torso']),
      weakChains: expect.arrayContaining(['leftArm', 'rightArm']),
      unsafeCueFamilies: expect.arrayContaining(['handlePath', 'wristSpecific', 'elbowPath']),
    });
  });

  it('keeps tracking-interruption protection with v2 PoseState metadata', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      recordingWithV2PoseMetadata(buildInterruptedMidRepRecording()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repTraces).toHaveLength(1);
  });

  it('uses image-space motion when world landmarks are static', () => {
    const result = replayRecording(cablePushdownDefinition, buildWorldImageMismatchRecording());

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
  });

  it('uses image-space form metrics when world landmarks are stale', () => {
    const result = replayRecording(cablePushdownDefinition, buildWorldStaticImageBadFormRecording());
    const metrics = result.reps[0].diagnostics?.metrics;

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Stay upright — avoid leaning into the pushdown.');
    expect(metrics?.elbowDriftDelta.eligible).toBe(true);
    expect(metrics?.elbowDriftDelta.sampleCount).toBeGreaterThan(0);
    expect(metrics?.shoulderMetricSource?.label).toBe('image');
    expect(metrics?.torsoAbsoluteDeviation.eligible).toBe(true);
    expect(metrics?.torsoAbsoluteDeviation.sampleCount).toBeGreaterThan(0);
    expect(metrics?.torsoMetricSource?.label).toBe('image');
  });

  it('keeps image-space form metrics 2D when image landmarks include z', () => {
    const result = replayRecording(cablePushdownDefinition, buildImageZBadFormRecording());
    const metrics = result.reps[0].diagnostics?.metrics;

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your elbows pinned to your sides — avoid letting them drift.');
    expect(result.feedbackMessages).toContain('Stay upright — avoid leaning into the pushdown.');
    expect(metrics?.elbowDriftDelta.eligible).toBe(true);
    expect(metrics?.torsoAbsoluteDeviation.value).toBeGreaterThan(14);
  });

  it('counts two clean pushdowns in sequence', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic two clean cable pushdowns', [
        ...fullRepPath(),
        ...fullRepPath(),
      ]),
    );

    expect(result.finalRepCount).toBe(2);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('keeps clean four-rep pushdowns unchanged with normal frame intervals', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildMultiRepRecording('synthetic clean four cable pushdowns', 4),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it.each([200, 700])('keeps counting unchanged for a %sms frame gap', (gapMs) => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildMultiRepRecording(`synthetic four cable pushdowns with ${gapMs}ms gap`, 4, { 1: gapMs }),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it('does not add a false rep across a long silent gap between pushdowns', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildMultiRepRecording('synthetic four cable pushdowns with walk-out gap', 4, { 1: 6000 }),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it('does not complete a stale active rep after a long silent gap', () => {
    const result = replayRecordingVerbose(
      cablePushdownDefinition,
      buildInterruptedMidRepRecording(),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repTraces).toHaveLength(1);
  });

  it('counts a real pushdown after a long gap once stable frames rebuild', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildSegmentedRecording('synthetic long gap then clean cable pushdown', [
        { path: Array(20).fill(0), gapAfterMs: 6000 },
        { path: fullRepPath() },
      ]),
    );

    expect(result.finalRepCount).toBe(1);
  });

  it('flags elbow drift without punishing pinned elbows', () => {
    const clean = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic pinned elbow pushdown', fullRepPath(), { elbowPosition: 'pinned' }),
    );
    const drifted = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic drifted elbow pushdown', fullRepPath(), {
        elbowPosition: index => (index >= 20 && index < 50 ? 'drifted' : 'pinned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your elbows pinned to your sides — avoid letting them drift.');
    expect(drifted.finalRepCount).toBe(1);
    expect(drifted.feedbackMessages).toContain('Keep your elbows pinned to your sides — avoid letting them drift.');
  });

  it('flags elbows that start too far forward separately from elbow drift', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic forward-elbow cable pushdown', fullRepPath(), {
        elbowPosition: 'forward',
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Start with your elbows tucked by your sides.');
  });

  it('flags torso lean without punishing upright pushdowns', () => {
    const clean = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic upright cable pushdown', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic leaned cable pushdown', fullRepPath(), {
        posture: index => (index < 16 ? 'upright' : 'leaned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Stay upright — avoid leaning into the pushdown.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Stay upright — avoid leaning into the pushdown.');
  });

  it('allows a slight static lean but flags dynamic torso rocking', () => {
    const slightLean = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic slight lean cable pushdown', fullRepPath(), { posture: 'slightLean' }),
    );
    const rocking = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic rocking cable pushdown', fullRepPath(), {
        posture: index => (index >= 34 && index < 58 ? 'leaned' : 'upright'),
      }),
    );

    expect(slightLean.finalRepCount).toBe(1);
    expect(slightLean.feedbackMessages).not.toContain('Stay upright — avoid leaning into the pushdown.');
    expect(slightLean.feedbackMessages).not.toContain('Keep your torso steady through the pushdown.');
    expect(rocking.finalRepCount).toBe(1);
    expect(rocking.feedbackMessages).toContain('Keep your torso steady through the pushdown.');
  });

  it('does not create elbow-drift or torso-lean feedback from low-confidence active frames', () => {
    const noisy = buildRecording('synthetic low-confidence cable pushdown form metrics', fullRepPath(), {
      posture: index => (index < 16 ? 'upright' : 'leaned'),
      elbowPosition: index => (index >= 20 && index < 50 ? 'drifted' : 'pinned'),
    });
    noisy.frames = noisy.frames.map((frame, index) => index >= 16
      ? { ...frame, keypoints: frame.keypoints.map(point => ({ ...point, score: 0.25 })) }
      : frame);

    const result = replayRecording(cablePushdownDefinition, noisy);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Keep your elbows pinned to your sides — avoid letting them drift.');
    expect(result.feedbackMessages).not.toContain('Stay upright — avoid leaning into the pushdown.');
    expect(result.reps[0].diagnostics?.metrics.elbowDriftDelta).toMatchObject({
      eligible: false,
      sampleCount: 0,
      skippedReason: 'shoulder_angle_unavailable',
    });
    expect(result.reps[0].diagnostics?.metrics.torsoAbsoluteDeviation).toMatchObject({
      eligible: false,
      sampleCount: 0,
      skippedReason: 'torso_chain_unavailable',
    });
    expect(result.reps[0].diagnostics?.cues['cable-pushdowns.elbow_drift']).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'shoulder_angle_unavailable',
    });
    expect(result.reps[0].diagnostics?.cues['cable-pushdowns.torso_warn']).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'torso_chain_unavailable',
    });
  });

  it('ignores a one-frame high-confidence elbow and torso spike', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic one-frame form spike cable pushdown', fullRepPath(), {
        posture: index => (index === 35 ? 'leaned' : 'upright'),
        elbowPosition: index => (index === 35 ? 'drifted' : 'pinned'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Keep your elbows pinned to your sides — avoid letting them drift.');
    expect(result.feedbackMessages).not.toContain('Stay upright — avoid leaning into the pushdown.');
    expect(result.feedbackMessages).not.toContain('Keep your torso steady through the pushdown.');
    expect(result.reps[0].diagnostics?.cues['cable-pushdowns.elbow_drift'].triggered).toBe(false);
    expect(result.reps[0].diagnostics?.cues['cable-pushdowns.torso_warn'].triggered).toBe(false);
    expect(result.reps[0].diagnostics?.cues['cable-pushdowns.torso_rocking'].triggered).toBe(false);
  });

  it('still flags a true fast return', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic fast return cable pushdown', fastReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Control the return — don't let the weight snap back.");
  });

  it('flags a rushed push and a bouncy lockout', () => {
    const fastPush = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic fast push cable pushdown', fastPushPath()),
    );
    const bouncyLockout = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic bouncy lockout cable pushdown', briefLockoutPath()),
    );

    expect(fastPush.finalRepCount).toBe(1);
    expect(fastPush.feedbackMessages).toContain('Slow down the push — control the extension.');
    expect(bouncyLockout.finalRepCount).toBe(1);
    expect(bouncyLockout.feedbackMessages).toContain('Extend fully — lock out at the bottom of each rep.');
    expect(bouncyLockout.reps[0].diagnostics?.metrics.lockoutHoldMs.value).toBeLessThan(300);
    expect(bouncyLockout.reps[0].diagnostics?.metrics.lockoutHoldMs.value).toBeGreaterThanOrEqual(0);
  });

  it('records clear production diagnostic keys for torso and velocity support', () => {
    const result = replayRecording(
      cablePushdownDefinition,
      buildRecording('synthetic diagnostic cable pushdown', fullRepPath()),
    );
    const metrics = result.reps[0].diagnostics?.metrics ?? {};

    expect(metrics.torsoDeltaFromBaseline).toBeUndefined();
    expect(metrics.torsoForwardDelta).toBeUndefined();
    expect(metrics.torsoRockDelta).toBeDefined();
    expect(metrics.pushVelocitySpikeRatio.sampleCount).toBeGreaterThanOrEqual(4);
    expect(metrics.returnVelocitySpikeRatio.sampleCount).toBeGreaterThanOrEqual(4);
  });
});
