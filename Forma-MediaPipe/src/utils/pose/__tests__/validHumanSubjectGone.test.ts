import type { Keypoint } from '../../poseAnalysis';
import { buildPoseState } from '../buildPoseState';
import {
  ValidHumanSubjectTracker,
  evaluateValidHumanSubject,
} from '../validHumanSubject';

const MAJOR_JOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

const BASE_POINTS: Record<string, Pick<Keypoint, 'x' | 'y' | 'z'>> = {
  left_shoulder: { x: 0.42, y: 0.24, z: 0 },
  right_shoulder: { x: 0.58, y: 0.24, z: 0 },
  left_elbow: { x: 0.37, y: 0.38, z: 0 },
  right_elbow: { x: 0.63, y: 0.38, z: 0 },
  left_wrist: { x: 0.34, y: 0.52, z: 0 },
  right_wrist: { x: 0.66, y: 0.52, z: 0 },
  left_hip: { x: 0.44, y: 0.52, z: 0 },
  right_hip: { x: 0.56, y: 0.52, z: 0 },
  left_knee: { x: 0.44, y: 0.72, z: 0 },
  right_knee: { x: 0.56, y: 0.72, z: 0 },
  left_ankle: { x: 0.44, y: 0.9, z: 0 },
  right_ankle: { x: 0.56, y: 0.9, z: 0 },
};

function keypoints(args: { score?: number; offsetX?: number } = {}): Keypoint[] {
  const { score = 0.99, offsetX = 0 } = args;
  return MAJOR_JOINTS.map((name) => ({
    name,
    score,
    ...BASE_POINTS[name],
    x: BASE_POINTS[name].x + offsetX,
  }));
}

function subject(frameKeypoints: Keypoint[]) {
  return evaluateValidHumanSubject({
    poseState: buildPoseState({
      status: 'ok',
      keypoints: frameKeypoints,
      worldKeypoints: undefined,
      imageKeypoints: frameKeypoints,
      primarySource: 'image',
      timestampMs: 1000,
      metadata: {},
      diagnostics: {},
    } as any),
    imageKeypoints: frameKeypoints,
  });
}

// A confident subject: high scores make every chain reliable.
const confident = () => subject(keypoints());
// MediaPipe hallucination after the user leaves: joints still present but all
// low-visibility (zero reliable chains), box drifted half off-frame.
const hallucinatedOffFrame = () => subject(keypoints({ score: 0.4, offsetX: 0.6 }));
// Occlusion-like degradation: zero reliable chains but the box stays put.
const degradedInPlace = () => subject(keypoints({ score: 0.4 }));

describe('subject-gone detection', () => {
  it('uses fixtures with the intended chain reliability', () => {
    const reliableCount = (result: ReturnType<typeof subject>) =>
      Object.values(result.chainStatuses).filter((status) => status === 'reliable').length;
    expect(reliableCount(confident())).toBeGreaterThan(0);
    expect(reliableCount(hallucinatedOffFrame())).toBe(0);
    expect(reliableCount(degradedInPlace())).toBe(0);
  });

  // The detector requires the subject to have been reliably tracked for a
  // sustained streak before it can arm.
  function trackConfidently(tracker: ValidHumanSubjectTracker, untilMs: number): void {
    for (let t = 0; t <= untilMs; t += 100) {
      tracker.update(confident(), t);
    }
  }

  it('flags subject-gone after a sustained zero-reliable run with off-frame drift, then re-entry', () => {
    const tracker = new ValidHumanSubjectTracker();
    trackConfidently(tracker, 1500);

    let latest = tracker.update(hallucinatedOffFrame(), 2000);
    for (let t = 2200; t <= 4400; t += 200) {
      latest = tracker.update(hallucinatedOffFrame(), t);
    }
    // 2.4s into the run: below the minimum gone duration.
    expect(latest.subjectGone).toBe(false);

    const armed = tracker.update(hallucinatedOffFrame(), 4600);
    expect(armed.subjectGone).toBe(true);
    expect(armed.subjectGoneReentry).toBe(false);

    const reentry = tracker.update(confident(), 4700);
    expect(reentry.subjectGone).toBe(true);
    expect(reentry.subjectGoneReentry).toBe(true);

    const settled = tracker.update(confident(), 4800);
    expect(settled.subjectGone).toBe(false);
    expect(settled.subjectGoneReentry).toBe(false);
  });

  it('does not flag a short occlusion-like degradation', () => {
    const tracker = new ValidHumanSubjectTracker();
    trackConfidently(tracker, 1500);

    for (let t = 2000; t <= 2800; t += 200) {
      expect(tracker.update(hallucinatedOffFrame(), t).subjectGone).toBe(false);
    }
    const recovered = tracker.update(confident(), 3000);
    expect(recovered.subjectGone).toBe(false);
    expect(recovered.subjectGoneReentry).toBe(false);
  });

  it('does not flag a long degradation without center-jump or off-frame evidence', () => {
    const tracker = new ValidHumanSubjectTracker();
    trackConfidently(tracker, 1500);

    let latest = tracker.update(degradedInPlace(), 2000);
    for (let t = 2200; t <= 9000; t += 200) {
      latest = tracker.update(degradedInPlace(), t);
    }
    expect(latest.subjectGone).toBe(false);
  });

  it('does not flag when the subject was never reliably tracked for a sustained streak', () => {
    const tracker = new ValidHumanSubjectTracker();
    // One reliable frame inside otherwise-junk data must not count as a
    // tracked subject (deliberately noisy/unscorable sets).
    tracker.update(confident(), 0);
    let latest = tracker.update(hallucinatedOffFrame(), 100);
    for (let t = 300; t <= 8000; t += 200) {
      latest = tracker.update(hallucinatedOffFrame(), t);
    }
    expect(latest.subjectGone).toBe(false);
  });

  it('never flags without frame timestamps', () => {
    const tracker = new ValidHumanSubjectTracker();
    tracker.update(confident());
    for (let i = 0; i < 200; i++) {
      expect(tracker.update(hallucinatedOffFrame()).subjectGone).toBe(false);
    }
  });

  it('does not flag when no subject was ever tracked', () => {
    const tracker = new ValidHumanSubjectTracker();
    for (let t = 0; t <= 6000; t += 200) {
      expect(tracker.update(hallucinatedOffFrame(), t).subjectGone).toBe(false);
    }
  });
});
