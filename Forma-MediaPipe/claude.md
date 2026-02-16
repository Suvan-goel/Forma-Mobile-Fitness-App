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
- Reference `COLORS` from `src/constants/theme.ts` — no hardcoded color values
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
- Keep heuristics/math logic in `src/utils/` separate from UI in `src/screens/`
- Feedback auto-clear should happen in ONE place (React `useEffect` timer), not duplicated in both business logic and UI

## 9. Project Structure
```
Forma-MediaPipe/
  src/
    screens/          # Screen components (CameraScreen, CurrentWorkoutScreen, etc.)
    components/ui/    # Reusable UI components (SetNotesModal, etc.)
    contexts/         # React contexts (CurrentWorkoutContext)
    services/         # External service integrations (elevenlabsTTS, feedbackTTS)
    services/api/     # API service layer (mock → Supabase migration planned)
    utils/            # Pure logic (barbellCurlHeuristics, poseAnalysis, setNotesSummary)
    constants/        # Theme, colors, config
    app/              # Navigation (RootNavigator)
  patches/            # patch-package patches for native deps
  scripts/            # Post-install scripts for MediaPipe patches
  docs/               # Technical documentation
```

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
barbellCurlHeuristics.ts  →  CameraScreen.tsx  →  ttsCoach.ts  →  elevenlabsTTS.ts
(produces RepResult)         (calls onRepCompleted)  (decides what/when)  (plays audio)
```

### Key files
- `src/services/ttsCoach.ts` — coaching engine (state, throttling, playback coordination)
- `src/services/ttsMessagePools.ts` — message pools, priority map, feedback-to-issue mapping
- `src/services/elevenlabsTTS.ts` — low-level ElevenLabs API + audio playback (unchanged)

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
1. Add the exercise's visual feedback strings to `FEEDBACK_TO_ISSUE` in `ttsMessagePools.ts`
2. Reuse existing `IssueType`s where applicable (e.g. `tempo_up`, `torso_warn`)
3. Add new `IssueType`s + pools only for exercise-specific issues
4. No changes needed in `ttsCoach.ts` — it's exercise-agnostic

## 13. Scoring System — Continuous Penalty Curves

### Philosophy
- **Visual feedback** (messages) uses discrete thresholds — unchanged
- **Numeric score** uses continuous quadratic penalty curves — small errors produce small but real drops
- A perfect 100 is rare and earned; a "pretty good" rep scores 85-93

### Rep Score: `computeRepScore()` in `barbellCurlHeuristics.ts`
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

## 14. How Claude Should Help
- Prefer incremental changes over big refactors
- Explain reasoning when touching heuristics, thresholds, rep logic, or perf-sensitive code
- Ask before adding dependencies, changing architecture, or changing data models
- When debugging: hypothesise failure mode → propose logging → propose fix
- **Always verify changes won't break iOS native builds** before suggesting them
- When adding TTS for a new exercise: add to `ttsMessagePools.ts` only, don't modify `ttsCoach.ts`
