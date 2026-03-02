/**
 * Cable Pushdowns -- Exercise Definition
 *
 * Side view, elbow angle as primary driver.
 * FSM: REST -> EXTENDING -> EXTENDED -> RETURNING -> REST
 * Arms start bent (~70-100deg), push down to near-full extension (~160-170deg),
 * then return. One rep = full push-down + controlled return.
 *
 * The only export is `cablePushdownDefinition`.
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

/** FSM thresholds (degrees) */
const THRESHOLDS = {
  /** Elbow angle above which we transition REST -> EXTENDING */
  EXTENDING_ENTER: 100,
  /** Elbow angle above which we consider near-full extension (EXTENDING -> EXTENDED) */
  EXTENDED_ENTER: 155,
  /** Elbow angle below which we leave EXTENDED (hysteresis) (EXTENDED -> RETURNING) */
  EXTENDED_EXIT: 150,
  /** Elbow angle below which the return is complete (RETURNING -> REST) */
  REST_REENTER: 100,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.5,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Max elbow angle below which extension is insufficient */
  EXTENSION_FAIL: 155,
  /** Min elbow angle above which starting flexion is insufficient */
  FLEXION_FAIL: 95,
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
 * | Category             | Cap | Deadzone        | Scale | Key Input                         |
 * |----------------------|-----|-----------------|-------|-----------------------------------|
 * | ROM extension        | 30  | 160 (maxElbow)  | 0.06  | ideal extension - max elbow       |
 * | ROM flexion          | 20  | 90 (minElbow)   | 0.04  | min elbow - ideal start angle     |
 * | Elbow drift          | 25  | 10              | 0.03  | max shoulder angle delta          |
 * | Torso lean           | 25  | 5               | 0.15  | max torso deviation from vertical |
 * | Tempo push           | 12  | 0.3s            | 60    | concentric time deficit           |
 * | Tempo return         | 8   | 0.4s            | 40    | eccentric time deficit            |
 *
 * Max total penalty: 120 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  EXTENSION_ROM: { cap: 30, deadzone: 0, scale: 0.06 } as PenaltyConfig,
  FLEXION_ROM:   { cap: 20, deadzone: 0, scale: 0.04 } as PenaltyConfig,
  ELBOW_DRIFT:   { cap: 25, deadzone: 15, scale: 0.03 } as PenaltyConfig,
  TORSO_LEAN:    { cap: 25, deadzone: 5, scale: 0.15 } as PenaltyConfig,
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
  /** Timestamp when full extension was reached */
  tExtended: number | null;
  /** Timestamp when rep completed (RETURNING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min elbow angle during rep (should be low -- bent position at start/end) */
  minElbow: number;
  /** Max elbow angle during rep (should be high -- extended at bottom) */
  maxElbow: number;
  /** Shoulder angle at rep start (baseline) */
  shoulderAngleBaseline: number | null;
  /** Max absolute shoulder angle delta from baseline during rep */
  maxShoulderDelta: number;
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

interface CablePushdownState {
  fsm: CablePushdownFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  /** Smoothed angle trackers */
  elbowTracker: SmoothedAngleTracker;
  shoulderTracker: SmoothedAngleTracker;
  torsoTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Current smoothed angles for debug */
  smoothedElbow: number | null;
  smoothedShoulder: number | null;
  smoothedTorso: number | null;
  /** Feedback */
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
  /** Minimum smoothed elbow angle observed during REST phase (pre-seeds rep window) */
  restMinElbow: number;
}

interface CablePushdownDebugInfo {
  phase: CablePushdownPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  elbow: number | null;
  shoulderAngle: number | null;
  torsoDev: number | null;
  // Rep window
  elbowMin: number | null;
  elbowMax: number | null;
  shoulderDelta: number | null;
  torsoDevMax: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): CablePushdownFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tExtended: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number): RepWindow {
  return {
    minElbow: Infinity,
    maxElbow: -Infinity,
    shoulderAngleBaseline: null,
    maxShoulderDelta: 0,
    maxTorsoDev: 0,
    tStart,
    tExtended: null,
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
    elbowTracker: new SmoothedAngleTracker(),
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
    smoothedElbow: null,
    smoothedShoulder: null,
    smoothedTorso: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
    restMinElbow: Infinity,
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
// ANGLE CALCULATION
// ============================================================================

type Point2D = { x: number; y: number };

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

/**
 * Calculate the elbow angle (shoulder-elbow-wrist) in 2D.
 * ~70-90deg when bent, ~160-170deg when extended.
 */
function calculateElbowAngle(
  keypoints: Keypoint[],
  side: 'left' | 'right'
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

  return calculateAngle2D(
    getPoint(shoulder)!,
    getPoint(elbow)!,
    getPoint(wrist)!
  );
}

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

  return calculateAngle2D(
    getPoint(hip)!,
    getPoint(shoulder)!,
    getPoint(elbow)!
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
  fsm: CablePushdownFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: CablePushdownFSM,
  elbowAngle: number,
  t: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Waiting for push to begin. When elbow starts extending past threshold,
      // transition to EXTENDING.
      if (elbowAngle > THRESHOLDS.EXTENDING_ENTER) {
        fsm.phase = 'EXTENDING';
        fsm.tRepStart = t;
        fsm.tExtended = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'EXTENDING':
      // Actively pushing down. When near-full extension reached, transition.
      if (elbowAngle > THRESHOLDS.EXTENDED_ENTER) {
        fsm.phase = 'EXTENDED';
        fsm.tExtended = t;
      } else if (elbowAngle < THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Went back to bent without extending -- reset
        fsm.phase = 'REST';
        fsm.tRepStart = null;
      }
      break;

    case 'EXTENDED':
      // At full extension. When elbow starts bending back (hysteresis), transition.
      if (elbowAngle < THRESHOLDS.EXTENDED_EXIT) {
        fsm.phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      // Controlled return. When elbow returns to bent position, rep is complete.
      if (
        elbowAngle < THRESHOLDS.REST_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'REST';
        fsm.tRepEnd = t;
        repCompleted = true;
      } else if (elbowAngle > THRESHOLDS.EXTENDED_ENTER) {
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

  // 1. ROM -- extension: ideal max elbow is 160+. Shortfall = max(0, 160 - maxElbow)
  const extensionShortfall = Math.max(0, 160 - repWindow.maxElbow);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 2. ROM -- flexion: ideal min elbow is 90 or below. Excess = max(0, minElbow - 90)
  const flexionExcess = Math.max(0, repWindow.minElbow - 90);
  penalties.push({ value: flexionExcess, config: PENALTY_CONFIGS.FLEXION_ROM });

  // 3. Elbow drift (shoulder angle delta)
  penalties.push({ value: repWindow.maxShoulderDelta, config: PENALTY_CONFIGS.ELBOW_DRIFT });

  // 4. Torso lean
  penalties.push({ value: repWindow.maxTorsoDev, config: PENALTY_CONFIGS.TORSO_LEAN });

  // 5. Tempo
  if (repWindow.tExtended !== null) {
    const tPush = repWindow.tExtended - repWindow.tStart;  // concentric (push down)
    const tReturn = repWindow.tEnd - repWindow.tExtended;   // eccentric (return)

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

  // 1. Extension ROM -- didn't lock out fully
  if (repWindow.maxElbow < FORM_THRESHOLDS.EXTENSION_FAIL) {
    messages.push('Extend fully \u2014 lock out at the bottom of each rep.');
  }

  // 2. Flexion ROM -- didn't bend enough at the top
  if (repWindow.minElbow > FORM_THRESHOLDS.FLEXION_FAIL) {
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
    const tReturn = repWindow.tEnd - repWindow.tExtended;

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

  // Select visible side
  const visibleSide = selectVisibleSide(keypoints);

  // Calculate raw angles
  const rawElbow = calculateElbowAngle(keypoints, visibleSide);
  const rawShoulder = calculateShoulderAngle(keypoints, visibleSide);
  const rawTorsoDev = calculateTorsoDeviation(keypoints, visibleSide);

  // If we can't even see the elbow, bail out
  if (rawElbow === null) {
    return {
      ...currentState,
      visibleSide,
      smoothedElbow: null,
      smoothedShoulder: null,
      smoothedTorso: null,
    };
  }

  // Smooth angles
  const smoothedElbow = currentState.elbowTracker.push(rawElbow);
  const smoothedShoulder = rawShoulder !== null
    ? currentState.shoulderTracker.push(rawShoulder)
    : currentState.shoulderTracker.value;
  const smoothedTorso = rawTorsoDev !== null
    ? currentState.torsoTracker.push(rawTorsoDev)
    : currentState.torsoTracker.value;

  const newState: CablePushdownState = {
    ...currentState,
    visibleSide,
    smoothedElbow,
    smoothedShoulder: isNaN(smoothedShoulder) ? null : smoothedShoulder,
    smoothedTorso: isNaN(smoothedTorso) ? null : smoothedTorso,
  };

  if (isNaN(smoothedElbow)) {
    return newState;
  }

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, smoothedElbow, t);
  newState.fsm = fsmResult.fsm;

  // Track minimum elbow angle during REST (captures true starting bent position)
  if (newState.fsm.phase === 'REST' && !isNaN(smoothedElbow)) {
    newState.restMinElbow = Math.min(newState.restMinElbow, smoothedElbow);
  }

  // Track rep window while actively in a rep (not REST)
  const inRep = newState.fsm.phase !== 'REST';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(t);
    // Pre-seed minElbow with the resting bent angle so flexion ROM is measured correctly
    if (currentState.restMinElbow !== Infinity) {
      newState.repWindow.minElbow = currentState.restMinElbow;
    }
    newState.restMinElbow = Infinity; // Reset for next rep
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update elbow min/max
    if (!isNaN(smoothedElbow)) {
      window.minElbow = Math.min(window.minElbow, smoothedElbow);
      window.maxElbow = Math.max(window.maxElbow, smoothedElbow);
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
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
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
    elbow: fmt(state.smoothedElbow),
    shoulderAngle: fmt(state.smoothedShoulder),
    torsoDev: fmt(state.smoothedTorso),
    elbowMin: repWin && repWin.minElbow !== Infinity ? fmt(repWin.minElbow) : null,
    elbowMax: repWin && repWin.maxElbow !== -Infinity ? fmt(repWin.maxElbow) : null,
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
