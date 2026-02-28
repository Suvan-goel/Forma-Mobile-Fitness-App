/**
 * Custom hook for 1v1 friend comparison stats
 */

import { useState, useEffect, useCallback } from 'react';
import { socialService, ComparisonData } from '../services/api';

interface UseFriendComparisonReturn {
  comparison: ComparisonData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useFriendComparison = (friendId: string): UseFriendComparisonReturn => {
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchComparison = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await socialService.compareFriend(friendId);
      if (response.success) {
        setComparison(response.data);
      } else {
        setError(response.error || 'Failed to fetch comparison');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [friendId]);

  useEffect(() => {
    fetchComparison();
  }, [fetchComparison]);

  return { comparison, isLoading, error, refetch: fetchComparison };
};
