/**
 * Hook for reading and updating the user's social visibility level.
 */

import { useState, useEffect, useCallback } from 'react';
import { socialService } from '../services/api';

export type PrivacyLevel = 'public' | 'friends' | 'private';

interface UsePrivacyLevelReturn {
  level: PrivacyLevel;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateLevel: (level: PrivacyLevel) => Promise<void>;
}

export const usePrivacyLevel = (): UsePrivacyLevelReturn => {
  const [level, setLevel] = useState<PrivacyLevel>('friends');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await socialService.getPrivacyLevel();
      if (!cancelled) {
        if (result.success) setLevel(result.data);
        setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateLevel = useCallback(async (newLevel: PrivacyLevel) => {
    setIsSaving(true);
    setError(null);
    const prev = level;
    setLevel(newLevel); // optimistic update
    const result = await socialService.updatePrivacyLevel(newLevel);
    if (!result.success) {
      setLevel(prev); // revert on failure
      setError(result.error ?? 'Failed to save visibility setting');
    }
    setIsSaving(false);
  }, [level]);

  return { level, isLoading, isSaving, error, updateLevel };
};
