/**
 * Replay Runner -- plays recorded landmark sequences through ExerciseDefinition.
 *
 * Pure functions: no React and no native modules. Each frame is fed into the
 * same definition.update() implementation used by CameraScreen.
 */

import type { ExerciseDefinition } from '../types';
import { mapFeedbackMessagesToIssueIds } from './issueIds';
import type {
  FrameTrace,
  FsmTransition,
  LandmarkRecording,
  RepTrace,
  ReplayOptions,
  ReplayRepPrediction,
  ReplayResult,
  ReplayResultVerbose,
} from './types';

function timestampToDateNow(baseTimeMs: number, frameTimestamp: number): number {
  return baseTimeMs + frameTimestamp;
}

function buildRepPrediction(
  definition: ExerciseDefinition,
  repIndex: number,
  score: number,
  messages: string[],
  completedAt: number,
  startedAt: number | null,
): ReplayRepPrediction {
  return {
    repIndex,
    score,
    messages,
    issueIds: mapFeedbackMessagesToIssueIds(definition, messages),
    completedAt,
    startedAt,
  };
}

function resolveDefinition(
  definition: ExerciseDefinition,
  options?: ReplayOptions,
): ExerciseDefinition {
  const config = options?.heuristicConfig;
  if (!config || Object.keys(config).length === 0) return definition;
  if (!definition.createVariant) {
    throw new Error(
      `Exercise "${definition.name}" does not expose createVariant(); cannot replay a candidate heuristic config.`,
    );
  }
  return definition.createVariant(config);
}

export function replayRecording(
  definition: ExerciseDefinition,
  recording: LandmarkRecording,
  options?: ReplayOptions,
): ReplayResult {
  const activeDefinition = resolveDefinition(definition, options);
  let state = activeDefinition.createState();
  const repScores: number[] = [];
  const feedbackMessages: string[] = [];
  const reps: ReplayRepPrediction[] = [];
  let lastRepCount = 0;
  let repStartedAt: number | null = recording.frames[0]?.timestamp ?? null;
  const originalDateNow = Date.now;
  // Keep replay deterministic and compatible with existing synthetic fixtures:
  // frame timestamps are elapsed milliseconds from the start of the recording.
  const baseTimeMs = 0;

  try {
    for (const frame of recording.frames) {
      Date.now = () => timestampToDateNow(baseTimeMs, frame.timestamp);
      state = activeDefinition.update(frame.keypoints, state);

      if (state.repCount > lastRepCount) {
        if (state.lastRepResult) {
          const score = state.lastRepResult.score;
          const messages = state.lastRepResult.messages;
          repScores.push(score);
          feedbackMessages.push(...messages);
          reps.push(buildRepPrediction(
            activeDefinition,
            state.lastRepResult.repIndex,
            score,
            messages,
            frame.timestamp,
            repStartedAt,
          ));
        }
        repStartedAt = frame.timestamp;
        lastRepCount = state.repCount;
      }
    }
  } finally {
    Date.now = originalDateNow;
  }

  return { finalRepCount: state.repCount, repScores, feedbackMessages, reps };
}

/**
 * Extracts the current FSM phase string from debugInfo.
 * Exercises expose it as `phase`, `leftArmState`/`rightArmState`, etc.
 */
function extractPhase(debugInfo: Record<string, unknown>): string {
  if (typeof debugInfo.phase === 'string') return debugInfo.phase;
  if (typeof debugInfo.leftArmState === 'string' && typeof debugInfo.rightArmState === 'string') {
    return `L:${debugInfo.leftArmState} R:${debugInfo.rightArmState}`;
  }
  return 'UNKNOWN';
}

/**
 * Extracts numeric angle values from debugInfo for transition logging.
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
 * Verbose replay with frame traces and FSM transition grouping.
 */
export function replayRecordingVerbose(
  definition: ExerciseDefinition,
  recording: LandmarkRecording,
  options?: ReplayOptions,
): ReplayResultVerbose {
  const activeDefinition = resolveDefinition(definition, options);
  let state = activeDefinition.createState();
  const repScores: number[] = [];
  const feedbackMessages: string[] = [];
  const reps: ReplayRepPrediction[] = [];
  const frameTraces: FrameTrace[] = [];
  const fsmTransitions: FsmTransition[] = [];
  const repTraces: RepTrace[] = [];
  const originalDateNow = Date.now;

  let lastRepCount = 0;
  let lastPhase = extractPhase(state.debugInfo);
  let pendingTransitions: FsmTransition[] = [];
  let repStartedAt: number | null = recording.frames[0]?.timestamp ?? null;
  const baseTimeMs = 0;

  try {
    for (let i = 0; i < recording.frames.length; i++) {
      const frame = recording.frames[i];
      Date.now = () => timestampToDateNow(baseTimeMs, frame.timestamp);
      state = activeDefinition.update(frame.keypoints, state);

      const currentPhase = extractPhase(state.debugInfo);
      frameTraces.push({
        frameIndex: i,
        timestamp: frame.timestamp,
        phase: currentPhase,
        repCount: state.repCount,
        feedback: state.feedback,
        debugInfo: state.debugInfo,
      });

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
          const score = state.lastRepResult.score;
          const messages = state.lastRepResult.messages;
          const prediction = buildRepPrediction(
            activeDefinition,
            state.lastRepResult.repIndex,
            score,
            messages,
            frame.timestamp,
            repStartedAt,
          );
          repScores.push(score);
          feedbackMessages.push(...messages);
          reps.push(prediction);
          repTraces.push({ ...prediction, transitions: pendingTransitions });
        }
        pendingTransitions = [];
        repStartedAt = frame.timestamp;
        lastRepCount = state.repCount;
      }
    }
  } finally {
    Date.now = originalDateNow;
  }

  return {
    finalRepCount: state.repCount,
    repScores,
    feedbackMessages,
    reps,
    frameTraces,
    fsmTransitions,
    repTraces,
  };
}
