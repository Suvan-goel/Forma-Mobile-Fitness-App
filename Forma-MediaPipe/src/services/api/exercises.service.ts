/**
 * Exercises service - handles all exercise-related API calls
 */

import { ApiResponse, Exercise, MuscleGroup } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import { mockExercises, mockMuscleGroups } from '../mock/data/exercises.mock';

export const exercisesService = {
  /**
   * Get all muscle groups
   */
  async getMuscleGroups(): Promise<ApiResponse<MuscleGroup[]>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockMuscleGroups, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get all exercises
   */
  async getAll(): Promise<ApiResponse<Exercise[]>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockExercises, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get exercises filtered by muscle group
   */
  async getByMuscleGroup(muscleGroup: string): Promise<ApiResponse<Exercise[]>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const filtered = muscleGroup === 'all'
        ? mockExercises
        : mockExercises.filter(ex => ex.muscleGroup === muscleGroup);
      return { data: filtered, success: true };
    }
    throw new Error('Real API not implemented');
  },
};
