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
import { cablePushdownDefinition } from '../definitions/cablePushdown';
import { cableRowDefinition } from '../definitions/cableRow';
import { barbellCurlDefinition } from '../definitions/barbellCurl';
import { legExtensionsDefinition } from '../definitions/legExtensions';
import { machineAbCrunchDefinition } from '../definitions/machineAbCrunch';
import { squatDefinition } from '../definitions/squat';
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
      viewAccuracy:
        caseEvaluation.totals.viewEvaluatedReps === 0
          ? 1
          : caseEvaluation.totals.viewCorrectReps / caseEvaluation.totals.viewEvaluatedReps,
      scorableAccuracy:
        caseEvaluation.totals.scorableEvaluatedReps === 0
          ? 1
          : caseEvaluation.totals.scorableCorrectReps / caseEvaluation.totals.scorableEvaluatedReps,
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
      viewEvaluatedReps: 0,
      viewCorrectReps: 0,
      scorableEvaluatedReps: 0,
      scorableCorrectReps: 0,
    },
    metrics: {
      repCountAccuracy,
      issuePrecision: issueF1,
      issueRecall: issueF1,
      issueF1,
      cleanRepFalsePositiveRate: cleanRate,
      viewAccuracy: 1,
      scorableAccuracy: 1,
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

  it('validates the default squat heuristic config', () => {
    expect(squatDefinition.validateHeuristicConfig?.(squatDefinition.heuristicConfig ?? {})).toEqual([]);
  });

  it('rejects invalid squat threshold ordering with clear messages', () => {
    const base = squatDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.BOTTOM_ENTER', 0.86);
    const invalidDepth = setConfigValue(base, 'formThresholds.THIGH_DEPTH_WARN', 30);
    const invalidTorso = setConfigValue(base, 'formThresholds.TORSO_LEAN_DELTA_WARN', 20);
    const invalidRom = setConfigValue(base, 'thresholds.MIN_PARTIAL_ROM', 0.2);

    expect(squatDefinition.validateHeuristicConfig?.(invalidFsm)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.BOTTOM_ENTER')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidDepth)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.THIGH_DEPTH_WARN')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidTorso)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.TORSO_LEAN_DELTA_WARN')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidRom)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.MIN_PARTIAL_ROM')]),
    );
  });

  it('rejects invalid squat heel support and score curves', () => {
    const base = squatDefinition.heuristicConfig ?? {};
    const invalidHeelSupport = setConfigValue(base, 'formThresholds.HEEL_LIFT_MIN_SUPPORT', 1.2);
    const invalidHeelEligibleSupport = setConfigValue(base, 'formThresholds.HEEL_LIFT_MIN_ELIGIBLE_SUPPORT', -0.1);
    const invalidScale = setConfigValue(base, 'scoreCurves.HEEL_LIFT.scale', 0);
    const invalidCap = setConfigValue(base, 'scoreCurves.THIGH_DEPTH.cap', -1);

    expect(squatDefinition.validateHeuristicConfig?.(invalidHeelSupport)).toEqual(
      expect.arrayContaining([expect.stringContaining('HEEL_LIFT_MIN_SUPPORT')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidHeelEligibleSupport)).toEqual(
      expect.arrayContaining([expect.stringContaining('HEEL_LIFT_MIN_ELIGIBLE_SUPPORT')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidScale)).toEqual(
      expect.arrayContaining([expect.stringContaining('scoreCurves.HEEL_LIFT.scale')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidCap)).toEqual(
      expect.arrayContaining([expect.stringContaining('scoreCurves.THIGH_DEPTH.cap')]),
    );
  });

  it('rejects invalid squat lockout delta and side-view quality thresholds', () => {
    const base = squatDefinition.heuristicConfig ?? {};
    const invalidLockoutDelta = setConfigValue(base, 'formThresholds.LOCKOUT_BASELINE_DELTA_FAIL', 0.2);
    const invalidSideOrdering = setConfigValue(base, 'formThresholds.SIDE_VIEW_WIDTH_WARN', 0.35);
    const invalidSideValue = setConfigValue(base, 'formThresholds.SIDE_VIEW_WIDTH_FAIL', 0);

    expect(squatDefinition.validateHeuristicConfig?.(invalidLockoutDelta)).toEqual(
      expect.arrayContaining([expect.stringContaining('LOCKOUT_BASELINE_DELTA_FAIL')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidSideOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('SIDE_VIEW_WIDTH_WARN')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidSideValue)).toEqual(
      expect.arrayContaining([expect.stringContaining('SIDE_VIEW_WIDTH_FAIL')]),
    );
  });

  it('rejects invalid squat multi-view and knee-tracking thresholds', () => {
    const base = squatDefinition.heuristicConfig ?? {};
    const invalidViewOrdering = setConfigValue(base, 'formThresholds.FRONT_VIEW_MAX', 70);
    const invalidViewSupport = setConfigValue(base, 'formThresholds.FRONT_VIEW_MIN_SUPPORT', 1.2);
    const invalidViewSamples = setConfigValue(base, 'formThresholds.VIEW_MIN_SAMPLES', 0.5);
    const invalidMetricConfidence = setConfigValue(base, 'formThresholds.METRIC_CONFIDENCE_MIN', 1.2);
    const invalidBaselineConfidence = setConfigValue(base, 'formThresholds.BASELINE_CONFIDENCE_MIN', -0.1);
    const invalidKneeTrackingConfidence = setConfigValue(base, 'formThresholds.KNEE_TRACKING_CONFIDENCE_MIN', 1.1);
    const invalidKneeOrdering = setConfigValue(base, 'formThresholds.KNEE_VALGUS_WARN', 0.2);
    const invalidKneeSupport = setConfigValue(base, 'formThresholds.KNEE_VALGUS_MIN_SUPPORT', -0.1);

    expect(squatDefinition.validateHeuristicConfig?.(invalidViewOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('FRONT_VIEW_MAX')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidViewSupport)).toEqual(
      expect.arrayContaining([expect.stringContaining('FRONT_VIEW_MIN_SUPPORT')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidViewSamples)).toEqual(
      expect.arrayContaining([expect.stringContaining('VIEW_MIN_SAMPLES')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidMetricConfidence)).toEqual(
      expect.arrayContaining([expect.stringContaining('METRIC_CONFIDENCE_MIN')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidBaselineConfidence)).toEqual(
      expect.arrayContaining([expect.stringContaining('BASELINE_CONFIDENCE_MIN')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidKneeTrackingConfidence)).toEqual(
      expect.arrayContaining([expect.stringContaining('KNEE_TRACKING_CONFIDENCE_MIN')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidKneeOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('KNEE_VALGUS_WARN')]),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidKneeSupport)).toEqual(
      expect.arrayContaining([expect.stringContaining('KNEE_VALGUS_MIN_SUPPORT')]),
    );
  });

  it('exposes squat knee-tracking diagnostics as optimizer tuning metadata', () => {
    expect(squatDefinition.tunableSpec?.diagnosticTuning).toEqual(expect.arrayContaining([
      expect.objectContaining({
        issueId: 'barbell-squat.knee_valgus',
        metricKey: 'kneeTrackingOffsetRatio',
        thresholdPath: 'formThresholds.KNEE_VALGUS_WARN',
      }),
    ]));
    expect(squatDefinition.tunableSpec?.tunables).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'formThresholds.VIEW_MIN_SAMPLES',
        step: 1,
      }),
      expect.objectContaining({ path: 'formThresholds.METRIC_CONFIDENCE_MIN' }),
      expect.objectContaining({ path: 'formThresholds.BASELINE_CONFIDENCE_MIN' }),
      expect.objectContaining({ path: 'formThresholds.KNEE_TRACKING_CONFIDENCE_MIN' }),
    ]));
  });

  it('validates the default cable-row heuristic config', () => {
    expect(cableRowDefinition.validateHeuristicConfig?.(cableRowDefinition.heuristicConfig ?? {})).toEqual([]);
  });

  it('rejects invalid cable-row thresholds and penalty configs', () => {
    const base = cableRowDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.CONTRACTED_ENTER', 0.7);
    const invalidRowTarget = setConfigValue(base, 'formThresholds.ROW_TARGET_HIGH_WARN', 0.6);
    const invalidTempo = setConfigValue(base, 'formThresholds.TEMPO_PULL_MIN', 0);
    const invalidPenalty = setConfigValue(base, 'penaltyConfigs.HIGH_ROW.scale', 0);

    expect(cableRowDefinition.validateHeuristicConfig?.(invalidFsm)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.CONTRACTED_ENTER')]),
    );
    expect(cableRowDefinition.validateHeuristicConfig?.(invalidRowTarget)).toEqual(
      expect.arrayContaining([expect.stringContaining('ROW_TARGET_HIGH_WARN')]),
    );
    expect(cableRowDefinition.validateHeuristicConfig?.(invalidTempo)).toEqual(
      expect.arrayContaining([expect.stringContaining('TEMPO_PULL_MIN')]),
    );
    expect(cableRowDefinition.validateHeuristicConfig?.(invalidPenalty)).toEqual(
      expect.arrayContaining([expect.stringContaining('penaltyConfigs.HIGH_ROW.scale')]),
    );
  });

  it('validates the default cable-pushdown heuristic config', () => {
    expect(cablePushdownDefinition.validateHeuristicConfig?.(cablePushdownDefinition.heuristicConfig ?? {})).toEqual([]);
  });

  it('rejects invalid cable-pushdown thresholds and penalty configs', () => {
    const base = cablePushdownDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.EXTENDED_EXIT', 0.99);
    const invalidMovement = setConfigValue(base, 'thresholds.RETURN_COMPLETE_BUFFER', 0.9);
    const invalidTempo = setConfigValue(base, 'formThresholds.TEMPO_RETURN_MIN', 0);
    const invalidLockoutGap = setConfigValue(base, 'formThresholds.LOCKOUT_GAP_TOLERANCE_MS', -1);
    const invalidPenalty = setConfigValue(base, 'penaltyConfigs.RETURN_SPIKE.scale', 0);

    expect(cablePushdownDefinition.validateHeuristicConfig?.(invalidFsm)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.EXTENDED_EXIT')]),
    );
    expect(cablePushdownDefinition.validateHeuristicConfig?.(invalidMovement)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.RETURN_COMPLETE_BUFFER')]),
    );
    expect(cablePushdownDefinition.validateHeuristicConfig?.(invalidTempo)).toEqual(
      expect.arrayContaining([expect.stringContaining('TEMPO_RETURN_MIN')]),
    );
    expect(cablePushdownDefinition.validateHeuristicConfig?.(invalidLockoutGap)).toEqual(
      expect.arrayContaining([expect.stringContaining('LOCKOUT_GAP_TOLERANCE_MS')]),
    );
    expect(cablePushdownDefinition.validateHeuristicConfig?.(invalidPenalty)).toEqual(
      expect.arrayContaining([expect.stringContaining('penaltyConfigs.RETURN_SPIKE.scale')]),
    );
  });

  it('validates the default barbell-curl heuristic config', () => {
    expect(barbellCurlDefinition.validateHeuristicConfig?.(barbellCurlDefinition.heuristicConfig ?? {})).toEqual([]);
  });

  it('rejects invalid barbell-curl thresholds, view support, and penalty configs', () => {
    const base = barbellCurlDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.FLEXED_EXIT', 0.5);
    const invalidParticipation = setConfigValue(base, 'thresholds.MIN_ARM_PARTICIPATION_ROM', 0.4);
    const invalidTempo = setConfigValue(base, 'formThresholds.TEMPO_UP_MIN', 0);
    const invalidSupport = setConfigValue(base, 'viewQualityThresholds.SIDE_MIN_SUPPORT', 1.2);
    const invalidSamples = setConfigValue(base, 'viewQualityThresholds.MIN_SAMPLES', 1.5);
    const invalidPenalty = setConfigValue(base, 'penaltyConfigs.ROM_FLEX.scale', 0);
    const invalidPenaltyGroup = setConfigValue(base, 'penaltyConfigs', null);
    const invalidViewGroup = setConfigValue(base, 'viewQualityThresholds', 'bad');

    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidFsm)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.FLEXED_EXIT')]),
    );
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidParticipation)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.MIN_PARTIAL_ROM')]),
    );
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidTempo)).toEqual(
      expect.arrayContaining([expect.stringContaining('TEMPO_UP_MIN')]),
    );
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidSupport)).toEqual(
      expect.arrayContaining([expect.stringContaining('SIDE_MIN_SUPPORT')]),
    );
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidSamples)).toEqual(
      expect.arrayContaining([expect.stringContaining('MIN_SAMPLES')]),
    );
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidPenalty)).toEqual(
      expect.arrayContaining([expect.stringContaining('penaltyConfigs.ROM_FLEX.scale')]),
    );
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidPenaltyGroup)).toEqual(
      expect.arrayContaining([expect.stringContaining('penaltyConfigs must be an object')]),
    );
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidViewGroup)).toEqual(
      expect.arrayContaining([expect.stringContaining('viewQualityThresholds must be an object')]),
    );
  });

  it('exposes barbell-curl scoring and view-quality tunables for optimization', () => {
    const tunablePaths = barbellCurlDefinition.tunableSpec?.tunables.map(tunable => tunable.path) ?? [];

    expect(tunablePaths).toEqual(expect.arrayContaining([
      'penaltyConfigs.ROM_FLEX.scale',
      'penaltyConfigs.ROM_EXTEND.scale',
      'penaltyConfigs.SHOULDER.scale',
      'penaltyConfigs.SHOULDER.deadzone',
      'penaltyConfigs.TORSO.scale',
      'penaltyConfigs.ASYMMETRY_MIN.scale',
      'penaltyConfigs.SYNC_DELTA.scale',
      'viewQualityThresholds.MIN_SAMPLES',
      'viewQualityThresholds.FRONT_MIN_SUPPORT',
      'viewQualityThresholds.SIDE_MIN_SUPPORT',
      'viewQualityThresholds.PRIMARY_SIDE_MIN_SUPPORT',
    ]));
  });

  it('exposes cable-pushdown scoring penalties as optimizer tunables', () => {
    const tunablePaths = cablePushdownDefinition.tunableSpec?.tunables.map(tunable => tunable.path) ?? [];

    expect(tunablePaths).toEqual(expect.arrayContaining([
      'penaltyConfigs.ELBOW_FORWARD.scale',
      'penaltyConfigs.TORSO_ROCK.deadzone',
      'penaltyConfigs.LOCKOUT_HOLD.scale',
      'penaltyConfigs.TEMPO_PUSH.deadzone',
      'penaltyConfigs.PUSH_SPIKE.deadzone',
      'penaltyConfigs.RETURN_SPIKE.scale',
    ]));
  });

  it('validates the default leg-extension heuristic config', () => {
    expect(legExtensionsDefinition.validateHeuristicConfig?.(legExtensionsDefinition.heuristicConfig ?? {})).toEqual([]);
  });

  it('rejects invalid leg-extension threshold ordering and support thresholds', () => {
    const base = legExtensionsDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.EXTENDED_EXIT', 0.73);
    const invalidPartial = setConfigValue(base, 'thresholds.MIN_PARTIAL_ROM', 0.2);
    const invalidKneeOrdering = setConfigValue(base, 'formThresholds.KNEE_EXTENSION_FAIL', 175);
    const invalidTempo = setConfigValue(base, 'formThresholds.TEMPO_EXTEND_MIN', 0);
    const invalidPenalty = setConfigValue(base, 'penaltyConfigs.TOP_HOLD.scale', 0);
    const invalidKneePartial = setConfigValue(base, 'thresholds.MIN_PARTIAL_KNEE_ROM', 90);
    const invalidLockoutMs = setConfigValue(base, 'thresholds.LOCKOUT_CONFIRM_MS', 0);
    const invalidReturnMs = setConfigValue(base, 'thresholds.RETURN_CONFIRM_MS', 700);
    const invalidBaselineSamples = setConfigValue(base, 'thresholds.BASELINE_MIN_SAMPLES', 20);
    const invalidSideOrdering = setConfigValue(base, 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', 0.7);
    const invalidSideSamples = setConfigValue(base, 'formThresholds.SIDE_VIEW_MIN_SAMPLES', 1.5);
    const invalidHoldBand = setConfigValue(base, 'formThresholds.TOP_HOLD_RATIO_BAND', 0);
    const invalidHoldVelocity = setConfigValue(base, 'formThresholds.TOP_HOLD_MAX_KNEE_VELOCITY', -1);

    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidFsm)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.EXTENDED_EXIT')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidPartial)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.MIN_PARTIAL_ROM')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidKneeOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('KNEE_EXTENSION_FAIL')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidTempo)).toEqual(
      expect.arrayContaining([expect.stringContaining('TEMPO_EXTEND_MIN')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidPenalty)).toEqual(
      expect.arrayContaining([expect.stringContaining('penaltyConfigs.TOP_HOLD.scale')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidKneePartial)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.MIN_PARTIAL_KNEE_ROM')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidLockoutMs)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.LOCKOUT_CONFIRM_MS')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidReturnMs)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.RETURN_CONFIRM_MS')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidBaselineSamples)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.BASELINE_MIN_SAMPLES')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidSideOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('SIDE_VIEW_MIN_CONFIDENCE_MIN')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidSideSamples)).toEqual(
      expect.arrayContaining([expect.stringContaining('SIDE_VIEW_MIN_SAMPLES')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidHoldBand)).toEqual(
      expect.arrayContaining([expect.stringContaining('TOP_HOLD_RATIO_BAND')]),
    );
    expect(legExtensionsDefinition.validateHeuristicConfig?.(invalidHoldVelocity)).toEqual(
      expect.arrayContaining([expect.stringContaining('TOP_HOLD_MAX_KNEE_VELOCITY')]),
    );
  });

  it('validates the default machine ab crunch heuristic config', () => {
    expect(machineAbCrunchDefinition.validateHeuristicConfig?.(machineAbCrunchDefinition.heuristicConfig ?? {})).toEqual([]);
  });

  it('rejects invalid machine ab crunch thresholds and penalty configs', () => {
    const base = machineAbCrunchDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.BOTTOM_ENTER', 113);
    const invalidSideOrdering = setConfigValue(base, 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', 0.6);
    const invalidTempo = setConfigValue(base, 'formThresholds.TEMPO_RETURN_MIN', 0);
    const invalidPenalty = setConfigValue(base, 'penaltyConfigs.ARM_PULL.scale', 0);

    expect(machineAbCrunchDefinition.validateHeuristicConfig?.(invalidFsm)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.BOTTOM_ENTER')]),
    );
    expect(machineAbCrunchDefinition.validateHeuristicConfig?.(invalidSideOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('SIDE_VIEW_MIN_CONFIDENCE_MIN')]),
    );
    expect(machineAbCrunchDefinition.validateHeuristicConfig?.(invalidTempo)).toEqual(
      expect.arrayContaining([expect.stringContaining('TEMPO_RETURN_MIN')]),
    );
    expect(machineAbCrunchDefinition.validateHeuristicConfig?.(invalidPenalty)).toEqual(
      expect.arrayContaining([expect.stringContaining('penaltyConfigs.ARM_PULL.scale')]),
    );
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

  it('registered diagnostic tuning entries point at declared tunable paths', () => {
    const definitions = ExerciseRegistry.list()
      .map((name) => ExerciseRegistry.get(name))
      .filter(
        (definition): definition is ExerciseDefinition =>
          Boolean(definition?.tunableSpec?.diagnosticTuning?.length),
      );

    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      const spec = definition.tunableSpec!;
      const tunablePaths = new Set(spec.tunables.map((tunable) => tunable.path));
      for (const entry of spec.diagnosticTuning ?? []) {
        expect(tunablePaths.has(entry.thresholdPath)).toBe(true);
      }
    }
  });
});
