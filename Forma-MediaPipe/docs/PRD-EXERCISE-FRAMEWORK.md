# PRD: Scalable Exercise Framework

**Document Version:** 1.0
**Date:** 2026-02-23
**Status:** Draft — Awaiting Approval
**Branch:** TBD

---

## 1. Overview

Forma currently supports two exercises with dedicated heuristics: Barbell Curl and Push-Up. Each was built as a standalone module with significant duplicated infrastructure (smoothing, FSM plumbing, scoring, warm-up gates). Adding a third exercise requires touching 4+ files and writing ~900-1300 lines — most of which is boilerplate identical to the first two.

This PRD defines a **scalable exercise framework** that extracts shared infrastructure into reusable primitives, introduces a registry pattern for exercise routing, and establishes a standard interface so that new exercises can be added in **200-400 lines of exercise-specific logic** instead of 900-1300 lines.

### Goals

1. **Scale to 10 exercises for beta MVP** — each addable in 1-3 days by one developer
2. **Set infrastructure for hundreds of exercises** post-launch — adding an exercise is a config + logic file, not an architecture change
3. **Eliminate boilerplate duplication** — smoothing, FSM scaffolding, scoring, warm-up gates written once
4. **Maintain accuracy** — zero regression on existing Barbell Curl and Push-Up behavior
5. **Enable replay testing** — validate heuristics against recorded landmark sequences without running the app

### Non-Goals

- Training ML models for form detection (see Section 12 for rationale)
- Changing the MediaPipe pipeline, camera setup, or landmark delivery
- Modifying the TTS coaching engine (`ttsCoach.ts`) — it's already exercise-agnostic
- Changing the frontend/backend boundary or navigation architecture
- Supporting multiple camera angles per exercise simultaneously

---

## 2. Current State — What Exists Today

### 2.1 File Map

| File | Lines | Purpose |
|------|-------|---------|
| `src/utils/barbellCurlHeuristics.ts` | 1,343 | Full barbell curl analysis: types, FSM, smoothing, scoring, feedback, warm-up gate |
| `src/utils/pushupHeuristics.ts` | 933 | Full push-up analysis: same structure, all reimplemented |
| `src/utils/poseAnalysis.ts` | 807 | Shared angle calculations + generic fallback detection/counting |
| `src/frontend/screens/CameraScreen.tsx` | ~600 | Exercise routing via if/else, state refs per exercise, UI flush, TTS trigger |
| `src/backend/services/ttsMessagePools.ts` | 313 | FEEDBACK_TO_ISSUE mapping, message pools, priority map |
| `src/backend/services/ttsCoach.ts` | 218 | Coaching engine (exercise-agnostic) |
| `src/utils/setNotesSummary.ts` | ~90 | FEEDBACK_TO_IMPROVEMENT mapping, set summary generation |

### 2.2 Current Pattern for Each Exercise

Each heuristic file independently implements:

1. **Type definitions** — exercise-specific state, FSM, rep window, angles, debug info (~80 lines)
2. **Constants/thresholds** — FSM transitions, form thresholds, scoring parameters (~60 lines)
3. **Median filter** — identical 5-sample circular buffer (~30 lines, **duplicated**)
4. **EMA smoothing** — identical α=0.3 exponential moving average (~20 lines, **duplicated**)
5. **`applySmoothing()`** — per-angle median→EMA pipeline (~50 lines, **duplicated pattern**)
6. **Warm-up gate** — identical visibility-based stability check (~30 lines, **duplicated**)
7. **FSM update** — exercise-specific state transitions (~80 lines, **unique per exercise**)
8. **Rep window tracking** — accumulate min/max/timestamps during rep (~40 lines, **partially duplicated**)
9. **`computeRepScore()`** — quadratic penalty curves (~80 lines, **duplicated formula, unique params**)
10. **`generateFormMessages()`** — discrete threshold checks → feedback strings (~100 lines, **unique per exercise**)
11. **Main `update()` function** — orchestrates everything (~150 lines, **duplicated orchestration**)
12. **Getter helpers** — `getRepCount()`, `getFormScore()`, `getFeedback()`, `getDebugInfo()` (~30 lines, **duplicated pattern**)

**Rough breakdown:** ~300 lines duplicated identically, ~300 lines duplicated with different parameters, ~300-700 lines truly exercise-specific.

### 2.3 CameraScreen Routing (Current)

```typescript
// Current: explicit if/else per exercise
const EXERCISES_WITH_HEURISTICS = new Set(['Barbell Curl', 'Push-Up']);

// In handleLandmark:
if (exerciseNameFromRoute === 'Barbell Curl') {
  const newState = updateBarbellCurlState(keypoints, barbellCurlStateRef.current);
  barbellCurlStateRef.current = newState;
  currentRepCount = getRepCount(newState);
  currentScore = getCurrentFormScore(newState);
  currentFeedback = getCurrentFeedback(newState);
  // ... TTS, accumulation, UI flush (20 lines)
} else if (exerciseNameFromRoute === 'Push-Up') {
  const newState = updatePushupState(keypoints, pushupStateRef.current);
  pushupStateRef.current = newState;
  currentRepCount = getPushupRepCount(newState);
  currentScore = getPushupFormScore(newState);
  currentFeedback = getPushupFeedback(newState);
  // ... TTS, accumulation, UI flush (20 lines, identical)
} else {
  // Generic fallback...
}
```

**Problems at 10 exercises:**
- 10 `else if` branches × ~40 lines each = 400 lines of nearly-identical routing
- 10 separate `useRef()` declarations for exercise state
- 10 separate re-initialization blocks in recording start
- Getter function names diverge (`getRepCount` vs `getPushupRepCount` vs `getSquatRepCount`...)

### 2.4 TTS Integration (Current)

Each exercise adds entries to two maps in `ttsMessagePools.ts`:
- `FEEDBACK_TO_ISSUE`: maps exact visual feedback strings → `IssueType`
- `ISSUE_POOLS`: maps `IssueType` → array of short coach voice lines
- `ISSUE_PRIORITY`: maps `IssueType` → numeric priority (10-35)

And to `setNotesSummary.ts`:
- `FEEDBACK_TO_IMPROVEMENT`: maps feedback strings → detailed improvement suggestions

This pattern works and scales fine — it's additive, not duplicative. **No structural change needed here**, just continued additions per exercise.

---

## 3. Proposed Architecture

### 3.1 Core Concept: Exercise Registry + Shared Primitives

```
                    ┌──────────────────────────────────────────────┐
                    │              ExerciseRegistry                │
                    │  .register(name, definition)                 │
                    │  .get(name) → ExerciseDefinition | null      │
                    │  .has(name) → boolean                        │
                    │  .list() → string[]                          │
                    └──────────┬───────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
     barbellCurl.ts     pushup.ts        overhead-press.ts ...
     (ExerciseDefinition) (ExerciseDefinition) (ExerciseDefinition)
              │                │                 │
              ▼                ▼                 ▼
     ┌─────────────────────────────────────────────────┐
     │              Shared Primitives                   │
     │  SmoothedAngleTracker (median + EMA)             │
     │  WarmupGate (visibility-based stability)         │
     │  computePenalty() (quadratic curve)               │
     │  RepWindowTracker (min/max/timestamp accumulator) │
     │  poseAnalysis.ts (angle math — unchanged)         │
     └─────────────────────────────────────────────────┘
```

### 3.2 Standard Exercise Interface

Every exercise exposes the same API surface — no more `getRepCount` vs `getPushupRepCount`:

```typescript
// src/utils/exercises/types.ts

export interface ExerciseState {
  /** Rep counter (integer, starts at 0) */
  repCount: number;
  /** Last completed rep's result (score + messages), or null if no reps yet */
  lastRepResult: RepResult | null;
  /** Current visual feedback string, or null */
  feedback: string | null;
  /** Timestamp of last feedback (for auto-clear) */
  feedbackTimestamp: number | null;
  /** Debug info for on-screen overlay (exercise-specific shape, opaque to CameraScreen) */
  debugInfo: Record<string, unknown>;
}

export interface RepResult {
  repIndex: number;
  score: number;         // 0-100
  messages: string[];    // Visual feedback strings (may be empty for perfect rep)
}

export interface ExerciseDefinition {
  /** Display name (must match exerciseName in route params / exercise catalog) */
  name: string;

  /** Required camera view for this exercise */
  requiredView: 'front' | 'side' | 'any';

  /** Create a fresh state object for this exercise */
  createState: () => ExerciseState;

  /** Process one frame of landmarks. Returns updated state (pure — no mutation of input). */
  update: (keypoints: Keypoint[], currentState: ExerciseState) => ExerciseState;

  /**
   * TTS config for this exercise.
   * Maps this exercise's visual feedback strings to IssueTypes and provides message pools.
   * Merged into the global TTS maps at registration time.
   */
  ttsConfig: ExerciseTTSConfig;

  /**
   * Set summary config for this exercise.
   * Maps visual feedback strings to improvement suggestions.
   * Merged into the global FEEDBACK_TO_IMPROVEMENT map at registration time.
   */
  summaryConfig: Record<string, string>;
}

export interface ExerciseTTSConfig {
  /** Maps exact visual feedback strings → IssueType */
  feedbackToIssue: Record<string, string>;
  /** New IssueType definitions with priority and message pools (only for types not already registered) */
  issueDefinitions?: Array<{
    issueType: string;
    priority: number;
    messages: string[];
  }>;
}
```

### 3.3 Exercise Registry

```typescript
// src/utils/exercises/ExerciseRegistry.ts

const registry = new Map<string, ExerciseDefinition>();

export const ExerciseRegistry = {
  register(definition: ExerciseDefinition): void {
    if (registry.has(definition.name)) {
      throw new Error(`Exercise "${definition.name}" already registered`);
    }
    registry.set(definition.name, definition);
    // Merge TTS config into global maps
    mergeTTSConfig(definition.ttsConfig);
    // Merge summary config into global maps
    mergeSummaryConfig(definition.summaryConfig);
  },

  get(name: string): ExerciseDefinition | undefined {
    return registry.get(name);
  },

  has(name: string): boolean {
    return registry.has(name);
  },

  list(): string[] {
    return Array.from(registry.keys());
  },
};
```

### 3.4 CameraScreen After Refactor

The entire if/else chain collapses to one code path:

```typescript
// CameraScreen.tsx — after refactor

import { ExerciseRegistry } from '../../utils/exercises/ExerciseRegistry';
import type { ExerciseState } from '../../utils/exercises/types';

// ONE ref for ANY exercise's state
const exerciseStateRef = useRef<ExerciseState | null>(null);

// In handleLandmark:
const exerciseDef = ExerciseRegistry.get(exerciseNameFromRoute);
if (exerciseDef && exerciseStateRef.current) {
  // Generic update — same code for ALL exercises
  const newState = exerciseDef.update(keypoints, exerciseStateRef.current);
  exerciseStateRef.current = newState;

  const currentRepCount = newState.repCount;
  const currentScore = newState.lastRepResult?.score ?? null;
  const currentFeedback = newState.feedback;

  // Rep detection, TTS, accumulation, UI flush — identical for all exercises
  if (currentRepCount > accumulatedFormScoresRef.current.length) {
    // ... accumulate, TTS, flush (written once)
  }
} else {
  // Generic fallback (unchanged)
}

// In recording start:
const exerciseDef = ExerciseRegistry.get(exerciseNameFromRoute);
if (exerciseDef) {
  exerciseStateRef.current = exerciseDef.createState();
}
```

**Lines saved:** ~400 lines of if/else routing → ~20 lines of generic code (at 10 exercises).

---

## 4. Shared Primitives

These are reusable building blocks extracted from the existing duplicated code. Each exercise imports and composes them — they are NOT mandatory (an exercise can implement everything from scratch if needed).

### 4.1 SmoothedAngleTracker

Encapsulates the median-filter + EMA pipeline for a single tracked angle.

```typescript
// src/utils/exercises/shared/SmoothedAngleTracker.ts

export interface SmoothedAngleTrackerConfig {
  medianWindow?: number;   // Default: 5
  emaAlpha?: number;       // Default: 0.3
}

export class SmoothedAngleTracker {
  private buffer: number[];       // Circular buffer for median
  private bufferIndex: number;
  private smoothedValue: number | null;
  private readonly medianWindow: number;
  private readonly emaAlpha: number;

  constructor(config?: SmoothedAngleTrackerConfig);

  /** Push a raw angle value, returns smoothed result */
  push(rawAngle: number): number;

  /** Current smoothed value (or NaN if no data yet) */
  get value(): number;

  /** Reset to initial state */
  reset(): void;
}
```

**Extracted from:** `barbellCurlHeuristics.ts` lines 711-761 (identical in `pushupHeuristics.ts`).

### 4.2 WarmupGate

Prevents FSM activation until the skeleton is stable.

```typescript
// src/utils/exercises/shared/WarmupGate.ts

export interface WarmupGateConfig {
  requiredFrames?: number;         // Default: 12 (~0.6s at 20fps)
  visibilityThreshold?: number;    // Default: 0.3
  requiredJoints: string[];        // Landmark names to check visibility
  decayRate?: number;              // Default: 2 (unstable frames decay 2x faster)
}

export class WarmupGate {
  private stableFrames: number;
  private readonly config: Required<WarmupGateConfig>;

  constructor(config: WarmupGateConfig);

  /** Process one frame's keypoints. Returns true if warmed up. */
  update(keypoints: Keypoint[]): boolean;

  /** Current stable frame count (for debug display) */
  get frameCount(): number;

  /** Reset to cold state */
  reset(): void;
}
```

**Extracted from:** `barbellCurlHeuristics.ts` lines 993-1014 (identical logic in `pushupHeuristics.ts`).

### 4.3 computePenalty()

Single quadratic penalty curve function, reusable for any scoring category.

```typescript
// src/utils/exercises/shared/scoring.ts

export interface PenaltyConfig {
  cap: number;          // Maximum penalty points
  deadzone: number;     // No penalty below this value
  scale: number;        // Quadratic coefficient
}

/**
 * Computes a single quadratic penalty: min(cap, scale × max(0, value - deadzone)²)
 * @param value - The measured value (angle deviation, time, etc.)
 * @param config - Penalty configuration
 * @returns Penalty points (0 to cap)
 */
export function computePenalty(value: number, config: PenaltyConfig): number;

/**
 * Computes total score from an array of penalty configs + values.
 * Returns max(0, min(100, 100 - totalPenalty)).
 */
export function computeScore(
  penalties: Array<{ value: number; config: PenaltyConfig }>
): number;
```

**Extracted from:** `computeRepScore()` in both heuristic files. The quadratic formula is identical — only parameters differ.

### 4.4 RepWindowTracker

Accumulates min/max values and timestamps during a rep.

```typescript
// src/utils/exercises/shared/RepWindowTracker.ts

export interface TrackedMetric {
  id: string;
  mode: 'min' | 'max' | 'delta' | 'last';  // How to aggregate across frames
}

export class RepWindowTracker {
  private values: Map<string, number[]>;
  private startTime: number | null;
  private readonly metrics: TrackedMetric[];

  constructor(metrics: TrackedMetric[]);

  /** Record one frame's values during a rep */
  record(values: Record<string, number>): void;

  /** Start tracking a new rep */
  start(): void;

  /** Finalize and return accumulated results */
  finalize(): RepWindowResult;
}

export interface RepWindowResult {
  /** Aggregated metric values (min, max, delta, or last depending on mode) */
  metrics: Record<string, number>;
  /** Rep duration in seconds */
  duration: number;
}
```

**Extracted from:** Rep window accumulation logic in both heuristic files.

### 4.5 Unchanged: poseAnalysis.ts

All angle calculation functions (`calculateAngle2D`, `calculateShoulderFlexionAngle`, `calculateSignedVerticalAngleSagittal`, etc.) remain in `src/utils/poseAnalysis.ts`. They are already shared and exercise-agnostic. **No changes needed.**

---

## 5. File Structure After Refactor

```
src/utils/
  exercises/
    types.ts                         # ExerciseState, ExerciseDefinition, RepResult interfaces
    ExerciseRegistry.ts              # Registry singleton + TTS/summary config merging
    index.ts                         # Re-exports registry + types
    shared/
      SmoothedAngleTracker.ts        # Median + EMA smoothing for one angle
      WarmupGate.ts                  # Visibility-based stability gate
      scoring.ts                     # computePenalty(), computeScore()
      RepWindowTracker.ts            # Min/max accumulator for rep windows
      index.ts                       # Re-exports all shared primitives
    definitions/
      barbellCurl.ts                 # Barbell curl ExerciseDefinition (migrated)
      pushup.ts                      # Push-up ExerciseDefinition (migrated)
      overheadPress.ts               # NEW — overhead press
      squat.ts                       # NEW — squat
      deadlift.ts                    # NEW — deadlift (RDL)
      lateralRaise.ts                # NEW — lateral raise
      tricepExtension.ts             # NEW — tricep extension
      hammerCurl.ts                  # NEW — hammer curl
      bentOverRow.ts                 # NEW — bent over row
      plankHold.ts                   # NEW — plank (isometric, time-based)
      register.ts                    # Imports all definitions, calls ExerciseRegistry.register()
  poseAnalysis.ts                    # UNCHANGED — shared angle math
  setNotesSummary.ts                 # MODIFIED — reads from registry instead of hardcoded map
```

### What Happens to Old Files

| Old File | Action |
|----------|--------|
| `src/utils/barbellCurlHeuristics.ts` | **Migrated** → `src/utils/exercises/definitions/barbellCurl.ts`. Old file deleted after migration verified. |
| `src/utils/pushupHeuristics.ts` | **Migrated** → `src/utils/exercises/definitions/pushup.ts`. Old file deleted after migration verified. |
| `src/utils/poseAnalysis.ts` | **Unchanged** — stays where it is. |
| `src/utils/setNotesSummary.ts` | **Modified** — reads `FEEDBACK_TO_IMPROVEMENT` from registry instead of hardcoded map. |
| `src/backend/services/ttsMessagePools.ts` | **Modified** — base issue types + pools remain, exercise-specific entries registered dynamically. |
| `src/frontend/screens/CameraScreen.tsx` | **Simplified** — if/else chain replaced with registry lookup. |

---

## 6. Anatomy of an Exercise Definition

Here's what a new exercise file looks like using the framework. Example: **Overhead Press**.

```typescript
// src/utils/exercises/definitions/overheadPress.ts

import { Keypoint } from '../../poseAnalysis';
import {
  calculateAngle2D,
  calculateSignedVerticalAngleSagittal,
  getKeypoint,
} from '../../poseAnalysis';
import { SmoothedAngleTracker } from '../shared/SmoothedAngleTracker';
import { WarmupGate } from '../shared/WarmupGate';
import { computeScore, PenaltyConfig } from '../shared/scoring';
import type { ExerciseDefinition, ExerciseState, RepResult } from '../types';

// ── 1. Exercise-Specific Types ────────────────────────────────
// (Only what's unique to this exercise)

type Phase = 'REST' | 'PRESSING' | 'TOP' | 'LOWERING';

interface OHPInternalState {
  phase: Phase;
  elbowL: SmoothedAngleTracker;
  elbowR: SmoothedAngleTracker;
  torso: SmoothedAngleTracker;
  warmup: WarmupGate;
  repStartTime: number | null;
  repTopTime: number | null;
  minElbowAngle: number;
  maxTorsoDeviation: number;
  // ... other rep-window accumulators
}

// ── 2. Thresholds ─────────────────────────────────────────────

const T = {
  REST_EXIT: 135,        // Elbow below this → start pressing
  TOP_ENTER: 165,        // Elbow above this → top of press
  TOP_EXIT: 160,         // Elbow below this → start lowering
  REST_ENTER: 140,       // Elbow below this → rep complete
  MIN_REP_TIME: 0.5,
} as const;

// ── 3. Penalty Configs ────────────────────────────────────────

const PENALTIES = {
  torsoLean: { cap: 30, deadzone: 5, scale: 0.4 } as PenaltyConfig,
  rom:       { cap: 25, deadzone: 15, scale: 0.03 } as PenaltyConfig,
  tempo:     { cap: 15, deadzone: 0.4, scale: 50 } as PenaltyConfig,
  lockout:   { cap: 20, deadzone: 170, scale: 0.08 } as PenaltyConfig,
};

// ── 4. FSM + Update Logic ─────────────────────────────────────
// (The ONLY part that requires real exercise knowledge)

function updateInternal(
  keypoints: Keypoint[],
  internal: OHPInternalState,
  external: ExerciseState
): { internal: OHPInternalState; external: ExerciseState } {
  // 1. Compute & smooth angles
  // 2. Warmup gate
  // 3. FSM transitions
  // 4. Rep window tracking
  // 5. On rep complete: score + feedback
  // ... (~150-250 lines of pure exercise logic)
}

// ── 5. Registration ───────────────────────────────────────────

export const overheadPressDefinition: ExerciseDefinition = {
  name: 'Overhead Press',
  requiredView: 'front',

  createState: (): ExerciseState => {
    // Initialize internal state (closured or stored in a WeakMap)
    // Return standard ExerciseState shape
  },

  update: (keypoints, currentState) => {
    // Delegate to updateInternal
  },

  ttsConfig: {
    feedbackToIssue: {
      'Keep your torso upright — avoid leaning back.': 'torso_warn',
      'Excessive back lean — brace your core.': 'torso_fail',
      'Press all the way up — full lockout.': 'lockout_short',
      'Go deeper — lower the bar to shoulder height.': 'depth_short',
      // ... exercise-specific feedback mappings
    },
    issueDefinitions: [
      // Only define NEW issue types not already in the global pool.
      // Reuse existing types (torso_warn, lockout_short, etc.) when applicable.
    ],
  },

  summaryConfig: {
    'Keep your torso upright — avoid leaning back.':
      'Focus on bracing your core before each rep. Slight lean is normal on heavy sets, but excessive lean shifts load to your lower back.',
    // ... improvement suggestions per feedback string
  },
};
```

**Total lines for a new exercise:** ~200-400 (exercise-specific logic only). Compare to ~933-1343 today.

---

## 7. Internal State Management

### The Problem

`ExerciseState` is a standardized external interface (repCount, feedback, score). But each exercise has unique internal state (FSM phase, smoothed angle trackers, rep window accumulators). CameraScreen should not know about internal state.

### The Solution: Opaque Internal State

Each exercise stores its internal state inside the `ExerciseState` object in an opaque field:

```typescript
export interface ExerciseState {
  repCount: number;
  lastRepResult: RepResult | null;
  feedback: string | null;
  feedbackTimestamp: number | null;
  debugInfo: Record<string, unknown>;

  /** Opaque internal state — only the exercise's own update() reads/writes this */
  _internal: unknown;
}
```

CameraScreen never reads `_internal`. Each exercise's `createState()` initializes it with exercise-specific types, and `update()` casts it back:

```typescript
// Inside overheadPress.ts
createState: (): ExerciseState => ({
  repCount: 0,
  lastRepResult: null,
  feedback: null,
  feedbackTimestamp: null,
  debugInfo: {},
  _internal: createOHPInternalState(),  // typed internally as OHPInternalState
}),

update: (keypoints, state) => {
  const internal = state._internal as OHPInternalState;
  // ... use typed internal state
},
```

This avoids generics complexity, keeps CameraScreen simple, and gives each exercise full control over its internal data structures.

---

## 8. Migration Plan — Existing Exercises

### 8.1 Barbell Curl Migration

**Approach:** Wrap, don't rewrite. The existing `barbellCurlHeuristics.ts` logic is battle-tested. Migration means:

1. Move `BarbellCurlState` into `_internal`
2. Create `barbellCurl.ts` in `definitions/` that wraps existing functions
3. Replace duplicated smoothing/warmup with shared primitives **only where the implementation is truly identical** — if the barbell curl has any exercise-specific tweaks to smoothing, keep them
4. Expose standard `ExerciseState` getters
5. Register TTS config (move barbell curl entries from `ttsMessagePools.ts` into the definition)
6. Verify identical output by running both old and new paths side-by-side against recorded landmark data

**Critical rule:** If any behavioral difference is detected during migration, keep the old behavior. The framework must be a no-op refactor for existing exercises.

### 8.2 Push-Up Migration

Same approach as barbell curl. The push-up has a different FSM shape (IDLE gate, single-body, partial rep escape) — all of this stays in the exercise-specific `update()` function.

### 8.3 Verification Strategy

Before deleting old files:

1. Record 3 landmark sequences per exercise (clean form, bad form, mixed)
2. Run both old `updateBarbellCurlState()` and new `barbellCurlDefinition.update()` against each recording
3. Assert identical: rep count, rep scores (exact), feedback messages (exact), feedback timing
4. If any difference → investigate and fix the new path, do NOT change the old path

---

## 9. CameraScreen Changes

### 9.1 Before (Current)

```
Imports:
  - 8 named imports from barbellCurlHeuristics
  - 9 named imports from pushupHeuristics
  - 3 named imports from poseAnalysis (fallback)
  - 5 named imports from ttsCoach

Refs:
  - barbellCurlStateRef = useRef<BarbellCurlState>(...)
  - pushupStateRef = useRef<PushupState>(...)

handleLandmark:
  - if (Barbell Curl) { ... 40 lines ... }
  - else if (Push-Up) { ... 40 lines ... }
  - else { ... 50 lines (generic) ... }

Recording start:
  - if (Barbell Curl) { barbellCurlStateRef.current = initialize...() }
  - else if (Push-Up) { pushupStateRef.current = initialize...() }
```

### 9.2 After (Refactored)

```
Imports:
  - ExerciseRegistry from exercises/ExerciseRegistry
  - ExerciseState from exercises/types
  - 3 named imports from poseAnalysis (fallback — unchanged)
  - 5 named imports from ttsCoach (unchanged)

Refs:
  - exerciseStateRef = useRef<ExerciseState | null>(null)

handleLandmark:
  - const def = ExerciseRegistry.get(exerciseName)
  - if (def) { ... 20 lines (generic) ... }
  - else { ... 50 lines (generic fallback — unchanged) ... }

Recording start:
  - const def = ExerciseRegistry.get(exerciseName)
  - if (def) { exerciseStateRef.current = def.createState() }
```

### 9.3 Changes Summary

| Aspect | Before | After |
|--------|--------|-------|
| Exercise-specific imports | 17+ (grows with each exercise) | 2 (fixed) |
| State refs | 1 per exercise (grows) | 1 total (fixed) |
| handleLandmark routing | if/else chain (grows) | Registry lookup (fixed) |
| Recording start | if/else chain (grows) | Registry lookup (fixed) |
| Lines of exercise routing code | ~80 × N exercises | ~20 total |

---

## 10. TTS & Summary Integration

### 10.1 Current: Centralized Maps

`ttsMessagePools.ts` has a single `FEEDBACK_TO_ISSUE` object with entries for all exercises. Same for `ISSUE_POOLS`, `ISSUE_PRIORITY`, and `setNotesSummary.ts`'s `FEEDBACK_TO_IMPROVEMENT`.

### 10.2 After: Exercise-Registered + Base Maps

The TTS system keeps its base maps (positive pools, transition pools, set-start pools, shared issue types like `tempo_up`). Exercise-specific entries are registered by each exercise definition.

```typescript
// ttsMessagePools.ts — after refactor

// ── Base issue types (shared across exercises) ──
// These remain hardcoded because multiple exercises reuse them:
//   torso_warn, torso_fail, tempo_up, tempo_down, asymmetry, etc.

// ── Exercise-specific entries ──
// Registered dynamically when ExerciseRegistry.register() is called.
// The registry calls mergeTTSConfig() which adds to FEEDBACK_TO_ISSUE and ISSUE_POOLS.

export function mergeTTSConfig(config: ExerciseTTSConfig): void {
  // Add feedbackToIssue entries
  // Add new issue definitions (if any)
  // Validate no conflicts with existing entries
}
```

**Why not move everything into definitions?** Because `ttsCoach.ts` needs the maps to exist at import time. The registry's `register()` calls happen at module load (in `register.ts`), before any landmark processing starts. This is safe as long as `register.ts` is imported early (e.g., in `App.tsx` or CameraScreen's top-level scope).

### 10.3 Load Order

```
App.tsx or CameraScreen.tsx (top-level import)
  → import '../../utils/exercises/definitions/register'
    → register.ts imports each definition file
    → each definition file calls ExerciseRegistry.register()
    → register() calls mergeTTSConfig() and mergeSummaryConfig()
  → ttsCoach.ts and setNotesSummary.ts now have all entries available
```

---

## 11. Replay Testing Framework

### 11.1 Why This Matters

Today, validating a heuristic change requires:
1. Open the app on a physical device
2. Set up camera angle
3. Perform the exercise
4. Observe results
5. Repeat for different form variations

This is slow (~5 min per test), non-reproducible (human form varies), and can't catch regressions (no automated comparison to baseline).

### 11.2 Recording Format

```typescript
// LandmarkRecording: a sequence of frames captured from a real session

interface LandmarkRecording {
  exerciseName: string;
  metadata: {
    recordedAt: string;
    duration: number;
    description: string;    // e.g., "5 clean curls, front view"
    expectedReps: number;
    expectedScoreRange: [number, number];  // e.g., [90, 100]
  };
  frames: Array<{
    timestamp: number;      // ms since start
    keypoints: Keypoint[];  // 33 landmarks
  }>;
}
```

### 11.3 Recording Capture

Add a dev-only recording mode to CameraScreen (gated behind `__DEV__`):

```typescript
// When debug recording is enabled, buffer all keypoint frames
if (__DEV__ && isRecordingLandmarksRef.current) {
  landmarkBufferRef.current.push({
    timestamp: Date.now() - recordingStartTimeRef.current,
    keypoints,
  });
}
// On stop: serialize to JSON, save to device filesystem via expo-file-system
```

### 11.4 Replay Runner

```typescript
// src/utils/exercises/__tests__/replayRunner.ts

export function replayRecording(
  definition: ExerciseDefinition,
  recording: LandmarkRecording
): ReplayResult {
  let state = definition.createState();

  for (const frame of recording.frames) {
    state = definition.update(frame.keypoints, state);
  }

  return {
    finalRepCount: state.repCount,
    repScores: extractRepScores(state),  // from accumulated lastRepResult
    feedbackMessages: extractFeedbackHistory(state),
  };
}
```

### 11.5 Test Structure

```typescript
// src/utils/exercises/__tests__/barbellCurl.replay.test.ts

describe('Barbell Curl - Replay Tests', () => {
  it('counts 5 clean reps correctly', () => {
    const recording = loadRecording('barbell_curl_5_clean_front.json');
    const result = replayRecording(barbellCurlDefinition, recording);
    expect(result.finalRepCount).toBe(5);
    result.repScores.forEach(score => expect(score).toBeGreaterThan(85));
  });

  it('detects torso swing and penalizes score', () => {
    const recording = loadRecording('barbell_curl_3_torso_swing.json');
    const result = replayRecording(barbellCurlDefinition, recording);
    expect(result.finalRepCount).toBe(3);
    result.repScores.forEach(score => expect(score).toBeLessThan(75));
    expect(result.feedbackMessages.some(m => m.includes('swing'))).toBe(true);
  });
});
```

### 11.6 Baseline Snapshots

When migrating existing exercises, record baseline outputs (rep count, scores, feedback per frame) from the old implementation. The replay tests for migrated exercises assert **exact match** against these baselines. This guarantees the migration is a no-op.

---

## 12. Why Heuristics Over ML (Decision Record)

This section documents the decision to continue with heuristic-based form analysis rather than training custom ML models. This is a **deliberate architectural choice**, not a deferral.

### 12.1 What Heuristics Give Us

| Property | Heuristic Approach |
|----------|-------------------|
| **Explainability** | "Your torso leaned 18° — keep it under 12°." Users and coaches can understand, trust, and act on feedback. |
| **Debuggability** | When scoring is wrong, we can inspect exact angle values, penalty contributions, and FSM state. Fix is targeted. |
| **Data requirements** | Zero training data. Exercise knowledge comes from biomechanics literature and coaching expertise. |
| **Time to add exercise** | 1-3 days with the framework (write thresholds, test with replay). |
| **Mobile performance** | Zero additional models. MediaPipe's 33 landmarks are the only inference cost. |
| **Iteration speed** | Change a threshold → test immediately. No retraining, no data pipeline, no GPU. |

### 12.2 What ML Would Require

| Requirement | Estimated Cost |
|-------------|---------------|
| Labeled training data | 5,000-10,000 reps per exercise, both correct AND incorrect form, multiple body types and camera angles |
| Labeling workforce | Certified trainers annotating video frame-by-frame with form quality scores |
| Training infrastructure | GPU compute for model training + hyperparameter tuning per exercise |
| Model optimization | Quantization, TFLite conversion, on-device validation for both iOS (JSC) and Android (Hermes) |
| Model size budget | ~5-20MB per exercise model × hundreds of exercises = significant app size |
| Debugging | "Why did the model score this rep 72?" — no clear answer. Requires interpretability tooling. |
| Team skillset | ML engineer (not currently on team) |

### 12.3 When to Revisit

ML becomes valuable when:
1. **Post-launch data flywheel** — thousands of real user reps with opt-in video, providing natural training data
2. **Complex movements** — Olympic lifts (snatch, clean & jerk) where the movement has too many interdependent phases for simple angle thresholds
3. **Per-user calibration** — ML model fine-tuned on an individual's body proportions and movement patterns
4. **Anomaly detection** — ML as a secondary signal ("something looks unusual") that triggers closer heuristic inspection

**Recommended approach when that time comes:** Hybrid architecture where heuristics remain the primary scoring/feedback engine (explainable, deterministic) and ML provides supplementary signals (anomaly flags, confidence modifiers). Never replace heuristics entirely — users need to understand *why* their form was scored a certain way.

---

## 13. Beta MVP — 10 Exercise Targets

### 13.1 Exercise Selection Criteria

Exercises chosen for beta MVP based on:
- **Popularity:** Most commonly performed in gyms
- **MediaPipe suitability:** Detectable with 33 upper/lower body landmarks
- **Camera view simplicity:** Single view angle (front OR side, not both required)
- **Form error detectability:** Common mistakes map cleanly to joint angles
- **Diversity:** Mix of push/pull/legs to cover full workout programs

### 13.2 Target Exercise List

| # | Exercise | View | Primary Angles | Key Form Checks | Complexity |
|---|----------|------|----------------|-----------------|------------|
| 1 | **Barbell Curl** (existing) | Front | Elbow, shoulder, torso | ROM, shoulder takeover, torso swing, tempo, symmetry | High — two-arm sync, view angle compensation |
| 2 | **Push-Up** (existing) | Side | Elbow, body alignment, hip | Depth, lockout, hip sag/pike, tempo | Medium — idle gate, partial rep escape |
| 3 | **Overhead Press** | Front | Elbow, torso | Lockout, torso lean, ROM, tempo, symmetry | Medium — similar to curl but inverted motion |
| 4 | **Lat Pulldown** | Front | Elbow, shoulder, torso | ROM (full pull/extension), elbow flare, torso lean, tempo, symmetry | Medium — vertical pull pattern, elbow + shoulder angles |
| 5 | **Cable Pushdowns** | Side | Elbow, shoulder, torso | ROM (full extension), elbow flare, torso lean/momentum, tempo | Low — single angle driver, similar FSM to curl |
| 6 | **Barbell Squat** | Side | Knee, hip, torso | Depth, knee tracking, torso lean, tempo | Medium — needs hip/knee angle, torso forward lean |
| 7 | **Standing Dumbbell Lateral Raises** | Front | Shoulder abduction, elbow, torso | ROM (raise height), elbow bend, torso lean/momentum, symmetry | Low-Medium — shoulder abduction angle as driver |
| 8 | **Romanian Deadlift (RDL)** | Side | Hip hinge, knee, torso | Hip hinge depth, back rounding, knee softness, tempo | Medium — hip hinge angle is primary driver |
| 9 | **Bent-Over Row** | Side | Elbow, torso angle, shoulder | Torso angle maintenance, ROM (pull height), tempo, momentum | Medium — torso angle is a prerequisite, not a penalty |
| 10 | **Plank Hold** (isometric) | Side | Body alignment, hip | Hip sag/pike, hold duration, stability | Low — no reps, time-based scoring |

### 13.3 Complexity & Reuse Analysis

**Can reuse barbell curl FSM pattern (UP→TOP→DOWN cycles):**
- Overhead Press (inverted — push up instead of curl up)
- Lat Pulldown (vertical pull, elbow angle as driver)
- Cable Pushdowns (single-angle driver: elbow)
- Standing Dumbbell Lateral Raises (shoulder abduction angle as driver)

**Can reuse push-up FSM pattern (body-position-gated, single-side view):**
- Barbell Squat (knee angle drives phases, torso lean is form check)
- RDL (hip angle drives phases)
- Bent-Over Row (torso angle prerequisite + elbow angle for rep counting)

**Unique pattern:**
- Plank Hold (isometric — no rep FSM, time-based scoring with continuous form evaluation)

### 13.4 Estimated Effort Per Exercise (With Framework)

| Exercise | Estimated LOC | Estimated Time | Notes |
|----------|---------------|----------------|-------|
| Overhead Press | 250-300 | 1.5 days | Reuse curl FSM pattern inverted |
| Lat Pulldown | 250-300 | 1.5 days | Vertical pull, front-view, symmetry |
| Cable Pushdowns | 200-250 | 1 day | Single angle driver, similar FSM to curl |
| Barbell Squat | 300-350 | 2 days | New angle set (knee, hip), side-view |
| Standing Dumbbell Lateral Raises | 200-250 | 1 day | Simple raise/lower, shoulder abduction angle |
| RDL | 250-300 | 1.5 days | Hip hinge focus, similar to squat structure |
| Bent-Over Row | 300-350 | 2 days | Torso prerequisite angle + pull detection |
| Plank Hold | 200-250 | 1.5 days | New pattern (isometric), simpler FSM |

**Total for 8 new exercises:** ~1,850-2,250 lines, ~11 dev-days

Compare without framework: ~8,000-10,000 lines, ~25-30 dev-days

---

## 14. Implementation Phases

### Phase 1: Framework Foundation (5-7 days)

**Goal:** Build the framework, migrate existing exercises, verify zero regression.

| Step | Task | Files Created/Modified | Verification |
|------|------|----------------------|-------------|
| 1.1 | Create `ExerciseState`, `ExerciseDefinition`, `RepResult` types | `src/utils/exercises/types.ts` | TypeScript compiles |
| 1.2 | Build `ExerciseRegistry` singleton | `src/utils/exercises/ExerciseRegistry.ts` | Unit tests: register, get, has, list, duplicate rejection |
| 1.3 | Extract `SmoothedAngleTracker` from barbell curl | `src/utils/exercises/shared/SmoothedAngleTracker.ts` | Unit tests: identical output to inline median+EMA for same input sequence |
| 1.4 | Extract `WarmupGate` | `src/utils/exercises/shared/WarmupGate.ts` | Unit tests: same frame-count behavior as inline implementation |
| 1.5 | Extract `computePenalty()` / `computeScore()` | `src/utils/exercises/shared/scoring.ts` | Unit tests: known input/output pairs from existing curl scoring |
| 1.6 | Extract `RepWindowTracker` | `src/utils/exercises/shared/RepWindowTracker.ts` | Unit tests: min/max/delta accumulation |
| 1.7 | Migrate barbell curl to `ExerciseDefinition` | `src/utils/exercises/definitions/barbellCurl.ts` | **Replay test: exact match against baseline** |
| 1.8 | Migrate push-up to `ExerciseDefinition` | `src/utils/exercises/definitions/pushup.ts` | **Replay test: exact match against baseline** |
| 1.9 | Create `register.ts` that imports + registers both | `src/utils/exercises/definitions/register.ts` | Both exercises in registry |
| 1.10 | Refactor CameraScreen to use registry | `src/frontend/screens/CameraScreen.tsx` | Manual test on device: curls and pushups work identically |
| 1.11 | Update TTS integration (merge pattern) | `src/backend/services/ttsMessagePools.ts` | TTS speaks correct cues for both exercises |
| 1.12 | Update set summary integration | `src/utils/setNotesSummary.ts` | Set notes show correct improvement suggestions |
| 1.13 | Delete old heuristic files | Remove `barbellCurlHeuristics.ts`, `pushupHeuristics.ts` | Build succeeds, all imports resolve |
| 1.14 | Add landmark recording mode (dev-only) | `CameraScreen.tsx` (gated behind `__DEV__`) | Can capture + export landmark JSON |

**Exit criteria:**
- Barbell curl and push-up work identically to before (verified by replay tests + manual device testing)
- CameraScreen has zero exercise-specific if/else branches
- Framework compiles and all types are clean
- At least 2 replay test recordings per existing exercise (clean form, bad form)

### Phase 2: First Wave of New Exercises (8-10 days)

**Goal:** Add 4 exercises to validate the framework scales.

| Step | Exercise | Priority | Notes |
|------|----------|----------|-------|
| 2.1 | Lat Pulldown | High | Vertical pull, validates front-view two-arm path |
| 2.2 | Cable Pushdowns | High | Simple FSM, validates single-angle driver path |
| 2.3 | Barbell Squat | High — most requested | New angle set, validates framework with different body mechanics |
| 2.4 | Standing Dumbbell Lateral Raises | Medium | Validates shoulder abduction detection |

**Per exercise:**
1. Write definition file in `definitions/`
2. Register in `register.ts`
3. Record 2-3 landmark sequences (clean, bad form)
4. Write replay tests
5. Manual device test (2-3 sets each)
6. Tune thresholds based on test results

**Exit criteria:**
- 6 total exercises working (2 migrated + 4 new)
- Each has replay tests (clean + bad form)
- CameraScreen unchanged from Phase 1 (no new code needed)
- TTS works for all 6 exercises

### Phase 3: Complete Beta MVP (5-7 days)

**Goal:** Add remaining 4 exercises, polish, full regression pass.

| Step | Exercise | Notes |
|------|----------|-------|
| 3.1 | Overhead Press | Front view, inverted curl pattern |
| 3.2 | RDL | Side view, hip hinge pattern |
| 3.3 | Bent-Over Row | Side view, torso prerequisite + pull |
| 3.4 | Plank Hold | Side view, isometric (new pattern) |

**Additional work:**
- Full regression suite: replay all 10 exercises × 2-3 recordings each
- Threshold tuning pass: collect 5+ real recordings per exercise, adjust deadzones/scales
- TTS pool review: ensure all 10 exercises have natural-sounding coaching cues
- Update exercise catalog / database to mark which exercises have heuristic support

**Exit criteria:**
- 10 exercises working with heuristic-based form analysis
- All have replay tests
- Full regression suite passes
- TTS coaching works for all 10

---

## 15. Success Criteria

| Criterion | Verification |
|-----------|-------------|
| Framework is exercise-agnostic | CameraScreen has zero exercise-specific code paths |
| Adding a new exercise requires no CameraScreen changes | Add hammer curl without touching CameraScreen |
| Existing exercises unchanged | Replay tests produce exact baseline match for barbell curl and push-up |
| New exercises are accurate | ±1 rep over 15-rep set; form score correlates with intentional form errors |
| Exercise definition is concise | Each new exercise ≤ 400 lines |
| Replay tests exist for all 10 exercises | At least 2 recordings each (clean form, bad form) |
| No iOS or Android build breakage | `npx expo prebuild --platform ios --clean` and `npx expo run:android` succeed |
| TTS works for all exercises | Each exercise's form errors produce spoken coaching cues |
| No performance regression | Landmark processing stays under 16ms per frame (maintains 30fps+ analysis) |

---

## 16. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Migration introduces subtle scoring differences | Medium | High | Replay baseline snapshots; exact-match assertions |
| `_internal` opaque state makes debugging harder | Low | Medium | Each exercise exposes `debugInfo` in standard shape; dev overlay unchanged |
| TTS config merge order causes missing entries | Low | High | Registry validates all feedback strings have issue mappings at registration time; warning in dev if unmapped |
| Some exercises need patterns the framework doesn't cover | Medium | Low | Framework is opt-in — exercises can implement `update()` from scratch using only shared angle math |
| Replay recordings don't capture enough variation | Medium | Medium | Start with 2-3 recordings; expand to 5+ per exercise during Phase 3 tuning pass |
| SmoothedAngleTracker class instances in state break React's immutability expectations | Medium | Medium | State is in refs (not useState), so mutation is fine. Document this clearly. |

---

## 17. Future Extensions (Post-Beta)

These are **not in scope** for this PRD but are enabled by the framework:

1. **Exercise variations** — e.g., "Wide Push-Up" registers as a variant of Push-Up with adjusted thresholds, sharing 90% of the definition
2. **Auto-detection** — registry provides `canDetect(keypoints)` per exercise for auto-exercise-identification
3. **Per-user calibration** — store user's baseline angles (e.g., max ROM) and adjust deadzones accordingly
4. **A/B testing thresholds** — registry supports multiple versions of a definition, switchable via feature flag
5. **Community exercises** — external JSON configs that define simple exercises without code changes
6. **ML supplementary signals** — hybrid scoring where heuristic score is primary, ML confidence modifier adjusts ±5 points
