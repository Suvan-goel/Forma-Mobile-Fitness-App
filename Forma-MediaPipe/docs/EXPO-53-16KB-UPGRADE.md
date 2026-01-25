# Expo SDK 53 Upgrade for 16KB / Google Play

This project has been updated to **Expo SDK 53** and **React Native 0.79** so native libraries are built with 16KB page alignment and the app can target **Android 15 (API 35)** for Google Play.

## What Changed

- **Expo:** 51 → 53  
- **React:** 18.2 → 19.0  
- **React Native:** 0.74.5 → 0.79.2  
- **Expo packages:** expo-blur, expo-build-properties, expo-dev-client, expo-font, expo-linear-gradient, expo-status-bar bumped to SDK 53–compatible versions  
- **React Navigation:** 6 → 7 (peer-compatible with Expo 53)  
- **react-native-reanimated, react-native-screens, react-native-gesture-handler, react-native-safe-area-context, react-native-svg:** Updated to versions compatible with RN 0.79  
- **package.json overrides:** `react` and `react-dom` set to 19.0.0 to avoid duplicate React when some deps still declare React 18 peer dependency  
- **16KB script:** APK extraction uses `unzip -o -q` so duplicate paths in the archive do not prompt for input  

## Steps You Must Run Locally

1. **Install dependencies**
   ```bash
   npm install
   ```
   If you see peer dependency warnings, they are often safe to leave as-is. If installation fails, try:
   ```bash
   npm install --legacy-peer-deps
   ```

2. **Align versions with Expo**
   ```bash
   npx expo install --fix
   ```
   This ensures every Expo-related and RN-related package matches the versions recommended for SDK 53.

3. **Regenerate native projects (prebuild)**
   Delete existing native folders and prebuild so Android/iOS use the new native code:
   ```bash
   rm -rf android ios
   npx expo prebuild --clean
   ```

4. **Build and run the 16KB check**
   ```bash
   cd android && ./gradlew assembleRelease && cd ..
   ./scripts/check_16kb_compatibility.sh android/app/build/outputs/apk/release/app-release.apk
   ```
   You should see far fewer (ideally zero) “NOT 16KB compliant” libs. If any remain, they come from a dependency that has not yet shipped 16KB-built binaries; upgrading that dependency or waiting for a fixed release is the next step.

5. **Run the app**
   ```bash
   npx expo run:android
   npx expo run:ios
   ```

## Possible Breaking Changes

- **React 19** – Some lifecycle and hook behaviors changed. If you use patterns that rely on React 18–specific behavior, update them per the [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide).
- **React Navigation 7** – If you use advanced navigation APIs, check the [React Navigation 7 migration notes](https://reactnavigation.org/docs/upgrading-from-6.x).
- **New Architecture** – Still **disabled** (`newArchEnabled: false` in app.json). You can enable it later once all native modules support it.
- **@thinksys/react-native-mediapipe** – Left at ^0.0.19. If you see build or runtime errors on Android/iOS after the upgrade, check the library’s repo for compatibility with React Native 0.79 and Expo 53.

## app.json

- **targetSdkVersion / compileSdkVersion:** Remain 35 for Google Play and 16KB.  
- **Plugins:** Unchanged (react-native-vision-camera, react-native-fast-tflite, expo-font, expo-build-properties).  
- **newArchEnabled:** false (unchanged).

## CLAUDE.md / “Golden” Versions

The previous “golden” versions in CLAUDE.md targeted Expo 51 and RN 0.74. For 16KB and Google Play, the stack is now Expo 53 and RN 0.79. Update CLAUDE.md (or your team’s version doc) to treat the versions in **package.json** after `npx expo install --fix` as the new reference set.

## If Something Breaks

- Run `npx expo-doctor` and fix any reported issues.  
- For “Unable to resolve module” or Metro errors, clear cache: `npx expo start -c`.  
- For native build failures, ensure `android` and `ios` were removed and regenerated with `npx expo prebuild --clean`.  
- For React 19 issues, temporarily try `"resolutions"` (Yarn) or `"overrides"` (npm) to force React 18 only if you must defer the React 19 migration; prefer fixing code for React 19 when possible.
