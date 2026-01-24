# MediaPipe Pose Troubleshooting Guide

## Common Issues and Solutions

### Issue 1: No Skeleton Appears

**Symptoms:**
- Camera opens but no skeleton overlay appears
- Model loading status shows but then disappears
- No pose detection

**Possible Causes & Solutions:**

#### 1. Model Loading Failed
**Check:**
- Look for "MediaPipe Pose (33 landmarks)" message at top of screen
- If you see "Error:" message, model failed to load

**Solution:**
```bash
# Verify model file exists and is valid
ls -lh assets/models/pose_landmark_full.tflite
# Should show ~6.1M file size

# If missing or corrupt, re-download:
curl -L -o assets/models/pose_landmark_full.tflite \
  "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose_landmark_full.tflite"
```

#### 2. Frame Processor Not Running
**Check console logs for:**
```
✅ MediaPipe: Using float32 input
🎥 Processing frame: inputType=3
✅ Frame resized: 196608 values
✅ Model inference complete: output length=195
```

**If you don't see these logs:**
- Frame processor may not be attached
- Camera may not be active
- Model may be null

**Solution:**
- Check that `frameProcessorFps` is set (line 646)
- Verify `shouldCameraBeActive` is true
- Ensure model loaded successfully

#### 3. Output Format Mismatch
**Check console for:**
```
📊 MediaPipe output: length=195
📐 Detected stride: 5 (output length: 195)
```

**Expected output lengths:**
- 99: [x, y, z] × 33
- 132: [x, y, z, visibility] × 33
- 165: [x, y, z, visibility, presence] × 33
- **195**: [x, y, z, visibility, presence, ?] × 33 ← PROBLEM!

**Solution:**
If output length is unexpected (like 195), the model may have extra fields. Update stride detection:

```typescript
// In onPoseOutputFromWorklet
if (outputLen === 195) {
  stride = 5; // Treat as 5 values per landmark, ignore extra
} else if (outputLen === 198) {
  stride = 6; // Even more fields
}
```

#### 4. Visibility Threshold Too High
**Check console for:**
```
❌ Pose rejected: avg score 0.35 < threshold 0.4
```

**Solution:**
Lower the confidence threshold in `onPoseOutputFromWorklet`:

```typescript
const confidenceThreshold = isFrontCamera ? 0.15 : 0.20; // Lower thresholds
```

#### 5. Coordinate System Issues
**Check console for:**
```
👤 Pose detected: avg visibility=0.850, keypoints[0]=(NaN, NaN)
```

**If coordinates are NaN:**
- Model output format may be different than expected
- X/Y order may be swapped

**Solution:**
Try swapping X/Y coordinates:

```typescript
// In onPoseOutputFromWorklet
const modelY = flatOutput[baseIdx];     // Try Y first
const modelX = flatOutput[baseIdx + 1]; // Then X
```

### Issue 2: Model Loads But No Detection

**Check:**
1. Ensure you're visible in the frame (full body or at least upper body)
2. Good lighting conditions
3. Stand 3-6 feet from camera

**Debug Steps:**

1. **Add debug overlay** to show if ANY keypoints are detected:
```typescript
// In CameraScreen render section
{poseKeypoints && (
  <Text style={{position: 'absolute', top: 100, left: 10, color: 'white'}}>
    Keypoints: {poseKeypoints.length} | 
    Avg Score: {(poseKeypoints.reduce((sum, kp) => sum + kp.score, 0) / poseKeypoints.length).toFixed(2)}
  </Text>
)}
```

2. **Test with MoveNet** to confirm camera/processing works:
```typescript
// Temporarily switch back to MoveNet
const POSE_MODEL = MODELS.MOVENET_THUNDER_QUANTIZED;
```

### Issue 3: Skeleton Appears But Flickering/Unstable

**Solution:**
Adjust smoothing parameters:

```typescript
const DEADZONE = 3;        // Increase to 3-5px
const SMOOTHING = 0.15;    // Increase to 0.15-0.20
```

### Issue 4: Poor Performance / Low FPS

**Check:**
- Frame interval set too low
- Device CPU/GPU overloaded

**Solution:**
```typescript
// Reduce frame rate
if (timestampMs - lastInferenceTime.value < 50) return; // 20 FPS instead of 30
```

## Debug Checklist

Run through this checklist:

- [ ] Model file exists: `ls assets/models/pose_landmark_full.tflite`
- [ ] Model loads: Look for "✅ MediaPipe Pose (33 landmarks)" message
- [ ] Camera active: Camera feed visible
- [ ] Frame processor running: Check console for "🎥 Processing frame"
- [ ] Model inference works: Check console for "✅ Model inference complete"
- [ ] Output format correct: Check console for "📐 Detected stride"
- [ ] Visibility scores adequate: Check console for "👤 Pose detected"
- [ ] Keypoints not rejected: No "❌ Pose rejected" messages
- [ ] PoseOverlay receiving data: Check console for "✅ Pose accepted"

## Quick Test Commands

```bash
# 1. Check model file
file assets/models/pose_landmark_full.tflite
# Should output: data

# 2. Verify model size
ls -lh assets/models/pose_landmark_full.tflite
# Should be ~6.1M

# 3. Test model loading (run app and check logs)
npx expo run:ios
# or
npx expo run:android

# 4. Watch logs
npx react-native log-android
# or
npx react-native log-ios
```

## Expected Console Output (Success)

```
✅ MediaPipe: Using float32 input
MediaPipe model loaded: shape=[1,256,256,3], dtype=float32
🎥 Processing frame: inputType=3, modelInputTypeSV=3
✅ Frame resized: 196608 values, type=Float32Array
✅ Model inference complete: output length=195
📊 MediaPipe output: length=195, first 10 values: [0.5, 0.3, ...]
📐 Detected stride: 5 (output length: 195)
👤 Pose detected: avg visibility=0.850, keypoints[0]=(512.3, 380.7)
✅ Pose accepted: showing 33 landmarks
```

## Revert to MoveNet (If Needed)

If MediaPipe issues persist, temporarily revert:

1. In `CameraScreen.tsx`:
```typescript
const POSE_MODEL = MODELS.MOVENET_THUNDER_QUANTIZED;
```

2. Revert `KEYPOINT_NAMES` to 17 MoveNet keypoints

3. Update `PoseOverlay.tsx` KEYPOINT_INDEX to MoveNet mapping

## Contact/Support

If issues persist after trying all solutions:
1. Capture full console logs
2. Note exact error messages
3. Share device model and OS version
4. Include screenshot of camera screen
