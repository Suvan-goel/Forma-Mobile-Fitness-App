/**
 * RepWindowTracker — Accumulates min/max/delta/last values during a rep.
 *
 * A generic utility for tracking per-frame metrics within a rep window.
 * Each metric is configured with an aggregation mode (min, max, delta, last).
 *
 * Usage:
 *   const tracker = new RepWindowTracker([
 *     { id: 'elbow', mode: 'min' },
 *     { id: 'bodyAngle', mode: 'max' },
 *   ]);
 *   tracker.start();
 *   tracker.record({ elbow: 95, bodyAngle: 175 });
 *   // ... more frames ...
 *   const result = tracker.finalize();
 */

export interface TrackedMetric {
  id: string;
  mode: 'min' | 'max' | 'delta' | 'last';
}

export interface RepWindowResult {
  /** Aggregated metric values (min, max, delta, or last depending on mode) */
  metrics: Record<string, number>;
  /** Rep duration in seconds */
  duration: number;
}

export class RepWindowTracker {
  private values: Map<string, number[]>;
  private startTime: number | null;
  private readonly metrics: TrackedMetric[];

  constructor(metrics: TrackedMetric[]) {
    this.metrics = metrics;
    this.values = new Map();
    this.startTime = null;
    for (const m of metrics) {
      this.values.set(m.id, []);
    }
  }

  /** Start tracking a new rep */
  start(): void {
    this.startTime = Date.now() / 1000;
    for (const m of this.metrics) {
      this.values.set(m.id, []);
    }
  }

  /** Record one frame's values during a rep */
  record(frameValues: Record<string, number>): void {
    for (const m of this.metrics) {
      const val = frameValues[m.id];
      if (val !== undefined && !isNaN(val)) {
        const arr = this.values.get(m.id);
        if (arr) {
          arr.push(val);
        }
      }
    }
  }

  /** Finalize and return accumulated results */
  finalize(): RepWindowResult {
    const endTime = Date.now() / 1000;
    const duration = this.startTime !== null ? endTime - this.startTime : 0;
    const result: Record<string, number> = {};

    for (const m of this.metrics) {
      const arr = this.values.get(m.id) ?? [];
      if (arr.length === 0) {
        result[m.id] = NaN;
        continue;
      }
      switch (m.mode) {
        case 'min':
          result[m.id] = Math.min(...arr);
          break;
        case 'max':
          result[m.id] = Math.max(...arr);
          break;
        case 'delta':
          result[m.id] = Math.max(...arr) - Math.min(...arr);
          break;
        case 'last':
          result[m.id] = arr[arr.length - 1];
          break;
      }
    }

    return { metrics: result, duration };
  }
}
