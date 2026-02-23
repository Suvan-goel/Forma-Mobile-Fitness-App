/**
 * Custom hook for fetching insights for a specific metric.
 */

import { useState, useEffect, useCallback } from 'react';
import { insightsService, InsightsData } from '../services/api';

interface UseInsightsReturn {
  insights: string[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useInsights = (metric: keyof InsightsData): UseInsightsReturn => {
  const [insights, setInsights] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await insightsService.getInsights(metric);
      if (response.success) {
        setInsights(response.data);
      } else {
        setError(response.error || 'Failed to fetch insights');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return { insights, isLoading, error, refetch: fetchInsights };
};
