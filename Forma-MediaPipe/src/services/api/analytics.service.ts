/**
 * Analytics service - handles all analytics-related API calls
 */

import { ApiResponse, AnalyticsData, AnalyticsMetric, WorkoutBarData } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import {
  formBaseData,
  consistencyBaseData,
  strengthBaseData,
  mockWeeklyBarData,
  generateDataForTimeRange,
} from '../mock/data/analytics.mock';

export const analyticsService = {
  /**
   * Get all analytics data for a given time range
   */
  async getAnalytics(timeRange: string = '1 week'): Promise<ApiResponse<AnalyticsData>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);

      const formResult = generateDataForTimeRange(formBaseData, timeRange);
      const consistencyResult = generateDataForTimeRange(consistencyBaseData, timeRange);
      const strengthResult = generateDataForTimeRange(strengthBaseData, timeRange);

      const data: AnalyticsData = {
        formData: { values: formResult.values, dates: formResult.dates },
        consistencyData: { values: consistencyResult.values, dates: consistencyResult.dates },
        strengthData: { values: strengthResult.values, dates: strengthResult.dates },
        weeklyBarData: mockWeeklyBarData,
      };

      return { data, success: true };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get a specific metric's data for a given time range
   */
  async getMetricByTimeRange(
    metric: 'form' | 'consistency' | 'strength',
    timeRange: string
  ): Promise<ApiResponse<AnalyticsMetric>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);

      let baseData: number[];
      switch (metric) {
        case 'form':
          baseData = formBaseData;
          break;
        case 'consistency':
          baseData = consistencyBaseData;
          break;
        case 'strength':
          baseData = strengthBaseData;
          break;
      }

      const result = generateDataForTimeRange(baseData, timeRange);
      return {
        data: { values: result.values, dates: result.dates },
        success: true,
      };
    }
    throw new Error('Real API not implemented');
  },

  /**
   * Get weekly bar chart data
   */
  async getWeeklyBarData(): Promise<ApiResponse<WorkoutBarData[]>> {
    if (API_CONFIG.useMock) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockWeeklyBarData, success: true };
    }
    throw new Error('Real API not implemented');
  },
};
