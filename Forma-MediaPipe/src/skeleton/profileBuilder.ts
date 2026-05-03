import {
  ANTHROPOMETRIC_PROFILE_MIN_FRAMES,
  computeAnthropometricProfile,
  type AnthropometricProfile,
} from './AnthropometricProfile';
import type { SkeletonFrame } from './SkeletonFrame';

export interface ProfileBuilderOptions {
  minStableFrames?: number;
  warn?: (message: string) => void;
}

export class ProfileBuilder {
  private readonly minStableFrames: number;
  private readonly warn: (message: string) => void;
  private samples: SkeletonFrame[] = [];
  private profile: AnthropometricProfile | null = null;

  constructor(options: ProfileBuilderOptions = {}) {
    this.minStableFrames = options.minStableFrames ?? ANTHROPOMETRIC_PROFILE_MIN_FRAMES;
    this.warn = options.warn ?? (() => {});
  }

  addStableFrame(frame: SkeletonFrame): AnthropometricProfile | null {
    if (this.profile) {
      frame.profile = this.profile;
      return this.profile;
    }

    frame.profile = null;
    this.samples.push(cloneFrameForProfile(frame));

    if (this.samples.length < this.minStableFrames) {
      return null;
    }

    const profile = this.seal(frame.timestamp);
    frame.profile = profile;
    return profile;
  }

  seal(computedAt: number = Date.now()): AnthropometricProfile {
    if (this.profile) return this.profile;
    if (this.samples.length < this.minStableFrames) {
      this.warn(
        `[ProfileBuilder] Sealing anthropometric profile with ${this.samples.length}/${this.minStableFrames} frames`
      );
    }
    this.profile = computeAnthropometricProfile(this.samples, computedAt);
    return this.profile;
  }

  attachProfile(frame: SkeletonFrame): SkeletonFrame {
    frame.profile = this.profile;
    return frame;
  }

  reset(): void {
    this.samples = [];
    this.profile = null;
  }

  get sealedProfile(): AnthropometricProfile | null {
    return this.profile;
  }

  get sampleFrameCount(): number {
    return this.samples.length;
  }
}

export class ProfileSession {
  private readonly builder: ProfileBuilder;
  private loggedProfile: AnthropometricProfile | null = null;

  constructor(options: ProfileBuilderOptions = {}) {
    this.builder = new ProfileBuilder(options);
  }

  update(frame: SkeletonFrame, stable: boolean): AnthropometricProfile | null {
    const existing = this.builder.sealedProfile;
    if (existing) {
      frame.profile = existing;
      return existing;
    }

    frame.profile = null;
    if (!stable) {
      this.builder.reset();
      return null;
    }

    const profile = this.builder.addStableFrame(frame);
    if (profile) frame.profile = profile;
    return profile;
  }

  reset(): void {
    this.builder.reset();
    this.loggedProfile = null;
  }

  markLogged(profile: AnthropometricProfile): void {
    this.loggedProfile = profile;
  }

  get hasLoggedProfile(): boolean {
    return this.loggedProfile !== null;
  }

  get sealedProfile(): AnthropometricProfile | null {
    return this.builder.sealedProfile;
  }
}

function cloneFrameForProfile(frame: SkeletonFrame): SkeletonFrame {
  const joints = {} as SkeletonFrame['joints'];
  const joints2D = {} as SkeletonFrame['joints2D'];

  for (const jointName of Object.keys(frame.joints) as Array<keyof SkeletonFrame['joints']>) {
    joints[jointName] = { ...frame.joints[jointName] };
    joints2D[jointName] = { ...frame.joints2D[jointName] };
  }

  return {
    ...frame,
    joints,
    joints2D,
    profile: null,
  };
}
