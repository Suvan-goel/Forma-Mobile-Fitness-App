/**
 * Core TypeScript interfaces for the Forma Mobile API layer
 * These types mirror the future Supabase API structure
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
  avatarUrl?: string;
  createdAt: Date;
}

export interface UserStats {
  formScore: number;
  consistencyScore: number;
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
}

export interface WorkoutDetails {
  id: string;
  name: string;
  date: string;
  duration: string;
  exercises: WorkoutExercise[];
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

export interface AnalyticsData {
  formData: AnalyticsMetric;
  consistencyData: AnalyticsMetric;
  strengthData: AnalyticsMetric;
  weeklyBarData: WorkoutBarData[];
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
