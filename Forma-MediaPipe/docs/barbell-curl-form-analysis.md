# Barbell Curl Form Analysis — Technical Specification

## Overview

Forma uses on-device pose estimation (MediaPipe BlazePose) to detect barbell curl reps and evaluate form in real time. The system is fully deterministic - no ML inference for form scoring. It runs at ~30fps analysis with throttled UI updates to keep the interface responsive.

Front view is the full-scoring target because both arms are visible for bilateral ROM, symmetry, and elbow-flare checks. Side or oblique views are supported as limited-signal fallback captures: reps can count from the visible primary arm, and only visible-arm cues are scored.

---

## 1. Data Flow

```
Camera (native)
  → MediaPipe BlazePose Full (33 landmarks, on-device)
  → NativeEventEmitter ("onLandmark") / iOS onLandmark callback
  → CameraScreen.handleLandmark()
  → convertLandmarksToKeypoints()        // normalize image + world landmarks
  → ExerciseRegistry.get('Barbell Curl')
  → barbellCurlDefinition.update()       // FSM + form evaluation
  → flushPendingUI()                     // batched React state updates
  → UI: rep count, form score, feedback text
  → handleRecordPress() on stop          // finalize set
  → addSetToExercise()                   // persist to CurrentWorkoutContext
  → SetNotesModal                        // per-rep breakdown + summary
```

### Key files

| File | Role |
|------|------|
| `src/frontend/screens/CameraScreen.tsx` | Orchestrates camera, landmark handling, recording, and set finalization |
| `src/utils/exercises/definitions/barbellCurl.ts` | Curl-specific logic: ratios, view handling, FSM, form evaluation, scoring, diagnostics |
| `src/utils/exercises/shared/poseQuality.ts` | Per-frame and per-rep tracking/scorable quality gates |
| `src/utils/exercises/replay/replayRunner.ts` | Offline replay path used by tests and dataset tooling |
| `src/utils/poseAnalysis.ts` | Shared math: angle calculations, keypoint utilities, exercise detection |
| `src/utils/setNotesSummary.ts` | Generates natural language summary from per-rep feedback |
| `src/frontend/contexts/CurrentWorkoutContext.tsx` | Stores workout exercises and sets, including per-rep data |

### Performance architecture

The system uses a **three-tier update strategy** to avoid blocking the JS thread:

1. **Analysis tier (~30fps)**: `handleLandmark` runs angle calculations and FSM updates. Writes to `pendingUIStateRef` (a mutable ref — no React re-render).
2. **UI tier (~10fps)**: `flushPendingUI` batches pending updates into React state via `InteractionManager.runAfterInteractions`, keeping button presses responsive.
3. **Accumulator tier (synchronous)**: `accumulatedFormScoresRef` and `accumulatedRepFeedbackRef` are updated directly in `handleLandmark` when a rep completes. These refs are immune to the InteractionManager deferral, ensuring `handleRecordPress` always has the latest per-rep data.

---

## 2. Landmark Processing

MediaPipe provides image landmarks and, when available, world landmarks. Curl mechanics prefer world landmarks for camera-angle-robust ratio and view calculations, with image landmarks as fallback.

| Keypoint | Used for |
|----------|----------|
| `left_shoulder`, `right_shoulder` | Reach ratio, shoulder flexion, torso midline, view angle |
| `left_elbow`, `right_elbow` | Reach ratio and debug elbow angle |
| `left_wrist`, `right_wrist` | Reach ratio |
| `left_hip`, `right_hip` | Torso angle, shoulder flexion reference |

### Visibility gating

Each mechanics keypoint must have `visibility > 0.15`. Front-view full scoring needs bilateral arm support. Side/oblique scoring can use the visible primary arm, while front-only cues such as asymmetry and elbow flare are marked ineligible outside confirmed front-view reps.

---

## 3. Angle Computation

The primary FSM and ROM signal is the normalized reach ratio:

```
dist(shoulder, wrist) / (dist(shoulder, elbow) + dist(elbow, wrist))
```

Approximate interpretation:

- Fully extended arm: about `0.95-1.0`
- Fully curled top position: about `0.40-0.55`

This ratio is more camera-angle tolerant than raw elbow angle because foreshortening affects the numerator and denominator together.

The implementation also computes supporting angular metrics:

| Metric | Calculation | Purpose |
|--------|-------------|---------|
| **Left/Right Reach Ratio** | normalized shoulder-wrist reach | FSM driver, ROM, flexion and extension checks |
| **Left/Right Elbow** | `calculateAngle2D(shoulder, elbow, wrist)` | Debug/diagnostic display |
| **Left/Right Shoulder** | `calculateShoulderFlexionAngle(hip, shoulder, elbow, oppShoulder)` | Detect elbow drift / shoulder takeover |
| **Midline Torso** | sagittal hip-center to shoulder-center angle | Detect forward/backward body swing |
| **Elbow Flare** | upper-arm angle from vertical in the frontal plane | Detect lateral elbow flare on confirmed front-view reps |

### Why 2D for elbows?

The old elbow-angle FSM was replaced by reach ratio. Elbow angle is still useful in debug output, but production counting and ROM feedback are ratio-based.

### Why sagittal projection for torso?

`calculateSignedVerticalAngleSagittal` projects the torso vector onto the person's own sagittal plane (perpendicular to the left-right hip/shoulder axis). This removes the effect of body rotation (yaw) — if the person is slightly turned, the raw vertical angle would show false lean. The sagittal projection isolates actual forward/backward swing.

The current torso anchor is the shoulder center, projected into the person's sagittal plane. This avoids most yaw-related false lean while keeping the signal available when head landmarks are noisy.

### Why shoulder flexion projection?

`calculateShoulderFlexionAngle` projects the upper arm vector onto the sagittal plane before measuring against the torso. Without this, lateral arm position (abduction) would register as shoulder flexion, causing false "elbows moving" warnings when the user simply has arms slightly out to the sides.

---

## 4. Signal Smoothing

Raw angles are noisy. Two-stage smoothing reduces jitter without adding significant latency:

1. **Median filter** (window = 4 frames): Removes outlier spikes. Each metric maintains a circular buffer of recent raw values; the median is used as the fast value for FSM transitions.

2. **Exponential Moving Average** (alpha = 0.4): Smooths the median-filtered signal for UI and form metric accumulation.

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
| REST | UP | reach ratio falls below `EXTENDED_EXIT` after a full extension has been seen |
| UP | TOP | reach ratio falls below `FLEXED_ENTER` |
| TOP | DOWN | reach ratio rises above `FLEXED_EXIT` or rebounds by `FLEXED_EXIT_DELTA` |
| DOWN | REST | reach ratio rises above `EXTENDED_ENTER`, minimum rep time has elapsed, and the down guard has passed |

### Hysteresis

Entry and exit thresholds differ slightly to prevent oscillation at boundary ratios.

### Minimum rep time

The DOWN→REST transition requires a minimum rep time and a short DOWN-state guard. Timing uses native frame timestamps when available, falling back to JS time only if the native payload does not include `timestampMs`.

### Two-arm synchronization

In confirmed front view, both arms must participate for the rep to count. Desynced but participating arms count once and receive asymmetry diagnostics. In side/oblique view, the selected visible primary arm drives counting.

---

## 6. Rep Window

During a rep (either arm not in REST), a `RepWindow` accumulates:

- **Min/max reach ratios** - used for range of motion, flexion, and extension checks
- **Min/max supporting angles** - used for torso swing, shoulder movement, and elbow flare
- **Start/end timestamps** — for tempo calculation
- **View and sample support** - used to mark reps scorable or unscorable

The rep window is created when either arm leaves REST and destroyed when the rep completes or the arms desync.

---

## 7. Form Evaluation

When a rep completes, `evaluateForm()` analyzes the rep window and arm FSM data:

### Scoring (starts at 100, penalties subtracted)

| Check | Condition | Penalty | Feedback |
|-------|-----------|---------|----------|
| **Incomplete flexion** | min reach ratio above `FLEX_RATIO_WARN` | continuous | "Flex more at the top of the curl." |
| **Incomplete extension** | return max ratio below `EXTEND_RATIO_WARN` | continuous | "Extend fully at the bottom." |
| **Low ROM** | ROM ratio below `ROM_MIN` and no clearer endpoint issue | continuous | "Incomplete rep — curl all the way up and fully extend." |
| **Shoulder fail/warn** | shoulder delta above tuned thresholds | continuous | shoulder-involvement feedback |
| **Torso fail/warn** | torso delta above tuned thresholds | continuous | torso-swing feedback |
| **Elbow flare** | sustained frontal-plane upper-arm flare | continuous | elbow-flare feedback |
| **Fast concentric/eccentric** | phase duration below tuned thresholds | continuous | tempo feedback |
| **Asymmetry** | bilateral ratio/ROM/sync mismatch in confirmed front view | continuous | "Arms are uneven — curl both sides together." |

Score is clamped to [0, 100]. If no issues are found, the feedback is "Great rep!".

### Why these thresholds?

Thresholds live in `src/utils/exercises/definitions/tuned/barbellCurl.json` and can be updated by the dataset optimizer. The default implementation exposes FSM, feedback, and view-quality tunables, while score penalty curves remain guarded by config validation.

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
