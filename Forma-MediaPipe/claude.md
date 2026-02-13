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

Project: Forma

What this project is

Forma is a mobile AI-powered fitness app that analyses exercise form using on-device pose estimation.
Core features:
	•	Real-time pose detection from camera
	•	Rep counting using heuristic rules
	•	Form feedback using joint-angle analysis
	•	Token/reward system for consistency
	•	Supabase backend for auth, data, and rewards
	•	React Native (Expo) app targeting Android & iOS

Primary goal: Accurate, fast, reliable form analysis with a clean UX and minimal latency.

⸻

Tech stack
	•	Frontend: React Native + Expo
	•	Camera: react-native-vision-camera
	•	Pose: MediaPipe / MoveNet (via RN bindings / native modules)
	•	Backend: Supabase (Auth, DB, Storage, Functions)
	•	Language: TypeScript
	•	State: React hooks + context (no heavy state libs unless justified)
	•	Build: Expo dev client / EAS
	•	Devices: Android (Galaxy S22) + iOS

⸻

Repo structure (high level)
	•	/app or /src: Main app code
	•	/components: Reusable UI components
	•	/features: Feature modules (e.g. pose, reps, feedback, rewards)
	•	/lib: Utilities, math, helpers, heuristics
	•	/services: Supabase, camera, model wrappers
	•	/assets: Images, icons, models
	•	/native: Any custom native modules / bindings

(Keep things feature-oriented, not just type-oriented.)

⸻

How to run (typical)

npm install
npx expo prebuild
npx expo run:android
# or
npx expo start --dev-client


⸻

How to test
	•	Manual testing on real device is critical (camera + performance)
	•	Unit test pure logic (math, angles, heuristics, rep state machines)
	•	Avoid over-testing UI; focus on correctness of detection logic

⸻

Coding conventions
	•	Language: TypeScript, strict where possible
	•	Style: Readable > clever
	•	Prefer small, composable functions
	•	Heuristics and thresholds must be:
	•	Centralised
	•	Named
	•	Documented
	•	Keep math / pose logic separate from UI
	•	Avoid introducing heavy dependencies unless clearly justified

⸻

Important constraints (VERY IMPORTANT)
	•	Do NOT break:
	•	Camera performance
	•	Real-time FPS
	•	Rep counting stability
	•	Do NOT:
	•	Add unnecessary abstraction layers
	•	Over-engineer ML pipelines (we use heuristics first)
	•	Introduce cloud inference unless explicitly asked
	•	Be careful with:
	•	Coordinate systems (screen vs model space)
	•	Angle definitions and thresholds
	•	Frame-to-frame state transitions

⸻

Pose & Form Analysis Rules
	•	We compute a fixed set of joint angles
	•	Rep counting uses a state machine (e.g. bottom → moving → top → moving → bottom)
	•	Form feedback is derived ONLY from those angles + temporal behavior
	•	No “magic” hidden heuristics: everything must be explicit, named, and explainable
	•	Prefer deterministic, debuggable logic over opaque models

⸻

How I want Claude to help
	•	Prefer incremental changes over big refactors
	•	Explain reasoning when touching:
	•	Heuristics
	•	Thresholds
	•	Rep logic
	•	Performance-sensitive code
	•	Ask before:
	•	Adding new dependencies
	•	Changing architecture
	•	Changing data models or schemas
	•	When debugging:
	•	First hypothesise the failure mode
	•	Then propose instrumentation/logging
	•	Then propose the fix

⸻

Current priorities (evolves over time)
	•	Improve rep counting stability
	•	Reduce false-positive form warnings
	•	Improve camera + model performance
	•	Clean up heuristics into a spec-like structure
	•	Make feedback more actionable and less noisy

⸻

Performance principles
	•	This is a real-time CV app:
	•	Avoid unnecessary re-renders
	•	Avoid allocations in hot paths
	•	Prefer simple math over complex abstractions
	•	Always consider:
	•	FPS
	•	Latency
	•	Battery usage

⸻

Notes for the assistant
	•	This is a product, not a research project
	•	Simplicity, reliability, and debuggability > fancy solutions
	•	If something seems off in pose or reps, assume:
	•	Coordinate mismatch
	•	Angle definition bug
	•	Threshold too tight/loose
	•	State machine edge case
	•	When in doubt, ask before making big changes
