/**
 * Custom hook for activity feed with cursor-based pagination
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { socialService, ActivityEvent, ActivityFilter } from '../services/api';

const STALE_MS = 60 * 1000; // 1 minute

interface UseActivityFeedReturn {
  events: ActivityEvent[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

export const useActivityFeed = (filter: ActivityFilter = 'all'): UseActivityFeedReturn => {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const lastFetchedRef = useRef(0);
  const lastFilterRef = useRef(filter);

  const fetchFeed = useCallback(async (force: boolean = false) => {
    const filterChanged = filter !== lastFilterRef.current;
    if (!force && !filterChanged && Date.now() - lastFetchedRef.current < STALE_MS) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await socialService.getActivityFeed(filter, null, 20);
      if (response.success) {
        setEvents(response.data.events);
        cursorRef.current = response.data.nextCursor;
        setHasMore(response.data.hasMore);
        lastFetchedRef.current = Date.now();
        lastFilterRef.current = filter;
      } else {
        setError(response.error || 'Failed to fetch activity feed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const response = await socialService.getActivityFeed(filter, cursorRef.current, 20);
      if (response.success) {
        setEvents(prev => [...prev, ...response.data.events]);
        cursorRef.current = response.data.nextCursor;
        setHasMore(response.data.hasMore);
      }
    } catch {
      // Silently fail on load more
    } finally {
      setIsLoadingMore(false);
    }
  }, [filter, hasMore, isLoadingMore]);

  const refetch = useCallback(async () => {
    await fetchFeed(true);
  }, [fetchFeed]);

  return { events, isLoading, isLoadingMore, error, hasMore, loadMore, refetch };
};
