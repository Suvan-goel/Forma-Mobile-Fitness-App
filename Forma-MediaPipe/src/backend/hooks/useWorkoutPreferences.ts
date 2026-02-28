/**
 * Standalone hook for reading/writing workout preferences from AsyncStorage.
 * Used by the Settings screen (which is outside CameraSettingsProvider scope).
 * Shares the same AsyncStorage key as CameraSettingsContext.
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CAMERA_SETTINGS_KEY } from '../../frontend/contexts/CameraSettingsContext';

export type WeeklyTrainingTarget = '1-2' | '3-4' | '5+';

interface WorkoutPreferences {
  showFeedback: boolean;
  isTTSEnabled: boolean;
  showSkeletonOverlay: boolean;
  selectedTrainerId: string;
  weeklyTrainingTarget: WeeklyTrainingTarget;
}

const defaults: WorkoutPreferences = {
  showFeedback: true,
  isTTSEnabled: false,
  showSkeletonOverlay: false,
  selectedTrainerId: 'marcus',
  weeklyTrainingTarget: '3-4',
};

export function useWorkoutPreferences() {
  const [prefs, setPrefs] = useState<WorkoutPreferences>(defaults);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(CAMERA_SETTINGS_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setPrefs({
            showFeedback: typeof parsed.showFeedback === 'boolean' ? parsed.showFeedback : defaults.showFeedback,
            isTTSEnabled: typeof parsed.isTTSEnabled === 'boolean' ? parsed.isTTSEnabled : defaults.isTTSEnabled,
            showSkeletonOverlay: typeof parsed.showSkeletonOverlay === 'boolean' ? parsed.showSkeletonOverlay : defaults.showSkeletonOverlay,
            selectedTrainerId: typeof parsed.selectedTrainerId === 'string' ? parsed.selectedTrainerId : defaults.selectedTrainerId,
            weeklyTrainingTarget: (['1-2', '3-4', '5+'] as WeeklyTrainingTarget[]).includes(parsed.weeklyTrainingTarget) ? parsed.weeklyTrainingTarget : defaults.weeklyTrainingTarget,
          });
        } catch { /* ignore corrupt data */ }
      }
      setIsLoading(false);
    });
  }, []);

  // Merges only the changed key into the full stored JSON to avoid silently dropping
  // camera-only keys (debugMode, restTimerEnabled, restTimerDurationSeconds, etc.)
  const updatePref = useCallback(<K extends keyof WorkoutPreferences>(key: K, value: WorkoutPreferences[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    AsyncStorage.getItem(CAMERA_SETTINGS_KEY).then((raw) => {
      const stored = raw ? JSON.parse(raw) : {};
      return AsyncStorage.setItem(CAMERA_SETTINGS_KEY, JSON.stringify({ ...stored, [key]: value }));
    }).catch(() => {});
  }, []);

  return { prefs, updatePref, isLoading };
}
