/**
 * Generates an AI-style form summary from rep feedback and form score.
 * Uses heuristics to produce natural language insights about the set.
 * Can be replaced with a real LLM API in the future.
 */

const FEEDBACK_TO_IMPROVEMENT: Record<string, string> = {
  // ROM issues
  'Flex more at the top of the curl.': 'Full ROM at top — contract the bicep fully before lowering.',
  'Extend fully at the bottom.': 'Extend arms completely at the bottom for a full stretch.',
  'Incomplete rep — curl all the way up and fully extend.': 'Achieve complete range of motion in both directions.',
  // Shoulder / elbow drift
  'Too much shoulder involvement — reduce the weight.': 'Reduce weight and focus on isolating the bicep.',
  'Upper arms moving — keep elbows pinned to your sides.': 'Minimize elbow drift — keep elbows close to your body.',
  // Torso swing
  'Excessive body swing — this is cheating the rep.': 'Reduce torso momentum — use strict, controlled form.',
  "Don't swing your torso — stay upright and controlled.": 'Brace your core and keep torso stationary throughout.',
  // Tempo
  'Slow down — control the curl.': 'Slow the concentric phase — aim for 1-2 seconds up.',
  "Control the lowering — don't drop the weight.": 'Slow the eccentric phase — 2-3 seconds down.',
  // Symmetry
  'Arms are uneven — curl both sides together.': 'Focus on symmetry — curl both arms at the same speed.',
  // Pushup-specific feedback
  'Go deeper \u2014 aim for elbows at 90 degrees.': 'Focus on hitting full depth each rep.',
  'Lock out your arms fully at the top.': 'Fully extend at the top of each rep for complete range of motion.',
  'Incomplete rep \u2014 full range of motion from lockout to 90 degrees.': 'Achieve complete range of motion in both directions.',
  'Hips are sagging \u2014 engage your core to maintain a straight line.': 'Strengthen your core \u2014 try planks as an accessory exercise.',
  'Keep your hips up \u2014 your body line is dropping.': 'Focus on maintaining a rigid plank throughout each rep.',
  'Hips are piking up \u2014 lower them to maintain a straight plank.': 'Think about pushing the ground away while keeping your body rigid.',
  'Hips are riding high \u2014 aim for a straight body line.': 'Keep your body in a straight line from head to heels.',
  'Keep your head neutral \u2014 look at the floor just ahead of your hands.': 'Maintain a neutral neck \u2014 pick a spot on the floor to focus on.',
  'Slow down the push \u2014 control the movement.': 'Slow the concentric phase \u2014 aim for 1-2 seconds up.',
  "Control the descent \u2014 don't drop into the pushup.": 'Slow the eccentric phase \u2014 2-3 seconds down.',
  "Go deeper \u2014 that one didn't count.": 'Make sure to reach full depth before pushing back up.',
  // Good reps (no improvement needed)
  'Great rep!': '',
  'Good rep.': '',
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
