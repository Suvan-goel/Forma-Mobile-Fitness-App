# PRD: Forma iOS MediaPipe Fix

**Document Version:** 1.3
**Date:** 2026-02-03
**Status:** Phase 2 In Progress - JSC Fix Attempted, Still Crashing

## CONTEXT FOR CONTINUATION

**Crash log analyzed:** `/Users/mohammadallahham/Downloads/forma-2026-02-03-021308.ips`

### Summary of Work Done
1. **Phase 1 Complete:** Removed unused `react-native-reanimated` and `react-native-worklets-core` - fixed build errors
2. **Phase 2 Diagnosis:**
   - MediaPipe disabled → Still crashes → MediaPipe NOT the cause
   - Hermes disabled (JSC) → Still crashes → Previous attempt had stale Hermes framework
   - Analyzed crash log (`forma-2026-02-02-192030.ips`) → Found Hermes was still bundled
   - Did complete clean rebuild with JSC → Still crashes (new log at path above)
   - **Analyzed new crash log (forma-2026-02-03-021308.ips) → ROOT CAUSE FOUND**
3. **Current State:**
   - iOS builds successfully in Xcode
   - Metro bundles successfully
   - **ROOT CAUSE IDENTIFIED:** React Native Inspector WebSocket crash
   - Android works fine (no regression)

### Root Cause Analysis (forma-2026-02-03-021308.ips)
**Confirmed:** JSC is now being used (no Hermes in usedImages, JavaScriptCore.framework present)

**Crash Stack:**
```
abort()
google::LogDestination::LogToSinks  ← FATAL log triggered
google::LogMessage::~LogMessage
InspectorPackagerConnection::Impl::reconnect()  ← CRASH HERE
InspectorPackagerConnection::Impl::didFailWithError
RCTCxxInspectorWebSocketAdapter webSocket:didFailWithError:
SRWebSocket _failWithError:
```

**Root Cause:** The React Native JS Inspector (`jsinspector-modern`) crashes when:
1. App starts and inspector tries to connect to Metro via WebSocket
2. WebSocket connection fails (likely network/reachability issue)
3. `didFailWithError` triggers `reconnect()`
4. `reconnect()` calls `LOG(FATAL)` via glog → abort()

This is a **bug in React Native 0.79's inspector code** - it shouldn't use LOG(FATAL) for connection errors.

### Fix Applied
Disabled `EX_DEV_CLIENT_NETWORK_INSPECTOR` in `ios/Podfile.properties.json`:
```json
"EX_DEV_CLIENT_NETWORK_INSPECTOR": "false"
```

### Next Steps
1. **Clean rebuild required** to pick up the Podfile.properties.json change:
   ```bash
   cd ios && rm -rf Pods Podfile.lock && pod install && cd ..
   ```
2. **Rebuild in Xcode** and test on device
3. If still crashing, try **Release build** to bypass inspector entirely
4. If Release works, investigate patching the RN inspector or ensuring Metro is reachable

---

## 1. Problem Statement

### Original Problem (Resolved by Phase 1)
The Forma iOS app crashed at runtime with Hermes-related initialization errors:
```
TypeError: Cannot read property 'S' of undefined
TypeError: Cannot read property 'default' of undefined
```
These errors originated from `react-native-reanimated` and `react-native-worklets-core` initialization with Hermes.

### Current Problem (Post Phase 1)
After removing unused Reanimated and worklets-core dependencies:
- **iOS builds successfully** in Xcode with no native errors
- **Metro bundling completes** successfully
- **App crashes immediately** after bundle loads (instant crash, no UI displayed)
- **Android works correctly** - no regression

The original Reanimated errors are gone, but a new/different runtime crash occurs. The crash happens after JS bundle loads but before any UI renders.

**Android works correctly** and must not be affected by any fix.

---

## 2. Success Criteria

The iOS fix is considered complete when:

| Criterion | Verification | Status |
|-----------|--------------|--------|
| App launches on iOS physical device | No crash, no white screen | ❌ Crashes |
| Camera permission works | Can access device camera | ❌ Blocked by crash |
| MediaPipe pose detection runs | Pose landmarks detected and displayed | ❌ Blocked by crash |
| Android remains functional | Existing Android APK still works | ✅ Verified |
| No shared package changes break Android | `npx expo run:android` succeeds | ✅ Verified |

---

## 3. Non-Goals

- **No Android changes** - Do not modify `android/`, Gradle config, or shared packages in ways that affect Android
- **No React/RN version changes** - Keep React 19.0.0, React Native 0.79.6, Expo 53
- **No new architecture migration** - Keep `newArchEnabled: false`
- **No feature changes** - This is a bug fix, not a feature release
- **No speculative fixes** - Diagnose before implementing fixes

---

## 4. Technical Context

### 4.1 Environment

| Component | Version |
|-----------|---------|
| macOS | 26.1 |
| Xcode | 26.2 |
| Node.js | v20.10.0 |
| npm | 10.2.3 |
| Test Device | Physical iPhone, iOS 18.x |

### 4.2 Current Stack (Post Phase 1)

| Package | Version | Notes |
|---------|---------|-------|
| Expo | ^53.0.0 | Managed workflow |
| React | 19.0.0 | With overrides |
| React Native | 0.79.6 | |
| Hermes | Enabled | Default for Expo 53 |
| @thinksys/react-native-mediapipe | ^0.0.19 | Core functionality |
| react-native-gesture-handler | ~2.24.0 | Navigation dependency |
| ~~react-native-reanimated~~ | ~~3.17.4~~ | **Removed in Phase 1** |
| ~~react-native-worklets-core~~ | ~~1.3.3~~ | **Removed in Phase 1** |

### 4.3 Build Process

```bash
# iOS
npx expo prebuild --platform ios
# Open ios/forma.xcworkspace in Xcode, build and run

# Android
npx expo run:android
```

### 4.4 iOS Configuration to Preserve

```json
// app.json → expo.ios
{
  "supportsTablet": true,
  "bundleIdentifier": "com.forma.dev.allahham.12345.app",
  "infoPlist": {
    "NSCameraUsageDescription": "This app requires camera access..."
  }
}
```

---

## 5. Phase 1 Results Summary

### What Was Done
1. Verified Reanimated and worklets-core were NOT used in app code
2. Removed `react-native-reanimated` from package.json
3. Removed `react-native-worklets-core` from package.json
4. Removed corresponding Babel plugins from babel.config.js
5. Regenerated iOS native project with `npx expo prebuild --platform ios`

### Results
| Test | Result |
|------|--------|
| Android regression | ✅ No regression - works correctly |
| iOS Xcode build | ✅ Builds with no native errors |
| iOS Metro bundle | ✅ Bundles successfully |
| iOS runtime | ❌ Crashes immediately after bundle loads |

### Conclusion
The original Reanimated/worklets errors are eliminated, but a different runtime crash now occurs. This crash is NOT the same as the original "TypeError: Cannot read property 'S'" error.

---

## 6. Phase 2: Crash Diagnosis (Current Phase)

### Objective
Identify the exact cause of the iOS runtime crash without introducing new errors or causing Android regression.

### Crash Characteristics (Observed)

| Observation | Detail |
|-------------|--------|
| Xcode Console | **Silent** - No error output |
| Metro Terminal | **Silent** - No JS errors |
| Crash Timing | **Instant** - Immediately after bundle download completes |
| UI Before Crash | **None** - No splash screen, no white screen, nothing |

### Analysis: What This Pattern Indicates

A **silent instant crash** after bundle download with no console output strongly indicates:

1. **Native Module Initialization Failure**
   - The crash occurs during the React Native bridge setup phase
   - A native module is failing to initialize before any JS can execute
   - This happens at the C++/Objective-C level, bypassing JS error handling

2. **Most Likely Culprit: `@thinksys/react-native-mediapipe`**
   - MediaPipe is the only remaining native module with complex initialization
   - It may have expected Reanimated or worklets-core to be present at native level
   - Or it has its own initialization issue with the current iOS/Hermes stack

3. **Alternative Possibilities**
   - A native module has a hidden dependency on something we removed
   - Hermes bytecode execution failure (would need JSC test)
   - Expo dev-client specific initialization issue

### Why Silent Crashes Happen

```
Normal JS Error Flow:
  JS Code → Error → Red Box / Console Output

Silent Native Crash Flow:
  Native Init → C++ Exception / SIGABRT → App Terminates
  (No JS ever executes, so no JS error handling)
```

### Diagnostic Plan

#### Step 1: Isolate MediaPipe (Primary Suspect)
Temporarily disable MediaPipe to determine if it's the cause:
- Comment out MediaPipe import in CameraScreen.tsx
- Replace RNMediapipe component with a placeholder View
- If app launches → MediaPipe is the issue
- If app still crashes → Issue is elsewhere

#### Step 2: Check iOS Device Crash Logs
Even silent crashes generate system crash reports:
- On iPhone: Settings → Privacy & Security → Analytics & Improvements → Analytics Data
- Look for files named `forma-YYYY-MM-DD-XXXXXX.ips`
- These contain the native stack trace showing exactly where the crash occurred

#### Step 3: If MediaPipe Is the Cause
Options to investigate:
- Check if MediaPipe requires Reanimated at native level (not just JS)
- Check MediaPipe iOS compatibility with React Native 0.79 / Expo 53
- Consider re-adding Reanimated but with iOS-specific config
- Consider alternative MediaPipe package or native integration

#### Step 4: If MediaPipe Is NOT the Cause
Proceed to test Hermes:
- Disable Hermes on iOS (Phase 4)
- If that fixes it → Hermes incompatibility with another module

### Constraints for Phase 2
- **Isolate before fixing** - Confirm the culprit module first
- **Minimal changes** - Only comment out code for testing, don't delete
- **Preserve Android** - All diagnostic changes must be iOS-conditional or easily reversible
- **Document findings** - Update PRD with results of each diagnostic step

### Diagnostic Results

#### Test 1: Disable MediaPipe ✅ COMPLETED
- **Action:** Commented out MediaPipe import, replaced with placeholder View
- **Result:** App still crashes
- **Conclusion:** MediaPipe is NOT the cause

#### Test 2: Disable Hermes (Use JSC) - INCOMPLETE
- **Action:** Set `jsEngine: "jsc"` in app.json, regenerated iOS project
- **Result:** App still crashed
- **Root Cause Found:** Crash log revealed Hermes was STILL bundled despite JSC setting
- **Fix:** Complete clean rebuild (rm -rf ios node_modules, npm install, prebuild --clean)

#### Crash Log Analysis (forma-2026-02-02-192030.ips)
- **Exception:** `EXC_CRASH` / `SIGABRT` - abort() called
- **Root Cause:** Hermes framework was still bundled and being used
- **Crash Location:** `InspectorPackagerConnection::reconnect()` triggered FATAL log
- **Evidence:** `hermes.framework` in usedImages, `HermesRuntimeImpl::evaluateJavaScript` in stack

#### Crash Log Analysis (forma-2026-02-03-021308.ips) ✅ ROOT CAUSE IDENTIFIED
- **Exception:** `EXC_CRASH` / `SIGABRT` - abort() called
- **JS Engine:** JSC confirmed (JavaScriptCore.framework in usedImages, NO Hermes)
- **Root Cause:** React Native Inspector WebSocket connection failure triggers LOG(FATAL)
- **Crash Stack:**
  ```
  abort()
  google::LogDestination::LogToSinks  ← FATAL log
  InspectorPackagerConnection::Impl::reconnect()  ← CRASH HERE
  InspectorPackagerConnection::Impl::didFailWithError
  RCTCxxInspectorWebSocketAdapter webSocket:didFailWithError:
  SRWebSocket _failWithError:
  ```
- **Evidence:** JavaScriptCore.framework in usedImages, crash in jsinspector-modern

#### Root Cause Explanation

The React Native JS Inspector (`jsinspector-modern`) has a bug where it uses `LOG(FATAL)` when handling WebSocket reconnection errors. This is a **glog** fatal log which calls `abort()` by design.

**Crash sequence:**
1. App starts in debug mode
2. Inspector tries to connect to Metro's WebSocket endpoint
3. Connection fails (network unreachable, Metro not running, etc.)
4. `didFailWithError` is called
5. `reconnect()` is called
6. Something in reconnect logic triggers `LOG(FATAL)` (bug in RN 0.79)
7. glog's FATAL handler calls `abort()`
8. App crashes with SIGABRT

### Fix Applied

Changed `ios/Podfile.properties.json`:
```json
"EX_DEV_CLIENT_NETWORK_INSPECTOR": "false"
```

**Note:** This disables Expo's network inspector. The RN inspector is separate but this may help.

### Next Steps

1. **Clean rebuild required:**
   ```bash
   cd Forma-MediaPipe/ios && rm -rf Pods Podfile.lock && pod install && cd ..
   ```
2. Rebuild in Xcode and test
3. If still crashing, try **Release build** to bypass inspector
4. If Release works, the issue is confirmed as RN inspector bug

---

## 7. Phase 3: Targeted Fix (After Diagnosis)

Once Phase 2 identifies the crash cause, Phase 3 will implement a targeted fix. Possible scenarios:

| Diagnosed Cause | Likely Fix |
|-----------------|------------|
| MediaPipe native module initialization | Check MediaPipe iOS compatibility, may need config |
| Hermes + specific package incompatibility | Disable Hermes on iOS only |
| Missing native module linking | Fix Podfile or native module config |
| JS import/export error | Fix JS code |
| React 19 compatibility issue | Add polyfill or compatibility fix |

---

## 8. Phase 4: Hermes Disable (Last Resort)

If Phase 2 diagnosis points to Hermes incompatibility that cannot be fixed otherwise:

1. **Disable Hermes iOS-only via expo-build-properties:**
   ```json
   // app.json
   {
     "plugins": [
       ["expo-build-properties", {
         "ios": {
           "jsEngine": "jsc"
         },
         "android": {
           "minSdkVersion": 26,
           "compileSdkVersion": 35,
           "targetSdkVersion": 35
         }
       }]
     ]
   }
   ```

2. **Regenerate iOS native project:**
   ```bash
   rm -rf ios
   npx expo prebuild --platform ios
   ```

3. **Build and test on iOS device**

---

## 9. Implementation Checklist

### Phase 1: Dependency Cleanup ✅ COMPLETE
- [x] Check `npm ls react-native-reanimated` output - Only direct dep
- [x] Remove Reanimated from package.json
- [x] Remove worklets-core from package.json
- [x] Remove Babel plugins from babel.config.js
- [x] Regenerate iOS native project
- [x] Test Android - No regression
- [x] Test iOS build - Builds successfully
- [x] Test iOS runtime - **Crashes (new issue)**

### Phase 2: Crash Diagnosis ✅ COMPLETE
- [x] Capture Xcode console crash output - **Silent (no output)**
- [x] Capture Metro terminal output - **Silent (no JS errors)**
- [x] Identify crash type - **Native module initialization (silent crash pattern)**
- [x] Test: Disable MediaPipe - **Still crashes → MediaPipe NOT the cause**
- [x] Test: Disable Hermes on iOS (JSC) - **Still crashes → Hermes NOT the cause**
- [x] Get iOS device crash logs - **Analyzed forma-2026-02-03-021308.ips**
- [x] Confirm root cause - **RN Inspector WebSocket reconnect calls LOG(FATAL)**
- [x] Document findings in PRD

### Phase 3: Targeted Fix ✅ COMPLETE
- [x] Implement fix - **Disabled EX_DEV_CLIENT_NETWORK_INSPECTOR**
- [x] Clean rebuild (pod install)
- [x] Test iOS Release - **App launches successfully**
- [x] Re-enabled MediaPipe camera functionality
- [ ] Test iOS - Camera works with MediaPipe
- [ ] Test Android - No regression

### Phase 4: Release Build ✅ CONFIRMED WORKING
- [x] Build in Release mode to bypass inspector - **Works!**
- [x] Issue confirmed as RN 0.79 inspector bug in debug mode
- [x] Workaround: Run in Release mode for iOS development

---

## 10. Open Questions

| Question | Status | Resolution |
|----------|--------|------------|
| Does MediaPipe require Reanimated? | **Resolved** | No - only needs react/react-native (per package.json) |
| What causes the 'S' undefined error? | **Resolved** | Reanimated worklet init - fixed by removal |
| What causes the new runtime crash? | **Resolved** | RN Inspector WebSocket reconnect triggers LOG(FATAL) |
| Is it a JS or native crash? | **Resolved** | Native crash (glog FATAL → abort) |
| Is MediaPipe the culprit? | **Resolved** | No - app crashes even with MediaPipe disabled |
| Is Hermes the culprit? | **Resolved** | No - app crashes even with JSC (Hermes disabled) |
| Which native module is crashing? | **Resolved** | jsinspector-modern (InspectorPackagerConnection) |
| Will disabling network inspector fix it? | **Resolved** | Release mode works; Debug has RN inspector bug |

---

## 11. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-02 | Hermes disable acceptable | Team confirmed as last resort |
| 2026-02-02 | MediaPipe must work day one | Core feature, cannot ship placeholder |
| 2026-02-02 | Reanimated removal acceptable | Not directly used in app code |
| 2026-02-02 | Phase 1 complete | Removed unused deps, fixed build, new crash discovered |
| 2026-02-02 | Phase 2 = Diagnosis | Must identify crash cause before attempting fixes |
| 2026-02-02 | MediaPipe ruled out | App crashes even with MediaPipe disabled |
| 2026-02-02 | Hermes ruled out | App crashes even with JSC (Hermes disabled) |
| 2026-02-02 | Need device crash logs | Only way to identify actual crash location |
| 2026-02-03 | Root cause found | RN Inspector WebSocket crash in reconnect() |
| 2026-02-03 | Disabled network inspector | Set EX_DEV_CLIENT_NETWORK_INSPECTOR=false |
| 2026-02-03 | Release build works | Confirmed: RN inspector bug only affects Debug mode |
| 2026-02-03 | MediaPipe re-enabled | Camera functionality restored for Release builds |

---

## 12. Appendix

### A. Current babel.config.js (Post Phase 1)

```javascript
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Removed react-native-worklets-core/plugin - not used in app
      // Removed react-native-reanimated/plugin - not used in app
      // These were causing iOS Hermes crash: "Cannot read property 'S' of undefined"
    ],
  };
};
```

### B. Current package.json dependencies (Post Phase 1)

```json
{
  "dependencies": {
    "@expo-google-fonts/inter": "^0.4.2",
    "@expo-google-fonts/jetbrains-mono": "^0.4.1",
    "@react-navigation/bottom-tabs": "^7.0.0",
    "@react-navigation/native": "^7.0.0",
    "@react-navigation/native-stack": "^7.0.0",
    "@thinksys/react-native-mediapipe": "^0.0.19",
    "clsx": "^2.1.1",
    "expo": "^53.0.0",
    "expo-blur": "~14.1.5",
    "expo-build-properties": "~0.14.0",
    "expo-dev-client": "~5.2.0",
    "expo-font": "~13.3.2",
    "expo-linear-gradient": "~14.1.5",
    "expo-status-bar": "~2.2.3",
    "lucide-react-native": "^0.378.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-native": "0.79.6",
    "react-native-gesture-handler": "~2.24.0",
    "react-native-safe-area-context": "5.4.0",
    "react-native-screens": "~4.11.1",
    "react-native-svg": "15.11.2",
    "tailwind-merge": "^2.6.0"
  }
}
```

### C. Crash Timeline (Observed)

```
1. Xcode build      → SUCCESS (no native errors)
2. App launches     → Metro bundler starts
3. Metro bundles JS → SUCCESS
4. Bundle downloads → SUCCESS (download completes)
5. Native init      → CRASH (silent, instant)
   ├─ No Xcode console output
   ├─ No Metro JS errors
   ├─ No UI rendered (not even splash)
   └─ Indicates native module init failure
```

### D. Crash Pattern Analysis

**Silent + Instant + No UI = Native Module Initialization Failure**

This crash pattern occurs when:
- A native module's `+initialize` or constructor fails
- The failure happens before the JS bridge is fully established
- Therefore, no JS error handlers are active to catch/report it

~~Primary suspect: `@thinksys/react-native-mediapipe`~~ **RULED OUT**
- Tested: App crashes even with MediaPipe completely disabled

**Current suspect: Hermes on iOS**
- Removing Reanimated changed crash behavior (JS error → silent crash)
- Suggests another module has Hermes-specific initialization that's now failing
- Candidates: gesture-handler, screens, expo-dev-client, or core RN bridge

### E. Diagnostic Progress

| Test | Result | Conclusion |
|------|--------|------------|
| Remove Reanimated/worklets | Build succeeds, runtime crash | Fixed build, new issue |
| Disable MediaPipe | Still crashes | MediaPipe not the cause |
| Disable Hermes (use JSC) | Still crashes | Hermes not the cause |
| Get device crash logs | **PENDING** | Will show exact crash location |

### F. Remaining Suspects

With MediaPipe and Hermes ruled out:
1. `react-native-gesture-handler` - Native initialization
2. `react-native-screens` - Native screens setup
3. `expo-dev-client` - Dev client early hooks
4. Misconfigured native linking in Pods
5. Core RN bridge initialization issue
