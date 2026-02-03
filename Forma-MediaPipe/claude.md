# Forma Mobile - Project Context & Constraints

## 1. Core Architecture
- **Framework:** React Native 0.79.x (Expo SDK 53 Managed Workflow), upgraded for 16KB / Google Play targetSdk 35
- **Engine:** Hermes
- **Platform:** iOS & Android

## 2. Critical Dependency Versions ("The Golden Standard")
After the Expo 53 / 16KB upgrade, the canonical set is in **package.json** and aligned via `npx expo install --fix`. Key pieces:
- **Expo:** ~53.0.0 — **React:** 19.0.0 — **React Native:** 0.79.x
- `@thinksys/react-native-mediapipe`: ^0.0.19 (Pose detection)
- `react-native-screens`, `react-native-gesture-handler`, etc.: use versions that `npx expo install --fix` selects for SDK 53
- See **docs/EXPO-53-16KB-UPGRADE.md** for the full upgrade and local steps.

## 3. MediaPipe Integration
We use `@thinksys/react-native-mediapipe` for pose detection with callback-based landmark data.
- The `RNMediapipe` component handles camera and pose detection internally
- Landmark data is received via `onLandmark` callback (not frame processors/worklets)
- No worklets, no Reanimated needed - pure callback-based architecture

### Removed Dependencies (iOS Hermes Fix)
The following were removed to fix iOS crashes ("Cannot read property 'S' of undefined"):
- `react-native-reanimated` - was not used in app code
- `react-native-worklets-core` - was not used in app code
- Corresponding Babel plugins removed from babel.config.js

## 4. Coding Patterns
### MediaPipe Landmark Handling
```typescript
const handleLandmark = useCallback((data: any) => {
  const keypoints = convertLandmarksToKeypoints(data);
  if (!keypoints) return;

  // Process pose data (rep counting, form analysis)
  const result = updateBarbellCurlState(keypoints, stateRef.current);

  // Update React state for UI
  setRepCount(result.repCount);
  setCurrentFormScore(result.formScore);
}, []);

<RNMediapipe
  {...mediapipeProps}
  onLandmark={handleLandmark}
/>
```

## 5. Animations
Use React Native's built-in `Animated` API from `react-native` (NOT Reanimated):
```typescript
import { Animated } from 'react-native';
```
