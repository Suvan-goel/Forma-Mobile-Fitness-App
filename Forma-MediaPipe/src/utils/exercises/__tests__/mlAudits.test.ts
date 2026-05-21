import type { ExerciseDefinition, ExerciseState } from '../types';
import {
  buildMlLabelAuditReport,
  buildMlSplitAuditReport,
  type LabelFileReference,
} from '../ml';

const definition: ExerciseDefinition = {
  name: 'Demo Exercise',
  requiredView: 'any',
  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: {},
  }),
  update: (_keypoints, state) => state,
  ttsConfig: {
    feedbackToIssue: {
      'Go deeper.': 'depth_short',
    },
  },
  summaryConfig: {},
};

function label(overrides: Partial<LabelFileReference['label']> = {}): LabelFileReference {
  return {
    labelPath: `labels/${overrides.split ?? 'train'}/demo.json`,
    label: {
      schemaVersion: 1,
      exerciseName: 'Demo Exercise',
      sourceVideo: `videos/${overrides.split ?? 'train'}/demo.mp4`,
      landmarkFile: `landmarks/${overrides.split ?? 'train'}/demo.json`,
      split: 'train',
      reviewStatus: 'reviewed',
      expectedReps: 1,
      captureMetadata: {
        subjectId: 'subject-a',
        sessionId: 'session-a',
        cameraSetupId: 'camera-a',
        reviewerConfidence: 'high',
      },
      reps: [
        {
          index: 1,
          startMs: 0,
          endMs: 1000,
          issueIds: ['demo-exercise.depth_short'],
          view: 'side',
          scorable: true,
          issueSeverities: {
            'demo-exercise.depth_short': 'moderate',
          },
        },
      ],
      ...overrides,
    },
  };
}

describe('ML label and split audits', () => {
  it('rejects reviewed labels missing grouping metadata', () => {
    const report = buildMlLabelAuditReport({
      definition,
      labels: [
        label({
          captureMetadata: {
            cameraView: 'side',
          },
        }),
      ],
      requireSeverity: true,
    });

    expect(report.passed).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'missing_subject_id',
      'missing_session_id',
      'missing_camera_setup_id',
      'missing_reviewer_confidence',
    ]));
  });

  it('detects subject, session, and camera setup leakage across holdout splits', () => {
    const report = buildMlSplitAuditReport({
      definition,
      labels: [
        label({ split: 'train' }),
        label({ split: 'test' }),
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'subject_train_test_leakage',
      'session_split_leakage',
      'camera_setup_split_leakage',
    ]));
  });

  it('permits grouped splits with issue support in every split', () => {
    const report = buildMlSplitAuditReport({
      definition,
      labels: [
        label({
          split: 'train',
          captureMetadata: {
            subjectId: 'subject-train',
            sessionId: 'session-train',
            cameraSetupId: 'camera-train',
            reviewerConfidence: 'high',
          },
        }),
        label({
          split: 'validation',
          captureMetadata: {
            subjectId: 'subject-val',
            sessionId: 'session-val',
            cameraSetupId: 'camera-val',
            reviewerConfidence: 'high',
          },
        }),
        label({
          split: 'test',
          captureMetadata: {
            subjectId: 'subject-test',
            sessionId: 'session-test',
            cameraSetupId: 'camera-test',
            reviewerConfidence: 'high',
          },
        }),
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.summary.groupingPolicy).toBe('subjectId');
    expect(report.issueSupportBySplit.train?.['demo-exercise.depth_short']).toBe(1);
    expect(report.issueSupportBySplit.validation?.['demo-exercise.depth_short']).toBe(1);
    expect(report.issueSupportBySplit.test?.['demo-exercise.depth_short']).toBe(1);
  });
});
