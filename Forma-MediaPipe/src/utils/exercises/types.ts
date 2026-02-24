/**
 * Exercise Framework — Core Types
 *
 * Standard interfaces for all exercises. CameraScreen interacts with
 * exercises only through these types + ExerciseRegistry.
 */

import type { Keypoint } from '../poseAnalysis';

// ============================================================================
// ExerciseState — the standard external state every exercise exposes
// ============================================================================

export interface ExerciseState {
  /** Rep counter (integer, starts at 0) */
  repCount: number;
  /** Last completed rep's result (score + messages), or null if no reps yet */
  lastRepResult: RepResult | null;
  /** Current visual feedback string, or null */
  feedback: string | null;
  /** Timestamp of last feedback in seconds (for auto-clear) */
  feedbackTimestamp: number | null;
  /** Debug info for on-screen overlay (exercise-specific shape, opaque to CameraScreen) */
  debugInfo: Record<string, unknown>;
  /** Opaque internal state — only the exercise's own update() reads/writes this */
  _internal: unknown;
}

// ============================================================================
// RepResult — per-rep scoring and feedback
// ============================================================================

export interface RepResult {
  repIndex: number;
  score: number;         // 0-100
  messages: string[];    // Visual feedback strings (may be empty for perfect rep)
}

// ============================================================================
// ExerciseTTSConfig — TTS integration for an exercise
// ============================================================================

export interface ExerciseTTSConfig {
  /** Maps exact visual feedback strings to IssueType strings */
  feedbackToIssue: Record<string, string>;
  /** New IssueType definitions with priority and message pools (only for types not already registered) */
  issueDefinitions?: Array<{
    issueType: string;
    priority: number;
    messages: string[];
  }>;
}

// ============================================================================
// ExerciseDefinition — the contract every exercise must satisfy
// ============================================================================

export interface ExerciseDefinition {
  /** Display name (must match exerciseName in route params / exercise catalog) */
  name: string;

  /** Required camera view for this exercise */
  requiredView: 'front' | 'side' | 'any';

  /** Create a fresh state object for this exercise */
  createState: () => ExerciseState;

  /** Process one frame of landmarks. Returns updated state (may mutate _internal). */
  update: (keypoints: Keypoint[], currentState: ExerciseState) => ExerciseState;

  /**
   * TTS config for this exercise.
   * Maps this exercise's visual feedback strings to IssueTypes and provides message pools.
   * Merged into the global TTS maps at registration time.
   */
  ttsConfig: ExerciseTTSConfig;

  /**
   * Set summary config for this exercise.
   * Maps visual feedback strings to improvement suggestions.
   * Merged into the global FEEDBACK_TO_IMPROVEMENT map at registration time.
   */
  summaryConfig: Record<string, string>;
}
