import { CanonicalJoint } from '../CanonicalJoint';
import { ProfileBuilder, ProfileSession } from '../profileBuilder';
import type { Joint2D, Joint3D, SkeletonFrame } from '../SkeletonFrame';

function joint(x: number, y: number, z = 0, confidence = 0.99, isSynthetic = false): Joint3D {
  return { x, y, z, confidence, isSynthetic };
}

function joint2D(x: number, y: number, confidence = 0.99): Joint2D {
  return { x, y, confidence };
}

function makeFrame(confidence = 0.99): SkeletonFrame {
  const joints: Record<CanonicalJoint, Joint3D> = {
    [CanonicalJoint.HEAD]: joint(0, 0.8, 0, confidence),
    [CanonicalJoint.NECK]: joint(0, 0.6, 0, confidence, true),
    [CanonicalJoint.CHEST_CENTER]: joint(0, 0.5, 0, confidence, true),
    [CanonicalJoint.PELVIS_CENTER]: joint(0, 0, 0, confidence, true),
    [CanonicalJoint.LEFT_SHOULDER]: joint(-0.2, 0.5, 0, confidence),
    [CanonicalJoint.RIGHT_SHOULDER]: joint(0.2, 0.5, 0, confidence),
    [CanonicalJoint.LEFT_ELBOW]: joint(-0.2, 0.2, 0, confidence),
    [CanonicalJoint.RIGHT_ELBOW]: joint(0.2, 0.2, 0, confidence),
    [CanonicalJoint.LEFT_WRIST]: joint(-0.2, 0, 0, confidence),
    [CanonicalJoint.RIGHT_WRIST]: joint(0.2, 0, 0, confidence),
    [CanonicalJoint.LEFT_HIP]: joint(-0.1, 0, 0, confidence),
    [CanonicalJoint.RIGHT_HIP]: joint(0.1, 0, 0, confidence),
    [CanonicalJoint.LEFT_KNEE]: joint(-0.1, -0.4, 0, confidence),
    [CanonicalJoint.RIGHT_KNEE]: joint(0.1, -0.4, 0, confidence),
    [CanonicalJoint.LEFT_ANKLE]: joint(-0.1, -0.8, 0, confidence),
    [CanonicalJoint.RIGHT_ANKLE]: joint(0.1, -0.8, 0, confidence),
    [CanonicalJoint.LEFT_FOOT]: joint(-0.1, -0.8, 0.25, confidence),
    [CanonicalJoint.RIGHT_FOOT]: joint(0.1, -0.8, 0.25, confidence),
  };

  const joints2D = {} as Record<CanonicalJoint, Joint2D>;
  for (const canonicalJoint of Object.values(CanonicalJoint)) {
    const source = joints[canonicalJoint];
    joints2D[canonicalJoint] = joint2D(source.x, source.y, source.confidence);
  }

  return {
    joints,
    joints2D,
    profile: null,
    source: 'mediapipe',
    sourceQuality: 'image_only',
    timestamp: 1000,
    viewHint: 'unknown',
    globalConfidence: confidence,
  };
}

describe('ProfileBuilder', () => {
  it('seals a profile from stable frames using known segment lengths', () => {
    const builder = new ProfileBuilder();
    let profile = null;

    for (let i = 0; i < 30; i++) {
      profile = builder.addStableFrame(makeFrame());
    }

    expect(profile).not.toBeNull();
    expect(profile!.confidence).toBe(1);
    expect(profile!.segments.torso).toBeCloseTo(0.5, 6);
    expect(profile!.segments.spineToNeck).toBeCloseTo(0.1, 6);
    expect(profile!.segments.upperArm).toBeCloseTo(0.3, 6);
    expect(profile!.segments.forearm).toBeCloseTo(0.2, 6);
    expect(profile!.segments.femur).toBeCloseTo(0.4, 6);
    expect(profile!.segments.tibia).toBeCloseTo(0.4, 6);
    expect(profile!.segments.foot).toBeCloseTo(0.25, 6);
    expect(profile!.segments.shoulderWidth).toBeCloseTo(0.4, 6);
    expect(profile!.segments.hipWidth).toBeCloseTo(0.2, 6);
    expect(profile!.derived.legLength).toBeCloseTo(1.05, 6);
    expect(profile!.derived.standingHeight).toBeCloseTo(1.85, 6);
    expect(profile!.derived.femurToTibia).toBeCloseTo(1, 6);
  });

  it('excludes low-confidence segment samples and still seals', () => {
    const builder = new ProfileBuilder();
    let profile = null;

    for (let i = 0; i < 30; i++) {
      profile = builder.addStableFrame(makeFrame(i % 5 === 0 ? 0.1 : 0.99));
    }

    expect(profile).not.toBeNull();
    expect(profile!.confidence).toBe(1);
    expect(profile!.segments.femur).toBeCloseTo(0.4, 6);
    expect(profile!.segments.tibia).toBeCloseTo(0.4, 6);
  });

  it('allows an early seal with reduced confidence and a warning', () => {
    const warn = jest.fn();
    const builder = new ProfileBuilder({ warn });

    for (let i = 0; i < 10; i++) {
      builder.addStableFrame(makeFrame());
    }
    const profile = builder.seal(2000);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(profile.sampleFrameCount).toBe(10);
    expect(profile.confidence).toBeLessThan(1);
    expect(profile.confidence).toBeCloseTo(0.5, 6);
  });

  it('keeps frame.profile null before warmup and frozen after sealing', () => {
    const session = new ProfileSession();
    let profile = null;

    for (let i = 0; i < 19; i++) {
      const frame = makeFrame();
      profile = session.update(frame, true);
      expect(profile).toBeNull();
      expect(frame.profile).toBeNull();
    }

    const sealedFrame = makeFrame();
    profile = session.update(sealedFrame, true);

    expect(profile).not.toBeNull();
    expect(sealedFrame.profile).toBe(profile);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile!.segments)).toBe(true);
    expect(Object.isFrozen(profile!.derived)).toBe(true);

    const nextFrame = makeFrame();
    session.update(nextFrame, true);
    expect(nextFrame.profile).toBe(profile);
  });
});
