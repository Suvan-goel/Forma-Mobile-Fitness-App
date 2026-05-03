/**
 * WarmupGate — Visibility-based stability gate.
 *
 * Prevents FSM activation until the skeleton has been stable for N
 * consecutive frames. Extracted from barbellCurlHeuristics warmup logic.
 *
 * Usage:
 *   const gate = new WarmupGate({ requiredJoints: ['left_shoulder', ...] });
 *   if (!gate.update(keypoints)) return; // skip FSM
 */

import type { Keypoint } from '../../poseAnalysis';
import { getKeypoint } from '../../poseAnalysis';
import type { ProfileBuilder } from '../../../skeleton';
import type { SkeletonFrame } from '../../../skeleton';

export interface WarmupGateConfig {
  requiredFrames?: number;         // Default: 12 (~0.6s at 20fps)
  visibilityThreshold?: number;    // Default: 0.3
  requiredJoints: string[];        // Landmark names to check visibility
  decayRate?: number;              // Default: 2 (unstable frames decay 2x faster)
  profileBuilder?: ProfileBuilder;
}

export class WarmupGate {
  private stableFrames: number;
  private readonly requiredFrames: number;
  private readonly visibilityThreshold: number;
  private readonly requiredJoints: string[];
  private readonly decayRate: number;
  private readonly profileBuilder: ProfileBuilder | null;

  constructor(config: WarmupGateConfig) {
    this.requiredFrames = config.requiredFrames ?? 12;
    this.visibilityThreshold = config.visibilityThreshold ?? 0.3;
    this.requiredJoints = config.requiredJoints;
    this.decayRate = config.decayRate ?? 2;
    this.profileBuilder = config.profileBuilder ?? null;
    this.stableFrames = 0;
  }

  /**
   * Process one frame's keypoints.
   * Returns true if the warmup threshold has been reached (FSM may activate).
   */
  update(keypoints: Keypoint[], frame?: SkeletonFrame): boolean {
    const stable = this.isFrameStable(keypoints);

    if (stable) {
      this.stableFrames = Math.min(this.stableFrames + 1, this.requiredFrames + 1);
      if (frame && this.profileBuilder) {
        this.profileBuilder.addStableFrame(frame);
      }
    } else {
      this.stableFrames = Math.max(0, this.stableFrames - this.decayRate);
      if (this.stableFrames === 0) {
        this.profileBuilder?.reset();
      }
    }

    if (frame && this.profileBuilder?.sealedProfile) {
      this.profileBuilder.attachProfile(frame);
    }

    return this.stableFrames >= this.requiredFrames;
  }

  /** Current stable frame count (for debug display) */
  get frameCount(): number {
    return this.stableFrames;
  }

  /** Reset to cold state */
  reset(): void {
    this.stableFrames = 0;
    this.profileBuilder?.reset();
  }

  /** Check if the current frame has sufficient average visibility across key joints. */
  private isFrameStable(keypoints: Keypoint[]): boolean {
    let totalVis = 0;
    for (const name of this.requiredJoints) {
      const kp = getKeypoint(keypoints, name);
      totalVis += kp?.score ?? 0;
    }
    return (totalVis / this.requiredJoints.length) >= this.visibilityThreshold;
  }
}
