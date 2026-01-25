# How to Verify targetSdk 35 Compatibility

Google Play requires new apps and updates to target **Android 15 (API 35)**. For API 35, native libraries must also meet the **16KB page size** requirement. This guide shows how to verify your app satisfies both.

## What you're verifying

1. **Build succeeds** with `compileSdkVersion` and `targetSdkVersion` set to 35.
2. **16KB alignment** – All `arm64-v8a` native `.so` files in your release build use 16KB-aligned segments so the app won’t crash on 16KB-page devices and won’t be rejected by Play.

## Prerequisites

- **Android NDK** installed (Android Studio → SDK Manager → SDK Tools → NDK) so `llvm-objdump` is available.  
  Typical path:  
  `$ANDROID_HOME/ndk/<version>/toolchains/llvm/prebuilt/<platform>/bin/llvm-objdump`
- **Java 17** for Gradle (see [android-build.md](./android-build.md)).
- **Expo / Android** – You need a built release artefact (see below).

## Verification steps

### 1. Use targetSdk 35 for the build

In `app.json`, under `expo-build-properties` → `android`, set:

```json
"compileSdkVersion": 35,
"targetSdkVersion": 35
```

Also set the same in `android/gradle.properties` if that file overrides them:

```
android.compileSdkVersion=35
android.targetSdkVersion=35
```

### 2. Produce a release APK

From the project root:

```bash
# If you don't have android/ yet
npx expo prebuild --platform android --clean

# Build release APK (use Java 17 – set JAVA_HOME if needed)
cd android
./gradlew assembleRelease
cd ..
```

APK path:  
`android/app/build/outputs/apk/release/app-release.apk`

If you use **EAS Build**, download the **APK** from the build output and use that file in step 3.

### 3. Run the 16KB compatibility script

From the **project root**:

```bash
chmod +x scripts/check_16kb_compatibility.sh
./scripts/check_16kb_compatibility.sh android/app/build/outputs/apk/release/app-release.apk
```

Or, if your APK is elsewhere:

```bash
./scripts/check_16kb_compatibility.sh /path/to/your/app-release.apk
```

### 4. Interpret the result

- **Script exits 0 and prints “ALL LIBRARIES ARE 16KB COMPLIANT!”**  
  → Your **release build** is compatible with targetSdk 35 from a 16KB perspective. You can ship that build to Play (from a 16KB standpoint).

- **Script exits 1 or reports “NOT 16KB compliant” for any library**  
  → That build is **not** 16KB-compliant. Do not rely on it for targetSdk 35 until you’ve either:
  - Updated or replaced the dependency that ships the non-compliant `.so`, or  
  - Switched the Android build to a stack that doesn’t include that library (e.g. the TFLite-based camera path in `CameraScreen.tflite.backup.tsx`), then rebuilt and re-ran this script.

## If you only have an AAB

The script expects an APK. To check the same binaries that ship in your AAB:

1. Use [bundletool](https://github.com/google/bundletool/releases) to build a universal APK:
   ```bash
   java -jar bundletool-all-*.jar build-apks --bundle=your.aab --output=out.apks --mode=universal
   unzip out.apks -d apks_out
   ```
2. Run the checker on the universal APK inside `apks_out/`:
   ```bash
   ./scripts/check_16kb_compatibility.sh apks_out/universal.apk
   ```

## What “verified” means

- **For this repo:**  
  A previous check of the **MediaPipe Tasks Vision** library used by `@thinksys/react-native-mediapipe` (see [16kb-verification-result.md](./16kb-verification-result.md)) showed 16KB alignment. That was done on the Gradle-cache `.so` that ends up in the app.

- **For your actual release:**  
  The only way to be sure **your** build is compatible is to run `scripts/check_16kb_compatibility.sh` on the **exact** release APK (or universal APK from your AAB) you plan to upload. Doing that after a build with targetSdk 35 is the verification that your app will be compatible with targetSdk 35 from a 16KB standpoint.

## Quick checklist

- [ ] Set `compileSdkVersion` and `targetSdkVersion` to 35.
- [ ] Build release APK (or get it from EAS).
- [ ] Run `./scripts/check_16kb_compatibility.sh <path-to-apk>`.
- [ ] Confirm “ALL LIBRARIES ARE 16KB COMPLIANT!” and exit code 0.
