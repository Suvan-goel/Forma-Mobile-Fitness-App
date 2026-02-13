# Text-to-Speech Feedback

## Overview
When performing tracked exercises like Barbell Curl, the app provides real-time spoken feedback using the device's built-in Text-to-Speech engine.

## How It Works

### 1. **TTS Engine**
- Uses `expo-speech` (device's built-in voice)
- Simple and reliable
- No setup required

### 2. **Feedback Flow**
```typescript
// Camera detects rep with form issues
barbellCurlHeuristics.ts → generates feedback

// Feedback appears on screen
CameraScreen.tsx → displays feedback text

// TTS reads it aloud (if enabled)
feedbackTTS.ts → Speech.speak()
```

### 3. **User Controls**
- **Mute Button**: Top-right speaker icon on Camera Screen
  - Tap to toggle TTS on/off
  - State persists during the set
  - No cost when disabled

## Examples
- ✅ "Great rep!" (perfect form)
- ⚠️ "Don't swing your back!" (momentum detected)
- ⚠️ "Raise your elbows higher" (poor starting position)

## Limitations
- Only works for Barbell Curl (other exercises show text feedback only)
- Voice quality depends on device TTS engine
- Reads feedback once per rep when it changes
