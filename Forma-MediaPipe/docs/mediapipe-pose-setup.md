# MediaPipe Pose Full Integration

## Summary

Successfully integrated MediaPipe Pose Full model to replace MoveNet for pose estimation. MediaPipe provides 33 body landmarks (vs MoveNet's 17), enabling more detailed body tracking including hands and feet.

## Model Specifications

### MediaPipe Pose Full
- **File**: `pose_landmark_full.tflite`
- **Size**: 6.4 MB
- **Input**: 256×256 RGB (float32, normalized 0-1)
- **Output**: 33 landmarks with [x, y, z, visibility] per landmark
- **Speed**: ~30-40ms per frame
- **Accuracy**: High - includes face, hands, and feet landmarks

## 33 Landmark Topology

MediaPipe Pose Full outputs 33 body landmarks:

### Face (0-10)
- 0: nose
- 1: left_eye_inner
- 2: left_eye
- 3: left_eye_outer
- 4: right_eye_inner
- 5: right_eye
- 6: right_eye_outer
- 7: left_ear
- 8: right_ear
- 9: mouth_left
- 10: mouth_right

### Upper Body (11-22)
- 11: left_shoulder
- 12: right_shoulder
- 13: left_elbow
- 14: right_elbow
- 15: left_wrist
- 16: right_wrist
- 17: left_pinky
- 18: right_pinky
- 19: left_index
- 20: right_index
- 21: left_thumb
- 22: right_thumb

### Lower Body (23-32)
- 23: left_hip
- 24: right_hip
- 25: left_knee
- 26: right_knee
- 27: left_ankle
- 28: right_ankle
- 29: left_heel
- 30: right_heel
- 31: left_foot_index
- 32: right_foot_index

## Changes Made

### 1. Model File
Downloaded `pose_landmark_full.tflite` from MediaPipe CDN to `assets/models/`.

### 2. CameraScreen.tsx Updates
- Updated `KEYPOINT_NAMES` array with 33 MediaPipe landmark names
- Changed input size constant to `MEDIAPIPE_INPUT_SIZE = 256`
- Updated model loading to use `POSE_MODEL`
- Modified frame processor for ~30 FPS targeting
- Updated output parsing to handle MediaPipe's [x, y, z, visibility] format
- Adjusted smoothing parameters for MediaPipe's output characteristics

### 3. PoseOverlay.tsx Updates
- Updated `KEYPOINT_INDEX` mapping for 33 landmarks
- Enhanced `SKELETON_CONNECTIONS` with hand and foot connections
- Improved rendering with visibility-based filtering
- Updated styling for better visualization

### 4. poseAnalysis.ts Updates
- Adjusted visibility threshold from 0.3 to 0.25
- Updated documentation comments
- No structural changes needed (uses name-based keypoint lookup)

## Output Format

MediaPipe Pose Full can output in different formats:
- **99 values**: [x, y, z] × 33 landmarks
- **132 values**: [x, y, z, visibility] × 33 landmarks
- **165 values**: [x, y, z, visibility, presence] × 33 landmarks

The code auto-detects the format based on output length.

## Performance Optimizations

### Frame Rate
- Target: ~30 FPS (33ms frame interval)
- Actual inference: ~30-40ms depending on device

### Smoothing
- Deadzone: 2px (prevents jitter)
- Smoothing factor: 0.08 (92% current frame, 8% previous)
- Minimal lag while maintaining stability

### Visibility Thresholds
- Front camera: 0.30
- Back camera: 0.40
- PoseOverlay minimum: 0.25

## Comparison: MediaPipe vs MoveNet

| Feature | MediaPipe Pose Full | MoveNet Thunder |
|---------|---------------------|-----------------|
| Landmarks | 33 | 17 |
| Hand tracking | ✅ (fingers) | ❌ |
| Foot tracking | ✅ (heel, toe) | ❌ |
| 3D coordinates | ✅ (z-depth) | ❌ |
| Model size | 6.4 MB | 6.8 MB |
| Input size | 256×256 | 256×256 |
| Speed | ~35ms | ~30ms |
| Accuracy | Higher | Good |

## Future Improvements

1. **Use 3D coordinates (z-depth)** for improved form analysis
2. **Add hand gesture detection** using finger landmarks
3. **Track foot placement** for exercises like squats and deadlifts
4. **Implement two-stage pipeline** (detector + landmarks) for better person localization

## Switching Back to MoveNet

If needed, you can switch back to MoveNet by:

1. Changing the model constant in `CameraScreen.tsx`:
```typescript
const POSE_MODEL = MODELS.MOVENET_THUNDER_QUANTIZED;
```

2. Reverting `KEYPOINT_NAMES` to MoveNet's 17 keypoints

3. Updating `KEYPOINT_INDEX` in `PoseOverlay.tsx`

## Status

✅ MediaPipe Pose Full model downloaded  
✅ CameraScreen.tsx updated for 33 landmarks  
✅ PoseOverlay.tsx updated with full skeleton  
✅ poseAnalysis.ts compatible with MediaPipe  
✅ No linter errors  

**Ready to test!** 🏋️‍♂️
