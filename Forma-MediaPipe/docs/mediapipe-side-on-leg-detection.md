# MediaPipe Side-On Leg Detection Analysis

## Issue
The pose detection model struggles to detect legs when the user is viewed from the side (profile view). The skeleton overlay shows upper body keypoints and connections but stops at the hips—no leg keypoints or lines are drawn despite the legs being visible in the frame.

## Root Cause Analysis

### 1. **MediaPipe BlazePose Model Limitation**
The BlazePose model (used by `pose_landmarker_full.task`) is trained primarily on front-facing and near-front-facing poses. When the user is side-on:
- **Occlusion**: One leg is often partially or fully occluded by the other
- **Training data**: The model has less exposure to profile views during training
- **Low confidence**: Leg landmarks may be output with very low visibility/confidence, or with degenerate coordinates (e.g., default values, same as hip)

### 2. **Confidence Thresholds**
The Pose Landmarker uses three thresholds (all default 0.5):
- `minPoseDetectionConfidence`: Whether a pose is present in the frame
- `minPosePresenceConfidence`: Pose presence in landmark detection
- `minPoseTrackingConfidence`: Tracking success

When the user is side-on, overall pose confidence can drop. If it falls below 0.5, the model may reject the frame or return lower-quality landmarks. **Lowering these thresholds** (e.g., to 0.35) allows the model to return results even when confidence is borderline, which can improve leg detection in challenging angles.

### 3. **App Configuration**
- **Leg drawing**: The app passes `leftLeg: true`, `rightLeg: true` to RNMediapipe, and `GlobalState.isLeftLegEnabled/isRightLegEnabled` are set accordingly. Leg drawing is enabled.
- **Our Barbell Curl logic**: We intentionally filter out leg keypoints for rep detection (they’re not needed), but this does not affect the native skeleton overlay. The overlay is drawn entirely by the native MediaPipe view.

### 4. **Overlay Implementation**
- **Android** (`OverlayView.kt`): Draws lines between landmarks 23–25–27 (left leg) and 24–26–28 (right leg) when `GlobalState.isLeftLegEnabled` / `isRightLegEnabled` are true. No per-landmark visibility filtering—if the model returns coordinates, they are drawn.
- **iOS** (`OverlayView.swift`): Same logic via `generateConnections` and line drawing.

If legs don’t appear, the model is either not returning leg landmarks or returning them with degenerate coordinates (e.g., same point, off-screen, or zero-length segments).

## Implemented Solutions

### 1. **Lower Confidence Thresholds (Patch)**
We patch `PoseLandmarkerHelper.kt` and `DefaultConstants.swift` to use 0.35 instead of 0.5 for:
- `minPoseDetectionConfidence`
- `minPoseTrackingConfidence`
- `minPosePresenceConfidence`

This allows the model to accept frames with lower confidence, which can help with side-on and partial poses.

### 2. **Recommended User Guidance**
- **Optimal angle**: Front-facing or 3/4 view (about 30–45° from camera) gives the best leg detection.
- **Side-on limitation**: Profile view (90°) is a known weak point for BlazePose leg detection; some missing leg lines are expected.

## Potential Future Improvements

1. **Pose Landmarker Heavy model**: Switching to `pose_landmarker_heavy.task` may improve accuracy on difficult angles at the cost of performance.
2. **Visibility-based fallback**: Use landmark visibility scores to interpolate or estimate leg positions when confidence is low (complex to implement).
3. **Mirror fallback**: When one leg has low visibility, mirror the other leg’s positions (may look odd for profile view).
4. **Upstream**: MediaPipe/BlazePose improvements for profile and occlusion handling would require model or pipeline changes from Google.
