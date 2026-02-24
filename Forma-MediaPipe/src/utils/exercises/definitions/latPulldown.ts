/**
 * Cable Lat Pulldowns -- Exercise Definition
 *
 * Front view, elbow angle as primary driver. Both arms tracked for symmetry.
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

/** FSM thresholds (degrees -- average elbow angle of both arms) */
const THRESHOLDS = {
  /** Average elbow angle below which we transition REST -> PULLING */
  PULLING_ENTER: 135,
  /** Average elbow angle below which we consider bottom position (PULLING -> BOTTOM) */
  BOTTOM_ENTER: 85,
  /** Average elbow angle above which we leave BOTTOM (hysteresis) (BOTTOM -> RETURNING) */
  BOTTOM_EXIT: 90,
  /** Average elbow angle above which the return is complete (RETURNING -> REST) */
  REST_REENTER: 135,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min average elbow angle above which pull is insufficient */
  PULL_ROM_FAIL: 90,
  /** Max average elbow angle below which extension is insufficient */
  EXTENSION_ROM_FAIL: 150,
  /** Torso lateral lean above which there is excessive lean */
  TORSO_LEAN_WARN: 15,
  /** Elbow angle difference between arms above which asymmetry triggers */
  ASYMMETRY_WARN: 20,
  /** Concentric (pull down) too fast threshold (seconds) */
  TEMPO_PULL_MIN: 0.3,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.4,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category         | Cap | Deadzone         | Scale | Key Input                          |
 * |------------------|-----|------------------|-------|------------------------------------|
 * | ROM pull         | 30  | 0 (from ideal)   | 0.04  | min avg elbow shortfall from 85    |
 * | ROM extension    | 25  | 0 (from ideal)   | 0.03  | max avg elbow shortfall from 155   |
 * | Torso lean       | 25  | 8                | 0.12  | max torso lateral lean             |
 * | Asymmetry        | 15  | 10               | 0.015 | max elbow diff between arms        |
 * | Tempo pull       | 10  | 0.4s             | 50    | concentric time deficit            |
 * | Tempo return     | 10  | 0.5s             | 40    | eccentric time deficit             |
 *
 * Max total penalty: 115 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  PULL_ROM:      { cap: 30, deadzone: 0, scale: 0.04 } as PenaltyConfig,
  EXTENSION_ROM: { cap: 25, deadzone: 0, scale: 0.03 } as PenaltyConfig,
  TORSO_LEAN:    { cap: 25, deadzone: 8, scale: 0.12 } as PenaltyConfig,
  ASYMMETRY:     { cap: 15, deadzone: 10, scale: 0.015 } as PenaltyConfig,
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
  /** Min elbow angle per arm (lower = deeper pull) */
  minLeftElbow: number;
  minRightElbow: number;
  /** Min average elbow angle (used for ROM pull scoring) */
  minAvgElbow: number;
  /** Max average elbow angle during the rep (used for ROM extension scoring) */
  maxAvgElbow: number;
  /** Max difference in elbow angle between arms at any frame */
  maxElbowDiff: number;
  /** Max torso lateral lean during the rep */
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
  /** Smoothed angle trackers */
  leftElbowTracker: SmoothedAngleTracker;
  rightElbowTracker: SmoothedAngleTracker;
  torsoLeanTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Current smoothed values (for debug) */
  smoothedLeftElbow: number;
  smoothedRightElbow: number;
  smoothedAvgElbow: number;
  smoothedTorsoLean: number;
  /** Visual feedback */
  feedback: string | null;
  lastFeedbackTime: number;
}

interface LatPulldownDebugInfo {
  phase: LatPulldownPhase;
  warmedUp: boolean;
  leftElbow: number | null;
  rightElbow: number | null;
  avgElbow: number | null;
  torsoLean: number | null;
  minAvgElbow: number | null;
  maxAvgElbow: number | null;
  maxElbowDiff: number | null;
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
    leftElbowTracker: new SmoothedAngleTracker(),
    rightElbowTracker: new SmoothedAngleTracker(),
    torsoLeanTracker: new SmoothedAngleTracker(),
    warmupGate: new WarmupGate({
      requiredJoints: [
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
        'left_wrist', 'right_wrist',
        'left_hip', 'right_hip',
      ],
      requiredFrames: 10,
      visibilityThreshold: 0.2,
    }),
    warmedUp: false,
    smoothedLeftElbow: 180,
    smoothedRightElbow: 180,
    smoothedAvgElbow: 180,
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
    minLeftElbow: Infinity,
    minRightElbow: Infinity,
    minAvgElbow: Infinity,
    maxAvgElbow: -Infinity,
    maxElbowDiff: 0,
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
 * Compute elbow angle (shoulder-elbow-wrist) in 2D.
 * Extended overhead: ~150-170 degrees. Pulled down to chest: ~50-80 degrees.
 */
function computeElbowAngle(
  shoulder: Keypoint,
  elbow: Keypoint,
  wrist: Keypoint,
): number {
  return calculateAngle2D(getPoint(shoulder), getPoint(elbow), getPoint(wrist));
}

/**
 * Compute lateral torso lean from front view.
 * Uses midpoint of shoulders and midpoint of hips.
 * Returns absolute lean angle in degrees from vertical.
 */
function computeTorsoLean(
  leftShoulder: Keypoint,
  rightShoulder: Keypoint,
  leftHip: Keypoint,
  rightHip: Keypoint,
): number {
  const midShoulderX = (leftShoulder.x + rightShoulder.x) / 2;
  const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const midHipX = (leftHip.x + rightHip.x) / 2;
  const midHipY = (leftHip.y + rightHip.y) / 2;

  const dx = midHipX - midShoulderX;
  const dy = midHipY - midShoulderY;

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
  avgElbow: number,
  t: number,
  tRepStart: number | null,
): FSMResult {
  let phase = currentPhase;
  let repCompleted = false;

  switch (phase) {
    case 'REST':
      // Arms extended overhead. When elbows start bending, begin pull.
      if (avgElbow < THRESHOLDS.PULLING_ENTER) {
        phase = 'PULLING';
      }
      break;

    case 'PULLING':
      // Actively pulling down. When elbows reach bottom position, transition.
      if (avgElbow < THRESHOLDS.BOTTOM_ENTER) {
        phase = 'BOTTOM';
      } else if (avgElbow > THRESHOLDS.REST_REENTER) {
        // Went back to extended without pulling deep enough -- reset
        phase = 'REST';
      }
      break;

    case 'BOTTOM':
      // At bottom of pull. When elbows start extending back up (hysteresis), transition.
      if (avgElbow > THRESHOLDS.BOTTOM_EXIT) {
        phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      // Controlled return. When elbows reach extended position, rep is complete.
      if (
        avgElbow > THRESHOLDS.REST_REENTER &&
        tRepStart !== null &&
        (t - tRepStart) >= THRESHOLDS.MIN_REP_TIME
      ) {
        phase = 'REST';
        repCompleted = true;
      } else if (avgElbow < THRESHOLDS.BOTTOM_ENTER) {
        // Went back to bottom -- return to BOTTOM
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

  // 1. ROM pull: ideal min avg elbow is 85 or below. Shortfall = max(0, minAvgElbow - 85)
  const pullShortfall = Math.max(0, repWindow.minAvgElbow - 85);
  penalties.push({ value: pullShortfall, config: PENALTY_CONFIGS.PULL_ROM });

  // 2. ROM extension: ideal max avg elbow is 155 or above. Shortfall = max(0, 155 - maxAvgElbow)
  const extensionShortfall = Math.max(0, 155 - repWindow.maxAvgElbow);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 3. Torso lean
  penalties.push({ value: repWindow.maxTorsoLean, config: PENALTY_CONFIGS.TORSO_LEAN });

  // 4. Asymmetry -- max elbow difference between arms
  penalties.push({ value: repWindow.maxElbowDiff, config: PENALTY_CONFIGS.ASYMMETRY });

  // 5. Tempo
  if (repWindow.tBottom !== null) {
    const tPull = repWindow.tBottom - repWindow.tStart;   // concentric (pull down)
    const tReturn = repWindow.tEnd - repWindow.tBottom;    // eccentric (return up)

    if (tPull > 0 && tPull < PENALTY_CONFIGS.TEMPO_PULL.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_PULL.deadzone - tPull;
      penalties.push({ value: deficit, config: PENALTY_CONFIGS.TEMPO_PULL });
    }
    if (tReturn > 0 && tReturn < PENALTY_CONFIGS.TEMPO_RETURN.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_RETURN.deadzone - tReturn;
      penalties.push({ value: deficit, config: PENALTY_CONFIGS.TEMPO_RETURN });
    }
  }

  return computeScore(penalties);
}

// ============================================================================
// FORM MESSAGES (discrete thresholds)
// ============================================================================

function generateFormMessages(repWindow: RepWindow): string[] {
  const messages: string[] = [];

  // 1. Pull ROM -- didn't pull deep enough
  if (repWindow.minAvgElbow > FORM_THRESHOLDS.PULL_ROM_FAIL) {
    messages.push('Pull deeper \u2014 bring the bar to your upper chest.');
  }

  // 2. Extension ROM -- didn't extend fully at top
  if (repWindow.maxAvgElbow < FORM_THRESHOLDS.EXTENSION_ROM_FAIL) {
    messages.push('Extend fully \u2014 reach all the way up at the top.');
  }

  // 3. Torso lean
  if (repWindow.maxTorsoLean > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Stay upright \u2014 avoid leaning back excessively.');
  }

  // 4. Asymmetry
  if (repWindow.maxElbowDiff > FORM_THRESHOLDS.ASYMMETRY_WARN) {
    messages.push('Even it out \u2014 pull evenly with both arms.');
  }

  // 5. Tempo
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

  // Require both arms visible (front-view exercise)
  const leftArmVisible =
    isVisible(ls, VISIBILITY_THRESHOLD) &&
    isVisible(le, VISIBILITY_THRESHOLD) &&
    isVisible(lw, VISIBILITY_THRESHOLD);
  const rightArmVisible =
    isVisible(rs, VISIBILITY_THRESHOLD) &&
    isVisible(re, VISIBILITY_THRESHOLD) &&
    isVisible(rw, VISIBILITY_THRESHOLD);

  if (!leftArmVisible || !rightArmVisible) {
    return state;
  }

  // -- Compute raw angles --
  const rawLeftElbow = computeElbowAngle(ls!, le!, lw!);
  const rawRightElbow = computeElbowAngle(rs!, re!, rw!);

  let rawTorsoLean = 0;
  const torsoVisible =
    isVisible(ls, VISIBILITY_THRESHOLD) &&
    isVisible(rs, VISIBILITY_THRESHOLD) &&
    isVisible(lh, VISIBILITY_THRESHOLD) &&
    isVisible(rh, VISIBILITY_THRESHOLD);
  if (torsoVisible) {
    rawTorsoLean = computeTorsoLean(ls!, rs!, lh!, rh!);
  }

  // -- Smooth angles --
  const smoothedLeftElbow = state.leftElbowTracker.push(rawLeftElbow);
  const smoothedRightElbow = state.rightElbowTracker.push(rawRightElbow);
  const smoothedAvgElbow = (smoothedLeftElbow + smoothedRightElbow) / 2;
  const smoothedTorsoLean = state.torsoLeanTracker.push(rawTorsoLean);

  // Update display values (mutate in place for perf)
  state.smoothedLeftElbow = smoothedLeftElbow;
  state.smoothedRightElbow = smoothedRightElbow;
  state.smoothedAvgElbow = smoothedAvgElbow;
  state.smoothedTorsoLean = smoothedTorsoLean;

  // -- FSM update --
  const fsmResult = updateFSM(state.phase, smoothedAvgElbow, t, state.tRepStart);
  const prevPhase = state.phase;
  state.phase = fsmResult.phase;

  // -- Track rep start --
  if (prevPhase === 'REST' && state.phase === 'PULLING') {
    state.tRepStart = t;
    state.repWindow = initRepWindow(t);
    // Record initial max avg elbow (starting position)
    state.repWindow.maxAvgElbow = smoothedAvgElbow;
  }

  // -- Accumulate rep window while in a rep --
  const inRep = state.phase !== 'REST';
  if (state.repWindow && inRep) {
    const w = state.repWindow;
    w.tEnd = t;
    w.frameCount++;

    // Min elbow per arm
    w.minLeftElbow = Math.min(w.minLeftElbow, smoothedLeftElbow);
    w.minRightElbow = Math.min(w.minRightElbow, smoothedRightElbow);

    // Min/max average elbow
    w.minAvgElbow = Math.min(w.minAvgElbow, smoothedAvgElbow);
    w.maxAvgElbow = Math.max(w.maxAvgElbow, smoothedAvgElbow);

    // Max difference between arms at this frame
    const elbowDiff = Math.abs(smoothedLeftElbow - smoothedRightElbow);
    w.maxElbowDiff = Math.max(w.maxElbowDiff, elbowDiff);

    // Max torso lean
    w.maxTorsoLean = Math.max(w.maxTorsoLean, smoothedTorsoLean);

    // Record BOTTOM timestamp
    if (state.phase === 'BOTTOM' && w.tBottom === null) {
      w.tBottom = t;
    }
  }

  // -- Handle rep completion --
  if (fsmResult.repCompleted && state.repWindow) {
    state.repCount++;

    const score = computeLatPulldownScore(state.repWindow);
    const messages = generateFormMessages(state.repWindow);

    state.lastRepResult = {
      repIndex: state.repCount,
      score,
      messages,
    };

    if (messages.length > 0) {
      state.feedback = messages.join('\n');
    } else {
      state.feedback = 'Great rep!';
    }
    state.lastFeedbackTime = t;

    // Reset for next rep
    state.repWindow = null;
    state.tRepStart = null;
  }

  // -- Handle aborted pull (PULLING -> REST without rep completion) --
  if (prevPhase === 'PULLING' && state.phase === 'REST' && !fsmResult.repCompleted) {
    state.repWindow = null;
    state.tRepStart = null;
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
    leftElbow: fmt(state.smoothedLeftElbow),
    rightElbow: fmt(state.smoothedRightElbow),
    avgElbow: fmt(state.smoothedAvgElbow),
    torsoLean: fmt(state.smoothedTorsoLean),
    minAvgElbow: w ? (w.minAvgElbow < Infinity ? fmt(w.minAvgElbow) : null) : null,
    maxAvgElbow: w ? (w.maxAvgElbow > -Infinity ? fmt(w.maxAvgElbow) : null) : null,
    maxElbowDiff: w ? fmt(w.maxElbowDiff) : null,
    maxTorsoLean: w ? fmt(w.maxTorsoLean) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export const latPulldownDefinition: ExerciseDefinition = {
  name: 'Cable Lat Pulldowns',
  requiredView: 'front',

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

    // Map internal RepResult to framework RepResult
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
      'Even it out \u2014 pull evenly with both arms.': 'asymmetry',
      'Slow down the pull \u2014 control the descent.': 'tempo_down',
      'Control the return \u2014 resist the weight on the way up.': 'tempo_up',
    },
    // Reuse existing issue types -- no new definitions needed.
    // rom_short, lockout_short, torso_warn, asymmetry, tempo_down, tempo_up
    // are all already registered by other exercises.
  },

  summaryConfig: {
    'Pull deeper \u2014 bring the bar to your upper chest.':
      'Focus on pulling the bar all the way down to your upper chest for full lat activation.',
    'Extend fully \u2014 reach all the way up at the top.':
      'Allow your arms to extend fully at the top of each rep to get a full stretch in your lats.',
    'Stay upright \u2014 avoid leaning back excessively.':
      'A slight lean back is fine, but excessive lean shifts the load away from your lats to your lower back.',
    'Even it out \u2014 pull evenly with both arms.':
      'Focus on pulling symmetrically \u2014 if one side is dominant, consider single-arm pulldowns to correct imbalances.',
    'Slow down the pull \u2014 control the descent.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the pull down.',
    'Control the return \u2014 resist the weight on the way up.':
      'Slow the eccentric phase \u2014 resist the weight for 2-3 seconds on the way up for better lat engagement.',
  },
};
