/**
 * Cable Lat Pulldowns -- Exercise Definition
 *
 * Side or diagonal view, single (best-visible) arm elbow angle as primary driver.
 * No symmetry tracking. Works from side, diagonal, or any angle where one arm
 * and the torso are visible.
 * FSM: REST -> PULLING -> BOTTOM -> RETURNING -> REST
 * Arms start extended overhead (~150-170deg elbow), pull down to ~50-80deg,
 * then return. One rep = full pull-down + controlled return.
 *
 * The only export is `latPulldownDefinition`.
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

import type {
  ExerciseDefinition,
  ExerciseState,
  RepResult as FrameworkRepResult,
} from '../types';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (degrees -- smoothed elbow angle of the active arm) */
const THRESHOLDS = {
  /** Elbow angle below which we transition REST -> PULLING.
   *  Set lower than a natural resting extended arm (~160°) to avoid false entry
   *  from noise or a slightly bent idle arm position. */
  PULLING_ENTER: 150,
  /** Elbow angle below which we consider bottom position (PULLING -> BOTTOM) */
  BOTTOM_ENTER: 85,
  /** Elbow angle above which we leave BOTTOM (hysteresis) (BOTTOM -> RETURNING) */
  BOTTOM_EXIT: 90,
  /** Elbow angle above which the return is complete (RETURNING -> REST) */
  REST_REENTER: 135,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
  /** Minimum time (seconds) to stay in PULLING before allowing abort back to REST.
   *  Prevents rapid flicker when the idle arm angle hovers near PULLING_ENTER. */
  PULLING_ABORT_MIN_TIME: 0.25,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min elbow angle above which pull is insufficient */
  PULL_ROM_FAIL: 90,
  /** Max elbow angle below which extension is insufficient */
  EXTENSION_ROM_FAIL: 130,
  /** Torso lean above which there is excessive lean (degrees from vertical) */
  TORSO_LEAN_WARN: 20,
  /** Concentric (pull down) too fast threshold (seconds) */
  TEMPO_PULL_MIN: 0.2,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.4,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category         | Cap | Deadzone | Scale | Key Input                     |
 * |------------------|-----|----------|-------|-------------------------------|
 * | ROM pull         | 30  | 0        | 0.04  | min elbow shortfall from 85   |
 * | ROM extension    | 25  | 0        | 0.03  | max elbow shortfall from 155  |
 * | Torso lean       | 25  | 8        | 0.12  | max torso lean from vertical  |
 * | Tempo pull       | 10  | 0.4s     | 50    | concentric time deficit       |
 * | Tempo return     | 10  | 0.5s     | 40    | eccentric time deficit        |
 *
 * Max total penalty: 100 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  PULL_ROM:      { cap: 30, deadzone: 0, scale: 0.04 } as PenaltyConfig,
  EXTENSION_ROM: { cap: 25, deadzone: 0, scale: 0.03 } as PenaltyConfig,
  TORSO_LEAN:    { cap: 25, deadzone: 8, scale: 0.12 } as PenaltyConfig,
  TEMPO_PULL:    { cap: 10, deadzone: 0.4, scale: 50 } as PenaltyConfig,
  TEMPO_RETURN:  { cap: 10, deadzone: 0.5, scale: 40 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LatPulldownPhase = 'REST' | 'PULLING' | 'BOTTOM' | 'RETURNING';

interface RepWindow {
  /** Timestamps */
  tStart: number;
  tBottom: number | null;
  tEnd: number;
  /** Min elbow angle reached (lower = deeper pull) */
  minElbow: number;
  /** Max elbow angle during the rep (used for ROM extension scoring) */
  maxElbow: number;
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
  /** Last completed rep result */
  lastRepResult: RepResult | null;
  /** Smoothed angle tracker for the active arm's elbow */
  elbowTracker: SmoothedAngleTracker;
  torsoLeanTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Which arm is being tracked this rep (picked per-REST based on visibility) */
  activeSide: 'left' | 'right';
  /** Max elbow observed during REST (pre-pull extension) */
  restMaxElbow: number;
  /** Current smoothed values (for debug) */
  smoothedElbow: number;
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
  elbow: number | null;
  torsoLean: number | null;
  minElbow: number | null;
  maxElbow: number | null;
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
    lastRepResult: null,
    elbowTracker: new SmoothedAngleTracker(),
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
    restMaxElbow: -Infinity,
    requireExtensionBeforeNextRep: false,
    tRepCompleted: null,
    smoothedElbow: 180,
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
    minElbow: Infinity,
    maxElbow: -Infinity,
    maxTorsoLean: 0,
    frameCount: 0,
  };
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

type Point2D = { x: number; y: number };

function getPoint(kp: Keypoint): Point2D {
  return { x: kp.x, y: kp.y };
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
 * Compute elbow angle (shoulder-elbow-wrist) in 2D.
 * Extended overhead: ~150-170 degrees. Pulled down: ~50-80 degrees.
 */
function computeElbowAngle(
  shoulder: Keypoint,
  elbow: Keypoint,
  wrist: Keypoint,
): number {
  return calculateAngle2D(getPoint(shoulder), getPoint(elbow), getPoint(wrist));
}

/**
 * Compute torso lean from vertical using a single shoulder + hip.
 * Works from side, diagonal, or front view.
 * Returns absolute lean angle in degrees.
 */
function computeTorsoLean(shoulder: Keypoint, hip: Keypoint): number {
  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y; // positive: hip is below shoulder in image coords
  return Math.abs(Math.atan2(dx, dy) * (180 / Math.PI));
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
  elbow: number,
  t: number,
  tRepStart: number | null,
  requireExtension: boolean,
): FSMResult {
  let phase = currentPhase;
  let repCompleted = false;

  switch (phase) {
    case 'REST':
      if (elbow < THRESHOLDS.PULLING_ENTER && !requireExtension) {
        phase = 'PULLING';
      }
      break;

    case 'PULLING':
      if (elbow < THRESHOLDS.BOTTOM_ENTER) {
        phase = 'BOTTOM';
      } else if (
        elbow > THRESHOLDS.REST_REENTER &&
        tRepStart !== null &&
        (t - tRepStart) >= THRESHOLDS.PULLING_ABORT_MIN_TIME
      ) {
        // Went back to extended without pulling deep enough -- reset.
        // The min-time guard prevents rapid flicker when the arm hovers near the threshold.
        phase = 'REST';
      }
      break;

    case 'BOTTOM':
      if (elbow > THRESHOLDS.BOTTOM_EXIT) {
        phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      if (
        elbow > THRESHOLDS.REST_REENTER &&
        tRepStart !== null &&
        (t - tRepStart) >= THRESHOLDS.MIN_REP_TIME
      ) {
        phase = 'REST';
        repCompleted = true;
      } else if (elbow < THRESHOLDS.BOTTOM_ENTER) {
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

  // 1. ROM pull: ideal min elbow is 85 or below
  const pullShortfall = Math.max(0, repWindow.minElbow - 85);
  penalties.push({ value: pullShortfall, config: PENALTY_CONFIGS.PULL_ROM });

  // 2. ROM extension: ideal max elbow is 155 or above
  const extensionShortfall = Math.max(0, 155 - repWindow.maxElbow);
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

  if (repWindow.minElbow > FORM_THRESHOLDS.PULL_ROM_FAIL) {
    messages.push('Pull deeper \u2014 bring the bar to your upper chest.');
  }

  if (repWindow.maxElbow < FORM_THRESHOLDS.EXTENSION_ROM_FAIL) {
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
  if (state.phase === 'REST') {
    state.activeSide = pickBetterSide(ls ?? undefined, rs ?? undefined);
  }

  const side = state.activeSide;
  const shoulder = side === 'left' ? ls : rs;
  const elbow    = side === 'left' ? le : re;
  const wrist    = side === 'left' ? lw : rw;
  const hip      = side === 'left' ? lh : rh;

  const armVisible =
    isVisible(shoulder, VISIBILITY_THRESHOLD) &&
    isVisible(elbow, VISIBILITY_THRESHOLD) &&
    isVisible(wrist, VISIBILITY_THRESHOLD);

  if (!armVisible) return state;

  // -- Compute raw angles --
  const rawElbow = computeElbowAngle(shoulder!, elbow!, wrist!);

  let rawTorsoLean = 0;
  if (isVisible(shoulder, VISIBILITY_THRESHOLD) && isVisible(hip, VISIBILITY_THRESHOLD)) {
    rawTorsoLean = computeTorsoLean(shoulder!, hip!);
  }

  // -- Smooth angles --
  const smoothedElbow = state.elbowTracker.push(rawElbow);
  const smoothedTorsoLean = state.torsoLeanTracker.push(rawTorsoLean);

  state.smoothedElbow = smoothedElbow;
  state.smoothedTorsoLean = smoothedTorsoLean;

  // -- Track max elbow during REST (pre-pull extension) --
  if (state.phase === 'REST') {
    state.restMaxElbow = Math.max(state.restMaxElbow, smoothedElbow);
    if (state.requireExtensionBeforeNextRep) {
      const extensionReached = smoothedElbow >= THRESHOLDS.PULLING_ENTER;
      const timedOut = state.tRepCompleted !== null && (t - state.tRepCompleted) > 1.5;
      if (extensionReached || timedOut) {
        state.requireExtensionBeforeNextRep = false;
        state.tRepCompleted = null;
      }
    }
  }

  // -- FSM update --
  const fsmResult = updateFSM(state.phase, smoothedElbow, t, state.tRepStart, state.requireExtensionBeforeNextRep);
  const prevPhase = state.phase;
  state.phase = fsmResult.phase;

  // -- Track rep start --
  if (prevPhase === 'REST' && state.phase === 'PULLING') {
    state.tRepStart = t;
    state.repWindow = initRepWindow(t);
    state.repWindow.maxElbow = state.restMaxElbow;
    state.restMaxElbow = -Infinity;
  }

  // -- Accumulate rep window while in a rep --
  const inRep = state.phase !== 'REST';
  if (state.repWindow && inRep) {
    const w = state.repWindow;
    w.tEnd = t;
    w.frameCount++;
    w.minElbow = Math.min(w.minElbow, smoothedElbow);
    w.maxElbow = Math.max(w.maxElbow, smoothedElbow);
    w.maxTorsoLean = Math.max(w.maxTorsoLean, smoothedTorsoLean);

    if (state.phase === 'BOTTOM' && w.tBottom === null) {
      w.tBottom = t;
    }
  }

  // -- Handle rep completion --
  if (fsmResult.repCompleted && state.repWindow) {
    state.repWindow.maxElbow = Math.max(state.repWindow.maxElbow, smoothedElbow);

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
  }

  // -- Handle aborted pull (PULLING -> REST without rep completion) --
  if (prevPhase === 'PULLING' && state.phase === 'REST' && !fsmResult.repCompleted) {
    state.repWindow = null;
    state.tRepStart = null;
    state.requireExtensionBeforeNextRep = false;
    state.tRepCompleted = null;
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
    activeSide: state.activeSide,
    elbow: fmt(state.smoothedElbow),
    torsoLean: fmt(state.smoothedTorsoLean),
    minElbow: w ? (w.minElbow < Infinity ? fmt(w.minElbow) : null) : null,
    maxElbow: w ? (w.maxElbow > -Infinity ? fmt(w.maxElbow) : null) : null,
    maxTorsoLean: w ? fmt(w.maxTorsoLean) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export const latPulldownDefinition: ExerciseDefinition = {
  name: 'Cable Lat Pulldowns',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: initializeState(),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as LatPulldownState;
    updateLatPulldownState(keypoints, internal);

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
