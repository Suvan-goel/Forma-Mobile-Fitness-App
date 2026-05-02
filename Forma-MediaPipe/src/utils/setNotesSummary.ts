/**
 * Generates an AI-style form summary from rep feedback and form score.
 * Uses heuristics to produce natural language insights about the set.
 * Can be replaced with a real LLM API in the future.
 *
 * FEEDBACK_TO_IMPROVEMENT is populated dynamically by exercise definitions
 * via mergeSummaryConfig(). Good-rep entries are hardcoded since they're
 * universal across all exercises.
 */

const FEEDBACK_TO_IMPROVEMENT: Record<string, string> = {
  // Good reps (no improvement needed) — universal across exercises
  'Great rep!': '',
  'Good rep.': '',
  'Use more range for this rep to count.': 'Use a larger range of motion before returning to the start position.',
};

/**
 * Merge exercise-specific summary configuration into the global map.
 * Called once per exercise at registration time (module load).
 */
export function mergeSummaryConfig(config: Record<string, string>): void {
  for (const [feedback, improvement] of Object.entries(config)) {
    FEEDBACK_TO_IMPROVEMENT[feedback] = improvement;
  }
}

/**
 * Generate a human-readable summary of form quality and what to improve.
 */
export function generateSetSummary(
  repFeedback: string[],
  formScore: number,
  _exerciseName: string
): string {
  if (repFeedback.length === 0) {
    return `No rep-by-rep feedback was recorded for this set. Your form score was ${formScore}/100.`;
  }

  // Split multi-line feedback (heuristics join issues with \n) into individual messages
  const allMessages = repFeedback.flatMap((f) => f.split('\n').map((s) => s.trim()).filter(Boolean));
  const goodReps = repFeedback.filter((f) => f === 'Great rep!' || f === 'Good rep.');
  const greatRepCount = goodReps.length;
  const totalReps = repFeedback.length;
  const errorMessages = allMessages.filter((m) => m !== 'Great rep!' && m !== 'Good rep.');
  const uniqueErrors = [...new Set(errorMessages)];

  // All great reps
  if (greatRepCount === totalReps) {
    return `Excellent form throughout! All ${totalReps} reps showed controlled movement with no form issues detected. Your form score of ${formScore}/100 reflects solid technique. Keep up the consistency!`;
  }

  // Mixed performance
  const greatPct = Math.round((greatRepCount / totalReps) * 100);
  let summary = `Form varied across the set. ${greatRepCount} of ${totalReps} reps (${greatPct}%) had good form. `;

  if (uniqueErrors.length === 1) {
    const err = uniqueErrors[0];
    const improvement = FEEDBACK_TO_IMPROVEMENT[err];
    summary += improvement
      ? `To improve: ${improvement}`
      : `Focus on addressing: "${err}"`;
  } else if (uniqueErrors.length > 1) {
    summary += 'Areas to improve: ';
    const improvements = uniqueErrors
      .filter((e) => e !== 'Great rep!')
      .map((err) => FEEDBACK_TO_IMPROVEMENT[err] || err)
      .filter(Boolean);
    summary += improvements.length > 0
      ? improvements.join(' ')
      : uniqueErrors.map((e) => `"${e}"`).join(', ');
  }

  summary += ` Overall form score: ${formScore}/100.`;
  return summary;
}
