/**
 * TTS Coaching Engine
 *
 * A coaching layer between the form heuristics and the ElevenLabs TTS service.
 * Decides WHAT to say, WHEN to say it, and manages playback state.
 *
 * Philosophy:
 * - Visual feedback = detailed, every rep, all issues (unchanged)
 * - TTS feedback = coach-like, selective, one issue max, adaptive praise
 *
 * Reusable across exercises — pass in the visual feedback messages and this
 * engine handles priority selection, throttling, and pool rotation.
 */

import { speakWithElevenLabs, isElevenLabsAvailable } from './elevenlabsTTS';
import {
  IssueType,
  ISSUE_POOLS,
  POSITIVE_POOLS,
  ISSUE_PRIORITY,
  FEEDBACK_TO_ISSUE,
  pickFromPool,
} from './ttsMessagePools';

// ============================================================================
// COACH STATE
// ============================================================================

interface CoachState {
  /** Is ElevenLabs currently speaking? */
  isSpeaking: boolean;
  /** Consecutive clean rep count */
  cleanStreak: number;
  /** Was the previous rep bad? (for transition detection) */
  prevRepWasBad: boolean;
  /** Adaptive praise interval — starts at 2, grows to 4 */
  praiseInterval: number;
  /** Total reps in current set (for summary) */
  totalRepsInSet: number;
  /** Last issue type spoken (for variety tracking) */
  lastSpokenIssue: IssueType | null;
}

const DEFAULT_STATE: CoachState = {
  isSpeaking: false,
  cleanStreak: 0,
  prevRepWasBad: false,
  praiseInterval: 2,
  totalRepsInSet: 0,
  lastSpokenIssue: null,
};

let state: CoachState = { ...DEFAULT_STATE };

// ============================================================================
// CORE API
// ============================================================================

/**
 * Call when a rep completes. Decides whether to speak and what to say.
 *
 * @param feedbackMessages - The visual feedback messages from evaluateForm().messages
 *   (e.g. ["Flex more at the top of the curl.", "Slow down — control the curl."])
 *   Pass an empty array for a clean rep.
 * @param score - The form score for this rep (0-100)
 */
export async function onRepCompleted(
  feedbackMessages: string[],
  score: number
): Promise<void> {
  if (!isElevenLabsAvailable()) return;

  state.totalRepsInSet++;

  // Map visual feedback strings to issue types
  const issues = feedbackMessages
    .map((msg) => FEEDBACK_TO_ISSUE[msg])
    .filter((issue): issue is IssueType => issue !== undefined);

  if (issues.length > 0) {
    // ── Bad rep ──
    // Pick the highest-priority issue
    const sorted = [...issues].sort(
      (a, b) => (ISSUE_PRIORITY[b] ?? 0) - (ISSUE_PRIORITY[a] ?? 0)
    );
    const topIssue = sorted[0];

    state.prevRepWasBad = true;
    state.cleanStreak = 0;
    state.praiseInterval = 2; // Reset adaptive interval

    const pool = ISSUE_POOLS[topIssue];
    if (pool) {
      state.lastSpokenIssue = topIssue;
      await trySpeak(pickFromPool(pool));
    }
  } else {
    // ── Clean rep ──
    state.cleanStreak++;

    if (state.prevRepWasBad) {
      // Transition: bad → good — always acknowledge the correction
      state.prevRepWasBad = false;
      await trySpeak(pickFromPool(POSITIVE_POOLS.transition_good));
    } else if (state.cleanStreak % state.praiseInterval === 0) {
      // Streak hit — praise
      await trySpeak(pickFromPool(POSITIVE_POOLS.positive));

      // Adapt interval: space out praise as streak grows
      if (state.cleanStreak >= 8) {
        state.praiseInterval = 4;
      } else if (state.cleanStreak >= 4) {
        state.praiseInterval = 3;
      }
    }
    // Otherwise: stay quiet — let the user work
  }
}

/**
 * Call when the set ends (user stops recording).
 * Waits for any current speech to finish, then speaks a brief summary.
 */
export async function onSetEnded(
  totalReps: number,
  avgFormScore: number
): Promise<void> {
  if (!isElevenLabsAvailable() || totalReps === 0) return;

  // Generate summary based on form quality
  let summary: string;
  if (avgFormScore >= 90) {
    summary = `Nice set. ${totalReps} reps, solid form.`;
  } else if (avgFormScore >= 70) {
    summary = `${totalReps} reps done. Form was decent — keep working on it.`;
  } else {
    summary = `Set done. ${totalReps} reps. Focus on cleaning up your form next set.`;
  }

  // Wait for any current speech to finish before speaking summary
  await waitForSilence(3000); // max 3s wait
  state.isSpeaking = true;
  try {
    await speakWithElevenLabs(summary);
  } catch {
    // Swallow — TTS failure shouldn't block navigation
  } finally {
    state.isSpeaking = false;
  }
}

/**
 * Reset state at the start of a new set.
 */
export function resetCoachState(): void {
  state = { ...DEFAULT_STATE };
}

/**
 * Stop any current speech (e.g. when user disables TTS).
 */
export function stopCoach(): void {
  state.isSpeaking = false;
  import('./elevenlabsTTS').then(({ stopSpeech }) => stopSpeech()).catch(() => {});
}

// ============================================================================
// INTERNAL
// ============================================================================

/**
 * Try to speak a message. If already speaking, drop the message (no interrupt).
 */
async function trySpeak(text: string): Promise<void> {
  if (!text || state.isSpeaking) return;

  state.isSpeaking = true;
  try {
    await speakWithElevenLabs(text);
  } catch {
    // Swallow — TTS failure shouldn't crash the app
  } finally {
    state.isSpeaking = false;
  }
}

/**
 * Wait for current speech to finish, with a timeout.
 */
function waitForSilence(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!state.isSpeaking || Date.now() - start > timeoutMs) {
        resolve();
      } else {
        setTimeout(check, 150);
      }
    };
    check();
  });
}
