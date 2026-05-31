export const TTS_AUDIO_CACHE_BUCKET = 'tts-audio-cache';
export const TTS_AUDIO_CACHE_PREFIX = 'v1';
export const TTS_MODEL_ID = 'eleven_flash_v2_5' as const;

const MAX_TEXT_LENGTH = 240;
const ALLOWED_VOICE_IDS = new Set([
  '21m00Tcm4TlvDq8ikWAM',
  '8N2ng9i2uiUWqstgmWlH',
  'l4Coq6695JDX9xtLqXDE',
  'uJCs8Cm3vdGWEkXI6wUX',
  'c6SfcYrb2t09NHXiT80T',
  'l30f87tf05uxyknGdDw6',
  'MdeqL1TMyZWz86QOELK8',
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: unknown | null }; error: unknown | null }>;
  };
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Blob,
        options: { contentType: string; cacheControl: string; upsert: boolean }
      ) => Promise<{ data?: unknown; error?: unknown | null }>;
    };
  };
};

export type TtsFunctionDependencies = {
  createClient: (url: string, key: string, options?: unknown) => SupabaseClient;
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
  now: () => number;
  waitUntil?: (promise: Promise<unknown>) => void;
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type SanitizedVoiceSettings = {
  stability: number;
  similarity_boost: number;
  speed: number;
  style: number;
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sanitizeVoiceSettings(value: unknown): SanitizedVoiceSettings {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    stability: boundedNumber(settings.stability, 0.45, 0, 1),
    similarity_boost: boundedNumber(settings.similarity_boost, 0.8, 0, 1),
    speed: boundedNumber(settings.speed, 0.9, 0.7, 1.2),
    style: boundedNumber(settings.style, 0.0, 0, 1),
  };
}

export function normalizeTtsText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeVoiceSettings(settings: SanitizedVoiceSettings) {
  return {
    speed: Number(settings.speed.toFixed(3)),
    stability: Number(settings.stability.toFixed(3)),
    similarity: Number(settings.similarity_boost.toFixed(3)),
    styleExaggeration: Number(settings.style.toFixed(3)),
  };
}

function stableTtsHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildTtsCacheKey(
  text: string,
  voiceId: string,
  voiceSettings: SanitizedVoiceSettings
): string {
  const payload = JSON.stringify({
    text: normalizeTtsText(text),
    modelId: TTS_MODEL_ID,
    voiceId,
    voiceSettings: normalizeVoiceSettings(voiceSettings),
  });
  return `tts_${stableTtsHash(payload)}`;
}

function storageObjectPath(cacheKey: string): string {
  return `${TTS_AUDIO_CACHE_PREFIX}/${cacheKey}.mp3`;
}

function publicStorageUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${TTS_AUDIO_CACHE_BUCKET}/${path}`;
}

function responseHeaders(cacheStatus: 'storage-hit' | 'generated') {
  return {
    ...corsHeaders,
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'x-tts-cache': cacheStatus,
  };
}

function scheduleStorageUpload(
  deps: TtsFunctionDependencies,
  input: {
    supabaseUrl: string;
    serviceRoleKey: string | undefined;
    cacheKey: string;
    objectPath: string;
    audioBytes: Uint8Array;
    requestStartedAt: number;
    authMs: number;
    storageMs: number;
    elevenLabsMs: number;
    textLength: number;
    voiceId: string;
  }
): void {
  if (!input.serviceRoleKey) {
    deps.warn?.('ElevenLabs TTS cache upload skipped', {
      reason: 'missing-service-role-key',
      cacheKey: input.cacheKey,
      totalMs: Math.round(deps.now() - input.requestStartedAt),
    });
    return;
  }
  const serviceRoleKey = input.serviceRoleKey;

  const uploadPromise = (async () => {
    const uploadStartedAt = deps.now();
    try {
      const admin = deps.createClient(input.supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });
      const uploadBytes = input.audioBytes.buffer.slice(
        input.audioBytes.byteOffset,
        input.audioBytes.byteOffset + input.audioBytes.byteLength
      );
      const { error } = await admin.storage
        .from(TTS_AUDIO_CACHE_BUCKET)
        .upload(
          input.objectPath,
          new Blob([uploadBytes as unknown as Blob]),
          {
            contentType: 'audio/mpeg',
            cacheControl: '31536000',
            upsert: false,
          }
        );

      const uploadMs = Math.round(deps.now() - uploadStartedAt);
      if (error) {
        deps.warn?.('ElevenLabs TTS cache upload failed', {
          cacheKey: input.cacheKey,
          uploadMs,
          error,
        });
        return;
      }

      deps.log?.('ElevenLabs TTS cache upload complete', {
        cacheKey: input.cacheKey,
        uploadMs,
        authMs: input.authMs,
        storageMs: input.storageMs,
        elevenLabsMs: input.elevenLabsMs,
        totalMs: Math.round(deps.now() - input.requestStartedAt),
        textLength: input.textLength,
        voiceId: input.voiceId,
      });
    } catch (error) {
      deps.warn?.('ElevenLabs TTS cache upload failed', {
        cacheKey: input.cacheKey,
        uploadMs: Math.round(deps.now() - uploadStartedAt),
        error,
      });
    }
  })();

  if (deps.waitUntil) deps.waitUntil(uploadPromise);
  else uploadPromise.catch(() => {});
}

export function createTtsHandler(deps: TtsFunctionDependencies) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    const requestStartedAt = deps.now();
    let authMs = 0;
    let storageMs = 0;
    let elevenLabsMs = 0;

    try {
      if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
      }

      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const supabaseUrl = deps.env('SUPABASE_URL') ?? '';
      const supabaseAnonKey = deps.env('SUPABASE_ANON_KEY') ?? '';
      const supabase = deps.createClient(
        supabaseUrl,
        supabaseAnonKey,
        { global: { headers: { Authorization: authHeader } } }
      );

      const authStartedAt = deps.now();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      authMs = Math.round(deps.now() - authStartedAt);
      if (authError || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const { text, voiceId, voiceSettings } = await req.json();
      if (typeof text !== 'string' || text.trim().length === 0 || typeof voiceId !== 'string') {
        return jsonResponse({ error: 'Missing text or voiceId' }, 400);
      }
      if (text.length > MAX_TEXT_LENGTH) {
        return jsonResponse({ error: `Text must be ${MAX_TEXT_LENGTH} characters or fewer` }, 400);
      }
      if (!ALLOWED_VOICE_IDS.has(voiceId)) {
        return jsonResponse({ error: 'Voice not allowed' }, 400);
      }

      const trimmedText = normalizeTtsText(text);
      const sanitizedSettings = sanitizeVoiceSettings(voiceSettings);
      const cacheKey = buildTtsCacheKey(trimmedText, voiceId, sanitizedSettings);
      const objectPath = storageObjectPath(cacheKey);
      const storageUrl = publicStorageUrl(supabaseUrl, objectPath);

      const storageStartedAt = deps.now();
      const storageResponse = await deps.fetch(storageUrl, {
        headers: { Accept: 'audio/mpeg' },
      }).catch((error) => {
        deps.warn?.('ElevenLabs TTS cache lookup failed', {
          cacheKey,
          error,
        });
        return null;
      });
      storageMs = Math.round(deps.now() - storageStartedAt);

      if (storageResponse?.ok && storageResponse.body) {
        deps.log?.('ElevenLabs TTS request complete', {
          status: 200,
          cacheStatus: 'storage-hit',
          cacheKey,
          authMs,
          storageMs,
          elevenLabsMs,
          totalMs: Math.round(deps.now() - requestStartedAt),
          textLength: trimmedText.length,
          voiceId,
        });
        return new Response(await storageResponse.arrayBuffer(), {
          headers: responseHeaders('storage-hit'),
        });
      }

      const apiKey = deps.env('ELEVENLABS_API_KEY');
      if (!apiKey) {
        return jsonResponse({ error: 'TTS service not configured' }, 503);
      }

      const elevenLabsStartedAt = deps.now();
      const elevenLabsRes = await deps.fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify({
            text: trimmedText,
            model_id: TTS_MODEL_ID,
            voice_settings: sanitizedSettings,
          }),
        }
      );
      elevenLabsMs = Math.round(deps.now() - elevenLabsStartedAt);

      if (!elevenLabsRes.ok) {
        const upstreamBody = await elevenLabsRes.text().catch(() => '');
        deps.warn?.('ElevenLabs TTS request failed', {
          status: elevenLabsRes.status,
          cacheStatus: 'miss',
          cacheKey,
          authMs,
          storageMs,
          elevenLabsMs,
          totalMs: Math.round(deps.now() - requestStartedAt),
          textLength: trimmedText.length,
          voiceId,
          body: upstreamBody.slice(0, 500),
        });
        return jsonResponse({ error: `ElevenLabs error: ${elevenLabsRes.status}` }, elevenLabsRes.status);
      }

      const audioBytes = new Uint8Array(await elevenLabsRes.arrayBuffer());
      scheduleStorageUpload(deps, {
        supabaseUrl,
        serviceRoleKey: deps.env('SUPABASE_SERVICE_ROLE_KEY'),
        cacheKey,
        objectPath,
        audioBytes,
        requestStartedAt,
        authMs,
        storageMs,
        elevenLabsMs,
        textLength: trimmedText.length,
        voiceId,
      });

      deps.log?.('ElevenLabs TTS request complete', {
        status: elevenLabsRes.status,
        cacheStatus: 'generated',
        cacheKey,
        authMs,
        storageMs,
        elevenLabsMs,
        totalMs: Math.round(deps.now() - requestStartedAt),
        textLength: trimmedText.length,
        voiceId,
      });

      return new Response(audioBytes, {
        headers: responseHeaders('generated'),
      });
    } catch (error) {
      deps.error?.('TTS function failed', {
        error,
        authMs,
        storageMs,
        elevenLabsMs,
        totalMs: Math.round(deps.now() - requestStartedAt),
      });
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  };
}
