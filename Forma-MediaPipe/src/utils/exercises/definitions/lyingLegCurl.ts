/**
 * Lying Leg Curl -- Exercise Definition
 *
 * Side view, knee reach ratio (hip-ankle distance / leg-chain length) as
 * primary driver.  Ratio is camera-distance-invariant.
 *
 * Person lies prone on a leg curl machine. Legs start extended (ratio ~0.96-0.98),
 * curl up to peak flexion (ratio ~0.35-0.50), then return.
 *
 * FSM: REST -> CURLING -> CURLED -> LOWERING -> REST
 * One rep = full curl up + controlled lower back down.
 *
 * Form checks:
 *   1. Knee flexion ROM   -- did they curl far enough?  (minRatio)
 *   2. Knee extension ROM -- did they fully extend?     (maxRatio)
 *   3. Hip lift            -- hips rising off the pad (torso angle change)
 *   4. Tempo               -- concentric (curl) and eccentric (lower) speed
 *
 * The only export is `lyingLegCurlDefinition`.
 */

import {
  Keypoint,
  calculateAngle2D,
  getKeypoint,
  isVisible,
} from '../../poseAnalysis';

import { SmoothedAngleTracker } from '../shared/SmoothedAngleTracker';
import { WarmupGate } from '../shared/WarmupGate';
import { computeScore, type PenaltyConfig } from '../shared/scoring';
import { LOW_ROM_FEEDBACK, isMeaningfulPartialRep } from '../shared/partialReps';
import {
  createDefaultTunableSpec,
  mergeHeuristicConfig,
  runWithConfigBindings,
} from '../heuristicConfig';
import tunedConfig from './tuned/lyingLegCurl.json';

import type {
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  ExerciseState,
  RepResult as FrameworkRepResult,
} from '../types';

// ============================================================================
// MODULE-PRIVATE HELPERS
// ============================================================================

type Point2D = { x: number; y: number };

/** Euclidean distance between two 2D points. */
function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute "reach ratio" for a three-joint chain: A-B-C.
 *   ratio = dist(A,C) / (dist(A,B) + dist(B,C))
 *
 * Returns 1.0 when perfectly straight, approaches 0 when fully folded.
 * Camera-distance-invariant because both numerator and denominator scale
 * identically with distance.
 */
function computeReachRatio(a: Point2D, b: Point2D, c: Point2D): number {
  const chainLen = dist2D(a, b) + dist2D(b, c);
  if (chainLen === 0) return 1;
  return dist2D(a, c) / chainLen;
}

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds — knee reach ratio (hip-ankle / chain length) */
const THRESHOLDS = {
  /** Ratio below which the curl clock starts before the FSM commits */
  CURL_CLOCK_START: 0.96,
  /** Ratio below which we transition REST -> CURLING (legs start to bend) */
  CURLING_ENTER: 0.90,
  /** Ratio below which we consider peak flexion (CURLING -> CURLED) */
  CURLED_ENTER: 0.55,
  /** Ratio above which we leave CURLED (hysteresis) (CURLED -> LOWERING) */
  CURLED_EXIT: 0.58,
  /** Ratio above which the extension is complete (LOWERING -> REST) */
  REST_REENTER: 0.90,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
  /** Minimum ratio ROM for a returned partial rep to count */
  MIN_PARTIAL_ROM: 0.19,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min ratio above which flexion is insufficient (didn't curl enough) */
  FLEXION_FAIL: 0.55,
  /** Max ratio below which extension is insufficient (didn't straighten) */
  EXTENSION_FAIL: 0.93,
  /** Hip angle delta from baseline above which hips are lifting */
  HIP_LIFT_WARN: 12,
  /** Concentric (curl up) too fast threshold (seconds) */
  TEMPO_CURL_MIN: 0.3,
  /** Eccentric (lower down) too fast threshold (seconds) */
  TEMPO_LOWER_MIN: 0.4,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category          | Cap | Deadzone | Scale | Key Input                            |
 * |-------------------|-----|----------|-------|--------------------------------------|
 * | ROM flexion       | 30  | 0        | 500   | max(0, minRatio - 0.45) excess       |
 * | ROM extension     | 25  | 0        | 800   | max(0, 0.96 - maxRatio) shortfall    |
 * | Hip lift          | 30  | 8        | 0.10  | max hip angle delta from baseline     |
 * | Tempo curl        | 12  | 0.4s     | 60    | concentric time deficit              |
 * | Tempo lower       | 10  | 0.5s     | 40    | eccentric time deficit               |
 *
 * Max total penalty: 107 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  FLEXION_ROM:    { cap: 30, deadzone: 0, scale: 500 } as PenaltyConfig,
  EXTENSION_ROM:  { cap: 25, deadzone: 0, scale: 800 } as PenaltyConfig,
  HIP_LIFT:       { cap: 30, deadzone: 8, scale: 0.10 } as PenaltyConfig,
  TEMPO_CURL:     { cap: 12, deadzone: 0.4, scale: 60 } as PenaltyConfig,
  TEMPO_LOWER:    { cap: 10, deadzone: 0.5, scale: 40 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;

const DEFAULT_LYING_LEG_CURL_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_LYING_LEG_CURL_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_LYING_LEG_CURL_HEURISTIC_CONFIG,
  tunedConfig,
);

const LYING_LEG_CURL_TUNABLE_SPEC = createDefaultTunableSpec(
  'Lying Leg Curl',
  DEFAULT_LYING_LEG_CURL_HEURISTIC_CONFIG,
);

const LYING_LEG_CURL_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withLyingLegCurlConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, LYING_LEG_CURL_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LyingLegCurlPhase = 'REST' | 'CURLING' | 'CURLED' | 'LOWERING';

interface LyingLegCurlFSM {
  phase: LyingLegCurlPhase;
  /** Timestamp when curl began (REST -> CURLING) */
  tRepStart: number | null;
  /** Timestamp when the user first moved out of full extension */
  tCurlStart: number | null;
  /** Timestamp when peak flexion was reached */
  tCurled: number | null;
  /** Timestamp when rep completed (LOWERING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min ratio during rep (should be low -- peak flexion) */
  minRatio: number;
  /** Max ratio during rep (should be high -- full extension at start/end) */
  maxRatio: number;
  /** Hip angle at rep start (baseline for detecting lift) */
  hipAngleBaseline: number | null;
  /** Max absolute hip angle delta from baseline during rep */
  maxHipDelta: number;
  /** Timestamps */
  tStart: number;
  tCurled: number | null;
  tLowerStart: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
}

interface LyingLegCurlState {
  fsm: LyingLegCurlFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  /** Smoothed trackers */
  ratioTracker: SmoothedAngleTracker;
  hipTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Current smoothed values for debug */
  smoothedRatio: number | null;
  /** Median-only ratio used for responsive FSM transitions */
  fastRatio: number | null;
  smoothedHip: number | null;
  /** Feedback */
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
  /** Maximum smoothed ratio observed in REST before the current rep starts */
  restMaxRatio: number;
}

interface LyingLegCurlDebugInfo {
  phase: LyingLegCurlPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  ratio: number | null;
  fastRatio: number | null;
  hipAngle: number | null;
  // Rep window
  ratioMin: number | null;
  ratioMax: number | null;
  hipDelta: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): LyingLegCurlFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tCurlStart: null,
    tCurled: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number, initialRatio?: number): RepWindow {
  return {
    minRatio: initialRatio ?? Infinity,
    maxRatio: initialRatio ?? -Infinity,
    hipAngleBaseline: null,
    maxHipDelta: 0,
    tStart,
    tCurled: null,
    tLowerStart: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function initializeLyingLegCurlState(): LyingLegCurlState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    ratioTracker: new SmoothedAngleTracker(),
    hipTracker: new SmoothedAngleTracker(),
    warmupGate: new WarmupGate({
      requiredJoints: [
        'left_hip', 'left_knee', 'left_ankle',
        'right_hip', 'right_knee', 'right_ankle',
      ],
      requiredFrames: 10,
      visibilityThreshold: 0.2,
    }),
    warmedUp: false,
    smoothedRatio: null,
    fastRatio: null,
    smoothedHip: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
    restMaxRatio: -Infinity,
  };
}

// ============================================================================
// VISIBLE SIDE SELECTION
// ============================================================================

function selectVisibleSide(keypoints: Keypoint[]): 'left' | 'right' {
  const leftParts = ['left_hip', 'left_knee', 'left_ankle', 'left_shoulder'];
  const rightParts = ['right_hip', 'right_knee', 'right_ankle', 'right_shoulder'];

  let leftScore = 0;
  let rightScore = 0;

  for (const name of leftParts) {
    const kp = getKeypoint(keypoints, name);
    if (kp) leftScore += kp.score;
  }
  for (const name of rightParts) {
    const kp = getKeypoint(keypoints, name);
    if (kp) rightScore += kp.score;
  }

  return leftScore >= rightScore ? 'left' : 'right';
}

// ============================================================================
// RATIO & ANGLE CALCULATION
// ============================================================================

/**
 * Calculate the knee reach ratio (hip-ankle / chain) in 2D.
 * ~0.96-0.98 when legs extended, ~0.35-0.50 when fully curled.
 */
function calculateKneeRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): number | null {
  const hip = getKeypoint(keypoints, `${side}_hip`);
  const knee = getKeypoint(keypoints, `${side}_knee`);
  const ankle = getKeypoint(keypoints, `${side}_ankle`);

  if (
    !hip || !knee || !ankle ||
    !isVisible(hip, VISIBILITY_THRESHOLD) ||
    !isVisible(knee, VISIBILITY_THRESHOLD) ||
    !isVisible(ankle, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  const hipPt = getPoint(hip)!;
  const kneePt = getPoint(knee)!;
  const anklePt = getPoint(ankle)!;

  return computeReachRatio(hipPt, kneePt, anklePt);
}

/**
 * Calculate the hip angle (shoulder-hip-knee) in 2D.
 * This measures the angle at the hip joint.
 * When lying flat and still, this angle stays relatively constant (~170-180deg).
 * If hips lift off the pad, this angle decreases noticeably.
 */
function calculateHipAngle(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): number | null {
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const hip = getKeypoint(keypoints, `${side}_hip`);
  const knee = getKeypoint(keypoints, `${side}_knee`);

  if (
    !shoulder || !hip || !knee ||
    !isVisible(shoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(hip, VISIBILITY_THRESHOLD) ||
    !isVisible(knee, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  return calculateAngle2D(
    getPoint(shoulder)!,
    getPoint(hip)!,
    getPoint(knee)!
  );
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: LyingLegCurlFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: LyingLegCurlFSM,
  ratio: number,
  t: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Legs extended (high ratio). When ratio drops, begin curl.
      if (ratio < THRESHOLDS.CURL_CLOCK_START) {
        fsm.tCurlStart ??= t;
      } else {
        fsm.tCurlStart = null;
      }

      if (ratio < THRESHOLDS.CURLING_ENTER) {
        fsm.phase = 'CURLING';
        fsm.tRepStart = fsm.tCurlStart ?? t;
        fsm.tCurled = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'CURLING':
      // Actively curling up. When peak flexion reached (low ratio), transition.
      if (ratio < THRESHOLDS.CURLED_ENTER) {
        fsm.phase = 'CURLED';
        fsm.tCurled = t;
      } else if (ratio > THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Extended back out without curling far enough -- reset
        fsm.phase = 'REST';
        fsm.tRepStart = null;
        fsm.tCurlStart = null;
      }
      break;

    case 'CURLED':
      // At peak flexion (low ratio). When ratio rises back (hysteresis), transition.
      if (ratio > THRESHOLDS.CURLED_EXIT) {
        fsm.phase = 'LOWERING';
      }
      break;

    case 'LOWERING':
      // Controlled eccentric. When legs return to extended position (high ratio), rep complete.
      if (
        ratio > THRESHOLDS.REST_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'REST';
        fsm.tRepEnd = t;
        repCompleted = true;
      } else if (ratio < THRESHOLDS.CURLED_ENTER) {
        // Went back to curled position -- return to CURLED
        fsm.phase = 'CURLED';
      }
      break;
  }

  return { fsm, repCompleted };
}

// ============================================================================
// SCORING (continuous penalty curves)
// ============================================================================

function computeLyingLegCurlScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM -- flexion: ideal minRatio is 0.45 or below. Excess = max(0, minRatio - 0.45)
  const flexionExcess = Math.max(0, repWindow.minRatio - 0.45);
  penalties.push({ value: flexionExcess, config: PENALTY_CONFIGS.FLEXION_ROM });

  // 2. ROM -- extension: ideal maxRatio is 0.96+. Shortfall = max(0, 0.96 - maxRatio)
  const extensionShortfall = Math.max(0, 0.96 - repWindow.maxRatio);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 3. Hip lift (hip angle delta -- already camera-invariant)
  penalties.push({ value: repWindow.maxHipDelta, config: PENALTY_CONFIGS.HIP_LIFT });

  // 4. Tempo
  if (repWindow.tCurled !== null) {
    const tCurl = repWindow.tCurled - repWindow.tStart;    // concentric (curl up)
    const tLower = repWindow.tEnd - (repWindow.tLowerStart ?? repWindow.tCurled); // eccentric (lower down)

    // Penalize if too fast (deficit is pre-computed, so pass with deadzone: 0)
    if (tCurl > 0 && tCurl < PENALTY_CONFIGS.TEMPO_CURL.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_CURL.deadzone - tCurl;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_CURL, deadzone: 0 } });
    }
    if (tLower > 0 && tLower < PENALTY_CONFIGS.TEMPO_LOWER.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_LOWER.deadzone - tLower;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_LOWER, deadzone: 0 } });
    }
  }

  return computeScore(penalties);
}

// ============================================================================
// FORM MESSAGES (discrete thresholds)
// ============================================================================

function generateFormMessages(repWindow: RepWindow): string[] {
  const messages: string[] = [];

  // 1. Flexion ROM -- didn't curl far enough (minRatio too high)
  if (repWindow.minRatio > FORM_THRESHOLDS.FLEXION_FAIL) {
    messages.push('Curl higher \u2014 bring your heels closer to your glutes.');
  }

  // 2. Extension ROM -- didn't straighten fully (maxRatio too low)
  if (repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_FAIL) {
    messages.push('Extend fully \u2014 straighten your legs at the bottom.');
  }

  // 3. Hip lift
  if (repWindow.maxHipDelta > FORM_THRESHOLDS.HIP_LIFT_WARN) {
    messages.push('Keep your hips down \u2014 avoid lifting off the pad.');
  }

  // 4. Tempo
  if (repWindow.tCurled !== null) {
    const tCurl = repWindow.tCurled - repWindow.tStart;
    const tLower = repWindow.tEnd - (repWindow.tLowerStart ?? repWindow.tCurled);

    if (tCurl > 0 && tCurl < FORM_THRESHOLDS.TEMPO_CURL_MIN) {
      messages.push('Slow down the curl \u2014 control the contraction.');
    }
    if (tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN) {
      messages.push('Control the descent \u2014 lower the weight slowly.');
    }
  }

  return messages;
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateLyingLegCurlState(
  keypoints: Keypoint[],
  currentState: LyingLegCurlState
): LyingLegCurlState {
  const t = Date.now() / 1000;

  // Warmup gate
  if (!currentState.warmedUp) {
    const ready = currentState.warmupGate.update(keypoints);
    if (!ready) {
      return currentState;
    }
    currentState.warmedUp = true;
  }

  // Select visible side in REST, then lock it through the active rep so
  // transient confidence changes do not splice two legs into one rep.
  const inActiveRep = currentState.fsm.phase !== 'REST';
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(keypoints);

  // Calculate raw ratio and hip angle
  const rawRatio = calculateKneeRatio(keypoints, visibleSide);
  const rawHip = calculateHipAngle(keypoints, visibleSide);

  // If we can't even compute the ratio, bail out
  if (rawRatio === null) {
    return {
      ...currentState,
      visibleSide,
      smoothedRatio: null,
      fastRatio: null,
      smoothedHip: null,
    };
  }

  // Smooth values through tracker pipeline
  const smoothedRatio = currentState.ratioTracker.push(rawRatio);
  const fastRatio = currentState.ratioTracker.medianValue;
  const smoothedHip = rawHip !== null
    ? currentState.hipTracker.push(rawHip)
    : currentState.hipTracker.value;

  const newState: LyingLegCurlState = {
    ...currentState,
    visibleSide,
    smoothedRatio,
    fastRatio: isNaN(fastRatio) ? null : fastRatio,
    smoothedHip: isNaN(smoothedHip) ? null : smoothedHip,
  };

  if (isNaN(fastRatio)) {
    return newState;
  }

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, fastRatio, t);
  newState.fsm = fsmResult.fsm;

  const returnedPartial =
    currentState.fsm.phase === 'CURLING' &&
    newState.fsm.phase === 'REST' &&
    !fsmResult.repCompleted &&
    newState.repWindow !== null;

  if (returnedPartial && newState.repWindow) {
    const window = newState.repWindow;
    window.tEnd = t;
    if (!isNaN(smoothedRatio)) {
      window.minRatio = Math.min(window.minRatio, smoothedRatio);
      window.maxRatio = Math.max(window.maxRatio, smoothedRatio);
    }
    const actualRom = window.maxRatio - window.minRatio;
    const duration = window.tEnd - window.tStart;

    if (isMeaningfulPartialRep({
      actualRom,
      minRom: THRESHOLDS.MIN_PARTIAL_ROM,
      duration,
      minDuration: THRESHOLDS.MIN_REP_TIME,
    })) {
      newState.repCount++;
      const score = computeLyingLegCurlScore(window);
      const messages = generateFormMessages(window);
      newState.lastRepResult = {
        repIndex: newState.repCount,
        score,
        messages,
      };
      newState.feedback = messages.length > 0 ? messages.join('\n') : 'Good rep.';
      newState.lastFeedbackTime = t;
    } else if (actualRom > 0) {
      newState.feedback = LOW_ROM_FEEDBACK;
      newState.lastFeedbackTime = t;
    }

    newState.repWindow = null;
    newState.fsm = initFSM();
    return newState;
  }

  if (newState.fsm.phase === 'REST' && !isNaN(smoothedRatio)) {
    newState.restMaxRatio = Math.max(newState.restMaxRatio, smoothedRatio);
  }

  // Track rep window while actively in a rep (not REST)
  const inRep = newState.fsm.phase !== 'REST';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(newState.fsm.tRepStart ?? t, rawRatio);
    if (currentState.restMaxRatio !== -Infinity) {
      newState.repWindow.maxRatio = currentState.restMaxRatio;
    }
    newState.restMaxRatio = -Infinity;
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update ratio min/max
    if (!isNaN(smoothedRatio)) {
      window.minRatio = Math.min(window.minRatio, smoothedRatio);
      window.maxRatio = Math.max(window.maxRatio, smoothedRatio);
    }

    // Track hip angle delta from baseline
    if (!isNaN(smoothedHip)) {
      if (window.hipAngleBaseline === null) {
        window.hipAngleBaseline = smoothedHip;
      }
      const delta = Math.abs(smoothedHip - window.hipAngleBaseline);
      window.maxHipDelta = Math.max(window.maxHipDelta, delta);
    }

    // Record curled timestamp
    if (newState.fsm.phase === 'CURLED' && window.tCurled === null) {
      window.tCurled = t;
    }

    if (
      currentState.fsm.phase === 'CURLED' &&
      window.minRatio <= FORM_THRESHOLDS.FLEXION_FAIL &&
      fastRatio > FORM_THRESHOLDS.FLEXION_FAIL &&
      window.tLowerStart === null
    ) {
      window.tLowerStart = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    newState.repWindow.tEnd = t;
    if (!isNaN(smoothedRatio)) {
      newState.repWindow.minRatio = Math.min(newState.repWindow.minRatio, smoothedRatio);
      newState.repWindow.maxRatio = Math.max(newState.repWindow.maxRatio, smoothedRatio);
    }

    newState.repCount++;

    const score = computeLyingLegCurlScore(newState.repWindow);
    const messages = generateFormMessages(newState.repWindow);

    newState.lastRepResult = {
      repIndex: newState.repCount,
      score,
      messages,
    };

    if (messages.length > 0) {
      newState.feedback = messages.join('\n');
    } else {
      newState.feedback = 'Great rep!';
    }
    newState.lastFeedbackTime = t;

    // Reset rep window and FSM
    newState.repWindow = null;
    newState.fsm = initFSM();
  }

  // Clear feedback after 2 seconds
  if (newState.feedback && t - newState.lastFeedbackTime > 2.0) {
    newState.feedback = null;
  }

  return newState;
}

// ============================================================================
// DEBUG INFO
// ============================================================================

function getDebugInfo(state: LyingLegCurlState): LyingLegCurlDebugInfo {
  const fmt = (v: number | null | undefined): number | null =>
    v !== null && v !== undefined && !isNaN(v) && isFinite(v) ? v : null;

  const fmtRatio = (v: number | null | undefined): number | null => {
    if (v === null || v === undefined || isNaN(v) || !isFinite(v)) return null;
    return Math.round(v * 1000) / 1000; // 3 decimal places for ratios
  };

  const repWin = state.repWindow;

  return {
    phase: state.fsm.phase,
    side: state.visibleSide,
    warmedUp: state.warmedUp,
    ratio: fmtRatio(state.smoothedRatio),
    fastRatio: fmtRatio(state.fastRatio),
    hipAngle: fmt(state.smoothedHip),
    ratioMin: repWin && repWin.minRatio !== Infinity ? fmtRatio(repWin.minRatio) : null,
    ratioMax: repWin && repWin.maxRatio !== -Infinity ? fmtRatio(repWin.maxRatio) : null,
    hipDelta: repWin ? fmt(repWin.maxHipDelta) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createLyingLegCurlDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_LYING_LEG_CURL_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Lying Leg Curl',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: withLyingLegCurlConfig(config, () => initializeLyingLegCurlState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as LyingLegCurlState;
    const newInternal = withLyingLegCurlConfig(
      config,
      () => updateLyingLegCurlState(keypoints, internal),
    );

    // Map internal RepResult to framework RepResult
    const lastRepResult: FrameworkRepResult | null = newInternal.lastRepResult
      ? {
          repIndex: newInternal.lastRepResult.repIndex,
          score: newInternal.lastRepResult.score,
          messages: newInternal.lastRepResult.messages,
        }
      : null;

    return {
      repCount: newInternal.repCount,
      lastRepResult,
      feedback: newInternal.feedback,
      feedbackTimestamp: newInternal.lastFeedbackTime > 0 ? newInternal.lastFeedbackTime : null,
      debugInfo: getDebugInfo(newInternal) as unknown as Record<string, unknown>,
      _internal: newInternal,
    };
  },

  heuristicConfig: config,
  tunableSpec: LYING_LEG_CURL_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/lyingLegCurl.json',
  createVariant: (variantConfig) =>
    createLyingLegCurlDefinition(mergeHeuristicConfig(config, variantConfig)),

  ttsConfig: {
    feedbackToIssue: {
      'Curl higher \u2014 bring your heels closer to your glutes.': 'rom_curl_short',
      'Extend fully \u2014 straighten your legs at the bottom.': 'rom_extend_short',
      'Keep your hips down \u2014 avoid lifting off the pad.': 'hip_lift',
      'Slow down the curl \u2014 control the contraction.': 'tempo_up',
      'Control the descent \u2014 lower the weight slowly.': 'tempo_down',
    },
    feedbackMessages: {
      'Keep your hips down \u2014 avoid lifting off the pad.': [
        'Keep your hips down.',
        'Press your hips into the pad.',
        "Don't lift your hips during the curl.",
      ],
    },
    issueDefinitions: [
      {
        issueType: 'rom_curl_short',
        priority: 25,
        messages: [
          'Curl it all the way up.',
          'Bring your heels closer to your glutes.',
          'Full range on the curl.',
        ],
      },
      {
        issueType: 'rom_extend_short',
        priority: 20,
        messages: [
          'Straighten fully at the bottom.',
          'Full extension before the next rep.',
          'Let your legs straighten.',
        ],
      },
      {
        issueType: 'hip_lift',
        priority: 30,
        messages: [
          'Keep your hips down.',
          'Keep your hips on the pad.',
          'Don\'t lift your hips.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Curl higher \u2014 bring your heels closer to your glutes.':
      'Focus on curling your heels as close to your glutes as possible for full hamstring contraction.',
    'Extend fully \u2014 straighten your legs at the bottom.':
      'Fully straighten your legs at the bottom of each rep to maximize range of motion.',
    'Keep your hips down \u2014 avoid lifting off the pad.':
      'Press your hips into the pad throughout the movement \u2014 lifting uses momentum instead of hamstring strength.',
    'Slow down the curl \u2014 control the contraction.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the curl up.',
    'Control the descent \u2014 lower the weight slowly.':
      'Slow the eccentric phase \u2014 resist the weight on the way down for 2-3 seconds.',
  },
  };
}

export const lyingLegCurlDefinition: ExerciseDefinition = createLyingLegCurlDefinition();
