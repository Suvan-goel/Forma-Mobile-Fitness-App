/**
 * SmoothedAngleTracker — Median filter + EMA smoothing for a single tracked angle.
 *
 * Pipeline: velocity clamp → median filter → confidence-weighted EMA
 *
 * Usage:
 *   const tracker = new SmoothedAngleTracker();
 *   const smoothed = tracker.push(rawAngle); // returns smoothed value
 *   const smoothed = tracker.push(rawAngle, confidence); // confidence-weighted
 */

export interface SmoothedAngleTrackerConfig {
  medianWindow?: number;       // Default: 5
  emaAlpha?: number;           // Default: 0.3
  maxDegPerFrame?: number;     // Velocity clamp: max allowed change per frame (default: undefined = disabled)
}

export class SmoothedAngleTracker {
  private buffer: number[];
  private sortedBuffer: number[];
  private smoothedValue: number | null;
  private readonly medianWindow: number;
  private readonly emaAlpha: number;
  private readonly maxDegPerFrame: number | undefined;

  constructor(config?: SmoothedAngleTrackerConfig) {
    this.medianWindow = config?.medianWindow ?? 5;
    this.emaAlpha = config?.emaAlpha ?? 0.3;
    this.maxDegPerFrame = config?.maxDegPerFrame;
    this.buffer = [];
    this.sortedBuffer = [];
    this.smoothedValue = null;
  }

  /**
   * Push a raw angle value through the velocity-clamp → median → EMA pipeline.
   * Returns the smoothed result.
   * If rawAngle is NaN, returns the previous smoothed value (or NaN if none).
   * Optional confidence (0-1) scales the EMA alpha — low confidence trusts previous value more.
   */
  push(rawAngle: number, confidence?: number): number {
    if (isNaN(rawAngle)) {
      return this.smoothedValue ?? NaN;
    }

    // Velocity clamp — reject teleportation spikes
    if (this.maxDegPerFrame !== undefined && this.buffer.length > 0) {
      const prev = this.buffer[this.buffer.length - 1];
      const delta = rawAngle - prev;
      if (Math.abs(delta) > this.maxDegPerFrame) {
        rawAngle = prev + Math.sign(delta) * this.maxDegPerFrame;
      }
    }

    // Remove oldest value from sorted buffer if at capacity
    if (this.buffer.length >= this.medianWindow) {
      const oldest = this.buffer[0];
      const idx = binarySearch(this.sortedBuffer, oldest);
      if (idx >= 0) {
        this.sortedBuffer.splice(idx, 1);
      }
      this.buffer.shift();
    }

    // Add new value to both buffers
    this.buffer.push(rawAngle);
    const insertIdx = binarySearchInsert(this.sortedBuffer, rawAngle);
    this.sortedBuffer.splice(insertIdx, 0, rawAngle);

    // Median from pre-sorted buffer
    const len = this.sortedBuffer.length;
    const mid = len >> 1;
    const medianValue = len % 2 === 0
      ? (this.sortedBuffer[mid - 1] + this.sortedBuffer[mid]) * 0.5
      : this.sortedBuffer[mid];

    // Confidence-weighted EMA
    const effectiveAlpha = confidence !== undefined
      ? this.emaAlpha * Math.min(1, confidence / 0.5)
      : this.emaAlpha;

    if (this.smoothedValue !== null && !isNaN(this.smoothedValue)) {
      this.smoothedValue = effectiveAlpha * medianValue + (1 - effectiveAlpha) * this.smoothedValue;
    } else {
      this.smoothedValue = medianValue;
    }

    return this.smoothedValue;
  }

  /** Current smoothed value (or NaN if no data yet) */
  get value(): number {
    return this.smoothedValue ?? NaN;
  }

  /**
   * Last median-filtered value before EMA is applied.
   * Use this for FSM transition decisions — it responds faster to extremes
   * (~1–2 frame lag) without the additional EMA lag that would cause the FSM
   * to miss brief peaks/valleys at the top and bottom of a rep.
   */
  get medianValue(): number {
    if (this.sortedBuffer.length === 0) return NaN;
    const len = this.sortedBuffer.length;
    const mid = len >> 1;
    return len % 2 === 0
      ? (this.sortedBuffer[mid - 1] + this.sortedBuffer[mid]) * 0.5
      : this.sortedBuffer[mid];
  }

  /** Reset to initial state */
  reset(): void {
    this.buffer = [];
    this.sortedBuffer = [];
    this.smoothedValue = null;
  }
}

/** Find exact index of value in sorted array, or -1. */
function binarySearch(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === value) return mid;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Find insertion index to maintain sorted order. */
function binarySearchInsert(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
