/**
 * Custom hook for analytics data management
 */

import { useState, useEffect, useCallback } from 'react';
import { analyticsService, AnalyticsData } from '../services/api';

interface UseAnalyticsReturn {
  analytics: AnalyticsData | null;
  isLoading: boolean;
  error: string | null;
  currentTimeRange: string;
  refetch: (timeRange?: string) => Promise<void>;
}

export const useAnalytics = (initialTimeRange: string = '1 week', weeklyTarget: number = 4): UseAnalyticsReturn => {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTimeRange, setCurrentTimeRange] = useState(initialTimeRange);

  const fetchAnalytics = useCallback(async (timeRange?: string) => {
    const rangeToUse = timeRange || currentTimeRange;
    if (timeRange) {
      setCurrentTimeRange(timeRange);
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await analyticsService.getAnalytics(rangeToUse, weeklyTarget);
      if (response.success) {
        setAnalytics(response.data);
      } else {
        setError(response.error || 'Failed to fetch analytics');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [currentTimeRange, weeklyTarget]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return { analytics, isLoading, error, currentTimeRange, refetch: fetchAnalytics };
};
