/**
 * Points calculator — pure functions, no React, no Supabase.
 * Used by useSaveWorkout (per-workout points) and rewards.service (weekly consistency).
 */

import type { CreateWorkoutPayload } from '../backend/services/api/types';

// ── Internal helpers ──────────────────────────────────────────

function tierPoints(formScore: number): number {
  if (formScore >= 85) return 3;
  if (formScore >= 75) return 2;
  return 1; // [60, 75)
}

function volumePoints(weight: number, reps: number): number {
  return Math.min(5, Math.floor((weight * reps) / 500));
}

function sessionFormBonus(avgFormScore: number): number {
  if (avgFormScore >= 90) return 10;
  if (avgFormScore >= 80) return 5;
  if (avgFormScore >= 70) return 2;
  return 0;
}

function durationBonus(durationSeconds: number): number {
  if (durationSeconds >= 2400) return 5; // 40 min+
  if (durationSeconds >= 1200) return 3; // 20 min+
  if (durationSeconds >= 600)  return 1; // 10 min+
  return 0;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Compute points earned for a single workout session.
 *
 * Only sets with formScore >= 60 earn set-level points.
 * Total is capped at 25 per workout.
 *
 * @returns integer in [0, 25]
 */
export function calculateWorkoutPoints(payload: CreateWorkoutPayload): number {
  let rawSetPts = 0;
  let formScoreSum = 0;
  let setsWithScore = 0;

  for (const exercise of payload.exercises) {
    for (const set of exercise.sets) {
      if (set.formScore > 0) {
        formScoreSum += set.formScore;
        setsWithScore++;
      }
      if (set.formScore >= 60) {
        rawSetPts += tierPoints(set.formScore) + volumePoints(set.weight, set.reps);
      }
    }
  }

  const avgFormScore = setsWithScore > 0 ? formScoreSum / setsWithScore : 0;

  const total =
    rawSetPts +
    sessionFormBonus(avgFormScore) +
    durationBonus(payload.durationSeconds);

  return Math.min(25, total);
}

/**
 * Compute weekly consistency points.
 *
 * @param workoutsInWeek           - Distinct workout days in the completed Mon-Sun week
 * @param weeklyTarget             - User's target (2, 4, or 6)
 * @param consecutiveWeeksStreak   - Weeks in a row where ratio >= 1.0
 * @returns integer in [0, 35]
 */
export function calculateWeeklyConsistencyPoints(
  workoutsInWeek: number,
  weeklyTarget: number,
  consecutiveWeeksStreak: number,
): number {
  const ratio = weeklyTarget > 0 ? workoutsInWeek / weeklyTarget : 0;

  let consistencyPts: number;
  if (ratio >= 1.0)       consistencyPts = 20;
  else if (ratio >= 0.75) consistencyPts = 10;
  else if (ratio >= 0.50) consistencyPts = 5;
  else                    consistencyPts = 0;

  let streakBonus: number;
  if (consecutiveWeeksStreak >= 8)      streakBonus = 15;
  else if (consecutiveWeeksStreak >= 4) streakBonus = 10;
  else if (consecutiveWeeksStreak >= 2) streakBonus = 5;
  else                                   streakBonus = 0;

  return Math.min(35, consistencyPts + streakBonus);
}

/**
 * Returns the ISO week string 'YYYY-WNN' for a given date.
 * Used as source_id in the points ledger for deduplication.
 */
function isoWeekId(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // ISO 8601: week containing the Thursday of the given date
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Returns the ISO week string for the most recently completed Mon-Sun week.
 * If today is Monday, "last completed week" is the one that ended yesterday (Sunday).
 */
export function lastCompletedIsoWeekId(): string {
  const today = new Date();
  const dow = today.getDay() || 7; // Mon=1 … Sun=7
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - dow);
  return isoWeekId(lastSunday);
}
