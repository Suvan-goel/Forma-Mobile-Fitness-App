/**
 * Custom hook for followers/following data management
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  socialService,
  FollowRelation,
  FollowCounts,
} from '../services/api';

const STALE_MS = 30 * 1000; // 30 seconds

interface UseFollowingReturn {
  followers: FollowRelation[];
  following: FollowRelation[];
  counts: FollowCounts;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  followUser: (targetUserId: string) => Promise<boolean>;
  unfollowUser: (targetUserId: string) => Promise<boolean>;
  isFollowingUser: (targetUserId: string) => boolean;
}

export const useFollowing = (): UseFollowingReturn => {
  const [followers, setFollowers] = useState<FollowRelation[]>([]);
  const [following, setFollowing] = useState<FollowRelation[]>([]);
  const [counts, setCounts] = useState<FollowCounts>({ followerCount: 0, followingCount: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedRef = useRef(0);

  const fetchAll = useCallback(async (force: boolean = false) => {
    if (!force && Date.now() - lastFetchedRef.current < STALE_MS) return;

    setIsLoading(true);
    setError(null);
    try {
      const [followersRes, followingRes, countsRes] = await Promise.all([
        socialService.getFollowers(),
        socialService.getFollowing(),
        socialService.getFollowCounts(),
      ]);

      if (followersRes.success) setFollowers(followersRes.data);
      if (followingRes.success) setFollowing(followingRes.data);
      if (countsRes.success) setCounts(countsRes.data);

      if (!followersRes.success && !followingRes.success) {
        setError('Failed to fetch follow data');
      }
      lastFetchedRef.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const refetch = useCallback(async () => {
    await fetchAll(true);
  }, [fetchAll]);

  const followUser = useCallback(async (targetUserId: string): Promise<boolean> => {
    try {
      const response = await socialService.followUser(targetUserId);
      if (response.success) {
        await fetchAll(true);
      }
      return response.success;
    } catch {
      return false;
    }
  }, [fetchAll]);

  const unfollowUser = useCallback(async (targetUserId: string): Promise<boolean> => {
    try {
      const response = await socialService.unfollowUser(targetUserId);
      if (response.success) {
        // Optimistic update: remove from following list immediately
        setFollowing(prev => prev.filter(f => f.userId !== targetUserId));
        setCounts(prev => ({
          ...prev,
          followingCount: Math.max(0, prev.followingCount - 1),
        }));
      }
      return response.success;
    } catch {
      return false;
    }
  }, []);

  const isFollowingUser = useCallback((targetUserId: string): boolean => {
    return following.some(f => f.userId === targetUserId);
  }, [following]);

  return {
    followers,
    following,
    counts,
    isLoading,
    error,
    refetch,
    followUser,
    unfollowUser,
    isFollowingUser,
  };
};
