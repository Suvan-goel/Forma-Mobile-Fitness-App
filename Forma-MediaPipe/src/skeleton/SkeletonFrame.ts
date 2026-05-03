import { CanonicalJoint } from './CanonicalJoint';
import type { AnthropometricProfile } from './AnthropometricProfile';

export type SkeletonSource = 'mediapipe' | 'vision3d';
export type SkeletonSourceQuality = 'lidar' | 'estimated_height' | 'image_only';
export type SkeletonViewHint = 'front' | 'side' | 'unknown';

export interface Joint3D {
  x: number;
  y: number;
  z: number;
  confidence: number;
  isSynthetic: boolean;
}

export interface Joint2D {
  x: number;
  y: number;
  confidence: number;
}

export interface SkeletonFrame {
  joints: Record<CanonicalJoint, Joint3D>;
  joints2D: Record<CanonicalJoint, Joint2D>;
  profile: AnthropometricProfile | null;
  source: SkeletonSource;
  sourceQuality: SkeletonSourceQuality;
  timestamp: number;
  viewHint: SkeletonViewHint;
  globalConfidence: number;
}

export function isSkeletonFrame(input: unknown): input is SkeletonFrame {
  return Boolean(
    input &&
      typeof input === 'object' &&
      'joints' in input &&
      'joints2D' in input &&
      'source' in input
  );
}
