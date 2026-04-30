/**
 * Leg Extensions -- Exercise Definition
 *
 * Side view, knee reach ratio as primary driver.
 * FSM: REST -> EXTENDING -> EXTENDED -> RETURNING -> REST
 * Legs start bent (ratio ~0.55-0.65), extend to near-full extension (ratio ~0.93-1.0),
 * then return. One rep = full extension + controlled return.
 *
 * Ratio = dist2D(hip,ankle) / (dist2D(hip,knee) + dist2D(knee,ankle))
 * High ratio = leg extended (straight). Low ratio = leg bent.
 *
 * Seated machine exercise -- the user sits with back supported and extends
 * their lower legs against a padded lever. Camera should be positioned to the
 * side so the hip-knee-ankle angle is clearly visible.
 *
 * The only export is `legExtensionsDefinition`.
 */

import {
  Keypoint,
  calculateAngle2D,
  calculateVerticalAngle,
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
// MODULE-PRIVATE HELPERS
// ============================================================================

type Point2D = { x: number; y: number };

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

/** Euclidean distance between two 2D points. */
function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute normalized knee reach ratio.
 * ratio = dist2D(hip,ankle) / (dist2D(hip,knee) + dist2D(knee,ankle))
 *
 * ~0.55-0.65 = leg bent (seated start position)
 * ~0.93-1.0  = leg nearly straight (full extension)
 */
function computeReachRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): number | null {
  const hipKp = getKeypoint(keypoints, `${side}_hip`);
  const kneeKp = getKeypoint(keypoints, `${side}_knee`);
  const ankleKp = getKeypoint(keypoints, `${side}_ankle`);

  if (
    !hipKp || !kneeKp || !ankleKp ||
    !isVisible(hipKp, VISIBILITY_THRESHOLD) ||
    !isVisible(kneeKp, VISIBILITY_THRESHOLD) ||
    !isVisible(ankleKp, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  const hip = getPoint(hipKp)!;
  const knee = getPoint(kneeKp)!;
  const ankle = getPoint(ankleKp)!;

  const segmentSum = dist2D(hip, knee) + dist2D(knee, ankle);
  if (segmentSum < 1e-6) return null;

  return dist2D(hip, ankle) / segmentSum;
}

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (reach ratio) -- knee reach ratio */
const THRESHOLDS = {
  /** Ratio above which the extension clock starts before the FSM commits */
  EXTEND_CLOCK_START: 0.56,
  /** Ratio above which we transition REST -> EXTENDING */
  EXTENDING_ENTER: 0.60,
  /** Ratio above which we consider near-full extension (EXTENDING -> EXTENDED) */
  EXTENDED_ENTER: 0.72,
  /** Ratio below which we leave EXTENDED (hysteresis) (EXTENDED -> RETURNING) */
  EXTENDED_EXIT: 0.63,
  /** Ratio below which the return is complete (RETURNING -> REST) */
  REST_REENTER: 0.58,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Max ratio below which extension is insufficient */
  EXTENSION_FAIL: 0.93,
  /** Min ratio above which starting flexion is insufficient */
  FLEXION_FAIL: 0.65,
  /** Torso deviation from vertical above which there is excessive lean */
  TORSO_LEAN_WARN: 30,
  /** Hip angle change that indicates lifting hips off the seat */
  HIP_LIFT_WARN: 7,
  /** Concentric (extend) too fast threshold (seconds) */
  TEMPO_EXTEND_MIN: 0.1,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.4,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category             | Cap | Deadzone        | Scale | Key Input                             |
 * |----------------------|-----|-----------------|-------|---------------------------------------|
 * | ROM extension        | 45  | 0 (shortfall)   | 800   | ideal ratio (0.97) - maxRatio         |
 * | ROM flexion          | 20  | 0.10            | 400   | minRatio - ideal start ratio (0.58)   |
 * | Torso lean           | 25  | 25              | 0.04  | max torso deviation from vertical     |
 * | Hip lift             | 30  | 5               | 0.15  | max hip angle delta from baseline     |
 * | Tempo extend         | 8   | 0.15s           | 60    | concentric time deficit               |
 * | Tempo return         | 10  | 0.5s            | 40    | eccentric time deficit                |
 *
 * Max total penalty: 128 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  EXTENSION_ROM: { cap: 45, deadzone: 0, scale: 800 } as PenaltyConfig,
  FLEXION_ROM:   { cap: 20, deadzone: 0.10, scale: 400 } as PenaltyConfig,
  TORSO_LEAN:    { cap: 25, deadzone: 25, scale: 0.04 } as PenaltyConfig,
  HIP_LIFT:      { cap: 30, deadzone: 5, scale: 0.15 } as PenaltyConfig,
  TEMPO_EXTEND:  { cap: 8, deadzone: 0.15, scale: 60 } as PenaltyConfig,
  TEMPO_RETURN:  { cap: 10, deadzone: 0.5, scale: 40 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LegExtensionPhase = 'REST' | 'EXTENDING' | 'EXTENDED' | 'RETURNING';

interface LegExtensionFSM {
  phase: LegExtensionPhase;
  /** Timestamp when extension began (REST -> EXTENDING) */
  tRepStart: number | null;
  /** Timestamp when the user first moved out of the bent start position */
  tExtendStart: number | null;
  /** Timestamp when full extension was reached */
  tExtended: number | null;
  /** Timestamp when rep completed (RETURNING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min ratio during rep (should be low -- bent position at start/end) */
  minRatio: number;
  /** Max ratio during rep (should be high -- extended) */
  maxRatio: number;
  /** Hip angle at rep start (baseline) */
  hipAngleBaseline: number | null;
  /** Max absolute hip angle delta from baseline during rep */
  maxHipDelta: number;
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

interface LegExtensionState {
  fsm: LegExtensionFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  /** Smoothed trackers */
  ratioTracker: SmoothedAngleTracker;
  hipTracker: SmoothedAngleTracker;
  torsoTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Current smoothed values for debug */
  smoothedRatio: number | null;
  /** Median-only ratio used for responsive FSM transitions */
  fastRatio: number | null;
  smoothedHip: number | null;
  smoothedTorso: number | null;
  /** Feedback */
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
  /** Minimum smoothed ratio observed in REST before the current rep starts */
  restMinRatio: number;
}

interface LegExtensionDebugInfo {
  phase: LegExtensionPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  ratio: number | null;
  fastRatio: number | null;
  hipAngle: number | null;
  torsoDev: number | null;
  // Rep window
  ratioMin: number | null;
  ratioMax: number | null;
  hipDelta: number | null;
  torsoDevMax: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): LegExtensionFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tExtendStart: null,
    tExtended: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number, initialRatio?: number): RepWindow {
  return {
    minRatio: initialRatio ?? Infinity,
    maxRatio: initialRatio ?? -Infinity,
    hipAngleBaseline: null,
    maxHipDelta: 0,
    maxTorsoDev: 0,
    tStart,
    tExtended: null,
    tReturnStart: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function initializeLegExtensionState(): LegExtensionState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    ratioTracker: new SmoothedAngleTracker({ medianWindow: 3, emaAlpha: 0.5 }),
    hipTracker: new SmoothedAngleTracker(),
    torsoTracker: new SmoothedAngleTracker(),
    warmupGate: new WarmupGate({
      requiredJoints: [
        'left_hip', 'left_knee', 'left_ankle',
        'right_hip', 'right_knee', 'right_ankle',
        'left_shoulder', 'right_shoulder',
      ],
      requiredFrames: 10,
      visibilityThreshold: 0.2,
    }),
    warmedUp: false,
    smoothedRatio: null,
    fastRatio: null,
    smoothedHip: null,
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
// ANGLE CALCULATION (hip angle + torso deviation kept as-is)
// ============================================================================

/**
 * Calculate the hip angle (shoulder-hip-knee) in 2D.
 * Measures how much the torso-thigh angle deviates -- if the user lifts
 * their hips off the seat, this angle changes from baseline.
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

/**
 * Calculate torso deviation from vertical using the shoulder-hip line.
 * Returns the absolute angle from vertical in degrees (0 = perfectly upright).
 * Uses calculateVerticalAngle() which handles both Y-up (world landmarks)
 * and Y-down (image landmarks) coordinate systems correctly.
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

  return calculateVerticalAngle(hip, shoulder);
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: LegExtensionFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: LegExtensionFSM,
  ratio: number,
  t: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Waiting for extension to begin. When ratio exceeds threshold,
      // transition to EXTENDING.
      if (ratio > THRESHOLDS.EXTEND_CLOCK_START) {
        fsm.tExtendStart ??= t;
      } else {
        fsm.tExtendStart = null;
      }

      if (ratio > THRESHOLDS.EXTENDING_ENTER) {
        fsm.phase = 'EXTENDING';
        fsm.tRepStart = fsm.tExtendStart ?? t;
        fsm.tExtended = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'EXTENDING':
      // Actively extending. When near-full extension reached, transition.
      if (ratio > THRESHOLDS.EXTENDED_ENTER) {
        fsm.phase = 'EXTENDED';
        fsm.tExtended = t;
      } else if (ratio < THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Went back to bent without extending -- reset
        fsm.phase = 'REST';
        fsm.tRepStart = null;
        fsm.tExtendStart = null;
      }
      break;

    case 'EXTENDED':
      // At full extension. When ratio drops back (hysteresis), transition.
      if (ratio < THRESHOLDS.EXTENDED_EXIT) {
        fsm.phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      // Controlled return. When ratio returns to bent position, rep is complete.
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

function computeLegExtensionScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM -- extension: ideal maxRatio is 0.97+. Shortfall = max(0, 0.97 - maxRatio)
  const extensionShortfall = Math.max(0, 0.97 - repWindow.maxRatio);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 2. ROM -- flexion: ideal minRatio is 0.58 or below. Excess = max(0, minRatio - 0.58)
  const flexionExcess = Math.max(0, repWindow.minRatio - 0.58);
  penalties.push({ value: flexionExcess, config: PENALTY_CONFIGS.FLEXION_ROM });

  // 3. Torso lean
  penalties.push({ value: repWindow.maxTorsoDev, config: PENALTY_CONFIGS.TORSO_LEAN });

  // 4. Hip lift (hip angle delta from baseline)
  penalties.push({ value: repWindow.maxHipDelta, config: PENALTY_CONFIGS.HIP_LIFT });

  // 5. Tempo
  if (repWindow.tExtended !== null) {
    const tExtend = repWindow.tExtended - repWindow.tStart;  // concentric (extend)
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tExtended); // eccentric (return)

    // Penalize if too fast (deficit is pre-computed, so pass with deadzone: 0)
    if (tExtend > 0 && tExtend < PENALTY_CONFIGS.TEMPO_EXTEND.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_EXTEND.deadzone - tExtend;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_EXTEND, deadzone: 0 } });
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

  // 1. Extension ROM -- didn't reach full extension
  if (repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_FAIL) {
    messages.push('Extend fully \u2014 straighten your legs completely at the top.');
  }

  // 2. Flexion ROM -- didn't bend enough at the bottom
  if (repWindow.minRatio > FORM_THRESHOLDS.FLEXION_FAIL) {
    messages.push('Lower the weight more \u2014 start from a deeper bend.');
  }

  // 3. Torso lean
  if (repWindow.maxTorsoDev > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Keep your back against the pad \u2014 avoid leaning forward.');
  }

  // 4. Hip lift
  if (repWindow.maxHipDelta > FORM_THRESHOLDS.HIP_LIFT_WARN) {
    messages.push('Keep your hips on the seat \u2014 don\'t lift off the pad.');
  }

  // 5. Tempo
  if (repWindow.tExtended !== null) {
    const tExtend = repWindow.tExtended - repWindow.tStart;
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tExtended);

    if (tExtend > 0 && tExtend < FORM_THRESHOLDS.TEMPO_EXTEND_MIN) {
      messages.push('Slow down the extension \u2014 control the lift.');
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      messages.push('Control the return \u2014 don\'t let the weight drop.');
    }
  }

  return messages;
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateLegExtensionState(
  keypoints: Keypoint[],
  currentState: LegExtensionState
): LegExtensionState {
  const t = Date.now() / 1000;

  // Warmup gate
  if (!currentState.warmedUp) {
    const ready = currentState.warmupGate.update(keypoints);
    if (!ready) {
      return currentState;
    }
    currentState.warmedUp = true;
  }

  // Only update visible side in REST -- lock it during active rep phases
  // to prevent mid-rep side switching that corrupts measurements.
  const inActiveRep = currentState.fsm.phase !== 'REST';
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(keypoints);

  // Calculate raw values
  const rawRatio = computeReachRatio(keypoints, visibleSide);
  const rawHip = calculateHipAngle(keypoints, visibleSide);
  const rawTorsoDev = calculateTorsoDeviation(keypoints, visibleSide);

  // If we can't compute the ratio, bail out
  if (rawRatio === null) {
    return {
      ...currentState,
      visibleSide,
      smoothedRatio: null,
      fastRatio: null,
      smoothedHip: null,
      smoothedTorso: null,
    };
  }

  // Smooth values
  const smoothedRatio = currentState.ratioTracker.push(rawRatio);
  const fastRatio = currentState.ratioTracker.medianValue;
  const smoothedHip = rawHip !== null
    ? currentState.hipTracker.push(rawHip)
    : currentState.hipTracker.value;
  const smoothedTorso = rawTorsoDev !== null
    ? currentState.torsoTracker.push(rawTorsoDev)
    : currentState.torsoTracker.value;

  const newState: LegExtensionState = {
    ...currentState,
    visibleSide,
    smoothedRatio,
    fastRatio: isNaN(fastRatio) ? null : fastRatio,
    smoothedHip: isNaN(smoothedHip) ? null : smoothedHip,
    smoothedTorso: isNaN(smoothedTorso) ? null : smoothedTorso,
  };

  if (isNaN(fastRatio)) {
    return newState;
  }

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, fastRatio, t);
  newState.fsm = fsmResult.fsm;

  if (newState.fsm.phase === 'REST' && !isNaN(smoothedRatio)) {
    newState.restMinRatio = Math.min(newState.restMinRatio, smoothedRatio);
  }

  // Track rep window while actively in a rep (not REST)
  const inRep = newState.fsm.phase !== 'REST';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(newState.fsm.tRepStart ?? t, rawRatio);
    if (currentState.restMinRatio !== Infinity) {
      newState.repWindow.minRatio = currentState.restMinRatio;
    }
    newState.restMinRatio = Infinity;
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
    // Only update when shoulder, hip, and knee all have sufficient confidence.
    if (!isNaN(smoothedHip)) {
      if (window.hipAngleBaseline === null) {
        window.hipAngleBaseline = smoothedHip;
      }
      const hipConf = minKeypointConfidence(keypoints, [
        `${visibleSide}_shoulder`, `${visibleSide}_hip`, `${visibleSide}_knee`,
      ]);
      if (hipConf >= 0.3) {
        const delta = Math.abs(smoothedHip - window.hipAngleBaseline);
        window.maxHipDelta = Math.max(window.maxHipDelta, delta);
      }
    }

    // Track torso deviation
    // Only update when shoulder + hip have sufficient confidence.
    if (!isNaN(smoothedTorso)) {
      const torsoConf = minKeypointConfidence(keypoints, [
        `${visibleSide}_shoulder`, `${visibleSide}_hip`,
      ]);
      if (torsoConf >= 0.3) {
        window.maxTorsoDev = Math.max(window.maxTorsoDev, smoothedTorso);
      }
    }

    // Record extended timestamp
    if (newState.fsm.phase === 'EXTENDED' && window.tExtended === null) {
      window.tExtended = t;
    }

    if (
      currentState.fsm.phase === 'EXTENDED' &&
      window.maxRatio >= FORM_THRESHOLDS.EXTENSION_FAIL &&
      fastRatio < FORM_THRESHOLDS.EXTENSION_FAIL &&
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

    const score = computeLegExtensionScore(newState.repWindow);
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

function getDebugInfo(state: LegExtensionState): LegExtensionDebugInfo {
  const fmt = (v: number | null | undefined): number | null =>
    v !== null && v !== undefined && !isNaN(v) && isFinite(v) ? v : null;

  const repWin = state.repWindow;

  return {
    phase: state.fsm.phase,
    side: state.visibleSide,
    warmedUp: state.warmedUp,
    ratio: fmt(state.smoothedRatio),
    fastRatio: fmt(state.fastRatio),
    hipAngle: fmt(state.smoothedHip),
    torsoDev: fmt(state.smoothedTorso),
    ratioMin: repWin && repWin.minRatio !== Infinity ? fmt(repWin.minRatio) : null,
    ratioMax: repWin && repWin.maxRatio !== -Infinity ? fmt(repWin.maxRatio) : null,
    hipDelta: repWin ? fmt(repWin.maxHipDelta) : null,
    torsoDevMax: repWin ? fmt(repWin.maxTorsoDev) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export const legExtensionsDefinition: ExerciseDefinition = {
  name: 'Leg Extensions',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: initializeLegExtensionState(),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as LegExtensionState;
    const newInternal = updateLegExtensionState(keypoints, internal);

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
      'Extend fully \u2014 straighten your legs completely at the top.': 'lockout_short',
      'Lower the weight more \u2014 start from a deeper bend.': 'rom_short_leg_ext',
      'Keep your back against the pad \u2014 avoid leaning forward.': 'torso_warn',
      "Keep your hips on the seat \u2014 don't lift off the pad.": 'hip_lift',
      'Slow down the extension \u2014 control the lift.': 'tempo_up',
      "Control the return \u2014 don't let the weight drop.": 'tempo_down',
    },
    issueDefinitions: [
      {
        issueType: 'rom_short_leg_ext',
        priority: 20,
        messages: [
          'Get a fuller bend at the bottom.',
          'Start from a deeper position.',
          'More range at the bottom.',
        ],
      },
      {
        issueType: 'hip_lift',
        priority: 25,
        messages: [
          'Stay seated.',
          'Hips on the pad.',
          'Keep your butt down.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Extend fully \u2014 straighten your legs completely at the top.':
      'Focus on achieving full lockout at the top of each rep for maximum quad activation.',
    'Lower the weight more \u2014 start from a deeper bend.':
      'Allow a deeper starting position to maximize the range of motion through the full knee bend.',
    'Keep your back against the pad \u2014 avoid leaning forward.':
      'Maintain contact with the backrest throughout the movement to isolate the quadriceps.',
    "Keep your hips on the seat \u2014 don't lift off the pad.":
      'Keep your hips firmly on the seat \u2014 lifting off uses momentum instead of quad strength.',
    'Slow down the extension \u2014 control the lift.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the extension.',
    "Control the return \u2014 don't let the weight drop.":
      'Slow the eccentric phase \u2014 resist the weight on the way down for 2-3 seconds.',
  },
};
