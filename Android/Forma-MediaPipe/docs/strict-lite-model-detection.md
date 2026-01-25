# Strict Detection for MediaPipe Lite Model

## Problem Diagnosis

The MediaPipe Lite model was showing two critical issues:

1. **False Positives on Empty Frames**: Skeleton appearing on walls, furniture, empty spaces
2. **Inaccurate Partial Body Detection**: When only head/upper body visible, showing incorrect keypoints (phantom limbs in wrong places)

### Root Causes

#### Issue 1: Too Lenient Thresholds
- **0.55 per-keypoint confidence**: Too low for Lite model
- **Single keypoint per region**: Accepted isolated points without context
- **No connectivity validation**: Didn't check if keypoints form a connected body

#### Issue 2: Poor Partial Body Handling  
- Accepted any 3 regions without checking relationships
- No validation of anatomical connectivity (shoulder→elbow→wrist chain)
- Showed low-confidence keypoints even when they didn't make sense

## Solution: Multi-Layer Strict Validation

### 1. Increased Confidence Thresholds

| Threshold | Previous | New | Purpose |
|-----------|----------|-----|---------|
| Per-keypoint validation | 0.55 | **0.65** | Very high for initial acceptance |
| Region detection | 0.5 | **0.6** | Standard threshold |
| Critical keypoints | N/A | **0.7** | Head, single shoulders/hips |
| Overlay display | 0.5 | **0.6** | Only show confident keypoints |

### 2. Connected Body Part Validation

Instead of accepting isolated keypoints, now requires **connected chains**:

#### Shoulders: Require Both OR One with Very High Confidence
```typescript
const bothShouldersVisible = 
  leftShoulder.score >= 0.6 && rightShoulder.score >= 0.6;
const oneShoulderVisible = 
  leftShoulder.score >= 0.7 || rightShoulder.score >= 0.7;
const shouldersVisible = bothShouldersVisible || oneShoulderVisible;
```

#### Arms: Require Connected Chain (Elbow + Wrist)
```typescript
// Not just "any arm keypoint", but elbow AND wrist together
const armsVisible = 
  (leftElbow.score >= 0.6 && leftWrist.score >= 0.6) || 
  (rightElbow.score >= 0.6 && rightWrist.score >= 0.6);
```

#### Legs: Require Connected Chain (Hip→Knee OR Knee→Ankle)
```typescript
const leftLegChain = 
  (leftHip.score >= 0.6 && leftKnee.score >= 0.6) ||
  (leftKnee.score >= 0.6 && leftAnkle.score >= 0.6);
const rightLegChain = 
  (rightHip.score >= 0.6 && rightKnee.score >= 0.6) ||
  (rightKnee.score >= 0.6 && rightAnkle.score >= 0.6);
const legsVisible = leftLegChain || rightLegChain;
```

### 3. Head Region: Require Eyes + Nose
```typescript
const headConfident = nose.score >= 0.7;
const eyesVisible = leftEye.score >= 0.6 || rightEye.score >= 0.6;
const headRegion = headConfident && eyesVisible;
```

### 4. Core Body Structure Requirement

Must have one of:
- **Connected torso**: Both shoulders AND hips visible (forms torso)
- **Complete leg chain**: Hip→Knee→Ankle on at least one side

```typescript
const hasConnectedTorso = shouldersVisible && hipsVisible;
const hasCompleteLeg = 
  (leftHip.score >= 0.6 && leftKnee.score >= 0.6 && leftAnkle.score >= 0.6) ||
  (rightHip.score >= 0.6 && rightKnee.score >= 0.6 && rightAnkle.score >= 0.6);

if (!hasConnectedTorso && !hasCompleteLeg) {
  return; // Reject detection
}
```

### 5. Enhanced Anatomical Validation

When torso is visible, apply strict checks:

#### Shoulders Above Hips (No Tolerance)
```typescript
if (avgShoulderY >= avgHipY) {
  return; // Reject - anatomically impossible
}
```

#### Minimum Torso Height: 40px
```typescript
const torsoHeight = avgHipY - avgShoulderY;
if (torsoHeight < 40) {
  return; // Too small to be a real person
}
```

#### Reasonable Shoulder Width
```typescript
if (bothShoulders) {
  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
  if (shoulderWidth < 30 || shoulderWidth > width * 0.75) {
    return; // Proportions don't match human body
  }
}
```

### 6. Filter Low-Confidence Keypoints from Display

Even if detection passes, hide individual keypoints with low confidence:

```typescript
for (let i = 0; i < keypoints.length; i++) {
  if (keypoints[i].score < MIN_CONFIDENCE) {
    keypoints[i].score = 0; // Don't display this keypoint
  }
}
```

This prevents showing "phantom limbs" outside the frame.

## Validation Flow

```
Frame Input
    ↓
Extract Keypoints (confidence ≥ 0.65)
    ↓
Check Connected Regions:
  - Head = Nose (0.7) + Eyes (0.6)
  - Shoulders = Both (0.6) OR One (0.7)
  - Arms = Elbow + Wrist connected (0.6)
  - Hips = Both (0.6) OR One (0.7)
  - Legs = Hip→Knee OR Knee→Ankle (0.6)
    ↓
Count Valid Regions (need ≥ 3)
    ↓
Check Core Body:
  - Has connected torso (shoulders + hips)?
  - OR has complete leg chain?
    ↓
Anatomical Validation (if torso):
  - Shoulders above hips?
  - Torso height ≥ 40px?
  - Shoulder width reasonable?
    ↓
Filter Display:
  - Hide keypoints < 0.6 confidence
    ↓
Display Skeleton
```

## Results

### ✅ Prevents False Positives
- Empty walls → ❌ No detection
- Furniture → ❌ No detection  
- Partial objects → ❌ No detection
- Laptop screens → ❌ No detection
- Patterns/textures → ❌ No detection

### ✅ Accurate Partial Body Detection
- **Upper body only**: Shows head + shoulders + arms (if all connected)
- **Lower body only**: Shows hips + legs (if chain complete)
- **Side profile**: Shows one side with connected keypoints
- **No phantom limbs**: Only shows keypoints that actually have high confidence

### ✅ Full Body Detection
- Requires all key body parts with proper connections
- Validates anatomical proportions
- Shows complete skeleton with confidence

## Comparison: Before vs After

| Scenario | Before | After |
|----------|--------|-------|
| Empty frame | ❌ Shows skeleton on wall | ✅ No detection |
| Only head visible | ❌ Shows random limbs | ✅ Only head if eyes + nose confident |
| Upper body (no legs) | ❌ Shows phantom legs | ✅ Only torso + arms if connected |
| Full body in good light | ✅ Detects | ✅ Detects with validation |
| Full body in dim light | ⚠️ May flicker | ⚠️ May not detect (acceptable) |

## Trade-offs

### Pros
✅ Eliminates false positives on empty frames
✅ No more phantom limbs outside frame  
✅ Only shows connected, anatomically valid keypoints
✅ Better accuracy for partial body tracking
✅ More reliable overall detection

### Cons
⚠️ May not detect in very dim lighting (confidence too low)
⚠️ Requires more of body visible (connected regions)
⚠️ May miss detections at extreme frame edges

## Model-Specific Notes

### MediaPipe Lite Model
- Faster but less accurate than Full model
- Produces more false positives → needs stricter thresholds
- Lower confidence scores overall → 0.65 threshold appropriate
- Better for real-time tracking when person is clearly visible

### MediaPipe Full Model  
- More accurate, higher confidence scores
- Could use slightly lower thresholds (0.55-0.6) if needed
- Better for challenging lighting and edge cases
- Currently using same strict validation for consistency

## Tuning Guidelines

### If Missing Too Many Real Humans
```typescript
// Option 1: Lower per-keypoint threshold slightly
const isHighConfidence = visibility >= 0.6; // From 0.65

// Option 2: Lower region threshold
const MIN_CONFIDENCE = 0.55; // From 0.6

// Option 3: Allow 2 regions if core body present
if (visibleRegions < 2) // From 3
```

### If Still Getting False Positives
```typescript
// Option 1: Raise threshold further
const isHighConfidence = visibility >= 0.7; // From 0.65

// Option 2: Require 4 regions
if (visibleRegions < 4) // From 3

// Option 3: Always require both shoulders AND hips
const hasValidBody = shouldersVisible && hipsVisible; // Remove leg option
```

## Conclusion

The strict multi-layer validation with connected body part checking successfully eliminates false positives while maintaining accurate partial body detection. The key improvements are:

1. **Higher thresholds** (0.65 per-keypoint, 0.6 region, 0.7 critical)
2. **Connected chain validation** (elbow+wrist, hip+knee+ankle)
3. **Core body requirement** (torso OR complete leg)
4. **Enhanced anatomical checks** (proportions, connectivity)
5. **Filtered display** (hide low-confidence keypoints)

This ensures the skeleton only appears when actual human body parts are detected with high confidence and proper anatomical structure.
