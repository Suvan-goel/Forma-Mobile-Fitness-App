import * as fs from 'fs';
import * as path from 'path';

import type {
  DatasetSplit,
  ExerciseLabelFile,
  RepLabel,
} from '../src/utils/exercises/dataset';
import { slugifyExerciseName } from '../src/utils/exercises/replay';
import {
  DATASET_ROOT,
  isDraftLabel,
  isTemplateLabelFile,
  listJsonFiles,
  readJson,
} from './dataset-common';

type ParsedArgs = Record<string, string | boolean>;
type SplitCounts = Record<DatasetSplit, number>;
type FindingSeverity = 'error' | 'warning';

const SPLITS: DatasetSplit[] = ['train', 'validation', 'test'];
const DEFAULT_PLAN_FILE = 'recording-plan.reliable-v1.json';

interface RecordingTypePlan {
  id: string;
  counts: SplitCounts;
  reps: number;
  description: string;
}

interface ExerciseRecordingPlan {
  name: string;
  slug: string;
  scorableView: string;
  notes?: string;
  detailedProtocol?: string;
  recordingTypeCounts?: Partial<Record<string, SplitCounts>>;
  partialViewCounts?: SplitCounts;
  issueFocusAllocation: Record<string, SplitCounts>;
  multiIssueRecipes: Record<string, string[]>;
  combinedFaultPairs: string[][];
}

interface RecordingPlan {
  id: string;
  target: {
    recordingsPerExercise: number;
    totalRecordings: number;
    splits: SplitCounts;
    minimumReviewedRepsPerExercise: number;
    minimumCleanScorableRepsPerExercise: number;
    minimumUnscorableRepsPerExercise: number;
    minimumIssuePositiveRepsPerSplit: SplitCounts;
  };
  recordingTypes: RecordingTypePlan[];
  exercises: ExerciseRecordingPlan[];
}

interface LabelReference {
  labelPath: string;
  label: ExerciseLabelFile;
}

interface ExerciseCounts {
  reviewedRecordings: SplitCounts;
  reviewedReps: number;
  cleanScorableReps: number;
  unscorableReps: number;
  draftRecordings: number;
  missingLandmarkRecordings: number;
  missingRepMetadataReps: number;
  issuePositiveReps: Record<string, SplitCounts>;
  unscorablePositiveIssueReps: number;
  unknownPositiveIssueReps: Record<string, number>;
}

interface Finding {
  severity: FindingSeverity;
  exercise: string;
  code: string;
  message: string;
}

interface AuditReport {
  planId: string;
  targetRecordings: number;
  reviewedRecordings: number;
  draftRecordings: number;
  findings: Finding[];
  exercises: Array<{
    name: string;
    slug: string;
    reviewedRecordings: SplitCounts;
    reviewedReps: number;
    cleanScorableReps: number;
    unscorableReps: number;
    draftRecordings: number;
    missingLandmarkRecordings: number;
    missingRepMetadataReps: number;
    missingIssuePositiveReps: Array<{
      issueId: string;
      split: DatasetSplit;
      actual: number;
      required: number;
    }>;
  }>;
  passed: boolean;
}

interface ChecklistRow {
  exercise: string;
  slug: string;
  split: DatasetSplit;
  recordingId: string;
  recordingType: string;
  reps: number;
  view: string;
  scorable: string;
  targetIssues: string;
  instructions: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function stringArg(args: ParsedArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function usage(): string {
  return [
    'Usage:',
    '  npm run dataset:recording-plan',
    '  npm run dataset:recording-plan -- --checklist [--exercise "Push-Up"]',
    '',
    'Options:',
    '  --dataset-root  Dataset root. Defaults to datasets/form-heuristics.',
    `  --plan          Recording-plan JSON. Defaults to <dataset-root>/${DEFAULT_PLAN_FILE}.`,
    '  --exercise      Exercise name or slug filter.',
    '  --checklist     Print the expanded recording checklist as CSV.',
    '  --out           Write checklist CSV to this path instead of stdout.',
    '  --json          Print audit report JSON.',
    '  --no-fail       Do not exit non-zero when the audit finds missing coverage.',
  ].join('\n');
}

function resolveDatasetRoot(args: ParsedArgs): string {
  return path.resolve(process.cwd(), stringArg(args, 'dataset-root') ?? DATASET_ROOT);
}

function resolvePlanPath(args: ParsedArgs, datasetRoot: string): string {
  return path.resolve(
    process.cwd(),
    stringArg(args, 'plan') ?? path.join(datasetRoot, DEFAULT_PLAN_FILE),
  );
}

function emptySplitCounts(): SplitCounts {
  return { train: 0, validation: 0, test: 0 };
}

function addToSplit(counts: SplitCounts, split: DatasetSplit, amount = 1): void {
  counts[split] += amount;
}

function isDatasetSplit(value: unknown): value is DatasetSplit {
  return value === 'train' || value === 'validation' || value === 'test';
}

function loadLabelReferences(datasetRoot: string): LabelReference[] {
  const labelsRoot = path.join(datasetRoot, 'labels');
  return listJsonFiles(labelsRoot)
    .filter((labelPath) => !isTemplateLabelFile(labelPath))
    .map((labelPath) => ({ labelPath, label: readJson<ExerciseLabelFile>(labelPath) }));
}

function buildLandmarkBaseIndex(datasetRoot: string): Set<string> {
  return new Set(
    listJsonFiles(path.join(datasetRoot, 'landmarks'))
      .map((filePath) => path.basename(filePath, '.json')),
  );
}

function hasMatchingLandmarks(reference: LabelReference, datasetRoot: string, landmarkBaseIndex: Set<string>): boolean {
  const candidates: string[] = [];
  if (reference.label.landmarkFile) {
    candidates.push(path.resolve(datasetRoot, reference.label.landmarkFile));
    candidates.push(path.resolve(path.dirname(reference.labelPath), reference.label.landmarkFile));
  }
  const sourceBase = path.basename(reference.label.sourceVideo, path.extname(reference.label.sourceVideo));
  candidates.push(path.join(datasetRoot, 'landmarks', `${sourceBase}.json`));
  return candidates.some((candidate) => fs.existsSync(candidate)) || landmarkBaseIndex.has(sourceBase);
}

function matchesExercise(plan: ExerciseRecordingPlan, filter?: string): boolean {
  if (!filter) return true;
  const normalized = slugifyExerciseName(filter);
  return normalized === plan.slug || normalized === slugifyExerciseName(plan.name);
}

function labelMatchesExercise(label: ExerciseLabelFile, plan: ExerciseRecordingPlan): boolean {
  return label.exerciseName === plan.name || slugifyExerciseName(label.exerciseName) === plan.slug;
}

function getIssuePositiveCounts(counts: ExerciseCounts, issueId: string): SplitCounts {
  counts.issuePositiveReps[issueId] ??= emptySplitCounts();
  return counts.issuePositiveReps[issueId];
}

function buildExerciseCounts(
  plan: ExerciseRecordingPlan,
  references: LabelReference[],
  datasetRoot: string,
  landmarkBaseIndex: Set<string>,
): ExerciseCounts {
  const planIssues = new Set(Object.keys(plan.issueFocusAllocation));
  const counts: ExerciseCounts = {
    reviewedRecordings: emptySplitCounts(),
    reviewedReps: 0,
    cleanScorableReps: 0,
    unscorableReps: 0,
    draftRecordings: 0,
    missingLandmarkRecordings: 0,
    missingRepMetadataReps: 0,
    issuePositiveReps: {},
    unscorablePositiveIssueReps: 0,
    unknownPositiveIssueReps: {},
  };

  for (const issueId of planIssues) {
    counts.issuePositiveReps[issueId] = emptySplitCounts();
  }

  for (const reference of references) {
    if (!labelMatchesExercise(reference.label, plan)) continue;
    if (isDraftLabel(reference.label)) {
      counts.draftRecordings += 1;
      continue;
    }
    if (!isDatasetSplit(reference.label.split)) continue;
    if (!hasMatchingLandmarks(reference, datasetRoot, landmarkBaseIndex)) {
      counts.missingLandmarkRecordings += 1;
      continue;
    }

    addToSplit(counts.reviewedRecordings, reference.label.split);
    counts.reviewedReps += reference.label.reps.length;

    for (const rep of reference.label.reps) {
      const issueIds = Array.isArray(rep.issueIds) ? rep.issueIds : [];
      if (!hasReviewedRepMetadata(rep)) {
        counts.missingRepMetadataReps += 1;
      }
      if (rep.scorable === false) {
        counts.unscorableReps += 1;
        if (issueIds.length > 0) counts.unscorablePositiveIssueReps += 1;
      } else if (rep.scorable === true && issueIds.length === 0) {
        counts.cleanScorableReps += 1;
      }

      if (rep.scorable !== true) continue;
      for (const issueId of issueIds) {
        if (!planIssues.has(issueId)) {
          counts.unknownPositiveIssueReps[issueId] = (counts.unknownPositiveIssueReps[issueId] ?? 0) + 1;
          continue;
        }
        addToSplit(getIssuePositiveCounts(counts, issueId), reference.label.split);
      }
    }
  }

  return counts;
}

function hasReviewedRepMetadata(rep: RepLabel): boolean {
  return rep.view !== undefined && rep.scorable !== undefined;
}

function reviewedTotal(counts: SplitCounts): number {
  return SPLITS.reduce((total, split) => total + counts[split], 0);
}

function addFinding(
  findings: Finding[],
  severity: FindingSeverity,
  exercise: string,
  code: string,
  message: string,
): void {
  findings.push({ severity, exercise, code, message });
}

function buildAuditReport(
  plan: RecordingPlan,
  references: LabelReference[],
  datasetRoot: string,
  exerciseFilter?: string,
): AuditReport {
  const findings: Finding[] = [];
  const exerciseReports: AuditReport['exercises'] = [];
  const landmarkBaseIndex = buildLandmarkBaseIndex(datasetRoot);
  let reviewedRecordings = 0;
  let draftRecordings = 0;

  for (const exercise of plan.exercises.filter((candidate) => matchesExercise(candidate, exerciseFilter))) {
    const counts = buildExerciseCounts(exercise, references, datasetRoot, landmarkBaseIndex);
    reviewedRecordings += reviewedTotal(counts.reviewedRecordings);
    draftRecordings += counts.draftRecordings;

    for (const split of SPLITS) {
      const actual = counts.reviewedRecordings[split];
      const required = plan.target.splits[split];
      if (actual < required) {
        addFinding(
          findings,
          'error',
          exercise.name,
          'missing_reviewed_recordings',
          `${split} has ${actual}/${required} reviewed recording(s).`,
        );
      }
    }

    if (reviewedTotal(counts.reviewedRecordings) < plan.target.recordingsPerExercise) {
      addFinding(
        findings,
        'error',
        exercise.name,
        'missing_total_recordings',
        `Total reviewed recordings ${reviewedTotal(counts.reviewedRecordings)}/${plan.target.recordingsPerExercise}.`,
      );
    }

    if (counts.reviewedReps < plan.target.minimumReviewedRepsPerExercise) {
      addFinding(
        findings,
        'error',
        exercise.name,
        'low_reviewed_reps',
        `Reviewed reps ${counts.reviewedReps}/${plan.target.minimumReviewedRepsPerExercise}.`,
      );
    }

    if (counts.cleanScorableReps < plan.target.minimumCleanScorableRepsPerExercise) {
      addFinding(
        findings,
        'error',
        exercise.name,
        'low_clean_scorable_reps',
        `Clean scorable reps ${counts.cleanScorableReps}/${plan.target.minimumCleanScorableRepsPerExercise}.`,
      );
    }

    if (counts.unscorableReps < plan.target.minimumUnscorableRepsPerExercise) {
      addFinding(
        findings,
        'error',
        exercise.name,
        'low_unscorable_reps',
        `Unscorable/view-quality reps ${counts.unscorableReps}/${plan.target.minimumUnscorableRepsPerExercise}.`,
      );
    }

    if (counts.draftRecordings > 0) {
      addFinding(
        findings,
        'warning',
        exercise.name,
        'draft_recordings_ignored',
        `${counts.draftRecordings} draft recording label(s) do not count toward reliable-v1 coverage.`,
      );
    }

    if (counts.missingLandmarkRecordings > 0) {
      addFinding(
        findings,
        'error',
        exercise.name,
        'missing_landmarks',
        `${counts.missingLandmarkRecordings} reviewed label file(s) are missing matching landmark JSON and do not count.`,
      );
    }

    if (counts.missingRepMetadataReps > 0) {
      addFinding(
        findings,
        'error',
        exercise.name,
        'missing_reviewed_rep_metadata',
        `${counts.missingRepMetadataReps} reviewed rep(s) are missing view or scorable metadata.`,
      );
    }

    if (counts.unscorablePositiveIssueReps > 0) {
      addFinding(
        findings,
        'error',
        exercise.name,
        'unscorable_positive_issues',
        `${counts.unscorablePositiveIssueReps} unscorable rep(s) have positive issueIds.`,
      );
    }

    for (const [issueId, count] of Object.entries(counts.unknownPositiveIssueReps)) {
      addFinding(
        findings,
        'warning',
        exercise.name,
        'unknown_plan_issue',
        `${issueId} appears ${count} time(s) but is not part of the reliable-v1 issue plan.`,
      );
    }

    const missingIssuePositiveReps: AuditReport['exercises'][number]['missingIssuePositiveReps'] = [];
    for (const issueId of Object.keys(exercise.issueFocusAllocation)) {
      const issueCounts = getIssuePositiveCounts(counts, issueId);
      for (const split of SPLITS) {
        const actual = issueCounts[split];
        const required = plan.target.minimumIssuePositiveRepsPerSplit[split];
        if (actual < required) {
          missingIssuePositiveReps.push({ issueId, split, actual, required });
          addFinding(
            findings,
            'error',
            exercise.name,
            'missing_issue_split_support',
            `${issueId} has ${actual}/${required} positive ${split} rep(s).`,
          );
        }
      }
    }

    exerciseReports.push({
      name: exercise.name,
      slug: exercise.slug,
      reviewedRecordings: counts.reviewedRecordings,
      reviewedReps: counts.reviewedReps,
      cleanScorableReps: counts.cleanScorableReps,
      unscorableReps: counts.unscorableReps,
      draftRecordings: counts.draftRecordings,
      missingLandmarkRecordings: counts.missingLandmarkRecordings,
      missingRepMetadataReps: counts.missingRepMetadataReps,
      missingIssuePositiveReps,
    });
  }

  const errors = findings.filter((finding) => finding.severity === 'error').length;
  return {
    planId: plan.id,
    targetRecordings: exerciseFilter
      ? plan.target.recordingsPerExercise
      : plan.target.totalRecordings,
    reviewedRecordings,
    draftRecordings,
    findings,
    exercises: exerciseReports,
    passed: errors === 0,
  };
}

function splitCode(split: DatasetSplit): string {
  return split === 'validation' ? 'val' : split;
}

function getRecordingType(plan: RecordingPlan, id: string): RecordingTypePlan {
  const recordingType = plan.recordingTypes.find((candidate) => candidate.id === id);
  if (!recordingType) throw new Error(`Recording plan is missing recording type "${id}".`);
  return recordingType;
}

function recordingTypeCounts(plan: RecordingPlan, exercise: ExerciseRecordingPlan, id: string): SplitCounts {
  return exercise.recordingTypeCounts?.[id] ?? getRecordingType(plan, id).counts;
}

function targetIssuesText(issues: string[]): string {
  return issues.join('; ');
}

function pairText(pairs: string[][]): string {
  return pairs.map((pair) => pair.join(' + ')).join(' | ');
}

function addRepeatedRows(
  rows: ChecklistRow[],
  exercise: ExerciseRecordingPlan,
  counters: SplitCounts,
  split: DatasetSplit,
  recordingType: string,
  count: number,
  build: (index: number) => Omit<ChecklistRow, 'exercise' | 'slug' | 'split' | 'recordingId' | 'recordingType'>,
): void {
  for (let index = 1; index <= count; index += 1) {
    counters[split] += 1;
    const recordingId = `${splitCode(split)}${String(counters[split]).padStart(2, '0')}-${recordingType}`;
    rows.push({
      exercise: exercise.name,
      slug: exercise.slug,
      split,
      recordingId,
      recordingType,
      ...build(index),
    });
  }
}

function expandChecklist(plan: RecordingPlan, exerciseFilter?: string): ChecklistRow[] {
  const rows: ChecklistRow[] = [];
  const exerciseRank = new Map(plan.exercises.map((exercise, index) => [exercise.slug, index]));
  const splitRank: Record<DatasetSplit, number> = { train: 0, validation: 1, test: 2 };

  for (const exercise of plan.exercises.filter((candidate) => matchesExercise(candidate, exerciseFilter))) {
    const counters = emptySplitCounts();
    const clean = getRecordingType(plan, 'clean_baseline');
    const hardNegative = getRecordingType(plan, 'hard_negative_clean');
    const viewQuality = getRecordingType(plan, 'view_quality_robustness');
    const combined = getRecordingType(plan, 'combined_realistic_faults');
    const cleanCounts = recordingTypeCounts(plan, exercise, 'clean_baseline');
    const hardNegativeCounts = recordingTypeCounts(plan, exercise, 'hard_negative_clean');
    const viewQualityCounts = recordingTypeCounts(plan, exercise, 'view_quality_robustness');
    const combinedCounts = recordingTypeCounts(plan, exercise, 'combined_realistic_faults');

    for (const split of SPLITS) {
      addRepeatedRows(rows, exercise, counters, split, 'clean-baseline', cleanCounts[split], () => ({
        reps: clean.reps,
        view: exercise.scorableView,
        scorable: 'true',
        targetIssues: '',
        instructions: 'All reps clean with full visible target joints. Label issueIds: [].',
      }));
    }

    for (const [issueId, allocation] of Object.entries(exercise.issueFocusAllocation)) {
      for (const split of SPLITS) {
        addRepeatedRows(rows, exercise, counters, split, `issue-focus-${issueId}`, allocation[split], () => ({
          reps: getRecordingType(plan, 'issue_focus').reps,
          view: exercise.scorableView,
          scorable: 'true',
          targetIssues: issueId,
          instructions: `Rep 1 clean; reps 2-3 mild ${issueId}; reps 4-5 clear ${issueId}; rep 6 clean.`,
        }));
      }
    }

    const recipeEntries = Object.entries(exercise.multiIssueRecipes).sort(([left], [right]) => left.localeCompare(right));
    const recipePlanBySplit: Record<DatasetSplit, Array<[string, string[]]>> = {
      train: recipeEntries,
      validation: recipeEntries.slice(0, 2),
      test: recipeEntries.slice(2, 4),
    };
    for (const split of SPLITS) {
      for (const [recipeId, issues] of recipePlanBySplit[split]) {
        addRepeatedRows(rows, exercise, counters, split, `multi-issue-${recipeId}`, 1, () => ({
          reps: getRecordingType(plan, 'multi_issue').reps,
          view: exercise.scorableView,
          scorable: 'true',
          targetIssues: targetIssuesText(issues),
          instructions: `Reps 1 and 10 clean. Each listed issue appears on exactly two reps: ${targetIssuesText(issues)}.`,
        }));
      }
    }

    for (const split of SPLITS) {
      addRepeatedRows(rows, exercise, counters, split, 'hard-negative-clean', hardNegativeCounts[split], () => ({
        reps: hardNegative.reps,
        view: exercise.scorableView,
        scorable: 'true',
        targetIssues: '',
        instructions: 'Acceptable near-threshold form only. Label all reps clean unless a fault is truly visible.',
      }));
    }

    for (const split of SPLITS) {
      addRepeatedRows(rows, exercise, counters, split, 'combined-faults', combinedCounts[split], () => ({
        reps: combined.reps,
        view: exercise.scorableView,
        scorable: 'true',
        targetIssues: pairText(exercise.combinedFaultPairs),
        instructions: `Reps 1 and 8 clean. Reps 2-7 use these two-issue pairs in order: ${pairText(exercise.combinedFaultPairs)}.`,
      }));
    }

    for (const split of SPLITS) {
      const partialCount = exercise.partialViewCounts?.[split] ?? 0;
      addRepeatedRows(rows, exercise, counters, split, 'view-quality', viewQualityCounts[split], (index) => {
        const isCurlPartial = index <= partialCount;
        return isCurlPartial
          ? {
              reps: 5,
              view: 'side or oblique',
              scorable: 'partial',
              targetIssues: 'visible-arm ROM; shoulder involvement; torso swing; tempo',
              instructions: 'Barbell Curl partial-view clip. Do not label asymmetry or elbow flare.',
            }
          : {
              reps: viewQuality.reps,
              view: 'unsupported, poor setup, or occluded',
              scorable: 'false',
              targetIssues: '',
              instructions: 'Count visible reps if possible, but label every rep scorable=false and issueIds: [].',
            };
      });
    }
  }

  return rows.sort((left, right) =>
    (exerciseRank.get(left.slug) ?? 0) - (exerciseRank.get(right.slug) ?? 0) ||
    splitRank[left.split] - splitRank[right.split] ||
    left.recordingId.localeCompare(right.recordingId)
  );
}

function csvEscape(value: string | number): string {
  const raw = String(value);
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function checklistToCsv(rows: ChecklistRow[]): string {
  const columns: Array<keyof ChecklistRow> = [
    'exercise',
    'slug',
    'split',
    'recordingId',
    'recordingType',
    'reps',
    'view',
    'scorable',
    'targetIssues',
    'instructions',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
}

function formatSplitCounts(counts: SplitCounts): string {
  return `train ${counts.train}, validation ${counts.validation}, test ${counts.test}`;
}

function printAudit(report: AuditReport): void {
  console.log(`Plan: ${report.planId}`);
  console.log(`Reviewed recordings: ${report.reviewedRecordings}/${report.targetRecordings}`);
  console.log(`Draft recordings ignored: ${report.draftRecordings}`);
  console.log(`Passed: ${report.passed ? 'yes' : 'no'}`);
  console.log('');

  for (const exercise of report.exercises) {
    console.log(
      `${exercise.name}: ${reviewedTotal(exercise.reviewedRecordings)} reviewed (${formatSplitCounts(exercise.reviewedRecordings)}), ` +
        `${exercise.reviewedReps} reps, ${exercise.cleanScorableReps} clean scorable, ${exercise.unscorableReps} unscorable`,
    );
  }

  if (report.findings.length === 0) return;
  console.log('');
  console.log('Findings:');
  for (const finding of report.findings) {
    console.log(`[${finding.severity.toUpperCase()}] ${finding.exercise}: ${finding.message}`);
  }
}

export function runRecordingPlanCommand(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  if (args.help === true || args.h === true) {
    console.log(usage());
    return;
  }

  const datasetRoot = resolveDatasetRoot(args);
  const plan = readJson<RecordingPlan>(resolvePlanPath(args, datasetRoot));
  const exerciseFilter = stringArg(args, 'exercise');

  if (args.checklist === true) {
    const csv = `${checklistToCsv(expandChecklist(plan, exerciseFilter))}\n`;
    const outPath = stringArg(args, 'out');
    if (outPath) {
      fs.mkdirSync(path.dirname(path.resolve(process.cwd(), outPath)), { recursive: true });
      fs.writeFileSync(path.resolve(process.cwd(), outPath), csv);
      console.log(`Wrote ${outPath}`);
    } else {
      process.stdout.write(csv);
    }
    return;
  }

  const report = buildAuditReport(plan, loadLabelReferences(datasetRoot), datasetRoot, exerciseFilter);
  if (args.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printAudit(report);
  }

  if (!report.passed && args['no-fail'] !== true) {
    process.exitCode = 1;
  }
}

runRecordingPlanCommand();
