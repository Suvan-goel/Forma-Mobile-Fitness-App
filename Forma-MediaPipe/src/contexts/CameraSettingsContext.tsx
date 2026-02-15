import React, { createContext, useContext, useState, useCallback } from 'react';

export type CameraSettings = {
  showFeedback: boolean;
  isTTSEnabled: boolean;
  showSkeletonOverlay: boolean;
};

type CameraSettingsContextValue = CameraSettings & {
  setShowFeedback: (value: boolean) => void;
  setIsTTSEnabled: (value: boolean) => void;
  setShowSkeletonOverlay: (value: boolean) => void;
};

const defaultSettings: CameraSettings = {
  showFeedback: true,
  isTTSEnabled: false,
  showSkeletonOverlay: true,
};

const CameraSettingsContext = createContext<CameraSettingsContextValue | null>(null);

export const CameraSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showFeedback, setShowFeedback] = useState(defaultSettings.showFeedback);
  const [isTTSEnabled, setIsTTSEnabled] = useState(defaultSettings.isTTSEnabled);
  const [showSkeletonOverlay, setShowSkeletonOverlay] = useState(defaultSettings.showSkeletonOverlay);

  return (
    <CameraSettingsContext.Provider
      value={{
        showFeedback,
        isTTSEnabled,
        showSkeletonOverlay,
        setShowFeedback,
        setIsTTSEnabled,
        setShowSkeletonOverlay,
      }}
    >
      {children}
    </CameraSettingsContext.Provider>
  );
};

export function useCameraSettings(): CameraSettingsContextValue {
  const ctx = useContext(CameraSettingsContext);
  if (!ctx) {
    throw new Error('useCameraSettings must be used within CameraSettingsProvider');
  }
  return ctx;
}
