import type {
  DatasetCase,
  DatasetSplit,
  ExerciseLabelFile,
  RepLabel,
  ValidationIssue,
} from './types';

const VALID_SPLITS: DatasetSplit[] = ['train', 'validation', 'test'];
const VALID_REVIEW_STATUSES = ['draft', 'reviewed'];
const VALID_CAPTURE_CAMERA_SIDES = ['left', 'right', 'oblique', 'frontish', 'unknown'];
const VALID_CAPTURE_CAMERA_VIEWS = ['front', 'frontish', 'oblique', 'side', 'unknown'];
const VALID_CAPTURE_MACHINE_STYLES = ['seated_selectorized', 'kneeling', 'plate_loaded', 'unknown'];
const VALID_CAPTURE_VISIBLE_HANDLES = ['yes', 'no', 'partial', 'unknown'];
const VALID_REVIEWER_VIEW_CONFIDENCES = ['good', 'usable', 'poor'];
const VALID_REP_VIEWS = ['side', 'front', 'oblique', 'unknown'];
const REVIEWED_REP_METADATA_REQUIRED_EXERCISES = new Set(['Barbell Curl', 'Push-Up', 'Barbell Squat', 'Standing Dumbbell Lateral Raises', 'Cable Row', 'Cable Lat Pulldowns', 'Leg Extensions']);
const REVIEWED_KNOWN_VIEW_REQUIRED_WHEN_SCORABLE = new Set(['Barbell Curl', 'Push-Up', 'Barbell Squat', 'Cable Row', 'Cable Lat Pulldowns', 'Leg Extensions']);
const REVIEWED_SIDE_VIEW_REQUIRED_WHEN_SCORABLE = new Set(['Push-Up', 'Barbell Squat', 'Cable Row', 'Cable Lat Pulldowns', 'Leg Extensions']);
const REVIEWED_FRONT_VIEW_REQUIRED_WHEN_SCORABLE = new Set(['Standing Dumbbell Lateral Raises']);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function exerciseList(exercises: Set<string>): string {
  return Array.from(exercises).join(' or ');
}

export function validateLabelFile(
  value: unknown,
  knownIssueIds?: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isObject(value)) {
    return [{ path: '$', message: 'Label file must be a JSON object.' }];
  }

  if (value.schemaVersion !== 1) {
    issues.push({ path: '$.schemaVersion', message: 'schemaVersion must be 1.' });
  }
  if (typeof value.exerciseName !== 'string' || value.exerciseName.trim() === '') {
    issues.push({ path: '$.exerciseName', message: 'exerciseName is required.' });
  }
  if (typeof value.sourceVideo !== 'string' || value.sourceVideo.trim() === '') {
    issues.push({ path: '$.sourceVideo', message: 'sourceVideo is required.' });
  }
  if (!VALID_SPLITS.includes(value.split as DatasetSplit)) {
    issues.push({ path: '$.split', message: 'split must be train, validation, or test.' });
  }
  if (
    value.reviewStatus !== undefined &&
    !VALID_REVIEW_STATUSES.includes(value.reviewStatus as string)
  ) {
    issues.push({ path: '$.reviewStatus', message: 'reviewStatus must be draft or reviewed.' });
  }
  if (!Number.isInteger(value.expectedReps) || (value.expectedReps as number) < 0) {
    issues.push({ path: '$.expectedReps', message: 'expectedReps must be a non-negative integer.' });
  }
  if (value.labelingGuidance !== undefined && !isStringArray(value.labelingGuidance)) {
    issues.push({ path: '$.labelingGuidance', message: 'labelingGuidance must be an array of strings.' });
  }
  if (value.captureMetadata !== undefined) {
    if (!isObject(value.captureMetadata)) {
      issues.push({ path: '$.captureMetadata', message: 'captureMetadata must be an object.' });
    } else {
      const metadata = value.captureMetadata;
      if (
        metadata.cameraSide !== undefined &&
        !VALID_CAPTURE_CAMERA_SIDES.includes(metadata.cameraSide as string)
      ) {
        issues.push({ path: '$.captureMetadata.cameraSide', message: 'cameraSide must be left, right, oblique, frontish, or unknown.' });
      }
      if (
        metadata.cameraView !== undefined &&
        !VALID_CAPTURE_CAMERA_VIEWS.includes(metadata.cameraView as string)
      ) {
        issues.push({ path: '$.captureMetadata.cameraView', message: 'cameraView must be front, frontish, oblique, side, or unknown.' });
      }
      if (
        metadata.machineStyle !== undefined &&
        !VALID_CAPTURE_MACHINE_STYLES.includes(metadata.machineStyle as string)
      ) {
        issues.push({ path: '$.captureMetadata.machineStyle', message: 'machineStyle must be seated_selectorized, kneeling, plate_loaded, or unknown.' });
      }
      if (
        metadata.visibleHandles !== undefined &&
        !VALID_CAPTURE_VISIBLE_HANDLES.includes(metadata.visibleHandles as string)
      ) {
        issues.push({ path: '$.captureMetadata.visibleHandles', message: 'visibleHandles must be yes, no, partial, or unknown.' });
      }
      if (
        metadata.reviewerViewConfidence !== undefined &&
        !VALID_REVIEWER_VIEW_CONFIDENCES.includes(metadata.reviewerViewConfidence as string)
      ) {
        issues.push({ path: '$.captureMetadata.reviewerViewConfidence', message: 'reviewerViewConfidence must be good, usable, or poor.' });
      }
    }
  }
  if (value.availableIssues !== undefined) {
    if (!Array.isArray(value.availableIssues)) {
      issues.push({ path: '$.availableIssues', message: 'availableIssues must be an array.' });
    } else {
      value.availableIssues.forEach((issue: unknown, index: number) => {
        const path = `$.availableIssues[${index}]`;
        if (!isObject(issue)) {
          issues.push({ path, message: 'availableIssues entries must be objects.' });
          return;
        }
        if (typeof issue.issueId !== 'string' || issue.issueId.trim() === '') {
          issues.push({ path: `${path}.issueId`, message: 'issueId is required.' });
        } else if (knownIssueIds && !knownIssueIds.has(issue.issueId)) {
          issues.push({ path: `${path}.issueId`, message: `Unknown issue id "${issue.issueId}".` });
        }
        if (typeof issue.feedbackMessage !== 'string' || issue.feedbackMessage.trim() === '') {
          issues.push({ path: `${path}.feedbackMessage`, message: 'feedbackMessage is required.' });
        }
      });
    }
  }
  if (!Array.isArray(value.reps)) {
    issues.push({ path: '$.reps', message: 'reps must be an array.' });
    return issues;
  }

  const expectedReps = typeof value.expectedReps === 'number' ? value.expectedReps : NaN;
  if (Number.isInteger(expectedReps) && value.reps.length !== expectedReps) {
    issues.push({
      path: '$.reps',
      message: `reps length (${value.reps.length}) must match expectedReps (${expectedReps}).`,
    });
  }

  let previousEndMs = -Infinity;
  const seenIndexes = new Set<number>();

  const requiresReviewedRepMetadata =
    value.reviewStatus === 'reviewed' &&
    typeof value.exerciseName === 'string' &&
    REVIEWED_REP_METADATA_REQUIRED_EXERCISES.has(value.exerciseName);

  value.reps.forEach((rep: unknown, zeroBasedIndex: number) => {
    const path = `$.reps[${zeroBasedIndex}]`;
    if (!isObject(rep)) {
      issues.push({ path, message: 'Rep label must be an object.' });
      return;
    }

    const index = rep.index;
    if (!Number.isInteger(index) || (index as number) < 1) {
      issues.push({ path: `${path}.index`, message: 'index must be a positive integer.' });
    } else {
      if (seenIndexes.has(index as number)) {
        issues.push({ path: `${path}.index`, message: `duplicate rep index ${index}.` });
      }
      seenIndexes.add(index as number);
      if (index !== zeroBasedIndex + 1) {
        issues.push({
          path: `${path}.index`,
          message: `index should be ${zeroBasedIndex + 1} for sequential per-rep labels.`,
        });
      }
    }

    if (!isNonNegativeNumber(rep.startMs)) {
      issues.push({ path: `${path}.startMs`, message: 'startMs must be a non-negative number.' });
    }
    if (!isNonNegativeNumber(rep.endMs)) {
      issues.push({ path: `${path}.endMs`, message: 'endMs must be a non-negative number.' });
    }
    if (
      isNonNegativeNumber(rep.startMs) &&
      isNonNegativeNumber(rep.endMs) &&
      rep.endMs <= rep.startMs
    ) {
      issues.push({ path, message: 'endMs must be greater than startMs.' });
    }
    if (isNonNegativeNumber(rep.startMs) && rep.startMs < previousEndMs) {
      issues.push({ path, message: 'Rep windows must not overlap or go backward.' });
    }
    if (isNonNegativeNumber(rep.endMs)) {
      previousEndMs = rep.endMs;
    }

    if (!isStringArray(rep.issueIds)) {
      issues.push({ path: `${path}.issueIds`, message: 'issueIds must be an array of strings.' });
    } else if (knownIssueIds) {
      for (const issueId of rep.issueIds) {
        if (!knownIssueIds.has(issueId)) {
          issues.push({ path: `${path}.issueIds`, message: `Unknown issue id "${issueId}".` });
        }
      }
    }

    if (requiresReviewedRepMetadata && rep.view === undefined) {
      issues.push({
        path: `${path}.view`,
        message: `reviewed ${exerciseList(REVIEWED_REP_METADATA_REQUIRED_EXERCISES)} reps must include view.`,
      });
    }
    if (rep.view !== undefined && !VALID_REP_VIEWS.includes(rep.view as string)) {
      issues.push({ path: `${path}.view`, message: 'view must be side, front, oblique, or unknown.' });
    }
    if (
      value.reviewStatus === 'reviewed' &&
      typeof value.exerciseName === 'string' &&
      REVIEWED_KNOWN_VIEW_REQUIRED_WHEN_SCORABLE.has(value.exerciseName) &&
      rep.scorable === true &&
      rep.view === 'unknown'
    ) {
      issues.push({
        path: `${path}.view`,
        message: `reviewed scorable ${exerciseList(REVIEWED_KNOWN_VIEW_REQUIRED_WHEN_SCORABLE)} reps must use front, side, or oblique view; use scorable=false when view is unknown.`,
      });
    }
    if (
      value.reviewStatus === 'reviewed' &&
      typeof value.exerciseName === 'string' &&
      REVIEWED_SIDE_VIEW_REQUIRED_WHEN_SCORABLE.has(value.exerciseName) &&
      rep.scorable === true &&
      rep.view !== undefined &&
      rep.view !== 'side'
    ) {
      issues.push({
        path: `${path}.view`,
        message: `reviewed scorable ${exerciseList(REVIEWED_SIDE_VIEW_REQUIRED_WHEN_SCORABLE)} reps must use side view; use scorable=false for front, oblique, or unknown views.`,
      });
    }
    if (
      value.reviewStatus === 'reviewed' &&
      typeof value.exerciseName === 'string' &&
      REVIEWED_FRONT_VIEW_REQUIRED_WHEN_SCORABLE.has(value.exerciseName) &&
      rep.scorable === true &&
      rep.view !== undefined &&
      rep.view !== 'front'
    ) {
      issues.push({
        path: `${path}.view`,
        message: `reviewed scorable ${exerciseList(REVIEWED_FRONT_VIEW_REQUIRED_WHEN_SCORABLE)} reps must use front view; use scorable=false for side, oblique, or unknown views.`,
      });
    }
    if (requiresReviewedRepMetadata && rep.scorable === undefined) {
      issues.push({
        path: `${path}.scorable`,
        message: `reviewed ${exerciseList(REVIEWED_REP_METADATA_REQUIRED_EXERCISES)} reps must include scorable.`,
      });
    }
    if (rep.scorable !== undefined && typeof rep.scorable !== 'boolean') {
      issues.push({ path: `${path}.scorable`, message: 'scorable must be a boolean when provided.' });
    }

    if (rep.suggestedIssueIds !== undefined) {
      if (!isStringArray(rep.suggestedIssueIds)) {
        issues.push({ path: `${path}.suggestedIssueIds`, message: 'suggestedIssueIds must be an array of strings.' });
      } else if (knownIssueIds) {
        for (const issueId of rep.suggestedIssueIds) {
          if (!knownIssueIds.has(issueId)) {
            issues.push({ path: `${path}.suggestedIssueIds`, message: `Unknown issue id "${issueId}".` });
          }
        }
      }
    }
    if (
      rep.suggestedFeedbackMessages !== undefined &&
      !isStringArray(rep.suggestedFeedbackMessages)
    ) {
      issues.push({
        path: `${path}.suggestedFeedbackMessages`,
        message: 'suggestedFeedbackMessages must be an array of strings.',
      });
    }
    if (
      rep.suggestedScore !== undefined &&
      (!isFiniteNumber(rep.suggestedScore) || rep.suggestedScore < 0 || rep.suggestedScore > 100)
    ) {
      issues.push({
        path: `${path}.suggestedScore`,
        message: 'suggestedScore must be a number between 0 and 100.',
      });
    }
  });

  return issues;
}

export function assertValidLabelFile(
  value: unknown,
  knownIssueIds?: Set<string>,
): asserts value is ExerciseLabelFile {
  const issues = validateLabelFile(value, knownIssueIds);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  }
}

export function validateDatasetCase(
  datasetCase: DatasetCase,
  knownIssueIds?: Set<string>,
): ValidationIssue[] {
  const issues = validateLabelFile(datasetCase.label, knownIssueIds);
  if (datasetCase.recording.exerciseName !== datasetCase.label.exerciseName) {
    issues.push({
      path: '$.exerciseName',
      message: `Label exerciseName "${datasetCase.label.exerciseName}" does not match recording exerciseName "${datasetCase.recording.exerciseName}".`,
    });
  }

  const expectedReps = datasetCase.recording.metadata?.expectedReps;
  if (
    typeof expectedReps === 'number' &&
    expectedReps > 0 &&
    expectedReps !== datasetCase.label.expectedReps
  ) {
    issues.push({
      path: '$.expectedReps',
      message: `Label expectedReps ${datasetCase.label.expectedReps} does not match recording metadata expectedReps ${expectedReps}.`,
    });
  }

  return issues;
}

export function getLabelDurationMs(reps: RepLabel[]): number {
  return reps.length === 0 ? 0 : Math.max(...reps.map((rep) => rep.endMs));
}
