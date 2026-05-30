/**
 * ElevenLabs Text-to-Speech
 *
 * Provides high-quality TTS using a Supabase Edge Function proxy, with
 * deterministic local caching and cancellation-aware playback.
 */

import { supabase } from './supabase/client';

let ExpoAudio: any = null;
let FileSystem: any = null;
let nativeModulesAvailable = false;

try {
  ExpoAudio = require('expo-audio');
  FileSystem = require('expo-file-system');
  nativeModulesAvailable = !!ExpoAudio?.createAudioPlayer && !!ExpoAudio?.setAudioModeAsync;
} catch (error) {
  console.warn('ElevenLabs TTS: Failed to load native modules:', error);
  nativeModulesAvailable = false;
}

export type ElevenLabsVoiceSettings = {
  speed: number;
  stability: number;
  similarity: number;
  styleExaggeration: number;
};

export type VoiceSnapshot = {
  voiceId: string;
  voiceSettings: ElevenLabsVoiceSettings;
  modelId: 'eleven_flash_v2_5';
};

export type SpeechPurpose = 'trainer-preview' | 'set-start' | 'coach' | 'summary' | 'prefetch';

export type SpeechOptions = {
  purpose?: SpeechPurpose;
  interrupt?: boolean;
  timeoutMs?: number;
  maxPlaybackDelayMs?: number;
};

export type PreparedSpeech = {
  uri: string;
  cacheKey: string;
  text: string;
  snapshot: VoiceSnapshot;
  generatedAt: number;
};

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const TTS_MODEL_ID: VoiceSnapshot['modelId'] = 'eleven_flash_v2_5';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const TTS_CACHE_DIR_NAME = 'tts-cache/';
const TTS_CACHE_MAX_FILES = 120;
const TTS_CACHE_MAX_BYTES = 30 * 1024 * 1024;
const DEFAULT_PLAYBACK_WATCHDOG_MS = 12000;

const PURPOSE_TIMEOUT_MS: Record<SpeechPurpose, number> = {
  'trainer-preview': 6000,
  'set-start': 5000,
  coach: 8000,
  summary: 8000,
  prefetch: 12000,
};

let activeVoiceId = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
let activeVoiceSettings: ElevenLabsVoiceSettings = {
  speed: 0.9,
  stability: 0.45,
  similarity: 0.8,
  styleExaggeration: 0.0,
};

let audioInstance: any = null;
let activePlaybackPurpose: SpeechPurpose | null = null;
let isInitialized = false;
let activePlaybackSubscription: { remove?: () => void } | null = null;
let activePlaybackResolve: (() => void) | null = null;
let cleanupScheduled = false;
let cacheDirectoryReady: Promise<string> | null = null;

const purposeGenerations = new Map<SpeechPurpose, number>();
const activeRequestControllers = new Map<SpeechPurpose, Set<AbortController>>();
const inFlightSpeech = new Map<string, Promise<PreparedSpeech>>();
const cacheAccessTimes = new Map<string, number>();

/**
 * Override the active voice ID at runtime (e.g. when the user selects a trainer).
 */
export function setActiveVoiceId(id: string): void {
  activeVoiceId = id;
}

/**
 * Override the active voice settings at runtime (e.g. when the user selects a trainer).
 */
export function setActiveVoiceSettings(settings: ElevenLabsVoiceSettings): void {
  activeVoiceSettings = { ...settings };
}

export function createVoiceSnapshot(
  voiceId = activeVoiceId,
  voiceSettings: ElevenLabsVoiceSettings = activeVoiceSettings
): VoiceSnapshot {
  return {
    voiceId,
    voiceSettings: { ...voiceSettings },
    modelId: TTS_MODEL_ID,
  };
}

export function getActiveVoiceSnapshot(): VoiceSnapshot {
  return createVoiceSnapshot(activeVoiceId, activeVoiceSettings);
}

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
 */
async function initializeAudio(): Promise<void> {
  if (!nativeModulesAvailable || !ExpoAudio) return;
  if (isInitialized) return;

  try {
    await ExpoAudio.setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
      interruptionModeAndroid: 'duckOthers',
      shouldRouteThroughEarpiece: false,
    });
    isInitialized = true;
  } catch (error) {
    console.warn('Failed to initialize audio session:', error);
  }
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeVoiceSettings(settings: ElevenLabsVoiceSettings): ElevenLabsVoiceSettings {
  return {
    speed: Number(settings.speed.toFixed(3)),
    stability: Number(settings.stability.toFixed(3)),
    similarity: Number(settings.similarity.toFixed(3)),
    styleExaggeration: Number(settings.styleExaggeration.toFixed(3)),
  };
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getCacheKey(text: string, snapshot: VoiceSnapshot): string {
  const payload = JSON.stringify({
    text: normalizeText(text),
    modelId: snapshot.modelId,
    voiceId: snapshot.voiceId,
    voiceSettings: normalizeVoiceSettings(snapshot.voiceSettings),
  });
  return `tts_${stableHash(payload)}`;
}

async function ensureCacheDirectory(): Promise<string> {
  if (!nativeModulesAvailable || !FileSystem?.cacheDirectory) {
    throw new Error('Native modules not available - rebuild development client');
  }

  if (!cacheDirectoryReady) {
    const dir = `${FileSystem.cacheDirectory}${TTS_CACHE_DIR_NAME}`;
    cacheDirectoryReady = (async () => {
      try {
        await FileSystem.makeDirectoryAsync?.(dir, { intermediates: true });
      } catch {
        // Directory may already exist or the platform may not need explicit creation.
      }
      return dir;
    })();
  }
  return cacheDirectoryReady;
}

function getCacheUri(cacheDir: string, cacheKey: string): string {
  return `${cacheDir}${cacheKey}.mp3`;
}

function registerRequestController(purpose: SpeechPurpose, controller: AbortController): void {
  const existing = activeRequestControllers.get(purpose) ?? new Set<AbortController>();
  existing.add(controller);
  activeRequestControllers.set(purpose, existing);
}

function unregisterRequestController(purpose: SpeechPurpose, controller: AbortController): void {
  const existing = activeRequestControllers.get(purpose);
  if (!existing) return;
  existing.delete(controller);
  if (existing.size === 0) activeRequestControllers.delete(purpose);
}

function abortRequests(purpose?: SpeechPurpose): void {
  const entries = purpose
    ? [[purpose, activeRequestControllers.get(purpose)] as const]
    : Array.from(activeRequestControllers.entries());

  for (const [, controllers] of entries) {
    controllers?.forEach((controller) => {
      try {
        controller.abort();
      } catch {}
    });
    controllers?.clear();
  }
  if (purpose) activeRequestControllers.delete(purpose);
  else activeRequestControllers.clear();
}

function bumpGeneration(purpose: SpeechPurpose): number {
  const next = (purposeGenerations.get(purpose) ?? 0) + 1;
  purposeGenerations.set(purpose, next);
  return next;
}

function getGeneration(purpose: SpeechPurpose): number {
  return purposeGenerations.get(purpose) ?? 0;
}

function abortError(message = 'TTS request aborted'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };

    signal.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  purpose: SpeechPurpose,
  timeoutMs: number,
  retries = 2
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  registerRequestController(purpose, controller);

  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (controller.signal.aborted) throw abortError();

      let response: Response;
      try {
        response = await fetch(url, { ...options, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) throw abortError();
        throw error;
      }

      if (response.ok) return response;
      if (response.status !== 429 && response.status !== 503) {
        throw new Error(await formatTtsError(response));
      }

      if (attempt < retries) {
        await abortableDelay(500 * Math.pow(2, attempt), controller.signal);
      } else {
        throw new Error(await formatTtsError(response));
      }
    }
  } finally {
    clearTimeout(timeout);
    unregisterRequestController(purpose, controller);
  }

  throw new Error('TTS request failed');
}

async function formatTtsError(response: Response): Promise<string> {
  const fallback = `TTS error: ${response.status}`;
  try {
    const body = await response.text();
    if (!body) return fallback;
    return `${fallback} ${body.slice(0, 300)}`;
  } catch {
    return fallback;
  }
}

async function fetchAndCacheSpeech(
  text: string,
  snapshot: VoiceSnapshot,
  options: Required<Pick<SpeechOptions, 'purpose' | 'timeoutMs'>>
): Promise<PreparedSpeech> {
  if (!SUPABASE_URL) {
    throw new Error('Supabase URL not configured');
  }

  const cacheDir = await ensureCacheDirectory();
  const cacheKey = getCacheKey(text, snapshot);
  const fileUri = getCacheUri(cacheDir, cacheKey);
  const cached = await FileSystem.getInfoAsync(fileUri);
  if (cached?.exists) {
    cacheAccessTimes.set(cacheKey, Date.now());
    return { uri: fileUri, cacheKey, text, snapshot, generatedAt: Date.now() };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/tts`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      text,
      voiceId: snapshot.voiceId,
      voiceSettings: {
        stability: snapshot.voiceSettings.stability,
        similarity_boost: snapshot.voiceSettings.similarity,
        speed: snapshot.voiceSettings.speed,
        style: snapshot.voiceSettings.styleExaggeration,
      },
    }),
  }, options.purpose, options.timeoutMs);

  const arrayBuffer = await response.arrayBuffer();
  const base64Audio = uint8ArrayToBase64(new Uint8Array(arrayBuffer));
  await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
    encoding: FileSystem.EncodingType.Base64,
  });

  cacheAccessTimes.set(cacheKey, Date.now());
  scheduleCacheCleanup();

  return { uri: fileUri, cacheKey, text, snapshot, generatedAt: Date.now() };
}

function resolvePurpose(options?: SpeechOptions): SpeechPurpose {
  return options?.purpose ?? 'coach';
}

function resolveTimeoutMs(purpose: SpeechPurpose, options?: SpeechOptions): number {
  return options?.timeoutMs ?? PURPOSE_TIMEOUT_MS[purpose];
}

export async function prepareSpeech(
  text: string,
  snapshot: VoiceSnapshot = getActiveVoiceSnapshot(),
  options: SpeechOptions = {}
): Promise<PreparedSpeech> {
  const normalizedText = normalizeText(text);
  if (!normalizedText) throw new Error('TTS text is empty');
  if (!nativeModulesAvailable || !FileSystem) {
    throw new Error('Native modules not available - rebuild development client');
  }

  const frozenSnapshot: VoiceSnapshot = {
    voiceId: snapshot.voiceId,
    voiceSettings: normalizeVoiceSettings(snapshot.voiceSettings),
    modelId: snapshot.modelId,
  };
  const purpose = resolvePurpose(options);
  const timeoutMs = resolveTimeoutMs(purpose, options);
  const cacheKey = getCacheKey(normalizedText, frozenSnapshot);
  const existing = inFlightSpeech.get(cacheKey);
  if (existing) return existing;

  const promise = fetchAndCacheSpeech(normalizedText, frozenSnapshot, { purpose, timeoutMs })
    .finally(() => {
      inFlightSpeech.delete(cacheKey);
    });

  inFlightSpeech.set(cacheKey, promise);
  return promise;
}

export async function prefetchSpeech(
  text: string,
  snapshot: VoiceSnapshot = getActiveVoiceSnapshot(),
  options: SpeechOptions = {}
): Promise<void> {
  await prepareSpeech(text, snapshot, { ...options, purpose: options.purpose ?? 'prefetch' });
}

function estimatePlaybackWatchdogMs(text: string): number {
  const estimated = normalizeText(text).length * 90 + 3000;
  return Math.min(20000, Math.max(DEFAULT_PLAYBACK_WATCHDOG_MS, estimated));
}

function releaseAudioPlayer(player: any): void {
  try {
    player.pause?.();
  } catch {}

  try {
    const seekResult = player.seekTo?.(0);
    if (seekResult?.catch) seekResult.catch(() => {});
  } catch {}

  try {
    player.remove?.();
  } catch {}
}

function resolveActivePlayback(player?: any): void {
  if (player && audioInstance && audioInstance !== player) return;

  const resolve = activePlaybackResolve;
  const subscription = activePlaybackSubscription;
  activePlaybackSubscription = null;
  activePlaybackResolve = null;
  if (!player || audioInstance === player) {
    audioInstance = null;
    activePlaybackPurpose = null;
  }

  try {
    subscription?.remove?.();
  } catch {}

  if (resolve) resolve();
}

async function stopActiveAudio(purpose?: SpeechPurpose): Promise<void> {
  if (purpose && activePlaybackPurpose !== purpose) return;

  const player = audioInstance;
  audioInstance = null;
  activePlaybackPurpose = null;

  if (!player) {
    resolveActivePlayback();
    return;
  }

  if (activePlaybackResolve) {
    resolveActivePlayback(player);
  } else {
    releaseAudioPlayer(player);
    resolveActivePlayback(player);
  }
}

export async function cancelSpeech(purpose?: SpeechPurpose): Promise<void> {
  if (purpose) {
    bumpGeneration(purpose);
  } else {
    (['trainer-preview', 'set-start', 'coach', 'summary', 'prefetch'] as SpeechPurpose[]).forEach(bumpGeneration);
  }
  abortRequests(purpose);
  await stopActiveAudio(purpose);
}

export async function playPreparedSpeech(
  asset: PreparedSpeech,
  options: SpeechOptions = {}
): Promise<void> {
  const purpose = resolvePurpose(options);
  if (!nativeModulesAvailable || !ExpoAudio) {
    console.warn('ElevenLabs TTS: Native modules not available.');
    return;
  }

  await initializeAudio();

  if (purpose === 'set-start') {
    await stopActiveAudio('trainer-preview');
  }
  if (options.interrupt || purpose === 'trainer-preview') {
    await stopActiveAudio(purpose);
  }

  const player = ExpoAudio.createAudioPlayer({ uri: asset.uri }, 250);
  player.volume = 1.0;

  const playbackFinished = new Promise<void>((resolve) => {
    let didResolve = false;
    const finish = () => {
      if (didResolve) return;
      didResolve = true;
      clearTimeout(watchdog);
      releaseAudioPlayer(player);
      resolveActivePlayback(player);
      resolve();
    };

    audioInstance = player;
    activePlaybackPurpose = purpose;
    activePlaybackResolve = finish;

    activePlaybackSubscription = player.addListener?.('playbackStatusUpdate', (status: any) => {
      if (status.didJustFinish) finish();
    });

    const watchdog = setTimeout(finish, estimatePlaybackWatchdogMs(asset.text));
  });

  player.play();
  await playbackFinished;
}

async function resolveWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    promise.then((value) => {
      clearTimeout(timeout);
      resolve(value);
    }).catch(() => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * Speak the given text using ElevenLabs TTS.
 */
export async function speakWithElevenLabs(text: string, options: SpeechOptions = {}): Promise<void> {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return;

  if (!nativeModulesAvailable || !ExpoAudio) {
    console.warn('ElevenLabs TTS: Native modules not available.');
    return;
  }

  const purpose = resolvePurpose(options);
  const shouldInterrupt = options.interrupt ?? purpose === 'trainer-preview';
  if (shouldInterrupt) {
    await cancelSpeech(purpose);
  } else if (purpose === 'set-start') {
    await cancelSpeech('trainer-preview');
  }

  const generation = bumpGeneration(purpose);
  try {
    const preparedPromise = prepareSpeech(normalizedText, getActiveVoiceSnapshot(), options);
    const asset = options.maxPlaybackDelayMs !== undefined
      ? await resolveWithin(preparedPromise, options.maxPlaybackDelayMs)
      : await preparedPromise;

    if (!asset || generation !== getGeneration(purpose)) return;
    await playPreparedSpeech(asset, options);
  } catch (error) {
    if (!isAbortError(error)) {
      console.error('ElevenLabs TTS error:', error);
    }
    await stopActiveAudio(purpose);
    throw error;
  }
}

/**
 * Stop any currently playing speech.
 */
export async function stopSpeech(): Promise<void> {
  if (!nativeModulesAvailable) return;
  await cancelSpeech();
}

/**
 * Check if ElevenLabs is configured and available.
 */
export function isElevenLabsAvailable(): boolean {
  return nativeModulesAvailable && !!SUPABASE_URL;
}

function scheduleCacheCleanup(): void {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setTimeout(() => {
    cleanupScheduled = false;
    cleanupOldAudioFiles().catch(() => {});
  }, 0);
}

async function cleanupOldAudioFiles(): Promise<void> {
  if (!nativeModulesAvailable || !FileSystem) return;

  try {
    const cacheDir = await ensureCacheDirectory();
    const files = await FileSystem.readDirectoryAsync(cacheDir);
    const mp3Files = files.filter((f: string) => f.startsWith('tts_') && f.endsWith('.mp3'));

    const entries: Array<{ file: string; uri: string; size: number; accessedAt: number }> = [];
    for (const file of mp3Files) {
      const uri = `${cacheDir}${file}`;
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      const cacheKey = file.replace(/\.mp3$/, '');
      entries.push({
        file,
        uri,
        size: typeof info?.size === 'number' ? info.size : 0,
        accessedAt: cacheAccessTimes.get(cacheKey) ?? info?.modificationTime ?? 0,
      });
    }

    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    const sortedOldestFirst = entries.sort((a, b) => a.accessedAt - b.accessedAt);

    while (
      sortedOldestFirst.length > TTS_CACHE_MAX_FILES ||
      totalBytes > TTS_CACHE_MAX_BYTES
    ) {
      const next = sortedOldestFirst.shift();
      if (!next) break;
      totalBytes -= next.size;
      cacheAccessTimes.delete(next.file.replace(/\.mp3$/, ''));
      await FileSystem.deleteAsync(next.uri, { idempotent: true });
    }
  } catch {
    // Ignore cleanup errors.
  }
}
