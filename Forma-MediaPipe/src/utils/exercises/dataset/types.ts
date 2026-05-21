import type { LandmarkRecording, ReplayRepPrediction } from '../replay';
import type { SetTrackingQualitySummary } from '../shared/poseQuality';
import type { RepDiagnostics } from '../types';

export type DatasetSplit = 'train' | 'validation' | 'test';
export type LabelReviewStatus = 'draft' | 'reviewed';
export type RepViewLabel = 'side' | 'front' | 'oblique' | 'unknown';

export interface AvailableIssue {
  issueId: string;
  feedbackMessage: string;
}

export interface DraftLabelMetadata {
  generatedAt: string;
  generator: string;
  source: 'heuristic-replay';
}

export type CaptureCameraSide = 'left' | 'right' | 'oblique' | 'frontish' | 'unknown';
export type CaptureCameraView = 'front' | 'frontish' | 'oblique' | 'side' | 'unknown';
export type CaptureMachineStyle = 'seated_selectorized' | 'kneeling' | 'plate_loaded' | 'unknown';
export type CaptureVisibleHandles = 'yes' | 'no' | 'partial' | 'unknown';
export type ReviewerViewConfidence = 'good' | 'usable' | 'poor';
export type CollectionMode = 'staged' | 'trainer_demo' | 'natural_user' | 'unknown';
export type LightingCondition = 'bright' | 'mixed' | 'dim' | 'backlit' | 'unknown';
export type ReviewerConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type RepIssueSeverity = 'none' | 'mild' | 'moderate' | 'severe';

export interface ExerciseCaptureMetadata {
  subjectId?: string;
  participantId?: string;
  sessionId?: string;
  cameraSetupId?: string;
  environmentId?: string;
  collectionMode?: CollectionMode;
  deviceModel?: string;
  lightingCondition?: LightingCondition;
  reviewerId?: string;
  reviewerConfidence?: ReviewerConfidence;
  cameraSide?: CaptureCameraSide;
  cameraView?: CaptureCameraView;
  machineStyle?: CaptureMachineStyle;
  visibleHandles?: CaptureVisibleHandles;
  reviewerViewConfidence?: ReviewerViewConfidence;
}

export interface RepLabel {
  index: number;
  startMs: number;
  endMs: number;
  issueIds: string[];
  view?: RepViewLabel;
  scorable?: boolean;
  notes?: string;
  suggestedIssueIds?: string[];
  suggestedFeedbackMessages?: string[];
  suggestedScore?: number;
  expectedScoreRange?: [number, number];
  issueSeverities?: Record<string, RepIssueSeverity>;
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
  captureMetadata?: ExerciseCaptureMetadata;
  labelingGuidance?: string[];
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
  predictedDiagnostics?: RepDiagnostics;
  truePositives: string[];
  falsePositives: string[];
  falseNegatives: string[];
  expectedScorable: boolean;
  expectedScorableExplicit?: boolean;
  predictedScorable?: boolean;
  expectedView?: RepViewLabel;
  predictedView?: RepViewLabel;
  expectedClean: boolean;
  predictedClean: boolean;
  expectedScoreRange?: [number, number];
  predictedScore?: number;
  scoreInExpectedRange?: boolean;
  scoreRangeMiss?: number | null;
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
  qualityCoverage?: QualityCoverageMetrics;
  diagnosticSummary?: DiagnosticEvaluationSummary;
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
  viewEvaluatedReps: number;
  viewCorrectReps: number;
  scorableEvaluatedReps: number;
  scorableCorrectReps: number;
  scoreEvaluatedReps: number;
  scoreInRangeReps: number;
  scoreRangeMissTotal: number;
}

export interface EvaluationMetrics {
  repCountAccuracy: number;
  issuePrecision: number;
  issueRecall: number;
  issueF1: number;
  cleanRepFalsePositiveRate: number;
  viewAccuracy: number;
  scorableAccuracy: number;
  scoreInRangeRate: number;
  scoreMeanAbsoluteMiss: number;
}

export interface DatasetEvaluation {
  cases: CaseEvaluation[];
  totals: EvaluationTotals;
  metrics: EvaluationMetrics;
  qualityCoverage?: QualityCoverageMetrics;
  diagnosticSummary?: DiagnosticEvaluationSummary;
}

export interface PredictionLike {
  finalRepCount: number;
  reps: ReplayRepPrediction[];
  qualitySummary?: SetTrackingQualitySummary;
}

export interface QualityCoverageMetrics {
  totalReps: number;
  scoredReps: number;
  unscoredReps: number;
  scorableRate: number;
  averageConfidence: number;
}

export interface DiagnosticMetricDistribution {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
}

export interface DiagnosticIssueSummary {
  issueId: string;
  eligiblePositiveCount: number;
  eligibleNegativeCount: number;
  truePositiveCount: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  skippedCount: number;
  ineligibleCount: number;
  expectedPositiveMetric: DiagnosticMetricDistribution;
  expectedNegativeMetric: DiagnosticMetricDistribution;
  nearThresholdMismatchCount: number;
  averageConfidence: number | null;
  averageSampleCount: number | null;
  weightedTruePositive: number;
  weightedFalsePositive: number;
  weightedFalseNegative: number;
}

export interface DiagnosticEvaluationSummary {
  issueSummaries: Record<string, DiagnosticIssueSummary>;
  weightedIssuePrecision: number;
  weightedIssueRecall: number;
  weightedIssueF1: number;
  nearThresholdMismatchCount: number;
  diagnosticRepCount: number;
}
