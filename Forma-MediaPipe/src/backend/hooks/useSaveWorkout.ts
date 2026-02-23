/**
 * Custom hook for saving a workout to the backend.
 * Handles data transformation from CurrentWorkoutContext shape → API payload.
 */

import { useState, useCallback } from 'react';
import { workoutsService, CreateWorkoutPayload } from '../services/api';

interface WorkoutExerciseInput {
  name: string;
  sets: {
    reps: number;
    weight?: number;
    formScore: number;
  }[];
}

interface SaveWorkoutParams {
  name: string;
  durationSeconds: number;
  category?: string;
  exercises: WorkoutExerciseInput[];
}

interface UseSaveWorkoutReturn {
  isSaving: boolean;
  error: string | null;
  saveWorkout: (params: SaveWorkoutParams) => Promise<boolean>;
}

export const useSaveWorkout = (): UseSaveWorkoutReturn => {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveWorkout = useCallback(async (params: SaveWorkoutParams): Promise<boolean> => {
    setIsSaving(true);
    setError(null);
    try {
      const payload: CreateWorkoutPayload = {
        name: params.name.trim(),
        date: new Date(),
        durationSeconds: params.durationSeconds,
        category: params.category,
        exercises: params.exercises.map((ex, i) => ({
          name: ex.name,
          orderIndex: i,
          sets: ex.sets.map((s, j) => ({
            setNumber: j + 1,
            reps: s.reps,
            weight: s.weight ?? 0,
            formScore: s.formScore,
          })),
        })),
      };

      const result = await workoutsService.create(payload);

      if (!result.success) {
        setError(result.error ?? 'Could not save workout.');
        return false;
      }
      return true;
    } catch (e: any) {
      setError(e?.message ?? 'Could not save workout.');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  return { isSaving, error, saveWorkout };
};
