/**
 * Cable Row -- Exercise Definition
 *
 * Side view, reach-ratio as primary driver (camera-invariant).
 * FSM: REST -> PULLING -> CONTRACTED -> RETURNING -> REST
 *
 * Reach ratio = dist2D(shoulder,wrist) / (dist2D(shoulder,elbow) + dist2D(elbow,wrist))
 *   ~0.90-0.97 when arms are extended (REST)
 *   ~0.40-0.60 when fully contracted
 *
 * Form checks:
 *  - ROM (pull depth): ratio should drop below ~0.55 at contraction
 *  - ROM (full extension): ratio should return to ~0.95+ on each rep
 *  - Torso lean: torso should stay relatively upright; leaning back = momentum cheat
 *  - Shoulder retraction: upper arm should pull back sufficiently (hip-shoulder-elbow angle)
 *  - Tempo: controlled concentric (pull) and eccentric (return)
 *
 * The only export is `cableRowDefinition`.
 */

import {
  Keypoint,
  calculateAngle,
  calculateSignedVerticalAngle,
  getKeypoint,
  isVisible,
  minKeypointConfidence,
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
// MODULE-PRIVATE HELPERS (dist2D / reach ratio)
// ============================================================================

/** Euclidean distance in the 2D image plane (x, y only). */
function dist2D(a: Keypoint, b: Keypoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute reach ratio for a three-joint chain.
 * ratio = dist2D(shoulder, wrist) / (dist2D(shoulder, elbow) + dist2D(elbow, wrist))
 *
 * Returns a value in [0, 1]:
 *   ~1.0  = arm fully extended (straight line)
 *   ~0.5  = arm significantly bent
 *   ~0.0  = wrist on top of shoulder (impossible in practice)
 */
function computeReachRatio(
  shoulder: Keypoint,
  elbow: Keypoint,
  wrist: Keypoint,
): number {
  const chainLen = dist2D(shoulder, elbow) + dist2D(elbow, wrist);
  if (chainLen < 1e-6) return 1; // degenerate -- avoid division by zero
  return dist2D(shoulder, wrist) / chainLen;
}

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (reach ratio) */
const THRESHOLDS = {
  /** Ratio below which the pull clock starts before the FSM commits */
  PULL_CLOCK_START: 0.985,
  /** Ratio below which we transition REST -> PULLING (arms starting to bend) */
  PULLING_ENTER: 0.90,
  /** Ratio below which we consider peak contraction (PULLING -> CONTRACTED) */
  CONTRACTED_ENTER: 0.60,
  /** Ratio above which we leave CONTRACTED (hysteresis) (CONTRACTED -> RETURNING) */
  CONTRACTED_EXIT: 0.63,
  /** Ratio above which the return is complete (RETURNING -> REST) */
  REST_REENTER: 0.90,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.5,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min ratio above which pull depth is insufficient (didn't contract enough) */
  PULL_DEPTH_FAIL: 0.63,
  /** Max ratio below which arm extension is insufficient */
  EXTENSION_FAIL: 0.92,
  /** Shoulder retraction angle delta below which retraction is insufficient */
  RETRACTION_FAIL: 15,
  /** Torso deviation delta from baseline above which there is excessive lean */
  TORSO_LEAN_WARN: 20,
  /** Concentric (pull) too fast threshold (seconds) */
  TEMPO_PULL_MIN: 0.3,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.4,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category             | Cap | Deadzone | Scale | Key Input                            |
 * |----------------------|-----|----------|-------|--------------------------------------|
 * | ROM pull depth       | 30  | 0        | 600   | min ratio excess above 0.55 target   |
 * | ROM extension        | 20  | 0        | 400   | max ratio shortfall below 0.95 target|
 * | Shoulder retraction  | 25  | 10       | 0.04  | retraction shortfall                 |
 * | Torso lean           | 25  | 8        | 0.10  | torso deviation delta from baseline  |
 * | Tempo pull           | 12  | 0.3s     | 60    | concentric time deficit              |
 * | Tempo return         | 8   | 0.4s     | 40    | eccentric time deficit               |
 *
 * Max total penalty: 120 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  PULL_DEPTH:        { cap: 30, deadzone: 0, scale: 600 } as PenaltyConfig,
  EXTENSION_ROM:     { cap: 20, deadzone: 0, scale: 400 } as PenaltyConfig,
  SHOULDER_RETRACT:  { cap: 25, deadzone: 10, scale: 0.04 } as PenaltyConfig,
  TORSO_LEAN:        { cap: 25, deadzone: 8, scale: 0.10 } as PenaltyConfig,
  TEMPO_PULL:        { cap: 12, deadzone: 0.3, scale: 60 } as PenaltyConfig,
  TEMPO_RETURN:      { cap: 8,  deadzone: 0.4, scale: 40 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;

// ============================================================================
// TYPES (module-private)
// ============================================================================

type CableRowPhase = 'REST' | 'PULLING' | 'CONTRACTED' | 'RETURNING';

interface CableRowFSM {
  phase: CableRowPhase;
  /** Timestamp when pull began (REST -> PULLING) */
  tRepStart: number | null;
  /** Timestamp when the user first moved out of full extension */
  tPullStart: number | null;
  /** Timestamp when peak contraction was reached */
  tContracted: number | null;
  /** Timestamp when rep completed (RETURNING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min reach ratio during rep (should be low -- contracted position) */
  minRatio: number;
  /** Max reach ratio during rep (should be high -- extended position) */
  maxRatio: number;
  /** Raw shoulder angle at rep start (baseline for retraction delta) */
  shoulderAngleBaseline: number | null;
  /** Max change in raw shoulder angle from baseline (measures retraction amplitude) */
  maxShoulderDelta: number;
  /** Raw torso deviation at rep start (baseline for dynamic lean measurement) */
  torsoDevBaseline: number | null;
  /** Max increase in torso deviation from baseline during rep */
  maxTorsoDev: number;
  /** Timestamps */
  tStart: number;
  tContracted: number | null;
  tReturnStart: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
}

interface CableRowState {
  fsm: CableRowFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  /** Smoothed trackers */
  ratioTracker: SmoothedAngleTracker;
  shoulderTracker: SmoothedAngleTracker;
  torsoTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Current smoothed values for debug */
  smoothedRatio: number | null;
  /** Median-only ratio used for responsive FSM transitions */
  fastRatio: number | null;
  smoothedShoulder: number | null;
  smoothedTorso: number | null;
  /** Feedback */
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
}

interface CableRowDebugInfo {
  phase: CableRowPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  ratio: number | null;
  fastRatio: number | null;
  shoulderAngle: number | null;
  torsoDev: number | null;
  ratioMin: number | null;
  ratioMax: number | null;
  shoulderDelta: number | null;
  torsoDevMax: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): CableRowFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tPullStart: null,
    tContracted: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number, initialRatio?: number): RepWindow {
  return {
    minRatio: initialRatio ?? Infinity,
    maxRatio: initialRatio ?? -Infinity,
    shoulderAngleBaseline: null,
    maxShoulderDelta: 0,
    torsoDevBaseline: null,
    maxTorsoDev: 0,
    tStart,
    tContracted: null,
    tReturnStart: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function initializeCableRowState(): CableRowState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    ratioTracker: new SmoothedAngleTracker(),
    shoulderTracker: new SmoothedAngleTracker(),
    torsoTracker: new SmoothedAngleTracker(),
    warmupGate: new WarmupGate({
      requiredJoints: [
        'left_shoulder', 'left_elbow', 'left_wrist', 'left_hip',
        'right_shoulder', 'right_elbow', 'right_wrist', 'right_hip',
      ],
      requiredFrames: 10,
      visibilityThreshold: 0.2,
    }),
    warmedUp: false,
    smoothedRatio: null,
    fastRatio: null,
    smoothedShoulder: null,
    smoothedTorso: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
  };
}

// ============================================================================
// VISIBLE SIDE SELECTION
// ============================================================================

function selectVisibleSide(keypoints: Keypoint[]): 'left' | 'right' {
  const leftParts = ['left_shoulder', 'left_elbow', 'left_wrist', 'left_hip'];
  const rightParts = ['right_shoulder', 'right_elbow', 'right_wrist', 'right_hip'];

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
// ANGLE / RATIO CALCULATION
// ============================================================================

/**
 * Calculate the reach ratio for the arm chain (shoulder-elbow-wrist) in 2D.
 * ~0.90-0.97 when extended, ~0.40-0.60 when contracted.
 * Camera-invariant because it's a ratio of segment lengths.
 */
function calculateArmReachRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const elbow = getKeypoint(keypoints, `${side}_elbow`);
  const wrist = getKeypoint(keypoints, `${side}_wrist`);

  if (
    !shoulder || !elbow || !wrist ||
    !isVisible(shoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(elbow, VISIBILITY_THRESHOLD) ||
    !isVisible(wrist, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  return computeReachRatio(shoulder, elbow, wrist);
}

/**
 * Calculate the upper arm angle relative to the torso (hip-shoulder-elbow) in 3D.
 * Measures shoulder extension/retraction during the row.
 * At start (arms extended): angle is smaller (~30-50deg, elbow in front).
 * At contraction (elbows back): angle increases (~70-90deg+, elbow alongside/behind torso).
 */
function calculateShoulderAngle(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): number | null {
  const hip = getKeypoint(keypoints, `${side}_hip`);
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const elbow = getKeypoint(keypoints, `${side}_elbow`);

  if (
    !hip || !shoulder || !elbow ||
    !isVisible(hip, VISIBILITY_THRESHOLD) ||
    !isVisible(shoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(elbow, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  return calculateAngle(hip, shoulder, elbow);
}

/**
 * Calculate signed torso angle from vertical using the shoulder-hip line.
 * Returns a signed angle in degrees: positive = forward lean, negative = backward lean,
 * 0 = perfectly upright. Uses the YZ plane (sagittal), ignoring the X-axis so that
 * lateral body rotation doesn't inflate the measurement.
 *
 * A signed angle is essential for delta-from-baseline tracking: the unsigned version
 * folds at vertical (0deg), causing lean-back past vertical to produce a SHRINKING delta
 * instead of a growing one.
 */
function calculateTorsoDeviation(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): number | null {
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const hip = getKeypoint(keypoints, `${side}_hip`);

  if (
    !shoulder || !hip ||
    !isVisible(shoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(hip, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  return calculateSignedVerticalAngle(hip, shoulder);
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: CableRowFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: CableRowFSM,
  ratio: number,
  t: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Waiting for pull to begin. When ratio drops below threshold,
      // transition to PULLING.
      if (ratio < THRESHOLDS.PULL_CLOCK_START) {
        fsm.tPullStart ??= t;
      } else {
        fsm.tPullStart = null;
      }

      if (ratio < THRESHOLDS.PULLING_ENTER) {
        fsm.phase = 'PULLING';
        fsm.tRepStart = fsm.tPullStart ?? t;
        fsm.tContracted = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'PULLING':
      // Actively pulling. When peak contraction reached, transition.
      if (ratio < THRESHOLDS.CONTRACTED_ENTER) {
        fsm.phase = 'CONTRACTED';
        fsm.tContracted = t;
      } else if (ratio > THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Went back to extended without contracting -- abort
        fsm.phase = 'REST';
        fsm.tRepStart = null;
        fsm.tPullStart = null;
      }
      break;

    case 'CONTRACTED':
      // At peak contraction. When ratio starts rising (hysteresis), transition.
      if (ratio > THRESHOLDS.CONTRACTED_EXIT) {
        fsm.phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      // Controlled return. When ratio returns to extended position, rep is complete.
      if (
        ratio > THRESHOLDS.REST_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'REST';
        fsm.tRepEnd = t;
        repCompleted = true;
      } else if (ratio < THRESHOLDS.CONTRACTED_ENTER) {
        // Went back to contraction -- return to CONTRACTED
        fsm.phase = 'CONTRACTED';
      }
      break;
  }

  return { fsm, repCompleted };
}

// ============================================================================
// SCORING (continuous penalty curves)
// ============================================================================

function computeCableRowScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM -- pull depth: ideal min ratio is 0.55 or below. Shortfall = max(0, minRatio - 0.55)
  const pullShortfall = Math.max(0, repWindow.minRatio - 0.55);
  penalties.push({ value: pullShortfall, config: PENALTY_CONFIGS.PULL_DEPTH });

  // 2. ROM -- extension: ideal max ratio is 0.95+. Shortfall = max(0, 0.95 - maxRatio)
  const extensionShortfall = Math.max(0, 0.95 - repWindow.maxRatio);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 3. Shoulder retraction (delta from baseline should be sufficient)
  // If delta is small, they're not pulling elbows back enough
  const retractionShortfall = Math.max(0, 20 - repWindow.maxShoulderDelta);
  penalties.push({ value: retractionShortfall, config: PENALTY_CONFIGS.SHOULDER_RETRACT });

  // 4. Torso lean
  penalties.push({ value: repWindow.maxTorsoDev, config: PENALTY_CONFIGS.TORSO_LEAN });

  // 5. Tempo
  if (repWindow.tContracted !== null) {
    const tPull = repWindow.tContracted - repWindow.tStart;    // concentric (pull)
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tContracted); // eccentric (return)

    // Penalize if too fast
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

  // 1. Pull depth -- didn't contract enough (ratio stayed too high)
  if (repWindow.minRatio > FORM_THRESHOLDS.PULL_DEPTH_FAIL) {
    messages.push('Pull further back \u2014 squeeze your shoulder blades together.');
  }

  // 2. Extension -- didn't extend arms fully on return (ratio stayed too low)
  if (repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_FAIL) {
    messages.push('Extend your arms fully \u2014 get a full stretch at the front.');
  }

  // 3. Shoulder retraction -- didn't pull elbows back enough
  if (repWindow.maxShoulderDelta < FORM_THRESHOLDS.RETRACTION_FAIL) {
    messages.push('Drive your elbows back \u2014 focus on shoulder retraction.');
  }

  // 4. Torso lean
  if (repWindow.maxTorsoDev > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Stay upright \u2014 avoid leaning back during the pull.');
  }

  // 5. Tempo
  if (repWindow.tContracted !== null) {
    const tPull = repWindow.tContracted - repWindow.tStart;
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tContracted);

    if (tPull > 0 && tPull < FORM_THRESHOLDS.TEMPO_PULL_MIN) {
      messages.push('Slow down the pull \u2014 control the contraction.');
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      messages.push('Control the return \u2014 don\'t let the weight pull you forward.');
    }
  }

  return messages;
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateCableRowState(
  keypoints: Keypoint[],
  currentState: CableRowState
): CableRowState {
  const t = Date.now() / 1000;

  // Warmup gate
  if (!currentState.warmedUp) {
    const ready = currentState.warmupGate.update(keypoints);
    if (!ready) {
      return currentState;
    }
    currentState.warmedUp = true;
  }

  // Only update visible side in REST — lock it during active rep phases
  // to prevent mid-rep side switching that corrupts angle measurements.
  const inActiveRep = currentState.fsm.phase !== 'REST';
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(keypoints);

  // Calculate raw values
  const rawRatio = calculateArmReachRatio(keypoints, visibleSide);
  const rawShoulder = calculateShoulderAngle(keypoints, visibleSide);
  const rawTorsoDev = calculateTorsoDeviation(keypoints, visibleSide);

  // If we can't even compute the ratio, bail out
  if (rawRatio === null) {
    return {
      ...currentState,
      visibleSide,
      smoothedRatio: null,
      fastRatio: null,
      smoothedShoulder: null,
      smoothedTorso: null,
    };
  }

  // Smooth values
  const smoothedRatio = currentState.ratioTracker.push(rawRatio);
  const fastRatio = currentState.ratioTracker.medianValue;
  const smoothedShoulder = rawShoulder !== null
    ? currentState.shoulderTracker.push(rawShoulder)
    : currentState.shoulderTracker.value;
  const smoothedTorso = rawTorsoDev !== null
    ? currentState.torsoTracker.push(rawTorsoDev)
    : currentState.torsoTracker.value;

  const newState: CableRowState = {
    ...currentState,
    visibleSide,
    smoothedRatio,
    fastRatio: isNaN(fastRatio) ? null : fastRatio,
    smoothedShoulder: isNaN(smoothedShoulder) ? null : smoothedShoulder,
    smoothedTorso: isNaN(smoothedTorso) ? null : smoothedTorso,
  };

  if (isNaN(fastRatio)) {
    return newState;
  }

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, fastRatio, t);
  newState.fsm = fsmResult.fsm;

  // Track rep window while actively in a rep (not REST)
  const inRep = newState.fsm.phase !== 'REST';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(newState.fsm.tRepStart ?? t, rawRatio);
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update ratio min/max — use smoothed ratio for min (contracted peak)
    // and raw ratio for max (extended peak) to capture true ROM.
    if (!isNaN(smoothedRatio)) {
      window.minRatio = Math.min(window.minRatio, smoothedRatio);
    }
    if (rawRatio !== null) {
      window.maxRatio = Math.max(window.maxRatio, rawRatio);
    }

    // Track shoulder angle delta from baseline (measures retraction).
    // Uses RAW shoulder angle — EMA smoothing dampens the peak delta,
    // causing the retraction check to fail even on good reps.
    // Only update when the three keypoints used by calculateShoulderAngle
    // (hip, shoulder, elbow) all have sufficient confidence.
    if (rawShoulder !== null) {
      const shoulderConf = minKeypointConfidence(keypoints, [
        `${visibleSide}_hip`, `${visibleSide}_shoulder`, `${visibleSide}_elbow`,
      ]);
      if (shoulderConf >= 0.3) {
        if (window.shoulderAngleBaseline === null) {
          window.shoulderAngleBaseline = rawShoulder;
        }
        const delta = Math.abs(rawShoulder - window.shoulderAngleBaseline);
        window.maxShoulderDelta = Math.max(window.maxShoulderDelta, delta);
      }
    }

    // Track torso deviation as delta from baseline — the absolute angle from
    // vertical includes natural seated lean and body rotation artifacts, which
    // easily exceed the threshold even with perfect form. Measuring the CHANGE
    // from baseline captures dynamic lean during the pull (the actual concern).
    // Only update when shoulder + hip have sufficient confidence.
    if (rawTorsoDev !== null) {
      const torsoConf = minKeypointConfidence(keypoints, [
        `${visibleSide}_shoulder`, `${visibleSide}_hip`,
      ]);
      if (torsoConf >= 0.3) {
        if (window.torsoDevBaseline === null) {
          window.torsoDevBaseline = rawTorsoDev;
        }
        const torsoDelta = Math.abs(rawTorsoDev - window.torsoDevBaseline);
        window.maxTorsoDev = Math.max(window.maxTorsoDev, torsoDelta);
      }
    }

    // Record contracted timestamp
    if (newState.fsm.phase === 'CONTRACTED' && window.tContracted === null) {
      window.tContracted = t;
    }

    if (
      currentState.fsm.phase === 'CONTRACTED' &&
      newState.fsm.phase === 'RETURNING' &&
      window.tReturnStart === null
    ) {
      window.tReturnStart = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    // Record the completing frame's ratio — the rep window stops updating
    // once phase becomes REST, but the frame that triggers REST_REENTER has
    // the actual peak extension ratio and must be included.
    if (rawRatio !== null) {
      newState.repWindow.maxRatio = Math.max(newState.repWindow.maxRatio, rawRatio);
    }
    newState.repWindow.tEnd = t;

    newState.repCount++;

    const score = computeCableRowScore(newState.repWindow);
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

function getDebugInfo(state: CableRowState): CableRowDebugInfo {
  const fmt = (v: number | null | undefined): number | null =>
    v !== null && v !== undefined && !isNaN(v) && isFinite(v) ? v : null;

  const repWin = state.repWindow;

  return {
    phase: state.fsm.phase,
    side: state.visibleSide,
    warmedUp: state.warmedUp,
    ratio: fmt(state.smoothedRatio),
    fastRatio: fmt(state.fastRatio),
    shoulderAngle: fmt(state.smoothedShoulder),
    torsoDev: fmt(state.smoothedTorso),
    ratioMin: repWin && repWin.minRatio !== Infinity ? fmt(repWin.minRatio) : null,
    ratioMax: repWin && repWin.maxRatio !== -Infinity ? fmt(repWin.maxRatio) : null,
    shoulderDelta: repWin ? fmt(repWin.maxShoulderDelta) : null,
    torsoDevMax: repWin ? fmt(repWin.maxTorsoDev) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export const cableRowDefinition: ExerciseDefinition = {
  name: 'Cable Row',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: initializeCableRowState(),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as CableRowState;
    const newInternal = updateCableRowState(keypoints, internal);

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

  ttsConfig: {
    feedbackToIssue: {
      'Pull further back \u2014 squeeze your shoulder blades together.': 'row_depth',
      'Extend your arms fully \u2014 get a full stretch at the front.': 'row_extension',
      'Drive your elbows back \u2014 focus on shoulder retraction.': 'shoulder_retraction',
      'Stay upright \u2014 avoid leaning back during the pull.': 'torso_warn',
      'Slow down the pull \u2014 control the contraction.': 'tempo_down',
      "Control the return \u2014 don't let the weight pull you forward.": 'tempo_up',
    },
    issueDefinitions: [
      {
        issueType: 'row_depth',
        priority: 25,
        messages: [
          'Pull it all the way back.',
          'Squeeze those shoulder blades.',
          'Deeper pull, more back activation.',
        ],
      },
      {
        issueType: 'row_extension',
        priority: 15,
        messages: [
          'Stretch those arms out fully.',
          'Full extension at the front.',
          'Get a complete stretch.',
        ],
      },
      {
        issueType: 'shoulder_retraction',
        priority: 20,
        messages: [
          'Elbows back, squeeze the back.',
          'Focus on retracting your shoulders.',
          'Drive those elbows behind you.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Pull further back \u2014 squeeze your shoulder blades together.':
      'Focus on pulling the handle all the way to your torso and squeezing your shoulder blades together at peak contraction.',
    'Extend your arms fully \u2014 get a full stretch at the front.':
      'Allow your arms to fully extend on each return to maximize the stretch and range of motion.',
    'Drive your elbows back \u2014 focus on shoulder retraction.':
      'Initiate the pull by driving your elbows back rather than curling with your arms. Think about squeezing a pencil between your shoulder blades.',
    'Stay upright \u2014 avoid leaning back during the pull.':
      'Maintain an upright torso throughout the movement. Leaning back uses momentum rather than back muscles.',
    'Slow down the pull \u2014 control the contraction.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the pull to maximize muscle engagement.',
    "Control the return \u2014 don't let the weight pull you forward.":
      'Resist the weight on the return phase \u2014 aim for 2-3 seconds of controlled eccentric movement.',
  },
};
