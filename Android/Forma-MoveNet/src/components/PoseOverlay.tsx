import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Circle, Line, vec } from '@shopify/react-native-skia';

export type PoseKeypoint = { name: string; x: number; y: number; score: number };

export interface PoseOverlayProps {
  keypoints: PoseKeypoint[] | null;
  width: number;
  height: number;
  mirror?: boolean;
  minScore?: number;
}

const KEYPOINT_INDEX: Record<string, number> = {
  nose: 0,
  left_eye: 1,
  right_eye: 2,
  left_ear: 3,
  right_ear: 4,
  left_shoulder: 5,
  right_shoulder: 6,
  left_elbow: 7,
  right_elbow: 8,
  left_wrist: 9,
  right_wrist: 10,
  left_hip: 11,
  right_hip: 12,
  left_knee: 13,
  right_knee: 14,
  left_ankle: 15,
  right_ankle: 16,
};

// Pre-defined skeleton connections (indices for faster lookup)
const SKELETON_CONNECTIONS: Array<[number, number]> = [
  [5, 6],   // left_shoulder - right_shoulder
  [11, 12], // left_hip - right_hip
  [5, 7],   // left_shoulder - left_elbow
  [7, 9],   // left_elbow - left_wrist
  [6, 8],   // right_shoulder - right_elbow
  [8, 10],  // right_elbow - right_wrist
  [11, 13], // left_hip - left_knee
  [13, 15], // left_knee - left_ankle
  [12, 14], // right_hip - right_knee
  [14, 16], // right_knee - right_ankle
  [5, 11],  // left_shoulder - left_hip
  [6, 12],  // right_shoulder - right_hip
];

// Memoized component to prevent unnecessary re-renders
export const PoseOverlay: React.FC<PoseOverlayProps> = React.memo(({
  keypoints,
  width,
  height,
  mirror = false,
  minScore = 0.2,
}) => {
  // Early return for invalid state
  if (!keypoints || width <= 0 || height <= 0) return null;

  // Pre-compute mapped coordinates once
  const mappedKeypoints = useMemo(() => {
    if (!keypoints) return null;
    return keypoints.map(kp => ({
      x: mirror ? width - kp.x : kp.x,
      y: kp.y,
      score: kp.score,
    }));
  }, [keypoints, width, mirror]);

  if (!mappedKeypoints) return null;

  // Pre-filter visible lines and points
  const visibleLines = useMemo(() => {
    const lines: Array<{ p1: { x: number; y: number }; p2: { x: number; y: number } }> = [];
    for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
      const [startIdx, endIdx] = SKELETON_CONNECTIONS[i];
      const start = mappedKeypoints[startIdx];
      const end = mappedKeypoints[endIdx];
      if (start.score >= minScore && end.score >= minScore) {
        lines.push({ p1: start, p2: end });
      }
    }
    return lines;
  }, [mappedKeypoints, minScore]);

  const visiblePoints = useMemo(() => {
    return mappedKeypoints.filter(kp => kp.score >= minScore);
  }, [mappedKeypoints, minScore]);

  return (
    <Canvas style={[styles.overlay, { width, height }]}>
      {/* Draw skeleton lines */}
      {visibleLines.map((line, i) => (
        <Line
          key={`line-${i}`}
          p1={vec(line.p1.x, line.p1.y)}
          p2={vec(line.p2.x, line.p2.y)}
          color="rgba(0, 255, 0, 0.7)"
          strokeWidth={3}
        />
      ))}
      {/* Draw keypoints */}
      {visiblePoints.map((point, i) => (
        <Circle
          key={`point-${i}`}
          cx={point.x}
          cy={point.y}
          r={5}
          color="rgba(0, 255, 0, 0.9)"
        />
      ))}
    </Canvas>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if keypoints actually changed
  if (prevProps.width !== nextProps.width || prevProps.height !== nextProps.height) {
    return false;
  }
  if (prevProps.mirror !== nextProps.mirror || prevProps.minScore !== nextProps.minScore) {
    return false;
  }
  if (prevProps.keypoints === nextProps.keypoints) {
    return true;
  }
  if (!prevProps.keypoints || !nextProps.keypoints) {
    return false;
  }
  // Quick length check
  if (prevProps.keypoints.length !== nextProps.keypoints.length) {
    return false;
  }
  // Always re-render when keypoints change (they should be new objects)
  return false;
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
