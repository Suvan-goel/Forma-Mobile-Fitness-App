# Forma Mobile - Project Context & Constraints

## 1. Architecture & Versions
- **React Native 0.79.6** / **Expo SDK 53** (Managed Workflow) / **New Arch: disabled**
- **iOS JS Engine: JSC** (NOT Hermes — see §5) / **Android: Hermes**
- React 19.0.0, Navigation v7 (`native-stack`, `bottom-tabs`)
- `expo-pose-detection`: local module at `modules/expo-pose-detection/`
- `expo-av` ~15.1.7, `expo-file-system` ~18.1.11, `expo-build-properties` ~0.14.0
- Animations: `Animated` from `react-native` ONLY — **never Reanimated** (removed, caused iOS crashes)
- Canonical versions in `package.json`, align with `npx expo install --fix`

## 2. How to Run
```bash
npm install
npx expo run:android                          # Android
npm run prebuild:ios                          # iOS prebuild (ALWAYS use this)
npx expo run:ios --configuration Release      # iOS run (Release mode required)
```
**Never run `npx expo prebuild --platform ios --clean` directly** — it writes `hermes` to `Podfile.properties.json`. `npm run prebuild:ios` runs prebuild + `scripts/fix-ios-jsc.js` (patches to `jsc`) + pod install.

## 3. iOS Constraints (CRITICAL)

**Why JSC:** RN 0.79.x `jsinspector-modern` bug — `LOG(FATAL)` on WebSocket reconnection causes `abort()` with Hermes. Don't switch back until upstream fix is confirmed.

### Cross-platform rules
1. **No Hermes globals on iOS.** `btoa()`/`atob()` not guaranteed on JSC. `FileReader.readAsDataURL()` **hangs on JSC with binary blobs**. Use `response.arrayBuffer()` + pure-JS base64 (see `uint8ArrayToBase64` in `elevenlabsTTS.ts`).
2. **Config files are CJS only.** `app.config.js`, `babel.config.js`, `metro.config.js` — always `require()`/`module.exports`, never `import`.
3. **Check iOS impact before adding native deps.** Verify autolinking, run `npm run prebuild:ios`, check Info.plist needs. Don't add deps not imported in code.
4. **Audio must not interrupt camera.** Always set `interruptionModeIOS: 1` (MixWithOthers) in `Audio.setAudioModeAsync()`.
5. **Test iOS in Release mode.** Debug builds may crash due to jsinspector bug.
6. **Patches in `patches/` touch native code.** Re-verify after updating patched packages.

### iOS permissions
- `NSCameraUsageDescription` (MediaPipe). No microphone (`allowsRecordingIOS: false`).

### Removed deps (caused iOS crashes)
- `react-native-reanimated`, `react-native-worklets-core` — not used, removed from code and `babel.config.js`.

## 4. Android → iOS Guard Rails

Before writing code touching shared files (`src/`, `App.tsx`, `package.json`, configs): every change must work on both JSC and Hermes.

**Checklist:**
- [ ] Package actually imported in source? Don't add unused deps
- [ ] No `btoa()`/`atob()`/`FileReader.readAsDataURL()` — use `arrayBuffer()` + pure-JS base64
- [ ] No CSS hacks (`left: '50%'` + `marginLeft`) — use `alignSelf: 'center'` or `Dimensions`
- [ ] `Platform.OS` checks where behavior diverges
- [ ] Config files CJS only
- [ ] `npx expo config` runs clean
- [ ] `npm run prebuild:ios` succeeds
- [ ] Debug overlays gated behind `__DEV__`
- [ ] `npx tsc --noEmit` passes

## 5. MediaPipe Integration
- Local module `expo-pose-detection` at `modules/expo-pose-detection/`
- `PoseDetectionView` handles camera + detection; landmarks via `onLandmark` callback
- Detection confidence: 0.35 (lowered for side-on detection)
- Android patches via `patch-package` (see `patches/`)

## 6. Project Structure & Import Boundaries

```
src/
  frontend/          # UI: screens/, components/, constants/, contexts/ (UI-only state), assets/
  backend/           # Data: contexts/ (auth), hooks/ (public API), services/ (internal)
  utils/             # Shared pure logic (heuristics, pose analysis)
patches/             # patch-package patches
scripts/             # Post-install & build scripts
```

### Import rules (CRITICAL — prevents merge conflicts between frontend/backend branches)
1. **Screens/components → `backend/hooks/` only.** Never import from `backend/services/` directly (exception: **types** from `backend/services/api` for prop typing).
2. **Backend → never imports from `frontend/`.** One-way flow: backend hooks → frontend consumes.
3. **`utils/` is shared.** Pure logic only — no React, no services, no side effects.
4. **New data feature:** service in `backend/services/api/` → hook in `backend/hooks/` → export from `backend/hooks/index.ts` → screen imports hook.
5. **New screen/component:** only touch `frontend/`. Use existing hooks for data.
6. **CameraScreen exception:** imports `ttsCoach` directly (perf requirement, 30fps). Not precedent for other screens.

## 7. React Native Best Practices

### Performance (real-time CV at 30fps)
- `useCallback`, `useMemo`, refs for non-UI state. Throttle UI updates to ~10fps.
- Hot paths: `.push()` not spread, mutation on refs, no allocations. Use `InteractionManager.runAfterInteractions()` for deferred work.

### Hooks pitfalls
- **Never hooks inside `.map()` or conditionals** — causes "Rendered fewer/more hooks" crashes.
- **Never `return null` before all hooks execute.** Use `display: 'none'` or move return below hooks.

### State & Styling
- Hooks + context only (no Redux). `useRef` for frequent non-UI values, `useState` for UI-driving values.
- `StyleSheet.create()` always. Colors from `src/frontend/constants/theme.ts`. No inline style objects.

### Native modules
- Wrap optional native imports in `try/catch` with `nativeModulesAvailable` flag.
- Always set `interruptionModeIOS` explicitly, `allowsRecordingIOS: false` unless recording needed.

### Conventions
- Config files: CJS only. `app.json` is source of truth for native config.
- `EXPO_PUBLIC_` vars are bundled into client JS — never use for secrets in production.
- TypeScript strict. Debug UI behind `__DEV__`. Heuristics in `utils/`, UI in `frontend/screens/`.

## 8. TTS Coaching System

**Two independent feedback layers:**
- **Visual:** detailed, every rep, all issues (driven by `feedback` state)
- **Voice (TTS):** coach-like, selective, max one issue per rep (driven by `ttsCoach.ts`)

**Flow:** `ExerciseDefinition.update()` → `CameraScreen` → `ttsCoach.ts` → `elevenlabsTTS.ts`

**Key files:** `ttsCoach.ts` (engine), `ttsMessagePools.ts` (pools/priorities), `elevenlabsTTS.ts` (API/playback)

### Behavior
- Multiple issues → TTS speaks highest-priority only (priority = penalty value: 35/30/25/15/10)
- Each `IssueType` has 3-4 short voice lines; shuffle-bag selection, never repeat last
- Positive pools: `positive` (streaks) and `transition_good` (bad→good transition)
- **Adaptive praise interval:** every 2 clean reps → every 3 (after 4 clean) → every 4 (after 8 clean); resets on bad rep
- **Overlap:** if speaking, new per-rep messages are **dropped**. Set summary **waits** up to 3s.
- TTS config declared per-exercise in `ExerciseDefinition.ttsConfig`, auto-merged at registration. **No changes to `ttsCoach.ts` or `ttsMessagePools.ts` needed.**

## 9. Scoring System

- **Visual feedback:** discrete thresholds. **Numeric score:** continuous quadratic penalty `min(cap, scale × max(0, x − deadzone)²)`.
- Target ranges: clean 95-100, sloppy 85-93, obvious cheat 50-70, terrible 0-30.
- Set score: weighted average where bad reps weigh more (`weight = 1 + (100 − score) / 50`).
- **Never change message thresholds when tuning scores** — they are independent. Adjust `scale`/`deadzone`, not formula shape.

## 10. Adding a New Exercise

All logic in `src/utils/exercises/`. CameraScreen is exercise-agnostic via `ExerciseRegistry`.

```
src/utils/exercises/
  types.ts, ExerciseRegistry.ts, index.ts
  shared/    # SmoothedAngleTracker, WarmupGate, scoring, RepWindowTracker
  definitions/
    <exerciseName>.ts   # One file per exercise
    register.ts         # Imports & registers all definitions
```

### Steps
1. **Create** `definitions/<exerciseName>.ts` — export one `ExerciseDefinition` (name must match route's `exerciseName`). All internals module-private. Include `ttsConfig` and `summaryConfig`.
2. **Register** in `definitions/register.ts`: `import` + `registerExercise()`. This auto-merges TTS/summary config into global maps.
3. **(Optional)** Add debug UI in CameraScreen (the only exercise-specific code allowed there).

### Rules
- One export per file. Reuse `shared/` primitives. Reuse existing issue types when concept matches.
- **No changes to CameraScreen logic, `ttsCoach.ts`, or `ttsMessagePools.ts`.**
- `update()` must be pure and fast (30fps) — no async, no allocations in hot paths, prefer mutation.

## 11. How Claude Should Help
- Incremental changes over big refactors
- Explain reasoning for heuristic/threshold/perf changes
- Ask before adding deps, changing architecture, or changing data models
- Debug approach: hypothesize → propose logging → propose fix
- **Always verify iOS build safety** before suggesting changes
- **Always respect frontend/backend import boundaries** (§6)
