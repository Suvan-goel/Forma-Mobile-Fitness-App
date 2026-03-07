import { Platform } from 'react-native';

let ExpoLiveActivity: {
  startWorkoutActivity(elapsedSeconds: number): boolean;
  updateWorkoutActivity(isPaused: boolean, elapsedSeconds: number): void;
  endWorkoutActivity(): void;
  isAvailable(): boolean;
} | null = null;

if (Platform.OS === 'ios') {
  try {
    const { requireNativeModule } = require('expo-modules-core');
    ExpoLiveActivity = requireNativeModule('ExpoLiveActivity');
  } catch {
    // Module not available (older iOS, simulator, etc.)
  }
}

export function startWorkoutActivity(elapsedSeconds: number = 0): boolean {
  if (!ExpoLiveActivity) return false;
  try {
    return ExpoLiveActivity.startWorkoutActivity(elapsedSeconds);
  } catch {
    return false;
  }
}

export function updateWorkoutActivity(isPaused: boolean, elapsedSeconds: number): void {
  if (!ExpoLiveActivity) return;
  try {
    ExpoLiveActivity.updateWorkoutActivity(isPaused, elapsedSeconds);
  } catch {}
}

export function endWorkoutActivity(): void {
  if (!ExpoLiveActivity) return;
  try {
    ExpoLiveActivity.endWorkoutActivity();
  } catch {}
}

export function isLiveActivityAvailable(): boolean {
  if (!ExpoLiveActivity) return false;
  try {
    return ExpoLiveActivity.isAvailable();
  } catch {
    return false;
  }
}
