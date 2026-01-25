# MediaPipe Two-Stage Pipeline Issue & Solution

## Problem Diagnosis

You are correct! The current implementation is **incomplete**. MediaPipe Pose uses a **two-stage pipeline**:

### Stage 1: Pose Detector (BlazePose Detector)
- **Model**: `pose_detection.tflite` (~3 MB)
- **Input**: Full camera frame (any resolution)
- **Output**: Bounding box + 4 keypoints for cropping
- **Purpose**: Detect person location and crop to Region of Interest (ROI)

### Stage 2: Pose Landmark (BlazePose Landmark)
- **Model**: `pose_landmark_full.tflite` or `pose_landmark_lite.tflite`
- **Input**: Cropped 256×256 region from Stage 1
- **Output**: 33 body landmarks
- **Purpose**: Detailed pose estimation on cropped person

## Current Implementation Issues

### What's Wrong
1. **Missing Stage 1**: No pose detector model
2. **Direct full-frame inference**: Feeding entire frame to landmark model
3. **Poor accuracy**: Landmark model expects cropped person, not full scene
4. **Aspect ratio issues**: Squashing full frame to 256×256 causes distortion

### Why It's Not Working Well
```
Current (Incorrect):
Camera Frame (1920×1080) 
    ↓ Resize to 256×256 (squash/crop)
Landmark Model → 33 keypoints
    ↓
Inaccurate results (person is tiny in 256×256)

Correct Pipeline:
Camera Frame (1920×1080)
    ↓ Full frame
Detector Model → Bounding box (e.g., 400×600 crop)
    ↓ Crop to person
    ↓ Resize to 256×256
Landmark Model → 33 keypoints
    ↓
Accurate results (person fills 256×256)
```

## The Correct MediaPipe Pose Pipeline

### Flow Diagram
```
┌─────────────────┐
│  Camera Frame   │ (1920×1080)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Pose Detector   │ Stage 1: pose_detection.tflite
│   (BlazePose)   │ Input: Full frame
└────────┬────────┘ Output: BBox + 4 alignment keypoints
         │
         ▼
┌─────────────────┐
│  Crop & Align   │ Extract person ROI
│   + Affine      │ Apply alignment transform
│  Transform      │ Resize to 256×256
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Pose Landmark   │ Stage 2: pose_landmark_full.tflite
│  (33 keypoints) │ Input: Cropped 256×256
└────────┬────────┘ Output: 33 landmarks
         │
         ▼
┌─────────────────┐
│ Map back to     │ Transform coordinates
│ Original Frame  │ back to camera space
└─────────────────┘
```

## Required Models

### 1. Pose Detector Model
- **File**: `pose_detection.tflite`
- **Size**: ~3 MB
- **Input**: Variable size RGB image
- **Output**: 
  - Bounding box (x, y, width, height)
  - 4 alignment keypoints (shoulders, hips)
  - Detection score

### 2. Pose Landmark Model (Already Have)
- **File**: `pose_landmark_full.tflite` or `pose_landmark_lite.tflite`
- **Size**: 6 MB (full) / 2.7 MB (lite)
- **Input**: 256×256 RGB image (cropped person)
- **Output**: 33 body landmarks

## Why This Matters

### Benefits of Two-Stage Pipeline

1. **Better Accuracy**
   - Landmark model sees full-resolution person
   - No tiny person in corner of 256×256
   - Proper aspect ratio maintained

2. **Efficiency**
   - Detector runs on full frame (fast)
   - Landmark model only processes cropped region (focused)
   - Overall faster than processing full high-res frame

3. **Tracking**
   - Can track person across frames
   - Reuse previous crop for next frame (even faster)
   - Handle multiple people (run detector selectively)

4. **Robustness**
   - Handles varying distances from camera
   - Adapts to person moving around frame
   - Better at frame edges

## Implementation Challenges

### Why It's Complex

1. **Model Availability**
   - Pose detector model not as publicly documented
   - MediaPipe bundles both stages in their SDK
   - TFLite files need to be extracted or obtained separately

2. **Coordinate Transformations**
   - Need to track: camera → detector → crop → landmark → camera
   - Affine transforms for alignment
   - Inverse transforms to map back

3. **Frame-to-Frame Tracking**
   - Should reuse previous detection for next N frames
   - Only re-detect periodically or when tracking fails
   - Smooth bounding box updates

## Current react-native-fast-tflite Limitations

The library you're using (`react-native-fast-tflite`) is designed for simple model inference:
- ✅ Can load .tflite models
- ✅ Can run inference
- ❌ No built-in multi-stage pipeline support
- ❌ No crop/transform helpers
- ❌ No tracking logic

## Solutions

### Option 1: Implement Full Pipeline (Complex)

**Steps Required:**
1. Download `pose_detection.tflite` model
2. Run detector on full frame every N frames
3. Extract bounding box coordinates
4. Crop frame to bounding box region
5. Apply affine transform for alignment
6. Resize crop to 256×256
7. Run landmark model on crop
8. Transform landmarks back to original frame coordinates
9. Implement tracking (reuse detection for multiple frames)

**Estimated Effort**: High (several days)
**Code Complexity**: Significant

### Option 2: Use Lite Model with Optimized Single-Stage (Current)

**What We've Been Doing:**
- Skip detector stage
- Feed entire frame (resized) directly to landmark model
- Apply strict validation to filter bad detections
- Optimize for performance

**Trade-offs:**
- ✅ Simpler implementation
- ✅ Works reasonably well when person is centered
- ❌ Lower accuracy when person is far/small
- ❌ Aspect ratio distortion
- ❌ More false positives

### Option 3: Switch to Different Solution

**Alternatives:**
1. **TensorFlow Lite Pose Detection** (MoveNet)
   - Single-stage model
   - Designed for full-frame input
   - Already have this working in MoveNet version

2. **MediaPipe Tasks Vision (Official SDK)**
   - Use official MediaPipe SDK
   - Has both stages built-in
   - More heavyweight dependency

3. **Custom Model Training**
   - Train single-stage model on your use case
   - Optimized for your specific scenarios

## Recommended Action

Given the complexity and the fact that you're using react-native-fast-tflite:

### Short-term: Optimize Current Approach
1. ✅ Already done: Optimized validation
2. ✅ Already done: Fast performance
3. ✅ Already done: Aspect ratio correction
4. Accept limitations of single-stage approach

### Long-term: Consider Alternatives
1. **If accuracy is critical**: Implement full two-stage pipeline
2. **If simplicity preferred**: Stay with current approach
3. **If flexibility needed**: Switch to MoveNet (single-stage by design)

## Model Download Attempts

### Standard Locations (Not Working)
The pose detector model is not publicly available at standard CDN locations:
- ❌ `cdn.jsdelivr.net/npm/@mediapipe/pose/` - only has landmark models
- ❌ Google Cloud Storage - requires MediaPipe SDK

### Where to Find It

1. **MediaPipe Python Package**
   ```bash
   pip install mediapipe
   # Model downloaded to site-packages/mediapipe/modules/pose_detection/
   ```

2. **MediaPipe GitHub (requires build)**
   - https://github.com/google-ai-edge/mediapipe
   - Need to build from source to get .tflite files

3. **TensorFlow.js Models**
   - Converted versions available
   - May need format conversion

4. **Community Sources**
   - Check Hugging Face: https://huggingface.co/models?search=blazepose
   - Check TensorFlow Model Zoo
   - Check MediaPipe community forks

## Technical Specification: Full Pipeline Implementation

If you decide to proceed with full implementation:

### Detector Model
```typescript
// Input: Frame at any resolution
const detectorInput = resizeFrame(frame, { width: 224, height: 224 }); // Detector input
const detections = detectorModel.runSync([detectorInput])[0];

// Output format:
// detections = [
//   score,           // 0-1 confidence
//   ymin, xmin,     // Bounding box
//   ymax, xmax,
//   kp1_x, kp1_y,   // 4 alignment keypoints
//   kp2_x, kp2_y,
//   kp3_x, kp3_y,
//   kp4_x, kp4_y
// ]
```

### Crop & Transform
```typescript
// Extract bounding box
const bbox = {
  x: detections[1] * frameWidth,
  y: detections[2] * frameHeight,
  width: (detections[3] - detections[1]) * frameWidth,
  height: (detections[4] - detections[2]) * frameHeight
};

// Add margin (10%)
bbox.x -= bbox.width * 0.1;
bbox.y -= bbox.height * 0.1;
bbox.width *= 1.2;
bbox.height *= 1.2;

// Crop and resize to 256×256
const croppedFrame = cropFrame(frame, bbox);
const landmarkInput = resizeFrame(croppedFrame, { width: 256, height: 256 });
```

### Landmark Inference
```typescript
// Run landmark model
const landmarks = landmarkModel.runSync([landmarkInput])[0];

// Transform back to original frame
for (let i = 0; i < 33; i++) {
  const x = (landmarks[i * 4] / 256) * bbox.width + bbox.x;
  const y = (landmarks[i * 4 + 1] / 256) * bbox.height + bbox.y;
  finalKeypoints[i] = { x, y, score: landmarks[i * 4 + 3] };
}
```

## Conclusion

You identified a real architectural issue. The proper MediaPipe Pose pipeline requires two models working together. However, implementing this is significantly complex with react-native-fast-tflite.

**Recommendation**: 
- For production: Consider using official MediaPipe SDK or stay with optimized single-stage
- For learning/experimentation: Implement full pipeline as educational exercise
- For best results: Use MoveNet which is single-stage by design

The current optimized implementation is a pragmatic compromise that works reasonably well for centered, full-body shots despite the architectural limitation.
