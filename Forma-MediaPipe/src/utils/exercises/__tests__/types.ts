/**
 * Landmark Recording & Replay — Type Definitions
 *
 * Used by the CameraScreen recorder (dev-only) and the Jest replay runner.
 */

export interface LandmarkRecording {
  exerciseName: string;
  metadata: {
    recordedAt: string;
    duration: number;
    description: string;
    expectedReps: number;
    expectedScoreRange: [number, number];
  };
  frames: Array<{
    timestamp: number;
    keypoints: Array<{
      name: string;
      x: number;
      y: number;
      z?: number;
      score: number;
    }>;
  }>;
}

export interface ReplayResult {
  finalRepCount: number;
  repScores: number[];
  feedbackMessages: string[];
}

/** One entry in the FSM trace — emitted each time the FSM phase changes. */
export interface FsmTransition {
  frameIndex: number;
  timestamp: number;
  fromPhase: string;
  toPhase: string;
  /** Key angle values at the moment of transition, sourced from debugInfo. */
  angles: Record<string, number | null>;
}

/** Per-rep summary with its trace data. */
export interface RepTrace {
  repIndex: number;
  score: number;
  messages: string[];
  /** FSM transitions that occurred during this rep. */
  transitions: FsmTransition[];
}

export interface ReplayResultVerbose extends ReplayResult {
  /** Every FSM phase transition across the entire recording. */
  fsmTransitions: FsmTransition[];
  /** Per-rep breakdown. */
  repTraces: RepTrace[];
}
