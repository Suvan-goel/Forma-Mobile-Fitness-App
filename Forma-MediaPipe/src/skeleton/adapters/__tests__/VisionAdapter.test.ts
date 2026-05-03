import { CANONICAL_JOINTS, CanonicalJoint } from '../../CanonicalJoint';
import { createVisionAdapter, type VisionBridgePayload } from '../VisionAdapter';

function makePayload(): VisionBridgePayload {
  const joints = {} as VisionBridgePayload['joints'];
  const joints2D = {} as VisionBridgePayload['joints2D'];

  CANONICAL_JOINTS.forEach((joint, index) => {
    joints[joint] = {
      x: index * 0.1,
      y: index * 0.2,
      z: index * 0.3,
      confidence: 1,
      isSynthetic: joint === CanonicalJoint.PELVIS_CENTER,
    };
    joints2D[joint] = {
      x: index * 0.01,
      y: index * 0.02,
      confidence: 1,
    };
  });

  return {
    joints,
    joints2D,
    source: 'vision3d',
    sourceQuality: 'lidar',
    timestamp: 1234,
    viewHint: 'front',
    globalConfidence: 0.98,
  };
}

describe('VisionAdapter', () => {
  it('deserializes bridge payloads into pooled SkeletonFrame objects', () => {
    const adapter = createVisionAdapter();
    const frame = adapter.update(makePayload());
    const second = adapter.update(makePayload());

    expect(second).toBe(frame);
    expect(frame.source).toBe('vision3d');
    expect(frame.sourceQuality).toBe('lidar');
    expect(frame.timestamp).toBe(1234);
    expect(frame.globalConfidence).toBe(0.98);

    for (const joint of CANONICAL_JOINTS) {
      expect(frame.joints[joint]).toBeDefined();
      expect(frame.joints2D[joint]).toBeDefined();
    }
  });
});
