# Forma Mobile - Project Context & Constraints

## 1. Core Architecture
- **Framework:** React Native 0.74.5 (Expo SDK 51 Managed Workflow)
- **Engine:** Hermes
- **Platform:** iOS (primary) & Android

## 2. Critical Dependency Versions ("The Golden Standard")
**DO NOT DEVIATE** from these specific versions. They are locked to avoid binary conflicts.
- `react-native-vision-camera`: **^4.0.5**
- `react-native-worklets-core`: **^1.3.3** (The Margelo version. NOT `react-native-worklets`)
- `react-native-fast-tflite`: **^1.2.1**
- `@shopify/react-native-skia`: **^1.2.3**
- `react-native-reanimated`: **~3.10.1**
- `react-native-screens`: **~3.31.1** (Strictly locked for Expo 51 compatibility)
- `@react-navigation/native`: **^6.x.x** (We use v6, NOT v7)

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