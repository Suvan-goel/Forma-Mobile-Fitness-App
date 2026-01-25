import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

export type PoseKeypoint = { name: string; x: number; y: number; score: number };

export interface PoseOverlayProps {
  keypoints: PoseKeypoint[] | null;
  width: number;
  height: number;
  mirror?: boolean;
  minScore?: number;
}

// MediaPipe Pose Full - 33 landmark indices
// Updated from MoveNet's 17 keypoints
const KEYPOINT_INDEX: Record<string, number> = {
  // Face landmarks
  nose: 0,
  left_eye_inner: 1,
  left_eye: 2,
  left_eye_outer: 3,
  right_eye_inner: 4,
  right_eye: 5,
  right_eye_outer: 6,
  left_ear: 7,
  right_ear: 8,
  mouth_left: 9,
  mouth_right: 10,
  // Upper body
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  // Hands
  left_pinky: 17,
  right_pinky: 18,
  left_index: 19,
  right_index: 20,
  left_thumb: 21,
  right_thumb: 22,
  // Lower body
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  // Feet
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
};

// MediaPipe skeleton connections for full body visualization
// Includes additional connections for hands and feet
const SKELETON_CONNECTIONS: Array<[string, string]> = [
  // Torso
  ['left_shoulder', 'right_shoulder'],
  ['left_hip', 'right_hip'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  // Left arm
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  // Right arm
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  // Left hand (simplified)
  ['left_wrist', 'left_pinky'],
  ['left_wrist', 'left_index'],
  ['left_wrist', 'left_thumb'],
  // Right hand (simplified)
  ['right_wrist', 'right_pinky'],
  ['right_wrist', 'right_index'],
  ['right_wrist', 'right_thumb'],
  // Left leg
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  // Right leg
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
  // Left foot
  ['left_ankle', 'left_heel'],
  ['left_ankle', 'left_foot_index'],
  ['left_heel', 'left_foot_index'],
  // Right foot
  ['right_ankle', 'right_heel'],
  ['right_ankle', 'right_foot_index'],
  ['right_heel', 'right_foot_index'],
];

export const PoseOverlay: React.FC<PoseOverlayProps> = ({
  keypoints,
  width,
  height,
  mirror = false,
  minScore = 0.8, // Balanced threshold for performance and quality
}) => {
  if (!keypoints || width <= 0 || height <= 0) return null;

  const mapX = (x: number) => (mirror ? width - x : x);

  // Optimized rendering - pre-filter visible keypoints
  const visibleKeypoints = keypoints.filter(kp => kp.score >= minScore);

  return (
    <Svg
      style={styles.overlay}
      pointerEvents="none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {SKELETON_CONNECTIONS.map(([from, to]) => {
        const startIdx = KEYPOINT_INDEX[from];
        const endIdx = KEYPOINT_INDEX[to];
        // Safety check for valid indices
        if (startIdx === undefined || endIdx === undefined) return null;
        if (startIdx >= keypoints.length || endIdx >= keypoints.length) return null;
        
        const start = keypoints[startIdx];
        const end = keypoints[endIdx];
        if (!start || !end || start.score < minScore || end.score < minScore) return null;
        
        return (
          <Line
            key={`${from}-${to}`}
            x1={mapX(start.x)}
            y1={start.y}
            x2={mapX(end.x)}
            y2={end.y}
            stroke="rgba(16, 185, 129, 0.8)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        );
      })}
      {visibleKeypoints.map(point => (
        <Circle
          key={point.name}
          cx={mapX(point.x)}
          cy={point.y}
          r={5}
          fill="rgba(16, 185, 129, 1)"
          stroke="rgba(255, 255, 255, 0.5)"
          strokeWidth={1}
        />
      ))}
    </Svg>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
});
