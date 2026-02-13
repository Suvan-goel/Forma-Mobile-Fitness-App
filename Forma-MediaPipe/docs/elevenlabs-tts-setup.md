# ElevenLabs Text-to-Speech Setup

This guide walks you through integrating ElevenLabs TTS into your Forma app.

## Prerequisites

1. **ElevenLabs API Key**
   - Sign up at [elevenlabs.io](https://elevenlabs.io)
   - Get your API key from the dashboard

2. **Development Client Rebuild**
   - ElevenLabs uses `expo-av` which is a native module
   - You must rebuild your development client to include it

## Setup Steps

### 1. Configure API Key

Add your ElevenLabs API key to `.env`:

```bash
EXPO_PUBLIC_ELEVENLABS_API_KEY=sk_your_api_key_here

# Optional: Choose a specific voice (default is Rachel)
# EXPO_PUBLIC_ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

Browse available voices at: https://elevenlabs.io/voice-library

### 2. Verify Dependencies

The following packages should already be installed:
- `expo-av` - Audio playback
- `expo-file-system` - Temporary file storage

Check your `package.json` to confirm they're present with SDK 53 compatible versions.

### 3. Rebuild Development Client

**Option A: Using EAS Build (Recommended)**

```bash
# Build for Android
eas build --profile development --platform android

# Build for iOS (if needed)
eas build --profile development --platform ios
```

**Option B: Local Build**

```bash
# Clean prebuild
npx expo prebuild --clean

# Build for Android
npx expo run:android

# Build for iOS
npx expo run:ios
```

### 4. Install & Test

1. Install the new development client on your device
2. Start the dev server: `npx expo start --dev-client`
3. Open the app and navigate to the Camera screen
4. Perform a Barbell Curl rep
5. You should hear ElevenLabs TTS feedback

## How It Works

### Audio Session Configuration

The app configures audio to work alongside the camera:

```typescript
Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  interruptionModeIOS: Audio.InterruptionModeIOS.MixWithOthers,
  interruptionModeAndroid: Audio.InterruptionModeAndroid.DuckOthers,
});
```

This ensures:
- Audio plays without interrupting camera
- iOS: Mixes with other audio sources
- Android: Ducks other audio when speaking

### TTS Flow

1. Rep detected → Feedback generated
2. Call ElevenLabs API with feedback text
3. Download MP3 audio to temporary file
4. Play audio using `expo-av`
5. Clean up old audio files

### Caching

- Audio files stored in `FileSystem.cacheDirectory`
- Keeps most recent 3 files
- Older files automatically deleted

## Troubleshooting

### "Cannot find native module 'ExponentAV'"

**Cause**: Development client doesn't include `expo-av`

**Fix**: Rebuild your development client (see Step 3)

### "ElevenLabs API error: 401"

**Cause**: Invalid or missing API key

**Fix**: Check your `.env` file has the correct `EXPO_PUBLIC_ELEVENLABS_API_KEY`

### No audio plays

**Causes**:
- TTS is muted (speaker icon in top-right)
- No internet connection
- API quota exceeded

**Fix**:
- Tap speaker icon to unmute
- Check internet connection
- Check ElevenLabs dashboard for quota

### Audio conflicts with camera

**Cause**: Audio session not properly configured

**Fix**: This should be handled automatically by `elevenlabsTTS.ts`. If issues persist, check console logs for audio initialization errors.

## Cost Considerations

- ElevenLabs charges per character spoken
- When TTS is muted (speaker icon), no API calls are made
- Typical feedback is 10-50 characters per rep
- Monitor usage at [elevenlabs.io](https://elevenlabs.io)

## Testing Without Rebuilding

If you want to test the implementation without rebuilding:
1. Comment out ElevenLabs imports
2. Use `expo-speech` as temporary fallback
3. Once ready, uncomment and rebuild

## Files Modified

- `src/services/elevenlabsTTS.ts` - ElevenLabs integration
- `src/services/feedbackTTS.ts` - TTS entry point
- `.env` - API key configuration
