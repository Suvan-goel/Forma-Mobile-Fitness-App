type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function drainMicrotasks(count = 8): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

function audioResponse(bytes = [1, 2, 3]): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as Response;
}

function createFileSystemMock() {
  return {
    cacheDirectory: 'file://cache/',
    EncodingType: { Base64: 'base64' },
    getInfoAsync: jest.fn(async () => ({ exists: false })),
    writeAsStringAsync: jest.fn(async () => {}),
    readDirectoryAsync: jest.fn(async () => []),
    deleteAsync: jest.fn(async () => {}),
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
  const getSession = jest.fn(async () => ({
    data: { session: { access_token: 'session-token' } },
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
      expect.stringMatching(/^file:\/\/cache\/tts_\d+\.mp3$/),
      expect.any(String),
      { encoding: 'base64' }
    );
    expect(createAudioPlayer).toHaveBeenCalledWith(
      { uri: expect.stringMatching(/^file:\/\/cache\/tts_\d+\.mp3$/) },
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
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementationOnce(async () => audioResponse([4, 5, 6]));
    const { service, players, createAudioPlayer } = loadTtsService({ fetchImpl });

    const staleSpeech = service.speakWithElevenLabs('Old cue.');
    await drainMicrotasks();
    const currentSpeech = service.speakWithElevenLabs('New cue.');
    await drainMicrotasks();

    expect(players).toHaveLength(1);
    players[0].emitStatus({ didJustFinish: true });
    await currentSpeech;

    firstFetch.resolve(audioResponse([7, 8, 9]));
    await staleSpeech;

    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(players[0].play).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable and skips playback when expo-audio cannot be loaded', async () => {
    const { service } = loadTtsService({ audioAvailable: false });

    expect(service.isElevenLabsAvailable()).toBe(false);
    await expect(service.speakWithElevenLabs('Hello.')).resolves.toBeUndefined();
  });
});
