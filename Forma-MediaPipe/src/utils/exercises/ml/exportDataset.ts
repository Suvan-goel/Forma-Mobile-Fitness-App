import type { CaseEvaluation, DatasetCase, DatasetSplit } from '../dataset';
import { evaluateCase, summarizeEvaluations } from '../dataset';
import type { ReplayResultVerbose } from '../replay';
import { replayRecordingVerbose, slugifyExerciseName } from '../replay';
import type { ExerciseDefinition } from '../types';
import {
  buildMlRepExamples,
  collectFeatureNames,
  safeColumnPart,
} from './featureExtractor';
import {
  ML_FEATURE_SCHEMA_VERSION,
  type MlDatasetManifest,
  type MlDatasetSummaryBucket,
  type MlRepExample,
} from './types';

export interface ExportMlDatasetInput {
  exerciseName: string;
  definition: ExerciseDefinition;
  cases: DatasetCase[];
  datasetRoot: string;
  includeDrafts: boolean;
  generatedAt?: string;
  discoveredLabelFiles: number;
  outputs: MlDatasetManifest['outputs'];
}

export interface ExportMlDatasetResult {
  examples: MlRepExample[];
  manifest: MlDatasetManifest;
  caseEvaluations: CaseEvaluation[];
}

function emptyBucket(): MlDatasetSummaryBucket {
  return {
    cases: 0,
    examples: 0,
    cleanExamples: 0,
    issueExamples: 0,
    unscorableExamples: 0,
  };
}

function incrementSplitBucket(
  buckets: Partial<Record<DatasetSplit, MlDatasetSummaryBucket>>,
  split: DatasetSplit,
  examples: MlRepExample[],
): void {
  const bucket = buckets[split] ?? emptyBucket();
  bucket.cases += 1;
  bucket.examples += examples.length;
  bucket.cleanExamples += examples.filter((example) => example.labels.clean).length;
  bucket.issueExamples += examples.filter((example) => !example.labels.clean).length;
  bucket.unscorableExamples += examples.filter((example) => !example.labels.scorable).length;
  buckets[split] = bucket;
}

function incrementCounts(counts: Record<string, number>, values: string[]): void {
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
}

function heuristicConfigVersion(definition: ExerciseDefinition): string {
  return definition.tunedConfigPath ?? `${slugifyExerciseName(definition.name)}:embedded`;
}

export function buildMlDataset(input: ExportMlDatasetInput): ExportMlDatasetResult {
  const examples: MlRepExample[] = [];
  const caseEvaluations: CaseEvaluation[] = [];
  const splitBuckets: Partial<Record<DatasetSplit, MlDatasetSummaryBucket>> = {};
  const issueCounts: Record<string, number> = {};
  const heuristicIssueCounts: Record<string, number> = {};
  let skippedMissingMatchedPrediction = 0;
  let skippedMissingDiagnostics = 0;

  for (const datasetCase of input.cases) {
    const replay: ReplayResultVerbose = replayRecordingVerbose(input.definition, datasetCase.recording, {
      confidenceGating: true,
    });
    const caseEvaluation = evaluateCase(datasetCase, replay);
    caseEvaluations.push(caseEvaluation);

    const built = buildMlRepExamples({
      definition: input.definition,
      datasetCase,
      replay,
      caseEvaluation,
      labelFile: datasetCase.labelPath,
      recordingFile: datasetCase.recordingPath,
      heuristicConfigVersion: heuristicConfigVersion(input.definition),
    });

    skippedMissingMatchedPrediction += built.skippedMissingMatchedPrediction;
    skippedMissingDiagnostics += built.skippedMissingDiagnostics;
    examples.push(...built.examples);
    incrementSplitBucket(splitBuckets, datasetCase.label.split, built.examples);
    for (const example of built.examples) {
      incrementCounts(issueCounts, example.labels.issueIds);
      incrementCounts(heuristicIssueCounts, example.heuristic.issueIds);
    }
  }

  const featureNames = collectFeatureNames(examples);
  const labelColumns = Object.fromEntries(
    Object.keys(issueCounts)
      .sort()
      .map((issueId) => [issueId, `label_issue__${safeColumnPart(issueId)}`]),
  );

  const manifest: MlDatasetManifest = {
    schemaVersion: 1,
    featureSchemaVersion: ML_FEATURE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    exerciseName: input.exerciseName,
    exerciseSlug: slugifyExerciseName(input.exerciseName),
    includeDrafts: input.includeDrafts,
    datasetRoot: input.datasetRoot,
    outputs: input.outputs,
    counts: {
      discoveredLabelFiles: input.discoveredLabelFiles,
      loadedCases: input.cases.length,
      exportedExamples: examples.length,
      skippedMissingMatchedPrediction,
      skippedMissingDiagnostics,
    },
    splits: splitBuckets,
    issueCounts,
    heuristicIssueCounts,
    featureNames,
    labelColumns,
  };

  summarizeEvaluations(caseEvaluations);
  return { examples, manifest, caseEvaluations };
}

export function mlExampleBaseColumns(): string[] {
  return [
    'id',
    'exercise_name',
    'exercise_slug',
    'split',
    'source_video',
    'landmark_file',
    'label_file',
    'recording_file',
    'rep_index',
    'expected_start_ms',
    'expected_end_ms',
    'predicted_start_ms',
    'predicted_end_ms',
    'completed_at_ms',
    'duration_ms',
    'overlap_ms',
    'completion_delta_ms',
    'label_clean',
    'label_scorable',
    'label_view',
    'label_issue_ids',
    'heuristic_clean',
    'heuristic_scorable',
    'heuristic_view',
    'heuristic_score',
    'heuristic_confidence',
    'heuristic_quality_status',
    'heuristic_quality_warnings',
    'heuristic_issue_ids',
    'heuristic_messages',
  ];
}

export function mlExampleToCsvRow(
  example: MlRepExample,
  featureNames: string[],
  labelColumns: Record<string, string>,
  heuristicIssueIds: string[],
): Record<string, string | number> {
  const row: Record<string, string | number> = {
    id: example.id,
    exercise_name: example.exerciseName,
    exercise_slug: example.exerciseSlug,
    split: example.split,
    source_video: example.sourceVideo,
    landmark_file: example.landmarkFile ?? '',
    label_file: example.labelFile ?? '',
    recording_file: example.recordingFile ?? '',
    rep_index: example.repIndex,
    expected_start_ms: example.timing.expectedStartMs,
    expected_end_ms: example.timing.expectedEndMs,
    predicted_start_ms: example.timing.predictedStartMs ?? '',
    predicted_end_ms: example.timing.predictedEndMs ?? '',
    completed_at_ms: example.timing.completedAtMs ?? '',
    duration_ms: example.timing.durationMs,
    overlap_ms: example.timing.overlapMs,
    completion_delta_ms: example.timing.completionDeltaMs ?? '',
    label_clean: example.labels.clean ? 1 : 0,
    label_scorable: example.labels.scorable ? 1 : 0,
    label_view: example.labels.view ?? '',
    label_issue_ids: example.labels.issueIds.join(';'),
    heuristic_clean: example.heuristic.clean ? 1 : 0,
    heuristic_scorable: example.heuristic.scorable === null ? '' : example.heuristic.scorable ? 1 : 0,
    heuristic_view: example.heuristic.view ?? '',
    heuristic_score: example.heuristic.score ?? '',
    heuristic_confidence: example.heuristic.confidence ?? '',
    heuristic_quality_status: example.heuristic.qualityStatus ?? '',
    heuristic_quality_warnings: example.heuristic.qualityWarnings.join(';'),
    heuristic_issue_ids: example.heuristic.issueIds.join(';'),
    heuristic_messages: example.heuristic.messages.join(' | '),
  };

  const labelSet = new Set(example.labels.issueIds);
  for (const [issueId, column] of Object.entries(labelColumns)) {
    row[column] = labelSet.has(issueId) ? 1 : 0;
  }

  const heuristicSet = new Set(example.heuristic.issueIds);
  for (const issueId of heuristicIssueIds) {
    row[`heuristic_issue__${safeColumnPart(issueId)}`] = heuristicSet.has(issueId) ? 1 : 0;
  }

  for (const featureName of featureNames) {
    const value = example.features[featureName];
    row[`feature__${featureName}`] = value ?? '';
  }

  return row;
}

export function csvEscape(value: string | number): string {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
