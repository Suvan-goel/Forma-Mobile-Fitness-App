# Barbell Curl Form Analysis — Technical Specification

## Overview

Forma uses on-device pose estimation (MediaPipe BlazePose Full) to detect barbell curl reps and evaluate form in real time. The system is fully deterministic — no ML inference for form scoring. It runs at ~30fps analysis with 10fps UI updates to keep the interface responsive.

---

## 1. Data Flow

```
Camera (native)
  → MediaPipe BlazePose Full (33 landmarks, on-device)
  → NativeEventEmitter ("onLandmark") / iOS onLandmark callback
  → CameraScreen.handleLandmark()
  → convertLandmarksToKeypoints()        // normalize to { name, x, y, z, score }
  → updateBarbellCurlState()             // FSM + form evaluation
  → flushPendingUI()                     // batched React state updates
  → UI: rep count, form score, feedback text
  → handleRecordPress() on stop          // finalize set
  → addSetToExercise()                   // persist to CurrentWorkoutContext
  → SetNotesModal                        // per-rep breakdown + summary
```

### Key files

| File | Role |
|------|------|
| `src/screens/CameraScreen.tsx` | Orchestrates camera, landmark handling, recording, and set finalization |
| `src/utils/barbellCurlHeuristics.ts` | All curl-specific logic: angles, FSM, form evaluation, scoring |
| `src/utils/poseAnalysis.ts` | Shared math: angle calculations, keypoint utilities, exercise detection |
| `src/utils/setNotesSummary.ts` | Generates natural language summary from per-rep feedback |
| `src/components/ui/SetNotesModal.tsx` | Displays per-rep breakdown and summary |
| `src/contexts/CurrentWorkoutContext.tsx` | Stores workout exercises and sets (including per-rep data) |

### Performance architecture

The system uses a **three-tier update strategy** to avoid blocking the JS thread:

1. **Analysis tier (~30fps)**: `handleLandmark` runs angle calculations and FSM updates. Writes to `pendingUIStateRef` (a mutable ref — no React re-render).
2. **UI tier (~10fps)**: `flushPendingUI` batches pending updates into React state via `InteractionManager.runAfterInteractions`, keeping button presses responsive.
3. **Accumulator tier (synchronous)**: `accumulatedFormScoresRef` and `accumulatedRepFeedbackRef` are updated directly in `handleLandmark` when a rep completes. These refs are immune to the InteractionManager deferral, ensuring `handleRecordPress` always has the latest per-rep data.

---

## 2. Landmark Processing

MediaPipe provides 33 landmarks per frame. The system uses these keypoints:

| Keypoint | Used for |
|----------|----------|
| `left_shoulder`, `right_shoulder` | Elbow angle, shoulder flexion, torso midline, coronal axis |
| `left_elbow`, `right_elbow` | Elbow angle (primary FSM driver) |
| `left_wrist`, `right_wrist` | Elbow angle, wrist neutrality |
| `left_hip`, `right_hip` | Torso angle, shoulder flexion reference |
| `left_index`, `right_index` | Wrist angle (elbow-wrist-finger) |
| `nose`, `left_ear`, `right_ear` | Midline torso upper anchor (head stays stable during curls) |

### Visibility gating

Each keypoint must have `visibility > 0.1` (lowered from default 0.5 for better side-on detection). Both sides must be visible for angle calculation; if only one side is visible, the system uses NaN and falls back to the previous smoothed value.

---

## 3. Angle Computation

Eight angles are computed per frame:

| Angle | Calculation | Purpose |
|-------|------------|---------|
| **Left/Right Elbow** | `calculateAngle2D(shoulder, elbow, wrist)` | FSM driver — determines curl phase |
| **Left/Right Shoulder** | `calculateShoulderFlexionAngle(hip, shoulder, elbow, oppShoulder)` | Detect elbow drift / shoulder takeover |
| **Left/Right Torso** | `calculateSignedVerticalAngle(hip, shoulder)` | Per-side lean (legacy, used alongside midline) |
| **Midline Torso** | `calculateSignedVerticalAngleSagittal(hipCenter, headPoint, ...)` | Primary swing detection — rotation-invariant |
| **Left/Right Wrist** | `calculateAngle(elbow, wrist, index)` | Wrist neutrality (currently disabled for feedback) |

### Why 2D for elbows?

`calculateAngle2D` ignores the Z axis. MediaPipe's depth (Z) is estimated from a single camera and can be noisy, especially when the arm is perpendicular to the camera. The 2D projection onto the XY plane matches what the user sees on screen, giving more stable elbow angle readings.

### Why sagittal projection for torso?

`calculateSignedVerticalAngleSagittal` projects the torso vector onto the person's own sagittal plane (perpendicular to the left-right hip/shoulder axis). This removes the effect of body rotation (yaw) — if the person is slightly turned, the raw vertical angle would show false lean. The sagittal projection isolates actual forward/backward swing.

The upper anchor uses the **head** (nose or mid-ear) instead of the shoulder center, because shoulder landmarks drift forward/back with arm movement during curls. The head stays relatively stable.

### Why shoulder flexion projection?

`calculateShoulderFlexionAngle` projects the upper arm vector onto the sagittal plane before measuring against the torso. Without this, lateral arm position (abduction) would register as shoulder flexion, causing false "elbows moving" warnings when the user simply has arms slightly out to the sides.

---

## 4. Signal Smoothing

Raw angles are noisy. Two-stage smoothing reduces jitter without adding significant latency:

1. **Median filter** (window = 5 frames): Removes outlier spikes. Each angle maintains a circular buffer of the last 5 raw values; the median is used as the filtered value.

2. **Exponential Moving Average** (alpha = 0.3): Smooths the median-filtered signal. `smoothed = 0.3 * median + 0.7 * previous`. Alpha of 0.3 provides responsive tracking (~3 frame effective lag) while eliminating most frame-to-frame noise.

If an angle becomes NaN (keypoint lost), the previous smoothed value is held rather than introducing a discontinuity.

---

## 5. Finite State Machine (FSM)

Each arm has an independent 4-state FSM:

```
REST ──→ UP ──→ TOP ──→ DOWN ──→ REST
 │                                  │
 └──────────────────────────────────┘
```

### State transitions

| From | To | Condition |
|------|----|-----------|
| REST | UP | Elbow angle < 145° (arm starting to bend) |
| UP | TOP | Elbow angle < 70° (fully curled) |
| TOP | DOWN | Elbow angle > 75° (starting to lower) |
| DOWN | REST | Elbow angle > 150° AND elapsed > 0.45s since REST→UP |

### Hysteresis

Entry and exit thresholds differ slightly (e.g. FLEXED_ENTER=70°, FLEXED_EXIT=75°) to prevent oscillation at boundary angles.

### Minimum rep time

The DOWN→REST transition requires at least 0.45 seconds since the rep started (REST→UP). This prevents counting arm repositioning or partial movements as reps.

### Two-arm synchronization

A rep is counted only when **both arms** reach REST within 0.35 seconds of each other. This ensures bilateral barbell curls are counted correctly — one arm finishing significantly before the other suggests an asymmetric movement (which still gets feedback but isn't double-counted).

---

## 6. Rep Window

During a rep (either arm not in REST), a `RepWindow` accumulates:

- **Min/max of all 8 angles** — used by form evaluation to determine range of motion, torso swing magnitude, shoulder movement, etc.
- **Start/end timestamps** — for tempo calculation
- **Wrist deviation frame count** — tracks how many frames the wrist was bent beyond threshold

The rep window is created when either arm leaves REST and destroyed when the rep completes or the arms desync.

---

## 7. Form Evaluation

When a rep completes, `evaluateForm()` analyzes the rep window and arm FSM data:

### Scoring (starts at 100, penalties subtracted)

| Check | Condition | Penalty | Feedback |
|-------|-----------|---------|----------|
| **Incomplete flexion** | Min elbow > 70° | -30 | "Flex more at the top of the curl." |
| **Incomplete extension** | Max elbow < 150° | -30 | "Extend fully at the bottom." |
| **Low ROM** | ROM < 80° (and no flex/extend issue) | -30 | "Incomplete rep — curl all the way up and fully extend." |
| **Shoulder fail** | Shoulder delta > 65° | -25 | "Too much shoulder involvement — reduce the weight." |
| **Shoulder warn** | Shoulder delta > 45° | -15 | "Upper arms moving — keep elbows pinned to your sides." |
| **Torso fail** | Midline torso delta > 22° | -25 | "Excessive body swing — this is cheating the rep." |
| **Torso warn** | Midline torso delta > 12° | -15 | "Don't swing your torso — stay upright and controlled." |
| **Fast concentric** | Up phase < 0.05s | -10 | "Slow down — control the curl." |
| **Fast eccentric** | Down phase < 0.20s | -10 | "Control the lowering — don't drop the weight." |
| **Asymmetry** | Elbow min delta > 50° or ROM delta > 55° | -10 | "Arms are uneven — curl both sides together." |

Score is clamped to [0, 100]. If no issues are found, the feedback is "Great rep!".

### Why these thresholds?

- **Torso 12°/22°**: A 12° forward lean is visible but minor — worth a heads-up. Beyond 22° the momentum is doing significant work. These were tuned from testing with intentional swing vs. strict form.
- **Shoulder 45°/65°**: The sagittal projection isolates flexion, so >45° of shoulder movement genuinely means the upper arm is swinging forward (not just lateral positioning).
- **ROM 80°**: A full barbell curl typically has 100-120° ROM. Below 80° suggests a half-rep.
- **Tempo 0.05s/0.20s**: Near-zero up time means a ballistic swing. The eccentric threshold is higher because controlled lowering is important for muscle engagement.

---

## 8. Per-Rep Data Storage

Each rep's form score and feedback message are accumulated in synchronous refs during recording:

```typescript
// In handleLandmark, when rep completes:
accumulatedFormScoresRef.current = [...accumulatedFormScoresRef.current, currentScore];
accumulatedRepFeedbackRef.current = [...accumulatedRepFeedbackRef.current, currentFeedback ?? 'Great rep!'];
```

When recording stops, `handleRecordPress` reads these refs to build the `LoggedSet`:

```typescript
const newSet = {
  exerciseName: 'Barbell Curl',
  reps: totalReps,
  formScore: avgFormScore,          // mean of all per-rep scores
  repFeedback: repFeedback,         // string[] — one entry per rep
  repFormScores: formScores,        // number[] — parallel array
};
```

### Why synchronous refs instead of React state?

The UI state updates are deferred via `InteractionManager.runAfterInteractions` to keep buttons responsive. But this creates a race condition: when the user taps stop, the deferred updates may not have been applied yet. The synchronous refs bypass this deferral entirely — they're updated directly in the landmark handler callback and always contain the latest data.

---

## 9. Set Notes & Summary

The `SetNotesModal` displays:

1. **Per-rep breakdown**: Each rep shows its form score and feedback message.
2. **Form summary**: Generated by `generateSetSummary()`, which:
   - Splits multi-line feedback (joined by `\n`) into individual messages
   - Counts good vs. problematic reps
   - Maps feedback strings to actionable improvement suggestions via `FEEDBACK_TO_IMPROVEMENT`
   - Produces a natural language paragraph

---

## 10. Optimizations That Improved Form Analysis

### Problem: False torso swing warnings
**Root cause**: The original torso angle used `calculateSignedVerticalAngle(hip, shoulderCenter)`. When the arms moved forward during a curl, the shoulder center shifted forward too, registering as torso lean.
**Fix**: Changed the upper anchor from shoulder center to the **head** (nose/mid-ear), which doesn't move with the arms. Also switched to sagittal plane projection (`calculateSignedVerticalAngleSagittal`) to eliminate false lean from body rotation.

### Problem: False shoulder warnings
**Root cause**: The shoulder angle used a basic 3D dot product between hip-shoulder and shoulder-elbow. When the user's arms were slightly abducted (out to the sides — common with a barbell), it measured both lateral and forward movement, triggering false warnings.
**Fix**: Added `calculateShoulderFlexionAngle` which projects the upper arm onto the sagittal plane before measuring, isolating true flexion from abduction.

### Problem: Noisy angles causing phantom reps
**Root cause**: Single-frame angle spikes (from keypoint jitter) could briefly cross FSM thresholds, causing state transitions.
**Fix**: Two-stage smoothing (median filter + EMA) removes spikes while keeping latency under 3 frames. Hysteresis on FSM thresholds prevents oscillation at boundaries.

### Problem: Camera preview going black on Android
**Root cause**: The Choreographer frame callback that drove `manuallyLayoutChildren()` stopped posting when the CameraFragment was created. The PreviewView (SurfaceView) needed continued layout passes to create its surface.
**Fix**: Keep the frame callback running always for layout, but only call `dispatchOnGlobalLayout()` before the fragment exists (to avoid interfering with the camera session).

### Problem: Confidence thresholds too strict for side-on views
**Root cause**: Default BlazePose confidence of 0.5 caused leg and hip keypoints to be filtered out when the user was at an angle to the camera, which is common when filming a curl from the side.
**Fix**: Lowered detection/tracking/presence confidence from 0.5 to 0.35 in both Android (`PoseLandmarkerHelper.kt`) and iOS (`DefaultConstants.swift`).

### Problem: Per-rep data lost when stopping recording
**Root cause**: `flushPendingUI` cleared the pending ref and deferred `setWorkoutData` via `InteractionManager.runAfterInteractions`. When the user pressed stop, the pending ref was null and the state hadn't been updated yet.
**Fix**: Added synchronous accumulator refs (`accumulatedFormScoresRef`, `accumulatedRepFeedbackRef`) updated directly in `handleLandmark`, bypassing the deferred state pipeline.

### Problem: Android frame processing latency
**Root cause**: CameraX was sending every frame to MediaPipe, causing a processing queue buildup. Frames would arrive faster than they could be analyzed, increasing latency.
**Fix**: Added frame throttling in `CameraFragment.kt` — frames are skipped if less than `1000/frameLimit` ms have elapsed since the last processed frame. Default is 20fps, configurable via the `frameLimit` prop.
