const trainer = {
  id: 'marcus',
  name: 'Marcus',
  voiceId: 'voice-selected',
  voiceSettings: { speed: 0.97, stability: 0.62, similarity: 0.87, styleExaggeration: 0.06 },
  previewGreeting: "Hey, I'm Marcus. Stay controlled.",
  greeting: 'Fallback greeting.',
};

function loadCuePack(prefetchImpl = jest.fn(async () => {})) {
  jest.resetModules();
  jest.doMock('../elevenlabsTTS', () => ({
    createVoiceSnapshot: jest.fn((voiceId, voiceSettings) => ({
      voiceId,
      voiceSettings,
      modelId: 'eleven_flash_v2_5',
    })),
    logTtsEvent: jest.fn(),
    prefetchSpeech: prefetchImpl,
  }));

  const service = require('../ttsCuePack') as typeof import('../ttsCuePack');
  const tts = require('../elevenlabsTTS') as {
    prefetchSpeech: jest.Mock;
  };
  return { service, prefetchSpeech: tts.prefetchSpeech };
}

describe('trainer TTS cue packs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('builds a bounded current-exercise cue pack with set-start and coach cues', () => {
    const { service } = loadCuePack();

    const texts = service.getCuePackTexts('Barbell Curl');

    expect(texts).toContain("Alright, Barbell Curl. Let's get into it.");
    expect(texts).toContain('Nice rep. Keep that rhythm.');
    expect(texts).toContain('There you go. Much better.');
    expect(texts.length).toBeGreaterThan(20);
  });

  it('warms only the supplied trainer snapshot and never plays audio directly', async () => {
    const { service, prefetchSpeech } = loadCuePack();

    await service.warmTrainerCuePack({
      trainer,
      exerciseName: 'Barbell Curl',
      reason: 'camera-focus',
    });

    expect(prefetchSpeech).toHaveBeenCalled();
    expect(prefetchSpeech.mock.calls[0][0]).toBe(trainer.previewGreeting);
    for (const call of prefetchSpeech.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ voiceId: 'voice-selected' }));
      expect(call[2]).toEqual({ purpose: 'prefetch', timeoutMs: 12000 });
    }
  });

  it('cancels stale cue-pack warming between prefetches', async () => {
    let service: typeof import('../ttsCuePack');
    const prefetchImpl = jest.fn(async () => {
      service.cancelTrainerCuePackWarming();
    });
    const loaded = loadCuePack(prefetchImpl);
    service = loaded.service;

    await service.warmTrainerCuePack({
      trainer,
      exerciseName: 'Barbell Curl',
      reason: 'trainer-picker',
    });

    expect(loaded.prefetchSpeech).toHaveBeenCalledTimes(1);
  });
});
