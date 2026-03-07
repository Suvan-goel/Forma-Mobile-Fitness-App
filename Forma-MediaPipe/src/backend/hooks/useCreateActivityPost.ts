/**
 * Hook for creating user-authored activity posts.
 */

import { useState, useCallback } from 'react';
import { socialService } from '../services/api';
import type { CreateActivityEventPayload } from '../services/api/types';

export function useCreateActivityPost() {
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createPost = useCallback(async (payload: CreateActivityEventPayload): Promise<boolean> => {
    setIsPosting(true);
    setError(null);
    try {
      const result = await socialService.createActivityEvent(payload);
      if (!result.success) {
        setError(result.error ?? 'Failed to create post');
        return false;
      }
      return true;
    } catch (e: any) {
      setError(e.message ?? 'Unexpected error');
      return false;
    } finally {
      setIsPosting(false);
    }
  }, []);

  return { createPost, isPosting, error };
}
