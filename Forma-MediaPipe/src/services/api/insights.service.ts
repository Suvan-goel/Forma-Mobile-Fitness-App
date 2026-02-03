/**
 * Insights service - handles insights-related API calls
 */

import { ApiResponse, InsightsData } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import { mockInsightsData } from '../mock/data/insights.mock';

export const insightsService = {
  /**
   * Get insights for a specific metric
   */
  async getInsights(metric: keyof InsightsData): Promise<ApiResponse<string[]>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const insights = mockInsightsData[metric] || [];
      return { data: insights, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get all insights for all metrics
   */
  async getAllInsights(): Promise<ApiResponse<InsightsData>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockInsightsData, success: true };
    }
    throw new Error('Real API not implemented');
  },
};
