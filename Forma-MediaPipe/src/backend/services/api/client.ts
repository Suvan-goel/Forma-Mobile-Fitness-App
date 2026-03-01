/**
 * API client configuration
 * Per-service mock flags: set to false when the Supabase backend is ready
 */

import { ApiResponse } from './types';

export const API_CONFIG = {
  useMock: false,
  services: {
    workouts: false,  // Supabase — Phase 1
    user: false,      // Supabase — Phase 1
    exercises: true,  // mock — Phase 2
    analytics: false, // Supabase — Phase 2
    rewards: false,    // mock — Phase 3
    insights: true,   // mock — Phase 3
    trainer: true,    // stays mock
    social: true,      // TEMP: mock for visual preview — flip back to false when done
  },
  mockDelayMs: 300,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
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
