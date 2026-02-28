/**
 * Core TypeScript interfaces for the Forma Mobile API layer
 * These types mirror the Supabase DB schema
 */

// Generic API response wrapper
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
}

// User types
export interface User {
  id: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  createdAt: Date;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  provider: 'google' | 'apple';
}

export interface UserStats {
  /** Cumulative points earned from workout quality (form scores). Displayed as "+N FORM" on RewardsScreen. */
  formScore: number;
  /** Cumulative points earned from weekly consistency bonuses + streaks. Displayed as "+N CONSISTENCY". */
  consistencyScore: number;
  /** Badge IDs the user has permanently earned (matches Reward.id). Source of truth for badge display and leaderboards. */
  earnedBadgeIds: string[];
}

// Exercise types
export interface MuscleGroup {
  id: string;
  name: string;
  icon: string;
}

export interface Exercise {
  name: string;
  muscleGroup: string;
  category: string;
  image?: any;
}

// Workout types
export interface WorkoutSet {
  setNumber: number;
  reps: number;
  weight: number;
  formScore: number;
  notes?: string;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id: string;
  name: string;
  date: string;
  fullDate: Date;
  duration: string;
  totalSets: number;
  totalReps: number;
  formScore: number;
  category?: string;
  userId?: string;
}

export interface WorkoutDetails {
  id: string;
  name: string;
  date: string;
  duration: string;
  notes?: string;
  exercises: WorkoutExercise[];
}

export interface CreateWorkoutPayload {
  name: string;
  date: Date;
  durationSeconds: number;
  category?: string;
  notes?: string;
  exercises: {
    name: string;
    orderIndex: number;
    sets: {
      setNumber: number;
      reps: number;
      weight: number;
      formScore: number;
      notes?: string;
    }[];
  }[];
}

// Analytics types
export interface AnalyticsMetric {
  values: number[];
  dates: Date[];
}

export interface WorkoutBarData {
  day: string;
  value: number;
}

export interface AnalyticsSummary {
  workoutCount: number;
  totalReps: number;
  avgRepsPerWorkout: number;
  totalDurationMinutes: number;
  streakDays: number;
  mostTrainedExercise: string | null;
  personalBest: { exercise: string; weight: number } | null;
  formTrendDirection: 'up' | 'down' | 'flat';
  formTrendPercent: number;
}

export interface AnalyticsData {
  formData: AnalyticsMetric;
  consistencyData: AnalyticsMetric;
  strengthData: AnalyticsMetric;
  weeklyBarData: WorkoutBarData[];
  summary: AnalyticsSummary;
}

// Trainer types
export interface Recommendation {
  type: 'success' | 'warning' | 'info';
  title: string;
  message: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

export interface TrainerProgress {
  avgFormScore: number;
  formTrend: number;
  totalReps: number;
  avgDuration: number;
  workoutCount: number;
}

// Insights types
export interface InsightsData {
  Form: string[];
  Consistency: string[];
  Strength: string[];
}

// Rewards types
export interface Reward {
  id: string;
  title: string;
  description: string;
  pointsRequired: number;
  iconName: string;
  color: string;
  category: string;
}

// ── Social types ──────────────────────────────────────────────

// Leaderboard
export type LeaderboardMetric = 'form_score' | 'weekly_volume' | 'streak';
export type TimeWindow = '1_week' | '1_month' | 'all_time';

export interface LeaderboardEntry {
  userId: string;
  rank: number;
  displayName: string;
  avatarUrl?: string;
  score: number;
  trend?: 'up' | 'down' | 'stable';
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  totalParticipants: number;
  currentUser: LeaderboardEntry | null;
}

// Friends
export type FriendshipStatus = 'pending' | 'accepted' | 'declined' | 'blocked';

export interface Friend {
  friendshipId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  lastActive?: string;
  streakDays: number;
  avgFormScore: number;
}

export interface FriendRequest {
  friendshipId: string;
  fromUserId: string;
  fromDisplayName: string;
  fromAvatarUrl?: string;
  sentAt: Date;
}

export interface SuggestedFriend {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  mutualFriendCount: number;
}

export interface UserSearchResult {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  mutualFriendCount: number;
  relationshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends';
}

export interface FriendProfileData {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  memberSince: Date;
  totalWorkouts: number;
  streakDays: number;
  avgFormScore: number;
  earnedBadgeIds: string[];
  recentWorkouts: WorkoutSession[];
}

export interface ComparisonStats {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  avgFormScore: number;
  streakDays: number;
  weeklyWorkouts: number;
  bestSetScore: number;
  totalPoints: number;
}

export interface ComparisonData {
  you: ComparisonStats;
  friend: ComparisonStats;
}

// Activity
export type ActivityEventType = 'workout_completed' | 'badge_earned' | 'personal_record' | 'streak_milestone';
export type ActivityFilter = 'all' | 'workouts' | 'badges' | 'records';

export interface ActivityEvent {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  eventType: ActivityEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface ActivityFeedPage {
  events: ActivityEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateActivityEventPayload {
  eventType: ActivityEventType;
  payload: Record<string, unknown>;
  sourceId?: string;
}
