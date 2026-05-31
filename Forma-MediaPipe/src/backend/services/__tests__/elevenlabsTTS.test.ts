type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function drainMicrotasks(count = 30): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

function audioResponse(bytes = [1, 2, 3], cacheStatus = 'generated'): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: jest.fn((name: string) => name.toLowerCase() === 'x-tts-cache' ? cacheStatus : null),
    },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Response;
}

function httpResponse(status: number, body = ''): Response {
  return {
    ok: false,
    status,
    headers: { get: jest.fn(() => null) },
    text: async () => body,
  } as unknown as Response;
}

function createFileSystemMock() {
  const files = new Map<string, { content: string; size: number; modificationTime: number }>();
  const directories = new Set<string>(['file://cache/']);

  return {
    cacheDirectory: 'file://cache/',
    EncodingType: { Base64: 'base64' },
    makeDirectoryAsync: jest.fn(async (uri: string) => {
      directories.add(uri);
    }),
    getInfoAsync: jest.fn(async (uri: string) => {
      if (directories.has(uri)) return { exists: true, isDirectory: true };
      const file = files.get(uri);
      if (!file) return { exists: false };
      return { exists: true, size: file.size, modificationTime: file.modificationTime };
    }),
    writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
      files.set(uri, { content, size: content.length, modificationTime: Date.now() / 1000 });
    }),
    readDirectoryAsync: jest.fn(async (uri: string) => {
      const prefix = uri.endsWith('/') ? uri : `${uri}/`;
      return Array.from(files.keys())
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length));
    }),
    deleteAsync: jest.fn(async (uri: string) => {
      files.delete(uri);
    }),
    files,
  };
}

function createPlayerMock() {
  const listeners: Array<(status: { didJustFinish?: boolean }) => void> = [];
  const subscriptions: Array<{ remove: jest.Mock }> = [];
  const player = {
    volume: 0,
    pause: jest.fn(),
    seekTo: jest.fn(async () => {}),
    remove: jest.fn(),
    play: jest.fn(),
    addListener: jest.fn((_event: string, listener: (status: { didJustFinish?: boolean }) => void) => {
      const subscription = { remove: jest.fn() };
      listeners.push(listener);
      subscriptions.push(subscription);
      return subscription;
    }),
    emitStatus(status: { didJustFinish?: boolean }) {
      for (const listener of listeners) listener(status);
    },
    subscriptions,
  };
  return player;
}

function loadTtsService(options: {
  audioAvailable?: boolean;
  fetchImpl?: jest.Mock;
  getSessionImpl?: jest.Mock;
} = {}) {
  jest.resetModules();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://supabase.test';
  process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID = 'voice-default';

  const players: ReturnType<typeof createPlayerMock>[] = [];
  const fileSystem = createFileSystemMock();
  const setAudioModeAsync = jest.fn(async () => {});
  const createAudioPlayer = jest.fn(() => {
    const player = createPlayerMock();
    players.push(player);
    return player;
  });
  const fetchImpl = options.fetchImpl ?? jest.fn(async () => audioResponse());
  const getSession = options.getSessionImpl ?? jest.fn(async () => ({
    data: { session: { access_token: 'session-token', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
  }));

  jest.doMock('../supabase/client', () => ({
    supabase: { auth: { getSession } },
  }));
  jest.doMock('expo-file-system', () => fileSystem);
  if (options.audioAvailable === false) {
    jest.doMock('expo-audio', () => {
      throw new Error('expo-audio unavailable');
    });
  } else {
    jest.doMock('expo-audio', () => ({
      createAudioPlayer,
      setAudioModeAsync,
    }));
  }

  (global as any).fetch = fetchImpl;

  const service = require('../elevenlabsTTS') as typeof import('../elevenlabsTTS');
  return { service, fileSystem, players, createAudioPlayer, setAudioModeAsync, fetchImpl, getSession };
}

async function speakAndFinish(
  service: typeof import('../elevenlabsTTS'),
  players: ReturnType<typeof createPlayerMock>[],
  text = 'Stand tall.'
): Promise<ReturnType<typeof createPlayerMock>> {
  const expectedPlayerCount = players.length + 1;
  const speech = service.speakWithElevenLabs(text);
  await drainMicrotasks();
  expect(players).toHaveLength(expectedPlayerCount);
  const player = players[players.length - 1];
  player.emitStatus({ didJustFinish: true });
  await speech;
  return player;
}

describe('ElevenLabs TTS expo-audio playback', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.restoreAllMocks();
    jest.resetModules();
    delete (global as any).fetch;
  });

  it('initializes audio mode once and plays generated speech to completion', async () => {
    const { service, players, createAudioPlayer, setAudioModeAsync, fetchImpl, fileSystem } = loadTtsService();

    await speakAndFinish(service, players);

    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
      interruptionModeAndroid: 'duckOthers',
      shouldRouteThroughEarpiece: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://supabase.test/functions/v1/tts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer session-token',
          Accept: 'audio/mpeg',
        }),
      })
    );
    expect(fileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/cache\/tts-cache\/tts_[a-z0-9]+\.mp3$/),
      expect.any(String),
      { encoding: 'base64' }
    );
    expect(createAudioPlayer).toHaveBeenCalledWith(
      { uri: expect.stringMatching(/^file:\/\/cache\/tts-cache\/tts_[a-z0-9]+\.mp3$/) },
      250
    );
    expect(players[0].volume).toBe(1);
    expect(players[0].play).toHaveBeenCalledTimes(1);
    expect(players[0].remove).toHaveBeenCalledTimes(1);
    expect(players[0].subscriptions[0].remove).toHaveBeenCalledTimes(1);

    await speakAndFinish(service, players, 'Brace your core.');
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
  });

  it('stopSpeech cancels active playback and releases the player', async () => {
    const { service, players } = loadTtsService();

    const speech = service.speakWithElevenLabs('Keep moving.');
    await drainMicrotasks();
    expect(players).toHaveLength(1);

    await service.stopSpeech();
    await speech;

    expect(players[0].pause).toHaveBeenCalledTimes(1);
    expect(players[0].seekTo).toHaveBeenCalledWith(0);
    expect(players[0].remove).toHaveBeenCalledTimes(1);
    expect(players[0].subscriptions[0].remove).toHaveBeenCalledTimes(1);
  });

  it('does not play stale audio when a newer speech request wins the generation race', async () => {
    const firstFetch = deferred<Response>();
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce((_url: string, options: RequestInit) => {
        options.signal?.addEventListener?.('abort', () => {
          firstFetch.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
        return firstFetch.promise;
      })
      .mockImplementationOnce(async () => audioResponse([4, 5, 6]));
    const { service, players, createAudioPlayer } = loadTtsService({ fetchImpl });

    const staleSpeech = service.speakWithElevenLabs('Old cue.', { purpose: 'trainer-preview' }).catch(() => {});
    await drainMicrotasks();
    const currentSpeech = service.speakWithElevenLabs('New cue.', { purpose: 'trainer-preview' });
    await drainMicrotasks();

    expect(players).toHaveLength(1);
    players[0].emitStatus({ didJustFinish: true });
    await currentSpeech;

    await staleSpeech;

    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(players[0].play).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable and skips playback when expo-audio cannot be loaded', async () => {
    const { service } = loadTtsService({ audioAvailable: false });

    expect(service.isElevenLabsAvailable()).toBe(false);
    await expect(service.speakWithElevenLabs('Hello.')).resolves.toBeUndefined();
  });

  it('keeps the request voice snapshot stable across async session lookup', async () => {
    const session = deferred<{ data: { session: { access_token: string } } }>();
    const fetchImpl = jest.fn(async () => audioResponse());
    const { service, players } = loadTtsService({
      fetchImpl,
      getSessionImpl: jest.fn(() => session.promise),
    });

    service.setActiveVoiceId('voice-a');
    service.setActiveVoiceSettings({ speed: 0.91, stability: 0.41, similarity: 0.81, styleExaggeration: 0.11 });
    const speech = service.speakWithElevenLabs('Snapshot cue.', { purpose: 'trainer-preview' });
    await drainMicrotasks();
    service.setActiveVoiceId('voice-b');
    service.setActiveVoiceSettings({ speed: 1.11, stability: 0.61, similarity: 0.91, styleExaggeration: 0.21 });

    session.resolve({ data: { session: { access_token: 'session-token' } } });
    await drainMicrotasks();
    expect(players).toHaveLength(1);
    players[0].emitStatus({ didJustFinish: true });
    await speech;

    const firstFetchOptions = (fetchImpl.mock.calls as any)[0][1] as RequestInit;
    const body = JSON.parse(String(firstFetchOptions.body));
    expect(body.voiceId).toBe('voice-a');
    expect(body.voiceSettings).toEqual({
      speed: 0.91,
      stability: 0.41,
      similarity_boost: 0.81,
      style: 0.11,
    });
  });

  it('aborts stale trainer preview requests when a new preview starts', async () => {
    const firstFetch = deferred<Response>();
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce((_url: string, options: RequestInit) => {
        options.signal?.addEventListener?.('abort', () => {
          firstFetch.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
        return firstFetch.promise;
      })
      .mockImplementationOnce(async () => audioResponse([4, 5, 6]));
    const { service, players } = loadTtsService({ fetchImpl });

    const staleSpeech = service.speakWithElevenLabs('Old preview.', { purpose: 'trainer-preview' }).catch((error) => error);
    await drainMicrotasks();
    const currentSpeech = service.speakWithElevenLabs('New preview.', { purpose: 'trainer-preview' });
    await drainMicrotasks();

    expect(await staleSpeech).toBeInstanceOf(Error);
    expect(players).toHaveLength(1);
    players[0].emitStatus({ didJustFinish: true });
    await currentSpeech;
  });

  it('prefetches audio without creating an audio player', async () => {
    const { service, createAudioPlayer, fetchImpl, fileSystem } = loadTtsService();

    await service.prefetchSpeech('Warm this cue.');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  it('shares in-flight generation work for identical speech requests', async () => {
    const fetchResult = deferred<Response>();
    const fetchImpl = jest.fn(() => fetchResult.promise);
    const { service } = loadTtsService({ fetchImpl });
    const snapshot = service.createVoiceSnapshot('shared-voice', {
      speed: 1,
      stability: 0.5,
      similarity: 0.8,
      styleExaggeration: 0,
    });

    const first = service.prepareSpeech('Same cue.', snapshot);
    const second = service.prepareSpeech('Same cue.', snapshot);
    await drainMicrotasks();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    fetchResult.resolve(audioResponse());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('reuses deterministic cached audio files on later requests', async () => {
    const { service, fetchImpl } = loadTtsService();

    const first = await service.prepareSpeech('Cached cue.');
    const second = await service.prepareSpeech('Cached cue.');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.uri).toBe(first.uri);
    expect(second.cacheKey).toBe(first.cacheKey);
  });

  it('maps server cache responses onto prepared speech metadata', async () => {
    const { service } = loadTtsService({
      fetchImpl: jest.fn(async () => audioResponse([8, 9, 10], 'storage-hit')),
    });

    const prepared = await service.prepareSpeech('Server cached cue.');

    expect(prepared.source).toBe('server-cache');
    expect(prepared.prepareDurationMs).toEqual(expect.any(Number));
  });

  it('memoizes auth tokens and refreshes once after a 401', async () => {
    const getSession = jest
      .fn()
      .mockResolvedValueOnce({
        data: { session: { access_token: 'stale-token', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      })
      .mockResolvedValueOnce({
        data: { session: { access_token: 'fresh-token', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(httpResponse(401, 'expired'))
      .mockResolvedValueOnce(audioResponse([4, 5, 6]))
      .mockResolvedValueOnce(audioResponse([7, 8, 9]));
    const { service } = loadTtsService({ fetchImpl, getSessionImpl: getSession });

    await service.prepareSpeech('Refresh me.');
    await service.prepareSpeech('Use memoized token.');

    expect(getSession).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer stale-token',
    }));
    expect((fetchImpl.mock.calls[1][1] as RequestInit).headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer fresh-token',
    }));
    expect((fetchImpl.mock.calls[2][1] as RequestInit).headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer fresh-token',
    }));
  });

  it('suppresses prefetch network work while the failure circuit is open but still reuses local cache', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(audioResponse([1, 2, 3]))
      .mockResolvedValue(httpResponse(500, 'unavailable'));
    const { service } = loadTtsService({ fetchImpl });

    await service.prepareSpeech('Cached before failures.', undefined, { purpose: 'prefetch' });
    await expect(service.prepareSpeech('Failure one.', undefined, { purpose: 'prefetch' })).rejects.toMatchObject({ status: 500 });
    await expect(service.prepareSpeech('Failure two.', undefined, { purpose: 'prefetch' })).rejects.toMatchObject({ status: 500 });
    await expect(service.prepareSpeech('Failure three.', undefined, { purpose: 'prefetch' })).rejects.toMatchObject({ status: 500 });

    await expect(service.prefetchSpeech('Suppressed cue.')).resolves.toBeUndefined();
    const cached = await service.prepareSpeech('Cached before failures.', undefined, { purpose: 'prefetch' });

    expect(cached.source).toBe('local-cache');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('times out slow requests and releases playback state', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener?.('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));
    const { service } = loadTtsService({ fetchImpl });

    const speech = service.speakWithElevenLabs('Slow cue.', {
      purpose: 'trainer-preview',
      timeoutMs: 100,
    });
    await drainMicrotasks();
    jest.advanceTimersByTime(150);

    await expect(speech).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('uses a playback watchdog when no finish event arrives', async () => {
    jest.useFakeTimers();
    const { service, players } = loadTtsService();

    const speech = service.speakWithElevenLabs('No finish event.');
    await drainMicrotasks();
    expect(players).toHaveLength(1);

    jest.advanceTimersByTime(13000);
    await speech;

    expect(players[0].remove).toHaveBeenCalledTimes(1);
  });
});
