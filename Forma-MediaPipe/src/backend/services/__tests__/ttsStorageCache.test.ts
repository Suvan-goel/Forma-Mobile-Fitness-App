import { buildTtsCacheKey as buildClientTtsCacheKey, TTS_MODEL_ID } from '../ttsCacheKey';
import {
  buildTtsCacheKey as buildEdgeTtsCacheKey,
  createTtsHandler,
} from '../../../../supabase/functions/tts/handler';

function makeRequest(body: Record<string, unknown>, auth = 'Bearer user-token'): Request {
  return new Request('https://supabase.test/functions/v1/tts', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : undefined,
    body: JSON.stringify(body),
  });
}

function createDeps(options: {
  fetchImpl?: jest.Mock;
  getUserImpl?: jest.Mock;
  uploadImpl?: jest.Mock;
  env?: Record<string, string | undefined>;
} = {}) {
  const upload = options.uploadImpl ?? jest.fn(async () => ({ data: { path: 'cached.mp3' }, error: null }));
  const getUser = options.getUserImpl ?? jest.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }));
  const waitUntilPromises: Promise<unknown>[] = [];
  const createClient = jest.fn((_url: string, key: string) => {
    if (key === 'service-role') {
      return {
        auth: { getUser },
        storage: { from: jest.fn(() => ({ upload })) },
      };
    }
    return {
      auth: { getUser },
      storage: { from: jest.fn(() => ({ upload })) },
    };
  });

  const env: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    ELEVENLABS_API_KEY: 'eleven-key',
    ...options.env,
  };

  const deps = {
    createClient,
    fetch: options.fetchImpl ?? jest.fn(),
    env: (name: string) => env[name],
    now: jest.fn(() => 1000),
    waitUntil: jest.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
    }),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  return { deps, upload, getUser, createClient, waitUntilPromises };
}

function ttsBody() {
  return {
    text: '  Stand   tall.  ',
    voiceId: '56bWURjYFHyYyVf490Dp',
    voiceSettings: {
      stability: 0.55,
      similarity_boost: 0.8,
      speed: 0.96,
      style: 0,
    },
  };
}

describe('TTS Storage cache Edge Function', () => {
  it('uses the same deterministic cache key fixture as the client', () => {
    const body = ttsBody();
    const clientKey = buildClientTtsCacheKey(String(body.text), {
      voiceId: body.voiceId,
      modelId: TTS_MODEL_ID,
      voiceSettings: {
        stability: body.voiceSettings.stability,
        similarity: body.voiceSettings.similarity_boost,
        speed: body.voiceSettings.speed,
        styleExaggeration: body.voiceSettings.style,
      },
    });
    const edgeKey = buildEdgeTtsCacheKey(String(body.text), body.voiceId, body.voiceSettings);

    expect(edgeKey).toBe(clientKey);
    expect(edgeKey).toMatch(/^tts_[a-z0-9]+$/);
  });

  it('returns a storage hit without calling ElevenLabs', async () => {
    const fetchImpl = jest.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const { deps } = createDeps({ fetchImpl });
    const handler = createTtsHandler(deps);

    const response = await handler(makeRequest(ttsBody()));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-tts-cache')).toBe('storage-hit');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls as unknown[][])[0][0])).toContain('/storage/v1/object/public/tts-audio-cache/v1/tts_');
  });

  it('generates on storage miss and schedules a best-effort upload', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));
    const { deps, upload, waitUntilPromises } = createDeps({ fetchImpl });
    const handler = createTtsHandler(deps);

    const response = await handler(makeRequest(ttsBody()));
    await Promise.all(waitUntilPromises);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-tts-cache')).toBe('generated');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('api.elevenlabs.io');
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^v1\/tts_[a-z0-9]+\.mp3$/),
      expect.any(Blob),
      {
        contentType: 'audio/mpeg',
        cacheControl: '31536000',
        upsert: false,
      }
    );
  });

  it('still returns generated audio if the storage upload fails', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));
    const { deps, waitUntilPromises } = createDeps({
      fetchImpl,
      uploadImpl: jest.fn(async () => ({ data: null, error: { message: 'race conflict' } })),
    });
    const handler = createTtsHandler(deps);

    const response = await handler(makeRequest(ttsBody()));
    await Promise.all(waitUntilPromises);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-tts-cache')).toBe('generated');
    expect(deps.warn).toHaveBeenCalledWith(
      'ElevenLabs TTS cache upload failed',
      expect.objectContaining({ error: { message: 'race conflict' } })
    );
  });

  it('preserves invalid auth, text, and voice behavior', async () => {
    const { deps } = createDeps({
      getUserImpl: jest.fn(async () => ({ data: { user: null }, error: new Error('bad token') })),
    });
    const authHandler = createTtsHandler(deps);
    expect((await authHandler(makeRequest(ttsBody()))).status).toBe(401);

    const validHandler = createTtsHandler(createDeps().deps);
    expect((await validHandler(makeRequest({ ...ttsBody(), text: '' }))).status).toBe(400);
    expect((await validHandler(makeRequest({ ...ttsBody(), voiceId: 'not-allowed' }))).status).toBe(400);
  });
});
