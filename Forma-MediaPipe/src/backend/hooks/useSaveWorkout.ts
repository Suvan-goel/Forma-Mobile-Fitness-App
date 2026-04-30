/**
 * Custom hook for saving a workout to the backend.
 * Handles data transformation from CurrentWorkoutContext shape → API payload.
 */

import { useState, useCallback } from 'react';
import { workoutsService, CreateWorkoutPayload, rewardsService, socialService } from '../services/api';
import { generateSetSummary } from '../../utils/setNotesSummary';
import { calculateWorkoutPoints } from '../../utils/pointsCalculator';
import { saveRecording, linkWorkoutId } from '../services/videoLibrary';
import { cleanupTempRecording } from '../services/screenRecording';

let MediaLibrary: any = null;
try {
  MediaLibrary = require('expo-media-library');
} catch {
  // expo-media-library not available
}

interface WorkoutExerciseInput {
  name: string;
  sets: {
    reps: number;
    weight?: number;
    formScore: number;
    repFeedback?: string[];
    repFormScores?: number[];
    durationSeconds?: number;
    tempRecordingUrl?: string;
    saveRecordingToLibrary?: boolean;
    saveToCameraRoll?: boolean;
  }[];
}

interface SaveWorkoutParams {
  name: string;
  durationSeconds: number;
  category?: string;
  notes?: string;
  exercises: WorkoutExerciseInput[];
  shareToFeed?: boolean;
  /** CurrentWorkoutContext sessionId — used to link video recordings to the saved workout */
  workoutSessionId?: string;
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

      // Emit activity event — fire and forget when the user opts in
      if (sessionId && params.shareToFeed !== false) {
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

        // Save opted-in recordings to video library — fire and forget
        for (const ex of params.exercises) {
          for (let j = 0; j < ex.sets.length; j++) {
            const s = ex.sets[j];
            if (!s.tempRecordingUrl) continue;
            if (s.saveRecordingToLibrary !== false) {
              saveRecording(s.tempRecordingUrl, {
                sessionId: params.workoutSessionId || '',
                exerciseName: ex.name,
                setNumber: j + 1,
                durationSeconds: s.durationSeconds ?? 0,
                formScore: s.formScore,
                reps: s.reps,
              }).then((record) => {
                // Link to workout
                if (record && params.workoutSessionId) {
                  linkWorkoutId(params.workoutSessionId, sessionId).catch((err) => {
                    if (__DEV__) console.warn('[useSaveWorkout] Failed to link workout ID', err);
                  });
                }
                // Save to camera roll if requested
                if (s.saveToCameraRoll && record && MediaLibrary) {
                  MediaLibrary.requestPermissionsAsync().then(({ status }: { status: string }) => {
                    if (status === 'granted') {
                      MediaLibrary.saveToLibraryAsync(record.videoPath).catch((err: unknown) => {
                        if (__DEV__) console.warn('[useSaveWorkout] Failed to save to camera roll', err);
                      });
                    }
                  }).catch((err: unknown) => {
                    if (__DEV__) console.warn('[useSaveWorkout] Failed to request media library permissions', err);
                  });
                }
              }).catch(() => {
                if (__DEV__) console.warn('[useSaveWorkout] Recording save failed for', ex.name, 'set', j + 1);
              });
            } else {
              // Clean up opted-out recordings
              cleanupTempRecording(s.tempRecordingUrl).catch((err) => {
                if (__DEV__) console.warn('[useSaveWorkout] Failed to cleanup temp recording', err);
              });
            }
          }
        }
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
