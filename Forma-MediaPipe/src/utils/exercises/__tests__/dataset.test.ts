import type { Keypoint } from '../../poseAnalysis';
import type { ExerciseDefinition, ExerciseState } from '../types';
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
});

describe('dataset evaluator', () => {
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
    });
    expect(result.repTraces[0].transitions[0]).toMatchObject({
      fromPhase: 'START',
      toPhase: 'DONE',
      timestamp: 500,
    });
  });
});
