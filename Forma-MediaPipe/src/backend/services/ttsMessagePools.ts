/**
 * TTS Coaching Message Pools
 *
 * Short, coach-like voice cues organized by issue type.
 * Visual feedback (on-screen) is separate and unchanged — this file
 * only controls what the TTS voice says.
 *
 * Base issue types and their pools are defined here. Exercise-specific
 * FEEDBACK_TO_ISSUE entries are registered dynamically by each exercise
 * definition via mergeTTSConfig().
 */

// ============================================================================
// TYPES
// ============================================================================

/** Known issue types — new exercises may add additional string keys via mergeTTSConfig. */
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
  | 'depth_short'
  | 'lockout_short'
  | 'hip_sag'
  | 'hip_pike';

export type PositiveCategory = 'positive' | 'transition_good';
export type SetSummaryCategory = 'excellent' | 'solid' | 'needs_work';

export interface MessagePool {
  messages: string[];
}

// ============================================================================
// ISSUE POOLS — short, punchy, coach-like
// Base pools shared across exercises. New pools can be added via mergeTTSConfig.
// ============================================================================

export const ISSUE_POOLS: Record<string, MessagePool> = {
  incomplete_flex: {
    messages: [
      'Squeeze at the top.',
      'Curl all the way up.',
      'Finish the contraction up top.',
      'Bring it a bit higher.',
    ],
  },
  incomplete_extend: {
    messages: [
      'Extend all the way down.',
      'Let your arms straighten.',
      'Find the stretch at the bottom.',
      "Don't cut it short. Finish the rep.",
    ],
  },
  incomplete_rom: {
    messages: [
      'Use a bigger range.',
      'Give me the full range.',
      'Go all the way up and all the way down.',
    ],
  },
  shoulder_fail: {
    messages: [
      'Too much shoulder. Go lighter.',
      'Shoulders are taking over. Ease the load.',
      'Make it stricter. Drop the weight.',
    ],
  },
  shoulder_warn: {
    messages: [
      'Keep your elbows by your sides.',
      'Hold those elbows still.',
      'Elbows are drifting. Lock them in.',
      'Tighter elbows.',
    ],
  },
  torso_fail: {
    messages: [
      'Too much swing. Tighten it up.',
      'Brace hard and keep it strict.',
      'Less momentum. Make the muscle work.',
    ],
  },
  torso_warn: {
    messages: [
      'Stay upright and steady.',
      'Keep your torso quiet.',
      'Brace your core and stay tight.',
      'Less body swing.',
    ],
  },
  tempo_up: {
    messages: [
      'Slow it down.',
      'Move with control. No rushing.',
      'Slower on the way up.',
    ],
  },
  tempo_down: {
    messages: [
      'Control the way down.',
      'Lower with control.',
      "Don't drop it. Stay smooth.",
    ],
  },
  asymmetry: {
    messages: [
      'Even it out — both arms together.',
      'Your arms are out of sync.',
      'Match both sides.',
    ],
  },
  depth_short: {
    messages: [
      'Go a little deeper.',
      'Find a bit more depth.',
      'Lower with control.',
      'Not quite deep enough.',
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
      'Hips are dropping. Brace your core.',
      'Tighten your core and hold the line.',
      'Lift your hips slightly.',
      'Straight line from head to heels.',
    ],
  },
  hip_pike: {
    messages: [
      'Bring your hips down.',
      'Hips are too high. Flatten out.',
      'Less pike. Keep one straight line.',
    ],
  },
};

// ============================================================================
// POSITIVE POOLS
// ============================================================================

export const POSITIVE_POOLS: Record<PositiveCategory, MessagePool> = {
  positive: {
    messages: [
      'Nice rep. Keep that rhythm.',
      'Good control. Stay with it.',
      'Clean rep. Same again.',
      'That moved well.',
      'Solid form. Keep going.',
      "That's the shape. Keep it there.",
      'Looking strong. Stay smooth.',
      'Good control there.',
      'Yes, just like that.',
      'Nice. Own the next one.',
    ],
  },
  transition_good: {
    messages: [
      'There you go. Much better.',
      "That's the correction.",
      'Good adjustment. Keep it there.',
      "You've got it now. Stay consistent.",
      'Better form. Repeat that.',
      'Nice fix. Keep that control.',
    ],
  },
};

// ============================================================================
// SET-SUMMARY POOLS — spoken once when recording stops
// Templates use {reps} placeholder, replaced at runtime.
// ============================================================================

const SET_SUMMARY_POOLS: Record<SetSummaryCategory, MessagePool> = {
  excellent: {
    messages: [
      'Great set. {reps}, and the form stayed sharp.',
      'Nice work. {reps} with clean control.',
      'Excellent set. {reps}, smooth from start to finish.',
      'That was a strong one. {reps}, well controlled.',
    ],
  },
  solid: {
    messages: [
      'Good set. {reps}. Keep chasing cleaner reps.',
      '{reps} done. Solid work. A little cleaner next time.',
      'Nice effort. {reps}. Stay patient with the technique.',
      'Set complete. {reps}. Keep building that consistency.',
    ],
  },
  needs_work: {
    messages: [
      'Set done. {reps}. Next one, slow it down and clean it up.',
      '{reps} complete. Focus on control before intensity.',
      'Good effort. {reps}. Let the next set be cleaner.',
      'Set finished. {reps}. Reset, breathe, and tighten it up.',
    ],
  },
};

export function pickSetSummaryMessage(totalReps: number, avgFormScore: number): string {
  const category: SetSummaryCategory =
    avgFormScore >= 90 ? 'excellent' : avgFormScore >= 70 ? 'solid' : 'needs_work';
  const reps = `${totalReps} ${totalReps === 1 ? 'rep' : 'reps'}`;
  return pickFromPool(SET_SUMMARY_POOLS[category]).replace('{reps}', reps);
}

// ============================================================================
// SET-START POOLS — spoken once when a new set begins
// Templates use {exercise} placeholder, replaced at runtime.
// ============================================================================

export type SetStartCategory = 'encouragement' | 'form_reminder' | 'neutral';

const SET_START_POOLS: Record<SetStartCategory, MessagePool> = {
  encouragement: {
    messages: [
      "Alright, {exercise}. Let's get into it.",
      '{exercise} next. Take a breath and lock in.',
      'Here we go: {exercise}. Make these reps count.',
      '{exercise}. Strong and controlled.',
      'Okay, {exercise}. Start smooth.',
    ],
  },
  form_reminder: {
    messages: [
      '{exercise}. Keep the first rep clean.',
      '{exercise} coming up. Control it and breathe.',
      '{exercise}. Form first, then power.',
      '{exercise}. Smooth reps, start to finish.',
      '{exercise}. Stay braced and move well.',
    ],
  },
  neutral: {
    messages: [
      '{exercise}. Ready when you are.',
      'Next up: {exercise}.',
      '{exercise}. Set starts now.',
      '{exercise}. Lock it in.',
      '{exercise}. Start steady.',
    ],
  },
};

/** All set-start categories in rotation order. */
const SET_START_CATEGORIES: SetStartCategory[] = [
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
// Base priorities for known issue types. New priorities added via mergeTTSConfig.
// ============================================================================

export const ISSUE_PRIORITY: Record<string, number> = {
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
  depth_short: 30,
  lockout_short: 25,
  hip_sag: 35,
  hip_pike: 35,
};

// ============================================================================
// FEEDBACK STRING → ISSUE TYPE MAPPING
// Populated dynamically by exercise definitions via mergeTTSConfig().
// ============================================================================

export const FEEDBACK_TO_ISSUE: Record<string, string> = {
  'Use more range for this rep to count.': 'incomplete_rom',
};

export const FEEDBACK_PRIORITY: Record<string, number> = {};

/**
 * Exact feedback-string voice pools.
 *
 * These let runtime TTS stay exercise-specific without changing issueType keys,
 * which are also used to derive stable dataset issue ids.
 */
export const FEEDBACK_TTS_POOLS: Record<string, MessagePool> = {
  'Use more range for this rep to count.': {
    messages: [
      'Use more range for that rep.',
      'That one was short. Give me more range.',
      'Bigger range next rep, nice and controlled.',
      'Make the next one fuller.',
    ],
  },
};

export interface FeedbackIssueCandidate {
  feedback: string;
  issueType: string;
  priority: number;
  pool: MessagePool;
}

// ============================================================================
// MERGE — called by exercise registration to add feedback→issue mappings
// ============================================================================

/**
 * Merge exercise-specific TTS configuration into the global maps.
 * Called once per exercise at registration time (module load).
 *
 * - feedbackToIssue entries are added to FEEDBACK_TO_ISSUE
 * - feedbackPriorities entries override priority for exact feedback strings
 * - issueDefinitions (if any) are added to ISSUE_POOLS and ISSUE_PRIORITY
 *   only if the issue type doesn't already exist (no overwrites)
 */
export function mergeTTSConfig(config: {
  feedbackToIssue: Record<string, string>;
  feedbackMessages?: Record<string, string[]>;
  feedbackPriorities?: Record<string, number>;
  issueDefinitions?: Array<{ issueType: string; priority: number; messages: string[] }>;
}): void {
  for (const [feedback, issueType] of Object.entries(config.feedbackToIssue)) {
    FEEDBACK_TO_ISSUE[feedback] = issueType;
  }
  if (config.feedbackMessages) {
    for (const [feedback, messages] of Object.entries(config.feedbackMessages)) {
      FEEDBACK_TTS_POOLS[feedback] = { messages };
    }
  }
  if (config.feedbackPriorities) {
    for (const [feedback, priority] of Object.entries(config.feedbackPriorities)) {
      FEEDBACK_PRIORITY[feedback] = priority;
    }
  }
  if (config.issueDefinitions) {
    for (const def of config.issueDefinitions) {
      if (!ISSUE_POOLS[def.issueType]) {
        ISSUE_POOLS[def.issueType] = { messages: def.messages };
      }
      if (ISSUE_PRIORITY[def.issueType] === undefined) {
        ISSUE_PRIORITY[def.issueType] = def.priority;
      }
    }
  }
}

/**
 * Split visual feedback into individual mapped lines. Some screens pass
 * newline-joined feedback for display, while TTS maps exact single messages.
 */
export function normalizeFeedbackMessages(feedbackMessages: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const message of feedbackMessages) {
    for (const line of message.split(/\n+/)) {
      const trimmed = line.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }

  return normalized;
}

export function getFeedbackIssueCandidates(
  feedbackMessages: string[]
): FeedbackIssueCandidate[] {
  return normalizeFeedbackMessages(feedbackMessages)
    .map((feedback): FeedbackIssueCandidate | null => {
      const issueType = FEEDBACK_TO_ISSUE[feedback];
      if (!issueType) return null;

      const pool = FEEDBACK_TTS_POOLS[feedback] ?? ISSUE_POOLS[issueType];
      if (!pool) return null;

      return {
        feedback,
        issueType,
        priority: FEEDBACK_PRIORITY[feedback] ?? ISSUE_PRIORITY[issueType] ?? 0,
        pool,
      };
    })
    .filter((candidate): candidate is FeedbackIssueCandidate => candidate !== null);
}

export function getTopFeedbackIssueCandidate(
  feedbackMessages: string[]
): FeedbackIssueCandidate | null {
  const candidates = getFeedbackIssueCandidates(feedbackMessages);
  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => b.priority - a.priority)[0];
}

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
