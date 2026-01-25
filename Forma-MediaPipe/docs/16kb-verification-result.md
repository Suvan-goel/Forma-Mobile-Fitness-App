# 16KB Page Size Verification Result

**Date:** January 25, 2026  
**Method:** `llvm-objdump` on native libraries  
**Status:** ✅ **COMPATIBLE**

---

## Summary

The **MediaPipe Tasks Vision** library used by `@thinksys/react-native-mediapipe` (version **0.10.29**) was verified for 16KB page size alignment using `llvm-objdump`.

**Result: All PT_LOAD segments use `align 2**14` (16,384 bytes = 16 KB).**

---

## What Was Checked

We inspected the exact native library that ships inside your app when using ThinkSys MediaPipe:

| Item | Value |
|------|--------|
| **Library** | `libmediapipe_tasks_vision_jni.so` |
| **Source** | `com.google.mediapipe:tasks-vision:0.10.29` |
| **ABI** | arm64-v8a (64-bit ARM, where 16KB requirement applies) |
| **Location** | Gradle cache (same .so that would be inside your APK) |

---

## llvm-objdump Output

```
LOAD off    0x0000000000000000 vaddr 0x0000000000000000 paddr 0x0000000000000000 align 2**14
LOAD off    0x0000000000988000 vaddr 0x0000000000988000 paddr 0x0000000000988000 align 2**14
LOAD off    0x00000000009d3778 vaddr 0x00000000009d7778 paddr 0x00000000009d7778 align 2**14
```

- **2\*\*14** = 16,384 bytes = **16 KB** ✅  
- 2\*\*12 = 4,096 bytes = 4 KB (would fail)

All three `LOAD` segments are aligned to 16 KB, which meets Google Play’s requirement.

---

## Conclusion

Your app’s use of **@thinksys/react-native-mediapipe** with **MediaPipe Tasks Vision 0.10.29** is **16KB page size compliant**.

You can target **Android 15 (API 35)** and expect to satisfy Google Play’s 16KB compatibility requirement for this dependency.

---

## How This Was Done

Because an Android release APK was not built in this environment, we checked the same binary that would go into your APK:

1. **Source of the .so**  
   ThinkSys depends on `com.google.mediapipe:tasks-vision:0.10.29`. That AAR is fetched by Gradle and cached under  
   `~/.gradle/caches/.../jetified-tasks-vision-0.10.29/jni/arm64-v8a/`.

2. **Tool**  
   Android NDK’s `llvm-objdump`:
   ```bash
   llvm-objdump -p libmediapipe_tasks_vision_jni.so | grep -E "LOAD|align"
   ```

3. **Interpretation**  
   For each `LOAD` segment, the `align` field must be at least `2**14` (16 KB). All shown segments meet that.

---

## Optional: Re-check After a Full Build

When you have a release APK, you can run the project’s checker script for a full audit of all native libs in the package:

```bash
cd android
./gradlew assembleRelease
cd ..
./scripts/check_16kb_compatibility.sh android/app/build/outputs/apk/release/app-release.apk
```

That will list every `arm64-v8a` .so in the APK and its alignment. The MediaPipe library you rely on has already been verified as compliant.

---

## References

- [GitHub Issue #22](https://github.com/ThinkSys/mediapipe-reactnative/issues/22) – ThinkSys update to MediaPipe 0.10.26+ for 16 KB support (closed).
- Google’s 16 KB requirement: [Android Developers Blog](https://android-developers.googleblog.com/2025/05/prepare-play-apps-for-devices-with-16kb-page-size.html).
- Alignment check: `llvm-objdump -p <file>.so` and inspect `LOAD` segment `align` values.

---

**Verified by:** llvm-objdump (NDK 25.1.8937393)  
**Library version:** MediaPipe Tasks Vision 0.10.29  
**Verdict:** ✅ **16KB compliant – app is compatible with Google Play’s requirement for this library.**
