import * as fs from 'fs';
import * as path from 'path';

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import {
  evaluateCase,
  generateRandomCandidates,
  refineCandidate,
  shouldApplyWinningConfig,
  sortCandidateEvaluations,
  summarizeEvaluations,
  topCandidates,
  validateCandidateConfig,
  validateTunableSpec,
  type CandidateConfig,
  type OptimizerSearchOptions,
} from '../src/utils/exercises/dataset';
import { replayRecording, slugifyExerciseName } from '../src/utils/exercises/replay';
import type {
  DatasetCase,
  DatasetEvaluation,
  EvaluationMetrics,
  EvaluationTotals,
} from '../src/utils/exercises/dataset';
import type { ExerciseDefinition, ExerciseHeuristicConfig } from '../src/utils/exercises/types';
import {
  DATASET_ROOT,
  discoverReviewedDatasetExercises,
  formatEvaluationSummary,
  formatLoadSummary,
  loadDatasetCasesWithSummary,
  writeJson,
  type DatasetLoadSummary,
} from './dataset-common';

export type SelectionSplit = 'validation' | 'train' | 'all' | 'none';

export interface MinimumSplitCases {
  train: number;
  validation: number;
  test: number;
}

export interface OptimizerCommandOptions {
  datasetRoot?: string;
  exerciseFilter: string | null;
  dryRun: boolean;
  includeCaseDetails: boolean;
  silent: boolean;
  reportPath: string | null;
  search: OptimizerSearchOptions;
  minCases: MinimumSplitCases;
}

export interface EvaluationSummary {
  totals: EvaluationTotals;
  metrics: EvaluationMetrics;
}

export interface EvaluatedCandidateSummary {
  id: string;
  config: ExerciseHeuristicConfig;
  evaluation: EvaluationSummary;
  score: number;
}

interface CandidateEvaluationBatch {
  evaluated: EvaluatedCandidateSummary[];
  rejectedCount: number;
  rejectedExamples: string[];
}

export interface SearchResult {
  candidates: EvaluatedCandidateSummary[];
  specIssues: string[];
  rejectedCandidates: number;
  rejectedCandidateExamples: string[];
  options: Required<OptimizerSearchOptions>;
}

export interface MinimumSplitGate {
  required: MinimumSplitCases;
  actual: MinimumSplitCases;
  passed: boolean;
  reason: string;
}

interface EvaluationBySplit<T> {
  all: T | null;
  train: T | null;
  validation: T | null;
  test: T | null;
}

export interface ExerciseOptimisationReport {
  exerciseName: string;
  cases: number;
  loadSummary: DatasetLoadSummary;
  splitCounts: MinimumSplitCases;
  minimumSplitGate: MinimumSplitGate;
  supportsConfigVariants: boolean;
  canAutoApply: boolean;
  applied: boolean;
  dryRun: boolean;
  reason: string;
  tunedConfigPath: string | null;
  selectionSplit: SelectionSplit;
  search: SearchResult;
  baseline: EvaluationBySplit<EvaluationSummary>;
  baselineCaseDetails?: EvaluationBySplit<DatasetEvaluation>;
  winner: {
    id: string | null;
    config: ExerciseHeuristicConfig | null;
    all: EvaluationSummary | null;
    train: EvaluationSummary | null;
    validation: EvaluationSummary | null;
    test: EvaluationSummary | null;
  };
  winnerCaseDetails?: EvaluationBySplit<DatasetEvaluation>;
  rankedSelection: Array<{
    id: string;
    config: ExerciseHeuristicConfig;
    evaluation: EvaluationSummary;
    score: number;
  }>;
}

export interface DatasetOptimisationReport {
  options: OptimizerCommandOptions;
  datasetRoot: string;
  discoveredExercises: string[];
  baseline: EvaluationSummary | null;
  exercises: ExerciseOptimisationReport[];
}

export const DEFAULT_MIN_SPLIT_CASES: MinimumSplitCases = {
  train: 1,
  validation: 1,
  test: 1,
};

function emptyTotals(): EvaluationTotals {
  return {
    cases: 0,
    expectedReps: 0,
    predictedReps: 0,
    repCountCorrect: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    cleanReps: 0,
    cleanFalsePositives: 0,
  };
}

function addTotals(target: EvaluationTotals, source: EvaluationTotals): void {
  target.cases += source.cases;
  target.expectedReps += source.expectedReps;
  target.predictedReps += source.predictedReps;
  target.repCountCorrect += source.repCountCorrect;
  target.truePositives += source.truePositives;
  target.falsePositives += source.falsePositives;
  target.falseNegatives += source.falseNegatives;
  target.cleanReps += source.cleanReps;
  target.cleanFalsePositives += source.cleanFalsePositives;
}

function metricsFromTotals(totals: EvaluationTotals): EvaluationMetrics {
  const precisionDenominator = totals.truePositives + totals.falsePositives;
  const recallDenominator = totals.truePositives + totals.falseNegatives;
  const issuePrecision =
    precisionDenominator === 0 ? 1 : totals.truePositives / precisionDenominator;
  const issueRecall = recallDenominator === 0 ? 1 : totals.truePositives / recallDenominator;
  const issueF1 =
    issuePrecision + issueRecall === 0
      ? 0
      : (2 * issuePrecision * issueRecall) / (issuePrecision + issueRecall);

  return {
    repCountAccuracy: totals.cases === 0 ? 1 : totals.repCountCorrect / totals.cases,
    issuePrecision,
    issueRecall,
    issueF1,
    cleanRepFalsePositiveRate:
      totals.cleanReps === 0 ? 0 : totals.cleanFalsePositives / totals.cleanReps,
  };
}

function scoreEvaluationSummary(evaluation: EvaluationSummary): number {
  return (
    evaluation.metrics.repCountAccuracy * 10000 +
    evaluation.metrics.issueF1 * 100 -
    evaluation.metrics.cleanRepFalsePositiveRate
  );
}

function combineSummaries(summaries: Array<EvaluationSummary | null>): EvaluationSummary | null {
  const totals = emptyTotals();
  let hasAny = false;
  for (const summary of summaries) {
    if (!summary) continue;
    addTotals(totals, summary.totals);
    hasAny = true;
  }
  return hasAny ? { totals, metrics: metricsFromTotals(totals) } : null;
}

function flagValue(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (current === flag) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${flag}.`);
      }
      return value;
    }
    if (current.startsWith(`${flag}=`)) {
      const value = current.slice(flag.length + 1);
      if (!value) throw new Error(`Missing value for ${flag}.`);
      return value;
    }
  }
  return null;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseNonNegativeIntegerFlag(argv: string[], flag: string): number | undefined {
  const value = flagValue(argv, flag);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

export function parseOptimizerCommandOptions(argv: string[]): OptimizerCommandOptions {
  return {
    datasetRoot: flagValue(argv, '--dataset-root') ?? undefined,
    exerciseFilter: flagValue(argv, '--exercise'),
    dryRun: hasFlag(argv, '--dry-run'),
    includeCaseDetails: hasFlag(argv, '--include-case-details'),
    silent: hasFlag(argv, '--silent'),
    reportPath: flagValue(argv, '--report'),
    search: {
      randomCandidates: parseNonNegativeIntegerFlag(argv, '--random-candidates'),
      survivorCount:
        parseNonNegativeIntegerFlag(argv, '--survivors') ??
        parseNonNegativeIntegerFlag(argv, '--survivor-count'),
      refinementRounds: parseNonNegativeIntegerFlag(argv, '--refinement-rounds'),
      seed: parseNonNegativeIntegerFlag(argv, '--seed'),
    },
    minCases: {
      train:
        parseNonNegativeIntegerFlag(argv, '--min-train-cases') ??
        DEFAULT_MIN_SPLIT_CASES.train,
      validation:
        parseNonNegativeIntegerFlag(argv, '--min-validation-cases') ??
        DEFAULT_MIN_SPLIT_CASES.validation,
      test:
        parseNonNegativeIntegerFlag(argv, '--min-test-cases') ??
        DEFAULT_MIN_SPLIT_CASES.test,
    },
  };
}

export function evaluateCasesCompact(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  config?: ExerciseHeuristicConfig,
): EvaluationSummary | null {
  if (cases.length === 0) return null;
  const totals = emptyTotals();
  for (const datasetCase of cases) {
    const prediction = replayRecording(
      definition,
      datasetCase.recording,
      config ? { heuristicConfig: config } : undefined,
    );
    const evaluation = evaluateCase(datasetCase, prediction);
    addTotals(totals, evaluation.totals);
  }
  return { totals, metrics: metricsFromTotals(totals) };
}

export function evaluateCasesDetailed(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  config?: ExerciseHeuristicConfig,
): DatasetEvaluation | null {
  if (cases.length === 0) return null;
  return summarizeEvaluations(
    cases.map((datasetCase) =>
      evaluateCase(
        datasetCase,
        replayRecording(definition, datasetCase.recording, config ? { heuristicConfig: config } : undefined),
      ),
    ),
  );
}

function evaluateSplitCompact(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  config?: ExerciseHeuristicConfig,
): EvaluationBySplit<EvaluationSummary> {
  return {
    all: evaluateCasesCompact(definition, cases, config),
    train: evaluateCasesCompact(
      definition,
      cases.filter((datasetCase) => datasetCase.label.split === 'train'),
      config,
    ),
    validation: evaluateCasesCompact(
      definition,
      cases.filter((datasetCase) => datasetCase.label.split === 'validation'),
      config,
    ),
    test: evaluateCasesCompact(
      definition,
      cases.filter((datasetCase) => datasetCase.label.split === 'test'),
      config,
    ),
  };
}

function evaluateSplitDetailed(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  config?: ExerciseHeuristicConfig,
): EvaluationBySplit<DatasetEvaluation> {
  return {
    all: evaluateCasesDetailed(definition, cases, config),
    train: evaluateCasesDetailed(
      definition,
      cases.filter((datasetCase) => datasetCase.label.split === 'train'),
      config,
    ),
    validation: evaluateCasesDetailed(
      definition,
      cases.filter((datasetCase) => datasetCase.label.split === 'validation'),
      config,
    ),
    test: evaluateCasesDetailed(
      definition,
      cases.filter((datasetCase) => datasetCase.label.split === 'test'),
      config,
    ),
  };
}

function selectionCasesFor(
  trainCases: DatasetCase[],
  validationCases: DatasetCase[],
  allCases: DatasetCase[],
): { cases: DatasetCase[]; split: SelectionSplit } {
  if (validationCases.length > 0) return { cases: validationCases, split: 'validation' };
  if (trainCases.length > 0) return { cases: trainCases, split: 'train' };
  if (allCases.length > 0) return { cases: allCases, split: 'all' };
  return { cases: [], split: 'none' };
}

function evaluationForSplit<T>(
  split: SelectionSplit,
  evaluations: EvaluationBySplit<T>,
): T | null {
  if (split === 'validation') return evaluations.validation;
  if (split === 'train') return evaluations.train;
  if (split === 'all') return evaluations.all;
  return null;
}

function evaluateCandidatesCompact(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  candidates: CandidateConfig[],
): CandidateEvaluationBatch {
  const spec = definition.tunableSpec;
  if (!spec) return { evaluated: [], rejectedCount: candidates.length, rejectedExamples: [] };

  const evaluated: EvaluatedCandidateSummary[] = [];
  let rejectedCount = 0;
  const rejectedExamples: string[] = [];

  for (const candidate of candidates) {
    const issues = validateCandidateConfig(candidate.config, spec, {
      validateConfig: definition.validateHeuristicConfig,
    });
    if (issues.length > 0) {
      rejectedCount += 1;
      if (rejectedExamples.length < 5) {
        rejectedExamples.push(`${candidate.id}: ${issues.join('; ')}`);
      }
      continue;
    }

    const evaluation = evaluateCasesCompact(definition, cases, candidate.config);
    if (evaluation) {
      evaluated.push({
        id: candidate.id,
        config: candidate.config,
        evaluation,
        score: scoreEvaluationSummary(evaluation),
      });
    }
  }

  return { evaluated, rejectedCount, rejectedExamples };
}

function dedupeCandidates(candidates: CandidateConfig[]): CandidateConfig[] {
  const seen = new Set<string>();
  const result: CandidateConfig[] = [];
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.config);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

export function searchExercise(
  definition: ExerciseDefinition,
  searchCases: DatasetCase[],
  searchOptions: OptimizerSearchOptions,
): SearchResult {
  const fallbackOptions: Required<OptimizerSearchOptions> = {
    randomCandidates: searchOptions.randomCandidates ?? definition.tunableSpec?.search?.randomCandidates ?? 500,
    survivorCount: searchOptions.survivorCount ?? definition.tunableSpec?.search?.survivorCount ?? 12,
    refinementRounds:
      searchOptions.refinementRounds ?? definition.tunableSpec?.search?.refinementRounds ?? 2,
    seed: searchOptions.seed ?? definition.tunableSpec?.search?.seed ?? 1337,
  };
  const emptyResult = {
    candidates: [],
    specIssues: [],
    rejectedCandidates: 0,
    rejectedCandidateExamples: [],
    options: fallbackOptions,
  };
  if (!definition.heuristicConfig || !definition.tunableSpec || searchCases.length === 0) {
    return emptyResult;
  }

  const spec = definition.tunableSpec;
  const specIssues = validateTunableSpec(definition.heuristicConfig, spec);
  if (specIssues.length > 0) {
    return { ...emptyResult, specIssues };
  }

  let rejectedCandidates = 0;
  const rejectedCandidateExamples: string[] = [];

  const randomBatch = evaluateCandidatesCompact(
    definition,
    searchCases,
    generateRandomCandidates(definition.heuristicConfig, spec, searchOptions),
  );
  let evaluated = sortCandidateEvaluations(randomBatch.evaluated);
  rejectedCandidates += randomBatch.rejectedCount;
  rejectedCandidateExamples.push(...randomBatch.rejectedExamples);

  for (let round = 1; round <= fallbackOptions.refinementRounds; round++) {
    const survivors = topCandidates(evaluated, fallbackOptions.survivorCount);
    if (survivors.length === 0) break;

    const refined = dedupeCandidates(
      survivors.flatMap((candidate) => refineCandidate(candidate, spec, round)),
    );
    const refinedBatch = evaluateCandidatesCompact(definition, searchCases, refined);
    rejectedCandidates += refinedBatch.rejectedCount;
    rejectedCandidateExamples.push(...refinedBatch.rejectedExamples);
    evaluated = sortCandidateEvaluations([...survivors, ...refinedBatch.evaluated]);
  }

  return {
    candidates: topCandidates(evaluated, fallbackOptions.survivorCount),
    specIssues,
    rejectedCandidates,
    rejectedCandidateExamples: rejectedCandidateExamples.slice(0, 5),
    options: fallbackOptions,
  };
}

function writeTunedConfig(definition: ExerciseDefinition, config: ExerciseHeuristicConfig): string {
  if (!definition.tunedConfigPath) {
    throw new Error(`Exercise "${definition.name}" does not declare tunedConfigPath.`);
  }
  const targetPath = path.resolve(process.cwd(), definition.tunedConfigPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`);
  return targetPath;
}

function emptySearchResult(searchOptions: OptimizerSearchOptions): SearchResult {
  return {
    candidates: [],
    specIssues: [],
    rejectedCandidates: 0,
    rejectedCandidateExamples: [],
    options: {
      randomCandidates: searchOptions.randomCandidates ?? 500,
      survivorCount: searchOptions.survivorCount ?? 12,
      refinementRounds: searchOptions.refinementRounds ?? 2,
      seed: searchOptions.seed ?? 1337,
    },
  };
}

function splitCountsFor(cases: DatasetCase[]): MinimumSplitCases {
  return {
    train: cases.filter((datasetCase) => datasetCase.label.split === 'train').length,
    validation: cases.filter((datasetCase) => datasetCase.label.split === 'validation').length,
    test: cases.filter((datasetCase) => datasetCase.label.split === 'test').length,
  };
}

export function minimumSplitGate(
  actual: MinimumSplitCases,
  required: MinimumSplitCases,
): MinimumSplitGate {
  const failures: string[] = [];
  if (actual.train < required.train) failures.push(`train ${actual.train}/${required.train}`);
  if (actual.validation < required.validation) {
    failures.push(`validation ${actual.validation}/${required.validation}`);
  }
  if (actual.test < required.test) failures.push(`test ${actual.test}/${required.test}`);

  return {
    actual,
    required,
    passed: failures.length === 0,
    reason:
      failures.length === 0
        ? 'Minimum split-size gate passed.'
        : `Rejected: minimum reviewed split counts not met (${failures.join(', ')}).`,
  };
}

export function optimizeExercise(
  exerciseName: string,
  exerciseCases: DatasetCase[],
  loadSummary: DatasetLoadSummary,
  options: OptimizerCommandOptions,
): ExerciseOptimisationReport {
  const definition = ExerciseRegistry.get(exerciseName);
  if (!definition) throw new Error(`No registered exercise definition for "${exerciseName}"`);

  const trainCases = exerciseCases.filter((datasetCase) => datasetCase.label.split === 'train');
  const validationCases = exerciseCases.filter((datasetCase) => datasetCase.label.split === 'validation');
  const testCases = exerciseCases.filter((datasetCase) => datasetCase.label.split === 'test');
  const splitCounts = splitCountsFor(exerciseCases);
  const splitGate = minimumSplitGate(splitCounts, options.minCases);
  const selection = selectionCasesFor(trainCases, validationCases, exerciseCases);

  const baseline = evaluateSplitCompact(definition, exerciseCases);
  const baselineSelection = evaluationForSplit(selection.split, baseline);
  const supportsConfigVariants = Boolean(definition.createVariant && definition.tunableSpec);
  const canAutoApply = Boolean(
    supportsConfigVariants &&
      definition.tunedConfigPath &&
      splitGate.passed &&
      !options.dryRun,
  );

  const baseReport = {
    exerciseName,
    cases: exerciseCases.length,
    loadSummary,
    splitCounts,
    minimumSplitGate: splitGate,
    supportsConfigVariants,
    canAutoApply,
    applied: false,
    dryRun: options.dryRun,
    reason: '',
    tunedConfigPath: definition.tunedConfigPath ?? null,
    selectionSplit: selection.split,
    search: emptySearchResult(options.search),
    baseline,
    baselineCaseDetails: options.includeCaseDetails
      ? evaluateSplitDetailed(definition, exerciseCases)
      : undefined,
    winner: {
      id: null,
      config: null,
      all: null,
      train: null,
      validation: null,
      test: null,
    },
    rankedSelection: [],
  } satisfies ExerciseOptimisationReport;

  if (!definition.createVariant || !definition.tunableSpec || !definition.tunedConfigPath || !baselineSelection) {
    return {
      ...baseReport,
      reason: 'Missing createVariant(), tunableSpec, tunedConfigPath, or selection cases.',
    };
  }

  if (trainCases.length === 0) {
    return {
      ...baseReport,
      reason: 'No reviewed train cases available for candidate discovery; no tuned config was written.',
    };
  }

  const search = searchExercise(definition, trainCases, options.search);
  if (search.specIssues.length > 0) {
    return {
      ...baseReport,
      search,
      reason: `Invalid tunable spec: ${search.specIssues.join(' ')}`,
    };
  }

  const baselineCandidate: EvaluatedCandidateSummary | null = definition.heuristicConfig
    ? {
        id: 'baseline',
        config: definition.heuristicConfig,
        evaluation: baselineSelection,
        score: scoreEvaluationSummary(baselineSelection),
      }
    : null;
  const selectionBatch = evaluateCandidatesCompact(
    definition,
    selection.cases,
    search.candidates.map((candidate) => ({ id: candidate.id, config: candidate.config })),
  );
  const rankedSelection = sortCandidateEvaluations(
    baselineCandidate ? [baselineCandidate, ...selectionBatch.evaluated] : selectionBatch.evaluated,
  );
  const winner = rankedSelection[0];

  const searchWithSelectionRejects = {
    ...search,
    rejectedCandidates: search.rejectedCandidates + selectionBatch.rejectedCount,
    rejectedCandidateExamples: [
      ...search.rejectedCandidateExamples,
      ...selectionBatch.rejectedExamples,
    ].slice(0, 5),
  };

  if (!winner) {
    return { ...baseReport, search: searchWithSelectionRejects, reason: 'No candidate could be evaluated.' };
  }

  const winnerEvaluations = evaluateSplitCompact(definition, exerciseCases, winner.config);
  const winnerSelection = evaluationForSplit(selection.split, winnerEvaluations);

  if (!winnerSelection) {
    return {
      ...baseReport,
      search: searchWithSelectionRejects,
      reason: 'Winning candidate has no selection evaluation.',
    };
  }

  const gate = splitGate.passed
    ? shouldApplyWinningConfig({
        baselineSelection,
        winnerSelection,
        baselineTest: baseline.test,
        winnerTest: winnerEvaluations.test,
        spec: definition.tunableSpec,
        selectionSplit: selection.split === 'none' ? undefined : selection.split,
        requireValidationSplit: true,
        requireTestSplit: true,
      })
    : { shouldApply: false, reason: splitGate.reason };

  let applied = false;
  let reason = gate.reason;
  if (gate.shouldApply && winner.id !== 'baseline' && options.dryRun) {
    reason = `${gate.reason} Dry run enabled; no tuned config was written.`;
  } else if (gate.shouldApply && winner.id !== 'baseline') {
    const targetPath = writeTunedConfig(definition, winner.config);
    applied = true;
    reason = `${gate.reason} Wrote tuned config to ${targetPath}.`;
  }

  return {
    ...baseReport,
    canAutoApply,
    applied,
    reason,
    search: searchWithSelectionRejects,
    winner: {
      id: winner.id,
      config: winner.config,
      all: winnerEvaluations.all,
      train: winnerEvaluations.train,
      validation: winnerEvaluations.validation,
      test: winnerEvaluations.test,
    },
    winnerCaseDetails: options.includeCaseDetails
      ? evaluateSplitDetailed(definition, exerciseCases, winner.config)
      : undefined,
    rankedSelection: rankedSelection.slice(0, 10),
  };
}

function reportPathFor(options: OptimizerCommandOptions, reportName: string): string {
  if (options.reportPath) return path.resolve(process.cwd(), options.reportPath);
  const datasetRoot = path.resolve(process.cwd(), options.datasetRoot ?? DATASET_ROOT);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(datasetRoot, 'reports', `${reportName}_${timestamp}.json`);
}

function writeOptimizationReport(
  reportName: string,
  report: unknown,
  options: OptimizerCommandOptions,
): string {
  const targetPath = reportPathFor(options, reportName);
  writeJson(targetPath, report);
  return targetPath;
}

function resolveTargetDefinition(exerciseFilter: string | null): ExerciseDefinition | undefined {
  if (!exerciseFilter) return undefined;
  const definition = ExerciseRegistry.get(exerciseFilter);
  if (!definition) {
    throw new Error(
      `No registered exercise "${exerciseFilter}". Available exercises: ${ExerciseRegistry.list().join(', ')}`,
    );
  }
  return definition;
}

function discoverExercisesForCommand(options: OptimizerCommandOptions): {
  exercises: string[];
  targetDefinition: ExerciseDefinition | undefined;
} {
  const targetDefinition = resolveTargetDefinition(options.exerciseFilter);
  if (targetDefinition) return { exercises: [targetDefinition.name], targetDefinition };
  return {
    exercises: discoverReviewedDatasetExercises({ datasetRoot: options.datasetRoot }),
    targetDefinition: undefined,
  };
}

export function runDatasetOptimize(options: OptimizerCommandOptions): {
  report: DatasetOptimisationReport;
  reportPath: string;
} {
  const datasetRoot = path.resolve(process.cwd(), options.datasetRoot ?? DATASET_ROOT);
  const { exercises, targetDefinition } = discoverExercisesForCommand(options);
  const exerciseReports: ExerciseOptimisationReport[] = [];

  for (const exerciseName of exercises) {
    const { cases, summary } = loadDatasetCasesWithSummary({
      datasetRoot,
      exerciseName,
      logSkippedDrafts: false,
    });
    if (cases.length === 0) continue;
    exerciseReports.push(optimizeExercise(exerciseName, cases, summary, options));
  }

  const report: DatasetOptimisationReport = {
    options,
    datasetRoot,
    discoveredExercises: exercises,
    baseline: combineSummaries(exerciseReports.map((exercise) => exercise.baseline.all)),
    exercises: exerciseReports,
  };

  const reportName = targetDefinition
    ? `optimization_${slugifyExerciseName(targetDefinition.name)}`
    : 'optimization';
  const reportPath = writeOptimizationReport(reportName, report, options);
  return { report, reportPath };
}

export function formatOptimizerConsoleSummary(args: {
  report: DatasetOptimisationReport;
  reportPath: string;
}): string {
  const lines: string[] = [];
  if (args.report.exercises.length === 0) {
    lines.push(
      `No reviewed label JSON files found under ${path.join(args.report.datasetRoot, 'labels')}.`,
    );
  } else if (args.report.baseline) {
    lines.push('Baseline metrics');
    lines.push(formatEvaluationSummary({ cases: [], ...args.report.baseline }));
  }

  for (const exercise of args.report.exercises) {
    lines.push('');
    lines.push(`${exercise.exerciseName}: ${exercise.reason}`);
    lines.push(formatLoadSummary(exercise.loadSummary));
  }

  lines.push(`Report: ${args.reportPath}`);
  return lines.join('\n');
}

export function runDatasetOptimizeCommand(
  argv: string[],
  logger: Pick<Console, 'log' | 'error'> = console,
): { report: DatasetOptimisationReport; reportPath: string } {
  const options = parseOptimizerCommandOptions(argv);
  const result = runDatasetOptimize(options);
  if (!options.silent) {
    logger.log(formatOptimizerConsoleSummary(result));
  }
  return result;
}
