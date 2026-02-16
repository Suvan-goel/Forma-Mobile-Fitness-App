/**
 * TTS Coaching Message Pools
 *
 * Short, coach-like voice cues organized by issue type.
 * Visual feedback (on-screen) is separate and unchanged — this file
 * only controls what the TTS voice says.
 *
 * To add a new exercise:
 * 1. Define its feedback strings → IssueType mapping in FEEDBACK_TO_ISSUE
 * 2. Reuse existing IssueType pools or add new ones to ISSUE_POOLS
 */

// ============================================================================
// TYPES
// ============================================================================

export type IssueType =
  | 'incomplete_flex'
  | 'incomplete_extend'
  | 'incomplete_rom'
  | 'shoulder_warn'
  | 'shoulder_fail'
  | 'torso_warn'
  | 'torso_fail'
  | 'tempo_up'
  | 'tempo_down'
  | 'asymmetry'
  // Pushup-specific
  | 'depth_short'
  | 'lockout_short'
  | 'hip_sag'
  | 'hip_pike';

export type PositiveCategory = 'positive' | 'transition_good';

export interface MessagePool {
  messages: string[];
}

// ============================================================================
// ISSUE POOLS — short, punchy, coach-like
// ============================================================================

export const ISSUE_POOLS: Record<IssueType, MessagePool> = {
  incomplete_flex: {
    messages: [
      'Squeeze harder at the top.',
      'Curl it all the way up.',
      'Get a full contraction up top.',
      'Bring it higher — full curl.',
    ],
  },
  incomplete_extend: {
    messages: [
      'Extend all the way down.',
      'Let your arms straighten at the bottom.',
      'Full stretch at the bottom.',
      "Don't cut the rep short — extend fully.",
    ],
  },
  incomplete_rom: {
    messages: [
      'Bigger range of motion.',
      'Use the full range.',
      'Go all the way up and all the way down.',
    ],
  },
  shoulder_fail: {
    messages: [
      'Too much shoulder. Drop the weight.',
      "Your shoulders are doing the work — go lighter.",
      'Shoulders are taking over. Reduce the load.',
    ],
  },
  shoulder_warn: {
    messages: [
      'Pin your elbows to your sides.',
      'Keep those elbows still.',
      "Elbows are drifting — lock them in.",
      'Tighter elbows.',
    ],
  },
  torso_fail: {
    messages: [
      "Way too much swing. That's momentum, not muscle.",
      "Stop swinging — that's not a real rep.",
      "You're using your whole body. Brace and isolate.",
    ],
  },
  torso_warn: {
    messages: [
      "Stay upright — don't swing.",
      'Keep your torso still.',
      'Brace your core and stay tight.',
      'Less body swing.',
    ],
  },
  tempo_up: {
    messages: [
      'Slow it down.',
      "Control the curl — don't rush it.",
      'Slower on the way up.',
    ],
  },
  tempo_down: {
    messages: [
      'Control the descent.',
      'Slow the negative.',
      "Don't just drop it — lower with control.",
    ],
  },
  asymmetry: {
    messages: [
      'Even it out — both arms together.',
      'Your arms are out of sync.',
      'Match both sides.',
    ],
  },
  // Pushup-specific pools
  depth_short: {
    messages: [
      'Go deeper.',
      'Get your chest closer to the floor.',
      'Lower — aim for ninety degrees.',
      'Not deep enough.',
    ],
  },
  lockout_short: {
    messages: [
      'Lock out at the top.',
      'Extend your arms fully.',
      'Push all the way up.',
    ],
  },
  hip_sag: {
    messages: [
      'Hips are dropping — squeeze your core.',
      'Tighten your core — keep that body straight.',
      'Your hips are sagging.',
      'Brace your abs — straight line from head to heels.',
    ],
  },
  hip_pike: {
    messages: [
      'Drop your hips down.',
      'Your hips are too high — flatten out.',
      'Stop piking — keep a straight body line.',
    ],
  },
};

// ============================================================================
// POSITIVE POOLS
// ============================================================================

export const POSITIVE_POOLS: Record<PositiveCategory, MessagePool> = {
  positive: {
    messages: [
      'Nice rep.',
      'Good one.',
      'That looked clean.',
      'Solid.',
      'Good control.',
      "That's the one.",
      'Looking strong.',
      'Keep that up.',
      'Yep, just like that.',
      'Perfect — stay with it.',
    ],
  },
  transition_good: {
    messages: [
      'There you go — much better.',
      "That's more like it.",
      'Good correction.',
      "Now you've got it.",
      'Better. Keep that form.',
    ],
  },
};

// ============================================================================
// SET-START POOLS — spoken once when a new set begins
// Templates use {exercise} placeholder, replaced at runtime.
// ============================================================================

export type SetStartCategory = 'encouragement' | 'form_reminder' | 'neutral';

export const SET_START_POOLS: Record<SetStartCategory, MessagePool> = {
  encouragement: {
    messages: [
      "Let's go — {exercise}. You've got this!",
      '{exercise}. Time to work!',
      "All right. {exercise}. Let's make these count!",
      '{exercise} — give it everything!',
      "Here we go, {exercise}. Stay strong.",
    ],
  },
  form_reminder: {
    messages: [
      '{exercise}. Remember, Keep those reps clean.',
      '{exercise} coming up. Control the tempo and focus on your breathing.',
      "{exercise}. Focus on your form — that's what matters.",
      '{exercise}. Keep it smooth and controlled.',
    ],
  },
  neutral: {
    messages: [
      '{exercise}. Ready when you are.',
      'Next up: {exercise}.',
      '{exercise} — set starting.',
      '{exercise}. Lock in!',
    ],
  },
};

/** All set-start categories in rotation order. */
export const SET_START_CATEGORIES: SetStartCategory[] = [
  'encouragement',
  'form_reminder',
  'neutral',
];

/**
 * Pick a set-start message, rotating across categories to stay fresh.
 * Returns the message with {exercise} replaced by the actual exercise name.
 */
let _lastSetStartCatIdx = -1;

export function pickSetStartMessage(exerciseName: string): string {
  // Rotate category: encouragement → form_reminder → neutral → encouragement ...
  _lastSetStartCatIdx = (_lastSetStartCatIdx + 1) % SET_START_CATEGORIES.length;
  const category = SET_START_CATEGORIES[_lastSetStartCatIdx];
  const pool = SET_START_POOLS[category];
  const template = pickFromPool(pool);
  return template.replace('{exercise}', exerciseName);
}

// ============================================================================
// PRIORITY — higher number = more important = speak first
// ============================================================================

export const ISSUE_PRIORITY: Record<IssueType, number> = {
  incomplete_flex: 30,
  incomplete_extend: 30,
  incomplete_rom: 30,
  shoulder_fail: 25,
  torso_fail: 25,
  shoulder_warn: 15,
  torso_warn: 15,
  tempo_up: 10,
  tempo_down: 10,
  asymmetry: 10,
  // Pushup-specific
  depth_short: 30,
  lockout_short: 25,
  hip_sag: 35,
  hip_pike: 35,
};

// ============================================================================
// FEEDBACK STRING → ISSUE TYPE MAPPING
// Maps the exact visual feedback strings from barbellCurlHeuristics.ts
// ============================================================================

export const FEEDBACK_TO_ISSUE: Record<string, IssueType> = {
  // Barbell Curl
  'Flex more at the top of the curl.': 'incomplete_flex',
  'Extend fully at the bottom.': 'incomplete_extend',
  'Incomplete rep — curl all the way up and fully extend.': 'incomplete_rom',
  'Too much shoulder involvement — reduce the weight.': 'shoulder_fail',
  'Upper arms moving — keep elbows pinned to your sides.': 'shoulder_warn',
  'Excessive body swing — this is cheating the rep.': 'torso_fail',
  "Don't swing your torso — stay upright and controlled.": 'torso_warn',
  'Slow down — control the curl.': 'tempo_up',
  "Control the lowering — don't drop the weight.": 'tempo_down',
  'Arms are uneven — curl both sides together.': 'asymmetry',
  // Push-Up
  'Go deeper \u2014 aim for elbows at 90 degrees.': 'depth_short',
  'Lock out your arms fully at the top.': 'lockout_short',
  'Incomplete rep \u2014 full range of motion from lockout to 90 degrees.': 'incomplete_rom',
  'Hips are sagging \u2014 engage your core to maintain a straight line.': 'hip_sag',
  'Keep your hips up \u2014 your body line is dropping.': 'hip_sag',
  'Hips are piking up \u2014 lower them to maintain a straight plank.': 'hip_pike',
  'Hips are riding high \u2014 aim for a straight body line.': 'hip_pike',
  'Slow down the push \u2014 control the movement.': 'tempo_up',
  "Control the descent \u2014 don't drop into the pushup.": 'tempo_down',
};

// ============================================================================
// POOL SELECTION — shuffle-bag, never repeat last
// ============================================================================

const lastIndices = new Map<MessagePool, number>();

/**
 * Pick a random message from a pool, never repeating the last-used one.
 */
export function pickFromPool(pool: MessagePool): string {
  const { messages } = pool;
  if (messages.length === 0) return '';
  if (messages.length === 1) return messages[0];

  const lastIdx = lastIndices.get(pool) ?? -1;
  let idx: number;
  do {
    idx = Math.floor(Math.random() * messages.length);
  } while (idx === lastIdx);

  lastIndices.set(pool, idx);
  return messages[idx];
}
