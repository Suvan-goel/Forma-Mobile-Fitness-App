import type {
  ParsedPoseFrame,
  PoseFrameInputKind,
  PoseFramePrimarySource,
  PoseFrameStatus,
  PoseLandmarkMetadata,
} from './parsePoseFrame';

export interface PoseParserSourceAvailability {
  presentFrames: number;
  missingFrames: number;
  totalLandmarks: number;
  malformedLandmarks: number;
  visibilityUnknownLandmarks: number;
  presenceUnknownLandmarks: number;
}

export interface PoseParserLastFrameSummary {
  status: PoseFrameStatus;
  primarySource: PoseFramePrimarySource;
  timestampMs?: number;
  warnings: string[];
  imageLandmarksPresent: boolean;
  worldLandmarksPresent: boolean;
}

export type PoseParserLowValueBucket = 'lt015' | 'lt020' | 'lt035' | 'lt050';

export type PoseParserLowValueCounts = Record<PoseParserLowValueBucket, Record<string, number>>;

export type PoseParserStatsSource = 'allSources' | 'primarySource' | 'image' | 'world';

export interface PoseParserValueStats {
  sampleCount: number;
  min: number;
  max: number;
  mean: number;
}

export interface PoseParserJointValueSummary {
  lowVisibilityByJoint: PoseParserLowValueCounts;
  lowPresenceByJoint: PoseParserLowValueCounts;
  visibilityStatsByJoint: Record<string, PoseParserValueStats>;
  presenceStatsByJoint: Record<string, PoseParserValueStats>;
}

export type PoseParserJointStatsBySource = Record<PoseParserStatsSource, PoseParserJointValueSummary>;

export interface PoseParserTimestampGapSummary {
  firstTimestampMs?: number;
  lastTimestampMs?: number;
  totalDurationMs: number;
  intervalCount: number;
  minFrameIntervalMs?: number;
  meanFrameIntervalMs?: number;
  maxFrameIntervalMs?: number;
  gapsOver250Ms: number;
  gapsOver500Ms: number;
  gapsOver1000Ms: number;
  gapsOver2000Ms: number;
  possibleSilentTrackingLossCount: number;
  reacquisitionFrameCount: number;
}

export interface PoseParserDiagnosticsRepSummary {
  totalReps: number;
  completedRepCount: number;
  analyzerRepCount: number;
  uiRepCount: number;
  scoredRepCount?: number;
  unscoredRepCount?: number;
}

export interface PoseParserDiagnosticsSummary {
  totalFrames: number;
  poseDetectedFrames: number;
  trackingLostFrames: number;
  framesWithMissingVisibility: number;
  framesWithMissingPresence: number;
  framesWithMalformedLandmarks: number;
  unknownVisibilityByJoint: Record<string, number>;
  missingPresenceByJoint: Record<string, number>;
  malformedLandmarksByJoint: Record<string, number>;
  lowVisibilityByJoint: PoseParserLowValueCounts;
  lowPresenceByJoint: PoseParserLowValueCounts;
  visibilityStatsByJoint: Record<string, PoseParserValueStats>;
  presenceStatsByJoint: Record<string, PoseParserValueStats>;
  jointStatsBySource: PoseParserJointStatsBySource;
  timestampGaps: PoseParserTimestampGapSummary;
  worldLandmarks: PoseParserSourceAvailability;
  imageLandmarks: PoseParserSourceAvailability;
  primarySourceCounts: Record<PoseFramePrimarySource, number>;
  inputKindCounts: Partial<Record<PoseFrameInputKind, number>>;
  warningCounts: Record<string, number>;
  lastFrame?: PoseParserLastFrameSummary;
}

interface PoseParserMutableValueStats {
  sampleCount: number;
  min: number;
  max: number;
  sum: number;
}

interface PoseParserMutableJointValueSummary {
  lowVisibilityByJoint: PoseParserLowValueCounts;
  lowPresenceByJoint: PoseParserLowValueCounts;
  visibilityStatsByJoint: Record<string, PoseParserMutableValueStats>;
  presenceStatsByJoint: Record<string, PoseParserMutableValueStats>;
}

const LOW_VALUE_THRESHOLDS: Array<{
  bucket: PoseParserLowValueBucket;
  threshold: number;
  label: string;
}> = [
  { bucket: 'lt015', threshold: 0.15, label: '<0.15' },
  { bucket: 'lt020', threshold: 0.20, label: '<0.20' },
  { bucket: 'lt035', threshold: 0.35, label: '<0.35' },
  { bucket: 'lt050', threshold: 0.50, label: '<0.50' },
];

const LEFT_WRIST = 'left_wrist';
const RIGHT_WRIST = 'right_wrist';
const SILENT_TRACKING_LOSS_GAP_MS = 1000;
const REACQUISITION_FRAMES_AFTER_GAP = 5;

function emptySourceAvailability(): PoseParserSourceAvailability {
  return {
    presentFrames: 0,
    missingFrames: 0,
    totalLandmarks: 0,
    malformedLandmarks: 0,
    visibilityUnknownLandmarks: 0,
    presenceUnknownLandmarks: 0,
  };
}

function emptyLowValueCounts(): PoseParserLowValueCounts {
  return {
    lt015: {},
    lt020: {},
    lt035: {},
    lt050: {},
  };
}

function emptyValueSummary(): PoseParserJointValueSummary {
  return {
    lowVisibilityByJoint: emptyLowValueCounts(),
    lowPresenceByJoint: emptyLowValueCounts(),
    visibilityStatsByJoint: {},
    presenceStatsByJoint: {},
  };
}

function emptyJointStatsBySource(): PoseParserJointStatsBySource {
  return {
    allSources: emptyValueSummary(),
    primarySource: emptyValueSummary(),
    image: emptyValueSummary(),
    world: emptyValueSummary(),
  };
}

function emptyTimestampGaps(): PoseParserTimestampGapSummary {
  return {
    totalDurationMs: 0,
    intervalCount: 0,
    gapsOver250Ms: 0,
    gapsOver500Ms: 0,
    gapsOver1000Ms: 0,
    gapsOver2000Ms: 0,
    possibleSilentTrackingLossCount: 0,
    reacquisitionFrameCount: 0,
  };
}

function emptySummary(): PoseParserDiagnosticsSummary {
  return {
    totalFrames: 0,
    poseDetectedFrames: 0,
    trackingLostFrames: 0,
    framesWithMissingVisibility: 0,
    framesWithMissingPresence: 0,
    framesWithMalformedLandmarks: 0,
    unknownVisibilityByJoint: {},
    missingPresenceByJoint: {},
    malformedLandmarksByJoint: {},
    lowVisibilityByJoint: emptyLowValueCounts(),
    lowPresenceByJoint: emptyLowValueCounts(),
    visibilityStatsByJoint: {},
    presenceStatsByJoint: {},
    jointStatsBySource: emptyJointStatsBySource(),
    timestampGaps: emptyTimestampGaps(),
    worldLandmarks: emptySourceAvailability(),
    imageLandmarks: emptySourceAvailability(),
    primarySourceCounts: { image: 0, world: 0 },
    inputKindCounts: {},
    warningCounts: {},
  };
}

function increment<K extends string>(map: Partial<Record<K, number>>, key: K, amount = 1): void {
  map[key] = (map[key] ?? 0) + amount;
}

function cloneRecord(record: Record<string, number>): Record<string, number> {
  return { ...record };
}

function cloneLowValueCounts(counts: PoseParserLowValueCounts): PoseParserLowValueCounts {
  return {
    lt015: cloneRecord(counts.lt015),
    lt020: cloneRecord(counts.lt020),
    lt035: cloneRecord(counts.lt035),
    lt050: cloneRecord(counts.lt050),
  };
}

function cloneValueStats(
  statsByJoint: Record<string, PoseParserMutableValueStats>,
): Record<string, PoseParserValueStats> {
  return Object.fromEntries(
    Object.entries(statsByJoint).map(([joint, stats]) => [
      joint,
      {
        sampleCount: stats.sampleCount,
        min: stats.min,
        max: stats.max,
        mean: stats.sum / stats.sampleCount,
      },
    ]),
  );
}

function cloneJointValueSummary(
  summary: {
    lowVisibilityByJoint: PoseParserLowValueCounts;
    lowPresenceByJoint: PoseParserLowValueCounts;
  },
  visibilityStatsByJoint: Record<string, PoseParserMutableValueStats>,
  presenceStatsByJoint: Record<string, PoseParserMutableValueStats>,
): PoseParserJointValueSummary {
  return {
    lowVisibilityByJoint: cloneLowValueCounts(summary.lowVisibilityByJoint),
    lowPresenceByJoint: cloneLowValueCounts(summary.lowPresenceByJoint),
    visibilityStatsByJoint: cloneValueStats(visibilityStatsByJoint),
    presenceStatsByJoint: cloneValueStats(presenceStatsByJoint),
  };
}

function emptyMutableJointValueSummary(): PoseParserMutableJointValueSummary {
  return {
    lowVisibilityByJoint: emptyLowValueCounts(),
    lowPresenceByJoint: emptyLowValueCounts(),
    visibilityStatsByJoint: {},
    presenceStatsByJoint: {},
  };
}

function emptyMutableStatsBySource(): Record<Exclude<PoseParserStatsSource, 'allSources'>, PoseParserMutableJointValueSummary> {
  return {
    primarySource: emptyMutableJointValueSummary(),
    image: emptyMutableJointValueSummary(),
    world: emptyMutableJointValueSummary(),
  };
}

function cloneStatsBySource(
  summary: PoseParserDiagnosticsSummary,
  allSourcesVisibilityStatsByJoint: Record<string, PoseParserMutableValueStats>,
  allSourcesPresenceStatsByJoint: Record<string, PoseParserMutableValueStats>,
  statsBySource: Record<Exclude<PoseParserStatsSource, 'allSources'>, PoseParserMutableJointValueSummary>,
): PoseParserJointStatsBySource {
  return {
    allSources: cloneJointValueSummary(
      summary,
      allSourcesVisibilityStatsByJoint,
      allSourcesPresenceStatsByJoint,
    ),
    primarySource: cloneJointValueSummary(
      statsBySource.primarySource,
      statsBySource.primarySource.visibilityStatsByJoint,
      statsBySource.primarySource.presenceStatsByJoint,
    ),
    image: cloneJointValueSummary(
      statsBySource.image,
      statsBySource.image.visibilityStatsByJoint,
      statsBySource.image.presenceStatsByJoint,
    ),
    world: cloneJointValueSummary(
      statsBySource.world,
      statsBySource.world.visibilityStatsByJoint,
      statsBySource.world.presenceStatsByJoint,
    ),
  };
}

function cloneSource(source: PoseParserSourceAvailability): PoseParserSourceAvailability {
  return { ...source };
}

function cloneTimestampGaps(timestampGaps: PoseParserTimestampGapSummary): PoseParserTimestampGapSummary {
  return { ...timestampGaps };
}

function cloneSummary(
  summary: PoseParserDiagnosticsSummary,
  visibilityStatsByJoint: Record<string, PoseParserMutableValueStats>,
  presenceStatsByJoint: Record<string, PoseParserMutableValueStats>,
  statsBySource: Record<Exclude<PoseParserStatsSource, 'allSources'>, PoseParserMutableJointValueSummary>,
): PoseParserDiagnosticsSummary {
  const jointStatsBySource = cloneStatsBySource(
    summary,
    visibilityStatsByJoint,
    presenceStatsByJoint,
    statsBySource,
  );

  return {
    ...summary,
    unknownVisibilityByJoint: cloneRecord(summary.unknownVisibilityByJoint),
    missingPresenceByJoint: cloneRecord(summary.missingPresenceByJoint),
    malformedLandmarksByJoint: cloneRecord(summary.malformedLandmarksByJoint),
    lowVisibilityByJoint: cloneLowValueCounts(summary.lowVisibilityByJoint),
    lowPresenceByJoint: cloneLowValueCounts(summary.lowPresenceByJoint),
    visibilityStatsByJoint: cloneValueStats(visibilityStatsByJoint),
    presenceStatsByJoint: cloneValueStats(presenceStatsByJoint),
    jointStatsBySource,
    timestampGaps: cloneTimestampGaps(summary.timestampGaps),
    worldLandmarks: cloneSource(summary.worldLandmarks),
    imageLandmarks: cloneSource(summary.imageLandmarks),
    primarySourceCounts: { ...summary.primarySourceCounts },
    inputKindCounts: { ...summary.inputKindCounts },
    warningCounts: cloneRecord(summary.warningCounts),
    lastFrame: summary.lastFrame
      ? {
          ...summary.lastFrame,
          warnings: [...summary.lastFrame.warnings],
        }
      : undefined,
  };
}

function observeSource(
  source: PoseParserSourceAvailability,
  landmarks: PoseLandmarkMetadata[] | undefined,
): boolean {
  const present = Boolean(landmarks && landmarks.length > 0);
  if (present) {
    source.presentFrames += 1;
  } else {
    source.missingFrames += 1;
  }

  if (!landmarks) return false;

  source.totalLandmarks += landmarks.length;
  for (const landmark of landmarks) {
    if (landmark.malformedFields.length > 0) source.malformedLandmarks += 1;
    if (landmark.visibilityState !== 'known') source.visibilityUnknownLandmarks += 1;
    if (landmark.presenceState !== 'known') source.presenceUnknownLandmarks += 1;
  }

  return present;
}

function observeKnownValue(
  statsByJoint: Record<string, PoseParserMutableValueStats>,
  lowCountsByJoint: PoseParserLowValueCounts,
  jointName: string,
  value: number,
): void {
  const stats = statsByJoint[jointName] ?? {
    sampleCount: 0,
    min: value,
    max: value,
    sum: 0,
  };

  stats.sampleCount += 1;
  stats.min = Math.min(stats.min, value);
  stats.max = Math.max(stats.max, value);
  stats.sum += value;
  statsByJoint[jointName] = stats;

  for (const { bucket, threshold } of LOW_VALUE_THRESHOLDS) {
    if (value < threshold) {
      increment(lowCountsByJoint[bucket], jointName);
    }
  }
}

function observeJointCounts(
  summary: PoseParserDiagnosticsSummary,
  visibilityStatsByJoint: Record<string, PoseParserMutableValueStats>,
  presenceStatsByJoint: Record<string, PoseParserMutableValueStats>,
  landmarks: PoseLandmarkMetadata[] | undefined,
): void {
  if (!landmarks) return;

  for (const landmark of landmarks) {
    if (landmark.visibilityState !== 'known') {
      increment(summary.unknownVisibilityByJoint, landmark.name);
    }
    if (landmark.presenceState !== 'known') {
      increment(summary.missingPresenceByJoint, landmark.name);
    }
    if (landmark.malformedFields.length > 0) {
      increment(summary.malformedLandmarksByJoint, landmark.name);
    }
    if (landmark.visibilityState === 'known' && landmark.visibility !== null) {
      observeKnownValue(
        visibilityStatsByJoint,
        summary.lowVisibilityByJoint,
        landmark.name,
        landmark.visibility,
      );
    }
    if (landmark.presenceState === 'known' && landmark.presence !== null) {
      observeKnownValue(
        presenceStatsByJoint,
        summary.lowPresenceByJoint,
        landmark.name,
        landmark.presence,
      );
    }
  }
}

function observeJointValues(
  summary: PoseParserMutableJointValueSummary,
  landmarks: PoseLandmarkMetadata[] | undefined,
): void {
  if (!landmarks) return;

  for (const landmark of landmarks) {
    if (landmark.visibilityState === 'known' && landmark.visibility !== null) {
      observeKnownValue(
        summary.visibilityStatsByJoint,
        summary.lowVisibilityByJoint,
        landmark.name,
        landmark.visibility,
      );
    }
    if (landmark.presenceState === 'known' && landmark.presence !== null) {
      observeKnownValue(
        summary.presenceStatsByJoint,
        summary.lowPresenceByJoint,
        landmark.name,
        landmark.presence,
      );
    }
  }
}

function primarySourceLandmarks(frame: ParsedPoseFrame): PoseLandmarkMetadata[] | undefined {
  return frame.primarySource === 'world'
    ? frame.metadata.worldLandmarks
    : frame.metadata.imageLandmarks;
}

function topCounts(counts: Record<string, number>, limit = 5): string {
  const entries = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);
  return entries.length > 0
    ? entries.map(([name, count]) => `${name}:${count}`).join(', ')
    : 'none';
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}

function formatMs(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${Math.round(value)}ms`;
}

function lowestMeanStats(statsByJoint: Record<string, PoseParserValueStats>, limit = 5): string {
  const entries = Object.entries(statsByJoint)
    .sort(([, a], [, b]) => a.mean - b.mean)
    .slice(0, limit);

  return entries.length > 0
    ? entries
        .map(([name, stats]) => `${name}:${formatNumber(stats.mean)}(n=${stats.sampleCount})`)
        .join(', ')
    : 'none';
}

function formatJointStats(
  statsByJoint: Record<string, PoseParserValueStats>,
  jointName: string,
): string {
  const stats = statsByJoint[jointName];
  if (!stats) return `${jointName}=n/a`;

  return [
    `${jointName}=n=${stats.sampleCount}`,
    `min=${formatNumber(stats.min)}`,
    `mean=${formatNumber(stats.mean)}`,
    `max=${formatNumber(stats.max)}`,
  ].join(' ');
}

function formatSourceTopStats(label: string, summary: PoseParserJointValueSummary): string[] {
  return [
    `[PoseParserDiagnostics] ${label} visibility lowestMean top=${lowestMeanStats(summary.visibilityStatsByJoint)}`,
    `[PoseParserDiagnostics] ${label} visibility${LOW_VALUE_THRESHOLDS[1].label} top=${topCounts(summary.lowVisibilityByJoint.lt020)} ${label} visibility${LOW_VALUE_THRESHOLDS[2].label} top=${topCounts(summary.lowVisibilityByJoint.lt035)}`,
    `[PoseParserDiagnostics] ${label} presence lowestMean top=${lowestMeanStats(summary.presenceStatsByJoint)}`,
    `[PoseParserDiagnostics] ${label} presence${LOW_VALUE_THRESHOLDS[2].label} top=${topCounts(summary.lowPresenceByJoint.lt035)}`,
  ];
}

function formatSourceWristStats(label: string, summary: PoseParserJointValueSummary): string[] {
  return [
    `[PoseParserDiagnostics] ${label} wrists visibility ${formatJointStats(summary.visibilityStatsByJoint, LEFT_WRIST)} ${formatJointStats(summary.visibilityStatsByJoint, RIGHT_WRIST)}`,
    `[PoseParserDiagnostics] ${label} wrists presence ${formatJointStats(summary.presenceStatsByJoint, LEFT_WRIST)} ${formatJointStats(summary.presenceStatsByJoint, RIGHT_WRIST)}`,
  ];
}

function formatTimestampGaps(summary: PoseParserTimestampGapSummary): string[] {
  return [
    `[PoseParserDiagnostics] timestampGaps duration=${formatMs(summary.totalDurationMs)} intervals=${summary.intervalCount} min=${formatMs(summary.minFrameIntervalMs)} mean=${formatMs(summary.meanFrameIntervalMs)} max=${formatMs(summary.maxFrameIntervalMs)}`,
    `[PoseParserDiagnostics] timestampGaps gaps>250ms=${summary.gapsOver250Ms} gaps>500ms=${summary.gapsOver500Ms} gaps>1000ms=${summary.gapsOver1000Ms} gaps>2000ms=${summary.gapsOver2000Ms} possibleSilentTrackingLoss=${summary.possibleSilentTrackingLossCount} reacquisitionFrames=${summary.reacquisitionFrameCount}`,
  ];
}

function formatRepSummary(summary: PoseParserDiagnosticsRepSummary): string {
  const scored = summary.scoredRepCount === undefined ? 'n/a' : summary.scoredRepCount;
  const unscored = summary.unscoredRepCount === undefined ? 'n/a' : summary.unscoredRepCount;
  return `[PoseParserDiagnostics] reps total=${summary.totalReps} completed=${summary.completedRepCount} analyzer=${summary.analyzerRepCount} ui=${summary.uiRepCount} scored=${scored} unscored=${unscored}`;
}

export class PoseParserDiagnosticsAggregator {
  private summary: PoseParserDiagnosticsSummary = emptySummary();
  private visibilityStatsByJoint: Record<string, PoseParserMutableValueStats> = {};
  private presenceStatsByJoint: Record<string, PoseParserMutableValueStats> = {};
  private statsBySource = emptyMutableStatsBySource();
  private timestampIntervalSumMs = 0;
  private reacquisitionFramesRemaining = 0;

  reset(): void {
    this.summary = emptySummary();
    this.visibilityStatsByJoint = {};
    this.presenceStatsByJoint = {};
    this.statsBySource = emptyMutableStatsBySource();
    this.timestampIntervalSumMs = 0;
    this.reacquisitionFramesRemaining = 0;
  }

  private observeTimestamp(timestampMs: number | undefined): void {
    if (timestampMs === undefined) return;

    const gaps = this.summary.timestampGaps;
    if (gaps.firstTimestampMs === undefined) {
      gaps.firstTimestampMs = timestampMs;
      gaps.lastTimestampMs = timestampMs;
      return;
    }

    const previousTimestampMs = gaps.lastTimestampMs;
    gaps.lastTimestampMs = timestampMs;
    gaps.totalDurationMs = Math.max(0, timestampMs - gaps.firstTimestampMs);

    if (previousTimestampMs === undefined) return;
    const intervalMs = timestampMs - previousTimestampMs;
    if (!Number.isFinite(intervalMs) || intervalMs < 0) return;

    gaps.intervalCount += 1;
    gaps.minFrameIntervalMs = gaps.minFrameIntervalMs === undefined
      ? intervalMs
      : Math.min(gaps.minFrameIntervalMs, intervalMs);
    gaps.maxFrameIntervalMs = gaps.maxFrameIntervalMs === undefined
      ? intervalMs
      : Math.max(gaps.maxFrameIntervalMs, intervalMs);
    this.timestampIntervalSumMs += intervalMs;
    gaps.meanFrameIntervalMs = this.timestampIntervalSumMs / gaps.intervalCount;

    if (intervalMs > 250) gaps.gapsOver250Ms += 1;
    if (intervalMs > 500) gaps.gapsOver500Ms += 1;
    if (intervalMs > 1000) gaps.gapsOver1000Ms += 1;
    if (intervalMs > 2000) gaps.gapsOver2000Ms += 1;

    if (intervalMs > SILENT_TRACKING_LOSS_GAP_MS) {
      gaps.possibleSilentTrackingLossCount += 1;
      this.reacquisitionFramesRemaining = REACQUISITION_FRAMES_AFTER_GAP;
    }

    if (this.reacquisitionFramesRemaining > 0) {
      gaps.reacquisitionFrameCount += 1;
      this.reacquisitionFramesRemaining -= 1;
    }
  }

  observe(frame: ParsedPoseFrame | null | undefined): void {
    if (!frame) return;

    const summary = this.summary;
    this.observeTimestamp(frame.timestampMs);
    summary.totalFrames += 1;
    if (frame.status === 'poseDetected') {
      summary.poseDetectedFrames += 1;
    } else {
      summary.trackingLostFrames += 1;
    }

    if (frame.diagnostics.visibilityUnknownCount > 0) {
      summary.framesWithMissingVisibility += 1;
    }
    if (frame.diagnostics.presenceUnknownCount > 0) {
      summary.framesWithMissingPresence += 1;
    }
    if (frame.diagnostics.malformedLandmarkCount > 0) {
      summary.framesWithMalformedLandmarks += 1;
    }

    increment(summary.primarySourceCounts, frame.primarySource);
    increment(summary.inputKindCounts, frame.diagnostics.inputKind);
    for (const warning of frame.diagnostics.warnings) {
      increment(summary.warningCounts, warning);
    }

    const imageLandmarksPresent = observeSource(summary.imageLandmarks, frame.metadata.imageLandmarks);
    const worldLandmarksPresent = observeSource(summary.worldLandmarks, frame.metadata.worldLandmarks);
    observeJointCounts(
      summary,
      this.visibilityStatsByJoint,
      this.presenceStatsByJoint,
      frame.metadata.imageLandmarks,
    );
    observeJointCounts(
      summary,
      this.visibilityStatsByJoint,
      this.presenceStatsByJoint,
      frame.metadata.worldLandmarks,
    );
    observeJointValues(this.statsBySource.image, frame.metadata.imageLandmarks);
    observeJointValues(this.statsBySource.world, frame.metadata.worldLandmarks);
    observeJointValues(this.statsBySource.primarySource, primarySourceLandmarks(frame));

    summary.lastFrame = {
      status: frame.status,
      primarySource: frame.primarySource,
      timestampMs: frame.timestampMs,
      warnings: [...frame.diagnostics.warnings],
      imageLandmarksPresent,
      worldLandmarksPresent,
    };

  }

  snapshot(): PoseParserDiagnosticsSummary {
    return cloneSummary(
      this.summary,
      this.visibilityStatsByJoint,
      this.presenceStatsByJoint,
      this.statsBySource,
    );
  }
}

export function createPoseParserDiagnosticsAggregator(): PoseParserDiagnosticsAggregator {
  return new PoseParserDiagnosticsAggregator();
}

export function formatPoseParserDiagnosticsSummary(
  summary: PoseParserDiagnosticsSummary,
  repSummary?: PoseParserDiagnosticsRepSummary,
): string {
  const lines = [
    `[PoseParserDiagnostics] frames=${summary.totalFrames} poseDetected=${summary.poseDetectedFrames} trackingLost=${summary.trackingLostFrames}`,
    `[PoseParserDiagnostics] primarySource image=${summary.primarySourceCounts.image} world=${summary.primarySourceCounts.world}`,
    `[PoseParserDiagnostics] imageLandmarks present=${summary.imageLandmarks.presentFrames} missing=${summary.imageLandmarks.missingFrames} worldLandmarks present=${summary.worldLandmarks.presentFrames} missing=${summary.worldLandmarks.missingFrames}`,
    `[PoseParserDiagnostics] framesWithMissingVisibility=${summary.framesWithMissingVisibility} framesWithMissingPresence=${summary.framesWithMissingPresence} framesWithMalformedLandmarks=${summary.framesWithMalformedLandmarks}`,
    `[PoseParserDiagnostics] unknownVisibilityByJoint top=${topCounts(summary.unknownVisibilityByJoint)}`,
    `[PoseParserDiagnostics] missingPresenceByJoint top=${topCounts(summary.missingPresenceByJoint)}`,
    `[PoseParserDiagnostics] malformedLandmarksByJoint top=${topCounts(summary.malformedLandmarksByJoint)}`,
    ...formatSourceTopStats('allSources', summary.jointStatsBySource.allSources),
    ...formatSourceTopStats('primarySource', summary.jointStatsBySource.primarySource),
    ...formatSourceWristStats('primarySource', summary.jointStatsBySource.primarySource),
    ...formatSourceWristStats('image', summary.jointStatsBySource.image),
    ...formatSourceWristStats('world', summary.jointStatsBySource.world),
    ...formatTimestampGaps(summary.timestampGaps),
  ];

  if (repSummary) {
    lines.push(formatRepSummary(repSummary));
  }

  return lines.join('\n');
}
