/**
 * Replay Runner — plays a recorded landmark sequence through an ExerciseDefinition
 *
 * Pure function: no side effects, no React, no native modules.
 * Feed each frame into definition.update() and accumulate per-rep results.
 */

import type { ExerciseDefinition } from '../types';
import type { LandmarkRecording, ReplayResult } from './types';

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
