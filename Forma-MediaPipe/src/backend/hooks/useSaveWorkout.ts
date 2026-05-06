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
import type { RepTrackingQuality, SetTrackingQualitySummary } from '../../utils/exercises';

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
    repTrackingQualities?: RepTrackingQuality[];
    trackingQuality?: SetTrackingQualitySummary;
    scoredRepCount?: number;
    unscoredRepCount?: number;
    durationSeconds?: number;
    tempRecordingUrl?: string;
    saveRecordingToLibrary?: boolean;
    saveToCameraRoll?: boolean;
    isManual?: boolean;
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
      const recordedFormScores = params.exercises.flatMap((ex) =>
        ex.sets
          .filter((set) => !set.isManual && set.formScore > 0)
          .map((set) => set.formScore)
      );
      const recordedAvgFormScore = recordedFormScores.length > 0
        ? Math.round(recordedFormScores.reduce((sum, score) => sum + score, 0) / recordedFormScores.length)
        : 0;

      const payload: CreateWorkoutPayload = {
        name: params.name.trim(),
        date: new Date(),
        durationSeconds: params.durationSeconds,
        category: params.category,
        notes: params.notes,
        exercises: params.exercises.map((ex, i) => ({
          name: ex.name,
          orderIndex: i,
          sets: ex.sets.map((s, j) => {
            const formScore = s.isManual ? recordedAvgFormScore : s.formScore;
            const generatedNotes = s.isManual
              ? 'Manual set - no form feedback or recording.'
              : s.repFeedback && s.repFeedback.length > 0
                ? generateSetSummary(s.repFeedback, s.formScore, ex.name)
                : undefined;
            const trackingNotes = s.trackingQuality?.message;
            return {
              setNumber: j + 1,
              reps: s.reps,
              weight: s.weight ?? 0,
              formScore,
              notes: [generatedNotes, trackingNotes].filter(Boolean).join('\n') || undefined,
              isManual: s.isManual,
            };
          }),
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
        socialService.createActivityEvent({
          eventType: 'workout_completed',
          payload: {
            session_id: sessionId,
            form_score: recordedAvgFormScore,
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

      // Save opted-in recordings independently of social sharing/privacy.
      // These are user-selected local persistence options, not feed activity.
      if (sessionId) {
        const recordingSaveTasks: Promise<void>[] = [];
        for (const ex of params.exercises) {
          for (let j = 0; j < ex.sets.length; j++) {
            const s = ex.sets[j];
            if (!s.tempRecordingUrl) continue;

            const shouldSaveRecording = s.saveRecordingToLibrary !== false || s.saveToCameraRoll === true;
            if (shouldSaveRecording) {
              recordingSaveTasks.push((async () => {
                const record = await saveRecording(s.tempRecordingUrl!, {
                  sessionId: params.workoutSessionId || '',
                  exerciseName: ex.name,
                  setNumber: j + 1,
                  durationSeconds: s.durationSeconds ?? 0,
                  formScore: s.formScore,
                  reps: s.reps,
                });

                if (!record) {
                  if (__DEV__) console.warn('[useSaveWorkout] Recording save returned no record for', ex.name, 'set', j + 1);
                  return;
                }

                if (params.workoutSessionId) {
                  await linkWorkoutId(params.workoutSessionId, sessionId).catch((err) => {
                    if (__DEV__) console.warn('[useSaveWorkout] Failed to link workout ID', err);
                  });
                }

                if (s.saveToCameraRoll && MediaLibrary) {
                  try {
                    const { status } = await MediaLibrary.requestPermissionsAsync();
                    if (status === 'granted') {
                      await MediaLibrary.saveToLibraryAsync(record.videoPath);
                    } else if (__DEV__) {
                      console.warn('[useSaveWorkout] Camera roll permission not granted');
                    }
                  } catch (err: unknown) {
                    if (__DEV__) console.warn('[useSaveWorkout] Failed to save to camera roll', err);
                  }
                }
              })().catch((err) => {
                if (__DEV__) console.warn('[useSaveWorkout] Recording save failed for', ex.name, 'set', j + 1, err);
              }));
            } else {
              // Clean up opted-out recordings
              cleanupTempRecording(s.tempRecordingUrl).catch((err) => {
                if (__DEV__) console.warn('[useSaveWorkout] Failed to cleanup temp recording', err);
              });
            }
          }
        }

        if (recordingSaveTasks.length > 0) {
          await Promise.allSettled(recordingSaveTasks);
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
