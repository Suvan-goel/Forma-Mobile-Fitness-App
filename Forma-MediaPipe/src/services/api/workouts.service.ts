/**
 * Workouts service - handles all workout-related API calls
 */

import { ApiResponse, WorkoutSession, WorkoutDetails } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import { mockWorkoutSessions, mockWorkoutDetails } from '../mock/data/workouts.mock';

export const workoutsService = {
  /**
   * Get all workout sessions
   */
  async getAll(): Promise<ApiResponse<WorkoutSession[]>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockWorkoutSessions, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get a specific workout by ID
   */
  async getById(id: string): Promise<ApiResponse<WorkoutDetails | null>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const workout = mockWorkoutDetails[id] || null;
      return { data: workout, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get recent workouts with a limit
   */
  async getRecent(limit: number = 5): Promise<ApiResponse<WorkoutSession[]>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const recent = mockWorkoutSessions.slice(0, limit);
      return { data: recent, success: true };
    }
    throw new Error('Real API not implemented');
  },
};
