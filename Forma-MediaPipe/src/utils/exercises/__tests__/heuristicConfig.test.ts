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
import { lateralRaiseDefinition } from '../definitions/lateralRaise';
import { machineAbCrunchDefinition } from '../definitions/machineAbCrunch';
import { pushupDefinition } from '../definitions/pushup';
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

function makeEvaluation(
  repCountAccuracy: number,
  issueF1: number,
  cleanRate: number,
  options: { viewAccuracy?: number; scorableAccuracy?: number } = {},
): DatasetEvaluation {
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
      viewAccuracy: options.viewAccuracy ?? 1,
      scorableAccuracy: options.scorableAccuracy ?? 1,
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

  it('rejects squat ratio thresholds outside zero to one', () => {
    const base = squatDefinition.heuristicConfig ?? {};
    const invalidHighFsm = setConfigValue(base, 'thresholds.DESCENT_CLOCK_START', 1.05);
    const invalidLowFsm = setConfigValue(base, 'thresholds.IDLE_STANDING_MIN', -0.01);
    const invalidHighForm = setConfigValue(base, 'formThresholds.LOCKOUT_FAIL', 1.05);
    const invalidLowForm = setConfigValue(base, 'formThresholds.ROM_MIN', -0.01);

    expect(squatDefinition.validateHeuristicConfig?.(invalidHighFsm)).toEqual(
      expect.arrayContaining(['Squat config "thresholds.DESCENT_CLOCK_START" must be between 0 and 1.']),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidLowFsm)).toEqual(
      expect.arrayContaining(['Squat config "thresholds.IDLE_STANDING_MIN" must be between 0 and 1.']),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidHighForm)).toEqual(
      expect.arrayContaining(['Squat config "formThresholds.LOCKOUT_FAIL" must be between 0 and 1.']),
    );
    expect(squatDefinition.validateHeuristicConfig?.(invalidLowForm)).toEqual(
      expect.arrayContaining(['Squat config "formThresholds.ROM_MIN" must be between 0 and 1.']),
    );
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

  it('keeps inactive squat knee-valgus/front-view paths out of optimizer metadata', () => {
    const diagnosticEntries = squatDefinition.tunableSpec?.diagnosticTuning ?? [];
    const tunablePaths = (squatDefinition.tunableSpec?.tunables ?? []).map((tunable) => tunable.path);

    expect(diagnosticEntries.some((entry) => entry.issueId === 'barbell-squat.knee_valgus')).toBe(false);
    expect(tunablePaths.some((path) =>
      path.includes('KNEE_VALGUS') ||
      path.includes('KNEE_TRACKING') ||
      path.includes('FRONT_VIEW') ||
      path.includes('OBLIQUE_VIEW')
    )).toBe(false);
    expect(squatDefinition.tunableSpec?.tunables).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'formThresholds.VIEW_MIN_SAMPLES',
        step: 1,
      }),
      expect.objectContaining({ path: 'formThresholds.METRIC_CONFIDENCE_MIN' }),
      expect.objectContaining({ path: 'formThresholds.BASELINE_CONFIDENCE_MIN' }),
    ]));
  });

  it('validates the default cable-row heuristic config', () => {
    expect(cableRowDefinition.validateHeuristicConfig?.(cableRowDefinition.heuristicConfig ?? {})).toEqual([]);
    expect((cableRowDefinition.tunableSpec?.tunables ?? []).map((tunable) => tunable.path)).toEqual(
      expect.arrayContaining([
        'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
        'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
      ]),
    );
  });

  it('rejects invalid cable-row thresholds and penalty configs', () => {
    const base = cableRowDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.CONTRACTED_ENTER', 0.7);
    const invalidRowTarget = setConfigValue(base, 'formThresholds.ROW_TARGET_HIGH_WARN', 0.6);
    const invalidTempo = setConfigValue(base, 'formThresholds.TEMPO_PULL_MIN', 0);
    const invalidPenalty = setConfigValue(base, 'penaltyConfigs.HIGH_ROW.scale', 0);
    const invalidSideViewRange = setConfigValue(base, 'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN', 1.2);
    const invalidSideViewOrdering = setConfigValue(base, 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', 0.6);
    const invalidDepthBelowContracted = setConfigValue(base, 'formThresholds.PULL_DEPTH_FAIL', 0.5);
    const invalidDepthAbovePulling = setConfigValue(base, 'formThresholds.PULL_DEPTH_FAIL', 0.95);
    const invalidExtensionBelowRest = setConfigValue(base, 'formThresholds.EXTENSION_FAIL', 0.85);

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
    expect(cableRowDefinition.validateHeuristicConfig?.(invalidSideViewRange)).toEqual(
      expect.arrayContaining([expect.stringContaining('SIDE_VIEW_AVG_CONFIDENCE_MIN')]),
    );
    expect(cableRowDefinition.validateHeuristicConfig?.(invalidSideViewOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('SIDE_VIEW_MIN_CONFIDENCE_MIN')]),
    );
    expect(cableRowDefinition.validateHeuristicConfig?.(invalidDepthBelowContracted)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.CONTRACTED_ENTER')]),
    );
    expect(cableRowDefinition.validateHeuristicConfig?.(invalidDepthAbovePulling)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.PULLING_ENTER')]),
    );
    expect(cableRowDefinition.validateHeuristicConfig?.(invalidExtensionBelowRest)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.REST_REENTER')]),
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

  it('validates the default push-up heuristic config', () => {
    expect(pushupDefinition.validateHeuristicConfig?.(pushupDefinition.heuristicConfig ?? {})).toEqual([]);
  });

  it('rejects invalid push-up threshold ordering and bounds', () => {
    const base = pushupDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.BOTTOM_EXIT', 0.95);
    const invalidDescendingIdleOrder = setConfigValue(base, 'thresholds.DESCENDING_ENTER', 0.92);
    const invalidIdlePlankOrder = setConfigValue(base, 'thresholds.IDLE_ARMS_EXTENDED', 0.94);
    const invalidPlankPartialOrder = setConfigValue(base, 'thresholds.PARTIAL_REP_RESET', 0.92);
    const invalidPartialLockoutOrder = setConfigValue(base, 'formThresholds.LOCKOUT_FAIL', 0.93);
    const invalidRatio = setConfigValue(base, 'thresholds.MIN_PARTIAL_ROM', -0.01);
    const invalidDepthCountOrder = setConfigValue(base, 'thresholds.BOTTOM_ENTER', 0.72);
    const invalidBodyOrdering = setConfigValue(base, 'thresholds.PLANK_BODY_MIN', 200);
    const invalidTorsoOrdering = setConfigValue(base, 'thresholds.TORSO_INCLINE_MIN', 120);
    const invalidHipDevWarnFail = setConfigValue(base, 'formThresholds.HIP_DEV_PIKE_WARN', 0.2);
    const invalidTempo = setConfigValue(base, 'formThresholds.TEMPO_ECCENTRIC_MIN', 0);
    const invalidFrames = setConfigValue(base, 'thresholds.MIN_REP_FRAMES', 1.5);
    const invalidShoulderStackOrdering = setConfigValue(base, 'thresholds.SHOULDER_WRIST_SETUP_FAIL', 0.1);

    expect(pushupDefinition.validateHeuristicConfig?.(invalidFsm)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.BOTTOM_EXIT')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidDescendingIdleOrder)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.DESCENDING_ENTER')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidIdlePlankOrder)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.IDLE_ARMS_EXTENDED')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidPlankPartialOrder)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.PARTIAL_REP_RESET')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidPartialLockoutOrder)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.LOCKOUT_FAIL')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidRatio)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.MIN_PARTIAL_ROM')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidDepthCountOrder)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.BOTTOM_ENTER')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidBodyOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.PLANK_BODY_MIN')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidTorsoOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.TORSO_INCLINE_MIN')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidHipDevWarnFail)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.HIP_DEV_PIKE_WARN')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidTempo)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.TEMPO_ECCENTRIC_MIN')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidFrames)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.MIN_REP_FRAMES')]),
    );
    expect(pushupDefinition.validateHeuristicConfig?.(invalidShoulderStackOrdering)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.SHOULDER_WRIST_WARN')]),
    );
  });

  it('keeps active push-up tunable defaults inside declared ranges', () => {
    expect(validateTunableSpec(
      pushupDefinition.heuristicConfig ?? {},
      pushupDefinition.tunableSpec!,
    )).toEqual([]);
  });

  it('validates the default lateral-raise heuristic config', () => {
    expect(lateralRaiseDefinition.validateHeuristicConfig?.(lateralRaiseDefinition.heuristicConfig ?? {})).toEqual([]);
  });

  it('keeps active lateral-raise tunable defaults valid without sample-count tuning', () => {
    const spec = lateralRaiseDefinition.tunableSpec!;
    const tunablePaths = spec.tunables.map(tunable => tunable.path);

    expect(validateTunableSpec(lateralRaiseDefinition.heuristicConfig ?? {}, spec)).toEqual([]);
    expect(tunablePaths).not.toContain('formThresholds.MIN_FORM_SAMPLES');
  });

  it('rejects invalid lateral-raise threshold ordering, samples, and penalty configs', () => {
    const base = lateralRaiseDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.TOP_EXIT', 0.9);
    const invalidPartial = setConfigValue(base, 'thresholds.MIN_PARTIAL_HEIGHT_RATIO', 0.2);
    const invalidRomOrder = setConfigValue(base, 'formThresholds.ROM_MIN', 1.2);
    const invalidTempo = setConfigValue(base, 'formThresholds.TEMPO_RAISE_MIN', 0);
    const invalidSamples = setConfigValue(base, 'formThresholds.MIN_FORM_SAMPLES', 1.5);
    const invalidPenalty = setConfigValue(base, 'penaltyConfigs.ROM.cap', -1);

    expect(lateralRaiseDefinition.validateHeuristicConfig?.(invalidFsm)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.TOP_EXIT')]),
    );
    expect(lateralRaiseDefinition.validateHeuristicConfig?.(invalidPartial)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.MIN_PARTIAL_HEIGHT_RATIO')]),
    );
    expect(lateralRaiseDefinition.validateHeuristicConfig?.(invalidRomOrder)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.ROM_MIN')]),
    );
    expect(lateralRaiseDefinition.validateHeuristicConfig?.(invalidTempo)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.TEMPO_RAISE_MIN')]),
    );
    expect(lateralRaiseDefinition.validateHeuristicConfig?.(invalidSamples)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.MIN_FORM_SAMPLES')]),
    );
    expect(lateralRaiseDefinition.validateHeuristicConfig?.(invalidPenalty)).toEqual(
      expect.arrayContaining([expect.stringContaining('penaltyConfigs.ROM.cap')]),
    );
  });

  it('keeps lateral-raise optimizer metadata safe for aggregated torso labels', () => {
    const spec = lateralRaiseDefinition.tunableSpec!;
    const tunablePaths = new Set(spec.tunables.map(tunable => tunable.path));

    expect(spec.diagnosticTuning).toEqual(expect.arrayContaining([
      expect.objectContaining({
        issueId: 'standing-dumbbell-lateral-raises.torso_warn',
        metricKey: 'torsoLean',
        thresholdPath: 'formThresholds.TORSO_LEAN_WARN',
      }),
    ]));
    expect(spec.diagnosticTuning).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        issueId: 'standing-dumbbell-lateral-raises.torso_warn',
        metricKey: 'sagittalTorsoSway',
        thresholdPath: 'formThresholds.SAGITTAL_SWAY_WARN',
      }),
    ]));
    expect(spec.diagnosticTuning).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        issueId: 'standing-dumbbell-lateral-raises.torso_warn',
        metricKey: 'hipSwayRatio',
        thresholdPath: 'formThresholds.HIP_SWAY_WARN',
      }),
    ]));
    expect(tunablePaths).not.toContain('formThresholds.SAGITTAL_SWAY_WARN');
    expect(tunablePaths).not.toContain('formThresholds.HIP_SWAY_WARN');
    expect(spec.tunables.find(tunable => tunable.path === 'formThresholds.TORSO_LEAN_WARN')).toMatchObject({
      min: 1,
      max: 8,
      step: 0.25,
    });
    expect(spec.tunables.find(tunable => tunable.path === 'formThresholds.TEMPO_RAISE_MIN')).toMatchObject({
      min: 0.15,
      max: 0.45,
      step: 0.05,
    });
    expect(spec.tunables.find(tunable => tunable.path === 'formThresholds.TEMPO_LOWER_MIN')).toMatchObject({
      min: 0.20,
      max: 0.55,
      step: 0.05,
    });
  });

  it('validates the default barbell-curl heuristic config', () => {
    expect(barbellCurlDefinition.validateHeuristicConfig?.(barbellCurlDefinition.heuristicConfig ?? {})).toEqual([]);
  });

  it('rejects invalid barbell-curl thresholds, view support, and penalty configs', () => {
    const base = barbellCurlDefinition.heuristicConfig ?? {};
    const invalidFsm = setConfigValue(base, 'thresholds.FLEXED_EXIT', 0.5);
    const invalidParticipation = setConfigValue(base, 'thresholds.MIN_ARM_PARTICIPATION_ROM', 0.4);
    const invalidTempo = setConfigValue(base, 'formThresholds.TEMPO_UP_MIN', 0);
    const invalidFlexEndpoint = setConfigValue(base, 'formThresholds.FLEX_RATIO_WARN', 0.5);
    const invalidExtendEndpoint = setConfigValue(base, 'formThresholds.EXTEND_RATIO_WARN', 0.8);
    const invalidExtensionReadiness = setConfigValue(base, 'thresholds.EXTENDED_EXIT', 0.95);
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
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidFlexEndpoint)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.FLEX_RATIO_WARN')]),
    );
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidExtendEndpoint)).toEqual(
      expect.arrayContaining([expect.stringContaining('formThresholds.EXTEND_RATIO_WARN')]),
    );
    expect(barbellCurlDefinition.validateHeuristicConfig?.(invalidExtensionReadiness)).toEqual(
      expect.arrayContaining([expect.stringContaining('thresholds.EXTENDED_EXIT')]),
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

  it('exposes barbell-curl threshold and view-quality tunables without score-penalty tunables', () => {
    const tunablePaths = barbellCurlDefinition.tunableSpec?.tunables.map(tunable => tunable.path) ?? [];

    expect(tunablePaths).toEqual(expect.arrayContaining([
      'thresholds.EXTENDED_ENTER',
      'thresholds.FLEXED_ENTER',
      'formThresholds.FLEX_RATIO_WARN',
      'formThresholds.EXTEND_RATIO_WARN',
      'viewQualityThresholds.MIN_SAMPLES',
      'viewQualityThresholds.FRONT_MIN_SUPPORT',
      'viewQualityThresholds.SIDE_MIN_SUPPORT',
      'viewQualityThresholds.PRIMARY_SIDE_MIN_SUPPORT',
    ]));
    expect(tunablePaths.some(path => path.startsWith('penaltyConfigs.'))).toBe(false);
    expect(tunablePaths.some(path => path.includes('WRIST'))).toBe(false);
  });

  it('keeps active barbell-curl tunable defaults inside declared ranges', () => {
    expect(validateTunableSpec(
      barbellCurlDefinition.heuristicConfig ?? {},
      barbellCurlDefinition.tunableSpec!,
    )).toEqual([]);
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

  it('uses scorable and view accuracy when ranking otherwise equivalent candidates', () => {
    const ranked = sortCandidateEvaluations([
      {
        id: 'lower-quality',
        config: {},
        evaluation: makeEvaluation(1, 0.8, 0, { viewAccuracy: 0.5, scorableAccuracy: 0.5 }),
      },
      {
        id: 'higher-quality',
        config: {},
        evaluation: makeEvaluation(1, 0.8, 0, { viewAccuracy: 1, scorableAccuracy: 1 }),
      },
    ]);

    expect(ranked[0].id).toBe('higher-quality');
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

    expect(
      shouldApplyWinningConfig({
        baselineSelection: makeEvaluation(0, 1, 0),
        winnerSelection: makeEvaluation(1, 1, 0),
        baselineTest: makeEvaluation(1, 1, 0, { viewAccuracy: 1, scorableAccuracy: 1 }),
        winnerTest: makeEvaluation(1, 1, 0, { viewAccuracy: 0.9, scorableAccuracy: 1 }),
        spec,
      }).shouldApply,
    ).toBe(false);

    expect(
      shouldApplyWinningConfig({
        baselineSelection: makeEvaluation(0, 1, 0),
        winnerSelection: makeEvaluation(1, 1, 0),
        baselineTest: makeEvaluation(1, 1, 0, { viewAccuracy: 1, scorableAccuracy: 1 }),
        winnerTest: makeEvaluation(1, 1, 0, { viewAccuracy: 1, scorableAccuracy: 0.9 }),
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
    expect(validateTunableSpec({ thresholds: { COMPLETE_AT: 0.9 } }, syntheticSpec)).toEqual([
      'Tunable path "thresholds.COMPLETE_AT" default value (0.9) must be within 0.4..0.8.',
    ]);
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
