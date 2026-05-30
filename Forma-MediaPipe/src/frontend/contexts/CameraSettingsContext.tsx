import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CAMERA_SETTINGS_KEY } from '../../utils/storageKeys';
import type { PoseModelName } from 'expo-pose-detection';
import { DEV_FEATURES_ENABLED } from '../../config/devFeatures';

export type CameraSettings = {
  showFeedback: boolean;
  isTTSEnabled: boolean;
  showSkeletonOverlay: boolean;
  debugMode: boolean;
  restTimerEnabled: boolean;
  restTimerDurationSeconds: number;
  selectedTrainerId: string;
  autoScreenRecording: boolean;
  poseModel: PoseModelName;
};

type CameraSettingsContextValue = CameraSettings & {
  setShowFeedback: (value: boolean) => void;
  setIsTTSEnabled: (value: boolean) => void;
  setShowSkeletonOverlay: (value: boolean) => void;
  setDebugMode: (value: boolean) => void;
  setRestTimerEnabled: (value: boolean) => void;
  setRestTimerDurationSeconds: (value: number) => void;
  setSelectedTrainerId: (id: string) => void;
  setAutoScreenRecording: (value: boolean) => void;
  setPoseModel: (model: PoseModelName) => void;
};

const defaultSettings: CameraSettings = {
  showFeedback: true,
  isTTSEnabled: true,
  showSkeletonOverlay: false,
  debugMode: false,
  restTimerEnabled: false,
  restTimerDurationSeconds: 90,
  selectedTrainerId: 'marcus',
  autoScreenRecording: false,
  poseModel: 'pose_landmarker_heavy',
};

const CameraSettingsContext = createContext<CameraSettingsContextValue | null>(null);

export const CameraSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showFeedback, setShowFeedbackRaw] = useState(defaultSettings.showFeedback);
  const [isTTSEnabled, setIsTTSEnabledRaw] = useState(defaultSettings.isTTSEnabled);
  const [showSkeletonOverlay, setShowSkeletonOverlayRaw] = useState(defaultSettings.showSkeletonOverlay);
  const [debugMode, setDebugMode] = useState(defaultSettings.debugMode);
  const [restTimerEnabled, setRestTimerEnabledRaw] = useState(defaultSettings.restTimerEnabled);
  const [restTimerDurationSeconds, setRestTimerDurationSecondsRaw] = useState(defaultSettings.restTimerDurationSeconds);
  const [selectedTrainerId, setSelectedTrainerIdRaw] = useState(defaultSettings.selectedTrainerId);
  const [autoScreenRecording, setAutoScreenRecordingRaw] = useState(defaultSettings.autoScreenRecording);
  const [poseModel, setPoseModelRaw] = useState<PoseModelName>(defaultSettings.poseModel);

  // Load persisted settings on mount
  useEffect(() => {
    AsyncStorage.getItem(CAMERA_SETTINGS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (typeof saved.showFeedback === 'boolean') setShowFeedbackRaw(saved.showFeedback);
        if (typeof saved.isTTSEnabled === 'boolean') setIsTTSEnabledRaw(saved.isTTSEnabled);
        if (typeof saved.showSkeletonOverlay === 'boolean') setShowSkeletonOverlayRaw(saved.showSkeletonOverlay);
        if (typeof saved.restTimerEnabled === 'boolean') setRestTimerEnabledRaw(saved.restTimerEnabled);
        if (typeof saved.restTimerDurationSeconds === 'number') setRestTimerDurationSecondsRaw(saved.restTimerDurationSeconds);
        if (typeof saved.selectedTrainerId === 'string') setSelectedTrainerIdRaw(saved.selectedTrainerId);
        if (typeof saved.autoScreenRecording === 'boolean') setAutoScreenRecordingRaw(saved.autoScreenRecording);
        if (DEV_FEATURES_ENABLED && (saved.poseModel === 'pose_landmarker_full' || saved.poseModel === 'pose_landmarker_heavy')) setPoseModelRaw(saved.poseModel);
      } catch { /* ignore corrupt data */ }
    });
  }, []);

  const persistSetting = useCallback((key: string, value: boolean | number | string) => {
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

  const setRestTimerEnabled = useCallback((value: boolean) => {
    setRestTimerEnabledRaw(value);
    persistSetting('restTimerEnabled', value);
  }, [persistSetting]);

  const setRestTimerDurationSeconds = useCallback((value: number) => {
    setRestTimerDurationSecondsRaw(value);
    persistSetting('restTimerDurationSeconds', value);
  }, [persistSetting]);

  const setSelectedTrainerId = useCallback((id: string) => {
    setSelectedTrainerIdRaw(id);
    persistSetting('selectedTrainerId', id);
  }, [persistSetting]);

  const setAutoScreenRecording = useCallback((value: boolean) => {
    setAutoScreenRecordingRaw(value);
    persistSetting('autoScreenRecording', value);
  }, [persistSetting]);

  const setPoseModel = useCallback((model: PoseModelName) => {
    setPoseModelRaw(model);
    persistSetting('poseModel', model);
  }, [persistSetting]);

  const contextValue = useMemo<CameraSettingsContextValue>(() => ({
    showFeedback,
    isTTSEnabled,
    showSkeletonOverlay,
    debugMode: DEV_FEATURES_ENABLED ? debugMode : false,
    restTimerEnabled,
    restTimerDurationSeconds,
    selectedTrainerId,
    autoScreenRecording,
    poseModel: DEV_FEATURES_ENABLED ? poseModel : 'pose_landmarker_heavy',
    setShowFeedback,
    setIsTTSEnabled,
    setShowSkeletonOverlay,
    setDebugMode,
    setRestTimerEnabled,
    setRestTimerDurationSeconds,
    setSelectedTrainerId,
    setAutoScreenRecording,
    setPoseModel,
  }), [
    showFeedback, isTTSEnabled, showSkeletonOverlay, debugMode,
    restTimerEnabled, restTimerDurationSeconds, selectedTrainerId, autoScreenRecording, poseModel,
    setShowFeedback, setIsTTSEnabled, setShowSkeletonOverlay, setDebugMode,
    setRestTimerEnabled, setRestTimerDurationSeconds, setSelectedTrainerId, setAutoScreenRecording, setPoseModel,
  ]);

  return (
    <CameraSettingsContext.Provider value={contextValue}>
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
