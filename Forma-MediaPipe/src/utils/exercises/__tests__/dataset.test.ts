import { readFileSync } from 'fs';
import { join } from 'path';
import type { Keypoint } from '../../poseAnalysis';
import type { ExerciseDefinition, ExerciseState, RepDiagnostics } from '../types';
import { evaluateCase, summarizeEvaluations } from '../dataset';
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

  it('accepts optional per-rep view and scorable fields and rejects invalid values', () => {
    expect(validateLabelFile(
      {
        ...baseLabel,
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view: 'front', scorable: false },
        ],
      },
      new Set(['demo-exercise.depth_short']),
    )).toEqual([]);

    expect(validateLabelFile(
      {
        ...baseLabel,
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view: 'diagonal', scorable: 'no' },
        ],
      },
      new Set(['demo-exercise.depth_short']),
    ).map((issue) => issue.message)).toEqual(expect.arrayContaining([
      'view must be side, front, oblique, or unknown.',
      'scorable must be a boolean when provided.',
    ]));
  });

  it.each(['Barbell Curl', 'Push-Up', 'Barbell Squat', 'Cable Row', 'Cable Lat Pulldowns', 'Leg Extensions'])(
    'requires view and scorable on reviewed %s reps but not drafts',
    exerciseName => {
      const reviewedLabel = {
        ...baseLabel,
        exerciseName,
        reviewStatus: 'reviewed' as const,
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [] },
        ],
      };

      expect(validateLabelFile(reviewedLabel).map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('reps must include view.'),
          expect.stringContaining('reps must include scorable.'),
        ]),
      );

      expect(validateLabelFile({
        ...reviewedLabel,
        reviewStatus: 'draft' as const,
      })).toEqual([]);

      const knownViewIssues = validateLabelFile({
        ...reviewedLabel,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view: 'front', scorable: true },
        ],
      });
      if (
        exerciseName === 'Push-Up' ||
        exerciseName === 'Barbell Squat' ||
        exerciseName === 'Cable Row' ||
        exerciseName === 'Cable Lat Pulldowns' ||
        exerciseName === 'Leg Extensions'
      ) {
        expect(knownViewIssues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
          expect.stringContaining('reps must use side view; use scorable=false for front, oblique, or unknown views.'),
        ]));
      } else {
        expect(knownViewIssues).toEqual([]);
      }

      expect(validateLabelFile({
        ...reviewedLabel,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view: 'unknown', scorable: true },
        ],
      }).map((issue) => issue.message)).toEqual(expect.arrayContaining([
        expect.stringContaining('reps must use front, side, or oblique view; use scorable=false when view is unknown.'),
      ]));

      expect(validateLabelFile({
        ...reviewedLabel,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view: 'unknown', scorable: false },
        ],
      })).toEqual([]);
    },
  );

  it('requires reviewed scorable lateral-raise reps to use front view', () => {
    const reviewedLabel = {
      ...baseLabel,
      exerciseName: 'Standing Dumbbell Lateral Raises',
      reviewStatus: 'reviewed' as const,
      expectedReps: 1,
      reps: [
        { index: 1, startMs: 0, endMs: 1000, issueIds: [] },
      ],
    };

    expect(validateLabelFile(reviewedLabel).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Standing Dumbbell Lateral Raises'),
        expect.stringContaining('reps must include scorable.'),
      ]),
    );

    expect(validateLabelFile({
      ...reviewedLabel,
      reps: [
        { index: 1, startMs: 0, endMs: 1000, issueIds: [], view: 'front', scorable: true },
      ],
    })).toEqual([]);

    expect(validateLabelFile({
      ...reviewedLabel,
      reps: [
        { index: 1, startMs: 0, endMs: 1000, issueIds: [], view: 'oblique', scorable: true },
      ],
    }).map((issue) => issue.message)).toEqual(expect.arrayContaining([
      'reviewed scorable Standing Dumbbell Lateral Raises reps must use front view; use scorable=false for side, oblique, or unknown views.',
    ]));

    expect(validateLabelFile({
      ...reviewedLabel,
      reps: [
        { index: 1, startMs: 0, endMs: 1000, issueIds: [], view: 'oblique', scorable: false },
      ],
    })).toEqual([]);
  });

  it.each(['front', 'oblique', 'unknown'] as const)(
    'allows reviewed unscorable Push-Up reps with %s view',
    view => {
      expect(validateLabelFile({
        ...baseLabel,
        exerciseName: 'Push-Up',
        reviewStatus: 'reviewed',
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view, scorable: false },
        ],
      })).toEqual([]);
    },
  );

  it.each(['front', 'oblique', 'unknown'] as const)(
    'rejects reviewed scorable Cable Row reps with %s view',
    view => {
      expect(validateLabelFile({
        ...baseLabel,
        exerciseName: 'Cable Row',
        reviewStatus: 'reviewed',
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view, scorable: true },
        ],
      }).map((issue) => issue.message)).toEqual(expect.arrayContaining([
        expect.stringContaining('reps must use side view; use scorable=false for front, oblique, or unknown views.'),
      ]));
    },
  );

  it.each(['front', 'oblique', 'unknown'] as const)(
    'allows reviewed unscorable Cable Row reps with %s view',
    view => {
      expect(validateLabelFile({
        ...baseLabel,
        exerciseName: 'Cable Row',
        reviewStatus: 'reviewed',
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view, scorable: false },
        ],
      })).toEqual([]);
    },
  );

  it.each(['front', 'oblique', 'unknown'] as const)(
    'rejects reviewed scorable Cable Lat Pulldowns reps with %s view',
    view => {
      expect(validateLabelFile({
        ...baseLabel,
        exerciseName: 'Cable Lat Pulldowns',
        reviewStatus: 'reviewed',
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view, scorable: true },
        ],
      }).map((issue) => issue.message)).toEqual(expect.arrayContaining([
        expect.stringContaining('reps must use side view; use scorable=false for front, oblique, or unknown views.'),
      ]));
    },
  );

  it.each(['front', 'oblique', 'unknown'] as const)(
    'allows reviewed unscorable Cable Lat Pulldowns reps with %s view',
    view => {
      expect(validateLabelFile({
        ...baseLabel,
        exerciseName: 'Cable Lat Pulldowns',
        reviewStatus: 'reviewed',
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view, scorable: false },
        ],
      })).toEqual([]);
    },
  );

  it.each(['front', 'oblique', 'unknown'] as const)(
    'rejects reviewed scorable Leg Extensions reps with %s view',
    view => {
      expect(validateLabelFile({
        ...baseLabel,
        exerciseName: 'Leg Extensions',
        reviewStatus: 'reviewed',
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view, scorable: true },
        ],
      }).map((issue) => issue.message)).toEqual(expect.arrayContaining([
        expect.stringContaining('reps must use side view; use scorable=false for front, oblique, or unknown views.'),
      ]));
    },
  );

  it.each(['front', 'oblique', 'unknown'] as const)(
    'allows reviewed unscorable Leg Extensions reps with %s view',
    view => {
      expect(validateLabelFile({
        ...baseLabel,
        exerciseName: 'Leg Extensions',
        reviewStatus: 'reviewed',
        expectedReps: 1,
        reps: [
          { index: 1, startMs: 0, endMs: 1000, issueIds: [], view, scorable: false },
        ],
      })).toEqual([]);
    },
  );

  it('includes reviewed-ready view and scorable metadata in the push-up label template', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), 'datasets/form-heuristics/labels/templates/push-up.template.json'),
        'utf8',
      ),
    ) as { reps: Array<{ view?: string; scorable?: boolean }>; labelingGuidance?: string[] };

    expect(template.reps[0]?.view).toBe('side');
    expect(template.reps[0]?.scorable).toBe(true);
    expect(template.labelingGuidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Standard side-view floor push-ups are the target scope'),
        expect.stringContaining('Use push-up.incomplete_rom only as the fallback ROM issue'),
      ]),
    );
  });

  it('includes reviewed-ready view, scorable metadata, and guidance in the lateral-raise label template', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), 'datasets/form-heuristics/labels/templates/standing-dumbbell-lateral-raises.template.json'),
        'utf8',
      ),
    ) as { reps: Array<{ view?: string; scorable?: boolean }>; labelingGuidance?: string[] };

    expect(template.reps[0]?.view).toBe('front');
    expect(template.reps[0]?.scorable).toBe(true);
    expect(template.labelingGuidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Front-view Standing Dumbbell Lateral Raises are the v1 full-form scoring target'),
        expect.stringContaining('do not count tiny pulses'),
        expect.stringContaining('note the visible subcause'),
        expect.stringContaining('Reviewed scorable Standing Dumbbell Lateral Raises reps must use view=front'),
      ]),
    );
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

  it('lists side-view squat issues in the label template', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), 'datasets/form-heuristics/labels/templates/barbell-squat.template.json'),
        'utf8',
      ),
    ) as { availableIssues: Array<{ issueId: string }>; labelingGuidance?: string[] };

    const issueIds = template.availableIssues.map((issue) => issue.issueId);
    expect(issueIds).toEqual(expect.arrayContaining([
      'barbell-squat.depth_short',
      'barbell-squat.lockout_short',
      'barbell-squat.incomplete_rom',
      'barbell-squat.heel_lift',
    ]));
    expect(issueIds).not.toContain('barbell-squat.knee_valgus');
    expect(template.labelingGuidance).toEqual(expect.arrayContaining([
      expect.stringContaining('Side-view Barbell Squat reps are the v1 full-form scoring target'),
      expect.stringContaining('Do not label knee valgus in v1'),
    ]));
  });

  it('lists production-hardening cable-row issues in the label template', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), 'datasets/form-heuristics/labels/templates/cable-row.template.json'),
        'utf8',
      ),
    ) as {
      availableIssues: Array<{ issueId: string }>;
      reps: Array<{ view?: string; scorable?: boolean }>;
      labelingGuidance?: string[];
    };

    expect(template.reps[0]?.view).toBe('side');
    expect(template.reps[0]?.scorable).toBe(true);
    expect(template.availableIssues.map((issue) => issue.issueId)).toEqual(expect.arrayContaining([
      'cable-row.torso_rocking',
      'cable-row.high_row',
      'cable-row.shoulder_shrug',
    ]));
    expect(template.availableIssues.map((issue) => issue.issueId)).not.toContain('cable-row.row_target_high');
    expect(template.availableIssues.map((issue) => issue.issueId)).not.toContain('cable-row.jerky_pull');
    expect(template.labelingGuidance).toEqual(expect.arrayContaining([
      expect.stringContaining('Side-view Cable Row reps are the v1 full-form scoring target'),
      expect.stringContaining('Do not label row-target height, hold, or velocity diagnostics'),
    ]));
  });

  it('lists production-hardening cable-lat-pulldown issues in the label template', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), 'datasets/form-heuristics/labels/templates/cable-lat-pulldowns.template.json'),
        'utf8',
      ),
    ) as {
      availableIssues: Array<{ issueId: string }>;
      reps: Array<{ view?: string; scorable?: boolean }>;
      labelingGuidance?: string[];
    };

    expect(template.reps[0]?.view).toBe('side');
    expect(template.reps[0]?.scorable).toBe(true);
    expect(template.availableIssues.map((issue) => issue.issueId)).toEqual(expect.arrayContaining([
      'cable-lat-pulldowns.rom_short',
      'cable-lat-pulldowns.lockout_short',
      'cable-lat-pulldowns.elbow_drive',
      'cable-lat-pulldowns.torso_warn',
      'cable-lat-pulldowns.torso_rocking',
      'cable-lat-pulldowns.shoulder_shrug',
      'cable-lat-pulldowns.tempo_down',
      'cable-lat-pulldowns.tempo_up',
    ]));
    expect(template.labelingGuidance).toEqual(expect.arrayContaining([
      expect.stringContaining('Side-view Cable Lat Pulldowns reps are the v1 full-form scoring target'),
      expect.stringContaining('Usable side-diagonal Cable Lat Pulldowns captures should be marked view=side'),
      expect.stringContaining('Do not label bar path or handle path as separate issues in v1'),
    ]));
  });

  it('includes reviewed-ready view, scorable metadata, and guidance in the leg-extension label template', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), 'datasets/form-heuristics/labels/templates/leg-extensions.template.json'),
        'utf8',
      ),
    ) as {
      availableIssues: Array<{ issueId: string }>;
      reps: Array<{ view?: string; scorable?: boolean }>;
      labelingGuidance?: string[];
    };

    expect(template.reps[0]?.view).toBe('side');
    expect(template.reps[0]?.scorable).toBe(true);
    expect(template.availableIssues.map((issue) => issue.issueId)).toEqual(expect.arrayContaining([
      'leg-extensions.lockout_short',
      'leg-extensions.rom_short_leg_ext',
      'leg-extensions.hip_lift',
      'leg-extensions.top_hold_short',
      'leg-extensions.tempo_up',
      'leg-extensions.tempo_down',
    ]));
    expect(template.labelingGuidance).toEqual(expect.arrayContaining([
      expect.stringContaining('Side-view Leg Extensions reps are the v1 full-form scoring target'),
      expect.stringContaining('mark them scorable=false and do not label clean negatives'),
      expect.stringContaining('Label lockout, bottom range, hip lift, torso movement, top hold, and tempo'),
      expect.stringContaining('Reviewed scorable Leg Extensions reps must use view=side'),
    ]));
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

  it('keeps unscorable labelled reps in rep-count accuracy but excludes them from issue metrics', () => {
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
              issueIds: ['demo-exercise.depth_short'],
              view: 'oblique',
              scorable: false,
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
            score: 0,
            messages: [],
            issueIds: [],
            startedAt: 0,
            completedAt: 1000,
            scorable: false,
          },
        ],
      },
    );

    expect(evaluation.repCountCorrect).toBe(true);
    expect(evaluation.matchedReps[0]).toMatchObject({
      expectedScorable: false,
      expectedView: 'oblique',
      falseNegatives: [],
    });
    expect(evaluation.totals.falseNegatives).toBe(0);
    expect(evaluation.totals.truePositives).toBe(0);
    expect(evaluation.totals.falsePositives).toBe(0);
  });

  it('reports view and scorable accuracy only for matched reps with explicit labels', () => {
    const evaluation = evaluateCase(
      {
        label: {
          ...baseLabel,
          expectedReps: 3,
          reps: [
            { index: 1, startMs: 0, endMs: 1000, issueIds: [], view: 'front', scorable: true },
            { index: 2, startMs: 1100, endMs: 2000, issueIds: [], view: 'unknown', scorable: false },
            { index: 3, startMs: 2100, endMs: 3000, issueIds: [], view: 'side' },
          ],
        },
        recording: { exerciseName: 'Demo Exercise', metadata: {}, frames: [] },
      },
      {
        finalRepCount: 2,
        reps: [
          {
            repIndex: 1,
            score: 90,
            messages: [],
            issueIds: [],
            diagnostics: { ...depthDiagnostics, view: 'front', scorable: true },
            scorable: true,
            startedAt: 0,
            completedAt: 1000,
          },
          {
            repIndex: 2,
            score: 0,
            messages: [],
            issueIds: [],
            diagnostics: { ...depthDiagnostics, repIndex: 2, view: 'front', scorable: true },
            scorable: true,
            startedAt: 1100,
            completedAt: 2000,
          },
        ],
      },
    );

    const summary = summarizeEvaluations([evaluation]);

    expect(evaluation.totals.viewEvaluatedReps).toBe(1);
    expect(evaluation.totals.viewCorrectReps).toBe(1);
    expect(summary.metrics.viewAccuracy).toBe(1);
    expect(evaluation.totals.scorableEvaluatedReps).toBe(2);
    expect(evaluation.totals.scorableCorrectReps).toBe(1);
    expect(summary.metrics.scorableAccuracy).toBe(0.5);
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
