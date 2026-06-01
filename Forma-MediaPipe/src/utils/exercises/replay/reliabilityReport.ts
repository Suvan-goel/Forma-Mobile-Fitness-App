import { buildPoseState, createPoseStateReliabilityAggregator } from '../../pose/buildPoseState';
import { createPoseFrameGapTracker } from '../../pose/frameGapTracker';
import { POSE_LANDMARK_NAMES } from '../../pose/landmarkReliability';
import type {
  KeypointScoreSource,
  MetadataValueState,
  ParsedPoseFrame,
  PoseFramePrimarySource,
  PoseFrameStatus,
  PoseLandmarkMetadata,
} from '../../pose/parsePoseFrame';
import type {
  PoseChainStatus,
  PoseJointReliability,
  PoseState,
  PoseStateFrameContext,
  PoseStateReliabilitySummary,
} from '../../pose/PoseState';
import type {
  ExerciseLabelFile,
  RepLabel,
} from '../dataset/types';
import type {
  LandmarkRecording,
  LandmarkRecordingFrame,
  LandmarkRecordingMetadataValueState,
  LandmarkRecordingPoseLandmarkMetadata,
  LandmarkRecordingSchemaVersion,
  LandmarkRecordingScoreSource,
} from './types';

export type RecordingReliabilityMetadataMode = 'v2RichMetadata' | 'legacyApproximate';

export interface RecordingReliabilityJointSummary {
  totalFrames: number;
  reliable: number;
  lowVisibility: number;
  lowPresence: number;
  missing: number;
  malformed: number;
  stale: number;
  outlierCandidate: number;
  unreliable: number;
  lowVisibilityReasonFrames: number;
  lowPresenceReasonFrames: number;
  visibilityUnknownFrames: number;
  presenceUnknownFrames: number;
  visibilityUnavailableFrames: number;
  presenceUnavailableFrames: number;
}

export interface RecordingReliabilityGapSummary {
  trackingInterruptedFrames: number;
  reacquisitionFrames: number;
  maxSilentGapMs: number | null;
  gapsOver1000Ms: number;
}

export interface LandmarkRecordingReliabilityReport {
  exerciseName: string;
  schemaVersion: LandmarkRecordingSchemaVersion | 'legacy';
  metadataMode: RecordingReliabilityMetadataMode;
  frameCount: number;
  poseStateSummary: PoseStateReliabilitySummary;
  jointSummaries: Record<string, RecordingReliabilityJointSummary>;
  focusJointSummaries: Record<string, RecordingReliabilityJointSummary>;
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>;
  gapSummary: RecordingReliabilityGapSummary;
  labelledRepReliability?: LabelledRepReliabilityReport;
}

export interface PoseStateFromRecordingFrameOptions extends PoseStateFrameContext {
  schemaVersion?: LandmarkRecordingSchemaVersion;
  previousPoseState?: PoseState | null;
  metadataMode?: RecordingReliabilityMetadataMode;
}

export interface LandmarkRecordingReliabilityOptions {
  label?: Pick<ExerciseLabelFile, 'exerciseName' | 'sourceVideo' | 'expectedReps' | 'reps'>;
}

export interface LabelledRepReliabilityLabelInfo {
  index: number;
  startMs: number;
  endMs: number;
  issueIds: string[];
  scorable?: boolean;
  expectedScoreRange?: [number, number];
  issueSeverities?: RepLabel['issueSeverities'];
  view?: RepLabel['view'];
}

export interface LabelledRepReliabilitySummary {
  label: LabelledRepReliabilityLabelInfo;
  frameCount: number;
  poseStateSummary: PoseStateReliabilitySummary;
  jointSummaries: Record<string, RecordingReliabilityJointSummary>;
  focusJointSummaries: Record<string, RecordingReliabilityJointSummary>;
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>;
  gapSummary: RecordingReliabilityGapSummary;
}

export interface LabelledRepReliabilityAggregateSummary {
  repCount: number;
  repsWithNoFrames: number;
  repsWithTrackingInterruption: number;
  repsWithMajorFocusJointLowConfidence: number;
  repsWithRelevantChainPartialOrUnreliable: number;
  topUnreliableJoints: Record<string, number>;
  averageChainStatusRates: Record<string, Record<PoseChainStatus, number>>;
}

export interface LabelledRepReliabilityReport {
  exerciseName: string;
  sourceVideo: string;
  expectedReps: number;
  repCount: number;
  aggregate: LabelledRepReliabilityAggregateSummary;
  reps: LabelledRepReliabilitySummary[];
}

const FOCUS_JOINTS = [
  'left_wrist',
  'right_wrist',
  'left_elbow',
  'right_elbow',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const;
const REPORT_CHAINS = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'torso', 'pushupBodyLine'] as const;
const MAJOR_LOW_CONFIDENCE_COVERAGE = 0.5;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function frameTimestampMs(frame: LandmarkRecordingFrame): number | undefined {
  return finiteNumber(frame.timestampMs) ?? finiteNumber(frame.timestamp) ?? undefined;
}

function frameStatus(frame: LandmarkRecordingFrame, keypoints: unknown[]): PoseFrameStatus {
  if (frame.status === 'trackingLost' || frame.status === 'noPose' || keypoints.length === 0) {
    return 'trackingLost';
  }
  return 'poseDetected';
}

function primarySourceForFrame(frame: LandmarkRecordingFrame): PoseFramePrimarySource {
  if (frame.primarySource === 'world' || frame.primarySource === 'image') {
    return frame.primarySource;
  }
  return Array.isArray(frame.worldKeypoints) && frame.worldKeypoints.length > 0 ? 'world' : 'image';
}

function primaryKeypointsForFrame(frame: LandmarkRecordingFrame, primarySource: PoseFramePrimarySource) {
  if (Array.isArray(frame.keypoints) && frame.keypoints.length > 0) return frame.keypoints;
  if (primarySource === 'world' && Array.isArray(frame.worldKeypoints)) return frame.worldKeypoints;
  if (primarySource === 'image' && Array.isArray(frame.imageKeypoints)) return frame.imageKeypoints;
  return [];
}

function keypointsByName(keypoints?: LandmarkRecordingFrame['keypoints']): Record<string, LandmarkRecordingFrame['keypoints'][number]> {
  if (!Array.isArray(keypoints)) return {};
  return Object.fromEntries(keypoints.map((keypoint) => [keypoint.name, keypoint]));
}

function metadataStateForPoseState(
  state: LandmarkRecordingMetadataValueState | undefined,
  field: 'visibility' | 'presence',
): MetadataValueState {
  if (state === 'present') return 'known';
  if (state === 'unavailable' && field === 'presence') return 'unavailable';
  return 'unknown';
}

function scoreSourceForPoseState(source: LandmarkRecordingScoreSource | undefined): KeypointScoreSource {
  if (source === 'visibility') return 'visibility';
  if (source === 'legacy') return 'legacyScore';
  return 'defaultVisibility';
}

function metadataForRecordingLandmark(
  metadata: LandmarkRecordingPoseLandmarkMetadata,
  index: number,
  keypoint: LandmarkRecordingFrame['keypoints'][number] | undefined,
): PoseLandmarkMetadata {
  const visibility = finiteNumber(metadata.visibility);
  const presence = finiteNumber(metadata.presence);
  const score = finiteNumber(keypoint?.score);
  const x = finiteNumber(keypoint?.x);
  const y = finiteNumber(keypoint?.y);
  const z = keypoint?.z === undefined ? null : finiteNumber(keypoint.z);
  const visibilityState = metadataStateForPoseState(metadata.visibilityState, 'visibility');
  const presenceState = metadataStateForPoseState(metadata.presenceState, 'presence');

  return {
    source: metadata.source,
    index,
    name: metadata.name,
    x,
    y,
    z,
    visibility,
    presence,
    visibilityState,
    presenceState,
    malformedFields: [...(metadata.malformedFields ?? [])],
    keypointScore:
      visibilityState === 'known' && visibility !== null
        ? visibility
        : score ?? 1.0,
    keypointScoreSource: scoreSourceForPoseState(metadata.scoreSource),
  };
}

function metadataForSource(
  metadata: LandmarkRecordingPoseLandmarkMetadata[] | undefined,
  keypoints: LandmarkRecordingFrame['keypoints'] | undefined,
): PoseLandmarkMetadata[] | undefined {
  if (!metadata) return undefined;
  const byName = keypointsByName(keypoints);
  return metadata.map((item, index) => metadataForRecordingLandmark(item, index, byName[item.name]));
}

function emptyDiagnostics(inputKind: ParsedPoseFrame['diagnostics']['inputKind'], status: PoseFrameStatus): ParsedPoseFrame['diagnostics'] {
  return {
    inputKind,
    status,
    warnings: status === 'trackingLost' ? ['tracking_lost'] : [],
    malformedLandmarkCount: 0,
    visibilityUnknownCount: 0,
    presenceUnknownCount: 0,
    sources: {},
  };
}

function parsedPoseFrameFromLegacyRecordingFrame(frame: LandmarkRecordingFrame): ParsedPoseFrame {
  const primarySource = primarySourceForFrame(frame);
  const keypoints = primaryKeypointsForFrame(frame, primarySource);
  const status = frameStatus(frame, keypoints);

  return {
    status,
    keypoints,
    ...(Array.isArray(frame.worldKeypoints) ? { worldKeypoints: frame.worldKeypoints } : {}),
    ...(Array.isArray(frame.imageKeypoints) ? { imageKeypoints: frame.imageKeypoints } : {}),
    primarySource,
    timestampMs: frameTimestampMs(frame),
    metadata: {
      status,
      inputKind: 'legacyKeypointArray',
    },
    diagnostics: emptyDiagnostics('legacyKeypointArray', status),
  };
}

export function parsedPoseFrameFromRecordingFrame(
  frame: LandmarkRecordingFrame,
  options: { schemaVersion?: LandmarkRecordingSchemaVersion; metadataMode?: RecordingReliabilityMetadataMode } = {},
): ParsedPoseFrame {
  const metadataMode = options.metadataMode
    ?? (options.schemaVersion === 2 && frame.poseMetadata ? 'v2RichMetadata' : 'legacyApproximate');
  if (metadataMode !== 'v2RichMetadata' || !frame.poseMetadata) {
    return parsedPoseFrameFromLegacyRecordingFrame(frame);
  }

  const primarySource = primarySourceForFrame(frame);
  const keypoints = primaryKeypointsForFrame(frame, primarySource);
  const status = frameStatus(frame, keypoints);
  const imageLandmarks = metadataForSource(frame.poseMetadata.imageLandmarks, frame.imageKeypoints);
  const worldLandmarks = metadataForSource(frame.poseMetadata.worldLandmarks, frame.worldKeypoints);

  return {
    status,
    keypoints,
    ...(Array.isArray(frame.worldKeypoints) ? { worldKeypoints: frame.worldKeypoints } : {}),
    ...(Array.isArray(frame.imageKeypoints) ? { imageKeypoints: frame.imageKeypoints } : {}),
    primarySource,
    timestampMs: frameTimestampMs(frame),
    metadata: {
      status,
      inputKind: 'nativeObject',
      imageLandmarks,
      worldLandmarks,
    },
    diagnostics: emptyDiagnostics('nativeObject', status),
  };
}

export function poseStateFromLandmarkRecordingFrame(
  frame: LandmarkRecordingFrame,
  options: PoseStateFromRecordingFrameOptions = {},
): PoseState {
  const parsed = parsedPoseFrameFromRecordingFrame(frame, options);
  return buildPoseState(parsed, options);
}

function recordingMetadataMode(recording: LandmarkRecording): RecordingReliabilityMetadataMode {
  return recording.schemaVersion === 2 && recording.frames.some((frame) => Boolean(frame.poseMetadata))
    ? 'v2RichMetadata'
    : 'legacyApproximate';
}

function emptyJointSummary(): RecordingReliabilityJointSummary {
  return {
    totalFrames: 0,
    reliable: 0,
    lowVisibility: 0,
    lowPresence: 0,
    missing: 0,
    malformed: 0,
    stale: 0,
    outlierCandidate: 0,
    unreliable: 0,
    lowVisibilityReasonFrames: 0,
    lowPresenceReasonFrames: 0,
    visibilityUnknownFrames: 0,
    presenceUnknownFrames: 0,
    visibilityUnavailableFrames: 0,
    presenceUnavailableFrames: 0,
  };
}

function jointSummaryFor(
  summaries: Record<string, RecordingReliabilityJointSummary>,
  jointName: string,
): RecordingReliabilityJointSummary {
  summaries[jointName] ??= emptyJointSummary();
  return summaries[jointName];
}

function primaryRecordingMetadata(frame: LandmarkRecordingFrame): LandmarkRecordingPoseLandmarkMetadata[] | undefined {
  if (frame.primarySource === 'world' && frame.poseMetadata?.worldLandmarks) {
    return frame.poseMetadata.worldLandmarks;
  }
  if (frame.primarySource === 'image' && frame.poseMetadata?.imageLandmarks) {
    return frame.poseMetadata.imageLandmarks;
  }
  return frame.poseMetadata?.worldLandmarks ?? frame.poseMetadata?.imageLandmarks;
}

function observeRecordingMetadata(
  summaries: Record<string, RecordingReliabilityJointSummary>,
  frame: LandmarkRecordingFrame,
): void {
  for (const metadata of primaryRecordingMetadata(frame) ?? []) {
    const summary = jointSummaryFor(summaries, metadata.name);
    if (metadata.visibilityState === 'unavailable') summary.visibilityUnavailableFrames++;
    if (metadata.presenceState === 'unavailable') summary.presenceUnavailableFrames++;
  }
}

function observePoseStateJoints(
  summaries: Record<string, RecordingReliabilityJointSummary>,
  poseState: PoseState,
): void {
  for (const joint of Object.values(poseState.joints)) {
    const summary = jointSummaryFor(summaries, joint.name);
    summary.totalFrames++;
    summary[joint.reliability]++;
    if (joint.reliability !== 'reliable') summary.unreliable++;
    if (joint.reasons.includes('low_visibility')) summary.lowVisibilityReasonFrames++;
    if (joint.reasons.includes('low_presence')) summary.lowPresenceReasonFrames++;
    if (joint.reasons.includes('visibility_unknown')) summary.visibilityUnknownFrames++;
    if (joint.reasons.includes('presence_unknown')) summary.presenceUnknownFrames++;
  }
}

function mergeFrameContext(
  frameContext: LandmarkRecordingFrame['frameContext'] | undefined,
  recomputedContext: PoseStateFrameContext,
): PoseStateFrameContext {
  if (!frameContext) return recomputedContext;
  return {
    ...recomputedContext,
    ...frameContext,
    trackingInterrupted: frameContext.trackingInterrupted === true,
  };
}

function observeGapSummary(summary: RecordingReliabilityGapSummary, frameContext: PoseStateFrameContext): void {
  if (frameContext.trackingInterrupted) summary.trackingInterruptedFrames++;
  if (frameContext.reacquisitionFrameIndex !== undefined) summary.reacquisitionFrames++;
  if (typeof frameContext.silentGapMs === 'number' && Number.isFinite(frameContext.silentGapMs)) {
    summary.maxSilentGapMs = Math.max(summary.maxSilentGapMs ?? frameContext.silentGapMs, frameContext.silentGapMs);
    if (frameContext.silentGapMs > 1000) summary.gapsOver1000Ms++;
  }
}

interface PoseStateReliabilitySample {
  timestampMs?: number;
  frame: LandmarkRecordingFrame;
  poseState: PoseState;
  frameContext: PoseStateFrameContext;
}

function summarizeSamples(samples: PoseStateReliabilitySample[]): {
  poseStateSummary: PoseStateReliabilitySummary;
  jointSummaries: Record<string, RecordingReliabilityJointSummary>;
  focusJointSummaries: Record<string, RecordingReliabilityJointSummary>;
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>;
  gapSummary: RecordingReliabilityGapSummary;
} {
  const aggregator = createPoseStateReliabilityAggregator();
  const jointSummaries: Record<string, RecordingReliabilityJointSummary> = {};
  const gapSummary: RecordingReliabilityGapSummary = {
    trackingInterruptedFrames: 0,
    reacquisitionFrames: 0,
    maxSilentGapMs: null,
    gapsOver1000Ms: 0,
  };

  for (const sample of samples) {
    aggregator.observe(sample.poseState);
    observePoseStateJoints(jointSummaries, sample.poseState);
    observeRecordingMetadata(jointSummaries, sample.frame);
    observeGapSummary(gapSummary, sample.frameContext);
  }

  for (const name of POSE_LANDMARK_NAMES) {
    jointSummaryFor(jointSummaries, name);
  }

  const poseStateSummary = aggregator.snapshot();
  const focusJointSummaries = Object.fromEntries(
    FOCUS_JOINTS.map((jointName) => [jointName, jointSummaryFor(jointSummaries, jointName)]),
  );

  return {
    poseStateSummary,
    jointSummaries,
    focusJointSummaries,
    chainStatusCounts: poseStateSummary.chainStatusCounts,
    gapSummary,
  };
}

function buildPoseStateSamples(recording: LandmarkRecording, metadataMode: RecordingReliabilityMetadataMode): PoseStateReliabilitySample[] {
  const gapTracker = createPoseFrameGapTracker();
  const samples: PoseStateReliabilitySample[] = [];
  let previousPoseState: PoseState | null = null;

  for (const frame of recording.frames) {
    const timestampMs = frameTimestampMs(frame);
    const recomputedFrameContext = gapTracker.observe(timestampMs);
    const frameContext = mergeFrameContext(frame.frameContext, recomputedFrameContext);
    const poseState = poseStateFromLandmarkRecordingFrame(frame, {
      schemaVersion: recording.schemaVersion,
      metadataMode,
      previousPoseState,
      ...frameContext,
    });
    samples.push({ timestampMs, frame, poseState, frameContext });
    previousPoseState = poseState;
  }

  return samples;
}

function labelInfo(rep: RepLabel): LabelledRepReliabilityLabelInfo {
  return {
    index: rep.index,
    startMs: rep.startMs,
    endMs: rep.endMs,
    issueIds: [...rep.issueIds],
    ...(rep.scorable !== undefined ? { scorable: rep.scorable } : {}),
    ...(rep.expectedScoreRange ? { expectedScoreRange: rep.expectedScoreRange } : {}),
    ...(rep.issueSeverities ? { issueSeverities: { ...rep.issueSeverities } } : {}),
    ...(rep.view ? { view: rep.view } : {}),
  };
}

function samplesInRepWindow(samples: PoseStateReliabilitySample[], rep: RepLabel): PoseStateReliabilitySample[] {
  return samples.filter((sample) => (
    sample.timestampMs !== undefined &&
    sample.timestampMs >= rep.startMs &&
    sample.timestampMs <= rep.endMs
  ));
}

function addCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [name, count] of Object.entries(source)) {
    target[name] = (target[name] ?? 0) + count;
  }
}

function hasMajorFocusJointLowConfidence(rep: LabelledRepReliabilitySummary): boolean {
  if (rep.frameCount === 0) return false;
  return Object.values(rep.focusJointSummaries).some((summary) => {
    const lowConfidenceFrames =
      summary.lowVisibilityReasonFrames +
      summary.lowPresenceReasonFrames +
      summary.visibilityUnknownFrames +
      summary.presenceUnknownFrames;
    return lowConfidenceFrames / rep.frameCount >= MAJOR_LOW_CONFIDENCE_COVERAGE;
  });
}

function hasRelevantChainPartialOrUnreliable(rep: LabelledRepReliabilitySummary): boolean {
  if (rep.frameCount === 0) return false;
  return REPORT_CHAINS.some((chainName) => {
    const counts = rep.chainStatusCounts[chainName] ?? { reliable: 0, partial: 0, unreliable: 0 };
    return (counts.partial + counts.unreliable) / rep.frameCount >= MAJOR_LOW_CONFIDENCE_COVERAGE;
  });
}

function chainRateAverage(
  reps: LabelledRepReliabilitySummary[],
): Record<string, Record<PoseChainStatus, number>> {
  const repsWithFrames = reps.filter((rep) => rep.frameCount > 0);
  const result: Record<string, Record<PoseChainStatus, number>> = {};

  for (const chainName of REPORT_CHAINS) {
    const totals: Record<PoseChainStatus, number> = { reliable: 0, partial: 0, unreliable: 0 };
    for (const rep of repsWithFrames) {
      const counts = rep.chainStatusCounts[chainName] ?? { reliable: 0, partial: 0, unreliable: 0 };
      totals.reliable += counts.reliable / rep.frameCount;
      totals.partial += counts.partial / rep.frameCount;
      totals.unreliable += counts.unreliable / rep.frameCount;
    }
    const denominator = Math.max(1, repsWithFrames.length);
    result[chainName] = {
      reliable: totals.reliable / denominator,
      partial: totals.partial / denominator,
      unreliable: totals.unreliable / denominator,
    };
  }

  return result;
}

function summarizeLabelledReps(
  label: Pick<ExerciseLabelFile, 'exerciseName' | 'sourceVideo' | 'expectedReps' | 'reps'>,
  samples: PoseStateReliabilitySample[],
): LabelledRepReliabilityReport {
  const reps = label.reps.map((rep): LabelledRepReliabilitySummary => {
    const repSamples = samplesInRepWindow(samples, rep);
    const summary = summarizeSamples(repSamples);
    return {
      label: labelInfo(rep),
      frameCount: repSamples.length,
      ...summary,
    };
  });

  const topUnreliableJoints: Record<string, number> = {};
  for (const rep of reps) {
    addCounts(topUnreliableJoints, Object.fromEntries(
      Object.entries(rep.jointSummaries).map(([name, summary]) => [name, summary.unreliable]),
    ));
  }

  return {
    exerciseName: label.exerciseName,
    sourceVideo: label.sourceVideo,
    expectedReps: label.expectedReps,
    repCount: label.reps.length,
    aggregate: {
      repCount: reps.length,
      repsWithNoFrames: reps.filter((rep) => rep.frameCount === 0).length,
      repsWithTrackingInterruption: reps.filter((rep) => rep.gapSummary.trackingInterruptedFrames > 0).length,
      repsWithMajorFocusJointLowConfidence: reps.filter(hasMajorFocusJointLowConfidence).length,
      repsWithRelevantChainPartialOrUnreliable: reps.filter(hasRelevantChainPartialOrUnreliable).length,
      topUnreliableJoints,
      averageChainStatusRates: chainRateAverage(reps),
    },
    reps,
  };
}

export function summarizeLandmarkRecordingReliability(
  recording: LandmarkRecording,
  options: LandmarkRecordingReliabilityOptions = {},
): LandmarkRecordingReliabilityReport {
  const metadataMode = recordingMetadataMode(recording);
  const samples = buildPoseStateSamples(recording, metadataMode);
  const recordingSummary = summarizeSamples(samples);

  return {
    exerciseName: recording.exerciseName,
    schemaVersion: recording.schemaVersion ?? 'legacy',
    metadataMode,
    frameCount: recording.frames.length,
    ...recordingSummary,
    ...(options.label ? { labelledRepReliability: summarizeLabelledReps(options.label, samples) } : {}),
  };
}

function topJointCounts(
  jointSummaries: Record<string, RecordingReliabilityJointSummary>,
  field: keyof RecordingReliabilityJointSummary,
  limit = 5,
): string {
  const entries = Object.entries(jointSummaries)
    .map(([name, summary]) => [name, summary[field]] as const)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return entries.length > 0 ? entries.map(([name, count]) => `${name}:${count}`).join(',') : 'none';
}

function formatChainCounts(
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>,
  chains: string[],
): string {
  return chains
    .map((chainName) => {
      const counts = chainStatusCounts[chainName] ?? { reliable: 0, partial: 0, unreliable: 0 };
      return `${chainName}=reliable:${counts.reliable}/partial:${counts.partial}/unreliable:${counts.unreliable}`;
    })
    .join(' ');
}

function formatFocusJoint(summary: RecordingReliabilityJointSummary): string {
  return [
    `unreliable=${summary.unreliable}`,
    `lowVis=${summary.lowVisibilityReasonFrames}`,
    `lowPres=${summary.lowPresenceReasonFrames}`,
    `visUnknown=${summary.visibilityUnknownFrames}`,
    `presUnknown=${summary.presenceUnknownFrames}`,
    `missing=${summary.missing}`,
    `malformed=${summary.malformed}`,
    `outlier=${summary.outlierCandidate}`,
    `visUnavailable=${summary.visibilityUnavailableFrames}`,
    `presUnavailable=${summary.presenceUnavailableFrames}`,
  ].join('/');
}

function formatFocusJointsFromSummaries(
  jointSummaries: Record<string, RecordingReliabilityJointSummary>,
  jointNames: readonly string[],
): string {
  return jointNames
    .map((jointName) => `${jointName}:${formatFocusJoint(jointSummaries[jointName] ?? emptyJointSummary())}`)
    .join(' ');
}

function formatFocusJoints(report: LandmarkRecordingReliabilityReport, jointNames: readonly string[]): string {
  return formatFocusJointsFromSummaries(report.jointSummaries, jointNames);
}

function formatIssueIds(issueIds: string[]): string {
  return issueIds.length > 0 ? issueIds.join(',') : 'none';
}

function formatOptionalLabelField(value: unknown): string {
  if (value === undefined) return 'unset';
  if (Array.isArray(value)) return `[${value.join(',')}]`;
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function formatAverageChainRates(rates: Record<string, Record<PoseChainStatus, number>>): string {
  return REPORT_CHAINS
    .map((chainName) => {
      const chainRates = rates[chainName] ?? { reliable: 0, partial: 0, unreliable: 0 };
      return `${chainName}=reliable:${chainRates.reliable.toFixed(2)}/partial:${chainRates.partial.toFixed(2)}/unreliable:${chainRates.unreliable.toFixed(2)}`;
    })
    .join(' ');
}

function formatLabelledRepReliability(report: LabelledRepReliabilityReport): string[] {
  const lines = [
    `[LabelledRepReliability] reps=${report.repCount} expectedReps=${report.expectedReps} noFrameWindows=${report.aggregate.repsWithNoFrames} repsWithTrackingInterrupted=${report.aggregate.repsWithTrackingInterruption} repsWithMajorFocusLowConfidence=${report.aggregate.repsWithMajorFocusJointLowConfidence} repsWithPartialOrUnreliableChains=${report.aggregate.repsWithRelevantChainPartialOrUnreliable}`,
    `[LabelledRepReliability] aggregateTopUnreliable=${topJointCounts(Object.fromEntries(
      Object.entries(report.aggregate.topUnreliableJoints).map(([name, unreliable]) => [name, { ...emptyJointSummary(), unreliable }]),
    ), 'unreliable')} averageChains ${formatAverageChainRates(report.aggregate.averageChainStatusRates)}`,
  ];

  for (const rep of report.reps) {
    const status = rep.poseStateSummary.statusCounts;
    lines.push(
      `[LabelledRepReliability] rep=${rep.label.index} window=${rep.label.startMs}-${rep.label.endMs}ms frames=${rep.frameCount} tracked=${status.tracked} partial=${status.partial} lost=${status.lost} view=${formatOptionalLabelField(rep.label.view)} scorable=${formatOptionalLabelField(rep.label.scorable)} issues=${formatIssueIds(rep.label.issueIds)} expectedScoreRange=${formatOptionalLabelField(rep.label.expectedScoreRange)} issueSeverities=${formatOptionalLabelField(rep.label.issueSeverities)} trackingInterrupted=${rep.gapSummary.trackingInterruptedFrames} reacquisitionFrames=${rep.gapSummary.reacquisitionFrames} topUnreliable=${topJointCounts(rep.jointSummaries, 'unreliable', 3)}`,
    );
    lines.push(
      `[LabelledRepReliability] rep=${rep.label.index} chains arms ${formatChainCounts(rep.chainStatusCounts, ['leftArm', 'rightArm'])} legs ${formatChainCounts(rep.chainStatusCounts, ['leftLeg', 'rightLeg'])} torso ${formatChainCounts(rep.chainStatusCounts, ['torso', 'pushupBodyLine'])}`,
    );
    lines.push(
      `[LabelledRepReliability] rep=${rep.label.index} focus wrists ${formatFocusJointsFromSummaries(rep.jointSummaries, ['left_wrist', 'right_wrist'])} elbows ${formatFocusJointsFromSummaries(rep.jointSummaries, ['left_elbow', 'right_elbow'])} knees ${formatFocusJointsFromSummaries(rep.jointSummaries, ['left_knee', 'right_knee'])} ankles ${formatFocusJointsFromSummaries(rep.jointSummaries, ['left_ankle', 'right_ankle'])}`,
    );
  }

  return lines;
}

export function formatLandmarkRecordingReliabilityReport(
  report: LandmarkRecordingReliabilityReport,
  filePath?: string,
): string {
  const status = report.poseStateSummary.statusCounts;
  const reliability = report.poseStateSummary.reliabilityCounts;
  const lines = [
    `[ReliabilityReport] file=${filePath ?? 'unknown'} exercise="${report.exerciseName}" schemaVersion=${report.schemaVersion} mode=${report.metadataMode} frames=${report.frameCount} tracked=${status.tracked} partial=${status.partial} lost=${status.lost}`,
    `[ReliabilityReport] reliability reliable=${reliability.reliable} lowVisibility=${reliability.lowVisibility} lowPresence=${reliability.lowPresence} missing=${reliability.missing} malformed=${reliability.malformed} stale=${reliability.stale} outlierCandidate=${reliability.outlierCandidate}`,
    `[ReliabilityReport] top unreliable=${topJointCounts(report.jointSummaries, 'unreliable')} lowVisibility=${topJointCounts(report.jointSummaries, 'lowVisibilityReasonFrames')} lowPresence=${topJointCounts(report.jointSummaries, 'lowPresenceReasonFrames')} missing=${topJointCounts(report.jointSummaries, 'missing')} malformed=${topJointCounts(report.jointSummaries, 'malformed')} outlier=${topJointCounts(report.jointSummaries, 'outlierCandidate')}`,
    `[ReliabilityReport] chains arms ${formatChainCounts(report.chainStatusCounts, ['leftArm', 'rightArm'])}`,
    `[ReliabilityReport] chains legs ${formatChainCounts(report.chainStatusCounts, ['leftLeg', 'rightLeg'])} torso ${formatChainCounts(report.chainStatusCounts, ['torso', 'pushupBodyLine'])}`,
    `[ReliabilityReport] focus wrists ${formatFocusJoints(report, ['left_wrist', 'right_wrist'])}`,
    `[ReliabilityReport] focus elbows ${formatFocusJoints(report, ['left_elbow', 'right_elbow'])}`,
    `[ReliabilityReport] focus knees ${formatFocusJoints(report, ['left_knee', 'right_knee'])}`,
    `[ReliabilityReport] focus ankles ${formatFocusJoints(report, ['left_ankle', 'right_ankle'])}`,
    `[ReliabilityReport] tracking trackingInterrupted=${report.gapSummary.trackingInterruptedFrames} reacquisitionFrames=${report.gapSummary.reacquisitionFrames} maxSilentGapMs=${report.gapSummary.maxSilentGapMs ?? 'none'} gapsOver1000Ms=${report.gapSummary.gapsOver1000Ms}`,
  ];
  if (report.labelledRepReliability) {
    lines.push(...formatLabelledRepReliability(report.labelledRepReliability));
  }
  return lines.join('\n');
}
