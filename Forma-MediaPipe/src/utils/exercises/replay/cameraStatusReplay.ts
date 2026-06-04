import { createPoseFrameGapTracker, type PoseFrameGapMetadata } from '../../pose/frameGapTracker';
import type { PoseState } from '../../pose/PoseState';
import {
  evaluateValidHumanSubject,
  ValidHumanSubjectTracker,
  type ValidHumanSubjectTrackingResult,
} from '../../pose/validHumanSubject';
import {
  CAMERA_ANALYSIS_STATUS_PRIORITY,
  cameraLiveFeedbackReadinessStatus,
  cameraStatusFromCompletedRepReadiness,
  cameraStatusFromPoseStateReadiness,
  createCameraLiveFeedbackReadinessState,
  createRecentCompletedRepCameraStatusState,
  recentCompletedRepCameraStatus,
  resolveCameraAnalysisStatus,
  selectLiveFeedbackReadinessSample,
  shouldIncludeRecentCompletedRepCameraStatus,
  updateCameraLiveFeedbackReadinessState,
  updateRecentCompletedRepCameraStatusState,
  type CameraAnalysisFeedbackMode,
  type CameraAnalysisStatus,
  type CameraAnalysisStatusCategory,
} from '../shared/cameraAnalysisStatus';
import {
  buildDisplayedPoseQuality,
  getPoseFramingDiagnostics,
  PoseQualityTracker,
  resolveExerciseQualityProfile,
  type PoseFramingDiagnostics,
  type PoseQualitySnapshot,
  type PoseQualityWarning,
} from '../shared/poseQuality';
import type {
  ExerciseDefinition,
  ExerciseFrameContext,
} from '../types';
import { poseStateFromLandmarkRecordingFrame } from './reliabilityReport';
import type {
  LandmarkRecording,
  LandmarkRecordingFrame,
  LandmarkRecordingFrameStatus,
  ReplayOptions,
} from './types';

const TOP_PILL_WARNING_STABLE_FRAMES = 3;
const TOP_PILL_WARNING_HOLD_MS = 1000;
const VALID_SUBJECT_INVALID_FRAME_THRESHOLD = 12;
const POSE_FRAME_GAP_INTERRUPTION_THRESHOLD_MS = 1000;
const DEFAULT_SYNTHETIC_GAP_FRAME_INTERVAL_MS = 33;
const DEFAULT_MAX_SYNTHETIC_FRAMES_PER_GAP = 900;
const DEFAULT_FLICKER_WINDOW_MS = 1000;
const DEFAULT_MAX_SUMMARY_ITEMS = 10;

const CAMERA_STATUS_CATEGORIES: CameraAnalysisStatusCategory[] = [
  'tracking',
  'framing',
  'exerciseSetup',
  'view',
  'feedbackAvailability',
  'occlusion',
  'countOnly',
];

const FEEDBACK_MODES: CameraAnalysisFeedbackMode[] = [
  'full',
  'limited',
  'countOnly',
  'unavailable',
];

export type CameraStatusTimeByCategory = Record<CameraAnalysisStatusCategory | 'none', number>;
export type CameraStatusTimeByFeedbackMode = Record<CameraAnalysisFeedbackMode | 'unspecified', number>;

export interface CameraStatusReplayOptions extends ReplayOptions {
  /**
   * Diagnostic-only samples inserted into long timestamp gaps. These samples are
   * never passed into ExerciseDefinition.update(), so rep counting and scoring
   * stay isolated from this reporting path.
   */
  synthesizeSilentGapFrames?: boolean;
  syntheticGapFrameIntervalMs?: number;
  syntheticGapThresholdMs?: number;
  maxSyntheticFramesPerGap?: number;
  flickerWindowMs?: number;
  includeFrames?: boolean;
  maxSummaryItems?: number;
  smoothing?: {
    stableFrames?: number;
    holdMs?: number;
  };
}

export interface CameraStatusTimelineEntry {
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  key: string;
  status: CameraAnalysisStatus | null;
}

export interface CameraStatusMessageSummary {
  message: string;
  count: number;
  durationMs: number;
  category?: CameraAnalysisStatusCategory;
  level?: CameraAnalysisStatus['level'];
  source?: CameraAnalysisStatus['source'];
  reason?: string;
  feedbackMode?: CameraAnalysisFeedbackMode;
}

export interface CameraStatusTransitionSummary {
  from: string;
  to: string;
  count: number;
}

export interface CameraStatusMetricStats {
  min: number | null;
  mean: number | null;
  max: number | null;
}

export interface CameraStatusBodySizeSummary {
  bodyBoxMaxDimension: CameraStatusMetricStats;
  bodyBoxArea: CameraStatusMetricStats;
  moveCloserThreshold: number;
  moveBackWidthThreshold: number;
  moveBackHeightThreshold: number;
}

export interface CameraStatusSilentGapReport {
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  synthesizedFrameCount: number;
  statusBeforeGap: CameraAnalysisStatus | null;
  firstStatusChangeMs?: number;
  staleStatusDurationMs: number;
  trackingLostAppeared: boolean;
  trackingLostAtMs?: number;
  trackingLostLatencyMs?: number;
  recoveryAtMs?: number;
  recoveryLatencyMs?: number;
  statusAfterRecovery?: CameraAnalysisStatus | null;
}

export interface CameraStatusReplayFrameTrace {
  sampleIndex: number;
  recordingFrameIndex?: number;
  timestampMs: number;
  synthetic: boolean;
  silentGapId?: number;
  inputStatus: LandmarkRecordingFrameStatus | 'poseDetected';
  keypointCount: number;
  selectedStatus: CameraAnalysisStatus | null;
  selectedStatusKey: string;
  poseQualityStatus: PoseQualitySnapshot['status'];
  poseQualityWarnings: PoseQualityWarning[];
  displayedPoseQualityStatus: PoseQualitySnapshot['status'];
  displayedPoseQualityWarnings: PoseQualityWarning[];
  rawExerciseWarnings: PoseQualityWarning[];
  stableExerciseWarnings: PoseQualityWarning[];
  rawExerciseStatus: CameraAnalysisStatus | null;
  stableExerciseStatus: CameraAnalysisStatus | null;
  liveFeedbackReadinessStatus: CameraAnalysisStatus | null;
  recentCompletedRepStatus: CameraAnalysisStatus | null;
  framing: PoseFramingDiagnostics;
  validSubject: Pick<
    ValidHumanSubjectTrackingResult,
    | 'valid'
    | 'reason'
    | 'sustainedInvalid'
    | 'invalidFrameCount'
    | 'validFrameCount'
    | 'reacquisitionFrameCount'
    | 'presentMajorJoints'
  >;
  frameGap: PoseFrameGapMetadata;
}

export interface CameraStatusReplayReport {
  exerciseName: string;
  schemaVersion: LandmarkRecording['schemaVersion'] | 'legacy';
  frameCount: number;
  processedFrameCount: number;
  poseDetectedFrameCount: number;
  noPoseFrameCount: number;
  syntheticNoPoseFrameCount: number;
  totalDurationMs: number;
  statusChanges: number;
  flickerCount: number;
  longestStaleStatusDurationMs: number;
  timeByCategory: CameraStatusTimeByCategory;
  timeByFeedbackMode: CameraStatusTimeByFeedbackMode;
  topMessages: CameraStatusMessageSummary[];
  topTransitions: CameraStatusTransitionSummary[];
  silentGaps: CameraStatusSilentGapReport[];
  trackingLostLatenciesMs: number[];
  recoveryLatenciesMs: number[];
  bodySize: CameraStatusBodySizeSummary;
  timeline: CameraStatusTimelineEntry[];
  frames?: CameraStatusReplayFrameTrace[];
  thresholds: {
    topPillWarningStableFrames: number;
    topPillWarningHoldMs: number;
    validSubjectInvalidFrameThreshold: number;
    poseFrameGapInterruptionThresholdMs: number;
    syntheticGapThresholdMs: number;
    syntheticGapFrameIntervalMs: number;
    maxSyntheticFramesPerGap: number;
  };
}

interface ReplaySample {
  sampleIndex: number;
  recordingFrameIndex?: number;
  timestampMs: number;
  frame: LandmarkRecordingFrame;
  synthetic: boolean;
  silentGapId?: number;
  diagnosticInterruptedGapMs?: number;
}

interface SilentGapBuildInfo {
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  synthesizedFrameCount: number;
}

interface BuildSamplesResult {
  samples: ReplaySample[];
  gaps: SilentGapBuildInfo[];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function frameTimestampMs(frame: LandmarkRecordingFrame): number {
  return finiteNumber(frame.timestampMs) ?? finiteNumber(frame.timestamp) ?? 0;
}

function statusKey(status: CameraAnalysisStatus | null | undefined): string {
  if (!status) return 'none';
  return [
    status.level,
    status.category,
    status.message,
    status.details?.feedbackMode ?? '',
  ].join('|');
}

function displayMessage(status: CameraAnalysisStatus | null): string {
  return status?.message ?? 'No status';
}

function mergeTrackingWarnings(
  baseWarnings: PoseQualityWarning[],
  exerciseWarnings: PoseQualityWarning[] = [],
): PoseQualityWarning[] {
  return Array.from(new Set([...baseWarnings, ...exerciseWarnings]));
}

function isNoPoseSample(frame: LandmarkRecordingFrame): boolean {
  return frame.status === 'noPose' || frame.status === 'trackingLost' || frame.keypoints.length === 0;
}

function primarySourceForFrame(frame: LandmarkRecordingFrame): 'world' | 'image' {
  if (frame.primarySource === 'world' || frame.primarySource === 'image') return frame.primarySource;
  return Array.isArray(frame.worldKeypoints) && frame.worldKeypoints.length > 0 ? 'world' : 'image';
}

function frameContextForReplay(
  frame: LandmarkRecordingFrame,
  timestampMs: number,
  frameGap: PoseFrameGapMetadata,
  poseState: PoseState,
): ExerciseFrameContext {
  const primarySource = primarySourceForFrame(frame);
  const hasExplicitImage = Array.isArray(frame.imageKeypoints) && frame.imageKeypoints.length > 0;
  const hasExplicitWorld = Array.isArray(frame.worldKeypoints) && frame.worldKeypoints.length > 0;

  return {
    worldKeypoints: hasExplicitWorld ? frame.worldKeypoints : primarySource === 'world' ? frame.keypoints : undefined,
    imageKeypoints: hasExplicitImage ? frame.imageKeypoints : primarySource === 'image' ? frame.keypoints : undefined,
    primarySource,
    timestampMs,
    ...frameGap,
    poseState,
  };
}

function cameraStatusFromValidSubject(subject: ValidHumanSubjectTrackingResult): CameraAnalysisStatus | null {
  if (!subject.sustainedInvalid) return null;
  return {
    level: 'error',
    category: 'tracking',
    message: 'Tracking was lost.',
    priority: CAMERA_ANALYSIS_STATUS_PRIORITY.TRACKING_LOST,
    source: 'poseState',
    reason: `invalid_subject_${subject.reason ?? 'unknown'}`,
    details: {
      feedbackMode: 'unavailable',
      usableChains: subject.usableChains,
      weakChains: subject.weakChains,
    },
  };
}

function resolveDefinition(definition: ExerciseDefinition, options?: CameraStatusReplayOptions): ExerciseDefinition {
  const config = options?.heuristicConfig;
  if (!config || Object.keys(config).length === 0) return definition;
  if (!definition.createVariant) {
    throw new Error(
      `Exercise "${definition.name}" does not expose createVariant(); cannot replay a candidate heuristic config.`,
    );
  }
  return definition.createVariant(config);
}

function syntheticNoPoseFrame(timestampMs: number): LandmarkRecordingFrame {
  return {
    timestamp: timestampMs,
    timestampMs,
    status: 'trackingLost',
    keypoints: [],
    imageKeypoints: [],
    primarySource: 'image',
  };
}

function buildReplaySamples(
  recording: LandmarkRecording,
  options: Required<Pick<
    CameraStatusReplayOptions,
    'synthesizeSilentGapFrames' | 'syntheticGapFrameIntervalMs' | 'syntheticGapThresholdMs' | 'maxSyntheticFramesPerGap'
  >>,
): BuildSamplesResult {
  const recordedFrames = recording.frames
    .map((frame, recordingFrameIndex) => ({
      frame,
      recordingFrameIndex,
      timestampMs: frameTimestampMs(frame),
    }))
    .filter((item) => Number.isFinite(item.timestampMs))
    .sort((a, b) => a.timestampMs - b.timestampMs || a.recordingFrameIndex - b.recordingFrameIndex);

  const samples: ReplaySample[] = [];
  const gaps: SilentGapBuildInfo[] = [];
  let previous: { timestampMs: number; recordingFrameIndex: number } | null = null;

  for (const item of recordedFrames) {
    if (previous && options.synthesizeSilentGapFrames) {
      const gapDurationMs = item.timestampMs - previous.timestampMs;
      if (gapDurationMs > options.syntheticGapThresholdMs) {
        const gap: SilentGapBuildInfo = {
          index: gaps.length,
          startMs: previous.timestampMs,
          endMs: item.timestampMs,
          durationMs: gapDurationMs,
          synthesizedFrameCount: 0,
        };
        gaps.push(gap);

        const firstSyntheticTimestamp = previous.timestampMs + options.syntheticGapFrameIntervalMs;
        let syntheticTimestamp = firstSyntheticTimestamp;
        while (
          syntheticTimestamp < item.timestampMs &&
          gap.synthesizedFrameCount < options.maxSyntheticFramesPerGap
        ) {
          samples.push({
            sampleIndex: samples.length,
            timestampMs: syntheticTimestamp,
            frame: syntheticNoPoseFrame(syntheticTimestamp),
            synthetic: true,
            silentGapId: gap.index,
            diagnosticInterruptedGapMs: gap.synthesizedFrameCount === 0 ? gapDurationMs : undefined,
          });
          gap.synthesizedFrameCount += 1;
          syntheticTimestamp += options.syntheticGapFrameIntervalMs;
        }
      }
    }

    samples.push({
      sampleIndex: samples.length,
      recordingFrameIndex: item.recordingFrameIndex,
      timestampMs: item.timestampMs,
      frame: item.frame,
      synthetic: false,
    });
    previous = item;
  }

  return { samples, gaps };
}

function isTrackingLostStatus(status: CameraAnalysisStatus | null): boolean {
  return Boolean(
    status &&
    status.category === 'tracking' &&
    (
      status.level === 'error' ||
      status.reason === 'tracking_lost' ||
      status.reason?.startsWith('invalid_subject_') ||
      status.details?.feedbackMode === 'unavailable'
    ),
  );
}

function emptyTimeByCategory(): CameraStatusTimeByCategory {
  const result = Object.fromEntries(CAMERA_STATUS_CATEGORIES.map((category) => [category, 0])) as CameraStatusTimeByCategory;
  result.none = 0;
  return result;
}

function emptyTimeByFeedbackMode(): CameraStatusTimeByFeedbackMode {
  const result = Object.fromEntries(FEEDBACK_MODES.map((mode) => [mode, 0])) as CameraStatusTimeByFeedbackMode;
  result.unspecified = 0;
  return result;
}

function buildTimeline(frames: CameraStatusReplayFrameTrace[], totalDurationMs: number): CameraStatusTimelineEntry[] {
  if (frames.length === 0) return [];
  const timeline: CameraStatusTimelineEntry[] = [];

  for (const frame of frames) {
    const previous = timeline[timeline.length - 1];
    if (previous && previous.key === frame.selectedStatusKey) {
      continue;
    }
    const startMs = frame.timestampMs;
    if (previous) {
      previous.endMs = Math.max(previous.startMs, startMs);
      previous.durationMs = previous.endMs - previous.startMs;
    }
    timeline.push({
      index: timeline.length,
      startMs,
      endMs: startMs,
      durationMs: 0,
      key: frame.selectedStatusKey,
      status: frame.selectedStatus,
    });
  }

  const last = timeline[timeline.length - 1];
  const lastFrameTimestamp = frames[frames.length - 1].timestampMs;
  last.endMs = Math.max(last.startMs, Math.max(totalDurationMs, lastFrameTimestamp));
  last.durationMs = last.endMs - last.startMs;
  return timeline;
}

function timelineEntryAt(timeline: CameraStatusTimelineEntry[], timestampMs: number): CameraStatusTimelineEntry | null {
  return timeline.find((entry) => entry.startMs <= timestampMs && timestampMs < entry.endMs)
    ?? timeline.find((entry) => entry.startMs <= timestampMs && entry.endMs === entry.startMs)
    ?? timeline[timeline.length - 1]
    ?? null;
}

function summarizeSilentGaps(
  gaps: SilentGapBuildInfo[],
  timeline: CameraStatusTimelineEntry[],
): CameraStatusSilentGapReport[] {
  return gaps.map((gap) => {
    const before = timelineEntryAt(timeline, gap.startMs);
    const beforeKey = before?.key ?? 'none';
    const firstChange = timeline.find((entry) => (
      entry.startMs >= gap.startMs &&
      entry.startMs <= gap.endMs &&
      entry.key !== beforeKey
    ));
    const trackingLostEntry = timeline.find((entry) => (
      entry.endMs >= gap.startMs &&
      entry.startMs <= gap.endMs &&
      isTrackingLostStatus(entry.status)
    ));
    const recoveryEntry = trackingLostEntry
      ? timeline.find((entry) => (
        entry.startMs >= gap.endMs &&
        !isTrackingLostStatus(entry.status)
      ))
      : undefined;
    const staleStatusDurationMs = firstChange
      ? Math.max(0, firstChange.startMs - gap.startMs)
      : gap.durationMs;
    const trackingLostAtMs = trackingLostEntry
      ? Math.max(gap.startMs, trackingLostEntry.startMs)
      : undefined;
    const recoveryAtMs = recoveryEntry?.startMs;

    return {
      ...gap,
      statusBeforeGap: before?.status ?? null,
      ...(firstChange ? { firstStatusChangeMs: firstChange.startMs } : {}),
      staleStatusDurationMs,
      trackingLostAppeared: Boolean(trackingLostEntry),
      ...(trackingLostAtMs !== undefined ? {
        trackingLostAtMs,
        trackingLostLatencyMs: trackingLostAtMs - gap.startMs,
      } : {}),
      ...(recoveryAtMs !== undefined ? {
        recoveryAtMs,
        recoveryLatencyMs: recoveryAtMs - gap.endMs,
        statusAfterRecovery: recoveryEntry?.status ?? null,
      } : {}),
    };
  });
}

function summarizeTimeByCategory(timeline: CameraStatusTimelineEntry[]): CameraStatusTimeByCategory {
  const result = emptyTimeByCategory();
  for (const entry of timeline) {
    const category = entry.status?.category ?? 'none';
    result[category] += entry.durationMs;
  }
  return result;
}

function summarizeTimeByFeedbackMode(timeline: CameraStatusTimelineEntry[]): CameraStatusTimeByFeedbackMode {
  const result = emptyTimeByFeedbackMode();
  for (const entry of timeline) {
    const mode = entry.status?.details?.feedbackMode ?? 'unspecified';
    result[mode] += entry.durationMs;
  }
  return result;
}

function summarizeMessages(timeline: CameraStatusTimelineEntry[], maxItems: number): CameraStatusMessageSummary[] {
  const summaries = new Map<string, CameraStatusMessageSummary>();
  for (const entry of timeline) {
    const message = displayMessage(entry.status);
    const existing = summaries.get(message) ?? {
      message,
      count: 0,
      durationMs: 0,
      category: entry.status?.category,
      level: entry.status?.level,
      source: entry.status?.source,
      reason: entry.status?.reason,
      feedbackMode: entry.status?.details?.feedbackMode,
    };
    existing.count += 1;
    existing.durationMs += entry.durationMs;
    summaries.set(message, existing);
  }
  return Array.from(summaries.values())
    .sort((a, b) => b.count - a.count || b.durationMs - a.durationMs || a.message.localeCompare(b.message))
    .slice(0, maxItems);
}

function summarizeTransitions(timeline: CameraStatusTimelineEntry[], maxItems: number): CameraStatusTransitionSummary[] {
  const counts = new Map<string, CameraStatusTransitionSummary>();
  for (let index = 1; index < timeline.length; index += 1) {
    const from = displayMessage(timeline[index - 1].status);
    const to = displayMessage(timeline[index].status);
    const key = `${from} -> ${to}`;
    const existing = counts.get(key) ?? { from, to, count: 0 };
    existing.count += 1;
    counts.set(key, existing);
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
    .slice(0, maxItems);
}

function summarizeMetric(values: Array<number | null | undefined>): CameraStatusMetricStats {
  const finiteValues = values.filter((value): value is number => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return { min: null, mean: null, max: null };
  }
  const sum = finiteValues.reduce((total, value) => total + value, 0);
  return {
    min: Math.min(...finiteValues),
    mean: sum / finiteValues.length,
    max: Math.max(...finiteValues),
  };
}

function summarizeBodySize(frames: CameraStatusReplayFrameTrace[]): CameraStatusBodySizeSummary {
  const firstFraming = frames.find((frame) => frame.framing)?.framing;
  return {
    bodyBoxMaxDimension: summarizeMetric(frames.map((frame) => frame.framing.bodyBoxMaxDimension)),
    bodyBoxArea: summarizeMetric(frames.map((frame) => frame.framing.bodyBoxArea)),
    moveCloserThreshold: firstFraming?.moveCloserThreshold ?? 0,
    moveBackWidthThreshold: firstFraming?.moveBackWidthThreshold ?? 0,
    moveBackHeightThreshold: firstFraming?.moveBackHeightThreshold ?? 0,
  };
}

function countFlickers(timeline: CameraStatusTimelineEntry[], flickerWindowMs: number): number {
  let flickers = 0;
  for (let index = 2; index < timeline.length; index += 1) {
    const first = timeline[index - 2];
    const middle = timeline[index - 1];
    const current = timeline[index];
    if (
      first.key === current.key &&
      first.key !== middle.key &&
      current.startMs - first.startMs <= flickerWindowMs
    ) {
      flickers += 1;
    }
  }
  return flickers;
}

function makeFrameTrace(args: {
  sample: ReplaySample;
  frameGap: PoseFrameGapMetadata;
  selectedStatus: CameraAnalysisStatus | null;
  quality: PoseQualitySnapshot;
  displayedQuality: PoseQualitySnapshot;
  rawExerciseWarnings: PoseQualityWarning[];
  stableTopPillWarnings: PoseQualityWarning[];
  rawExerciseStatus: CameraAnalysisStatus | null;
  stableExerciseStatus: CameraAnalysisStatus | null;
  liveFeedbackReadinessStatus: CameraAnalysisStatus | null;
  recentCompletedRepStatus: CameraAnalysisStatus | null;
  framing: PoseFramingDiagnostics;
  validSubject: ValidHumanSubjectTrackingResult;
}): CameraStatusReplayFrameTrace {
  const inputStatus: LandmarkRecordingFrameStatus | 'poseDetected' = args.sample.frame.status ?? (
    args.sample.frame.keypoints.length > 0 ? 'poseDetected' : 'trackingLost'
  );
  const selectedStatusKey = statusKey(args.selectedStatus);
  return {
    sampleIndex: args.sample.sampleIndex,
    ...(args.sample.recordingFrameIndex !== undefined ? { recordingFrameIndex: args.sample.recordingFrameIndex } : {}),
    timestampMs: args.sample.timestampMs,
    synthetic: args.sample.synthetic,
    ...(args.sample.silentGapId !== undefined ? { silentGapId: args.sample.silentGapId } : {}),
    inputStatus,
    keypointCount: args.sample.frame.keypoints.length,
    selectedStatus: args.selectedStatus,
    selectedStatusKey,
    poseQualityStatus: args.quality.status,
    poseQualityWarnings: args.quality.warnings,
    displayedPoseQualityStatus: args.displayedQuality.status,
    displayedPoseQualityWarnings: args.displayedQuality.warnings,
    rawExerciseWarnings: args.rawExerciseWarnings,
    stableExerciseWarnings: args.stableTopPillWarnings,
    rawExerciseStatus: args.rawExerciseStatus,
    stableExerciseStatus: args.stableExerciseStatus,
    liveFeedbackReadinessStatus: args.liveFeedbackReadinessStatus,
    recentCompletedRepStatus: args.recentCompletedRepStatus,
    framing: args.framing,
    validSubject: {
      valid: args.validSubject.valid,
      reason: args.validSubject.reason,
      sustainedInvalid: args.validSubject.sustainedInvalid,
      invalidFrameCount: args.validSubject.invalidFrameCount,
      validFrameCount: args.validSubject.validFrameCount,
      reacquisitionFrameCount: args.validSubject.reacquisitionFrameCount,
      presentMajorJoints: args.validSubject.presentMajorJoints,
    },
    frameGap: args.frameGap,
  };
}

export function replayCameraAnalysisStatus(
  definition: ExerciseDefinition,
  recording: LandmarkRecording,
  options: CameraStatusReplayOptions = {},
): CameraStatusReplayReport {
  const activeDefinition = resolveDefinition(definition, options);
  const qualityProfile = resolveExerciseQualityProfile(activeDefinition);
  const synthesizeSilentGapFrames = options.synthesizeSilentGapFrames ?? true;
  const syntheticGapFrameIntervalMs = options.syntheticGapFrameIntervalMs ?? DEFAULT_SYNTHETIC_GAP_FRAME_INTERVAL_MS;
  const syntheticGapThresholdMs = options.syntheticGapThresholdMs ?? POSE_FRAME_GAP_INTERRUPTION_THRESHOLD_MS;
  const maxSyntheticFramesPerGap = options.maxSyntheticFramesPerGap ?? DEFAULT_MAX_SYNTHETIC_FRAMES_PER_GAP;
  const stableFrames = options.smoothing?.stableFrames ?? TOP_PILL_WARNING_STABLE_FRAMES;
  const holdMs = options.smoothing?.holdMs ?? TOP_PILL_WARNING_HOLD_MS;
  const maxSummaryItems = options.maxSummaryItems ?? DEFAULT_MAX_SUMMARY_ITEMS;
  const { samples, gaps } = buildReplaySamples(recording, {
    synthesizeSilentGapFrames,
    syntheticGapFrameIntervalMs,
    syntheticGapThresholdMs,
    maxSyntheticFramesPerGap,
  });

  let state = activeDefinition.createState();
  const qualityTracker = new PoseQualityTracker();
  const validHumanSubjectTracker = new ValidHumanSubjectTracker({
    invalidFrameThreshold: VALID_SUBJECT_INVALID_FRAME_THRESHOLD,
  });
  const frameGapTracker = createPoseFrameGapTracker();
  const warningSmoothing: Partial<Record<PoseQualityWarning, number>> = {};
  let warningHold: { warnings: PoseQualityWarning[]; updatedAt: number } = { warnings: [], updatedAt: 0 };
  let statusSmoothing: { key: string; count: number } = { key: 'none', count: 0 };
  let statusHold: { status: CameraAnalysisStatus | null; updatedAt: number } = { status: null, updatedAt: 0 };
  let liveFeedbackReadiness = createCameraLiveFeedbackReadinessState();
  let recentCompletedRepStatusState = createRecentCompletedRepCameraStatusState();
  let previousPoseState: PoseState | null = null;
  let completedRepCount = state.repCount;
  const frames: CameraStatusReplayFrameTrace[] = [];
  const originalDateNow = Date.now;

  try {
    for (const sample of samples) {
      Date.now = () => sample.timestampMs;
      const observedFrameGap = frameGapTracker.observe(sample.timestampMs);
      const frameGap: PoseFrameGapMetadata = sample.diagnosticInterruptedGapMs === undefined
        ? observedFrameGap
        : {
          ...observedFrameGap,
          silentGapMs: sample.diagnosticInterruptedGapMs,
          trackingInterrupted: true,
          reacquisitionFrameIndex: 0,
        };
      const poseState = poseStateFromLandmarkRecordingFrame(sample.frame, {
        schemaVersion: recording.schemaVersion,
        previousPoseState,
        ...frameGap,
      });
      previousPoseState = poseState;
      const frameContext = frameContextForReplay(sample.frame, sample.timestampMs, frameGap, poseState);
      const imageKeypoints = frameContext.imageKeypoints ?? [];
      const validSubject = validHumanSubjectTracker.update(
        evaluateValidHumanSubject({ poseState, imageKeypoints }),
      );
      const validSubjectStatus = cameraStatusFromValidSubject(validSubject);
      const quality = qualityTracker.update(sample.frame.keypoints, qualityProfile, {
        frameBoundsKeypoints: imageKeypoints,
      });
      const framing = getPoseFramingDiagnostics(
        imageKeypoints.length > 0 ? imageKeypoints : sample.frame.keypoints,
        qualityProfile,
      );

      const processExerciseFrame = !isNoPoseSample(sample.frame);
      let completedNewTrackedRep = false;
      let rawExerciseWarnings: PoseQualityWarning[] = [];
      let rawExerciseStatus: CameraAnalysisStatus | null = null;
      if (processExerciseFrame) {
        state = activeDefinition.update(sample.frame.keypoints, state, frameContext);
        state.quality = quality;
        completedNewTrackedRep = state.repCount > completedRepCount;
        rawExerciseWarnings = mergeTrackingWarnings(state.liveQualityWarnings ?? []);
        rawExerciseStatus = state.liveAnalysisStatus ?? null;
        if (completedNewTrackedRep) {
          rawExerciseWarnings = mergeTrackingWarnings(
            rawExerciseWarnings,
            state.lastRepResult?.qualityWarnings ?? [],
          );
          completedRepCount = state.repCount;
        }
      }

      const liveWarningSet = new Set(rawExerciseWarnings);
      const stableLiveWarnings = rawExerciseWarnings.filter((warning) => {
        const count = (warningSmoothing[warning] ?? 0) + 1;
        warningSmoothing[warning] = Math.min(count, stableFrames);
        return count >= stableFrames;
      });
      for (const warning of Object.keys(warningSmoothing) as PoseQualityWarning[]) {
        if (!liveWarningSet.has(warning)) {
          delete warningSmoothing[warning];
        }
      }

      let stableTopPillWarnings = stableLiveWarnings;
      if (stableLiveWarnings.length > 0) {
        warningHold = { warnings: stableLiveWarnings, updatedAt: sample.timestampMs };
      } else if (
        warningHold.warnings.length > 0 &&
        sample.timestampMs - warningHold.updatedAt <= holdMs
      ) {
        stableTopPillWarnings = warningHold.warnings;
      } else {
        warningHold = { warnings: [], updatedAt: 0 };
      }

      let stableExerciseStatus: CameraAnalysisStatus | null = null;
      const rawExerciseStatusKey = statusKey(rawExerciseStatus);
      if (rawExerciseStatus) {
        if (statusSmoothing.key === rawExerciseStatusKey) {
          statusSmoothing.count = Math.min(statusSmoothing.count + 1, stableFrames);
        } else {
          statusSmoothing = { key: rawExerciseStatusKey, count: 1 };
        }
        if (statusSmoothing.count >= stableFrames) {
          stableExerciseStatus = rawExerciseStatus;
        }
      } else {
        statusSmoothing = { key: 'none', count: 0 };
      }

      if (stableExerciseStatus) {
        statusHold = { status: stableExerciseStatus, updatedAt: sample.timestampMs };
      } else if (
        statusHold.status &&
        sample.timestampMs - statusHold.updatedAt <= holdMs
      ) {
        stableExerciseStatus = statusHold.status;
      } else {
        statusHold = { status: null, updatedAt: 0 };
      }

      const poseStateReadinessStatus = cameraStatusFromPoseStateReadiness({
        exerciseName: activeDefinition.name,
        poseState,
      });
      const currentLiveReadinessSample = selectLiveFeedbackReadinessSample({
        exerciseStatus: completedNewTrackedRep ? null : rawExerciseStatus,
        poseStateReadinessStatus,
      });
      liveFeedbackReadiness = updateCameraLiveFeedbackReadinessState(liveFeedbackReadiness, {
        nowMs: sample.timestampMs,
        sampleStatus: currentLiveReadinessSample,
      });
      const liveFeedbackReadinessStatus = cameraLiveFeedbackReadinessStatus(
        liveFeedbackReadiness,
        sample.timestampMs,
      );
      const completedRepReadinessStatus = completedNewTrackedRep
        ? cameraStatusFromCompletedRepReadiness({ repResult: state.lastRepResult })
        : null;
      recentCompletedRepStatusState = updateRecentCompletedRepCameraStatusState(
        recentCompletedRepStatusState,
        {
          nowMs: sample.timestampMs,
          completedRepStatus: completedRepReadinessStatus,
          currentReadinessStatus: liveFeedbackReadinessStatus,
        },
      );
      const recentCompletedRepStatus = recentCompletedRepCameraStatus(
        recentCompletedRepStatusState,
        sample.timestampMs,
      );
      const recentCompletedRepResolverStatus = shouldIncludeRecentCompletedRepCameraStatus({
        recentStatus: recentCompletedRepStatus,
        liveFeedbackReadinessStatus,
      })
        ? recentCompletedRepStatus
        : null;
      const exerciseStatusForResolver = liveFeedbackReadinessStatus ? null : stableExerciseStatus;

      const displayedQuality = buildDisplayedPoseQuality(quality, stableTopPillWarnings);
      const resolution = resolveCameraAnalysisStatus({
        poseQuality: quality,
        exerciseWarnings: stableTopPillWarnings,
        exerciseStatus: exerciseStatusForResolver,
        poseStateStatus: validSubjectStatus,
        additionalStatuses: [liveFeedbackReadinessStatus, recentCompletedRepResolverStatus],
      });

      frames.push(makeFrameTrace({
        sample,
        frameGap,
        selectedStatus: resolution.selected,
        quality,
        displayedQuality,
        rawExerciseWarnings,
        stableTopPillWarnings,
        rawExerciseStatus,
        stableExerciseStatus,
        liveFeedbackReadinessStatus,
        recentCompletedRepStatus,
        framing,
        validSubject,
      }));
    }
  } finally {
    Date.now = originalDateNow;
  }

  const recordedTimestamps = recording.frames.map(frameTimestampMs);
  const firstTimestamp = recordedTimestamps.length > 0 ? Math.min(...recordedTimestamps) : 0;
  const lastTimestamp = recordedTimestamps.length > 0 ? Math.max(...recordedTimestamps) : 0;
  const observedDurationMs = Math.max(0, lastTimestamp - firstTimestamp);
  const totalDurationMs = Math.max(observedDurationMs, finiteNumber(recording.metadata.duration) ?? 0);
  const timeline = buildTimeline(frames, totalDurationMs);
  const bodySize = summarizeBodySize(frames);
  const silentGaps = summarizeSilentGaps(gaps, timeline);
  const longestStaleStatusDurationMs = silentGaps.reduce(
    (max, gap) => Math.max(max, gap.staleStatusDurationMs),
    0,
  );
  const noPoseFrameCount = recording.frames.filter(isNoPoseSample).length;
  const syntheticNoPoseFrameCount = frames.filter((frame) => frame.synthetic).length;

  return {
    exerciseName: activeDefinition.name,
    schemaVersion: recording.schemaVersion ?? 'legacy',
    frameCount: recording.frames.length,
    processedFrameCount: frames.length,
    poseDetectedFrameCount: recording.frames.length - noPoseFrameCount,
    noPoseFrameCount,
    syntheticNoPoseFrameCount,
    totalDurationMs,
    statusChanges: Math.max(0, timeline.length - 1),
    flickerCount: countFlickers(timeline, options.flickerWindowMs ?? DEFAULT_FLICKER_WINDOW_MS),
    longestStaleStatusDurationMs,
    timeByCategory: summarizeTimeByCategory(timeline),
    timeByFeedbackMode: summarizeTimeByFeedbackMode(timeline),
    topMessages: summarizeMessages(timeline, maxSummaryItems),
    topTransitions: summarizeTransitions(timeline, maxSummaryItems),
    silentGaps,
    trackingLostLatenciesMs: silentGaps
      .map((gap) => gap.trackingLostLatencyMs)
      .filter((value): value is number => value !== undefined),
    recoveryLatenciesMs: silentGaps
      .map((gap) => gap.recoveryLatencyMs)
      .filter((value): value is number => value !== undefined),
    bodySize,
    timeline,
    ...(options.includeFrames ? { frames } : {}),
    thresholds: {
      topPillWarningStableFrames: stableFrames,
      topPillWarningHoldMs: holdMs,
      validSubjectInvalidFrameThreshold: VALID_SUBJECT_INVALID_FRAME_THRESHOLD,
      poseFrameGapInterruptionThresholdMs: POSE_FRAME_GAP_INTERRUPTION_THRESHOLD_MS,
      syntheticGapThresholdMs,
      syntheticGapFrameIntervalMs,
      maxSyntheticFramesPerGap,
    },
  };
}

function formatMs(value: number | undefined): string {
  if (value === undefined) return 'n/a';
  return `${Math.round(value)}ms`;
}

function formatTimeMap(values: Record<string, number>): string {
  return Object.entries(values)
    .filter(([, durationMs]) => durationMs > 0)
    .map(([key, durationMs]) => `${key}=${formatMs(durationMs)}`)
    .join(', ') || 'none';
}

function formatMetricStats(stats: CameraStatusMetricStats): string {
  const format = (value: number | null) => value === null ? 'n/a' : value.toFixed(3);
  return `min=${format(stats.min)}, mean=${format(stats.mean)}, max=${format(stats.max)}`;
}

export function formatCameraStatusReplayReport(
  report: CameraStatusReplayReport,
  label = report.exerciseName,
): string {
  const gapLines = report.silentGaps.length === 0
    ? ['Silent gaps: none detected above threshold']
    : [
      `Silent gaps: ${report.silentGaps.length}`,
      ...report.silentGaps.slice(0, DEFAULT_MAX_SUMMARY_ITEMS).map((gap) => [
        `  #${gap.index + 1}`,
        `${formatMs(gap.durationMs)} gap`,
        `${gap.synthesizedFrameCount} diagnostic no-pose frame(s)`,
        `stale=${formatMs(gap.staleStatusDurationMs)}`,
        `trackingLost=${gap.trackingLostAppeared ? formatMs(gap.trackingLostLatencyMs) : 'no'}`,
        `recovery=${formatMs(gap.recoveryLatencyMs)}`,
      ].join(' | ')),
    ];

  const topMessageLines = report.topMessages.length === 0
    ? ['Top messages: none']
    : [
      'Top messages:',
      ...report.topMessages.map((item) => (
        `  ${item.message} (${item.count} window(s), ${formatMs(item.durationMs)})`
      )),
    ];

  return [
    `Camera analysis status replay: ${label}`,
    `Exercise: ${report.exerciseName}`,
    `Frames: recorded=${report.frameCount}, processed=${report.processedFrameCount}, poseDetected=${report.poseDetectedFrameCount}, noPose=${report.noPoseFrameCount}, syntheticNoPose=${report.syntheticNoPoseFrameCount}`,
    `Duration: ${formatMs(report.totalDurationMs)}`,
    `Status changes: ${report.statusChanges}; flicker count: ${report.flickerCount}; longest stale gap status: ${formatMs(report.longestStaleStatusDurationMs)}`,
    `Time by category: ${formatTimeMap(report.timeByCategory)}`,
    `Time by feedback mode: ${formatTimeMap(report.timeByFeedbackMode)}`,
    `Body box max dimension: ${formatMetricStats(report.bodySize.bodyBoxMaxDimension)}; moveCloserThreshold=${report.bodySize.moveCloserThreshold}`,
    `Body box area: ${formatMetricStats(report.bodySize.bodyBoxArea)}; moveBackWidthThreshold=${report.bodySize.moveBackWidthThreshold}; moveBackHeightThreshold=${report.bodySize.moveBackHeightThreshold}`,
    ...gapLines,
    ...topMessageLines,
  ].join('\n');
}
