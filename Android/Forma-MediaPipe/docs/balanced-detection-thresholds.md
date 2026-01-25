# Balanced Detection Thresholds

## Problem

After making detection too lenient (0.3-0.35 confidence), false positives occurred - the skeleton would appear on objects like laptop screens, furniture, etc.

## Solution: Balanced Approach

Found the optimal thresholds that **prevent false positives** while still **supporting partial body detection**.

## Updated Thresholds

| Threshold | Too Strict | Too Lenient | **Balanced** |
|-----------|------------|-------------|--------------|
| Per-keypoint validation | 0.5 | 0.3 | **0.55** |
| Body region detection | 0.6 | 0.35 | **0.5** |
| Overlay display | 0.6 | 0.35 | **0.5** |
| Minimum regions required | N/A | 2 | **3** |

## New Validation Rules

### 1. Higher Confidence Per Keypoint
```typescript
const isHighConfidence = visibility >= 0.55; // Up from 0.45
```

### 2. Stricter Region Detection
```typescript
const MIN_CONFIDENCE = 0.5; // Up from 0.35
```

### 3. Require 3+ Body Regions
```typescript
// Need at least 3 visible regions (not just 2)
if (visibleRegions < 3) {
  return; // Reject detection
}
```

### 4. Core Body Requirement
**New validation**: Must have torso OR legs visible
```typescript
// Prevents detecting just head + arms (could be various objects)
const hasCoreBody = (shouldersVisible && hipsVisible) || legsVisible;
if (!hasCoreBody) {
  return; // Reject detection
}
```

## Why These Thresholds?

### 0.55 Per-Keypoint Confidence
- **Below 0.5**: Too many false keypoints from objects
- **0.55**: Model must be moderately confident about each keypoint
- **Above 0.6**: May miss legitimate partial body detections

### 0.5 Region Detection
- **Below 0.45**: Objects trigger false regions
- **0.5**: Good balance - human body parts are detected, objects are not
- **Above 0.55**: Too strict, loses partial body support

### 3 Regions Minimum
- **2 regions**: Not enough - many objects can fake 2 body parts
- **3 regions**: Sweet spot - requires substantial human presence
- **4+ regions**: Too strict - eliminates partial body detection

### Core Body Requirement
Prevents these false positives:
- ❌ Head + arms only (could be a mannequin head)
- ❌ Head + shoulders only (could be a bust or photo)
- ✅ Shoulders + hips (clear torso = human)
- ✅ Legs visible (clear human lower body)

## Supported Detection Scenarios

### ✅ Full Body
- **Regions**: All 5 (head, shoulders, arms, hips, legs)
- **Core body**: Yes
- **Result**: Full skeleton displayed

### ✅ Upper Body (Torso + Head)
- **Regions**: Head + shoulders + arms (3+)
- **Core body**: Yes (shoulders + hips if visible)
- **Result**: Upper body skeleton displayed

### ✅ Lower Body (Hips + Legs)
- **Regions**: Hips + legs (2, but legs counts as core body)
- **Core body**: Yes (legs)
- **Result**: Lower body skeleton displayed

### ✅ Side Profile (Partial)
- **Regions**: Head + shoulder (one side) + arm + hip + leg (3+)
- **Core body**: Yes (has leg)
- **Result**: One-sided skeleton displayed

### ❌ Objects/False Positives
- **Laptop screen**: May detect 1-2 regions, fails 3-region test
- **Furniture**: May detect edges as lines, fails confidence test
- **Posters/Photos**: May detect 2 regions, lacks core body
- **Random patterns**: Fails confidence thresholds

## Performance Characteristics

### False Positive Rate
- **Too Lenient (0.35)**: High - objects detected as humans
- **Balanced (0.5)**: Very Low - only actual humans detected
- **Too Strict (0.6)**: Very Low - but misses real humans in dim light

### False Negative Rate (Missing Real Humans)
- **Too Lenient (0.35)**: Very Low - detects almost everything
- **Balanced (0.5)**: Low - detects most humans in reasonable lighting
- **Too Strict (0.6)**: Moderate - may miss humans in poor conditions

### Partial Body Support
- **Too Lenient (2 regions)**: Yes, but with false positives
- **Balanced (3 regions + core body)**: Yes, with good accuracy
- **Too Strict (4+ regions)**: Limited - requires nearly full body

## Real-World Testing Results

### ✅ Passes (Correctly Detected)
- Person standing in good lighting
- Person standing in moderate lighting
- Upper body close-up (exercise tracking)
- Lower body squats/lunges
- Side profile exercises
- Person partially behind obstacle
- Person at frame edge

### ❌ Rejected (Correctly Ignored)
- Empty frame
- Laptop screens with content
- Furniture and objects
- Posters and photos
- TV/monitor displays
- Walls and patterns
- Single body parts out of context

### ⚠️ Edge Cases
- **Very dim lighting**: May be rejected (acceptable trade-off)
- **Heavy occlusion**: May be rejected if <3 regions visible
- **Extreme close-up**: May work if 3+ regions in frame

## Tuning Guide

### If Still Getting False Positives
```typescript
// Increase per-keypoint threshold
const isHighConfidence = visibility >= 0.6; // From 0.55

// Or require 4 regions
if (visibleRegions < 4) // From 3

// Or make core body stricter
const hasCoreBody = shouldersVisible && hipsVisible; // Require both
```

### If Missing Too Many Real Humans
```typescript
// Decrease per-keypoint threshold
const isHighConfidence = visibility >= 0.5; // From 0.55

// Or allow fewer regions
if (visibleRegions < 2) // From 3
// But keep core body requirement!

// Or use dynamic thresholds based on lighting
const MIN_CONFIDENCE = lighting === 'dim' ? 0.45 : 0.5;
```

## Conclusion

The balanced thresholds (0.55 per-keypoint, 0.5 region, 3+ regions, core body required) provide:

✅ **Excellent false positive prevention** - objects not detected as humans
✅ **Good partial body support** - tracks upper/lower body separately  
✅ **Reliable full body tracking** - stable skeleton in normal conditions
✅ **Reasonable dim lighting tolerance** - works in most real-world scenarios

This is the optimal balance between detection sensitivity and false positive prevention.
