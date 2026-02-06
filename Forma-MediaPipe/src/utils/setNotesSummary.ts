/**
 * Generates an AI-style form summary from rep feedback and form score.
 * Uses heuristics to produce natural language insights about the set.
 * Can be replaced with a real LLM API in the future.
 */

const FEEDBACK_TO_IMPROVEMENT: Record<string, string> = {
  "Don't swing your back!": 'Reduce torso momentum—focus on controlled, isolated arm movement.',
  'Keep your elbows pinned to your sides.': 'Minimize elbow drift by keeping elbows close to your body throughout the rep.',
  'Squeeze all the way up.': 'Achieve full range of motion at the top—contract the bicep fully before lowering.',
  'Fully extend your arms at the bottom.': 'Extend arms completely at the bottom of each rep for full stretch.',
  'Great rep!': '', // No improvement needed
};

/**
 * Generate a human-readable summary of form quality and what to improve.
 */
export function generateSetSummary(
  repFeedback: string[],
  formScore: number,
  exerciseName: string
): string {
  if (repFeedback.length === 0) {
    return `No rep-by-rep feedback was recorded for this set. Your form score was ${formScore}/100.`;
  }

  const greatRepCount = repFeedback.filter((f) => f === 'Great rep!').length;
  const totalReps = repFeedback.length;
  const errorFeedbacks = repFeedback.filter((f) => f !== 'Great rep!');
  const uniqueErrors = [...new Set(errorFeedbacks)];

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
