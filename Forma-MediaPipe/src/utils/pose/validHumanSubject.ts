import type { Keypoint } from '../poseAnalysis';
import type { PoseChainSummary, PoseState } from './PoseState';

export type ValidHumanSubjectInvalidReason =
  | 'pose_lost'
  | 'insufficient_major_joints'
  | 'torso_unusable'
  | 'no_limb_chain'
  | 'subject_too_small'
  | 'collapsed_torso';

export interface ValidHumanSubjectResult {
  valid: boolean;
  reason?: ValidHumanSubjectInvalidReason;
  presentMajorJoints: number;
  usableChains: string[];
  weakChains: string[];
  boundingBox?: {
    width: number;
    height: number;
    maxDimension: number;
  };
}

export interface ValidHumanSubjectTrackingResult extends ValidHumanSubjectResult {
  invalidFrameCount: number;
  validFrameCount: number;
  sustainedInvalid: boolean;
}

export interface ValidHumanSubjectTrackerOptions {
  invalidFrameThreshold?: number;
  validFrameThreshold?: number;
}

const MAJOR_JOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

const LIMB_CHAINS = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const DEFAULT_INVALID_FRAME_THRESHOLD = 12;
const DEFAULT_VALID_FRAME_THRESHOLD = 2;
const MIN_PRESENT_MAJOR_JOINTS = 5;
const MIN_SUBJECT_BOX_MAX_DIMENSION = 0.06;
const MIN_TORSO_SPAN = 0.04;

function isJointPresent(poseState: PoseState, jointName: string): boolean {
  const joint = poseState.joints[jointName];
  return Boolean(
    joint?.raw &&
    joint.reliability !== 'missing' &&
    joint.reliability !== 'malformed',
  );
}

function reliableJointCount(poseState: PoseState, joints: string[]): number {
  return joints.filter((jointName) => poseState.joints[jointName]?.reliability === 'reliable').length;
}

function chainUsable(chain: PoseChainSummary | undefined): boolean {
  if (!chain) return false;
  return chain.status === 'reliable' || chain.status === 'partial';
}

function visibleMajorBox(imageKeypoints: Keypoint[] | undefined): ValidHumanSubjectResult['boundingBox'] {
  if (!imageKeypoints || imageKeypoints.length === 0) return undefined;
  const major = new Set(MAJOR_JOINTS);
  const visible = imageKeypoints.filter((keypoint) => (
    keypoint.name &&
    major.has(keypoint.name) &&
    (keypoint.score ?? 0) > 0.2 &&
    Number.isFinite(keypoint.x) &&
    Number.isFinite(keypoint.y)
  ));
  if (visible.length < 2) return undefined;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const keypoint of visible) {
    minX = Math.min(minX, keypoint.x);
    minY = Math.min(minY, keypoint.y);
    maxX = Math.max(maxX, keypoint.x);
    maxY = Math.max(maxY, keypoint.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    width,
    height,
    maxDimension: Math.max(width, height),
  };
}

function torsoSpan(poseState: PoseState): number {
  const torsoJoints = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']
    .map((jointName) => poseState.joints[jointName]?.raw)
    .filter((keypoint): keypoint is Keypoint => Boolean(keypoint));
  if (torsoJoints.length < 2) return 0;

  let maxDistance = 0;
  for (let i = 0; i < torsoJoints.length; i++) {
    for (let j = i + 1; j < torsoJoints.length; j++) {
      const dx = torsoJoints[i].x - torsoJoints[j].x;
      const dy = torsoJoints[i].y - torsoJoints[j].y;
      const dz = (torsoJoints[i].z ?? 0) - (torsoJoints[j].z ?? 0);
      maxDistance = Math.max(maxDistance, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  return maxDistance;
}

export function evaluateValidHumanSubject(args: {
  poseState?: PoseState | null;
  imageKeypoints?: Keypoint[];
}): ValidHumanSubjectResult {
  const { poseState, imageKeypoints } = args;
  if (!poseState || poseState.status === 'lost') {
    return {
      valid: false,
      reason: 'pose_lost',
      presentMajorJoints: 0,
      usableChains: [],
      weakChains: [],
    };
  }

  const presentMajorJoints = MAJOR_JOINTS.filter((jointName) => isJointPresent(poseState, jointName)).length;
  const usableChains = Object.values(poseState.chains)
    .filter(chainUsable)
    .map((chain) => chain.name);
  const weakChains = Object.values(poseState.chains)
    .filter((chain) => !chainUsable(chain))
    .map((chain) => chain.name);
  const boundingBox = visibleMajorBox(imageKeypoints);
  const hasTorso =
    reliableJointCount(poseState, ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']) >= 2 &&
    (
      isJointPresent(poseState, 'left_shoulder') ||
      isJointPresent(poseState, 'right_shoulder')
    ) &&
    (
      isJointPresent(poseState, 'left_hip') ||
      isJointPresent(poseState, 'right_hip')
    );
  const hasLimbChain = LIMB_CHAINS.some((chainName) => chainUsable(poseState.chains[chainName]));

  const base = {
    presentMajorJoints,
    usableChains,
    weakChains,
    boundingBox,
  };

  if (presentMajorJoints < MIN_PRESENT_MAJOR_JOINTS) {
    return { ...base, valid: false, reason: 'insufficient_major_joints' };
  }
  if (!hasTorso) {
    return { ...base, valid: false, reason: 'torso_unusable' };
  }
  if (!hasLimbChain) {
    return { ...base, valid: false, reason: 'no_limb_chain' };
  }
  if (boundingBox && boundingBox.maxDimension < MIN_SUBJECT_BOX_MAX_DIMENSION) {
    return { ...base, valid: false, reason: 'subject_too_small' };
  }
  if (torsoSpan(poseState) < MIN_TORSO_SPAN) {
    return { ...base, valid: false, reason: 'collapsed_torso' };
  }

  return { ...base, valid: true };
}

export class ValidHumanSubjectTracker {
  private invalidFrameCount = 0;
  private validFrameCount = 0;
  private readonly invalidFrameThreshold: number;
  private readonly validFrameThreshold: number;

  constructor(options: ValidHumanSubjectTrackerOptions = {}) {
    this.invalidFrameThreshold = options.invalidFrameThreshold ?? DEFAULT_INVALID_FRAME_THRESHOLD;
    this.validFrameThreshold = options.validFrameThreshold ?? DEFAULT_VALID_FRAME_THRESHOLD;
  }

  reset(): void {
    this.invalidFrameCount = 0;
    this.validFrameCount = 0;
  }

  update(result: ValidHumanSubjectResult): ValidHumanSubjectTrackingResult {
    if (result.valid) {
      this.validFrameCount++;
      if (this.validFrameCount >= this.validFrameThreshold) {
        this.invalidFrameCount = 0;
      }
    } else {
      this.validFrameCount = 0;
      this.invalidFrameCount++;
    }

    return {
      ...result,
      invalidFrameCount: this.invalidFrameCount,
      validFrameCount: this.validFrameCount,
      sustainedInvalid: !result.valid && this.invalidFrameCount >= this.invalidFrameThreshold,
    };
  }
}
