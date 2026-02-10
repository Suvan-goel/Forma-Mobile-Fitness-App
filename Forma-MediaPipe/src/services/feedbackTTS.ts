/**
 * Feedback Text-to-Speech
 *
 * Reads out form feedback messages during barbell curls using the device's
 * built-in TTS (expo-speech). Works offline and avoids native module conflicts
 * with the camera.
 */

import * as Speech from 'expo-speech';

/**
 * Speak the given feedback text using device TTS.
 */
export function speakFeedback(text: string): void {
  if (!text?.trim()) return;

  Speech.speak(text.trim(), {
    language: 'en-US',
    pitch: 1.0,
    rate: 0.9,
  });
}
