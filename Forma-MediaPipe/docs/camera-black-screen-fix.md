# Camera Black Screen Issue - Diagnosis & Fix

## Problem

Camera screen appeared completely black and non-functional after integrating ElevenLabs TTS.

## Root Cause

The app was **crashing on startup** due to missing native modules:

```
ERROR: Cannot find native module 'ExponentAV'
ERROR: Module 'expo.modules.interfaces.filesystem.AppDirectories' not found
```

When you added ElevenLabs TTS integration, the code imported `expo-av` and `expo-file-system`:

```typescript
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
```

These are **native modules** that must be compiled into the development client. Your development client was built *before* these dependencies were added, so it didn't include them. When the JavaScript code tried to import them, the app crashed immediately - before it could even render the camera.

## Why Camera Appeared Black

The camera wasn't actually "black" - the entire app was crashing before the UI could render. The black screen was just a crash state.

## The Fix

Modified `src/services/elevenlabsTTS.ts` to gracefully handle missing native modules:

### Before (Crashes on Missing Module)

```typescript
import { Audio } from 'expo-av';  // ❌ Crashes if module not in dev client
import * as FileSystem from 'expo-file-system';  // ❌ Crashes if module not in dev client
```

### After (Graceful Fallback)

```typescript
// Try to load native modules, but don't crash if missing
let Audio: any = null;
let FileSystem: any = null;
let nativeModulesAvailable = false;

try {
  Audio = require('expo-av').Audio;
  FileSystem = require('expo-file-system');
  nativeModulesAvailable = true;
} catch (error) {
  console.warn('Native modules not available - TTS disabled until rebuild');
  nativeModulesAvailable = false;
}
```

All TTS functions now check `nativeModulesAvailable` before trying to use the modules:

```typescript
export async function speakWithElevenLabs(text: string): Promise<void> {
  if (!nativeModulesAvailable || !Audio) {
    console.warn('TTS disabled - rebuild development client to enable');
    return; // ✅ Gracefully skip instead of crashing
  }
  // ... rest of TTS code
}
```

## Current State

✅ **Camera works now** - App no longer crashes on startup
✅ **Feedback text displays** - Visual feedback still works
⚠️ **TTS is temporarily disabled** - Audio won't play until dev client is rebuilt

## To Enable TTS (Full Solution)

You need to rebuild your development client to include the native modules:

```bash
# Option 1: Using EAS Build (recommended)
npx eas build --profile development --platform android

# Option 2: Local build
npx expo prebuild --clean
npx expo run:android
```

See `docs/REBUILD-FOR-ELEVENLABS.md` for detailed rebuild instructions.

## Why This Approach is Good

1. **Non-breaking**: App works immediately without waiting for rebuild
2. **Progressive enhancement**: Can rebuild when ready
3. **Clear messaging**: Console logs explain what's needed
4. **Production-ready**: Same pattern can handle optional features gracefully

## Testing

### What Works Now (Without Rebuild)
- ✅ Camera renders and captures pose data
- ✅ Rep counting works
- ✅ Form analysis works
- ✅ Visual feedback displays on screen
- ✅ All UI controls work

### What Requires Rebuild
- ⚠️ Spoken feedback (ElevenLabs TTS)

## Key Lesson

When adding native modules to an existing Expo project:

1. Add dependency to `package.json`
2. **Rebuild development client** (this step was missed!)
3. Test the new feature

Without step 2, the JavaScript imports the module but the native code isn't there → crash.
