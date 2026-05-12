/**
 * Shared Scoring Primitives
 *
 * Reusable quadratic penalty curve functions for exercise scoring.
 * Each exercise defines its own penalty configs and feeds values through
 * these functions.
 */

export interface PenaltyConfig {
  /** Maximum penalty points */
  cap: number;
  /** No penalty below this value */
  deadzone: number;
  /** Quadratic coefficient */
  scale: number;
}

/**
 * Computes a single quadratic penalty: min(cap, scale * max(0, value - deadzone)^2)
 * @param value - The measured value (angle deviation, time deficit, etc.)
 * @param config - Penalty configuration
 * @returns Penalty points (0 to cap)
 */
export function computePenaltyPoints(value: number, config: PenaltyConfig): number {
  const d = Math.max(0, value - config.deadzone);
  return Math.min(config.cap, config.scale * d * d);
}

/**
 * Computes total score from precomputed penalty points.
 * Returns max(0, min(100, 100 - totalPenalty)), rounded to nearest integer.
 */
export function computeScoreFromPenaltyPoints(points: number[]): number {
  const total = points.reduce((sum, point) => sum + point, 0);
  return Math.max(0, Math.min(100, Math.round(100 - total)));
}

/**
 * Computes total score from an array of penalty configs + values.
 * Returns max(0, min(100, 100 - totalPenalty)), rounded to nearest integer.
 */
export function computeScore(
  penalties: Array<{ value: number; config: PenaltyConfig }>
): number {
  return computeScoreFromPenaltyPoints(
    penalties.map((penalty) => computePenaltyPoints(penalty.value, penalty.config)),
  );
}
