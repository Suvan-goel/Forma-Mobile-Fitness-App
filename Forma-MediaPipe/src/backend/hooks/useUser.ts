/**
 * Custom hook for user data management.
 *
 * Uses a module-level cache + subscriber set so all `useUser()` callers share
 * one source of truth — when one screen updates the profile, every other
 * screen sees the new value immediately. Without this, each hook instance
 * held its own copy and only the screen that triggered the update refreshed.
 */

import { useState, useEffect, useCallback } from 'react';
import { userService, User } from '../services/api';

interface UseUserReturn {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

let cachedUser: User | null = null;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<(user: User | null) => void>();

function notify() {
  subscribers.forEach((fn) => fn(cachedUser));
}

export function setUserCache(user: User | null): void {
  cachedUser = user;
  notify();
}

export const useUser = (): UseUserReturn => {
  const [user, setUser] = useState<User | null>(cachedUser);
  const [isLoading, setIsLoading] = useState(cachedUser === null);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    setError(null);
    if (cachedUser === null) setIsLoading(true);

    if (!inFlight) {
      inFlight = (async () => {
        try {
          const response = await userService.getCurrentUser();
          if (response.success) {
            cachedUser = response.data;
            notify();
          } else {
            setError(response.error || 'Failed to fetch user');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'An error occurred');
        }
      })().finally(() => {
        inFlight = null;
      });
    }

    await inFlight;
    setIsLoading(false);
  }, []);

  useEffect(() => {
    subscribers.add(setUser);
    if (cachedUser === null) {
      fetchUser();
    }
    return () => {
      subscribers.delete(setUser);
    };
  }, [fetchUser]);

  return { user, isLoading, error, refetch: fetchUser };
};
