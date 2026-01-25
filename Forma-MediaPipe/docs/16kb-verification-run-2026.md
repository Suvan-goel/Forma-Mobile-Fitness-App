# 16KB Verification Run (2026)

**Date:** January 2026  
**Purpose:** Confirm the app’s native dependencies are 16KB page-size compliant for targetSdk 35.

---

## MediaPipe Tasks Vision (arm64-v8a)

The app uses **@thinksys/react-native-mediapipe**, which depends on **MediaPipe Tasks Vision 0.10.29**. The `arm64-v8a` native library shipped in that dependency was checked with `llvm-objdump` from the Android NDK.

**Library:** `libmediapipe_tasks_vision_jni.so`  
**Source:** Gradle transform cache  
`~/.gradle/caches/.../jetified-tasks-vision-0.10.29/jni/arm64-v8a/`

### llvm-objdump output (LOAD segments)

```
    LOAD off    0x0000000000000000 vaddr 0x0000000000000000 paddr 0x0000000000000000 align 2**14
    LOAD off    0x0000000000988000 vaddr 0x0000000000988000 paddr 0x0000000000988000 align 2**14
    LOAD off    0x00000000009d3778 vaddr 0x00000000009d7778 paddr 0x00000000009d7778 align 2**14
```

- **2\*\*14** = 16,384 bytes = **16 KB**  
- All three LOAD segments are 16KB-aligned.

### Verdict

**MediaPipe Tasks Vision 0.10.29 (arm64-v8a) is 16KB compliant.**  
This is the main native dependency of concern for the ThinkSys MediaPipe integration.

---

## What is “100%” verification?

- **Dependency check (done):** The MediaPipe .so that ships with the app has been verified from the Gradle cache. That gives high confidence for targetSdk 35.
- **Full app check (run locally):** To confirm every `.so` in the final APK is compliant, build a release APK and run the project’s 16KB script on it.

### How to run the full check yourself

From the project root, with Java 17 and Android NDK available:

```bash
chmod +x scripts/verify-16kb-and-targetsdk35.sh
./scripts/verify-16kb-and-targetsdk35.sh
```

Or step by step:

```bash
cd android && ./gradlew assembleRelease && cd ..
./scripts/check_16kb_compatibility.sh android/app/build/outputs/apk/release/app-release.apk
```

If the script prints **“ALL LIBRARIES ARE 16KB COMPLIANT!”** and exits 0, the build you just produced is 16KB-compliant and suitable for targetSdk 35 from a 16KB perspective.

---

## Config used for targetSdk 35

- **app.json:** `expo-build-properties` → `android.compileSdkVersion: 35`, `android.targetSdkVersion: 35`
- **android/gradle.properties:** `android.compileSdkVersion=35`, `android.targetSdkVersion=35`
