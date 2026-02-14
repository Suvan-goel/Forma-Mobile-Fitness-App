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
  | 'asymmetry';

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
};

// ============================================================================
// FEEDBACK STRING → ISSUE TYPE MAPPING
// Maps the exact visual feedback strings from barbellCurlHeuristics.ts
// ============================================================================

export const FEEDBACK_TO_ISSUE: Record<string, IssueType> = {
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
