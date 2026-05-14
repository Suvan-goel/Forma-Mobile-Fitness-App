import type {
  CaseEvaluation,
  DatasetCase,
  DatasetEvaluation,
  DiagnosticEvaluationSummary,
  DiagnosticIssueSummary,
  DiagnosticMetricDistribution,
  EvaluationMetrics,
  EvaluationTotals,
  PredictionLike,
  QualityCoverageMetrics,
  RepLabel,
  RepEvaluation,
} from './types';
import type { ReplayRepPrediction } from '../replay';

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
    scoreEvaluatedReps: 0,
    scoreInRangeReps: 0,
    scoreRangeMissTotal: 0,
  };
}

function unique(values: string[] | undefined): string[] {
  return Array.from(new Set(values ?? [])).sort();
}

interface RepTimingMetadata {
  matchStatus: RepEvaluation['matchStatus'];
  expectedRepIndex: number | null;
  predictedRepIndex: number | null;
  expectedStartMs: number | null;
  expectedEndMs: number | null;
  predictedStartMs: number | null;
  predictedEndMs: number | null;
  overlapMs: number;
  completionDeltaMs: number | null;
}

interface RepMatch {
  predictionIndex: number;
  prediction: ReplayRepPrediction;
  overlapMs: number;
  completionDeltaMs: number;
}

function scoreMissFromExpectedRange(score: number, [min, max]: [number, number]): number {
  if (score < min) return min - score;
  if (score > max) return score - max;
  return 0;
}

function evaluateRep(
  expected: string[],
  predicted: string[],
  index: number,
  timing: RepTimingMetadata,
  prediction?: ReplayRepPrediction,
  options: {
    expectedScorable?: boolean;
    expectedScorableExplicit?: boolean;
    expectedView?: RepEvaluation['expectedView'];
    expectedScoreRange?: [number, number];
  } = {},
): RepEvaluation {
  const expectedScorable = options.expectedScorable ?? true;
  const predictedScore =
    typeof prediction?.score === 'number' && Number.isFinite(prediction.score)
      ? prediction.score
      : undefined;
  const scoreRangeMiss =
    expectedScorable && options.expectedScoreRange && predictedScore !== undefined
      ? scoreMissFromExpectedRange(predictedScore, options.expectedScoreRange)
      : null;
  const expectedSet = new Set(unique(expected));
  const predictedSet = new Set(unique(predicted));
  const truePositives: string[] = [];
  const falsePositives: string[] = [];
  const falseNegatives: string[] = [];

  if (expectedScorable) {
    for (const issueId of predictedSet) {
      if (expectedSet.has(issueId)) truePositives.push(issueId);
      else falsePositives.push(issueId);
    }
    for (const issueId of expectedSet) {
      if (!predictedSet.has(issueId)) falseNegatives.push(issueId);
    }
  }

  return {
    index,
    ...timing,
    expectedIssueIds: Array.from(expectedSet),
    predictedIssueIds: Array.from(predictedSet),
    predictedDiagnostics: prediction?.diagnostics,
    truePositives,
    falsePositives,
    falseNegatives,
    expectedScorable,
    expectedScorableExplicit: options.expectedScorableExplicit,
    predictedScorable: prediction?.scorable ?? prediction?.diagnostics?.scorable,
    expectedView: options.expectedView,
    predictedView: prediction?.diagnostics?.view,
    expectedClean: expectedSet.size === 0,
    predictedClean: predictedSet.size === 0,
    expectedScoreRange: options.expectedScoreRange,
    predictedScore,
    scoreInExpectedRange: scoreRangeMiss === null ? undefined : scoreRangeMiss === 0,
    scoreRangeMiss,
  };
}

function addRepToTotals(totals: EvaluationTotals, rep: RepEvaluation): void {
  if (rep.matchStatus === 'matched') {
    if (rep.expectedView && rep.expectedView !== 'unknown') {
      totals.viewEvaluatedReps += 1;
      if (rep.predictedView === rep.expectedView) totals.viewCorrectReps += 1;
    }
    if (rep.expectedScorableExplicit) {
      totals.scorableEvaluatedReps += 1;
      if (rep.predictedScorable === rep.expectedScorable) totals.scorableCorrectReps += 1;
    }
  }

  if (!rep.expectedScorable) return;
  if (rep.matchStatus === 'matched' && rep.expectedScoreRange && rep.scoreRangeMiss !== null && rep.scoreRangeMiss !== undefined) {
    totals.scoreEvaluatedReps += 1;
    if (rep.scoreInExpectedRange) totals.scoreInRangeReps += 1;
    totals.scoreRangeMissTotal += rep.scoreRangeMiss;
  }
  totals.truePositives += rep.truePositives.length;
  totals.falsePositives += rep.falsePositives.length;
  totals.falseNegatives += rep.falseNegatives.length;
  if (rep.expectedClean && rep.matchStatus !== 'extra_predicted') {
    totals.cleanReps += 1;
    if (!rep.predictedClean) totals.cleanFalsePositives += 1;
  }
}

function overlapMs(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function predictionStart(prediction: ReplayRepPrediction): number {
  return prediction.startedAt ?? prediction.completedAt;
}

function predictionEnd(prediction: ReplayRepPrediction): number {
  return Math.max(predictionStart(prediction), prediction.completedAt);
}

function completionDeltaMs(expected: RepLabel, prediction: ReplayRepPrediction): number {
  return Math.abs(prediction.completedAt - expected.endMs);
}

function findBestPredictionMatch(
  expected: RepLabel,
  predictions: ReplayRepPrediction[],
  usedPredictionIndexes: Set<number>,
): RepMatch | null {
  let best: RepMatch | null = null;

  predictions.forEach((prediction, predictionIndex) => {
    if (usedPredictionIndexes.has(predictionIndex)) return;

    const predictedStartMs = predictionStart(prediction);
    const predictedEndMs = predictionEnd(prediction);
    const overlap = overlapMs(expected.startMs, expected.endMs, predictedStartMs, predictedEndMs);
    const completionInsideExpectedWindow =
      prediction.completedAt >= expected.startMs && prediction.completedAt <= expected.endMs;

    if (overlap <= 0 && !completionInsideExpectedWindow) return;

    const delta = completionDeltaMs(expected, prediction);
    const candidate = { predictionIndex, prediction, overlapMs: overlap, completionDeltaMs: delta };

    if (
      !best ||
      candidate.overlapMs > best.overlapMs ||
      (candidate.overlapMs === best.overlapMs &&
        candidate.completionDeltaMs < best.completionDeltaMs)
    ) {
      best = candidate;
    }
  });

  return best;
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
    scoreInRangeRate:
      totals.scoreEvaluatedReps === 0 ? 1 : totals.scoreInRangeReps / totals.scoreEvaluatedReps,
    scoreMeanAbsoluteMiss:
      totals.scoreEvaluatedReps === 0 ? 0 : totals.scoreRangeMissTotal / totals.scoreEvaluatedReps,
  };
}

function qualityCoverageFromPrediction(prediction: PredictionLike): QualityCoverageMetrics | undefined {
  const summary = prediction.qualitySummary;
  if (!summary) return undefined;
  return {
    totalReps: summary.totalReps,
    scoredReps: summary.scoredReps,
    unscoredReps: summary.unscoredReps,
    scorableRate: summary.totalReps === 0 ? 1 : summary.scoredReps / summary.totalReps,
    averageConfidence: summary.confidence,
  };
}

function combineQualityCoverage(cases: CaseEvaluation[]): QualityCoverageMetrics | undefined {
  let totalReps = 0;
  let scoredReps = 0;
  let unscoredReps = 0;
  let weightedConfidence = 0;

  for (const caseEvaluation of cases) {
    const coverage = caseEvaluation.qualityCoverage;
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

function emptyDistribution(): { values: number[] } {
  return { values: [] };
}

function distribution(values: number[]): DiagnosticMetricDistribution {
  if (values.length === 0) return { count: 0, min: null, max: null, mean: null };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: sum / values.length,
  };
}

type MutableIssueSummary = Omit<
  DiagnosticIssueSummary,
  'expectedPositiveMetric' | 'expectedNegativeMetric'
> & {
  positiveValues: number[];
  negativeValues: number[];
  confidenceValues: number[];
  sampleCounts: number[];
};

function createMutableIssueSummary(issueId: string): MutableIssueSummary {
  return {
    issueId,
    eligiblePositiveCount: 0,
    eligibleNegativeCount: 0,
    truePositiveCount: 0,
    falsePositiveCount: 0,
    falseNegativeCount: 0,
    skippedCount: 0,
    ineligibleCount: 0,
    nearThresholdMismatchCount: 0,
    averageConfidence: null,
    averageSampleCount: null,
    weightedTruePositive: 0,
    weightedFalsePositive: 0,
    weightedFalseNegative: 0,
    positiveValues: emptyDistribution().values,
    negativeValues: emptyDistribution().values,
    confidenceValues: [],
    sampleCounts: [],
  };
}

function mismatchIsNearThreshold(margin: number | null | undefined, threshold: unknown): boolean {
  if (typeof margin !== 'number' || !Number.isFinite(margin)) return false;
  const numericThreshold = typeof threshold === 'number' && Number.isFinite(threshold) ? Math.abs(threshold) : 0;
  const tolerance = Math.max(0.05, numericThreshold * 0.1);
  return Math.abs(margin) <= tolerance;
}

function firstMetricValue(rep: RepEvaluation, metricKeys: string[]): number | null {
  const metrics = rep.predictedDiagnostics?.metrics;
  if (!metrics) return null;
  for (const key of metricKeys) {
    const value = metrics[key]?.value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function addDiagnosticRep(
  summaries: Map<string, MutableIssueSummary>,
  rep: RepEvaluation,
): void {
  if (!rep.expectedScorable) return;
  const diagnostics = rep.predictedDiagnostics;
  if (!diagnostics) return;
  const issueIds = new Set([
    ...rep.expectedIssueIds,
    ...rep.predictedIssueIds,
    ...Object.keys(diagnostics.cues),
  ]);

  for (const issueId of issueIds) {
    const cue = diagnostics.cues[issueId];
    const summary = summaries.get(issueId) ?? createMutableIssueSummary(issueId);
    summaries.set(issueId, summary);

    const expectedPositive = rep.expectedIssueIds.includes(issueId);
    const predictedPositive = rep.predictedIssueIds.includes(issueId);
    const eligible = cue?.eligible ?? false;
    const weight = eligible ? 1 : 0.35;

    if (expectedPositive && eligible) summary.eligiblePositiveCount += 1;
    if (!expectedPositive && eligible) summary.eligibleNegativeCount += 1;
    if (!eligible) summary.ineligibleCount += 1;
    if (cue?.skippedReason) summary.skippedCount += 1;

    if (expectedPositive && predictedPositive) {
      summary.truePositiveCount += 1;
      summary.weightedTruePositive += weight;
    } else if (!expectedPositive && predictedPositive) {
      summary.falsePositiveCount += 1;
      summary.weightedFalsePositive += weight;
    } else if (expectedPositive && !predictedPositive) {
      summary.falseNegativeCount += 1;
      summary.weightedFalseNegative += weight;
    }

    if (cue && expectedPositive !== predictedPositive && mismatchIsNearThreshold(cue.margin, cue.thresholdValue)) {
      summary.nearThresholdMismatchCount += 1;
    }

    if (cue && eligible) {
      const value = firstMetricValue(rep, cue.metricKeys);
      if (value !== null) {
        if (expectedPositive) summary.positiveValues.push(value);
        else summary.negativeValues.push(value);
      }
      for (const key of cue.metricKeys) {
        const metric = diagnostics.metrics[key];
        if (!metric) continue;
        if (typeof metric.confidence === 'number' && Number.isFinite(metric.confidence)) {
          summary.confidenceValues.push(metric.confidence);
        }
        if (typeof metric.sampleCount === 'number' && Number.isFinite(metric.sampleCount)) {
          summary.sampleCounts.push(metric.sampleCount);
        }
      }
    }
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function combineDiagnosticSummary(cases: CaseEvaluation[]): DiagnosticEvaluationSummary | undefined {
  const summaries = new Map<string, MutableIssueSummary>();
  let diagnosticRepCount = 0;

  for (const caseEvaluation of cases) {
    for (const rep of caseEvaluation.reps) {
      if (!rep.expectedScorable) continue;
      if (!rep.predictedDiagnostics) continue;
      diagnosticRepCount += 1;
      addDiagnosticRep(summaries, rep);
    }
  }

  if (diagnosticRepCount === 0) return undefined;

  const issueSummaries: Record<string, DiagnosticIssueSummary> = {};
  let weightedTp = 0;
  let weightedFp = 0;
  let weightedFn = 0;
  let nearThresholdMismatchCount = 0;

  for (const [issueId, summary] of summaries.entries()) {
    weightedTp += summary.weightedTruePositive;
    weightedFp += summary.weightedFalsePositive;
    weightedFn += summary.weightedFalseNegative;
    nearThresholdMismatchCount += summary.nearThresholdMismatchCount;
    issueSummaries[issueId] = {
      issueId,
      eligiblePositiveCount: summary.eligiblePositiveCount,
      eligibleNegativeCount: summary.eligibleNegativeCount,
      truePositiveCount: summary.truePositiveCount,
      falsePositiveCount: summary.falsePositiveCount,
      falseNegativeCount: summary.falseNegativeCount,
      skippedCount: summary.skippedCount,
      ineligibleCount: summary.ineligibleCount,
      expectedPositiveMetric: distribution(summary.positiveValues),
      expectedNegativeMetric: distribution(summary.negativeValues),
      nearThresholdMismatchCount: summary.nearThresholdMismatchCount,
      averageConfidence: average(summary.confidenceValues),
      averageSampleCount: average(summary.sampleCounts),
      weightedTruePositive: summary.weightedTruePositive,
      weightedFalsePositive: summary.weightedFalsePositive,
      weightedFalseNegative: summary.weightedFalseNegative,
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

export function evaluateCase(
  datasetCase: DatasetCase,
  prediction: PredictionLike,
): CaseEvaluation {
  const totals = emptyTotals();
  totals.cases = 1;
  totals.expectedReps = datasetCase.label.expectedReps;
  totals.predictedReps = prediction.finalRepCount;
  const repCountCorrect = prediction.finalRepCount === datasetCase.label.expectedReps;
  totals.repCountCorrect = repCountCorrect ? 1 : 0;

  const reps: RepEvaluation[] = [];
  const usedPredictionIndexes = new Set<number>();

  for (const expectedRep of datasetCase.label.reps) {
    const match = findBestPredictionMatch(expectedRep, prediction.reps, usedPredictionIndexes);
    if (!match) {
      const rep = evaluateRep(expectedRep.issueIds, [], expectedRep.index, {
        matchStatus: 'missing_expected',
        expectedRepIndex: expectedRep.index,
        predictedRepIndex: null,
        expectedStartMs: expectedRep.startMs,
        expectedEndMs: expectedRep.endMs,
        predictedStartMs: null,
        predictedEndMs: null,
        overlapMs: 0,
        completionDeltaMs: null,
      }, undefined, {
        expectedScorable: expectedRep.scorable ?? true,
        expectedScorableExplicit: typeof expectedRep.scorable === 'boolean',
        expectedView: expectedRep.view,
        expectedScoreRange: expectedRep.expectedScoreRange,
      });
      reps.push(rep);
      addRepToTotals(totals, rep);
      continue;
    }

    usedPredictionIndexes.add(match.predictionIndex);
    const rep = evaluateRep(
      expectedRep.issueIds,
      match.prediction.issueIds,
      expectedRep.index,
      {
        matchStatus: 'matched',
        expectedRepIndex: expectedRep.index,
        predictedRepIndex: match.prediction.repIndex,
        expectedStartMs: expectedRep.startMs,
        expectedEndMs: expectedRep.endMs,
        predictedStartMs: predictionStart(match.prediction),
        predictedEndMs: predictionEnd(match.prediction),
        overlapMs: match.overlapMs,
        completionDeltaMs: match.completionDeltaMs,
      },
      match.prediction,
      {
        expectedScorable: expectedRep.scorable ?? true,
        expectedScorableExplicit: typeof expectedRep.scorable === 'boolean',
        expectedView: expectedRep.view,
        expectedScoreRange: expectedRep.expectedScoreRange,
      },
    );
    reps.push(rep);
    addRepToTotals(totals, rep);
  }

  let extraRepCount = 0;
  prediction.reps.forEach((predictedRep, predictionIndex) => {
    if (usedPredictionIndexes.has(predictionIndex)) return;
    extraRepCount += 1;
    const rep = evaluateRep(
      [],
      predictedRep.issueIds,
      datasetCase.label.reps.length + extraRepCount,
      {
        matchStatus: 'extra_predicted',
        expectedRepIndex: null,
        predictedRepIndex: predictedRep.repIndex,
        expectedStartMs: null,
        expectedEndMs: null,
        predictedStartMs: predictionStart(predictedRep),
        predictedEndMs: predictionEnd(predictedRep),
        overlapMs: 0,
        completionDeltaMs: null,
      },
      predictedRep,
    );
    reps.push(rep);
    addRepToTotals(totals, rep);
  });

  const caseEvaluation: CaseEvaluation = {
    exerciseName: datasetCase.label.exerciseName,
    sourceVideo: datasetCase.label.sourceVideo,
    split: datasetCase.label.split,
    expectedReps: datasetCase.label.expectedReps,
    predictedReps: prediction.finalRepCount,
    repCountCorrect,
    reps,
    matchedReps: reps.filter((rep) => rep.matchStatus === 'matched'),
    missingExpectedReps: reps.filter((rep) => rep.matchStatus === 'missing_expected'),
    extraPredictedReps: reps.filter((rep) => rep.matchStatus === 'extra_predicted'),
    totals,
    qualityCoverage: qualityCoverageFromPrediction(prediction),
  };
  return {
    ...caseEvaluation,
    diagnosticSummary: combineDiagnosticSummary([caseEvaluation]),
  };
}

function addCaseTotals(totals: EvaluationTotals, caseEvaluation: CaseEvaluation): void {
  totals.cases += caseEvaluation.totals.cases;
  totals.expectedReps += caseEvaluation.totals.expectedReps;
  totals.predictedReps += caseEvaluation.totals.predictedReps;
  totals.repCountCorrect += caseEvaluation.totals.repCountCorrect;
  totals.truePositives += caseEvaluation.totals.truePositives;
  totals.falsePositives += caseEvaluation.totals.falsePositives;
  totals.falseNegatives += caseEvaluation.totals.falseNegatives;
  totals.cleanReps += caseEvaluation.totals.cleanReps;
  totals.cleanFalsePositives += caseEvaluation.totals.cleanFalsePositives;
  totals.viewEvaluatedReps += caseEvaluation.totals.viewEvaluatedReps;
  totals.viewCorrectReps += caseEvaluation.totals.viewCorrectReps;
  totals.scorableEvaluatedReps += caseEvaluation.totals.scorableEvaluatedReps;
  totals.scorableCorrectReps += caseEvaluation.totals.scorableCorrectReps;
  totals.scoreEvaluatedReps += caseEvaluation.totals.scoreEvaluatedReps;
  totals.scoreInRangeReps += caseEvaluation.totals.scoreInRangeReps;
  totals.scoreRangeMissTotal += caseEvaluation.totals.scoreRangeMissTotal;
}

export function summarizeEvaluations(cases: CaseEvaluation[]): DatasetEvaluation {
  const totals = emptyTotals();
  for (const caseEvaluation of cases) {
    addCaseTotals(totals, caseEvaluation);
  }
  return {
    cases,
    totals,
    metrics: metricsFromTotals(totals),
    qualityCoverage: combineQualityCoverage(cases),
    diagnosticSummary: combineDiagnosticSummary(cases),
  };
}

export function evaluateDataset(
  cases: Array<{ datasetCase: DatasetCase; prediction: PredictionLike }>,
): DatasetEvaluation {
  return summarizeEvaluations(
    cases.map(({ datasetCase, prediction }) => evaluateCase(datasetCase, prediction)),
  );
}

export function formatMetricPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
