/**
 * Social service - handles leaderboard, friends, and activity feed API calls
 */

import {
  ApiResponse,
  LeaderboardMetric,
  TimeWindow,
  LeaderboardResult,
  Friend,
  FriendRequest,
  SuggestedFriend,
  UserSearchResult,
  FriendProfileData,
  ComparisonData,
  ActivityFilter,
  ActivityFeedPage,
  CreateActivityEventPayload,
  LeaderboardEntry,
  ActivityEvent,
} from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import {
  getMockLeaderboard,
  mockFriends,
  mockPendingRequests,
  mockSuggestedFriends,
  mockSearchResults,
  getMockFriendProfile,
  getMockComparison,
  getMockActivityFeed,
} from '../mock/data/social.mock';
import { supabase } from '../supabase/client';

// ── Private helpers ───────────────────────────────────────────

const STREAK_MILESTONES = new Set([7, 14, 21, 30, 60, 90, 100, 150, 200, 365]);

/**
 * Computes the current streak (consecutive calendar days ending today or yesterday)
 * from the user's workout_sessions rows. No `current_streak` column required.
 */
async function computeStreak(userId: string): Promise<number> {
  const { data } = await supabase
    .from('workout_sessions')
    .select('date')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (!data || data.length === 0) return 0;

  // Collect unique calendar days (ISO date string 'YYYY-MM-DD')
  const seen = new Set<string>();
  for (const w of data) {
    const day = typeof w.date === 'string' ? w.date.slice(0, 10) : new Date(w.date).toISOString().slice(0, 10);
    seen.add(day);
  }
  const days = [...seen].sort().reverse(); // descending order

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  // Streak must be active (last workout was today or yesterday)
  if (days[0] !== today && days[0] !== yesterday) return 0;

  let streak = 0;
  let anchor = days[0]; // start from most recent workout day
  for (const day of days) {
    if (day === anchor) {
      streak++;
      // Advance anchor one day back
      const d = new Date(anchor + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - 1);
      anchor = d.toISOString().slice(0, 10);
    } else if (day < anchor) {
      break; // gap found
    }
  }
  return streak;
}

function timeWindowToDate(timeWindow: TimeWindow): string {
  const now = new Date();
  switch (timeWindow) {
    case '1_week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d.toISOString();
    }
    case '1_month': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return d.toISOString();
    }
    case 'all_time':
      return '2020-01-01T00:00:00.000Z';
  }
}

function mapFriendshipRow(row: any, currentUserId: string): { friendUserId: string; friendshipId: string } {
  return {
    friendshipId: row.id,
    friendUserId: row.requester_id === currentUserId ? row.addressee_id : row.requester_id,
  };
}

// ── Service ───────────────────────────────────────────────────

export const socialService = {
  // ── Leaderboard ─────────────────────────────────────────────

  async getLeaderboard(
    metric: LeaderboardMetric,
    timeWindow: TimeWindow,
    limit: number = 50,
  ): Promise<ApiResponse<LeaderboardResult>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: getMockLeaderboard(), success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: { entries: [], totalParticipants: 0, currentUser: null }, success: false, error: 'Not authenticated' };
    }

    const timeStart = timeWindowToDate(timeWindow);

    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_metric: metric,
      p_time_start: timeStart,
      p_limit: limit,
    });

    if (error) {
      return { data: { entries: [], totalParticipants: 0, currentUser: null }, success: false, error: error.message };
    }

    const entries: LeaderboardEntry[] = (data ?? []).map((row: any) => ({
      userId: row.user_id,
      rank: Number(row.rank),
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      score: Number(row.score),
    }));

    const currentUser = entries.find(e => e.userId === user.id) ?? null;
    let currentUserEntry = currentUser;

    // If current user not in top results, fetch their rank separately
    if (!currentUser) {
      const { data: userRankData } = await supabase.rpc('get_leaderboard', {
        p_metric: metric,
        p_time_start: timeStart,
        p_limit: 10000,
      });

      if (userRankData) {
        const userRow = (userRankData as any[]).find((r: any) => r.user_id === user.id);
        if (userRow) {
          currentUserEntry = {
            userId: user.id,
            rank: Number(userRow.rank),
            displayName: userRow.display_name,
            avatarUrl: userRow.avatar_url ?? undefined,
            score: Number(userRow.score),
          };
        }
      }
    }

    return {
      data: {
        entries,
        totalParticipants: entries.length,
        currentUser: currentUserEntry,
      },
      success: true,
    };
  },

  // ── Friends ─────────────────────────────────────────────────

  async getFriends(): Promise<ApiResponse<Friend[]>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockFriends, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: [], success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('friendships')
      .select('id, requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (error) return { data: [], success: false, error: error.message };

    const friendMappings = (data ?? []).map((row: any) => mapFriendshipRow(row, user.id));
    if (friendMappings.length === 0) return { data: [], success: true };

    const friendIds = friendMappings.map(m => m.friendUserId);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', friendIds);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const friends: Friend[] = friendMappings.map(m => {
      const profile = profileMap.get(m.friendUserId);
      return {
        friendshipId: m.friendshipId,
        userId: m.friendUserId,
        displayName: profile?.display_name ?? 'Unknown',
        avatarUrl: profile?.avatar_url ?? undefined,
        streakDays: 0,
        avgFormScore: 0,
      };
    });

    return { data: friends, success: true };
  },

  async getPendingRequests(): Promise<ApiResponse<FriendRequest[]>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockPendingRequests, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: [], success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('friendships')
      .select('id, requester_id, created_at')
      .eq('addressee_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) return { data: [], success: false, error: error.message };

    const requesterIds = (data ?? []).map((r: any) => r.requester_id);
    if (requesterIds.length === 0) return { data: [], success: true };

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', requesterIds);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const requests: FriendRequest[] = (data ?? []).map((row: any) => {
      const profile = profileMap.get(row.requester_id);
      return {
        friendshipId: row.id,
        fromUserId: row.requester_id,
        fromDisplayName: profile?.display_name ?? 'Unknown',
        fromAvatarUrl: profile?.avatar_url ?? undefined,
        sentAt: new Date(row.created_at),
      };
    });

    return { data: requests, success: true };
  },

  async getSuggestedFriends(): Promise<ApiResponse<SuggestedFriend[]>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockSuggestedFriends, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: [], success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase.rpc('get_friend_suggestions', {
      p_user_id: user.id,
      p_limit: 10,
    });

    if (error) return { data: [], success: false, error: error.message };

    const suggestions: SuggestedFriend[] = (data ?? []).map((row: any) => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      mutualFriendCount: Number(row.mutual_count),
    }));

    return { data: suggestions, success: true };
  },

  async sendFriendRequest(targetUserId: string): Promise<ApiResponse<void>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: undefined, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: undefined, success: false, error: 'Not authenticated' };
    }

    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: user.id, addressee_id: targetUserId });

    if (error) {
      if (error.message.includes('duplicate') || error.code === '23505') {
        return { data: undefined, success: false, error: 'Friend request already exists' };
      }
      return { data: undefined, success: false, error: error.message };
    }

    return { data: undefined, success: true };
  },

  async respondToRequest(friendshipId: string, accept: boolean): Promise<ApiResponse<void>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: undefined, success: true };
    }

    const newStatus = accept ? 'accepted' : 'declined';
    const { error } = await supabase
      .from('friendships')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', friendshipId);

    if (error) return { data: undefined, success: false, error: error.message };
    return { data: undefined, success: true };
  },

  async removeFriend(friendshipId: string): Promise<ApiResponse<void>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: undefined, success: true };
    }

    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    if (error) return { data: undefined, success: false, error: error.message };
    return { data: undefined, success: true };
  },

  async searchUsers(query: string): Promise<ApiResponse<UserSearchResult[]>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const filtered = mockSearchResults.filter(
        u => u.displayName.toLowerCase().includes(query.toLowerCase()),
      );
      return { data: filtered, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: [], success: false, error: 'Not authenticated' };
    }

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .ilike('display_name', `%${query}%`)
      .neq('id', user.id)
      .not('privacy_level', 'eq', 'private')
      .limit(20);

    if (error) return { data: [], success: false, error: error.message };

    // Get existing friendships for relationship status
    const searchedIds = (profiles ?? []).map((p: any) => p.id);
    const { data: friendships } = await supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, status')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .in('requester_id', [...searchedIds, user.id])
      .in('addressee_id', [...searchedIds, user.id]);

    const friendshipMap = new Map<string, { status: string; isRequester: boolean }>();
    (friendships ?? []).forEach((f: any) => {
      const otherId = f.requester_id === user.id ? f.addressee_id : f.requester_id;
      friendshipMap.set(otherId, {
        status: f.status,
        isRequester: f.requester_id === user.id,
      });
    });

    const results: UserSearchResult[] = (profiles ?? []).map((p: any) => {
      const friendship = friendshipMap.get(p.id);
      let relationshipStatus: UserSearchResult['relationshipStatus'] = 'none';
      if (friendship) {
        if (friendship.status === 'accepted') relationshipStatus = 'friends';
        else if (friendship.status === 'pending') {
          relationshipStatus = friendship.isRequester ? 'pending_sent' : 'pending_received';
        }
      }
      return {
        userId: p.id,
        displayName: p.display_name,
        avatarUrl: p.avatar_url ?? undefined,
        mutualFriendCount: 0,
        relationshipStatus,
      };
    });

    return { data: results, success: true };
  },

  // ── Friend Profile & Comparison ─────────────────────────────

  async getFriendProfile(userId: string): Promise<ApiResponse<FriendProfileData>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: getMockFriendProfile(userId), success: true };
    }

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, created_at')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) {
      return { data: getMockFriendProfile(userId), success: false, error: 'User not found' };
    }

    const [workoutsResult, badgesResult, streakDays] = await Promise.all([
      supabase
        .from('workout_sessions')
        .select('id, name, date, duration_seconds, total_sets, total_reps, form_score')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(5),
      supabase
        .from('user_badges')
        .select('badge_id')
        .eq('user_id', userId),
      computeStreak(userId),
    ]);

    const allWorkouts = workoutsResult.data ?? [];
    const recentWorkouts = allWorkouts.map((w: any) => ({
      id: w.id,
      name: w.name,
      date: new Date(w.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      fullDate: new Date(w.date),
      duration: `${Math.round(w.duration_seconds / 60)} min`,
      totalSets: w.total_sets,
      totalReps: w.total_reps,
      formScore: w.form_score,
      userId,
    }));

    // Get total workout count
    const { count: totalWorkouts } = await supabase
      .from('workout_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Compute avg form score
    const avgFormScore = allWorkouts.length > 0
      ? allWorkouts.reduce((sum: number, w: any) => sum + (w.form_score ?? 0), 0) / allWorkouts.length
      : 0;

    return {
      data: {
        userId,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url ?? undefined,
        memberSince: new Date(profile.created_at),
        totalWorkouts: totalWorkouts ?? 0,
        streakDays,
        avgFormScore: Math.round(avgFormScore * 10) / 10,
        earnedBadgeIds: (badgesResult.data ?? []).map((b: any) => b.badge_id),
        recentWorkouts,
      },
      success: true,
    };
  },

  async compareFriend(friendId: string): Promise<ApiResponse<ComparisonData>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: getMockComparison(friendId), success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: getMockComparison(friendId), success: false, error: 'Not authenticated' };
    }

    const getStats = async (uid: string): Promise<{ displayName: string; avatarUrl?: string; avgFormScore: number; streakDays: number; weeklyWorkouts: number; bestSetScore: number; totalPoints: number }> => {
      const [profileRes, workoutsRes, pointsRes, streakDays] = await Promise.all([
        supabase.from('profiles').select('display_name, avatar_url').eq('id', uid).single(),
        supabase.from('workout_sessions').select('form_score, date').eq('user_id', uid).order('date', { ascending: false }),
        supabase.from('user_points_cache').select('total_points').eq('user_id', uid).maybeSingle(),
        computeStreak(uid),
      ]);

      const workouts = workoutsRes.data ?? [];
      const avgFormScore = workouts.length > 0
        ? workouts.reduce((s: number, w: any) => s + (w.form_score ?? 0), 0) / workouts.length
        : 0;

      // Weekly workouts (last 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weeklyWorkouts = workouts.filter((w: any) => new Date(w.date) >= weekAgo).length;

      return {
        displayName: profileRes.data?.display_name ?? 'Unknown',
        avatarUrl: profileRes.data?.avatar_url ?? undefined,
        avgFormScore: Math.round(avgFormScore * 10) / 10,
        streakDays,
        weeklyWorkouts,
        bestSetScore: 0,
        totalPoints: pointsRes.data?.total_points ?? 0,
      };
    };

    const [youStats, friendStats] = await Promise.all([getStats(user.id), getStats(friendId)]);

    return {
      data: {
        you: { userId: user.id, ...youStats },
        friend: { userId: friendId, ...friendStats },
      },
      success: true,
    };
  },

  // ── Activity Feed ───────────────────────────────────────────

  async getActivityFeed(
    filter: ActivityFilter = 'all',
    cursor: string | null = null,
    limit: number = 20,
  ): Promise<ApiResponse<ActivityFeedPage>> {
    if (API_CONFIG.services.social) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: getMockActivityFeed(filter, cursor, limit), success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: { events: [], nextCursor: null, hasMore: false }, success: false, error: 'Not authenticated' };
    }

    // Get friend IDs first
    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    const friendIds = (friendships ?? []).map((f: any) =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id,
    );
    const allUserIds = [user.id, ...friendIds];

    let query = supabase
      .from('activity_events')
      .select('id, user_id, event_type, payload, created_at')
      .in('user_id', allUserIds)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    // Apply filter
    if (filter === 'workouts') {
      query = query.eq('event_type', 'workout_completed');
    } else if (filter === 'badges') {
      query = query.eq('event_type', 'badge_earned');
    } else if (filter === 'records') {
      query = query.in('event_type', ['personal_record', 'streak_milestone']);
    }

    // Apply cursor
    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data, error } = await query;
    if (error) {
      return { data: { events: [], nextCursor: null, hasMore: false }, success: false, error: error.message };
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    // Get profiles for event authors
    const authorIds = [...new Set(pageRows.map((r: any) => r.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', authorIds);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const events: ActivityEvent[] = pageRows.map((row: any) => {
      const profile = profileMap.get(row.user_id);
      return {
        id: row.id,
        userId: row.user_id,
        displayName: row.user_id === user.id ? 'You' : (profile?.display_name ?? 'Unknown'),
        avatarUrl: profile?.avatar_url ?? undefined,
        eventType: row.event_type,
        payload: row.payload ?? {},
        createdAt: new Date(row.created_at),
      };
    });

    return {
      data: {
        events,
        nextCursor: pageRows.length > 0 ? pageRows[pageRows.length - 1].created_at : null,
        hasMore,
      },
      success: true,
    };
  },

  // ── Privacy Level ────────────────────────────────────────────

  async getPrivacyLevel(): Promise<ApiResponse<'public' | 'friends' | 'private'>> {
    if (API_CONFIG.services.social) {
      return { data: 'friends', success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: 'friends', success: false, error: 'Not authenticated' };

    const { data, error } = await supabase
      .from('profiles')
      .select('privacy_level')
      .eq('id', user.id)
      .single();

    if (error) return { data: 'friends', success: false, error: error.message };
    return { data: (data?.privacy_level ?? 'friends') as 'public' | 'friends' | 'private', success: true };
  },

  async updatePrivacyLevel(level: 'public' | 'friends' | 'private'): Promise<ApiResponse<void>> {
    if (API_CONFIG.services.social) {
      return { data: undefined, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: undefined, success: false, error: 'Not authenticated' };

    const { error } = await supabase
      .from('profiles')
      .update({ privacy_level: level })
      .eq('id', user.id);

    if (error) return { data: undefined, success: false, error: error.message };
    return { data: undefined, success: true };
  },

  async createActivityEvent(payload: CreateActivityEventPayload): Promise<ApiResponse<void>> {
    if (API_CONFIG.services.social) {
      return { data: undefined, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: undefined, success: false, error: 'Not authenticated' };
    }

    const { error } = await supabase
      .from('activity_events')
      .insert({
        user_id: user.id,
        event_type: payload.eventType,
        payload: payload.payload,
        source_id: payload.sourceId ?? null,
      });

    if (error) return { data: undefined, success: false, error: error.message };
    return { data: undefined, success: true };
  },

  // ── Milestone Detection ───────────────────────────────────

  /**
   * Computes the user's current streak and emits a streak_milestone
   * activity event if the streak has hit a notable threshold.
   * Fire-and-forget — errors are silently swallowed.
   */
  async emitStreakMilestoneIfNeeded(): Promise<void> {
    if (API_CONFIG.services.social) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const streak = await computeStreak(user.id);
    if (!STREAK_MILESTONES.has(streak)) return;

    // Check if we already emitted this exact milestone today (prevent duplicates)
    const today = new Date().toISOString().slice(0, 10);
    const sourceId = `streak-${streak}-${today}`;
    const { data: existing } = await supabase
      .from('activity_events')
      .select('id')
      .eq('user_id', user.id)
      .eq('event_type', 'streak_milestone')
      .eq('source_id', sourceId)
      .limit(1);

    if (existing && existing.length > 0) return;

    await supabase.from('activity_events').insert({
      user_id: user.id,
      event_type: 'streak_milestone',
      payload: { streak_days: streak },
      source_id: sourceId,
    });
  },

  /**
   * Checks if any exercise in the just-saved workout set a new max weight
   * compared to all previous sessions. Emits a personal_record activity
   * event for each new PR found.
   * Fire-and-forget — errors are silently swallowed.
   */
  async emitPersonalRecordsIfNeeded(
    sessionId: string,
    exercises: { name: string; sets: { weight: number }[] }[],
  ): Promise<void> {
    if (API_CONFIG.services.social) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    for (const ex of exercises) {
      const currentMax = Math.max(...ex.sets.map(s => s.weight));
      if (currentMax <= 0) continue; // skip bodyweight exercises

      // Get previous max weight for this exercise (excluding current session)
      const { data: prevRows } = await supabase
        .from('workout_sets')
        .select('weight, workout_exercises!inner(name, session_id)')
        .eq('workout_exercises.name', ex.name)
        .neq('workout_exercises.session_id', sessionId)
        .order('weight', { ascending: false })
        .limit(1);

      // Filter to only this user's data (RLS handles this)
      const prevMax = prevRows && prevRows.length > 0 ? Number(prevRows[0].weight) : 0;

      if (currentMax > prevMax && prevMax > 0) {
        await supabase.from('activity_events').insert({
          user_id: user.id,
          event_type: 'personal_record',
          payload: { exercise: ex.name, weight: currentMax },
          source_id: `pr-${ex.name}-${sessionId}`,
        });
      }
    }
  },
};
