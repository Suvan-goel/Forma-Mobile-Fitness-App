/**
 * Barbell Squat Exercise Definition
 *
 * Side-view squat analysis using knee reach ratio as the primary FSM driver.
 * Knee reach ratio: dist2D(hip,ankle) / (dist2D(hip,knee) + dist2D(knee,ankle))
 *   ~0.95-0.98 = legs fully extended (standing), ~0.60-0.70 = deep squat
 *
 * Evaluates depth, lockout, torso forward lean, and tempo.
 *
 * FSM: IDLE -> STANDING -> DESCENDING -> BOTTOM -> ASCENDING -> STANDING
 * - IDLE gate: user must hold a standing pose for 0.8s before FSM activates
 * - After first rep, FSM resets to STANDING (skips IDLE)
 *
 * The only export is `squatDefinition`.
 */

import {
  Keypoint,
  calculateVerticalAngle,
  getKeypoint,
  isVisible,
  minKeypointConfidence,
} from '../../poseAnalysis';

import type {
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  ExerciseState,
  RepResult as FrameworkRepResult,
} from '../types';
import {
  createDefaultTunableSpec,
  mergeHeuristicConfig,
  runWithConfigBindings,
} from '../heuristicConfig';
import tunedConfig from './tuned/squat.json';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/**
 * FSM thresholds — ratio-based for knee (camera-invariant).
 * Knee reach ratio: dist(hip,ankle) / (dist(hip,knee) + dist(knee,ankle))
 *   ~0.95-0.98 = legs fully extended (standing), ~0.60-0.70 = deep squat
 *
 * Torso lean and IDLE gate torso check remain angle-based (they measure pose
 * orientation, not limb flexion, so angles are the correct metric).
 */
const THRESHOLDS = {
  /** Reach ratio below which we transition STANDING -> DESCENDING */
  DESCENDING_ENTER: 0.92,
  /** Reach ratio below which we start timing the descent before committing a rep */
  DESCENT_CLOCK_START: 0.985,
  /** Reach ratio below which we reach BOTTOM */
  BOTTOM_ENTER: 0.76,
  /** Reach ratio above which we leave BOTTOM (hysteresis) */
  BOTTOM_EXIT: 0.80,
  /** Reach ratio above which we transition ASCENDING -> STANDING (rep complete) */
  STANDING_REENTER: 0.93,
  /** Minimum time (seconds) for a rep to count */
  MIN_REP_TIME: 0.8,
  /** Partial rep: ratio above which we reset from DESCENDING without hitting BOTTOM */
  PARTIAL_REP_RESET: 0.93,
  /** Minimum time in DESCENDING before partial-rep reset can trigger */
  MIN_DESCENDING_TIME: 0.5,
  /** Reach ratio above which legs are considered extended (for IDLE gate) */
  IDLE_STANDING_MIN: 0.93,
  /** Seconds user must hold standing pose before FSM activates from IDLE */
  STANDING_HOLD_TIME: 0.8,
  /** Maximum torso inclination from vertical for standing detection (degrees) */
  TORSO_INCLINE_MAX_IDLE: 25,
  /** Minimum ratio ROM for a partial rep to count */
  MIN_PARTIAL_ROM: 0.08,
  /** Minimum ratio ROM for a full rep to count */
  MIN_REP_ROM: 0.15,
  /** Minimum frames in rep window for a rep to count */
  MIN_REP_FRAMES: 8,
} as const;

/** Form heuristic thresholds — ratio-based for knee, angle-based for torso */
const FORM_THRESHOLDS = {
  // Depth: lower ratio = deeper squat. Parallel ~ ratio 0.60-0.65.
  DEPTH_WARN: 0.70,   // min ratio > 0.70 = not quite parallel
  DEPTH_FAIL: 0.76,   // min ratio > 0.76 = clearly shallow
  // Lockout: max ratio below this = incomplete lockout
  LOCKOUT_FAIL: 0.95,
  // ROM: minimum ratio change during rep
  ROM_MIN: 0.20,
  // Torso lean (forward lean from vertical, via hip-shoulder vector — already camera-invariant)
  TORSO_LEAN_WARN: 40, // max torso lean > 40 degrees (natural squat lean is 15-35)
  TORSO_LEAN_FAIL: 50, // max torso lean > 50 degrees
  // Tempo
  TEMPO_CONCENTRIC_MIN: 0.3,  // ascent too fast (seconds)
  TEMPO_ECCENTRIC_MIN: 0.8,   // descent too fast (seconds)
} as const;

/**
 * Continuous penalty curve parameters — ratio-based for depth/lockout.
 *
 * | Category          | Cap | Deadzone       | Scale | Key Input                     |
 * |-------------------|-----|----------------|-------|-------------------------------|
 * | Depth shortfall   | 35  | 0.62 (ratio)   | 300   | min ratio - no penalty below  |
 * | Lockout shortfall | 20  | 0.97 (ideal)   | 300   | ideal - max ratio             |
 * | Torso lean        | 30  | 30 (degrees)   | 0.06  | max torso forward lean        |
 * | Tempo             | 15  | up: 0.3s       | 60/40 | concentric / eccentric time   |
 *
 * Max total penalty: 100 -> worst possible rep = 0.
 */
const SCORE_CURVES = {
  DEPTH:   { deadzone: 0.62, scale: 300, cap: 35 },
  LOCKOUT: { ideal: 0.97,    scale: 300, cap: 20 },
  TORSO:   { deadzone: 30,   scale: 0.06, cap: 30 },
  TEMPO_CONCENTRIC: { deadzone: 0.3, scale: 60, cap: 8 },
  TEMPO_ECCENTRIC:  { deadzone: 0.8, scale: 40, cap: 7 },
} as const;

/** Smoothing parameters */
const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.3;
const VISIBILITY_THRESHOLD = 0.2;

const DEFAULT_SQUAT_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  scoreCurves: SCORE_CURVES,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_SQUAT_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_SQUAT_HEURISTIC_CONFIG,
  tunedConfig,
);

const SQUAT_TUNABLE_SPEC = createDefaultTunableSpec(
  'Barbell Squat',
  DEFAULT_SQUAT_HEURISTIC_CONFIG,
);

const SQUAT_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'scoreCurves', target: SCORE_CURVES as unknown as Record<string, unknown> },
];

function withSquatConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, SQUAT_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type SquatPhase = 'IDLE' | 'STANDING' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';

interface SquatFSM {
  phase: SquatPhase;
  /** Timestamp when rep started (STANDING -> DESCENDING) */
  tRepStart: number | null;
  /** Timestamp when the user first moved out of the top position */
  tDescentStart: number | null;
  /** Timestamp when BOTTOM was reached */
  tBottom: number | null;
  /** Timestamp when rep completed (ASCENDING -> STANDING) */
  tRepEnd: number | null;
  /** Timestamp when user first showed valid standing pose in IDLE */
  tIdleStableSince: number | null;
}

interface SquatRepWindow {
  /** Min/max knee reach ratio during rep (primary — camera-invariant) */
  minKneeRatio: number;
  maxKneeRatio: number;
  /** Max torso forward lean (degrees from vertical) during rep */
  maxTorsoLean: number;
  /** Timestamps */
  tStart: number;
  tBottom: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
}

interface SquatAngles {
  knee: number;
  kneeRatio: number; // reach ratio: camera-invariant
  torsoLean: number;
  hipAngle: number;
}

interface SmoothedSquatAngles extends SquatAngles {}

interface RepResult {
  repIndex: number;
  romRatio: number; // ratio ROM (max - min reach ratio)
  tDown: number;
  tUp: number;
  score: number;
  messages: string[];
}

interface SquatState {
  fsm: SquatFSM;
  repCount: number;
  repWindow: SquatRepWindow | null;
  lastRepResult: RepResult | null;
  angleHistory: Record<keyof SquatAngles, number[]>;
  smoothed: SmoothedSquatAngles | null;
  /** Median-only values (no EMA) — used for FSM transitions to avoid smoothing lag. */
  fast: SmoothedSquatAngles | null;
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
  /** Best top-position knee extension seen before the current rep starts */
  standingKneeRatioPeak: number;
}

/** Debug info for on-screen diagnostics */
interface SquatDebugInfo {
  phase: SquatPhase;
  side: 'left' | 'right';
  knee: number | null;
  kneeRatio: number | null;
  /** Median-only ratio fed to FSM — should track extremes faster than kneeRatio (EMA) */
  fastKneeRatio: number | null;
  torsoLean: number | null;
  hipAngle: number | null;
  kneeRatioMin: number | null;
  kneeRatioMax: number | null;
  maxTorsoLean: number | null;
}

interface FSMUpdateResult {
  fsm: SquatFSM;
  repCompleted: boolean;
  partialRep: boolean;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): SquatFSM {
  return {
    phase: 'IDLE',
    tRepStart: null,
    tDescentStart: null,
    tBottom: null,
    tRepEnd: null,
    tIdleStableSince: null,
  };
}

function resetFSMToStanding(): SquatFSM {
  return {
    phase: 'STANDING',
    tRepStart: null,
    tDescentStart: null,
    tBottom: null,
    tRepEnd: null,
    tIdleStableSince: null,
  };
}

function initRepWindow(tStart: number, initialKneeRatio?: number): SquatRepWindow {
  return {
    minKneeRatio: initialKneeRatio ?? Infinity,
    maxKneeRatio: initialKneeRatio ?? -Infinity,
    maxTorsoLean: -Infinity,
    tStart,
    tBottom: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function initializeSquatState(): SquatState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    angleHistory: {
      knee: [],
      kneeRatio: [],
      torsoLean: [],
      hipAngle: [],
    },
    smoothed: null,
    fast: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
    standingKneeRatioPeak: -Infinity,
  };
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

type Point2D = { x: number; y: number };

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

/** Euclidean distance in 2D */
function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Reach ratio for a 3-joint chain. 1.0 = straight, lower = more bent. */
function computeReachRatio(proximal: Point2D, joint: Point2D, distal: Point2D): number {
  const chainLen = dist2D(proximal, joint) + dist2D(joint, distal);
  if (chainLen < 1e-6) return 1.0;
  return dist2D(proximal, distal) / chainLen;
}

/**
 * Calculate torso forward lean: deviation of the hip->shoulder vector from vertical.
 * 0 = perfectly upright, 90 = horizontal.
 * Uses midpoints when both sides are visible.
 *
 * Delegates to calculateVerticalAngle() which handles both Y-up (world landmarks)
 * and Y-down (image landmarks) coordinate systems correctly.
 */
function calculateTorsoLean(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): number | null {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  let shoulder: { x: number; y: number; z?: number };
  let hip: { x: number; y: number; z?: number };

  const lsVis = isVisible(ls, VISIBILITY_THRESHOLD);
  const rsVis = isVisible(rs, VISIBILITY_THRESHOLD);
  const lhVis = isVisible(lh, VISIBILITY_THRESHOLD);
  const rhVis = isVisible(rh, VISIBILITY_THRESHOLD);

  if (lsVis && rsVis) {
    shoulder = {
      x: (ls!.x + rs!.x) / 2,
      y: (ls!.y + rs!.y) / 2,
      z: ((ls!.z ?? 0) + (rs!.z ?? 0)) / 2,
    };
  } else {
    const s = getKeypoint(keypoints, `${side}_shoulder`);
    if (!s || !isVisible(s, VISIBILITY_THRESHOLD)) return null;
    shoulder = s;
  }

  if (lhVis && rhVis) {
    hip = {
      x: (lh!.x + rh!.x) / 2,
      y: (lh!.y + rh!.y) / 2,
      z: ((lh!.z ?? 0) + (rh!.z ?? 0)) / 2,
    };
  } else {
    const h = getKeypoint(keypoints, `${side}_hip`);
    if (!h || !isVisible(h, VISIBILITY_THRESHOLD)) return null;
    hip = h;
  }

  return calculateVerticalAngle(hip, shoulder);
}

// ============================================================================
// VISIBLE SIDE SELECTION
// ============================================================================

function selectVisibleSide(keypoints: Keypoint[]): 'left' | 'right' {
  const leftParts = ['left_shoulder', 'left_hip', 'left_knee', 'left_ankle'];
  const rightParts = ['right_shoulder', 'right_hip', 'right_knee', 'right_ankle'];

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
// ANGLE CALCULATION
// ============================================================================

function calculateSquatAngles(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): SquatAngles | null {
  const hip = getKeypoint(keypoints, `${side}_hip`);
  const knee = getKeypoint(keypoints, `${side}_knee`);
  const ankle = getKeypoint(keypoints, `${side}_ankle`);
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);

  const hasLeg =
    hip && knee && ankle &&
    isVisible(hip, VISIBILITY_THRESHOLD) &&
    isVisible(knee, VISIBILITY_THRESHOLD) &&
    isVisible(ankle, VISIBILITY_THRESHOLD);

  if (!hasLeg) return null;

  const hipPt = getPoint(hip)!;
  const kneePt = getPoint(knee)!;
  const anklePt = getPoint(ankle)!;

  // Knee reach ratio (hip-knee-ankle): ~0.97 = fully extended, ~0.60 = deep squat
  const kneeRatio = computeReachRatio(hipPt, kneePt, anklePt);

  // Hip angle (shoulder-hip-knee): indicates hip hinge depth
  let hipAngle = 180;
  if (shoulder && isVisible(shoulder, VISIBILITY_THRESHOLD)) {
    const shoulderPt = getPoint(shoulder)!;
    hipAngle = computeReachRatio(shoulderPt, hipPt, kneePt);
    // Keep as angle-like value — hipAngle is not used in FSM, kept for debug
    // Actually recompute as a proper angle for consistency
  }
  // Recompute hipAngle as actual ratio for the interface — but hipAngle was
  // originally an angle. Since it's only used for debug display, keep it as
  // a ratio too for consistency with the camera-invariant approach.
  // Actually, let's keep hipAngle as a simple pass-through value since it's
  // not used by FSM or form checks. Set to 180 as default.
  hipAngle = 180;
  if (shoulder && isVisible(shoulder, VISIBILITY_THRESHOLD)) {
    // Store hip reach ratio (not used for FSM, just debug)
    hipAngle = computeReachRatio(getPoint(shoulder)!, hipPt, kneePt);
  }

  // Torso forward lean from vertical
  const torsoLean = calculateTorsoLean(keypoints, side);

  return {
    knee: kneeRatio,
    kneeRatio,
    torsoLean: torsoLean ?? NaN,
    hipAngle,
  };
}

// ============================================================================
// SMOOTHING
// ============================================================================

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function applySmoothing(
  rawAngles: SquatAngles,
  history: SquatState['angleHistory'],
  prevSmoothed: SmoothedSquatAngles | null
): { smoothed: SmoothedSquatAngles; fast: SmoothedSquatAngles } {
  const keys: (keyof SquatAngles)[] = ['knee', 'kneeRatio', 'torsoLean', 'hipAngle'];
  const smoothedResult: Partial<SmoothedSquatAngles> = {};
  const fastResult: Partial<SmoothedSquatAngles> = {};

  for (const key of keys) {
    const value = rawAngles[key];
    if (isNaN(value)) {
      const fallback = prevSmoothed?.[key] ?? NaN;
      smoothedResult[key] = fallback;
      fastResult[key] = fallback;
      continue;
    }

    history[key].push(value);
    if (history[key].length > MEDIAN_WINDOW) {
      history[key].shift();
    }

    const medianValue = median(history[key]);
    // fast = median only: responds to extremes within ~1-2 frames, used for FSM
    fastResult[key] = medianValue;

    // smoothed = median + EMA: stable for form evaluation
    const prev = prevSmoothed?.[key];
    smoothedResult[key] =
      prev !== undefined && !isNaN(prev)
        ? EMA_ALPHA * medianValue + (1 - EMA_ALPHA) * prev
        : medianValue;
  }

  return {
    smoothed: smoothedResult as SmoothedSquatAngles,
    fast: fastResult as SmoothedSquatAngles,
  };
}

// ============================================================================
// FSM LOGIC
// ============================================================================

function updateFSM(
  currentFSM: SquatFSM,
  kneeRatio: number,
  t: number,
  torsoLean: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;
  let partialRep = false;

  switch (fsm.phase) {
    case 'IDLE': {
      // Ratio is high when legs are extended (standing)
      const legsExtended = kneeRatio > THRESHOLDS.IDLE_STANDING_MIN;
      const torsoUpright = torsoLean < THRESHOLDS.TORSO_INCLINE_MAX_IDLE;

      if (legsExtended && torsoUpright) {
        if (fsm.tIdleStableSince === null) {
          fsm.tIdleStableSince = t;
        } else if (t - fsm.tIdleStableSince >= THRESHOLDS.STANDING_HOLD_TIME) {
          fsm.phase = 'STANDING';
          fsm.tIdleStableSince = null;
        }
      } else {
        fsm.tIdleStableSince = null;
      }
      break;
    }

    case 'STANDING':
      // Ratio drops as knee bends
      if (kneeRatio < THRESHOLDS.DESCENT_CLOCK_START) {
        fsm.tDescentStart ??= t;
      } else {
        fsm.tDescentStart = null;
      }

      if (kneeRatio < THRESHOLDS.DESCENDING_ENTER) {
        fsm.phase = 'DESCENDING';
        fsm.tRepStart = fsm.tDescentStart ?? t;
        fsm.tBottom = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'DESCENDING':
      // Ratio continues to drop toward bottom
      if (kneeRatio < THRESHOLDS.BOTTOM_ENTER) {
        fsm.phase = 'BOTTOM';
        fsm.tBottom = t;
      } else if (
        kneeRatio > THRESHOLDS.PARTIAL_REP_RESET &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_DESCENDING_TIME
      ) {
        // Returned to standing without reaching depth -- partial rep
        fsm.phase = 'STANDING';
        partialRep = true;
        fsm.tRepStart = null;
        fsm.tDescentStart = null;
      }
      break;

    case 'BOTTOM':
      // Ratio rises as knee extends
      if (kneeRatio > THRESHOLDS.BOTTOM_EXIT) {
        fsm.phase = 'ASCENDING';
      }
      break;

    case 'ASCENDING':
      if (
        kneeRatio > THRESHOLDS.STANDING_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'STANDING';
        fsm.tRepEnd = t;
        repCompleted = true;
      }
      break;
  }

  return { fsm, repCompleted, partialRep };
}

// ============================================================================
// FORM EVALUATION
// ============================================================================

function computeSquatRepScore(repWindow: SquatRepWindow): number {
  let penalty = 0;

  // 1. Depth shortfall -- lower minKneeRatio is better (deeper squat)
  //    Penalty kicks in when min ratio is above the deadzone (not deep enough)
  const depthExcess = Math.max(0, repWindow.minKneeRatio - SCORE_CURVES.DEPTH.deadzone);
  penalty += Math.min(SCORE_CURVES.DEPTH.cap, SCORE_CURVES.DEPTH.scale * depthExcess * depthExcess);

  // 2. Lockout shortfall -- higher maxKneeRatio is better (closer to full extension)
  const lockoutShortfall = Math.max(0, SCORE_CURVES.LOCKOUT.ideal - repWindow.maxKneeRatio);
  penalty += Math.min(SCORE_CURVES.LOCKOUT.cap, SCORE_CURVES.LOCKOUT.scale * lockoutShortfall * lockoutShortfall);

  // 3. Torso forward lean -- some lean is natural for squats (deadzone 30)
  const torsoExcess = Math.max(0, repWindow.maxTorsoLean - SCORE_CURVES.TORSO.deadzone);
  penalty += Math.min(SCORE_CURVES.TORSO.cap, SCORE_CURVES.TORSO.scale * torsoExcess * torsoExcess);

  // 4. Tempo
  if (repWindow.tBottom !== null) {
    const tEccentric = repWindow.tBottom - repWindow.tStart;
    const tConcentric = repWindow.tEnd - repWindow.tBottom;

    if (tConcentric > 0 && tConcentric < SCORE_CURVES.TEMPO_CONCENTRIC.deadzone) {
      const deficit = SCORE_CURVES.TEMPO_CONCENTRIC.deadzone - tConcentric;
      penalty += Math.min(SCORE_CURVES.TEMPO_CONCENTRIC.cap, SCORE_CURVES.TEMPO_CONCENTRIC.scale * deficit * deficit);
    }
    if (tEccentric > 0 && tEccentric < SCORE_CURVES.TEMPO_ECCENTRIC.deadzone) {
      const deficit = SCORE_CURVES.TEMPO_ECCENTRIC.deadzone - tEccentric;
      penalty += Math.min(SCORE_CURVES.TEMPO_ECCENTRIC.cap, SCORE_CURVES.TEMPO_ECCENTRIC.scale * deficit * deficit);
    }
  }

  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

function generateFormMessages(repWindow: SquatRepWindow): string[] {
  const messages: string[] = [];

  // 1. Depth — higher min ratio = shallower squat
  if (repWindow.minKneeRatio > FORM_THRESHOLDS.DEPTH_FAIL) {
    messages.push('Squat deeper \u2014 aim to get your thighs parallel.');
  } else if (repWindow.minKneeRatio > FORM_THRESHOLDS.DEPTH_WARN) {
    messages.push('Try to go a little deeper for full range of motion.');
  }

  // 2. Lockout — lower max ratio = incomplete extension
  if (repWindow.maxKneeRatio < FORM_THRESHOLDS.LOCKOUT_FAIL) {
    messages.push('Stand all the way up \u2014 fully extend your knees.');
  }

  // 3. ROM — ratio change during rep
  const romRatio = repWindow.maxKneeRatio - repWindow.minKneeRatio;
  if (romRatio < FORM_THRESHOLDS.ROM_MIN && messages.length === 0) {
    messages.push('Incomplete rep \u2014 use a full range of motion.');
  }

  // 4. Torso lean (angle-based — already camera-invariant)
  if (repWindow.maxTorsoLean > FORM_THRESHOLDS.TORSO_LEAN_FAIL) {
    messages.push('Too much forward lean \u2014 keep your chest up.');
  } else if (repWindow.maxTorsoLean > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Stay more upright \u2014 brace your core.');
  }

  // 5. Tempo
  if (repWindow.tBottom !== null) {
    const tEccentric = repWindow.tBottom - repWindow.tStart;
    const tConcentric = repWindow.tEnd - repWindow.tBottom;

    if (tConcentric > 0 && tConcentric < FORM_THRESHOLDS.TEMPO_CONCENTRIC_MIN) {
      messages.push('Control the ascent \u2014 don\'t bounce out of the hole.');
    }
    if (tEccentric > 0 && tEccentric < FORM_THRESHOLDS.TEMPO_ECCENTRIC_MIN) {
      messages.push('Slow the descent \u2014 control the weight down.');
    }
  }

  return messages;
}

function evaluateForm(
  repWindow: SquatRepWindow
): { score: number; messages: string[] } {
  const score = computeSquatRepScore(repWindow);
  const messages = generateFormMessages(repWindow);
  return { score, messages };
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateSquatState(
  keypoints: Keypoint[],
  currentState: SquatState
): SquatState {
  const t = Date.now() / 1000;

  // Only update visible side in IDLE/STANDING — lock it during active rep phases
  // to prevent mid-rep side switching that corrupts angle measurements.
  const inActiveRep = currentState.fsm.phase !== 'IDLE' && currentState.fsm.phase !== 'STANDING';
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(keypoints);

  const rawAngles = calculateSquatAngles(keypoints, visibleSide);
  if (!rawAngles) {
    return { ...currentState, visibleSide };
  }

  const { smoothed, fast } = applySmoothing(rawAngles, currentState.angleHistory, currentState.smoothed);

  const newState: SquatState = {
    ...currentState,
    smoothed,
    fast,
    visibleSide,
  };

  // Use the fast (median-only) ratio for FSM decisions: it tracks extremes within ~1-2
  // frames, whereas the EMA-smoothed value lags by ~250ms and can miss brief peaks.
  if (isNaN(fast.kneeRatio)) {
    return newState;
  }

  if (currentState.fsm.phase === 'IDLE' || currentState.fsm.phase === 'STANDING') {
    newState.standingKneeRatioPeak = Math.max(
      currentState.standingKneeRatioPeak,
      fast.kneeRatio
    );
  }

  // Update FSM — uses fast (median-only) ratio to avoid smoothing-induced misses
  const fsmResult = updateFSM(currentState.fsm, fast.kneeRatio, t, fast.torsoLean);
  newState.fsm = fsmResult.fsm;

  // Handle partial rep — provide feedback, but do not increment the rep count.
  // Shallow pulses should not be treated as completed squat reps.
  if (fsmResult.partialRep) {
    const partialROM = newState.repWindow
      ? newState.repWindow.maxKneeRatio - newState.repWindow.minKneeRatio
      : 0;
    const partialFrames = newState.repWindow?.frameCount ?? 0;

    if (partialROM >= THRESHOLDS.MIN_PARTIAL_ROM && partialFrames >= THRESHOLDS.MIN_REP_FRAMES) {
      const messages = ['Squat deeper \u2014 aim to get your thighs parallel.'];
      newState.feedback = messages[0];
      newState.lastFeedbackTime = t;
    }
    // Either way, reset the rep window and let FSM return to STANDING
    newState.repWindow = null;
    newState.standingKneeRatioPeak = fast.kneeRatio;
    return newState;
  }

  // Track rep window while actively in a rep
  const inRep = newState.fsm.phase !== 'STANDING' && newState.fsm.phase !== 'IDLE';
  if (inRep && !currentState.repWindow) {
    const standingRatio = isFinite(currentState.standingKneeRatioPeak)
      ? currentState.standingKneeRatioPeak
      : currentState.fast?.kneeRatio;
    newState.repWindow = initRepWindow(
      newState.fsm.tRepStart ?? t,
      standingRatio !== undefined && !isNaN(standingRatio) ? standingRatio : fast.kneeRatio
    );
    newState.standingKneeRatioPeak = -Infinity;
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    if (!isNaN(fast.kneeRatio)) {
      window.minKneeRatio = Math.min(window.minKneeRatio, fast.kneeRatio);
      window.maxKneeRatio = Math.max(window.maxKneeRatio, fast.kneeRatio);
    }
    if (!isNaN(smoothed.torsoLean)) {
      // Only update max torso lean when shoulder+hip are detected with sufficient
      // confidence to avoid noise-spike false positives from low-confidence frames.
      const torsoConf = minKeypointConfidence(keypoints, [`${visibleSide}_shoulder`, `${visibleSide}_hip`]);
      if (torsoConf >= 0.3) {
        window.maxTorsoLean = Math.max(window.maxTorsoLean, smoothed.torsoLean);
      }
    }

    // Set tBottom as soon as depth is reached so tempo reflects the full descent
    // and the whole ascent, rather than starting the ascent clock after bottom exit.
    if (
      currentState.fsm.phase === 'DESCENDING' &&
      newState.fsm.phase === 'BOTTOM' &&
      window.tBottom === null
    ) {
      window.tBottom = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    const romRatio = newState.repWindow.maxKneeRatio - newState.repWindow.minKneeRatio;

    // Validate: require minimum ROM and frame count to prevent noise-driven reps
    if (romRatio < THRESHOLDS.MIN_REP_ROM || newState.repWindow.frameCount < THRESHOLDS.MIN_REP_FRAMES) {
      newState.repWindow = null;
      newState.fsm = resetFSMToStanding();
      newState.standingKneeRatioPeak = fast.kneeRatio;
      return newState;
    }

    newState.repCount++;

    const tDown = newState.repWindow.tBottom
      ? newState.repWindow.tBottom - newState.repWindow.tStart
      : 0;
    const tUp = newState.repWindow.tBottom
      ? newState.repWindow.tEnd - newState.repWindow.tBottom
      : 0;

    const { score, messages } = evaluateForm(newState.repWindow);

    newState.lastRepResult = {
      repIndex: newState.repCount,
      romRatio,
      tDown,
      tUp,
      score,
      messages,
    };

    if (messages.length > 0) {
      newState.feedback = messages.join('\n');
    } else {
      newState.feedback = 'Great rep!';
    }
    newState.lastFeedbackTime = t;

    newState.repWindow = null;
    newState.fsm = resetFSMToStanding();
    newState.standingKneeRatioPeak = fast.kneeRatio;
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

function getSquatDebugInfo(state: SquatState): SquatDebugInfo {
  const angles = state.smoothed;
  const repWin = state.repWindow;
  const fmt = (v: number | undefined): number | null =>
    v !== undefined && !isNaN(v) && isFinite(v) ? v : null;

  return {
    phase: state.fsm.phase,
    side: state.visibleSide,
    knee: fmt(angles?.knee),
    kneeRatio: fmt(angles?.kneeRatio),
    fastKneeRatio: fmt(state.fast?.kneeRatio),
    torsoLean: fmt(angles?.torsoLean),
    hipAngle: fmt(angles?.hipAngle),
    kneeRatioMin: repWin && repWin.minKneeRatio !== Infinity ? fmt(repWin.minKneeRatio) : null,
    kneeRatioMax: repWin && repWin.maxKneeRatio !== -Infinity ? fmt(repWin.maxKneeRatio) : null,
    maxTorsoLean: repWin && repWin.maxTorsoLean !== -Infinity ? fmt(repWin.maxTorsoLean) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createSquatDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_SQUAT_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Barbell Squat',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: withSquatConfig(config, () => initializeSquatState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as SquatState;
    const newInternal = withSquatConfig(config, () => updateSquatState(keypoints, internal));

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
      debugInfo: getSquatDebugInfo(newInternal) as unknown as Record<string, unknown>,
      _internal: newInternal,
    };
  },

  heuristicConfig: config,
  tunableSpec: SQUAT_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/squat.json',
  createVariant: (variantConfig) =>
    createSquatDefinition(mergeHeuristicConfig(config, variantConfig)),

  ttsConfig: {
    feedbackToIssue: {
      'Squat deeper \u2014 aim to get your thighs parallel.': 'depth_short',
      'Try to go a little deeper for full range of motion.': 'depth_short',
      'Stand all the way up \u2014 fully extend your knees.': 'lockout_short',
      'Incomplete rep \u2014 use a full range of motion.': 'incomplete_rom',
      'Too much forward lean \u2014 keep your chest up.': 'torso_fail',
      'Stay more upright \u2014 brace your core.': 'torso_warn',
      'Control the ascent \u2014 don\'t bounce out of the hole.': 'tempo_up',
      'Slow the descent \u2014 control the weight down.': 'tempo_down',
    },
    // All issue types reused from existing pools — no new definitions needed
  },

  summaryConfig: {
    'Squat deeper \u2014 aim to get your thighs parallel.':
      'Focus on hip mobility and ankle flexibility to achieve parallel depth. Try box squats to build confidence at depth.',
    'Try to go a little deeper for full range of motion.':
      'You\'re close to parallel \u2014 work on ankle mobility and try paused squats to build strength at the bottom.',
    'Stand all the way up \u2014 fully extend your knees.':
      'Fully lock out at the top of each rep to complete the range of motion.',
    'Incomplete rep \u2014 use a full range of motion.':
      'Achieve complete range of motion from standing to at least parallel.',
    'Too much forward lean \u2014 keep your chest up.':
      'Excessive forward lean shifts load to your lower back. Strengthen your upper back and core, and check ankle mobility.',
    'Stay more upright \u2014 brace your core.':
      'Take a deep breath and brace your core before each rep. Think about driving your chest up as you ascend.',
    'Control the ascent \u2014 don\'t bounce out of the hole.':
      'Drive up with control \u2014 bouncing at the bottom puts extra stress on your knees.',
    'Slow the descent \u2014 control the weight down.':
      'Aim for a 2-3 second descent. Controlled eccentrics build more strength and protect your joints.',
  },
  };
}

export const squatDefinition: ExerciseDefinition = createSquatDefinition();
