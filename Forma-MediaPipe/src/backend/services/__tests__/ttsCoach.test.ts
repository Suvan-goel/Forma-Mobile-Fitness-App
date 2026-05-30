jest.mock('../elevenlabsTTS', () => ({
  isElevenLabsAvailable: jest.fn(() => true),
  speakWithElevenLabs: jest.fn(async () => {}),
  playPreparedSpeech: jest.fn(async () => {}),
}));

import {
  onTrackingQualityWarning,
  onUnscoredRep,
  resetCoachState,
} from '../ttsCoach';
import { speakWithElevenLabs } from '../elevenlabsTTS';
import { UNSCORED_REP_FEEDBACK } from '../../../utils/exercises/shared/poseQuality';

const speakMock = speakWithElevenLabs as jest.MockedFunction<typeof speakWithElevenLabs>;

describe('ttsCoach reliability warnings', () => {
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    resetCoachState();
    speakMock.mockClear();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('rate-limits unscored rep TTS with live tracking warnings', async () => {
    await onTrackingQualityWarning('Move the camera back.');
    await onUnscoredRep(`${UNSCORED_REP_FEEDBACK} Keep your full body inside the frame.`);

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledWith('Move the camera back.', { purpose: 'coach' });

    nowSpy.mockReturnValue(11050);
    await onUnscoredRep(`${UNSCORED_REP_FEEDBACK} Keep your full body inside the frame.`);

    expect(speakMock).toHaveBeenCalledTimes(2);
    expect(speakMock).toHaveBeenLastCalledWith(`${UNSCORED_REP_FEEDBACK} Keep your full body inside the frame.`, { purpose: 'coach' });
  });

  it('clears speaking state after a failed speech request', async () => {
    speakMock
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(undefined);

    await onTrackingQualityWarning('Move the camera back.');
    nowSpy.mockReturnValue(11050);
    await onTrackingQualityWarning('Keep your full body inside the frame.');

    expect(speakMock).toHaveBeenCalledTimes(2);
    expect(speakMock).toHaveBeenLastCalledWith('Keep your full body inside the frame.', { purpose: 'coach' });
  });

  it('drops overlapping coach messages while speech is in progress', async () => {
    let resolveSpeech!: () => void;
    speakMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveSpeech = resolve;
    }));

    const first = onTrackingQualityWarning('Move the camera back.');
    await Promise.resolve();
    nowSpy.mockReturnValue(11050);
    await onTrackingQualityWarning('Keep your full body inside the frame.');

    expect(speakMock).toHaveBeenCalledTimes(1);
    resolveSpeech();
    await first;
  });
});
