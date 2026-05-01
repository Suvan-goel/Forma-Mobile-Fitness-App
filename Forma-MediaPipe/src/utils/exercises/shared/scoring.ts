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
function computePenalty(value: number, config: PenaltyConfig): number {
  const d = Math.max(0, value - config.deadzone);
  return Math.min(config.cap, config.scale * d * d);
}

/**
 * Computes total score from an array of penalty configs + values.
 * Returns max(0, min(100, 100 - totalPenalty)), rounded to nearest integer.
 */
export function computeScore(
  penalties: Array<{ value: number; config: PenaltyConfig }>
): number {
  let total = 0;
  for (const p of penalties) {
    total += computePenalty(p.value, p.config);
  }
  return Math.max(0, Math.min(100, Math.round(100 - total)));
}
