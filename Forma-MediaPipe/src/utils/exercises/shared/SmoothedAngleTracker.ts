/**
 * SmoothedAngleTracker — Median filter + EMA smoothing for a single tracked angle.
 *
 * Extracted from barbellCurlHeuristics / pushupHeuristics where the same
 * median→EMA pipeline is duplicated per angle.
 *
 * Usage:
 *   const tracker = new SmoothedAngleTracker();
 *   const smoothed = tracker.push(rawAngle); // returns smoothed value
 */

export interface SmoothedAngleTrackerConfig {
  medianWindow?: number;   // Default: 5
  emaAlpha?: number;       // Default: 0.3
}

export class SmoothedAngleTracker {
  private buffer: number[];
  private smoothedValue: number | null;
  private readonly medianWindow: number;
  private readonly emaAlpha: number;

  constructor(config?: SmoothedAngleTrackerConfig) {
    this.medianWindow = config?.medianWindow ?? 5;
    this.emaAlpha = config?.emaAlpha ?? 0.3;
    this.buffer = [];
    this.smoothedValue = null;
  }

  /**
   * Push a raw angle value through the median→EMA pipeline.
   * Returns the smoothed result.
   * If rawAngle is NaN, returns the previous smoothed value (or NaN if none).
   */
  push(rawAngle: number): number {
    if (isNaN(rawAngle)) {
      return this.smoothedValue ?? NaN;
    }

    // Update circular buffer
    this.buffer.push(rawAngle);
    if (this.buffer.length > this.medianWindow) {
      this.buffer.shift();
    }

    // Median filter
    const medianValue = median(this.buffer);

    // EMA
    if (this.smoothedValue !== null && !isNaN(this.smoothedValue)) {
      this.smoothedValue = this.emaAlpha * medianValue + (1 - this.emaAlpha) * this.smoothedValue;
    } else {
      this.smoothedValue = medianValue;
    }

    return this.smoothedValue;
  }

  /** Current smoothed value (or NaN if no data yet) */
  get value(): number {
    return this.smoothedValue ?? NaN;
  }

  /** Reset to initial state */
  reset(): void {
    this.buffer = [];
    this.smoothedValue = null;
  }
}

/** Compute the median of a non-empty array. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
