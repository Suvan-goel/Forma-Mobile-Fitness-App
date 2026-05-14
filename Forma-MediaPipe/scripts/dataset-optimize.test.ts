import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Keypoint } from '../src/utils/poseAnalysis';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import { evaluateCase } from '../src/utils/exercises/dataset';
import type {
  DiagnosticDirection,
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  ExerciseState,
  RepDiagnostics,
  TunableSpec,
} from '../src/utils/exercises/types';
import type { DatasetCase, ExerciseLabelFile } from '../src/utils/exercises/dataset';
import { getConfigValue } from '../src/utils/exercises/heuristicConfig';
import { replayRecording } from '../src/utils/exercises/replay';
import {
  DEFAULT_MIN_SPLIT_CASES,
  evaluateCasesCompact,
  evaluateCasesDetailed,
  minimumSplitGate,
  optimizeExercise,
  parseOptimizerCommandOptions,
  runDatasetOptimize,
  searchExercise,
} from './dataset-optimize';
import { discoverReviewedDatasetExercises, formatEvaluationSummary } from './dataset-common';

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const syntheticSpec: TunableSpec = {
  exerciseName: 'Scaling Synthetic Threshold',
  tunables: [{ path: 'thresholds.COMPLETE_AT', min: 0.4, max: 0.8, step: 0.1, kind: 'fsm' }],
  search: {
    randomCandidates: 4,
    survivorCount: 2,
    refinementRounds: 0,
    seed: 3,
  },
};

const diagnosticSyntheticIssueId = 'diagnostic-synthetic.too_high';

const diagnosticSyntheticSpec: TunableSpec = {
  exerciseName: 'Diagnostic Synthetic Threshold',
  tunables: [
    { path: 'thresholds.COMPLETE_AT', min: 0.4, max: 0.8, step: 0.1, kind: 'fsm' },
    { path: 'formThresholds.WARN_AT', min: 0.4, max: 1, step: 0.05, kind: 'feedback' },
  ],
  diagnosticTuning: [
    {
      issueId: diagnosticSyntheticIssueId,
      metricKey: 'peakX',
      thresholdPath: 'formThresholds.WARN_AT',
      direction: 'above' satisfies DiagnosticDirection,
      minPositiveCases: 1,
      minNegativeCases: 1,
    },
  ],
  search: {
    randomCandidates: 0,
    survivorCount: 4,
    refinementRounds: 0,
    seed: 7,
  },
};

function makeSyntheticExercise(
  name: string,
  config: ExerciseHeuristicConfig,
  options: {
    feedbackMessages?: string[];
    qualityProfile?: ExerciseDefinition['qualityProfile'];
  } = {},
): ExerciseDefinition {
  const threshold = Number(getConfigValue(config, 'thresholds.COMPLETE_AT'));
  return {
    name,
    requiredView: 'any',
    qualityProfile: options.qualityProfile,
    heuristicConfig: config,
    tunableSpec: { ...syntheticSpec, exerciseName: name },
    tunedConfigPath: `src/utils/exercises/definitions/tuned/${name}.json`,
    createVariant: (variantConfig) => makeSyntheticExercise(name, variantConfig, options),
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
        lastRepResult: { repIndex: 1, score: 100, messages: options.feedbackMessages ?? [] },
        _internal: internal,
      };
    },
    ttsConfig: {
      feedbackToIssue: Object.fromEntries(
        (options.feedbackMessages ?? []).map((message) => [message, 'synthetic_issue']),
      ),
    },
    summaryConfig: {},
  };
}

function makeDiagnosticSyntheticExercise(
  name: string,
  config: ExerciseHeuristicConfig,
  options: {
    cueMetricKeys?: string[];
    cueThresholdPath?: string | string[];
  } = {},
): ExerciseDefinition {
  const completeAt = Number(getConfigValue(config, 'thresholds.COMPLETE_AT'));
  const warnAt = Number(getConfigValue(config, 'formThresholds.WARN_AT'));
  return {
    name,
    requiredView: 'any',
    qualityProfile: {
      exerciseName: name,
      requiredView: 'any',
      requiredJoints: ['demo'],
      importantJoints: [],
      windowSize: 1,
    },
    heuristicConfig: config,
    tunableSpec: { ...diagnosticSyntheticSpec, exerciseName: name },
    tunedConfigPath: `src/utils/exercises/definitions/tuned/${name}.json`,
    createVariant: (variantConfig) => makeDiagnosticSyntheticExercise(name, variantConfig, options),
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
      if (internal.completed || x < completeAt) return state;
      const triggered = x >= warnAt;
      const diagnostics: RepDiagnostics = {
        exerciseName: name,
        repIndex: 1,
        view: 'unknown',
        selectedSide: 'unknown',
        scorable: true,
        metrics: {
          peakX: {
            key: 'peakX',
            value: x,
            unit: 'ratio',
            eligible: true,
            confidence: keypoints[0]?.score,
            sampleCount: 1,
          },
        },
        cues: {
          [diagnosticSyntheticIssueId]: {
            issueId: diagnosticSyntheticIssueId,
            metricKeys: options.cueMetricKeys ?? ['peakX'],
            triggered,
            eligible: true,
            direction: 'above',
            thresholdPath: options.cueThresholdPath ?? 'formThresholds.WARN_AT',
            thresholdValue: warnAt,
            margin: x - warnAt,
            support: 1,
          },
        },
      };
      internal.completed = true;
      return {
        ...state,
        repCount: 1,
        lastRepResult: {
          repIndex: 1,
          score: triggered ? 70 : 100,
          messages: triggered ? ['Synthetic diagnostic warning'] : [],
          issueIds: triggered ? [diagnosticSyntheticIssueId] : [],
          diagnostics,
        },
        _internal: internal,
      };
    },
    ttsConfig: {
      feedbackToIssue: {
        'Synthetic diagnostic warning': diagnosticSyntheticIssueId,
      },
    },
    summaryConfig: {},
  };
}

function syntheticCase(
  exerciseName: string,
  split: ExerciseLabelFile['split'],
  score = 1,
): DatasetCase {
  return {
    label: {
      schemaVersion: 1,
      exerciseName,
      sourceVideo: `videos/${exerciseName}/${split}.mp4`,
      split,
      reviewStatus: 'reviewed',
      expectedReps: 1,
      reps: [{ index: 1, startMs: 0, endMs: 1000, issueIds: [] }],
    },
    recording: {
      exerciseName,
      metadata: {},
      frames: [
        { timestamp: 0, keypoints: [{ name: 'demo', x: 0.2, y: 0, score } as Keypoint] },
        { timestamp: 500, keypoints: [{ name: 'demo', x: 0.6, y: 0, score } as Keypoint] },
      ],
    },
  };
}

function diagnosticSyntheticCase(
  exerciseName: string,
  peakX: number,
  issueIds: string[],
): DatasetCase {
  return {
    label: {
      schemaVersion: 1,
      exerciseName,
      sourceVideo: `videos/${exerciseName}/${peakX}.mp4`,
      split: 'train',
      reviewStatus: 'reviewed',
      expectedReps: 1,
      reps: [{ index: 1, startMs: 0, endMs: 1000, issueIds }],
    },
    recording: {
      exerciseName,
      metadata: {},
      frames: [
        { timestamp: 0, keypoints: [{ name: 'demo', x: 0.2, y: 0, score: 1 } as Keypoint] },
        { timestamp: 500, keypoints: [{ name: 'demo', x: peakX, y: 0, score: 1 } as Keypoint] },
      ],
    },
  };
}

describe('dataset optimiser scaling helpers', () => {
  it('parses standalone CLI flags for search, reports, case details, and split gates', () => {
    const options = parseOptimizerCommandOptions([
      '--exercise',
      'Barbell Squat',
      '--dataset-root',
      '/tmp/dataset',
      '--dry-run',
      '--include-case-details',
      '--silent',
      '--report',
      '/tmp/report.json',
      '--random-candidates',
      '12',
      '--refinement-rounds',
      '3',
      '--survivors',
      '4',
      '--seed',
      '99',
      '--min-train-cases',
      '30',
      '--min-validation-cases',
      '8',
      '--min-test-cases',
      '7',
    ]);

    expect(options).toMatchObject({
      exerciseFilter: 'Barbell Squat',
      datasetRoot: '/tmp/dataset',
      dryRun: true,
      includeCaseDetails: true,
      includeDiagnostics: true,
      selectionMode: 'diagnostic',
      apply: false,
      silent: true,
      reportPath: '/tmp/report.json',
      search: {
        randomCandidates: 12,
        refinementRounds: 3,
        survivorCount: 4,
        seed: 99,
      },
      minCases: { train: 30, validation: 8, test: 7 },
    });
  });

  it('parses explicit apply and diagnostic report flags', () => {
    expect(parseOptimizerCommandOptions(['--apply', '--selection-mode', 'current', '--no-diagnostics'])).toMatchObject({
      dryRun: false,
      apply: true,
      selectionMode: 'current',
      includeDiagnostics: false,
    });
    expect(parseOptimizerCommandOptions(['--apply', '--dry-run'])).toMatchObject({
      dryRun: true,
      apply: false,
    });
  });

  it('compact evaluation matches detailed evaluation totals and metrics', () => {
    const definition = makeSyntheticExercise('Scaling Synthetic Compact', {
      thresholds: { COMPLETE_AT: 0.5 },
    });
    const cases = [syntheticCase(definition.name, 'train')];
    const compact = evaluateCasesCompact(definition, cases);
    const detailed = evaluateCasesDetailed(definition, cases);

    expect(compact).toEqual({
      totals: detailed?.totals,
      metrics: detailed?.metrics,
      qualityCoverage: detailed?.qualityCoverage,
      diagnosticSummary: detailed?.diagnosticSummary,
    });
  });

  it('prints score metrics only when reviewed score ranges exist', () => {
    const definition = makeSyntheticExercise('Scaling Synthetic Score Summary', {
      thresholds: { COMPLETE_AT: 0.5 },
    });
    const noScoreEvaluation = evaluateCasesCompact(definition, [syntheticCase(definition.name, 'train')]);
    expect(noScoreEvaluation).not.toBeNull();
    expect(formatEvaluationSummary({ cases: [], ...noScoreEvaluation! })).not.toContain('Score in expected range');

    const scoreCase = syntheticCase(definition.name, 'train');
    scoreCase.label.reps[0].expectedScoreRange = [90, 100];
    const scoreEvaluation = evaluateCasesCompact(definition, [scoreCase]);
    expect(scoreEvaluation).not.toBeNull();
    expect(formatEvaluationSummary({ cases: [], ...scoreEvaluation! })).toContain('Score in expected range');
  });

  it('evaluates optimizer cases with confidence gating enabled by default', () => {
    const feedbackMessage = 'Synthetic form warning';
    const definition = makeSyntheticExercise(
      'Scaling Synthetic Gated',
      { thresholds: { COMPLETE_AT: 0.5 } },
      {
        feedbackMessages: [feedbackMessage],
        qualityProfile: {
          exerciseName: 'Scaling Synthetic Gated',
          requiredView: 'any',
          requiredJoints: ['demo'],
          importantJoints: [],
          windowSize: 3,
        },
      },
    );
    const cleanLowConfidenceCase = syntheticCase(definition.name, 'train', 0);

    const rawEvaluation = evaluateCase(
      cleanLowConfidenceCase,
      replayRecording(definition, cleanLowConfidenceCase.recording),
    );
    const optimizerEvaluation = evaluateCasesCompact(definition, [cleanLowConfidenceCase]);

    expect(rawEvaluation.totals.falsePositives).toBe(1);
    expect(optimizerEvaluation?.totals.falsePositives).toBe(0);
    expect(optimizerEvaluation?.metrics.cleanRepFalsePositiveRate).toBe(0);
  });

  it('candidate search keeps compact summaries without per-case arrays', () => {
    const definition = makeSyntheticExercise('Scaling Synthetic Candidate', {
      thresholds: { COMPLETE_AT: 0.7 },
    });
    const result = searchExercise(definition, [syntheticCase(definition.name, 'train')], {
      randomCandidates: 2,
      refinementRounds: 0,
      survivorCount: 2,
      seed: 1,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].evaluation).not.toHaveProperty('cases');
    expect(result.candidates[0].evaluation).toHaveProperty('totals');
    expect(result.candidates[0].evaluation).toHaveProperty('metrics');
  });

  it('does not vary score-only tunables during issue-optimizer search', () => {
    const definition = makeSyntheticExercise('Scoring Tunable Synthetic Candidate', {
      thresholds: { COMPLETE_AT: 0.7 },
      penaltyConfigs: { SCORE_ONLY: { cap: 5 } },
    });
    definition.tunableSpec = {
      ...syntheticSpec,
      exerciseName: definition.name,
      tunables: [
        ...syntheticSpec.tunables,
        { path: 'penaltyConfigs.SCORE_ONLY.cap', min: 0, max: 10, step: 1, kind: 'scoring' },
      ],
    };

    const result = searchExercise(definition, [syntheticCase(definition.name, 'train')], {
      randomCandidates: 8,
      refinementRounds: 1,
      survivorCount: 4,
      seed: 1,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(getConfigValue(candidate.config, 'penaltyConfigs.SCORE_ONLY.cap')).toBe(5);
    }
  });

  it('allows score-only tunables during search when reviewed score ranges exist', () => {
    const definition = makeSyntheticExercise('Scoring Range Tunable Synthetic Candidate', {
      thresholds: { COMPLETE_AT: 0.7 },
      penaltyConfigs: { SCORE_ONLY: { cap: 5 } },
    });
    definition.tunableSpec = {
      ...syntheticSpec,
      exerciseName: definition.name,
      tunables: [
        ...syntheticSpec.tunables,
        { path: 'penaltyConfigs.SCORE_ONLY.cap', min: 0, max: 10, step: 1, kind: 'scoring' },
      ],
    };
    const scoreCase = syntheticCase(definition.name, 'train');
    scoreCase.label.reps[0].expectedScoreRange = [90, 100];

    const result = searchExercise(definition, [scoreCase], {
      randomCandidates: 20,
      refinementRounds: 0,
      survivorCount: 20,
      seed: 1,
    });

    expect(result.candidates.some((candidate) =>
      getConfigValue(candidate.config, 'penaltyConfigs.SCORE_ONLY.cap') !== 5,
    )).toBe(true);
  });

  it('generates diagnostic-derived threshold candidates from labelled metric distributions', () => {
    const definition = makeDiagnosticSyntheticExercise('Diagnostic Synthetic Threshold', {
      thresholds: { COMPLETE_AT: 0.5 },
      formThresholds: { WARN_AT: 0.9 },
    });
    const result = searchExercise(
      definition,
      [
        diagnosticSyntheticCase(definition.name, 0.8, [diagnosticSyntheticIssueId]),
        diagnosticSyntheticCase(definition.name, 0.55, []),
      ],
      { randomCandidates: 0, refinementRounds: 0, survivorCount: 4, seed: 1 },
      'diagnostic',
    );

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.sourceBreakdown.diagnostic).toBeGreaterThan(0);
    expect(result.candidates[0].source).toBe('diagnostic');
    expect(getConfigValue(result.candidates[0].config, 'formThresholds.WARN_AT')).toBeLessThan(0.9);
    expect(result.candidates[0].evaluation.metrics.issueF1).toBe(1);
  });

  it('ignores diagnostic candidates when the active cue metric or threshold does not match the tuning entry', () => {
    const metricMismatchDefinition = makeDiagnosticSyntheticExercise(
      'Diagnostic Synthetic Metric Mismatch',
      {
        thresholds: { COMPLETE_AT: 0.5 },
        formThresholds: { WARN_AT: 0.9 },
      },
      { cueMetricKeys: ['otherMetric'] },
    );
    const metricMismatchResult = searchExercise(
      metricMismatchDefinition,
      [
        diagnosticSyntheticCase(metricMismatchDefinition.name, 0.8, [diagnosticSyntheticIssueId]),
        diagnosticSyntheticCase(metricMismatchDefinition.name, 0.55, []),
      ],
      { randomCandidates: 0, refinementRounds: 0, survivorCount: 4, seed: 1 },
      'diagnostic',
    );

    expect(metricMismatchResult.candidates).toHaveLength(0);
    expect(metricMismatchResult.sourceBreakdown.diagnostic).toBe(0);
    expect(metricMismatchResult.diagnosticFallbackReason).toContain('insufficient eligible diagnostic support');

    const thresholdMismatchDefinition = makeDiagnosticSyntheticExercise(
      'Diagnostic Synthetic Threshold Mismatch',
      {
        thresholds: { COMPLETE_AT: 0.5 },
        formThresholds: { WARN_AT: 0.9 },
      },
      { cueThresholdPath: ['formThresholds.OTHER_WARN_AT'] },
    );
    const thresholdMismatchResult = searchExercise(
      thresholdMismatchDefinition,
      [
        diagnosticSyntheticCase(thresholdMismatchDefinition.name, 0.8, [diagnosticSyntheticIssueId]),
        diagnosticSyntheticCase(thresholdMismatchDefinition.name, 0.55, []),
      ],
      { randomCandidates: 0, refinementRounds: 0, survivorCount: 4, seed: 1 },
      'diagnostic',
    );

    expect(thresholdMismatchResult.candidates).toHaveLength(0);
    expect(thresholdMismatchResult.sourceBreakdown.diagnostic).toBe(0);
    expect(thresholdMismatchResult.diagnosticFallbackReason).toContain('insufficient eligible diagnostic support');
  });

  it('reports diagnostic fallback reasons when an exercise has no diagnostic metadata', () => {
    const definition = makeSyntheticExercise('Scaling Synthetic No Diagnostics', {
      thresholds: { COMPLETE_AT: 0.5 },
    });
    const result = searchExercise(
      definition,
      [syntheticCase(definition.name, 'train')],
      { randomCandidates: 0, refinementRounds: 0, survivorCount: 2, seed: 1 },
      'diagnostic',
    );

    expect(result.diagnosticFallbackReason).toContain('no diagnosticTuning metadata');
  });

  it('blocks auto-apply when minimum split counts are below thresholds', () => {
    expect(minimumSplitGate({ train: 0, validation: 1, test: 1 }, DEFAULT_MIN_SPLIT_CASES)).toMatchObject({
      passed: false,
      reason: expect.stringContaining('train 0/1'),
    });
    expect(minimumSplitGate({ train: 1, validation: 0, test: 1 }, DEFAULT_MIN_SPLIT_CASES)).toMatchObject({
      passed: false,
      reason: expect.stringContaining('validation 0/1'),
    });
    expect(minimumSplitGate({ train: 1, validation: 1, test: 0 }, DEFAULT_MIN_SPLIT_CASES)).toMatchObject({
      passed: false,
      reason: expect.stringContaining('test 0/1'),
    });
    expect(minimumSplitGate({ train: 1, validation: 1, test: 1 }, DEFAULT_MIN_SPLIT_CASES)).toMatchObject({
      passed: true,
    });
  });

  it('reports minimum split gate failures without writing tuned config', () => {
    const name = 'Scaling Synthetic Registered';
    if (!ExerciseRegistry.has(name)) {
      ExerciseRegistry.register(makeSyntheticExercise(name, { thresholds: { COMPLETE_AT: 0.7 } }));
    }
    const cases = [
      syntheticCase(name, 'train'),
      syntheticCase(name, 'validation'),
      syntheticCase(name, 'test'),
    ];
    const report = optimizeExercise(
      name,
      cases,
      {
        labelFilesDiscovered: 3,
        templateLabelsSkipped: 0,
        draftLabelsSkipped: 0,
        exerciseLabelsSkipped: 0,
        splitLabelsSkipped: 0,
        missingLandmarksSkipped: 0,
        landmarkFilesRead: 3,
        casesLoaded: 3,
      },
      {
        exerciseFilter: name,
        dryRun: false,
        includeCaseDetails: false,
        includeDiagnostics: true,
        selectionMode: 'diagnostic',
        apply: false,
        silent: true,
        reportPath: null,
        search: { randomCandidates: 1, refinementRounds: 0, survivorCount: 1, seed: 1 },
        minCases: { train: 2, validation: 2, test: 2 },
      },
    );

    expect(report.applied).toBe(false);
    expect(report.minimumSplitGate.passed).toBe(false);
    expect(report.reason).toContain('minimum reviewed split counts');
  });
});

describe('dataset optimiser exercise discovery', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-optimize-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeDatasetCase(exerciseName: string, slug: string): void {
    writeJson(path.join(root, `labels/${slug}/case.json`), {
      schemaVersion: 1,
      exerciseName,
      sourceVideo: `videos/${slug}/case.mp4`,
      landmarkFile: `landmarks/${slug}/case.json`,
      split: 'train',
      reviewStatus: 'reviewed',
      expectedReps: 0,
      reps: [],
    });
    writeJson(path.join(root, `landmarks/${slug}/case.json`), {
      exerciseName,
      metadata: {},
      frames: [],
    });
  }

  it('discovers reviewed exercises from labels without requiring landmark reads', () => {
    writeJson(path.join(root, 'labels/barbell-squat/case.json'), {
      schemaVersion: 1,
      exerciseName: 'Barbell Squat',
      sourceVideo: 'videos/barbell-squat/case.mp4',
      landmarkFile: 'landmarks/barbell-squat/missing.json',
      split: 'train',
      reviewStatus: 'reviewed',
      expectedReps: 0,
      reps: [],
    });

    expect(discoverReviewedDatasetExercises({ datasetRoot: root })).toEqual(['Barbell Squat']);
  });

  it('runs all-exercise optimisation one exercise at a time with per-exercise load summaries', () => {
    writeDatasetCase('Barbell Squat', 'barbell-squat');
    writeDatasetCase('Push-Up', 'push-up');

    const { report } = runDatasetOptimize({
      datasetRoot: root,
      exerciseFilter: null,
      dryRun: true,
      includeCaseDetails: false,
      includeDiagnostics: true,
      selectionMode: 'diagnostic',
      apply: false,
      silent: true,
      reportPath: path.join(root, 'reports/optimization.json'),
      search: { randomCandidates: 0, refinementRounds: 0, survivorCount: 1, seed: 1 },
      minCases: DEFAULT_MIN_SPLIT_CASES,
    });

    expect(report.discoveredExercises.sort()).toEqual(['Barbell Squat', 'Push-Up']);
    expect(report.exercises).toHaveLength(2);
    expect(report.exercises.map((exercise) => exercise.loadSummary.landmarkFilesRead)).toEqual([1, 1]);
    expect(report.exercises.map((exercise) => exercise.rankedSelection[0]?.evaluation)).toEqual(
      expect.arrayContaining([expect.not.objectContaining({ cases: expect.any(Array) })]),
    );
  });
});
