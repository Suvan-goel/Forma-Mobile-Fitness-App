/**
 * Machine Ab Crunches — Exercise Definition
 *
 * Side view, torso flexion angle as primary driver.
 * User sits in a machine ab crunch and curls their torso forward.
 * FSM: REST -> CRUNCHING -> BOTTOM -> RETURNING -> REST
 *
 * Starting position: torso near upright (~160-175° hip angle).
 * Crunch: flex forward, bringing shoulders toward hips (~90-120° hip angle).
 * One rep = full crunch down + controlled return to upright.
 *
 * Primary angle: hip angle (shoulder-hip-knee) — decreases during crunch.
 * Form checks: ROM (crunch depth + full extension), tempo, neck position.
 *
 * The only export is `machineAbCrunchDefinition`.
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
import {
  createDefaultTunableSpec,
  mergeHeuristicConfig,
  runWithConfigBindings,
} from '../heuristicConfig';
import tunedConfig from './tuned/machineAbCrunch.json';

import type {
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  ExerciseState,
  RepResult as FrameworkRepResult,
} from '../types';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (degrees — hip angle: shoulder-hip-knee) */
const THRESHOLDS = {
  /** Hip angle below which the crunch clock starts before the FSM commits */
  CRUNCH_CLOCK_START: 128,
  /** Hip angle below which we transition REST -> CRUNCHING */
  CRUNCHING_ENTER: 112,
  /** Hip angle below which we consider bottom position (CRUNCHING -> BOTTOM) */
  BOTTOM_ENTER: 105,
  /** Hip angle above which we leave BOTTOM (hysteresis) (BOTTOM -> RETURNING) */
  BOTTOM_EXIT: 110,
  /** Hip angle above which CRUNCHING aborts (must be higher than REST_REENTER) */
  CRUNCHING_EXIT: 117,
  /** Hip angle above which the return is complete (RETURNING -> REST) */
  REST_REENTER: 114,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.5,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min hip angle above which crunch is too shallow */
  CRUNCH_ROM_FAIL: 125,
  /** Max hip angle below which extension is incomplete */
  EXTENSION_ROM_FAIL: 114,
  /** Concentric (crunch down) too fast threshold (seconds) */
  TEMPO_CRUNCH_MIN: 0.25,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.4,
  /** Neck forward deviation threshold (degrees) — neck shouldn't jut forward */
  NECK_FORWARD_WARN: 45,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category         | Cap | Deadzone         | Scale | Key Input                              |
 * |------------------|-----|------------------|-------|----------------------------------------|
 * | ROM crunch       | 30  | 0 (from ideal)   | 0.04  | min hip angle shortfall from 106       |
 * | ROM extension    | 50  | 0 (from ideal)   | 0.12  | max hip angle shortfall from 122       |
 * | Tempo crunch     | 40  | 0.27s            | 3000  | concentric time deficit                |
 * | Tempo return     | 15  | 0.5s             | 40    | eccentric time deficit                 |
 * | Neck forward     | 5   | 40°              | 0.01  | neck forward angle deviation           |
 *
 * Max total penalty: 140 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  CRUNCH_ROM:    { cap: 30, deadzone: 0, scale: 0.04 } as PenaltyConfig,
  EXTENSION_ROM: { cap: 50, deadzone: 0, scale: 0.12 } as PenaltyConfig,
  TEMPO_CRUNCH:  { cap: 40, deadzone: 0.27, scale: 3000 } as PenaltyConfig,
  TEMPO_RETURN:  { cap: 15, deadzone: 0.5, scale: 40 } as PenaltyConfig,
  NECK_FORWARD:  { cap: 5, deadzone: 40, scale: 0.01 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;

const DEFAULT_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG,
  tunedConfig,
);

const MACHINE_AB_CRUNCH_TUNABLE_SPEC = createDefaultTunableSpec(
  'Machine Ab Crunches',
  DEFAULT_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG,
);

const MACHINE_AB_CRUNCH_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withMachineAbCrunchConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, MACHINE_AB_CRUNCH_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type AbCrunchPhase = 'REST' | 'CRUNCHING' | 'BOTTOM' | 'RETURNING';

interface RepWindow {
  tStart: number;
  tBottom: number | null;
  tReturnStart: number | null;
  tEnd: number;
  /** Min hip angle during rep (lower = deeper crunch) */
  minHipAngle: number;
  /** Max hip angle during rep (higher = fuller extension) */
  maxHipAngle: number;
  /** Max neck forward deviation during rep */
  maxNeckForward: number;
  frameCount: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
}

interface AbCrunchState {
  phase: AbCrunchPhase;
  repCount: number;
  tRepStart: number | null;
  tCrunchStart: number | null;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  /** Smoothed angle trackers */
  hipAngleTracker: SmoothedAngleTracker;
  neckAngleTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Max hip angle observed during REST (pre-crunch extension) */
  restMaxHipAngle: number;
  /** Current smoothed values (for debug) */
  smoothedHipAngle: number;
  fastHipAngle: number;
  smoothedNeckAngle: number;
  /** Visual feedback */
  feedback: string | null;
  lastFeedbackTime: number;
}

interface AbCrunchDebugInfo {
  phase: AbCrunchPhase;
  warmedUp: boolean;
  hipAngle: number | null;
  fastHipAngle: number | null;
  neckAngle: number | null;
  minHipAngle: number | null;
  maxHipAngle: number | null;
  maxNeckForward: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializeState(): AbCrunchState {
  return {
    phase: 'REST',
    repCount: 0,
    tRepStart: null,
    tCrunchStart: null,
    repWindow: null,
    lastRepResult: null,
    hipAngleTracker: new SmoothedAngleTracker(),
    neckAngleTracker: new SmoothedAngleTracker(),
    warmupGate: new WarmupGate({
      requiredJoints: [
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
      ],
      requiredFrames: 10,
      visibilityThreshold: 0.2,
    }),
    warmedUp: false,
    restMaxHipAngle: -Infinity,
    smoothedHipAngle: 170,
    fastHipAngle: 170,
    smoothedNeckAngle: 0,
    feedback: null,
    lastFeedbackTime: 0,
  };
}

function initRepWindow(tStart: number): RepWindow {
  return {
    tStart,
    tBottom: null,
    tReturnStart: null,
    tEnd: tStart,
    minHipAngle: Infinity,
    maxHipAngle: -Infinity,
    maxNeckForward: 0,
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
 * Compute hip angle (shoulder-hip-knee) in 2D.
 * Upright seated: ~160-175°. Crunched forward: ~90-120°.
 * Uses the more visible side (higher average score).
 */
function computeHipAngle(keypoints: Keypoint[]): number | null {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');
  const lk = getKeypoint(keypoints, 'left_knee');
  const rk = getKeypoint(keypoints, 'right_knee');

  const leftVisible =
    isVisible(ls, VISIBILITY_THRESHOLD) &&
    isVisible(lh, VISIBILITY_THRESHOLD) &&
    isVisible(lk, VISIBILITY_THRESHOLD);
  const rightVisible =
    isVisible(rs, VISIBILITY_THRESHOLD) &&
    isVisible(rh, VISIBILITY_THRESHOLD) &&
    isVisible(rk, VISIBILITY_THRESHOLD);

  if (!leftVisible && !rightVisible) return null;

  if (leftVisible && rightVisible) {
    const leftScore = (ls!.score + lh!.score + lk!.score) / 3;
    const rightScore = (rs!.score + rh!.score + rk!.score) / 3;
    if (leftScore >= rightScore) {
      return calculateAngle2D(getPoint(ls!), getPoint(lh!), getPoint(lk!));
    }
    return calculateAngle2D(getPoint(rs!), getPoint(rh!), getPoint(rk!));
  }

  if (leftVisible) {
    return calculateAngle2D(getPoint(ls!), getPoint(lh!), getPoint(lk!));
  }
  return calculateAngle2D(getPoint(rs!), getPoint(rh!), getPoint(rk!));
}

/**
 * Compute neck forward angle — measures how much the head juts forward
 * relative to the torso line. Uses ear-shoulder vs shoulder-hip vector.
 * Returns angle in degrees (0 = aligned, higher = more forward).
 */
function computeNeckForwardAngle(keypoints: Keypoint[]): number | null {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');
  const le = getKeypoint(keypoints, 'left_ear');
  const re = getKeypoint(keypoints, 'right_ear');

  // Use the more visible side
  const leftVisible =
    isVisible(ls, VISIBILITY_THRESHOLD) &&
    isVisible(lh, VISIBILITY_THRESHOLD) &&
    isVisible(le, VISIBILITY_THRESHOLD);
  const rightVisible =
    isVisible(rs, VISIBILITY_THRESHOLD) &&
    isVisible(rh, VISIBILITY_THRESHOLD) &&
    isVisible(re, VISIBILITY_THRESHOLD);

  if (!leftVisible && !rightVisible) return null;

  let ear: Keypoint, shoulder: Keypoint, hip: Keypoint;
  if (leftVisible && rightVisible) {
    const leftScore = (le!.score + ls!.score + lh!.score) / 3;
    const rightScore = (re!.score + rs!.score + rh!.score) / 3;
    if (leftScore >= rightScore) {
      ear = le!; shoulder = ls!; hip = lh!;
    } else {
      ear = re!; shoulder = rs!; hip = rh!;
    }
  } else if (leftVisible) {
    ear = le!; shoulder = ls!; hip = lh!;
  } else {
    ear = re!; shoulder = rs!; hip = rh!;
  }

  // Angle at shoulder: ear-shoulder-hip. Ideal is ~180° (aligned).
  // Neck forward = 180 - angle.
  const angle = calculateAngle2D(getPoint(ear), getPoint(shoulder), getPoint(hip));
  return Math.max(0, 180 - angle);
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMResult {
  phase: AbCrunchPhase;
  repCompleted: boolean;
}

function updateFSM(
  currentPhase: AbCrunchPhase,
  hipAngle: number,
  t: number,
  tRepStart: number | null,
): FSMResult {
  let phase = currentPhase;
  let repCompleted = false;

  switch (phase) {
    case 'REST':
      if (hipAngle < THRESHOLDS.CRUNCHING_ENTER) {
        phase = 'CRUNCHING';
      }
      break;

    case 'CRUNCHING':
      if (hipAngle < THRESHOLDS.BOTTOM_ENTER) {
        phase = 'BOTTOM';
      } else if (hipAngle >= THRESHOLDS.CRUNCHING_EXIT) {
        // Went back without crunching deep enough — reset
        phase = 'REST';
      }
      break;

    case 'BOTTOM':
      if (hipAngle > THRESHOLDS.BOTTOM_EXIT) {
        phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      if (
        hipAngle >= THRESHOLDS.REST_REENTER &&
        tRepStart !== null &&
        (t - tRepStart) >= THRESHOLDS.MIN_REP_TIME
      ) {
        phase = 'REST';
        repCompleted = true;
      } else if (hipAngle < THRESHOLDS.BOTTOM_ENTER) {
        // Went back to bottom
        phase = 'BOTTOM';
      }
      break;
  }

  return { phase, repCompleted };
}

// ============================================================================
// SCORING (continuous penalty curves)
// ============================================================================

function computeAbCrunchScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. Crunch ROM: ideal min hip angle is 106 or below. Shortfall = max(0, minHipAngle - 106)
  const crunchShortfall = Math.max(0, repWindow.minHipAngle - 106);
  penalties.push({ value: crunchShortfall, config: PENALTY_CONFIGS.CRUNCH_ROM });

  // 2. Extension ROM: ideal max hip angle is 122 or above. Shortfall = max(0, 122 - maxHipAngle)
  const extensionShortfall = Math.max(0, 122 - repWindow.maxHipAngle);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 3. Neck forward deviation
  penalties.push({ value: repWindow.maxNeckForward, config: PENALTY_CONFIGS.NECK_FORWARD });

  // 4. Tempo
  if (repWindow.tBottom !== null) {
    const tCrunch = repWindow.tBottom - repWindow.tStart;
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tBottom);

    if (tCrunch > 0 && tCrunch < PENALTY_CONFIGS.TEMPO_CRUNCH.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_CRUNCH.deadzone - tCrunch;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_CRUNCH, deadzone: 0 } });
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

  // 1. Crunch ROM — didn't crunch deep enough
  if (repWindow.minHipAngle > FORM_THRESHOLDS.CRUNCH_ROM_FAIL) {
    messages.push('Crunch deeper \u2014 bring your chest closer to your knees.');
  }

  // 2. Extension ROM — didn't extend fully at top
  if (repWindow.maxHipAngle < FORM_THRESHOLDS.EXTENSION_ROM_FAIL) {
    messages.push('Extend fully \u2014 return to the upright position.');
  }

  // 3. Neck forward — head jutting forward
  if (repWindow.maxNeckForward > FORM_THRESHOLDS.NECK_FORWARD_WARN) {
    messages.push('Keep your neck neutral \u2014 avoid pulling with your head.');
  }

  // 4. Tempo
  if (repWindow.tBottom !== null) {
    const tCrunch = repWindow.tBottom - repWindow.tStart;
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tBottom);

    if (tCrunch > 0 && tCrunch < FORM_THRESHOLDS.TEMPO_CRUNCH_MIN) {
      messages.push('Slow down the crunch \u2014 control the movement.');
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      messages.push('Control the return \u2014 resist on the way back.');
    }
  }

  return messages;
}

// ============================================================================
// MAIN UPDATE LOGIC
// ============================================================================

function updateAbCrunchState(
  keypoints: Keypoint[],
  state: AbCrunchState,
): AbCrunchState {
  const t = Date.now() / 1000;

  // -- Warmup gate --
  if (!state.warmedUp) {
    const stable = state.warmupGate.update(keypoints);
    if (!stable) return state;
    state.warmedUp = true;
  }

  // -- Compute raw angles --
  const rawHipAngle = computeHipAngle(keypoints);
  if (rawHipAngle === null) return state;

  const rawNeckAngle = computeNeckForwardAngle(keypoints);

  // -- Smooth angles --
  const smoothedHipAngle = state.hipAngleTracker.push(rawHipAngle);
  const fastHipAngle = state.hipAngleTracker.medianValue;
  const smoothedNeckAngle = rawNeckAngle !== null
    ? state.neckAngleTracker.push(rawNeckAngle)
    : state.neckAngleTracker.value;

  state.smoothedHipAngle = smoothedHipAngle;
  state.fastHipAngle = isNaN(fastHipAngle) ? smoothedHipAngle : fastHipAngle;
  state.smoothedNeckAngle = smoothedNeckAngle;

  // -- Track max hip angle during REST (pre-crunch extension) --
  if (state.phase === 'REST') {
    state.restMaxHipAngle = Math.max(state.restMaxHipAngle, smoothedHipAngle);
    if (state.fastHipAngle < THRESHOLDS.CRUNCH_CLOCK_START) {
      state.tCrunchStart ??= t;
    } else {
      state.tCrunchStart = null;
    }
  }

  // -- FSM update --
  const fsmResult = updateFSM(state.phase, state.fastHipAngle, t, state.tRepStart);
  const prevPhase = state.phase;
  state.phase = fsmResult.phase;

  // -- Track rep start --
  if (prevPhase === 'REST' && state.phase === 'CRUNCHING') {
    state.tRepStart = state.tCrunchStart ?? t;
    state.repWindow = initRepWindow(state.tRepStart);
    // Seed maxHipAngle from the pre-crunch position observed during REST
    state.repWindow.maxHipAngle = state.restMaxHipAngle;
    state.restMaxHipAngle = -Infinity;
    state.tCrunchStart = null;
  }

  // -- Accumulate rep window while in a rep --
  const inRep = state.phase !== 'REST';
  if (state.repWindow && inRep) {
    const w = state.repWindow;
    w.tEnd = t;
    w.frameCount++;

    w.minHipAngle = Math.min(w.minHipAngle, smoothedHipAngle);
    w.maxHipAngle = Math.max(w.maxHipAngle, smoothedHipAngle);

    if (!isNaN(smoothedNeckAngle) && isFinite(smoothedNeckAngle)) {
      w.maxNeckForward = Math.max(w.maxNeckForward, smoothedNeckAngle);
    }

    // Record BOTTOM timestamp
    if (state.phase === 'BOTTOM' && w.tBottom === null) {
      w.tBottom = t;
    }

    if (
      prevPhase === 'BOTTOM' &&
      w.minHipAngle < Infinity &&
      state.fastHipAngle > w.minHipAngle + 6 &&
      w.tReturnStart === null
    ) {
      w.tReturnStart = t;
    }
  }

  // -- Handle rep completion --
  if (fsmResult.repCompleted && state.repWindow) {
    state.repWindow.tEnd = t;
    state.repWindow.minHipAngle = Math.min(state.repWindow.minHipAngle, smoothedHipAngle);
    state.repWindow.maxHipAngle = Math.max(state.repWindow.maxHipAngle, smoothedHipAngle);

    state.repCount++;

    const score = computeAbCrunchScore(state.repWindow);
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

  // -- Handle aborted crunch (CRUNCHING -> REST without rep completion) --
  if (prevPhase === 'CRUNCHING' && state.phase === 'REST' && !fsmResult.repCompleted) {
    state.repWindow = null;
    state.tRepStart = null;
    state.tCrunchStart = null;
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

function getDebugInfo(state: AbCrunchState): AbCrunchDebugInfo {
  const fmt = (v: number): number | null =>
    !isNaN(v) && isFinite(v) ? v : null;

  const w = state.repWindow;
  return {
    phase: state.phase,
    warmedUp: state.warmedUp,
    hipAngle: fmt(state.smoothedHipAngle),
    fastHipAngle: fmt(state.fastHipAngle),
    neckAngle: fmt(state.smoothedNeckAngle),
    minHipAngle: w ? (w.minHipAngle < Infinity ? fmt(w.minHipAngle) : null) : null,
    maxHipAngle: w ? (w.maxHipAngle > -Infinity ? fmt(w.maxHipAngle) : null) : null,
    maxNeckForward: w ? fmt(w.maxNeckForward) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createMachineAbCrunchDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Machine Ab Crunches',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: withMachineAbCrunchConfig(config, () => initializeState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as AbCrunchState;
    withMachineAbCrunchConfig(config, () => updateAbCrunchState(keypoints, internal));

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
  tunableSpec: MACHINE_AB_CRUNCH_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/machineAbCrunch.json',
  createVariant: (variantConfig) =>
    createMachineAbCrunchDefinition(mergeHeuristicConfig(config, variantConfig)),

  ttsConfig: {
    feedbackToIssue: {
      'Crunch deeper \u2014 bring your chest closer to your knees.': 'depth_short',
      'Extend fully \u2014 return to the upright position.': 'lockout_short',
      'Keep your neck neutral \u2014 avoid pulling with your head.': 'neck_forward',
      'Slow down the crunch \u2014 control the movement.': 'tempo_down',
      'Control the return \u2014 resist on the way back.': 'tempo_up',
    },
    issueDefinitions: [
      {
        issueType: 'neck_forward',
        priority: 20,
        messages: [
          'Keep your neck neutral.',
          'Don\'t pull with your head.',
          'Chin stays tucked.',
          'Lead with your chest, not your head.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Crunch deeper \u2014 bring your chest closer to your knees.':
      'Focus on curling your torso forward fully to maximize ab engagement. Think about bringing your ribcage toward your pelvis.',
    'Extend fully \u2014 return to the upright position.':
      'Return to the full upright position between reps to maintain the full range of motion and get a stretch at the top.',
    'Keep your neck neutral \u2014 avoid pulling with your head.':
      'Keep your head in line with your spine throughout the movement. Pulling with your neck reduces ab activation and risks neck strain.',
    'Slow down the crunch \u2014 control the movement.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the crunch down to maintain tension on your abs.',
    'Control the return \u2014 resist on the way back.':
      'Slow the eccentric phase \u2014 resist the weight for 2-3 seconds on the way back for better ab engagement.',
  },
  };
}

export const machineAbCrunchDefinition: ExerciseDefinition = createMachineAbCrunchDefinition();
