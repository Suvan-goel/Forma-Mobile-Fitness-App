import { squatDefinition } from '../definitions/squat';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type TorsoPosture = 'upright' | 'leaned' | 'stable-forward' | 'backward';
type PoseProfile = 'clean' | 'true-depth-shallow' | 'ratio-fallback-shallow' | 'natural-low-lockout' | 'low-rom-fallback';
type SquatViewMode = 'front' | 'oblique';
type FrontMotionMode = 'normal' | 'weak';
type WorldMotionMode = 'normal' | 'z-driven';

type Pose = {
  shoulder: { x: number; y: number };
  hip: { x: number; y: number };
  knee: { x: number; y: number };
  ankle: { x: number; y: number };
  heel: { x: number; y: number };
  foot: { x: number; y: number };
};

const FRAME_MS = 50;

const STANDING: Pose = {
  shoulder: { x: 0, y: 0 },
  hip: { x: 0, y: 0.5 },
  knee: { x: 0, y: 1.0 },
  ankle: { x: 0, y: 1.5 },
  heel: { x: -0.08, y: 1.5 },
  foot: { x: 0.2, y: 1.5 },
};

const BOTTOM: Pose = {
  shoulder: { x: -0.16, y: 0.45 },
  hip: { x: -0.22, y: 1.02 },
  knee: { x: 0.35, y: 1.05 },
  ankle: { x: 0, y: 1.5 },
  heel: { x: -0.08, y: 1.5 },
  foot: { x: 0.2, y: 1.5 },
};

const TRUE_DEPTH_SHALLOW_BOTTOM: Pose = {
  ...BOTTOM,
  shoulder: { x: -0.13, y: 0.22 },
  hip: { x: -0.22, y: 0.78 },
};

const RATIO_FALLBACK_SHALLOW_BOTTOM: Pose = {
  shoulder: { x: -0.08, y: 0.18 },
  hip: { x: 0, y: 0.65 },
  knee: { x: 0, y: 1.0 },
  ankle: { x: 0.9, y: 1.5 },
  heel: { x: 0.82, y: 1.5 },
  foot: { x: 1.1, y: 1.5 },
};

const LOW_ROM_FALLBACK_BOTTOM: Pose = {
  ...BOTTOM,
  shoulder: { x: -0.06, y: 0.48 },
  hip: { x: 0, y: 1.03 },
  knee: { x: 0.12, y: 1.05 },
};

const NATURAL_LOW_LOCKOUT_STANDING: Pose = {
  ...STANDING,
  knee: { x: 0.18, y: 1.0 },
};

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
    ...Array(20).fill(0),
    ...interpolate(0, 1, 50),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 35),
    ...Array(8).fill(0),
  ];
}

function partialPath(): number[] {
  return [
    ...Array(20).fill(0),
    ...interpolate(0, 0.22, 8),
    ...interpolate(0.22, 0, 8),
    ...Array(8).fill(0),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(20).fill(0),
    ...interpolate(0, 0.5, 16),
    ...interpolate(0.5, 0, 16),
    ...Array(8).fill(0),
  ];
}

function fastDescentPath(): number[] {
  return [
    ...Array(20).fill(0),
    ...interpolate(0, 1, 5),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 28),
    ...Array(8).fill(0),
  ];
}

function incompleteLockoutPath(): number[] {
  return [
    ...Array(20).fill(0),
    ...interpolate(0, 1, 50),
    ...Array(4).fill(1),
    ...interpolate(1, 0.3, 35),
    ...Array(12).fill(0.3),
  ];
}

function standingPoseFor(profile: PoseProfile): Pose {
  if (profile === 'natural-low-lockout') return NATURAL_LOW_LOCKOUT_STANDING;
  return STANDING;
}

function bottomPoseFor(profile: PoseProfile): Pose {
  if (profile === 'true-depth-shallow') return TRUE_DEPTH_SHALLOW_BOTTOM;
  if (profile === 'ratio-fallback-shallow') return RATIO_FALLBACK_SHALLOW_BOTTOM;
  if (profile === 'low-rom-fallback') return LOW_ROM_FALLBACK_BOTTOM;
  return BOTTOM;
}

function poseAt(
  depth: number,
  orientation: Orientation,
  posture: TorsoPosture,
  profile: PoseProfile,
  heelLift: boolean,
): Pose {
  const mirror = orientation === 'facing-left' ? -1 : 1;
  const lerpPoint = (a: Pose[keyof Pose], b: Pose[keyof Pose]) => ({
    x: (a.x + (b.x - a.x) * depth) * mirror,
    y: a.y + (b.y - a.y) * depth,
  });
  const standing = standingPoseFor(profile);
  const bottom = bottomPoseFor(profile);
  const pose = {
    shoulder: lerpPoint(standing.shoulder, bottom.shoulder),
    hip: lerpPoint(standing.hip, bottom.hip),
    knee: lerpPoint(standing.knee, bottom.knee),
    ankle: lerpPoint(standing.ankle, bottom.ankle),
    heel: lerpPoint(standing.heel, bottom.heel),
    foot: lerpPoint(standing.foot, bottom.foot),
  };

  if (posture === 'leaned') {
    pose.shoulder.x = pose.hip.x + 0.72 * mirror;
    pose.shoulder.y = pose.hip.y - 0.38;
  } else if (posture === 'stable-forward') {
    pose.shoulder.x = pose.hip.x + 0.46 * mirror;
    pose.shoulder.y = pose.hip.y - 0.45;
  } else if (posture === 'backward') {
    pose.shoulder.x = pose.hip.x - 0.72 * mirror;
    pose.shoulder.y = pose.hip.y - 0.38;
  }

  if (heelLift) {
    pose.heel.y -= 0.14 * depth;
  }

  return pose;
}

function sideKeypoints(
  side: Side,
  depth: number,
  orientation: Orientation,
  posture: TorsoPosture,
  score: number,
  profile: PoseProfile,
  heelLift: boolean,
  footScore: number,
  bilateralSpread: number,
): Keypoint[] {
  const pose = poseAt(depth, orientation, posture, profile, heelLift);
  const offset = side === 'left' ? -bilateralSpread : bilateralSpread;

  return [
    kp(`${side}_shoulder`, pose.shoulder.x + offset, pose.shoulder.y, score),
    kp(`${side}_hip`, pose.hip.x + offset, pose.hip.y, score),
    kp(`${side}_knee`, pose.knee.x + offset, pose.knee.y, score),
    kp(`${side}_ankle`, pose.ankle.x + offset, pose.ankle.y, score),
    kp(`${side}_heel`, pose.heel.x + offset, pose.heel.y, footScore),
    kp(`${side}_foot_index`, pose.foot.x + offset, pose.foot.y, footScore),
  ];
}

function makeFrameWithScores(
  timestamp: number,
  depth: number,
  orientation: Orientation,
  posture: TorsoPosture,
  leftScore: number,
  rightScore: number,
  profile: PoseProfile,
  heelLift: boolean,
  leftFootScore: number,
  rightFootScore: number,
  bilateralSpread: number,
): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [
      ...sideKeypoints('left', depth, orientation, posture, leftScore, profile, heelLift, leftFootScore, bilateralSpread),
      ...sideKeypoints('right', depth, orientation, posture, rightScore, profile, heelLift, rightFootScore, bilateralSpread),
    ],
  };
}

function makeFrame(
  timestamp: number,
  depth: number,
  side: Side,
  orientation: Orientation,
  posture: TorsoPosture,
  hiddenSideScore = 0.05,
  profile: PoseProfile = 'clean',
  heelLift = false,
  footScore = 0.99,
  bilateralSpread = 0.015,
): LandmarkRecording['frames'][number] {
  return side === 'left'
    ? makeFrameWithScores(timestamp, depth, orientation, posture, 0.99, hiddenSideScore, profile, heelLift, footScore, hiddenSideScore, bilateralSpread)
    : makeFrameWithScores(timestamp, depth, orientation, posture, hiddenSideScore, 0.99, profile, heelLift, hiddenSideScore, footScore, bilateralSpread);
}

function buildRecording(
  description: string,
  depthPath: number[],
  options: {
    side?: Side;
    orientation?: Orientation;
    posture?: TorsoPosture | ((index: number) => TorsoPosture);
    sideSwitchFrame?: number;
    poseProfile?: PoseProfile;
    heelLift?: boolean | ((index: number, depth: number) => boolean);
    footScore?: number | ((index: number, depth: number) => number);
    hiddenSideScore?: number;
    bilateralSpread?: number;
  } = {},
): LandmarkRecording {
  const {
    side = 'left',
    orientation = 'facing-right',
    posture = 'upright',
    sideSwitchFrame,
    poseProfile = 'clean',
    heelLift = false,
    footScore = 0.99,
    hiddenSideScore = 0.05,
    bilateralSpread = 0.015,
  } = options;

  return {
    exerciseName: 'Barbell Squat',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (depthPath.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: depthPath.map((depth, index) => {
      const framePosture = typeof posture === 'function' ? posture(index) : posture;
      const frameHeelLift = typeof heelLift === 'function' ? heelLift(index, depth) : heelLift;
      const frameFootScore = typeof footScore === 'function' ? footScore(index, depth) : footScore;
      if (sideSwitchFrame !== undefined && index >= sideSwitchFrame) {
        return side === 'left'
          ? makeFrameWithScores(index * FRAME_MS, depth, orientation, framePosture, 0.7, 0.99, poseProfile, frameHeelLift, frameFootScore, frameFootScore, bilateralSpread)
          : makeFrameWithScores(index * FRAME_MS, depth, orientation, framePosture, 0.99, 0.7, poseProfile, frameHeelLift, frameFootScore, frameFootScore, bilateralSpread);
      }
      return makeFrame(index * FRAME_MS, depth, side, orientation, framePosture, hiddenSideScore, poseProfile, frameHeelLift, frameFootScore, bilateralSpread);
    }),
  };
}

function frontImageKeypoints(
  depth: number,
  kneeValgus = false,
  score = 0.99,
  motionMode: FrontMotionMode = 'normal',
): Keypoint[] {
  const motionDepth = motionMode === 'weak' ? depth * 0.08 : depth;
  const hipY = 0.42 + motionDepth * 0.18;
  const kneeY = 0.72 + motionDepth * 0.1;
  const ankleY = 0.96;
  const leftHipX = 0.38;
  const rightHipX = 0.62;
  const leftAnkleX = 0.3;
  const rightAnkleX = 0.7;
  const lineLeftKneeX = leftHipX + (leftAnkleX - leftHipX) * ((kneeY - hipY) / (ankleY - hipY));
  const lineRightKneeX = rightHipX + (rightAnkleX - rightHipX) * ((kneeY - hipY) / (ankleY - hipY));
  const outwardBend = 0.14 * motionDepth;
  const valgusOffset = kneeValgus ? 0.22 * motionDepth : 0;

  return [
    kp('left_shoulder', 0.32, 0.2 + motionDepth * 0.06, score),
    kp('right_shoulder', 0.68, 0.2 + motionDepth * 0.06, score),
    kp('left_hip', leftHipX, hipY, score),
    kp('right_hip', rightHipX, hipY, score),
    kp('left_knee', lineLeftKneeX - outwardBend + valgusOffset, kneeY, score),
    kp('right_knee', lineRightKneeX + outwardBend - valgusOffset, kneeY, score),
    kp('left_ankle', leftAnkleX, ankleY, score),
    kp('right_ankle', rightAnkleX, ankleY, score),
    kp('left_heel', leftAnkleX - 0.03, ankleY, score),
    kp('right_heel', rightAnkleX + 0.03, ankleY, score),
    kp('left_foot_index', leftAnkleX + 0.04, ankleY + 0.01, score),
    kp('right_foot_index', rightAnkleX - 0.04, ankleY + 0.01, score),
  ];
}

function frontWorldKeypoints(
  depth: number,
  viewMode: SquatViewMode,
  score = 0.99,
  options: { worldMotion?: WorldMotionMode; hiddenSide?: Side } = {},
): Keypoint[] {
  const { worldMotion = 'normal', hiddenSide } = options;
  const makeZDrivenPose = (): Record<keyof Pose, { x: number; y: number; z: number }> => {
    const lerp = (standing: { x: number; y: number; z: number }, bottom: { x: number; y: number; z: number }) => ({
      x: standing.x + (bottom.x - standing.x) * depth,
      y: standing.y + (bottom.y - standing.y) * depth,
      z: standing.z + (bottom.z - standing.z) * depth,
    });
    return {
      shoulder: lerp({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.42, z: -0.12 }),
      hip: lerp({ x: 0, y: 0.5, z: 0 }, { x: 0, y: 1.02, z: -0.24 }),
      knee: lerp({ x: 0, y: 1.0, z: 0 }, { x: 0, y: 1.05, z: 0.48 }),
      ankle: lerp({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1.5, z: 0 }),
      heel: lerp({ x: -0.08, y: 1.5, z: 0 }, { x: -0.08, y: 1.5, z: 0 }),
      foot: lerp({ x: 0.2, y: 1.5, z: 0 }, { x: 0.2, y: 1.5, z: 0 }),
    };
  };
  const leftPose = worldMotion === 'z-driven'
    ? makeZDrivenPose()
    : poseAt(depth, 'facing-right', 'upright', 'clean', false);
  const rightPose = worldMotion === 'z-driven'
    ? makeZDrivenPose()
    : poseAt(depth, 'facing-right', 'upright', 'clean', false);
  const sideOffset = 0.12;
  const zSpread = viewMode === 'front' ? 0.02 : 0.34;
  const sideKps = (side: Side, pose: Pose | Record<keyof Pose, { x: number; y: number; z: number }>, offset: number, zOffset: number) => [
    { name: `${side}_shoulder`, point: pose.shoulder },
    { name: `${side}_hip`, point: pose.hip },
    { name: `${side}_knee`, point: pose.knee },
    { name: `${side}_ankle`, point: pose.ankle },
    { name: `${side}_heel`, point: pose.heel },
    { name: `${side}_foot_index`, point: pose.foot },
  ].map(({ name, point }) => ({
    name,
    x: point.x + offset,
    y: point.y,
    z: ('z' in point ? point.z : 0) + zOffset,
    score: hiddenSide === side ? 0.05 : score,
  }));

  return [
    ...sideKps('left', leftPose, -sideOffset, -zSpread / 2),
    ...sideKps('right', rightPose, sideOffset, zSpread / 2),
  ];
}

function buildFrontRecording(
  description: string,
  depthPath: number[],
  options: {
    viewMode?: SquatViewMode;
    kneeValgus?: boolean;
    includeWorld?: boolean;
    imageMotion?: FrontMotionMode;
    worldMotion?: WorldMotionMode;
    hiddenWorldSide?: Side;
    score?: number | ((index: number, depth: number) => number);
  } = {},
): LandmarkRecording {
  const {
    viewMode = 'front',
    kneeValgus = false,
    includeWorld = true,
    imageMotion = 'normal',
    worldMotion = 'normal',
    hiddenWorldSide,
    score = 0.99,
  } = options;

  return {
    exerciseName: 'Barbell Squat',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (depthPath.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: depthPath.map((depth, index) => {
      const frameScore = typeof score === 'function' ? score(index, depth) : score;
      const imageKeypoints = frontImageKeypoints(depth, kneeValgus, frameScore, imageMotion);
      const frame: LandmarkRecording['frames'][number] = {
        timestamp: index * FRAME_MS,
        keypoints: imageKeypoints,
        imageKeypoints,
      };
      if (includeWorld) {
        frame.worldKeypoints = frontWorldKeypoints(depth, viewMode, frameScore, {
          worldMotion,
          hiddenSide: hiddenWorldSide,
        });
      }
      return frame;
    }),
  };
}

function collectLiveWarnings(recording: LandmarkRecording): string[] {
  let state = squatDefinition.createState();
  const warnings = new Set<string>();
  const originalDateNow = Date.now;

  try {
    for (const frame of recording.frames) {
      Date.now = () => frame.timestamp;
      state = squatDefinition.update(frame.keypoints, state, {
        worldKeypoints: frame.worldKeypoints,
        imageKeypoints: frame.imageKeypoints ?? frame.keypoints,
        primarySource: frame.worldKeypoints ? 'world' : 'image',
        timestampMs: frame.timestamp,
      });
      state.liveQualityWarnings?.forEach(warning => warnings.add(warning));
    }
  } finally {
    Date.now = originalDateNow;
  }

  return [...warnings];
}

describe('Barbell Squat synthetic replay coverage', () => {
  it.each<Orientation>(['facing-right', 'facing-left'])(
    'counts a clean full rep when %s',
    orientation => {
      const result = replayRecording(
        squatDefinition,
        buildRecording(`synthetic clean squat ${orientation}`, fullRepPath(), { orientation }),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.feedbackMessages).toEqual([]);
    },
  );

  it('emits the new production diagnostics for a clean full rep', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic clean squat diagnostics', fullRepPath(), {
        hiddenSideScore: 0.99,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].diagnostics?.metrics.smoothedKneeRatio).toBeUndefined();
    expect(result.reps[0].diagnostics?.metrics).toEqual(
      expect.objectContaining({
        thighDepthAngle: expect.objectContaining({ eligible: true }),
        depthRatio: expect.objectContaining({ eligible: true }),
        lockoutRatio: expect.objectContaining({ eligible: true }),
        lockoutBaselineRatio: expect.objectContaining({ eligible: true }),
        lockoutDeltaRatio: expect.objectContaining({ eligible: true }),
        romRatio: expect.objectContaining({ eligible: true }),
        heelLiftDeltaDeg: expect.objectContaining({ eligible: true }),
        heelLiftSupport: expect.objectContaining({ eligible: true }),
        heelLiftEligibleSupport: expect.objectContaining({ eligible: true }),
        heelLiftOverThresholdSupport: expect.objectContaining({ eligible: true }),
        torsoLean: expect.objectContaining({ eligible: true }),
        torsoLeanDelta: expect.objectContaining({ eligible: true }),
        torsoLeanSigned: expect.objectContaining({ eligible: true }),
        sideViewWidthRatio: expect.objectContaining({ eligible: true }),
        sideViewQuality: expect.objectContaining({ value: 0 }),
        partialRep: expect.objectContaining({ value: 0 }),
      }),
    );
  });

  it('counts a clean front-view squat but marks it unscorable for side-view form scoring', () => {
    const recording = buildFrontRecording('synthetic clean front squat', fullRepPath());
    const result = replayRecordingVerbose(squatDefinition, recording);

    const rep = result.reps[0];
    expect(result.finalRepCount).toBe(1);
    expect(rep.score).toBe(0);
    expect(rep.scorable).toBe(false);
    expect(rep.qualityWarnings).toContain('side_view_uncertain');
    expect(rep.messages).toEqual([]);
    expect(rep.issueIds).toEqual([]);
    expect(rep.diagnostics?.view).toBe('front');
    expect(rep.diagnostics?.viewQuality?.frontConfirmed).toBe(true);
    expect(rep.diagnostics?.metrics.metricSource.label).toBe('world');
    expect(rep.diagnostics?.cues['barbell-squat.depth_short'].eligible).toBe(false);
    expect(rep.diagnostics?.cues['barbell-squat.lockout_short'].eligible).toBe(false);
    expect(rep.diagnostics?.cues['barbell-squat.incomplete_rom'].eligible).toBe(false);
    expect(rep.diagnostics?.cues['barbell-squat.heel_lift'].eligible).toBe(false);
    expect(rep.diagnostics?.cues['barbell-squat.heel_lift'].skippedReason).toBe('not_side_view');
    expect(rep.diagnostics?.cues['barbell-squat.knee_valgus']).toBeUndefined();
    expect(collectLiveWarnings(recording)).toContain('side_view_uncertain');
  });

  it('counts front-view world-z knee travel but keeps form scoring disabled', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildFrontRecording('synthetic world-z front squat', fullRepPath(), {
        imageMotion: 'weak',
        worldMotion: 'z-driven',
      }),
    );

    const rep = result.reps[0];
    expect(result.finalRepCount).toBe(1);
    expect(rep.score).toBe(0);
    expect(rep.scorable).toBe(false);
    expect(rep.messages).toEqual([]);
    expect(rep.issueIds).toEqual([]);
    expect(rep.diagnostics?.view).toBe('front');
    expect(rep.diagnostics?.metrics.metricSource.label).toBe('world');
    expect(rep.diagnostics?.metrics.movementKneeRatio.value).toBeLessThan(0.76);
    expect(rep.diagnostics?.metrics.leftWorldKneeRatioSupport.value).toBeGreaterThanOrEqual(0.35);
    expect(rep.diagnostics?.metrics.rightWorldKneeRatioSupport.value).toBeGreaterThanOrEqual(0.35);
  });

  it('counts front-view squats from the supported world side when the other side is occluded', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildFrontRecording('synthetic one-side world front squat', fullRepPath(), {
        worldMotion: 'z-driven',
        hiddenWorldSide: 'right',
      }),
    );

    const rep = result.reps[0];
    expect(result.finalRepCount).toBe(1);
    expect(rep.scorable).toBe(false);
    expect(rep.messages).toEqual([]);
    expect(rep.issueIds).toEqual([]);
    expect(rep.diagnostics?.metrics.leftKneeRatioSource.label).toBe('world');
    expect(rep.diagnostics?.metrics.rightKneeRatioSource.label).toBe('image');
    expect(rep.diagnostics?.metrics.leftWorldKneeRatioSupport.value).toBeGreaterThanOrEqual(0.35);
    expect(rep.diagnostics?.metrics.rightWorldKneeRatioSupport.eligible).toBe(false);
  });

  it('does not emit front-view knee valgus feedback in the side-only scoring scope', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildFrontRecording('synthetic front knee valgus squat', fullRepPath(), {
        kneeValgus: true,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].messages).toEqual([]);
    expect(result.reps[0].issueIds).toEqual([]);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.knee_valgus']).toBeUndefined();
    expect(result.reps[0].diagnostics?.metrics.kneeTrackingOffsetRatio.eligible).toBe(false);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.depth_short'].eligible).toBe(false);
  });

  it('keeps front-view reps unscorable when bilateral knee-tracking support is missing', () => {
    const recording = buildFrontRecording('synthetic front knee tracking occlusion squat', fullRepPath(), {
      kneeValgus: true,
      worldMotion: 'z-driven',
    });
    for (const frame of recording.frames) {
      for (const keypoint of frame.keypoints) {
        if (keypoint.name === 'right_knee' || keypoint.name === 'right_ankle') keypoint.score = 0.05;
      }
      for (const keypoint of frame.imageKeypoints ?? []) {
        if (keypoint.name === 'right_knee' || keypoint.name === 'right_ankle') keypoint.score = 0.05;
      }
    }

    const result = replayRecordingVerbose(squatDefinition, recording);

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].messages).toEqual([]);
    expect(result.reps[0].issueIds).not.toContain('barbell-squat.knee_valgus');
    expect(result.reps[0].diagnostics?.cues['barbell-squat.knee_valgus']).toBeUndefined();
  });

  it('counts an oblique-view squat but marks the rep unscorable with a view warning', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildFrontRecording('synthetic oblique squat', fullRepPath(), {
        viewMode: 'oblique',
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('oblique');
    expect(result.reps[0].diagnostics?.scorable).toBe(false);
    expect(result.reps[0].messages).toEqual([]);
    expect(result.reps[0].issueIds).toEqual([]);
  });

  it('counts a front-view image-only squat but does not score form without world landmarks', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildFrontRecording('synthetic front image-only squat', fullRepPath(), {
        includeWorld: false,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('front');
    expect(result.reps[0].diagnostics?.metrics.worldKneeRatioSupport.eligible).toBe(false);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.lockout_short'].eligible).toBe(false);
    expect(result.reps[0].messages).toEqual([]);
    expect(result.reps[0].issueIds).toEqual([]);
  });

  it('keeps front-view image-only reps unscorable even when image motion is enough to count', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildFrontRecording('synthetic front image-only countable squat', fullRepPath(), {
        includeWorld: false,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].messages).toEqual([]);
    expect(result.reps[0].issueIds).toEqual([]);
    expect(result.reps[0].diagnostics?.metrics.leftWorldKneeRatioSupport.eligible).toBe(false);
    expect(result.reps[0].diagnostics?.metrics.rightWorldKneeRatioSupport.eligible).toBe(false);
    expect(result.reps[0].diagnostics?.metrics.leftImageKneeRatioSupport.value).toBeGreaterThan(0);
    expect(result.reps[0].diagnostics?.metrics.rightImageKneeRatioSupport.value).toBeGreaterThan(0);
  });

  it('flags incomplete lockout when the rep does not return to the standing baseline', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic incomplete lockout squat', incompleteLockoutPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).toContain('Stand all the way up — fully extend your knees.');
    expect(result.reps[0].messages).not.toContain('Incomplete rep — use a full range of motion.');
    expect(result.reps[0].issueIds).toContain('barbell-squat.lockout_short');
    expect(result.reps[0].issueIds).not.toContain('barbell-squat.incomplete_rom');
    expect(result.reps[0].diagnostics?.metrics.lockoutDeltaRatio.value).toBeGreaterThan(0.035);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.lockout_short'].metricKeys).toContain('lockoutDeltaRatio');
    expect(result.reps[0].diagnostics?.cues['barbell-squat.incomplete_rom'].triggered).toBe(false);
    const metrics = result.reps[0].diagnostics?.metrics;
    expect(metrics?.movementEndDelaySeconds.value).toBeGreaterThan(0);
    expect(metrics?.tMovementEnd.value).toBeLessThan(metrics?.tConfirmedEnd.value ?? 0);
    expect(metrics?.tUp.value).toBeCloseTo(
      (metrics?.tMovementEnd.value ?? 0) - (metrics?.tBottom.value ?? 0),
      5,
    );
    expect(metrics?.tUp.value).toBeLessThan(
      (metrics?.tConfirmedEnd.value ?? 0) - (metrics?.tBottom.value ?? 0),
    );
  });

  it('does not false-positive lockout for a naturally lower but repeatable standing baseline', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic natural low-lockout squat', fullRepPath(), {
        poseProfile: 'natural-low-lockout',
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).not.toContain('Stand all the way up — fully extend your knees.');
    expect(result.reps[0].diagnostics?.metrics.lockoutRatio.value).toBeLessThan(0.95);
    expect(result.reps[0].diagnostics?.metrics.lockoutDeltaRatio.value).toBeLessThanOrEqual(0.035);
  });

  it('counts a shallow squat, triggers depth feedback, and scores below a clean squat', () => {
    const clean = replayRecording(
      squatDefinition,
      buildRecording('synthetic clean squat', fullRepPath()),
    );
    const shallow = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic true-depth shallow squat', fullRepPath(), {
        poseProfile: 'true-depth-shallow',
      }),
    );

    expect(shallow.finalRepCount).toBe(1);
    expect(shallow.reps[0].messages).toContain('Squat deeper — aim to get your thighs parallel.');
    expect(shallow.reps[0].messages).not.toContain('Incomplete rep — use a full range of motion.');
    expect(shallow.reps[0].issueIds).toContain('barbell-squat.depth_short');
    expect(shallow.reps[0].issueIds).not.toContain('barbell-squat.incomplete_rom');
    expect(shallow.reps[0].diagnostics?.cues['barbell-squat.incomplete_rom'].triggered).toBe(false);
    expect(shallow.reps[0].score).toBeLessThan(clean.repScores[0]);
  });

  it('catches true-depth shallow reps even when knee ratio looks deep enough', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic true-depth shallow ratio-pass squat', fullRepPath(), {
        poseProfile: 'true-depth-shallow',
      }),
    );

    const diagnostics = result.reps[0].diagnostics!;
    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).toContain('Squat deeper — aim to get your thighs parallel.');
    expect(result.reps[0].issueIds).toEqual(['barbell-squat.depth_short']);
    expect(diagnostics.metrics.depthRatio.value).toBeLessThan(0.7);
    expect(diagnostics.cues['barbell-squat.depth_short'].metricKeys).toEqual(['thighDepthAngle']);
    expect(diagnostics.cues['barbell-squat.incomplete_rom'].triggered).toBe(false);
  });

  it('falls back to knee ratio when true thigh depth is unavailable', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic fallback shallow squat', fullRepPath(), {
        poseProfile: 'ratio-fallback-shallow',
      }),
    );

    const diagnostics = result.reps[0].diagnostics!;
    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).toContain('Squat deeper — aim to get your thighs parallel.');
    expect(result.reps[0].issueIds).toContain('barbell-squat.depth_short');
    expect(result.reps[0].issueIds).not.toContain('barbell-squat.incomplete_rom');
    expect(diagnostics.metrics.thighDepthAngle.eligible).toBe(false);
    expect(diagnostics.cues['barbell-squat.depth_short'].metricKeys).toEqual(['depthRatio']);
    expect(diagnostics.cues['barbell-squat.incomplete_rom'].triggered).toBe(false);
  });

  it('does not count a tiny squat pulse', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic tiny squat pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial squat and records one endpoint ROM cue', () => {
    const clean = replayRecording(squatDefinition, buildRecording('synthetic clean squat', fullRepPath()));
    const result = replayRecordingVerbose(squatDefinition, buildRecording('synthetic half squat', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].score).toBeLessThan(clean.repScores[0]);
    expect(result.reps[0].score).toBeLessThanOrEqual(65);
    expect(result.reps[0].messages).toContain('Squat deeper — aim to get your thighs parallel.');
    expect(result.reps[0].messages).not.toContain('Incomplete rep — use a full range of motion.');
    expect(result.reps[0].issueIds).toContain('barbell-squat.depth_short');
    expect(result.reps[0].issueIds).not.toContain('barbell-squat.incomplete_rom');
  });

  it('uses incomplete ROM only as the low-ROM fallback when endpoints are not clearer', () => {
    const diagnosticVariant = squatDefinition.createVariant?.({
      formThresholds: {
        LOCKOUT_BASELINE_DELTA_FAIL: 0.08,
      },
    });
    expect(diagnosticVariant).toBeDefined();

    const result = replayRecordingVerbose(
      diagnosticVariant!,
      buildRecording('synthetic low-rom fallback squat', fullRepPath(), {
        poseProfile: 'low-rom-fallback',
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).toEqual(['Incomplete rep — use a full range of motion.']);
    expect(result.reps[0].issueIds).toEqual(['barbell-squat.incomplete_rom']);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.depth_short'].triggered).toBe(false);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.lockout_short'].triggered).toBe(false);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.incomplete_rom'].triggered).toBe(true);
  });

  it('flags heel lift when support is sustained during the active rep', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic heel lift squat', fullRepPath(), { heelLift: true }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).toContain('Keep your heels planted — drive through your mid-foot.');
    expect(result.reps[0].issueIds).toContain('barbell-squat.heel_lift');
    expect(result.reps[0].score).toBeLessThanOrEqual(85);
  });

  it('does not trigger heel lift when foot visibility support is too low', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic low-support heel lift squat', fullRepPath(), {
        heelLift: true,
        footScore: (index) => (index < 22 || index === 52 ? 0.99 : 0.05),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).not.toContain('Keep your heels planted — drive through your mid-foot.');
    expect(result.reps[0].diagnostics?.metrics.heelLiftEligibleSupport.value).toBeLessThan(0.35);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.heel_lift'].triggered).toBe(false);
  });

  it('does not trigger heel lift from a brief one-frame spike', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic heel lift spike squat', fullRepPath(), {
        heelLift: (index) => index === 52,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).not.toContain('Keep your heels planted — drive through your mid-foot.');
    expect(result.reps[0].diagnostics?.metrics.heelLiftOverThresholdSupport.value).toBeLessThan(0.2);
  });

  it('does not trigger heel lift from low-confidence foot landmarks', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic low-confidence foot squat', fullRepPath(), {
        heelLift: true,
        footScore: 0.05,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).not.toContain('Keep your heels planted — drive through your mid-foot.');
    expect(result.reps[0].diagnostics?.metrics.heelLiftDeltaDeg.eligible).toBe(false);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.heel_lift'].eligible).toBe(false);
  });

  it('keeps the visible side locked through a rep when visibility flips', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic squat side visibility flip', fullRepPath(), {
        side: 'left',
        sideSwitchFrame: 55,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    const activeFrames = result.frameTraces.filter(trace => {
      const phase = String(trace.phase);
      return phase !== 'IDLE' && phase !== 'STANDING';
    });
    expect(activeFrames.every(trace => trace.debugInfo.side === 'left')).toBe(true);
  });

  it('flags excessive torso lean without punishing an upright squat', () => {
    const clean = replayRecording(
      squatDefinition,
      buildRecording('synthetic upright squat', fullRepPath(), { posture: 'upright' }),
    );
    const leaned = replayRecording(
      squatDefinition,
      buildRecording('synthetic leaned squat', fullRepPath(), {
        posture: index => (index < 45 ? 'upright' : 'leaned'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Too much forward lean — keep your chest up.');
    expect(clean.feedbackMessages).not.toContain('Stay more upright — brace your core.');
    expect(leaned.finalRepCount).toBe(1);
    expect(leaned.feedbackMessages).toContain('Too much forward lean — keep your chest up.');
  });

  it('uses torso baseline delta so stable forward posture is not punished', () => {
    const stableForward = replayRecording(
      squatDefinition,
      buildRecording('synthetic stable forward squat', fullRepPath(), {
        posture: index => (index < 18 ? 'upright' : 'stable-forward'),
      }),
    );

    expect(stableForward.finalRepCount).toBe(1);
    expect(stableForward.feedbackMessages).not.toContain('Too much forward lean — keep your chest up.');
    expect(stableForward.feedbackMessages).not.toContain('Stay more upright — brace your core.');
  });

  it('does not treat backward torso lean as forward-lean feedback', () => {
    const result = replayRecording(
      squatDefinition,
      buildRecording('synthetic backward torso squat', fullRepPath(), {
        posture: index => (index < 45 ? 'upright' : 'backward'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Too much forward lean — keep your chest up.');
    expect(result.feedbackMessages).not.toContain('Stay more upright — brace your core.');
  });

  it('emits side-view quality diagnostics for front-ish capture without blocking rep counting', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic front-ish squat', fullRepPath(), {
        hiddenSideScore: 0.99,
        bilateralSpread: 0.24,
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].diagnostics?.metrics.sideViewWidthRatio.value).toBeGreaterThan(0.28);
    expect(result.reps[0].diagnostics?.metrics.sideViewQuality.value).toBe(2);
  });

  it('still flags a true fast descent', () => {
    const result = replayRecording(
      squatDefinition,
      buildRecording('synthetic fast descent squat', fastDescentPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Slow the descent — control the weight down.');
  });
});
