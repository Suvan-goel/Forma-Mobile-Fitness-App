import { requireNativeModule } from 'expo-modules-core';

const ExpoPoseDetection = requireNativeModule('ExpoPoseDetection');

export function switchCamera(): void {
  ExpoPoseDetection.switchCamera();
}

export default ExpoPoseDetection;
