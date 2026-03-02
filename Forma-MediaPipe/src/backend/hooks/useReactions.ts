/**
 * Custom hook for managing reactions on activity feed events.
 * Supports optimistic toggle with rollback on failure.
 * One reaction per user per event — tapping a new reaction replaces the old one.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { socialService } from '../services/api';
import { ReactionType, EventReactions } from '../services/api/types';

const EMPTY_REACTIONS: EventReactions = {
  counts: { like: 0, muscle: 0, fire: 0, clap: 0 },
  userReaction: null,
};

interface UseReactionsReturn {
  reactions: Record<string, EventReactions>;
  toggleReaction: (eventId: string, reactionType: ReactionType) => void;
  isLoading: boolean;
}

export const useReactions = (eventIds: string[]): UseReactionsReturn => {
  const [reactions, setReactions] = useState<Record<string, EventReactions>>({});
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchedIdsRef = useRef<string>('');

  // Fetch reactions when eventIds change
  useEffect(() => {
    if (eventIds.length === 0) return;

    const idKey = eventIds.join(',');
    if (idKey === lastFetchedIdsRef.current) return;

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      const response = await socialService.getReactionsForEvents(eventIds);
      if (!cancelled && response.success) {
        setReactions(prev => ({ ...prev, ...response.data }));
        lastFetchedIdsRef.current = idKey;
      }
      if (!cancelled) setIsLoading(false);
    })();

    return () => { cancelled = true; };
  }, [eventIds]);

  const toggleReaction = useCallback((eventId: string, reactionType: ReactionType) => {
    // Snapshot for rollback
    let snapshot: EventReactions | undefined;

    // Optimistic update
    setReactions(prev => {
      const current = prev[eventId] ?? EMPTY_REACTIONS;
      snapshot = current;
      const prevUserReaction = current.userReaction;
      const newCounts = { ...current.counts };

      if (prevUserReaction === reactionType) {
        // Same reaction — remove it
        newCounts[reactionType] = Math.max(0, newCounts[reactionType] - 1);
        return { ...prev, [eventId]: { counts: newCounts, userReaction: null } };
      }

      if (prevUserReaction !== null) {
        // Different reaction — decrement old, increment new
        newCounts[prevUserReaction] = Math.max(0, newCounts[prevUserReaction] - 1);
      }
      newCounts[reactionType] = newCounts[reactionType] + 1;
      return { ...prev, [eventId]: { counts: newCounts, userReaction: reactionType } };
    });

    // Fire API call, revert on failure
    socialService.toggleReaction(eventId, reactionType).then(response => {
      if (!response.success && snapshot) {
        setReactions(prev => ({ ...prev, [eventId]: snapshot! }));
      }
    });
  }, []);

  return { reactions, toggleReaction, isLoading };
};
