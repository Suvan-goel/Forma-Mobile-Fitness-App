import type { Keypoint } from '../poseAnalysis';
import type { PoseChainStatus, PoseChainSummary, PoseState } from './PoseState';

export type ValidHumanSubjectInvalidReason =
  | 'pose_lost'
  | 'insufficient_major_joints'
  | 'torso_unusable'
  | 'no_limb_chain'
  | 'subject_too_small'
  | 'collapsed_torso'
  | 'subject_center_jump'
  | 'subject_scale_jump'
  | 'active_subject_jump'
  | 'reacquisition_pending';

export interface SubjectObservation {
  centerX: number;
  centerY: number;
  area: number;
  width: number;
  height: number;
  maxDimension: number;
}

export interface ValidHumanSubjectResult {
  valid: boolean;
  reason?: ValidHumanSubjectInvalidReason;
  presentMajorJoints: number;
  usableChains: string[];
  weakChains: string[];
  chainStatuses: Record<string, PoseChainStatus>;
  strongHumanEvidence: boolean;
  boundingBox?: SubjectObservation;
}

export interface ValidHumanSubjectTrackingResult extends ValidHumanSubjectResult {
  invalidFrameCount: number;
  validFrameCount: number;
  reacquisitionFrameCount: number;
  sustainedInvalid: boolean;
  rejectedAsLikelyFalseSubject: boolean;
  subjectCenter?: { x: number; y: number };
  previousSubjectCenter?: { x: number; y: number };
  centerJump?: number;
  bboxArea?: number;
  previousBboxArea?: number;
  bboxAreaRatio?: number;
  continuityOverride: boolean;
  suspiciousSignals: string[];
}

export interface ValidHumanSubjectTrackerOptions {
  invalidFrameThreshold?: number;
  validFrameThreshold?: number;
  reacquisitionFrameThreshold?: number;
  centerJumpThreshold?: number;
  hardCenterJumpThreshold?: number;
  scaleRatioMin?: number;
  scaleRatioMax?: number;
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
const DEFAULT_REACQUISITION_FRAME_THRESHOLD = 6;
const MIN_PRESENT_MAJOR_JOINTS = 5;
const MIN_SUBJECT_BOX_MAX_DIMENSION = 0.06;
const MIN_TORSO_SPAN = 0.04;
const DEFAULT_CENTER_JUMP_THRESHOLD = 0.42;
const DEFAULT_HARD_CENTER_JUMP_THRESHOLD = 0.52;
const DEFAULT_SCALE_RATIO_MIN = 0.25;
const DEFAULT_SCALE_RATIO_MAX = 4.0;

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

function chainReliable(chain: PoseChainSummary | undefined): boolean {
  return chain?.status === 'reliable';
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
    centerX: minX + width / 2,
    centerY: minY + height / 2,
    area: Math.max(0, width) * Math.max(0, height),
    width,
    height,
    maxDimension: Math.max(width, height),
  };
}

function observationFromResult(result: ValidHumanSubjectResult): SubjectObservation | null {
  return result.valid && result.boundingBox ? result.boundingBox : null;
}

function centerDistance(a: SubjectObservation, b: SubjectObservation): number {
  const dx = a.centerX - b.centerX;
  const dy = a.centerY - b.centerY;
  return Math.sqrt(dx * dx + dy * dy);
}

function areaRatio(current: SubjectObservation, previous: SubjectObservation): number {
  if (previous.area <= 1e-6 || current.area <= 1e-6) return Infinity;
  return current.area / previous.area;
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
      chainStatuses: {},
      strongHumanEvidence: false,
    };
  }

  const presentMajorJoints = MAJOR_JOINTS.filter((jointName) => isJointPresent(poseState, jointName)).length;
  const chainStatuses = Object.fromEntries(
    Object.entries(poseState.chains).map(([chainName, chain]) => [chainName, chain.status]),
  );
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
  const strongHumanEvidence =
    presentMajorJoints >= 6 &&
    chainReliable(poseState.chains.torso) &&
    LIMB_CHAINS.some((chainName) => chainReliable(poseState.chains[chainName]));

  const base = {
    presentMajorJoints,
    usableChains,
    weakChains,
    chainStatuses,
    strongHumanEvidence,
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
  private reacquisitionFrameCount = 0;
  private sustainedInvalid = false;
  private activeSubject: SubjectObservation | null = null;
  private reacquisitionCandidate: SubjectObservation | null = null;
  private readonly invalidFrameThreshold: number;
  private readonly validFrameThreshold: number;
  private readonly reacquisitionFrameThreshold: number;
  private readonly centerJumpThreshold: number;
  private readonly hardCenterJumpThreshold: number;
  private readonly scaleRatioMin: number;
  private readonly scaleRatioMax: number;

  constructor(options: ValidHumanSubjectTrackerOptions = {}) {
    this.invalidFrameThreshold = options.invalidFrameThreshold ?? DEFAULT_INVALID_FRAME_THRESHOLD;
    this.validFrameThreshold = options.validFrameThreshold ?? DEFAULT_VALID_FRAME_THRESHOLD;
    this.reacquisitionFrameThreshold = options.reacquisitionFrameThreshold ?? DEFAULT_REACQUISITION_FRAME_THRESHOLD;
    this.centerJumpThreshold = options.centerJumpThreshold ?? DEFAULT_CENTER_JUMP_THRESHOLD;
    this.hardCenterJumpThreshold = options.hardCenterJumpThreshold ?? DEFAULT_HARD_CENTER_JUMP_THRESHOLD;
    this.scaleRatioMin = options.scaleRatioMin ?? DEFAULT_SCALE_RATIO_MIN;
    this.scaleRatioMax = options.scaleRatioMax ?? DEFAULT_SCALE_RATIO_MAX;
  }

  reset(): void {
    this.invalidFrameCount = 0;
    this.validFrameCount = 0;
    this.reacquisitionFrameCount = 0;
    this.sustainedInvalid = false;
    this.activeSubject = null;
    this.reacquisitionCandidate = null;
  }

  private continuityIssue(current: SubjectObservation, previous: SubjectObservation): {
    reason?: ValidHumanSubjectInvalidReason;
    centerJump: number;
    bboxAreaRatio: number;
    suspiciousSignals: string[];
  } {
    const jump = centerDistance(current, previous);
    const ratio = areaRatio(current, previous);
    const scaleJump = ratio < this.scaleRatioMin || ratio > this.scaleRatioMax;
    const hardCenterJump = jump > this.hardCenterJumpThreshold;
    const combinedJump = jump > this.centerJumpThreshold && scaleJump;
    const suspiciousSignals: string[] = [];
    if (jump > this.centerJumpThreshold) suspiciousSignals.push('center_jump');
    if (hardCenterJump) suspiciousSignals.push('hard_center_jump');
    if (scaleJump) suspiciousSignals.push('scale_jump');
    let reason: ValidHumanSubjectInvalidReason | undefined;
    if (hardCenterJump && scaleJump) reason = 'active_subject_jump';
    else if (hardCenterJump) reason = 'subject_center_jump';
    else if (combinedJump) reason = 'active_subject_jump';
    else if (scaleJump && jump > this.centerJumpThreshold * 0.55) reason = 'subject_scale_jump';
    return {
      reason,
      centerJump: jump,
      bboxAreaRatio: ratio,
      suspiciousSignals,
    };
  }

  private shouldRejectContinuity(
    result: ValidHumanSubjectResult,
    issue: ReturnType<ValidHumanSubjectTracker['continuityIssue']>,
  ): boolean {
    if (!issue.reason) return false;
    if (!result.strongHumanEvidence) return true;

    const hardCenterJump = issue.suspiciousSignals.includes('hard_center_jump');
    const scaleJump = issue.suspiciousSignals.includes('scale_jump');
    const severeShrink = issue.bboxAreaRatio < this.scaleRatioMin * 0.85;
    const severeGrowth = issue.bboxAreaRatio > this.scaleRatioMax * 1.15;

    // A solid torso plus a reliable major limb is strong evidence that this is
    // still the user. Only reject continuity when the switch is severe enough
    // to look like a different subject/object, not normal exercise motion.
    return hardCenterJump && scaleJump && (severeShrink || severeGrowth);
  }

  private accept(result: ValidHumanSubjectResult, observation: SubjectObservation): ValidHumanSubjectTrackingResult {
    const previousSubject = this.activeSubject;
    this.validFrameCount++;
    this.reacquisitionFrameCount = 0;
    this.reacquisitionCandidate = null;
    if (this.validFrameCount >= this.validFrameThreshold) {
      this.invalidFrameCount = 0;
      this.sustainedInvalid = false;
    }
    const tracking = this.withTrackingFields(result, {
      valid: true,
      rejectedAsLikelyFalseSubject: false,
      previousSubject,
    });
    this.activeSubject = observation;
    return tracking;
  }

  private reject(result: ValidHumanSubjectResult, args: {
    reason: ValidHumanSubjectInvalidReason;
    rejectedAsLikelyFalseSubject?: boolean;
    centerJump?: number;
    bboxAreaRatio?: number;
    suspiciousSignals?: string[];
  }): ValidHumanSubjectTrackingResult {
    this.validFrameCount = 0;
    this.reacquisitionFrameCount = 0;
    this.reacquisitionCandidate = null;
    this.invalidFrameCount++;
    if (this.invalidFrameCount >= this.invalidFrameThreshold) {
      this.sustainedInvalid = true;
    }
    return this.withTrackingFields(
      { ...result, valid: false, reason: args.reason },
      {
        valid: false,
        rejectedAsLikelyFalseSubject: args.rejectedAsLikelyFalseSubject ?? false,
        centerJump: args.centerJump,
        bboxAreaRatio: args.bboxAreaRatio,
        suspiciousSignals: args.suspiciousSignals,
      },
    );
  }

  private reacquire(result: ValidHumanSubjectResult, observation: SubjectObservation): ValidHumanSubjectTrackingResult {
    const previous = this.activeSubject;
    if (previous) {
      const issue = this.continuityIssue(observation, previous);
      if (this.shouldRejectContinuity(result, issue)) {
        return this.reject(result, {
          reason: issue.reason ?? 'active_subject_jump',
          rejectedAsLikelyFalseSubject: true,
          centerJump: issue.centerJump,
          bboxAreaRatio: issue.bboxAreaRatio,
          suspiciousSignals: issue.suspiciousSignals,
        });
      }
    }

    if (!this.reacquisitionCandidate) {
      this.reacquisitionCandidate = observation;
      this.reacquisitionFrameCount = 1;
    } else {
      const issue = this.continuityIssue(observation, this.reacquisitionCandidate);
      if (this.shouldRejectContinuity(result, issue)) {
        this.reacquisitionCandidate = observation;
        this.reacquisitionFrameCount = 1;
      } else {
        this.reacquisitionFrameCount++;
        this.reacquisitionCandidate = observation;
      }
    }

    if (this.reacquisitionFrameCount >= this.reacquisitionFrameThreshold) {
      this.validFrameCount = this.validFrameThreshold;
      this.invalidFrameCount = 0;
      this.sustainedInvalid = false;
      this.reacquisitionCandidate = null;
      const tracking = this.withTrackingFields(result, {
        valid: true,
        rejectedAsLikelyFalseSubject: false,
        previousSubject: this.activeSubject,
      });
      this.activeSubject = observation;
      return tracking;
    }

    return this.withTrackingFields(
      { ...result, valid: false, reason: 'reacquisition_pending' },
      {
        valid: false,
        rejectedAsLikelyFalseSubject: false,
      },
    );
  }

  private withTrackingFields(
    result: ValidHumanSubjectResult,
    args: {
      valid: boolean;
      rejectedAsLikelyFalseSubject: boolean;
      centerJump?: number;
      bboxAreaRatio?: number;
      previousSubject?: SubjectObservation | null;
      continuityOverride?: boolean;
      suspiciousSignals?: string[];
    },
  ): ValidHumanSubjectTrackingResult {
    const observation = observationFromResult(result);
    const previous = args.previousSubject === undefined ? this.activeSubject : args.previousSubject;
    const centerJump = args.centerJump ?? (observation && previous ? centerDistance(observation, previous) : undefined);
    const bboxAreaRatio = args.bboxAreaRatio ?? (observation && previous ? areaRatio(observation, previous) : undefined);

    return {
      ...result,
      valid: args.valid,
      invalidFrameCount: this.invalidFrameCount,
      validFrameCount: this.validFrameCount,
      reacquisitionFrameCount: this.reacquisitionFrameCount,
      sustainedInvalid: this.sustainedInvalid,
      rejectedAsLikelyFalseSubject: args.rejectedAsLikelyFalseSubject,
      subjectCenter: observation
        ? { x: observation.centerX, y: observation.centerY }
        : undefined,
      previousSubjectCenter: previous
        ? { x: previous.centerX, y: previous.centerY }
        : undefined,
      centerJump,
      bboxArea: observation?.area,
      previousBboxArea: previous?.area,
      bboxAreaRatio,
      continuityOverride: args.continuityOverride ?? false,
      suspiciousSignals: args.suspiciousSignals ?? [],
    };
  }

  update(result: ValidHumanSubjectResult): ValidHumanSubjectTrackingResult {
    const observation = observationFromResult(result);
    if (!result.valid || !observation) {
      return this.reject(result, {
        reason: result.reason ?? 'pose_lost',
      });
    }

    if (!this.activeSubject) {
      this.validFrameCount = Math.max(this.validFrameCount + 1, this.validFrameThreshold);
      this.invalidFrameCount = 0;
      this.sustainedInvalid = false;
      const tracking = this.withTrackingFields(result, {
        valid: true,
        rejectedAsLikelyFalseSubject: false,
        previousSubject: null,
      });
      this.activeSubject = observation;
      return tracking;
    }

    if (this.sustainedInvalid) {
      return this.reacquire(result, observation);
    }

    const issue = this.continuityIssue(observation, this.activeSubject);
    if (this.shouldRejectContinuity(result, issue)) {
      return this.reject(result, {
        reason: issue.reason ?? 'active_subject_jump',
        rejectedAsLikelyFalseSubject: true,
        centerJump: issue.centerJump,
        bboxAreaRatio: issue.bboxAreaRatio,
        suspiciousSignals: issue.suspiciousSignals,
      });
    }

    const accepted = this.accept(result, observation);
    if (issue.reason) {
      return {
        ...accepted,
        continuityOverride: true,
        suspiciousSignals: issue.suspiciousSignals,
        centerJump: issue.centerJump,
        bboxAreaRatio: issue.bboxAreaRatio,
      };
    }
    return accepted;
  }
}
