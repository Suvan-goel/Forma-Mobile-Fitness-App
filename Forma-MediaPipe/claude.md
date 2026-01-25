# Forma Mobile - Project Context & Constraints

## 1. Core Architecture
- **Framework:** React Native 0.79.x (Expo SDK 53 Managed Workflow), upgraded for 16KB / Google Play targetSdk 35
- **Engine:** Hermes
- **Platform:** iOS (primary) & Android

## 2. Critical Dependency Versions ("The Golden Standard")
After the Expo 53 / 16KB upgrade, the canonical set is in **package.json** and aligned via `npx expo install --fix`. Key pieces:
- **Expo:** ~53.0.0 — **React:** 19.0.0 — **React Native:** 0.79.x
- `react-native-worklets-core`: **^1.3.3** (The Margelo version. NOT `react-native-worklets`)
- `react-native-vision-camera`, `react-native-fast-tflite`, `@shopify/react-native-skia`, `react-native-reanimated`, `react-native-screens`, etc.: use versions that `npx expo install --fix` selects for SDK 53
- See **docs/EXPO-53-16KB-UPGRADE.md** for the full upgrade and local steps.

## 3. Worklet Rules (Strict)
We use `react-native-worklets-core` for VisionCamera frame processors.
- **Rule 1:** Any function called inside `useFrameProcessor` MUST start with the `'worklet';` directive at the very top.
- **Rule 2:** Do not use `runOnJS` unless absolutely necessary for UI updates that SharedValues cannot handle.
- **Rule 3:** Complex logic (angles, rep counting) should be extracted into separate files where functions are explicitly marked `'worklet'`.
- **Rule 4:** NEVER install `@swmansion/react-native-worklets`. It conflicts with our stack. 

## 4. Coding Patterns
### Frame Processor Pattern
```typescript
const frameProcessor = useFrameProcessor((frame) => {
  'worklet';
  // 1. Resize/Format Frame
  const resized = resize(frame, { scale: 0.25 });
  
  // 2. Run Model
  const outputs = model.run(resized);
  
  // 3. Update SharedValues for Skia (Do not set React State here!)
  poseKeypoints.value = outputs[0];
}, [model]);