/**
 * Composite hook for Home screen data.
 * Aggregates existing hooks into a focused, minimal payload.
 */

import { useMemo } from 'react';
import { useAnalytics } from './useAnalytics';
import { useRewards } from './useRewards';
import { useWorkouts } from './useWorkouts';
import { useUser } from './useUser';
import { useWorkoutPreferences } from './useWorkoutPreferences';

// ── Types ──────────────────────────────────────────

export interface NextBadge {
  name: string;
  current: number;
  required: number;
  color: string;
  iconName: string;
}

export interface LastWorkout {
  id: string;
  name: string;
  date: string;
  duration: string;
  totalSets: number;
  totalReps: number;
  formScore: number;
  timeAgo: string;
}

export interface WeeklyGoal {
  current: number;
  target: number;
}

export interface HomeData {
  displayName: string;
  streakDays: number;
  formScore: number;
  formTrendDirection: 'up' | 'down' | 'flat';
  formTrendPercent: number;
  weeklyGoal: WeeklyGoal;
  lastWorkout: LastWorkout | null;
  totalPoints: number;
  nextBadge: NextBadge | null;
}

// ── Helpers ───────────────────────────────────────

const WEEKLY_TARGET_MAP: Record<string, number> = { '1-2': 2, '3-4': 4, '5+': 6 };

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return '1w ago';
  return `${diffWeeks}w ago`;
}

// ── Hook ───────────────────────────────────────────

export function useHomeData() {
  const { user, isLoading: userLoading } = useUser();
  const { prefs, isLoading: prefsLoading } = useWorkoutPreferences();
  const weeklyTarget = WEEKLY_TARGET_MAP[prefs.weeklyTrainingTarget] ?? 4;
  const { analytics, isLoading: analyticsLoading } = useAnalytics('1 week', weeklyTarget);
  const { rewards, userStats, userPoints, isLoading: rewardsLoading, refetch: refetchRewards } = useRewards();
  const { workouts, isLoading: workoutsLoading } = useWorkouts();

  const isLoading = userLoading || prefsLoading || analyticsLoading || rewardsLoading || workoutsLoading;

  const homeData = useMemo<HomeData | null>(() => {
    if (!user || !analytics) return null;

    const displayName = user.displayName || 'Athlete';
    const streakDays = analytics.summary.streakDays;
    const formValues = analytics.formData.values;
    const avgFormScore = formValues.length > 0
      ? Math.round(formValues.reduce((a, b) => a + b, 0) / formValues.length)
      : 0;

    // Next badge
    const earnedIds = userStats?.earnedBadgeIds ?? [];
    const sortedRewards = [...rewards].sort((a, b) => a.pointsRequired - b.pointsRequired);
    const nextReward = sortedRewards.find(r => !earnedIds.includes(r.id));
    const nextBadge: NextBadge | null = nextReward
      ? { name: nextReward.title, current: userPoints, required: nextReward.pointsRequired, color: nextReward.color, iconName: nextReward.iconName }
      : null;

    // Last workout
    let lastWorkout: LastWorkout | null = null;
    if (workouts && workouts.length > 0) {
      const sorted = [...workouts].sort(
        (a, b) => new Date(b.fullDate).getTime() - new Date(a.fullDate).getTime()
      );
      const w = sorted[0];
      lastWorkout = {
        id: w.id,
        name: w.name,
        date: w.date,
        duration: w.duration,
        totalSets: w.totalSets,
        totalReps: w.totalReps,
        formScore: w.formScore,
        timeAgo: getTimeAgo(new Date(w.fullDate)),
      };
    }

    // Weekly goal
    const weeklyGoal: WeeklyGoal = {
      current: Math.min(analytics.summary.workoutCount, weeklyTarget),
      target: weeklyTarget,
    };

    return {
      displayName,
      streakDays,
      formScore: avgFormScore,
      formTrendDirection: analytics.summary.formTrendDirection,
      formTrendPercent: analytics.summary.formTrendPercent,
      weeklyGoal,
      lastWorkout,
      totalPoints: userPoints,
      nextBadge,
    };
  }, [user, analytics, rewards, userStats, userPoints, workouts, weeklyTarget]);

  const refetch = refetchRewards;

  return { homeData, isLoading, error: null as string | null, refetch };
}
