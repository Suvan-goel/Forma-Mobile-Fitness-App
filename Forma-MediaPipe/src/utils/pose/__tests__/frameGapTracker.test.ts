import { createPoseFrameGapTracker } from '../frameGapTracker';

describe('PoseFrameGapTracker', () => {
  it('does not treat the first frame as interrupted', () => {
    const tracker = createPoseFrameGapTracker();

    expect(tracker.observe(1000)).toEqual({ trackingInterrupted: false });
  });

  it('does not interrupt normal frame gaps', () => {
    const tracker = createPoseFrameGapTracker();

    tracker.observe(1000);
    expect(tracker.observe(1033)).toEqual({ silentGapMs: 33, trackingInterrupted: false });
    expect(tracker.observe(1233)).toEqual({ silentGapMs: 200, trackingInterrupted: false });
  });

  it('does not interrupt a 700ms gap', () => {
    const tracker = createPoseFrameGapTracker();

    tracker.observe(1000);
    expect(tracker.observe(1700)).toEqual({ silentGapMs: 700, trackingInterrupted: false });
  });

  it('interrupts a gap above 1000ms and tracks reacquisition frames', () => {
    const tracker = createPoseFrameGapTracker();

    tracker.observe(1000);
    expect(tracker.observe(2001)).toEqual({
      silentGapMs: 1001,
      trackingInterrupted: true,
      reacquisitionFrameIndex: 0,
    });
    expect(tracker.observe(2034)).toEqual({
      silentGapMs: 33,
      trackingInterrupted: false,
      reacquisitionFrameIndex: 1,
    });
    expect(tracker.observe(2067)).toEqual({
      silentGapMs: 33,
      trackingInterrupted: false,
      reacquisitionFrameIndex: 2,
    });
  });

  it('resets first-frame and reacquisition state', () => {
    const tracker = createPoseFrameGapTracker();

    tracker.observe(1000);
    tracker.observe(2500);
    tracker.reset();

    expect(tracker.observe(3000)).toEqual({ trackingInterrupted: false });
  });
});
