/**
 * Lying Leg Curl -- Exercise Definition
 *
 * Side view, knee angle (hip-knee-ankle) as primary driver.
 * Person lies prone on a leg curl machine. Legs start extended (~160-170deg),
 * curl up to peak flexion (~40-70deg), then return.
 *
 * FSM: REST -> CURLING -> CURLED -> LOWERING -> REST
 * One rep = full curl up + controlled lower back down.
 *
 * Form checks:
 *   1. Knee flexion ROM   -- did they curl far enough?
 *   2. Knee extension ROM -- did they fully extend at the bottom?
 *   3. Hip lift            -- hips rising off the pad (torso angle change)
 *   4. Tempo               -- concentric (curl) and eccentric (lower) speed
 *
 * The only export is `lyingLegCurlDefinition`.
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

/** FSM thresholds (degrees) — knee angle (hip-knee-ankle) */
const THRESHOLDS = {
  /** Knee angle below which we transition REST -> CURLING (legs start to bend) */
  CURLING_ENTER: 140,
  /** Knee angle below which we consider peak flexion (CURLING -> CURLED) */
  CURLED_ENTER: 80,
  /** Knee angle above which we leave CURLED (hysteresis) (CURLED -> LOWERING) */
  CURLED_EXIT: 85,
  /** Knee angle above which the extension is complete (LOWERING -> REST) */
  REST_REENTER: 140,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min knee angle above which flexion is insufficient (didn't curl enough) */
  FLEXION_FAIL: 80,
  /** Max knee angle below which extension is insufficient (didn't straighten) */
  EXTENSION_FAIL: 150,
  /** Hip angle delta from baseline above which hips are lifting */
  HIP_LIFT_WARN: 12,
  /** Concentric (curl up) too fast threshold (seconds) */
  TEMPO_CURL_MIN: 0.3,
  /** Eccentric (lower down) too fast threshold (seconds) */
  TEMPO_LOWER_MIN: 0.4,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category          | Cap | Deadzone         | Scale | Key Input                          |
 * |-------------------|-----|------------------|-------|------------------------------------|
 * | ROM flexion       | 30  | 70 (minKnee)     | 0.04  | min knee angle - ideal flex angle  |
 * | ROM extension     | 25  | 155 (maxKnee)    | 0.05  | ideal extension - max knee angle   |
 * | Hip lift          | 30  | 8                | 0.10  | max hip angle delta from baseline  |
 * | Tempo curl        | 12  | 0.4s             | 60    | concentric time deficit            |
 * | Tempo lower       | 10  | 0.5s             | 40    | eccentric time deficit             |
 *
 * Max total penalty: 107 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  FLEXION_ROM:    { cap: 30, deadzone: 0, scale: 0.04 } as PenaltyConfig,
  EXTENSION_ROM:  { cap: 25, deadzone: 0, scale: 0.05 } as PenaltyConfig,
  HIP_LIFT:       { cap: 30, deadzone: 8, scale: 0.10 } as PenaltyConfig,
  TEMPO_CURL:     { cap: 12, deadzone: 0.4, scale: 60 } as PenaltyConfig,
  TEMPO_LOWER:    { cap: 10, deadzone: 0.5, scale: 40 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LyingLegCurlPhase = 'REST' | 'CURLING' | 'CURLED' | 'LOWERING';

interface LyingLegCurlFSM {
  phase: LyingLegCurlPhase;
  /** Timestamp when curl began (REST -> CURLING) */
  tRepStart: number | null;
  /** Timestamp when peak flexion was reached */
  tCurled: number | null;
  /** Timestamp when rep completed (LOWERING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min knee angle during rep (should be low -- peak flexion) */
  minKnee: number;
  /** Max knee angle during rep (should be high -- full extension at start/end) */
  maxKnee: number;
  /** Hip angle at rep start (baseline for detecting lift) */
  hipAngleBaseline: number | null;
  /** Max absolute hip angle delta from baseline during rep */
  maxHipDelta: number;
  /** Timestamps */
  tStart: number;
  tCurled: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
}

interface LyingLegCurlState {
  fsm: LyingLegCurlFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  /** Smoothed angle trackers */
  kneeTracker: SmoothedAngleTracker;
  hipTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Current smoothed angles for debug */
  smoothedKnee: number | null;
  smoothedHip: number | null;
  /** Feedback */
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
}

interface LyingLegCurlDebugInfo {
  phase: LyingLegCurlPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  knee: number | null;
  hipAngle: number | null;
  // Rep window
  kneeMin: number | null;
  kneeMax: number | null;
  hipDelta: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): LyingLegCurlFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tCurled: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number): RepWindow {
  return {
    minKnee: Infinity,
    maxKnee: -Infinity,
    hipAngleBaseline: null,
    maxHipDelta: 0,
    tStart,
    tCurled: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function initializeLyingLegCurlState(): LyingLegCurlState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    kneeTracker: new SmoothedAngleTracker(),
    hipTracker: new SmoothedAngleTracker(),
    warmupGate: new WarmupGate({
      requiredJoints: [
        'left_hip', 'left_knee', 'left_ankle',
        'right_hip', 'right_knee', 'right_ankle',
      ],
      requiredFrames: 10,
      visibilityThreshold: 0.2,
    }),
    warmedUp: false,
    smoothedKnee: null,
    smoothedHip: null,
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
 * ~160-170deg when legs extended, ~40-70deg when fully curled.
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
 * This measures the angle at the hip joint.
 * When lying flat and still, this angle stays relatively constant (~170-180deg).
 * If hips lift off the pad, this angle decreases noticeably.
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

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: LyingLegCurlFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: LyingLegCurlFSM,
  kneeAngle: number,
  t: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Legs extended. When knee starts flexing (angle drops), begin curl.
      if (kneeAngle < THRESHOLDS.CURLING_ENTER) {
        fsm.phase = 'CURLING';
        fsm.tRepStart = t;
        fsm.tCurled = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'CURLING':
      // Actively curling up. When peak flexion reached, transition.
      if (kneeAngle < THRESHOLDS.CURLED_ENTER) {
        fsm.phase = 'CURLED';
        fsm.tCurled = t;
      } else if (kneeAngle > THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Extended back out without curling far enough -- reset
        fsm.phase = 'REST';
        fsm.tRepStart = null;
      }
      break;

    case 'CURLED':
      // At peak flexion. When knee starts extending back (hysteresis), transition.
      if (kneeAngle > THRESHOLDS.CURLED_EXIT) {
        fsm.phase = 'LOWERING';
      }
      break;

    case 'LOWERING':
      // Controlled eccentric. When legs return to extended position, rep complete.
      if (
        kneeAngle > THRESHOLDS.REST_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'REST';
        fsm.tRepEnd = t;
        repCompleted = true;
      } else if (kneeAngle < THRESHOLDS.CURLED_ENTER) {
        // Went back to curled position -- return to CURLED
        fsm.phase = 'CURLED';
      }
      break;
  }

  return { fsm, repCompleted };
}

// ============================================================================
// SCORING (continuous penalty curves)
// ============================================================================

function computeLyingLegCurlScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM -- flexion: ideal min knee angle is 70 or below. Excess = max(0, minKnee - 70)
  const flexionExcess = Math.max(0, repWindow.minKnee - 70);
  penalties.push({ value: flexionExcess, config: PENALTY_CONFIGS.FLEXION_ROM });

  // 2. ROM -- extension: ideal max knee angle is 155+. Shortfall = max(0, 155 - maxKnee)
  const extensionShortfall = Math.max(0, 155 - repWindow.maxKnee);
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  // 3. Hip lift (hip angle delta)
  penalties.push({ value: repWindow.maxHipDelta, config: PENALTY_CONFIGS.HIP_LIFT });

  // 4. Tempo
  if (repWindow.tCurled !== null) {
    const tCurl = repWindow.tCurled - repWindow.tStart;    // concentric (curl up)
    const tLower = repWindow.tEnd - repWindow.tCurled;      // eccentric (lower down)

    // Penalize if too fast
    if (tCurl > 0 && tCurl < PENALTY_CONFIGS.TEMPO_CURL.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_CURL.deadzone - tCurl;
      penalties.push({ value: deficit, config: PENALTY_CONFIGS.TEMPO_CURL });
    }
    if (tLower > 0 && tLower < PENALTY_CONFIGS.TEMPO_LOWER.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_LOWER.deadzone - tLower;
      penalties.push({ value: deficit, config: PENALTY_CONFIGS.TEMPO_LOWER });
    }
  }

  return computeScore(penalties);
}

// ============================================================================
// FORM MESSAGES (discrete thresholds)
// ============================================================================

function generateFormMessages(repWindow: RepWindow): string[] {
  const messages: string[] = [];

  // 1. Flexion ROM -- didn't curl far enough
  if (repWindow.minKnee > FORM_THRESHOLDS.FLEXION_FAIL) {
    messages.push('Curl higher \u2014 bring your heels closer to your glutes.');
  }

  // 2. Extension ROM -- didn't straighten fully
  if (repWindow.maxKnee < FORM_THRESHOLDS.EXTENSION_FAIL) {
    messages.push('Extend fully \u2014 straighten your legs at the bottom.');
  }

  // 3. Hip lift
  if (repWindow.maxHipDelta > FORM_THRESHOLDS.HIP_LIFT_WARN) {
    messages.push('Keep your hips down \u2014 avoid lifting off the pad.');
  }

  // 4. Tempo
  if (repWindow.tCurled !== null) {
    const tCurl = repWindow.tCurled - repWindow.tStart;
    const tLower = repWindow.tEnd - repWindow.tCurled;

    if (tCurl > 0 && tCurl < FORM_THRESHOLDS.TEMPO_CURL_MIN) {
      messages.push('Slow down the curl \u2014 control the contraction.');
    }
    if (tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN) {
      messages.push('Control the descent \u2014 lower the weight slowly.');
    }
  }

  return messages;
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateLyingLegCurlState(
  keypoints: Keypoint[],
  currentState: LyingLegCurlState
): LyingLegCurlState {
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

  // If we can't even see the knee, bail out
  if (rawKnee === null) {
    return {
      ...currentState,
      visibleSide,
      smoothedKnee: null,
      smoothedHip: null,
    };
  }

  // Smooth angles
  const smoothedKnee = currentState.kneeTracker.push(rawKnee);
  const smoothedHip = rawHip !== null
    ? currentState.hipTracker.push(rawHip)
    : currentState.hipTracker.value;

  const newState: LyingLegCurlState = {
    ...currentState,
    visibleSide,
    smoothedKnee,
    smoothedHip: isNaN(smoothedHip) ? null : smoothedHip,
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

    // Record curled timestamp
    if (newState.fsm.phase === 'CURLED' && window.tCurled === null) {
      window.tCurled = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    newState.repCount++;

    const score = computeLyingLegCurlScore(newState.repWindow);
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

function getDebugInfo(state: LyingLegCurlState): LyingLegCurlDebugInfo {
  const fmt = (v: number | null | undefined): number | null =>
    v !== null && v !== undefined && !isNaN(v) && isFinite(v) ? v : null;

  const repWin = state.repWindow;

  return {
    phase: state.fsm.phase,
    side: state.visibleSide,
    warmedUp: state.warmedUp,
    knee: fmt(state.smoothedKnee),
    hipAngle: fmt(state.smoothedHip),
    kneeMin: repWin && repWin.minKnee !== Infinity ? fmt(repWin.minKnee) : null,
    kneeMax: repWin && repWin.maxKnee !== -Infinity ? fmt(repWin.maxKnee) : null,
    hipDelta: repWin ? fmt(repWin.maxHipDelta) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export const lyingLegCurlDefinition: ExerciseDefinition = {
  name: 'Lying Leg Curl',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: initializeLyingLegCurlState(),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as LyingLegCurlState;
    const newInternal = updateLyingLegCurlState(keypoints, internal);

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
      'Curl higher \u2014 bring your heels closer to your glutes.': 'rom_curl_short',
      'Extend fully \u2014 straighten your legs at the bottom.': 'rom_extend_short',
      'Keep your hips down \u2014 avoid lifting off the pad.': 'hip_lift',
      'Slow down the curl \u2014 control the contraction.': 'tempo_up',
      'Control the descent \u2014 lower the weight slowly.': 'tempo_down',
    },
    issueDefinitions: [
      {
        issueType: 'rom_curl_short',
        priority: 25,
        messages: [
          'Curl it all the way up.',
          'Get those heels to your glutes.',
          'Full range on the curl.',
        ],
      },
      {
        issueType: 'rom_extend_short',
        priority: 20,
        messages: [
          'Straighten fully at the bottom.',
          'Full extension before the next rep.',
          'Legs all the way down.',
        ],
      },
      {
        issueType: 'hip_lift',
        priority: 30,
        messages: [
          'Keep your hips down.',
          'Hips on the pad.',
          'Don\'t lift your hips.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Curl higher \u2014 bring your heels closer to your glutes.':
      'Focus on curling your heels as close to your glutes as possible for full hamstring contraction.',
    'Extend fully \u2014 straighten your legs at the bottom.':
      'Fully straighten your legs at the bottom of each rep to maximize range of motion.',
    'Keep your hips down \u2014 avoid lifting off the pad.':
      'Press your hips into the pad throughout the movement \u2014 lifting uses momentum instead of hamstring strength.',
    'Slow down the curl \u2014 control the contraction.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the curl up.',
    'Control the descent \u2014 lower the weight slowly.':
      'Slow the eccentric phase \u2014 resist the weight on the way down for 2-3 seconds.',
  },
};
