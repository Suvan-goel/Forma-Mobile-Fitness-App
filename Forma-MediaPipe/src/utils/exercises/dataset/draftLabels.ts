import type { ExerciseDefinition } from '../types';
import {
  type LandmarkRecording,
  type ReplayResultVerbose,
} from '../replay';
import type {
  AvailableIssue,
  DatasetSplit,
  ExerciseLabelFile,
  RepLabel,
  RepViewLabel,
} from './types';
import {
  buildLabelingGuidance,
  getExerciseLabelPolicy,
  getLabelableIssues,
  isIssueLabelableForView,
} from './labelPolicy';

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
  return getLabelableIssues(definition);
}

function getSuggestedIssueIds(
  definition: ExerciseDefinition,
  trace: ReplayResultVerbose['repTraces'][number],
  view: RepViewLabel,
  scorable: boolean,
): string[] {
  const policy = getExerciseLabelPolicy(definition.name);
  if (!policy || !scorable) return policy ? [] : trace.issueIds;
  return trace.issueIds.filter((issueId) => isIssueLabelableForView(policy, issueId, view));
}

function createRepLabel(
  definition: ExerciseDefinition,
  trace: ReplayResultVerbose['repTraces'][number],
  fallbackStartedAt: number | null,
): RepLabel {
  const transitionStart = trace.transitions[0]?.timestamp;
  const endMs = roundTimestamp(trace.completedAt);
  let startMs = roundTimestamp(transitionStart ?? trace.startedAt ?? fallbackStartedAt ?? 0);
  const view = trace.diagnostics?.view ?? 'unknown';
  const scorable = trace.scorable ?? trace.diagnostics?.scorable ?? true;

  if (startMs >= endMs) {
    startMs = Math.max(0, endMs - 1);
  }

  return {
    index: trace.repIndex,
    startMs,
    endMs,
    issueIds: [],
    view,
    scorable,
    suggestedIssueIds: getSuggestedIssueIds(definition, trace, view, scorable),
    suggestedFeedbackMessages: trace.messages,
    suggestedScore: trace.score,
    notes: 'Review timing and copy approved suggestedIssueIds into issueIds.',
  };
}

export function createDraftLabelFromReplay(options: CreateDraftLabelOptions): ExerciseLabelFile {
  const fallbackStartedAt = options.recording.frames[0]?.timestamp ?? 0;
  const labelingGuidance = buildLabelingGuidance(options.definition);
  return {
    schemaVersion: 1,
    exerciseName: options.definition.name,
    sourceVideo: options.sourceVideo,
    landmarkFile: options.landmarkFile,
    split: options.split,
    reviewStatus: 'draft',
    expectedReps: options.replay.finalRepCount,
    reps: options.replay.repTraces.map((trace) =>
      createRepLabel(options.definition, trace, fallbackStartedAt),
    ),
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
