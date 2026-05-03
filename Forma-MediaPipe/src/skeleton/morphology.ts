import type { AnthropometricProfile } from './AnthropometricProfile';

let coupledMorphologyEnabled = true;

export function setCoupledMorphologyEnabled(enabled: boolean): void {
  coupledMorphologyEnabled = enabled;
}

export function isCoupledMorphologyEnabled(): boolean {
  return coupledMorphologyEnabled;
}

export function ratioToFemur(value: number, profile: AnthropometricProfile | null): number {
  return profile?.segments.femur ? value / profile.segments.femur : value;
}

export function ratioToTibia(value: number, profile: AnthropometricProfile | null): number {
  return profile?.segments.tibia ? value / profile.segments.tibia : value;
}

export function ratioToUpperArm(value: number, profile: AnthropometricProfile | null): number {
  return profile?.segments.upperArm ? value / profile.segments.upperArm : value;
}

export function ratioToTorso(value: number, profile: AnthropometricProfile | null): number {
  return profile?.segments.torso ? value / profile.segments.torso : value;
}

export function femurDominance(profile: AnthropometricProfile | null): number {
  return profile?.derived.femurToTibia ?? 1;
}

export function asymmetryBaseline(
  profile: AnthropometricProfile | null,
  _side: 'left' | 'right' | 'both' = 'both'
): number {
  return profile?.baselines?.reachRatioAsymmetry ?? 0;
}

export function getMorphologyAdjustedSquatTorsoDeadzone(
  baseDeadzone: number,
  profile: AnthropometricProfile | null
): number {
  if (!coupledMorphologyEnabled || !profile) return baseDeadzone;
  const dominance = femurDominance(profile);
  const factor = dominance > 1.10 ? dominance : 1;
  return boundedThreshold(baseDeadzone, factor);
}

export function getMorphologyAdjustedPushupHipDevDeadzone(
  baseDeadzone: number,
  profile: AnthropometricProfile | null
): number {
  if (!coupledMorphologyEnabled || !profile) return baseDeadzone;
  const torsoToLeg = profile.derived.torsoToLeg;
  const factor = torsoToLeg > 0.55 ? 1 + Math.min(0.25, (torsoToLeg - 0.55) * 2) : 1;
  return boundedThreshold(baseDeadzone, factor);
}

export function getSquatHipTravelLimit(profile: AnthropometricProfile | null): number {
  if (!coupledMorphologyEnabled || !profile) return Infinity;
  return 0.6 * profile.segments.tibia;
}

function boundedThreshold(base: number, factor: number): number {
  const lower = 0.7 * base;
  const upper = 1.4 * base;
  return Math.max(lower, Math.min(upper, base * factor));
}
