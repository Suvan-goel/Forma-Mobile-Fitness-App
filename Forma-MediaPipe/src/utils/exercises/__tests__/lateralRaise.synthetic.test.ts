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
  bodyShiftX: number,
) {
  const mirror = orientation === 'mirrored' ? -1 : 1;
  const sideSign = side === 'left' ? -1 : 1;
  const shoulderBaseX = sideSign * 0.22 * mirror;
  const hipBaseX = sideSign * 0.18 * mirror;
  const leanX = posture === 'leaned' ? 0.08 * mirror : 0;
  const shrugY = posture === 'shrug' ? -0.1 : 0;
  const shoulder = {
    x: shoulderBaseX + leanX + bodyShiftX,
    y: SHOULDER_Y + shrugY,
  };
  const hip = {
    x: hipBaseX + bodyShiftX,
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
    leftArmPlane: ArmPlane;
    rightArmPlane: ArmPlane;
    leftWristScore: number;
    rightWristScore: number;
    bodyShiftX: number;
    noseScore: number;
    leftEarScore: number;
    rightEarScore: number;
  },
): LandmarkRecording['frames'][number] {
  const left = sidePoints('left', leftRatio, options.orientation, options.posture, options.armStyle, options.leftArmPlane, options.bodyShiftX);
  const right = sidePoints('right', rightRatio, options.orientation, options.posture, options.armStyle, options.rightArmPlane, options.bodyShiftX);

  return {
    timestamp,
    keypoints: [
      kp('nose', options.bodyShiftX, 0.18, options.noseScore),
      kp('left_ear', options.bodyShiftX - 0.08, 0.22, options.leftEarScore),
      kp('right_ear', options.bodyShiftX + 0.08, 0.22, options.rightEarScore),
      kp('left_shoulder', left.shoulder.x, left.shoulder.y),
      kp('left_elbow', left.elbow.x, left.elbow.y),
      kp('left_wrist', left.wrist.x, left.wrist.y, options.leftWristScore),
      kp('left_hip', left.hip.x, left.hip.y),
      kp('right_shoulder', right.shoulder.x, right.shoulder.y),
      kp('right_elbow', right.elbow.x, right.elbow.y),
      kp('right_wrist', right.wrist.x, right.wrist.y, options.rightWristScore),
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
    leftArmPlane?: ArmPlane | ((index: number) => ArmPlane);
    rightArmPlane?: ArmPlane | ((index: number) => ArmPlane);
    rightScale?: number | ((index: number) => number);
    leftWristScore?: number | ((index: number) => number);
    rightWristScore?: number | ((index: number) => number);
    bodyShiftX?: number | ((index: number) => number);
    noseScore?: number | ((index: number) => number);
    leftEarScore?: number | ((index: number) => number);
    rightEarScore?: number | ((index: number) => number);
  } = {},
): LandmarkRecording {
  const {
    orientation = 'front',
    posture = 'upright',
    armStyle = 'straight',
    armPlane = 'lateral',
    leftArmPlane,
    rightArmPlane,
    rightScale = 1,
    leftWristScore = 0.99,
    rightWristScore = 0.99,
    bodyShiftX = 0,
    noseScore = 0.99,
    leftEarScore = 0.99,
    rightEarScore = 0.99,
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
      const frameLeftArmPlane = leftArmPlane === undefined
        ? frameArmPlane
        : typeof leftArmPlane === 'function' ? leftArmPlane(index) : leftArmPlane;
      const frameRightArmPlane = rightArmPlane === undefined
        ? frameArmPlane
        : typeof rightArmPlane === 'function' ? rightArmPlane(index) : rightArmPlane;
      const frameRightScale = typeof rightScale === 'function' ? rightScale(index) : rightScale;
      const frameLeftWristScore = typeof leftWristScore === 'function' ? leftWristScore(index) : leftWristScore;
      const frameRightWristScore = typeof rightWristScore === 'function' ? rightWristScore(index) : rightWristScore;
      const frameBodyShiftX = typeof bodyShiftX === 'function' ? bodyShiftX(index) : bodyShiftX;
      const frameNoseScore = typeof noseScore === 'function' ? noseScore(index) : noseScore;
      const frameLeftEarScore = typeof leftEarScore === 'function' ? leftEarScore(index) : leftEarScore;
      const frameRightEarScore = typeof rightEarScore === 'function' ? rightEarScore(index) : rightEarScore;
      return makeFrame(index * FRAME_MS, heightRatio, heightRatio * frameRightScale, {
        orientation,
        posture: framePosture,
        armStyle: frameArmStyle,
        leftArmPlane: frameLeftArmPlane,
        rightArmPlane: frameRightArmPlane,
        leftWristScore: frameLeftWristScore,
        rightWristScore: frameRightWristScore,
        bodyShiftX: frameBodyShiftX,
        noseScore: frameNoseScore,
        leftEarScore: frameLeftEarScore,
        rightEarScore: frameRightEarScore,
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

  it('counts two clean reps in one recording with clean feedback and two rep traces', () => {
    const result = replayRecordingVerbose(
      lateralRaiseDefinition,
      buildRecording('synthetic two clean lateral raise reps', [
        ...fullRepPath(),
        ...fullRepPath(),
      ]),
    );

    expect(result.finalRepCount).toBe(2);
    expect(result.feedbackMessages).toEqual([]);
    expect(result.repTraces).toHaveLength(2);
    expect(result.repScores).toHaveLength(2);
    expect(result.repScores.every(score => score >= 85)).toBe(true);
  });

  it('uses image landmarks for Y-down lateral raise metrics when primary keypoints are world Y-up', () => {
    const recording = withWorldContext(
      buildRecording('synthetic clean lateral raise with world primary keypoints', fullRepPath()),
    );
    const result = replayRecording(lateralRaiseDefinition, recording);

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('counts but marks sustained oblique world-landmark captures unscorable', () => {
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
    expect(result.feedbackMessages[0]).toContain('Face the camera so I can judge your form.');
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

  it('keeps mostly-front captures with brief oblique yaw scorable and diagnosed as front', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic mostly-front lateral raise with brief oblique yaw', fullRepPath()),
        () => 0,
        index => (index >= 45 && index <= 54 ? 80 : 0),
      ),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings).not.toContain('front_view_uncertain');
    expect(result.reps[0].diagnostics?.view).toBe('front');
  });

  it('counts image-only captures but marks view-angle diagnostics ineligible and unscorable', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic image-only lateral raise', fullRepPath()),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('front_view_uncertain');
    expect(result.reps[0].diagnostics?.scorable).toBe(false);
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

  it('flags the wrong movement plane when only one arm turns into a front raise', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic one-sided front raise lateral raise', fullRepPath(), {
          rightArmPlane: 'front',
        }),
      ),
    );

    const metrics = result.reps[0].diagnostics?.metrics;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.feedbackMessages).toContain('Raise out to your sides — avoid turning it into a front raise.');
    expect(metrics?.weakestPeakLateralReachRatio.value).toBeLessThan(0.45);
    expect(metrics?.leftPeakLateralReachRatio.value).toBeGreaterThan(metrics?.rightPeakLateralReachRatio.value ?? 0);
  });

  it('counts with estimated endpoints when wrists are missing but makes wrist-dependent cues ineligible', () => {
    const activeWristScore = (index: number) => (index >= 18 && index <= 96 ? 0.05 : 0.99);
    const result = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic missing-wrist lateral raise', fullRepPath(), {
          leftWristScore: activeWristScore,
          rightWristScore: activeWristScore,
        }),
      ),
    );

    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('arms_hidden');
    expect(result.reps[0].qualityWarnings).not.toContain('front_view_uncertain');
    expect(diagnostics.scorable).toBe(false);
    expect(result.feedbackMessages).not.toContain('Keep your arms straighter — avoid excessive elbow bend.');
    expect(result.feedbackMessages).not.toContain('Raise out to your sides — avoid turning it into a front raise.');
    expect(diagnostics.metrics.wristEndpointCoverage.value).toBeLessThan(0.25);
    expect(diagnostics.metrics.minStraightnessRatio.eligible).toBe(false);
    expect(diagnostics.metrics.peakLateralReachRatio.eligible).toBe(false);
    expect(diagnostics.cues['standing-dumbbell-lateral-raises.elbow_bend'].eligible).toBe(false);
    expect(diagnostics.cues['standing-dumbbell-lateral-raises.wrong_plane'].eligible).toBe(false);
  });

  it('ignores a one-frame wrist dropout without false wrist-dependent feedback', () => {
    const oneFrameDropout = (index: number) => (index === 53 ? 0.05 : 0.99);
    const result = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic one-frame wrist dropout lateral raise', fullRepPath(), {
          leftWristScore: oneFrameDropout,
          rightWristScore: oneFrameDropout,
        }),
      ),
    );

    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.reps[0].qualityWarnings).not.toContain('arms_hidden');
    expect(result.feedbackMessages).toEqual([]);
    expect(diagnostics.metrics.wristEndpointCoverage.value).toBeGreaterThan(0.95);
    expect(diagnostics.metrics.minStraightnessRatio.eligible).toBe(true);
    expect(diagnostics.metrics.peakLateralReachRatio.eligible).toBe(true);
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

  it('flags sustained hip sway as one torso warning without requiring lateral torso lean', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic hip-shift lateral raise', fullRepPath(), {
          bodyShiftX: index => (index >= 45 && index <= 70 ? 0.08 : 0),
        }),
      ),
    );

    const diagnostics = result.reps[0].diagnostics!;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.feedbackMessages).toContain('Stay upright — avoid swaying or leaning.');
    expect(result.reps[0].messages.filter(message => message === 'Stay upright — avoid swaying or leaning.')).toHaveLength(1);
    expect(diagnostics.metrics.torsoLean.value).toBeLessThan(1);
    expect(diagnostics.metrics.hipSwayRatio.eligible).toBe(true);
    expect(diagnostics.metrics.hipSwayRatio.value).toBeGreaterThan(0.1);
    expect(diagnostics.cues['standing-dumbbell-lateral-raises.torso_warn'].triggered).toBe(true);
  });

  it('groups combined torso-family score penalties under one torso cue', () => {
    const torsoCue = 'Stay upright — avoid swaying or leaning.';
    const leaned = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic leaned lateral raise', fullRepPath(), {
        posture: index => (index < 18 ? 'upright' : 'leaned'),
      }),
    );
    const sagittal = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic sagittal sway lateral raise', fullRepPath()),
        index => (index >= 45 && index <= 70 ? 0.2 : 0),
      ),
    );
    const combined = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic combined torso faults lateral raise', fullRepPath(), {
          posture: index => (index < 18 ? 'upright' : 'leaned'),
        }),
        index => (index >= 45 && index <= 70 ? 0.2 : 0),
      ),
    );

    expect(combined.finalRepCount).toBe(1);
    expect(combined.reps[0].messages.filter(message => message === torsoCue)).toHaveLength(1);
    expect(combined.repScores[0]).toBeGreaterThanOrEqual(
      Math.min(leaned.repScores[0], sagittal.repScores[0]),
    );
  });

  it('flags asymmetric raise height', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic asymmetric lateral raise', fullRepPath(), { rightScale: 0.78 }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Even it out — raise both arms to the same height.');
  });

  it('counts a severe one-arm raise as a meaningful partial with asymmetry feedback', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      buildRecording('synthetic severe unilateral lateral raise', fullRepPath(), { rightScale: 0.15 }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Raise higher — aim for shoulder level.');
    expect(result.feedbackMessages).toContain('Even it out — raise both arms to the same height.');
    expect(result.reps[0].diagnostics?.metrics.topHeightAsymmetry.eligible).toBe(true);
    expect(result.reps[0].diagnostics?.metrics.topHeightAsymmetry.sampleCount).toBeGreaterThanOrEqual(3);
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
    expect(shrug.reps[0].diagnostics?.metrics.shrugPct.unit).toBe('percent');
    expect(shrug.reps[0].diagnostics?.metrics.headShrugPct.unit).toBe('percent');
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

  it('uses visible ear landmarks for head-relative shrug confidence when the nose is missing', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic ear-only head-relative shrug lateral raise', fullRepPath(), {
          posture: index => (index < 18 ? 'upright' : 'shrug'),
          noseScore: 0.05,
        }),
      ),
    );

    const headShrug = result.reps[0].diagnostics?.metrics.headShrugPct;

    expect(result.finalRepCount).toBe(1);
    expect(headShrug?.eligible).toBe(true);
    expect(headShrug?.sampleCount).toBeGreaterThanOrEqual(3);
    expect(headShrug?.value).toBeGreaterThan(12);
  });

  it('does not treat nose dropout as a head-relative shrug', () => {
    const result = replayRecording(
      lateralRaiseDefinition,
      withWorldContext(
        buildRecording('synthetic relaxed lateral raise with nose dropout', fullRepPath(), {
          noseScore: index => (index < 18 ? 0.99 : 0.05),
        }),
      ),
    );

    const headShrug = result.reps[0].diagnostics?.metrics.headShrugPct;

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain("Relax your traps — don't shrug the weight up.");
    expect(headShrug?.eligible).toBe(false);
    expect(headShrug?.sampleCount).toBe(0);
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
