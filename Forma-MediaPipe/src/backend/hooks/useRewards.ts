/**
 * Custom hook for rewards data management
 */

import { useState, useEffect, useCallback } from 'react';
import { rewardsService, Reward, UserStats } from '../services/api';

interface UseRewardsReturn {
  rewards: Reward[];
  userStats: UserStats | null;
  userPoints: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  redeemReward: (rewardId: string) => Promise<{ success: boolean; message: string }>;
}

export const useRewards = (): UseRewardsReturn => {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [rewardsResponse, statsResponse] = await Promise.all([
        rewardsService.getRewards(),
        rewardsService.getUserStats(),
      ]);

      if (rewardsResponse.success && statsResponse.success) {
        setRewards(rewardsResponse.data);
        setUserStats(statsResponse.data);
      } else {
        setError('Failed to fetch rewards data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const userPoints = userStats
    ? userStats.formScore + userStats.consistencyScore
    : 0;

  const redeemReward = useCallback(async (rewardId: string) => {
    try {
      const response = await rewardsService.redeemReward(rewardId);
      if (response.success) {
        return response.data;
      }
      return { success: false, message: response.error || 'Failed to redeem reward' };
    } catch (err) {
      return { success: false, message: 'An error occurred while redeeming reward' };
    }
  }, []);

  return { rewards, userStats, userPoints, isLoading, error, refetch: fetchData, redeemReward };
};
