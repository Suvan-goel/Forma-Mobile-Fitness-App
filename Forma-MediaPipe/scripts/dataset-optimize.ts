import * as fs from 'fs';
import * as path from 'path';

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import {
  evaluateCase,
  generateRandomCandidates,
  refineCandidate,
  shouldApplyWinningConfig,
  summarizeEvaluations,
  validateCandidateConfig,
  validateTunableSpec,
  type CandidateConfig,
  type OptimizerSearchOptions,
} from '../src/utils/exercises/dataset';
import {
  clampTunableValue,
  getConfigValue,
  setConfigValue,
} from '../src/utils/exercises/heuristicConfig';
import { replayRecording, slugifyExerciseName } from '../src/utils/exercises/replay';
import type {
  DatasetCase,
  DatasetEvaluation,
  DiagnosticEvaluationSummary,
  EvaluationMetrics,
  EvaluationTotals,
  QualityCoverageMetrics,
} from '../src/utils/exercises/dataset';
import type {
  DiagnosticTuningEntry,
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  NumericTunable,
} from '../src/utils/exercises/types';
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
export type OptimizerSelectionMode = 'current' | 'diagnostic';
type CandidateSource = 'baseline' | 'random' | 'refined' | 'diagnostic';

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
  includeDiagnostics?: boolean;
  selectionMode?: OptimizerSelectionMode;
  apply?: boolean;
  silent: boolean;
  reportPath: string | null;
  search: OptimizerSearchOptions;
  minCases: MinimumSplitCases;
}

export interface EvaluationSummary {
  totals: EvaluationTotals;
  metrics: EvaluationMetrics;
  qualityCoverage?: QualityCoverageMetrics;
  diagnosticSummary?: DiagnosticEvaluationSummary;
}

export interface EvaluatedCandidateSummary {
  id: string;
  source: CandidateSource;
  changedPaths?: string[];
  config: ExerciseHeuristicConfig;
  evaluation: EvaluationSummary;
  score: number;
  legacyScore: number;
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
  sourceBreakdown: Record<CandidateSource, number>;
  diagnosticFallbackReason?: string;
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

interface InstrumentedCandidateConfig extends CandidateConfig {
  source: CandidateSource;
  changedPaths?: string[];
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
  selectionMode: OptimizerSelectionMode;
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
    source: CandidateSource;
    changedPaths?: string[];
    config: ExerciseHeuristicConfig;
    evaluation: EvaluationSummary;
    score: number;
    legacyScore: number;
  }>;
}

export interface DatasetOptimisationReport {
  options: OptimizerCommandOptions;
  datasetRoot: string;
  discoveredExercises: string[];
  confidenceGating: boolean;
  baseline: EvaluationSummary | null;
  exercises: ExerciseOptimisationReport[];
}

const OPTIMIZER_CONFIDENCE_GATING = true;

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
    viewEvaluatedReps: 0,
    viewCorrectReps: 0,
    scorableEvaluatedReps: 0,
    scorableCorrectReps: 0,
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
  target.viewEvaluatedReps += source.viewEvaluatedReps;
  target.viewCorrectReps += source.viewCorrectReps;
  target.scorableEvaluatedReps += source.scorableEvaluatedReps;
  target.scorableCorrectReps += source.scorableCorrectReps;
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
    viewAccuracy:
      totals.viewEvaluatedReps === 0 ? 1 : totals.viewCorrectReps / totals.viewEvaluatedReps,
    scorableAccuracy:
      totals.scorableEvaluatedReps === 0 ? 1 : totals.scorableCorrectReps / totals.scorableEvaluatedReps,
  };
}

function scoreLegacyEvaluationSummary(evaluation: EvaluationSummary): number {
  return (
    evaluation.metrics.repCountAccuracy * 10000 +
    evaluation.metrics.issueF1 * 100 -
    evaluation.metrics.cleanRepFalsePositiveRate
  );
}

function scoreDiagnosticEvaluationSummary(evaluation: EvaluationSummary): number {
  const diagnostic = evaluation.diagnosticSummary;
  const diagnosticIssueF1 = diagnostic?.weightedIssueF1 ?? evaluation.metrics.issueF1;
  const nearThresholdRate =
    diagnostic && diagnostic.diagnosticRepCount > 0
      ? diagnostic.nearThresholdMismatchCount / diagnostic.diagnosticRepCount
      : 0;
  const scorableRate = evaluation.qualityCoverage?.scorableRate ?? 1;
  return (
    evaluation.metrics.repCountAccuracy * 10000 +
    diagnosticIssueF1 * 125 -
    evaluation.metrics.cleanRepFalsePositiveRate * 5 -
    nearThresholdRate * 10 +
    scorableRate * 5
  );
}

function scoreEvaluationSummary(
  evaluation: EvaluationSummary,
  selectionMode: OptimizerSelectionMode,
): number {
  return selectionMode === 'diagnostic'
    ? scoreDiagnosticEvaluationSummary(evaluation)
    : scoreLegacyEvaluationSummary(evaluation);
}

function sortEvaluatedCandidates<T extends { score: number; legacyScore: number }>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => b.score - a.score || b.legacyScore - a.legacyScore);
}

function topEvaluatedCandidates<T extends { score: number; legacyScore: number }>(
  candidates: T[],
  count: number,
): T[] {
  return sortEvaluatedCandidates(candidates).slice(0, count);
}

function emptySourceBreakdown(): Record<CandidateSource, number> {
  return { baseline: 0, random: 0, refined: 0, diagnostic: 0 };
}

function sourceBreakdownFor(candidates: EvaluatedCandidateSummary[]): Record<CandidateSource, number> {
  const result = emptySourceBreakdown();
  for (const candidate of candidates) {
    result[candidate.source] += 1;
  }
  return result;
}

function changedTunablePaths(
  baseConfig: ExerciseHeuristicConfig,
  candidateConfig: ExerciseHeuristicConfig,
  spec: NonNullable<ExerciseDefinition['tunableSpec']>,
): string[] {
  return spec.tunables
    .map((tunable) => tunable.path)
    .filter((pathName) => getConfigValue(baseConfig, pathName) !== getConfigValue(candidateConfig, pathName));
}

function diagnosticSupportGate(args: {
  definition: ExerciseDefinition;
  baselineConfig: ExerciseHeuristicConfig;
  winnerConfig: ExerciseHeuristicConfig;
  winnerSelection: EvaluationSummary;
}): { passed: boolean; reason: string } {
  const spec = args.definition.tunableSpec;
  if (!spec?.diagnosticTuning || spec.diagnosticTuning.length === 0) {
    return { passed: true, reason: 'No diagnostic support gate configured.' };
  }
  const changedPaths = new Set(changedTunablePaths(args.baselineConfig, args.winnerConfig, spec));
  const failures: string[] = [];
  for (const entry of spec.diagnosticTuning) {
    if (!changedPaths.has(entry.thresholdPath)) continue;
    const issueSummary = args.winnerSelection.diagnosticSummary?.issueSummaries[entry.issueId];
    const minPositive = entry.minPositiveCases ?? 2;
    const minNegative = entry.minNegativeCases ?? 2;
    if (
      !issueSummary ||
      issueSummary.eligiblePositiveCount < minPositive ||
      issueSummary.eligibleNegativeCount < minNegative
    ) {
      failures.push(
        `${entry.issueId} support ${issueSummary?.eligiblePositiveCount ?? 0}/${minPositive} positive, ${issueSummary?.eligibleNegativeCount ?? 0}/${minNegative} negative`,
      );
    }
  }
  return failures.length === 0
    ? { passed: true, reason: 'Diagnostic support gate passed.' }
    : { passed: false, reason: `Rejected: diagnostic support gate failed (${failures.join('; ')}).` };
}

function replayCaseForOptimizer(
  definition: ExerciseDefinition,
  datasetCase: DatasetCase,
  config?: ExerciseHeuristicConfig,
) {
  return replayRecording(definition, datasetCase.recording, {
    ...(config ? { heuristicConfig: config } : {}),
    confidenceGating: OPTIMIZER_CONFIDENCE_GATING,
  });
}

function combineQualityCoverageSummaries(
  summaries: Array<EvaluationSummary | null>,
): QualityCoverageMetrics | undefined {
  let totalReps = 0;
  let scoredReps = 0;
  let unscoredReps = 0;
  let weightedConfidence = 0;

  for (const summary of summaries) {
    const coverage = summary?.qualityCoverage;
    if (!coverage) continue;
    totalReps += coverage.totalReps;
    scoredReps += coverage.scoredReps;
    unscoredReps += coverage.unscoredReps;
    weightedConfidence += coverage.averageConfidence * coverage.totalReps;
  }

  if (totalReps === 0) return undefined;
  return {
    totalReps,
    scoredReps,
    unscoredReps,
    scorableRate: scoredReps / totalReps,
    averageConfidence: weightedConfidence / totalReps,
  };
}

function combineDistributions(
  distributions: DiagnosticEvaluationSummary['issueSummaries'][string]['expectedPositiveMetric'][],
): DiagnosticEvaluationSummary['issueSummaries'][string]['expectedPositiveMetric'] {
  const count = distributions.reduce((total, item) => total + item.count, 0);
  if (count === 0) return { count: 0, min: null, max: null, mean: null };
  const means = distributions.filter((item) => item.count > 0 && item.mean !== null);
  const mins = distributions
    .map((item) => item.min)
    .filter((value): value is number => typeof value === 'number');
  const maxes = distributions
    .map((item) => item.max)
    .filter((value): value is number => typeof value === 'number');
  const meanDenominator = means.reduce((total, item) => total + item.count, 0);
  return {
    count,
    min: mins.length === 0 ? null : Math.min(...mins),
    max: maxes.length === 0 ? null : Math.max(...maxes),
    mean:
      meanDenominator === 0
        ? null
        : means.reduce((total, item) => total + item.mean! * item.count, 0) / meanDenominator,
  };
}

function weightedAverageNullable(values: Array<{ value: number | null; weight: number }>): number | null {
  const weighted = values.filter((item) => item.value !== null && item.weight > 0);
  if (weighted.length === 0) return null;
  const denominator = weighted.reduce((total, item) => total + item.weight, 0);
  return weighted.reduce((total, item) => total + item.value! * item.weight, 0) / denominator;
}

function combineDiagnosticSummaries(
  summaries: Array<EvaluationSummary | null>,
): DiagnosticEvaluationSummary | undefined {
  const issueIds = new Set<string>();
  let diagnosticRepCount = 0;
  for (const summary of summaries) {
    const diagnostic = summary?.diagnosticSummary;
    if (!diagnostic) continue;
    diagnosticRepCount += diagnostic.diagnosticRepCount;
    Object.keys(diagnostic.issueSummaries).forEach((issueId) => issueIds.add(issueId));
  }

  if (diagnosticRepCount === 0) return undefined;

  const issueSummaries: DiagnosticEvaluationSummary['issueSummaries'] = {};
  let weightedTp = 0;
  let weightedFp = 0;
  let weightedFn = 0;
  let nearThresholdMismatchCount = 0;

  for (const issueId of issueIds) {
    const parts = summaries
      .map((summary) => summary?.diagnosticSummary?.issueSummaries[issueId])
      .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary));
    const eligiblePositiveCount = parts.reduce((total, item) => total + item.eligiblePositiveCount, 0);
    const eligibleNegativeCount = parts.reduce((total, item) => total + item.eligibleNegativeCount, 0);
    const truePositiveCount = parts.reduce((total, item) => total + item.truePositiveCount, 0);
    const falsePositiveCount = parts.reduce((total, item) => total + item.falsePositiveCount, 0);
    const falseNegativeCount = parts.reduce((total, item) => total + item.falseNegativeCount, 0);
    const skippedCount = parts.reduce((total, item) => total + item.skippedCount, 0);
    const ineligibleCount = parts.reduce((total, item) => total + item.ineligibleCount, 0);
    const issueNearThresholdMismatchCount = parts.reduce(
      (total, item) => total + item.nearThresholdMismatchCount,
      0,
    );
    const issueWeightedTp = parts.reduce((total, item) => total + item.weightedTruePositive, 0);
    const issueWeightedFp = parts.reduce((total, item) => total + item.weightedFalsePositive, 0);
    const issueWeightedFn = parts.reduce((total, item) => total + item.weightedFalseNegative, 0);
    weightedTp += issueWeightedTp;
    weightedFp += issueWeightedFp;
    weightedFn += issueWeightedFn;
    nearThresholdMismatchCount += issueNearThresholdMismatchCount;

    issueSummaries[issueId] = {
      issueId,
      eligiblePositiveCount,
      eligibleNegativeCount,
      truePositiveCount,
      falsePositiveCount,
      falseNegativeCount,
      skippedCount,
      ineligibleCount,
      expectedPositiveMetric: combineDistributions(parts.map((item) => item.expectedPositiveMetric)),
      expectedNegativeMetric: combineDistributions(parts.map((item) => item.expectedNegativeMetric)),
      nearThresholdMismatchCount: issueNearThresholdMismatchCount,
      averageConfidence: weightedAverageNullable(
        parts.map((item) => ({
          value: item.averageConfidence,
          weight: Math.max(1, item.eligiblePositiveCount + item.eligibleNegativeCount),
        })),
      ),
      averageSampleCount: weightedAverageNullable(
        parts.map((item) => ({
          value: item.averageSampleCount,
          weight: Math.max(1, item.eligiblePositiveCount + item.eligibleNegativeCount),
        })),
      ),
      weightedTruePositive: issueWeightedTp,
      weightedFalsePositive: issueWeightedFp,
      weightedFalseNegative: issueWeightedFn,
    };
  }

  const precisionDenominator = weightedTp + weightedFp;
  const recallDenominator = weightedTp + weightedFn;
  const weightedIssuePrecision = precisionDenominator === 0 ? 1 : weightedTp / precisionDenominator;
  const weightedIssueRecall = recallDenominator === 0 ? 1 : weightedTp / recallDenominator;
  const weightedIssueF1 =
    weightedIssuePrecision + weightedIssueRecall === 0
      ? 0
      : (2 * weightedIssuePrecision * weightedIssueRecall) /
        (weightedIssuePrecision + weightedIssueRecall);

  return {
    issueSummaries,
    weightedIssuePrecision,
    weightedIssueRecall,
    weightedIssueF1,
    nearThresholdMismatchCount,
    diagnosticRepCount,
  };
}

function combineSummaries(summaries: Array<EvaluationSummary | null>): EvaluationSummary | null {
  const totals = emptyTotals();
  let hasAny = false;
  for (const summary of summaries) {
    if (!summary) continue;
    addTotals(totals, summary.totals);
    hasAny = true;
  }
  return hasAny
    ? {
        totals,
        metrics: metricsFromTotals(totals),
        qualityCoverage: combineQualityCoverageSummaries(summaries),
        diagnosticSummary: combineDiagnosticSummaries(summaries),
      }
    : null;
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

function parseSelectionMode(argv: string[]): OptimizerSelectionMode {
  const value = flagValue(argv, '--selection-mode') ?? 'diagnostic';
  if (value !== 'current' && value !== 'diagnostic') {
    throw new Error('--selection-mode must be "current" or "diagnostic".');
  }
  return value;
}

export function parseOptimizerCommandOptions(argv: string[]): OptimizerCommandOptions {
  const apply = hasFlag(argv, '--apply') && !hasFlag(argv, '--dry-run');
  return {
    datasetRoot: flagValue(argv, '--dataset-root') ?? undefined,
    exerciseFilter: flagValue(argv, '--exercise'),
    dryRun: hasFlag(argv, '--dry-run'),
    includeCaseDetails: hasFlag(argv, '--include-case-details'),
    includeDiagnostics: !hasFlag(argv, '--no-diagnostics') || hasFlag(argv, '--include-diagnostics'),
    selectionMode: parseSelectionMode(argv),
    apply,
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
  const detailed = summarizeEvaluations(
    cases.map((datasetCase) =>
      evaluateCase(datasetCase, replayCaseForOptimizer(definition, datasetCase, config)),
    ),
  );
  return {
    totals: detailed.totals,
    metrics: detailed.metrics,
    qualityCoverage: detailed.qualityCoverage,
    diagnosticSummary: detailed.diagnosticSummary,
  };
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
        replayCaseForOptimizer(definition, datasetCase, config),
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

function findTunable(spec: NonNullable<ExerciseDefinition['tunableSpec']>, pathName: string): NumericTunable | null {
  return spec.tunables.find((tunable) => tunable.path === pathName) ?? null;
}

function quantile(sortedValues: number[], q: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * q)));
  return sortedValues[index];
}

function valuesForDiagnosticEntry(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  entry: DiagnosticTuningEntry,
): { positives: number[]; negatives: number[]; skippedReason?: string } {
  const positives: number[] = [];
  const negatives: number[] = [];

  for (const datasetCase of cases) {
    const prediction = replayCaseForOptimizer(definition, datasetCase);
    const evaluation = evaluateCase(datasetCase, prediction);
    for (const rep of evaluation.matchedReps) {
      const cue = rep.predictedDiagnostics?.cues[entry.issueId];
      const metric = rep.predictedDiagnostics?.metrics[entry.metricKey];
      if (!cue || !metric || !cue.eligible || !metric.eligible) continue;
      if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) continue;
      if (
        entry.minEligibleSamples !== undefined &&
        (metric.sampleCount ?? cue.support ?? 0) < entry.minEligibleSamples
      ) {
        continue;
      }
      if (rep.expectedIssueIds.includes(entry.issueId)) positives.push(metric.value);
      else negatives.push(metric.value);
    }
  }

  const minPositiveCases = entry.minPositiveCases ?? 2;
  const minNegativeCases = entry.minNegativeCases ?? 2;
  if (positives.length < minPositiveCases || negatives.length < minNegativeCases) {
    return {
      positives,
      negatives,
      skippedReason: `${entry.issueId} has insufficient eligible diagnostic support (${positives.length}/${minPositiveCases} positives, ${negatives.length}/${minNegativeCases} negatives).`,
    };
  }
  return { positives, negatives };
}

function thresholdCandidatesFromValues(
  positives: number[],
  negatives: number[],
  entry: DiagnosticTuningEntry,
  currentValue: number,
  tunable: NumericTunable,
): number[] {
  if (entry.direction !== 'above' && entry.direction !== 'below') return [];

  const rawValues = new Set<number>([
    currentValue - tunable.step,
    currentValue,
    currentValue + tunable.step,
  ]);
  const sortedPositive = [...positives].sort((a, b) => a - b);
  const sortedNegative = [...negatives].sort((a, b) => a - b);
  for (const q of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const positive = quantile(sortedPositive, q);
    const negative = quantile(sortedNegative, q);
    if (positive !== null) rawValues.add(positive);
    if (negative !== null) rawValues.add(negative);
  }

  const labelled = [
    ...positives.map((value) => ({ value, label: 'positive' as const })),
    ...negatives.map((value) => ({ value, label: 'negative' as const })),
  ].sort((a, b) => a.value - b.value);
  for (let i = 1; i < labelled.length; i++) {
    if (labelled[i - 1].label !== labelled[i].label) {
      rawValues.add((labelled[i - 1].value + labelled[i].value) / 2);
    }
  }

  return Array.from(rawValues)
    .map((value) => clampTunableValue(value, tunable))
    .filter((value) => value >= tunable.min && value <= tunable.max)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function generateDiagnosticCandidates(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
): { candidates: InstrumentedCandidateConfig[]; fallbackReasons: string[] } {
  const spec = definition.tunableSpec;
  if (!definition.heuristicConfig || !spec?.diagnosticTuning || spec.diagnosticTuning.length === 0) {
    return { candidates: [], fallbackReasons: ['Exercise has no diagnosticTuning metadata.'] };
  }

  const candidates: InstrumentedCandidateConfig[] = [];
  const fallbackReasons: string[] = [];

  for (const entry of spec.diagnosticTuning) {
    const tunable = findTunable(spec, entry.thresholdPath);
    if (!tunable) {
      fallbackReasons.push(`${entry.issueId} threshold ${entry.thresholdPath} is not tunable.`);
      continue;
    }
    const currentValue = getConfigValue(definition.heuristicConfig, entry.thresholdPath);
    if (typeof currentValue !== 'number' || !Number.isFinite(currentValue)) {
      fallbackReasons.push(`${entry.issueId} threshold ${entry.thresholdPath} is not numeric.`);
      continue;
    }
    const values = valuesForDiagnosticEntry(definition, cases, entry);
    if (values.skippedReason) {
      fallbackReasons.push(values.skippedReason);
      continue;
    }
    const thresholds = thresholdCandidatesFromValues(
      values.positives,
      values.negatives,
      entry,
      currentValue,
      tunable,
    );
    thresholds.forEach((threshold, index) => {
      if (threshold === currentValue) return;
      candidates.push({
        id: `diagnostic-${entry.issueId}-${index + 1}`,
        source: 'diagnostic',
        changedPaths: [entry.thresholdPath],
        config: setConfigValue(definition.heuristicConfig!, entry.thresholdPath, threshold),
      });
    });
  }

  return { candidates, fallbackReasons };
}

function combineDiagnosticCandidates(
  baseConfig: ExerciseHeuristicConfig,
  candidates: EvaluatedCandidateSummary[],
  limit: number,
): InstrumentedCandidateConfig[] {
  const byPath = new Map<string, EvaluatedCandidateSummary>();
  for (const candidate of candidates) {
    const pathName = candidate.changedPaths?.[0];
    if (!pathName) continue;
    const current = byPath.get(pathName);
    if (!current || candidate.score > current.score) {
      byPath.set(pathName, candidate);
    }
  }
  const singles = Array.from(byPath.values()).slice(0, Math.max(0, limit));
  const combined: InstrumentedCandidateConfig[] = [];
  for (let i = 0; i < singles.length; i++) {
    for (let j = i + 1; j < singles.length; j++) {
      let config = baseConfig;
      const changedPaths = [...(singles[i].changedPaths ?? []), ...(singles[j].changedPaths ?? [])];
      for (const candidate of [singles[i], singles[j]]) {
        for (const pathName of candidate.changedPaths ?? []) {
          config = setConfigValue(config, pathName, getConfigValue(candidate.config, pathName));
        }
      }
      combined.push({
        id: `diagnostic-combo-${i + 1}-${j + 1}`,
        source: 'diagnostic',
        changedPaths,
        config,
      });
    }
  }
  return combined.slice(0, limit);
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
  candidates: InstrumentedCandidateConfig[],
  selectionMode: OptimizerSelectionMode = 'diagnostic',
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
        source: candidate.source,
        changedPaths: candidate.changedPaths,
        config: candidate.config,
        evaluation,
        score: scoreEvaluationSummary(evaluation, selectionMode),
        legacyScore: scoreLegacyEvaluationSummary(evaluation),
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
  selectionMode: OptimizerSelectionMode = 'diagnostic',
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
    sourceBreakdown: emptySourceBreakdown(),
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

  const randomCandidates: InstrumentedCandidateConfig[] = generateRandomCandidates(
    definition.heuristicConfig,
    spec,
    searchOptions,
  ).map((candidate) => ({ ...candidate, source: 'random' }));

  const diagnostic = generateDiagnosticCandidates(definition, searchCases);
  const randomBatch = evaluateCandidatesCompact(
    definition,
    searchCases,
    randomCandidates,
    selectionMode,
  );
  const diagnosticBatch = evaluateCandidatesCompact(
    definition,
    searchCases,
    diagnostic.candidates,
    selectionMode,
  );
  const diagnosticCombos = combineDiagnosticCandidates(
    definition.heuristicConfig,
    topEvaluatedCandidates(diagnosticBatch.evaluated, Math.min(fallbackOptions.survivorCount, 8)),
    Math.min(fallbackOptions.survivorCount, 8),
  );
  const diagnosticComboBatch = evaluateCandidatesCompact(
    definition,
    searchCases,
    diagnosticCombos,
    selectionMode,
  );
  let evaluated = sortEvaluatedCandidates([
    ...randomBatch.evaluated,
    ...diagnosticBatch.evaluated,
    ...diagnosticComboBatch.evaluated,
  ]);
  rejectedCandidates += randomBatch.rejectedCount;
  rejectedCandidates += diagnosticBatch.rejectedCount + diagnosticComboBatch.rejectedCount;
  rejectedCandidateExamples.push(...randomBatch.rejectedExamples);
  rejectedCandidateExamples.push(...diagnosticBatch.rejectedExamples, ...diagnosticComboBatch.rejectedExamples);

  for (let round = 1; round <= fallbackOptions.refinementRounds; round++) {
    const survivors = topEvaluatedCandidates(evaluated, fallbackOptions.survivorCount);
    if (survivors.length === 0) break;

    const refined: InstrumentedCandidateConfig[] = dedupeCandidates(
      survivors.flatMap((candidate) => refineCandidate(candidate, spec, round)),
    ).map((candidate) => ({
      ...candidate,
      source: 'refined',
      changedPaths: candidate.id.includes('.')
        ? [candidate.id.split('-r')[1]?.split('-').slice(1, -1).join('-')].filter(Boolean)
        : undefined,
    }));
    const refinedBatch = evaluateCandidatesCompact(
      definition,
      searchCases,
      refined,
      selectionMode,
    );
    rejectedCandidates += refinedBatch.rejectedCount;
    rejectedCandidateExamples.push(...refinedBatch.rejectedExamples);
    evaluated = sortEvaluatedCandidates([...survivors, ...refinedBatch.evaluated]);
  }

  const topCandidates = topEvaluatedCandidates(evaluated, fallbackOptions.survivorCount);
  return {
    candidates: topCandidates,
    specIssues,
    rejectedCandidates,
    rejectedCandidateExamples: rejectedCandidateExamples.slice(0, 5),
    options: fallbackOptions,
    sourceBreakdown: sourceBreakdownFor(topCandidates),
    diagnosticFallbackReason:
      diagnostic.candidates.length === 0 && diagnostic.fallbackReasons.length > 0
        ? diagnostic.fallbackReasons.slice(0, 5).join(' ')
        : undefined,
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
    sourceBreakdown: emptySourceBreakdown(),
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
  const selectionMode = options.selectionMode ?? 'diagnostic';
  const shouldApply = options.apply ?? false;

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
      shouldApply &&
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
    selectionMode,
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

  const search = searchExercise(definition, trainCases, options.search, selectionMode);
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
        source: 'baseline',
        config: definition.heuristicConfig,
        evaluation: baselineSelection,
        score: scoreEvaluationSummary(baselineSelection, selectionMode),
        legacyScore: scoreLegacyEvaluationSummary(baselineSelection),
      }
    : null;
  const selectionBatch = evaluateCandidatesCompact(
    definition,
    selection.cases,
    search.candidates.map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      changedPaths: candidate.changedPaths,
      config: candidate.config,
    })),
    selectionMode,
  );
  const rankedSelection = sortEvaluatedCandidates(
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

  let gate = splitGate.passed
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

  if (
    gate.shouldApply &&
    winner.id !== 'baseline' &&
    definition.heuristicConfig &&
    selectionMode === 'diagnostic'
  ) {
    const supportGate = diagnosticSupportGate({
      definition,
      baselineConfig: definition.heuristicConfig,
      winnerConfig: winner.config,
      winnerSelection,
    });
    if (!supportGate.passed) {
      gate = { shouldApply: false, reason: supportGate.reason };
    }
  }

  let applied = false;
  let reason = gate.reason;
  if (gate.shouldApply && winner.id !== 'baseline' && (!shouldApply || options.dryRun)) {
    reason = `${gate.reason} Report-only mode; pass --apply to write tuned config JSON.`;
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

function stripEvaluationSummaryDiagnostics<T extends EvaluationSummary | null>(summary: T): T {
  if (!summary) return summary;
  const { diagnosticSummary: _diagnosticSummary, ...rest } = summary;
  return rest as T;
}

function stripDatasetEvaluationDiagnostics<T extends DatasetEvaluation | null | undefined>(evaluation: T): T {
  if (!evaluation) return evaluation;
  const { diagnosticSummary: _diagnosticSummary, cases, ...rest } = evaluation;
  return {
    ...rest,
    cases: cases.map((caseEvaluation) => {
      const {
        diagnosticSummary: _caseDiagnosticSummary,
        reps,
        matchedReps: _matchedReps,
        missingExpectedReps: _missingExpectedReps,
        extraPredictedReps: _extraPredictedReps,
        ...caseRest
      } = caseEvaluation;
      const strippedReps = reps.map((rep) => {
        const { predictedDiagnostics: _predictedDiagnostics, ...repRest } = rep;
        return repRest;
      });
      return {
        ...caseRest,
        reps: strippedReps,
        matchedReps: strippedReps.filter((rep) => rep.matchStatus === 'matched'),
        missingExpectedReps: strippedReps.filter((rep) => rep.matchStatus === 'missing_expected'),
        extraPredictedReps: strippedReps.filter((rep) => rep.matchStatus === 'extra_predicted'),
      };
    }),
  } as T;
}

function stripSummarySplitDiagnostics(
  evaluations: EvaluationBySplit<EvaluationSummary>,
): EvaluationBySplit<EvaluationSummary> {
  return {
    all: stripEvaluationSummaryDiagnostics(evaluations.all),
    train: stripEvaluationSummaryDiagnostics(evaluations.train),
    validation: stripEvaluationSummaryDiagnostics(evaluations.validation),
    test: stripEvaluationSummaryDiagnostics(evaluations.test),
  };
}

function stripDetailedSplitDiagnostics(
  evaluations: EvaluationBySplit<DatasetEvaluation> | undefined,
): EvaluationBySplit<DatasetEvaluation> | undefined {
  if (!evaluations) return undefined;
  return {
    all: stripDatasetEvaluationDiagnostics(evaluations.all),
    train: stripDatasetEvaluationDiagnostics(evaluations.train),
    validation: stripDatasetEvaluationDiagnostics(evaluations.validation),
    test: stripDatasetEvaluationDiagnostics(evaluations.test),
  };
}

function stripExerciseReportDiagnostics(report: ExerciseOptimisationReport): ExerciseOptimisationReport {
  return {
    ...report,
    search: {
      ...report.search,
      candidates: report.search.candidates.map((candidate) => ({
        ...candidate,
        evaluation: stripEvaluationSummaryDiagnostics(candidate.evaluation),
      })),
    },
    baseline: stripSummarySplitDiagnostics(report.baseline),
    baselineCaseDetails: stripDetailedSplitDiagnostics(report.baselineCaseDetails),
    winner: {
      ...report.winner,
      all: stripEvaluationSummaryDiagnostics(report.winner.all),
      train: stripEvaluationSummaryDiagnostics(report.winner.train),
      validation: stripEvaluationSummaryDiagnostics(report.winner.validation),
      test: stripEvaluationSummaryDiagnostics(report.winner.test),
    },
    winnerCaseDetails: stripDetailedSplitDiagnostics(report.winnerCaseDetails),
    rankedSelection: report.rankedSelection.map((candidate) => ({
      ...candidate,
      evaluation: stripEvaluationSummaryDiagnostics(candidate.evaluation),
    })),
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
  const reportExerciseReports =
    options.includeDiagnostics === false
      ? exerciseReports.map(stripExerciseReportDiagnostics)
      : exerciseReports;

  const report: DatasetOptimisationReport = {
    options,
    datasetRoot,
    discoveredExercises: exercises,
    confidenceGating: OPTIMIZER_CONFIDENCE_GATING,
    baseline: combineSummaries(reportExerciseReports.map((exercise) => exercise.baseline.all)),
    exercises: reportExerciseReports,
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
