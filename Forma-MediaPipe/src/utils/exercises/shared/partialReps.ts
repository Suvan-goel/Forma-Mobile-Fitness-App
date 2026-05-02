export const LOW_ROM_FEEDBACK = 'Use more range for this rep to count.';

export interface MeaningfulPartialRepInput {
  actualRom: number;
  minRom: number;
  duration?: number;
  minDuration?: number;
  frameCount?: number;
  minFrames?: number;
}

export function isMeaningfulPartialRep({
  actualRom,
  minRom,
  duration,
  minDuration,
  frameCount,
  minFrames,
}: MeaningfulPartialRepInput): boolean {
  if (!Number.isFinite(actualRom) || actualRom < minRom) return false;
  if (
    minDuration !== undefined &&
    (!Number.isFinite(duration ?? NaN) || (duration ?? 0) < minDuration)
  ) {
    return false;
  }
  if (
    minFrames !== undefined &&
    (!Number.isFinite(frameCount ?? NaN) || (frameCount ?? 0) < minFrames)
  ) {
    return false;
  }
  return true;
}
