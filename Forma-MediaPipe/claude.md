# Forma Mobile - Project Context & Constraints

## 1. Core Architecture
- **Framework:** React Native 0.79.6 (Expo SDK 53 Managed Workflow)
- **iOS JS Engine:** JSC (JavaScriptCore) — NOT Hermes (see section 6)
- **Android JS Engine:** Hermes (default)
- **Platform:** iOS & Android
- **New Arch:** Disabled (`newArchEnabled: false`)

## 2. Critical Dependency Versions
Canonical set lives in `package.json`, aligned via `npx expo install --fix`. Key pieces:
- **Expo:** ~53.0.27 — **React:** 19.0.0 — **React Native:** 0.79.6
- `@thinksys/react-native-mediapipe`: ^0.0.19 (Pose detection — patched via `patch-package`)
- `expo-av`: ~15.1.7 (Audio playback for TTS)
- `expo-file-system`: ~18.1.11 (Temp file storage for TTS audio)
- `expo-build-properties`: ~0.14.0 (iOS JSC engine override, Android SDK targets)
- Navigation: `@react-navigation/native` ^7, `native-stack` ^7, `bottom-tabs` ^7
- See **docs/EXPO-53-16KB-UPGRADE.md** for the full upgrade and local steps.

## 3. iOS Native Modules & Permissions
### Modules included in iOS build
| Module | Purpose | iOS-specific config |
|--------|---------|---------------------|
| `@thinksys/react-native-mediapipe` | Pose detection + camera | `NSCameraUsageDescription` in Info.plist |
| `expo-av` | TTS audio playback | `playsInSilentModeIOS`, `interruptionModeIOS: MixWithOthers` |
| `expo-file-system` | Temp file I/O for TTS audio cache | None |
| `expo-font` | Custom fonts (Inter, JetBrains Mono) | None |
| `expo-blur` | UI blur effects | None |
| `expo-linear-gradient` | UI gradients | None |
| `react-native-gesture-handler` | Touch/gesture handling | None |
| `react-native-screens` | Native screen containers | None |
| `react-native-safe-area-context` | Safe area insets | None |
| `react-native-svg` | SVG rendering | None |

### iOS permissions (Info.plist)
- `NSCameraUsageDescription` — Required for MediaPipe pose detection
- No microphone permission (`expo-av` is playback-only, `allowsRecordingIOS: false`)

### Removed dependencies (iOS crash fix)
These caused iOS crashes ("Cannot read property 'S' of undefined"):
- `react-native-reanimated` — not used in app code
- `react-native-worklets-core` — not used in app code
- Corresponding Babel plugins removed from `babel.config.js`

## 4. MediaPipe Integration
We use `@thinksys/react-native-mediapipe` with callback-based landmark data.
- `RNMediapipe` component handles camera + pose detection internally
- Landmark data received via `onLandmark` callback (not frame processors/worklets)
- Detection confidence lowered to 0.35 (from 0.5) for better side-on detection
- Android-specific patches applied via `patch-package` (see `patches/` directory)

```typescript
const handleLandmark = useCallback((data: any) => {
  const keypoints = convertLandmarksToKeypoints(data);
  if (!keypoints) return;
  const result = updateBarbellCurlState(keypoints, stateRef.current);
  setRepCount(result.repCount);
  setCurrentFormScore(result.formScore);
}, []);
```

## 5. Animations
Use React Native's built-in `Animated` API ONLY (NOT Reanimated):
```typescript
import { Animated } from 'react-native';
```

## 6. iOS Build Constraints (CRITICAL)

### Why iOS uses JSC, not Hermes
RN 0.79.x has a `jsinspector-modern` bug where `LOG(FATAL)` fires on WebSocket reconnection failure, causing `abort()` in iOS debug builds. Workaround: iOS uses JSC via `expo-build-properties`. Do NOT change `jsEngine` back to Hermes until the upstream RN fix is confirmed.

Config location: `app.json` → `plugins` → `expo-build-properties` → `ios.jsEngine: "jsc"`

### Rules for cross-platform safety
1. **Never assume Hermes globals on iOS.** `btoa()`, `atob()` are Hermes built-ins but NOT guaranteed on JSC. `FileReader.readAsDataURL()` **hangs indefinitely on JSC with binary blobs** — do NOT use it for audio/binary data. Instead use `response.arrayBuffer()` + a pure-JS base64 encoder (see `uint8ArrayToBase64` in `elevenlabsTTS.ts`). If you must use `btoa`, add a runtime guard: `if (typeof btoa === 'undefined') throw new Error(...)`.
2. **Never mix ESM and CJS in config files.** Expo evaluates `app.config.js`, `babel.config.js`, `metro.config.js` as CommonJS. Using `import` statements will cause a SyntaxError that blocks ALL native builds. Always use `require()` / `module.exports`.
3. **Never add a native dependency without checking iOS impact.** Every package with native code adds pods to the iOS build. Before adding:
   - Verify it has an Expo config plugin or supports autolinking
   - Run `npx expo prebuild --platform ios --clean` to verify pod install succeeds
   - Check if it requires additional Info.plist entries
   - If it's not actually imported in code, don't add it — dead native deps bloat the binary and risk pod conflicts
4. **Audio must not interrupt the camera.** Any audio playback (TTS, sound effects) must set `interruptionModeIOS: 1` (MixWithOthers) in `Audio.setAudioModeAsync()`. The default `DoNotMix` will interrupt the AVCaptureSession used by MediaPipe.
5. **Test iOS in Release mode.** Due to the jsinspector bug, iOS debug builds may crash. Always verify with: `npx expo run:ios --configuration Release`
6. **Patches in `patches/` may touch iOS native code.** The MediaPipe patch modifies `DefaultConstants.swift` (confidence thresholds). When updating `@thinksys/react-native-mediapipe`, re-verify the patch applies cleanly on both platforms.

## 7. Android Development — iOS Guard Rails

When working on Android-specific features:

### Before writing code
- Check if the feature touches shared files (`src/`, `App.tsx`, `package.json`, config files)
- If it does, every change must work on both JSC (iOS) and Hermes (Android)

### Dependency checklist
- [ ] Is the package actually imported in source code? (Don't add unused deps)
- [ ] Does it require `EXPO_PUBLIC_` env vars? (These are bundled into the client JS — security risk for API keys)
- [ ] Does it add iOS native modules? Check with `npx expo prebuild --platform ios`
- [ ] Is the version compatible with Expo SDK 53? Run `npx expo install --fix`

### API and runtime checklist
- [ ] No `btoa()` / `atob()` calls — use `arrayBuffer()` + pure-JS base64 encoder (see `elevenlabsTTS.ts`). Do NOT use `FileReader.readAsDataURL()` for binary data (hangs on JSC).
- [ ] No CSS patterns that don't work in React Native (e.g., `left: '50%'` with `marginLeft` for centering)
- [ ] `Platform.OS` checks where behavior diverges (audio config, permissions, etc.)
- [ ] Config files use CJS only (`require` / `module.exports`, never `import`)

### Before submitting a PR
- [ ] `npx expo config` runs without error
- [ ] `npx expo prebuild --platform ios --clean` succeeds
- [ ] No debug overlays visible without `__DEV__` gate
- [ ] TypeScript compiles clean (`npx tsc --noEmit`)

## 8. React Native Best Practices

### Performance (real-time CV app)
- Avoid unnecessary re-renders — use `useCallback`, `useMemo`, refs for non-UI state
- Avoid allocations in hot paths — use `.push()` not spread (`[...arr, item]`), prefer mutation on refs
- Use `InteractionManager.runAfterInteractions()` to defer non-critical UI updates
- Throttle high-frequency updates (pose data at 30fps, UI updates at ~10fps)
- Keep heavy computation out of the render cycle — use refs + `InteractionManager`

### React Hooks — Rules & Pitfalls
- **Never place hooks (`useCallback`, `useMemo`, `useState`, etc.) inside `.map()` or any loop/conditional.** This violates React's rules of hooks and causes "Rendered fewer/more hooks than expected" crashes.
- **Never `return null` (early return) before all hooks have executed.** If a component conditionally hides itself (e.g., `if (hideTabBar) return null`), the early return MUST come AFTER all hooks (including any inside `.map()` loops). Use `display: 'none'` or render to a hidden state instead, OR move the early return below the hook calls.
- When refactoring a component that uses `display: 'none'` to hide, do NOT convert it to an early `return null` unless you verify no hooks follow the return point.

### State management
- React hooks + context (no Redux or heavy state libs)
- Use refs (`useRef`) for values that change frequently but don't need re-renders (frame data, accumulators)
- Use state (`useState`) only for values that drive UI updates
- Single source of truth — don't derive the same value from multiple refs/state

### Styling
- Use `StyleSheet.create()` — not inline objects (avoids re-allocation on every render)
- Reference `COLORS` from `src/frontend/constants/theme.ts` — no hardcoded color values
- Use `alignSelf: 'center'` or `Dimensions` for centering — not CSS `left: '50%'` hacks
- Percentage-based positioning in RN is relative to parent, not viewport

### Native modules
- Wrap native module imports in `try/catch` when the module may not be available (e.g., TTS in Expo Go)
- Use dynamic `require()` for optional native modules, with a `nativeModulesAvailable` flag
- Set `allowsRecordingIOS: false` unless recording is needed — prevents unnecessary permission prompts
- Always configure `interruptionModeIOS` explicitly when using `expo-av`

### File and config conventions
- All config files (`app.config.js`, `babel.config.js`, `metro.config.js`) — CJS only
- Environment variables with `EXPO_PUBLIC_` prefix are bundled into client JS — never use for secrets in production
- `app.json` is the source of truth for native config. `app.config.js` only wraps it with env var loading.

### Code quality
- TypeScript strict mode — use `Record<K, V>` not `{ [key: K]: V }` for mapped types
- Gate debug UI behind `__DEV__` — never ship debug overlays to users
- Keep heuristics/math logic in `src/utils/` separate from UI in `src/frontend/screens/`
- Feedback auto-clear should happen in ONE place (React `useEffect` timer), not duplicated in both business logic and UI

## 9. Project Structure — Frontend / Backend Separation

The codebase is split so frontend (UI) and backend (data/services) can be developed on **separate branches with zero file overlap**. This is enforced by folder structure and import rules.

```
Forma-MediaPipe/
  src/
    frontend/                    # ── UI layer (screens, components, styling) ──
      app/                       # Navigation (RootNavigator)
      assets/                    # Images, icons, SVGs
      components/                # Reusable UI (GlassTabBar, SetNotesModal, etc.)
        ui/
        typography/
        icons/
      constants/                 # Theme, colors, fonts, spacing
      contexts/                  # UI-only state (CurrentWorkout, CameraSettings, Scroll)
      screens/                   # All screen components
    backend/                     # ── Data layer (API, services, auth) ──
      contexts/                  # Auth state (AuthContext wraps Supabase)
      hooks/                     # Public API for frontend (useWorkouts, useSaveWorkout, etc.)
      services/                  # Internal implementation
        api/                     # Service layer + types (mock ↔ Supabase swap)
        supabase/                # Supabase client + auth helpers
        mock/                    # Mock data for development
        (ttsCoach, elevenlabsTTS, etc.)
    utils/                       # Shared pure logic (heuristics, pose analysis)
  patches/                       # patch-package patches for native deps
  scripts/                       # Post-install scripts for MediaPipe patches
  docs/                          # Technical documentation
```

### Import boundary rules (CRITICAL)

These rules exist to prevent merge conflicts between frontend and backend branches. **Never violate them.**

1. **Screens and components MUST NOT import directly from `backend/services/`.** All data access goes through `backend/hooks/` (e.g. `useSaveWorkout`, `useWorkouts`). The one exception is importing **types** from `backend/services/api` (e.g. `WorkoutSession`, `Exercise`) for prop typing.
2. **Backend files (`hooks/`, `services/`, `backend/contexts/`) MUST NOT import from `frontend/`.** Data flows one way: backend exposes hooks → frontend consumes them.
3. **`utils/` is shared** — both frontend and backend may import from it. Utils must contain only pure logic (no React, no service calls, no side effects).
4. **`frontend/contexts/`** holds UI-only state (CurrentWorkout, CameraSettings, Scroll) with no service imports. **`backend/contexts/`** holds auth state that wraps Supabase.
5. **When adding a new data feature:**
   - Add the service method in `backend/services/api/`
   - Create a hook in `backend/hooks/` that wraps it
   - Export from `backend/hooks/index.ts`
   - Import the hook in the screen — never the service directly
6. **When adding a new screen or UI component:** only touch files under `frontend/`. If it needs data, import an existing hook from `backend/hooks/`.
7. **CameraScreen exception:** CameraScreen imports `backend/services/ttsCoach` directly for real-time TTS coaching. This is acceptable due to performance requirements (fire-and-forget calls at 30fps). Do not use this as precedent for other screens.

## 10. How to Run
```bash
npm install
npx expo prebuild --clean
npx expo run:android          # Android
npx expo run:ios --configuration Release  # iOS (Release to avoid jsinspector bug)
# or
npx expo start --dev-client
```

## 11. Pose & Form Analysis
- Fixed set of joint angles computed per frame
- Rep counting via dual-arm FSM with two-arm synchronization
- Signal smoothing: median filter (5-sample window) + EMA
- Sagittal plane projection for angle calculations
- Form feedback derived ONLY from angles + temporal behavior
- Everything must be explicit, named, and explainable — no opaque magic

## 12. TTS Coaching System

### Philosophy: Visual vs Voice Feedback
- **Visual feedback** (on-screen text, SetNotesModal): detailed, every rep, all issues. Unchanged.
- **TTS voice feedback** (ElevenLabs): coach-like, selective, one issue max per rep. Separate layer.
- The two systems are independent — visual is driven by `feedback` state, TTS by `ttsCoach.ts`.

### Architecture
```
ExerciseDefinition.update()  →  CameraScreen.tsx  →  ttsCoach.ts  →  elevenlabsTTS.ts
(produces ExerciseState)        (calls onRepCompleted)  (decides what/when)  (plays audio)
```

### Key files
- `src/backend/services/ttsCoach.ts` — coaching engine (state, throttling, playback coordination)
- `src/backend/services/ttsMessagePools.ts` — message pools, priority map, feedback-to-issue mapping
- `src/backend/services/elevenlabsTTS.ts` — low-level ElevenLabs API + audio playback (unchanged)

### Priority system
- Each visual feedback message maps to an `IssueType` via `FEEDBACK_TO_ISSUE`
- Each `IssueType` has a priority value (= its penalty from heuristics: 30, 25, 15, or 10)
- When a rep has multiple issues, TTS speaks only the highest-priority one
- Visual feedback still shows all issues

### Message pools
- Each `IssueType` has a pool of 3-4 short, coach-like voice lines
- Positive feedback has two pools: `positive` (streaks) and `transition_good` (bad→good)
- Pool selection uses shuffle-bag: random pick, never repeat the last-used message

### When TTS speaks
| Scenario | Speak? | What |
|---|---|---|
| Rep has issues | Yes (if not already speaking) | Highest-priority issue from pool |
| Clean rep after bad rep(s) | Yes | Random from `transition_good` pool |
| Clean rep, streak hits adaptive interval | Yes | Random from `positive` pool |
| Clean rep, streak hasn't hit interval | No | — |
| Set ends (stop recording) | Yes (waits for current speech) | Dynamic set summary |

### Adaptive praise interval
- Starts at every 2 clean reps
- After 4 consecutive clean: every 3
- After 8 consecutive clean: every 4
- Resets to 2 when a bad rep breaks the streak

### Audio overlap rules
- If TTS is currently speaking, new per-rep messages are **dropped** (no interrupt, no queue)
- Set summary **waits** (up to 3s) for current speech to finish before speaking
- Voice lines are kept short (<1.5s) to minimize overlap risk

### Adding a new exercise's TTS feedback
TTS config is declared in the exercise's `ExerciseDefinition.ttsConfig` and merged into the global maps automatically at registration time. See section 14 for the full exercise creation guide. No changes needed in `ttsCoach.ts` or `ttsMessagePools.ts` — both are exercise-agnostic.

## 13. Scoring System — Continuous Penalty Curves

### Philosophy
- **Visual feedback** (messages) uses discrete thresholds — unchanged
- **Numeric score** uses continuous quadratic penalty curves — small errors produce small but real drops
- A perfect 100 is rare and earned; a "pretty good" rep scores 85-93

### Rep Score: `computeRepScore()` in barbell curl definition
Five penalty categories, each `min(cap, scale × max(0, x − deadzone)²)`:

| Category | Max Penalty | Deadzone | Scale | Key Input |
|---|---|---|---|---|
| Torso swing | 35 | 3° | 0.55 | midline torso delta |
| Shoulder movement | 30 | 10° | 0.018 | max shoulder delta (L/R) |
| ROM shortfall | 35 | flex: 50°, ext: 140° | 0.03 each | min flex angle, max ext angle |
| Tempo | 20 | up: 0.4s, down: 0.5s | 60/40 | concentric/eccentric time |
| Asymmetry | 15 | 0 | 0.005/0.004 | min-angle diff, ROM diff |

**Max total penalty:** 135 → worst possible rep = 0.

### Set Score: Weighted Average in `CameraScreen.tsx`
Bad reps weigh more: `weight = 1 + (100 − score) / 50` (range [1, 3]).
A score-100 rep has weight 1; a score-0 rep has weight 3.

### Rules for Modifying
- **Never change message thresholds** when tuning scores — they are independent
- When recalibrating, adjust `scale` or `deadzone`, not the formula shape
- Test with: clean rep → 95-100, slightly sloppy → 85-93, obvious cheat → 50-70, terrible → 0-30

## 14. Adding a New Exercise

All exercise logic lives under `src/utils/exercises/`. CameraScreen is exercise-agnostic — it uses the `ExerciseRegistry` to look up the active exercise by name and delegates all processing to the definition's `update()` function. **No changes to CameraScreen are required when adding a new exercise.**

### File structure

```
src/utils/exercises/
  types.ts                    # ExerciseState, RepResult, ExerciseDefinition interfaces
  ExerciseRegistry.ts         # Registry singleton (register/get/has/list)
  index.ts                    # Public re-exports
  shared/                     # Reusable primitives
    SmoothedAngleTracker.ts   # Median filter + EMA smoothing
    WarmupGate.ts             # Visibility-based stability gate
    scoring.ts                # computePenalty() + computeScore()
    RepWindowTracker.ts       # Min/max/delta accumulator for rep windows
  definitions/                # One file per exercise
    barbellCurl.ts            # Barbell curl definition
    pushup.ts                 # Push-up definition
    register.ts               # Imports all definitions and registers them
```

### Step-by-step: adding a new exercise

**1. Create the definition file** at `src/utils/exercises/definitions/<exerciseName>.ts`

Export a single `ExerciseDefinition` object. All internal types, constants, and functions must be **module-private** (not exported). Example skeleton:

```typescript
import type { Keypoint } from '../../poseAnalysis';
import type { ExerciseDefinition, ExerciseState } from '../types';

// -- All types, constants, helpers are private to this module --
interface MyExerciseState { /* ... */ }
function initializeState(): MyExerciseState { /* ... */ }
function updateState(keypoints: Keypoint[], state: MyExerciseState): MyExerciseState { /* ... */ }

export const myExerciseDefinition: ExerciseDefinition = {
  name: 'My Exercise',           // Must match the exercise name from the route
  requiredView: 'side',          // 'front' | 'side' | 'any'
  createState: () => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: initializeState(),
  }),
  update: (keypoints, currentState) => {
    const internal = currentState._internal as MyExerciseState;
    const newInternal = updateState(keypoints, internal);
    // Map internal state to framework ExerciseState
    return {
      repCount: newInternal.repCount,
      lastRepResult: /* map to { repIndex, score, messages } or null */,
      feedback: newInternal.feedback,
      feedbackTimestamp: newInternal.feedbackTimestamp,
      debugInfo: /* cast internal debug info to Record<string, unknown> */,
      _internal: newInternal,
    };
  },
  ttsConfig: {
    feedbackToIssue: {
      // Map each visual feedback string → issue type
      'Your feedback message here.': 'issue_type',
    },
    // Optional: define new issue types with TTS voice pools
    issueDefinitions: [
      { issueType: 'my_new_issue', priority: 25, messages: ['Short coach cue 1.', 'Short coach cue 2.'] },
    ],
  },
  summaryConfig: {
    // Map each visual feedback string → improvement suggestion for set summary
    'Your feedback message here.': 'Explanation of how to improve.',
  },
};
```

**2. Register the definition** in `src/utils/exercises/definitions/register.ts`:

```typescript
import { myExerciseDefinition } from './myExercise';
// ... at the bottom:
registerExercise(myExerciseDefinition);
```

That's it. The `registerExercise()` helper handles:
- Adding the definition to `ExerciseRegistry`
- Merging `ttsConfig` into the global `FEEDBACK_TO_ISSUE`, `ISSUE_POOLS`, and `ISSUE_PRIORITY` maps
- Merging `summaryConfig` into the global `FEEDBACK_TO_IMPROVEMENT` map

**3. (Optional) Add debug UI** in `CameraScreen.tsx`

If you want a debug overlay for the new exercise, add a conditional JSX block in the debug UI section (search for "Debug" in CameraScreen). Read from the generic `exerciseDebug` state and cast via `as any`:

```tsx
{exerciseNameFromRoute === 'My Exercise' && debugMode && exerciseDebug && (() => {
  const d = exerciseDebug as any;
  return (<View>...</View>);
})()}
```

### Rules

- **One export per definition file** — only the `ExerciseDefinition` object. Everything else is private.
- **Reuse shared primitives** from `exercises/shared/` (SmoothedAngleTracker, WarmupGate, scoring, RepWindowTracker) instead of reimplementing.
- **Reuse existing issue types** (e.g. `tempo_up`, `hip_sag`) when the feedback concept is the same. Only create new issue types for truly exercise-specific issues.
- **No changes to CameraScreen business logic.** The registry handles everything. Debug UI is the only exercise-specific code allowed in CameraScreen.
- **No changes to `ttsCoach.ts` or `ttsMessagePools.ts`.** TTS config is declared in the definition and merged at registration time.
- **`update()` must be pure and fast** — it runs at ~30fps. No async calls, no allocations in hot paths, prefer mutation on the internal state object.
- **The `name` field must match the route's `exerciseName` exactly.** CameraScreen looks up the definition by `ExerciseRegistry.get(exerciseNameFromRoute)`.

## 15. How Claude Should Help
- Prefer incremental changes over big refactors
- Explain reasoning when touching heuristics, thresholds, rep logic, or perf-sensitive code
- Ask before adding dependencies, changing architecture, or changing data models
- When debugging: hypothesise failure mode → propose logging → propose fix
- **Always verify changes won't break iOS native builds** before suggesting them
- When adding a new exercise: follow section 14. No changes to CameraScreen business logic, ttsCoach, or ttsMessagePools needed.
- **Always respect the frontend/backend boundary** — see section 9. Never add service imports to screens; create or use a hook instead.
