/**
 * Replay Runner — plays a recorded landmark sequence through an ExerciseDefinition
 *
 * Pure function: no side effects, no React, no native modules.
 * Feed each frame into definition.update() and accumulate per-rep results.
 */

import type { ExerciseDefinition } from '../types';
import type {
  FsmTransition,
  LandmarkRecording,
  RepTrace,
  ReplayResult,
  ReplayResultVerbose,
} from './types';

export function replayRecording(
  definition: ExerciseDefinition,
  recording: LandmarkRecording,
): ReplayResult {
  let state = definition.createState();
  const repScores: number[] = [];
  const feedbackMessages: string[] = [];
  let lastRepCount = 0;

  for (const frame of recording.frames) {
    state = definition.update(frame.keypoints, state);

    if (state.repCount > lastRepCount) {
      if (state.lastRepResult) {
        repScores.push(state.lastRepResult.score);
        feedbackMessages.push(...state.lastRepResult.messages);
      }
      lastRepCount = state.repCount;
    }
  }

  return { finalRepCount: state.repCount, repScores, feedbackMessages };
}

/**
 * Extracts the current FSM phase string from debugInfo.
 * Exercises expose it as `phase`, `leftArmState`/`rightArmState` (barbell curl), etc.
 */
function extractPhase(debugInfo: Record<string, unknown>): string {
  if (typeof debugInfo.phase === 'string') return debugInfo.phase;
  // Barbell curl uses per-arm states instead of a single phase
  if (typeof debugInfo.leftArmState === 'string' && typeof debugInfo.rightArmState === 'string') {
    return `L:${debugInfo.leftArmState} R:${debugInfo.rightArmState}`;
  }
  return 'UNKNOWN';
}

/**
 * Extracts numeric angle values from debugInfo for logging at FSM transitions.
 * Pulls from `current` (barbell curl style) or top-level fields.
 */
function extractAngles(debugInfo: Record<string, unknown>): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const src =
    debugInfo.current != null && typeof debugInfo.current === 'object'
      ? (debugInfo.current as Record<string, unknown>)
      : debugInfo;
  for (const [key, val] of Object.entries(src)) {
    if (typeof val === 'number') result[key] = val;
    else if (val === null) result[key] = null;
  }
  return result;
}

/**
 * Verbose version of replayRecording — same rep counting logic, but also
 * captures every FSM phase transition and groups them per rep.
 *
 * Use this when you want to understand *why* a rep didn't count or what
 * angles were seen at each state transition.
 */
export function replayRecordingVerbose(
  definition: ExerciseDefinition,
  recording: LandmarkRecording,
): ReplayResultVerbose {
  let state = definition.createState();
  const repScores: number[] = [];
  const feedbackMessages: string[] = [];
  const fsmTransitions: FsmTransition[] = [];
  const repTraces: RepTrace[] = [];

  let lastRepCount = 0;
  let lastPhase = extractPhase(state.debugInfo);
  // Transitions accumulated since the last completed rep
  let pendingTransitions: FsmTransition[] = [];

  for (let i = 0; i < recording.frames.length; i++) {
    const frame = recording.frames[i];
    state = definition.update(frame.keypoints, state);

    const currentPhase = extractPhase(state.debugInfo);
    if (currentPhase !== lastPhase) {
      const transition: FsmTransition = {
        frameIndex: i,
        timestamp: frame.timestamp,
        fromPhase: lastPhase,
        toPhase: currentPhase,
        angles: extractAngles(state.debugInfo),
      };
      fsmTransitions.push(transition);
      pendingTransitions.push(transition);
      lastPhase = currentPhase;
    }

    if (state.repCount > lastRepCount) {
      if (state.lastRepResult) {
        repScores.push(state.lastRepResult.score);
        feedbackMessages.push(...state.lastRepResult.messages);
        repTraces.push({
          repIndex: state.lastRepResult.repIndex,
          score: state.lastRepResult.score,
          messages: state.lastRepResult.messages,
          transitions: pendingTransitions,
        });
      }
      pendingTransitions = [];
      lastRepCount = state.repCount;
    }
  }

  return {
    finalRepCount: state.repCount,
    repScores,
    feedbackMessages,
    fsmTransitions,
    repTraces,
  };
}
