/**
 * Landmark replay and labelled dataset types.
 *
 * These are shared by Jest tests, desktop dataset tooling, and future
 * optimisation scripts. The recording shape intentionally matches the JSON
 * emitted by CameraScreen's dev landmark recorder.
 */

import type { Keypoint } from '../../poseAnalysis';
import type { ExerciseHeuristicConfig } from '../types';
import type {
  PoseQualitySnapshot,
  PoseQualityStatus,
  PoseQualityWarning,
  RepTrackingQuality,
  SetTrackingQualitySummary,
} from '../shared/poseQuality';

export interface LandmarkRecording {
  exerciseName: string;
  metadata: {
    recordedAt?: string;
    duration?: number;
    description?: string;
    expectedReps?: number;
    expectedScoreRange?: [number, number];
    sourceVideo?: string;
    modelName?: string;
    modelPath?: string;
    fps?: number;
    frameCount?: number;
    processedFrameCount?: number;
  };
  frames: Array<{
    timestamp: number;
    keypoints: Keypoint[];
    imageKeypoints?: Keypoint[];
  }>;
}

export interface ReplayRepPrediction {
  repIndex: number;
  score: number;
  messages: string[];
  issueIds: string[];
  completedAt: number;
  startedAt: number | null;
  confidence?: number;
  qualityStatus?: PoseQualityStatus;
  qualityWarnings?: PoseQualityWarning[];
  scorable?: boolean;
}

export interface ReplayResult {
  finalRepCount: number;
  repScores: number[];
  feedbackMessages: string[];
  reps: ReplayRepPrediction[];
  qualitySummary?: SetTrackingQualitySummary;
}

export interface ReplayOptions {
  heuristicConfig?: ExerciseHeuristicConfig;
  confidenceGating?: boolean;
}

/** Per-frame debug sample captured during verbose replay. */
export interface FrameTrace {
  frameIndex: number;
  timestamp: number;
  phase: string;
  repCount: number;
  feedback: string | null;
  debugInfo: Record<string, unknown>;
  quality?: PoseQualitySnapshot;
}

/** One entry in the FSM trace, emitted each time the FSM phase changes. */
export interface FsmTransition {
  frameIndex: number;
  timestamp: number;
  fromPhase: string;
  toPhase: string;
  /** Key angle values at the moment of transition, sourced from debugInfo. */
  angles: Record<string, number | null>;
}

/** Per-rep summary with its trace data. */
export interface RepTrace extends ReplayRepPrediction {
  /** FSM transitions that occurred during this rep. */
  transitions: FsmTransition[];
}

export interface ReplayResultVerbose extends ReplayResult {
  /** One debug sample per processed frame. */
  frameTraces: FrameTrace[];
  /** Every FSM phase transition across the entire recording. */
  fsmTransitions: FsmTransition[];
  /** Per-rep breakdown. */
  repTraces: RepTrace[];
}

export type QualityCoverage = SetTrackingQualitySummary;
export type ReplayRepQuality = RepTrackingQuality;
