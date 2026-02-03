/**
 * API client configuration
 * Toggle between mock and real API implementations
 */

import { ApiResponse } from './types';

export const API_CONFIG = {
  useMock: true,
  mockDelayMs: 300,
  baseUrl: '', // Will be set when real API is implemented
} as const;

/**
 * API client for making requests
 * Currently returns mock data, will be replaced with real HTTP calls
 */
export const apiClient = {
  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    if (API_CONFIG.useMock) {
      throw new Error(`Mock implementation required for GET ${endpoint}`);
    }
    // Real API implementation would go here
    throw new Error('Real API not implemented');
  },

  async post<T, B>(endpoint: string, body: B): Promise<ApiResponse<T>> {
    if (API_CONFIG.useMock) {
      throw new Error(`Mock implementation required for POST ${endpoint}`);
    }
    // Real API implementation would go here
    throw new Error('Real API not implemented');
  },
};
