/**
 * ElevenLabs Text-to-Speech
 *
 * Provides high-quality TTS using ElevenLabs API with proper audio session
 * configuration to avoid conflicts with the camera.
 */

// Gracefully handle missing native modules - development client needs rebuild
let Audio: any = null;
let FileSystem: any = null;
let nativeModulesAvailable = false;

try {
  Audio = require('expo-av').Audio;
  FileSystem = require('expo-file-system');
  nativeModulesAvailable = true;
} catch (error) {
  console.warn('ElevenLabs TTS: Native modules not available. Rebuild development client with: npx expo prebuild --clean && npx expo run:android');
  nativeModulesAvailable = false;
}

const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel

let audioInstance: any = null;
let isInitialized = false;

/**
 * Initialize audio session with camera-compatible settings.
 * This prevents conflicts between audio playback and camera recording.
 */
async function initializeAudio(): Promise<void> {
  if (!nativeModulesAvailable || !Audio) return;
  if (isInitialized) return;

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    isInitialized = true;
  } catch (error) {
    console.warn('Failed to initialize audio session:', error);
  }
}

/**
 * Call ElevenLabs API and save audio to a temporary file.
 * Returns the file URI for playback.
 */
async function generateSpeech(text: string): Promise<string> {
  if (!nativeModulesAvailable || !FileSystem) {
    throw new Error('Native modules not available - rebuild development client');
  }

  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

  // Fetch audio from ElevenLabs
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.65,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  // Get audio as base64
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Convert to base64 (btoa is available in React Native with Hermes)
  let binaryString = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
    binaryString += String.fromCharCode.apply(null, Array.from(chunk));
  }
  const base64Audio = btoa(binaryString);

  // Write to temporary file
  const fileUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return fileUri;
}

/**
 * Clean up old TTS audio files from cache.
 */
async function cleanupOldAudioFiles(): Promise<void> {
  if (!nativeModulesAvailable || !FileSystem) return;

  try {
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) return;

    const files = await FileSystem.readDirectoryAsync(cacheDir);
    const ttsFiles = files.filter((f) => f.startsWith('tts_') && f.endsWith('.mp3'));

    // Keep only the most recent 3 files, delete older ones
    if (ttsFiles.length > 3) {
      const sorted = ttsFiles.sort().reverse(); // Descending by timestamp
      for (let i = 3; i < sorted.length; i++) {
        await FileSystem.deleteAsync(`${cacheDir}${sorted[i]}`, { idempotent: true });
      }
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Speak the given text using ElevenLabs TTS.
 * Configures audio session to avoid conflicts with camera.
 */
export async function speakWithElevenLabs(text: string): Promise<void> {
  if (!text?.trim()) return;

  if (!nativeModulesAvailable || !Audio) {
    console.warn('ElevenLabs TTS: Native modules not available. TTS is disabled until development client is rebuilt.');
    return;
  }

  try {
    // Initialize audio session
    await initializeAudio();

    // Stop any currently playing audio
    if (audioInstance) {
      try {
        await audioInstance.stopAsync();
        await audioInstance.unloadAsync();
      } catch (e) {
        // Ignore errors when stopping
      }
      audioInstance = null;
    }

    // Generate speech from ElevenLabs (downloads to temp file)
    const audioUri = await generateSpeech(text.trim());

    // Cleanup old files asynchronously (don't block playback)
    cleanupOldAudioFiles().catch(() => {});

    // Load and play the audio
    const { sound } = await Audio.Sound.createAsync(
      { uri: audioUri },
      { shouldPlay: true, volume: 1.0 },
      (status) => {
        // Cleanup when playback finishes
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
        }
      }
    );

    audioInstance = sound;
  } catch (error) {
    console.error('ElevenLabs TTS error:', error);
    throw error;
  }
}

/**
 * Stop any currently playing speech.
 */
export async function stopSpeech(): Promise<void> {
  if (!nativeModulesAvailable || !audioInstance) return;

  try {
    await audioInstance.stopAsync();
    await audioInstance.unloadAsync();
  } catch (e) {
    // Ignore errors
  }
  audioInstance = null;
}

/**
 * Check if ElevenLabs is configured and available.
 */
export function isElevenLabsAvailable(): boolean {
  return nativeModulesAvailable && !!ELEVENLABS_API_KEY;
}
