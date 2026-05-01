/**
 * Cable Pushdowns -- Exercise Definition
 *
 * Side view, reach ratio as primary driver (camera-invariant).
 * FSM: REST -> EXTENDING -> EXTENDED -> RETURNING -> REST
 * Arms start bent (ratio ~0.50-0.65), push down to near-full extension (ratio ~0.95-1.0),
 * then return. One rep = full push-down + controlled return.
 *
 * Reach ratio = dist2D(shoulder,wrist) / (dist2D(shoulder,elbow) + dist2D(elbow,wrist))
 *   low ratio  = arm bent (start/rest position)
 *   high ratio = arm extended (lockout position)
 *
 * The only export is `cablePushdownDefinition`.
 */

import {
  Keypoint,
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
// HELPERS (module-private)
// ============================================================================

type Point2D = { x: number; y: number };

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

/** Euclidean distance using only x, y. */
function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute normalized arm reach ratio.
 * reach = dist2D(shoulder, wrist) / (dist2D(shoulder, elbow) + dist2D(elbow, wrist))
 *
 * ~0.95-1.0  = arm nearly straight (full extension / lockout)
 * ~0.50-0.65 = arm bent (start position)
 */
function computeReachRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): number {
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const elbow = getKeypoint(keypoints, `${side}_elbow`);
  const wrist = getKeypoint(keypoints, `${side}_wrist`);

  if (
    !shoulder || !elbow || !wrist ||
    !isVisible(shoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(elbow, VISIBILITY_THRESHOLD) ||
    !isVisible(wrist, VISIBILITY_THRESHOLD)
  ) {
    return NaN;
  }

  const shoulderPt = getPoint(shoulder)!;
  const elbowPt = getPoint(elbow)!;
  const wristPt = getPoint(wrist)!;

  const segmentLength = dist2D(shoulderPt, elbowPt) + dist2D(elbowPt, wristPt);
  if (segmentLength < 1e-6) return NaN;

  return dist2D(shoulderPt, wristPt) / segmentLength;
}

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (reach ratios) */
const THRESHOLDS = {
  /** Ratio above which the push clock starts before the FSM commits */
  PUSH_CLOCK_START: 0.62,
  /** Ratio above which we transition REST -> EXTENDING (arm starting to straighten) */
  EXTENDING_ENTER: 0.65,
  /** Ratio above which we consider near-full extension (EXTENDING -> EXTENDED) */
  EXTENDED_ENTER: 0.95,
  /** Ratio below which we leave EXTENDED (hysteresis) (EXTENDED -> RETURNING) */
  EXTENDED_EXIT: 0.93,
  /** Ratio below which the return is complete (RETURNING -> REST) */
  REST_REENTER: 0.65,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.5,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Max ratio below which extension is insufficient (didn't lock out) */
  EXTENSION_FAIL: 0.95,
  /** Min ratio above which starting flexion is insufficient (didn't bend enough) */
  FLEXION_FAIL: 0.68,
  /** Shoulder angle delta above which elbows are drifting */
  ELBOW_DRIFT_WARN: 20,
  /** Torso deviation from vertical above which there is excessive lean */
  TORSO_LEAN_WARN: 12,
  /** Concentric (push down) too fast threshold (seconds) */
  TEMPO_PUSH_MIN: 0.2,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.3,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category             | Cap | Deadzone           | Scale | Key Input                         |
 * |----------------------|-----|--------------------|-------|-----------------------------------|
 * | ROM extension        | 30  | 0 (ratio shortfall)| 300   | ideal ratio - max ratio           |
 * | ROM flexion          | 20  | 0 (ratio excess)   | 200   | min ratio - ideal start ratio     |
 * | Elbow drift          | 25  | 15                 | 0.03  | max shoulder angle delta          |
 * | Torso lean           | 25  | 5                  | 0.15  | max torso deviation from vertical |
 * | Tempo push           | 12  | 0.3s               | 60    | concentric time deficit           |
 * | Tempo return         | 8   | 0.4s               | 40    | eccentric time deficit            |
 *
 * Max total penalty: 120 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  EXTENSION_ROM: { cap: 30, deadzone: 0, scale: 300 } as PenaltyConfig,
  FLEXION_ROM:   { cap: 20, deadzone: 0, scale: 200 } as PenaltyConfig,
  ELBOW_DRIFT:   { cap: 25, deadzone: 15, scale: 0.03 } as PenaltyConfig,
  TORSO_LEAN:    { cap: 40, deadzone: 5, scale: 0.15 } as PenaltyConfig,
  TEMPO_PUSH:    { cap: 12, deadzone: 0.3, scale: 60 } as PenaltyConfig,
  TEMPO_RETURN:  { cap: 8,  deadzone: 0.4, scale: 40 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;

// ============================================================================
// TYPES (module-private)
// ============================================================================

type CablePushdownPhase = 'REST' | 'EXTENDING' | 'EXTENDED' | 'RETURNING';

interface CablePushdownFSM {
  phase: CablePushdownPhase;
  /** Timestamp when push began (REST -> EXTENDING) */
  tRepStart: number | null;
  /** Timestamp when the user first moved out of the bent start position */
  tPushStart: number | null;
  /** Timestamp when full extension was reached */
  tExtended: number | null;
  /** Timestamp when rep completed (RETURNING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min reach ratio during rep (should be low -- bent position at start/end) */
  minRatio: number;
  /** Max reach ratio during rep (should be high -- extended at bottom) */
  maxRatio: number;
  /** Shoulder angle at rep start (baseline) */
  shoulderAngleBaseline: number | null;
  /** Max absolute shoulder angle delta from baseline during rep */
  maxShoulderDelta: number;
  /** Max absolute torso deviation from vertical during rep */
  maxTorsoDev: number;
  /** Timestamps */
  tStart: number;
  tExtended: number | null;
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

interface CablePushdownState {
  fsm: CablePushdownFSM;
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
  /** Minimum smoothed ratio observed during REST phase (pre-seeds rep window) */
  restMinRatio: number;
}

interface CablePushdownDebugInfo {
  phase: CablePushdownPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  ratio: number | null;
  fastRatio: number | null;
  shoulderAngle: number | null;
  torsoDev: number | null;
  // Rep window
  ratioMin: number | null;
  ratioMax: number | null;
  shoulderDelta: number | null;
  torsoDevMax: number | null;
}

// ============================================================================
// ANGLE CALCULATION (shoulder angle & torso — kept as angles, already camera-invariant deltas)
// ============================================================================

/**
 * Calculate the upper arm angle relative to the torso (hip-shoulder-elbow) in 2D.
 * This measures how much the upper arm deviates from being pinned to the torso.
 * When elbows are properly pinned, this angle stays relatively constant.
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

  const hipPt = getPoint(hip)!;
  const shoulderPt = getPoint(shoulder)!;
  const elbowPt = getPoint(elbow)!;

  // Vectors from shoulder
  const v1x = hipPt.x - shoulderPt.x;
  const v1y = hipPt.y - shoulderPt.y;
  const v2x = elbowPt.x - shoulderPt.x;
  const v2y = elbowPt.y - shoulderPt.y;

  const dot = v1x * v2x + v1y * v2y;
  const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

  if (len1 < 1e-8 || len2 < 1e-8) return null;

  const cosTheta = Math.max(-1, Math.min(1, dot / (len1 * len2)));
  return Math.acos(cosTheta) * (180 / Math.PI);
}

/**
 * Calculate torso deviation from vertical using the shoulder-hip line.
 * Returns the absolute angle from vertical in degrees (0 = perfectly upright).
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

  // Torso vector: hip -> shoulder (should point roughly upward)
  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-8) return null;

  // In screen coords, Y points down. Straight up = (0, -1).
  // cos(theta) = dot((dx,dy), (0,-1)) / len = -dy / len
  const cosTheta = -dy / len;
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180 / Math.PI);

  return angleDeg;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): CablePushdownFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tPushStart: null,
    tExtended: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number, initialRatio?: number): RepWindow {
  return {
    minRatio: initialRatio ?? Infinity,
    maxRatio: initialRatio ?? -Infinity,
    shoulderAngleBaseline: null,
    maxShoulderDelta: 0,
    maxTorsoDev: 0,
    tStart,
    tExtended: null,
    tReturnStart: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function initializeCablePushdownState(): CablePushdownState {
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
    restMinRatio: Infinity,
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
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: CablePushdownFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: CablePushdownFSM,
  ratio: number,
  t: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Waiting for push to begin. When ratio rises past threshold (arm straightening),
      // transition to EXTENDING.
      if (ratio > THRESHOLDS.PUSH_CLOCK_START) {
        fsm.tPushStart ??= t;
      } else {
        fsm.tPushStart = null;
      }

      if (ratio > THRESHOLDS.EXTENDING_ENTER) {
        fsm.phase = 'EXTENDING';
        fsm.tRepStart = fsm.tPushStart ?? t;
        fsm.tExtended = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'EXTENDING':
      // Actively pushing down. When near-full extension reached, transition.
      if (ratio > THRESHOLDS.EXTENDED_ENTER) {
        fsm.phase = 'EXTENDED';
        fsm.tExtended = t;
      } else if (ratio < THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Went back to bent without extending -- reset
        fsm.phase = 'REST';
        fsm.tRepStart = null;
        fsm.tPushStart = null;
      }
      break;

    case 'EXTENDED':
      // At full extension. When ratio drops (arm bending back), transition.
      if (ratio < THRESHOLDS.EXTENDED_EXIT) {
        fsm.phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      // Controlled return. When ratio drops to bent position, rep is complete.
      if (
        ratio < THRESHOLDS.REST_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'REST';
        fsm.tRepEnd = t;
        repCompleted = true;
      } else if (ratio > THRESHOLDS.EXTENDED_ENTER) {
        // Went back to extension -- return to EXTENDED
        fsm.phase = 'EXTENDED';
      }
      break;
  }

  return { fsm, repCompleted };
}

// ============================================================================
// SCORING (continuous penalty curves)
// ============================================================================

function computeCablePushdownScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM -- extension: ideal max ratio is 0.98+. Shortfall = max(0, 0.98 - maxRatio)
  const extensionShortfall = Math.max(0, 0.98 - repWindow.maxRatio);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 2. ROM -- flexion: ideal min ratio is 0.55 or below. Excess = max(0, minRatio - 0.55)
  const flexionExcess = Math.max(0, repWindow.minRatio - 0.55);
  penalties.push({ value: flexionExcess, config: PENALTY_CONFIGS.FLEXION_ROM });

  // 3. Elbow drift (shoulder angle delta)
  penalties.push({ value: repWindow.maxShoulderDelta, config: PENALTY_CONFIGS.ELBOW_DRIFT });

  // 4. Torso lean
  penalties.push({ value: repWindow.maxTorsoDev, config: PENALTY_CONFIGS.TORSO_LEAN });

  // 5. Tempo
  if (repWindow.tExtended !== null) {
    const tPush = repWindow.tExtended - repWindow.tStart;  // concentric (push down)
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tExtended); // eccentric (return)

    // Penalize if too fast (deficit is pre-computed, so pass with deadzone: 0)
    if (tPush > 0 && tPush < PENALTY_CONFIGS.TEMPO_PUSH.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_PUSH.deadzone - tPush;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_PUSH, deadzone: 0 } });
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

  // 1. Extension ROM -- didn't lock out fully (max ratio too low)
  if (repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_FAIL) {
    messages.push('Extend fully \u2014 lock out at the bottom of each rep.');
  }

  // 2. Flexion ROM -- didn't bend enough at the top (min ratio too high)
  if (repWindow.minRatio > FORM_THRESHOLDS.FLEXION_FAIL) {
    messages.push('Start with a deeper bend \u2014 bring your forearms closer to your biceps.');
  }

  // 3. Elbow drift (shoulder movement)
  if (repWindow.maxShoulderDelta > FORM_THRESHOLDS.ELBOW_DRIFT_WARN) {
    messages.push('Keep your elbows pinned to your sides \u2014 avoid letting them drift.');
  }

  // 4. Torso lean
  if (repWindow.maxTorsoDev > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Stay upright \u2014 avoid leaning into the pushdown.');
  }

  // 5. Tempo
  if (repWindow.tExtended !== null) {
    const tPush = repWindow.tExtended - repWindow.tStart;
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tExtended);

    if (tPush > 0 && tPush < FORM_THRESHOLDS.TEMPO_PUSH_MIN) {
      messages.push('Slow down the push \u2014 control the extension.');
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      messages.push('Control the return \u2014 don\'t let the weight snap back.');
    }
  }

  return messages;
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateCablePushdownState(
  keypoints: Keypoint[],
  currentState: CablePushdownState
): CablePushdownState {
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
  // transient confidence changes do not splice two arms into one rep.
  const inActiveRep = currentState.fsm.phase !== 'REST';
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(keypoints);

  // Calculate raw values
  const rawRatio = computeReachRatio(keypoints, visibleSide);
  const rawShoulder = calculateShoulderAngle(keypoints, visibleSide);
  const rawTorsoDev = calculateTorsoDeviation(keypoints, visibleSide);

  // If we can't compute the ratio, bail out
  if (isNaN(rawRatio)) {
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

  const newState: CablePushdownState = {
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

  // Track minimum ratio during REST (captures true starting bent position)
  if (newState.fsm.phase === 'REST' && !isNaN(smoothedRatio)) {
    newState.restMinRatio = Math.min(newState.restMinRatio, smoothedRatio);
  }

  // Track rep window while actively in a rep (not REST)
  const inRep = newState.fsm.phase !== 'REST';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(newState.fsm.tRepStart ?? t, rawRatio);
    // Pre-seed minRatio with the resting bent ratio so flexion ROM is measured correctly
    if (currentState.restMinRatio !== Infinity) {
      newState.repWindow.minRatio = currentState.restMinRatio;
    }
    newState.restMinRatio = Infinity; // Reset for next rep
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

    // Track shoulder angle delta from baseline
    if (!isNaN(smoothedShoulder)) {
      if (window.shoulderAngleBaseline === null) {
        window.shoulderAngleBaseline = smoothedShoulder;
      }
      const delta = Math.abs(smoothedShoulder - window.shoulderAngleBaseline);
      window.maxShoulderDelta = Math.max(window.maxShoulderDelta, delta);
    }

    // Track torso deviation
    if (!isNaN(smoothedTorso)) {
      window.maxTorsoDev = Math.max(window.maxTorsoDev, smoothedTorso);
    }

    // Record extended timestamp
    if (newState.fsm.phase === 'EXTENDED' && window.tExtended === null) {
      window.tExtended = t;
    }

    if (
      currentState.fsm.phase === 'EXTENDED' &&
      newState.fsm.phase === 'RETURNING' &&
      window.tReturnStart === null
    ) {
      window.tReturnStart = t;
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

    const score = computeCablePushdownScore(newState.repWindow);
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

function getDebugInfo(state: CablePushdownState): CablePushdownDebugInfo {
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

export const cablePushdownDefinition: ExerciseDefinition = {
  name: 'Cable Pushdowns',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: initializeCablePushdownState(),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as CablePushdownState;
    const newInternal = updateCablePushdownState(keypoints, internal);

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
      'Extend fully \u2014 lock out at the bottom of each rep.': 'lockout_short',
      'Start with a deeper bend \u2014 bring your forearms closer to your biceps.': 'rom_short',
      'Keep your elbows pinned to your sides \u2014 avoid letting them drift.': 'elbow_drift',
      'Stay upright \u2014 avoid leaning into the pushdown.': 'torso_warn',
      'Slow down the push \u2014 control the extension.': 'tempo_down',
      "Control the return \u2014 don't let the weight snap back.": 'tempo_up',
    },
    issueDefinitions: [
      {
        issueType: 'rom_short',
        priority: 20,
        messages: [
          'Get a fuller stretch at the top.',
          'Deeper starting position.',
          'Bring it up higher.',
        ],
      },
      {
        issueType: 'elbow_drift',
        priority: 25,
        messages: [
          'Pin your elbows.',
          'Elbows tight to your sides.',
          'Lock those elbows in place.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Extend fully \u2014 lock out at the bottom of each rep.':
      'Focus on achieving full lockout at the bottom of each rep for maximum tricep activation.',
    'Start with a deeper bend \u2014 bring your forearms closer to your biceps.':
      'Allow a deeper stretch at the top position to maximize the range of motion.',
    'Keep your elbows pinned to your sides \u2014 avoid letting them drift.':
      'Keep your elbows locked to your sides throughout the movement to isolate the triceps.',
    'Stay upright \u2014 avoid leaning into the pushdown.':
      'Maintain an upright posture \u2014 leaning forward uses momentum instead of tricep strength.',
    'Slow down the push \u2014 control the extension.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the push down.',
    "Control the return \u2014 don't let the weight snap back.":
      'Slow the eccentric phase \u2014 resist the weight on the way up for 2-3 seconds.',
  },
};
