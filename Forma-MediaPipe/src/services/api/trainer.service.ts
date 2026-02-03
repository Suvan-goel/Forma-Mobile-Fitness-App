/**
 * Trainer service - handles AI trainer-related API calls
 */

import { ApiResponse, Recommendation, TrainerProgress } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import {
  calculateProgress,
  generateRecommendations,
  generateAIResponse,
} from '../mock/data/trainer.mock';

export const trainerService = {
  /**
   * Get trainer progress summary
   */
  async getProgress(): Promise<ApiResponse<TrainerProgress>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const progress = calculateProgress();
      return { data: progress, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get AI recommendations based on progress
   */
  async getRecommendations(): Promise<ApiResponse<Recommendation[]>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const progress = calculateProgress();
      const recommendations = generateRecommendations(progress);
      return { data: recommendations, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get AI response for a user message
   */
  async getAIResponse(message: string): Promise<ApiResponse<string>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs * 1.5); // Slightly longer delay for "thinking"
      const progress = calculateProgress();
      const response = generateAIResponse(message, progress);
      return { data: response, success: true };
    }
    throw new Error('Real API not implemented');
  },
};
