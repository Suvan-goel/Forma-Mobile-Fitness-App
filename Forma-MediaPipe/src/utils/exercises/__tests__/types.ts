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
