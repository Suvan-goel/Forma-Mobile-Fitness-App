/**
 * Screen Recording Service
 *
 * Wraps react-native-record-screen to provide OS-level screen recording
 * using ReplayKit (iOS) and MediaProjection (Android).
 * Follows the same defensive module loading pattern as elevenlabsTTS.ts.
 */

import { Platform } from 'react-native';

let RecordScreen: any = null;
let nativeModulesAvailable = false;

try {
  RecordScreen = require('react-native-record-screen').default;
  nativeModulesAvailable = true;
} catch (error) {
  console.warn('Screen recording: native modules not available:', error);
  nativeModulesAvailable = false;
}

let isCurrentlyRecording = false;

/**
 * Check if screen recording native modules are available.
 */
export function isScreenRecordingAvailable(): boolean {
  return nativeModulesAvailable;
}

/**
 * Check if screen recording is currently active.
 */
export function getRecordingState(): boolean {
  return isCurrentlyRecording;
}

/**
 * Start screen recording.
 * On Android, mic is disabled because MediaPipe's camera holds the audio source —
 * enabling mic causes HBRecorder's setAudioSource to fail, preventing any recording.
 * On iOS, mic is enabled to capture ambient TTS audio via ReplayKit.
 */
export async function startScreenRecording(
  options?: { mic?: boolean }
): Promise<{ success: boolean; error?: string }> {
  if (!nativeModulesAvailable || !RecordScreen) {
    return { success: false, error: 'Screen recording not available' };
  }

  if (isCurrentlyRecording) {
    return { success: false, error: 'Already recording' };
  }

  // Android: camera holds the audio source → setAudioSource fails → no recording at all.
  // Disable mic on Android to get video-only recording instead of nothing.
  const useMic = Platform.OS === 'ios' ? (options?.mic ?? true) : false;

  try {
    const result = await RecordScreen.startRecording({
      mic: useMic,
      fps: 30,
      bitrate: 6000000, // 6 Mbps
    });

    // Native module resolves with string "started" on success, "permission_error" on failure
    if (result === 'started') {
      isCurrentlyRecording = true;
      return { success: true };
    }

    if (result === 'permission_error') {
      return { success: false, error: 'Screen recording permission denied' };
    }

    // Fallback: check object-style responses (other platforms / library versions)
    if (result?.status === 'started' || result?.status === 'success') {
      isCurrentlyRecording = true;
      return { success: true };
    }

    // If result is truthy and not an error, treat as success
    if (result && result !== 'error' && !result?.error) {
      isCurrentlyRecording = true;
      return { success: true };
    }

    return { success: false, error: result?.error || 'Recording did not start' };
  } catch (error: any) {
    isCurrentlyRecording = false;
    return { success: false, error: error?.message || 'Failed to start recording' };
  }
}

/**
 * Stop screen recording and return the path to the recorded video file.
 */
export async function stopScreenRecording(): Promise<{
  success: boolean;
  outputUrl?: string;
  error?: string;
}> {
  if (!nativeModulesAvailable || !RecordScreen) {
    return { success: false, error: 'Screen recording not available' };
  }

  // Always attempt native stop — the start may still be in-flight (OS permission prompt)
  // or isCurrentlyRecording may be stale. The native module handles double-stop gracefully.

  try {
    // Timeout as safety net if the native module never resolves.
    // Samsung/Android MediaProjection can take 10-30s to finalize; this runs in the
    // background (CameraScreen navigates immediately) so a long timeout is fine.
    const startMs = Date.now();
    const result = await Promise.race([
      RecordScreen.stopRecording(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 30000)),
    ]);
    const elapsedMs = Date.now() - startMs;
    isCurrentlyRecording = false;

    if (__DEV__) console.log(`[screenRecording] stopRecording resolved in ${elapsedMs}ms, result:`, JSON.stringify(result));

    if (!result) {
      if (__DEV__) console.warn(`[screenRecording] stopRecording timed out after ${elapsedMs}ms`);
      return { success: false, error: 'Stop recording timed out' };
    }

    // Native module returns: { status: "success", result: { outputURL: "file://..." } }
    // On error (patched): { status: "error", result: { error: "..." } }
    if (result?.status === 'error') {
      const errMsg = result?.result?.error || 'Native stop failed';
      if (__DEV__) console.warn('[screenRecording] native stop error:', errMsg);
      return { success: false, error: errMsg };
    }

    // Try every known path the URL might appear at (varies by platform/library version)
    const outputUrl =
      result?.result?.outputURL ||
      result?.result?.outputUrl ||
      result?.outputURL ||
      result?.outputUrl ||
      result?.result?.url ||
      result?.url;

    if (outputUrl) {
      if (__DEV__) console.log('[screenRecording] got output URL:', outputUrl);
      return { success: true, outputUrl };
    }

    // Last resort: walk the result object looking for any string that looks like a file path
    const resultStr = JSON.stringify(result);
    if (__DEV__) console.warn('[screenRecording] no output URL found in result:', resultStr);

    return { success: false, error: 'No output URL returned' };
  } catch (error: any) {
    isCurrentlyRecording = false;
    if (__DEV__) console.warn('[screenRecording] stopRecording threw:', error?.message);
    return { success: false, error: error?.message || 'Failed to stop recording' };
  }
}

/**
 * Clean up temporary recording files.
 */
export async function cleanupTempRecording(url: string): Promise<void> {
  try {
    const FileSystem = require('expo-file-system');
    const uri = url.startsWith('file://') ? url : `file://${url}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Clean all temporary recording files via the library's clean method.
 */
export async function cleanAllTempRecordings(): Promise<void> {
  if (!nativeModulesAvailable || !RecordScreen) return;
  try {
    await RecordScreen.clean();
  } catch {
    // Best-effort cleanup
  }
}
