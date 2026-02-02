# PRD: Forma iOS MediaPipe Fix

**Document Version:** 1.1
**Date:** 2026-02-02
**Status:** Phase 1 Implemented - Awaiting Testing

---

## 1. Problem Statement

The Forma iOS app builds successfully but crashes at runtime with Hermes-related initialization errors:

```
TypeError: Cannot read property 'S' of undefined
TypeError: Cannot read property 'default' of undefined
```

These errors originate from `react-native-reanimated` and/or `react-native-worklets-core` initialization when running on Hermes. Even when errors are partially addressed, the app displays a white screen.

**Android works correctly** and must not be affected by any fix.

### Root Cause Analysis

1. **Reanimated is a transitive dependency** - There are no direct imports of `react-native-reanimated` in `/src/`. It exists only in:
   - `package.json` (dependency declaration)
   - `babel.config.js` (Babel plugin)
   - Potentially pulled in by `@thinksys/react-native-mediapipe` or `react-native-gesture-handler`

2. **Hermes + Reanimated + iOS incompatibility** - The Reanimated worklet runtime initialization fails on iOS with Hermes, causing the cryptic `'S' of undefined` and `'default' of undefined` errors.

3. **Already attempted and reverted:**
   - React downgrade
   - Babel/Reanimated/worklets-core plugin and linking tweaks
   - Worklets shim
   - Excluding worklets-core on iOS

---

## 2. Success Criteria

The iOS fix is considered complete when:

| Criterion | Verification |
|-----------|--------------|
| App launches on iOS physical device | No crash, no white screen |
| Camera permission works | Can access device camera |
| MediaPipe pose detection runs | Pose landmarks detected and displayed |
| Android remains functional | Existing Android APK still works |
| No shared package changes break Android | `npx expo run:android` succeeds |

---

## 3. Non-Goals

- **No Android changes** - Do not modify `android/`, Gradle config, or shared packages in ways that affect Android
- **No React/RN version changes** - Keep React 19.0.0, React Native 0.79.6, Expo 53
- **No new architecture migration** - Keep `newArchEnabled: false`
- **No feature changes** - This is a bug fix, not a feature release

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

### 4.2 Stack

| Package | Version | Notes |
|---------|---------|-------|
| Expo | ^53.0.0 | Managed workflow |
| React | 19.0.0 | With overrides |
| React Native | 0.79.6 | |
| Hermes | Enabled | Default for Expo 53 |
| @thinksys/react-native-mediapipe | ^0.0.19 | Core functionality |
| react-native-reanimated | ~3.17.4 | **Not directly used** |
| react-native-worklets-core | ^1.3.3 | May be needed by MediaPipe |
| react-native-gesture-handler | ~2.24.0 | May pull in Reanimated |

### 4.3 Build Process

```bash
npx pod-install
# Then build in Xcode
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

## 5. Requirements and Acceptance Criteria

### REQ-1: Investigate Reanimated Necessity

**Requirement:** Determine if `react-native-reanimated` can be safely removed.

**Acceptance Criteria:**
- [ ] Verify `@thinksys/react-native-mediapipe` does NOT require Reanimated
- [ ] Verify `react-native-gesture-handler` works without Reanimated
- [ ] If removable, remove from `package.json` and `babel.config.js`
- [ ] Test on Android to confirm no regression

### REQ-2: iOS-Only Hermes Disable (If Needed)

**Requirement:** If Reanimated cannot be removed and native fixes fail, disable Hermes on iOS only.

**Acceptance Criteria:**
- [ ] Configure `app.json` or `Podfile.properties.json` to disable Hermes iOS-only
- [ ] Keep Hermes enabled on Android
- [ ] Verify iOS app launches and MediaPipe works with JSC
- [ ] Document performance implications

### REQ-3: Native iOS Configuration

**Requirement:** Apply iOS-specific native fixes via Podfile or Xcode settings.

**Acceptance Criteria:**
- [ ] Any Podfile changes are iOS-only (not affecting Android)
- [ ] Code signing settings preserved
- [ ] Deployment target remains iOS 15.1+
- [ ] Clean build succeeds after pod install

### REQ-4: MediaPipe Functionality

**Requirement:** MediaPipe pose detection must work on iOS.

**Acceptance Criteria:**
- [ ] Camera preview displays
- [ ] Pose landmarks are detected
- [ ] Landmarks are rendered on screen
- [ ] Rep counting (if implemented) functions correctly

### REQ-5: Android Non-Regression

**Requirement:** Android must continue working after iOS fix.

**Acceptance Criteria:**
- [ ] `npx expo run:android` builds successfully
- [ ] App launches on Android device/emulator
- [ ] Camera and MediaPipe work on Android
- [ ] No new Android runtime errors

---

## 6. Open Questions and Risks

### Open Questions

| Question | Status | Resolution |
|----------|--------|------------|
| Does MediaPipe actually require Reanimated? | **Resolved** | No - MediaPipe only requires `react` and `react-native` as peer deps |
| What causes the 'S' undefined error specifically? | **Resolved** | Reanimated's worklet runtime init failing on iOS with Hermes |
| Is disabling Hermes acceptable for iOS performance? | **Resolved** | Yes, acceptable as last resort (may not be needed)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| MediaPipe requires Reanimated | Medium | High | Fall back to Hermes disable |
| Hermes disable causes iOS performance regression | Low | Medium | Acceptable per team decision |
| Fix breaks Android | Low | Critical | Test Android after every change |
| @thinksys/react-native-mediapipe incompatible with stack | Medium | High | May need to fork or find alternative |

---

## 7. Proposed Fix Approach

### Phase 1: Dependency Analysis (Low Risk)

1. **Check if Reanimated is actually needed:**
   ```bash
   npm ls react-native-reanimated
   ```
   Verify which packages depend on it.

2. **Test removal of Reanimated:**
   - Remove from `package.json`
   - Remove from `babel.config.js` plugins
   - Run `npm install`
   - Test on **Android first** (should not break)
   - Then test on iOS

### Phase 2: iOS-Only Native Fixes (Medium Risk)

If Reanimated cannot be removed:

1. **Try Reanimated iOS-specific initialization fix:**
   - Check if Reanimated 3.17 has known iOS/Hermes issues
   - Add iOS-specific Reanimated config in Podfile if available

2. **Try worklets-core iOS exclusion:**
   - Conditionally exclude `react-native-worklets-core` on iOS in babel.config.js:
     ```javascript
     plugins: [
       ...(process.env.EXPO_OS !== 'ios' ? ['react-native-worklets-core/plugin'] : []),
       'react-native-reanimated/plugin',
     ]
     ```

### Phase 3: Hermes Disable on iOS (Last Resort)

If Phase 1 and 2 fail:

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
           // Keep Android config as-is (Hermes enabled by default)
         }
       }]
     ]
   }
   ```

2. **Regenerate iOS native project:**
   ```bash
   rm -rf ios
   npx expo prebuild --platform ios
   npx pod-install
   ```

3. **Build and test on iOS device**

### Phase 4: Verification

1. **iOS verification:**
   - App launches without crash
   - Camera works
   - MediaPipe detects poses

2. **Android non-regression:**
   - Clean build Android: `npx expo run:android`
   - Verify existing functionality

---

## 8. Implementation Checklist

- [x] **Phase 1:** Check `npm ls react-native-reanimated` output ✅ Only direct dep, no transitive deps
- [x] **Phase 1:** Remove Reanimated from package.json ✅ Removed
- [x] **Phase 1:** Remove worklets-core from package.json ✅ Removed
- [x] **Phase 1:** Remove Babel plugins from babel.config.js ✅ Removed
- [x] **Phase 1:** Regenerate iOS native project ✅ `npx expo prebuild --platform ios`
- [ ] **Phase 1:** Test Reanimated removal on Android ⏳ Awaiting manual test
- [ ] **Phase 1:** Test Reanimated removal on iOS ⏳ Awaiting manual test
- [ ] **Phase 2:** Try worklets-core iOS exclusion (if Phase 1 fails)
- [ ] **Phase 2:** Try Reanimated iOS-specific fixes (if Phase 1 fails)
- [ ] **Phase 3:** Disable Hermes on iOS only (if Phase 2 fails)
- [ ] **Phase 4:** Verify iOS functionality (launch, camera, MediaPipe)
- [ ] **Phase 4:** Verify Android non-regression
- [ ] **Documentation:** Update docs if config changes

---

## 9. Appendix

### A. Current babel.config.js

```javascript
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-worklets-core/plugin',
      'react-native-reanimated/plugin',
    ],
  };
};
```

### B. Current Podfile Key Sections

```ruby
platform :ios, '15.1'

use_react_native!(
  :hermes_enabled => podfile_properties['expo.jsEngine'] == nil || podfile_properties['expo.jsEngine'] == 'hermes',
)
```

### C. Error Stack Trace Examples

```
TypeError: Cannot read property 'S' of undefined
    at anonymous (ReanimatedModule.js:1)
    at worklet initialization

TypeError: Cannot read property 'default' of undefined
    at anonymous (worklet runtime init)
```

### D. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-02 | Hermes disable acceptable | Team confirmed as last resort |
| 2026-02-02 | MediaPipe must work day one | Core feature, cannot ship placeholder |
| 2026-02-02 | Reanimated removal acceptable | Not directly used in app code |
