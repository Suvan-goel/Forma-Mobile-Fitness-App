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
  worldLandmarks: PoseParserSourceAvailability;
  imageLandmarks: PoseParserSourceAvailability;
  primarySourceCounts: Record<PoseFramePrimarySource, number>;
  inputKindCounts: Partial<Record<PoseFrameInputKind, number>>;
  warningCounts: Record<string, number>;
  lastFrame?: PoseParserLastFrameSummary;
}

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

function cloneSource(source: PoseParserSourceAvailability): PoseParserSourceAvailability {
  return { ...source };
}

function cloneSummary(summary: PoseParserDiagnosticsSummary): PoseParserDiagnosticsSummary {
  return {
    ...summary,
    unknownVisibilityByJoint: cloneRecord(summary.unknownVisibilityByJoint),
    missingPresenceByJoint: cloneRecord(summary.missingPresenceByJoint),
    malformedLandmarksByJoint: cloneRecord(summary.malformedLandmarksByJoint),
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

function observeJointCounts(
  summary: PoseParserDiagnosticsSummary,
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

export class PoseParserDiagnosticsAggregator {
  private summary: PoseParserDiagnosticsSummary = emptySummary();

  reset(): void {
    this.summary = emptySummary();
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
    observeJointCounts(summary, frame.metadata.imageLandmarks);
    observeJointCounts(summary, frame.metadata.worldLandmarks);

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
    return cloneSummary(this.summary);
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
  ].join('\n');
}
