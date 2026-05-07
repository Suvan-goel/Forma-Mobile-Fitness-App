import { squatDefinition } from '../definitions/squat';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Side = 'left' | 'right';
type Orientation = 'facing-right' | 'facing-left';
type TorsoPosture = 'upright' | 'leaned' | 'stable-forward' | 'backward';
type PoseProfile = 'clean' | 'true-depth-shallow' | 'ratio-fallback-shallow' | 'natural-low-lockout';

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

  it('flags incomplete lockout when the rep does not return to the standing baseline', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic incomplete lockout squat', incompleteLockoutPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].messages).toContain('Stand all the way up — fully extend your knees.');
    expect(result.reps[0].diagnostics?.metrics.lockoutDeltaRatio.value).toBeGreaterThan(0.035);
    expect(result.reps[0].diagnostics?.cues['barbell-squat.lockout_short'].metricKeys).toContain('lockoutDeltaRatio');
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
    const shallow = replayRecording(
      squatDefinition,
      buildRecording('synthetic true-depth shallow squat', fullRepPath(), {
        poseProfile: 'true-depth-shallow',
      }),
    );

    expect(shallow.finalRepCount).toBe(1);
    expect(shallow.feedbackMessages).toContain('Squat deeper — aim to get your thighs parallel.');
    expect(shallow.repScores[0]).toBeLessThan(clean.repScores[0]);
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
    expect(diagnostics.metrics.depthRatio.value).toBeLessThan(0.7);
    expect(diagnostics.cues['barbell-squat.depth_short'].metricKeys).toEqual(['thighDepthAngle']);
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
    expect(diagnostics.metrics.thighDepthAngle.eligible).toBe(false);
    expect(diagnostics.cues['barbell-squat.depth_short'].metricKeys).toEqual(['depthRatio']);
  });

  it('does not count a tiny squat pulse', () => {
    const result = replayRecordingVerbose(
      squatDefinition,
      buildRecording('synthetic tiny squat pulse', partialPath()),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial squat and records depth feedback', () => {
    const clean = replayRecording(squatDefinition, buildRecording('synthetic clean squat', fullRepPath()));
    const result = replayRecording(squatDefinition, buildRecording('synthetic half squat', halfRepPath()));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.repScores[0]).toBeLessThanOrEqual(65);
    expect(result.feedbackMessages).toContain('Squat deeper — aim to get your thighs parallel.');
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
