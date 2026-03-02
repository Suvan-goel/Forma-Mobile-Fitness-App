import type { ViewStyle, StyleProp } from 'react-native';

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
  onLandmark?: (data: any) => void;
}
