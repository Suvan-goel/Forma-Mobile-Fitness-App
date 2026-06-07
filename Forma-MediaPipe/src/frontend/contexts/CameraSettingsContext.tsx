import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CAMERA_SETTINGS_KEY } from '../../utils/storageKeys';
import type { PoseModelName } from 'expo-pose-detection';
import { DEV_FEATURES_ENABLED } from '../../config/devFeatures';
import { DEFAULT_TRAINER_ID, TRAINERS } from '../constants/trainers';

export type CameraSettings = {
  showFeedback: boolean;
  isTTSEnabled: boolean;
  showSkeletonOverlay: boolean;
  devFeaturesEnabled: boolean;
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
  setDevFeaturesEnabled: (value: boolean) => void;
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
  devFeaturesEnabled: DEV_FEATURES_ENABLED,
  debugMode: false,
  restTimerEnabled: false,
  restTimerDurationSeconds: 90,
  selectedTrainerId: DEFAULT_TRAINER_ID,
  autoScreenRecording: false,
  poseModel: 'pose_landmarker_heavy',
};

const TRAINER_IDS = new Set(TRAINERS.map((trainer) => trainer.id));

function normalizeTrainerId(id: unknown): string {
  return typeof id === 'string' && TRAINER_IDS.has(id) ? id : DEFAULT_TRAINER_ID;
}

const CameraSettingsContext = createContext<CameraSettingsContextValue | null>(null);

export const CameraSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showFeedback, setShowFeedbackRaw] = useState(defaultSettings.showFeedback);
  const [isTTSEnabled, setIsTTSEnabledRaw] = useState(defaultSettings.isTTSEnabled);
  const [showSkeletonOverlay, setShowSkeletonOverlayRaw] = useState(defaultSettings.showSkeletonOverlay);
  const [devFeaturesEnabled, setDevFeaturesEnabledRaw] = useState(defaultSettings.devFeaturesEnabled);
  const [debugMode, setDebugModeRaw] = useState(defaultSettings.debugMode);
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
        if (typeof saved.devFeaturesEnabled === 'boolean') setDevFeaturesEnabledRaw(saved.devFeaturesEnabled);
        if (typeof saved.debugMode === 'boolean') setDebugModeRaw(saved.debugMode);
        if (typeof saved.restTimerEnabled === 'boolean') setRestTimerEnabledRaw(saved.restTimerEnabled);
        if (typeof saved.restTimerDurationSeconds === 'number') setRestTimerDurationSecondsRaw(saved.restTimerDurationSeconds);
        if ('selectedTrainerId' in saved) {
          const normalizedTrainerId = normalizeTrainerId(saved.selectedTrainerId);
          setSelectedTrainerIdRaw(normalizedTrainerId);
          if (saved.selectedTrainerId !== normalizedTrainerId) {
            AsyncStorage.setItem(
              CAMERA_SETTINGS_KEY,
              JSON.stringify({ ...saved, selectedTrainerId: normalizedTrainerId }),
            ).catch(() => { /* ignore migration write errors */ });
          }
        }
        if (typeof saved.autoScreenRecording === 'boolean') setAutoScreenRecordingRaw(saved.autoScreenRecording);
        if (
          (DEV_FEATURES_ENABLED || saved.devFeaturesEnabled === true) &&
          (saved.poseModel === 'pose_landmarker_full' || saved.poseModel === 'pose_landmarker_heavy')
        ) setPoseModelRaw(saved.poseModel);
      } catch { /* ignore corrupt data */ }
    });
  }, []);

  const persistSettings = useCallback((values: Record<string, boolean | number | string>) => {
    AsyncStorage.getItem(CAMERA_SETTINGS_KEY).then((raw) => {
      const current = raw ? JSON.parse(raw) : {};
      AsyncStorage.setItem(CAMERA_SETTINGS_KEY, JSON.stringify({ ...current, ...values }));
    }).catch(() => { /* ignore write errors */ });
  }, []);

  const persistSetting = useCallback((key: string, value: boolean | number | string) => {
    persistSettings({ [key]: value });
  }, [persistSettings]);

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

  const setDevFeaturesEnabled = useCallback((value: boolean) => {
    setDevFeaturesEnabledRaw(value);
    if (!value) {
      setDebugModeRaw(false);
    }
    persistSettings(value ? { devFeaturesEnabled: value } : { devFeaturesEnabled: value, debugMode: false });
  }, [persistSettings]);

  const setDebugMode = useCallback((value: boolean) => {
    setDebugModeRaw(value);
    persistSetting('debugMode', value);
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
    const normalizedTrainerId = normalizeTrainerId(id);
    setSelectedTrainerIdRaw(normalizedTrainerId);
    persistSetting('selectedTrainerId', normalizedTrainerId);
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
    devFeaturesEnabled,
    debugMode: devFeaturesEnabled ? debugMode : false,
    restTimerEnabled,
    restTimerDurationSeconds,
    selectedTrainerId,
    autoScreenRecording,
    poseModel: devFeaturesEnabled ? poseModel : 'pose_landmarker_heavy',
    setShowFeedback,
    setIsTTSEnabled,
    setShowSkeletonOverlay,
    setDevFeaturesEnabled,
    setDebugMode,
    setRestTimerEnabled,
    setRestTimerDurationSeconds,
    setSelectedTrainerId,
    setAutoScreenRecording,
    setPoseModel,
  }), [
    showFeedback, isTTSEnabled, showSkeletonOverlay, devFeaturesEnabled, debugMode,
    restTimerEnabled, restTimerDurationSeconds, selectedTrainerId, autoScreenRecording, poseModel,
    setShowFeedback, setIsTTSEnabled, setShowSkeletonOverlay, setDevFeaturesEnabled, setDebugMode,
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
