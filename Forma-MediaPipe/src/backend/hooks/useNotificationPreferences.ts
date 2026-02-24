/**
 * Hook for managing notification preferences via AsyncStorage.
 * Stores user's preference for rest timer notifications.
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIFICATION_PREFS_KEY = 'forma_notification_prefs';

interface NotificationPreferences {
  restTimerEnabled: boolean;
}

const defaults: NotificationPreferences = {
  restTimerEnabled: false,
};

export function useNotificationPreferences() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaults);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(NOTIFICATION_PREFS_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setPrefs({
            restTimerEnabled: typeof parsed.restTimerEnabled === 'boolean' ? parsed.restTimerEnabled : defaults.restTimerEnabled,
          });
        } catch { /* ignore corrupt data */ }
      }
      setIsLoading(false);
    });
  }, []);

  const updatePref = useCallback(<K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { prefs, updatePref, isLoading };
}
