/**
 * Standalone hook for reading/writing workout preferences from AsyncStorage.
 * Used by the Settings screen (which is outside CameraSettingsProvider scope).
 * Shares the same AsyncStorage key as CameraSettingsContext.
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CAMERA_SETTINGS_KEY } from '../../frontend/contexts/CameraSettingsContext';

interface WorkoutPreferences {
  showFeedback: boolean;
  isTTSEnabled: boolean;
  showSkeletonOverlay: boolean;
}

const defaults: WorkoutPreferences = {
  showFeedback: true,
  isTTSEnabled: false,
  showSkeletonOverlay: false,
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
          });
        } catch { /* ignore corrupt data */ }
      }
      setIsLoading(false);
    });
  }, []);

  const updatePref = useCallback(<K extends keyof WorkoutPreferences>(key: K, value: WorkoutPreferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem(CAMERA_SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { prefs, updatePref, isLoading };
}
