/**
 * Exercise Framework — public API.
 *
 * Re-exports the registry and types so consumers can import from
 * one location: `../../utils/exercises`.
 */

export { ExerciseRegistry } from './ExerciseRegistry';
export type {
  ExerciseState,
  ExerciseDefinition,
  RepResult,
  ExerciseTTSConfig,
} from './types';
