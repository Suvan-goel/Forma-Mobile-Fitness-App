/**
 * ElevenLabs Text-to-Speech
 *
 * Provides high-quality TTS using ElevenLabs API with proper audio session
 * configuration to avoid conflicts with the camera.
 */

let Audio: any = null;
let FileSystem: any = null;
let nativeModulesAvailable = false;

try {
  Audio = require('expo-av').Audio;
  FileSystem = require('expo-file-system');
  nativeModulesAvailable = true;
} catch (error) {
  console.warn('ElevenLabs TTS: Failed to load native modules:', error);
  nativeModulesAvailable = false;
}

// TODO: EXPO_PUBLIC_ keys are bundled into the JS and extractable from production builds.
// When Supabase is set up, proxy TTS requests through an Edge Function and move this key server-side.
const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
let activeVoiceId = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default: Rachel

interface ActiveVoiceSettings {
  speed: number;
  stability: number;
  similarity: number;
  styleExaggeration: number;
}

let activeVoiceSettings: ActiveVoiceSettings = {
  speed: 0.9,
  stability: 0.45,
  similarity: 0.8,
  styleExaggeration: 0.0,
};

/**
 * Override the active voice ID at runtime (e.g. when the user selects a trainer).
 */
export function setActiveVoiceId(id: string): void {
  activeVoiceId = id;
}

/**
 * Override the active voice settings at runtime (e.g. when the user selects a trainer).
 */
export function setActiveVoiceSettings(settings: ActiveVoiceSettings): void {
  activeVoiceSettings = settings;
}

let audioInstance: any = null;
let isInitialized = false;
let speechGeneration = 0; // Incremented on every speakWithElevenLabs call; used to cancel stale fetches

// Audio cache: maps "voiceId:text" → file URI to avoid re-generating identical phrases.
// Coaching message pools are small and fixed (~50 phrases), so cache stays bounded.
const audioCache = new Map<string, string>();

/**
 * Pure-JS base64 encoder for Uint8Array.
 * Avoids btoa (Hermes-only) and FileReader.readAsDataURL (hangs on JSC with binary blobs).
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const parts: string[] = [];
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    parts.push(
      BASE64_CHARS[b0 >> 2] +
      BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)] +
      (i + 1 < len ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=') +
      (i + 2 < len ? BASE64_CHARS[b2 & 63] : '=')
    );
  }
  return parts.join('');
}

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
      interruptionModeIOS: 1, // MixWithOthers — prevents camera session interruption
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      interruptionModeAndroid: 2, // DuckOthers
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

  // Check cache — same voice + same text = identical audio, skip the API call
  const cacheKey = `${activeVoiceId}:${text}`;
  const cached = audioCache.get(cacheKey);
  if (cached) {
    try {
      const info = await FileSystem.getInfoAsync(cached);
      if (info.exists) return cached;
    } catch {}
    audioCache.delete(cacheKey); // File was cleaned up — re-generate
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${activeVoiceId}`;

  // Fetch audio from ElevenLabs
  // Using eleven_turbo_v2_5: ~300ms latency vs ~1-2s for eleven_multilingual_v2.
  // All coaching cues are English-only, so multilingual support is not needed.
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
        stability: activeVoiceSettings.stability,
        similarity_boost: activeVoiceSettings.similarity,
        speed: activeVoiceSettings.speed,
        style: activeVoiceSettings.styleExaggeration,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  // Convert response to base64 via arrayBuffer + pure JS encoder
  // (FileReader.readAsDataURL hangs indefinitely on JSC with binary blobs)
  const arrayBuffer = await response.arrayBuffer();
  const base64Audio = uint8ArrayToBase64(new Uint8Array(arrayBuffer));
  const fileUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;

  // Write to temporary file
  await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Cache the result for future identical requests
  audioCache.set(cacheKey, fileUri);

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
    const ttsFiles = files.filter((f: string) => f.startsWith('tts_') && f.endsWith('.mp3'));

    // Build set of filenames currently in the cache so we don't delete them
    const cachedFilenames = new Set<string>();
    for (const uri of audioCache.values()) {
      const parts = uri.split('/');
      cachedFilenames.add(parts[parts.length - 1]);
    }

    // Delete uncached files beyond the 3 most recent
    const uncached = ttsFiles.filter((f: string) => !cachedFilenames.has(f));
    if (uncached.length > 3) {
      const sorted = uncached.sort().reverse(); // Descending by timestamp
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
    console.warn('ElevenLabs TTS: Native modules not available.');
    return;
  }

  // Claim this generation; any in-flight fetch with an older generation will be discarded
  const generation = ++speechGeneration;

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

    // A newer speakWithElevenLabs call was made while we were fetching — discard this result
    if (generation !== speechGeneration) return;

    // Cleanup old files asynchronously (don't block playback)
    cleanupOldAudioFiles().catch(() => {});

    // Load and play the audio
    const { sound } = await Audio.Sound.createAsync(
      { uri: audioUri },
      { shouldPlay: true, volume: 1.0 },
      (status: any) => {
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
  speechGeneration++; // Cancel any in-flight fetch
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
