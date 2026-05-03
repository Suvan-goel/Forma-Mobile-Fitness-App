import type { AnthropometricProfile } from '../AnthropometricProfile';
import {
  asymmetryBaseline,
  femurDominance,
  getMorphologyAdjustedPushupHipDevDeadzone,
  getMorphologyAdjustedSquatTorsoDeadzone,
  getSquatHipTravelLimit,
  ratioToFemur,
  ratioToTibia,
  ratioToTorso,
  ratioToUpperArm,
  setCoupledMorphologyEnabled,
} from '../morphology';

function makeProfile(overrides: Partial<AnthropometricProfile> = {}): AnthropometricProfile {
  return {
    computedAt: 1000,
    sampleFrameCount: 30,
    confidence: 1,
    segments: {
      torso: 0.5,
      spineToNeck: 0.12,
      upperArm: 0.28,
      forearm: 0.25,
      femur: 0.46,
      tibia: 0.4,
      foot: 0.2,
      shoulderWidth: 0.42,
      hipWidth: 0.3,
    },
    derived: {
      standingHeight: 1.73,
      armSpan: 1.67,
      legLength: 1.06,
      torsoToLeg: 0.47,
      femurToTibia: 1.15,
    },
    baselines: {
      reachRatioAsymmetry: 0.06,
    },
    referenceUnit: 1.73,
    ...overrides,
  };
}

describe('morphology helpers', () => {
  afterEach(() => {
    setCoupledMorphologyEnabled(true);
  });

  it('collapses to legacy values with a null profile', () => {
    expect(ratioToFemur(0.2, null)).toBe(0.2);
    expect(ratioToTibia(0.2, null)).toBe(0.2);
    expect(ratioToUpperArm(0.2, null)).toBe(0.2);
    expect(ratioToTorso(0.2, null)).toBe(0.2);
    expect(femurDominance(null)).toBe(1);
    expect(asymmetryBaseline(null)).toBe(0);
    expect(getMorphologyAdjustedSquatTorsoDeadzone(30, null)).toBe(30);
    expect(getMorphologyAdjustedPushupHipDevDeadzone(0.04, null)).toBe(0.04);
    expect(getSquatHipTravelLimit(null)).toBe(Infinity);
  });

  it('exposes profile-relative ratios and asymmetry baselines', () => {
    const profile = makeProfile();

    expect(ratioToFemur(0.23, profile)).toBeCloseTo(0.5, 6);
    expect(ratioToTibia(0.2, profile)).toBeCloseTo(0.5, 6);
    expect(ratioToUpperArm(0.14, profile)).toBeCloseTo(0.5, 6);
    expect(ratioToTorso(0.25, profile)).toBeCloseTo(0.5, 6);
    expect(femurDominance(profile)).toBeCloseTo(1.15, 6);
    expect(asymmetryBaseline(profile, 'both')).toBeCloseTo(0.06, 6);
    expect(getSquatHipTravelLimit(profile)).toBeCloseTo(0.24, 6);
  });

  it('widens squat torso deadzone only for long-femur profiles', () => {
    expect(getMorphologyAdjustedSquatTorsoDeadzone(30, makeProfile())).toBeCloseTo(34.5, 6);
    expect(getMorphologyAdjustedSquatTorsoDeadzone(30, makeProfile({
      derived: { ...makeProfile().derived, femurToTibia: 1.05 },
    }))).toBe(30);
  });

  it('widens pushup sag deadzone for high torso-to-leg profiles', () => {
    const profile = makeProfile({
      derived: { ...makeProfile().derived, torsoToLeg: 0.6 },
    });

    expect(getMorphologyAdjustedPushupHipDevDeadzone(0.04, profile)).toBeCloseTo(0.044, 6);
  });

  it('keeps all coupled modulation bounded across plausible profiles', () => {
    for (const femurToTibia of [0.9, 1, 1.1, 1.15, 1.25]) {
      const adjusted = getMorphologyAdjustedSquatTorsoDeadzone(30, makeProfile({
        derived: { ...makeProfile().derived, femurToTibia },
      }));
      expect(adjusted).toBeGreaterThanOrEqual(21);
      expect(adjusted).toBeLessThanOrEqual(42);
    }

    for (const torsoToLeg of [0.4, 0.5, 0.55, 0.6, 0.65]) {
      const adjusted = getMorphologyAdjustedPushupHipDevDeadzone(0.04, makeProfile({
        derived: { ...makeProfile().derived, torsoToLeg },
      }));
      expect(adjusted).toBeGreaterThanOrEqual(0.028);
      expect(adjusted).toBeLessThanOrEqual(0.056);
    }
  });

  it('feature-flag off collapses coupled helpers to old behavior', () => {
    const profile = makeProfile();

    setCoupledMorphologyEnabled(false);

    expect(getMorphologyAdjustedSquatTorsoDeadzone(30, profile)).toBe(30);
    expect(getMorphologyAdjustedPushupHipDevDeadzone(0.04, profile)).toBe(0.04);
    expect(getSquatHipTravelLimit(profile)).toBe(Infinity);
  });
});
