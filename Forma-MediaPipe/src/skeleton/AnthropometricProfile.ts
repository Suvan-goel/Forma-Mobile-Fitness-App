import { CanonicalJoint } from './CanonicalJoint';
import type { Joint3D, SkeletonFrame } from './SkeletonFrame';

export interface AnthropometricProfile {
  computedAt: number;
  sampleFrameCount: number;
  confidence: number;
  segments: {
    torso: number;
    spineToNeck: number;
    upperArm: number;
    forearm: number;
    femur: number;
    tibia: number;
    foot: number;
    shoulderWidth: number;
    hipWidth: number;
  };
  derived: {
    standingHeight: number;
    armSpan: number;
    legLength: number;
    torsoToLeg: number;
    femurToTibia: number;
  };
  baselines?: {
    reachRatioAsymmetry?: number;
  };
  referenceUnit: number;
}

type SegmentSample = {
  value: number;
  confidence: number;
};

type SegmentSamples = {
  torso: SegmentSample[];
  spineToNeck: SegmentSample[];
  headToNeck: SegmentSample[];
  leftUpperArm: SegmentSample[];
  rightUpperArm: SegmentSample[];
  leftForearm: SegmentSample[];
  rightForearm: SegmentSample[];
  leftFemur: SegmentSample[];
  rightFemur: SegmentSample[];
  leftTibia: SegmentSample[];
  rightTibia: SegmentSample[];
  leftFoot: SegmentSample[];
  rightFoot: SegmentSample[];
  shoulderWidth: SegmentSample[];
  hipWidth: SegmentSample[];
};

const MIN_CONFIDENCE = 0.5;
const MIN_PROFILE_FRAMES = 20;

function distance(a: Joint3D, b: Joint3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function pushSegment(
  samples: SegmentSample[],
  frame: SkeletonFrame,
  a: CanonicalJoint,
  b: CanonicalJoint
): void {
  const jointA = frame.joints[a];
  const jointB = frame.joints[b];
  const confidence = Math.min(jointA.confidence, jointB.confidence);
  if (confidence < MIN_CONFIDENCE) return;
  samples.push({ value: distance(jointA, jointB), confidence });
}

function collectSamples(frames: readonly SkeletonFrame[]): SegmentSamples {
  const samples: SegmentSamples = {
    torso: [],
    spineToNeck: [],
    headToNeck: [],
    leftUpperArm: [],
    rightUpperArm: [],
    leftForearm: [],
    rightForearm: [],
    leftFemur: [],
    rightFemur: [],
    leftTibia: [],
    rightTibia: [],
    leftFoot: [],
    rightFoot: [],
    shoulderWidth: [],
    hipWidth: [],
  };

  for (const frame of frames) {
    pushSegment(samples.torso, frame, CanonicalJoint.PELVIS_CENTER, CanonicalJoint.CHEST_CENTER);
    pushSegment(samples.spineToNeck, frame, CanonicalJoint.CHEST_CENTER, CanonicalJoint.NECK);
    pushSegment(samples.headToNeck, frame, CanonicalJoint.NECK, CanonicalJoint.HEAD);
    pushSegment(samples.leftUpperArm, frame, CanonicalJoint.LEFT_SHOULDER, CanonicalJoint.LEFT_ELBOW);
    pushSegment(samples.rightUpperArm, frame, CanonicalJoint.RIGHT_SHOULDER, CanonicalJoint.RIGHT_ELBOW);
    pushSegment(samples.leftForearm, frame, CanonicalJoint.LEFT_ELBOW, CanonicalJoint.LEFT_WRIST);
    pushSegment(samples.rightForearm, frame, CanonicalJoint.RIGHT_ELBOW, CanonicalJoint.RIGHT_WRIST);
    pushSegment(samples.leftFemur, frame, CanonicalJoint.LEFT_HIP, CanonicalJoint.LEFT_KNEE);
    pushSegment(samples.rightFemur, frame, CanonicalJoint.RIGHT_HIP, CanonicalJoint.RIGHT_KNEE);
    pushSegment(samples.leftTibia, frame, CanonicalJoint.LEFT_KNEE, CanonicalJoint.LEFT_ANKLE);
    pushSegment(samples.rightTibia, frame, CanonicalJoint.RIGHT_KNEE, CanonicalJoint.RIGHT_ANKLE);
    pushSegment(samples.leftFoot, frame, CanonicalJoint.LEFT_ANKLE, CanonicalJoint.LEFT_FOOT);
    pushSegment(samples.rightFoot, frame, CanonicalJoint.RIGHT_ANKLE, CanonicalJoint.RIGHT_FOOT);
    pushSegment(samples.shoulderWidth, frame, CanonicalJoint.LEFT_SHOULDER, CanonicalJoint.RIGHT_SHOULDER);
    pushSegment(samples.hipWidth, frame, CanonicalJoint.LEFT_HIP, CanonicalJoint.RIGHT_HIP);
  }

  return samples;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function sampleMedian(samples: readonly SegmentSample[]): number {
  return median(samples.map((sample) => sample.value));
}

function averageConfidence(samples: readonly SegmentSample[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample.confidence;
  return sum / samples.length;
}

function bilateralMedian(left: readonly SegmentSample[], right: readonly SegmentSample[]): number {
  const leftMedian = sampleMedian(left);
  const rightMedian = sampleMedian(right);
  if (leftMedian <= 0) return rightMedian;
  if (rightMedian <= 0) return leftMedian;

  const diffRatio = Math.abs(leftMedian - rightMedian) / Math.max(leftMedian, rightMedian);
  if (diffRatio > 0.15) {
    return averageConfidence(left) >= averageConfidence(right) ? leftMedian : rightMedian;
  }

  return (leftMedian + rightMedian) / 2;
}

function deepFreezeProfile(profile: AnthropometricProfile): AnthropometricProfile {
  Object.freeze(profile.segments);
  Object.freeze(profile.derived);
  if (profile.baselines) Object.freeze(profile.baselines);
  return Object.freeze(profile);
}

export function computeAnthropometricProfile(
  frames: readonly SkeletonFrame[],
  computedAt: number = Date.now()
): AnthropometricProfile {
  const samples = collectSamples(frames);

  const torso = sampleMedian(samples.torso);
  const spineToNeck = sampleMedian(samples.spineToNeck);
  const headToNeck = sampleMedian(samples.headToNeck);
  const upperArm = bilateralMedian(samples.leftUpperArm, samples.rightUpperArm);
  const forearm = bilateralMedian(samples.leftForearm, samples.rightForearm);
  const femur = bilateralMedian(samples.leftFemur, samples.rightFemur);
  const tibia = bilateralMedian(samples.leftTibia, samples.rightTibia);
  const foot = bilateralMedian(samples.leftFoot, samples.rightFoot);
  const shoulderWidth = sampleMedian(samples.shoulderWidth);
  const hipWidth = sampleMedian(samples.hipWidth);

  const legLength = foot + tibia + femur;
  const standingHeight = legLength + torso + spineToNeck + headToNeck;
  const armSpan = 2 * (shoulderWidth / 2 + upperArm + forearm);
  const confidence = Math.min(1, frames.length / MIN_PROFILE_FRAMES);

  return deepFreezeProfile({
    computedAt,
    sampleFrameCount: frames.length,
    confidence,
    segments: {
      torso,
      spineToNeck,
      upperArm,
      forearm,
      femur,
      tibia,
      foot,
      shoulderWidth,
      hipWidth,
    },
    derived: {
      standingHeight,
      armSpan,
      legLength,
      torsoToLeg: legLength > 0 ? torso / legLength : 0,
      femurToTibia: tibia > 0 ? femur / tibia : 0,
    },
    baselines: {
      reachRatioAsymmetry: computeReachRatioAsymmetryBaseline(frames),
    },
    referenceUnit: standingHeight,
  });
}

export const ANTHROPOMETRIC_PROFILE_MIN_FRAMES = MIN_PROFILE_FRAMES;

function computeReachRatioAsymmetryBaseline(frames: readonly SkeletonFrame[]): number {
  const values: number[] = [];
  for (const frame of frames) {
    const left = reachRatio(frame, CanonicalJoint.LEFT_SHOULDER, CanonicalJoint.LEFT_ELBOW, CanonicalJoint.LEFT_WRIST);
    const right = reachRatio(frame, CanonicalJoint.RIGHT_SHOULDER, CanonicalJoint.RIGHT_ELBOW, CanonicalJoint.RIGHT_WRIST);
    if (left === null || right === null) continue;
    values.push(Math.abs(left - right));
  }
  return median(values);
}

function reachRatio(
  frame: SkeletonFrame,
  proximal: CanonicalJoint,
  joint: CanonicalJoint,
  distal: CanonicalJoint
): number | null {
  const a = frame.joints[proximal];
  const b = frame.joints[joint];
  const c = frame.joints[distal];
  if (
    Math.min(a.confidence, b.confidence, c.confidence) < MIN_CONFIDENCE
  ) {
    return null;
  }
  const chainLength = distance(a, b) + distance(b, c);
  if (chainLength < 1e-8) return null;
  return distance(a, c) / chainLength;
}
