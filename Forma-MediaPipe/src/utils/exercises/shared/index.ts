/**
 * Shared Primitives — re-exports for exercise definitions.
 */

export { SmoothedAngleTracker } from './SmoothedAngleTracker';
export type { SmoothedAngleTrackerConfig } from './SmoothedAngleTracker';

export { WarmupGate } from './WarmupGate';
export type { WarmupGateConfig } from './WarmupGate';

export { computePenalty, computeScore } from './scoring';
export type { PenaltyConfig } from './scoring';

export { RepWindowTracker } from './RepWindowTracker';
export type { TrackedMetric, RepWindowResult } from './RepWindowTracker';
