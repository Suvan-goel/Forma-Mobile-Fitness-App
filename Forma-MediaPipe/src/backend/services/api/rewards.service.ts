/**
 * Rewards service - handles all rewards-related API calls
 */

import { ApiResponse, Reward, UserStats } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import { mockRewards, mockUserStats } from '../mock/data/rewards.mock';
import { supabase } from '../supabase/client';
import {
  calculateWeeklyConsistencyPoints,
  lastCompletedIsoWeekId,
} from '../../../utils/pointsCalculator';

// ── Private helpers ───────────────────────────────────────────

/** Returns the Monday and Sunday of the last completed Mon-Sun week as ISO date strings. */
function getLastCompletedWeekBounds(): { weekStart: string; weekEnd: string } {
  const today = new Date();
  const dow = today.getDay() || 7; // Mon=1 … Sun=7
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - dow);
  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastSunday.getDate() - 6);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return {
    weekStart: fmt(lastMonday),
    weekEnd: fmt(lastSunday) + 'T23:59:59.999Z',
  };
}

/**
 * Count consecutive completed ISO weeks (ratio >= 1.0) before the current one.
 * A "hit" week is any weekly_consistency ledger row with points_delta > 0.
 */
async function computeConsistencyStreak(userId: string): Promise<number> {
  const currentWeekId = lastCompletedIsoWeekId();

  const { data: rows } = await supabase
    .from('user_points_ledger')
    .select('source_id, points_delta')
    .eq('user_id', userId)
    .eq('event_type', 'weekly_consistency')
    .order('source_id', { ascending: false })
    .limit(16);

  if (!rows || rows.length === 0) return 0;

  let streak = 0;
  for (const row of rows) {
    if (row.source_id === currentWeekId) continue;
    if ((row.points_delta ?? 0) > 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * UPSERT the denormalized points cache by adding the given deltas.
 * Returns the new total points so the caller can check badge thresholds.
 */
async function upsertPointsCache(
  userId: string,
  workoutDelta: number,
  consistencyDelta: number,
): Promise<number> {
  const { data: existing } = await supabase
    .from('user_points_cache')
    .select('workout_points, consistency_points')
    .eq('user_id', userId)
    .maybeSingle();

  const newWorkout = (existing?.workout_points ?? 0) + workoutDelta;
  const newConsistency = (existing?.consistency_points ?? 0) + consistencyDelta;
  const newTotal = newWorkout + newConsistency;

  await supabase
    .from('user_points_cache')
    .upsert(
      {
        user_id: userId,
        workout_points: newWorkout,
        consistency_points: newConsistency,
        total_points: newTotal,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  return newTotal;
}

/**
 * Check if the user has crossed any new badge thresholds and write them to user_badges.
 * Idempotent: the PRIMARY KEY on user_badges prevents duplicates.
 * The badge catalog (mockRewards) is the source of threshold definitions.
 */
async function checkAndAwardBadges(userId: string, totalPoints: number): Promise<void> {
  const { data: existingRows } = await supabase
    .from('user_badges')
    .select('badge_id')
    .eq('user_id', userId);

  const earnedIds = new Set((existingRows ?? []).map((b: any) => b.badge_id as string));

  const newlyEarned = mockRewards.filter(
    badge => totalPoints >= badge.pointsRequired && !earnedIds.has(badge.id),
  );

  if (newlyEarned.length === 0) return;

  await supabase.from('user_badges').insert(
    newlyEarned.map(badge => ({ user_id: userId, badge_id: badge.id })),
  );
}

// ── Service ───────────────────────────────────────────────────

export const rewardsService = {
  /**
   * Get all rewards (badge catalog).
   */
  async getRewards(): Promise<ApiResponse<Reward[]>> {
    // Catalog is static — always return the local list
    return { data: mockRewards, success: true };
  },

  /**
   * Get user stats + earned badge IDs.
   *
   * Side effect: awards the weekly consistency bonus if not yet given for
   * the last completed ISO week, then checks for newly earned badges.
   *
   * @param weeklyTarget - From AsyncStorage via useRewards (2 | 4 | 6)
   */
  async getUserStats(weeklyTarget: number = 4): Promise<ApiResponse<UserStats>> {
    if (API_CONFIG.services.rewards) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockUserStats, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: { formScore: 0, consistencyScore: 0, earnedBadgeIds: [] }, success: false, error: 'Not authenticated' };
    }

    // ── Award weekly consistency bonus if owed ──
    const lastWeekId = lastCompletedIsoWeekId();

    const { data: existingEntry } = await supabase
      .from('user_points_ledger')
      .select('id')
      .eq('user_id', user.id)
      .eq('event_type', 'weekly_consistency')
      .eq('source_id', lastWeekId)
      .maybeSingle();

    if (!existingEntry) {
      const { weekStart, weekEnd } = getLastCompletedWeekBounds();

      const { data: sessionRows } = await supabase
        .from('workout_sessions')
        .select('date')
        .eq('user_id', user.id)
        .gte('date', weekStart)
        .lte('date', weekEnd);

      const uniqueDays = new Set(
        (sessionRows ?? []).map((r: any) => (r.date as string).split('T')[0]),
      );
      const workoutsInWeek = uniqueDays.size;
      const streak = await computeConsistencyStreak(user.id);
      const pts = calculateWeeklyConsistencyPoints(workoutsInWeek, weeklyTarget, streak);

      const { error: ledgerErr } = await supabase
        .from('user_points_ledger')
        .insert({
          user_id: user.id,
          points_delta: pts,
          event_type: 'weekly_consistency',
          source_id: lastWeekId,
        });

      if (!ledgerErr && pts > 0) {
        const newTotal = await upsertPointsCache(user.id, 0, pts);
        await checkAndAwardBadges(user.id, newTotal).catch(() => {});
      }
    }

    // ── Read cache + earned badges in parallel ──
    const [cacheResult, badgesResult] = await Promise.all([
      supabase
        .from('user_points_cache')
        .select('workout_points, consistency_points, total_points')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('user_badges')
        .select('badge_id')
        .eq('user_id', user.id),
    ]);

    const totalPoints = cacheResult.data?.total_points ?? 0;
    const earnedBadgeIds = (badgesResult.data ?? []).map((b: any) => b.badge_id as string);

    // Retroactively award any badges the user has already earned but not yet recorded
    // (handles existing users who had points before user_badges table was created)
    const hasAllDueBadges = mockRewards
      .filter(b => totalPoints >= b.pointsRequired)
      .every(b => earnedBadgeIds.includes(b.id));

    if (!hasAllDueBadges) {
      await checkAndAwardBadges(user.id, totalPoints).catch(() => {});
      const { data: refreshed } = await supabase
        .from('user_badges')
        .select('badge_id')
        .eq('user_id', user.id);
      earnedBadgeIds.splice(
        0,
        earnedBadgeIds.length,
        ...(refreshed ?? []).map((b: any) => b.badge_id as string),
      );
    }

    return {
      data: {
        formScore: cacheResult.data?.workout_points ?? 0,
        consistencyScore: cacheResult.data?.consistency_points ?? 0,
        earnedBadgeIds,
      },
      success: true,
    };
  },

  /**
   * Award points for a completed workout session.
   * Idempotent: a second call with the same sessionId is a no-op (unique index).
   * Anti-cheat: only the first workout per calendar day earns points.
   */
  async awardWorkoutPoints(
    sessionId: string,
    points: number,
  ): Promise<ApiResponse<void>> {
    if (API_CONFIG.services.rewards) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: undefined, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: undefined, success: false, error: 'Not authenticated' };
    }

    // Daily cap: only first workout per calendar day earns points
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayEntry } = await supabase
      .from('user_points_ledger')
      .select('id')
      .eq('user_id', user.id)
      .eq('event_type', 'workout')
      .gte('created_at', todayStart.toISOString())
      .maybeSingle();

    if (todayEntry) {
      return { data: undefined, success: true };
    }

    const { error: ledgerErr } = await supabase
      .from('user_points_ledger')
      .insert({
        user_id: user.id,
        points_delta: points,
        event_type: 'workout',
        source_id: sessionId,
      });

    if (ledgerErr && !ledgerErr.message.includes('duplicate') && !ledgerErr.code?.includes('23505')) {
      return { data: undefined, success: false, error: ledgerErr.message };
    }

    if (!ledgerErr) {
      const newTotal = await upsertPointsCache(user.id, points, 0);
      await checkAndAwardBadges(user.id, newTotal).catch(() => {});
    }

    return { data: undefined, success: true };
  },

  /**
   * Fetch the badge IDs earned by any user.
   * Used by leaderboards to show another user's badges.
   * Readable by all authenticated users (public SELECT RLS policy on user_badges).
   *
   * @param userId - The target user's ID
   */
  async getUserBadges(userId: string): Promise<ApiResponse<string[]>> {
    if (API_CONFIG.services.rewards) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockUserStats.earnedBadgeIds, success: true };
    }

    const { data, error } = await supabase
      .from('user_badges')
      .select('badge_id')
      .eq('user_id', userId);

    if (error) return { data: [], success: false, error: error.message };
    return { data: (data ?? []).map((b: any) => b.badge_id as string), success: true };
  },

  /**
   * Redeem a reward.
   */
  async redeemReward(rewardId: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    if (API_CONFIG.services.rewards) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const reward = mockRewards.find(r => r.id === rewardId);
      if (!reward) {
        return {
          data: { success: false, message: 'Reward not found' },
          success: false,
          error: 'Reward not found',
        };
      }
      return {
        data: { success: true, message: `Successfully redeemed: ${reward.title}` },
        success: true,
      };
    }
    throw new Error('Real API not implemented');
  },
};
