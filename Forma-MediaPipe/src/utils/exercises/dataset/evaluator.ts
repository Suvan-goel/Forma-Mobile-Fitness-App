import type {
  CaseEvaluation,
  DatasetCase,
  DatasetEvaluation,
  EvaluationMetrics,
  EvaluationTotals,
  PredictionLike,
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

function evaluateRep(
  expected: string[],
  predicted: string[],
  index: number,
  timing: RepTimingMetadata,
): RepEvaluation {
  const expectedSet = new Set(unique(expected));
  const predictedSet = new Set(unique(predicted));
  const truePositives: string[] = [];
  const falsePositives: string[] = [];
  const falseNegatives: string[] = [];

  for (const issueId of predictedSet) {
    if (expectedSet.has(issueId)) truePositives.push(issueId);
    else falsePositives.push(issueId);
  }
  for (const issueId of expectedSet) {
    if (!predictedSet.has(issueId)) falseNegatives.push(issueId);
  }

  return {
    index,
    ...timing,
    expectedIssueIds: Array.from(expectedSet),
    predictedIssueIds: Array.from(predictedSet),
    truePositives,
    falsePositives,
    falseNegatives,
    expectedClean: expectedSet.size === 0,
    predictedClean: predictedSet.size === 0,
  };
}

function addRepToTotals(totals: EvaluationTotals, rep: RepEvaluation): void {
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
      });
      reps.push(rep);
      addRepToTotals(totals, rep);
      continue;
    }

    usedPredictionIndexes.add(match.predictionIndex);
    const rep = evaluateRep(expectedRep.issueIds, match.prediction.issueIds, expectedRep.index, {
      matchStatus: 'matched',
      expectedRepIndex: expectedRep.index,
      predictedRepIndex: match.prediction.repIndex,
      expectedStartMs: expectedRep.startMs,
      expectedEndMs: expectedRep.endMs,
      predictedStartMs: predictionStart(match.prediction),
      predictedEndMs: predictionEnd(match.prediction),
      overlapMs: match.overlapMs,
      completionDeltaMs: match.completionDeltaMs,
    });
    reps.push(rep);
    addRepToTotals(totals, rep);
  }

  let extraRepCount = 0;
  prediction.reps.forEach((predictedRep, predictionIndex) => {
    if (usedPredictionIndexes.has(predictionIndex)) return;
    extraRepCount += 1;
    const rep = evaluateRep([], predictedRep.issueIds, datasetCase.label.reps.length + extraRepCount, {
      matchStatus: 'extra_predicted',
      expectedRepIndex: null,
      predictedRepIndex: predictedRep.repIndex,
      expectedStartMs: null,
      expectedEndMs: null,
      predictedStartMs: predictionStart(predictedRep),
      predictedEndMs: predictionEnd(predictedRep),
      overlapMs: 0,
      completionDeltaMs: null,
    });
    reps.push(rep);
    addRepToTotals(totals, rep);
  });

  return {
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
}

export function summarizeEvaluations(cases: CaseEvaluation[]): DatasetEvaluation {
  const totals = emptyTotals();
  for (const caseEvaluation of cases) {
    addCaseTotals(totals, caseEvaluation);
  }
  return { cases, totals, metrics: metricsFromTotals(totals) };
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
