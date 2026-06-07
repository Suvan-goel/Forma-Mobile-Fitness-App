import type { ExerciseDefinition } from '../types';
import {
  getExerciseLabelPolicy,
  getLabelableIssues,
  isIssueLabelableForView,
} from '../dataset/labelPolicy';
import type {
  DatasetSplit,
  ExerciseCaptureMetadata,
  ExerciseLabelFile,
  LabelReviewStatus,
  RepIssueSeverity,
  RepViewLabel,
} from '../dataset/types';

export type MlAuditLevel = 'error' | 'warning';

export interface MlAuditFinding {
  level: MlAuditLevel;
  code: string;
  path: string;
  message: string;
}

export interface LabelFileReference {
  label: ExerciseLabelFile;
  labelPath?: string;
}

export interface MlLabelAuditOptions {
  definition: ExerciseDefinition;
  labels: LabelFileReference[];
  requireSeverity?: boolean;
  allowDrafts?: boolean;
  minPositivePerIssue?: number;
  minNegativePerIssue?: number;
}

export interface MlLabelAuditReport {
  passed: boolean;
  exerciseName: string;
  summary: {
    labelFiles: number;
    reviewedFiles: number;
    draftFiles: number;
    reps: number;
    scorableReps: number;
    unscorableReps: number;
    reviewedFilesMissingMetadata: number;
  };
  issueCounts: Record<string, { positive: number; negative: number; severityCounts: Record<RepIssueSeverity, number> }>;
  metadataConvention: MlMetadataConvention;
  metadataPatchWorkflow: MlMetadataPatchWorkflow;
  metadataPatchTemplate: MlMetadataPatchTemplateEntry[];
  findings: MlAuditFinding[];
}

export interface MlMetadataConvention {
  requiredReviewedFields: string[];
  existingConvention: {
    subjectId: string;
    sessionId: string;
    cameraSetupId: string;
    reviewerConfidence: string;
  };
  placeholderValuesToAvoid: string[];
}

export interface MlMetadataPatchWorkflow {
  format: 'json';
  instructions: string[];
  dryRunCommand: string;
  applyCommand: string;
}

export interface MlMetadataPatchTemplateEntry {
  labelPath: string;
  sourceVideo: string;
  split: DatasetSplit;
  reviewStatus?: LabelReviewStatus;
  missingFields: string[];
  existingCaptureMetadata: ExerciseCaptureMetadata;
  patch: {
    captureMetadata: {
      subjectId?: string | null;
      participantId?: string | null;
      sessionId?: string | null;
      cameraSetupId?: string | null;
      reviewerConfidence?: string | null;
    };
  };
  notes: string[];
}

export interface MlSplitAuditOptions {
  definition: ExerciseDefinition;
  labels: LabelFileReference[];
  allowCameraSetupAcrossSplits?: boolean;
  includeDrafts?: boolean;
}

export interface MlSplitAuditReport {
  passed: boolean;
  exerciseName: string;
  summary: {
    labelFiles: number;
    splits: Partial<Record<DatasetSplit, number>>;
    groupingPolicy: 'subjectId' | 'sessionId' | 'invalid';
  };
  groupCounts: {
    subjects: Record<string, string[]>;
    sessions: Record<string, string[]>;
    cameraSetups: Record<string, string[]>;
  };
  issueSupportBySplit: Partial<Record<DatasetSplit, Record<string, number>>>;
  findings: MlAuditFinding[];
}

const SEVERITIES: RepIssueSeverity[] = ['none', 'mild', 'moderate', 'severe'];
const SPLITS: DatasetSplit[] = ['train', 'validation', 'test'];
const REQUIRED_REVIEWED_METADATA_FIELDS = [
  'captureMetadata.subjectId or captureMetadata.participantId',
  'captureMetadata.sessionId',
  'captureMetadata.cameraSetupId',
  'captureMetadata.reviewerConfidence',
];
const PLACEHOLDER_VALUES_TO_AVOID = [
  'subject-unknown',
  'session-unknown',
  'camera-setup-unknown',
  'unknown subject/session/camera grouping keys',
];

function finding(level: MlAuditLevel, code: string, path: string, message: string): MlAuditFinding {
  return { level, code, path, message };
}

function labelPath(reference: LabelFileReference, suffix = ''): string {
  return `${reference.labelPath ?? reference.label.sourceVideo}${suffix}`;
}

function subjectId(label: ExerciseLabelFile): string | undefined {
  return label.captureMetadata?.subjectId ?? label.captureMetadata?.participantId;
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function recordingSlug(label: ExerciseLabelFile): string {
  const withoutDirs = label.sourceVideo.split('/').pop() ?? label.sourceVideo;
  return withoutDirs.replace(/\.[^.]+$/, '');
}

function metadataConvention(): MlMetadataConvention {
  return {
    requiredReviewedFields: REQUIRED_REVIEWED_METADATA_FIELDS,
    existingConvention: {
      subjectId: 'Use a stable anonymized participant key that is consistent across recordings from the same participant. Avoid split-specific placeholder keys when the same person appears in multiple splits.',
      sessionId: 'Use a stable capture-session key. Existing Barbell Curl labels often use the recording slug when each recording is its own session.',
      cameraSetupId: 'Use a stable camera setup key. Existing per-recording Barbell Curl labels commonly use "<recording-slug>-camera".',
      reviewerConfidence: 'Use the reviewer confidence enum from the label schema: high, medium, low, or unknown.',
    },
    placeholderValuesToAvoid: PLACEHOLDER_VALUES_TO_AVOID,
  };
}

function metadataPatchWorkflow(): MlMetadataPatchWorkflow {
  return {
    format: 'json',
    dryRunCommand: 'npm run ml:patch-metadata -- --patch path/to/metadata-patch.json',
    applyCommand: 'npm run ml:patch-metadata -- --patch path/to/metadata-patch.json --apply',
    instructions: [
      'Copy metadataPatchTemplate from this audit report into a sidecar JSON file, or keep the whole audit report and pass it directly to the patch command.',
      'Replace null metadata values with manually verified values. The patch command refuses empty placeholder fields and defaults to dry-run mode.',
      'Use --apply only after reviewing the dry-run output. The patcher only updates captureMetadata and leaves reps, labels, timings, and reviewStatus unchanged.',
    ],
  };
}

function reviewedMetadataMissingFields(label: ExerciseLabelFile): string[] {
  const fields: string[] = [];
  if (!hasText(subjectId(label))) fields.push('subjectIdOrParticipantId');
  if (!hasText(label.captureMetadata?.sessionId)) fields.push('sessionId');
  if (!hasText(label.captureMetadata?.cameraSetupId)) fields.push('cameraSetupId');
  if (!hasText(label.captureMetadata?.reviewerConfidence)) fields.push('reviewerConfidence');
  return fields;
}

function buildMetadataPatchTemplateEntry(
  reference: LabelFileReference,
  missingFields: string[],
): MlMetadataPatchTemplateEntry {
  const { label } = reference;
  const slug = recordingSlug(label);
  return {
    labelPath: reference.labelPath ?? label.sourceVideo,
    sourceVideo: label.sourceVideo,
    split: label.split,
    reviewStatus: label.reviewStatus,
    missingFields,
    existingCaptureMetadata: label.captureMetadata ?? {},
    patch: {
      captureMetadata: {
        subjectId: missingFields.includes('subjectIdOrParticipantId') ? null : label.captureMetadata?.subjectId,
        participantId: label.captureMetadata?.participantId,
        sessionId: missingFields.includes('sessionId') ? null : label.captureMetadata?.sessionId,
        cameraSetupId: missingFields.includes('cameraSetupId') ? null : label.captureMetadata?.cameraSetupId,
        reviewerConfidence: missingFields.includes('reviewerConfidence') ? null : label.captureMetadata?.reviewerConfidence,
      },
    },
    notes: [
      'Fill values manually from recording provenance. Do not reuse subject/session/camera placeholders unless they are genuinely correct.',
      `Existing per-recording convention would make session/camera keys resemble "${slug}" and "${slug}-camera", but the audit does not auto-apply those values.`,
    ],
  };
}

function issueScorable(definition: ExerciseDefinition, view: RepViewLabel | undefined, scorable: boolean | undefined, issueId: string): boolean {
  if (scorable === false) return false;
  const policy = getExerciseLabelPolicy(definition.name);
  if (!policy) return true;
  if (!view) return false;
  return isIssueLabelableForView(policy, issueId, view);
}

function issueCountsFor(definition: ExerciseDefinition): MlLabelAuditReport['issueCounts'] {
  return Object.fromEntries(
    getLabelableIssues(definition).map((issue) => [
      issue.issueId,
      {
        positive: 0,
        negative: 0,
        severityCounts: { none: 0, mild: 0, moderate: 0, severe: 0 },
      },
    ]),
  );
}

export function buildMlLabelAuditReport(options: MlLabelAuditOptions): MlLabelAuditReport {
  const findings: MlAuditFinding[] = [];
  const issueCounts = issueCountsFor(options.definition);
  const minPositive = options.minPositivePerIssue ?? 1;
  const minNegative = options.minNegativePerIssue ?? 1;
  let reviewedFiles = 0;
  let draftFiles = 0;
  let reps = 0;
  let scorableReps = 0;
  let unscorableReps = 0;
  let reviewedFilesMissingMetadata = 0;
  const metadataPatchTemplate: MlMetadataPatchTemplateEntry[] = [];

  for (const reference of options.labels) {
    const { label } = reference;
    const isDraft = label.reviewStatus === 'draft';
    if (isDraft) draftFiles += 1;
    else reviewedFiles += 1;

    if (isDraft && !options.allowDrafts) {
      findings.push(finding('error', 'draft_label', labelPath(reference), 'Draft labels are not valid for production ML training or claims.'));
    }

    if (!isDraft) {
      const missingMetadataFields = reviewedMetadataMissingFields(label);
      if (missingMetadataFields.length > 0) {
        reviewedFilesMissingMetadata += 1;
        metadataPatchTemplate.push(buildMetadataPatchTemplateEntry(reference, missingMetadataFields));
      }
      if (missingMetadataFields.includes('subjectIdOrParticipantId')) {
        findings.push(finding('error', 'missing_subject_id', labelPath(reference, '.captureMetadata'), 'Reviewed labels must include captureMetadata.subjectId or participantId.'));
      }
      if (missingMetadataFields.includes('sessionId')) {
        findings.push(finding('error', 'missing_session_id', labelPath(reference, '.captureMetadata.sessionId'), 'Reviewed labels must include captureMetadata.sessionId.'));
      }
      if (missingMetadataFields.includes('cameraSetupId')) {
        findings.push(finding('error', 'missing_camera_setup_id', labelPath(reference, '.captureMetadata.cameraSetupId'), 'Reviewed labels must include captureMetadata.cameraSetupId.'));
      }
      if (missingMetadataFields.includes('reviewerConfidence')) {
        findings.push(finding('error', 'missing_reviewer_confidence', labelPath(reference, '.captureMetadata.reviewerConfidence'), 'Reviewed labels must include captureMetadata.reviewerConfidence.'));
      }
    }

    label.reps.forEach((rep, index) => {
      const repPath = labelPath(reference, `.reps[${index}]`);
      reps += 1;
      if (rep.scorable === false) unscorableReps += 1;
      else scorableReps += 1;

      if (rep.endMs <= rep.startMs) {
        findings.push(finding('error', 'invalid_rep_timing', repPath, 'Rep endMs must be greater than startMs.'));
      }
      if (rep.scorable === false && rep.issueIds.length === 0 && !hasText(rep.notes)) {
        findings.push(finding('warning', 'unscorable_clean_without_notes', repPath, 'Clean unscorable reps should include notes explaining why they are unscorable.'));
      }
      if (rep.scorable === false && rep.issueIds.length > 0) {
        findings.push(finding('error', 'unscorable_positive_issue', repPath, 'Unscorable reps should not include issueIds.'));
      }

      for (const issueId of Object.keys(issueCounts)) {
        if (!issueScorable(options.definition, rep.view, rep.scorable, issueId)) continue;
        if (rep.issueIds.includes(issueId)) issueCounts[issueId].positive += 1;
        else issueCounts[issueId].negative += 1;
      }

      for (const issueId of rep.issueIds) {
        if (!issueScorable(options.definition, rep.view, rep.scorable, issueId)) {
          findings.push(finding('error', 'issue_not_judgeable_from_view', repPath, `Issue ${issueId} is not judgeable from view=${rep.view ?? 'missing'} with scorable=${rep.scorable}.`));
        }
        const severity = rep.issueSeverities?.[issueId];
        if (options.requireSeverity && severity === undefined) {
          findings.push(finding('error', 'missing_issue_severity', `${repPath}.issueSeverities.${issueId}`, `Missing severity for labelled issue ${issueId}.`));
        }
        if (severity) issueCounts[issueId].severityCounts[severity] += 1;
      }
    });
  }

  for (const [issueId, counts] of Object.entries(issueCounts)) {
    if (counts.positive < minPositive) {
      findings.push(finding('warning', 'low_positive_support', `issue:${issueId}`, `Issue has ${counts.positive} positive examples; recommended minimum is ${minPositive}.`));
    }
    if (counts.negative < minNegative) {
      findings.push(finding('warning', 'low_negative_support', `issue:${issueId}`, `Issue has ${counts.negative} negative examples; recommended minimum is ${minNegative}.`));
    }
  }

  return {
    passed: findings.every((item) => item.level !== 'error'),
    exerciseName: options.definition.name,
    summary: {
      labelFiles: options.labels.length,
      reviewedFiles,
      draftFiles,
      reps,
      scorableReps,
      unscorableReps,
      reviewedFilesMissingMetadata,
    },
    issueCounts,
    metadataConvention: metadataConvention(),
    metadataPatchWorkflow: metadataPatchWorkflow(),
    metadataPatchTemplate,
    findings,
  };
}

function addSplit(map: Record<string, Set<DatasetSplit>>, key: string | undefined, split: DatasetSplit): void {
  if (!hasText(key)) return;
  const active = map[key] ?? new Set<DatasetSplit>();
  active.add(split);
  map[key] = active;
}

function serialiseSplitMap(map: Record<string, Set<DatasetSplit>>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(map).map(([key, splits]) => [key, Array.from(splits).sort()]),
  );
}

export function buildMlSplitAuditReport(options: MlSplitAuditOptions): MlSplitAuditReport {
  const findings: MlAuditFinding[] = [];
  const labels = options.includeDrafts
    ? options.labels
    : options.labels.filter((reference) => reference.label.reviewStatus !== 'draft');
  const subjects: Record<string, Set<DatasetSplit>> = {};
  const sessions: Record<string, Set<DatasetSplit>> = {};
  const cameraSetups: Record<string, Set<DatasetSplit>> = {};
  const splits: Partial<Record<DatasetSplit, number>> = {};
  const issueSupportBySplit: Partial<Record<DatasetSplit, Record<string, number>>> = {};
  const allIssues = getLabelableIssues(options.definition).map((issue) => issue.issueId);

  if (labels.length === 0) {
    findings.push(finding('error', 'no_reviewed_labels', '$', 'No reviewed labels available for split audit.'));
  }

  for (const reference of labels) {
    const { label } = reference;
    splits[label.split] = (splits[label.split] ?? 0) + 1;
    addSplit(subjects, subjectId(label), label.split);
    addSplit(sessions, label.captureMetadata?.sessionId, label.split);
    addSplit(cameraSetups, label.captureMetadata?.cameraSetupId, label.split);

    if (!hasText(subjectId(label)) && !hasText(label.captureMetadata?.sessionId)) {
      findings.push(finding('error', 'missing_grouping_key', labelPath(reference, '.captureMetadata'), 'Label needs subjectId/participantId or sessionId for grouped holdout evaluation.'));
    }

    const splitIssues = issueSupportBySplit[label.split] ?? {};
    issueSupportBySplit[label.split] = splitIssues;
    for (const rep of label.reps) {
      for (const issueId of rep.issueIds) {
        splitIssues[issueId] = (splitIssues[issueId] ?? 0) + 1;
      }
    }
  }

  for (const [key, splitSet] of Object.entries(subjects)) {
    if (splitSet.has('train') && splitSet.has('test')) {
      findings.push(finding('error', 'subject_train_test_leakage', `subject:${key}`, 'Same subject appears in both train and test.'));
    }
  }
  for (const [key, splitSet] of Object.entries(sessions)) {
    if (splitSet.size > 1) {
      findings.push(finding('error', 'session_split_leakage', `session:${key}`, 'Same session appears across multiple splits.'));
    }
  }
  if (!options.allowCameraSetupAcrossSplits) {
    for (const [key, splitSet] of Object.entries(cameraSetups)) {
      if (splitSet.size > 1) {
        findings.push(finding('error', 'camera_setup_split_leakage', `cameraSetup:${key}`, 'Same camera setup appears across multiple splits.'));
      }
    }
  }

  const presentSplits = SPLITS.filter((split) => (splits[split] ?? 0) > 0);
  for (const issueId of allIssues) {
    for (const split of presentSplits) {
      if ((issueSupportBySplit[split]?.[issueId] ?? 0) === 0) {
        findings.push(finding('error', 'zero_issue_support_in_split', `issue:${issueId}:${split}`, `Issue has zero positive examples in ${split}.`));
      }
    }
  }

  const groupingPolicy = Object.keys(subjects).length > 0
    ? 'subjectId'
    : Object.keys(sessions).length > 0
      ? 'sessionId'
      : 'invalid';
  if (groupingPolicy === 'invalid') {
    findings.push(finding('error', 'invalid_grouping_policy', '$.captureMetadata', 'No subjectId/participantId or sessionId grouping policy is available.'));
  }

  return {
    passed: findings.every((item) => item.level !== 'error'),
    exerciseName: options.definition.name,
    summary: {
      labelFiles: labels.length,
      splits,
      groupingPolicy,
    },
    groupCounts: {
      subjects: serialiseSplitMap(subjects),
      sessions: serialiseSplitMap(sessions),
      cameraSetups: serialiseSplitMap(cameraSetups),
    },
    issueSupportBySplit,
    findings,
  };
}
