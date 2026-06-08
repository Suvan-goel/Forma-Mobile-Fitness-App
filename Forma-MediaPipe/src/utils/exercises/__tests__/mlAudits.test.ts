import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
    expect(report.summary.reviewedFilesMissingMetadata).toBe(1);
    expect(report.metadataPatchTemplate).toHaveLength(1);
    expect(report.metadataPatchTemplate[0]).toMatchObject({
      missingFields: [
        'subjectIdOrParticipantId',
        'sessionId',
        'cameraSetupId',
        'reviewerConfidence',
      ],
      patch: {
        captureMetadata: {
          subjectId: null,
          sessionId: null,
          cameraSetupId: null,
          reviewerConfidence: null,
        },
      },
    });
    expect(report.metadataPatchWorkflow.dryRunCommand).toContain('ml:patch-metadata');
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

  it('keeps ML review annotations offline while separating acceptable borderline warnings', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ml-review-annotations-'));
    const annotationsPath = join(tempDir, 'annotations.json');
    writeFileSync(annotationsPath, JSON.stringify({
      schemaVersion: 1,
      annotations: [
        {
          recordingId: 'val08-hard-negative-front',
          repIndex: 2,
          startMs: 11250,
          endMs: 13500,
          acceptableBorderlineGroups: ['shoulder_issue'],
          acceptableBorderlineIssues: ['barbell-curl.shoulder_warn'],
          reviewerNotes: 'Mild shoulder assistance is acceptable as a light warning.',
        },
        {
          recordingId: 'test08-hard-negative-front',
          repIndex: 2,
          startMs: 9300,
          endMs: 14100,
          unacceptableGroups: ['torso_issue'],
          reviewerNotes: 'Minimal torso sway should remain unacceptable.',
        },
      ],
    }));

    const script = String.raw`
import importlib.util
import json
import sys
import pandas as pd

module_path = sys.argv[1]
annotations_path = sys.argv[2]
spec = importlib.util.spec_from_file_location("ml_evaluate_test", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

review_annotations = module.load_review_annotations(annotations_path)
df = pd.DataFrame([
    {
        "source_video": "videos/validation/barbell-curl/val08-hard-negative-front.mp4",
        "label_file": "labels/validation/barbell-curl/val08-hard-negative-front.json",
        "recording_file": "landmarks/validation/barbell-curl/val08-hard-negative-front.json",
        "split": "validation",
        "rep_index": 2,
        "expected_start_ms": 11250,
        "expected_end_ms": 13500,
        "label_clean": 1,
        "label_issue__barbell_curl_shoulder_issue": 0,
        "label_issue__barbell_curl_torso_issue": 0,
        "pred_shoulder": 1,
        "pred_torso": 0,
    },
    {
        "source_video": "videos/testing/barbell-curl/test08-hard-negative-front.mp4",
        "label_file": "labels/testing/barbell-curl/test08-hard-negative-front.json",
        "recording_file": "landmarks/testing/barbell-curl/test08-hard-negative-front.json",
        "split": "test",
        "rep_index": 2,
        "expected_start_ms": 9300,
        "expected_end_ms": 14100,
        "label_clean": 1,
        "label_issue__barbell_curl_shoulder_issue": 0,
        "label_issue__barbell_curl_torso_issue": 0,
        "pred_shoulder": 0,
        "pred_torso": 1,
    },
])
label_columns = [
    "label_issue__barbell_curl_shoulder_issue",
    "label_issue__barbell_curl_torso_issue",
]
prediction_columns = {
    "label_issue__barbell_curl_shoulder_issue": "pred_shoulder",
    "label_issue__barbell_curl_torso_issue": "pred_torso",
}
report = module.tolerant_grouped_policy_metrics(df, label_columns, prediction_columns, review_annotations)
assert report["strictHardNegativeFalsePositiveRows"] == 2, report
assert report["hardNegativeAcceptableBorderlineWarningRows"] == 1, report
assert report["hardNegativeUnacceptableFalsePositiveRows"] == 1, report
assert report["strictAggregate"]["falsePositives"] == 2, report
assert report["tolerantAggregate"]["falsePositives"] == 1, report

no_annotations = module.load_review_annotations(None)
strict_only = module.tolerant_grouped_policy_metrics(df, label_columns, prediction_columns, no_annotations)
assert strict_only["hardNegativeUnacceptableFalsePositiveRows"] == 2, strict_only
assert int(df["label_clean"].sum()) == 2
assert int(df["label_issue__barbell_curl_shoulder_issue"].sum()) == 0
assert int(df["label_issue__barbell_curl_torso_issue"].sum()) == 0
print(json.dumps({"ok": True}))
`;

    try {
      const output = execFileSync('python3', ['-c', script, join(process.cwd(), 'scripts/ml-evaluate.py'), annotationsPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        encoding: 'utf8',
      });
      expect(JSON.parse(output)).toEqual({ ok: true });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('selects grouped rep-level policies with acceptable-borderline safety accounting offline only', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ml-grouped-policy-'));
    const annotationsPath = join(tempDir, 'annotations.json');
    writeFileSync(annotationsPath, JSON.stringify({
      schemaVersion: 1,
      annotations: [
        {
          recordingId: 'val08-hard-negative-front',
          repIndex: 2,
          startMs: 11250,
          endMs: 13500,
          acceptableBorderlineGroups: ['shoulder_issue'],
          reviewerNotes: 'Mild shoulder assistance is acceptable as grouped shoulder feedback.',
        },
      ],
    }));

    const script = String.raw`
import argparse
import importlib.util
import json
import sys
import pandas as pd

module_path = sys.argv[1]
annotations_path = sys.argv[2]
spec = importlib.util.spec_from_file_location("ml_evaluate_test", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

label = "label_issue__barbell_curl_shoulder_issue"
heuristic = "heuristic_shoulder"
ml = "ml_shoulder"
prob = "ml__logistic__label_issue__barbell_curl_shoulder_issue__prob"
df = pd.DataFrame([
    {
        "source_video": "videos/validation/barbell-curl/val08-hard-negative-front.mp4",
        "label_file": "labels/validation/barbell-curl/val08-hard-negative-front.json",
        "recording_file": "landmarks/validation/barbell-curl/val08-hard-negative-front.json",
        "split": "validation",
        "rep_index": 2,
        "expected_start_ms": 11250,
        "expected_end_ms": 13500,
        "label_clean": 1,
        label: 0,
        heuristic: 0,
        ml: 1,
        prob: 0.95,
        "heuristic_scorable": 1,
        "feature__diagnostic.scorable": 1,
    },
    {
        "source_video": "videos/validation/barbell-curl/val01-shoulder-front.mp4",
        "label_file": "labels/validation/barbell-curl/val01-shoulder-front.json",
        "recording_file": "landmarks/validation/barbell-curl/val01-shoulder-front.json",
        "split": "validation",
        "rep_index": 1,
        "expected_start_ms": 1000,
        "expected_end_ms": 3000,
        "label_clean": 0,
        label: 1,
        heuristic: 0,
        ml: 1,
        prob: 0.92,
        "heuristic_scorable": 1,
        "feature__diagnostic.scorable": 1,
    },
    {
        "source_video": "videos/validation/barbell-curl/val02-shoulder-front.mp4",
        "label_file": "labels/validation/barbell-curl/val02-shoulder-front.json",
        "recording_file": "landmarks/validation/barbell-curl/val02-shoulder-front.json",
        "split": "validation",
        "rep_index": 1,
        "expected_start_ms": 1000,
        "expected_end_ms": 3000,
        "label_clean": 0,
        label: 1,
        heuristic: 0,
        ml: 1,
        prob: 0.81,
        "heuristic_scorable": 1,
        "feature__diagnostic.scorable": 1,
    },
    {
        "source_video": "videos/validation/barbell-curl/val03-clean-front.mp4",
        "label_file": "labels/validation/barbell-curl/val03-clean-front.json",
        "recording_file": "landmarks/validation/barbell-curl/val03-clean-front.json",
        "split": "validation",
        "rep_index": 1,
        "expected_start_ms": 1000,
        "expected_end_ms": 3000,
        "label_clean": 1,
        label: 0,
        heuristic: 0,
        ml: 0,
        prob: 0.4,
        "heuristic_scorable": 1,
        "feature__diagnostic.scorable": 1,
    },
])
args = argparse.Namespace(
    grouped_policy_min_precision=0.75,
    grouped_policy_clean_fp_row_cap=0,
    grouped_policy_hard_negative_fp_row_cap=0,
    grouped_policy_partial_view_fp_row_cap=0,
)
with_annotations = module.choose_grouped_tolerant_threshold_policy(
    df,
    label,
    heuristic,
    ml,
    prob,
    args,
    module.load_review_annotations(annotations_path),
)
without_annotations = module.choose_grouped_tolerant_threshold_policy(
    df,
    label,
    heuristic,
    ml,
    prob,
    args,
    module.load_review_annotations(None),
)
assert with_annotations["selected"] == "ml-threshold-tolerant-optimized", with_annotations
assert with_annotations["threshold"] == 0.81, with_annotations
metrics = with_annotations["validationMetrics"]
assert metrics["strictHardNegativeFalsePositiveRows"] == 1, metrics
assert metrics["hardNegativeUnacceptableFalsePositiveRows"] == 0, metrics
assert metrics["hardNegativeAcceptableBorderlineWarningRows"] == 1, metrics
assert metrics["tolerantTruePositives"] == 2, metrics
assert without_annotations["selected"] == "disabled", without_annotations
assert int(df["label_clean"].sum()) == 2
print(json.dumps({"ok": True}))
`;

    try {
      const output = execFileSync('python3', ['-c', script, join(process.cwd(), 'scripts/ml-evaluate.py'), annotationsPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        encoding: 'utf8',
      });
      expect(JSON.parse(output)).toEqual({ ok: true });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prunes only training features while reporting removed feature groups', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import pandas as pd

module_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("ml_train_test", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

df = pd.DataFrame({
    "feature__demo.all_null": [None, None, None, None],
    "feature__demo.single": [5, 5, 5, 5],
    "feature__demo.low_variance": [1.0, 1.000001, 1.0, 1.0],
    "feature__demo.missing": [1.0, None, None, None],
    "feature__demo.keep": [1, 2, 3, 4],
})
features = list(df.columns)
selected, report = module.prune_feature_columns(
    df,
    features,
    True,
    0.000001,
    0.5,
)
assert selected == ["feature__demo.keep"], selected
assert report["beforeCount"] == 5, report
assert report["afterCount"] == 1, report
assert report["removedByReason"]["allNull"] == 1, report
assert report["removedByReason"]["singleValued"] == 1, report
assert report["removedByReason"]["nearZeroVariance"] == 1, report
assert report["removedByReason"]["excessiveMissingness"] == 1, report
assert report["removedByGroup"]["demo.all_null"] == 1, report
print(json.dumps({"ok": True}))
`;

    const output = execFileSync('python3', ['-c', script, join(process.cwd(), 'scripts/ml-train.py')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      encoding: 'utf8',
    });
    expect(JSON.parse(output)).toEqual({ ok: true });
  });

  it('can select a validation-only direct evidence gate for grouped torso false positives', () => {
    const script = String.raw`
import argparse
import importlib.util
import json
import sys
import pandas as pd

module_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("ml_evaluate_test", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

label = "label_issue__barbell_curl_torso_issue"
heuristic = "heuristic_torso"
ml = "ml_torso"
evidence = "feature__diagnostic.metric.torsodelta.value"
df = pd.DataFrame([
    {
        "source_video": "videos/validation/barbell-curl/val-clean-front.mp4",
        "label_file": "labels/validation/barbell-curl/val-clean-front.json",
        "recording_file": "landmarks/validation/barbell-curl/val-clean-front.json",
        "split": "validation",
        "rep_index": 1,
        "label_clean": 1,
        label: 0,
        heuristic: 0,
        ml: 1,
        evidence: 0.1,
    },
    {
        "source_video": "videos/validation/barbell-curl/val-torso-front.mp4",
        "label_file": "labels/validation/barbell-curl/val-torso-front.json",
        "recording_file": "landmarks/validation/barbell-curl/val-torso-front.json",
        "split": "validation",
        "rep_index": 1,
        "label_clean": 0,
        label: 1,
        heuristic: 0,
        ml: 1,
        evidence: 0.8,
    },
    {
        "source_video": "videos/validation/barbell-curl/val-torso-front.mp4",
        "label_file": "labels/validation/barbell-curl/val-torso-front.json",
        "recording_file": "landmarks/validation/barbell-curl/val-torso-front.json",
        "split": "validation",
        "rep_index": 2,
        "label_clean": 0,
        label: 1,
        heuristic: 0,
        ml: 1,
        evidence: 0.9,
    },
])
base = pd.Series([1, 1, 1], index=df.index)
args = argparse.Namespace(
    grouped_policy_min_precision=0.75,
    grouped_policy_clean_fp_row_cap=0,
    grouped_policy_hard_negative_fp_row_cap=0,
    grouped_policy_partial_view_fp_row_cap=0,
)
choice = module.choose_grouped_direct_evidence_gate_policy(
    df,
    label,
    heuristic,
    ml,
    base,
    args,
    module.load_review_annotations(None),
)
assert choice["selected"] == "direct-evidence-gated", choice
assert choice["evidenceColumn"] == evidence, choice
assert choice["validationMetrics"]["cleanUnacceptableFalsePositiveRows"] == 0, choice
pred = module.apply_grouped_direct_evidence_gate(df, label, base, choice)
assert pred.tolist() == [0, 1, 1], pred.tolist()
assert int(df["label_clean"].sum()) == 1
print(json.dumps({"ok": True}))
`;

    const output = execFileSync('python3', ['-c', script, join(process.cwd(), 'scripts/ml-evaluate.py')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      encoding: 'utf8',
    });
    expect(JSON.parse(output)).toEqual({ ok: true });
  });
});
