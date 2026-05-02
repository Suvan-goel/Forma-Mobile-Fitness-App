import { requireNativeViewManager } from 'expo-modules-core';
import React, { useCallback } from 'react';
import type { PoseDetectionViewProps } from './ExpoPoseDetection.types';

const NativePoseDetectionView: React.ComponentType<any> =
  requireNativeViewManager('ExpoPoseDetection');

export function PoseDetectionView(props: PoseDetectionViewProps) {
  const {
    style,
    frameLimit = 20,
    showSkeleton = false,
    modelName = 'pose_landmarker_heavy',
    onLandmark,
    onVisionFrame,
    enableVisionDualEmit = false,
    ...rest
  } = props;

  const handleLandmark = useCallback(
    (event: any) => {
      if (onLandmark) {
        // Expo Module events arrive wrapped in { nativeEvent: ... }
        // Extract the data and pass in the format convertLandmarksToKeypoints expects
        // On iOS: nativeEvent is a dictionary object
        // On Android: nativeEvent is a dictionary object (via Expo EventDispatcher)
        // convertLandmarksToKeypoints already handles both string and object input
        const data = event?.nativeEvent ?? event;
        onLandmark(data);
      }
    },
    [onLandmark]
  );

  const handleVisionFrame = useCallback(
    (event: any) => {
      if (onVisionFrame) {
        const data = event?.nativeEvent ?? event;
        onVisionFrame(data);
      }
    },
    [onVisionFrame]
  );

  return (
    <NativePoseDetectionView
      style={style}
      frameLimit={frameLimit}
      showSkeleton={showSkeleton}
      modelName={modelName}
      onLandmark={handleLandmark}
      enableVisionDualEmit={enableVisionDualEmit}
      onVisionFrame={handleVisionFrame}
      {...rest}
    />
  );
}
