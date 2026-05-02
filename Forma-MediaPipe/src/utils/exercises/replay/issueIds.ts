import type { ExerciseDefinition } from '../types';

export function slugifyExerciseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getFeedbackIssueIdMap(
  definition: ExerciseDefinition,
): Record<string, string> {
  if (definition.feedbackToIssueId) {
    return definition.feedbackToIssueId;
  }

  const exerciseSlug = slugifyExerciseName(definition.name);
  const result: Record<string, string> = {};
  for (const [message, issueType] of Object.entries(definition.ttsConfig.feedbackToIssue)) {
    result[message] = `${exerciseSlug}.${issueType}`;
  }
  return result;
}

export function getKnownIssueIds(definitions: ExerciseDefinition[]): Set<string> {
  const ids = new Set<string>();
  for (const definition of definitions) {
    for (const issueId of Object.values(getFeedbackIssueIdMap(definition))) {
      ids.add(issueId);
    }
  }
  return ids;
}

export function mapFeedbackMessagesToIssueIds(
  definition: ExerciseDefinition,
  messages: string[],
): string[] {
  const issueMap = getFeedbackIssueIdMap(definition);
  const ids = new Set<string>();
  for (const message of messages) {
    const issueId = issueMap[message];
    if (issueId) ids.add(issueId);
  }
  return Array.from(ids);
}
