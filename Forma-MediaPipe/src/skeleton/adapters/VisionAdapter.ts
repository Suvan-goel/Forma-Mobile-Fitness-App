import { CANONICAL_JOINTS, CanonicalJoint } from '../CanonicalJoint';
import type { Joint2D, Joint3D, SkeletonFrame, SkeletonSourceQuality, SkeletonViewHint } from '../SkeletonFrame';

export type VisionBridgeJoint3D = {
  x: number;
  y: number;
  z: number;
  confidence?: number;
  isSynthetic?: boolean;
};

export type VisionBridgeJoint2D = {
  x: number;
  y: number;
  confidence?: number;
};

export type VisionBridgePayload = {
  joints: Partial<Record<CanonicalJoint, VisionBridgeJoint3D>>;
  joints2D: Partial<Record<CanonicalJoint, VisionBridgeJoint2D>>;
  source?: 'vision3d';
  sourceQuality?: SkeletonSourceQuality;
  timestamp?: number;
  viewHint?: SkeletonViewHint;
  globalConfidence?: number;
};

export interface VisionAdapter {
  update(payload: VisionBridgePayload): SkeletonFrame;
}

function createJoint3D(): Joint3D {
  return { x: 0, y: 0, z: 0, confidence: 0, isSynthetic: false };
}

function createJoint2D(): Joint2D {
  return { x: 0, y: 0, confidence: 0 };
}

function createEmptyFrame(): SkeletonFrame {
  const joints = {} as Record<CanonicalJoint, Joint3D>;
  const joints2D = {} as Record<CanonicalJoint, Joint2D>;

  for (const joint of CANONICAL_JOINTS) {
    joints[joint] = createJoint3D();
    joints2D[joint] = createJoint2D();
  }

  return {
    joints,
    joints2D,
    profile: null,
    source: 'vision3d',
    sourceQuality: 'estimated_height',
    timestamp: 0,
    viewHint: 'unknown',
    globalConfidence: 0,
  };
}

export function createVisionAdapter(): VisionAdapter {
  const frame = createEmptyFrame();

  return {
    update(payload: VisionBridgePayload): SkeletonFrame {
      let confidenceSum = 0;

      for (const joint of CANONICAL_JOINTS) {
        const source3D = payload.joints[joint];
        const target3D = frame.joints[joint];
        if (source3D) {
          target3D.x = source3D.x;
          target3D.y = source3D.y;
          target3D.z = source3D.z;
          target3D.confidence = source3D.confidence ?? 1;
          target3D.isSynthetic = source3D.isSynthetic ?? false;
        } else {
          target3D.x = 0;
          target3D.y = 0;
          target3D.z = 0;
          target3D.confidence = 0;
          target3D.isSynthetic = false;
        }

        const source2D = payload.joints2D[joint];
        const target2D = frame.joints2D[joint];
        if (source2D) {
          target2D.x = source2D.x;
          target2D.y = source2D.y;
          target2D.confidence = source2D.confidence ?? target3D.confidence;
        } else {
          target2D.x = 0;
          target2D.y = 0;
          target2D.confidence = 0;
        }

        confidenceSum += target3D.confidence;
      }

      frame.source = 'vision3d';
      frame.sourceQuality = payload.sourceQuality ?? 'estimated_height';
      frame.timestamp = payload.timestamp ?? Date.now();
      frame.viewHint = payload.viewHint ?? 'unknown';
      frame.globalConfidence = payload.globalConfidence ?? confidenceSum / CANONICAL_JOINTS.length;
      frame.profile = null;

      return frame;
    },
  };
}
