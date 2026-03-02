/**
 * Leg Extensions -- Exercise Definition
 *
 * Side view, knee angle as primary driver.
 * FSM: REST -> EXTENDING -> EXTENDED -> RETURNING -> REST
 * Legs start bent (~80-100deg at the knee), extend to near-full extension (~160-175deg),
 * then return. One rep = full extension + controlled return.
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

/** FSM thresholds (degrees) -- knee angle */
const THRESHOLDS = {
  /** Knee angle above which we transition REST -> EXTENDING */
  EXTENDING_ENTER: 105,
  /** Knee angle above which we consider near-full extension (EXTENDING -> EXTENDED) */
  EXTENDED_ENTER: 155,
  /** Knee angle below which we leave EXTENDED (hysteresis) (EXTENDED -> RETURNING) */
  EXTENDED_EXIT: 150,
  /** Knee angle below which the return is complete (RETURNING -> REST) */
  REST_REENTER: 105,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Max knee angle below which extension is insufficient */
  EXTENSION_FAIL: 155,
  /** Min knee angle above which starting flexion is insufficient */
  FLEXION_FAIL: 100,
  /** Torso deviation from vertical above which there is excessive lean */
  TORSO_LEAN_WARN: 15,
  /** Hip angle change that indicates lifting hips off the seat */
  HIP_LIFT_WARN: 18,
  /** Concentric (extend) too fast threshold (seconds) */
  TEMPO_EXTEND_MIN: 0.3,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.4,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category             | Cap | Deadzone        | Scale | Key Input                          |
 * |----------------------|-----|-----------------|-------|------------------------------------|
 * | ROM extension        | 30  | 0 (shortfall)   | 0.05  | ideal extension - max knee angle   |
 * | ROM flexion          | 20  | 0 (excess)      | 0.04  | min knee - ideal start angle       |
 * | Torso lean           | 25  | 8               | 0.12  | max torso deviation from vertical  |
 * | Hip lift             | 25  | 10              | 0.08  | max hip angle delta from baseline  |
 * | Tempo extend         | 12  | 0.4s            | 60    | concentric time deficit            |
 * | Tempo return         | 10  | 0.5s            | 40    | eccentric time deficit             |
 *
 * Max total penalty: 122 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  EXTENSION_ROM: { cap: 30, deadzone: 0, scale: 0.05 } as PenaltyConfig,
  FLEXION_ROM:   { cap: 20, deadzone: 0, scale: 0.04 } as PenaltyConfig,
  TORSO_LEAN:    { cap: 25, deadzone: 8, scale: 0.12 } as PenaltyConfig,
  HIP_LIFT:      { cap: 25, deadzone: 10, scale: 0.08 } as PenaltyConfig,
  TEMPO_EXTEND:  { cap: 12, deadzone: 0.4, scale: 60 } as PenaltyConfig,
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
  /** Timestamp when full extension was reached */
  tExtended: number | null;
  /** Timestamp when rep completed (RETURNING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min knee angle during rep (should be low -- bent position at start/end) */
  minKnee: number;
  /** Max knee angle during rep (should be high -- extended) */
  maxKnee: number;
  /** Hip angle at rep start (baseline) */
  hipAngleBaseline: number | null;
  /** Max absolute hip angle delta from baseline during rep */
  maxHipDelta: number;
  /** Max absolute torso deviation from vertical during rep */
  maxTorsoDev: number;
  /** Timestamps */
  tStart: number;
  tExtended: number | null;
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
  /** Smoothed angle trackers */
  kneeTracker: SmoothedAngleTracker;
  hipTracker: SmoothedAngleTracker;
  torsoTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Current smoothed angles for debug */
  smoothedKnee: number | null;
  smoothedHip: number | null;
  smoothedTorso: number | null;
  /** Feedback */
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
}

interface LegExtensionDebugInfo {
  phase: LegExtensionPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  knee: number | null;
  hipAngle: number | null;
  torsoDev: number | null;
  // Rep window
  kneeMin: number | null;
  kneeMax: number | null;
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
    tExtended: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number): RepWindow {
  return {
    minKnee: Infinity,
    maxKnee: -Infinity,
    hipAngleBaseline: null,
    maxHipDelta: 0,
    maxTorsoDev: 0,
    tStart,
    tExtended: null,
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
    kneeTracker: new SmoothedAngleTracker(),
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
    smoothedKnee: null,
    smoothedHip: null,
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
// ANGLE CALCULATION
// ============================================================================

type Point2D = { x: number; y: number };

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

/**
 * Calculate the knee angle (hip-knee-ankle) in 2D.
 * ~80-100deg when bent (seated start), ~160-175deg when fully extended.
 */
function calculateKneeAngle(
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

  return calculateAngle2D(
    getPoint(hip)!,
    getPoint(knee)!,
    getPoint(ankle)!
  );
}

/**
 * Calculate the hip angle (shoulder-hip-knee) in 2D.
 * Measures how much the torso-thigh angle deviates — if the user lifts
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
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: LegExtensionFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: LegExtensionFSM,
  kneeAngle: number,
  t: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Waiting for extension to begin. When knee starts extending past threshold,
      // transition to EXTENDING.
      if (kneeAngle > THRESHOLDS.EXTENDING_ENTER) {
        fsm.phase = 'EXTENDING';
        fsm.tRepStart = t;
        fsm.tExtended = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'EXTENDING':
      // Actively extending. When near-full extension reached, transition.
      if (kneeAngle > THRESHOLDS.EXTENDED_ENTER) {
        fsm.phase = 'EXTENDED';
        fsm.tExtended = t;
      } else if (kneeAngle < THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Went back to bent without extending -- reset
        fsm.phase = 'REST';
        fsm.tRepStart = null;
      }
      break;

    case 'EXTENDED':
      // At full extension. When knee starts bending back (hysteresis), transition.
      if (kneeAngle < THRESHOLDS.EXTENDED_EXIT) {
        fsm.phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      // Controlled return. When knee returns to bent position, rep is complete.
      if (
        kneeAngle < THRESHOLDS.REST_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'REST';
        fsm.tRepEnd = t;
        repCompleted = true;
      } else if (kneeAngle > THRESHOLDS.EXTENDED_ENTER) {
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

  // 1. ROM -- extension: ideal max knee is 165+. Shortfall = max(0, 165 - maxKnee)
  const extensionShortfall = Math.max(0, 165 - repWindow.maxKnee);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 2. ROM -- flexion: ideal min knee is 95 or below. Excess = max(0, minKnee - 95)
  const flexionExcess = Math.max(0, repWindow.minKnee - 95);
  penalties.push({ value: flexionExcess, config: PENALTY_CONFIGS.FLEXION_ROM });

  // 3. Torso lean
  penalties.push({ value: repWindow.maxTorsoDev, config: PENALTY_CONFIGS.TORSO_LEAN });

  // 4. Hip lift (hip angle delta from baseline)
  penalties.push({ value: repWindow.maxHipDelta, config: PENALTY_CONFIGS.HIP_LIFT });

  // 5. Tempo
  if (repWindow.tExtended !== null) {
    const tExtend = repWindow.tExtended - repWindow.tStart;  // concentric (extend)
    const tReturn = repWindow.tEnd - repWindow.tExtended;     // eccentric (return)

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
  if (repWindow.maxKnee < FORM_THRESHOLDS.EXTENSION_FAIL) {
    messages.push('Extend fully \u2014 straighten your legs completely at the top.');
  }

  // 2. Flexion ROM -- didn't bend enough at the bottom
  if (repWindow.minKnee > FORM_THRESHOLDS.FLEXION_FAIL) {
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
    const tReturn = repWindow.tEnd - repWindow.tExtended;

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

  // Select visible side
  const visibleSide = selectVisibleSide(keypoints);

  // Calculate raw angles
  const rawKnee = calculateKneeAngle(keypoints, visibleSide);
  const rawHip = calculateHipAngle(keypoints, visibleSide);
  const rawTorsoDev = calculateTorsoDeviation(keypoints, visibleSide);

  // If we can't even see the knee, bail out
  if (rawKnee === null) {
    return {
      ...currentState,
      visibleSide,
      smoothedKnee: null,
      smoothedHip: null,
      smoothedTorso: null,
    };
  }

  // Smooth angles
  const smoothedKnee = currentState.kneeTracker.push(rawKnee);
  const smoothedHip = rawHip !== null
    ? currentState.hipTracker.push(rawHip)
    : currentState.hipTracker.value;
  const smoothedTorso = rawTorsoDev !== null
    ? currentState.torsoTracker.push(rawTorsoDev)
    : currentState.torsoTracker.value;

  const newState: LegExtensionState = {
    ...currentState,
    visibleSide,
    smoothedKnee,
    smoothedHip: isNaN(smoothedHip) ? null : smoothedHip,
    smoothedTorso: isNaN(smoothedTorso) ? null : smoothedTorso,
  };

  if (isNaN(smoothedKnee)) {
    return newState;
  }

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, smoothedKnee, t);
  newState.fsm = fsmResult.fsm;

  // Track rep window while actively in a rep (not REST)
  const inRep = newState.fsm.phase !== 'REST';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(t);
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update knee min/max
    if (!isNaN(smoothedKnee)) {
      window.minKnee = Math.min(window.minKnee, smoothedKnee);
      window.maxKnee = Math.max(window.maxKnee, smoothedKnee);
    }

    // Track hip angle delta from baseline
    if (!isNaN(smoothedHip)) {
      if (window.hipAngleBaseline === null) {
        window.hipAngleBaseline = smoothedHip;
      }
      const delta = Math.abs(smoothedHip - window.hipAngleBaseline);
      window.maxHipDelta = Math.max(window.maxHipDelta, delta);
    }

    // Track torso deviation
    if (!isNaN(smoothedTorso)) {
      window.maxTorsoDev = Math.max(window.maxTorsoDev, smoothedTorso);
    }

    // Record extended timestamp
    if (newState.fsm.phase === 'EXTENDED' && window.tExtended === null) {
      window.tExtended = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
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
    knee: fmt(state.smoothedKnee),
    hipAngle: fmt(state.smoothedHip),
    torsoDev: fmt(state.smoothedTorso),
    kneeMin: repWin && repWin.minKnee !== Infinity ? fmt(repWin.minKnee) : null,
    kneeMax: repWin && repWin.maxKnee !== -Infinity ? fmt(repWin.maxKnee) : null,
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
