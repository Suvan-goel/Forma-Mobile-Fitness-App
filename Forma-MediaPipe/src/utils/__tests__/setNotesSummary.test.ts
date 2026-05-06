import { generateSetSummary } from '../setNotesSummary';
import { UNSCORED_REP_FEEDBACK } from '../exercises/shared/poseQuality';

describe('generateSetSummary', () => {
  it('describes fully unscored sets as tracking-limited, not zero-score form', () => {
    const summary = generateSetSummary(
      [`${UNSCORED_REP_FEEDBACK} Keep full body in frame.`],
      0,
      'Push-Up',
      {
        scoredRepCount: 0,
        unscoredRepCount: 1,
        trackingQualityMessage: 'Tracking quality: Lost. Form score based on 0 of 1 reps.',
      },
    );

    expect(summary).toContain('tracking was too low to score form');
    expect(summary).toContain('Set counted 1 rep');
    expect(summary).not.toContain('0/100');
  });

  it('keeps tracking-limited reps separate from form faults in mixed summaries', () => {
    const summary = generateSetSummary(
      [
        'Great rep!',
        `${UNSCORED_REP_FEEDBACK} Move camera back.`,
        'Slow down the push — control the extension.',
      ],
      82,
      'Cable Pushdowns',
      {
        scoredRepCount: 2,
        unscoredRepCount: 1,
      },
    );

    expect(summary).toContain('2 scored reps');
    expect(summary).toContain('1 rep was unscored because tracking was too low');
    expect(summary).toContain('Overall form score based on scored reps: 82/100');
    expect(summary).not.toContain(UNSCORED_REP_FEEDBACK);
  });
});
