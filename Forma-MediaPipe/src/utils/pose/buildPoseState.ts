import type { Keypoint } from '../poseAnalysis';
import type { ParsedPoseFrame, PoseLandmarkMetadata } from './parsePoseFrame';
import type {
  PoseChainStatus,
  PoseChainSummary,
  PoseJoint,
  PoseJointReliability,
  PoseJointReliabilityReason,
  PoseState,
  PoseStateFrameContext,
  PoseStateReliabilitySummary,
  PoseStateStatus,
} from './PoseState';
import {
  POSE_LANDMARK_NAMES,
  POSE_RELIABILITY_THRESHOLDS,
  addJointReliabilityReason,
  createPoseJoint,
  keypointDistance,
} from './landmarkReliability';

export interface BuildPoseStateOptions extends PoseStateFrameContext {
  previousPoseState?: PoseState | null;
}

const CHAIN_DEFINITIONS: Record<string, string[]> = {
  leftArm: ['left_shoulder', 'left_elbow', 'left_wrist'],
  rightArm: ['right_shoulder', 'right_elbow', 'right_wrist'],
  leftLeg: ['left_hip', 'left_knee', 'left_ankle'],
  rightLeg: ['right_hip', 'right_knee', 'right_ankle'],
  torso: ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'],
  pushupBodyLine: ['left_shoulder', 'left_hip', 'left_ankle', 'right_shoulder', 'right_hip', 'right_ankle'],
};

const BONE_DEFINITIONS: Array<[string, string]> = [
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

function emptyReliabilityCounts(): Record<PoseJointReliability, number> {
  return {
    reliable: 0,
    lowVisibility: 0,
    lowPresence: 0,
    missing: 0,
    malformed: 0,
    stale: 0,
    outlierCandidate: 0,
  };
}

function keypointsByName(keypoints: Keypoint[]): Record<string, Keypoint> {
  return Object.fromEntries(keypoints.map(keypoint => [keypoint.name, keypoint]));
}

function metadataByName(metadata?: PoseLandmarkMetadata[]): Record<string, PoseLandmarkMetadata> {
  if (!metadata) return {};
  return Object.fromEntries(metadata.map(item => [item.name, item]));
}

function primaryMetadata(parsed: ParsedPoseFrame): Record<string, PoseLandmarkMetadata> {
  if (parsed.primarySource === 'world' && parsed.metadata.worldLandmarks) {
    return metadataByName(parsed.metadata.worldLandmarks);
  }
  if (parsed.metadata.imageLandmarks) {
    return metadataByName(parsed.metadata.imageLandmarks);
  }
  return metadataByName(parsed.metadata.worldLandmarks);
}

function jointNames(parsed: ParsedPoseFrame): string[] {
  const names = new Set<string>(POSE_LANDMARK_NAMES);
  parsed.keypoints.forEach(keypoint => names.add(keypoint.name));
  parsed.metadata.imageLandmarks?.forEach(item => names.add(item.name));
  parsed.metadata.worldLandmarks?.forEach(item => names.add(item.name));
  return [...names];
}

function applyBoneLengthDiagnostics(
  joints: Record<string, PoseJoint>,
  previousPoseState?: PoseState | null,
): void {
  if (!previousPoseState) return;

  for (const [aName, bName] of BONE_DEFINITIONS) {
    const a = joints[aName];
    const b = joints[bName];
    const prevA = previousPoseState.joints[aName];
    const prevB = previousPoseState.joints[bName];
    if (!a?.raw || !b?.raw || !prevA?.raw || !prevB?.raw) continue;

    const currentLength = keypointDistance(a.raw, b.raw);
    const previousLength = keypointDistance(prevA.raw, prevB.raw);
    if (currentLength === null || previousLength === null || previousLength < 1e-6) continue;

    const relativeChange = Math.abs(currentLength - previousLength) / previousLength;
    if (relativeChange > POSE_RELIABILITY_THRESHOLDS.boneLengthRelativeChange) {
      addJointReliabilityReason(a, 'bone_length_jump');
      addJointReliabilityReason(b, 'bone_length_jump');
    }
  }
}

function buildChainSummary(name: string, chainJoints: string[], joints: Record<string, PoseJoint>): PoseChainSummary {
  const reliableJoints: string[] = [];
  const lowConfidenceJoints: string[] = [];
  const missingJoints: string[] = [];
  const malformedJoints: string[] = [];
  const staleJoints: string[] = [];
  const outlierCandidateJoints: string[] = [];

  for (const jointName of chainJoints) {
    const joint = joints[jointName];
    if (!joint) {
      missingJoints.push(jointName);
      continue;
    }
    if (joint.reliability === 'reliable') reliableJoints.push(jointName);
    if (joint.reliability === 'lowVisibility' || joint.reliability === 'lowPresence') {
      lowConfidenceJoints.push(jointName);
    }
    if (joint.reliability === 'missing') missingJoints.push(jointName);
    if (joint.reliability === 'malformed') malformedJoints.push(jointName);
    if (joint.reliability === 'stale') staleJoints.push(jointName);
    if (joint.reliability === 'outlierCandidate') outlierCandidateJoints.push(jointName);
  }

  const status: PoseChainStatus =
    missingJoints.length > 0 || malformedJoints.length > 0
      ? 'unreliable'
      : reliableJoints.length === chainJoints.length
        ? 'reliable'
        : 'partial';

  return {
    name,
    joints: chainJoints,
    reliableJoints,
    lowConfidenceJoints,
    missingJoints,
    malformedJoints,
    staleJoints,
    outlierCandidateJoints,
    status,
  };
}

function buildDiagnostics(
  joints: Record<string, PoseJoint>,
  frameContext: PoseStateFrameContext,
): PoseState['diagnostics'] {
  const reliabilityCounts = emptyReliabilityCounts();
  const reasonCounts: Partial<Record<PoseJointReliabilityReason, number>> = {};
  const malformedJoints: string[] = [];
  const missingJoints: string[] = [];
  const lowConfidenceJoints: string[] = [];
  const staleJoints: string[] = [];
  const outlierCandidateJoints: string[] = [];

  for (const joint of Object.values(joints)) {
    reliabilityCounts[joint.reliability]++;
    for (const reason of joint.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
    if (joint.reliability === 'malformed') malformedJoints.push(joint.name);
    if (joint.reliability === 'missing') missingJoints.push(joint.name);
    if (joint.reliability === 'lowVisibility' || joint.reliability === 'lowPresence') {
      lowConfidenceJoints.push(joint.name);
    }
    if (joint.reliability === 'stale') staleJoints.push(joint.name);
    if (joint.reliability === 'outlierCandidate') outlierCandidateJoints.push(joint.name);
  }

  return {
    reliabilityCounts,
    reasonCounts,
    malformedJoints,
    missingJoints,
    lowConfidenceJoints,
    staleJoints,
    outlierCandidateJoints,
    trackingInterrupted: frameContext.trackingInterrupted === true,
    silentGapMs: frameContext.silentGapMs,
    reacquisitionFrameIndex: frameContext.reacquisitionFrameIndex,
  };
}

function poseStateStatus(parsed: ParsedPoseFrame, joints: Record<string, PoseJoint>): PoseStateStatus {
  if (parsed.status === 'trackingLost' || parsed.keypoints.length === 0) return 'lost';
  return Object.values(joints).some(joint => joint.reliability !== 'reliable') ? 'partial' : 'tracked';
}

export function buildPoseState(parsed: ParsedPoseFrame, options: BuildPoseStateOptions = {}): PoseState {
  const keypointMap = keypointsByName(parsed.keypoints);
  const metadataMap = primaryMetadata(parsed);
  const source = parsed.primarySource;
  const joints: Record<string, PoseJoint> = {};

  for (const name of jointNames(parsed)) {
    const metadata = metadataMap[name];
    joints[name] = createPoseJoint({
      name,
      keypoint: keypointMap[name] ?? null,
      metadata,
      source: metadata?.source ?? source ?? 'unknown',
      frameContext: options,
      previousJoint: options.previousPoseState?.joints[name],
      timestampMs: parsed.timestampMs,
      previousTimestampMs: options.previousPoseState?.timestampMs,
    });
  }

  applyBoneLengthDiagnostics(joints, options.previousPoseState);

  const chains = Object.fromEntries(
    Object.entries(CHAIN_DEFINITIONS).map(([name, chainJoints]) => [
      name,
      buildChainSummary(name, chainJoints, joints),
    ]),
  );

  return {
    timestampMs: parsed.timestampMs,
    status: poseStateStatus(parsed, joints),
    primarySource: parsed.primarySource,
    keypoints: parsed.keypoints,
    joints,
    chains,
    diagnostics: buildDiagnostics(joints, options),
  };
}

function emptyStatusCounts(): Record<PoseStateStatus, number> {
  return { tracked: 0, partial: 0, lost: 0 };
}

function cloneReliabilityCounts(counts: Record<PoseJointReliability, number>): Record<PoseJointReliability, number> {
  return { ...counts };
}

function cloneReasonCounts(
  counts: Partial<Record<PoseJointReliabilityReason, number>>,
): Partial<Record<PoseJointReliabilityReason, number>> {
  return { ...counts };
}

function emptySummary(): PoseStateReliabilitySummary {
  return {
    totalFrames: 0,
    statusCounts: emptyStatusCounts(),
    reliabilityCounts: emptyReliabilityCounts(),
    reasonCounts: {},
    unreliableJointCounts: {},
    outlierCandidateByJoint: {},
    chainStatusCounts: {},
    trackingInterruptedFrames: 0,
    reacquisitionFrames: 0,
  };
}

function increment(map: Record<string, number>, key: string, amount = 1): void {
  map[key] = (map[key] ?? 0) + amount;
}

export class PoseStateReliabilityAggregator {
  private summary: PoseStateReliabilitySummary = emptySummary();

  observe(poseState: PoseState): void {
    this.summary.totalFrames++;
    this.summary.statusCounts[poseState.status]++;
    if (poseState.diagnostics.trackingInterrupted) this.summary.trackingInterruptedFrames++;
    if (poseState.diagnostics.reacquisitionFrameIndex !== undefined) this.summary.reacquisitionFrames++;

    for (const [reliability, count] of Object.entries(poseState.diagnostics.reliabilityCounts) as Array<[PoseJointReliability, number]>) {
      this.summary.reliabilityCounts[reliability] += count;
    }
    for (const [reason, count] of Object.entries(poseState.diagnostics.reasonCounts) as Array<[PoseJointReliabilityReason, number]>) {
      this.summary.reasonCounts[reason] = (this.summary.reasonCounts[reason] ?? 0) + count;
    }

    for (const joint of Object.values(poseState.joints)) {
      if (joint.reliability !== 'reliable') increment(this.summary.unreliableJointCounts, joint.name);
      if (joint.reliability === 'outlierCandidate') increment(this.summary.outlierCandidateByJoint, joint.name);
    }

    for (const chain of Object.values(poseState.chains)) {
      this.summary.chainStatusCounts[chain.name] ??= { reliable: 0, partial: 0, unreliable: 0 };
      this.summary.chainStatusCounts[chain.name][chain.status]++;
    }
  }

  snapshot(): PoseStateReliabilitySummary {
    return {
      totalFrames: this.summary.totalFrames,
      statusCounts: { ...this.summary.statusCounts },
      reliabilityCounts: cloneReliabilityCounts(this.summary.reliabilityCounts),
      reasonCounts: cloneReasonCounts(this.summary.reasonCounts),
      unreliableJointCounts: { ...this.summary.unreliableJointCounts },
      outlierCandidateByJoint: { ...this.summary.outlierCandidateByJoint },
      chainStatusCounts: Object.fromEntries(
        Object.entries(this.summary.chainStatusCounts).map(([chain, counts]) => [chain, { ...counts }]),
      ),
      trackingInterruptedFrames: this.summary.trackingInterruptedFrames,
      reacquisitionFrames: this.summary.reacquisitionFrames,
    };
  }

  reset(): void {
    this.summary = emptySummary();
  }
}

export function createPoseStateReliabilityAggregator(): PoseStateReliabilityAggregator {
  return new PoseStateReliabilityAggregator();
}

function topCounts(record: Record<string, number>, limit = 5): string {
  const entries = Object.entries(record)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return entries.length > 0 ? entries.map(([key, count]) => `${key}:${count}`).join(',') : 'none';
}

function formatChainCounts(summary: PoseStateReliabilitySummary, chains: string[]): string {
  return chains
    .map((chain) => {
      const counts = summary.chainStatusCounts[chain] ?? { reliable: 0, partial: 0, unreliable: 0 };
      return `${chain}=reliable:${counts.reliable}/partial:${counts.partial}/unreliable:${counts.unreliable}`;
    })
    .join(' ');
}

function focusJointSummary(summary: PoseStateReliabilitySummary): string {
  const names = [
    'left_wrist', 'right_wrist',
    'left_elbow', 'right_elbow',
    'left_knee', 'right_knee',
    'left_ankle', 'right_ankle',
  ];
  return names
    .map(name => `${name}:unreliable=${summary.unreliableJointCounts[name] ?? 0}/outlier=${summary.outlierCandidateByJoint[name] ?? 0}`)
    .join(' ');
}

export function formatPoseStateReliabilitySummary(summary: PoseStateReliabilitySummary): string {
  return [
    `[PoseStateDiagnostics] frames=${summary.totalFrames} tracked=${summary.statusCounts.tracked} partial=${summary.statusCounts.partial} lost=${summary.statusCounts.lost}`,
    `[PoseStateDiagnostics] reliability reliable=${summary.reliabilityCounts.reliable} lowVisibility=${summary.reliabilityCounts.lowVisibility} lowPresence=${summary.reliabilityCounts.lowPresence} missing=${summary.reliabilityCounts.missing} malformed=${summary.reliabilityCounts.malformed} stale=${summary.reliabilityCounts.stale} outlierCandidate=${summary.reliabilityCounts.outlierCandidate}`,
    `[PoseStateDiagnostics] topUnreliableJoints=${topCounts(summary.unreliableJointCounts)} topOutlierCandidates=${topCounts(summary.outlierCandidateByJoint)}`,
    `[PoseStateDiagnostics] reasons top=${topCounts(summary.reasonCounts as Record<string, number>)}`,
    `[PoseStateDiagnostics] chains arms ${formatChainCounts(summary, ['leftArm', 'rightArm'])}`,
    `[PoseStateDiagnostics] chains legs ${formatChainCounts(summary, ['leftLeg', 'rightLeg'])} torso ${formatChainCounts(summary, ['torso', 'pushupBodyLine'])}`,
    `[PoseStateDiagnostics] focus ${focusJointSummary(summary)}`,
    `[PoseStateDiagnostics] trackingInterrupted=${summary.trackingInterruptedFrames} reacquisitionFrames=${summary.reacquisitionFrames}`,
  ].join('\n');
}
