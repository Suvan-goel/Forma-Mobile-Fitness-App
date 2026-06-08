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

import {
  speakWithElevenLabs,
  isElevenLabsAvailable,
  playPreparedSpeech,
  cancelSpeech,
  type PreparedSpeech,
  type SpeechOptions,
} from './elevenlabsTTS';
import {
  POSITIVE_POOLS,
  type FeedbackIssueCandidate,
  getTopFeedbackIssueCandidate,
  pickFromPool,
  pickSetStartMessage,
  pickSetSummaryMessage,
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
  lastSpokenIssue: string | null;
  /** Last time a tracking-quality warning was spoken. */
  lastTrackingWarningAt: number | null;
}

const DEFAULT_STATE: CoachState = {
  isSpeaking: false,
  cleanStreak: 0,
  prevRepWasBad: false,
  praiseInterval: 2,
  totalRepsInSet: 0,
  lastSpokenIssue: null,
  lastTrackingWarningAt: null,
};

let state: CoachState = { ...DEFAULT_STATE };
let activeSpeechToken = 0;

type PendingCoachSpeech = {
  text: string;
  options: SpeechOptions;
  queuedAt: number;
};

const PENDING_COACH_SPEECH_MAX_AGE_MS = 8000;

let pendingCoachSpeech: PendingCoachSpeech | null = null;

function beginSpeech(): number {
  activeSpeechToken += 1;
  state.isSpeaking = true;
  return activeSpeechToken;
}

function finishSpeech(token: number): boolean {
  if (activeSpeechToken !== token) return false;
  state.isSpeaking = false;
  return true;
}

function invalidateActiveSpeech(): void {
  activeSpeechToken += 1;
  state.isSpeaking = false;
}

async function speakFeedback(candidate: FeedbackIssueCandidate): Promise<void> {
  state.lastSpokenIssue = candidate.issueType;
  await trySpeak(pickFromPool(candidate.pool));
}

function markBadFeedback(): void {
  state.prevRepWasBad = true;
  state.cleanStreak = 0;
  state.praiseInterval = 2;
}

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
  _score: number
): Promise<void> {
  if (!isElevenLabsAvailable()) return;

  state.totalRepsInSet++;

  const topFeedback = getTopFeedbackIssueCandidate(feedbackMessages);

  if (topFeedback) {
    // ── Bad rep ──
    markBadFeedback();
    await speakFeedback(topFeedback);
  } else {
    // ── Clean rep ──
    state.cleanStreak++;

    if (state.totalRepsInSet === 1) {
      // First rep of the set — always speak so the user knows the coach is active
      await trySpeak(pickFromPool(POSITIVE_POOLS.positive));
    } else if (state.prevRepWasBad) {
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
 * Call when a form issue is detected outside a completed rep, such as a
 * no-count partial rep. This speaks the highest-priority issue without
 * incrementing the set's completed-rep counter or triggering clean-rep praise.
 */
export async function onFormFeedback(feedbackMessages: string[]): Promise<void> {
  if (!isElevenLabsAvailable()) return;

  const topFeedback = getTopFeedbackIssueCandidate(feedbackMessages);
  if (!topFeedback) return;

  markBadFeedback();
  await speakFeedback(topFeedback);
}

/**
 * Call when pose tracking has been unreliable for long enough to guide setup.
 * This is intentionally rate-limited so it cannot chatter during a set.
 */
export async function onTrackingQualityWarning(message: string): Promise<void> {
  if (!isElevenLabsAvailable()) return;
  const trimmed = message.trim();
  if (!trimmed) return;

  await speakTrackingReliabilityWarning(trimmed);
}

/**
 * Call when a completed rep was counted but not form-scored because tracking
 * quality was unreliable. Shares the live tracking warning cooldown.
 */
export async function onUnscoredRep(message: string): Promise<void> {
  if (!isElevenLabsAvailable()) return;
  const trimmed = message.trim();
  if (!trimmed) return;

  await speakTrackingReliabilityWarning(trimmed);
}

async function speakTrackingReliabilityWarning(message: string): Promise<void> {
  const now = Date.now();
  if (state.lastTrackingWarningAt !== null && now - state.lastTrackingWarningAt < 10000) {
    return;
  }
  state.lastTrackingWarningAt = now;
  await trySpeak(message);
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

  const summary = pickSetSummaryMessage(totalReps, avgFormScore);

  // Wait for any current speech to finish before speaking summary
  await waitForSilence(3000); // max 3s wait
  pendingCoachSpeech = null;
  if (state.isSpeaking) {
    invalidateActiveSpeech();
    await cancelSpeech('coach').catch(() => {});
    await cancelSpeech('set-start').catch(() => {});
  }
  const speechToken = beginSpeech();
  try {
    await speakWithElevenLabs(summary, { purpose: 'summary' });
  } catch {
    // Swallow — TTS failure shouldn't block navigation
  } finally {
    finishSpeech(speechToken);
  }
}

/**
 * Reset state at the start of a new set.
 */
export function resetCoachState(): void {
  state = { ...DEFAULT_STATE };
  invalidateActiveSpeech();
  pendingCoachSpeech = null;
}

export function getSetStartMessage(exerciseName: string): string {
  return pickSetStartMessage(exerciseName);
}

/**
 * Call once when a new set begins (user taps record).
 * Speaks a short set-start cue with the exercise name.
 * Rotates across encouragement / form-reminder / neutral categories.
 */
export async function onSetStarted(
  exerciseName: string,
  messageOverride?: string,
  preparedSpeech?: PreparedSpeech | null
): Promise<void> {
  if (!isElevenLabsAvailable()) return;
  pendingCoachSpeech = null;
  invalidateActiveSpeech();
  await cancelSpeech('coach').catch(() => {});
  await cancelSpeech('summary').catch(() => {});
  await cancelSpeech('set-start').catch(() => {});
  const message = messageOverride ?? pickSetStartMessage(exerciseName);
  await trySpeak(message, { purpose: 'set-start' }, preparedSpeech);
}

/**
 * Stop any current speech (e.g. when user disables TTS).
 */
export function stopCoach(): void {
  invalidateActiveSpeech();
  pendingCoachSpeech = null;
  import('./elevenlabsTTS').then(({ stopSpeech }) => stopSpeech()).catch(() => {});
}

// ============================================================================
// INTERNAL
// ============================================================================

async function trySpeak(
  text: string,
  options: SpeechOptions = { purpose: 'coach' },
  preparedSpeech?: PreparedSpeech | null
): Promise<void> {
  const normalizedOptions: SpeechOptions = {
    ...options,
    purpose: options.purpose ?? 'coach',
  };

  if (!text) return;

  if (state.isSpeaking) {
    if (!preparedSpeech && normalizedOptions.purpose === 'coach') {
      pendingCoachSpeech = {
        text,
        options: normalizedOptions,
        queuedAt: Date.now(),
      };
    }
    return;
  }

  const completedAsCurrentSpeech = await speakNow(text, normalizedOptions, preparedSpeech);
  if (completedAsCurrentSpeech) {
    await flushPendingCoachSpeech();
  }
}

async function speakNow(
  text: string,
  options: SpeechOptions,
  preparedSpeech?: PreparedSpeech | null
): Promise<boolean> {
  const speechToken = beginSpeech();
  let completedAsCurrentSpeech = false;
  try {
    if (preparedSpeech) {
      await playPreparedSpeech(preparedSpeech, options);
    } else {
      await speakWithElevenLabs(text, options);
    }
  } catch {
    // Swallow — TTS failure shouldn't crash the app
  } finally {
    completedAsCurrentSpeech = finishSpeech(speechToken);
  }
  return completedAsCurrentSpeech;
}

async function flushPendingCoachSpeech(): Promise<void> {
  if (state.isSpeaking || !pendingCoachSpeech) return;

  const pending = pendingCoachSpeech;
  pendingCoachSpeech = null;
  if (Date.now() - pending.queuedAt > PENDING_COACH_SPEECH_MAX_AGE_MS) return;

  await trySpeak(pending.text, pending.options);
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
