/**
 * Custom hook for leaderboard data
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  socialService,
  LeaderboardMetric,
  TimeWindow,
  LeaderboardEntry,
} from '../services/api';

const STALE_MS = 5 * 60 * 1000; // 5 minutes

interface UseLeaderboardReturn {
  entries: LeaderboardEntry[];
  currentUser: LeaderboardEntry | null;
  totalParticipants: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useLeaderboard = (
  metric: LeaderboardMetric,
  timeWindow: TimeWindow,
): UseLeaderboardReturn => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [currentUser, setCurrentUser] = useState<LeaderboardEntry | null>(null);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedRef = useRef(0);
  const lastParamsRef = useRef('');

  const fetchLeaderboard = useCallback(async (force: boolean = false) => {
    const paramsKey = `${metric}-${timeWindow}`;
    const paramsChanged = paramsKey !== lastParamsRef.current;

    if (!force && !paramsChanged && Date.now() - lastFetchedRef.current < STALE_MS) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await socialService.getLeaderboard(metric, timeWindow);
      if (response.success) {
        setEntries(response.data.entries);
        setCurrentUser(response.data.currentUser);
        setTotalParticipants(response.data.totalParticipants);
        lastFetchedRef.current = Date.now();
        lastParamsRef.current = paramsKey;
      } else {
        setError(response.error || 'Failed to fetch leaderboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [metric, timeWindow]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const refetch = useCallback(async () => {
    await fetchLeaderboard(true);
  }, [fetchLeaderboard]);

  return { entries, currentUser, totalParticipants, isLoading, error, refetch };
};
