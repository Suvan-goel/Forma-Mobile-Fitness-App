# 16KB compliance: removed non-compliant native dependencies

To get the app to pass the 16KB page-size check for Google Play (targetSdk 35), we removed packages whose native libs were built with 4KB alignment and had no 16KB-built release at the time.

## Removed packages

| Package | Non-compliant .so | Reason |
|--------|--------------------|--------|
| **react-native-vision-camera** | (libVisionCamera was compliant; plugins were not) | Only used in backup TFLite screen |
| **vision-camera-resize-plugin** | libVisionCameraResizePlugin.so | Only used in `CameraScreen.tflite.backup.tsx` |
| **react-native-fast-tflite** | libVisionCameraTflite.so | Only used in `CameraScreen.tflite.backup.tsx` |
| **@shopify/react-native-skia** | librnskia.so | Not imported anywhere in the app |

The **active** camera flow uses **@thinksys/react-native-mediapipe** only (`CameraScreen.tsx`), so the app still has full pose detection and recording without these packages.

## If libyuv.so is still non-compliant

**libyuv** usually comes from React Native’s image stack or from Expo. If, after the removals above, the 16KB script still reports `libyuv.so` as non-compliant:

1. **Re-run the check** after a clean build:
   - `cd android && ./gradlew clean && ./build-with-java17.sh assembleRelease && cd ..`
   - `./scripts/check_16kb_compatibility.sh android/app/build/outputs/apk/release/app-release.apk`

2. If **libyuv** is still there and still 2**12, it is almost certainly from React Native or an Expo image dependency. You can’t fix it by removing another app-level package. Options:
   - Ensure you’re on the latest Expo 53 / React Native 0.79.x and run the check again (newer builds may ship 16KB-aligned libyuv).
   - Track [React Native](https://github.com/facebook/react-native) / [Expo](https://github.com/expo/expo) for 16KB-related releases or issues.

## Restoring the TFLite backup path

The file `CameraScreen.tflite.backup.tsx` implements a TFLite + Vision Camera path. It currently imports and uses:

- `react-native-vision-camera`
- `vision-camera-resize-plugin`
- `react-native-fast-tflite`

To use that path again you would need to:

1. Re-add those dependencies and the Vision Camera / resize / TFLite plugins to `app.json`.
2. Use it only when maintainers ship 16KB-built native libs (or a fork that does), so the 16KB script passes.

Until then, the main camera remains the ThinkSys MediaPipe path only.
