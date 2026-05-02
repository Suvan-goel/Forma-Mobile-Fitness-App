/**
 * Cable Lat Pulldowns -- Exercise Definition
 *
 * Side or diagonal view, single (best-visible) arm reach-ratio as primary driver.
 * No symmetry tracking. Works from side, diagonal, or any angle where one arm
 * and the torso are visible.
 * FSM: REST -> PULLING -> BOTTOM -> RETURNING -> REST
 *
 * Reach ratio = dist2D(shoulder,wrist) / (dist2D(shoulder,elbow) + dist2D(elbow,wrist))
 * Arms extended overhead: ratio ~0.93-0.97. Pulled down: ratio ~0.40-0.55.
 * One rep = full pull-down + controlled return.
 *
 * The only export is `latPulldownDefinition`.
 */

import {
  Keypoint,
  calculateVerticalAngle,
  getKeypoint,
  isVisible,
  minKeypointConfidence,
} from '../../poseAnalysis';

import { SmoothedAngleTracker } from '../shared/SmoothedAngleTracker';
import { WarmupGate } from '../shared/WarmupGate';
import { computeScore, type PenaltyConfig } from '../shared/scoring';
import {
  createDefaultTunableSpec,
  mergeHeuristicConfig,
  runWithConfigBindings,
} from '../heuristicConfig';
import tunedConfig from './tuned/latPulldown.json';

import type {
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  ExerciseState,
  RepResult as FrameworkRepResult,
} from '../types';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (reach ratio of the active arm) */
const THRESHOLDS = {
  /** Ratio below which we transition REST -> PULLING.
   *  Extended arm ~0.93-0.97; set to 0.93 to avoid false entry from noise. */
  PULLING_ENTER: 0.93,
  /** Ratio below which we consider bottom position (PULLING -> BOTTOM) */
  BOTTOM_ENTER: 0.58,
  /** Ratio above which we leave BOTTOM (hysteresis) (BOTTOM -> RETURNING) */
  BOTTOM_EXIT: 0.60,
  /** Ratio above which the return is complete (RETURNING -> REST) */
  REST_REENTER: 0.88,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
  /** Minimum time (seconds) to stay in PULLING before allowing abort back to REST.
   *  Prevents rapid flicker when the idle arm ratio hovers near PULLING_ENTER. */
  PULLING_ABORT_MIN_TIME: 0.25,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min ratio above which pull is insufficient (didn't pull deep enough) */
  PULL_ROM_FAIL: 0.60,
  /** Max ratio below which extension is insufficient */
  EXTENSION_ROM_FAIL: 0.86,
  /** Torso lean above which there is excessive lean (degrees from vertical, 0-90) */
  TORSO_LEAN_WARN: 30,
  /** Concentric (pull down) too fast threshold (seconds). */
  TEMPO_PULL_MIN: 0.20,
  /** Eccentric (return) too fast threshold (seconds). */
  TEMPO_RETURN_MIN: 0.8,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category         | Cap | Deadzone | Scale  | Key Input                        |
 * |------------------|-----|----------|--------|----------------------------------|
 * | ROM pull         | 30  | 0        | 400    | minRatio shortfall from 0.58     |
 * | ROM extension    | 25  | 0        | 300    | maxRatio shortfall from 0.97     |
 * | Torso lean       | 25  | 8        | 0.12   | max torso lean from vertical     |
 * | Tempo pull       | 10  | 0.35s    | 50     | concentric time deficit          |
 * | Tempo return     | 25  | 0.80s    | 800    | eccentric time deficit           |
 *
 * Max total penalty: 100 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  PULL_ROM:      { cap: 30, deadzone: 0, scale: 400 } as PenaltyConfig,
  EXTENSION_ROM: { cap: 25, deadzone: 0, scale: 300 } as PenaltyConfig,
  TORSO_LEAN:    { cap: 25, deadzone: 20, scale: 0.10 } as PenaltyConfig,
  TEMPO_PULL:    { cap: 10, deadzone: 0.35, scale: 50 } as PenaltyConfig,
  TEMPO_RETURN:  { cap: 25, deadzone: 0.8, scale: 800 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;

const DEFAULT_LAT_PULLDOWN_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_LAT_PULLDOWN_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_LAT_PULLDOWN_HEURISTIC_CONFIG,
  tunedConfig,
);

const LAT_PULLDOWN_TUNABLE_SPEC = createDefaultTunableSpec(
  'Cable Lat Pulldowns',
  DEFAULT_LAT_PULLDOWN_HEURISTIC_CONFIG,
);

const LAT_PULLDOWN_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withLatPulldownConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, LAT_PULLDOWN_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LatPulldownPhase = 'REST' | 'PULLING' | 'BOTTOM' | 'RETURNING';

interface RepWindow {
  /** Timestamps */
  tStart: number;
  tBottom: number | null;
  tEnd: number;
  /** Min reach ratio during the rep (lower = deeper pull) */
  minRatio: number;
  /** Max reach ratio during the rep (used for ROM extension scoring) */
  maxRatio: number;
  /** Max torso lean during the rep */
  maxTorsoLean: number;
  /** Frame count */
  frameCount: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
}

interface LatPulldownState {
  phase: LatPulldownPhase;
  repCount: number;
  /** Timestamp when the current rep started */
  tRepStart: number | null;
  /** Current rep window accumulator */
  repWindow: RepWindow | null;
  /** Side used for the just-completed frame; kept for stable debug traces. */
  debugSide: 'left' | 'right';
  /** Last completed rep result */
  lastRepResult: RepResult | null;
  /** Smoothed tracker for the active arm's reach ratio */
  ratioTracker: SmoothedAngleTracker;
  torsoLeanTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Which arm is being tracked this rep (picked per-REST based on visibility) */
  activeSide: 'left' | 'right';
  /** Max ratio observed during REST (pre-pull extension) */
  restMaxRatio: number;
  /** Timestamp of peak ratio during REST — used as the true pull start for
   *  tempo calculation so that the measurement is independent of when the FSM
   *  actually transitions to PULLING (which can be delayed by the extension gate
   *  timeout when the smoothed ratio doesn't reach PULLING_ENTER). */
  tRestPeakRatio: number | null;
  /** Current smoothed values (for debug) */
  smoothedRatio: number;
  smoothedTorsoLean: number;
  /** After a rep completes, gate next rep start until user re-extends */
  requireExtensionBeforeNextRep: boolean;
  /** Timestamp when the last rep completed, for timeout fallback */
  tRepCompleted: number | null;
  /** Visual feedback */
  feedback: string | null;
  lastFeedbackTime: number;
}

interface LatPulldownDebugInfo {
  phase: LatPulldownPhase;
  warmedUp: boolean;
  activeSide: 'left' | 'right';
  ratio: number | null;
  torsoLean: number | null;
  minRatio: number | null;
  maxRatio: number | null;
  maxTorsoLean: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializeState(): LatPulldownState {
  return {
    phase: 'REST',
    repCount: 0,
    tRepStart: null,
    repWindow: null,
    debugSide: 'right',
    lastRepResult: null,
    ratioTracker: new SmoothedAngleTracker(),
    torsoLeanTracker: new SmoothedAngleTracker(),
    warmupGate: new WarmupGate({
      requiredJoints: [
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
      ],
      requiredFrames: 10,
      visibilityThreshold: 0.15,
    }),
    warmedUp: false,
    activeSide: 'right',
    restMaxRatio: -Infinity,
    tRestPeakRatio: null,
    requireExtensionBeforeNextRep: false,
    tRepCompleted: null,
    smoothedRatio: 1.0,
    smoothedTorsoLean: 0,
    feedback: null,
    lastFeedbackTime: 0,
  };
}

function initRepWindow(tStart: number): RepWindow {
  return {
    tStart,
    tBottom: null,
    tEnd: tStart,
    minRatio: Infinity,
    maxRatio: -Infinity,
    maxTorsoLean: 0,
    frameCount: 0,
  };
}

// ============================================================================
// GEOMETRY HELPERS (module-private)
// ============================================================================

/** Euclidean distance between two keypoints in 2D (x, y). */
function dist2D(a: Keypoint, b: Keypoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the reach ratio for an arm: straight-line shoulder->wrist distance
 * divided by the total segment length (shoulder->elbow + elbow->wrist).
 *
 * Fully extended arm: ratio ~0.95-1.0
 * Fully bent arm: ratio ~0.35-0.55
 *
 * This metric is camera-distance-invariant because both numerator and
 * denominator scale equally with distance from the camera.
 */
function computeReachRatio(
  shoulder: Keypoint,
  elbow: Keypoint,
  wrist: Keypoint,
): number {
  const segmentSum = dist2D(shoulder, elbow) + dist2D(elbow, wrist);
  if (segmentSum < 1e-6) return 1.0; // degenerate case
  return dist2D(shoulder, wrist) / segmentSum;
}

/**
 * Returns which arm is more visible this frame.
 * Uses shoulder visibility as the primary signal.
 */
function pickBetterSide(
  ls: Keypoint | undefined,
  rs: Keypoint | undefined,
): 'left' | 'right' {
  const lVis = ls?.score ?? 0;
  const rVis = rs?.score ?? 0;
  return lVis >= rVis ? 'left' : 'right';
}

/**
 * Compute torso lean from vertical using a single shoulder + hip.
 * Uses calculateVerticalAngle() which handles both Y-up (world landmarks)
 * and Y-down (image landmarks) coordinate systems correctly.
 * Returns absolute lean angle in degrees (0 = perfectly upright).
 */
function computeTorsoLean(shoulder: Keypoint, hip: Keypoint): number {
  return calculateVerticalAngle(hip, shoulder);
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMResult {
  phase: LatPulldownPhase;
  repCompleted: boolean;
}

function updateFSM(
  currentPhase: LatPulldownPhase,
  ratio: number,
  t: number,
  tRepStart: number | null,
  requireExtension: boolean,
): FSMResult {
  let phase = currentPhase;
  let repCompleted = false;

  switch (phase) {
    case 'REST':
      // Ratio drops below threshold = arm bending = pulling
      if (ratio < THRESHOLDS.PULLING_ENTER && !requireExtension) {
        phase = 'PULLING';
      }
      break;

    case 'PULLING':
      if (ratio < THRESHOLDS.BOTTOM_ENTER) {
        phase = 'BOTTOM';
      } else if (
        ratio > THRESHOLDS.REST_REENTER &&
        tRepStart !== null &&
        (t - tRepStart) >= THRESHOLDS.PULLING_ABORT_MIN_TIME
      ) {
        // Went back to extended without pulling deep enough -- reset.
        phase = 'REST';
      }
      break;

    case 'BOTTOM':
      if (ratio > THRESHOLDS.BOTTOM_EXIT) {
        phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      if (
        ratio > THRESHOLDS.REST_REENTER &&
        tRepStart !== null &&
        (t - tRepStart) >= THRESHOLDS.MIN_REP_TIME
      ) {
        phase = 'REST';
        repCompleted = true;
      } else if (ratio < THRESHOLDS.BOTTOM_ENTER) {
        phase = 'BOTTOM';
      }
      break;
  }

  return { phase, repCompleted };
}

// ============================================================================
// SCORING (continuous penalty curves)
// ============================================================================

function computeLatPulldownScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM pull: ideal minRatio is 0.58 or below
  const pullShortfall = Math.max(0, repWindow.minRatio - 0.58);
  penalties.push({ value: pullShortfall, config: PENALTY_CONFIGS.PULL_ROM });

  // 2. ROM extension: ideal maxRatio is 0.97 or above
  const extensionShortfall = Math.max(0, 0.97 - repWindow.maxRatio);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 3. Torso lean
  penalties.push({ value: repWindow.maxTorsoLean, config: PENALTY_CONFIGS.TORSO_LEAN });

  // 4. Tempo
  if (repWindow.tBottom !== null) {
    const tPull = repWindow.tBottom - repWindow.tStart;
    const tReturn = repWindow.tEnd - repWindow.tBottom;

    if (tPull > 0 && tPull < PENALTY_CONFIGS.TEMPO_PULL.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_PULL.deadzone - tPull;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_PULL, deadzone: 0 } });
    }
    if (tReturn > 0 && tReturn < PENALTY_CONFIGS.TEMPO_RETURN.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_RETURN.deadzone - tReturn;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_RETURN, deadzone: 0 } });
    }
  }

  return computeScore(penalties);
}

// ============================================================================
// FORM MESSAGES (discrete thresholds)
// ============================================================================

function generateFormMessages(repWindow: RepWindow): string[] {
  const messages: string[] = [];

  if (repWindow.minRatio > FORM_THRESHOLDS.PULL_ROM_FAIL) {
    messages.push('Pull deeper \u2014 bring the bar to your upper chest.');
  }

  if (repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_ROM_FAIL) {
    messages.push('Extend fully \u2014 reach all the way up at the top.');
  }

  if (repWindow.maxTorsoLean > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Stay upright \u2014 avoid leaning back excessively.');
  }

  if (repWindow.tBottom !== null) {
    const tPull = repWindow.tBottom - repWindow.tStart;
    const tReturn = repWindow.tEnd - repWindow.tBottom;

    if (tPull > 0 && tPull < FORM_THRESHOLDS.TEMPO_PULL_MIN) {
      messages.push('Slow down the pull \u2014 control the descent.');
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      messages.push('Control the return \u2014 resist the weight on the way up.');
    }
  }

  return messages;
}

// ============================================================================
// MAIN UPDATE LOGIC
// ============================================================================

function updateLatPulldownState(
  keypoints: Keypoint[],
  state: LatPulldownState,
): LatPulldownState {
  const t = Date.now() / 1000;

  // -- Warmup gate --
  if (!state.warmedUp) {
    const stable = state.warmupGate.update(keypoints);
    if (!stable) return state;
    state.warmedUp = true;
  }

  // -- Fetch keypoints --
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const le = getKeypoint(keypoints, 'left_elbow');
  const re = getKeypoint(keypoints, 'right_elbow');
  const lw = getKeypoint(keypoints, 'left_wrist');
  const rw = getKeypoint(keypoints, 'right_wrist');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  // -- Pick active side during REST; lock it during a rep --
  if (state.phase === 'REST' && !state.repWindow) {
    state.activeSide = pickBetterSide(ls ?? undefined, rs ?? undefined);
  }

  const side = state.activeSide;
  state.debugSide = side;
  const shoulder = side === 'left' ? ls : rs;
  const elbow    = side === 'left' ? le : re;
  const wrist    = side === 'left' ? lw : rw;
  const hip      = side === 'left' ? lh : rh;

  const armVisible =
    isVisible(shoulder, VISIBILITY_THRESHOLD) &&
    isVisible(elbow, VISIBILITY_THRESHOLD) &&
    isVisible(wrist, VISIBILITY_THRESHOLD);

  if (!armVisible) return state;

  // -- Compute raw values --
  const rawRatio = computeReachRatio(shoulder!, elbow!, wrist!);

  let rawTorsoLean = 0;
  if (isVisible(shoulder, VISIBILITY_THRESHOLD) && isVisible(hip, VISIBILITY_THRESHOLD)) {
    rawTorsoLean = computeTorsoLean(shoulder!, hip!);
  }

  // -- Smooth values --
  const smoothedRatio = state.ratioTracker.push(rawRatio);
  const smoothedTorsoLean = state.torsoLeanTracker.push(rawTorsoLean);

  state.smoothedRatio = smoothedRatio;
  state.smoothedTorsoLean = smoothedTorsoLean;

  // -- Track max ratio during REST (pre-pull extension) --
  if (state.phase === 'REST') {
    if (smoothedRatio >= state.restMaxRatio) {
      state.restMaxRatio = smoothedRatio;
      state.tRestPeakRatio = t;
    }
    if (state.requireExtensionBeforeNextRep) {
      const extensionReached = smoothedRatio >= THRESHOLDS.PULLING_ENTER;
      const timedOut = state.tRepCompleted !== null && (t - state.tRepCompleted) > 1.5;
      if (extensionReached || timedOut) {
        state.requireExtensionBeforeNextRep = false;
        state.tRepCompleted = null;
      }
    }
  }

  // -- FSM update --
  const fsmResult = updateFSM(state.phase, smoothedRatio, t, state.tRepStart, state.requireExtensionBeforeNextRep);
  const prevPhase = state.phase;
  state.phase = fsmResult.phase;

  // -- Track rep start --
  if (prevPhase === 'REST' && state.phase === 'PULLING') {
    state.tRepStart = t;
    // Use the time of peak ratio extension during REST as the true pull start
    // for tempo calculation.  This avoids artificially short tPull when the
    // extension-gate timeout fires and the FSM enters PULLING late (with the
    // smoothed ratio already well below PULLING_ENTER).
    const pullStartTime = state.tRestPeakRatio ?? t;
    state.repWindow = initRepWindow(pullStartTime);
    state.repWindow.maxRatio = state.restMaxRatio;
    state.restMaxRatio = -Infinity;
    state.tRestPeakRatio = null;
  }

  // -- Accumulate rep window while in a rep --
  const inRep = state.phase !== 'REST';
  if (state.repWindow && inRep) {
    const w = state.repWindow;
    w.tEnd = t;
    w.frameCount++;
    w.minRatio = Math.min(w.minRatio, smoothedRatio);
    w.maxRatio = Math.max(w.maxRatio, smoothedRatio);
    // Only update torso lean max when shoulder + hip have sufficient confidence.
    const torsoConf = minKeypointConfidence(keypoints, [
      `${side}_shoulder`, `${side}_hip`,
    ]);
    if (torsoConf >= 0.3) {
      w.maxTorsoLean = Math.max(w.maxTorsoLean, smoothedTorsoLean);
    }

    if (state.phase === 'BOTTOM' && w.tBottom === null) {
      w.tBottom = t;
    }
  }

  // -- Handle rep completion --
  if (fsmResult.repCompleted && state.repWindow) {
    state.repWindow.maxRatio = Math.max(state.repWindow.maxRatio, smoothedRatio);

    state.repCount++;
    state.requireExtensionBeforeNextRep = true;
    state.tRepCompleted = t;

    const score = computeLatPulldownScore(state.repWindow);
    const messages = generateFormMessages(state.repWindow);

    state.lastRepResult = { repIndex: state.repCount, score, messages };

    state.feedback = messages.length > 0 ? messages.join('\n') : 'Great rep!';
    state.lastFeedbackTime = t;

    state.repWindow = null;
    state.tRepStart = null;
    state.debugSide = state.activeSide;
  }

  // -- Handle aborted pull (PULLING -> REST without rep completion) --
  if (prevPhase === 'PULLING' && state.phase === 'REST' && !fsmResult.repCompleted) {
    state.repWindow = null;
    state.tRepStart = null;
    state.requireExtensionBeforeNextRep = false;
    state.tRepCompleted = null;
    state.tRestPeakRatio = null;
  }

  // -- Clear feedback after 2 seconds --
  if (state.feedback && t - state.lastFeedbackTime > 2.0) {
    state.feedback = null;
  }

  return state;
}

// ============================================================================
// DEBUG INFO
// ============================================================================

function getDebugInfo(state: LatPulldownState): LatPulldownDebugInfo {
  const fmt = (v: number): number | null =>
    !isNaN(v) && isFinite(v) ? v : null;

  const w = state.repWindow;
  return {
    phase: state.phase,
    warmedUp: state.warmedUp,
    activeSide: state.debugSide,
    ratio: fmt(state.smoothedRatio),
    torsoLean: fmt(state.smoothedTorsoLean),
    minRatio: w ? (w.minRatio < Infinity ? fmt(w.minRatio) : null) : null,
    maxRatio: w ? (w.maxRatio > -Infinity ? fmt(w.maxRatio) : null) : null,
    maxTorsoLean: w ? fmt(w.maxTorsoLean) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createLatPulldownDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_LAT_PULLDOWN_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Cable Lat Pulldowns',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: withLatPulldownConfig(config, () => initializeState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as LatPulldownState;
    withLatPulldownConfig(config, () => updateLatPulldownState(keypoints, internal));

    const lastRepResult: FrameworkRepResult | null = internal.lastRepResult
      ? {
          repIndex: internal.lastRepResult.repIndex,
          score: internal.lastRepResult.score,
          messages: internal.lastRepResult.messages,
        }
      : null;

    return {
      repCount: internal.repCount,
      lastRepResult,
      feedback: internal.feedback,
      feedbackTimestamp: internal.lastFeedbackTime > 0 ? internal.lastFeedbackTime : null,
      debugInfo: getDebugInfo(internal) as unknown as Record<string, unknown>,
      _internal: internal,
    };
  },

  heuristicConfig: config,
  tunableSpec: LAT_PULLDOWN_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/latPulldown.json',
  createVariant: (variantConfig) =>
    createLatPulldownDefinition(mergeHeuristicConfig(config, variantConfig)),

  ttsConfig: {
    feedbackToIssue: {
      'Pull deeper \u2014 bring the bar to your upper chest.': 'rom_short',
      'Extend fully \u2014 reach all the way up at the top.': 'lockout_short',
      'Stay upright \u2014 avoid leaning back excessively.': 'torso_warn',
      'Slow down the pull \u2014 control the descent.': 'tempo_down',
      'Control the return \u2014 resist the weight on the way up.': 'tempo_up',
    },
  },

  summaryConfig: {
    'Pull deeper \u2014 bring the bar to your upper chest.':
      'Focus on pulling the bar all the way down to your upper chest for full lat activation.',
    'Extend fully \u2014 reach all the way up at the top.':
      'Allow your arms to extend fully at the top of each rep to get a full stretch in your lats.',
    'Stay upright \u2014 avoid leaning back excessively.':
      'A slight lean back is fine, but excessive lean shifts the load away from your lats to your lower back.',
    'Slow down the pull \u2014 control the descent.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the pull down.',
    'Control the return \u2014 resist the weight on the way up.':
      'Slow the eccentric phase \u2014 resist the weight for 2-3 seconds on the way up for better lat engagement.',
  },
  };
}

export const latPulldownDefinition: ExerciseDefinition = createLatPulldownDefinition();
