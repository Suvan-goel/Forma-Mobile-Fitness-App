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
import { getFeedbackIssueIdMap } from '../replay';
import { mergeTTSConfig } from '../../../backend/services/ttsMessagePools';
import { mergeSummaryConfig } from '../../setNotesSummary';
import type { ExerciseDefinition } from '../types';
import { barbellCurlDefinition } from './barbellCurl';
import { cablePushdownDefinition } from './cablePushdown';
import { cableRowDefinition } from './cableRow';
import { latPulldownDefinition } from './latPulldown';
import { lateralRaiseDefinition } from './lateralRaise';
import { legExtensionsDefinition } from './legExtensions';
import { lyingLegCurlDefinition } from './lyingLegCurl';
import { machineAbCrunchDefinition } from './machineAbCrunch';
import { pushupDefinition } from './pushup';
import { squatDefinition } from './squat';

/** Register an exercise and merge its TTS + summary configs into the global maps. */
function registerExercise(definition: ExerciseDefinition): void {
  const normalizedDefinition: ExerciseDefinition = {
    ...definition,
    feedbackToIssueId: getFeedbackIssueIdMap(definition),
  };

  ExerciseRegistry.register(normalizedDefinition);
  mergeTTSConfig(normalizedDefinition.ttsConfig);
  mergeSummaryConfig(normalizedDefinition.summaryConfig);
}

// ── Register all exercises ──
registerExercise(barbellCurlDefinition);
registerExercise(cablePushdownDefinition);
registerExercise(cableRowDefinition);
registerExercise(latPulldownDefinition);
registerExercise(lateralRaiseDefinition);
registerExercise(legExtensionsDefinition);
registerExercise(lyingLegCurlDefinition);
registerExercise(machineAbCrunchDefinition);
registerExercise(pushupDefinition);
registerExercise(squatDefinition);
