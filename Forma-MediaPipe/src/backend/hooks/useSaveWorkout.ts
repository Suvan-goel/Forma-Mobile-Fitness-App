/**
 * Custom hook for saving a workout to the backend.
 * Handles data transformation from CurrentWorkoutContext shape → API payload.
 */

import { useState, useCallback } from 'react';
import { workoutsService, CreateWorkoutPayload, rewardsService, socialService } from '../services/api';
import { generateSetSummary } from '../../utils/setNotesSummary';
import { calculateWorkoutPoints } from '../../utils/pointsCalculator';

interface WorkoutExerciseInput {
  name: string;
  sets: {
    reps: number;
    weight?: number;
    formScore: number;
    repFeedback?: string[];
    repFormScores?: number[];
  }[];
}

interface SaveWorkoutParams {
  name: string;
  durationSeconds: number;
  category?: string;
  notes?: string;
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
        notes: params.notes,
        exercises: params.exercises.map((ex, i) => ({
          name: ex.name,
          orderIndex: i,
          sets: ex.sets.map((s, j) => ({
            setNumber: j + 1,
            reps: s.reps,
            weight: s.weight ?? 0,
            formScore: s.formScore,
            notes: s.repFeedback && s.repFeedback.length > 0
              ? generateSetSummary(s.repFeedback, s.formScore, ex.name)
              : undefined,
          })),
        })),
      };

      const result = await workoutsService.create(payload);

      if (!result.success) {
        setError(result.error ?? 'Could not save workout.');
        return false;
      }

      // Award workout points — fire and forget, never blocks the save UX
      const pts = calculateWorkoutPoints(payload);
      const sessionId = result.data?.id;
      if (pts > 0 && sessionId) {
        rewardsService.awardWorkoutPoints(sessionId, pts).catch(() => {
          if (__DEV__) console.warn('[useSaveWorkout] Points award failed for session', sessionId);
        });
      }

      // Emit activity event — fire and forget
      if (sessionId) {
        const avgFormScore = payload.exercises.length > 0
          ? Math.round(payload.exercises.reduce((sum, ex) =>
              sum + ex.sets.reduce((s, set) => s + set.formScore, 0) / Math.max(ex.sets.length, 1), 0) / payload.exercises.length)
          : 0;
        socialService.createActivityEvent({
          eventType: 'workout_completed',
          payload: {
            session_id: sessionId,
            form_score: avgFormScore,
            duration: `${Math.round(payload.durationSeconds / 60)} min`,
            exercise_count: payload.exercises.length,
          },
          sourceId: sessionId,
        }).catch(() => {
          if (__DEV__) console.warn('[useSaveWorkout] Activity event failed for session', sessionId);
        });

        // Check for streak milestones — fire and forget
        socialService.emitStreakMilestoneIfNeeded().catch(() => {
          if (__DEV__) console.warn('[useSaveWorkout] Streak milestone check failed');
        });

        // Check for personal records — fire and forget
        socialService.emitPersonalRecordsIfNeeded(sessionId, payload.exercises).catch(() => {
          if (__DEV__) console.warn('[useSaveWorkout] Personal record check failed');
        });
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
