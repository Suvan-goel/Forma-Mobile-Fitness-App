/**
 * Analytics service - handles all analytics-related API calls
 */

import { ApiResponse, AnalyticsData, AnalyticsMetric, AnalyticsSummary, WorkoutBarData } from './types';
import { API_CONFIG } from './client';
import { mockDelay } from '../mock/delay';
import {
  formBaseData,
  consistencyBaseData,
  strengthBaseData,
  mockWeeklyBarData,
  generateDataForTimeRange,
  generateMockSummary,
} from '../mock/data/analytics.mock';
import { supabase } from '../supabase/client';

// ── Helpers ────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Weekday indices in Mon–Sun display order
const MON_SUN_ORDER = [1, 2, 3, 4, 5, 6, 0];

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Parse a YYYY-MM-DD string as local midnight (avoids UTC-offset shifting).
 */
function parseLocalDate(dateStr: string): Date {
  const datePart = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Convert a named time range to { startDate, endDate } strings (YYYY-MM-DD).
 * endDate is always today. startDate is N days back (inclusive).
 */
export function getDateRange(timeRange: string): { startDate: string; endDate: string } {
  const today = new Date();
  const endDate = toDateStr(today) + 'T23:59:59.999Z';

  let daysBack: number;
  switch (timeRange) {
    case '1 week':   daysBack = 6;   break; // 7 days total (today + 6 prior)
    case '4 weeks':  daysBack = 27;  break; // 28 days
    case '3 months': daysBack = 90;  break; // ~91 days
    case '6 months': daysBack = 181; break;
    case 'Year':     daysBack = 364; break;
    case 'All Time': daysBack = 730; break;
    default:         daysBack = 6;
  }

  const start = new Date(today);
  start.setDate(today.getDate() - daysBack);
  return { startDate: toDateStr(start), endDate };
}

/**
 * Compute form trend direction by comparing first-half vs second-half averages.
 */
function computeFormTrend(formData: AnalyticsMetric): { direction: 'up' | 'down' | 'flat'; percent: number } {
  const vals = formData.values;
  if (vals.length < 2) return { direction: 'flat', percent: 0 };

  const mid = Math.floor(vals.length / 2);
  const firstHalf = vals.slice(0, mid);
  const secondHalf = vals.slice(mid);
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  if (avgFirst === 0) return { direction: avgSecond > 0 ? 'up' : 'flat', percent: 0 };

  const pct = Math.round(((avgSecond - avgFirst) / avgFirst) * 1000) / 10;
  const direction = pct > 1 ? 'up' : pct < -1 ? 'down' : 'flat';
  return { direction, percent: Math.abs(pct) };
}

/**
 * Compute summary stats from Supabase data.
 */
async function computeSupabaseSummary(
  startDate: string,
  endDate: string,
  formData: AnalyticsMetric,
): Promise<AnalyticsSummary> {
  const trend = computeFormTrend(formData);

  // Run independent queries in parallel
  const [countResult, repResult, exerciseResult, pbResult, streakResult, durationResult] = await Promise.all([
    // Workout count
    supabase
      .from('workout_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('date', startDate)
      .lte('date', endDate),

    // Total reps
    supabase
      .from('workout_sessions')
      .select('workout_exercises(workout_sets(reps))')
      .gte('date', startDate)
      .lte('date', endDate),

    // Exercise frequency
    supabase
      .from('workout_sessions')
      .select('workout_exercises(name)')
      .gte('date', startDate)
      .lte('date', endDate),

    // Personal best (highest weight)
    supabase
      .from('workout_sessions')
      .select('workout_exercises(name, workout_sets(weight))')
      .gte('date', startDate)
      .lte('date', endDate),

    // Streak — all session dates ordered descending
    supabase
      .from('workout_sessions')
      .select('date')
      .lte('date', endDate)
      .order('date', { ascending: false }),

    // Total duration for selected time range
    supabase
      .from('workout_sessions')
      .select('duration_seconds')
      .gte('date', startDate)
      .lte('date', endDate),
  ]);

  // Workout count
  const workoutCount = countResult.count ?? 0;

  // Total reps
  let totalReps = 0;
  (repResult.data ?? []).forEach((session: any) => {
    (session.workout_exercises ?? []).forEach((ex: any) => {
      (ex.workout_sets ?? []).forEach((set: any) => {
        totalReps += set.reps ?? 0;
      });
    });
  });

  // Most trained exercise
  const exerciseFreq: Record<string, number> = {};
  (exerciseResult.data ?? []).forEach((session: any) => {
    (session.workout_exercises ?? []).forEach((ex: any) => {
      if (ex.name) {
        exerciseFreq[ex.name] = (exerciseFreq[ex.name] || 0) + 1;
      }
    });
  });
  const sortedExercises = Object.entries(exerciseFreq).sort((a, b) => b[1] - a[1]);
  const mostTrainedExercise = sortedExercises.length > 0 ? sortedExercises[0][0] : null;

  // Personal best
  let personalBest: { exercise: string; weight: number } | null = null;
  let maxWeight = 0;
  (pbResult.data ?? []).forEach((session: any) => {
    (session.workout_exercises ?? []).forEach((ex: any) => {
      (ex.workout_sets ?? []).forEach((set: any) => {
        if ((set.weight ?? 0) > maxWeight) {
          maxWeight = set.weight;
          personalBest = { exercise: ex.name, weight: set.weight };
        }
      });
    });
  });

  // Streak — count consecutive days with workouts going backwards from today
  let streakDays = 0;
  if (streakResult.data && streakResult.data.length > 0) {
    const uniqueDates = [...new Set(
      streakResult.data.map((r: any) => (r.date as string).split('T')[0]),
    )].sort().reverse();

    const todayStr = toDateStr(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = toDateStr(yesterdayDate);

    // Streak must start from today or yesterday
    if (uniqueDates[0] === todayStr || uniqueDates[0] === yesterdayStr) {
      let expectedDate = parseLocalDate(uniqueDates[0]);
      for (const dateStr of uniqueDates) {
        if (dateStr === toDateStr(expectedDate)) {
          streakDays++;
          expectedDate.setDate(expectedDate.getDate() - 1);
        } else {
          break;
        }
      }
    }
  }

  // Total duration in minutes for the selected time range
  let totalDurationMinutes = 0;
  (durationResult.data ?? []).forEach((session: any) => {
    totalDurationMinutes += Math.round((session.duration_seconds ?? 0) / 60);
  });

  return {
    workoutCount,
    totalReps,
    avgRepsPerWorkout: workoutCount > 0 ? Math.round(totalReps / workoutCount) : 0,
    totalDurationMinutes,
    streakDays,
    mostTrainedExercise,
    personalBest,
    formTrendDirection: trend.direction,
    formTrendPercent: trend.percent,
  };
}

// ── Service ────────────────────────────────────────────────────

export const analyticsService = {
  /**
   * Get all analytics data for a given time range.
   * When analytics flag is false, queries Supabase directly from workout tables.
   */
  async getAnalytics(timeRange: string = '1 week'): Promise<ApiResponse<AnalyticsData>> {
    if (API_CONFIG.services.analytics) {
      await mockDelay(API_CONFIG.mockDelayMs);

      const formResult = generateDataForTimeRange(formBaseData, timeRange);
      const consistencyResult = generateDataForTimeRange(consistencyBaseData, timeRange);
      const strengthResult = generateDataForTimeRange(strengthBaseData, timeRange);

      return {
        data: {
          formData: { values: formResult.values, dates: formResult.dates },
          consistencyData: { values: consistencyResult.values, dates: consistencyResult.dates },
          strengthData: { values: strengthResult.values, dates: strengthResult.dates },
          weeklyBarData: mockWeeklyBarData,
          summary: generateMockSummary(timeRange),
        },
        success: true,
      };
    }

    // ── Real Supabase implementation ───────────────────────────
    const { startDate, endDate } = getDateRange(timeRange);

    // 1. Form trend — form_score per session date
    const { data: formRows, error: formErr } = await supabase
      .from('workout_sessions')
      .select('date, form_score')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (formErr) {
      return { data: {} as AnalyticsData, success: false, error: formErr.message };
    }

    const formData: AnalyticsMetric = {
      values: (formRows ?? []).map((r) => r.form_score as number),
      dates: (formRows ?? []).map((r) => parseLocalDate(r.date as string)),
    };

    // 2. Consistency — rolling 7-day workout frequency, target 3 sessions/week
    // Query from 6 days before startDate so the first days in range have a full window.
    const CONSISTENCY_TARGET = 3; // sessions per 7 days = 100%
    const lookbackStart = parseLocalDate(startDate);
    lookbackStart.setDate(lookbackStart.getDate() - 6);

    const { data: consistencyRows, error: consistencyErr } = await supabase
      .from('workout_sessions')
      .select('date')
      .gte('date', toDateStr(lookbackStart))
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (consistencyErr) {
      return { data: {} as AnalyticsData, success: false, error: consistencyErr.message };
    }

    // Build a sorted array of session date strings for the window scan
    const allSessionDates = (consistencyRows ?? []).map((r) =>
      (r.date as string).split('T')[0],
    );

    const consistencyValues: number[] = [];
    const consistencyDates: Date[] = [];
    const cursor = parseLocalDate(startDate);
    const rangeEnd = parseLocalDate(endDate);

    while (cursor <= rangeEnd) {
      const windowEnd = toDateStr(cursor);
      const windowStart = new Date(cursor);
      windowStart.setDate(cursor.getDate() - 6);
      const windowStartStr = toDateStr(windowStart);

      const count = allSessionDates.filter(
        (d) => d >= windowStartStr && d <= windowEnd,
      ).length;

      consistencyValues.push(Math.min(100, Math.round((count / CONSISTENCY_TARGET) * 100)));
      consistencyDates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    const consistencyData: AnalyticsMetric = { values: consistencyValues, dates: consistencyDates };

    // 3. Strength / volume — total weight × reps per session date
    const { data: volSessions, error: volErr } = await supabase
      .from('workout_sessions')
      .select(`
        date,
        workout_exercises (
          workout_sets (
            weight,
            reps
          )
        )
      `)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (volErr) {
      return { data: {} as AnalyticsData, success: false, error: volErr.message };
    }

    const volumeByDate: Record<string, number> = {};
    (volSessions ?? []).forEach((session: any) => {
      const vol = (session.workout_exercises ?? []).reduce((sum: number, ex: any) => {
        return sum + (ex.workout_sets ?? []).reduce(
          (s: number, set: any) => s + (set.weight ?? 0) * (set.reps ?? 0),
          0,
        );
      }, 0);
      const ds = (session.date as string).split('T')[0];
      volumeByDate[ds] = (volumeByDate[ds] || 0) + vol;
    });

    const volDates = Object.keys(volumeByDate).sort();
    const strengthData: AnalyticsMetric = {
      values: volDates.map((d) => volumeByDate[d]),
      dates: volDates.map(parseLocalDate),
    };

    // 4. Weekly bar chart — duration in minutes per weekday for last 7 days
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    const todayEndOfDay = toDateStr(today) + 'T23:59:59.999Z';

    const { data: weekRows, error: weekErr } = await supabase
      .from('workout_sessions')
      .select('date, duration_seconds')
      .gte('date', toDateStr(sevenDaysAgo))
      .lte('date', todayEndOfDay);

    if (weekErr) {
      return { data: {} as AnalyticsData, success: false, error: weekErr.message };
    }

    const durationByDay: Record<number, number> = {};
    (weekRows ?? []).forEach((session: any) => {
      const d = parseLocalDate(session.date as string);
      const dayIdx = d.getDay(); // 0=Sun, 1=Mon, ...
      durationByDay[dayIdx] = (durationByDay[dayIdx] || 0) +
        Math.round((session.duration_seconds as number) / 60);
    });

    const weeklyBarData: WorkoutBarData[] = MON_SUN_ORDER.map((dayIdx) => ({
      day: DAY_NAMES[dayIdx],
      value: durationByDay[dayIdx] || 0,
    }));

    // 5. Summary — workout count, total reps, most trained exercise, personal best, streak
    const summary = await computeSupabaseSummary(startDate, endDate, formData);

    return {
      data: { formData, consistencyData, strengthData, weeklyBarData, summary },
      success: true,
    };
  },

  /**
   * Get a specific metric's data for a given time range.
   */
  async getMetricByTimeRange(
    metric: 'form' | 'consistency' | 'strength',
    timeRange: string
  ): Promise<ApiResponse<AnalyticsMetric>> {
    if (API_CONFIG.services.analytics) {
      await mockDelay(API_CONFIG.mockDelayMs);

      let baseData: number[];
      switch (metric) {
        case 'form':         baseData = formBaseData;         break;
        case 'consistency':  baseData = consistencyBaseData;  break;
        case 'strength':     baseData = strengthBaseData;     break;
      }

      const result = generateDataForTimeRange(baseData, timeRange);
      return { data: { values: result.values, dates: result.dates }, success: true };
    }

    // Real: delegate to getAnalytics and extract the metric
    const result = await analyticsService.getAnalytics(timeRange);
    if (!result.success) {
      return { data: { values: [], dates: [] }, success: false, error: result.error };
    }

    const metricKey = `${metric}Data` as keyof typeof result.data;
    return { data: result.data[metricKey] as AnalyticsMetric, success: true };
  },

  /**
   * Get weekly bar chart data (last 7 days, Mon–Sun).
   */
  async getWeeklyBarData(): Promise<ApiResponse<WorkoutBarData[]>> {
    if (API_CONFIG.services.analytics) {
      await mockDelay(API_CONFIG.mockDelayMs);
      return { data: mockWeeklyBarData, success: true };
    }

    // Real: delegate to getAnalytics and extract weeklyBarData
    const result = await analyticsService.getAnalytics('1 week');
    if (!result.success) {
      return { data: [], success: false, error: result.error };
    }
    return { data: result.data.weeklyBarData, success: true };
  },
};
