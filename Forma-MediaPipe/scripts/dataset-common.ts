import * as fs from 'fs';
import * as path from 'path';

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import { replayRecording } from '../src/utils/exercises/replay';
import { getKnownIssueIds, slugifyExerciseName } from '../src/utils/exercises/replay/issueIds';
import {
  evaluateCase,
  formatMetricPercent,
  summarizeEvaluations,
  validateDatasetCase,
  type CaseEvaluation,
  type DatasetCase,
  type DatasetEvaluation,
  type DatasetSplit,
  type ExerciseLabelFile,
} from '../src/utils/exercises/dataset';
import type { ExerciseDefinition } from '../src/utils/exercises/types';
import type { LandmarkRecording } from '../src/utils/exercises/replay';

export const DATASET_ROOT = path.resolve(
  process.cwd(),
  process.env.FORMA_DATASET_ROOT ?? 'datasets/form-heuristics',
);

export interface LoadDatasetCasesOptions {
  datasetRoot?: string;
  exerciseName?: string;
  exerciseSlug?: string;
  splits?: DatasetSplit[];
  includeDraft?: boolean;
  includeDrafts?: boolean;
  includeTemplates?: boolean;
  requireLandmarks?: boolean;
  logSkippedDrafts?: boolean;
}

export interface DatasetLoadSummary {
  labelFilesDiscovered: number;
  templateLabelsSkipped: number;
  draftLabelsSkipped: number;
  exerciseLabelsSkipped: number;
  splitLabelsSkipped: number;
  missingLandmarksSkipped: number;
  landmarkFilesRead: number;
  casesLoaded: number;
}

export interface LoadedDatasetCases {
  cases: DatasetCase[];
  summary: DatasetLoadSummary;
}

export interface DiscoverDatasetExercisesOptions {
  datasetRoot?: string;
  includeDraft?: boolean;
  includeDrafts?: boolean;
  splits?: DatasetSplit[];
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

export function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function listJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listJsonFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(entryPath);
  }
  return result.sort();
}

export function isTemplateLabelFile(filePath: string): boolean {
  const filename = path.basename(filePath).toLowerCase();
  return filename === '_template.json' || filename.endsWith('.template.json');
}

export function isDraftLabel(label: ExerciseLabelFile): boolean {
  return label.reviewStatus === 'draft';
}

function registeredDefinitions(): ExerciseDefinition[] {
  return ExerciseRegistry.list()
    .map((name) => ExerciseRegistry.get(name))
    .filter((definition): definition is ExerciseDefinition => Boolean(definition));
}

function buildLandmarkIndex(landmarksRoot: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const filePath of listJsonFiles(landmarksRoot)) {
    const base = path.basename(filePath, '.json');
    if (!index.has(base)) index.set(base, filePath);
  }
  return index;
}

function resolveLandmarkPath(
  label: ExerciseLabelFile,
  labelPath: string,
  datasetRoot: string,
  landmarkIndex: () => Map<string, string>,
): string {
  const landmarksRoot = path.join(datasetRoot, 'landmarks');
  const candidates: string[] = [];

  if (label.landmarkFile) {
    candidates.push(path.resolve(datasetRoot, label.landmarkFile));
    candidates.push(path.resolve(path.dirname(labelPath), label.landmarkFile));
  }

  const sourceBase = path.basename(label.sourceVideo, path.extname(label.sourceVideo));
  candidates.push(path.join(landmarksRoot, `${sourceBase}.json`));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const recursiveMatch = landmarkIndex().get(sourceBase);
  if (recursiveMatch) return recursiveMatch;

  throw new Error(
    `No landmark JSON found for label ${labelPath}. Set landmarkFile or create landmarks/${sourceBase}.json.`,
  );
}

function matchesExerciseFilter(label: ExerciseLabelFile, options: LoadDatasetCasesOptions): boolean {
  if (options.exerciseName && label.exerciseName !== options.exerciseName) return false;
  if (options.exerciseSlug && slugifyExerciseName(label.exerciseName) !== slugifyExerciseName(options.exerciseSlug)) {
    return false;
  }
  return true;
}

function matchesSplitFilter(label: ExerciseLabelFile, options: LoadDatasetCasesOptions): boolean {
  return !options.splits || options.splits.includes(label.split);
}

export function discoverReviewedDatasetExercises(
  options: DiscoverDatasetExercisesOptions = {},
): string[] {
  const datasetRoot = options.datasetRoot ?? DATASET_ROOT;
  const labelsRoot = path.join(datasetRoot, 'labels');
  const includeDrafts = options.includeDrafts ?? options.includeDraft ?? false;
  const exercises = new Set<string>();

  for (const labelPath of listJsonFiles(labelsRoot)) {
    if (isTemplateLabelFile(labelPath)) continue;
    const label = readJson<ExerciseLabelFile>(labelPath);
    if (isDraftLabel(label) && !includeDrafts) continue;
    if (options.splits && !options.splits.includes(label.split)) continue;
    if (typeof label.exerciseName === 'string' && label.exerciseName.trim() !== '') {
      exercises.add(label.exerciseName);
    }
  }

  return Array.from(exercises).sort();
}

export function loadDatasetCasesWithSummary(
  options: LoadDatasetCasesOptions = {},
): LoadedDatasetCases {
  const datasetRoot = options.datasetRoot ?? DATASET_ROOT;
  const labelsRoot = path.join(datasetRoot, 'labels');
  const knownIssueIds = getKnownIssueIds(registeredDefinitions());
  const allLabelFiles = listJsonFiles(labelsRoot);
  const includeDrafts = options.includeDrafts ?? options.includeDraft ?? false;
  const requireLandmarks = options.requireLandmarks ?? true;
  const cases: DatasetCase[] = [];
  const summary: DatasetLoadSummary = {
    labelFilesDiscovered: allLabelFiles.length,
    templateLabelsSkipped: 0,
    draftLabelsSkipped: 0,
    exerciseLabelsSkipped: 0,
    splitLabelsSkipped: 0,
    missingLandmarksSkipped: 0,
    landmarkFilesRead: 0,
    casesLoaded: 0,
  };
  let landmarkIndexCache: Map<string, string> | null = null;
  const landmarkIndex = () => {
    if (!landmarkIndexCache) {
      landmarkIndexCache = buildLandmarkIndex(path.join(datasetRoot, 'landmarks'));
    }
    return landmarkIndexCache;
  };

  for (const labelPath of allLabelFiles) {
    if (isTemplateLabelFile(labelPath) && !options.includeTemplates) {
      summary.templateLabelsSkipped += 1;
      continue;
    }
    const label = readJson<ExerciseLabelFile>(labelPath);
    if (isDraftLabel(label) && !includeDrafts) {
      summary.draftLabelsSkipped += 1;
      continue;
    }
    if (!matchesExerciseFilter(label, options)) {
      summary.exerciseLabelsSkipped += 1;
      continue;
    }
    if (!matchesSplitFilter(label, options)) {
      summary.splitLabelsSkipped += 1;
      continue;
    }

    let recordingPath: string;
    try {
      recordingPath = resolveLandmarkPath(label, labelPath, datasetRoot, landmarkIndex);
    } catch (error) {
      if (requireLandmarks) throw error;
      summary.missingLandmarksSkipped += 1;
      continue;
    }
    const recording = readJson<LandmarkRecording>(recordingPath);
    summary.landmarkFilesRead += 1;
    const datasetCase = { label, recording, labelPath, recordingPath };
    const issues = validateDatasetCase(datasetCase, knownIssueIds);
    if (issues.length > 0) {
      throw new Error(
        `Invalid dataset case ${labelPath}:\n` +
          issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n'),
      );
    }
    cases.push(datasetCase);
  }
  summary.casesLoaded = cases.length;

  if (summary.draftLabelsSkipped > 0 && options.logSkippedDrafts !== false) {
    console.log(
      `Skipped ${summary.draftLabelsSkipped} draft label file(s). Mark reviewStatus as "reviewed" to include them.`,
    );
  }

  return { cases, summary };
}

export function loadDatasetCases(options: LoadDatasetCasesOptions = {}): DatasetCase[] {
  return loadDatasetCasesWithSummary(options).cases;
}

export function formatLoadSummary(summary: DatasetLoadSummary): string {
  return [
    `Label JSON files discovered: ${summary.labelFilesDiscovered}`,
    `Cases loaded: ${summary.casesLoaded}`,
    `Landmark JSON files read: ${summary.landmarkFilesRead}`,
    `Templates skipped: ${summary.templateLabelsSkipped}`,
    `Draft labels skipped: ${summary.draftLabelsSkipped}`,
    `Exercise-filtered labels skipped: ${summary.exerciseLabelsSkipped}`,
    `Split-filtered labels skipped: ${summary.splitLabelsSkipped}`,
    `Missing-landmark labels skipped: ${summary.missingLandmarksSkipped}`,
  ].join('\n');
}

export function evaluateBaseline(cases: DatasetCase[]): DatasetEvaluation {
  const caseEvaluations: CaseEvaluation[] = [];
  for (const datasetCase of cases) {
    const definition = ExerciseRegistry.get(datasetCase.label.exerciseName);
    if (!definition) {
      throw new Error(`No registered exercise definition for "${datasetCase.label.exerciseName}"`);
    }
    const prediction = replayRecording(definition, datasetCase.recording, { confidenceGating: true });
    caseEvaluations.push(evaluateCase(datasetCase, prediction));
  }
  return summarizeEvaluations(caseEvaluations);
}

export function ensureReportsDir(): string {
  const reportsDir = path.join(DATASET_ROOT, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  return reportsDir;
}

export function writeJsonReport(name: string, payload: unknown): string {
  const reportsDir = ensureReportsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(reportsDir, `${name}_${timestamp}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

export function formatEvaluationSummary(evaluation: DatasetEvaluation): string {
  const lines = [
    `Cases: ${evaluation.totals.cases}`,
    `Expected reps: ${evaluation.totals.expectedReps}`,
    `Predicted reps: ${evaluation.totals.predictedReps}`,
    `Rep-count accuracy: ${formatMetricPercent(evaluation.metrics.repCountAccuracy)}`,
    `Issue precision: ${formatMetricPercent(evaluation.metrics.issuePrecision)}`,
    `Issue recall: ${formatMetricPercent(evaluation.metrics.issueRecall)}`,
    `Issue F1: ${formatMetricPercent(evaluation.metrics.issueF1)}`,
    `Clean-rep false-positive rate: ${formatMetricPercent(evaluation.metrics.cleanRepFalsePositiveRate)}`,
    `View accuracy: ${formatMetricPercent(evaluation.metrics.viewAccuracy)} (${evaluation.totals.viewCorrectReps}/${evaluation.totals.viewEvaluatedReps})`,
    `Scorable accuracy: ${formatMetricPercent(evaluation.metrics.scorableAccuracy)} (${evaluation.totals.scorableCorrectReps}/${evaluation.totals.scorableEvaluatedReps})`,
  ];
  if (evaluation.qualityCoverage) {
    lines.push(
      `Quality scorable reps: ${evaluation.qualityCoverage.scoredReps}/${evaluation.qualityCoverage.totalReps} (${formatMetricPercent(evaluation.qualityCoverage.scorableRate)})`,
      `Average tracking confidence: ${formatMetricPercent(evaluation.qualityCoverage.averageConfidence)}`,
    );
  }
  return lines.join('\n');
}

export function groupedByExercise(cases: DatasetCase[]): Map<string, DatasetCase[]> {
  const grouped = new Map<string, DatasetCase[]>();
  for (const datasetCase of cases) {
    const key = datasetCase.label.exerciseName;
    grouped.set(key, [...(grouped.get(key) ?? []), datasetCase]);
  }
  return grouped;
}
