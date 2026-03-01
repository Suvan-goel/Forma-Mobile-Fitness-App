import { useState, useCallback, useRef } from 'react';
import {
  startScreenRecording,
  stopScreenRecording,
  cleanupTempRecording,
  isScreenRecordingAvailable,
  getRecordingState,
} from '../services/screenRecording';

export function useScreenRecording() {
  const [isRecordingScreen, setIsRecordingScreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRecordingRef = useRef(false);

  const startRecording = useCallback(async (): Promise<boolean> => {
    setError(null);
    const result = await startScreenRecording({ mic: true });
    if (result.success) {
      isRecordingRef.current = true;
      setIsRecordingScreen(true);
      return true;
    }
    setError(result.error ?? 'Failed to start recording');
    return false;
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    setError(null);
    if (__DEV__) console.log('[useScreenRecording] stopping recording...');
    const result = await stopScreenRecording();
    isRecordingRef.current = false;
    setIsRecordingScreen(false);
    if (result.success && result.outputUrl) {
      if (__DEV__) console.log('[useScreenRecording] stop succeeded, url:', result.outputUrl);
      return result.outputUrl;
    }
    if (result.error) {
      if (__DEV__) console.warn('[useScreenRecording] stop failed:', result.error);
      setError(result.error);
    }
    return null;
  }, []);

  const cancelRecording = useCallback(async (): Promise<void> => {
    if (isRecordingRef.current || getRecordingState()) {
      const result = await stopScreenRecording();
      isRecordingRef.current = false;
      setIsRecordingScreen(false);
      if (result.outputUrl) {
        await cleanupTempRecording(result.outputUrl);
      }
    }
  }, []);

  return {
    isRecordingScreen,
    isRecordingScreenRef: isRecordingRef,
    error,
    isAvailable: isScreenRecordingAvailable(),
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
