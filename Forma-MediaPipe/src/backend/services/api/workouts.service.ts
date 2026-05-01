/**
 * Workouts service - handles all workout-related API calls
 */

import { ApiResponse, WorkoutSession, WorkoutDetails, CreateWorkoutPayload } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import { mockWorkoutSessions, mockWorkoutDetails } from '../mock/data/workouts.mock';
import { supabase } from '../supabase/client';

// ── Mapper helpers ────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}min` : `${h}h`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function mapWorkoutSessionRow(row: any): WorkoutSession {
  const workoutExercises = Array.isArray(row.workout_exercises) ? row.workout_exercises : [];
  const firstExercise = [...workoutExercises].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
  )[0];

  return {
    id: row.id,
    name: row.name,
    date: formatDate(row.date),
    fullDate: new Date(row.date),
    duration: formatDuration(row.duration_seconds),
    totalSets: row.total_sets,
    totalReps: row.total_reps,
    formScore: Math.round(row.form_score),
    category: row.category ?? undefined,
    firstExerciseName: firstExercise?.name,
    userId: row.user_id,
  };
}

function mapWorkoutDetailsRow(row: any): WorkoutDetails {
  return {
    id: row.id,
    name: row.name,
    date: formatDate(row.date),
    duration: formatDuration(row.duration_seconds),
    notes: row.notes ?? undefined,
    exercises: (row.workout_exercises ?? []).map((ex: any) => ({
      id: ex.id,
      name: ex.name,
      sets: (ex.workout_sets ?? []).map((s: any) => ({
        setNumber: s.set_number,
        reps: s.reps,
        weight: s.weight,
        formScore: Math.round(s.form_score),
        notes: s.notes ?? undefined,
      })),
    })),
  };
}

// ── Service ───────────────────────────────────────────────────

export const workoutsService = {
  /**
   * Get all workout sessions
   */
  async getAll(userId?: string): Promise<ApiResponse<WorkoutSession[]>> {
    if (API_CONFIG.services.workouts) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockWorkoutSessions, success: true };
    }

    await supabase.auth.getSession();

    let query = supabase
      .from('workout_sessions')
      .select('*, workout_exercises(name, order_index)')
      .order('date', { ascending: false });

    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;

    if (error) return { data: [], success: false, error: error.message };
    return { data: (data ?? []).map(mapWorkoutSessionRow), success: true };
  },

  /**
   * Get a specific workout by ID
   */
  async getById(id: string): Promise<ApiResponse<WorkoutDetails | null>> {
    if (API_CONFIG.services.workouts) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const workout = mockWorkoutDetails[id] || null;
      return { data: workout, success: true };
    }

    const { data, error } = await supabase
      .from('workout_sessions')
      .select('*, workout_exercises(*, workout_sets(*))')
      .eq('id', id)
      .single();

    if (error) return { data: null, success: false, error: error.message };
    return { data: data ? mapWorkoutDetailsRow(data) : null, success: true };
  },

  /**
   * Get recent workouts with a limit
   */
  async getRecent(limit: number = 5, userId?: string): Promise<ApiResponse<WorkoutSession[]>> {
    if (API_CONFIG.services.workouts) {
      await mockDelay(API_CONFIG.mockDelayMs);
      const recent = mockWorkoutSessions.slice(0, limit);
      return { data: recent, success: true };
    }

    await supabase.auth.getSession();

    let query = supabase
      .from('workout_sessions')
      .select('*, workout_exercises(name, order_index)')
      .order('date', { ascending: false })
      .limit(limit);

    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;

    if (error) return { data: [], success: false, error: error.message };
    return { data: (data ?? []).map(mapWorkoutSessionRow), success: true };
  },

  /**
   * Create a new workout session with exercises and sets
   */
  async create(payload: CreateWorkoutPayload): Promise<ApiResponse<WorkoutSession>> {
    if (API_CONFIG.services.workouts) {
      await mockDelay(API_CONFIG.mockDelayMs);
      // Return a fake session in mock mode
      const fake: WorkoutSession = {
        id: String(Date.now()),
        name: payload.name,
        date: formatDate(payload.date.toISOString()),
        fullDate: payload.date,
        duration: formatDuration(payload.durationSeconds),
        totalSets: payload.exercises.reduce((n, ex) => n + ex.sets.length, 0),
        totalReps: payload.exercises.reduce((n, ex) => n + ex.sets.reduce((m, s) => m + s.reps, 0), 0),
        formScore: 0,
        category: payload.category,
      };
      return { data: fake, success: true };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: {} as WorkoutSession, success: false, error: 'Not authenticated' };

    // 1. Insert the session row
    const { data: sessionRow, error: sessionErr } = await supabase
      .from('workout_sessions')
      .insert({
        user_id: user.id,
        name: payload.name,
        date: payload.date.toISOString(),
        duration_seconds: payload.durationSeconds,
        category: payload.category ?? null,
        notes: payload.notes ?? null,
      })
      .select()
      .single();

    if (sessionErr || !sessionRow) {
      return { data: {} as WorkoutSession, success: false, error: sessionErr?.message ?? 'Insert failed' };
    }

    // 2. Insert exercises and their sets
    for (const ex of payload.exercises) {
      const { data: exRow, error: exErr } = await supabase
        .from('workout_exercises')
        .insert({ session_id: sessionRow.id, name: ex.name, order_index: ex.orderIndex })
        .select()
        .single();

      if (exErr || !exRow) continue;

      if (ex.sets.length > 0) {
        await supabase.from('workout_sets').insert(
          ex.sets.map((s) => ({
            exercise_id: exRow.id,
            set_number: s.setNumber,
            reps: s.reps,
            weight: s.weight,
            form_score: s.formScore,
            notes: s.notes ?? null,
          }))
        );
      }
    }

    // 3. Re-fetch the session to get trigger-computed aggregates
    const { data: refreshed } = await supabase
      .from('workout_sessions')
      .select('*')
      .eq('id', sessionRow.id)
      .single();

    return {
      data: refreshed ? mapWorkoutSessionRow(refreshed) : mapWorkoutSessionRow(sessionRow),
      success: true,
    };
  },

  /**
   * Delete a workout session (cascades to exercises and sets)
   */
  async delete(id: string): Promise<ApiResponse<void>> {
    if (API_CONFIG.services.workouts) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: undefined, success: true };
    }

    const { error } = await supabase
      .from('workout_sessions')
      .delete()
      .eq('id', id);

    if (error) return { data: undefined, success: false, error: error.message };
    return { data: undefined, success: true };
  },
};
