import { lateralRaiseDefinition } from '../definitions/lateralRaise';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type Orientation = 'front' | 'mirrored';
type Posture = 'upright' | 'leaned' | 'shrug';
type ArmStyle = 'straight' | 'bent';
type ArmPlane = 'lateral' | 'front';

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

function fastRaisePath(): number[] {
  return [
    ...Array(18).fill(0),
    ...interpolate(0, 1, 5),
    ...Array(6).fill(1),
    ...interpolate(1, 0, 44),
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
  armPlane: ArmPlane,
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
  const lateralOffset = armPlane === 'front'
    ? 0.04
    : 0.04 + 0.48 * heightRatio;
  const wrist = {
    x: shoulder.x + sideSign * mirror * lateralOffset,
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
    armPlane: ArmPlane;
  },
): LandmarkRecording['frames'][number] {
  const left = sidePoints('left', leftRatio, options.orientation, options.posture, options.armStyle, options.armPlane);
  const right = sidePoints('right', rightRatio, options.orientation, options.posture, options.armStyle, options.armPlane);

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
    armPlane?: ArmPlane | ((index: number) => ArmPlane);
    rightScale?: number | ((index: number) => number);
  } = {},
): LandmarkRecording {
  const {
    orientation = 'front',
    posture = 'upright',
    armStyle = 'straight',
    armPlane = 'lateral',
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
      const frameArmPlane = typeof armPlane === 'function' ? armPlane(index) : armPlane;
      const frameRightScale = typeof rightScale === 'function' ? rightScale(index) : rightScale;
      return makeFrame(index * FRAME_MS, heightRatio, heightRatio * frameRightScale, {
        orientation,
        posture: framePosture,
        armStyle: frameArmStyle,
        armPlane: frameArmPlane,
      });
    }),
  };
}

function toWorldYUp(point: Keypoint, sagittalShoulderShift = 0, yawShoulderDepth = 0): Keypoint {
  const isShoulder = point.name === 'left_shoulder' || point.name === 'right_shoulder';
  const yawDepth = point.name === 'left_shoulder'
    ? -yawShoulderDepth / 2
    : point.name === 'right_shoulder'
      ? yawShoulderDepth / 2
      : 0;
  return {
    ...point,
    y: 1 - point.y,
    z: (point.z ?? 0) + (isShoulder ? sagittalShoulderShift : 0) + yawDepth,
  };
}

function withWorldContext(
  recording: LandmarkRecording,
  sagittalShoulderShift: (index: number) => number = () => 0,
  yawAngleDeg: (index: number) => number = () => 0,
): LandmarkRecording {
  return {
    ...recording,
    frames: recording.frames.map((frame, index) => {
      const imageKeypoints = frame.keypoints;
      const leftShoulder = imageKeypoints.find(point => point.name === 'left_shoulder');
      const rightShoulder = imageKeypoints.find(point => point.name === 'right_shoulder');
      const shoulderDx = leftShoulder && rightShoulder ? Math.abs(rightShoulder.x - leftShoulder.x) : 0;
      const yawDepth = Math.tan(yawAngleDeg(index) * Math.PI / 180) * shoulderDx;
      const worldKeypoints = imageKeypoints.map(point => toWorldYUp(point, sagittalShoulderShift(index), yawDepth));
      return {
        ...frame,
        keypoints: worldKeypoints,
        imageKeypoints,
        worldKeypoints,
      };
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

  it('uses image landmarks for Y-down lateral raise metrics when primary keypoints are world Y-up', () => {
    const recording = withWorldContext(
      buildRecording('synthetic clean lateral raise with world primary keypoints', fullRepPath()),
    );
    const result = replayRecording(lateralRaiseDefinition, recording);

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('counts but marks oblique world-landmark captures unscorable', () => {
    const recording = withWorldContext(
      buildRecording('synthetic oblique lateral raise', fullRepPath()),
      () => 0,
      () => 35,
    );
    const result = replayRecording(lateralRaiseDefinition, recording, { confidenceGating: true });

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('front_view_uncertain');
    expect(result.reps[0].diagnostics?.scorable).toBe(false);
    expect(result.reps[0].diagnostics?.view).toBe('oblique');
    expect(result.feedbackMessages[0]).toContain('Face the camera so I can judge your lateral raise.');
  });

  it('keeps clean front world-landmark captures scorable', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(buildRecording('synthetic front-view lateral raise', fullRepPath())),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings).not.toContain('front_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('front');
  });

  it('keeps image-only captures scorable and marks view-angle diagnostics ineligible', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic image-only lateral raise', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings).not.toContain('front_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('unknown');
    expect(result.reps[0].diagnostics?.metrics.viewAngleDeg.eligible).toBe(false);
    expect(result.reps[0].diagnostics?.metrics.viewAngleDeg.skippedReason).toBe('world_landmarks_unavailable');
  });

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

  it('accumulates full form samples for meaningful partial reps', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic leaned partial lateral raise', halfRepPath(), {
        posture: index => (index < 18 ? 'upright' : 'leaned'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Raise higher — aim for shoulder level.');
    expect(result.feedbackMessages).toContain('Stay upright — avoid swaying or leaning.');
    expect(result.reps[0].diagnostics?.metrics.torsoLean.sampleCount).toBeGreaterThanOrEqual(3);
  });

  it('counts a front raise but flags the wrong movement plane', () => {
    const clean = replayRecording(lateralRaiseDefinition, buildRecording('synthetic clean lateral raise', fullRepPath()));
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic front raise mistaken for lateral raise', fullRepPath(), { armPlane: 'front' }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Raise out to your sides — avoid turning it into a front raise.');
  });

  it('does not flag the wrong plane on a clean lateral raise', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic clean lateral path', fullRepPath()),
    );

    expect(result.feedbackMessages).not.toContain('Raise out to your sides — avoid turning it into a front raise.');
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

  it('does not flag asymmetry from a single-frame top spike', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic single-frame asymmetric lateral raise', fullRepPath(), {
        rightScale: index => (index === 53 ? 0.55 : 1),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Even it out — raise both arms to the same height.');
  });

  it('does not create bend, asymmetry, or torso feedback from low-confidence active frames', () => {
    const noisy = buildRecording('synthetic low-confidence lateral raise form metrics', fullRepPath(), {
      armStyle: index => (index < 18 ? 'straight' : 'bent'),
      posture: index => (index < 18 ? 'upright' : 'leaned'),
      rightScale: 0.78,
    });
    noisy.frames = noisy.frames.map((frame, index) => index >= 18
      ? { ...frame, keypoints: frame.keypoints.map(point => ({ ...point, score: 0.25 })) }
      : frame);

    const result = replayRecording(lateralRaiseDefinition, noisy);

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Keep your arms straighter — avoid excessive elbow bend.');
    expect(result.feedbackMessages).not.toContain('Even it out — raise both arms to the same height.');
    expect(result.feedbackMessages).not.toContain('Stay upright — avoid swaying or leaning.');
    expect(result.feedbackMessages).not.toContain('Raise out to your sides — avoid turning it into a front raise.');
    expect(result.feedbackMessages).not.toContain('Lift with control — avoid swinging the weights up.');
    expect(result.feedbackMessages).not.toContain("Relax your traps — don't shrug the weight up.");
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

  it('does not flag shrugging from a single-frame shoulder spike', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic one-frame shrug lateral raise', fullRepPath(), {
        posture: index => (index === 53 ? 'shrug' : 'upright'),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain("Relax your traps — don't shrug the weight up.");
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

  it('flags a swingy fast raise without punishing normal raise speed', () => {
    const clean = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic normal tempo lateral raise', fullRepPath()),
    );
    const fast = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic fast raise lateral raise', fastRaisePath()),
    );

    expect(clean.feedbackMessages).not.toContain('Lift with control — avoid swinging the weights up.');
    expect(fast.finalRepCount).toBe(1);
    expect(fast.feedbackMessages).toContain('Lift with control — avoid swinging the weights up.');
  });

  it('flags sagittal torso sway when world landmarks show backward/forward rocking', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic sagittal sway lateral raise', fullRepPath()),
        index => (index >= 45 && index <= 70 ? 0.2 : 0),
      ),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Stay upright — avoid swaying or leaning.');
  });
});
