import { cableRowDefinition } from '../definitions/cableRow';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type TorsoPosture = 'upright' | 'leaned' | 'forward';
type ArmPath = 'normal' | 'highRow' | 'upperChest' | 'shrug' | 'protract';

type Point = { x: number; y: number; z?: number };

const FRAME_MS = 50;

const EXTENDED = {
  shoulder: { x: 0, y: 0.5, z: 0 },
  elbow: { x: 0.36, y: 0.55, z: 0 },
  wrist: { x: 0.72, y: 0.6, z: 0 },
  hip: { x: 0, y: 1.1, z: 0 },
};

const CONTRACTED = {
  shoulder: { x: 0, y: 0.5, z: 0 },
  elbow: { x: -0.18, y: 0.75, z: 0 },
  wrist: { x: 0.02, y: 0.72, z: 0 },
  hip: { x: 0, y: 1.1, z: 0 },
};

function kp(name: string, point: Point, score = 0.99): Keypoint {
  return { name, x: point.x, y: point.y, z: point.z ?? 0, score };
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
    ...interpolate(0, 1, 40),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 50),
    ...Array(8).fill(0),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.15, 8),
    ...interpolate(0.15, 0, 8),
    ...Array(8).fill(0),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 0.72, 16),
    ...interpolate(0.72, 0, 20),
    ...Array(8).fill(0),
  ];
}

function fastReturnPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 40),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 4),
    ...Array(8).fill(0),
  ];
}

function shortExtensionPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 40),
    ...Array(4).fill(1),
    ...interpolate(1, 0.47, 24),
    ...Array(8).fill(0.47),
  ];
}

function fastPullPath(): number[] {
  return [
    ...Array(16).fill(0),
    ...interpolate(0, 1, 4),
    ...Array(6).fill(1),
    ...interpolate(1, 0, 50),
    ...Array(8).fill(0),
  ];
}

function lerpPoint(a: Point, b: Point, t: number, mirror: number): Point {
  return {
    x: (a.x + (b.x - a.x) * t) * mirror,
    y: a.y + (b.y - a.y) * t,
    z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
  };
}

function poseAt(
  progress: number,
  orientation: Orientation,
  posture: TorsoPosture,
  armPath: ArmPath,
  torsoZMagnitude = 0.34,
) {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const shoulder = lerpPoint(EXTENDED.shoulder, CONTRACTED.shoulder, progress, mirror);
  const elbow = lerpPoint(EXTENDED.elbow, CONTRACTED.elbow, progress, mirror);
  const wrist = lerpPoint(EXTENDED.wrist, CONTRACTED.wrist, progress, mirror);
  const hip = lerpPoint(EXTENDED.hip, CONTRACTED.hip, progress, mirror);

  if (posture === 'leaned') {
    shoulder.z = -torsoZMagnitude;
  } else if (posture === 'forward') {
    shoulder.z = torsoZMagnitude;
  }

  if (armPath === 'highRow') {
    const lift = progress * 0.42;
    elbow.y -= lift;
    wrist.y -= lift * 0.55;
  } else if (armPath === 'upperChest') {
    const lift = progress * 0.22;
    elbow.y -= progress * 0.08;
    wrist.y -= lift;
  } else if (armPath === 'shrug') {
    const lift = progress * 0.16;
    shoulder.y -= lift;
    elbow.y -= lift;
    wrist.y -= lift;
  } else if (armPath === 'protract') {
    const protractedElbow = { x: 0.25 * mirror, y: 0.48, z: 0 };
    elbow.x += (protractedElbow.x - elbow.x) * progress;
    elbow.y += (protractedElbow.y - elbow.y) * progress;
    elbow.z = (elbow.z ?? 0) + ((protractedElbow.z ?? 0) - (elbow.z ?? 0)) * progress;
  }

  return { shoulder, elbow, wrist, hip };
}

function sideKeypoints(
  side: Side,
  progress: number,
  orientation: Orientation,
  posture: TorsoPosture,
  score: number,
  armPath: ArmPath,
  sideGap: number,
  torsoZMagnitude: number,
): Keypoint[] {
  const pose = poseAt(progress, orientation, posture, armPath, torsoZMagnitude);
  const offset = side === 'left' ? -sideGap / 2 : sideGap / 2;
  const withOffset = (point: Point) => ({ ...point, x: point.x + offset });

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
  posture: TorsoPosture,
  leftScore: number,
  rightScore: number,
  armPath: ArmPath,
  sideGap: number,
  torsoZMagnitude: number,
): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints('left', progress, orientation, posture, leftScore, armPath, sideGap, torsoZMagnitude),
      ...sideKeypoints('right', progress, orientation, posture, rightScore, armPath, sideGap, torsoZMagnitude),
    ],
  };
}

function makeFrame(
  timestamp: number,
  progress: number,
  side: Side,
  orientation: Orientation,
  posture: TorsoPosture,
  hiddenSideScore = 0.3,
  armPath: ArmPath,
  sideGap: number,
  torsoZMagnitude: number,
): LandmarkRecording['frames'][number] {
  return side === 'left'
    ? makeFrameWithScores(timestamp, progress, orientation, posture, 0.99, hiddenSideScore, armPath, sideGap, torsoZMagnitude)
    : makeFrameWithScores(timestamp, progress, orientation, posture, hiddenSideScore, 0.99, armPath, sideGap, torsoZMagnitude);
}

function buildRecording(
  description: string,
  path: number[],
  options: {
    side?: Side;
    orientation?: Orientation;
    posture?: TorsoPosture | ((index: number) => TorsoPosture);
    armPath?: ArmPath;
    sideGap?: number;
    sideSwitchFrame?: number;
    torsoZMagnitude?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'upright',
    armPath = 'normal',
    sideGap = 0.03,
    sideSwitchFrame,
    torsoZMagnitude = 0.34,
  } = options;

  return {
    exerciseName: 'Cable Row',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (path.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: path.map((progress, index) => {
      const framePosture = typeof posture === 'function' ? posture(index) : posture;
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        return side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.7, 0.99, armPath, sideGap, torsoZMagnitude)
          : makeFrameWithScores(index * FRAME_MS, progress, orientation, framePosture, 0.99, 0.7, armPath, sideGap, torsoZMagnitude);
      }
      return makeFrame(index * FRAME_MS, progress, side, orientation, framePosture, 0.3, armPath, sideGap, torsoZMagnitude);
    }),
  };
}

function jitter(index: number, keypointIndex: number, axis: number): number {
  const value = ((index + 1) * 17 + (keypointIndex + 3) * 11 + axis * 5) % 9;
  return (value - 4) * 0.0005;
}

function buildNoisyRecording(description: string, path: number[]): LandmarkRecording {
  const recording = buildRecording(description, path);
  return {
    ...recording,
    frames: recording.frames.map((frame, frameIndex) => ({
      ...frame,
      keypoints: frame.keypoints.map((keypoint, keypointIndex) => ({
        ...keypoint,
        x: keypoint.x + jitter(frameIndex, keypointIndex, 0),
        y: keypoint.y + jitter(frameIndex, keypointIndex, 1),
        z: (keypoint.z ?? 0) + jitter(frameIndex, keypointIndex, 2),
      })),
    })),
  };
}

function buildWorldStaticImageRecording(
  description: string,
  path: number[],
  options: Parameters<typeof buildRecording>[2] = {},
): LandmarkRecording {
  const imageRecording = buildRecording(description, path, options);
  const staticWorldRecording = buildRecording(`${description} static world`, Array(path.length).fill(0));
  return {
    ...imageRecording,
    frames: imageRecording.frames.map((frame, index) => ({
      timestamp: frame.timestamp,
      keypoints: staticWorldRecording.frames[index].keypoints,
      worldKeypoints: staticWorldRecording.frames[index].keypoints,
      imageKeypoints: frame.keypoints,
    })),
  };
}

function buildInvalidWorldImageRecording(
  description: string,
  path: number[],
  options: Parameters<typeof buildRecording>[2] = {},
): LandmarkRecording {
  const imageRecording = buildRecording(description, path, options);
  const invalidWorldRecording = buildRecording(`${description} invalid world`, Array(path.length).fill(0));
  return {
    ...imageRecording,
    frames: imageRecording.frames.map((frame, index) => {
      const worldKeypoints = invalidWorldRecording.frames[index].keypoints.map((keypoint) => ({
        ...keypoint,
        score: 0.05,
      }));
      return {
        timestamp: frame.timestamp,
        keypoints: worldKeypoints,
        worldKeypoints,
        imageKeypoints: frame.keypoints,
      };
    }),
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
    visibility: lowVisibilityJoints.has(point.name)
      ? 0.2
      : point.name.endsWith('_shoulder') || point.name.endsWith('_hip')
        ? 0.99
        : point.score,
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

function buildYawArtifactRecording(description: string, path: number[]): LandmarkRecording {
  const recording = buildRecording(description, path);
  return {
    ...recording,
    frames: recording.frames.map((frame, index) => ({
      ...frame,
      keypoints: frame.keypoints.map((keypoint) => {
        if (index < 45) return keypoint;
        if (keypoint.name === 'left_shoulder' || keypoint.name === 'left_hip') return { ...keypoint, z: -0.34 };
        if (keypoint.name === 'right_shoulder' || keypoint.name === 'right_hip') return { ...keypoint, z: 0.34 };
        return keypoint;
      }),
    })),
  };
}

function buildSegmentedRecording(
  description: string,
  segments: Array<{ path: number[]; gapAfterMs?: number }>,
  options: {
    side?: Side;
    orientation?: Orientation;
    posture?: TorsoPosture;
    hiddenSideScore?: number;
    armPath?: ArmPath;
    sideGap?: number;
    torsoZMagnitude?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'upright',
    hiddenSideScore = 0.3,
    armPath = 'normal',
    sideGap = 0.03,
    torsoZMagnitude = 0.34,
  } = options;
  const frames: LandmarkRecording['frames'] = [];
  let timestamp = 0;

  for (const segment of segments) {
    for (const progress of segment.path) {
      frames.push(makeFrame(timestamp, progress, side, orientation, posture, hiddenSideScore, armPath, sideGap, torsoZMagnitude));
      timestamp += FRAME_MS;
    }
    if (segment.gapAfterMs !== undefined) {
      timestamp += Math.max(0, segment.gapAfterMs - FRAME_MS);
    }
  }

  return {
    exerciseName: 'Cable Row',
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
  return buildSegmentedRecording('synthetic interrupted mid-rep cable row with recovery', [
    {
      path: [
        ...Array(16).fill(0),
        ...interpolate(0, 1, 40),
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

describe('Cable Row synthetic replay coverage', () => {
  it.each<Orientation>(['facing-right', 'facing-left'])(
    'counts a clean full rep when %s',
    orientation => {
      const result = replayRecording(
        cableRowDefinition,
        buildRecording(`synthetic clean cable row ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('does not count a tiny row pulse', () => {
    const result = replayRecordingVerbose(
      cableRowDefinition,
      buildRecording('synthetic tiny cable row pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a noisy clean row without form feedback', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildNoisyRecording('synthetic noisy clean cable row', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('keeps clean v2 PoseState cable rows fully scoreable with one visible arm and torso', () => {
    const result = replayRecording(
      cableRowDefinition,
      recordingWithV2PoseMetadata(
        buildRecording('synthetic clean v2 cable row with one visible arm', fullRepPath()),
      ),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
    expect(result.feedbackMessages).toEqual([]);
    expect(result.reps[0].diagnostics?.reliability).toMatchObject({
      countabilityCandidate: 'countable',
      scoreabilityCandidate: 'fullyScoreable',
      usableChains: expect.arrayContaining(['leftArm', 'torso']),
      weakChains: expect.arrayContaining(['rightArm']),
      unsafeCueFamilies: [],
      suppressedIssueIds: [],
    });
  });

  it('keeps visible-arm and torso cues available when the hidden arm chain is weak', () => {
    const result = replayRecording(
      cableRowDefinition,
      recordingWithV2PoseMetadata(
        buildRecording('synthetic high v2 cable row with hidden arm weak', fullRepPath(), { armPath: 'highRow' }),
      ),
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.feedbackMessages).toContain('Keep your elbows lower — row toward your ribs.');
    expect(diagnostics.reliability).toMatchObject({
      scoreabilityCandidate: 'fullyScoreable',
      safeCueFamilies: expect.arrayContaining(['handlePath', 'torsoControl', 'visibleArmPath']),
      unsafeCueFamilies: [],
    });
    expect(diagnostics.cues['cable-row.high_row'].triggered).toBe(true);
  });

  it('allows partial cue-level scoring for front-ish rows when selected arm and torso are reliable in v2 replay', () => {
    const result = replayRecording(
      cableRowDefinition,
      recordingWithV2PoseMetadata(
        buildRecording('synthetic front-ish selected-side reliable v2 cable row', fullRepPath(), {
          sideGap: 0.42,
        }),
      ),
      { confidenceGating: true },
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(diagnostics.scorable).toBe(true);
    expect(diagnostics.view).toBe('unknown');
    expect(diagnostics.viewCueGating).toMatchObject({
      sideViewGatePassed: false,
      partialViewScoringAllowed: true,
      finalScorableReason: 'partial_view_scoring',
      finalSafeCueFamilies: expect.arrayContaining(['visibleArmPath', 'torsoControl', 'tempo']),
    });
    expect(diagnostics.metrics.sideViewMinConfidence.value ?? 1).toBeLessThan(0.25);
  });

  it('counts but suppresses unsafe arm-path cues when both arm chains are unreliable in v2 replay', () => {
    const result = replayRecording(
      cableRowDefinition,
      recordingWithV2PoseMetadata(
        buildRecording('synthetic occluded v2 high cable row', fullRepPath(), { armPath: 'highRow' }),
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
    expect(result.reps[0].messages).not.toContain('Keep your elbows lower — row toward your ribs.');
    expect(diagnostics.reliability).toMatchObject({
      scoreabilityCandidate: 'partiallyScoreable',
      usableChains: expect.arrayContaining(['torso']),
      weakChains: expect.arrayContaining(['leftArm', 'rightArm']),
      unsafeCueFamilies: expect.arrayContaining(['handlePath', 'visibleArmPath', 'wristSpecific']),
      suppressedIssueIds: expect.arrayContaining([
        'cable-row.high_row',
        'cable-row.row_depth',
        'cable-row.row_extension',
        'cable-row.shoulder_retraction',
      ]),
    });
    expect(diagnostics.cues['cable-row.high_row']).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'reliability_unsafe_handlePath',
    });
    expect(diagnostics.viewCueGating?.finalUnscorableReason).toBe('pose_reliability_not_scoreable');
  });

  it('counts a meaningful partial row and records ROM feedback', () => {
    const clean = replayRecording(cableRowDefinition, buildRecording('synthetic clean cable row', fullRepPath()));
    const result = replayRecording(cableRowDefinition, buildRecording('synthetic half cable row', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Pull further back — squeeze your shoulder blades together.');
  });

  it('counts a short-extension row and records extension feedback', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic short-extension cable row', shortExtensionPath()),
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Extend your arms fully — get a full stretch at the front.');
    expect(diagnostics.metrics.extensionRatio.value ?? 1).toBeLessThan(0.92);
    expect(diagnostics.cues['cable-row.row_extension'].triggered).toBe(true);
  });

  it('aligns pull-depth score penalties with the tunable feedback threshold', () => {
    const lenientDefinition = cableRowDefinition.createVariant!({
      formThresholds: { PULL_DEPTH_FAIL: 0.8 },
    });
    const defaultResult = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic default-threshold half cable row', halfRepPath()),
    );
    const lenientResult = replayRecording(
      lenientDefinition,
      buildRecording('synthetic lenient-threshold half cable row', halfRepPath()),
    );

    expect(defaultResult.feedbackMessages).toContain('Pull further back — squeeze your shoulder blades together.');
    expect(lenientResult.feedbackMessages).not.toContain('Pull further back — squeeze your shoulder blades together.');
    expect(lenientResult.repScores[0]).toBeGreaterThan(defaultResult.repScores[0]);
  });

  it('keeps the visible side locked through a rep when visibility flips', () => {
    const result = replayRecordingVerbose(
      cableRowDefinition,
      buildRecording('synthetic cable row side visibility flip', fullRepPath(), {
        side: 'left',
        sideSwitchFrame: 48,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => trace.phase !== 'REST');
    expect(activeFrames.every(trace => trace.debugInfo.side === 'left')).toBe(true);
  });

  it('flags torso lean without punishing an upright row', () => {
    const clean = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic upright cable row', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic leaned cable row', fullRepPath(), {
        posture: index => (index < 45 ? 'upright' : 'leaned'),
      }),
    );
    const diagnostics = leaned.reps[0].diagnostics!;

    expect(clean.feedbackMessages).not.toContain('Stay upright — avoid leaning back during the pull.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Stay upright — avoid leaning back during the pull.');
    expect(leaned.feedbackMessages).not.toContain('Keep your torso steady through the row.');
    expect(diagnostics.metrics.torsoRockDelta.value).toBe(0);
    expect(diagnostics.cues['cable-row.torso_warn'].triggered).toBe(true);
    expect(diagnostics.cues['cable-row.torso_rocking'].triggered).toBe(false);
  });

  it.each<Orientation>(['facing-right', 'facing-left'])(
    'keeps torso lean direction consistent when %s',
    orientation => {
      const leaned = replayRecording(
        cableRowDefinition,
        buildRecording(`synthetic directional torso cable row ${orientation}`, fullRepPath(), {
          orientation,
          posture: index => (index < 45 ? 'upright' : 'leaned'),
        }),
      );
      const forward = replayRecording(
        cableRowDefinition,
        buildRecording(`synthetic forward torso cable row ${orientation}`, fullRepPath(), {
          orientation,
          posture: index => (index < 45 ? 'upright' : 'forward'),
        }),
      );

      expect(leaned.feedbackMessages).toContain('Stay upright — avoid leaning back during the pull.');
      expect(forward.feedbackMessages).not.toContain('Stay upright — avoid leaning back during the pull.');
    },
  );

  it('uses two-sided sagittal torso tracking instead of selected-side yaw artifacts', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildYawArtifactRecording('synthetic yaw artifact cable row', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Stay upright — avoid leaning back during the pull.');
  });

  it('keeps clean four-rep rows unchanged with normal frame intervals', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildMultiRepRecording('synthetic clean four cable rows', 4),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it.each([200, 700])('keeps counting unchanged for a %sms frame gap', (gapMs) => {
    const result = replayRecording(
      cableRowDefinition,
      buildMultiRepRecording(`synthetic four cable rows with ${gapMs}ms gap`, 4, { 1: gapMs }),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it('does not add a false rep across a long silent gap between rows', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildMultiRepRecording('synthetic four cable rows with walk-out gap', 4, { 1: 6000 }),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it('does not complete a stale active rep after a long silent gap', () => {
    const result = replayRecordingVerbose(
      cableRowDefinition,
      buildInterruptedMidRepRecording(),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repTraces).toHaveLength(1);
  });

  it('counts a real row after a long gap once stable frames rebuild', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildSegmentedRecording('synthetic long gap then clean cable row', [
        { path: Array(20).fill(0), gapAfterMs: 6000 },
        { path: fullRepPath() },
      ]),
    );

    expect(result.finalRepCount).toBe(1);
  });

  it('does not treat forward-only torso movement as lean-back cheating', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic forward torso drift cable row', fullRepPath(), {
        posture: index => (index < 32 ? 'upright' : 'forward'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Stay upright — avoid leaning back during the pull.');
  });

  it('flags torso rocking separately from lean-back', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic rocking cable row', fullRepPath(), {
        posture: index => (index < 45 ? 'upright' : index < 70 ? 'leaned' : 'forward'),
        torsoZMagnitude: 0.75,
      }),
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your torso steady through the row.');
    expect(diagnostics.metrics.torsoRockDelta.value ?? 0).toBeGreaterThan(0);
    expect(diagnostics.cues['cable-row.torso_rocking'].triggered).toBe(true);
  });

  it('flags a high row path without punishing a clean rib-level row', () => {
    const clean = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic clean rib-level cable row', fullRepPath()),
    );
    const highRow = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic high cable row', fullRepPath(), { armPath: 'highRow' }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your elbows lower — row toward your ribs.');
    expect(highRow.finalRepCount).toBe(1);
    expect(highRow.feedbackMessages).toContain('Keep your elbows lower — row toward your ribs.');
  });

  it('flags an upper-chest row via target height even when the elbow stays below the shoulder', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic upper chest cable row', fullRepPath(), { armPath: 'upperChest' }),
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Keep your elbows lower — row toward your ribs.');
    expect(diagnostics.metrics.elbowAboveShoulderRatio.value ?? 0).toBeLessThanOrEqual(0.08);
    expect(diagnostics.metrics.rowTargetHighRatio.value ?? 0).toBeGreaterThan(0.10);
    expect(diagnostics.cues['cable-row.high_row'].triggered).toBe(true);
  });

  it('flags shoulder shrug without punishing a clean row', () => {
    const clean = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic clean no-shrug cable row', fullRepPath()),
    );
    const shrug = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic shrugging cable row', fullRepPath(), { armPath: 'shrug' }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your shoulders down as you pull.');
    expect(shrug.finalRepCount).toBe(1);
    expect(shrug.feedbackMessages).toContain('Keep your shoulders down as you pull.');
  });

  it('does not count wrong-direction shoulder movement as shoulder retraction', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic protracted shoulder cable row', fullRepPath(), { armPath: 'protract' }),
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Drive your elbows back — focus on shoulder retraction.');
    expect(diagnostics.metrics.shoulderRetractionDelta.value ?? 0).toBeLessThan(15);
    expect(diagnostics.metrics.shoulderProtractionDelta.value ?? 0).toBeGreaterThan(0);
  });

  it('flags a fast pull from a naturally sub-maximal extended rest', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic fast pull cable row', fastPullPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Slow down the pull — control the contraction.');
  });

  it('still flags a true fast return', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic fast return cable row', fastReturnPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Control the return — don't let the weight pull you forward.");
  });

  it('counts but marks front-ish rows unscorable when side-view confidence is too low', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildRecording('synthetic poor side view cable row', fullRepPath(), { sideGap: 0.42 }),
      { confidenceGating: true },
    );
    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(diagnostics.scorable).toBe(false);
    expect(diagnostics.view).toBe('unknown');
    expect(diagnostics.metrics.sideViewConfidence.sampleCount).toBeGreaterThanOrEqual(5);
    expect(diagnostics.metrics.sideViewMinConfidence.sampleCount).toBeGreaterThanOrEqual(5);
    expect(diagnostics.metrics.sideViewMinConfidence.value ?? 1).toBeLessThan(0.25);
    expect(diagnostics.viewCueGating).toMatchObject({
      sideViewGatePassed: false,
      partialViewScoringAllowed: false,
      finalUnscorableReason: 'side_view_uncertain',
    });
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.feedbackMessages[0]).toContain('Turn side-on so I can judge your form.');
  });

  it('shows cable-row setup guidance while resting in a poor side view', () => {
    const poor = replayRecordingVerbose(
      cableRowDefinition,
      buildRecording('synthetic poor side-view setup cable row', Array(30).fill(0), { sideGap: 0.42 }),
    );
    const good = replayRecordingVerbose(
      cableRowDefinition,
      buildRecording('synthetic good side-view setup cable row', Array(30).fill(0), { sideGap: 0.03 }),
    );

    expect(poor.finalRepCount).toBe(0);
    expect(poor.frameTraces.some(trace => trace.feedback === 'Turn side-on so I can judge your row.')).toBe(true);
    expect(good.frameTraces.some(trace => trace.feedback === 'Turn side-on so I can judge your row.')).toBe(false);
  });

  it('uses image landmarks for row FSM when world x/y are not useful', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildWorldStaticImageRecording('synthetic image-driven cable row', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('falls back to image form metrics when world landmarks are stale but image form is clean', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildWorldStaticImageRecording('synthetic stale-world clean cable row', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('falls back to image form metrics when stale world landmarks hide torso lean', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildWorldStaticImageRecording('synthetic stale-world leaned cable row', fullRepPath(), {
        posture: index => (index < 45 ? 'upright' : 'leaned'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Stay upright — avoid leaning back during the pull.');
  });

  it('falls back to image landmarks for form metrics when world landmarks are invalid', () => {
    const result = replayRecording(
      cableRowDefinition,
      buildInvalidWorldImageRecording('synthetic image fallback torso cable row', fullRepPath(), {
        posture: index => (index < 45 ? 'upright' : 'leaned'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Stay upright — avoid leaning back during the pull.');
  });

});
