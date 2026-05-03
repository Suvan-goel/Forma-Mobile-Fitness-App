import { createMediaPipeAdapter } from '../../../skeleton';
import type { AnthropometricProfile, SkeletonFrame } from '../../../skeleton';
import type { ExerciseDefinition, ExerciseState } from '../types';
import { barbellCurlDefinition } from '../definitions/barbellCurl';
import { pushupDefinition } from '../definitions/pushup';
import { squatDefinition } from '../definitions/squat';
import type { Keypoint } from '../../poseAnalysis';

const FRAME_MS = 50;

function kp(name: string, x: number, y: number, z = 0, score = 0.99): Keypoint {
  return { name, x, y, z, score };
}

function interpolate(from: number, to: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => {
    const p = frames <= 1 ? 1 : index / (frames - 1);
    return from + (to - from) * p;
  });
}

function makeProfile(overrides: Partial<AnthropometricProfile> = {}): AnthropometricProfile {
  return {
    computedAt: 1000,
    sampleFrameCount: 30,
    confidence: 1,
    segments: {
      torso: 0.5,
      spineToNeck: 0.12,
      upperArm: 0.28,
      forearm: 0.25,
      femur: 0.46,
      tibia: 0.4,
      foot: 0.2,
      shoulderWidth: 0.42,
      hipWidth: 0.3,
    },
    derived: {
      standingHeight: 1.73,
      armSpan: 1.67,
      legLength: 1.06,
      torsoToLeg: 0.47,
      femurToTibia: 1.15,
    },
    baselines: {
      reachRatioAsymmetry: 0,
    },
    referenceUnit: 1.73,
    ...overrides,
  };
}

function replayWithProfile(
  definition: ExerciseDefinition,
  frames: Array<{ timestamp: number; keypoints: Keypoint[] }>,
  profile: AnthropometricProfile | null
): ExerciseState {
  const adapter = createMediaPipeAdapter();
  let state = definition.createState();
  const originalDateNow = Date.now;

  try {
    for (const frame of frames) {
      Date.now = () => frame.timestamp;
      const skeletonFrame: SkeletonFrame = adapter.update(frame.keypoints, frame.timestamp);
      skeletonFrame.profile = profile;
      state = definition.update(frame.keypoints, state, skeletonFrame);
    }
  } finally {
    Date.now = originalDateNow;
  }

  return state;
}

function fullSquatPath(): number[] {
  return [
    ...Array(20).fill(0),
    ...interpolate(0, 1, 50),
    ...Array(4).fill(1),
    ...interpolate(1, 0, 35),
    ...Array(8).fill(0),
  ];
}

function squatFrame(timestamp: number, depth: number, leaned: boolean): { timestamp: number; keypoints: Keypoint[] } {
  const standing = {
    shoulder: { x: 0, y: 0 },
    hip: { x: 0, y: 0.5 },
    knee: { x: 0, y: 1 },
    ankle: { x: 0, y: 1.5 },
  };
  const bottom = {
    shoulder: { x: -0.14, y: 0.28 },
    hip: { x: -0.22, y: 0.85 },
    knee: { x: 0.35, y: 1.05 },
    ankle: { x: 0, y: 1.5 },
  };
  const point = (name: keyof typeof standing) => ({
    x: standing[name].x + (bottom[name].x - standing[name].x) * depth,
    y: standing[name].y + (bottom[name].y - standing[name].y) * depth,
  });
  const shoulder = point('shoulder');
  const hip = point('hip');
  const knee = point('knee');
  const ankle = point('ankle');
  if (leaned) {
    shoulder.x = hip.x + 0.72;
    shoulder.y = hip.y - 0.38;
  }

  return {
    timestamp,
    keypoints: [
      kp('left_shoulder', shoulder.x - 0.015, shoulder.y),
      kp('left_hip', hip.x - 0.015, hip.y),
      kp('left_knee', knee.x - 0.015, knee.y),
      kp('left_ankle', ankle.x - 0.015, ankle.y),
      kp('right_shoulder', shoulder.x + 0.015, shoulder.y, 0, 0.05),
      kp('right_hip', hip.x + 0.015, hip.y, 0, 0.05),
      kp('right_knee', knee.x + 0.015, knee.y, 0, 0.05),
      kp('right_ankle', ankle.x + 0.015, ankle.y, 0, 0.05),
    ],
  };
}

function fullPushupPath(): number[] {
  return [
    ...Array(22).fill(0),
    ...interpolate(0, 0.58, 50),
    ...Array(4).fill(0.58),
    ...interpolate(0.58, 0, 18),
    ...Array(8).fill(0),
  ];
}

function pushupFrame(timestamp: number, elbowOffsetX: number, sag: boolean): { timestamp: number; keypoints: Keypoint[] } {
  const shoulder = { x: 0.3, y: 0.48 };
  const ankle = { x: 0.9, y: 0.48 };
  const hip = { x: (shoulder.x + ankle.x) / 2, y: sag ? 0.59 : 0.48 };
  const makeSide = (side: 'left' | 'right', score: number) => {
    const offset = side === 'left' ? -0.02 : 0.02;
    return [
      kp(`${side}_shoulder`, shoulder.x + offset, shoulder.y, 0, score),
      kp(`${side}_elbow`, shoulder.x + offset - elbowOffsetX, 0.63, 0, score),
      kp(`${side}_wrist`, shoulder.x + offset, 0.78, 0, score),
      kp(`${side}_hip`, hip.x + offset, hip.y, 0, score),
      kp(`${side}_ankle`, ankle.x + offset, ankle.y, 0, score),
    ];
  };

  return {
    timestamp,
    keypoints: [
      kp('nose', shoulder.x - 0.12, shoulder.y - 0.02),
      ...makeSide('left', 0.99),
      ...makeSide('right', 0.05),
    ],
  };
}

function fullCurlPath(): number[] {
  return [
    ...Array(16).fill(0.6),
    ...interpolate(0.6, 1.2, 16),
    ...Array(4).fill(1.2),
    ...interpolate(1.2, 0.6, 18),
    ...Array(8).fill(0.6),
  ];
}

function curlFrame(timestamp: number, leftWristY: number, rightWristY: number): { timestamp: number; keypoints: Keypoint[] } {
  const arm = (side: 'left' | 'right', x: number, wristY: number) => [
    kp(`${side}_shoulder`, x, 1.4),
    kp(`${side}_elbow`, x, 1),
    kp(`${side}_wrist`, x, wristY),
    kp(`${side}_index`, x, wristY + (wristY - 1) * 0.2),
    kp(`${side}_hip`, x, 0.5),
  ];

  return {
    timestamp,
    keypoints: [
      kp('nose', 0, 1.72, -0.05),
      ...arm('left', -0.22, leftWristY),
      ...arm('right', 0.22, rightWristY),
    ],
  };
}

describe('coupled morphology exercise integration', () => {
  it('passes squat profile into public update and widens long-femur torso deadzone', () => {
    const frames = fullSquatPath().map((depth, index) =>
      squatFrame(index * FRAME_MS, depth, index >= 20)
    );
    const profile = makeProfile();
    const state = replayWithProfile(squatDefinition, frames, profile);

    expect(state.repCount).toBe(1);
    expect((state.debugInfo.morphology as { torsoDeadzone: number }).torsoDeadzone).toBeCloseTo(34.5, 6);
  });

  it('leaves squat morphology debug absent when profile is null', () => {
    const frames = fullSquatPath().map((depth, index) =>
      squatFrame(index * FRAME_MS, depth, index >= 20)
    );
    const state = replayWithProfile(squatDefinition, frames, null);

    expect(state.repCount).toBe(1);
    expect(state.debugInfo.morphology).toBeUndefined();
  });

  it('passes pushup profile into public update and widens high torso-to-leg sag deadzone', () => {
    const profile = makeProfile({
      derived: { ...makeProfile().derived, torsoToLeg: 0.6 },
    });
    const frames = fullPushupPath().map((elbowOffsetX, index) =>
      pushupFrame(index * FRAME_MS, elbowOffsetX, index >= 22)
    );
    const state = replayWithProfile(pushupDefinition, frames, profile);

    expect(state.repCount).toBe(1);
    expect((state.debugInfo.morphology as { hipDevDeadzone: number }).hipDevDeadzone).toBeCloseTo(0.044, 6);
  });

  it('subtracts barbell curl asymmetry baseline before feedback thresholding', () => {
    const leftPath = fullCurlPath();
    const rightPath = [
      ...Array(16).fill(0.6),
      ...interpolate(0.6, 1.15, 16),
      ...Array(4).fill(1.15),
      ...interpolate(1.15, 0.6, 18),
      ...Array(8).fill(0.6),
    ];
    const frames = leftPath.map((leftWristY, index) =>
      curlFrame(index * FRAME_MS, leftWristY, rightPath[index])
    );

    const uncalibrated = replayWithProfile(barbellCurlDefinition, frames, makeProfile());
    const calibrated = replayWithProfile(barbellCurlDefinition, frames, makeProfile({
      baselines: { reachRatioAsymmetry: 0.2 },
    }));

    expect(uncalibrated.feedback).toContain('Arms are uneven');
    expect(calibrated.feedback).not.toContain('Arms are uneven');
    expect((calibrated.debugInfo.morphology as { asymmetryBaseline: number }).asymmetryBaseline).toBeCloseTo(0.2, 6);
  });
});
