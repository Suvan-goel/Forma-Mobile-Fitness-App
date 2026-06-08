import { barbellCurlDefinition } from '../definitions/barbellCurl';
import { BARBELL_CURL_GROUPED_FEEDBACK_FLAG } from '../ml/runtime/barbellCurlGroupedFeedback';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildReplayFrameCache,
  replayRecording,
  replayRecordingVerbose,
  replayRecordingWithFrameCache,
} from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';
import type {
  PoseChainStatus,
  PoseChainSummary,
  PoseState,
} from '../../pose/PoseState';

type CurlView = 'front' | 'side-left' | 'side-right' | 'oblique-left' | 'oblique-right';
type FrameValue<T> = T | ((index: number) => T);

const EXTENDED_WRIST_Y = 0.6;
const TOP_WRIST_Y = 1.2;
const PULSE_WRIST_Y = 0.78;
const HALF_WRIST_Y = 1.08;
const CLEAN_THRESHOLD_RETURN_WRIST_Y = 1.006;
const FRAME_MS = 50;

function kp(name: string, x: number, y: number, z: number, score = 0.99): Keypoint {
  return { name, x, y, z, score };
}

function frameValue<T>(value: FrameValue<T> | undefined, index: number, fallback: T): T {
  if (typeof value === 'function') return (value as (index: number) => T)(index);
  return value ?? fallback;
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
    case 'oblique-left':
      return {
        leftX: -0.13,
        rightX: 0.13,
        leftZ: -0.18,
        rightZ: 0.18,
        visibleArm: 'left' as const,
      };
    case 'oblique-right':
      return {
        leftX: -0.13,
        rightX: 0.13,
        leftZ: 0.18,
        rightZ: -0.18,
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
  elbowOffset: number,
  elbowZOffset: number,
  jointScore?: number,
  shoulderScore = 0.99,
  hipScore = 0.99,
): Keypoint[] {
  const score = visible ? (jointScore ?? 0.99) : 0.05;
  const shoulderY = 1.4;
  const elbowY = 1.0;
  const elbowX = x + (side === 'left' ? -elbowOffset : elbowOffset);
  const elbowZ = z + elbowZOffset;
  const indexY = wristY + (wristY - elbowY) * 0.2;
  const effectiveIndexScore = visible ? 0.99 : 0.05;

  return [
    kp(`${side}_shoulder`, x, shoulderY, z, shoulderScore),
    kp(`${side}_elbow`, elbowX, elbowY, elbowZ, score),
    kp(`${side}_wrist`, x, wristY, z, score),
    kp(`${side}_index`, x, indexY, z, effectiveIndexScore),
    kp(`${side}_hip`, x, 0.5, z, hipScore),
  ];
}

function makeFrame(
  timestamp: number,
  wristY: number,
  view: CurlView,
  index: number,
  options: {
    elbowOffset?: FrameValue<number>;
    leftScore?: FrameValue<number>;
    rightScore?: FrameValue<number>;
    leftElbowZOffset?: FrameValue<number>;
    rightElbowZOffset?: FrameValue<number>;
    leftShoulderScore?: FrameValue<number>;
    rightShoulderScore?: FrameValue<number>;
    leftHipScore?: FrameValue<number>;
    rightHipScore?: FrameValue<number>;
  } = {},
): LandmarkRecording['frames'][number] {
  return makeDualFrame(timestamp, wristY, wristY, view, index, options);
}

function makeDualFrame(
  timestamp: number,
  leftWristY: number,
  rightWristY: number,
  view: CurlView,
  index: number,
  options: {
    elbowOffset?: FrameValue<number>;
    leftScore?: FrameValue<number>;
    rightScore?: FrameValue<number>;
    leftElbowZOffset?: FrameValue<number>;
    rightElbowZOffset?: FrameValue<number>;
    leftShoulderScore?: FrameValue<number>;
    rightShoulderScore?: FrameValue<number>;
    leftHipScore?: FrameValue<number>;
    rightHipScore?: FrameValue<number>;
  } = {},
): LandmarkRecording['frames'][number] {
  const geom = sideGeometry(view);
  const leftVisible = geom.visibleArm === 'both' || geom.visibleArm === 'left';
  const rightVisible = geom.visibleArm === 'both' || geom.visibleArm === 'right';
  const elbowOffset = frameValue(options.elbowOffset, index, 0);
  const leftScore = frameValue(options.leftScore, index, 0.99);
  const rightScore = frameValue(options.rightScore, index, 0.99);
  const leftElbowZOffset = frameValue(options.leftElbowZOffset, index, 0);
  const rightElbowZOffset = frameValue(options.rightElbowZOffset, index, 0);
  const leftShoulderScore = frameValue(options.leftShoulderScore, index, 0.99);
  const rightShoulderScore = frameValue(options.rightShoulderScore, index, 0.99);
  const leftHipScore = frameValue(options.leftHipScore, index, 0.99);
  const rightHipScore = frameValue(options.rightHipScore, index, 0.99);

  return {
    timestamp,
    keypoints: [
      kp('nose', 0, 1.72, -0.05, 0.99),
      ...armKeypoints('left', geom.leftX, geom.leftZ, leftWristY, leftVisible, elbowOffset, leftElbowZOffset, leftScore, leftShoulderScore, leftHipScore),
      ...armKeypoints('right', geom.rightX, geom.rightZ, rightWristY, rightVisible, elbowOffset, rightElbowZOffset, rightScore, rightShoulderScore, rightHipScore),
    ],
  };
}

function buildRecording(
  description: string,
  wristPath: number[],
  view: CurlView = 'front',
  options: {
    elbowOffset?: FrameValue<number>;
    leftScore?: FrameValue<number>;
    rightScore?: FrameValue<number>;
    leftElbowZOffset?: FrameValue<number>;
    rightElbowZOffset?: FrameValue<number>;
    leftShoulderScore?: FrameValue<number>;
    rightShoulderScore?: FrameValue<number>;
    leftHipScore?: FrameValue<number>;
    rightHipScore?: FrameValue<number>;
  } = {},
): LandmarkRecording {
  const { elbowOffset, leftScore, rightScore, leftElbowZOffset, rightElbowZOffset, leftShoulderScore, rightShoulderScore, leftHipScore, rightHipScore } = options;

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
      return makeFrame(index * FRAME_MS, wristY, view, index, {
        elbowOffset,
        leftScore,
        rightScore,
        leftElbowZOffset,
        rightElbowZOffset,
        leftShoulderScore,
        rightShoulderScore,
        leftHipScore,
        rightHipScore,
      });
    }),
  };
}

function buildDualRecording(
  description: string,
  leftWristPath: number[],
  rightWristPath: number[],
  view: CurlView = 'front',
  options: {
    elbowOffset?: FrameValue<number>;
    leftScore?: FrameValue<number>;
    rightScore?: FrameValue<number>;
    leftElbowZOffset?: FrameValue<number>;
    rightElbowZOffset?: FrameValue<number>;
    leftShoulderScore?: FrameValue<number>;
    rightShoulderScore?: FrameValue<number>;
    leftHipScore?: FrameValue<number>;
    rightHipScore?: FrameValue<number>;
  } = {},
): LandmarkRecording {
  const { elbowOffset, leftScore, rightScore, leftElbowZOffset, rightElbowZOffset, leftShoulderScore, rightShoulderScore, leftHipScore, rightHipScore } = options;
  const frameCount = Math.max(leftWristPath.length, rightWristPath.length);

  return {
    exerciseName: 'Barbell Curl',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (frameCount * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: Array.from({ length: frameCount }, (_, index) => {
      return makeDualFrame(
        index * FRAME_MS,
        leftWristPath[index] ?? EXTENDED_WRIST_Y,
        rightWristPath[index] ?? EXTENDED_WRIST_Y,
        view,
        index,
        { elbowOffset, leftScore, rightScore, leftElbowZOffset, rightElbowZOffset, leftShoulderScore, rightShoulderScore, leftHipScore, rightHipScore },
      );
    }),
  };
}

function buildSegmentedRecording(
  description: string,
  segments: Array<{ path: number[]; gapAfterMs?: number }>,
  view: CurlView = 'front',
): LandmarkRecording {
  const frames: LandmarkRecording['frames'] = [];
  let timestamp = 0;
  let frameIndex = 0;

  for (const segment of segments) {
    for (const wristY of segment.path) {
      frames.push(makeFrame(timestamp, wristY, view, frameIndex));
      timestamp += FRAME_MS;
      frameIndex++;
    }
    if (segment.gapAfterMs !== undefined) {
      timestamp += Math.max(0, segment.gapAfterMs - FRAME_MS);
    }
  }

  return {
    exerciseName: 'Barbell Curl',
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
  return buildSegmentedRecording('synthetic interrupted mid-rep curl with recovery', [
    {
      path: [
        ...Array(16).fill(EXTENDED_WRIST_Y),
        ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
        ...Array(4).fill(TOP_WRIST_Y),
      ],
      gapAfterMs: 6000,
    },
    {
      path: [
        ...Array(16).fill(EXTENDED_WRIST_Y),
        ...fullRepPath(),
      ],
    },
  ]);
}

function interpolate(from: number, to: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => {
    const p = frames <= 1 ? 1 : index / (frames - 1);
    return from + (to - from) * p;
  });
}

function fullRepPath(): number[] {
  return repPathToTop(TOP_WRIST_Y);
}

function repPathToTop(topWristY: number): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, topWristY, 16),
    ...Array(4).fill(topWristY),
    ...interpolate(topWristY, EXTENDED_WRIST_Y, 18),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function slowFullRepPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 36),
    ...Array(12).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 42),
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

function fastCurlUpPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 2),
    ...Array(20).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 18),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function fastShortFullRepPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 4),
    ...Array(4).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 4),
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

function shortIncompleteFlexPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, 1.04, 24),
    ...Array(8).fill(1.04),
    ...interpolate(1.04, EXTENDED_WRIST_Y, 24),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function shortReturnReflexPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
    ...Array(4).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, HALF_WRIST_Y, 10),
    ...Array(8).fill(HALF_WRIST_Y),
    ...interpolate(HALF_WRIST_Y, TOP_WRIST_Y, 10),
    ...Array(8).fill(TOP_WRIST_Y),
  ];
}

function cleanThresholdReturnDoubleRepPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
    ...Array(4).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, CLEAN_THRESHOLD_RETURN_WRIST_Y, 8),
    ...Array(10).fill(CLEAN_THRESHOLD_RETURN_WRIST_Y),
    ...interpolate(CLEAN_THRESHOLD_RETURN_WRIST_Y, TOP_WRIST_Y, 16),
    ...Array(4).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 18),
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

function transformRecording(
  recording: LandmarkRecording,
  transform: (point: Keypoint, frameIndex: number) => Keypoint,
  description: string,
): LandmarkRecording {
  return {
    ...recording,
    metadata: {
      ...recording.metadata,
      description,
    },
    frames: recording.frames.map((frame, frameIndex) => ({
      ...frame,
      keypoints: frame.keypoints.map(point => transform(point, frameIndex)),
      imageKeypoints: frame.imageKeypoints?.map(point => transform(point, frameIndex)),
      worldKeypoints: frame.worldKeypoints?.map(point => transform(point, frameIndex)),
    })),
  };
}

function recordingWithHeadMotion(recording: LandmarkRecording): LandmarkRecording {
  return transformRecording(
    recording,
    (point, index) => (
      point.name === 'nose' && index >= 18 && index <= 52
        ? { ...point, z: (point.z ?? 0) + 0.75 }
        : point
    ),
    `${recording.metadata.description} with head motion`,
  );
}

const TORSO_UPPER_BODY_JOINTS = new Set([
  'nose',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_index',
  'right_index',
]);

function recordingWithTorsoSwing(recording: LandmarkRecording): LandmarkRecording {
  return transformRecording(
    recording,
    (point, index) => {
      if (!TORSO_UPPER_BODY_JOINTS.has(point.name) || index < 18 || index > 52) return point;
      const progress = index <= 35
        ? (index - 18) / (35 - 18)
        : (52 - index) / (52 - 35);
      return { ...point, z: (point.z ?? 0) + 1.0 * Math.max(0, progress) };
    },
    `${recording.metadata.description} with torso swing`,
  );
}

function recordingWithTorsoSpike(
  recording: LandmarkRecording,
  startIndex: number,
  frameCount: number,
  depthOffset: number,
): LandmarkRecording {
  return transformRecording(
    recording,
    (point, index) => (
      TORSO_UPPER_BODY_JOINTS.has(point.name) && index >= startIndex && index < startIndex + frameCount
        ? { ...point, z: (point.z ?? 0) + depthOffset }
        : point
    ),
    `${recording.metadata.description} with torso spike`,
  );
}

function recordingWithSustainedTorsoSeesaw(recording: LandmarkRecording): LandmarkRecording {
  return transformRecording(
    recording,
    (point, index) => {
      if (!TORSO_UPPER_BODY_JOINTS.has(point.name) || index < 30 || index > 85) return point;
      return { ...point, z: (point.z ?? 0) + (index < 58 ? -0.5 : 0.5) };
    },
    `${recording.metadata.description} with sustained torso seesaw`,
  );
}

function recordingWithSmallPoseNoise(recording: LandmarkRecording): LandmarkRecording {
  return transformRecording(
    recording,
    (point, index) => {
      if (!point.name.includes('_')) return point;
      const jitter = ((index % 5) - 2) * 0.0015;
      return {
        ...point,
        x: point.x + jitter,
        y: point.y - jitter * 0.5,
      };
    },
    `${recording.metadata.description} with small deterministic noise`,
  );
}

function loadLandmarkFixture(relativePath: string): LandmarkRecording {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')) as LandmarkRecording;
}

function recordingWithFrontalCompletionOnly(recording: LandmarkRecording): LandmarkRecording {
  const frontSwitchIndex = Math.max(0, recording.frames.length - 30);
  return transformRecording(
    recording,
    (point, index) => {
      if (index >= frontSwitchIndex) return point;
      if (point.name === 'left_shoulder') return { ...point, z: -0.25 };
      if (point.name === 'right_shoulder') return { ...point, z: 0.25 };
      return point;
    },
    `${recording.metadata.description} with frontal completion only`,
  );
}

function recordingWithExplicitSources(
  worldRecording: LandmarkRecording,
  imageRecording: LandmarkRecording,
  description: string,
): LandmarkRecording {
  return {
    ...worldRecording,
    metadata: {
      ...worldRecording.metadata,
      description,
    },
    frames: worldRecording.frames.map((worldFrame, index) => {
      const imageFrame = imageRecording.frames[index] ?? worldFrame;
      return {
        timestamp: worldFrame.timestamp,
        keypoints: imageFrame.keypoints,
        imageKeypoints: imageFrame.keypoints,
        worldKeypoints: worldFrame.keypoints,
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

const TEST_CHAIN_JOINTS: Record<string, string[]> = {
  leftArm: ['left_shoulder', 'left_elbow', 'left_wrist'],
  rightArm: ['right_shoulder', 'right_elbow', 'right_wrist'],
  torso: ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'],
  leftLeg: ['left_hip', 'left_knee', 'left_ankle'],
  rightLeg: ['right_hip', 'right_knee', 'right_ankle'],
  pushupBodyLine: ['left_shoulder', 'left_hip', 'left_ankle', 'right_shoulder', 'right_hip', 'right_ankle'],
};

function testChainSummary(name: string, status: PoseChainStatus): PoseChainSummary {
  const joints = TEST_CHAIN_JOINTS[name] ?? [];
  return {
    name,
    joints,
    reliableJoints: status === 'reliable' ? joints : [],
    lowConfidenceJoints: status === 'partial' ? [joints[joints.length - 1] ?? `${name}_joint`] : [],
    missingJoints: status === 'unreliable' ? [joints[joints.length - 1] ?? `${name}_joint`] : [],
    malformedJoints: [],
    staleJoints: [],
    outlierCandidateJoints: [],
    status,
  };
}

function testPoseState(
  timestampMs: number,
  chainStatuses: Partial<Record<string, PoseChainStatus>> = {},
): PoseState {
  const chains = Object.fromEntries(
    Object.keys(TEST_CHAIN_JOINTS).map((chainName) => [
      chainName,
      testChainSummary(chainName, chainStatuses[chainName] ?? 'reliable'),
    ]),
  );
  const allStatuses = Object.values(chains).map((chain) => chain.status);
  return {
    timestampMs,
    status: allStatuses.every((status) => status === 'reliable') ? 'tracked' : 'partial',
    primarySource: 'image',
    keypoints: [],
    joints: {},
    chains,
    diagnostics: {
      reliabilityCounts: {
        reliable: 0,
        lowVisibility: 0,
        lowPresence: 0,
        missing: 0,
        malformed: 0,
        stale: 0,
        outlierCandidate: 0,
      },
      reasonCounts: {},
      malformedJoints: [],
      missingJoints: [],
      lowConfidenceJoints: [],
      staleJoints: [],
      outlierCandidateJoints: [],
      trackingInterrupted: false,
    },
  };
}

function replayRecordingWithPoseState(
  recording: LandmarkRecording,
  chainStatusesForFrame: (frame: LandmarkRecording['frames'][number], index: number) => Partial<Record<string, PoseChainStatus>>,
) {
  let state = barbellCurlDefinition.createState();
  for (const [index, frame] of recording.frames.entries()) {
    state = barbellCurlDefinition.update(frame.keypoints, state, {
      imageKeypoints: frame.keypoints,
      primarySource: 'image',
      timestampMs: frame.timestamp,
      poseState: testPoseState(frame.timestamp, chainStatusesForFrame(frame, index)),
    });
  }
  return state;
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
    expect(result.reps[0]?.diagnostics?.metrics.landmarkSource.label).toBe('image');
    expect(result.reps[0]?.diagnostics?.metrics.ratioDistanceMode.label).toBe('image_2d');
    expect(result.reps[0]?.diagnostics?.metrics.torsoAnchorSource.label).toBe('shoulder_center');
    expect(result.reps[0]?.diagnostics?.metrics.viewAngleDeg.value).toBeGreaterThanOrEqual(0);
    expect(result.reps[0]?.diagnostics?.metrics.smoothedViewAngleDeg.value).toBeGreaterThanOrEqual(0);
    expect(result.reps[0]?.diagnostics?.metrics.viewSupportRatio.value).toBeGreaterThan(0);
    expect(result.reps[0]?.diagnostics?.metrics.rawLeftMinCurlRatio.value).toBeLessThan(0.6);
    expect(result.reps[0]?.diagnostics?.metrics.leftValidSamples.value).toBeGreaterThan(0);
    expect(result.reps[0]?.diagnostics?.metrics.leftShoulderDelta).toBeDefined();
    expect(result.reps[0]?.diagnostics?.metrics.rightShoulderDelta).toBeDefined();
    expect(result.reps[0]?.diagnostics?.metrics.primaryShoulderDelta).toBeDefined();
    expect(result.reps[0]?.diagnostics?.metrics.returnMaxCurlRatio.value).toBeGreaterThanOrEqual(0.85);
    expect(result.reps[0]?.diagnostics?.viewQuality?.frontishConfirmed).toBe(true);
    expect(result.reps[0]?.diagnostics?.reliability).toMatchObject({
      countabilityCandidate: 'countable',
      scoreabilityCandidate: 'fullyScoreable',
      unsafeCueFamilies: [],
      suppressedIssueIds: [],
    });
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.incomplete_extend']).toMatchObject({
      metricKeys: ['returnMaxCurlRatio'],
      triggered: false,
    });
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.asymmetry'].eligible).toBe(true);
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.elbow_flare'].eligible).toBe(true);
  });

  it('attaches grouped ML feedback diagnostics behind the feature flag without changing rep count', () => {
    const previous = process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '1';
    try {
      const result = replayRecording(
        barbellCurlDefinition,
        buildRecording('synthetic clean front curl with grouped feedback flag', fullRepPath(), 'front'),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
      expect(result.reps[0]?.diagnostics?.mlGroupedFeedback).toMatchObject({
        enabled: true,
        applied: true,
        policyId: 'barbell-curl-grouped-feedback-v1-20260608T183615Z',
        modelRunId: '2026-06-08T17-27-07Z',
      });
      expect(result.reps[0]?.messages.length ?? 0).toBeLessThanOrEqual(1);
    } finally {
      if (previous === undefined) delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
      else process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = previous;
    }
  });

  it('keeps a clean full-reliability runtime PoseState rep unchanged', () => {
    const recording = buildRecording('synthetic clean front curl', fullRepPath(), 'front');
    const baseline = replayRecording(barbellCurlDefinition, recording);
    const state = replayRecordingWithPoseState(recording, () => ({}));

    expect(state.repCount).toBe(1);
    expect(state.lastRepResult?.score).toBe(baseline.repScores[0]);
    expect(state.lastRepResult?.messages).toEqual([]);
    expect(state.lastRepResult?.scorable).toBe(true);
    expect(state.lastRepResult?.diagnostics?.reliability).toMatchObject({
      countabilityCandidate: 'countable',
      scoreabilityCandidate: 'fullyScoreable',
      usableChains: expect.arrayContaining(['leftArm', 'rightArm', 'torso']),
      unsafeCueFamilies: [],
      suppressedIssueIds: [],
    });
  });

  it('keeps clean v2 metadata replay fully scoreable', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      recordingWithV2PoseMetadata(buildRecording('synthetic clean v2 front curl', fullRepPath(), 'front')),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.scorable).toBe(true);
    expect(result.reps[0]?.diagnostics?.reliability).toMatchObject({
      countabilityCandidate: 'countable',
      scoreabilityCandidate: 'fullyScoreable',
      usableChains: expect.arrayContaining(['leftArm', 'rightArm', 'torso']),
      unsafeCueFamilies: [],
      suppressedIssueIds: [],
    });
  });

  it('matches cached and uncached replay-frame evaluation exactly', () => {
    const recording = recordingWithV2PoseMetadata(
      buildRecording('synthetic cached clean v2 front curl', fullRepPath(), 'front'),
    );

    const uncached = replayRecording(barbellCurlDefinition, recording, { confidenceGating: true });
    const cached = replayRecordingWithFrameCache(
      barbellCurlDefinition,
      buildReplayFrameCache(recording),
      { confidenceGating: true },
    );

    expect(cached).toEqual(uncached);
  });

  it('uses frame timestamps instead of JS callback time for live rep timing', () => {
    const recording = buildRecording('synthetic timestamp-driven front curl', fullRepPath(), 'front');
    const originalDateNow = Date.now;
    let state = barbellCurlDefinition.createState();

    try {
      Date.now = () => 1234567890;
      for (const frame of recording.frames) {
        state = barbellCurlDefinition.update(frame.keypoints, state, {
          imageKeypoints: frame.keypoints,
          primarySource: 'image',
          timestampMs: frame.timestamp,
        });
      }
    } finally {
      Date.now = originalDateNow;
    }

    expect(state.repCount).toBe(1);
    expect(state.lastRepResult?.score).toBeGreaterThanOrEqual(85);
    expect(state.lastRepResult?.messages).toEqual([]);
    expect(state.lastRepResult?.diagnostics?.metrics.tUp.value).toBeGreaterThan(0);
    expect(state.lastRepResult?.diagnostics?.metrics.tDown.value).toBeGreaterThan(0);
  });

  it('keeps a clean four-rep curl unchanged with normal frame intervals', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildMultiRepRecording('synthetic clean four front curls', 4),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it('does not add a false rep across a long silent gap between curls', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildMultiRepRecording('synthetic four curls with walk-out gap', 4, { 1: 6000 }),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it.each([200, 700])('keeps counting unchanged for a %sms frame gap', (gapMs) => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildMultiRepRecording(`synthetic four curls with ${gapMs}ms gap`, 4, { 1: gapMs }),
    );

    expect(result.finalRepCount).toBe(4);
  });

  it('does not complete a stale active rep after a long silent gap', () => {
    const result = replayRecordingVerbose(
      barbellCurlDefinition,
      buildInterruptedMidRepRecording(),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repTraces).toHaveLength(1);
  });

  it('counts a real rep after a long gap once stable frames rebuild', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildSegmentedRecording('synthetic long gap then clean curl', [
        { path: Array(20).fill(EXTENDED_WRIST_Y), gapAfterMs: 6000 },
        { path: fullRepPath() },
      ]),
    );

    expect(result.finalRepCount).toBe(1);
  });

  it('re-arms counting after a scoring-clean bottom return', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic clean-threshold double front curl', cleanThresholdReturnDoubleRepPath(), 'front'),
    );

    expect(result.finalRepCount).toBe(2);
    expect(result.feedbackMessages).not.toContain('Extend fully at the bottom.');
  });

  it('does not treat head-only motion as torso swing', () => {
    const cleanRecording = buildRecording('synthetic clean front curl', fullRepPath(), 'front');
    const clean = replayRecording(barbellCurlDefinition, cleanRecording);
    const headMotion = replayRecording(
      barbellCurlDefinition,
      recordingWithHeadMotion(cleanRecording),
    );

    expect(headMotion.finalRepCount).toBe(1);
    expect(headMotion.feedbackMessages).toEqual([]);
    expect(headMotion.repScores[0]).toBeGreaterThanOrEqual(clean.repScores[0] - 2);
    expect(headMotion.reps[0]?.diagnostics?.metrics.torsoAnchorSource.label).toBe('shoulder_center');
    expect(headMotion.reps[0]?.diagnostics?.cues['barbell-curl.torso_warn'].triggered).toBe(false);
    expect(headMotion.reps[0]?.diagnostics?.cues['barbell-curl.torso_fail'].triggered).toBe(false);
  });

  it('flags real upper-body torso swing', () => {
    const cleanRecording = buildRecording('synthetic clean front curl', fullRepPath(), 'front');
    const clean = replayRecording(barbellCurlDefinition, cleanRecording);
    const swinging = replayRecording(
      barbellCurlDefinition,
      recordingWithTorsoSwing(cleanRecording),
    );

    expect(swinging.finalRepCount).toBe(1);
    expect(swinging.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(swinging.feedbackMessages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/swing|torso|upright/),
      ]),
    );
    expect(swinging.reps[0]?.diagnostics?.metrics.torsoDelta.value).toBeGreaterThan(
      clean.reps[0]?.diagnostics?.metrics.torsoDelta.value ?? 0,
    );
  });

  it('preserves torso feedback when one arm chain is weak but torso is reliable', () => {
    const recording = recordingWithTorsoSwing(
      buildRecording('synthetic weak-left-arm torso swing curl', fullRepPath(), 'front'),
    );
    const state = replayRecordingWithPoseState(recording, () => ({ leftArm: 'partial' }));

    expect(state.repCount).toBe(1);
    expect(state.lastRepResult?.scorable).toBe(true);
    expect(state.lastRepResult?.messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/swing|torso|upright/),
      ]),
    );
    expect(state.lastRepResult?.diagnostics?.cues['barbell-curl.torso_warn'].eligible).toBe(true);
    expect(state.lastRepResult?.diagnostics?.reliability).toMatchObject({
      countabilityCandidate: 'countable',
      scoreabilityCandidate: 'partiallyScoreable',
      usableChains: expect.arrayContaining(['rightArm', 'torso']),
      weakChains: expect.arrayContaining(['leftArm']),
      safeCueFamilies: expect.arrayContaining(['torsoControl']),
    });
  });

  it('does not elevate a short torso spike to torso_fail', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      recordingWithTorsoSpike(
        buildRecording('synthetic slow curl with torso spike', slowFullRepPath(), 'front'),
        58,
        2,
        3,
      ),
    );
    const metrics = result.reps[0]?.diagnostics?.metrics;

    expect(result.finalRepCount).toBe(1);
    expect(metrics?.torsoDeltaRaw.value).toBeGreaterThan(28);
    expect(metrics?.torsoDelta.value).toBeLessThan(28);
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.torso_fail']).toMatchObject({
      triggered: false,
    });
    expect(result.reps[0]?.issueIds).not.toContain('barbell-curl.torso_fail');
  });

  it('still flags sustained severe torso movement as torso_fail', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      recordingWithSustainedTorsoSeesaw(
        buildRecording('synthetic slow curl with sustained torso movement', slowFullRepPath(), 'front'),
      ),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.diagnostics?.metrics.torsoDelta.value).toBeGreaterThan(28);
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.torso_fail']).toMatchObject({
      triggered: true,
    });
    expect(result.reps[0]?.issueIds).toContain('barbell-curl.torso_fail');
  });

  it('keeps a clean front rep stable under small deterministic pose noise', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      recordingWithSmallPoseNoise(buildRecording('synthetic clean front curl', fullRepPath(), 'front')),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(80);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('does not emit ROM or asymmetry issues for hard-negative one-sided ROM compression', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      loadLandmarkFixture('datasets/form-heuristics/landmarks/validation/barbell-curl/val08-hard-negative-front.json'),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(6);
    for (const rep of result.reps) {
      expect(rep.issueIds).not.toContain('barbell-curl.incomplete_rom');
      expect(rep.issueIds).not.toContain('barbell-curl.asymmetry');
      expect(rep.diagnostics?.metrics.romShortfallEvidence.label).toBe('right_only');
      expect(rep.diagnostics?.cues['barbell-curl.incomplete_rom']).toMatchObject({
        triggered: false,
      });
      expect(rep.diagnostics?.cues['barbell-curl.asymmetry']).toMatchObject({
        triggered: false,
      });
    }
  });

  it('does not diagnose mild one-sided ROM variation as asymmetry', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildDualRecording(
        'synthetic mild one-sided ROM variation',
        fullRepPath(),
        repPathToTop(1.12),
        'front',
      ),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.issueIds).not.toContain('barbell-curl.asymmetry');
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.asymmetry']).toMatchObject({
      eligible: true,
      triggered: false,
    });
  });

  it('still flags clear amplitude asymmetry when endpoint and ROM evidence agree', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildDualRecording(
        'synthetic clear one-sided amplitude asymmetry',
        fullRepPath(),
        repPathToTop(1.08),
        'front',
      ),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.issueIds).toContain('barbell-curl.asymmetry');
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.asymmetry'].triggered).toBe(true);
  });

  it('still flags clear bilateral incomplete ROM', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic bilateral incomplete ROM', repPathToTop(1.1), 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.issueIds).toContain('barbell-curl.incomplete_rom');
    expect(result.reps[0]?.diagnostics?.metrics.romShortfallEvidence.label).toBe('bilateral');
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.incomplete_rom'].triggered).toBe(true);
  });

  it('does not emit front-only cues from a frontal completion frame without sustained front support', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      recordingWithFrontalCompletionOnly(
        buildRecording('synthetic mixed-view flared curl', fullRepPath(), 'front', {
          elbowOffset: index => (index >= 24 && index <= 48 ? 0.35 : 0),
        }),
      ),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.diagnostics).toMatchObject({
      view: 'front',
      viewQuality: { frontishConfirmed: false },
    });
    expect(result.reps[0]?.scorable).toBe(false);
    expect(result.reps[0]?.diagnostics?.viewQuality?.frontishConfirmed).toBe(false);
    expect(result.reps[0]?.diagnostics?.metrics.frontZoneSupportRatio.value).toBeLessThan(0.6);
    expect(result.feedbackMessages).not.toContain("Keep your elbows in — don't flare them out to the sides.");
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.elbow_flare']).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'front_view_unconfirmed',
    });
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.asymmetry']).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'front_view_unconfirmed',
    });
  });

  it('uses explicit world landmarks for curl ratios when image landmarks diverge', () => {
    const worldRecording = buildRecording('synthetic world clean front curl', fullRepPath(), 'front');
    const divergentImageRecording = buildRecording('synthetic image pulse only curl', pulsePath(), 'front');
    const result = replayRecording(
      barbellCurlDefinition,
      recordingWithExplicitSources(worldRecording, divergentImageRecording, 'world overrides divergent image ratios'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.diagnostics?.metrics.landmarkSource.label).toBe('world');
    expect(result.reps[0]?.diagnostics?.metrics.ratioDistanceMode.label).toBe('world_3d');
    expect(result.reps[0]?.diagnostics?.metrics.rawLeftMinCurlRatio.value).toBeLessThan(0.6);
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
      expect(result.reps[0]?.diagnostics?.metrics.ratioDistanceMode.label).toBe('image_2d');
      expect(result.reps[0]?.scorable).toBe(true);
      expect(result.reps[0]?.diagnostics?.cues['barbell-curl.asymmetry']).toMatchObject({
        eligible: false,
        skippedReason: 'reliability_unsafe_bilateralSymmetry',
      });
      expect(result.reps[0]?.diagnostics?.cues['barbell-curl.elbow_flare']).toMatchObject({
        eligible: false,
        skippedReason: 'reliability_unsafe_bilateralArmRom',
      });
    },
  );

  it('counts a clean oblique rep from the visible primary arm and keeps front-only cues ineligible', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic clean oblique-left curl', fullRepPath(), 'oblique-left'),
    );
    const cues = result.reps[0]?.diagnostics?.cues;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.diagnostics?.view).toBe('oblique');
    expect(cues?.['barbell-curl.asymmetry']).toMatchObject({
      eligible: false,
      skippedReason: 'reliability_unsafe_bilateralSymmetry',
    });
    expect(cues?.['barbell-curl.elbow_flare']).toMatchObject({
      eligible: false,
      skippedReason: 'reliability_unsafe_bilateralArmRom',
    });
  });

  it.each<CurlView>(['side-left', 'side-right'])(
    'flags shoulder involvement from %s using the primary side',
    view => {
      const clean = replayRecording(
        barbellCurlDefinition,
        buildRecording(`synthetic clean ${view} curl`, fullRepPath(), view),
      );
      const involved = replayRecording(
        barbellCurlDefinition,
        buildRecording(`synthetic shoulder involvement ${view} curl`, fullRepPath(), view, {
          elbowOffset: index => (index >= 20 && index <= 48 ? 1.0 : 0),
        }),
      );

      expect(involved.finalRepCount).toBe(1);
      expect(involved.repScores[0]).toBeLessThan(clean.repScores[0]);
      expect(involved.feedbackMessages).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/shoulder involvement|Upper arms moving/),
        ]),
      );
      expect(involved.reps[0]?.diagnostics?.metrics.primaryShoulderDelta.value).toBeGreaterThan(
        clean.reps[0]?.diagnostics?.metrics.primaryShoulderDelta.value ?? 0,
      );
      expect(involved.reps[0]?.diagnostics?.cues['barbell-curl.shoulder_warn'].eligible).toBe(true);
    },
  );

  it('marks side shoulder cue ineligible when primary shoulder samples are unavailable', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic side-left missing shoulder samples curl', fullRepPath(), 'side-left', {
        rightShoulderScore: index => (index < 16 ? 0.99 : 0.05),
      }),
    );
    const shoulderCue = result.reps[0]?.diagnostics?.cues['barbell-curl.shoulder_warn'];

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.diagnostics?.metrics.primaryShoulderDelta.eligible).toBe(false);
    expect(shoulderCue).toMatchObject({
      eligible: false,
      skippedReason: 'primary_shoulder_unavailable',
    });
  });

  it('does not count a front-view rep when only one arm participates', () => {
    const movingArm = fullRepPath();
    const stationaryArm = Array(movingArm.length).fill(EXTENDED_WRIST_Y);
    const result = replayRecordingVerbose(
      barbellCurlDefinition,
      buildDualRecording('synthetic one-arm front curl', movingArm, stationaryArm, 'front'),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts desynced front-view arms once and diagnoses asymmetry', () => {
    const delayFrames = 20;
    const basePath = [
      ...Array(16).fill(EXTENDED_WRIST_Y),
      ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
      ...Array(28).fill(TOP_WRIST_Y),
      ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 24),
      ...Array(8).fill(EXTENDED_WRIST_Y),
    ];
    const leftPath = [...basePath, ...Array(delayFrames).fill(EXTENDED_WRIST_Y)];
    const rightPath = [...Array(delayFrames).fill(EXTENDED_WRIST_Y), ...basePath];
    const result = replayRecording(
      barbellCurlDefinition,
      buildDualRecording('synthetic desynced front curl', leftPath, rightPath, 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Arms are uneven — curl both sides together.');
    expect(result.reps[0]?.diagnostics?.metrics.syncDelta.value).toBeGreaterThan(0.75);
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.asymmetry'].triggered).toBe(true);
  });

  it('keeps counting with one weak arm but suppresses unsafe bilateral cue families', () => {
    const delayFrames = 20;
    const basePath = [
      ...Array(16).fill(EXTENDED_WRIST_Y),
      ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
      ...Array(28).fill(TOP_WRIST_Y),
      ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 24),
      ...Array(8).fill(EXTENDED_WRIST_Y),
    ];
    const leftPath = [...basePath, ...Array(delayFrames).fill(EXTENDED_WRIST_Y)];
    const rightPath = [...Array(delayFrames).fill(EXTENDED_WRIST_Y), ...basePath];
    const recording = recordingWithV2PoseMetadata(
      buildDualRecording('synthetic desynced front curl with weak left reliability', leftPath, rightPath, 'front'),
      { lowVisibilityJoints: new Set(['left_elbow', 'left_wrist']) },
    );
    const result = replayRecording(barbellCurlDefinition, recording);
    const asymmetryCue = result.reps[0]?.diagnostics?.cues['barbell-curl.asymmetry'];

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Arms are uneven — curl both sides together.');
    expect(asymmetryCue).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'reliability_unsafe_bilateralSymmetry',
    });
    expect(result.reps[0]?.scorable).toBe(true);
    expect(result.reps[0]?.diagnostics?.reliability).toMatchObject({
      countabilityCandidate: 'countable',
      scoreabilityCandidate: 'partiallyScoreable',
      usableChains: expect.arrayContaining(['rightArm', 'torso']),
      weakChains: expect.arrayContaining(['leftArm']),
      safeCueFamilies: expect.arrayContaining(['repCount', 'tempo', 'torsoControl', 'visibleArmRom']),
      unsafeCueFamilies: expect.arrayContaining(['bilateralArmRom', 'bilateralSymmetry', 'wristSpecific']),
      suppressedIssueIds: expect.arrayContaining(['barbell-curl.asymmetry']),
      suppressedCueFamilies: expect.arrayContaining(['bilateralSymmetry']),
    });
  });

  it('counts but marks a rep unscorable when both arm chains and torso are weak', () => {
    const recording = buildRecording('synthetic clean front curl with weak runtime reliability', fullRepPath(), 'front');
    const state = replayRecordingWithPoseState(recording, () => ({
      leftArm: 'partial',
      rightArm: 'partial',
      torso: 'partial',
    }));

    expect(state.repCount).toBe(1);
    expect(state.lastRepResult?.scorable).toBe(false);
    expect(state.lastRepResult?.score).toBe(0);
    expect(state.lastRepResult?.diagnostics?.reliability).toMatchObject({
      countabilityCandidate: 'notCountable',
      scoreabilityCandidate: 'notScoreable',
      weakChains: expect.arrayContaining(['leftArm', 'rightArm', 'torso']),
    });
  });

  it('does not count a short unscorable setup candidate before a clean rep', () => {
    const setupPath = fastShortFullRepPath();
    const recording = buildSegmentedRecording('synthetic weak setup candidate then clean curl', [
      { path: setupPath },
      { path: fullRepPath() },
    ]);
    const state = replayRecordingWithPoseState(recording, (_frame, index) => (
      index < setupPath.length
        ? { leftArm: 'partial', rightArm: 'partial', torso: 'partial' }
        : {}
    ));

    expect(state.repCount).toBe(1);
    expect(state.lastRepResult?.scorable).toBe(true);
  });

  it('does not count a short unscorable trailing candidate after a clean rep', () => {
    const cleanPath = fullRepPath();
    const recording = buildSegmentedRecording('synthetic clean curl then weak trailing candidate', [
      { path: cleanPath },
      { path: fastShortFullRepPath() },
    ]);
    const state = replayRecordingWithPoseState(recording, (_frame, index) => (
      index >= cleanPath.length
        ? { leftArm: 'partial', rightArm: 'partial', torso: 'partial' }
        : {}
    ));

    expect(state.repCount).toBe(1);
    expect(state.lastRepResult?.scorable).toBe(true);
  });

  it('marks bilateral-only cues ineligible from side/oblique views', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic side-left cue eligibility curl', fullRepPath(), 'side-left'),
    );
    const cues = result.reps[0]?.diagnostics?.cues;

    expect(result.finalRepCount).toBe(1);
    expect(cues?.['barbell-curl.asymmetry']).toMatchObject({
      eligible: false,
      skippedReason: 'reliability_unsafe_bilateralSymmetry',
    });
    expect(cues?.['barbell-curl.elbow_flare']).toMatchObject({
      eligible: false,
      skippedReason: 'reliability_unsafe_bilateralArmRom',
    });
  });

  it('marks reps unscorable when exercise-specific view quality is insufficient', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic side-left insufficient view support curl', fullRepPath(), 'side-left'),
      {
        confidenceGating: true,
        heuristicConfig: { viewQualityThresholds: { MIN_SAMPLES: 100 } },
      },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.scorable).toBe(false);
    expect(result.reps[0]?.qualityWarnings).toContain('side_view_uncertain');
    expect(result.reps[0]?.diagnostics?.scorable).toBe(false);
    expect(result.feedbackMessages[0]).toContain("I couldn't judge your form there.");
  });

  it('marks low-confidence occluded side reps unscorable without clean-form issue ids under gating', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic occluded side-left curl', fullRepPath(), 'side-left', {
        leftScore: index => (index >= 16 && index <= 54 && index % 4 !== 0 ? 0.05 : 0.99),
      }),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.scorable).toBe(false);
    expect(result.reps[0]?.qualityWarnings?.length).toBeGreaterThan(0);
    expect(result.reps[0]?.issueIds).toEqual([]);
    expect(result.feedbackMessages[0]).toContain("I couldn't judge your form there.");
  });

  it('does not count a small pulse that never reaches the top threshold', () => {
    const result = replayRecordingVerbose(
      barbellCurlDefinition,
      buildRecording('synthetic partial pulse', pulsePath(), 'front'),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('does not count a short-top setup movement before counting is armed', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildSegmentedRecording('synthetic short-top setup then clean curl', [
        { path: shortIncompleteFlexPath() },
        { path: fullRepPath() },
      ]),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.issueIds).toEqual([]);
  });

  it('counts a repeated short-top curl as incomplete_flex after a valid rep', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildSegmentedRecording('synthetic clean curl then short-top curl', [
        { path: fullRepPath() },
        { path: shortIncompleteFlexPath() },
      ]),
    );

    expect(result.finalRepCount).toBe(2);
    expect(result.reps[1]?.issueIds).toContain('barbell-curl.incomplete_flex');
    expect(result.reps[1]?.diagnostics?.metrics.romRatio.value).toBeLessThan(0.19);
  });

  it('does not complete a rep from held smoothed ratios during active landmark dropout', () => {
    const dropoutAfterTop = (index: number) => (index >= 34 ? 0.05 : 0.99);
    const result = replayRecordingVerbose(
      barbellCurlDefinition,
      buildDualRecording('synthetic curl dropout after top', fullRepPath(), fullRepPath(), 'front', {
        leftScore: dropoutAfterTop,
        rightScore: dropoutAfterTop,
      }),
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

  it('flags incomplete extension when the lifter re-curls before returning to the bottom', () => {
    const clean = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic clean front curl', fullRepPath(), 'front'),
    );
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic short return then re-flex curl', shortReturnReflexPath(), 'front'),
    );
    const metrics = result.reps[0]?.diagnostics?.metrics;
    const cue = result.reps[0]?.diagnostics?.cues['barbell-curl.incomplete_extend'];

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Extend fully at the bottom.');
    expect(result.reps[0]?.issueIds).toContain('barbell-curl.incomplete_extend');
    expect(metrics?.returnMaxCurlRatio.value).toBeLessThan(0.85);
    expect(metrics?.maxCurlRatio.value).toBeGreaterThan(metrics?.returnMaxCurlRatio.value ?? 0);
    expect(cue).toMatchObject({
      metricKeys: ['returnMaxCurlRatio'],
      eligible: true,
      triggered: true,
    });
  });

  it('marks torso cues ineligible when bilateral torso samples are unavailable', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic side-left torso unavailable curl', fullRepPath(), 'side-left', {
        rightHipScore: index => (index < 16 ? 0.99 : 0.05),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.diagnostics?.metrics.torsoDelta).toMatchObject({
      eligible: false,
      skippedReason: 'torso_unavailable',
    });
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.torso_warn']).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'reliability_unsafe_torsoControl',
    });
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.torso_fail']).toMatchObject({
      eligible: false,
      triggered: false,
      skippedReason: 'reliability_unsafe_torsoControl',
    });
  });

  it('does not flag elbow flare from a single noisy frame', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic one-frame elbow flare spike', fullRepPath(), 'front', {
        elbowOffset: index => (index === 34 ? 0.6 : 0),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain("Keep your elbows in — don't flare them out to the sides.");
    expect(result.feedbackMessages).not.toContain("Tuck your elbows in — they're drifting outward.");
  });

  it('flags sustained elbow flare', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic sustained elbow flare', fullRepPath(), 'front', {
        elbowOffset: index => (index >= 24 && index <= 48 ? 0.28 : 0),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Tuck your elbows in — they're drifting outward.");
  });

  it('still flags a true fast curl up', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic fast curl up', fastCurlUpPath(), 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Slow down — control the curl.');
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
