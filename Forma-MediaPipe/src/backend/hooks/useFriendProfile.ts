/**
 * Custom hook for fetching a friend's public profile
 */

import { useState, useEffect, useCallback } from 'react';
import { socialService, FriendProfileData } from '../services/api';

interface UseFriendProfileReturn {
  profile: FriendProfileData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useFriendProfile = (userId: string): UseFriendProfileReturn => {
  const [profile, setProfile] = useState<FriendProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await socialService.getFriendProfile(userId);
      if (response.success) {
        setProfile(response.data);
      } else {
        setError(response.error || 'Failed to fetch profile');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return { profile, isLoading, error, refetch: fetchProfile };
};
