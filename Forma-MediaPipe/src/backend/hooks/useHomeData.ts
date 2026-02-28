/**
 * Composite hook for Home screen data.
 * Aggregates existing hooks + provides mock social/news data.
 */

import { useMemo } from 'react';
import { useAnalytics } from './useAnalytics';
import { useRewards } from './useRewards';
import { useWorkouts } from './useWorkouts';
import { useUser } from './useUser';
import { useWorkoutPreferences } from './useWorkoutPreferences';

// ── Types ──────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  points: number;
  isCurrentUser: boolean;
}

export interface ActivityItem {
  id: string;
  displayName: string;
  action: string;
  timeAgo: string;
}

export interface NewsItem {
  id: string;
  category: 'tip' | 'update' | 'new';
  title: string;
  body: string;
  date: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  navigateTo: string;
}

export interface NextBadge {
  name: string;
  current: number;
  required: number;
  color: string;
  iconName: string;
}

export interface HomeData {
  firstName: string;
  displayName: string;
  streakDays: number;
  totalPoints: number;
  formScore: number;
  formTrendDirection: 'up' | 'down' | 'flat';
  formTrendPercent: number;
  workoutCount: number;
  nextBadge: NextBadge | null;
  motivationalQuote: string;
  challenges: Challenge[];
  socialPreview: { leaderboard: LeaderboardEntry[]; friendActivity: ActivityItem[] };
  news: NewsItem[];
}

// ── Static Data ────────────────────────────────────

const MOTIVATIONAL_QUOTES = [
  'The only bad workout is the one that didn\'t happen.',
  'Your body can stand almost anything. It\'s your mind you have to convince.',
  'Discipline is choosing between what you want now and what you want most.',
  'Small daily improvements are the key to staggering long-term results.',
  'Don\'t wish for it. Work for it.',
  'Consistency beats intensity. Show up every day.',
  'You don\'t have to be extreme, just consistent.',
  'Progress, not perfection.',
  'The pain you feel today will be the strength you feel tomorrow.',
  'Every rep counts. Make them all matter.',
];

const MOCK_LEADERBOARD_BASE: Omit<LeaderboardEntry, 'isCurrentUser'>[] = [
  { rank: 1, displayName: 'Alex M.', points: 4200 },
  { rank: 2, displayName: 'Jordan K.', points: 3850 },
  { rank: 4, displayName: 'Sam R.', points: 2100 },
  { rank: 5, displayName: 'Taylor P.', points: 1750 },
];

const MOCK_ACTIVITY: ActivityItem[] = [
  { id: 'a1', displayName: 'Alex M.', action: 'completed a workout', timeAgo: '2h ago' },
  { id: 'a2', displayName: 'Jordan K.', action: 'earned a new badge', timeAgo: '5h ago' },
];

const MOCK_NEWS: NewsItem[] = [
  { id: 'n1', category: 'tip', title: 'Perfect Your Curl Form', body: 'Focus on keeping your elbows pinned to your sides and controlling the eccentric phase for maximum gains.', date: 'Feb 28' },
  { id: 'n2', category: 'new', title: 'Push-Up Tracking Available', body: 'Track your push-up form with real-time AI feedback. Head to the Capture tab to try it out.', date: 'Feb 25' },
  { id: 'n3', category: 'update', title: 'Scoring Refinements', body: 'We\'ve fine-tuned our penalty curves for more accurate form scoring across all exercises.', date: 'Feb 20' },
];

const WEEKLY_TARGET_MAP: Record<string, number> = { '1-2': 2, '3-4': 4, '5+': 6 };

const STREAK_TIERS = [7, 14, 30, 60, 100];

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
    const firstName = user.firstName || displayName.split(' ')[0] || 'there';
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

    // Daily motivational quote (stable within a day)
    const dayIndex = Math.floor(Date.now() / 86400000) % MOTIVATIONAL_QUOTES.length;
    const motivationalQuote = MOTIVATIONAL_QUOTES[dayIndex];

    // Challenges
    const challenges: Challenge[] = [];

    // 1. Weekly workouts
    challenges.push({
      id: 'weekly_workouts',
      title: 'Weekly Workouts',
      description: `Complete ${weeklyTarget} workouts this week`,
      currentValue: Math.min(analytics.summary.workoutCount, weeklyTarget),
      targetValue: weeklyTarget,
      unit: 'workouts',
      navigateTo: 'Record',
    });

    // 2. Streak goal
    const streakTarget = STREAK_TIERS.find(t => t > streakDays) ?? streakDays + 7;
    challenges.push({
      id: 'streak_goal',
      title: 'Streak Goal',
      description: `Reach a ${streakTarget}-day streak`,
      currentValue: Math.min(streakDays, streakTarget),
      targetValue: streakTarget,
      unit: 'days',
      navigateTo: 'Analytics',
    });

    // 3. Form score challenge
    challenges.push({
      id: 'form_score',
      title: 'Form Mastery',
      description: 'Average 85+ form score this week',
      currentValue: Math.min(avgFormScore, 100),
      targetValue: 85,
      unit: 'avg score',
      navigateTo: 'Analytics',
    });

    // Mock leaderboard with current user injected
    const leaderboard: LeaderboardEntry[] = [
      { ...MOCK_LEADERBOARD_BASE[0], isCurrentUser: false },
      { ...MOCK_LEADERBOARD_BASE[1], isCurrentUser: false },
      { rank: 3, displayName: firstName, points: userPoints, isCurrentUser: true },
      { ...MOCK_LEADERBOARD_BASE[2], isCurrentUser: false },
      { ...MOCK_LEADERBOARD_BASE[3], isCurrentUser: false },
    ];

    return {
      firstName,
      displayName,
      streakDays,
      totalPoints: userPoints,
      formScore: avgFormScore,
      formTrendDirection: analytics.summary.formTrendDirection,
      formTrendPercent: analytics.summary.formTrendPercent,
      workoutCount: workouts?.length ?? 0,
      nextBadge,
      motivationalQuote,
      challenges,
      socialPreview: { leaderboard, friendActivity: MOCK_ACTIVITY },
      news: MOCK_NEWS,
    };
  }, [user, analytics, rewards, userStats, userPoints, workouts, weeklyTarget]);

  const refetch = refetchRewards;

  return { homeData, isLoading, error: null as string | null, refetch };
}
