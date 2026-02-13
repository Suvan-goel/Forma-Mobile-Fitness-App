/**
 * Text-to-Speech for exercise feedback.
 *
 * Uses ElevenLabs API for high-quality voice.
 */

import { speakWithElevenLabs, isElevenLabsAvailable } from './elevenlabsTTS';

/**
 * Speak feedback text aloud using ElevenLabs.
 */
export async function speakFeedback(text: string): Promise<void> {
  if (!text?.trim()) return;

  const cleanText = text.trim();

  // Use ElevenLabs
  if (isElevenLabsAvailable()) {
    try {
      await speakWithElevenLabs(cleanText);
      return;
    } catch (error) {
      console.error('ElevenLabs TTS failed:', error);
      // Don't fall back - if ElevenLabs fails, just fail silently
    }
  } else {
    console.warn('ElevenLabs API key not configured');
  }
}
