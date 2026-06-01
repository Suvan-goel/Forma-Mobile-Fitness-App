/**
 * Hook for updating user profile (display name, avatar).
 * Wraps userService.updateUser() and userService.uploadAvatar().
 */

import { useState, useCallback } from 'react';
import { userService } from '../services/api';
import type { User } from '../services/api/types';
import { setUserCache } from './useUser';

export function useUpdateUser() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateProfile = useCallback(async (updates: Partial<User>) => {
    setIsUpdating(true);
    setError(null);
    try {
      const response = await userService.updateUser(updates);
      if (response.success) {
        setUserCache(response.data);
      } else {
        setError(response.error ?? 'Update failed');
      }
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      return { data: {} as User, success: false, error: msg };
    } finally {
      setIsUpdating(false);
    }
  }, []);

  const uploadAvatar = useCallback(async (localUri: string) => {
    setIsUpdating(true);
    setError(null);
    try {
      const response = await userService.uploadAvatar(localUri);
      if (!response.success) setError(response.error ?? 'Upload failed');
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      return { data: '', success: false, error: msg };
    } finally {
      setIsUpdating(false);
    }
  }, []);

  return { updateProfile, uploadAvatar, isUpdating, error };
}
