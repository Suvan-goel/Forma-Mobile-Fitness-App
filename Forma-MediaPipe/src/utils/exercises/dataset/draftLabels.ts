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
    availableIssues: getAvailableIssues(options.definition),
    draftMetadata: {
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      generator: options.generator ?? 'dataset:draft-label',
      source: 'heuristic-replay',
    },
  };
}
