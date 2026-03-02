/**
 * API client configuration
 * Per-service mock flags: set to false when the Supabase backend is ready
 */

export const API_CONFIG = {
  useMock: false,
  services: {
    workouts: false,  // Supabase — Phase 1
    user: false,      // Supabase — Phase 1
    exercises: true,  // mock — Phase 2
    analytics: false, // Supabase — Phase 2
    rewards: false,    // mock — Phase 3
    insights: true,   // mock — Phase 3
    social: true,     // Supabase — social features live
  },
  mockDelayMs: 300,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
} as const;
