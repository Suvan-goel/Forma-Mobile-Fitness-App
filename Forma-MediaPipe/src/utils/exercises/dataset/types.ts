import type { LandmarkRecording, ReplayRepPrediction } from '../replay';

export type DatasetSplit = 'train' | 'validation' | 'test';
export type LabelReviewStatus = 'draft' | 'reviewed';

export interface AvailableIssue {
  issueId: string;
  feedbackMessage: string;
}

export interface DraftLabelMetadata {
  generatedAt: string;
  generator: string;
  source: 'heuristic-replay';
}

export interface RepLabel {
  index: number;
  startMs: number;
  endMs: number;
  issueIds: string[];
  notes?: string;
  suggestedIssueIds?: string[];
  suggestedFeedbackMessages?: string[];
  suggestedScore?: number;
}

export interface ExerciseLabelFile {
  schemaVersion: 1;
  exerciseName: string;
  sourceVideo: string;
  landmarkFile?: string;
  split: DatasetSplit;
  reviewStatus?: LabelReviewStatus;
  expectedReps: number;
  reps: RepLabel[];
  notes?: string;
  availableIssues?: AvailableIssue[];
  draftMetadata?: DraftLabelMetadata;
}

export interface DatasetCase {
  label: ExerciseLabelFile;
  recording: LandmarkRecording;
  labelPath?: string;
  recordingPath?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type RepMatchStatus = 'matched' | 'missing_expected' | 'extra_predicted';

export interface RepEvaluation {
  index: number;
  matchStatus: RepMatchStatus;
  expectedRepIndex: number | null;
  predictedRepIndex: number | null;
  expectedStartMs: number | null;
  expectedEndMs: number | null;
  predictedStartMs: number | null;
  predictedEndMs: number | null;
  overlapMs: number;
  completionDeltaMs: number | null;
  expectedIssueIds: string[];
  predictedIssueIds: string[];
  truePositives: string[];
  falsePositives: string[];
  falseNegatives: string[];
  expectedClean: boolean;
  predictedClean: boolean;
}

export interface CaseEvaluation {
  exerciseName: string;
  sourceVideo: string;
  split: DatasetSplit;
  expectedReps: number;
  predictedReps: number;
  repCountCorrect: boolean;
  reps: RepEvaluation[];
  matchedReps: RepEvaluation[];
  missingExpectedReps: RepEvaluation[];
  extraPredictedReps: RepEvaluation[];
  totals: EvaluationTotals;
}

export interface EvaluationTotals {
  cases: number;
  expectedReps: number;
  predictedReps: number;
  repCountCorrect: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  cleanReps: number;
  cleanFalsePositives: number;
}

export interface EvaluationMetrics {
  repCountAccuracy: number;
  issuePrecision: number;
  issueRecall: number;
  issueF1: number;
  cleanRepFalsePositiveRate: number;
}

export interface DatasetEvaluation {
  cases: CaseEvaluation[];
  totals: EvaluationTotals;
  metrics: EvaluationMetrics;
}

export interface PredictionLike {
  finalRepCount: number;
  reps: ReplayRepPrediction[];
}
