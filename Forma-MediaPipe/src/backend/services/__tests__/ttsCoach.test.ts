jest.mock('../elevenlabsTTS', () => ({
  isElevenLabsAvailable: jest.fn(() => true),
  speakWithElevenLabs: jest.fn(async () => {}),
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
    expect(speakMock).toHaveBeenCalledWith('Move the camera back.');

    nowSpy.mockReturnValue(11050);
    await onUnscoredRep(`${UNSCORED_REP_FEEDBACK} Keep your full body inside the frame.`);

    expect(speakMock).toHaveBeenCalledTimes(2);
    expect(speakMock).toHaveBeenLastCalledWith(`${UNSCORED_REP_FEEDBACK} Keep your full body inside the frame.`);
  });
});
