/**
 * Exercise Registration — imports all exercise definitions and registers them.
 *
 * This file is imported at the top level of CameraScreen to ensure all
 * exercises are registered before any landmark processing starts.
 *
 * Each exercise's TTS and summary configs are merged into the global maps
 * during registration so ttsCoach.ts and setNotesSummary.ts have all entries
 * available at runtime.
 */

import { ExerciseRegistry } from '../ExerciseRegistry';
import { mergeTTSConfig } from '../../../backend/services/ttsMessagePools';
import { mergeSummaryConfig } from '../../setNotesSummary';
import type { ExerciseDefinition } from '../types';
import { barbellCurlDefinition } from './barbellCurl';
import { cablePushdownDefinition } from './cablePushdown';
import { latPulldownDefinition } from './latPulldown';
import { lateralRaiseDefinition } from './lateralRaise';
import { machineAbCrunchDefinition } from './machineAbCrunch';
import { pushupDefinition } from './pushup';

/** Register an exercise and merge its TTS + summary configs into the global maps. */
function registerExercise(definition: ExerciseDefinition): void {
  ExerciseRegistry.register(definition);
  mergeTTSConfig(definition.ttsConfig);
  mergeSummaryConfig(definition.summaryConfig);
}

// ── Register all exercises ──
registerExercise(barbellCurlDefinition);
registerExercise(cablePushdownDefinition);
registerExercise(latPulldownDefinition);
registerExercise(lateralRaiseDefinition);
registerExercise(machineAbCrunchDefinition);
registerExercise(pushupDefinition);
