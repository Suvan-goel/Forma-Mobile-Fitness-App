/**
 * Hook for reading the user's subscription status.
 * Currently returns mock data (free plan). When a real subscription
 * backend is added, this hook will wrap the service call.
 */

import { useState, useEffect, useCallback } from 'react';
import type { SubscriptionStatus } from '../services/api/types';
import { mockSubscriptionStatus } from '../services/mock/data/subscription.mock';
import { mockDelay } from '../services/mock/delay';

interface UseSubscriptionReturn {
  subscription: SubscriptionStatus | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useSubscription = (): UseSubscriptionReturn => {
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await mockDelay(200);
      setSubscription(mockSubscriptionStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscription');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { subscription, isLoading, error, refetch: fetchData };
};
