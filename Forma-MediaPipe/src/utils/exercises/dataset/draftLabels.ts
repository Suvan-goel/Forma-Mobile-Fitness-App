import type { ExerciseDefinition } from '../types';
import {
  getFeedbackIssueIdMap,
  type LandmarkRecording,
  type ReplayResultVerbose,
} from '../replay';
import type {
  AvailableIssue,
  DatasetSplit,
  ExerciseLabelFile,
  RepLabel,
} from './types';

export interface CreateDraftLabelOptions {
  definition: ExerciseDefinition;
  recording: LandmarkRecording;
  replay: ReplayResultVerbose;
  sourceVideo: string;
  landmarkFile: string;
  split: DatasetSplit;
  generatedAt?: string;
  generator?: string;
}

function roundTimestamp(value: number | null | undefined): number {
  return Math.max(0, Math.round(value ?? 0));
}

export function getAvailableIssues(definition: ExerciseDefinition): AvailableIssue[] {
  const issueIdMap = getFeedbackIssueIdMap(definition);
  const availableIssues: AvailableIssue[] = [];
  const seenIssueIds = new Set<string>();

  for (const feedbackMessage of Object.keys(definition.ttsConfig.feedbackToIssue)) {
    const issueId = issueIdMap[feedbackMessage];
    if (!issueId || seenIssueIds.has(issueId)) continue;
    seenIssueIds.add(issueId);
    availableIssues.push({ issueId, feedbackMessage });
  }

  return availableIssues;
}

function getLabelingGuidance(definition: ExerciseDefinition): string[] | undefined {
  if (definition.name === 'Push-Up') {
    return [
      'Standard side-view floor push-ups are the target scope for Push-Up labels.',
      'Mark each rep view accurately; use scorable=false when the view, full body, or form-critical landmarks are not judgeable.',
      'Count meaningful shallow or partial attempts as reps when there is clear descent and return.',
      'Use push-up.depth_short or push-up.lockout_short for endpoint-specific range-of-motion failures.',
      'Use push-up.incomplete_rom only as the fallback ROM issue when neither endpoint issue is the clearer label.',
      'Label only visible faults; do not treat unobservable cues as clean negatives.',
    ];
  }

  if (definition.name === 'Barbell Squat') {
    return [
      'Side-view Barbell Squat reps are the v1 full-form scoring target.',
      'Front, oblique, or unknown-view reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Label depth, lockout, heel lift, torso lean, ROM, and tempo only when a clear side view supports the cue.',
      'Use barbell-squat.incomplete_rom only as the fallback ROM issue when neither depth_short nor lockout_short is the clearer endpoint label.',
      'Do not label knee valgus in v1; front-view knee tracking is deferred until a separate labelled scope exists.',
    ];
  }

  if (definition.name === 'Standing Dumbbell Lateral Raises') {
    return [
      'Front-view Standing Dumbbell Lateral Raises are the v1 full-form scoring target.',
      'Side, oblique, or unknown-view reps may still count movement, but mark them scorable=false and do not label clean negatives for front-view form cues.',
      'Count meaningful partial raises as reps when there is a clear raise and return; do not count tiny pulses.',
      'Label ROM height, over-raise, elbow bend, torso sway, asymmetry, wrong plane, tempo, and shoulder shrug only when the fault is visible.',
      'Mark sustained poor wrist visibility as scorable=false unless the form issue is clearly visible.',
      'For one-arm or highly asymmetric raises, label asymmetry; also label ROM height when the rep is effectively short as a bilateral lateral raise.',
      'For torso sway labels, note the visible subcause when possible: lateral lean, forward/back rocking, or hip shift.',
      'Reviewed scorable Standing Dumbbell Lateral Raises reps must use view=front; use scorable=false for side, oblique, or unknown views.',
    ];
  }

  if (definition.name === 'Cable Row') {
    return [
      'Side-view Cable Row reps are the v1 full-form scoring target.',
      'Front, oblique, or unknown-view Cable Row reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Label row depth, extension, shoulder retraction, torso lean, torso rocking, high row path, shoulder shrug, and tempo only when a clear side view supports the cue.',
      'Do not label row-target height, hold, or velocity diagnostics as separate issues in v1.',
    ];
  }

  if (definition.name === 'Cable Lat Pulldowns') {
    return [
      'Side-view Cable Lat Pulldowns reps are the v1 full-form scoring target.',
      'Usable side-diagonal Cable Lat Pulldowns captures should be marked view=side for v1; front, oblique, or unknown-view reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Label pull depth, top extension, elbow drive, torso lean, torso rocking, shoulder shrug, and tempo only when a clear side view supports the cue.',
      'Do not label bar path or handle path as separate issues in v1.',
    ];
  }

  if (definition.name === 'Leg Extensions') {
    return [
      'Side-view Leg Extensions reps are the v1 full-form scoring target.',
      'Front, oblique, or unknown-view Leg Extensions reps may still count movement, but mark them scorable=false and do not label clean negatives for side-only form cues.',
      'Label lockout, bottom range, hip lift, torso movement, top hold, and tempo only when a clear side view supports the cue.',
      'Label only visible faults; do not treat unobservable cues as clean negatives.',
      'Reviewed scorable Leg Extensions reps must use view=side; use scorable=false for front, oblique, or unknown views.',
    ];
  }

  if (definition.name !== 'Barbell Curl') return undefined;

  return [
    'Front-view Barbell Curl reps are full-form labels: review bilateral ROM, symmetry/sync, elbow flare, shoulder involvement, torso swing, and tempo.',
    'Side/oblique Barbell Curl reps are limited-signal fallback labels: label only visible-arm ROM/flex/extend, shoulder involvement, torso swing, and tempo when observable.',
    'For side/oblique reps, do not treat missing asymmetry or elbow-flare cues as clean negatives; leave those issues unlabelled.',
    'Reviewed scorable Barbell Curl reps must be marked front, side, or oblique; use scorable=false when the view is unknown.',
  ];
}

function createRepLabel(
  trace: ReplayResultVerbose['repTraces'][number],
  fallbackStartedAt: number | null,
): RepLabel {
  const transitionStart = trace.transitions[0]?.timestamp;
  const endMs = roundTimestamp(trace.completedAt);
  let startMs = roundTimestamp(transitionStart ?? trace.startedAt ?? fallbackStartedAt ?? 0);

  if (startMs >= endMs) {
    startMs = Math.max(0, endMs - 1);
  }

  return {
    index: trace.repIndex,
    startMs,
    endMs,
    issueIds: [],
    view: trace.diagnostics?.view ?? 'unknown',
    scorable: trace.scorable ?? trace.diagnostics?.scorable ?? true,
    suggestedIssueIds: trace.issueIds,
    suggestedFeedbackMessages: trace.messages,
    suggestedScore: trace.score,
    notes: 'Review timing and copy approved suggestedIssueIds into issueIds.',
  };
}

export function createDraftLabelFromReplay(options: CreateDraftLabelOptions): ExerciseLabelFile {
  const fallbackStartedAt = options.recording.frames[0]?.timestamp ?? 0;
  const labelingGuidance = getLabelingGuidance(options.definition);
  return {
    schemaVersion: 1,
    exerciseName: options.definition.name,
    sourceVideo: options.sourceVideo,
    landmarkFile: options.landmarkFile,
    split: options.split,
    reviewStatus: 'draft',
    expectedReps: options.replay.finalRepCount,
    reps: options.replay.repTraces.map((trace) => createRepLabel(trace, fallbackStartedAt)),
    notes:
      'Draft generated from heuristic replay. Review rep count/timing and move approved suggestions into issueIds before marking reviewed.',
    ...(labelingGuidance ? { labelingGuidance } : {}),
    availableIssues: getAvailableIssues(options.definition),
    draftMetadata: {
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      generator: options.generator ?? 'dataset:draft-label',
      source: 'heuristic-replay',
    },
  };
}
