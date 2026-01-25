# Partial Body Detection & Lenient Confidence Thresholds

## Problem

After implementing strict detection to prevent false positives, two issues emerged:

1. **Intermittent disappearing**: The skeleton would disappear frequently because the 0.6 confidence threshold was too high
2. **No partial body support**: If only part of the body was in frame (e.g., just torso), the entire skeleton would disappear

## Solution

Implemented a **region-based partial body detection system** with more lenient thresholds.

### Key Changes

#### 1. Lowered Confidence Thresholds

| Threshold | Before | After | Purpose |
|-----------|--------|-------|---------|
| Per-keypoint validation | 0.5 | 0.3 | Individual keypoint acceptance |
| Core body parts | 0.6 | 0.35 | Body region detection |
| Overlay display | 0.6 | 0.35 | Visible keypoint rendering |

#### 2. Region-Based Detection

Instead of requiring all core keypoints, the system now:
- Divides body into 5 regions: head, shoulders, arms, hips, legs
- Requires **at least 2 regions** to be visible
- Displays only the keypoints that are actually detected

```typescript
// Count visible body regions
const headVisible = nose.score >= MIN_CONFIDENCE;
const shouldersVisible = leftShoulder.score >= MIN_CONFIDENCE || 
                         rightShoulder.score >= MIN_CONFIDENCE;
const armsVisible = leftElbow.score >= MIN_CONFIDENCE || 
                    rightElbow.score >= MIN_CONFIDENCE || 
                    leftWrist.score >= MIN_CONFIDENCE || 
                    rightWrist.score >= MIN_CONFIDENCE;
const hipsVisible = leftHip.score >= MIN_CONFIDENCE || 
                    rightHip.score >= MIN_CONFIDENCE;
const legsVisible = leftKnee.score >= MIN_CONFIDENCE || 
                    rightKnee.score >= MIN_CONFIDENCE || 
                    leftAnkle.score >= MIN_CONFIDENCE || 
                    rightAnkle.score >= MIN_CONFIDENCE;

const visibleRegions = [headVisible, shouldersVisible, armsVisible, hipsVisible, legsVisible]
  .filter(v => v).length;

// Require at least 2 regions (prevents false positives while allowing partial body)
if (visibleRegions < 2) {
  return; // Reject detection
}
```

#### 3. Smart Anatomical Validation

Only applies strict anatomical checks when relevant body parts are visible:

```typescript
// Only validate torso if both shoulders AND hips are visible
if (shouldersVisible && hipsVisible) {
  // Check that shoulders are above hips
  // Check minimum torso height
  // More lenient thresholds (20px vs 30px)
}
```

## Supported Partial Body Scenarios

### ✅ Upper Body Only
- **Visible**: Head + shoulders + arms
- **Hidden**: Hips, legs
- **Result**: Shows head, shoulder, and arm keypoints only
- **Use case**: Close-up workout shots, upper body exercises

### ✅ Lower Body Only
- **Visible**: Hips + legs
- **Hidden**: Head, shoulders, arms
- **Result**: Shows hip, knee, and ankle keypoints only
- **Use case**: Leg exercises, lower body focus

### ✅ Torso Only
- **Visible**: Shoulders + hips
- **Hidden**: Head, arms, legs
- **Result**: Shows torso keypoints with anatomical validation
- **Use case**: Mid-range shots, core exercises

### ✅ One Side Visible
- **Visible**: Left shoulder + left elbow + left hip + left knee
- **Hidden**: Right side of body
- **Result**: Shows left side keypoints only
- **Use case**: Side profiles, partial occlusion

### ❌ Single Body Part
- **Visible**: Only head OR only arm
- **Hidden**: Everything else
- **Result**: No skeleton displayed
- **Reason**: Prevents false positives from random objects

## Validation Logic

### Minimum Requirements
- At least **2 different body regions** must be visible
- Each visible keypoint must have **≥ 0.35 confidence**

### Anatomical Validation (when applicable)
Only checked when both shoulders and hips are visible:
- Shoulders must be above hips (with 5px tolerance)
- Minimum torso height: 20px (reduced from 30px)

### No Longer Required
- ❌ Full body visibility
- ❌ Both shoulders present
- ❌ Both hips present
- ❌ Legs visible
- ❌ Head visible
- ❌ Strict width/height ratios

## Confidence Threshold Details

### 0.3 - Initial Keypoint Acceptance
```typescript
const isHighConfidence = visibility >= 0.3;
```
Determines whether a single keypoint from the model is accepted.

### 0.35 - Body Region Detection
```typescript
const MIN_CONFIDENCE = 0.35;
const headVisible = nose.score >= MIN_CONFIDENCE;
```
Determines whether an entire body region (head, arms, etc.) is considered visible.

### 0.35 - Overlay Rendering
```typescript
<PoseOverlay minScore={0.35} />
```
Only keypoints with ≥ 0.35 confidence are drawn on screen.

## False Positive Prevention

Even with lenient thresholds, false positives are still prevented by:

1. **Multi-region requirement**: Need 2+ body regions (objects don't have multiple body regions)
2. **Confidence validation**: Each region needs specific anatomical keypoints
3. **Anatomical checks**: When full torso is visible, proportions must be correct
4. **Temporal consistency**: Smoothing helps filter out single-frame anomalies

## Performance Characteristics

### Visibility Persistence
- **Before**: Skeleton would flicker on/off frequently
- **After**: Stable skeleton display when person is in frame

### Partial Body Support
- **Before**: Disappears if any core keypoint is missing
- **After**: Shows whatever body parts are actually visible

### False Positive Rate
- **Before**: Very low (too strict)
- **After**: Still very low, but allows legitimate partial body detections

### Detection Sensitivity
| Scenario | Before | After |
|----------|--------|-------|
| Full body in good lighting | ✅ Detected | ✅ Detected |
| Full body in dim lighting | ❌ Often missed | ✅ Detected |
| Upper body only | ❌ Rejected | ✅ Detected |
| Lower body only | ❌ Rejected | ✅ Detected |
| Person at frame edge | ❌ Often rejected | ✅ Detected |
| Side profile | ❌ Often rejected | ✅ Detected |
| Random objects | ✅ Rejected | ✅ Rejected |

## Use Cases

### Workout Recording
- **Close-up shots**: Upper body exercises like bicep curls
- **Lower body focus**: Squats, lunges with camera focused on legs
- **Side profiles**: Lateral exercises

### Real-World Scenarios
- **Person entering/exiting frame**: Smoothly appears/disappears
- **Camera panning**: Skeleton persists even when body is partially off-screen
- **Occlusions**: If arm goes behind body, only visible limbs are shown

## Tuning the Detection

### To Make Even More Lenient
```typescript
// Lower per-keypoint threshold
const isHighConfidence = visibility >= 0.2; // From 0.3

// Lower region threshold
const MIN_CONFIDENCE = 0.25; // From 0.35

// Require only 1 region
if (visibleRegions < 1) // From 2
```

### To Make More Strict
```typescript
// Raise per-keypoint threshold
const isHighConfidence = visibility >= 0.4; // From 0.3

// Raise region threshold
const MIN_CONFIDENCE = 0.45; // From 0.35

// Require 3 regions
if (visibleRegions < 3) // From 2
```

## Testing

### Test Cases
1. ✅ Full body visible → All keypoints displayed
2. ✅ Upper body only → Head, shoulders, arms displayed
3. ✅ Lower body only → Hips, legs displayed
4. ✅ Person enters from left → Skeleton appears progressively
5. ✅ Person exits right → Skeleton disappears progressively
6. ✅ Dim lighting → Skeleton persists (not flickering)
7. ✅ Side profile → One-sided skeleton displayed
8. ✅ Empty frame → No skeleton (false positive prevention)

## Result

The skeleton now:
- ✅ **Persists reliably** when a person is in frame
- ✅ **Supports partial body** detection
- ✅ **Shows only visible parts** (no phantom limbs)
- ✅ **Still prevents false positives** from objects
- ✅ **Works in various lighting** conditions
- ✅ **Handles edge cases** gracefully
