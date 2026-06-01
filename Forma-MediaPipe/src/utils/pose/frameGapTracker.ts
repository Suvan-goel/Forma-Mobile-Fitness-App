export interface PoseFrameGapMetadata {
  silentGapMs?: number;
  trackingInterrupted: boolean;
  reacquisitionFrameIndex?: number;
}

export interface PoseFrameGapTrackerOptions {
  interruptionThresholdMs?: number;
  reacquisitionFrameCount?: number;
}

const DEFAULT_INTERRUPTION_THRESHOLD_MS = 1000;
const DEFAULT_REACQUISITION_FRAME_COUNT = 5;

function finiteTimestamp(timestampMs: unknown): number | undefined {
  return typeof timestampMs === 'number' && Number.isFinite(timestampMs) ? timestampMs : undefined;
}

export class PoseFrameGapTracker {
  private readonly interruptionThresholdMs: number;
  private readonly reacquisitionFrameCount: number;
  private previousTimestampMs: number | undefined;
  private reacquisitionFramesRemaining = 0;
  private nextReacquisitionFrameIndex = 0;

  constructor(options: PoseFrameGapTrackerOptions = {}) {
    this.interruptionThresholdMs = options.interruptionThresholdMs ?? DEFAULT_INTERRUPTION_THRESHOLD_MS;
    this.reacquisitionFrameCount = options.reacquisitionFrameCount ?? DEFAULT_REACQUISITION_FRAME_COUNT;
  }

  reset(): void {
    this.previousTimestampMs = undefined;
    this.reacquisitionFramesRemaining = 0;
    this.nextReacquisitionFrameIndex = 0;
  }

  observe(timestampMs: unknown): PoseFrameGapMetadata {
    const timestamp = finiteTimestamp(timestampMs);
    if (timestamp === undefined) {
      return { trackingInterrupted: false };
    }

    if (this.previousTimestampMs === undefined) {
      this.previousTimestampMs = timestamp;
      return { trackingInterrupted: false };
    }

    const silentGapMs = timestamp - this.previousTimestampMs;
    this.previousTimestampMs = timestamp;

    if (!Number.isFinite(silentGapMs) || silentGapMs < 0) {
      this.reacquisitionFramesRemaining = 0;
      this.nextReacquisitionFrameIndex = 0;
      return { trackingInterrupted: false };
    }

    if (silentGapMs > this.interruptionThresholdMs) {
      this.reacquisitionFramesRemaining = Math.max(0, this.reacquisitionFrameCount - 1);
      this.nextReacquisitionFrameIndex = 1;
      return {
        silentGapMs,
        trackingInterrupted: true,
        reacquisitionFrameIndex: 0,
      };
    }

    if (this.reacquisitionFramesRemaining > 0) {
      const reacquisitionFrameIndex = this.nextReacquisitionFrameIndex;
      this.reacquisitionFramesRemaining -= 1;
      this.nextReacquisitionFrameIndex += 1;
      return {
        silentGapMs,
        trackingInterrupted: false,
        reacquisitionFrameIndex,
      };
    }

    return {
      silentGapMs,
      trackingInterrupted: false,
    };
  }
}

export function createPoseFrameGapTracker(options?: PoseFrameGapTrackerOptions): PoseFrameGapTracker {
  return new PoseFrameGapTracker(options);
}
