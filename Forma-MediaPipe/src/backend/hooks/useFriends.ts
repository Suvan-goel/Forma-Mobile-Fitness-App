/**
 * Custom hook for friends data management
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  socialService,
  Friend,
  FriendRequest,
  SuggestedFriend,
} from '../services/api';

const STALE_MS = 30 * 1000; // 30 seconds
const SUGGESTIONS_STALE_MS = 10 * 60 * 1000; // 10 minutes

interface UseFriendsReturn {
  friends: Friend[];
  pendingRequests: FriendRequest[];
  suggestedFriends: SuggestedFriend[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  sendRequest: (targetUserId: string) => Promise<boolean>;
  respondToRequest: (friendshipId: string, accept: boolean) => Promise<boolean>;
  removeFriend: (friendshipId: string) => Promise<boolean>;
}

export const useFriends = (): UseFriendsReturn => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [suggestedFriends, setSuggestedFriends] = useState<SuggestedFriend[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedRef = useRef(0);
  const lastSuggestionsRef = useRef(0);

  const fetchFriends = useCallback(async (force: boolean = false) => {
    if (!force && Date.now() - lastFetchedRef.current < STALE_MS) return;

    setIsLoading(true);
    setError(null);
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        socialService.getFriends(),
        socialService.getPendingRequests(),
      ]);

      if (friendsRes.success) setFriends(friendsRes.data);
      if (requestsRes.success) setPendingRequests(requestsRes.data);

      if (!friendsRes.success) setError(friendsRes.error || 'Failed to fetch friends');
      lastFetchedRef.current = Date.now();

      // Fetch suggestions less frequently
      if (force || Date.now() - lastSuggestionsRef.current > SUGGESTIONS_STALE_MS) {
        const suggestionsRes = await socialService.getSuggestedFriends();
        if (suggestionsRes.success) setSuggestedFriends(suggestionsRes.data);
        lastSuggestionsRef.current = Date.now();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  const refetch = useCallback(async () => {
    await fetchFriends(true);
  }, [fetchFriends]);

  const sendRequest = useCallback(async (targetUserId: string): Promise<boolean> => {
    try {
      const response = await socialService.sendFriendRequest(targetUserId);
      if (response.success) {
        // Remove from suggestions
        setSuggestedFriends(prev => prev.filter(s => s.userId !== targetUserId));
      }
      return response.success;
    } catch {
      return false;
    }
  }, []);

  const respondToRequest = useCallback(async (friendshipId: string, accept: boolean): Promise<boolean> => {
    try {
      const response = await socialService.respondToRequest(friendshipId, accept);
      if (response.success) {
        // Remove from pending requests
        setPendingRequests(prev => prev.filter(r => r.friendshipId !== friendshipId));
        // Refresh friends list if accepted
        if (accept) await fetchFriends(true);
      }
      return response.success;
    } catch {
      return false;
    }
  }, [fetchFriends]);

  const removeFriend = useCallback(async (friendshipId: string): Promise<boolean> => {
    try {
      const response = await socialService.removeFriend(friendshipId);
      if (response.success) {
        setFriends(prev => prev.filter(f => f.friendshipId !== friendshipId));
      }
      return response.success;
    } catch {
      return false;
    }
  }, []);

  return {
    friends,
    pendingRequests,
    suggestedFriends,
    isLoading,
    error,
    refetch,
    sendRequest,
    respondToRequest,
    removeFriend,
  };
};
