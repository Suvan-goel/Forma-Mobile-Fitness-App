# PRD: iOS Build Safety — Required Changes for PR #1

**Date:** 2026-02-13
**PR:** #1 — Barbell curl form analysis, TTS feedback, and Android camera fixes
**Priority:** P0 (merge-blocking)
**Author:** Product/Engineering Review

---

## 1. Problem Statement

PR #1 introduces ElevenLabs TTS (`elevenlabsTTS.ts`) which uses `btoa()` with a code comment stating it is "available in React Native with Hermes." However, our iOS build is explicitly configured to use **JSC (JavaScriptCore)**, not Hermes, due to a known RN 0.79.x `jsinspector-modern` bug that causes `abort()` crashes on iOS debug builds.

This creates a fragile dependency chain:
- `btoa()` is a Hermes built-in (added in RN 0.73+)
- JSC does **not** guarantee `btoa()` availability — it depends on the RN polyfill shim, which is an implementation detail that can change between RN versions
- The comment in the code is misleading and will confuse future developers
- If the polyfill is ever removed or breaks, iOS TTS will crash at runtime with a `ReferenceError`

Beyond `btoa`, there are **6 additional iOS build risks** discovered during review that must be resolved before this PR can be safely merged.

---

## 2. Current State

| Config | Value | Source |
|--------|-------|--------|
| iOS JS Engine | **JSC** | `app.json` → `expo-build-properties` → `ios.jsEngine: "jsc"` |
| Android JS Engine | **Hermes** (default) | Not overridden |
| React Native | **0.79.6** | `package.json` |
| Why not Hermes on iOS | RN 0.79 `jsinspector-modern` bug — `LOG(FATAL)` on WebSocket reconnection failure causes `abort()` in debug builds | Historical decision, documented in project |

**Key constraint:** We cannot switch iOS back to Hermes until the upstream RN inspector bug is fixed. All changes must work on JSC.

---

## 3. Required Changes (7 Items)

### 3.1 [P0 — BUILD BLOCKER] Fix `app.config.js` ESM/CJS Mixing

**File:** `Forma-MediaPipe/app.config.js` (new file in PR)

**Problem:** The file mixes ESM `import` with CJS `require`/`module.exports`:
```javascript
import 'dotenv/config';          // ESM — SyntaxError in CJS context
require('dotenv').config();       // CJS — redundant
const appJson = require('./app.json');
module.exports = { ...appJson };
```

Expo evaluates `app.config.js` as CommonJS. The `import` statement will cause a **SyntaxError** during `expo prebuild`, `expo start`, and all EAS builds — on **both** iOS and Android. This blocks all native builds entirely.

**Required change:**
```javascript
require('dotenv').config();
const appJson = require('./app.json');
module.exports = { ...appJson };
```

**Impact if not fixed:** No native build will succeed on either platform.

---

### 3.2 [P0 — RUNTIME CRASH RISK] Replace `btoa()` with `expo-file-system` Base64 Write

**File:** `Forma-MediaPipe/src/services/elevenlabsTTS.ts` — `generateSpeech()` function

**Problem:** The current implementation does a manual `Uint8Array → binaryString → btoa() → base64` conversion, then writes via `FileSystem.writeAsStringAsync` with base64 encoding. The `btoa()` call assumes Hermes, but iOS runs JSC.

While RN 0.79.x likely ships a `btoa` polyfill, this is:
1. **Undocumented behavior** — RN does not guarantee `btoa` on JSC
2. **Fragile** — a Metro bundler or RN version upgrade could remove the polyfill
3. **Misleading** — the comment says "available in React Native with Hermes" which is factually wrong for our iOS config
4. **Unnecessary** — `expo-file-system` already supports writing binary data directly

**Required change — Option A (Recommended): Use `FileSystem` blob write:**

`expo-file-system`'s `downloadAsync` can fetch and save directly to a file, eliminating the entire manual base64 pipeline:

```typescript
async function generateSpeech(text: string): Promise<string> {
  if (!nativeModulesAvailable || !FileSystem) {
    throw new Error('Native modules not available');
  }
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;
  const fileUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;

  const response = await FileSystem.downloadAsync(url, fileUri, {
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    // Note: downloadAsync uses GET by default.
    // If POST is required, use Option B instead.
  });

  if (response.status !== 200) {
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  return fileUri;
}
```

**Caveat:** `FileSystem.downloadAsync` only supports GET requests. ElevenLabs TTS endpoint requires POST. If POST is required, use Option B.

**Required change — Option B (Safe fallback): Use `expo-file-system` with `uploadAsync` or manual fetch + write:**

Keep the `fetch()` call but replace the `btoa` conversion with `FileSystem`-native encoding:

```typescript
// Fetch audio from ElevenLabs (POST required)
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Accept': 'audio/mpeg',
    'Content-Type': 'application/json',
    'xi-api-key': ELEVENLABS_API_KEY,
  },
  body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.6, similarity_boost: 0.65 } }),
});

if (!response.ok) {
  throw new Error(`ElevenLabs API error: ${response.status}`);
}

// Read response as blob, convert via FileReader (available in both Hermes and JSC)
const blob = await response.blob();
const fileUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;

const base64 = await new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => {
    // result is "data:audio/mpeg;base64,<data>" — strip the prefix
    const dataUrl = reader.result as string;
    const base64Data = dataUrl.split(',')[1];
    resolve(base64Data);
  };
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

await FileSystem.writeAsStringAsync(fileUri, base64, {
  encoding: FileSystem.EncodingType.Base64,
});

return fileUri;
```

**Why Option B is ve. It performs the base64 conversion internally without relying on `btoa`.
engine-safe:** `FileReader.readAsDataURL()` is a Web API available in both JSC and Hermes runtimes in React Nati
**Required change — Option C (Simplest, if polyfill is verified):**

If the team verifies `btoa` works on iOS JSC in RN 0.79.6, keep the current code but:
1. **Fix the misleading comment**: Change `// btoa is available in React Native with Hermes` to `// btoa is polyfilled by React Native's runtime (works on both Hermes and JSC)`
2. **Add a safety guard**:
```typescript
if (typeof btoa === 'undefined') {
  throw new Error('btoa is not available in this JS engine. See PRD-ios-build-safety-pr1.md for alternatives.');
}
```

**Recommendation:** Option B — it eliminates the `btoa` dependency entirely while keeping the POST request, and works identically on both engines with zero assumptions.

**Impact if not fixed:** TTS will crash on iOS with `ReferenceError: btoa is not defined` if the polyfill is missing.

---

### 3.3 [P1] Add `interruptionModeIOS` to Audio Session Config

**File:** `Forma-MediaPipe/src/services/elevenlabsTTS.ts` — `initializeAudio()`

**Problem:** The docs (`docs/elevenlabs-tts-setup.md`) claim `interruptionModeIOS: Audio.InterruptionModeIOS.MixWithOthers` is set, but the actual code omits it:

```typescript
// Current (missing interruptionModeIOS):
await Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  staysActiveInBackground: false,
  shouldDuckAndroid: true,
  playThroughEarpieceAndroid: false,
});
```

The default `interruptionModeIOS` is `DoNotMix`, which means TTS playback will **interrupt the AVCaptureSession** used by `react-native-mediapipe` for camera. On iOS, this could cause:
- Camera feed momentarily freezing during TTS
- Audio session reconfiguration conflicts
- Potential crash if the camera module doesn't handle session interruptions gracefully

**Required change:**
```typescript
await Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  interruptionModeIOS: 1, // InterruptionModeIOS.MixWithOthers
  staysActiveInBackground: false,
  shouldDuckAndroid: true,
  interruptionModeAndroid: 2, // InterruptionModeAndroid.DuckOthers
  playThroughEarpieceAndroid: false,
});
```

Note: Use numeric values (1 for MixWithOthers, 2 for DuckOthers) if the enum imports aren't available through the dynamic `require()` pattern. Alternatively, import the constants:
```typescript
const InterruptionModeIOS = { MixWithOthers: 1, DoNotMix: 2, DuckOthers: 3 };
const InterruptionModeAndroid = { DoNotMix: 1, DuckOthers: 2 };
```

**Impact if not fixed:** Camera may freeze or crash during TTS playback on iOS.

---

### 3.4 [P1] Remove Unused `expo-speech` Dependency

**File:** `Forma-MediaPipe/package.json`

**Problem:** `expo-speech` is added as a dependency but is **never imported** in any source file in the PR. It is only mentioned in documentation as a hypothetical fallback. This dependency:
- Adds the `AVSpeechSynthesizer` native module to the iOS build unnecessarily
- Increases binary size
- Adds a native module that must be maintained across SDK upgrades
- Could cause `pod install` conflicts

**Required change:** Remove from `package.json`:
```bash
npm uninstall expo-speech
```

If the team wants it as a future fallback, add it later when actually implementing the fallback code path.

**Impact if not fixed:** Unnecessary native code in iOS binary; potential pod conflicts.

---


**File:** `Forma-MediaPipe/src/screens/CameraScreen.tsx` — "Torso Swing Debug" overlay

**Problem:** A debug overlay showing raw torso angle values is rendered during recording for all users. This is development-only UI that should not ship.

**Required change:** Gate behind `__DEV__`:
```typescript
{__DEV__ && (
  <View style={styles.debugOverlay}>
    {/* torso swing debug info */}
  </View>
)}
```

Or remove entirely if no longer needed for development.

**Impact if not fixed:** Users see raw debug data during workouts.

---

### 3.6 [P2] Fix TypeScript Type Error in `angleHistory`

**File:** `Forma-MediaPipe/src/utils/barbellCurlHeuristics.ts`

**Problem:**
```typescript
angleHistory: { [key: keyof AngleSet]: number[] };
```
This is invalid TypeScript. `[key: keyof AngleSet]` is a mapped type syntax error — it silently becomes `{ [key: string]: number[] }`, losing all type safety.

**Required change:**
```typescript
angleHistory: Record<keyof AngleSet, number[]>;
```

**Impact if not fixed:** No runtime impact, but TypeScript won't catch incorrect angle keys.

---

### 3.7 [P3] Verify `NSCameraUsageDescription` Sufficiency for `expo-av`

**File:** `Forma-MediaPipe/app.json` — `infoPlist`

**Problem:** Adding `expo-av` introduces audio capabilities. While the current code sets `allowsRecordingIOS: false`, iOS requires `NSMicrophoneUsageDescription` if **any** code path could request microphone access. Currently safe, but a latent risk if `expo-av`'s config plugin auto-adds the permission.

**Required action:** After `expo prebuild --platform ios`, verify that `Info.plist` does NOT contain `NSMicrophoneUsageDescription` (since we don't use the mic). If it does, add a config plugin to explicitly remove it:
```json
["expo-av", { "microphonePermission": false }]
```

**Impact if not fixed:** App Store review may flag an unnecessary microphone permission string.

---

## 4. Verification Plan

After making the above changes, verify iOS build safety with:

| Step | Command | Expected |
|------|---------|----------|
| 1. Config loads | `npx expo config` | No SyntaxError, JSON output shows correct config |
| 2. Prebuild succeeds | `npx expo prebuild --platform ios --clean` | Exits 0, generates `ios/` directory |
| 3. Pod install succeeds | `cd ios && pod install` | No conflicts, no missing pods |
| 4. Xcode build | `npx expo run:ios --configuration Release` | Build succeeds (Release mode to avoid jsinspector bug) |
| 5. TTS runtime test | Perform a barbell curl rep with ElevenLabs key configured | Audio plays without camera freeze |
| 6. TTS without key | Remove API key from `.env`, perform a rep | No crash, graceful silence |
| 7. TTS without native modules | Use Expo Go (no native modules) | No crash, console warning |

---

## 5. Summary

| # | Change | Priority | Risk if Skipped | Effort |
|---|--------|----------|-----------------|--------|
| 3.1 | Fix `app.config.js` ESM/CJS | **P0** | All builds fail | 1 line |
| 3.2 | Replace `btoa()` with engine-safe approach | **P0** | iOS TTS crash | ~20 lines |
| 3.3 | Add `interruptionModeIOS: MixWithOthers` | **P1** | Camera freeze during TTS on iOS | 2 lines |
| 3.4 | Remove unused `expo-speech` | **P1** | Unnecessary native module in build | 1 command |
| 3.5 | Gate debug overlay behind `__DEV__` | **P2** | Users see debug data | 2 lines |
| 3.6 | Fix `angleHistory` TypeScript type | **P2** | Lost type safety | 1 line |
| 3.7 | Verify no unwanted iOS permissions | **P3** | Potential App Store flag | Verification only |

**Merge recommendation:** Block merge until P0 and P1 items are resolved. P2/P3 can be addressed in a follow-up if needed.
