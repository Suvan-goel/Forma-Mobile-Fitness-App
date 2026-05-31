import '../../utils/exercises/definitions/register';

import { ExerciseRegistry } from '../../utils/exercises/ExerciseRegistry';
import {
  FEEDBACK_TTS_POOLS,
  ISSUE_POOLS,
  ISSUE_PRIORITY,
  POSITIVE_POOLS,
  getAllSetStartMessages,
  type MessagePool,
} from './ttsMessagePools';
import {
  createVoiceSnapshot,
  logTtsEvent,
  prefetchSpeech,
  type ElevenLabsVoiceSettings,
} from './elevenlabsTTS';

type CuePackTrainer = {
  id?: string;
  name?: string;
  voiceId: string;
  voiceSettings: ElevenLabsVoiceSettings;
  previewGreeting?: string;
  greeting: string;
};

export type TrainerCuePackReason = 'trainer-picker' | 'exercise-selected' | 'camera-focus';

let cuePackGeneration = 0;

function addUnique(target: string[], seen: Set<string>, value: string): void {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
}

function addPoolMessages(target: string[], seen: Set<string>, pool?: MessagePool): void {
  if (!pool) return;
  for (const message of pool.messages) {
    addUnique(target, seen, message);
  }
}

export function cancelTrainerCuePackWarming(): void {
  cuePackGeneration++;
}

export function getCuePackTexts(exerciseName?: string): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();

  if (exerciseName) {
    for (const message of getAllSetStartMessages(exerciseName)) {
      addUnique(texts, seen, message);
    }
  }

  addPoolMessages(texts, seen, POSITIVE_POOLS.positive);
  addPoolMessages(texts, seen, POSITIVE_POOLS.transition_good);

  if (!exerciseName) return texts;

  const definition = ExerciseRegistry.get(exerciseName);
  if (!definition) return texts;

  const feedbackCueCandidates = Object.entries(definition.ttsConfig.feedbackToIssue)
    .map(([feedback, issueType]) => {
      const pool = definition.ttsConfig.feedbackMessages?.[feedback]
        ? { messages: definition.ttsConfig.feedbackMessages[feedback] }
        : FEEDBACK_TTS_POOLS[feedback] ?? ISSUE_POOLS[issueType];

      return {
        pool,
        priority: definition.ttsConfig.feedbackPriorities?.[feedback] ?? ISSUE_PRIORITY[issueType] ?? 0,
      };
    })
    .filter((candidate): candidate is { pool: MessagePool; priority: number } => !!candidate.pool)
    .sort((a, b) => b.priority - a.priority);

  let feedbackTextCount = 0;
  for (const candidate of feedbackCueCandidates) {
    for (const message of candidate.pool.messages) {
      const before = texts.length;
      addUnique(texts, seen, message);
      if (texts.length !== before) feedbackTextCount++;
      if (feedbackTextCount >= 30) return texts;
    }
  }

  return texts;
}

export async function warmTrainerCuePack(input: {
  trainer: CuePackTrainer;
  exerciseName?: string;
  reason: TrainerCuePackReason;
}): Promise<void> {
  const generation = ++cuePackGeneration;
  const snapshot = createVoiceSnapshot(input.trainer.voiceId, input.trainer.voiceSettings);
  const preview = input.trainer.previewGreeting ?? input.trainer.greeting;
  const cueTexts = [preview, ...getCuePackTexts(input.exerciseName)];
  const seen = new Set<string>();
  const uniqueCueTexts = cueTexts.filter((text) => {
    const normalized = text.trim().replace(/\s+/g, ' ');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  logTtsEvent({
    type: 'cue-pack-start',
    reason: input.reason,
    trainerId: input.trainer.id,
    exerciseName: input.exerciseName,
    cueCount: uniqueCueTexts.length,
  });

  for (const text of uniqueCueTexts) {
    if (generation !== cuePackGeneration) {
      logTtsEvent({
        type: 'cue-pack-cancelled',
        reason: input.reason,
        trainerId: input.trainer.id,
        exerciseName: input.exerciseName,
      });
      return;
    }

    await prefetchSpeech(text, snapshot, { purpose: 'prefetch', timeoutMs: 12000 }).catch((error) => {
      logTtsEvent({
        type: 'cue-pack-prefetch-failed',
        reason: input.reason,
        trainerId: input.trainer.id,
        exerciseName: input.exerciseName,
        errorName: error instanceof Error ? error.name : 'Unknown',
      });
    });
  }

  logTtsEvent({
    type: 'cue-pack-complete',
    reason: input.reason,
    trainerId: input.trainer.id,
    exerciseName: input.exerciseName,
    cueCount: uniqueCueTexts.length,
  });
}
