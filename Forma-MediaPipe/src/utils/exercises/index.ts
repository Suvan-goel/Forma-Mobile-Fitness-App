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
  RepEvaluation,
  RepMatchStatus,
  RepLabel,
  ValidationIssue,
} from './dataset';
