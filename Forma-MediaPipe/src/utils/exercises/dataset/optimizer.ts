import {
  clampTunableValue,
  cloneConfig,
  getConfigValue,
  mergeHeuristicConfig,
  setConfigValue,
} from '../heuristicConfig';
import type {
  ExerciseHeuristicConfig,
  NumericTunable,
  TunableSpec,
} from '../types';
import type { DatasetEvaluation } from './types';

type EvaluationScoringInput = Pick<DatasetEvaluation, 'metrics'>;

export interface CandidateConfig {
  id: string;
  config: ExerciseHeuristicConfig;
}

export interface CandidateEvaluation {
  id: string;
  config: ExerciseHeuristicConfig;
  evaluation: EvaluationScoringInput;
  selectionSplit: 'validation' | 'train' | 'all';
}

export interface OptimizerSearchOptions {
  randomCandidates?: number;
  survivorCount?: number;
  refinementRounds?: number;
  seed?: number;
}

export interface CandidateValidationOptions {
  validateConfig?: (config: ExerciseHeuristicConfig) => string[];
}

export interface ApplyGateResult {
  shouldApply: boolean;
  reason: string;
}

const VALID_TUNABLE_KINDS = new Set<NumericTunable['kind']>(['fsm', 'feedback', 'scoring']);

export function validateTunableSpec(
  baseConfig: ExerciseHeuristicConfig,
  spec: TunableSpec,
): string[] {
  const issues: string[] = [];
  const seenPaths = new Set<string>();

  for (const tunable of spec.tunables) {
    if (!tunable.path || typeof tunable.path !== 'string') {
      issues.push('Tunable path must be a non-empty string.');
      continue;
    }
    if (seenPaths.has(tunable.path)) {
      issues.push(`Duplicate tunable path "${tunable.path}".`);
    }
    seenPaths.add(tunable.path);

    const baseValue = getConfigValue(baseConfig, tunable.path);
    const hasFiniteBaseValue = typeof baseValue === 'number' && Number.isFinite(baseValue);
    if (!hasFiniteBaseValue) {
      issues.push(`Tunable path "${tunable.path}" must point to a finite numeric default config value.`);
    }
    if (!Number.isFinite(tunable.min) || !Number.isFinite(tunable.max)) {
      issues.push(`Tunable "${tunable.path}" min and max must be finite.`);
    }
    if (tunable.max < tunable.min) {
      issues.push(`Tunable "${tunable.path}" max must be greater than or equal to min.`);
    }
    if (!Number.isFinite(tunable.step) || tunable.step <= 0) {
      issues.push(`Tunable "${tunable.path}" step must be greater than 0.`);
    }
    if (!VALID_TUNABLE_KINDS.has(tunable.kind)) {
      issues.push(`Tunable "${tunable.path}" kind must be fsm, feedback, or scoring.`);
    }
    if (
      hasFiniteBaseValue &&
      Number.isFinite(tunable.min) &&
      Number.isFinite(tunable.max) &&
      tunable.max >= tunable.min &&
      (baseValue < tunable.min || baseValue > tunable.max)
    ) {
      issues.push(
        `Tunable path "${tunable.path}" default value (${baseValue}) must be within ${tunable.min}..${tunable.max}.`,
      );
    }
  }

  return issues;
}

export function validateCandidateConfig(
  config: ExerciseHeuristicConfig,
  spec: TunableSpec,
  options?: CandidateValidationOptions,
): string[] {
  const issues: string[] = [];

  for (const tunable of spec.tunables) {
    const value = getConfigValue(config, tunable.path);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push(`Candidate value at "${tunable.path}" must be finite number.`);
      continue;
    }
    if (value < tunable.min || value > tunable.max) {
      issues.push(
        `Candidate value at "${tunable.path}" (${value}) is outside ${tunable.min}..${tunable.max}.`,
      );
    }
  }

  if (options?.validateConfig) {
    issues.push(...options.validateConfig(config));
  }

  return issues;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function sampleTunableValue(tunable: NumericTunable, random: () => number): number {
  const steps = Math.max(0, Math.floor((tunable.max - tunable.min) / tunable.step));
  const index = Math.floor(random() * (steps + 1));
  return clampTunableValue(tunable.min + index * tunable.step, tunable);
}

export function generateRandomCandidates(
  baseConfig: ExerciseHeuristicConfig,
  spec: TunableSpec,
  options?: OptimizerSearchOptions,
): CandidateConfig[] {
  const count = options?.randomCandidates ?? spec.search?.randomCandidates ?? 500;
  const random = createSeededRandom(options?.seed ?? spec.search?.seed ?? 1337);
  const candidates: CandidateConfig[] = [];

  for (let i = 0; i < count; i++) {
    let config = cloneConfig(baseConfig);
    for (const tunable of spec.tunables) {
      config = setConfigValue(config, tunable.path, sampleTunableValue(tunable, random));
    }
    candidates.push({ id: `random-${i + 1}`, config });
  }

  return candidates;
}

export function refineCandidate(
  candidate: CandidateConfig,
  spec: TunableSpec,
  round: number,
): CandidateConfig[] {
  const variants: CandidateConfig[] = [];
  for (const tunable of spec.tunables) {
    const current = getConfigValue(candidate.config, tunable.path);
    if (typeof current !== 'number' || !Number.isFinite(current)) continue;

    for (const direction of [-1, 1]) {
      const value = clampTunableValue(current + direction * tunable.step, tunable);
      if (value === current) continue;
      variants.push({
        id: `${candidate.id}-r${round}-${tunable.path}-${direction > 0 ? 'up' : 'down'}`,
        config: setConfigValue(candidate.config, tunable.path, value),
      });
    }
  }
  return variants;
}

export function scoreEvaluation(evaluation: EvaluationScoringInput): number {
  return (
    evaluation.metrics.repCountAccuracy * 10000 +
    evaluation.metrics.issueF1 * 100 -
    evaluation.metrics.cleanRepFalsePositiveRate +
    evaluation.metrics.scorableAccuracy * 10 +
    evaluation.metrics.viewAccuracy * 5
  );
}

export function compareEvaluations(a: EvaluationScoringInput, b: EvaluationScoringInput): number {
  return (
    a.metrics.repCountAccuracy - b.metrics.repCountAccuracy ||
    a.metrics.issueF1 - b.metrics.issueF1 ||
    a.metrics.scorableAccuracy - b.metrics.scorableAccuracy ||
    a.metrics.viewAccuracy - b.metrics.viewAccuracy ||
    b.metrics.cleanRepFalsePositiveRate - a.metrics.cleanRepFalsePositiveRate
  );
}

export function sortCandidateEvaluations<T extends { evaluation: EvaluationScoringInput }>(
  candidates: T[],
): T[] {
  return [...candidates].sort((a, b) => compareEvaluations(b.evaluation, a.evaluation));
}

export function topCandidates<T extends { evaluation: EvaluationScoringInput }>(
  candidates: T[],
  count: number,
): T[] {
  return sortCandidateEvaluations(candidates).slice(0, count);
}

export function shouldApplyWinningConfig(args: {
  baselineSelection: EvaluationScoringInput;
  winnerSelection: EvaluationScoringInput;
  baselineTest?: EvaluationScoringInput | null;
  winnerTest?: EvaluationScoringInput | null;
  spec: TunableSpec;
  selectionSplit?: CandidateEvaluation['selectionSplit'];
  requireValidationSplit?: boolean;
  requireTestSplit?: boolean;
}): ApplyGateResult {
  if (args.requireValidationSplit && args.selectionSplit !== 'validation') {
    return {
      shouldApply: false,
      reason: 'Rejected: auto-apply requires reviewed validation data for winner selection.',
    };
  }

  if (args.requireTestSplit && (!args.baselineTest || !args.winnerTest)) {
    return {
      shouldApply: false,
      reason: 'Rejected: auto-apply requires reviewed test data for regression checks.',
    };
  }

  const gates = args.spec.search?.applyGates ?? {};
  const minValidationImprovement = gates.minValidationImprovement ?? 0.001;
  const selectionDelta = scoreEvaluation(args.winnerSelection) - scoreEvaluation(args.baselineSelection);

  if (selectionDelta < minValidationImprovement) {
    return {
      shouldApply: false,
      reason: `Winner did not improve selection score enough (${selectionDelta.toFixed(4)} < ${minValidationImprovement}).`,
    };
  }

  if (args.baselineTest && args.winnerTest) {
    const maxRepRegression = gates.maxTestRepCountAccuracyRegression ?? 0;
    const repRegression =
      args.baselineTest.metrics.repCountAccuracy - args.winnerTest.metrics.repCountAccuracy;
    if (repRegression > maxRepRegression) {
      return {
        shouldApply: false,
        reason: `Rejected: test rep-count accuracy regressed by ${repRegression.toFixed(4)}.`,
      };
    }

    const maxCleanRegression = gates.maxTestCleanFalsePositiveRegression ?? 0.02;
    const cleanRegression =
      args.winnerTest.metrics.cleanRepFalsePositiveRate -
      args.baselineTest.metrics.cleanRepFalsePositiveRate;
    if (cleanRegression > maxCleanRegression) {
      return {
        shouldApply: false,
        reason: `Rejected: test clean false-positive rate regressed by ${cleanRegression.toFixed(4)}.`,
      };
    }

    const maxViewRegression = gates.maxTestViewAccuracyRegression ?? 0.05;
    const viewRegression =
      args.baselineTest.metrics.viewAccuracy - args.winnerTest.metrics.viewAccuracy;
    if (viewRegression > maxViewRegression) {
      return {
        shouldApply: false,
        reason: `Rejected: test view accuracy regressed by ${viewRegression.toFixed(4)}.`,
      };
    }

    const maxScorableRegression = gates.maxTestScorableAccuracyRegression ?? 0.02;
    const scorableRegression =
      args.baselineTest.metrics.scorableAccuracy - args.winnerTest.metrics.scorableAccuracy;
    if (scorableRegression > maxScorableRegression) {
      return {
        shouldApply: false,
        reason: `Rejected: test scorable accuracy regressed by ${scorableRegression.toFixed(4)}.`,
      };
    }
  }

  return { shouldApply: true, reason: 'Winner passed validation and test gates.' };
}

export function mergeCandidateWithBase(
  baseConfig: ExerciseHeuristicConfig,
  candidateConfig: ExerciseHeuristicConfig,
): ExerciseHeuristicConfig {
  return mergeHeuristicConfig(baseConfig, candidateConfig);
}
