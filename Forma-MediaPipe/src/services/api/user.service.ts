/**
 * User service - handles user-related API calls
 */

import { ApiResponse, User } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import { mockUser } from '../mock/data/user.mock';
import { supabase } from '../supabase/client';

export const userService = {
  /**
   * Get current user
   */
  async getCurrentUser(): Promise<ApiResponse<User>> {
    if (API_CONFIG.services.user) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockUser, success: true };
    }

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      return { data: mockUser, success: false, error: authError?.message ?? 'Not authenticated' };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      // Return a minimal user from auth data if profile row doesn't exist yet
      return {
        data: {
          id: authUser.id,
          email: authUser.email ?? '',
          displayName: authUser.user_metadata?.full_name ?? authUser.email ?? '',
          avatarUrl: authUser.user_metadata?.avatar_url,
          createdAt: new Date(authUser.created_at),
        },
        success: true,
      };
    }

    return {
      data: {
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url ?? undefined,
        createdAt: new Date(profile.created_at),
      },
      success: true,
    };
  },

  /**
   * Update user profile
   */
  async updateUser(updates: Partial<User>): Promise<ApiResponse<User>> {
    if (API_CONFIG.services.user) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const updatedUser = { ...mockUser, ...updates };
      return { data: updatedUser, success: true };
    }

    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return { data: {} as User, success: false, error: 'Not authenticated' };
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .update({
        display_name: updates.displayName,
        avatar_url: updates.avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', authUser.id)
      .select()
      .single();

    if (error || !profile) {
      return { data: {} as User, success: false, error: error?.message ?? 'Update failed' };
    }

    return {
      data: {
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url ?? undefined,
        createdAt: new Date(profile.created_at),
      },
      success: true,
    };
  },
};
