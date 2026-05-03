import type { ViewStyle, StyleProp } from 'react-native';

export type PoseModelName = 'pose_landmarker_full' | 'pose_landmarker_heavy';
export type PoseBackendName = 'mediapipe' | 'vision3d';

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence: number;
}

export interface LandmarkData {
  landmarks: Landmark[];
  worldLandmarks: Landmark[];
  additionalData: {
    height: number;
    width: number;
  };
}

export interface PoseDetectionViewProps {
  style?: StyleProp<ViewStyle>;
  frameLimit?: number;
  showSkeleton?: boolean;
  modelName?: PoseModelName;
  poseBackend?: PoseBackendName;
  visionHeightPrior?: number | null;
  onLandmark?: (data: any) => void;
  enableVisionDualEmit?: boolean;
  onVisionFrame?: (data: any) => void;
}
