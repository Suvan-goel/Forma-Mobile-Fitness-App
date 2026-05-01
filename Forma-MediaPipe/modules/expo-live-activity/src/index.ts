import { Platform } from 'react-native';

let ExpoLiveActivity: {
  startWorkoutActivity(elapsedSeconds: number): boolean;
  endWorkoutActivity(): void;
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

export function endWorkoutActivity(): void {
  if (!ExpoLiveActivity) return;
  try {
    ExpoLiveActivity.endWorkoutActivity();
  } catch {}
}
