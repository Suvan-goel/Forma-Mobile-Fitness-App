/**
 * Custom hook for rewards data management
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { rewardsService, Reward, UserStats, socialService } from '../services/api';
import { useWorkoutPreferences } from './useWorkoutPreferences';

const EMITTED_BADGES_KEY = '@forma_emitted_badge_events';

const WEEKLY_TARGET_MAP: Record<string, number> = { '1-2': 2, '3-4': 4, '5+': 6 };

interface UseRewardsReturn {
  rewards: Reward[];
  userStats: UserStats | null;
  userPoints: number;
  redeemedBadgeIds: string[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  redeemReward: (rewardId: string) => Promise<{ success: boolean; message: string }>;
}

export const useRewards = (): UseRewardsReturn => {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [redeemedBadgeIds, setRedeemedBadgeIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { prefs, isLoading: prefsLoading } = useWorkoutPreferences();
  const weeklyTarget = WEEKLY_TARGET_MAP[prefs.weeklyTrainingTarget] ?? 4;

  const fetchData = useCallback(async () => {
    if (prefsLoading) return; // wait for AsyncStorage before checking consistency
    setIsLoading(true);
    setError(null);
    try {
      const [rewardsResponse, statsResponse, redeemedResponse] = await Promise.all([
        rewardsService.getRewards(),
        rewardsService.getUserStats(weeklyTarget),
        rewardsService.getRedeemedBadges(),
      ]);

      if (rewardsResponse.success && statsResponse.success) {
        setRewards(rewardsResponse.data);
        setUserStats(statsResponse.data);
        if (redeemedResponse.success) setRedeemedBadgeIds(redeemedResponse.data);

        // Emit badge_earned activity events for newly unlocked badges (fire and forget)
        const earnedIds = statsResponse.data.earnedBadgeIds;
        if (earnedIds.length > 0) {
          AsyncStorage.getItem(EMITTED_BADGES_KEY).then(raw => {
            const emitted = new Set<string>(raw ? JSON.parse(raw) : []);
            const newBadges = earnedIds.filter(id => !emitted.has(id));
            if (newBadges.length === 0) return;

            const rewardMap = new Map(rewardsResponse.data.map((r: Reward) => [r.id, r]));
            newBadges.forEach(badgeId => {
              const reward = rewardMap.get(badgeId);
              if (reward) {
                socialService.createActivityEvent({
                  eventType: 'badge_earned',
                  payload: { badge_id: badgeId, badge_name: reward.title },
                  sourceId: badgeId,
                }).catch((err) => {
                  if (__DEV__) console.warn('[useRewards] Failed to emit badge event', badgeId, err);
                });
              }
              emitted.add(badgeId);
            });

            AsyncStorage.setItem(EMITTED_BADGES_KEY, JSON.stringify([...emitted])).catch((err) => {
              if (__DEV__) console.warn('[useRewards] Failed to persist emitted badges', err);
            });
          }).catch((err) => {
            if (__DEV__) console.warn('[useRewards] Failed to read emitted badges', err);
          });
        }
      } else {
        setError('Failed to fetch rewards data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [prefsLoading, weeklyTarget]);

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
        setRedeemedBadgeIds(prev => prev.includes(rewardId) ? prev : [...prev, rewardId]);
        return response.data;
      }
      return { success: false, message: response.error || 'Failed to redeem reward' };
    } catch (err) {
      return { success: false, message: 'An error occurred while redeeming reward' };
    }
  }, []);

  return { rewards, userStats, userPoints, redeemedBadgeIds, isLoading, error, refetch: fetchData, redeemReward };
};
