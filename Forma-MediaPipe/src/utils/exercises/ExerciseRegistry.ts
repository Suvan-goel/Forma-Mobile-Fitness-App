/**
 * ExerciseRegistry — Singleton registry for exercise definitions.
 *
 * Pure data store: holds ExerciseDefinition objects keyed by name.
 * The register.ts file handles registration + TTS/summary config merging.
 */

import type { ExerciseDefinition } from './types';

const registry = new Map<string, ExerciseDefinition>();

export const ExerciseRegistry = {
  register(definition: ExerciseDefinition): void {
    if (registry.has(definition.name)) {
      throw new Error(`Exercise "${definition.name}" already registered`);
    }
    registry.set(definition.name, definition);
  },

  get(name: string): ExerciseDefinition | undefined {
    return registry.get(name);
  },

  has(name: string): boolean {
    return registry.has(name);
  },

  list(): string[] {
    return Array.from(registry.keys());
  },
};
