/**
 * User service - handles user-related API calls
 */

import { ApiResponse, User } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import { mockUser } from '../mock/data/user.mock';

export const userService = {
  /**
   * Get current user
   */
  async getCurrentUser(): Promise<ApiResponse<User>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockUser, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Update user profile
   */
  async updateUser(updates: Partial<User>): Promise<ApiResponse<User>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const updatedUser = { ...mockUser, ...updates };
      return { data: updatedUser, success: true };
    }
    throw new Error('Real API not implemented');
  },
};
