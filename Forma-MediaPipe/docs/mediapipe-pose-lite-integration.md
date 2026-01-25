# MediaPipe Pose Lite Integration

## Overview

The MediaPipe Pose Lite model has been integrated into the app alongside the existing MediaPipe Pose Full model. The Lite model offers faster inference times with a smaller file size, making it ideal for devices with limited resources or when performance is prioritized over maximum accuracy.

## Model Specifications

### MediaPipe Pose Lite
- **File**: `pose_landmark_lite.tflite`
- **Size**: ~2.7 MB (vs 6.1 MB for Full)
- **Input**: 256×256 RGB (float32, normalized 0-1)
- **Output**: 33 landmarks with [x, y, z, visibility] per landmark
- **Speed**: ~15-25ms per frame (faster than Full)
- **Accuracy**: Good - slightly lower than Full but still very capable
- **Landmarks**: Same 33 landmarks as Full model

### Comparison

| Model | Size | Speed | Accuracy | Use Case |
|-------|------|-------|----------|----------|
| **Lite** | 2.7 MB | ~15-25ms | Good | Fast inference, lower-end devices |
| **Full** | 6.1 MB | ~30-40ms | High | Maximum accuracy |

## Downloading the Model

The Lite model needs to be downloaded before use. You have several options:

### Option 1: Using npm script (Recommended)
```bash
npm run download:mediapipe-lite
```

### Option 2: Using Python script directly
```bash
python3 scripts/download_mediapipe_lite.py
```

### Option 3: Using Bash script directly
```bash
bash scripts/download_mediapipe_lite.sh
```

### Option 4: Manual download
1. Download from: `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose_landmark_lite.tflite`
2. Save to: `assets/models/pose_landmark_lite.tflite`

## Code Integration

### Model Selection

The model is configured in `src/screens/CameraScreen.tsx`:

```typescript
const MODELS = {
  MEDIAPIPE_POSE_LITE: require('../../assets/models/pose_landmark_lite.tflite'),
  MEDIAPIPE_POSE_FULL: require('../../assets/models/pose_landmark_full.tflite'),
};

// Default to Lite model (faster, smaller)
const POSE_MODEL = MODELS.MEDIAPIPE_POSE_LITE;

// To switch to Full model:
// const POSE_MODEL = MODELS.MEDIAPIPE_POSE_FULL;
```

### Switching Models

To switch between models, simply change the `POSE_MODEL` constant:

```typescript
// For Lite (faster, smaller)
const POSE_MODEL = MODELS.MEDIAPIPE_POSE_LITE;

// For Full (more accurate)
const POSE_MODEL = MODELS.MEDIAPIPE_POSE_FULL;
```

## Technical Details

### Input/Output Format

Both Lite and Full models use the same format:
- **Input**: 256×256 RGB image, float32, normalized to [0, 1]
- **Output**: 33 landmarks, each with [x, y, z, visibility] (132 values total)
- **Coordinate System**: Pixel coordinates relative to 256×256 input, normalized to [0, 1]

### Performance Considerations

The Lite model is optimized for:
- **Lower latency**: Faster inference means more responsive UI
- **Battery efficiency**: Less computation = better battery life
- **Lower-end devices**: Works well on devices with limited GPU/CPU

The Full model is better for:
- **Maximum accuracy**: Better landmark detection in challenging poses
- **Edge cases**: Handles occlusions and unusual angles better
- **High-end devices**: When you have processing power to spare

## Troubleshooting

### Model file not found
If you see an error about the model file not being found:
1. Ensure you've downloaded the model using one of the methods above
2. Check that the file exists at `assets/models/pose_landmark_lite.tflite`
3. Verify the file size is approximately 2.7 MB

### Build errors
If the app fails to build:
- Make sure the model file is in the correct location
- Clear the build cache: `npx expo start -c`
- Rebuild the app: `npm run android` or `npm run ios`

### Runtime errors
If the model fails to load at runtime:
- Check that the model file wasn't corrupted during download
- Try re-downloading the model
- Verify the model format is correct (should be a .tflite file)

## Future Enhancements

Potential improvements:
- Add UI toggle to switch between models at runtime
- Add model selection in settings
- Automatic model selection based on device capabilities
- Support for MediaPipe Pose Heavy model
