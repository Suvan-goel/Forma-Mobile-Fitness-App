import { readFileSync } from 'fs';
import { join } from 'path';
import type { Keypoint } from '../../poseAnalysis';
import type { ExerciseDefinition, ExerciseState, RepDiagnostics } from '../types';
import { evaluateCase } from '../dataset';
import { validateLabelFile } from '../dataset/validation';
import { replayRecordingVerbose, type LandmarkRecording } from '../replay';

const baseLabel = {
  schemaVersion: 1 as const,
  exerciseName: 'Demo Exercise',
  sourceVideo: 'videos/demo.mp4',
  split: 'train' as const,
  expectedReps: 2,
  reps: [
    { index: 1, startMs: 0, endMs: 1000, issueIds: [] },
    { index: 2, startMs: 1100, endMs: 2000, issueIds: ['demo-exercise.depth_short'] },
  ],
};

describe('dataset label validation', () => {
  it('rejects missing reps, overlapping windows, invalid issue ids, and out-of-order indexes', () => {
    const issues = validateLabelFile(
      {
        ...baseLabel,
        expectedReps: 3,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [] },
          { index: 3, startMs: 900, endMs: 850, issueIds: ['unknown.issue'] },
        ],
      },
      new Set(['demo-exercise.depth_short']),
    );

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'reps length (2) must match expectedReps (3).',
        'index should be 2 for sequential per-rep labels.',
        'endMs must be greater than startMs.',
        'Rep windows must not overlap or go backward.',
        'Unknown issue id "unknown.issue".',
      ]),
    );
  });

  it('accepts a clean per-rep label file with known issue ids', () => {
    expect(validateLabelFile(baseLabel, new Set(['demo-exercise.depth_short']))).toEqual([]);
  });

  it('accepts multiple known issue ids on the same rep', () => {
    const issues = validateLabelFile(
      {
        ...baseLabel,
        expectedReps: 1,
        reps: [
          {
            index: 1,
            startMs: 0,
            endMs: 1000,
            issueIds: ['demo-exercise.depth_short', 'demo-exercise.tempo_fast'],
          },
        ],
      },
      new Set(['demo-exercise.depth_short', 'demo-exercise.tempo_fast']),
    );

    expect(issues).toEqual([]);
  });

  it('lists heel-lift as an available squat label issue', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), 'datasets/form-heuristics/labels/templates/barbell-squat.template.json'),
        'utf8',
      ),
    ) as { availableIssues: Array<{ issueId: string }> };

    expect(template.availableIssues.map((issue) => issue.issueId)).toContain('barbell-squat.heel_lift');
  });

  it('lists production-hardening cable-row issues in the label template', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), 'datasets/form-heuristics/labels/templates/cable-row.template.json'),
        'utf8',
      ),
    ) as { availableIssues: Array<{ issueId: string }> };

    expect(template.availableIssues.map((issue) => issue.issueId)).toEqual(expect.arrayContaining([
      'cable-row.torso_rocking',
      'cable-row.high_row',
      'cable-row.shoulder_shrug',
    ]));
    expect(template.availableIssues.map((issue) => issue.issueId)).not.toContain('cable-row.row_target_high');
    expect(template.availableIssues.map((issue) => issue.issueId)).not.toContain('cable-row.jerky_pull');
  });

  it('lists production-hardening cable-pushdown issues in the label template', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), 'datasets/form-heuristics/labels/templates/cable-pushdowns.template.json'),
        'utf8',
      ),
    ) as { availableIssues: Array<{ issueId: string }> };

    expect(template.availableIssues.map((issue) => issue.issueId)).toEqual(expect.arrayContaining([
      'cable-pushdowns.elbow_forward',
      'cable-pushdowns.torso_rocking',
    ]));
  });
});

describe('dataset evaluator', () => {
  const depthDiagnostics: RepDiagnostics = {
    exerciseName: 'Demo Exercise',
    repIndex: 1,
    view: 'front',
    selectedSide: 'both',
    scorable: true,
    metrics: {
      depthRatio: {
        key: 'depthRatio',
        value: 0.82,
        unit: 'ratio',
        eligible: true,
        confidence: 0.93,
        sampleCount: 6,
      },
    },
    cues: {
      'demo-exercise.depth_short': {
        issueId: 'demo-exercise.depth_short',
        metricKeys: ['depthRatio'],
        triggered: true,
        eligible: true,
        direction: 'above',
        thresholdPath: 'formThresholds.DEPTH_WARN',
        thresholdValue: 0.75,
        margin: 0.07,
        support: 6,
      },
    },
  };

  it('scores count mismatches, false positives, and false negatives', () => {
    const evaluation = evaluateCase(
      {
        label: baseLabel,
        recording: { exerciseName: 'Demo Exercise', metadata: {}, frames: [] },
      },
      {
        finalRepCount: 3,
        reps: [
          {
            repIndex: 1,
            score: 80,
            messages: [],
            issueIds: ['demo-exercise.extra_issue'],
            startedAt: 0,
            completedAt: 1000,
          },
          {
            repIndex: 2,
            score: 90,
            messages: [],
            issueIds: [],
            startedAt: 1100,
            completedAt: 2000,
          },
          {
            repIndex: 3,
            score: 100,
            messages: [],
            issueIds: [],
            startedAt: 2100,
            completedAt: 2500,
          },
        ],
      },
    );

    expect(evaluation.repCountCorrect).toBe(false);
    expect(evaluation.totals.falsePositives).toBe(1);
    expect(evaluation.totals.falseNegatives).toBe(1);
    expect(evaluation.totals.cleanFalsePositives).toBe(1);
  });

  it('scores multiple expected issues on the same rep independently when partially predicted', () => {
    const evaluation = evaluateCase(
      {
        label: {
          ...baseLabel,
          expectedReps: 1,
          reps: [
            {
              index: 1,
              startMs: 0,
              endMs: 1000,
              issueIds: ['demo-exercise.depth_short', 'demo-exercise.tempo_fast'],
            },
          ],
        },
        recording: { exerciseName: 'Demo Exercise', metadata: {}, frames: [] },
      },
      {
        finalRepCount: 1,
        reps: [
          {
            repIndex: 1,
            score: 80,
            messages: [],
            issueIds: ['demo-exercise.depth_short'],
            startedAt: 0,
            completedAt: 1000,
          },
        ],
      },
    );

    expect(evaluation.matchedReps[0]).toMatchObject({
      truePositives: ['demo-exercise.depth_short'],
      falsePositives: [],
      falseNegatives: ['demo-exercise.tempo_fast'],
    });
    expect(evaluation.totals.truePositives).toBe(1);
    expect(evaluation.totals.falsePositives).toBe(0);
    expect(evaluation.totals.falseNegatives).toBe(1);
  });

  it('scores all matched issues on the same rep as true positives', () => {
    const evaluation = evaluateCase(
      {
        label: {
          ...baseLabel,
          expectedReps: 1,
          reps: [
            {
              index: 1,
              startMs: 0,
              endMs: 1000,
              issueIds: ['demo-exercise.depth_short', 'demo-exercise.tempo_fast'],
            },
          ],
        },
        recording: { exerciseName: 'Demo Exercise', metadata: {}, frames: [] },
      },
      {
        finalRepCount: 1,
        reps: [
          {
            repIndex: 1,
            score: 70,
            messages: [],
            issueIds: ['demo-exercise.tempo_fast', 'demo-exercise.depth_short'],
            startedAt: 0,
            completedAt: 1000,
          },
        ],
      },
    );

    expect(evaluation.matchedReps[0]).toMatchObject({
      truePositives: ['demo-exercise.depth_short', 'demo-exercise.tempo_fast'],
      falsePositives: [],
      falseNegatives: [],
    });
    expect(evaluation.totals.truePositives).toBe(2);
    expect(evaluation.totals.falsePositives).toBe(0);
    expect(evaluation.totals.falseNegatives).toBe(0);
  });

  it('matches issue labels by rep timing instead of array position', () => {
    const evaluation = evaluateCase(
      {
        label: {
          ...baseLabel,
          expectedReps: 2,
          reps: [
            { index: 1, startMs: 0, endMs: 1000, issueIds: ['demo-exercise.depth_short'] },
            { index: 2, startMs: 1100, endMs: 2000, issueIds: ['demo-exercise.tempo_fast'] },
          ],
        },
        recording: { exerciseName: 'Demo Exercise', metadata: {}, frames: [] },
      },
      {
        finalRepCount: 1,
        reps: [
          {
            repIndex: 1,
            score: 90,
            messages: [],
            issueIds: ['demo-exercise.tempo_fast'],
            startedAt: 1100,
            completedAt: 2000,
          },
        ],
      },
    );

    expect(evaluation.matchedReps).toHaveLength(1);
    expect(evaluation.missingExpectedReps).toHaveLength(1);
    expect(evaluation.extraPredictedReps).toHaveLength(0);
    expect(evaluation.totals.truePositives).toBe(1);
    expect(evaluation.totals.falsePositives).toBe(0);
    expect(evaluation.totals.falseNegatives).toBe(1);
  });

  it('keeps extra early predicted reps from shifting later feedback labels', () => {
    const evaluation = evaluateCase(
      {
        label: {
          ...baseLabel,
          expectedReps: 1,
          reps: [{ index: 1, startMs: 1000, endMs: 2000, issueIds: ['demo-exercise.depth_short'] }],
        },
        recording: { exerciseName: 'Demo Exercise', metadata: {}, frames: [] },
      },
      {
        finalRepCount: 2,
        reps: [
          {
            repIndex: 1,
            score: 70,
            messages: [],
            issueIds: ['demo-exercise.extra_issue'],
            startedAt: 0,
            completedAt: 500,
          },
          {
            repIndex: 2,
            score: 90,
            messages: [],
            issueIds: ['demo-exercise.depth_short'],
            startedAt: 1000,
            completedAt: 2000,
          },
        ],
      },
    );

    expect(evaluation.matchedReps).toHaveLength(1);
    expect(evaluation.extraPredictedReps).toHaveLength(1);
    expect(evaluation.totals.truePositives).toBe(1);
    expect(evaluation.totals.falsePositives).toBe(1);
    expect(evaluation.totals.falseNegatives).toBe(0);
  });

  it('matches predictions with missing starts by completion time inside the labelled window', () => {
    const evaluation = evaluateCase(
      {
        label: baseLabel,
        recording: { exerciseName: 'Demo Exercise', metadata: {}, frames: [] },
      },
      {
        finalRepCount: 1,
        reps: [
          {
            repIndex: 1,
            score: 90,
            messages: [],
            issueIds: [],
            startedAt: null,
            completedAt: 750,
          },
        ],
      },
    );

    expect(evaluation.matchedReps[0]).toMatchObject({
      expectedRepIndex: 1,
      predictedRepIndex: 1,
      overlapMs: 0,
    });
  });

  it('preserves predicted diagnostics and summarizes eligible metric distributions', () => {
    const evaluation = evaluateCase(
      {
        label: {
          ...baseLabel,
          expectedReps: 1,
          reps: [{ index: 1, startMs: 0, endMs: 1000, issueIds: ['demo-exercise.depth_short'] }],
        },
        recording: { exerciseName: 'Demo Exercise', metadata: {}, frames: [] },
      },
      {
        finalRepCount: 1,
        reps: [
          {
            repIndex: 1,
            score: 80,
            messages: [],
            issueIds: ['demo-exercise.depth_short'],
            diagnostics: depthDiagnostics,
            startedAt: 0,
            completedAt: 1000,
          },
        ],
      },
    );

    expect(evaluation.matchedReps[0].predictedDiagnostics).toEqual(depthDiagnostics);
    expect(evaluation.diagnosticSummary?.weightedIssueF1).toBe(1);
    expect(evaluation.diagnosticSummary?.issueSummaries['demo-exercise.depth_short']).toMatchObject({
      eligiblePositiveCount: 1,
      eligibleNegativeCount: 0,
      truePositiveCount: 1,
      expectedPositiveMetric: {
        count: 1,
        min: 0.82,
        max: 0.82,
        mean: 0.82,
      },
      averageConfidence: 0.93,
      averageSampleCount: 6,
    });
  });

  it('summarizes eligible positive and negative distributions for squat heel lift diagnostics', () => {
    const makeHeelDiagnostics = (
      repIndex: number,
      delta: number,
      triggered: boolean,
    ): RepDiagnostics => ({
      exerciseName: 'Barbell Squat',
      repIndex,
      view: 'side',
      selectedSide: 'left',
      scorable: true,
      metrics: {
        heelLiftDeltaDeg: {
          key: 'heelLiftDeltaDeg',
          value: delta,
          unit: 'degrees',
          eligible: true,
          confidence: 0.9,
          sampleCount: 12,
        },
        heelLiftSupport: {
          key: 'heelLiftSupport',
          value: triggered ? 0.5 : 0,
          unit: 'ratio',
          eligible: true,
          confidence: 0.9,
          sampleCount: 12,
        },
      },
      cues: {
        'barbell-squat.heel_lift': {
          issueId: 'barbell-squat.heel_lift',
          metricKeys: ['heelLiftDeltaDeg', 'heelLiftSupport'],
          triggered,
          eligible: true,
          direction: 'above',
          thresholdPath: ['formThresholds.HEEL_LIFT_WARN', 'formThresholds.HEEL_LIFT_MIN_SUPPORT'],
          thresholdValue: {
            heelLiftDeltaDeg: 12,
            heelLiftSupport: 0.2,
          },
          margin: null,
          support: triggered ? 0.5 : 0,
        },
      },
    });

    const evaluation = evaluateCase(
      {
        label: {
          schemaVersion: 1,
          exerciseName: 'Barbell Squat',
          sourceVideo: 'videos/squat.mp4',
          split: 'train',
          expectedReps: 2,
          reps: [
            { index: 1, startMs: 0, endMs: 1000, issueIds: ['barbell-squat.heel_lift'] },
            { index: 2, startMs: 1200, endMs: 2200, issueIds: [] },
          ],
        },
        recording: { exerciseName: 'Barbell Squat', metadata: {}, frames: [] },
      },
      {
        finalRepCount: 2,
        reps: [
          {
            repIndex: 1,
            score: 82,
            messages: [],
            issueIds: ['barbell-squat.heel_lift'],
            diagnostics: makeHeelDiagnostics(1, 18, true),
            startedAt: 0,
            completedAt: 1000,
          },
          {
            repIndex: 2,
            score: 96,
            messages: [],
            issueIds: [],
            diagnostics: makeHeelDiagnostics(2, 2, false),
            startedAt: 1200,
            completedAt: 2200,
          },
        ],
      },
    );

    expect(evaluation.diagnosticSummary?.issueSummaries['barbell-squat.heel_lift']).toMatchObject({
      eligiblePositiveCount: 1,
      eligibleNegativeCount: 1,
      expectedPositiveMetric: { count: 1, min: 18, max: 18, mean: 18 },
      expectedNegativeMetric: { count: 1, min: 2, max: 2, mean: 2 },
    });
  });
});

describe('shared replay tracing', () => {
  const makeKeypoint = (x: number): Keypoint => ({
    name: 'demo',
    x,
    y: 0,
    z: 0,
    score: 1,
  });

  const definition: ExerciseDefinition = {
    name: 'Demo Exercise',
    requiredView: 'any',
    createState: (): ExerciseState => ({
      repCount: 0,
      lastRepResult: null,
      feedback: null,
      feedbackTimestamp: null,
      debugInfo: { phase: 'START' },
      _internal: { completed: false },
    }),
    update: (keypoints, state): ExerciseState => {
      const internal = state._internal as { completed: boolean };
      const shouldComplete = !internal.completed && (keypoints[0]?.x ?? 0) > 0.5;
      if (!shouldComplete) {
        return { ...state, debugInfo: { phase: internal.completed ? 'DONE' : 'START' } };
      }
      internal.completed = true;
      return {
        repCount: 1,
        lastRepResult: {
          repIndex: 1,
          score: 88,
          messages: ['Go deeper.'],
          diagnostics: {
            exerciseName: 'Demo Exercise',
            repIndex: 1,
            view: 'unknown',
            selectedSide: 'unknown',
            scorable: true,
            metrics: {
              depthRatio: {
                key: 'depthRatio',
                value: 0.82,
                unit: 'ratio',
                eligible: true,
                confidence: 0.9,
                sampleCount: 1,
              },
            },
            cues: {
              'demo-exercise.depth_short': {
                issueId: 'demo-exercise.depth_short',
                metricKeys: ['depthRatio'],
                triggered: true,
                eligible: true,
                direction: 'above',
                thresholdPath: 'formThresholds.DEPTH_WARN',
                thresholdValue: 0.75,
                margin: 0.07,
                support: 1,
              },
            },
          },
        },
        feedback: 'Go deeper.',
        feedbackTimestamp: Date.now(),
        debugInfo: { phase: 'DONE' },
        _internal: internal,
      };
    },
    ttsConfig: {
      feedbackToIssue: {
        'Go deeper.': 'depth_short',
      },
    },
    summaryConfig: {},
  };

  it('includes predicted timestamps, scores, messages, and issue ids', () => {
    const recording: LandmarkRecording = {
      exerciseName: 'Demo Exercise',
      metadata: { recordedAt: '2026-01-01T00:00:00.000Z' },
      frames: [
        { timestamp: 0, keypoints: [makeKeypoint(0)] },
        { timestamp: 500, keypoints: [makeKeypoint(1)] },
      ],
    };

    const result = replayRecordingVerbose(definition, recording);

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]).toMatchObject({
      repIndex: 1,
      score: 88,
      messages: ['Go deeper.'],
      issueIds: ['demo-exercise.depth_short'],
      startedAt: 0,
      completedAt: 500,
      diagnostics: {
        cues: {
          'demo-exercise.depth_short': {
            issueId: 'demo-exercise.depth_short',
          },
        },
      },
    });
    expect(result.repTraces[0].transitions[0]).toMatchObject({
      fromPhase: 'START',
      toPhase: 'DONE',
      timestamp: 500,
    });
  });
});
