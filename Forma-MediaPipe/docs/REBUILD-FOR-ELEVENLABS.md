# Rebuilding Development Client for ElevenLabs TTS

## Why This Is Needed

ElevenLabs TTS requires `expo-av` and `expo-file-system`, which are **native modules**. These modules need to be compiled into your development client. Your current development client was built before these modules were added, so they're missing.

## Rebuild Steps

### Option A: Using EAS Build (Recommended - Faster)

1. **Make sure you have an EAS account**
   ```bash
   npx eas login
   ```

2. **Build new development client for Android**
   ```bash
   npx eas build --profile development --platform android
   ```

3. **Wait for build to complete** (usually 10-15 minutes)
   - You'll get a download link when done
   - Install the APK on your device

4. **Start dev server and test**
   ```bash
   npx expo start --dev-client --tunnel
   ```

### Option B: Local Build (Alternative - Takes Longer)

1. **Clean and rebuild native code**
   ```bash
   # Clean previous builds
   npx expo prebuild --clean
   
   # Build for Android
   npx expo run:android
   ```

2. **Wait for build** (first build takes 15-30 minutes)

3. **App will install and launch automatically**

## Verification

Once rebuilt, test that TTS works:

1. Open the app and navigate to Camera screen
2. Start recording a Barbell Curl workout
3. Perform a rep
4. You should:
   - See feedback text on screen
   - **Hear spoken feedback** via ElevenLabs
   - If you see `"ElevenLabs TTS: Native modules not available"` in console, rebuild didn't work

## Troubleshooting

### "expo-av is not available"

**Cause**: Development client still doesn't include the module

**Fix**: 
- Make sure `expo-av` is in `package.json` dependencies (it is)
- Try clearing cache: `npx expo start --dev-client --clear`
- Rebuild again with `--clean` flag

### Build fails

**Check**:
- You have enough disk space (10GB+)
- Android SDK is installed (for local builds)
- `package.json` has no conflicting dependencies

### Still no audio after rebuild

**Check**:
- Your `.env` file has `EXPO_PUBLIC_ELEVENLABS_API_KEY` set
- Internet connection is working
- TTS toggle (speaker icon) is not muted in the camera screen
- Check console for any API errors

## Quick Test Without Rebuilding

If you want to verify everything else works without waiting for a rebuild:

The camera now works! TTS is just disabled. You'll see feedback text on screen but won't hear audio until you rebuild.
