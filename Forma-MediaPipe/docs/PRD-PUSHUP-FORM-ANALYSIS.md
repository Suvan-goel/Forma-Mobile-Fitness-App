# PRD: Pushup Form Analysis

**Document Version:** 1.0
**Date:** 2026-02-14
**Status:** Draft — Awaiting Additional Implementation Notes
**Branch:** `pushupsfeature`

---

## 1. Overview

Add real-time pushup rep counting and form analysis to Forma, using the same on-device MediaPipe BlazePose pipeline that powers barbell curl analysis. The user places their phone to the side (perpendicular to their body) to capture a side-view of the pushup. The system detects reps via a 4-state FSM, evaluates form per-rep, and displays visual feedback — mirroring the curl UX.

### Scope

| In Scope | Out of Scope (v1) |
|----------|-------------------|
| Standard pushup (floor) | Knee, wide, diamond, deficit, weighted variations |
| Side-view camera only | Front-view, auto-detect camera orientation |
| Full form analysis (depth, hip alignment, head position, tempo, lockout, ROM consistency) | Elbow flare detection (unreliable from side view) |
| Per-rep visual feedback bubble (same as curls) | — |
| TTS coaching (same architecture as curls — via `ttsCoach.ts` + `ttsMessagePools.ts`) | — |
| Per-rep scoring and set summary | Left/right symmetry detection (single side visible) |
| Text-only camera setup instructions | Visual guide overlay or landmark validation gate |

---

## 2. Success Criteria

| Criterion | Verification |
|-----------|-------------|
| Pushup reps are counted accurately (±1 over a 20-rep set) | Manual comparison with video playback |
| Form score reflects actual form quality | Test with intentional bad form (hip sag, shallow depth, fast reps) and verify penalties fire |
| Feedback messages are actionable and accurate | No false positives on good-form reps; bad-form reps get specific, correct feedback |
| No regression on barbell curl analysis | Run curl set, verify identical behavior to pre-change |
| No iOS or Android build breakage | `npx expo prebuild --platform ios --clean` and `npx expo run:android` succeed |
| TTS speaks highest-priority issue per rep | Do bad-form pushup → hear corrective cue; do good-form pushup → hear praise at adaptive interval |
| TTS doesn't interrupt camera | Audio uses `interruptionModeIOS: MixWithOthers`; camera feed stays active during speech |
| Per-rep data persists to set notes | `SetNotesModal` shows per-rep breakdown with pushup-specific feedback |

---

## 3. Data Flow

The pushup feature reuses the existing Forma pipeline end-to-end. Only the heuristics module is new.

```
Camera (native, side-view)
  -> MediaPipe BlazePose Full (33 landmarks, on-device)
  -> NativeEventEmitter ("onLandmark") / iOS onLandmark callback
  -> CameraScreen.handleLandmark()
  -> convertLandmarksToKeypoints()               // REUSED — no changes
  -> updatePushupState()                          // NEW — pushupHeuristics.ts
  -> flushPendingUI()                             // REUSED — no changes
  -> UI: rep count, form score, feedback bubble   // REUSED — no changes
  -> handleRecordPress() on stop                  // REUSED — no changes
  -> addSetToExercise()                           // REUSED — no changes
  -> SetNotesModal                                // MINOR UPDATE — feedback mapping
```

### Reuse summary

| Component | Status | Changes Needed |
|-----------|--------|----------------|
| MediaPipe + `convertLandmarksToKeypoints()` | Reuse as-is | None |
| `poseAnalysis.ts` math functions | Reuse as-is | None — all angle functions are generic |
| Three-tier update architecture (analysis/UI/accumulator) | Reuse as-is | None |
| `CurrentWorkoutContext.tsx` | Reuse as-is | None — already generic |
| `ttsCoach.ts` | Reuse as-is | None — exercise-agnostic coaching engine |
| `elevenlabsTTS.ts` | Reuse as-is | None — low-level audio playback |
| Navigation / route params | Reuse as-is | `exerciseName` already passed through |
| `CameraScreen.tsx` | Modify | Add `else if` branch for pushup + generalize curl-specific gates |
| `setNotesSummary.ts` | Modify | Add pushup feedback-to-improvement mappings |
| `SetNotesModal.tsx` | Modify | Remove hardcoded "Barbell Curl" text |
| `ttsMessagePools.ts` | Modify | Add pushup `FEEDBACK_TO_ISSUE` mappings, new issue types + message pools |
| `pushupHeuristics.ts` | **New file** | Full FSM, angle calculation, form evaluation, scoring |

---

## 4. Camera Setup — Side View

### Why side view?

Pushups are performed horizontally. A side-view camera (phone perpendicular to the user's body, at floor level or slightly elevated) provides clear visibility of:
- Elbow flexion angle (depth detection)
- Shoulder-hip-ankle alignment (hip sag/pike detection)
- Head/neck position relative to spine
- Full body line for plank quality

A front-view cannot reliably detect depth or body alignment for pushups.

### User instructions (text only, v1)

When the user selects "Push-Up" and enters the camera screen, display a brief instruction before recording:

> **Setup:** Place your phone to your side so your full body is visible from head to feet. Position at floor level for best results.

This replaces the curl's implicit assumption of front-facing camera. No landmark validation gate in v1 — we rely on text instructions.

---

## 5. Landmark Usage

Side-view pushup analysis uses a different subset of MediaPipe landmarks than curls:

| Keypoint | Used For |
|----------|----------|
| `left_shoulder` / `right_shoulder` | Elbow angle, body alignment upper reference, lockout detection |
| `left_elbow` / `right_elbow` | Elbow angle (FSM driver — depth detection) |
| `left_wrist` / `right_wrist` | Elbow angle endpoint, hand placement reference |
| `left_hip` / `right_hip` | Body alignment midpoint (hip sag/pike detection) |
| `left_ankle` / `right_ankle` | Body alignment lower reference (plank line endpoint) |
| `nose` | Head/neck position relative to spine |

### Visible-side selection

From a side view, one side of the body is closer to the camera and has better landmark confidence. The system should detect which side is more visible (higher average keypoint confidence) and use that side's landmarks for elbow angle and body alignment. This is simpler than the curl's two-arm approach — pushups move both arms together, so one side is representative.

### Visibility thresholds

Use the same lowered confidence threshold as curls: `visibility > 0.1` (lowered from 0.5 for side-on detection, per existing `DefaultConstants.swift` / `PoseLandmarkerHelper.kt` patches).

---

## 6. Angle Computation

Five primary angles computed per frame:

| Angle | Calculation | Purpose |
|-------|------------|---------|
| **Elbow angle** | `calculateAngle2D(shoulder, elbow, wrist)` | FSM driver — determines pushup phase (extended vs. flexed) |
| **Body alignment (angle)** | `calculateAngle(shoulder, hip, ankle)` | Primary hip sag/pike detection — straight plank ≈ 180° |
| **Body alignment (deviation)** | Perpendicular distance from hip to shoulder-ankle line | Secondary hip sag/pike cross-check — deviation in pixels |
| **Head-spine angle** | `calculateAngle2D(hip, shoulder, nose)` | Head drop / neck extension detection |
| **Tempo** | Timestamps from FSM transitions | Concentric/eccentric speed |

### Why 2D for elbows (same rationale as curls)?

From side view, the elbow flexion is primarily in the XY plane. Z-axis noise from single-camera depth estimation would add jitter. `calculateAngle2D` provides stable readings.

### Body alignment — dual metric (angle + deviation)

**Primary: Shoulder-Hip-Ankle angle**
- Straight plank: ~170-180° (slight natural lordosis is normal)
- Hip sag: angle drops below ~165° (hip drops below the shoulder-ankle line)
- Hip pike: angle rises above ~190° or hip visibly rises above the line

**Secondary: Hip perpendicular deviation**
- Measure the perpendicular distance from the hip keypoint to the line connecting shoulder and ankle
- Positive = sag (hip below line), Negative = pike (hip above line)
- Used as cross-validation — if angle says sag but deviation is minimal, suppress the warning (noise)

### Reusable math from `poseAnalysis.ts`

All angle calculation functions already exist:
- `calculateAngle2D()` — for elbow angle
- `calculateAngle()` — for shoulder-hip-ankle body line angle
- `getKeypoint()` — keypoint lookup by name
- `isVisible()` — visibility check

New utility needed: perpendicular distance from point to line (for hip deviation metric). This is a simple geometric calculation to add to `poseAnalysis.ts` or keep local to `pushupHeuristics.ts`.

---

## 7. Signal Smoothing

Reuse the same two-stage smoothing pipeline from curls:

1. **Median filter** (window = 5 frames) — removes outlier spikes
2. **EMA** (alpha = 0.3) — smooths remaining noise, ~3 frame effective lag

Applied independently to each angle (elbow, body alignment, head-spine). If a keypoint is lost (NaN), hold the previous smoothed value.

The smoothing state structure (`MedianWindow` + `EMAState` per angle) is implemented identically to curls — just with different angle inputs.

---

## 8. Finite State Machine (FSM)

Single whole-body FSM with 4 states (mirrors the curl pattern per the user's decision):

```
PLANK ──> DESCENDING ──> BOTTOM ──> ASCENDING ──> PLANK
  |                                                  |
  └──────────────────────────────────────────────────┘
                       (rep counted here)
```

### State transitions

| From | To | Condition |
|------|----|-----------|
| PLANK | DESCENDING | Elbow angle < 160° (arms starting to bend from lockout) |
| DESCENDING | BOTTOM | Elbow angle < 95° (reached depth — near or below 90°) |
| BOTTOM | ASCENDING | Elbow angle > 100° (starting to push back up) |
| ASCENDING | PLANK | Elbow angle > 165° AND elapsed > 0.4s since PLANK→DESCENDING |

### Hysteresis

Entry and exit thresholds differ to prevent oscillation:
- DESCENDING entry: elbow < 160° / PLANK re-entry: elbow > 165°
- BOTTOM entry: elbow < 95° / BOTTOM exit: elbow > 100°

### Minimum rep time

ASCENDING→PLANK requires at least 0.4 seconds since the rep started (PLANK→DESCENDING). This prevents counting small arm adjustments or bouncing at the top as reps.

### No two-arm sync needed

Unlike curls (where each arm has an independent FSM), pushups move both arms as a single unit. A single FSM tracking the visible-side elbow angle is sufficient. This simplifies the state machine considerably.

### Partial/failed rep handling

If the elbow never reaches the BOTTOM threshold (< 95°) and the user returns to extension:
- The FSM resets to PLANK without counting a rep
- Feedback is displayed: "Go deeper — that one didn't count."
- No score is recorded for the partial rep

Implementation: if in DESCENDING state and elbow returns above 160° without ever reaching 95°, reset FSM to PLANK and emit partial-rep feedback.

---

## 9. Rep Window

During a rep (FSM not in PLANK), a `PushupRepWindow` accumulates:

| Data | Purpose |
|------|---------|
| Min/max elbow angle | Depth verification, lockout verification, ROM calculation |
| Min/max body alignment angle | Hip sag/pike magnitude during rep |
| Min/max hip deviation | Cross-check for body alignment |
| Min/max head-spine angle | Head drop detection |
| Start timestamp (PLANK→DESCENDING) | Tempo: concentric/eccentric timing |
| BOTTOM timestamp | Split point between descent and ascent |
| End timestamp (ASCENDING→PLANK) | Tempo calculation |
| Frame count | Diagnostics |

The rep window is created when the FSM leaves PLANK and consumed by `evaluateForm()` when the rep completes.

---

## 10. Form Evaluation & Scoring

Score starts at 100. Penalties are subtracted per form check. Score clamped to [0, 100].

### Penalty table

| Check | Condition | Penalty | Feedback Message |
|-------|-----------|---------|-----------------|
| **Insufficient depth** | Min elbow > 100° (never reached ~90°) | -30 | "Go deeper — aim for elbows at 90 degrees." |
| **Incomplete lockout** | Max elbow < 160° (didn't fully extend at top) | -25 | "Lock out your arms fully at the top." |
| **Low ROM** | ROM < 60° (and no depth/lockout issue flagged) | -25 | "Incomplete rep — full range of motion from lockout to 90 degrees." |
| **Hip sag (fail)** | Body alignment angle < 155° AND hip deviation confirms | -35 | "Hips are sagging — engage your core to maintain a straight line." |
| **Hip sag (warn)** | Body alignment angle < 165° AND hip deviation confirms | -20 | "Keep your hips up — your body line is dropping." |
| **Hip pike (fail)** | Body alignment angle > 195° or hip clearly above line | -35 | "Hips are piking up — lower them to maintain a straight plank." |
| **Hip pike (warn)** | Body alignment angle > 185° or hip slightly above line | -20 | "Hips are riding high — aim for a straight body line." |
| **Head drop** | Head-spine angle deviates significantly from plank baseline | -10 | "Keep your head neutral — look at the floor just ahead of your hands." |
| **Fast concentric** | Ascent phase (BOTTOM→PLANK) < 0.15s | -10 | "Slow down the push — control the movement." |
| **Fast eccentric** | Descent phase (PLANK→BOTTOM) < 0.20s | -10 | "Control the descent — don't drop into the pushup." |

If no issues: **"Great rep!"**

### Why these penalty weights differ from curls

Hip alignment is the most critical form element in pushups (sag = spinal load, pike = cheating ROM), hence **-35** for fail vs. curl's -25 for torso swing. Depth is equally important (**-30**, same as curl's flexion check). Lockout is slightly less penalized (**-25**) since partial lockout is less injurious than partial depth. Tempo penalties remain at **-10** (same as curls) since they're secondary concerns.

### Cross-check for hip sag/pike

Both the angle metric AND the deviation metric must agree before triggering a hip alignment penalty. This prevents false positives from:
- Landmark jitter on the hip keypoint
- Unusual body proportions (long torso, short legs)
- Camera angle not perfectly perpendicular

If only one metric triggers, suppress the penalty (could log for debug).

---

## 11. Per-Rep Data Storage

Identical to curls — uses the existing synchronous accumulator refs:

```typescript
// In handleLandmark, when pushup rep completes:
accumulatedFormScoresRef.current.push(currentScore);
accumulatedRepFeedbackRef.current.push(currentFeedback ?? 'Great rep!');
```

On recording stop, `handleRecordPress` reads these refs into a `LoggedSet` — no changes needed to this flow.

---

## 12. Visual Feedback

Per-rep feedback bubble, same as curls:
- Appears after each completed rep (or partial rep attempt)
- Auto-clears after 2 seconds
- Shows the feedback message from `evaluateForm()` — may contain multiple issues
- Form score displayed in the existing score indicator

Visual feedback shows **all** issues for a rep. TTS is a separate, selective layer (see section 13).

---

## 13. TTS Coaching

Pushup TTS follows the identical architecture from CLAUDE.md section 12. The coaching engine (`ttsCoach.ts`) is exercise-agnostic — only the message pools need pushup entries.

### Architecture (unchanged from curls)

```
pushupHeuristics.ts  →  CameraScreen.tsx  →  ttsCoach.ts  →  elevenlabsTTS.ts
(produces RepResult)    (calls onRepCompleted)  (decides what/when)  (plays audio)
```

### What to add: `FEEDBACK_TO_ISSUE` mappings in `ttsMessagePools.ts`

Each pushup visual feedback string maps to an `IssueType`. Reuse existing issue types where the form problem is analogous to curls; add new issue types only for pushup-specific problems.

| Pushup Feedback Message | IssueType | New or Reused? |
|------------------------|-----------|----------------|
| "Go deeper — aim for elbows at 90 degrees." | `depth` | **New** |
| "Lock out your arms fully at the top." | `lockout` | **New** |
| "Incomplete rep — full range of motion from lockout to 90 degrees." | `rom` | **New** (curl's ROM message maps differently) |
| "Hips are sagging — engage your core to maintain a straight line." | `hip_sag_fail` | **New** |
| "Keep your hips up — your body line is dropping." | `hip_sag_warn` | **New** |
| "Hips are piking up — lower them to maintain a straight plank." | `hip_pike_fail` | **New** |
| "Hips are riding high — aim for a straight body line." | `hip_pike_warn` | **New** |
| "Keep your head neutral — look at the floor just ahead of your hands." | `head_position` | **New** |
| "Slow down the push — control the movement." | `tempo_up` | **Reuse** from curls |
| "Control the descent — don't drop into the pushup." | `tempo_down` | **Reuse** from curls |

### Priority values (= penalty from heuristics)

| IssueType | Priority | Rationale |
|-----------|----------|-----------|
| `hip_sag_fail` | 35 | Most critical — spinal load risk |
| `hip_pike_fail` | 35 | Equally critical — cheating ROM |
| `depth` | 30 | Core rep quality |
| `lockout` | 25 | Important but less injurious |
| `rom` | 25 | Composite of depth + lockout |
| `hip_sag_warn` | 20 | Minor alignment drift |
| `hip_pike_warn` | 20 | Minor alignment drift |
| `head_position` | 10 | Secondary form cue |
| `tempo_up` | 10 | Reuse existing priority |
| `tempo_down` | 10 | Reuse existing priority |

When a rep has multiple issues, TTS speaks **only the highest-priority one**. Visual feedback still shows all.

### Message pools for new IssueTypes

Each new `IssueType` needs 3-4 short, coach-like voice lines (~1-1.5 seconds spoken). Examples:

```typescript
depth: [
  "Get lower.",
  "Go deeper on that one.",
  "Chest closer to the floor.",
  "More depth.",
],
lockout: [
  "Lock out at the top.",
  "Extend your arms fully.",
  "Push all the way up.",
],
hip_sag_fail: [
  "Tighten your core.",
  "Hips are dropping.",
  "Keep your body straight.",
  "Brace your core, hips up.",
],
hip_sag_warn: [
  "Watch your hips.",
  "Keep that body line.",
],
hip_pike_fail: [
  "Hips too high.",
  "Drop your hips down.",
  "Flatten out your body.",
],
hip_pike_warn: [
  "Hips are creeping up.",
  "Stay flat.",
],
head_position: [
  "Head neutral.",
  "Look at the floor.",
  "Don't drop your head.",
],
rom: [
  "Full range of motion.",
  "All the way down, all the way up.",
  "Complete the rep.",
],
```

Pool selection uses the existing shuffle-bag algorithm (random pick, never repeat last-used).

### Positive feedback and adaptive praise

Reuse the existing `positive` and `transition_good` pools from curls — they're exercise-agnostic ("Nice one!", "Good rep!", "That's better!", etc.). The adaptive praise interval logic in `ttsCoach.ts` is unchanged:
- Every 2 clean reps initially
- Every 3 after 4 consecutive clean
- Every 4 after 8 consecutive clean
- Resets to 2 on a bad rep

### Set summary

On recording stop, `ttsCoach.ts` speaks a dynamic set summary (waits up to 3s for current speech to finish). This is exercise-agnostic — it summarizes rep count, average score, and most common issue. No pushup-specific changes needed.

### Audio overlap rules (unchanged)

- If TTS is currently speaking, new per-rep messages are **dropped** (no interrupt, no queue)
- Set summary **waits** for current speech to finish
- Voice lines kept short (<1.5s)

### Implementation steps (per CLAUDE.md section 12)

1. Add pushup feedback strings to `FEEDBACK_TO_ISSUE` in `ttsMessagePools.ts`
2. Add new `IssueType` entries + message pools for pushup-specific issues
3. Add priority values for new issue types
4. **No changes to `ttsCoach.ts`** — it's exercise-agnostic
5. In `CameraScreen.tsx`, ensure pushup reps call `onRepCompleted` the same way curls do

---

## 14. Files to Create

### `src/utils/pushupHeuristics.ts`

The single new file. Contains all pushup-specific logic:

```typescript
// Types
export interface PushupState { ... }       // FSM state, rep window, smoothing state, feedback
export interface PushupRepWindow { ... }   // Accumulated angle data for one rep

// Core functions
export function initializePushupState(): PushupState;
export function updatePushupState(keypoints: Keypoint[], state: PushupState): PushupState;

// Internal (not exported)
function selectVisibleSide(keypoints): 'left' | 'right';
function calculatePushupAngles(keypoints, side): PushupAngles;
function smoothAngles(raw, smoothingState): SmoothedAngles;
function updateFSM(angles, fsm, timestamp): FSMResult;
function evaluateForm(repWindow: PushupRepWindow): { score: number; feedback: string };
function calculateHipDeviation(shoulder, hip, ankle): number;  // perpendicular distance
```

**Return contract**: `updatePushupState()` returns the updated state including `repCount`, `formScore`, `feedback`, and `repWindow` — same shape that `CameraScreen.tsx` expects for UI updates.

---

## 15. Files to Modify

### `src/screens/CameraScreen.tsx`

1. **Import** `pushupHeuristics` and its types
2. **Add** `pushupStateRef = useRef(initializePushupState())` alongside `barbellCurlStateRef`
3. **Add branch** in `handleLandmark`:
   ```typescript
   if (exerciseNameFromRoute === 'Barbell Curl') {
     // existing curl logic
   } else if (exerciseNameFromRoute === 'Push-Up') {
     const result = updatePushupState(keypoints, pushupStateRef.current);
     pushupStateRef.current = result;
     // update pending UI state (same pattern as curl)
   }
   ```
4. **Generalize gates**: Change `exerciseNameFromRoute === 'Barbell Curl'` checks for feedback auto-clear and TTS (lines ~152-170) to include pushups (e.g., check against a set of exercises with dedicated heuristics)
5. **Add setup instructions**: When `exerciseNameFromRoute === 'Push-Up'`, show the side-view text prompt before recording starts

### `src/utils/setNotesSummary.ts`

Add pushup feedback strings to `FEEDBACK_TO_IMPROVEMENT`:

```typescript
// Pushup-specific mappings
"Go deeper — aim for elbows at 90 degrees.": "Focus on hitting full depth each rep.",
"Hips are sagging — engage your core to maintain a straight line.": "Strengthen your core — try planks as an accessory exercise.",
"Hips are piking up — lower them to maintain a straight plank.": "Think about pushing the ground away while keeping your body rigid.",
"Lock out your arms fully at the top.": "Fully extend at the top of each rep for complete range of motion.",
"Keep your head neutral — look at the floor just ahead of your hands.": "Maintain a neutral neck — pick a spot on the floor to focus on.",
// ... etc for each feedback message
```

### `src/services/ttsMessagePools.ts`

1. Add pushup visual feedback strings to `FEEDBACK_TO_ISSUE` mapping (10 new entries — see section 13)
2. Add new `IssueType` values: `depth`, `lockout`, `rom`, `hip_sag_fail`, `hip_sag_warn`, `hip_pike_fail`, `hip_pike_warn`, `head_position`
3. Add priority values for each new issue type
4. Add message pools (3-4 short voice lines each) for each new issue type
5. **No changes to `ttsCoach.ts`** — it's exercise-agnostic

### `src/components/ui/SetNotesModal.tsx`

Line 129: Change hardcoded "Barbell Curl" reference to be generic (e.g., "this exercise" or use the exercise name from context).

---

## 16. Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MediaPipe landmark quality in horizontal body orientation | Ankle/hip keypoints may have low confidence when body is horizontal | Test early with side-view camera. Fall back to shoulder-hip only if ankle unreliable. Existing lowered confidence threshold (0.35) helps. |
| User positions camera at wrong angle | Landmarks may not be reliably detected | Text instructions in v1. Can add landmark validation gate in v2. |
| Hip deviation metric is in pixel space, not real-world units | Threshold may need per-device calibration | Use body-proportional normalization (e.g., deviation as % of shoulder-ankle distance) |
| Side-view only sees one side of body | Cannot detect asymmetric pushups | Documented as out of scope. Single-side analysis is sufficient for standard form checks. |
| Elbow angle thresholds may need tuning | Reps may be miscounted with initial thresholds | Start with conservative thresholds, test with multiple users, tune based on data |

---

## 17. Testing Plan

### Unit tests (if test infra exists)

- `calculateHipDeviation()` — known geometries, verify perpendicular distance
- `evaluateForm()` — mock `PushupRepWindow` with specific angle ranges, verify correct penalties and messages
- FSM transitions — feed sequences of elbow angles, verify state transitions and rep counting
- Partial rep — feed sequence that descends but doesn't reach depth threshold, verify no rep counted + feedback emitted

### Manual testing matrix

| Test Case | Expected |
|-----------|----------|
| 10 good-form pushups | 10 reps counted, all scores 85-100, feedback "Great rep!" |
| Pushups with hip sag | Sag penalty fires (-20 or -35), feedback mentions hips |
| Pushups with hip pike | Pike penalty fires, feedback mentions hips riding high |
| Shallow pushups (half depth) | Depth penalty fires (-30), or partial rep not counted with "Go deeper" feedback |
| Fast pushups | Tempo penalties fire (-10), feedback mentions slowing down |
| No lockout at top | Lockout penalty fires (-25), feedback mentions extending fully |
| Head drop during pushup | Head penalty fires (-10), feedback mentions neutral head |
| TTS on bad-form rep | Highest-priority issue spoken; other issues shown visually only |
| TTS on good rep after bad reps | "transition_good" pool message spoken |
| TTS adaptive praise interval | Good reps: praise at 2, then 3, then 4 rep intervals |
| TTS audio overlap | If already speaking, new per-rep message dropped (not queued) |
| TTS set summary on stop | Summary spoken after current speech finishes (up to 3s wait) |
| Switch to barbell curl after pushups | Curl analysis works identically — no regression |
| Set notes after pushup set | Per-rep breakdown shows pushup-specific feedback, summary is coherent |

---

## 18. Future Iterations

Items explicitly deferred from v1:

1. **Pushup variations** (knee, wide, diamond) — Different thresholds per variation, selectable from UI
3. **Visual setup guide** — Silhouette overlay showing correct phone/body positioning
4. **Landmark validation gate** — Block recording until ankle-hip-shoulder are all visible
5. **Front-view support** — Would enable elbow flare detection, requires separate heuristics path
6. **Auto-detect camera orientation** — Determine side vs. front view from landmark geometry
7. **Calibration phase** — Use first 1-2 reps to establish personal baseline angles

---

## 19. Open Questions

| Question | Status | Notes |
|----------|--------|-------|
| Exact FSM elbow angle thresholds | Tentative (160°/95°/100°/165°) | Need to validate with real side-view testing |
| Hip deviation normalization method | Tentative (% of shoulder-ankle distance) | Need to verify landmark stability in horizontal orientation |
| Exercise name string | TBD | Must match `exerciseNameFromRoute` — check what `ChooseExerciseScreen` passes |
| Should partial reps appear in set notes? | TBD | Currently no — but could be useful for user awareness |
| TTS voice line wording | Tentative | Example pools provided — may need refinement after hearing them spoken |
| Additional implementation notes from user | Pending | User indicated they have more detailed notes to share |

---

## 20. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-14 | Side-view camera only | Best landmark visibility for depth + body alignment; front view cannot detect these |
| 2026-02-14 | Standard pushup only (v1) | Simplest to implement and validate; variations added later |
| 2026-02-14 | Full form analysis | Depth, hip alignment (angle + deviation cross-check), head position, tempo, lockout, ROM |
| 2026-02-14 | Skip elbow flare | Unreliable from side view — requires top-down or front view |
| 2026-02-14 | TTS included via `ttsMessagePools.ts` | Same architecture as curls (CLAUDE.md section 12) — add mappings + pools, no changes to `ttsCoach.ts` |
| 2026-02-14 | Mirror curl FSM pattern | 4-state FSM (PLANK→DESCENDING→BOTTOM→ASCENDING→PLANK), consistent with curl architecture |
| 2026-02-14 | Elbow ~90° depth standard | Standard pushup depth — upper arm parallel to floor |
| 2026-02-14 | Text instructions only | Minimal setup UX for v1; visual guide/validation gate in future iterations |
| 2026-02-14 | Score from rep 1 | Fixed thresholds, no calibration phase — consistent with curl approach |
| 2026-02-14 | Adjusted penalty weights | Hip alignment weighted higher (-35 fail) than curl's torso swing (-25) — hip sag is more critical in pushups |
| 2026-02-14 | Skip symmetry detection | Side view only shows one side reliably — no basis for comparison |
| 2026-02-14 | Per-rep visual feedback bubble | Consistent with curl UX — user can glance between reps |
| 2026-02-14 | Dual metric for hip sag/pike | Angle + perpendicular deviation must agree — prevents false positives from landmark jitter |
| 2026-02-14 | Don't count partial reps | Show "Go deeper" feedback instead — clearer than a low-score rep |
