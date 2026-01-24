# MoveNet Models Comparison

## Available Models

The app includes 4 MoveNet SinglePose models, each with different trade-offs between accuracy, speed, and model size.

### 1. MoveNet Lightning Quantized ⚡
- **File**: `movenet_lightning_quantized.tflite`
- **Size**: 2.8 MB
- **Input**: 192×192 RGB (uint8)
- **Output**: Float32 (auto-dequantized)
- **Speed**: ~20-25ms per frame (fastest)
- **Accuracy**: Good for basic pose tracking
- **Best for**: Real-time applications where speed is critical
- **Trade-off**: Lower spatial resolution may struggle with fine limb differentiation

### 2. MoveNet Lightning Float32 ⚡
- **File**: `movenet_lightning_float32.tflite`
- **Size**: 4.5 MB
- **Input**: 192×192 RGB (float32, normalized 0-1)
- **Output**: Float32
- **Speed**: ~25-30ms per frame (fast)
- **Accuracy**: Better than quantized Lightning
- **Best for**: Balanced speed/accuracy on mobile
- **Trade-off**: Still limited by 192×192 input resolution

### 3. MoveNet Thunder Quantized ⚡⚡
- **File**: `movenet_thunder_quantized.tflite`
- **Size**: 6.8 MB
- **Input**: 256×256 RGB (uint8)
- **Output**: Float32 (auto-dequantized)
- **Speed**: ~30-40ms per frame (good)
- **Accuracy**: Excellent for most use cases
- **Best for**: Production apps requiring accuracy
- **Trade-off**: 33% slower than Lightning but 75% better spatial resolution

### 4. MoveNet Thunder Float16 ⚡⚡⚡ (CURRENT)
- **File**: `movenet_thunder_float16.tflite`
- **Size**: 12 MB
- **Input**: 256×256 RGB (float32, normalized 0-1)
- **Output**: Float32
- **Speed**: ~35-50ms per frame (slower)
- **Accuracy**: Highest accuracy available
- **Best for**: Maximum accuracy, fine limb differentiation
- **Trade-off**: Largest model, slower inference

## Performance Comparison

| Model | Input Size | Model Size | Speed | Accuracy | RAM Usage |
|-------|-----------|-----------|-------|----------|-----------|
| Lightning Quantized | 192×192 | 2.8 MB | ⚡⚡⚡⚡⚡ | ⭐⭐⭐ | Low |
| Lightning Float32 | 192×192 | 4.5 MB | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | Medium |
| Thunder Quantized | 256×256 | 6.8 MB | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | Medium |
| Thunder Float16 | 256×256 | 12 MB | ⚡⚡ | ⭐⭐⭐⭐⭐⭐ | High |

## Key Differences

### Resolution Impact
- **Lightning (192×192)**: 36,864 pixels
- **Thunder (256×256)**: 65,536 pixels (+78% more pixels)

The higher resolution in Thunder models provides:
- Better limb differentiation (left vs right arm/leg)
- More accurate keypoint localization
- Better detection of small movements
- Reduced confusion between body parts

### Quantization vs Float

**Quantized Models (uint8)**:
- Smaller file size
- Faster inference on some hardware
- Slight accuracy loss due to quantization
- Input: 0-255 RGB values
- Modern TFLite auto-dequantizes output to Float32

**Float Models (float16/float32)**:
- Larger file size
- Better precision
- Higher accuracy
- Input: 0.0-1.0 normalized RGB values
- No quantization artifacts

## Current Configuration

```typescript
// Active model: Thunder Float16
const MOVENET_MODEL = MODELS.THUNDER_FLOAT16;
```

### Confidence Thresholds
- **Front camera**: 0.25 (needs lower threshold due to hardware)
- **Rear camera**: 0.35 (higher quality sensor)

### Processing Settings
- **Frame rate**: 15 FPS (~66ms interval)
- **Deadzone**: 2-3px (minimal filtering)
- **Smoothing**: 0.1-0.2 (preserves accuracy)

## Switching Models

To switch models, edit `src/screens/CameraScreen.tsx`:

```typescript
// For maximum speed:
const MOVENET_MODEL = MODELS.LIGHTNING_QUANTIZED;

// For balanced speed/accuracy:
const MOVENET_MODEL = MODELS.LIGHTNING_FLOAT32;

// For high accuracy:
const MOVENET_MODEL = MODELS.THUNDER_QUANTIZED;

// For maximum accuracy (current):
const MOVENET_MODEL = MODELS.THUNDER_FLOAT16;
```

## Recommendations

### Use Lightning Quantized if:
- Target is low-end devices
- Real-time 30 FPS is required
- Basic pose tracking is sufficient
- App size is constrained

### Use Lightning Float32 if:
- Need balance between speed and accuracy
- 20-25 FPS is acceptable
- Good general-purpose model

### Use Thunder Quantized if:
- Accuracy is important
- 15-20 FPS is acceptable
- Need good limb differentiation
- Production app quality

### Use Thunder Float16 if:
- Maximum accuracy is required
- Fine limb differentiation is critical
- Exercise form analysis needs precision
- Device has sufficient performance

## Model Sources

All models downloaded from TensorFlow Hub:
- Lightning Quantized: [tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/int8/4](https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/int8/4)
- Lightning Float32: [tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/float16/4](https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/float16/4)
- Thunder Quantized: [tfhub.dev/google/lite-model/movenet/singlepose/thunder/tflite/int8/4](https://tfhub.dev/google/lite-model/movenet/singlepose/thunder/tflite/int8/4)
- Thunder Float16: [tfhub.dev/google/lite-model/movenet/singlepose/thunder/tflite/float16/4](https://tfhub.dev/google/lite-model/movenet/singlepose/thunder/tflite/float16/4)

## Technical Details

### Model Architecture
- **Type**: SinglePose (one person only)
- **Keypoints**: 17 body landmarks (COCO format)
- **Output format**: [y, x, confidence] × 17
- **Coordinate system**: Normalized [0.0, 1.0]

### Keypoint Names
0. nose, 1. left_eye, 2. right_eye, 3. left_ear, 4. right_ear, 5. left_shoulder, 6. right_shoulder, 7. left_elbow, 8. right_elbow, 9. left_wrist, 10. right_wrist, 11. left_hip, 12. right_hip, 13. left_knee, 14. right_knee, 15. left_ankle, 16. right_ankle

### Processing Pipeline
1. **Capture**: YUV frame from camera
2. **Resize**: Native YUV→RGB + resize to 192×192 or 256×256
3. **Rotate**: 90° CW rotation for portrait mode
4. **Normalize**: uint8 [0-255] or float32 [0.0-1.0]
5. **Inference**: TFLite model execution
6. **Post-process**: Coordinate mapping, filtering, smoothing
7. **Display**: Skeleton overlay on preview

## Performance Optimization

The app uses several optimizations for real-time performance:
- Native YUV→RGB conversion (vision-camera-resize-plugin)
- Native 90° rotation during resize
- Frame rate limiting (15 FPS)
- Worklet-based frame processing (separate thread)
- Minimal post-processing (confidence filtering + light smoothing)
- Throttled exercise detection (150ms intervals)

With Thunder Float16, the app maintains consistent 15 FPS performance on modern mobile devices while providing maximum pose estimation accuracy.
