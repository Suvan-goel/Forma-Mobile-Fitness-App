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

export interface PoseParserValueStats {
  sampleCount: number;
  min: number;
  max: number;
  mean: number;
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

function cloneSource(source: PoseParserSourceAvailability): PoseParserSourceAvailability {
  return { ...source };
}

function cloneSummary(
  summary: PoseParserDiagnosticsSummary,
  visibilityStatsByJoint: Record<string, PoseParserMutableValueStats>,
  presenceStatsByJoint: Record<string, PoseParserMutableValueStats>,
): PoseParserDiagnosticsSummary {
  return {
    ...summary,
    unknownVisibilityByJoint: cloneRecord(summary.unknownVisibilityByJoint),
    missingPresenceByJoint: cloneRecord(summary.missingPresenceByJoint),
    malformedLandmarksByJoint: cloneRecord(summary.malformedLandmarksByJoint),
    lowVisibilityByJoint: cloneLowValueCounts(summary.lowVisibilityByJoint),
    lowPresenceByJoint: cloneLowValueCounts(summary.lowPresenceByJoint),
    visibilityStatsByJoint: cloneValueStats(visibilityStatsByJoint),
    presenceStatsByJoint: cloneValueStats(presenceStatsByJoint),
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

export class PoseParserDiagnosticsAggregator {
  private summary: PoseParserDiagnosticsSummary = emptySummary();
  private visibilityStatsByJoint: Record<string, PoseParserMutableValueStats> = {};
  private presenceStatsByJoint: Record<string, PoseParserMutableValueStats> = {};

  reset(): void {
    this.summary = emptySummary();
    this.visibilityStatsByJoint = {};
    this.presenceStatsByJoint = {};
  }

  observe(frame: ParsedPoseFrame | null | undefined): void {
    if (!frame) return;

    const summary = this.summary;
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
    return cloneSummary(this.summary, this.visibilityStatsByJoint, this.presenceStatsByJoint);
  }
}

export function createPoseParserDiagnosticsAggregator(): PoseParserDiagnosticsAggregator {
  return new PoseParserDiagnosticsAggregator();
}

export function formatPoseParserDiagnosticsSummary(summary: PoseParserDiagnosticsSummary): string {
  return [
    `[PoseParserDiagnostics] frames=${summary.totalFrames} poseDetected=${summary.poseDetectedFrames} trackingLost=${summary.trackingLostFrames}`,
    `[PoseParserDiagnostics] primarySource image=${summary.primarySourceCounts.image} world=${summary.primarySourceCounts.world}`,
    `[PoseParserDiagnostics] imageLandmarks present=${summary.imageLandmarks.presentFrames} missing=${summary.imageLandmarks.missingFrames} worldLandmarks present=${summary.worldLandmarks.presentFrames} missing=${summary.worldLandmarks.missingFrames}`,
    `[PoseParserDiagnostics] framesWithMissingVisibility=${summary.framesWithMissingVisibility} framesWithMissingPresence=${summary.framesWithMissingPresence} framesWithMalformedLandmarks=${summary.framesWithMalformedLandmarks}`,
    `[PoseParserDiagnostics] unknownVisibilityByJoint top=${topCounts(summary.unknownVisibilityByJoint)}`,
    `[PoseParserDiagnostics] missingPresenceByJoint top=${topCounts(summary.missingPresenceByJoint)}`,
    `[PoseParserDiagnostics] malformedLandmarksByJoint top=${topCounts(summary.malformedLandmarksByJoint)}`,
    `[PoseParserDiagnostics] visibility lowestMean top=${lowestMeanStats(summary.visibilityStatsByJoint)}`,
    `[PoseParserDiagnostics] visibility${LOW_VALUE_THRESHOLDS[1].label} top=${topCounts(summary.lowVisibilityByJoint.lt020)} visibility${LOW_VALUE_THRESHOLDS[2].label} top=${topCounts(summary.lowVisibilityByJoint.lt035)}`,
    `[PoseParserDiagnostics] presence lowestMean top=${lowestMeanStats(summary.presenceStatsByJoint)}`,
    `[PoseParserDiagnostics] presence${LOW_VALUE_THRESHOLDS[2].label} top=${topCounts(summary.lowPresenceByJoint.lt035)}`,
    `[PoseParserDiagnostics] wrists visibility ${formatJointStats(summary.visibilityStatsByJoint, LEFT_WRIST)} ${formatJointStats(summary.visibilityStatsByJoint, RIGHT_WRIST)}`,
    `[PoseParserDiagnostics] wrists presence ${formatJointStats(summary.presenceStatsByJoint, LEFT_WRIST)} ${formatJointStats(summary.presenceStatsByJoint, RIGHT_WRIST)}`,
  ].join('\n');
}
