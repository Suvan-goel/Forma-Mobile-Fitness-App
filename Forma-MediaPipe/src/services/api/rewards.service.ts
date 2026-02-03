/**
 * Rewards service - handles all rewards-related API calls
 */

import { ApiResponse, Reward, UserStats } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import { mockRewards, mockUserStats } from '../mock/data/rewards.mock';

export const rewardsService = {
  /**
   * Get all rewards
   */
  async getRewards(): Promise<ApiResponse<Reward[]>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockRewards, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get user stats for points calculation
   */
  async getUserStats(): Promise<ApiResponse<UserStats>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockUserStats, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Redeem a reward
   */
  async redeemReward(rewardId: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const reward = mockRewards.find(r => r.id === rewardId);
      if (!reward) {
        return {
          data: { success: false, message: 'Reward not found' },
          success: false,
          error: 'Reward not found',
        };
      }
      // In a real implementation, this would deduct points and mark the reward as redeemed
      return {
        data: { success: true, message: `Successfully redeemed: ${reward.title}` },
        success: true,
      };
    }
    throw new Error('Real API not implemented');
  },
};
