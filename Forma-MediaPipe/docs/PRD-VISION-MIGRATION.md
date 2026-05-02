---
name: PRD - Apple Vision 3D Migration & Morphology-Aware Heuristics
description: Iterable master roadmap for migrating iOS pose detection from MediaPipe (2.5D, 33 landmarks) to Apple Vision VNDetectHumanBodyPose3DRequest (3D, 19 joints) while introducing a platform-agnostic skeleton abstraction and shifting the heuristic engine from absolute angles/distances to anthropometrically-scaled relative ratios. Android remains on MediaPipe for parity.
---

# PRD: Apple Vision 3D Migration & Morphology-Aware Heuristics

**Document Version:** 1.0
**Date:** 2026-05-02
**Status:** Draft — Awaiting Architectural Approval
**Author:** Lead AI Architect
**Predecessor:** `PRD-EXERCISE-FRAMEWORK.md` (v1.0) — establishes the `ExerciseDefinition` registry pattern this PRD builds on
**Branch Strategy:** One long-lived integration branch (`feat/vision3d-skeleton-v2`) with phase branches merged into it (`phase-1-skeleton`, `phase-2-vision-adapter`, …)

---

## 0. Executive Summary

Forma's heuristic engine today consumes a `Keypoint[]` array shaped to MediaPipe Pose Full (33 landmarks, normalized image space + per-joint world meters). This contract is hard-coded throughout `src/utils/poseAnalysis.ts`, every `ExerciseDefinition`, and `CameraScreen`. Two structural problems block our next product step:

1. **iOS is paying a tax for an Android-first pipeline.** MediaPipe's GPU graph on iOS is heavier than the equivalent Apple Vision request, and we cannot exceed ~30 FPS on A15-class devices without thermal cost. Apple's `VNDetectHumanBodyPose3DRequest` (iOS 17+) returns true 3D joints in metric world space, runs on the Neural Engine, and is the right primitive for Forma on Apple silicon.
2. **Heuristics are body-shape brittle in the *coupled* cases.** A first pass at scale-invariance has already shipped — every exercise in `definitions/*.ts` uses chain-reach-ratios or torso-normalized heights as its primary FSM driver, so single-joint depth checks (squat parallel, pushup chest-down, curl extension) are already body-invariant (see §1.3). The remaining brittleness is in **coupled** heuristics: torso-lean penalties in the squat that don't account for femur dominance, asymmetry checks that don't subtract the athlete's structural baseline, body-line checks in the pushup that don't account for torso:leg ratio. These need a formal `AnthropometricProfile` to fix — and Phase 4 is now scoped to *only* that gap, not a from-scratch ratio rewrite.

This PRD proposes a **branch-by-branch migration** that:

- Inserts a **`SkeletonFrame`** abstraction between source (MediaPipe / Vision) and consumer (heuristics).
- Adds an **iOS-native Vision 3D adapter** behind the same `expo-pose-detection` API, including a fallback height-prior strategy for non-LiDAR devices.
- Introduces an **Anthropometric Profile** computed during warmup that re-expresses every distance/positional threshold as a ratio of the user's own segment lengths.
- Achieves and validates **60 FPS sustained on iPhone 14 Pro** without exceeding the existing thermal envelope.
- Ships behind a runtime feature flag (`forma.pose.backend`) with full A/B comparison against MediaPipe before MediaPipe is removed from iOS.

### What this PRD is NOT

- Not a rewrite of `ExerciseDefinition` or the registry — those remain authoritative.
- Not a change to TTS coaching, scoring math (quadratic penalty), or set-summary logic.
- Not a removal of MediaPipe — it remains the canonical Android backend and the iOS fallback during Phases 1–4.
- Not an ML model change — heuristics stay heuristics (see §12 of predecessor PRD).

---

## 1. Current State (as of 2026-05-02)

### 1.1 Pose detection surface

| Concern | Today |
|---|---|
| iOS source | MediaPipe Pose Full via `modules/expo-pose-detection/ios/PoseLandmarkerService.swift` |
| Android source | MediaPipe Pose Full (Hermes JS bridge) |
| JS contract | `Keypoint = { name: string; x: number; y: number; z?: number; score: number }`, array of 33, indexed by MediaPipe BlazePose taxonomy |
| Coordinate space | x/y in normalized image space `[0,1]`; `z` is MediaPipe's per-frame relative depth (unitless, no metric meaning) |
| Frame rate | 28–32 FPS (iOS), 30 FPS (Android) |
| Confidence | Per-joint `score` ∈ `[0,1]`, plus a global `min_pose_detection_confidence = 0.35` |

### 1.2 How heuristics consume keypoints

- `src/utils/poseAnalysis.ts` exports `calculateAngle`, `calculateAngle2D`, `calculateSignedVerticalAngleSagittal`, `getKeypoint(name)`. All take `Keypoint[]` directly.
- Every `ExerciseDefinition.update(keypoints, state)` receives the raw MediaPipe array.
- Distance-based heuristics (squat depth, hip sag in pushup, RDL hip-hinge bottom) use **normalized image-space deltas**, e.g. `Math.abs(hipY - kneeY) < 0.04`. These constants implicitly assume an ~1.7 m subject framed full-body in portrait mode.

### 1.3 Existing ratio-based heuristics (codebase audit, 2026-05-02)

A substantial first pass at scale-invariance has **already shipped** in `src/utils/exercises/definitions/`. Any redesign must build on this — not redo it.

| Exercise | Primary FSM driver today | Scale-invariance technique |
|---|---|---|
| `barbellCurl.ts` | `reachRatio` of shoulder→elbow→wrist chain | 3-joint chain self-normalization |
| `pushup.ts` | `elbowRatio` (chain reach ratio); `hipDeviation` is already perpendicular-distance / shoulder-ankle-distance | 3-joint chain ratio + line-segment ratio |
| `squat.ts` | `kneeRatio` of hip→knee→ankle chain | 3-joint chain self-normalization |
| `latPulldown.ts` | Active-arm reach ratio | 3-joint chain self-normalization |
| `cablePushdown.ts` | Arm reach ratio | 3-joint chain self-normalization |
| `cableRow.ts` | Arm reach ratio | 3-joint chain self-normalization |
| `legExtensions.ts` | Knee reach ratio | 3-joint chain self-normalization |
| `lyingLegCurl.ts` | Knee reach ratio | 3-joint chain self-normalization |
| `lateralRaise.ts` | Arm height ratio = `(hip.y − wrist.y) / (hip.y − shoulder.y)` | Height normalized by torso height |
| `machineAbCrunch.ts` | Spine-flexion angle | Angle (already scale-invariant) |

**Key property of the chain reach ratio (`d(A,C) / (d(A,B) + d(B,C))`):** it depends only on the joint angle at `B`, not on the absolute lengths of the segments. A 5'2" user and a 6'5" user with a 90° elbow bend have **mathematically identical** elbow reach ratios. This is a clever by-product of the construction — the technique is camera-invariant *and* anthropometric-invariant **for the joint it measures**, without ever measuring a body segment.

**What this gets us already:**
- Depth thresholds for squat (parallel ≈ ratio 0.62), pushup (chest down ≈ ratio 0.62), leg extension (lockout ≈ 0.97), curl (extension ≈ 0.93) are already body-shape-agnostic for the **driver joint**.
- The pushup hip-sag check is normalized by the shoulder-ankle line length, so it scales with body length already.
- The lateral raise height check is normalized by torso height, so it scales with torso length.
- No `ExerciseDefinition` references absolute meter constants. The remaining "constants" in image space are bounded ∈ [0, 1] and most are already ratios in disguise.

**What this does NOT cover (the remaining Phase-4 gap):**
1. **Coupled-joint heuristics**, where the form check at joint X depends on the proportion of segment Y to segment Z. Example: long-femur athletes physically need more forward torso lean to hit parallel depth in a squat — the squat torso-lean penalty does not currently know whether the user is long-femur'd. The reach ratio at the knee tells us *that* the squat is deep, but not *how much* torso lean is acceptable for *this* athlete.
2. **Cross-segment ratios** (e.g., hip-width-relative stance width) — none are computed today.
3. **Per-side asymmetry baselines** — `barbellCurl` measures left-vs-right ratio symmetry, but treats any difference > 10% as a fault; some athletes have legitimate ~6% asymmetry from prior injury that should be calibrated as their personal baseline.
4. **Profile metadata for diagnostics** — `standingHeight`, `femurToTibia`, `armSpan` are not exposed anywhere; debug overlays and post-session reports currently can't say "this athlete has long femurs."
5. **No formal anthropometric profile object exists** — there is no place to put a per-session segment-length record, so each heuristic that wants morphology awareness would have to recompute its own segments inline.

### 1.4 Why this still breaks the next milestone

- **Vision 3D returns 19 joints in meters**, not 33 in normalized space. No code path can consume both today.
- The chain-reach-ratio trick depends on having all three joints from the same backend in the same frame; the canonical mapping must preserve this, including the synthesized joints (`PELVIS_CENTER`, foot-tip on Vision) that some chains will reach for in future exercises.
- Apple's `VNDetectHumanBodyPose3DRequest` documentation explicitly states that on devices without LiDAR, depth is estimated by assuming a default **1.8 m subject height**. Heuristics using **only** ratios are immune; heuristics using absolute meters (none today, but tempting for future features like bar-path tracking) would be off by `actualHeight / 1.8`.
- The handful of heuristics that need *coupled* morphology (item 1 above) cannot be addressed without a profile object, and Phase 4 needs to fill exactly that gap — not redo the scale-invariance work that already shipped.

---

## 2. Target Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                         CameraScreen.tsx                            │
│           (calls ExerciseRegistry.get(name).update(frame))          │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ SkeletonFrame
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                       Heuristic Engine                              │
│  ExerciseDefinition.update(frame: SkeletonFrame, state)             │
│  • Reads canonical joints by enum, not by MediaPipe index           │
│  • Reads ratios from frame.profile (anthropometric)                 │
│  • All thresholds expressed as ratios or scale-invariant angles     │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ uses
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                     SkeletonFrame (canonical)                       │
│  joints: Record<CanonicalJoint, Joint3D>                            │
│  profile: AnthropometricProfile                                     │
│  source: 'mediapipe' | 'vision3d'                                   │
│  confidence, timestamp, viewHint                                    │
└────────┬───────────────────────────────────────────────────┬───────┘
         │                                                   │
         │ adapter                                           │ adapter
         ▼                                                   ▼
┌────────────────────────────┐                ┌─────────────────────────────┐
│   MediaPipeAdapter         │                │   VisionAdapter (iOS only)  │
│   (Android always,         │                │   VNDetectHumanBodyPose3D   │
│    iOS until Phase 6)      │                │   + LiDAR/height-prior fix  │
│   33 → canonical mapping   │                │   19 → canonical mapping    │
└────────────────────────────┘                └─────────────────────────────┘
```

### 2.1 Three new architectural primitives

1. **`CanonicalJoint`** — enum of 19 joints we commit to supporting on both backends. Subset of MediaPipe; superset of Vision after we synthesize the 2 missing joints (see §3.3).
2. **`SkeletonFrame`** — the new value type passed into `ExerciseDefinition.update`. Replaces `Keypoint[]`.
3. **`AnthropometricProfile`** — per-session struct of computed segment lengths and derived ratios, attached to every frame after warmup completes. Drives ratio-based heuristics.

### 2.2 What stays unchanged

- `ExerciseRegistry`, `ExerciseDefinition` shape (only the `update` signature widens)
- TTS, set summary, scoring math (quadratic penalty), replay test runner
- Android MediaPipe pipeline end-to-end (only the JS-side adapter is added)
- Camera permissions, audio interruption mode, JSC iOS engine choice

---

## 3. The Unified Skeleton Abstraction

### 3.1 `CanonicalJoint` enum

The canonical joint set is the **intersection of operationally useful joints from both backends**, plus two synthesized joints (`pelvis_center`, `chest_center`) that both adapters must compute.

```
CanonicalJoint =
  HEAD,
  NECK,
  CHEST_CENTER,        // synthesized: midpoint of L/R shoulder
  PELVIS_CENTER,       // synthesized: midpoint of L/R hip (= Vision "root")
  LEFT_SHOULDER,  RIGHT_SHOULDER,
  LEFT_ELBOW,     RIGHT_ELBOW,
  LEFT_WRIST,     RIGHT_WRIST,
  LEFT_HIP,       RIGHT_HIP,
  LEFT_KNEE,      RIGHT_KNEE,
  LEFT_ANKLE,     RIGHT_ANKLE,
  LEFT_FOOT,      RIGHT_FOOT
```

**Total: 19 canonical joints.** Hands/fingers and face landmarks from MediaPipe are dropped — they are not used by any current `ExerciseDefinition`. If a future exercise needs them (e.g., grip detection), the adapter can publish them on a separate optional channel.

### 3.2 `SkeletonFrame`

```
SkeletonFrame {
  joints:        Record<CanonicalJoint, Joint3D>      // metric, body-local frame
  joints2D:      Record<CanonicalJoint, Joint2D>      // image-space, normalized [0,1]
  profile:       AnthropometricProfile | null         // null until warmup completes
  source:        'mediapipe' | 'vision3d'
  sourceQuality: 'lidar' | 'estimated_height' | 'image_only'
  timestamp:     number  // ms, monotonic (CACurrentMediaTime / SystemClock.elapsedRealtime)
  viewHint:      'front' | 'side' | 'unknown'
  globalConfidence: number  // 0–1
}

Joint3D { x: number; y: number; z: number; confidence: number; isSynthetic: boolean }
Joint2D { x: number; y: number; confidence: number }
```

**Why both 2D and 3D in the frame:**
- 3D is correct for body-local angles, segment lengths, depth-aware reasoning.
- 2D is necessary for on-screen overlay rendering (skeleton overlay must align with the camera preview), and for backwards compatibility during the migration phases when not all heuristics have been ported.

**Coordinate frame for `joints` (3D, metric):**
- Origin: `PELVIS_CENTER`.
- +Y up (gravity-opposed; both backends provide this implicitly with rotation correction).
- +X right, +Z forward (out of the user's chest).
- Units: meters.

This is the same convention Apple Vision 3D uses, so the Vision adapter is a near-passthrough. The MediaPipe adapter must (a) re-anchor world landmarks to the hip midpoint (MediaPipe already provides hip-anchored world landmarks, so this is mostly a renaming + axis-flip pass) and (b) scale-correct using the height prior described in §5.4.

### 3.3 Joint mapping table

| Canonical | MediaPipe (index) | Vision 3D (joint name) | Notes |
|---|---|---|---|
| `HEAD` | `nose` (0) | `head_joint` | MediaPipe has no head-top; nose is acceptable proxy for current heuristics |
| `NECK` | synthesize: midpoint of `left_shoulder` (11) and `right_shoulder` (12) | `neck_1_joint` | Vision provides neck directly; MediaPipe synthesizes |
| `CHEST_CENTER` | synthesize: midpoint of L/R shoulder | `spine_5_joint` (or midpoint of L/R shoulder) | Used for torso lean math |
| `PELVIS_CENTER` | synthesize: midpoint of `left_hip` (23) and `right_hip` (24) | `root` | Vision's root joint is exactly this |
| `LEFT_SHOULDER` | `left_shoulder` (11) | `left_shoulder_1_joint` | Direct |
| `RIGHT_SHOULDER` | `right_shoulder` (12) | `right_shoulder_1_joint` | Direct |
| `LEFT_ELBOW` | `left_elbow` (13) | `left_forearm_joint` | Vision names by bone, not joint — `left_forearm_joint` is the elbow position |
| `RIGHT_ELBOW` | `right_elbow` (14) | `right_forearm_joint` | Direct |
| `LEFT_WRIST` | `left_wrist` (15) | `left_hand_joint` | Vision's `left_hand_joint` ≡ wrist |
| `RIGHT_WRIST` | `right_wrist` (16) | `right_hand_joint` | Direct |
| `LEFT_HIP` | `left_hip` (23) | `left_leg_joint` | Vision names hip by bone |
| `RIGHT_HIP` | `right_hip` (24) | `right_leg_joint` | Direct |
| `LEFT_KNEE` | `left_knee` (25) | `left_foreleg_joint` | Direct |
| `RIGHT_KNEE` | `right_knee` (26) | `right_foreleg_joint` | Direct |
| `LEFT_ANKLE` | `left_ankle` (27) | `left_foot_joint` | Direct |
| `RIGHT_ANKLE` | `right_ankle` (28) | `right_foot_joint` | Direct |
| `LEFT_FOOT` | `left_foot_index` (31) | synthesize: project ankle forward by `0.5 × tibia_length` | Vision lacks foot-tip; project from ankle along forward axis |
| `RIGHT_FOOT` | `right_foot_index` (32) | synthesize: same | Direct |

The exact Vision joint name strings (`VNHumanBodyPose3DObservation.JointName`) must be pinned in code to avoid string typos — see Phase 1 deliverables.

### 3.4 Confidence normalization

- MediaPipe `score` ∈ `[0, 1]` — used directly as `Joint3D.confidence`.
- Vision 3D does not expose per-joint confidence; instead it exposes `VNRecognizedPoint3D.confidence` which is currently always `1.0` for detected joints and the joint either exists or doesn't. The adapter must therefore:
  - Set `confidence = 1.0` for any joint Vision returns,
  - Set `confidence = 0.0` for any canonical joint Vision did not return that frame,
  - Set `globalConfidence` from the observation's overall confidence.
- Heuristics that branch on confidence (e.g., warmup gate visibility threshold of 0.3) will still function: any visible Vision joint passes the gate, and any missing one fails it — the same semantic.

---

## 4. The Anthropometric Profile

### 4.1 Definition

```
AnthropometricProfile {
  // Computed once during warmup and held for the session
  computedAt:        number            // timestamp
  sampleFrameCount:  number            // how many frames went into the estimate
  confidence:        number            // 0–1, lower if warmup was noisy

  // Segment lengths, meters (from 3D joints)
  segments: {
    torso:           number  // PELVIS_CENTER → CHEST_CENTER
    spineToNeck:     number  // CHEST_CENTER → NECK
    upperArm:        number  // SHOULDER → ELBOW (averaged L/R)
    forearm:         number  // ELBOW → WRIST
    femur:           number  // HIP → KNEE
    tibia:           number  // KNEE → ANKLE
    foot:            number  // ANKLE → FOOT
    shoulderWidth:   number  // L_SHOULDER ↔ R_SHOULDER
    hipWidth:        number  // L_HIP ↔ R_HIP
  }

  // Derived totals
  derived: {
    standingHeight:  number  // sum of foot + tibia + femur + torso + spineToNeck + (head est)
    armSpan:         number  // 2 × (shoulderWidth/2 + upperArm + forearm)
    legLength:       number  // foot + tibia + femur
    torsoToLeg:      number  // ratio: torso / legLength
    femurToTibia:    number  // ratio: femur / tibia (long-femur ≈ > 1.05)
  }

  // Reference unit for ratio thresholds (the canonical "1.0 unit" for all heuristics)
  referenceUnit:     number  // = standingHeight, in meters
}
```

### 4.2 Where it comes from

- The existing `WarmupGate` (in `src/utils/exercises/shared/WarmupGate.ts`) already gates exercise activation on visibility stability. We extend it: while it is collecting stable frames, it also accumulates segment-length samples.
- For each segment, accumulate the **median** across stable warmup frames (not mean — robust to one bad frame).
- Profile is sealed when warmup completes; subsequent frames consume it but never modify it.
- If the user re-warms-up (e.g., camera moves), profile is recomputed.

### 4.3 The cross-platform calibration trick

The hardest part of the migration: MediaPipe's "world landmarks" are in **meters but with arbitrary scale per session** (the model is not metric-calibrated). Vision 3D is **truly metric on LiDAR devices** and **assumes a 1.8 m reference height on non-LiDAR devices**.

Three different "metric truths" must collapse to one usable scale:

| Source | Behavior | Scale truth |
|---|---|---|
| MediaPipe (Android + iOS pre-cutover) | Per-frame world coords, hip-anchored, no metric guarantee | Unknown — must be inferred |
| Vision 3D + LiDAR | True metric, hip-anchored | Trustable absolute meters |
| Vision 3D, no LiDAR | Metric but scaled by assumption that subject is 1.8 m tall | Off by `actualHeight / 1.8` |

**Solution: ratio-only heuristics + a single per-session height prior.**

The whole point of moving to ratios is that **the absolute scale never appears in any heuristic**. The squat depth check becomes:

> `verticalDrop(PELVIS_CENTER) > 0.92 × profile.segments.femur`

This is unitless. It works whether the source is MediaPipe (arbitrary scale) or Vision-no-LiDAR (off by 10%). What matters is that **the femur length and the vertical drop are measured in the same coordinate system in the same frame** — the scale cancels.

The standing-height field in the profile is computed for diagnostics only; no heuristic should ever multiply by an absolute meter value. The `referenceUnit` is `standingHeight` purely for reporting / debug overlay.

### 4.4 What the user must do

Nothing. No height entry, no calibration screen. The profile is computed silently from the same warmup frames the user already produces.

If the user wishes to enter their height (we already collect it for analytics in `weight-input-feature.md`), the system can use that value as a sanity check on `standingHeight` — but never as an input to heuristics. A 10% mismatch is logged for telemetry; > 25% mismatch triggers a re-warmup.

---

## 5. Phased Migration Plan

The plan is structured so that each phase produces an independently shippable, behind-a-flag-mergeable change. Phase N never assumes Phase N+1 exists. If we paused after any phase, the app would still ship.

> **Validation philosophy.** Each phase's gate is **infrastructure-correctness**: TypeScript compiles, iOS/Android builds succeed, types are exported, adapter math is lossless on synthetic input, unit tests against synthetic fixtures pass, feature flags collapse cleanly, and runtime invariants hold. **Form-accuracy validation is explicitly deferred** (see §6.6). The repository today has the replay infrastructure (`src/utils/exercises/replay/`, `__tests__/replay.test.ts`) but `__tests__/recordings/` is empty — there are no captured landmark sessions to assert score parity, body-type variance, or backend-A/B agreement against. The PRD does not pretend otherwise. Once recordings are captured, accuracy gates can be added in a follow-up; the migration itself is gated only on what we can verify at build/test time.

### Phase 1 — Skeleton Abstraction Layer (foundation)

**Architectural goal:** Insert `SkeletonFrame` between MediaPipe and the heuristic engine **without changing the underlying detector**. MediaPipe is the only backend; the abstraction exists but has only one adapter.

**Deliverables:**

1. `src/skeleton/CanonicalJoint.ts` — enum + canonical joint metadata (parent joint, default segment).
2. `src/skeleton/SkeletonFrame.ts` — the type defined in §3.2.
3. `src/skeleton/adapters/MediaPipeAdapter.ts` — converts current `Keypoint[]` to a `SkeletonFrame`. Synthesizes `PELVIS_CENTER`, `NECK`, `CHEST_CENTER`. Computes 3D from MediaPipe world landmarks (already present in current iOS bridge but unused).
4. `src/utils/exercises/types.ts` — extend `ExerciseDefinition.update` signature to accept `SkeletonFrame` *in addition to* the legacy `Keypoint[]` (overload, so no exercise needs changing yet).
5. `CameraScreen.tsx` — call adapter once per frame, pass both `frame` and legacy `keypoints` to `update`. Existing exercises continue reading `keypoints`; nothing else changes.

**Key technical considerations:**

- **Allocation in the hot path.** A `SkeletonFrame` with 19 joints × 2 coordinate sets is ~40 small objects per frame. At 30 FPS this is 1,200 allocations/second. Adapter must use a pooled/recycled frame object (single `SkeletonFrame` mutated in place per camera; see `RepWindowTracker` for the existing mutation-on-refs pattern).
- **MediaPipe world-coordinate sign convention.** MediaPipe's world landmarks are +Y down (image convention) but some heuristics expect +Y up. The adapter is the right place to perform a one-time axis flip; do not let this leak into per-exercise code.
- **Backward compat.** `update` must accept the legacy `Keypoint[]` for the entire phase. No exercise migrates yet.

**Validation gate (infrastructure-only — no recorded sessions exist yet):**
- ✅ `npx tsc --noEmit` passes; new `SkeletonFrame`, `CanonicalJoint`, adapter types are exported from `src/skeleton/index.ts`.
- ✅ `npm run prebuild:ios` and `npx expo run:android` both succeed unmodified.
- ✅ Existing **synthetic** unit tests (`src/utils/exercises/__tests__/*.synthetic.test.ts`) pass unmodified after `CameraScreen` is rewired through the adapter (the synthetic tests construct `Keypoint[]` directly and don't depend on the adapter, so they prove the legacy contract is preserved).
- ✅ A new adapter unit test (`MediaPipeAdapter.test.ts`) constructs a synthetic `Keypoint[]`, runs it through the adapter, and asserts (a) every `CanonicalJoint` is present, (b) synthesized joints (`PELVIS_CENTER`, `NECK`, `CHEST_CENTER`) equal the midpoint of their parents to `< 1e-9`, (c) running the same input twice through a pooled adapter instance produces structurally-equal output (no leak from reuse).
- ✅ Smoke run on a connected iPhone (manual): existing exercises still count reps and produce feedback. Result is logged but not asserted as a gate — no recordings to compare against.

---

### Phase 2 — iOS Vision 3D Adapter (parallel backend, dark)

**Architectural goal:** Stand up the Apple Vision pipeline in the native module behind a runtime flag, producing `SkeletonFrame`s in parallel with MediaPipe but **discarded by JS**. Both pipelines run; only MediaPipe drives heuristics. Telemetry compares.

**Deliverables:**

1. `modules/expo-pose-detection/ios/VisionPoseService.swift` — wraps `VNDetectHumanBodyPose3DRequest`, runs on a dedicated `DispatchQueue` (QoS `.userInteractive`) so MediaPipe's queue is undisturbed.
2. `modules/expo-pose-detection/ios/VisionToCanonicalMapper.swift` — implements §3.3 mapping in Swift, including foot synthesis. Outputs a `SkeletonFrame`-shaped struct that the Expo bridge serializes to JS.
3. JS bridge: a second `onLandmark`-equivalent event (`onVisionFrame`) only fired when the `forma.pose.dualEmit` setting is on.
4. `src/skeleton/adapters/VisionAdapter.ts` — converts the bridge payload to `SkeletonFrame`. Almost a passthrough since the Swift mapper already produces canonical joints.
5. Telemetry: log per-frame `(mediaPipeFrame.joints[J], visionFrame.joints[J], jointAgreementMeters)` for J ∈ canonical set, with sampling at 1 Hz (not every frame).

**Key technical considerations:**

- **Camera buffer ownership.** Both pipelines need the `CMSampleBuffer`. Do not copy — share the buffer with `VNImageRequestHandler` directly. Both detectors are read-only consumers.
- **iOS 17 minimum for Vision 3D.** Wrap all calls in `if #available(iOS 17.0, *)`. On iOS 16 devices, the Vision pipeline is silently disabled, MediaPipe remains the only path. (Forma's deployment target is currently iOS 16; bumping to iOS 17 is a separate decision tracked in `BEFORE-PRODUCTION.md`.)
- **LiDAR detection.** Use `ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)` to set `sourceQuality = 'lidar'` vs `'estimated_height'`. Persist this in the frame so heuristics can later opt into LiDAR-only paths if needed.
- **Thermal envelope.** Running both pipelines doubles GPU+ANE load. The dual-emit mode is **debug-only and time-boxed** (auto-disable after 5 minutes of session) to avoid throttling biasing the comparison.
- **Coordinate axes.** Vision returns coordinates in a right-handed Y-up frame with the root at the pelvis — this matches the canonical frame, so the mapper performs no rotation. Verify on first prototype; do not assume.

**Validation gate (infrastructure-only):**
- ✅ `npm run prebuild:ios` succeeds with the new Swift sources compiled in; iOS Release build succeeds.
- ✅ Vision pipeline starts on an iOS 17+ device under the `forma.pose.dualEmit` flag and emits at least one `onVisionFrame` event per second for 30 s (proves the bridge is wired, not how accurate it is).
- ✅ On iOS < 17 the Vision pipeline is statically excluded (`#available` guard) and `dualEmit` is a no-op — verified by grepping for the guard plus a smoke run on iOS 16 simulator.
- ✅ `VisionToCanonicalMapper` Swift unit test constructs a fixture `VNHumanBodyPose3DObservation`-like input and asserts every `CanonicalJoint` is populated (or marked synthetic).
- ✅ JS-side `VisionAdapter.test.ts` asserts the bridge payload deserializes into a `SkeletonFrame` with `source = 'vision3d'` and a valid `sourceQuality` enum.
- ✅ MediaPipe pipeline continues to drive heuristics — runtime smoke test confirms no behavioral change from Phase 1 (no assert against recordings, manual confirmation only).

---

### Phase 3 — Anthropometric Profile (still on MediaPipe)

**Architectural goal:** Compute and surface the `AnthropometricProfile`. No heuristic uses it yet — this phase only proves the profile is stable and accurate.

**Deliverables:**

1. `src/skeleton/AnthropometricProfile.ts` — type + `compute()` function from a window of `SkeletonFrame`s.
2. `src/skeleton/profileBuilder.ts` — accumulator that consumes warmup-stable frames and emits a sealed profile.
3. Integration: extend `WarmupGate` to populate `frame.profile` once warmed (via a small `ProfileSession` object held alongside the gate in CameraScreen).
4. Debug overlay (gated behind `__DEV__`): show `femur`, `tibia`, `torso`, `standingHeight`, `femurToTibia` in the on-screen HUD.
5. Telemetry: log final profile per session, anonymized, for distribution analysis.

**Key technical considerations:**

- **Median, not mean.** A single bad frame (occluded knee on warmup) skews mean by an unbounded amount; median absorbs it.
- **Visibility-weighted samples.** Only count a segment toward the profile if **both endpoint joints** had `confidence ≥ 0.5` that frame.
- **Minimum sample size.** Require ≥ 20 stable frames before sealing the profile; if warmup completes with fewer, mark `profile.confidence < 1.0` and log a warning.
- **Bilateral averaging.** Where left and right segments differ by > 15%, log it (likely indicates a tracking error, not an actual asymmetry; true asymmetry is rare and small) and use the higher-confidence side rather than the average.
- **Re-warmup invalidates the profile.** If the user steps out and back, the gate resets and a new profile is computed.

**Validation gate (infrastructure-only):**
- ✅ `npx tsc --noEmit` passes; `AnthropometricProfile` is exported and consumed by the extended `WarmupGate`.
- ✅ Unit test (`profileBuilder.test.ts`): feed a synthetic stream of 30 stable frames with known segment lengths; assert the computed `profile.segments.*` matches inputs to `< 1e-6` and `profile.confidence === 1.0`.
- ✅ Unit test: feed a stream where 20% of frames have low-confidence joints; assert the visibility-weighted accumulator excludes them and still seals successfully.
- ✅ Unit test: feed fewer than 20 frames; assert the profile seals with `confidence < 1.0` and a logged warning.
- ✅ Smoke run on device: dev HUD shows non-NaN segment values after warmup. Sanity-eyeball only — no asserted height or ratio bounds.
- ✅ `frame.profile === null` before warmup completes; non-null and frozen (deep-equal across frames) after. Verified by a runtime invariant assertion in `__DEV__`.

---

### Phase 4 — Coupled-Morphology Heuristics & Profile Surfacing

**Architectural goal:** Close the gap between today's **scale-invariance** (already shipped, see §1.3) and full **morphology-awareness** (proportions of one segment to another influence form expectations). The chain-reach-ratio approach already in `definitions/*.ts` solves single-joint scale invariance; this phase addresses the residual cases where one segment's length should modify the threshold applied to a *different* joint.

**Pre-existing baseline (do not redo):**
- All 10 exercises in `src/utils/exercises/definitions/` already use ratio-based primary FSM drivers (chain reach ratios, height-over-torso ratios, or pure angles). See §1.3 table.
- Pushup `hipDeviation` is already perpendicular-distance / shoulder-ankle line length.
- Lateral raise `armHeight` is already normalized by torso height.
- No `ExerciseDefinition` consults absolute meters.

**Deliverables (concrete, scoped to the actual gap):**

1. **`src/skeleton/morphology.ts`** — thin helpers exposing the profile to heuristics that opt in:
   ```
   function ratioToFemur(value: number, profile: AnthropometricProfile): number
   function ratioToTibia(value, profile): number
   function ratioToUpperArm(value, profile): number
   function ratioToTorso(value, profile): number
   function femurDominance(profile): number   // = femurToTibia, > 1.05 is "long femur"
   function asymmetryBaseline(profile, side): number  // future-extensible
   ```
   These are pure, allocation-free, and noop-safe when `profile = null`.

2. **`squat.ts` — torso-lean tolerance modulated by femur dominance.**
   - Today, the torso-lean penalty has fixed deadzone/scale.
   - New: when `femurDominance > 1.10`, scale the torso-lean penalty `deadzone` by `femurDominance` (a long-femur athlete who leans 22° forward at the bottom is biomechanically equivalent to an average-femur athlete leaning 18°). The reach-ratio depth check stays exactly as today.
   - Also: bar-path / hip-back travel — currently nothing; add an opt-in check that hip horizontal travel is within `0.6 × profile.segments.tibia` of the start position.

3. **`pushup.ts` — body-line tolerance modulated by torso/leg ratio.**
   - Hip-sag deadzone widens slightly for users with `torsoToLeg > 0.55` (proportionally long torso ⇒ pelvis hangs lower at neutral, false-positive sag).

4. **`barbellCurl.ts` — asymmetry baseline.**
   - Today: `SYMMETRY_MIN_RATIO = 0.10` is a global threshold.
   - New: subtract the user's resting per-side reach-ratio difference (captured during warmup, persisted in `profile`) from the per-rep asymmetry measurement before applying the threshold. Athletes with structural asymmetry stop being penalized for their baseline.

5. **`lyingLegCurl.ts`, `legExtensions.ts`, `latPulldown.ts`, `cableRow.ts`, `cablePushdown.ts`, `lateralRaise.ts`, `machineAbCrunch.ts`** — **no behavioral change**. These are already either chain-reach-ratio driven or angle-only. Phase 4 only attaches the `profile` to their `ExerciseState` for telemetry/debug-overlay purposes; thresholds untouched.

6. **Audit pass + lint rule:**
   - Add an ESLint rule (or simple grep CI check) that flags any numeric literal in `definitions/*.ts` paired with `.x` or `.y` *outside* a ratio expression. Phase 1 audit will produce a small allowlist (e.g., `kneeRatio < 0.62`, where `0.62` is a ratio constant); the rule prevents regressions, not the existing well-formed code.

7. **Debug overlay (gated `__DEV__`):** add `profile` summary line — `H 1.78m · F 0.46m · T 0.42m · F:T 1.10`.

**Key technical considerations:**

- **Do not break the chain-reach-ratio invariants.** The construction `d(A,C) / (d(A,B) + d(B,C))` is already body-invariant for joint `B`; a "morphology adjustment" applied on top of it would *introduce* body-shape bias, not remove it. The profile should only modulate **secondary** form checks (torso lean, asymmetry, body-line) where the bias actually exists.
- **Profile may be absent.** Frames before warmup completes have `profile = null`. Heuristics must guard with a no-op fallback that uses today's fixed thresholds — no profile means we behave exactly like today, never worse.
- **Replay-test baseline strategy:** because the existing reach-ratio implementation is already body-invariant for primary drivers, the **rep counts** in old baselines should not move at all under Phase 4. Only **scores** for exercises in deliverables 2–4 may shift, and only for athletes outside the median morphology band. Capture per-body-type baselines (1.55 m, 1.78 m, 1.95 m) for these exercises and assert (a) median-body baselines unchanged, (b) edge-body baselines move *toward* the median-body score (not away).
- **Don't add a deadzone variable that does nothing.** If a feature flag for morphology mode is toggled off, the path collapses cleanly to today's code; do not leave half-applied scaling that's neither old-behavior nor new-behavior.

**Validation gate (infrastructure-only):**
- ✅ `npx tsc --noEmit` passes; `morphology.ts` helpers are exported and imported by the three modified definitions.
- ✅ All existing `*.synthetic.test.ts` files in `src/utils/exercises/__tests__/` pass unmodified — synthetic tests use procedurally-generated keypoints with known ratios, so they confirm the modified definitions still produce expected FSM transitions and non-NaN scores.
- ✅ New unit tests for the three modified definitions:
  - `squat.test.ts` — call `update()` with `profile = null` and confirm output is byte-identical to today's behavior. Then call with a synthetic profile (`femurToTibia = 1.15`) and confirm the torso-lean penalty deadzone widens (assert via inspecting penalty contribution in `debugInfo`, not the score itself).
  - `pushup.test.ts` — same pattern: `profile = null` ⇒ today's behavior; synthetic `torsoToLeg = 0.60` ⇒ widened sag deadzone.
  - `barbellCurl.test.ts` — `profile.asymmetryBaseline = 0.06` ⇒ a synthetic frame with 6% asymmetry produces no asymmetry feedback string; with `0.00` baseline, it does.
- ✅ ESLint/grep audit rule (Phase 4e) runs in CI and passes against the current `definitions/*.ts` allowlist.
- ✅ Bounded-modulation unit test: for each modulated threshold, sweep `profile` across anatomically plausible inputs (`femurToTibia ∈ [0.90, 1.25]`, `torsoToLeg ∈ [0.40, 0.65]`) and assert `0.7 × T_old ≤ T_mod ≤ 1.4 × T_old`. This is the core safety property — it is provable from the helpers themselves without any recorded session.
- ✅ Toggling `forma.heuristics.coupledMorphology = false` collapses every modified definition to byte-identical pre-Phase-4 behavior — verified by a unit test that runs the same synthetic input through both flag states and asserts identity when off.

---

### Phase 5 — iOS Cutover & 60 FPS

**Architectural goal:** Make Vision 3D the **primary** iOS backend. MediaPipe stays compiled in as a feature-flag fallback for one release cycle. Hit 60 FPS sustained.

**Deliverables:**

1. Promote the runtime flag `forma.pose.backend` from `dualEmit` (debug) to a user-facing setting with values `vision3d` (iOS 17+ default), `mediapipe` (Android default, iOS fallback).
2. Tear down the dual-emit telemetry; keep one-line "active backend" event per session.
3. **60 FPS path optimizations** (Swift):
   - Use `VNDetectHumanBodyPose3DRequest` with `revision = .revision1` explicitly (lock the model version).
   - Set `request.usesCPUOnly = false` and pin to ANE.
   - Drop the `OverlayView.swift` UIKit overlay and render the skeleton via the React Native preview layer (the existing MediaPipe overlay does this; reuse).
   - Frame skipping: if the previous frame's request hasn't completed, drop the current frame rather than queue it. (Vision is fast enough that this should be rare; queueing causes visible lag.)
4. **Non-LiDAR stabilization** (Swift):
   - Pin a per-session height prior into Vision's request via `request.customHumanBodyPose3DHeight = profile.derived.standingHeight` *if and only if* a profile exists from a prior MediaPipe session. (Cold-start: first warmup uses the 1.8 m default; the recomputed profile from Vision frames then becomes the prior for the next session, persisted in `AsyncStorage`.)
   - Document the cold-start scaling error (~10% on a 1.65 m user) and the 1-warmup convergence to within 2%.
5. Performance budget enforcement:
   - Add a frame-time histogram in dev builds: assert p99 ≤ 16 ms on iPhone 14 Pro.

**Key technical considerations:**

- **Vision's frame rate is request-bound, not detection-bound.** The model itself runs in ~6 ms on A16; the rest is image preprocessing and Swift↔JS bridge cost. Keep all preprocessing on the camera capture queue, never bounce to JS for pre-detection work.
- **The 1.8 m assumption is the single biggest accuracy threat on non-LiDAR.** Even a 6'4" user (1.93 m) will have 7% scale error, which appears in the absolute Z coordinate but **not in any ratio-based heuristic**. The customHumanBodyPose3DHeight prior is belt-and-suspenders for users who care about absolute distance reporting (future feature: "your bar path is 12 cm forward").
- **iPhone 12 / 13 (A14, A15) at 60 FPS.** Possible but tight. Validate on the lowest-spec target before committing the default.
- **MediaPipe stays compiled in for one full release.** Removing it requires its own deletion PRD and a confirmation that no edge case (Android device crash, Vision regression in iOS 17.x patch release) has bitten users.

**Validation gate (infrastructure-only):**
- ✅ `npm run prebuild:ios` and iOS Release build succeed with `forma.pose.backend = vision3d` as the iOS default.
- ✅ Frame-time histogram is wired and visible in dev builds (`__DEV__` HUD shows running p50/p99 ms). Values are logged but not gated against numeric targets — actual perf characterization is a manual exercise on real devices, not a build-time assert.
- ✅ Backend-switch unit test: toggling `forma.pose.backend` between values triggers `pose.backend_switched` telemetry event and resets the active `ExerciseState` cleanly (no double-counted rep across the boundary in a synthetic test fixture).
- ✅ Height-prior persistence unit test: write `standingHeight = 1.65` to `AsyncStorage`, restart the app fixture, assert the next Vision request payload includes `customHumanBodyPose3DHeight = 1.65`. Cold-start (no stored value) defaults to no override — assertion is on payload shape, not subsequent accuracy.
- ✅ `sourceQuality` is set correctly on a LiDAR-capable test fixture vs a non-LiDAR fixture (mocked `ARWorldTrackingConfiguration.supportsFrameSemantics` lookup).
- ✅ Smoke run on device: app boots, exercises count reps, no crash. Manual confirmation only — score parity vs MediaPipe is **not asserted**, since Vision's accuracy may legitimately diverge from MediaPipe's and the right reference is trainer-rated form (see §6.6, deferred).

---

### Phase 6 — Cleanup & MediaPipe Removal from iOS

**Architectural goal:** Remove the dual-pipeline tax from iOS. MediaPipe code path on iOS is deleted; Android continues unchanged.

**Deliverables:**

1. Strip MediaPipe Swift sources from the iOS module (Android `.aar` and JS bridge stay).
2. Conditional compilation: `expo-pose-detection`'s `ios/` directory contains only `VisionPoseService.swift` and the canonical mapper. The runtime flag `forma.pose.backend` is removed from iOS code paths (Vision is the only iOS backend).
3. Update `CLAUDE.md` §1 (architecture) and §3 (iOS constraints) to reflect Vision as the iOS detector, including the iOS 17 minimum.
4. Remove the dual-emit debug overlay and telemetry hook.
5. Final regression sweep: replay all 10 exercises × 3 body types × 2 platforms.

**Key technical considerations:**

- **Symmetry with Android matters operationally.** Logs, telemetry events, and crash reports must not distinguish backends in a way that fragments dashboards. Use `source` field in telemetry rather than separate event names.
- **App size.** Removing MediaPipe iOS frameworks should drop the IPA by ~25 MB (current MediaPipe Pose framework on iOS). Track and confirm.
- **CLAUDE.md update is mandatory** — future Claude sessions will assume MediaPipe is the iOS backend unless the doc reflects reality. This is a doc bug-class regression, not a nice-to-have.

**Validation gate (infrastructure-only):**
- ✅ `npm run prebuild:ios` and iOS Release build succeed after MediaPipe iOS sources are removed.
- ✅ Grep audit: no remaining references to MediaPipe symbols (`MPP*`, `PoseLandmarkerService`, etc.) in `modules/expo-pose-detection/ios/`.
- ✅ Android build (`npx expo run:android`) and Android MediaPipe path are unchanged — verified by diffing `modules/expo-pose-detection/android/` and asserting zero modifications in this phase.
- ✅ All TypeScript and synthetic-test suites pass unmodified.
- ✅ `CLAUDE.md` §1 and §3 updated to describe Vision as the iOS backend; reviewed in PR.
- ✅ IPA size before/after measurement is recorded in the PR description (informational — not gated against a target, since the actual delta depends on Apple's Vision footprint).

**Mathematical proof requirement:**
None — this is a deletion phase.

---

## 6. Cross-Phase Concerns

### 6.1 Feature flag taxonomy

| Flag | Phase introduced | Phase removed | Default (iOS) | Default (Android) |
|---|---|---|---|---|
| `forma.pose.skeletonAdapter` | 1 | never (always on) | on | on |
| `forma.pose.dualEmit` | 2 | 5 | off | off |
| `forma.pose.backend` | 5 | 6 (iOS only) | `vision3d` | `mediapipe` |
| `forma.heuristics.coupledMorphology` | 4 | 4+1 (after one release) | on | on |
| (note) | The flag only gates the **coupled** modulations introduced in Phase 4 (squat torso-lean × femur, pushup body-line × torso:leg, curl asymmetry baseline). The reach-ratio and torso-normalized heuristics already in `definitions/*.ts` are not flagged — they're not changing. | | | |

### 6.2 Platform parity guarantee

After Phase 6, these invariants must hold:

- A given recorded `SkeletonFrame` produces **identical** `update()` output regardless of which adapter created it.
- The Android MediaPipe adapter and iOS Vision adapter both produce `SkeletonFrame`s that pass the same validation suite.
- No `ExerciseDefinition` references any platform-specific symbol.

### 6.3 Dataset/replay format migration

The replay test framework (`src/utils/exercises/replay/`) currently stores `Keypoint[]` per frame. Phase 1 introduces `SkeletonFrame` storage; old recordings continue to work via the MediaPipe adapter being invoked at replay time. New recordings (post Phase 2) store `SkeletonFrame` directly and tag with `source`. This is a **lossless format upgrade**: old recordings remain valid forever.

### 6.4 Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Vision 3D's joint positions are systematically biased vs MediaPipe (model disagreement) | 2 | The §5.4 ratio-only design absorbs this; absolute position drift is non-issue |
| Non-LiDAR scaling error is user-perceivable in absolute distance reporting | 5 | Persist height prior in `AsyncStorage`; document one-warmup convergence |
| iOS 17 deployment target excludes some users | 2 | Vision path gated `if #available`; MediaPipe remains for iOS 16 throughout Phase 5 |
| Coupled-morphology modulation introduces a *new* body-shape bias for athletes far outside the calibration sample | 4 | Bounded-modulation proof in §5 Phase 4 (`0.7 ≤ T_mod / T_old ≤ 1.4`); flag-gated rollout |
| Profile fails to compute (occluded warmup), heuristics silently fall back to fixed thresholds | 4 | `profile = null` is treated as "today's behavior"; UX shows debug HUD line so the team notices regressions in dev |
| Dual-emit telemetry biases thermals during measurement | 2 | Time-box dual-emit to 5 minutes; measure thermals separately in single-backend mode |
| MediaPipe upgrades on Android while iOS frozen on Vision drift the canonical mapping | post-6 | Adapter unit tests pin exact joint indices; CI fails on MediaPipe SDK bumps that change taxonomy |

### 6.6 Deferred: form-accuracy validation

The infrastructure-only gates in §5 prove the migration is **wired correctly**, not that it is **scoring correctly**. Accuracy validation requires recorded landmark sessions, which today's repo does not contain (`__tests__/recordings/` is empty; the replay runner exists but has no fixtures).

A separate follow-up workstream — independent of and parallel to this migration — should:

1. Capture ≥ 3 landmark recordings per exercise across ≥ 3 body types (1.55 m, 1.78 m, 1.95 m self-reported) under the existing dev-only recording mode.
2. Capture matched MediaPipe + Vision dual-emit recordings on iPhone 14 Pro for at least 5 exercises (Phase 2 dual-emit must remain available long enough to do this).
3. Establish trainer-rated ground truth scores for a subset, since Vision may legitimately disagree with MediaPipe — the right reference is human form judgment, not the prior backend.
4. Add accuracy assertions to `replay.test.ts` once those recordings exist: rep-count parity, score-stability across body types, backend-vs-trainer agreement.

Until that workstream lands, **score / rep accuracy is verified manually on-device**, recorded in PR descriptions as smoke-test notes, and not gated in CI. This is a known and accepted limitation of the migration plan as written.

### 6.5 Telemetry events to instrument (Phase 1+)

- `pose.frame_processed` (sampled at 1 Hz): `{ source, sourceQuality, fps, p99FrameMs }`
- `pose.warmup_completed`: `{ frameCount, profile, durationMs }`
- `pose.profile_anomaly`: `{ field, value, expectedRange }` — fired on out-of-range segment ratios
- `pose.backend_switched`: `{ from, to, reason }` — Phase 5 hand-over
- `heuristic.score_drift_observation`: `{ exercise, sourceA, sourceB, scoreDelta }` — Phase 5 A/B

---

## 7. What a Senior Developer Builds, Phase by Phase

The following table compresses the above into a build order. Each row is one branch, one PR, one validation gate.

| Branch | Owner role | Touches | Gates against |
|---|---|---|---|
| `phase-1a-canonical-types` | Architect | `src/skeleton/CanonicalJoint.ts`, `src/skeleton/SkeletonFrame.ts` | TypeScript compiles, no runtime change |
| `phase-1b-mediapipe-adapter` | Senior RN | `src/skeleton/adapters/MediaPipeAdapter.ts`, `CameraScreen.tsx` | Phase 1 gate (byte-identical replay) |
| `phase-2a-vision-native` | Senior iOS | `modules/expo-pose-detection/ios/VisionPoseService.swift`, `VisionToCanonicalMapper.swift` | Builds on iOS 17 simulator + device |
| `phase-2b-dual-emit-telemetry` | Senior RN + iOS | Bridge event, JS telemetry hook | Phase 2 gates (joint agreement, FPS) |
| `phase-3-anthropometric` | Senior RN | `src/skeleton/AnthropometricProfile.ts`, profileBuilder, WarmupGate extension, dev HUD | Phase 3 gates (height correlation, stability, anatomy bounds) |
| `phase-4a-morphology-helpers` | Senior RN | `src/skeleton/morphology.ts`, attach `profile` to `ExerciseState`, debug HUD line | TS compiles, `profile` reaches `update()` |
| `phase-4b-squat-coupled` | Senior RN | `definitions/squat.ts` (femur-dominance torso-lean modulation, hip-back travel) | Squat score variance across body types ≤8 |
| `phase-4c-pushup-bodyline` | Senior RN | `definitions/pushup.ts` (torso:leg ratio adjustment) | Pushup score variance across body types ≤8 |
| `phase-4d-curl-asymmetry` | Senior RN | `definitions/barbellCurl.ts` (asymmetry baseline subtraction) | 6% structural asymmetry produces no false-positive feedback |
| `phase-4e-audit-lint` | Senior RN | ESLint/grep CI rule, allowlist | Audit passes, no regressions in other 7 exercises |
| `phase-5a-vision-default` | Senior iOS + RN | Flag promotion, height prior persistence | Phase 5 gates (60 FPS, non-LiDAR cold-start, A/B parity) |
| `phase-5b-perf-tuning` | Senior iOS | Frame skipping, ANE pinning, preprocessing queue | 60 FPS validation gate |
| `phase-6-mediapipe-strip-ios` | Senior iOS | Delete MediaPipe iOS sources, update CLAUDE.md | One release cycle stable, IPA size drop |

---

## 8. Out of Scope (Explicitly Deferred)

- **ARKit body tracking** as an alternative to Vision. ARKit's body anchor is hip-anchored and metric but requires a Metal rendering pipeline we don't have; revisit if Vision proves insufficient.
- **Custom Core ML pose model.** Vision 3D is Apple's model; we are not training our own.
- **Per-user persistent profile across sessions.** Phase 5 persists `standingHeight` for the height prior; a full per-user profile (with asymmetry corrections, mobility-driven thresholds) is a future enhancement.
- **Android Vision-equivalent** (e.g., ML Kit Pose v3 with depth). Android stays on MediaPipe until Google ships a 3D-metric equivalent at parity with Vision.
- **Exercise definitions for non-existent exercises.** This PRD only refactors the 10 existing exercises in `src/utils/exercises/definitions/`.

---

## 9. Glossary

- **Anthropometric scaling** — expressing measurements as ratios of a person's own body segments rather than absolute units, so heuristics work across body sizes.
- **Canonical joint** — a member of Forma's 19-joint enum that both MediaPipe and Vision adapters must produce.
- **Height prior** — a per-session value passed to Vision 3D on non-LiDAR devices to override the default 1.8 m subject-height assumption.
- **LiDAR** — Apple's depth-sensing hardware on Pro iPhones since iPhone 12 Pro; gives Vision 3D true metric coordinates.
- **Profile** — `AnthropometricProfile` instance; the per-session struct of measured segment lengths.
- **SkeletonFrame** — the canonical, source-agnostic value type produced by adapters and consumed by heuristics.
- **Source quality** — `'lidar' | 'estimated_height' | 'image_only'`, indicating the trustworthiness of a frame's metric coordinates.

---

## 10. Approval Checklist

Before a Senior Developer begins Phase 1:

- [ ] Architectural review of §3 (Skeleton Abstraction) signed off
- [ ] iOS deployment target decision made (16 vs 17 — affects Phase 2 gating)
- [ ] Replay test baselines re-recorded for all 10 existing exercises (Phase 1 prerequisite)
- [ ] Telemetry sink in place for the new event names (§6.5)
- [ ] Feature flag system supports the four flags in §6.1
- [ ] CLAUDE.md updates planned for Phase 1 (skeleton abstraction) and Phase 6 (MediaPipe iOS removal)

Once all phase 6 gates pass, Forma ships on Apple Vision for iOS, MediaPipe for Android, and a single body-shape-agnostic heuristic engine for both.
