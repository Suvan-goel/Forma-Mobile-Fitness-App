import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Circle, Line, vec } from '@shopify/react-native-skia';

export type PoseKeypoint = { name: string; x: number; y: number; score: number };

export interface PoseOverlayProps {
  // LATENCY OPTIMIZATION: Direct keypoints prop (no interpolation)
  // Renders latest pose immediately without animation delays
  keypoints: PoseKeypoint[] | null;
  width: number;
  height: number;
  mirror?: boolean;
  minScore?: number;
}

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

// LATENCY OPTIMIZATION: Zero-interpolation overlay for instant pose display
// Removes all animation delays - overlay reacts immediately to model output
export const PoseOverlay: React.FC<PoseOverlayProps> = React.memo(({
  keypoints,
  width,
  height,
  mirror = false,
  minScore = 0.2,
}) => {
  // Transform keypoints (mirroring for front camera)
  const mappedKeypoints = useMemo(() => {
    if (!keypoints) return null;
    
    return keypoints.map((kp: PoseKeypoint) => ({
      x: mirror ? width - kp.x : kp.x,
      y: kp.y,
      score: kp.score,
    }));
  }, [keypoints, width, mirror]);

  // Pre-filter visible elements for performance
  const visibleLines = useMemo(() => {
    if (!mappedKeypoints) return [];
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
    if (!mappedKeypoints) return [];
    return mappedKeypoints.filter((kp) => kp.score >= minScore);
  }, [mappedKeypoints, minScore]);

  if (width <= 0 || height <= 0) return null;
  if (!mappedKeypoints) return null;

  return (
    <Canvas style={[styles.overlay, { width, height }]}>
      {/* Render skeleton lines */}
      {visibleLines.map((line, i) => (
        <Line
          key={`line-${i}`}
          p1={vec(line.p1.x, line.p1.y)}
          p2={vec(line.p2.x, line.p2.y)}
          color="rgba(0, 255, 0, 0.7)"
          strokeWidth={2}
        />
      ))}
      
      {/* Render keypoints */}
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
  // LATENCY: Minimal re-render checks - only re-render when truly needed
  if (prevProps.width !== nextProps.width || prevProps.height !== nextProps.height) return false;
  if (prevProps.mirror !== nextProps.mirror || prevProps.minScore !== nextProps.minScore) return false;
  
  // Always re-render when keypoints change (they're new objects each time)
  if (prevProps.keypoints !== nextProps.keypoints) return false;
  
  return true;
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
