/**
 * Standing Dumbbell Lateral Raises -- Exercise Definition
 *
 * Uses ratio-based metrics for camera-angle-invariant form detection.
 * Primary metric: arm height ratio = (hip.y - wrist.y) / (hip.y - shoulder.y)
 *   - Arms at sides: ~0.0-0.3
 *   - Arms at shoulder level: ~1.0
 *   - Camera-invariant: normalized by torso height
 * Secondary: arm straightness ratio = dist(shoulder,wrist) / (dist(shoulder,elbow) + dist(elbow,wrist))
 *
 * FSM: REST -> RAISING -> TOP -> LOWERING -> REST
 *
 * The only export is `lateralRaiseDefinition`.
 */

import {
  Keypoint,
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

import { SmoothedAngleTracker } from '../shared/SmoothedAngleTracker';
import { WarmupGate } from '../shared/WarmupGate';
import { computeScore, PenaltyConfig } from '../shared/scoring';
import { LOW_ROM_FEEDBACK, isMeaningfulPartialRep } from '../shared/partialReps';
import {
  createDefaultTunableSpec,
  mergeHeuristicConfig,
  runWithConfigBindings,
} from '../heuristicConfig';
import tunedConfig from './tuned/lateralRaise.json';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/**
 * FSM thresholds — ratio-based (camera-angle invariant).
 * Arm height ratio: (hip.y - wrist.y) / (hip.y - shoulder.y)
 *   0.0 = wrist at hip level, 1.0 = wrist at shoulder level
 */
const THRESHOLDS = {
  /** Height ratio above which we leave REST and enter RAISING */
  RAISING_ENTER: 0.30,
  /** Height ratio above which we transition RAISING -> TOP */
  TOP_ENTER: 0.85,
  /** Height ratio below which we leave TOP (hysteresis) */
  TOP_EXIT: 0.80,
  /** Height ratio below which we complete the rep (LOWERING -> REST) */
  REST_ENTER: 0.30,
  /** Minimum time (seconds) for a rep to count */
  MIN_REP_TIME: 0.5,
  /** Minimum height ratio for a returned partial rep to count */
  MIN_PARTIAL_HEIGHT_RATIO: 0.46,
} as const;

/** Form heuristic thresholds — ratio-based where applicable */
const FORM_THRESHOLDS = {
  /** Max height ratio should reach at least this for good ROM (1.0 = shoulder level) */
  ROM_MIN: 0.92,
  /** Height ratio above which the raise is excessive (well above shoulder level). */
  OVER_RAISE_WARN: 1.15,
  /** Arm straightness ratio below this triggers "keep arms straighter".
   *  1.0 = perfectly straight, ~0.85 = noticeably bent. */
  ELBOW_STRAIGHTNESS_WARN: 0.88,
  /** Torso lateral lean above this triggers "stay upright" */
  TORSO_LEAN_WARN: 1.8,
  /** Height ratio difference between arms above this triggers asymmetry */
  ASYMMETRY_WARN: 0.18,
  /** Eccentric tempo threshold (seconds). */
  TEMPO_LOWER_MIN: 0.35,
  /** Shoulder elevation (shrug) as percentage of torso height (already ratio-based). */
  SHRUG_WARN: 12,
} as const;

/** Ideal targets used by the scoring system (separate from penalty deadzones) */
const IDEAL = {
  /** Shoulder-level height ratio */
  MAX_HEIGHT_RATIO: 1.0,
  /** Nearly straight arm (straightness ratio) */
  MIN_STRAIGHTNESS: 0.97,
  /** Controlled eccentric time (seconds) */
  ECCENTRIC_TIME: 0.55,
} as const;

/**
 * Continuous penalty curve configs for scoring.
 *
 * Formula: min(cap, scale × max(0, value − deadzone)²)
 *
 * | Category     | Cap | Deadzone | Scale | Input                                          |
 * |--------------|-----|----------|-------|------------------------------------------------|
 * | ROM          | 50  | 0        | 500   | ideal 1.0 − maxHeightRatio                     |
 * | Arm straight | 20  | 0.05     | 1500  | ideal 0.97 − minStraightnessRatio              |
 * | Torso lean   | 25  | 1.8°     | 200   | maxTorsoLean from vertical                     |
 * | Tempo lower  | 35  | 0.05s    | 1800  | ideal 0.55s − actual eccentric time            |
 * | Asymmetry    | 15  | 0.08     | 800   | maxHeightRatioDiff between arms                |
 * | Shrug        | 20  | 10%      | 0.50  | shoulder elevation % above rest baseline       |
 * | Over-raise   | 10  | 0.10     | 500   | maxHeightRatio above shoulder level            |
 *
 * Max total penalty: 165 → worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  ROM:            { cap: 50, deadzone: 0,    scale: 500  } as PenaltyConfig,
  ARM_STRAIGHT:   { cap: 20, deadzone: 0.05, scale: 1500 } as PenaltyConfig,
  TORSO_LEAN:     { cap: 25, deadzone: 1.8,  scale: 200  } as PenaltyConfig,
  TEMPO_LOWER:    { cap: 35, deadzone: 0.05, scale: 1800 } as PenaltyConfig,
  ASYMMETRY:      { cap: 15, deadzone: 0.08, scale: 800  } as PenaltyConfig,
  SHRUG:          { cap: 20, deadzone: 10,   scale: 0.50 } as PenaltyConfig,
  OVER_RAISE:     { cap: 10, deadzone: 0.10, scale: 500  } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;
const FORM_CONFIDENCE_MIN = 0.3;

const DEFAULT_LATERAL_RAISE_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_LATERAL_RAISE_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_LATERAL_RAISE_HEURISTIC_CONFIG,
  tunedConfig,
);

const LATERAL_RAISE_TUNABLE_SPEC = createDefaultTunableSpec(
  'Standing Dumbbell Lateral Raises',
  DEFAULT_LATERAL_RAISE_HEURISTIC_CONFIG,
);

const LATERAL_RAISE_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withLateralRaiseConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, LATERAL_RAISE_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LateralRaisePhase = 'REST' | 'RAISING' | 'TOP' | 'LOWERING';

interface RepWindow {
  /** Timestamps */
  tStart: number;
  tTop: number | null;
  /** Timestamp of the TOP→LOWERING transition — the true eccentric start */
  tLoweringStart: number | null;
  tEnd: number;
  /** Max arm height ratio reached (average of both arms) */
  maxHeightRatio: number;
  /** Max height ratio per arm (for asymmetry) */
  maxLeftHeightRatio: number;
  maxRightHeightRatio: number;
  /** Max height ratio difference between arms at any frame */
  maxHeightRatioDiff: number;
  /** Min arm straightness ratio during the rep (lower = more bent) */
  minStraightnessRatio: number;
  /** Max torso lateral lean during the rep (degrees — already camera-invariant) */
  maxTorsoLean: number;
  /** Baseline torso height at rep start (for shrug detection) */
  baselineTorsoHeight: number | null;
  /** Max shoulder shrug as percentage of torso height (already ratio-based) */
  maxShrugPct: number;
  /** Frame count */
  frameCount: number;
}

interface LateralRaiseState {
  phase: LateralRaisePhase;
  repCount: number;
  /** Timestamp when the current rep started (REST -> RAISING) */
  tRepStart: number | null;
  /** Current rep window accumulator */
  repWindow: RepWindow | null;
  /** Last completed rep result */
  lastRepResult: RepResult | null;
  /** Smoothed ratio/angle trackers */
  leftHeightRatioTracker: SmoothedAngleTracker;
  rightHeightRatioTracker: SmoothedAngleTracker;
  leftStraightnessTracker: SmoothedAngleTracker;
  rightStraightnessTracker: SmoothedAngleTracker;
  torsoLeanTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  /** Whether warmup has been passed */
  warmedUp: boolean;
  /**
   * Torso height (midHipY − midShoulderY) captured during REST.
   * Used as the shrug baseline so we measure shoulder ELEVATION above rest.
   */
  restTorsoHeight: number | null;
  /** Current smoothed values (for debug) */
  smoothedLeftHeightRatio: number;
  smoothedRightHeightRatio: number;
  smoothedAvgHeightRatio: number;
  smoothedLeftStraightness: number;
  smoothedRightStraightness: number;
  smoothedTorsoLean: number;
  /** Visual feedback */
  feedback: string | null;
  lastFeedbackTime: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
}

/** Debug info for on-screen overlay */
interface LateralRaiseDebugInfo {
  phase: LateralRaisePhase;
  warmedUp: boolean;
  leftHeightRatio: number | null;
  rightHeightRatio: number | null;
  avgHeightRatio: number | null;
  leftStraightness: number | null;
  rightStraightness: number | null;
  torsoLean: number | null;
  maxHeightRatio: number | null;
  maxHeightRatioDiff: number | null;
  minStraightness: number | null;
  maxTorsoLean: number | null;
  shrugPct: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializeState(): LateralRaiseState {
  return {
    phase: 'REST',
    repCount: 0,
    tRepStart: null,
    repWindow: null,
    lastRepResult: null,
    leftHeightRatioTracker: new SmoothedAngleTracker(),
    rightHeightRatioTracker: new SmoothedAngleTracker(),
    leftStraightnessTracker: new SmoothedAngleTracker(),
    rightStraightnessTracker: new SmoothedAngleTracker(),
    torsoLeanTracker: new SmoothedAngleTracker(),
    warmupGate: new WarmupGate({
      requiredJoints: [
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
        'left_hip', 'right_hip',
        'left_wrist', 'right_wrist',
      ],
    }),
    warmedUp: false,
    restTorsoHeight: null,
    smoothedLeftHeightRatio: 0,
    smoothedRightHeightRatio: 0,
    smoothedAvgHeightRatio: 0,
    smoothedLeftStraightness: 1.0,
    smoothedRightStraightness: 1.0,
    smoothedTorsoLean: 0,
    feedback: null,
    lastFeedbackTime: 0,
  };
}

function initRepWindow(tStart: number, baselineTorsoHeight: number | null): RepWindow {
  return {
    tStart,
    tTop: null,
    tLoweringStart: null,
    tEnd: tStart,
    maxHeightRatio: 0,
    maxLeftHeightRatio: 0,
    maxRightHeightRatio: 0,
    maxHeightRatioDiff: 0,
    minStraightnessRatio: 1.0,
    maxTorsoLean: 0,
    baselineTorsoHeight,
    maxShrugPct: 0,
    frameCount: 0,
  };
}

// ============================================================================
// GEOMETRY HELPERS (ratio-based)
// ============================================================================

/** Euclidean distance in 2D */
function dist2D(a: Keypoint, b: Keypoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute arm height ratio for one side.
 * Ratio = (hip.y - wrist.y) / (hip.y - shoulder.y)
 *   0.0 = wrist at hip level (arms at sides)
 *   1.0 = wrist at shoulder level
 *   >1.0 = wrist above shoulders
 * Camera-invariant: normalized by torso height.
 * Uses midpoint of both hips for stability.
 */
function computeArmHeightRatio(
  wrist: Keypoint,
  leftHip: Keypoint,
  rightHip: Keypoint,
  leftShoulder: Keypoint,
  rightShoulder: Keypoint,
): number {
  const midHipY = (leftHip.y + rightHip.y) / 2;
  const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const torsoHeight = midHipY - midShoulderY; // positive (Y increases downward)
  if (torsoHeight < 0.01) return 0;
  return (midHipY - wrist.y) / torsoHeight;
}

/**
 * Compute arm straightness ratio for one side.
 * Ratio = dist(shoulder, wrist) / (dist(shoulder, elbow) + dist(elbow, wrist))
 *   1.0 = perfectly straight, ~0.85 = noticeably bent
 * Camera-invariant: foreshortening scales numerator and denominator equally.
 */
function computeArmStraightnessRatio(
  shoulder: Keypoint,
  elbow: Keypoint,
  wrist: Keypoint,
): number {
  const chainLen = dist2D(shoulder, elbow) + dist2D(elbow, wrist);
  if (chainLen < 1e-6) return 1.0;
  return dist2D(shoulder, wrist) / chainLen;
}

/**
 * Compute lateral torso lean from front view (degrees from vertical).
 * Already camera-invariant as a ratio of dx/dy.
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
  phase: LateralRaisePhase;
  repCompleted: boolean;
}

/**
 * Update FSM using average arm height ratio (camera-invariant).
 * 0.0 = arms at sides, 1.0 = shoulder level.
 */
function updateFSM(
  currentPhase: LateralRaisePhase,
  avgHeightRatio: number,
  t: number,
  tRepStart: number | null,
): FSMResult {
  let phase = currentPhase;
  let repCompleted = false;

  switch (phase) {
    case 'REST':
      if (avgHeightRatio > THRESHOLDS.RAISING_ENTER) {
        phase = 'RAISING';
      }
      break;

    case 'RAISING':
      if (avgHeightRatio >= THRESHOLDS.TOP_ENTER) {
        phase = 'TOP';
      } else if (avgHeightRatio < THRESHOLDS.REST_ENTER) {
        // Aborted raise -- back to rest without counting
        phase = 'REST';
      }
      break;

    case 'TOP':
      if (avgHeightRatio < THRESHOLDS.TOP_EXIT) {
        phase = 'LOWERING';
      }
      break;

    case 'LOWERING':
      if (avgHeightRatio < THRESHOLDS.REST_ENTER) {
        // Rep complete if enough time has passed
        if (tRepStart !== null && (t - tRepStart) >= THRESHOLDS.MIN_REP_TIME) {
          repCompleted = true;
        }
        phase = 'REST';
      } else if (avgHeightRatio >= THRESHOLDS.TOP_ENTER) {
        // User raised arms again before completing descent
        phase = 'TOP';
      }
      break;
  }

  return { phase, repCompleted };
}

// ============================================================================
// SCORING
// ============================================================================

function computeRepWindowScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM shortfall — ideal is ratio 1.0 (shoulder level). FSM ensures ≥0.85.
  const romShortfall = Math.max(0, IDEAL.MAX_HEIGHT_RATIO - repWindow.maxHeightRatio);
  penalties.push({ value: romShortfall, config: PENALTY_CONFIGS.ROM });

  // 2. Arm straightness — ideal is 0.97 (slight bend OK). Lower = more bend = worse.
  const straightnessDeficit = Math.max(0, IDEAL.MIN_STRAIGHTNESS - repWindow.minStraightnessRatio);
  penalties.push({ value: straightnessDeficit, config: PENALTY_CONFIGS.ARM_STRAIGHT });

  // 3. Torso lean — lower is better (deadzone handles small amounts)
  penalties.push({ value: repWindow.maxTorsoLean, config: PENALTY_CONFIGS.TORSO_LEAN });

  // 4. Eccentric tempo only — no penalty for concentric speed.
  if (repWindow.tLoweringStart !== null) {
    const tLower = repWindow.tEnd - repWindow.tLoweringStart;
    if (tLower > 0 && tLower < IDEAL.ECCENTRIC_TIME) {
      const deficit = IDEAL.ECCENTRIC_TIME - tLower;
      penalties.push({ value: deficit, config: PENALTY_CONFIGS.TEMPO_LOWER });
    }
  }

  // 5. Asymmetry — max height ratio difference between arms
  penalties.push({ value: repWindow.maxHeightRatioDiff, config: PENALTY_CONFIGS.ASYMMETRY });

  // 6. Shoulder shrug — torso height compression percentage (already ratio-based)
  penalties.push({ value: repWindow.maxShrugPct, config: PENALTY_CONFIGS.SHRUG });

  // 7. Over-raising — above shoulder level shifts tension and often invites shrugging.
  const overRaise = Math.max(0, repWindow.maxHeightRatio - IDEAL.MAX_HEIGHT_RATIO);
  penalties.push({ value: overRaise, config: PENALTY_CONFIGS.OVER_RAISE });

  return computeScore(penalties);
}

// ============================================================================
// FORM FEEDBACK (discrete messages for visual display)
// ============================================================================

function generateFormMessages(repWindow: RepWindow): string[] {
  const messages: string[] = [];

  // 1. ROM — raise height (ratio-based)
  if (repWindow.maxHeightRatio < FORM_THRESHOLDS.ROM_MIN) {
    messages.push('Raise higher \u2014 aim for shoulder level.');
  }

  // 2. Over-raise (ratio-based)
  if (repWindow.maxHeightRatio > FORM_THRESHOLDS.OVER_RAISE_WARN) {
    messages.push('Stop around shoulder height \u2014 avoid lifting too high.');
  }

  // 3. Arm straightness (ratio-based)
  if (repWindow.minStraightnessRatio < FORM_THRESHOLDS.ELBOW_STRAIGHTNESS_WARN) {
    messages.push('Keep your arms straighter \u2014 avoid excessive elbow bend.');
  }

  // 4. Torso lean
  if (repWindow.maxTorsoLean > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Stay upright \u2014 avoid swaying or leaning.');
  }

  // 5. Asymmetry (ratio-based)
  if (repWindow.maxHeightRatioDiff > FORM_THRESHOLDS.ASYMMETRY_WARN) {
    messages.push('Even it out \u2014 raise both arms to the same height.');
  }

  // 6. Eccentric tempo only
  if (repWindow.tLoweringStart !== null) {
    const tLower = repWindow.tEnd - repWindow.tLoweringStart;
    if (tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN) {
      messages.push('Control the descent \u2014 lower the weights slowly.');
    }
  }

  // 7. Shoulder shrug
  if (repWindow.maxShrugPct > FORM_THRESHOLDS.SHRUG_WARN) {
    messages.push('Relax your traps \u2014 don\'t shrug the weight up.');
  }

  return messages;
}

// ============================================================================
// MAIN UPDATE LOGIC
// ============================================================================

function updateLateralRaiseState(
  keypoints: Keypoint[],
  state: LateralRaiseState,
): LateralRaiseState {
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

  // Require both sides visible (front-view exercise)
  const leftArmVisible =
    isVisible(ls, VISIBILITY_THRESHOLD) &&
    isVisible(le, VISIBILITY_THRESHOLD) &&
    isVisible(lh, VISIBILITY_THRESHOLD);
  const rightArmVisible =
    isVisible(rs, VISIBILITY_THRESHOLD) &&
    isVisible(re, VISIBILITY_THRESHOLD) &&
    isVisible(rh, VISIBILITY_THRESHOLD);

  if (!leftArmVisible || !rightArmVisible) {
    return state;
  }

  // -- Compute raw ratios --
  // Arm height ratio: wrist height relative to torso (0 = hip, 1.0 = shoulder)
  // Uses elbow as fallback for wrist if wrist not visible (arms still track via elbow height)
  const leftWristVisible = isVisible(lw, VISIBILITY_THRESHOLD);
  const rightWristVisible = isVisible(rw, VISIBILITY_THRESHOLD);
  const leftWristPoint = leftWristVisible ? lw! : le!;
  const rightWristPoint = rightWristVisible ? rw! : re!;
  const rawLeftHeightRatio = computeArmHeightRatio(leftWristPoint, lh!, rh!, ls!, rs!);
  const rawRightHeightRatio = computeArmHeightRatio(rightWristPoint, lh!, rh!, ls!, rs!);

  // Arm straightness ratio (only when wrist visible)
  let rawLeftStraightness = NaN;
  let rawRightStraightness = NaN;
  if (leftWristVisible) {
    rawLeftStraightness = computeArmStraightnessRatio(ls!, le!, lw!);
  }
  if (rightWristVisible) {
    rawRightStraightness = computeArmStraightnessRatio(rs!, re!, rw!);
  }

  let rawTorsoLean: number | null = null;
  const allTorsoVisible =
    isVisible(ls, VISIBILITY_THRESHOLD) &&
    isVisible(rs, VISIBILITY_THRESHOLD) &&
    isVisible(lh, VISIBILITY_THRESHOLD) &&
    isVisible(rh, VISIBILITY_THRESHOLD);
  if (allTorsoVisible) {
    rawTorsoLean = computeTorsoLean(ls!, rs!, lh!, rh!);
  }
  const leftHeightConf = minKeypointConfidence(keypoints, [
    'left_shoulder', 'left_elbow', leftWristVisible ? 'left_wrist' : 'left_elbow', 'left_hip', 'right_hip',
  ]);
  const rightHeightConf = minKeypointConfidence(keypoints, [
    'right_shoulder', 'right_elbow', rightWristVisible ? 'right_wrist' : 'right_elbow', 'left_hip', 'right_hip',
  ]);
  const leftStraightnessConf = leftWristVisible
    ? minKeypointConfidence(keypoints, ['left_shoulder', 'left_elbow', 'left_wrist'])
    : 0;
  const rightStraightnessConf = rightWristVisible
    ? minKeypointConfidence(keypoints, ['right_shoulder', 'right_elbow', 'right_wrist'])
    : 0;
  const torsoConf = minKeypointConfidence(keypoints, [
    'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
  ]);

  // -- Smooth ratios --
  const smoothedLeftHeightRatio = state.leftHeightRatioTracker.push(rawLeftHeightRatio, leftHeightConf);
  const smoothedRightHeightRatio = state.rightHeightRatioTracker.push(rawRightHeightRatio, rightHeightConf);
  const smoothedAvgHeightRatio = (smoothedLeftHeightRatio + smoothedRightHeightRatio) / 2;
  const fastLeftHeightRatio = state.leftHeightRatioTracker.medianValue;
  const fastRightHeightRatio = state.rightHeightRatioTracker.medianValue;
  const fastAvgHeightRatio = (fastLeftHeightRatio + fastRightHeightRatio) / 2;
  const smoothedLeftStraightness = leftWristVisible
    ? state.leftStraightnessTracker.push(rawLeftStraightness, leftStraightnessConf)
    : state.leftStraightnessTracker.value;
  const smoothedRightStraightness = rightWristVisible
    ? state.rightStraightnessTracker.push(rawRightStraightness, rightStraightnessConf)
    : state.rightStraightnessTracker.value;
  const smoothedTorsoLean = rawTorsoLean !== null
    ? state.torsoLeanTracker.push(rawTorsoLean, torsoConf)
    : state.torsoLeanTracker.value;

  // Update display values (mutate in place for perf)
  state.smoothedLeftHeightRatio = smoothedLeftHeightRatio;
  state.smoothedRightHeightRatio = smoothedRightHeightRatio;
  state.smoothedAvgHeightRatio = smoothedAvgHeightRatio;
  state.smoothedLeftStraightness = isNaN(smoothedLeftStraightness) ? state.smoothedLeftStraightness : smoothedLeftStraightness;
  state.smoothedRightStraightness = isNaN(smoothedRightStraightness) ? state.smoothedRightStraightness : smoothedRightStraightness;
  state.smoothedTorsoLean = isNaN(smoothedTorsoLean) ? state.smoothedTorsoLean : smoothedTorsoLean;

  // -- FSM update (ratio-based) --
  const fsmResult = updateFSM(state.phase, fastAvgHeightRatio, t, state.tRepStart);
  const prevPhase = state.phase;
  state.phase = fsmResult.phase;

  // -- Capture rest-state torso height baseline (used for shrug detection) --
  // Updated only when the arms are genuinely down so early shrugging or a
  // low-amplitude raise cannot overwrite the relaxed shoulder baseline.
  if (
    state.phase === 'REST' &&
    fastAvgHeightRatio < THRESHOLDS.REST_ENTER * 0.5 &&
    allTorsoVisible &&
    torsoConf >= FORM_CONFIDENCE_MIN
  ) {
    const midShoulderY = (ls!.y + rs!.y) / 2;
    const midHipY = (lh!.y + rh!.y) / 2;
    const torsoH = midHipY - midShoulderY;
    if (torsoH > 0.01) {
      state.restTorsoHeight = state.restTorsoHeight === null
        ? torsoH
        : Math.min(state.restTorsoHeight, torsoH);
    }
  }

  // -- Track rep start --
  if (prevPhase === 'REST' && state.phase === 'RAISING') {
    state.tRepStart = t;
    state.repWindow = initRepWindow(t, state.restTorsoHeight);
  }

  // -- Track TOP→LOWERING transition (true eccentric start) --
  if (prevPhase === 'TOP' && state.phase === 'LOWERING' && state.repWindow) {
    state.repWindow.tLoweringStart = t;
  }

  // -- Accumulate rep window while in a rep --
  const inRep = state.phase !== 'REST';
  if (state.repWindow && inRep) {
    const w = state.repWindow;
    w.tEnd = t;
    w.frameCount++;

    // Max height ratio (average)
    w.maxHeightRatio = Math.max(w.maxHeightRatio, fastAvgHeightRatio);
    // Per-arm max height ratio
    w.maxLeftHeightRatio = Math.max(w.maxLeftHeightRatio, fastLeftHeightRatio);
    w.maxRightHeightRatio = Math.max(w.maxRightHeightRatio, fastRightHeightRatio);
    // Max height ratio difference between arms at this frame
    if (leftHeightConf >= FORM_CONFIDENCE_MIN && rightHeightConf >= FORM_CONFIDENCE_MIN) {
      const heightRatioDiff = Math.abs(smoothedLeftHeightRatio - smoothedRightHeightRatio);
      w.maxHeightRatioDiff = Math.max(w.maxHeightRatioDiff, heightRatioDiff);
    }
    // Min arm straightness ratio (worst bend)
    if (
      leftStraightnessConf >= FORM_CONFIDENCE_MIN &&
      rightStraightnessConf >= FORM_CONFIDENCE_MIN &&
      !isNaN(smoothedLeftStraightness) &&
      !isNaN(smoothedRightStraightness)
    ) {
      const minStraightness = Math.min(smoothedLeftStraightness, smoothedRightStraightness);
      w.minStraightnessRatio = Math.min(w.minStraightnessRatio, minStraightness);
    }
    // Max torso lean
    if (torsoConf >= FORM_CONFIDENCE_MIN && !isNaN(smoothedTorsoLean)) {
      w.maxTorsoLean = Math.max(w.maxTorsoLean, smoothedTorsoLean);
    }

    // Shoulder shrug detection via shoulder ELEVATION above rest baseline.
    //
    // When shrugging, shoulders RISE (midShoulderY decreases in image coords where Y=0
    // is the top). This makes torsoHeight = midHipY − midShoulderY INCREASE.
    // elevation = (current − baseline) / baseline × 100 is therefore POSITIVE when
    // shrugging, which is the correct sign.
    //
    // The old formula used (baseline − current), which produced a NEGATIVE value for
    // shrugging and fired spuriously on noise/sway instead.
    if (allTorsoVisible && torsoConf >= FORM_CONFIDENCE_MIN) {
      const midShoulderY = (ls!.y + rs!.y) / 2;
      const midHipY = (lh!.y + rh!.y) / 2;
      const torsoHeight = midHipY - midShoulderY; // increases when shoulders rise
      if (torsoHeight > 0.01) {
        // Seed baseline from rest-state height (captured before rep started) if available.
        if (w.baselineTorsoHeight === null) {
          w.baselineTorsoHeight = torsoHeight;
        }
        const elevation = (torsoHeight - w.baselineTorsoHeight) / w.baselineTorsoHeight * 100;
        if (elevation > 0) {
          w.maxShrugPct = Math.max(w.maxShrugPct, elevation);
        }
      }
    }

    // Record TOP timestamp
    if (state.phase === 'TOP' && w.tTop === null) {
      w.tTop = t;
    }
  }

  // -- Handle rep completion --
  if (fsmResult.repCompleted && state.repWindow) {
    state.repCount++;

    const score = computeRepWindowScore(state.repWindow);
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

  // -- Handle aborted raise (RAISING -> REST without rep completion) --
  if (prevPhase === 'RAISING' && state.phase === 'REST' && !fsmResult.repCompleted) {
    if (state.repWindow) {
      const w = state.repWindow;
      w.tEnd = t;
      w.maxHeightRatio = Math.max(w.maxHeightRatio, fastAvgHeightRatio);
      w.maxLeftHeightRatio = Math.max(w.maxLeftHeightRatio, fastLeftHeightRatio);
      w.maxRightHeightRatio = Math.max(w.maxRightHeightRatio, fastRightHeightRatio);
      if (leftHeightConf >= FORM_CONFIDENCE_MIN && rightHeightConf >= FORM_CONFIDENCE_MIN) {
        w.maxHeightRatioDiff = Math.max(
          w.maxHeightRatioDiff,
          Math.abs(smoothedLeftHeightRatio - smoothedRightHeightRatio),
        );
      }
      if (
        leftStraightnessConf >= FORM_CONFIDENCE_MIN &&
        rightStraightnessConf >= FORM_CONFIDENCE_MIN &&
        !isNaN(smoothedLeftStraightness) &&
        !isNaN(smoothedRightStraightness)
      ) {
        w.minStraightnessRatio = Math.min(
          w.minStraightnessRatio,
          smoothedLeftStraightness,
          smoothedRightStraightness,
        );
      }
      if (torsoConf >= FORM_CONFIDENCE_MIN && !isNaN(smoothedTorsoLean)) {
        w.maxTorsoLean = Math.max(w.maxTorsoLean, smoothedTorsoLean);
      }

      const duration = w.tEnd - w.tStart;
      if (isMeaningfulPartialRep({
        actualRom: w.maxHeightRatio,
        minRom: THRESHOLDS.MIN_PARTIAL_HEIGHT_RATIO,
        duration,
        minDuration: THRESHOLDS.MIN_REP_TIME,
      })) {
        state.repCount++;
        const score = computeRepWindowScore(w);
        const messages = generateFormMessages(w);
        state.lastRepResult = {
          repIndex: state.repCount,
          score,
          messages,
        };
        state.feedback = messages.length > 0 ? messages.join('\n') : 'Good rep.';
        state.lastFeedbackTime = t;
      } else if (w.maxHeightRatio > 0) {
        state.feedback = LOW_ROM_FEEDBACK;
        state.lastFeedbackTime = t;
      }
    }
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

function getDebugInfo(state: LateralRaiseState): LateralRaiseDebugInfo {
  const fmt = (v: number): number | null =>
    !isNaN(v) && isFinite(v) ? v : null;

  const w = state.repWindow;
  return {
    phase: state.phase,
    warmedUp: state.warmedUp,
    leftHeightRatio: fmt(state.smoothedLeftHeightRatio),
    rightHeightRatio: fmt(state.smoothedRightHeightRatio),
    avgHeightRatio: fmt(state.smoothedAvgHeightRatio),
    leftStraightness: fmt(state.smoothedLeftStraightness),
    rightStraightness: fmt(state.smoothedRightStraightness),
    torsoLean: fmt(state.smoothedTorsoLean),
    maxHeightRatio: w ? fmt(w.maxHeightRatio) : null,
    maxHeightRatioDiff: w ? fmt(w.maxHeightRatioDiff) : null,
    minStraightness: w ? (w.minStraightnessRatio < 1.0 ? fmt(w.minStraightnessRatio) : null) : null,
    maxTorsoLean: w ? fmt(w.maxTorsoLean) : null,
    shrugPct: w ? fmt(w.maxShrugPct) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createLateralRaiseDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_LATERAL_RAISE_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Standing Dumbbell Lateral Raises',
  requiredView: 'front',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: withLateralRaiseConfig(config, () => initializeState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as LateralRaiseState;
    withLateralRaiseConfig(config, () => updateLateralRaiseState(keypoints, internal));

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

  heuristicConfig: config,
  tunableSpec: LATERAL_RAISE_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/lateralRaise.json',
  createVariant: (variantConfig) =>
    createLateralRaiseDefinition(mergeHeuristicConfig(config, variantConfig)),

  ttsConfig: {
    feedbackToIssue: {
      'Raise higher \u2014 aim for shoulder level.': 'rom_height',
      'Stop around shoulder height \u2014 avoid lifting too high.': 'over_raise',
      'Keep your arms straighter \u2014 avoid excessive elbow bend.': 'elbow_bend',
      'Stay upright \u2014 avoid swaying or leaning.': 'torso_warn',
      'Even it out \u2014 raise both arms to the same height.': 'asymmetry',
      'Control the descent \u2014 lower the weights slowly.': 'tempo_down',
      'Relax your traps \u2014 don\'t shrug the weight up.': 'shoulder_shrug',
    },
    feedbackMessages: {
      'Even it out \u2014 raise both arms to the same height.': [
        'Match both arms.',
        'Raise both sides evenly.',
        'Keep the left and right side level.',
      ],
    },
    issueDefinitions: [
      {
        issueType: 'rom_height',
        priority: 25,
        messages: [
          'Lift a bit higher.',
          'Raise to shoulder height.',
          'Bring the weights to shoulder height.',
        ],
      },
      {
        issueType: 'over_raise',
        priority: 15,
        messages: [
          'Stop at shoulder height.',
          "Don't lift above shoulder level.",
          'Keep it at shoulder height.',
        ],
      },
      {
        issueType: 'elbow_bend',
        priority: 15,
        messages: [
          'Straighten your arms more.',
          'Less bend in the elbows.',
          'Keep your arms long.',
        ],
      },
      {
        issueType: 'shoulder_shrug',
        priority: 20,
        messages: [
          'Relax your shoulders down.',
          'Don\'t shrug, lead with your elbows.',
          'Keep your traps relaxed.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Raise higher \u2014 aim for shoulder level.':
      'Focus on raising the dumbbells to shoulder height for full range of motion.',
    'Stop around shoulder height \u2014 avoid lifting too high.':
      'Stop the raise around shoulder height to keep tension on the side delts and avoid turning the rep into a shrug.',
    'Keep your arms straighter \u2014 avoid excessive elbow bend.':
      'Maintain a slight bend but keep arms mostly straight throughout the lift.',
    'Stay upright \u2014 avoid swaying or leaning.':
      'Brace your core and avoid using momentum to swing the weights up.',
    'Even it out \u2014 raise both arms to the same height.':
      'Focus on raising both arms evenly \u2014 consider using a mirror to check symmetry.',
    'Control the descent \u2014 lower the weights slowly.':
      'Slow the eccentric phase \u2014 aim for 2-3 seconds down.',
    'Relax your traps \u2014 don\'t shrug the weight up.':
      'Focus on leading with your elbows, not your shoulders. If you\'re shrugging, the weight may be too heavy.',
  },
  };
}

export const lateralRaiseDefinition: ExerciseDefinition = createLateralRaiseDefinition();
