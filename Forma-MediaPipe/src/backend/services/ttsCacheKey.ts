export const TTS_MODEL_ID = 'eleven_flash_v2_5' as const;

export type TtsVoiceSettings = {
  speed: number;
  stability: number;
  similarity: number;
  styleExaggeration: number;
};

export type TtsVoiceSnapshot = {
  voiceId: string;
  voiceSettings: TtsVoiceSettings;
  modelId: typeof TTS_MODEL_ID;
};

export function normalizeTtsText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function normalizeTtsVoiceSettings(settings: TtsVoiceSettings): TtsVoiceSettings {
  return {
    speed: Number(settings.speed.toFixed(3)),
    stability: Number(settings.stability.toFixed(3)),
    similarity: Number(settings.similarity.toFixed(3)),
    styleExaggeration: Number(settings.styleExaggeration.toFixed(3)),
  };
}

export function stableTtsHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildTtsCacheKey(text: string, snapshot: TtsVoiceSnapshot): string {
  const payload = JSON.stringify({
    text: normalizeTtsText(text),
    modelId: snapshot.modelId,
    voiceId: snapshot.voiceId,
    voiceSettings: normalizeTtsVoiceSettings(snapshot.voiceSettings),
  });
  return `tts_${stableTtsHash(payload)}`;
}
