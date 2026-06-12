import type { ExerciseDefinition } from '../types';
import { getGroupedFeedbackDefinitionForExercise } from '../groupedFeedback';
import { getFeedbackIssueIdMap } from '../replay';
import type { AvailableIssue, RepViewLabel } from './types';

export type ScoreRangePolicy = 'optional_scorable_only';

export interface ExerciseLabelPolicy {
  exerciseName: string;
  scorableViews: readonly RepViewLabel[];
  fullScoringViews: readonly RepViewLabel[];
  partialScoringViews?: readonly RepViewLabel[];
  allowedIssueIdsByView?: Partial<Record<RepViewLabel, readonly string[]>>;
  nonGroundTruthIssueIds: readonly string[];
  guidance: readonly string[];
  scoreRangePolicy: ScoreRangePolicy;
}

const SCORE_RANGE_POLICY: ScoreRangePolicy = 'optional_scorable_only';

const BARBELL_CURL_VISIBLE_ARM_ISSUES = [
  'barbell-curl.incomplete_flex',
  'barbell-curl.incomplete_extend',
  'barbell-curl.incomplete_rom',
  'barbell-curl.shoulder_fail',
  'barbell-curl.shoulder_warn',
  'barbell-curl.torso_fail',
  'barbell-curl.torso_warn',
  'barbell-curl.tempo_up',
  'barbell-curl.tempo_down',
] as const;

const policies: readonly ExerciseLabelPolicy[] = [
  {
    exerciseName: 'Barbell Curl',
    scorableViews: ['front', 'side', 'oblique'],
    fullScoringViews: ['front'],
    partialScoringViews: ['side', 'oblique'],
    allowedIssueIdsByView: {
      side: BARBELL_CURL_VISIBLE_ARM_ISSUES,
      oblique: BARBELL_CURL_VISIBLE_ARM_ISSUES,
    },
    nonGroundTruthIssueIds: [],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Front-view Barbell Curl reps are full-form labels: review bilateral ROM, symmetry/sync, elbow flare, shoulder involvement, torso swing, and tempo.',
      'Side/oblique Barbell Curl reps are limited-signal fallback labels: label only visible-arm ROM/flex/extend, shoulder involvement, torso swing, and tempo when observable.',
      'For side/oblique reps, do not treat missing asymmetry or elbow-flare cues as clean negatives; leave those issues unlabelled unless the rep is front-view and judgeable.',
      'Mark view as front, side, oblique, or unknown; set scorable=false when arm path, torso, or rep timing cannot be judged.',
      'Count meaningful partial curl attempts as reps when there is a visible flex and return, even if ROM is poor.',
      'Label only visible faults; do not treat unobservable cues as clean negatives.',
    ],
  },
  {
    exerciseName: 'Push-Up',
    scorableViews: ['side'],
    fullScoringViews: ['side'],
    nonGroundTruthIssueIds: ['push-up.camera_setup'],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Standard side-view floor push-ups are the target scope for Push-Up labels.',
      'Mark each rep view accurately; use scorable=false when the view, full body, or form-critical landmarks are not judgeable.',
      'Count meaningful shallow or partial attempts as reps when there is clear descent and return.',
      'Use push-up.depth_short or push-up.lockout_short for endpoint-specific range-of-motion failures.',
      'Use push-up.incomplete_rom only as the fallback ROM issue when neither endpoint issue is the clearer label.',
      'Label only visible faults; do not treat unobservable cues as clean negatives.',
    ],
  },
  {
    exerciseName: 'Barbell Squat',
    scorableViews: ['side'],
    fullScoringViews: ['side'],
    nonGroundTruthIssueIds: [],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Side-view Barbell Squat reps are the v1 full-form scoring target.',
      'Annotate each rep view as side, front, oblique, or unknown.',
      'Set scorable=false for front, oblique, unknown, occluded, or otherwise ambiguous views; these reps may still count for rep-count accuracy.',
      'Label depth, lockout, heel lift, torso lean, ROM, and tempo only when a clear side view supports the cue.',
      'Use barbell-squat.incomplete_rom only as the fallback ROM issue when neither depth_short nor lockout_short is the clearer endpoint label.',
      'Do not label knee valgus in v1; front-view knee tracking is deferred until a separate labelled scope exists.',
    ],
  },
  {
    exerciseName: 'Standing Dumbbell Lateral Raises',
    scorableViews: ['front'],
    fullScoringViews: ['front'],
    nonGroundTruthIssueIds: [],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Front-view Standing Dumbbell Lateral Raises are the v1 full-form scoring target.',
      'Side, oblique, or unknown-view reps may still count movement, but mark them scorable=false and do not label clean negatives for front-view form cues.',
      'Count meaningful partial raises as reps when there is a clear raise and return; do not count tiny pulses.',
      'Label ROM height, over-raise, elbow bend, torso sway, asymmetry, wrong plane, tempo, and shoulder shrug only when the fault is visible.',
      'Mark sustained poor wrist visibility as scorable=false unless the form issue is clearly visible.',
      'For one-arm or highly asymmetric raises, label asymmetry; also label ROM height when the rep is effectively short as a bilateral lateral raise.',
      'For torso sway labels, note the visible subcause when possible: lateral lean, forward/back rocking, or hip shift.',
      'Reviewed scorable Standing Dumbbell Lateral Raises reps must use view=front; use scorable=false for side, oblique, or unknown views.',
    ],
  },
  {
    exerciseName: 'Cable Row',
    scorableViews: ['side'],
    fullScoringViews: ['side'],
    nonGroundTruthIssueIds: [],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Side-view Cable Row reps are the v1 full-form scoring target.',
      'Front, oblique, or unknown-view Cable Row reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Label row depth, extension, shoulder retraction, torso lean, torso rocking, high row path, shoulder shrug, and tempo only when a clear side view supports the cue.',
      'Do not label row-target height, hold, or velocity diagnostics as separate issues in v1.',
    ],
  },
  {
    exerciseName: 'Cable Lat Pulldowns',
    scorableViews: ['side'],
    fullScoringViews: ['side'],
    nonGroundTruthIssueIds: [],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Side-view Cable Lat Pulldowns reps are the v1 full-form scoring target.',
      'Usable side-diagonal Cable Lat Pulldowns captures should be marked view=side for v1; front, oblique, or unknown-view reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Label pull depth, top extension, elbow drive, torso lean, torso rocking, shoulder shrug, and tempo only when a clear side view supports the cue.',
      'Do not label bar path or handle path as separate issues in v1.',
    ],
  },
  {
    exerciseName: 'Cable Pushdowns',
    scorableViews: ['side'],
    fullScoringViews: ['side'],
    nonGroundTruthIssueIds: [],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Side-view Cable Pushdowns reps are the v1 full-form scoring target.',
      'Front, oblique, or unknown-view Cable Pushdowns reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Label lockout, top range, elbow drift, forward elbow setup, torso lean, torso rocking, and tempo only when a clear side view supports the cue.',
      'Label only visible faults; do not treat unobservable cues as clean negatives.',
      'Reviewed scorable Cable Pushdowns reps must use view=side; use scorable=false for front, oblique, or unknown views.',
    ],
  },
  {
    exerciseName: 'Leg Extensions',
    scorableViews: ['side'],
    fullScoringViews: ['side'],
    nonGroundTruthIssueIds: [],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Side-view Leg Extensions reps are the v1 full-form scoring target.',
      'Front, oblique, or unknown-view Leg Extensions reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Label lockout, bottom range, hip lift, torso movement, top hold, and tempo only when a clear side view supports the cue.',
      'Label only visible faults; do not treat unobservable cues as clean negatives.',
      'Reviewed scorable Leg Extensions reps must use view=side; use scorable=false for front, oblique, or unknown views.',
    ],
  },
  {
    exerciseName: 'Lying Leg Curl',
    scorableViews: ['side'],
    fullScoringViews: ['side'],
    nonGroundTruthIssueIds: ['lying-leg-curl.side_view_uncertain'],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Side-view Lying Leg Curl reps are the v1 full-form scoring target.',
      'Front, oblique, or unknown-view Lying Leg Curl reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Keep the same-side hip, knee, and lower-leg endpoint visible so rep count and scoring signals are reviewable.',
      'Label curl depth, bottom extension, hip lift, thigh movement, top hold, tempo, and jerkiness only when a clear side view supports the cue.',
      'Note whether the ankle, heel, or foot index is the clearest lower-leg endpoint when the roller pad hides the ankle.',
      'Reviewed scorable Lying Leg Curl reps must use view=side; use scorable=false for front, oblique, or unknown views.',
    ],
  },
  {
    exerciseName: 'Machine Ab Crunches',
    scorableViews: ['side'],
    fullScoringViews: ['side'],
    nonGroundTruthIssueIds: ['machine-ab-crunches.side_view_uncertain'],
    scoreRangePolicy: SCORE_RANGE_POLICY,
    guidance: [
      'Side-view Machine Ab Crunches reps are the v1 full-form scoring target.',
      'Front, oblique, or unknown-view Machine Ab Crunches reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Count intentional crunch attempts with meaningful range of motion, including partial reps; do not count tiny pulses or aborted no-return motion.',
      'Keep the same-side shoulder, hip, and knee visible so rep count and scoring signals are reviewable.',
      'Label crunch depth, upright return, neck position, tempo, jerkiness, arm pulling, and hip shifting only when a clear side view supports the cue.',
      'Label only visible faults; do not treat unobservable cues as clean negatives.',
      'Reviewed scorable Machine Ab Crunches reps must use view=side; use scorable=false for front, oblique, or unknown views.',
    ],
  },
];

const policyByExerciseName = new Map(
  policies.map((policy) => [policy.exerciseName, policy]),
);

export function listExerciseLabelPolicies(): ExerciseLabelPolicy[] {
  return [...policies];
}

export function getExerciseLabelPolicy(exerciseName: string): ExerciseLabelPolicy | undefined {
  return policyByExerciseName.get(exerciseName);
}

export function buildLabelingGuidance(
  exercise: ExerciseDefinition | string,
): string[] | undefined {
  const exerciseName = typeof exercise === 'string' ? exercise : exercise.name;
  const policy = getExerciseLabelPolicy(exerciseName);
  return policy ? [...policy.guidance] : undefined;
}

export function isViewScorable(
  policy: ExerciseLabelPolicy,
  view: RepViewLabel,
): boolean {
  return policy.scorableViews.includes(view);
}

export function isIssueNonGroundTruth(
  policy: ExerciseLabelPolicy,
  issueId: string,
): boolean {
  if (policy.nonGroundTruthIssueIds.includes(issueId)) return true;
  // Grouped feedback IDs (e.g. barbell-curl.ROM_issue) are a derived
  // presentation layer, never ground truth: evaluation maps labeled fine
  // issues to groups, and a group ID in a label would silently drop out of
  // the truth set. They leak into feedbackToIssue once an exercise's grouped
  // taxonomy goes runtime-active, so exclude them centrally here.
  const groupedDefinition = getGroupedFeedbackDefinitionForExercise(policy.exerciseName);
  return groupedDefinition?.groups.some((group) => group.id === issueId) ?? false;
}

export function isIssueLabelableForView(
  policy: ExerciseLabelPolicy,
  issueId: string,
  view: RepViewLabel,
): boolean {
  if (isIssueNonGroundTruth(policy, issueId)) return false;

  const allowedIssueIds = policy.allowedIssueIdsByView?.[view];
  if (allowedIssueIds) return allowedIssueIds.includes(issueId);

  return isViewScorable(policy, view);
}

export function isIssueLabelableInAnyScoringView(
  policy: ExerciseLabelPolicy,
  issueId: string,
): boolean {
  return policy.scorableViews.some((view) => isIssueLabelableForView(policy, issueId, view));
}

export function getLabelableIssues(
  definition: ExerciseDefinition,
  view?: RepViewLabel,
): AvailableIssue[] {
  const issueIdMap = getFeedbackIssueIdMap(definition);
  const policy = getExerciseLabelPolicy(definition.name);
  const availableIssues: AvailableIssue[] = [];
  const seenIssueIds = new Set<string>();

  for (const feedbackMessage of Object.keys(definition.ttsConfig.feedbackToIssue)) {
    const issueId = issueIdMap[feedbackMessage];
    if (!issueId || seenIssueIds.has(issueId)) continue;
    if (policy) {
      const labelable = view
        ? isIssueLabelableForView(policy, issueId, view)
        : isIssueLabelableInAnyScoringView(policy, issueId);
      if (!labelable) continue;
    }
    seenIssueIds.add(issueId);
    availableIssues.push({ issueId, feedbackMessage });
  }

  return availableIssues;
}

export function formatScorableViewRequirement(policy: ExerciseLabelPolicy): string {
  const views = policy.scorableViews;
  if (views.length === 1) return `${views[0]} view`;
  if (views.length === 2) return `${views[0]} or ${views[1]} view`;
  return `${views.slice(0, -1).join(', ')}, or ${views[views.length - 1]} view`;
}
