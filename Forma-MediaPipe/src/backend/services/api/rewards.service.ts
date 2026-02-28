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
  isoWeekId,
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
    if (row.source_id === currentWeekId) continue; // don't count the week we're about to award
    if ((row.points_delta ?? 0) > 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/** UPSERT the denormalized points cache by adding the given deltas. */
async function upsertPointsCache(
  userId: string,
  workoutDelta: number,
  consistencyDelta: number,
): Promise<void> {
  const { data: existing } = await supabase
    .from('user_points_cache')
    .select('workout_points, consistency_points')
    .eq('user_id', userId)
    .maybeSingle();

  const newWorkout = (existing?.workout_points ?? 0) + workoutDelta;
  const newConsistency = (existing?.consistency_points ?? 0) + consistencyDelta;

  await supabase
    .from('user_points_cache')
    .upsert(
      {
        user_id: userId,
        workout_points: newWorkout,
        consistency_points: newConsistency,
        total_points: newWorkout + newConsistency,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
}

// ── Service ───────────────────────────────────────────────────

export const rewardsService = {
  /**
   * Get all rewards.
   */
  async getRewards(): Promise<ApiResponse<Reward[]>> {
    // Rewards catalog is static — always return the local list until a rewards table exists in Supabase
    return { data: mockRewards, success: true };
  },

  /**
   * Get user stats (formScore = cumulative workout points,
   * consistencyScore = cumulative weekly consistency points).
   *
   * Side effect: if the last completed ISO week has no consistency ledger entry yet,
   * awards consistency points before returning totals.
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
      return { data: { formScore: 0, consistencyScore: 0 }, success: false, error: 'Not authenticated' };
    }

    // ── Check if last week's consistency bonus is owed ──
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

      // Insert ledger row — unique index prevents double-award on concurrent calls
      const { error: ledgerErr } = await supabase
        .from('user_points_ledger')
        .insert({
          user_id: user.id,
          points_delta: pts,
          event_type: 'weekly_consistency',
          source_id: lastWeekId,
        });

      // Update cache only when insert succeeded (pts=0 inserts still mark the week as checked)
      if (!ledgerErr && pts > 0) {
        await upsertPointsCache(user.id, 0, pts);
      }
    }

    // ── Read from cache ──
    const { data: cache } = await supabase
      .from('user_points_cache')
      .select('workout_points, consistency_points')
      .eq('user_id', user.id)
      .maybeSingle();

    return {
      data: {
        formScore: cache?.workout_points ?? 0,
        consistencyScore: cache?.consistency_points ?? 0,
      },
      success: true,
    };
  },

  /**
   * Award points for a completed workout session.
   * Idempotent: a second call with the same sessionId is a no-op (unique index).
   *
   * Anti-cheat: only the first workout per calendar day earns points.
   *
   * @param sessionId - workout_sessions.id, used as the deduplication key
   * @param points    - pre-calculated by calculateWorkoutPoints()
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
      // Already earned workout points today — skip without error
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

    // Unique constraint conflict = already awarded for this session = treat as success
    if (ledgerErr && !ledgerErr.message.includes('duplicate') && !ledgerErr.code?.includes('23505')) {
      return { data: undefined, success: false, error: ledgerErr.message };
    }

    if (!ledgerErr) {
      await upsertPointsCache(user.id, points, 0);
    }

    return { data: undefined, success: true };
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
