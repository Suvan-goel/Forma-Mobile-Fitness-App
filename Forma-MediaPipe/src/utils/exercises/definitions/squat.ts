/**
 * Barbell Squat Exercise Definition
 *
 * Side-view squat analysis using knee angle as the primary FSM driver.
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
  calculateAngle2D,
  calculateVerticalAngle,
  getKeypoint,
  isVisible,
} from '../../poseAnalysis';

import type {
  ExerciseDefinition,
  ExerciseState,
  RepResult as FrameworkRepResult,
} from '../types';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (degrees) */
const THRESHOLDS = {
  /** Knee angle below which we transition STANDING -> DESCENDING */
  DESCENDING_ENTER: 148,
  /** Knee angle below which we reach BOTTOM */
  BOTTOM_ENTER: 110,
  /** Knee angle above which we leave BOTTOM (hysteresis) */
  BOTTOM_EXIT: 118,
  /** Knee angle above which we transition ASCENDING -> STANDING (rep complete) */
  STANDING_REENTER: 160,
  /** Minimum time (seconds) for a rep to count */
  MIN_REP_TIME: 0.8,
  /** Partial rep: if in DESCENDING and knee returns above this without hitting BOTTOM */
  PARTIAL_REP_RESET: 150,
  /** Minimum time in DESCENDING before partial-rep reset can trigger */
  MIN_DESCENDING_TIME: 0.5,
  /** Minimum knee angle for standing detection in IDLE gate */
  IDLE_STANDING_MIN: 160,
  /** Seconds user must hold standing pose before FSM activates from IDLE */
  STANDING_HOLD_TIME: 0.8,
  /** Maximum torso inclination from vertical for standing detection (degrees) */
  TORSO_INCLINE_MAX_IDLE: 25,
  /** Minimum ROM (degrees) for a partial rep to count */
  MIN_PARTIAL_ROM: 20,
  /** Minimum ROM (degrees) for a full rep to count */
  MIN_REP_ROM: 35,
  /** Minimum frames in rep window for a rep to count */
  MIN_REP_FRAMES: 8,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  // Depth: lower knee angle = deeper squat. Parallel ~ 90 degrees.
  DEPTH_WARN: 105,   // min knee > 105 = not quite parallel
  DEPTH_FAIL: 115,   // min knee > 115 = clearly shallow
  // Lockout
  LOCKOUT_FAIL: 155,  // max knee < 155 = incomplete lockout
  // ROM
  ROM_MIN: 50,        // minimum ROM in degrees (max - min knee angle)
  // Torso lean (forward lean from vertical, via hip-shoulder vector)
  TORSO_LEAN_WARN: 50, // max torso lean > 50 degrees
  TORSO_LEAN_FAIL: 55, // max torso lean > 55 degrees
  // Tempo
  TEMPO_CONCENTRIC_MIN: 0.3,  // ascent too fast (seconds)
  TEMPO_ECCENTRIC_MIN: 0.4,   // descent too fast (seconds)
} as const;

/**
 * Continuous penalty curve parameters for rep scoring.
 * Each category: min(cap, scale * max(0, x - deadzone)^2)
 *
 * | Category          | Cap | Deadzone          | Scale | Key Input                     |
 * |-------------------|-----|-------------------|-------|-------------------------------|
 * | Depth shortfall   | 35  | 95 (minKnee)      | 0.035 | min knee angle during rep     |
 * | Lockout shortfall | 20  | 165 (maxKnee)     | 0.08  | ideal lockout - max knee      |
 * | Torso lean        | 30  | 35 (degrees)      | 0.06  | max torso forward lean        |
 * | Tempo             | 15  | up: 0.3s, dn: 0.4s| 60/40 | concentric / eccentric time   |
 *
 * Max total penalty: 100 -> worst possible rep = 0.
 */
const SCORE_CURVES = {
  DEPTH:   { deadzone: 95,  scale: 0.035, cap: 35 },
  LOCKOUT: { ideal: 165,    scale: 0.08,  cap: 20 },
  TORSO:   { deadzone: 35,  scale: 0.06,  cap: 30 },
  TEMPO_CONCENTRIC: { deadzone: 0.3, scale: 60, cap: 8 },
  TEMPO_ECCENTRIC:  { deadzone: 0.4, scale: 40, cap: 7 },
} as const;

/** Smoothing parameters */
const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.3;
const VISIBILITY_THRESHOLD = 0.1;

// ============================================================================
// TYPES (module-private)
// ============================================================================

type SquatPhase = 'IDLE' | 'STANDING' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';

interface SquatFSM {
  phase: SquatPhase;
  /** Timestamp when rep started (STANDING -> DESCENDING) */
  tRepStart: number | null;
  /** Timestamp when BOTTOM was reached */
  tBottom: number | null;
  /** Timestamp when rep completed (ASCENDING -> STANDING) */
  tRepEnd: number | null;
  /** Timestamp when user first showed valid standing pose in IDLE */
  tIdleStableSince: number | null;
}

interface SquatRepWindow {
  /** Min/max knee angle during rep */
  minKnee: number;
  maxKnee: number;
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
  torsoLean: number;
  hipAngle: number;
}

interface SmoothedSquatAngles extends SquatAngles {}

interface RepResult {
  repIndex: number;
  rom: number;
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
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
}

/** Debug info for on-screen diagnostics */
interface SquatDebugInfo {
  phase: SquatPhase;
  side: 'left' | 'right';
  knee: number | null;
  torsoLean: number | null;
  hipAngle: number | null;
  kneeMin: number | null;
  kneeMax: number | null;
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
    tBottom: null,
    tRepEnd: null,
    tIdleStableSince: null,
  };
}

function resetFSMToStanding(): SquatFSM {
  return {
    phase: 'STANDING',
    tRepStart: null,
    tBottom: null,
    tRepEnd: null,
    tIdleStableSince: null,
  };
}

function initRepWindow(tStart: number): SquatRepWindow {
  return {
    minKnee: Infinity,
    maxKnee: -Infinity,
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
      torsoLean: [],
      hipAngle: [],
    },
    smoothed: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
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

/**
 * Calculate torso forward lean: angle of the hip->shoulder vector from vertical.
 * 0 = perfectly upright, 90 = horizontal.
 * Uses midpoints when both sides are visible.
 */
function calculateTorsoLean(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): number | null {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  let shoulderX: number, shoulderY: number;
  let hipX: number, hipY: number;

  const lsVis = isVisible(ls, VISIBILITY_THRESHOLD);
  const rsVis = isVisible(rs, VISIBILITY_THRESHOLD);
  const lhVis = isVisible(lh, VISIBILITY_THRESHOLD);
  const rhVis = isVisible(rh, VISIBILITY_THRESHOLD);

  if (lsVis && rsVis) {
    shoulderX = (ls!.x + rs!.x) / 2;
    shoulderY = (ls!.y + rs!.y) / 2;
  } else {
    const s = getKeypoint(keypoints, `${side}_shoulder`);
    if (!s || !isVisible(s, VISIBILITY_THRESHOLD)) return null;
    shoulderX = s.x;
    shoulderY = s.y;
  }

  if (lhVis && rhVis) {
    hipX = (lh!.x + rh!.x) / 2;
    hipY = (lh!.y + rh!.y) / 2;
  } else {
    const h = getKeypoint(keypoints, `${side}_hip`);
    if (!h || !isVisible(h, VISIBILITY_THRESHOLD)) return null;
    hipX = h.x;
    hipY = h.y;
  }

  // Vector from hip to shoulder
  const dx = shoulderX - hipX;
  const dy = shoulderY - hipY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-8) return null;

  // Angle from vertical (Y-up in screen coords means Y points down)
  // Vertical vector is (0, -1) in screen coords (up)
  // cos(theta) = dot((dx,dy), (0,-1)) / len = -dy / len
  const cosTheta = -dy / len;
  return Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180 / Math.PI);
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

  // Knee angle (hip-knee-ankle): 180 = fully extended, ~90 = parallel squat
  const kneeAngle = calculateAngle2D(
    getPoint(hip)!,
    getPoint(knee)!,
    getPoint(ankle)!
  );

  // Hip angle (shoulder-hip-knee): indicates hip hinge depth
  let hipAngle = 180;
  if (shoulder && isVisible(shoulder, VISIBILITY_THRESHOLD)) {
    hipAngle = calculateAngle2D(
      getPoint(shoulder)!,
      getPoint(hip)!,
      getPoint(knee)!
    );
  }

  // Torso forward lean from vertical
  const torsoLean = calculateTorsoLean(keypoints, side);

  return {
    knee: kneeAngle,
    torsoLean: torsoLean ?? 0,
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
): SmoothedSquatAngles {
  const keys: (keyof SquatAngles)[] = ['knee', 'torsoLean', 'hipAngle'];
  const result: Partial<SmoothedSquatAngles> = {};

  for (const key of keys) {
    const value = rawAngles[key];
    if (isNaN(value)) {
      result[key] = prevSmoothed?.[key] ?? NaN;
      continue;
    }

    history[key].push(value);
    if (history[key].length > MEDIAN_WINDOW) {
      history[key].shift();
    }

    const medianValue = median(history[key]);
    const prev = prevSmoothed?.[key];
    result[key] =
      prev !== undefined && !isNaN(prev)
        ? EMA_ALPHA * medianValue + (1 - EMA_ALPHA) * prev
        : medianValue;
  }

  return result as SmoothedSquatAngles;
}

// ============================================================================
// FSM LOGIC
// ============================================================================

function updateFSM(
  currentFSM: SquatFSM,
  kneeAngle: number,
  t: number,
  torsoLean: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;
  let partialRep = false;

  switch (fsm.phase) {
    case 'IDLE': {
      const legsExtended = kneeAngle > THRESHOLDS.IDLE_STANDING_MIN;
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
      if (kneeAngle < THRESHOLDS.DESCENDING_ENTER) {
        fsm.phase = 'DESCENDING';
        fsm.tRepStart = t;
        fsm.tBottom = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'DESCENDING':
      if (kneeAngle < THRESHOLDS.BOTTOM_ENTER) {
        fsm.phase = 'BOTTOM';
        fsm.tBottom = t;
      } else if (
        kneeAngle > THRESHOLDS.PARTIAL_REP_RESET &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_DESCENDING_TIME
      ) {
        // Returned to standing without reaching depth -- partial rep
        fsm.phase = 'STANDING';
        partialRep = true;
        fsm.tRepStart = null;
      }
      break;

    case 'BOTTOM':
      if (kneeAngle > THRESHOLDS.BOTTOM_EXIT) {
        fsm.phase = 'ASCENDING';
      }
      break;

    case 'ASCENDING':
      if (
        kneeAngle > THRESHOLDS.STANDING_REENTER &&
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

  // 1. Depth shortfall -- lower minKnee is better (closer to 90 = parallel)
  const depthExcess = Math.max(0, repWindow.minKnee - SCORE_CURVES.DEPTH.deadzone);
  penalty += Math.min(SCORE_CURVES.DEPTH.cap, SCORE_CURVES.DEPTH.scale * depthExcess * depthExcess);

  // 2. Lockout shortfall -- higher maxKnee is better (closer to 170+)
  const lockoutShortfall = Math.max(0, SCORE_CURVES.LOCKOUT.ideal - repWindow.maxKnee);
  penalty += Math.min(SCORE_CURVES.LOCKOUT.cap, SCORE_CURVES.LOCKOUT.scale * lockoutShortfall * lockoutShortfall);

  // 3. Torso forward lean -- some lean is natural for squats (deadzone 35)
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

  // 1. Depth
  if (repWindow.minKnee > FORM_THRESHOLDS.DEPTH_FAIL) {
    messages.push('Squat deeper \u2014 aim to get your thighs parallel.');
  } else if (repWindow.minKnee > FORM_THRESHOLDS.DEPTH_WARN) {
    messages.push('Try to go a little deeper for full range of motion.');
  }

  // 2. Lockout
  if (repWindow.maxKnee < FORM_THRESHOLDS.LOCKOUT_FAIL) {
    messages.push('Stand all the way up \u2014 fully extend your knees.');
  }

  // 3. ROM
  const rom = repWindow.maxKnee - repWindow.minKnee;
  if (rom < FORM_THRESHOLDS.ROM_MIN && messages.length === 0) {
    messages.push('Incomplete rep \u2014 use a full range of motion.');
  }

  // 4. Torso lean
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

  const smoothed = applySmoothing(rawAngles, currentState.angleHistory, currentState.smoothed);

  const newState: SquatState = {
    ...currentState,
    smoothed,
    visibleSide,
  };

  if (isNaN(smoothed.knee)) {
    return newState;
  }

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, smoothed.knee, t, smoothed.torsoLean);
  newState.fsm = fsmResult.fsm;

  // Handle partial rep — only count if meaningful ROM was achieved
  if (fsmResult.partialRep) {
    const partialROM = newState.repWindow
      ? newState.repWindow.maxKnee - newState.repWindow.minKnee
      : 0;
    const partialFrames = newState.repWindow?.frameCount ?? 0;

    if (partialROM >= THRESHOLDS.MIN_PARTIAL_ROM && partialFrames >= THRESHOLDS.MIN_REP_FRAMES) {
      newState.repCount++;
      const messages = ['Squat deeper \u2014 aim to get your thighs parallel.'];
      // Score partial reps low (30-45 range) based on how much ROM was achieved
      const score = Math.max(0, Math.min(45, Math.round(15 + partialROM * 0.75)));
      newState.lastRepResult = {
        repIndex: newState.repCount,
        rom: partialROM,
        tDown: 0,
        tUp: 0,
        score,
        messages,
      };
      newState.feedback = messages[0];
      newState.lastFeedbackTime = t;
    }
    // Either way, reset the rep window and let FSM return to STANDING
    newState.repWindow = null;
    return newState;
  }

  // Track rep window while actively in a rep
  const inRep = newState.fsm.phase !== 'STANDING' && newState.fsm.phase !== 'IDLE';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(t);
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    if (!isNaN(smoothed.knee)) {
      window.minKnee = Math.min(window.minKnee, smoothed.knee);
      window.maxKnee = Math.max(window.maxKnee, smoothed.knee);
    }
    if (!isNaN(smoothed.torsoLean)) {
      window.maxTorsoLean = Math.max(window.maxTorsoLean, smoothed.torsoLean);
    }

    if (newState.fsm.phase === 'BOTTOM' && window.tBottom === null) {
      window.tBottom = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    const rom = newState.repWindow.maxKnee - newState.repWindow.minKnee;

    // Validate: require minimum ROM and frame count to prevent noise-driven reps
    if (rom < THRESHOLDS.MIN_REP_ROM || newState.repWindow.frameCount < THRESHOLDS.MIN_REP_FRAMES) {
      newState.repWindow = null;
      newState.fsm = resetFSMToStanding();
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
      rom,
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
    torsoLean: fmt(angles?.torsoLean),
    hipAngle: fmt(angles?.hipAngle),
    kneeMin: repWin && repWin.minKnee !== Infinity ? fmt(repWin.minKnee) : null,
    kneeMax: repWin && repWin.maxKnee !== -Infinity ? fmt(repWin.maxKnee) : null,
    maxTorsoLean: repWin && repWin.maxTorsoLean !== -Infinity ? fmt(repWin.maxTorsoLean) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export const squatDefinition: ExerciseDefinition = {
  name: 'Barbell Squat',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: initializeSquatState(),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as SquatState;
    const newInternal = updateSquatState(keypoints, internal);

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
