/**
 * Exercise Framework — public API.
 *
 * Re-exports the registry and types so consumers can import from
 * one location: `../../utils/exercises`.
 */

export { ExerciseRegistry } from './ExerciseRegistry';
export {
  getFeedbackIssueIdMap,
  getKnownIssueIds,
  mapFeedbackMessagesToIssueIds,
  replayRecording,
  replayRecordingVerbose,
  slugifyExerciseName,
} from './replay';
export {
  evaluateCase,
  createDraftLabelFromReplay,
  evaluateDataset,
  formatMetricPercent,
  getAvailableIssues,
  summarizeEvaluations,
  validateCandidateConfig,
  validateDatasetCase,
  validateLabelFile,
  validateTunableSpec,
} from './dataset';
export {
  clampTunableValue,
  cloneConfig,
  createDefaultTunableSpec,
  getConfigValue,
  mergeHeuristicConfig,
  runWithConfigBindings,
  setConfigValue,
} from './heuristicConfig';
export type {
  ExerciseState,
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  ExerciseHeuristicConfigValue,
  NumericTunable,
  OptimizationResult,
  RepResult,
  ExerciseTTSConfig,
  TunableSpec,
} from './types';
export type {
  LandmarkRecording,
  QualityCoverage,
  ReplayRepPrediction,
  ReplayResult,
  ReplayResultVerbose,
} from './replay';
export type {
  CaseEvaluation,
  AvailableIssue,
  DatasetCase,
  DatasetEvaluation,
  DatasetSplit,
  DraftLabelMetadata,
  EvaluationMetrics,
  EvaluationTotals,
  ExerciseLabelFile,
  LabelReviewStatus,
  QualityCoverageMetrics,
  RepEvaluation,
  RepMatchStatus,
  RepLabel,
  ValidationIssue,
} from './dataset';
export {
  POSE_QUALITY_LATENCY_TARGET_MS,
  PoseQualityTracker,
  RepQualityAccumulator,
  RepQualityWindowAccumulator,
  UNSCORED_REP_FEEDBACK,
  getPoseQualityMessage,
  getPoseQualityStatusLabel,
  getUnscoredRepFeedback,
  resolveExerciseQualityProfile,
  summarizeRepQuality,
  summarizeSetTrackingQuality,
} from './shared/poseQuality';
export type {
  ExerciseQualityProfile,
  PoseQualitySnapshot,
  PoseQualityStatus,
  PoseQualityTrackerOptions,
  PoseQualityWarning,
  RepQualityWindowState,
  RepTrackingQuality,
  SetTrackingQualitySummary,
} from './shared/poseQuality';
