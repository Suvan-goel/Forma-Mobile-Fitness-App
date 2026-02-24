import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CAMERA_SETTINGS_KEY = 'forma_camera_settings';

export type CameraSettings = {
  showFeedback: boolean;
  isTTSEnabled: boolean;
  showSkeletonOverlay: boolean;
  debugMode: boolean;
};

type CameraSettingsContextValue = CameraSettings & {
  setShowFeedback: (value: boolean) => void;
  setIsTTSEnabled: (value: boolean) => void;
  setShowSkeletonOverlay: (value: boolean) => void;
  setDebugMode: (value: boolean) => void;
};

const defaultSettings: CameraSettings = {
  showFeedback: true,
  isTTSEnabled: false,
  showSkeletonOverlay: false,
  debugMode: false,
};

const CameraSettingsContext = createContext<CameraSettingsContextValue | null>(null);

export const CameraSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showFeedback, setShowFeedbackRaw] = useState(defaultSettings.showFeedback);
  const [isTTSEnabled, setIsTTSEnabledRaw] = useState(defaultSettings.isTTSEnabled);
  const [showSkeletonOverlay, setShowSkeletonOverlayRaw] = useState(defaultSettings.showSkeletonOverlay);
  const [debugMode, setDebugMode] = useState(defaultSettings.debugMode);

  // Load persisted settings on mount
  useEffect(() => {
    AsyncStorage.getItem(CAMERA_SETTINGS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (typeof saved.showFeedback === 'boolean') setShowFeedbackRaw(saved.showFeedback);
        if (typeof saved.isTTSEnabled === 'boolean') setIsTTSEnabledRaw(saved.isTTSEnabled);
        if (typeof saved.showSkeletonOverlay === 'boolean') setShowSkeletonOverlayRaw(saved.showSkeletonOverlay);
      } catch { /* ignore corrupt data */ }
    });
  }, []);

  const persistSetting = useCallback((key: string, value: boolean) => {
    AsyncStorage.getItem(CAMERA_SETTINGS_KEY).then((raw) => {
      const current = raw ? JSON.parse(raw) : {};
      AsyncStorage.setItem(CAMERA_SETTINGS_KEY, JSON.stringify({ ...current, [key]: value }));
    }).catch(() => { /* ignore write errors */ });
  }, []);

  const setShowFeedback = useCallback((value: boolean) => {
    setShowFeedbackRaw(value);
    persistSetting('showFeedback', value);
  }, [persistSetting]);

  const setIsTTSEnabled = useCallback((value: boolean) => {
    setIsTTSEnabledRaw(value);
    persistSetting('isTTSEnabled', value);
  }, [persistSetting]);

  const setShowSkeletonOverlay = useCallback((value: boolean) => {
    setShowSkeletonOverlayRaw(value);
    persistSetting('showSkeletonOverlay', value);
  }, [persistSetting]);

  return (
    <CameraSettingsContext.Provider
      value={{
        showFeedback,
        isTTSEnabled,
        showSkeletonOverlay,
        debugMode,
        setShowFeedback,
        setIsTTSEnabled,
        setShowSkeletonOverlay,
        setDebugMode,
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
