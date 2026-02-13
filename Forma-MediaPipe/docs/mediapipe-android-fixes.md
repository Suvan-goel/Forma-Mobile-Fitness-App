# MediaPipe Android Fixes

This project applies patches to `@thinksys/react-native-mediapipe` for correctness and Android latency improvements. The patches are applied automatically via `patch-package` after `npm install`.

## Fixes Applied

### 1. **ImageProxy used after close() (Correctness)**
- **File:** `PoseLandmarkerHelper.kt`
- **Issue:** `imageProxy.imageInfo.rotationDegrees` and dimensions were read after `imageProxy.close()`, which is invalid.
- **Fix:** Capture `rotationDegrees`, `width`, and `height` into local variables before closing the proxy.

### 2. **onLandmark stale closure (Correctness)**
- **File:** `src/index.tsx`
- **Issue:** The Android event subscription used an empty dependency array, so `onLandmark` could be stale.
- **Fix:** Added `onLandmark` to the `useEffect` dependency array.

### 3. **JSON serialization on main thread (Latency)**
- **File:** `CameraFragment.kt`
- **Issue:** Landmark array building and Gson serialization ran on the main thread via `runOnUiThread`, blocking UI.
- **Fix:** Build landmark maps and serialize to JSON on the calling thread (MediaPipe background). Only `emit()` and overlay update run on the main thread.

### 4. **Frame throttling (Latency)**
- **Files:** `CameraFragment.kt`, `GlobalState.java`, `TsMediapipeViewManager.java`
- **Issue:** Android processed every camera frame (~30fps) while iOS was capped at 20fps, causing queue buildup and higher latency.
- **Fix:** Added time-based frame throttling (default 20fps) matching iOS. `frameLimit` prop is passed from React Native and stored in `GlobalState`.

## Rebuilding

After `npm install`, the patches are applied automatically. Rebuild the Android app:

```bash
npx expo run:android
```

## Recreating the patch

If you modify the MediaPipe library source in `node_modules` and need to update the patch:

1. Delete the `android/build` folder in the MediaPipe package to avoid including build artifacts.
2. Run: `npx patch-package @thinksys/react-native-mediapipe`
