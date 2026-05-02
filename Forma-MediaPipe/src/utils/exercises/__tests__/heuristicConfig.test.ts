import type { Keypoint } from '../../poseAnalysis';
import {
  createDefaultTunableSpec,
  getConfigValue,
  mergeHeuristicConfig,
  runWithConfigBindings,
  setConfigValue,
} from '../heuristicConfig';
import {
  evaluateCase,
  generateRandomCandidates,
  refineCandidate,
  shouldApplyWinningConfig,
  sortCandidateEvaluations,
  validateCandidateConfig,
  validateTunableSpec,
  type CandidateConfig,
} from '../dataset';
import { replayRecording } from '../replay';
import '../definitions/register';
import { ExerciseRegistry } from '../ExerciseRegistry';
import type {
  DatasetCase,
  DatasetEvaluation,
  ExerciseLabelFile,
} from '../dataset';
import type {
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  ExerciseState,
  TunableSpec,
} from '../types';

function summarizeCaseEvaluation(caseEvaluation: ReturnType<typeof evaluateCase>): DatasetEvaluation {
  const precisionDenominator = caseEvaluation.totals.truePositives + caseEvaluation.totals.falsePositives;
  const recallDenominator = caseEvaluation.totals.truePositives + caseEvaluation.totals.falseNegatives;
  const issuePrecision =
    precisionDenominator === 0 ? 1 : caseEvaluation.totals.truePositives / precisionDenominator;
  const issueRecall =
    recallDenominator === 0 ? 1 : caseEvaluation.totals.truePositives / recallDenominator;
  const issueF1 =
    issuePrecision + issueRecall === 0
      ? 0
      : (2 * issuePrecision * issueRecall) / (issuePrecision + issueRecall);

  return {
    cases: [caseEvaluation],
    totals: caseEvaluation.totals,
    metrics: {
      repCountAccuracy: caseEvaluation.repCountCorrect ? 1 : 0,
      issuePrecision,
      issueRecall,
      issueF1,
      cleanRepFalsePositiveRate:
        caseEvaluation.totals.cleanReps === 0
          ? 0
          : caseEvaluation.totals.cleanFalsePositives / caseEvaluation.totals.cleanReps,
    },
  };
}

function makeEvaluation(repCountAccuracy: number, issueF1: number, cleanRate: number): DatasetEvaluation {
  return {
    cases: [],
    totals: {
      cases: 1,
      expectedReps: 1,
      predictedReps: repCountAccuracy === 1 ? 1 : 0,
      repCountCorrect: repCountAccuracy === 1 ? 1 : 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      cleanReps: 1,
      cleanFalsePositives: cleanRate > 0 ? 1 : 0,
    },
    metrics: {
      repCountAccuracy,
      issuePrecision: issueF1,
      issueRecall: issueF1,
      issueF1,
      cleanRepFalsePositiveRate: cleanRate,
    },
  };
}

function makeSyntheticExercise(config: ExerciseHeuristicConfig): ExerciseDefinition {
  const threshold = Number(getConfigValue(config, 'thresholds.COMPLETE_AT'));
  return {
    name: 'Synthetic Threshold',
    requiredView: 'any',
    heuristicConfig: config,
    tunableSpec: syntheticSpec,
    createVariant: makeSyntheticExercise,
    createState: (): ExerciseState => ({
      repCount: 0,
      lastRepResult: null,
      feedback: null,
      feedbackTimestamp: null,
      debugInfo: {},
      _internal: { completed: false },
    }),
    update: (keypoints, state): ExerciseState => {
      const internal = state._internal as { completed: boolean };
      const x = keypoints[0]?.x ?? 0;
      if (internal.completed || x < threshold) return state;
      internal.completed = true;
      return {
        ...state,
        repCount: 1,
        lastRepResult: { repIndex: 1, score: 100, messages: [], issueIds: [] },
        _internal: internal,
      };
    },
    ttsConfig: { feedbackToIssue: {} },
    summaryConfig: {},
  };
}

const syntheticSpec: TunableSpec = {
  exerciseName: 'Synthetic Threshold',
  tunables: [{ path: 'thresholds.COMPLETE_AT', min: 0.4, max: 0.8, step: 0.1, kind: 'fsm' }],
  search: {
    randomCandidates: 20,
    survivorCount: 4,
    refinementRounds: 1,
    seed: 2,
  },
};

const syntheticLabel: ExerciseLabelFile = {
  schemaVersion: 1,
  exerciseName: 'Synthetic Threshold',
  sourceVideo: 'videos/synthetic.mp4',
  split: 'train',
  expectedReps: 1,
  reps: [{ index: 1, startMs: 0, endMs: 1000, issueIds: [] }],
};

const syntheticCase: DatasetCase = {
  label: syntheticLabel,
  recording: {
    exerciseName: 'Synthetic Threshold',
    metadata: {},
    frames: [
      { timestamp: 0, keypoints: [{ x: 0.2, y: 0, score: 1 } as Keypoint] },
      { timestamp: 500, keypoints: [{ x: 0.6, y: 0, score: 1 } as Keypoint] },
    ],
  },
};

function evaluateSyntheticCandidate(candidate: CandidateConfig): {
  id: string;
  config: ExerciseHeuristicConfig;
  evaluation: DatasetEvaluation;
} {
  const definition = makeSyntheticExercise(candidate.config);
  return {
    id: candidate.id,
    config: candidate.config,
    evaluation: summarizeCaseEvaluation(
      evaluateCase(syntheticCase, replayRecording(definition, syntheticCase.recording)),
    ),
  };
}

describe('heuristic config helpers', () => {
  it('merges nested config overrides without mutating the base config', () => {
    const base = {
      thresholds: { TOP_ENTER: 0.8, MIN_REP_TIME: 0.6 },
      formThresholds: { DEPTH_FAIL: 0.7 },
    };

    const merged = mergeHeuristicConfig(base, {
      thresholds: { TOP_ENTER: 0.75 },
    });

    expect(merged).toEqual({
      thresholds: { TOP_ENTER: 0.75, MIN_REP_TIME: 0.6 },
      formThresholds: { DEPTH_FAIL: 0.7 },
    });
    expect(base.thresholds.TOP_ENTER).toBe(0.8);
  });

  it('gets and sets dotted config paths immutably', () => {
    const base = { thresholds: { BOTTOM_ENTER: 0.58 } };
    const updated = setConfigValue(base, 'thresholds.BOTTOM_ENTER', 0.55);

    expect(getConfigValue(base, 'thresholds.BOTTOM_ENTER')).toBe(0.58);
    expect(getConfigValue(updated, 'thresholds.BOTTOM_ENTER')).toBe(0.55);
  });

  it('temporarily binds active config objects and restores them after execution', () => {
    const thresholds = { TOP_ENTER: 0.8 };
    const result = runWithConfigBindings(
      { thresholds: { TOP_ENTER: 0.72 } },
      [{ path: 'thresholds', target: thresholds }],
      () => thresholds.TOP_ENTER,
    );

    expect(result).toBe(0.72);
    expect(thresholds.TOP_ENTER).toBe(0.8);
  });

  it('builds bounded tunables from default threshold groups', () => {
    const spec = createDefaultTunableSpec('Demo', {
      thresholds: { TOP_ENTER: 0.8 },
      formThresholds: { TORSO_LEAN_WARN: 12 },
      penaltyConfigs: { SCORE: { min: 0, max: 100 } },
    });

    expect(spec.tunables.map((tunable) => tunable.path)).toEqual([
      'thresholds.TOP_ENTER',
      'formThresholds.TORSO_LEAN_WARN',
    ]);
    expect(spec.tunables[0]).toMatchObject({ min: 0.72, max: 0.88, step: 0.01 });
  });
});

describe('automatic heuristic optimiser helpers', () => {
  it('generates random candidates within declared safe ranges', () => {
    const candidates = generateRandomCandidates(
      { thresholds: { COMPLETE_AT: 0.7 } },
      syntheticSpec,
    );

    expect(candidates).toHaveLength(20);
    for (const candidate of candidates) {
      const value = getConfigValue(candidate.config, 'thresholds.COMPLETE_AT');
      expect(typeof value).toBe('number');
      expect(value as number).toBeGreaterThanOrEqual(0.4);
      expect(value as number).toBeLessThanOrEqual(0.8);
    }
  });

  it('coordinate refinement can recover a better threshold than baseline', () => {
    const baseline: CandidateConfig = {
      id: 'baseline',
      config: { thresholds: { COMPLETE_AT: 0.7 } },
    };
    const refined = refineCandidate(baseline, syntheticSpec, 1);
    const ranked = sortCandidateEvaluations(
      [baseline, ...refined].map(evaluateSyntheticCandidate),
    );

    expect(ranked[0].evaluation.metrics.repCountAccuracy).toBe(1);
    expect(getConfigValue(ranked[0].config, 'thresholds.COMPLETE_AT')).toBe(0.6);
    expect(evaluateSyntheticCandidate(baseline).evaluation.metrics.repCountAccuracy).toBe(0);
  });

  it('gates application on validation improvement and test regressions', () => {
    const spec: TunableSpec = {
      exerciseName: 'Demo',
      tunables: [],
      search: {
        applyGates: {
          minValidationImprovement: 0.001,
          maxTestRepCountAccuracyRegression: 0,
          maxTestCleanFalsePositiveRegression: 0.02,
        },
      },
    };

    expect(
      shouldApplyWinningConfig({
        baselineSelection: makeEvaluation(0, 1, 0),
        winnerSelection: makeEvaluation(1, 1, 0),
        baselineTest: makeEvaluation(1, 1, 0),
        winnerTest: makeEvaluation(1, 1, 0.01),
        spec,
      }).shouldApply,
    ).toBe(true);

    expect(
      shouldApplyWinningConfig({
        baselineSelection: makeEvaluation(0, 1, 0),
        winnerSelection: makeEvaluation(1, 1, 0),
        baselineTest: makeEvaluation(1, 1, 0),
        winnerTest: makeEvaluation(0, 1, 0),
        spec,
      }).shouldApply,
    ).toBe(false);
  });

  it('requires validation and test data when production apply gates are enabled', () => {
    expect(
      shouldApplyWinningConfig({
        baselineSelection: makeEvaluation(0, 1, 0),
        winnerSelection: makeEvaluation(1, 1, 0),
        spec: syntheticSpec,
        selectionSplit: 'train',
        requireValidationSplit: true,
        requireTestSplit: true,
      }),
    ).toMatchObject({
      shouldApply: false,
      reason: expect.stringContaining('validation'),
    });

    expect(
      shouldApplyWinningConfig({
        baselineSelection: makeEvaluation(0, 1, 0),
        winnerSelection: makeEvaluation(1, 1, 0),
        spec: syntheticSpec,
        selectionSplit: 'validation',
        requireValidationSplit: true,
        requireTestSplit: true,
      }),
    ).toMatchObject({
      shouldApply: false,
      reason: expect.stringContaining('test'),
    });
  });

  it('validates tunable specs and generated candidate configs before replay', () => {
    expect(validateTunableSpec({ thresholds: { COMPLETE_AT: 0.7 } }, syntheticSpec)).toEqual([]);
    expect(
      validateTunableSpec(
        { thresholds: { COMPLETE_AT: 0.7 } },
        {
          exerciseName: 'Bad Spec',
          tunables: [
            { path: 'thresholds.MISSING', min: 1, max: 0, step: 0, kind: 'fsm' },
          ],
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        'Tunable path "thresholds.MISSING" must point to a finite numeric default config value.',
        'Tunable "thresholds.MISSING" max must be greater than or equal to min.',
        'Tunable "thresholds.MISSING" step must be greater than 0.',
      ]),
    );

    expect(validateCandidateConfig({ thresholds: { COMPLETE_AT: 0.6 } }, syntheticSpec)).toEqual([]);
    expect(validateCandidateConfig({ thresholds: { COMPLETE_AT: 0.9 } }, syntheticSpec)).toEqual([
      'Candidate value at "thresholds.COMPLETE_AT" (0.9) is outside 0.4..0.8.',
    ]);
  });

  it('registered default config variants replay the same no-op result as defaults', () => {
    const definitions = ExerciseRegistry.list()
      .map((name) => ExerciseRegistry.get(name))
      .filter(
        (definition): definition is ExerciseDefinition =>
          Boolean(definition?.heuristicConfig && definition.createVariant),
      );

    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      const variant = definition.createVariant?.(definition.heuristicConfig ?? {});
      expect(variant).toBeDefined();
      const recording = {
        exerciseName: definition.name,
        metadata: { recordedAt: '2026-01-01T00:00:00.000Z' },
        frames: [
          { timestamp: 0, keypoints: [] },
          { timestamp: 500, keypoints: [] },
        ],
      };

      expect(replayRecording(variant!, recording)).toEqual(
        replayRecording(definition, recording),
      );
    }
  });
});
