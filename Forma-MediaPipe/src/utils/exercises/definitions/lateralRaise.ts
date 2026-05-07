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
  calculateSignedVerticalAngleSagittal,
  getKeypoint,
  isVisible,
  minKeypointConfidence,
} from '../../poseAnalysis';

import type {
  ExerciseDefinition,
  ExerciseFrameContext,
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
import {
  buildRepDiagnostics,
  diagnosticCue,
  diagnosticMetric,
} from '../shared/diagnostics';
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
  /** Minimum outward wrist/elbow reach for a raise to count as lateral, normalized by torso height. */
  LATERAL_REACH_MIN: 0.45,
  /** Concentric tempo threshold (seconds) for swingy raises. */
  TEMPO_RAISE_MIN: 0.30,
  /** Sagittal torso sway threshold (degrees) when world landmarks are available. */
  SAGITTAL_SWAY_WARN: 8,
  /** Hip center displacement threshold, normalized by torso height. */
  HIP_SWAY_WARN: 0.10,
  /** Minimum confident samples before per-frame form cues can trigger. */
  MIN_FORM_SAMPLES: 3,
} as const;

/** Ideal targets used by the scoring system (separate from penalty deadzones) */
const IDEAL = {
  /** Shoulder-level height ratio */
  MAX_HEIGHT_RATIO: 1.0,
  /** Nearly straight arm (straightness ratio) */
  MIN_STRAIGHTNESS: 0.97,
  /** Controlled eccentric time (seconds) */
  ECCENTRIC_TIME: 0.55,
  /** Controlled concentric time (seconds) */
  CONCENTRIC_TIME: 0.35,
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
 * | Wrong plane  | 25  | 0        | 180   | lateral reach shortfall                         |
 * | Tempo raise  | 8   | 0        | 500   | ideal 0.35s - actual concentric time           |
 * | Sag sway     | 15  | 8deg     | 2     | sagittal torso sway from rep baseline          |
 * | Hip sway     | 15  | 0.10     | 800   | hip center displacement ratio                   |
 *
 * Max total penalty: 228 → worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  ROM:            { cap: 50, deadzone: 0,    scale: 500  } as PenaltyConfig,
  ARM_STRAIGHT:   { cap: 20, deadzone: 0.05, scale: 1500 } as PenaltyConfig,
  TORSO_LEAN:     { cap: 25, deadzone: 1.8,  scale: 200  } as PenaltyConfig,
  TEMPO_LOWER:    { cap: 35, deadzone: 0.05, scale: 1800 } as PenaltyConfig,
  ASYMMETRY:      { cap: 15, deadzone: 0.08, scale: 800  } as PenaltyConfig,
  SHRUG:          { cap: 20, deadzone: 10,   scale: 0.50 } as PenaltyConfig,
  OVER_RAISE:     { cap: 10, deadzone: 0.10, scale: 500  } as PenaltyConfig,
  LATERAL_PATH:   { cap: 25, deadzone: 0,    scale: 180  } as PenaltyConfig,
  TEMPO_RAISE:    { cap: 8,  deadzone: 0,    scale: 500  } as PenaltyConfig,
  SAGITTAL_SWAY:  { cap: 15, deadzone: 8,    scale: 2    } as PenaltyConfig,
  HIP_SWAY:       { cap: 15, deadzone: 0.10, scale: 800  } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;
const FORM_CONFIDENCE_MIN = 0.3;
const VIEW_ANGLE_EMA = 0.25;
const FRONT_VIEW_MAX = 25;
const OBLIQUE_VIEW_MAX = 55;
const FRONT_VIEW_MIN_SAMPLES = 3;
const FRONT_VIEW_WARN_SAMPLE_RATIO = 0.5;

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
LATERAL_RAISE_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'standing-dumbbell-lateral-raises.rom_height', metricKey: 'peakHeightRatio', thresholdPath: 'formThresholds.ROM_MIN', direction: 'below' },
  { issueId: 'standing-dumbbell-lateral-raises.over_raise', metricKey: 'peakHeightRatio', thresholdPath: 'formThresholds.OVER_RAISE_WARN', direction: 'above' },
  { issueId: 'standing-dumbbell-lateral-raises.elbow_bend', metricKey: 'minStraightnessRatio', thresholdPath: 'formThresholds.ELBOW_STRAIGHTNESS_WARN', direction: 'below' },
  { issueId: 'standing-dumbbell-lateral-raises.torso_warn', metricKey: 'torsoLean', thresholdPath: 'formThresholds.TORSO_LEAN_WARN', direction: 'above' },
  { issueId: 'standing-dumbbell-lateral-raises.asymmetry', metricKey: 'topHeightAsymmetry', thresholdPath: 'formThresholds.ASYMMETRY_WARN', direction: 'above' },
  { issueId: 'standing-dumbbell-lateral-raises.tempo_down', metricKey: 'tLower', thresholdPath: 'formThresholds.TEMPO_LOWER_MIN', direction: 'below' },
  { issueId: 'standing-dumbbell-lateral-raises.shoulder_shrug', metricKey: 'shrugPct', thresholdPath: 'formThresholds.SHRUG_WARN', direction: 'above' },
  { issueId: 'standing-dumbbell-lateral-raises.wrong_plane', metricKey: 'peakLateralReachRatio', thresholdPath: 'formThresholds.LATERAL_REACH_MIN', direction: 'below' },
  { issueId: 'standing-dumbbell-lateral-raises.tempo_up', metricKey: 'tRaise', thresholdPath: 'formThresholds.TEMPO_RAISE_MIN', direction: 'below' },
];

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
type ViewDiagnostic = 'front' | 'side' | 'oblique' | 'unknown';

interface ViewAngleEstimate {
  angleDeg: number | null;
  smoothedAngleDeg: number | null;
  zone: ViewDiagnostic;
  skippedReason?: 'world_landmarks_unavailable' | 'insufficient_front_view_samples';
}

interface RepFrameMetrics {
  t: number;
  phase: LateralRaisePhase;
  avgHeightRatio: number;
  leftHeightRatio: number;
  rightHeightRatio: number;
  avgLateralReach: number;
  leftLateralReach: number;
  rightLateralReach: number;
  lateralReachConf: number;
  leftHeightConf: number;
  rightHeightConf: number;
  leftStraightness: number;
  rightStraightness: number;
  leftStraightnessConf: number;
  rightStraightnessConf: number;
  torsoLean: number;
  torsoConf: number;
  sagittalTorsoAngle: number | null;
  worldTorsoConf: number;
  hipCenter: { x: number; y: number } | null;
  torsoHeight: number | null;
  shoulderHeadGap: number | null;
  headShrugConf: number;
  viewAngle: ViewAngleEstimate;
}

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
  /** Sustained average height difference between arms near the top */
  topHeightAsymmetry: number;
  /** Sum for sustained top-phase asymmetry */
  topHeightAsymmetrySum: number;
  /** Min arm straightness ratio during the rep (lower = more bent) */
  minStraightnessRatio: number;
  /** Max torso lateral lean during the rep (degrees — already camera-invariant) */
  maxTorsoLean: number;
  /** Max torso sway in the sagittal plane from the rep baseline (degrees) */
  maxSagittalTorsoSway: number;
  /** Max hip center displacement from rep start, normalized by torso height */
  maxHipSwayRatio: number;
  /** Baseline sagittal torso angle at rep start */
  baselineSagittalTorsoAngle: number | null;
  /** Baseline hip center at rep start */
  baselineHipCenter: { x: number; y: number } | null;
  /** Baseline torso height at rep start (for shrug detection) */
  baselineTorsoHeight: number | null;
  /** Baseline shoulder-to-head gap at rep start/rest (for optional shrug support) */
  baselineShoulderHeadGap: number | null;
  /** Max shoulder shrug as percentage of torso height (already ratio-based) */
  maxShrugPct: number;
  /** Max head-relative shoulder shrug percentage when head landmarks are visible */
  maxHeadShrugPct: number;
  /** Max average outward wrist/elbow reach near top, normalized by torso height */
  maxLateralReachRatio: number;
  /** Per-arm lateral reach peaks */
  maxLeftLateralReachRatio: number;
  maxRightLateralReachRatio: number;
  /** Front-view/yaw quality gate samples */
  lastViewAngleDeg: number | null;
  maxViewAngleDeg: number;
  viewAngleSampleCount: number;
  frontViewSampleCount: number;
  nonFrontViewSampleCount: number;
  viewAngleSkippedReason: 'world_landmarks_unavailable' | 'insufficient_front_view_samples' | null;
  /** Confident sample counts for per-frame metrics */
  straightnessSampleCount: number;
  torsoSampleCount: number;
  asymmetrySampleCount: number;
  topFrameCount: number;
  lateralReachSampleCount: number;
  shrugSampleCount: number;
  headShrugSampleCount: number;
  sagittalSwaySampleCount: number;
  hipSwaySampleCount: number;
  torsoWarnSampleCount: number;
  sagittalSwayWarnSampleCount: number;
  hipSwayWarnSampleCount: number;
  shrugWarnSampleCount: number;
  headShrugWarnSampleCount: number;
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
  leftLateralReachTracker: SmoothedAngleTracker;
  rightLateralReachTracker: SmoothedAngleTracker;
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
  /** Shoulder/head gap captured during relaxed REST frames for optional shrug support. */
  restShoulderHeadGap: number | null;
  /** Current smoothed values (for debug) */
  smoothedLeftHeightRatio: number;
  smoothedRightHeightRatio: number;
  smoothedAvgHeightRatio: number;
  smoothedLeftStraightness: number;
  smoothedRightStraightness: number;
  smoothedLeftLateralReach: number;
  smoothedRightLateralReach: number;
  smoothedAvgLateralReach: number;
  smoothedTorsoLean: number;
  /** Smoothed yaw estimate used to decide whether front-view form is scorable. */
  viewAngleSmoothedDeg: number | null;
  /** Visual feedback */
  feedback: string | null;
  lastFeedbackTime: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
  scorable?: boolean;
  qualityWarnings?: FrameworkRepResult['qualityWarnings'];
  diagnostics?: FrameworkRepResult['diagnostics'];
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
  lateralReachRatio: number | null;
  maxHeightRatio: number | null;
  maxHeightRatioDiff: number | null;
  topHeightAsymmetry: number | null;
  maxLateralReachRatio: number | null;
  minStraightness: number | null;
  maxTorsoLean: number | null;
  maxSagittalTorsoSway: number | null;
  maxHipSwayRatio: number | null;
  shrugPct: number | null;
  viewAngleDeg: number | null;
  maxViewAngleDeg: number | null;
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
    leftLateralReachTracker: new SmoothedAngleTracker(),
    rightLateralReachTracker: new SmoothedAngleTracker(),
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
    restShoulderHeadGap: null,
    smoothedLeftHeightRatio: 0,
    smoothedRightHeightRatio: 0,
    smoothedAvgHeightRatio: 0,
    smoothedLeftStraightness: 1.0,
    smoothedRightStraightness: 1.0,
    smoothedLeftLateralReach: 0,
    smoothedRightLateralReach: 0,
    smoothedAvgLateralReach: 0,
    smoothedTorsoLean: 0,
    viewAngleSmoothedDeg: null,
    feedback: null,
    lastFeedbackTime: 0,
  };
}

function initRepWindow(
  tStart: number,
  baselineTorsoHeight: number | null,
  baselineShoulderHeadGap: number | null,
  baselineSagittalTorsoAngle: number | null,
  baselineHipCenter: { x: number; y: number } | null,
): RepWindow {
  return {
    tStart,
    tTop: null,
    tLoweringStart: null,
    tEnd: tStart,
    maxHeightRatio: 0,
    maxLeftHeightRatio: 0,
    maxRightHeightRatio: 0,
    maxHeightRatioDiff: 0,
    topHeightAsymmetry: 0,
    topHeightAsymmetrySum: 0,
    minStraightnessRatio: 1.0,
    maxTorsoLean: 0,
    maxSagittalTorsoSway: 0,
    maxHipSwayRatio: 0,
    baselineSagittalTorsoAngle,
    baselineHipCenter,
    baselineTorsoHeight,
    baselineShoulderHeadGap,
    maxShrugPct: 0,
    maxHeadShrugPct: 0,
    maxLateralReachRatio: 0,
    maxLeftLateralReachRatio: 0,
    maxRightLateralReachRatio: 0,
    lastViewAngleDeg: null,
    maxViewAngleDeg: 0,
    viewAngleSampleCount: 0,
    frontViewSampleCount: 0,
    nonFrontViewSampleCount: 0,
    viewAngleSkippedReason: null,
    straightnessSampleCount: 0,
    torsoSampleCount: 0,
    asymmetrySampleCount: 0,
    topFrameCount: 0,
    lateralReachSampleCount: 0,
    shrugSampleCount: 0,
    headShrugSampleCount: 0,
    sagittalSwaySampleCount: 0,
    hipSwaySampleCount: 0,
    torsoWarnSampleCount: 0,
    sagittalSwayWarnSampleCount: 0,
    hipSwayWarnSampleCount: 0,
    shrugWarnSampleCount: 0,
    headShrugWarnSampleCount: 0,
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
  const torsoHeight = Math.abs(midHipY - midShoulderY);
  if (torsoHeight < 0.01) return 0;

  // Image landmarks are Y-down (hipY > shoulderY); MediaPipe world landmarks are
  // usually Y-up. The sign branch keeps the fallback coordinate-safe.
  return midHipY >= midShoulderY
    ? (midHipY - wrist.y) / torsoHeight
    : (wrist.y - midHipY) / torsoHeight;
}

function computeTorsoHeight(
  leftHip: Keypoint,
  rightHip: Keypoint,
  leftShoulder: Keypoint,
  rightShoulder: Keypoint,
): number {
  const midHipY = (leftHip.y + rightHip.y) / 2;
  const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  return Math.abs(midHipY - midShoulderY);
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
 * Compute outward reach from the same-side shoulder, normalized by torso height.
 * Wrist reach is primary; elbow reach is doubled as a fallback approximation when
 * wrists are not visible.
 */
function computeLateralReachRatio(
  side: 'left' | 'right',
  shoulder: Keypoint,
  elbow: Keypoint,
  wrist: Keypoint | null,
  leftHip: Keypoint,
  rightHip: Keypoint,
  leftShoulder: Keypoint,
  rightShoulder: Keypoint,
): number {
  const torsoHeight = computeTorsoHeight(leftHip, rightHip, leftShoulder, rightShoulder);
  if (torsoHeight < 0.01) return 0;

  const midShoulderX = (leftShoulder.x + rightShoulder.x) / 2;
  const outward = shoulder.x === midShoulderX
    ? side === 'left' ? -1 : 1
    : Math.sign(shoulder.x - midShoulderX);
  const wristReach = wrist ? Math.max(0, (wrist.x - shoulder.x) * outward) / torsoHeight : NaN;
  const elbowReach = Math.max(0, (elbow.x - shoulder.x) * outward) / torsoHeight;
  return Number.isFinite(wristReach) ? wristReach : elbowReach * 2;
}

function computeHipCenter(leftHip: Keypoint, rightHip: Keypoint): { x: number; y: number } {
  return {
    x: (leftHip.x + rightHip.x) / 2,
    y: (leftHip.y + rightHip.y) / 2,
  };
}

function computeShoulderHeadGap(keypoints: Keypoint[]): number | null {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  if (!isVisible(ls, VISIBILITY_THRESHOLD) || !isVisible(rs, VISIBILITY_THRESHOLD)) return null;

  const headCandidates = ['nose', 'left_ear', 'right_ear']
    .map((name) => getKeypoint(keypoints, name))
    .filter((point): point is Keypoint => isVisible(point, VISIBILITY_THRESHOLD));
  if (headCandidates.length === 0) return null;

  const midShoulderY = (ls.y + rs.y) / 2;
  const headY = headCandidates.reduce((best, point) => Math.min(best, point.y), headCandidates[0].y);
  const gap = Math.abs(midShoulderY - headY);
  return gap > 0.01 ? gap : null;
}

function computeSagittalTorsoAngle(worldKeypoints: Keypoint[] | undefined): number | null {
  if (!worldKeypoints) return null;
  const ls = getKeypoint(worldKeypoints, 'left_shoulder');
  const rs = getKeypoint(worldKeypoints, 'right_shoulder');
  const lh = getKeypoint(worldKeypoints, 'left_hip');
  const rh = getKeypoint(worldKeypoints, 'right_hip');
  if (
    !isVisible(ls, VISIBILITY_THRESHOLD) ||
    !isVisible(rs, VISIBILITY_THRESHOLD) ||
    !isVisible(lh, VISIBILITY_THRESHOLD) ||
    !isVisible(rh, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  const hipCenter = {
    x: (lh.x + rh.x) / 2,
    y: (lh.y + rh.y) / 2,
    z: ((lh.z ?? 0) + (rh.z ?? 0)) / 2,
  };
  const shoulderCenter = {
    x: (ls.x + rs.x) / 2,
    y: (ls.y + rs.y) / 2,
    z: ((ls.z ?? 0) + (rs.z ?? 0)) / 2,
  };
  const angle = calculateSignedVerticalAngleSagittal(hipCenter, shoulderCenter, lh, rh, ls, rs);
  return Number.isFinite(angle) ? angle : null;
}

function classifyFrontViewAngle(angleDeg: number): ViewDiagnostic {
  if (angleDeg < FRONT_VIEW_MAX) return 'front';
  if (angleDeg < OBLIQUE_VIEW_MAX) return 'oblique';
  return 'side';
}

function estimateFrontViewAngle(
  worldKeypoints: Keypoint[] | undefined,
  previousSmoothedDeg: number | null,
): ViewAngleEstimate {
  if (!worldKeypoints) {
    return {
      angleDeg: null,
      smoothedAngleDeg: null,
      zone: 'unknown',
      skippedReason: 'world_landmarks_unavailable',
    };
  }

  const ls = getKeypoint(worldKeypoints, 'left_shoulder');
  const rs = getKeypoint(worldKeypoints, 'right_shoulder');
  if (
    !isVisible(ls, VISIBILITY_THRESHOLD) ||
    !isVisible(rs, VISIBILITY_THRESHOLD) ||
    minKeypointConfidence(worldKeypoints, ['left_shoulder', 'right_shoulder']) < FORM_CONFIDENCE_MIN
  ) {
    return {
      angleDeg: null,
      smoothedAngleDeg: null,
      zone: 'unknown',
      skippedReason: 'insufficient_front_view_samples',
    };
  }

  const dx = Math.abs(rs!.x - ls!.x);
  const dz = Math.abs((rs!.z ?? 0) - (ls!.z ?? 0));
  const angleDeg = Math.atan2(dz, Math.max(dx, 1e-6)) * (180 / Math.PI);
  const smoothedAngleDeg = previousSmoothedDeg === null
    ? angleDeg
    : VIEW_ANGLE_EMA * angleDeg + (1 - VIEW_ANGLE_EMA) * previousSmoothedDeg;

  return {
    angleDeg,
    smoothedAngleDeg,
    zone: classifyFrontViewAngle(smoothedAngleDeg),
  };
}

function nonFrontViewSampleRatio(repWindow: RepWindow): number | null {
  if (repWindow.viewAngleSampleCount === 0) return null;
  return repWindow.nonFrontViewSampleCount / repWindow.viewAngleSampleCount;
}

function hasEnoughViewAngleSamples(repWindow: RepWindow): boolean {
  return repWindow.viewAngleSampleCount >= FRONT_VIEW_MIN_SAMPLES;
}

function isLateralRaiseRepScorable(repWindow: RepWindow): boolean {
  const ratio = nonFrontViewSampleRatio(repWindow);
  if (!hasEnoughViewAngleSamples(repWindow) || ratio === null) return true;
  return ratio < FRONT_VIEW_WARN_SAMPLE_RATIO;
}

function lateralRaiseQualityWarnings(repWindow: RepWindow): FrameworkRepResult['qualityWarnings'] {
  return isLateralRaiseRepScorable(repWindow) ? [] : ['front_view_uncertain'];
}

function diagnosticView(repWindow: RepWindow): ViewDiagnostic {
  if (!hasEnoughViewAngleSamples(repWindow)) return 'unknown';
  return classifyFrontViewAngle(repWindow.maxViewAngleDeg);
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

function hasEnoughSamples(count: number): boolean {
  return count >= FORM_THRESHOLDS.MIN_FORM_SAMPLES;
}

function accumulateRepWindowFrame(repWindow: RepWindow, metrics: RepFrameMetrics): void {
  repWindow.tEnd = metrics.t;
  repWindow.frameCount++;

  repWindow.maxHeightRatio = Math.max(repWindow.maxHeightRatio, metrics.avgHeightRatio);
  repWindow.maxLeftHeightRatio = Math.max(repWindow.maxLeftHeightRatio, metrics.leftHeightRatio);
  repWindow.maxRightHeightRatio = Math.max(repWindow.maxRightHeightRatio, metrics.rightHeightRatio);

  const nearTop = metrics.avgHeightRatio >= THRESHOLDS.TOP_EXIT;
  if (
    nearTop &&
    metrics.lateralReachConf >= FORM_CONFIDENCE_MIN &&
    Number.isFinite(metrics.avgLateralReach)
  ) {
    repWindow.lateralReachSampleCount++;
    repWindow.maxLateralReachRatio = Math.max(repWindow.maxLateralReachRatio, metrics.avgLateralReach);
    repWindow.maxLeftLateralReachRatio = Math.max(repWindow.maxLeftLateralReachRatio, metrics.leftLateralReach);
    repWindow.maxRightLateralReachRatio = Math.max(repWindow.maxRightLateralReachRatio, metrics.rightLateralReach);
  }

  if (metrics.leftHeightConf >= FORM_CONFIDENCE_MIN && metrics.rightHeightConf >= FORM_CONFIDENCE_MIN) {
    const heightRatioDiff = Math.abs(metrics.leftHeightRatio - metrics.rightHeightRatio);
    repWindow.maxHeightRatioDiff = Math.max(repWindow.maxHeightRatioDiff, heightRatioDiff);
    repWindow.asymmetrySampleCount++;
    if (nearTop) {
      repWindow.topFrameCount++;
      repWindow.topHeightAsymmetrySum += heightRatioDiff;
      repWindow.topHeightAsymmetry = repWindow.topHeightAsymmetrySum / repWindow.topFrameCount;
    }
  }

  if (
    metrics.leftStraightnessConf >= FORM_CONFIDENCE_MIN &&
    metrics.rightStraightnessConf >= FORM_CONFIDENCE_MIN &&
    Number.isFinite(metrics.leftStraightness) &&
    Number.isFinite(metrics.rightStraightness)
  ) {
    const minStraightness = Math.min(metrics.leftStraightness, metrics.rightStraightness);
    repWindow.minStraightnessRatio = Math.min(repWindow.minStraightnessRatio, minStraightness);
    repWindow.straightnessSampleCount++;
  }

  if (metrics.torsoConf >= FORM_CONFIDENCE_MIN && Number.isFinite(metrics.torsoLean)) {
    repWindow.maxTorsoLean = Math.max(repWindow.maxTorsoLean, metrics.torsoLean);
    repWindow.torsoSampleCount++;
    if (metrics.torsoLean > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
      repWindow.torsoWarnSampleCount++;
    }
  }

  if (metrics.sagittalTorsoAngle !== null && metrics.worldTorsoConf >= FORM_CONFIDENCE_MIN) {
    if (repWindow.baselineSagittalTorsoAngle === null) {
      repWindow.baselineSagittalTorsoAngle = metrics.sagittalTorsoAngle;
    }
    const sagittalSway = Math.abs(metrics.sagittalTorsoAngle - repWindow.baselineSagittalTorsoAngle);
    repWindow.maxSagittalTorsoSway = Math.max(repWindow.maxSagittalTorsoSway, sagittalSway);
    if (sagittalSway > FORM_THRESHOLDS.SAGITTAL_SWAY_WARN) {
      repWindow.sagittalSwayWarnSampleCount++;
    }
    repWindow.sagittalSwaySampleCount++;
  }

  if (
    metrics.hipCenter &&
    repWindow.baselineHipCenter &&
    metrics.torsoHeight !== null &&
    metrics.torsoHeight > 0.01 &&
    metrics.torsoConf >= FORM_CONFIDENCE_MIN
  ) {
    const dx = metrics.hipCenter.x - repWindow.baselineHipCenter.x;
    const dy = metrics.hipCenter.y - repWindow.baselineHipCenter.y;
    const hipSwayRatio = Math.sqrt(dx * dx + dy * dy) / metrics.torsoHeight;
    repWindow.maxHipSwayRatio = Math.max(repWindow.maxHipSwayRatio, hipSwayRatio);
    if (hipSwayRatio > FORM_THRESHOLDS.HIP_SWAY_WARN) {
      repWindow.hipSwayWarnSampleCount++;
    }
    repWindow.hipSwaySampleCount++;
  }

  if (metrics.torsoHeight !== null && metrics.torsoHeight > 0.01 && metrics.torsoConf >= FORM_CONFIDENCE_MIN) {
    if (repWindow.baselineTorsoHeight === null) {
      repWindow.baselineTorsoHeight = metrics.torsoHeight;
    }
    const elevation = (metrics.torsoHeight - repWindow.baselineTorsoHeight) / repWindow.baselineTorsoHeight * 100;
    if (elevation > 0) {
      repWindow.maxShrugPct = Math.max(repWindow.maxShrugPct, elevation);
    }
    if (elevation > FORM_THRESHOLDS.SHRUG_WARN) {
      repWindow.shrugWarnSampleCount++;
    }
    repWindow.shrugSampleCount++;
  }

  if (metrics.shoulderHeadGap !== null && metrics.headShrugConf >= FORM_CONFIDENCE_MIN) {
    if (repWindow.baselineShoulderHeadGap === null) {
      repWindow.baselineShoulderHeadGap = metrics.shoulderHeadGap;
    }
    const headShrug = (repWindow.baselineShoulderHeadGap - metrics.shoulderHeadGap) / repWindow.baselineShoulderHeadGap * 100;
    if (headShrug > 0) {
      repWindow.maxHeadShrugPct = Math.max(repWindow.maxHeadShrugPct, headShrug);
    }
    if (headShrug > FORM_THRESHOLDS.SHRUG_WARN) {
      repWindow.headShrugWarnSampleCount++;
    }
    repWindow.headShrugSampleCount++;
  }

  if (metrics.viewAngle.smoothedAngleDeg !== null) {
    repWindow.lastViewAngleDeg = metrics.viewAngle.smoothedAngleDeg;
    repWindow.maxViewAngleDeg = Math.max(repWindow.maxViewAngleDeg, metrics.viewAngle.smoothedAngleDeg);
    repWindow.viewAngleSampleCount++;
    if (metrics.viewAngle.zone === 'front') {
      repWindow.frontViewSampleCount++;
    } else {
      repWindow.nonFrontViewSampleCount++;
    }
  } else if (repWindow.viewAngleSampleCount === 0 && metrics.viewAngle.skippedReason) {
    repWindow.viewAngleSkippedReason = metrics.viewAngle.skippedReason;
  }

  if (metrics.phase === 'TOP' && repWindow.tTop === null) {
    repWindow.tTop = metrics.t;
  }
}

function effectiveShrugPct(repWindow: RepWindow): number {
  const torsoShrug = hasEnoughSamples(repWindow.shrugWarnSampleCount) ? repWindow.maxShrugPct : 0;
  const headShrug = hasEnoughSamples(repWindow.headShrugWarnSampleCount) ? repWindow.maxHeadShrugPct : 0;
  return Math.max(torsoShrug, headShrug);
}

function torsoWarningTriggered(repWindow: RepWindow): boolean {
  return (
    (hasEnoughSamples(repWindow.torsoWarnSampleCount) && repWindow.maxTorsoLean > FORM_THRESHOLDS.TORSO_LEAN_WARN) ||
    (hasEnoughSamples(repWindow.sagittalSwayWarnSampleCount) && repWindow.maxSagittalTorsoSway > FORM_THRESHOLDS.SAGITTAL_SWAY_WARN) ||
    (hasEnoughSamples(repWindow.hipSwayWarnSampleCount) && repWindow.maxHipSwayRatio > FORM_THRESHOLDS.HIP_SWAY_WARN)
  );
}

function computeRepWindowScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM shortfall — ideal is ratio 1.0 (shoulder level). FSM ensures ≥0.85.
  const romShortfall = Math.max(0, IDEAL.MAX_HEIGHT_RATIO - repWindow.maxHeightRatio);
  penalties.push({ value: romShortfall, config: PENALTY_CONFIGS.ROM });

  // 2. Arm straightness — ideal is 0.97 (slight bend OK). Lower = more bend = worse.
  if (hasEnoughSamples(repWindow.straightnessSampleCount)) {
    const straightnessDeficit = Math.max(0, IDEAL.MIN_STRAIGHTNESS - repWindow.minStraightnessRatio);
    penalties.push({ value: straightnessDeficit, config: PENALTY_CONFIGS.ARM_STRAIGHT });
  }

  // 3. Torso lean — lower is better (deadzone handles small amounts)
  if (hasEnoughSamples(repWindow.torsoSampleCount)) {
    penalties.push({ value: repWindow.maxTorsoLean, config: PENALTY_CONFIGS.TORSO_LEAN });
  }
  if (hasEnoughSamples(repWindow.sagittalSwaySampleCount)) {
    penalties.push({ value: repWindow.maxSagittalTorsoSway, config: PENALTY_CONFIGS.SAGITTAL_SWAY });
  }
  if (hasEnoughSamples(repWindow.hipSwaySampleCount)) {
    penalties.push({ value: repWindow.maxHipSwayRatio, config: PENALTY_CONFIGS.HIP_SWAY });
  }

  // 4. Tempo — lightly penalize swingy raises and uncontrolled descents.
  if (repWindow.tTop !== null) {
    const tRaise = repWindow.tTop - repWindow.tStart;
    if (tRaise > 0 && tRaise < IDEAL.CONCENTRIC_TIME) {
      penalties.push({ value: IDEAL.CONCENTRIC_TIME - tRaise, config: PENALTY_CONFIGS.TEMPO_RAISE });
    }
  }
  if (repWindow.tLoweringStart !== null) {
    const tLower = repWindow.tEnd - repWindow.tLoweringStart;
    if (tLower > 0 && tLower < IDEAL.ECCENTRIC_TIME) {
      const deficit = IDEAL.ECCENTRIC_TIME - tLower;
      penalties.push({ value: deficit, config: PENALTY_CONFIGS.TEMPO_LOWER });
    }
  }

  // 5. Asymmetry — sustained top-phase difference between arms.
  if (hasEnoughSamples(repWindow.topFrameCount)) {
    penalties.push({ value: repWindow.topHeightAsymmetry, config: PENALTY_CONFIGS.ASYMMETRY });
  }

  // 6. Shoulder shrug — torso-height or optional head-relative support.
  penalties.push({ value: effectiveShrugPct(repWindow), config: PENALTY_CONFIGS.SHRUG });

  // 7. Over-raising — above shoulder level shifts tension and often invites shrugging.
  const overRaise = Math.max(0, repWindow.maxHeightRatio - IDEAL.MAX_HEIGHT_RATIO);
  penalties.push({ value: overRaise, config: PENALTY_CONFIGS.OVER_RAISE });

  // 8. Wrong plane — height without enough outward reach is a front/scaption raise.
  if (hasEnoughSamples(repWindow.lateralReachSampleCount)) {
    const lateralReachShortfall = Math.max(0, FORM_THRESHOLDS.LATERAL_REACH_MIN - repWindow.maxLateralReachRatio);
    penalties.push({ value: lateralReachShortfall, config: PENALTY_CONFIGS.LATERAL_PATH });
  }

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
  if (
    hasEnoughSamples(repWindow.straightnessSampleCount) &&
    repWindow.minStraightnessRatio < FORM_THRESHOLDS.ELBOW_STRAIGHTNESS_WARN
  ) {
    messages.push('Keep your arms straighter \u2014 avoid excessive elbow bend.');
  }

  // 4. Torso lean/sway
  if (torsoWarningTriggered(repWindow)) {
    messages.push('Stay upright \u2014 avoid swaying or leaning.');
  }

  // 5. Asymmetry (sustained near top, not single-frame spikes)
  if (
    hasEnoughSamples(repWindow.topFrameCount) &&
    repWindow.topHeightAsymmetry > FORM_THRESHOLDS.ASYMMETRY_WARN
  ) {
    messages.push('Even it out \u2014 raise both arms to the same height.');
  }

  // 6. Raise tempo
  if (repWindow.tTop !== null) {
    const tRaise = repWindow.tTop - repWindow.tStart;
    if (tRaise > 0 && tRaise < FORM_THRESHOLDS.TEMPO_RAISE_MIN) {
      messages.push('Lift with control \u2014 avoid swinging the weights up.');
    }
  }

  // 7. Eccentric tempo
  if (repWindow.tLoweringStart !== null) {
    const tLower = repWindow.tEnd - repWindow.tLoweringStart;
    if (tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN) {
      messages.push('Control the descent \u2014 lower the weights slowly.');
    }
  }

  // 8. Shoulder shrug
  if (effectiveShrugPct(repWindow) > FORM_THRESHOLDS.SHRUG_WARN) {
    messages.push('Relax your traps \u2014 don\'t shrug the weight up.');
  }

  // 9. Wrong plane
  if (
    hasEnoughSamples(repWindow.lateralReachSampleCount) &&
    repWindow.maxLateralReachRatio < FORM_THRESHOLDS.LATERAL_REACH_MIN
  ) {
    messages.push('Raise out to your sides \u2014 avoid turning it into a front raise.');
  }

  return messages;
}

function buildLateralRaiseRepResult(repWindow: RepWindow, repIndex: number): RepResult {
  return {
    repIndex,
    score: computeRepWindowScore(repWindow),
    messages: generateFormMessages(repWindow),
    scorable: isLateralRaiseRepScorable(repWindow),
    qualityWarnings: lateralRaiseQualityWarnings(repWindow),
    diagnostics: buildLateralRaiseDiagnostics(repWindow, repIndex),
  };
}

function buildLateralRaiseDiagnostics(
  repWindow: RepWindow,
  repIndex: number,
): FrameworkRepResult['diagnostics'] {
  const hasLowering = repWindow.tLoweringStart !== null;
  const tLower = repWindow.tLoweringStart !== null ? repWindow.tEnd - repWindow.tLoweringStart : null;
  const tRaise = repWindow.tTop !== null ? repWindow.tTop - repWindow.tStart : null;
  const hasStraightness = hasEnoughSamples(repWindow.straightnessSampleCount) && Number.isFinite(repWindow.minStraightnessRatio);
  const hasTopAsymmetry = hasEnoughSamples(repWindow.topFrameCount);
  const hasLateralReach = hasEnoughSamples(repWindow.lateralReachSampleCount);
  const hasTorsoLean = hasEnoughSamples(repWindow.torsoSampleCount);
  const hasSagittalSway = hasEnoughSamples(repWindow.sagittalSwaySampleCount);
  const hasHipSway = hasEnoughSamples(repWindow.hipSwaySampleCount);
  const hasShrug = hasEnoughSamples(repWindow.shrugSampleCount) || hasEnoughSamples(repWindow.headShrugSampleCount);
  const hasViewAngle = hasEnoughViewAngleSamples(repWindow);
  const hasAnyViewAngle = repWindow.viewAngleSampleCount > 0;
  const viewSkippedReason = hasAnyViewAngle
    ? 'insufficient_front_view_samples'
    : repWindow.viewAngleSkippedReason ?? 'world_landmarks_unavailable';
  const nonFrontRatio = nonFrontViewSampleRatio(repWindow);
  const shrugMetricPct = Math.max(
    hasEnoughSamples(repWindow.shrugSampleCount) ? repWindow.maxShrugPct : 0,
    hasEnoughSamples(repWindow.headShrugSampleCount) ? repWindow.maxHeadShrugPct : 0,
  );
  const cueShrugPct = effectiveShrugPct(repWindow);
  const torsoEligible = hasTorsoLean || hasSagittalSway || hasHipSway;
  return buildRepDiagnostics({
    exerciseName: 'Standing Dumbbell Lateral Raises',
    repIndex,
    view: diagnosticView(repWindow),
    selectedSide: 'both',
    scorable: isLateralRaiseRepScorable(repWindow),
    metrics: [
      diagnosticMetric('peakHeightRatio', repWindow.maxHeightRatio, { unit: 'ratio' }),
      diagnosticMetric('leftPeakHeightRatio', repWindow.maxLeftHeightRatio, { unit: 'ratio' }),
      diagnosticMetric('rightPeakHeightRatio', repWindow.maxRightHeightRatio, { unit: 'ratio' }),
      diagnosticMetric('heightAsymmetry', repWindow.maxHeightRatioDiff, { unit: 'ratio' }),
      diagnosticMetric('topHeightAsymmetry', repWindow.topHeightAsymmetry, {
        unit: 'ratio',
        eligible: hasTopAsymmetry,
        sampleCount: repWindow.topFrameCount,
        skippedReason: 'insufficient_top_samples',
      }),
      diagnosticMetric('peakLateralReachRatio', repWindow.maxLateralReachRatio, {
        unit: 'ratio',
        eligible: hasLateralReach,
        sampleCount: repWindow.lateralReachSampleCount,
        skippedReason: 'insufficient_lateral_path_samples',
      }),
      diagnosticMetric('leftPeakLateralReachRatio', repWindow.maxLeftLateralReachRatio, {
        unit: 'ratio',
        eligible: hasLateralReach,
        sampleCount: repWindow.lateralReachSampleCount,
        skippedReason: 'insufficient_lateral_path_samples',
      }),
      diagnosticMetric('rightPeakLateralReachRatio', repWindow.maxRightLateralReachRatio, {
        unit: 'ratio',
        eligible: hasLateralReach,
        sampleCount: repWindow.lateralReachSampleCount,
        skippedReason: 'insufficient_lateral_path_samples',
      }),
      diagnosticMetric('minStraightnessRatio', repWindow.minStraightnessRatio, {
        unit: 'ratio',
        eligible: hasStraightness,
        sampleCount: repWindow.straightnessSampleCount,
        skippedReason: 'wrist_landmarks_unavailable',
      }),
      diagnosticMetric('torsoLean', repWindow.maxTorsoLean, {
        unit: 'degrees',
        eligible: hasTorsoLean,
        sampleCount: repWindow.torsoSampleCount,
        skippedReason: 'insufficient_torso_samples',
      }),
      diagnosticMetric('sagittalTorsoSway', repWindow.maxSagittalTorsoSway, {
        unit: 'degrees',
        eligible: hasSagittalSway,
        sampleCount: repWindow.sagittalSwaySampleCount,
        skippedReason: 'world_landmarks_unavailable',
      }),
      diagnosticMetric('hipSwayRatio', repWindow.maxHipSwayRatio, {
        unit: 'ratio',
        eligible: hasHipSway,
        sampleCount: repWindow.hipSwaySampleCount,
        skippedReason: 'insufficient_hip_sway_samples',
      }),
      diagnosticMetric('shrugPct', shrugMetricPct, {
        unit: 'ratio',
        eligible: hasShrug,
        sampleCount: Math.max(repWindow.shrugSampleCount, repWindow.headShrugSampleCount),
        skippedReason: 'insufficient_shrug_samples',
      }),
      diagnosticMetric('headShrugPct', repWindow.maxHeadShrugPct, {
        unit: 'ratio',
        eligible: hasEnoughSamples(repWindow.headShrugSampleCount),
        sampleCount: repWindow.headShrugSampleCount,
        skippedReason: 'head_landmarks_unavailable',
      }),
      diagnosticMetric('tRaise', tRaise, { unit: 'seconds', eligible: tRaise !== null, skippedReason: 'top_not_detected' }),
      diagnosticMetric('tLower', tLower, { unit: 'seconds', eligible: hasLowering, skippedReason: 'lowering_start_not_detected' }),
      diagnosticMetric('viewAngleDeg', repWindow.lastViewAngleDeg, {
        unit: 'degrees',
        eligible: hasAnyViewAngle,
        sampleCount: repWindow.viewAngleSampleCount,
        skippedReason: viewSkippedReason,
      }),
      diagnosticMetric('maxViewAngleDeg', repWindow.maxViewAngleDeg, {
        unit: 'degrees',
        eligible: hasAnyViewAngle,
        sampleCount: repWindow.viewAngleSampleCount,
        skippedReason: viewSkippedReason,
      }),
      diagnosticMetric('frontViewSampleCount', repWindow.frontViewSampleCount, {
        unit: 'count',
        eligible: hasAnyViewAngle,
        sampleCount: repWindow.viewAngleSampleCount,
        skippedReason: viewSkippedReason,
      }),
      diagnosticMetric('nonFrontViewSampleRatio', nonFrontRatio, {
        unit: 'ratio',
        eligible: hasViewAngle,
        sampleCount: repWindow.viewAngleSampleCount,
        skippedReason: viewSkippedReason,
      }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'standing-dumbbell-lateral-raises.rom_height',
        metricKeys: ['peakHeightRatio'],
        direction: 'below',
        value: repWindow.maxHeightRatio,
        thresholdPath: 'formThresholds.ROM_MIN',
        thresholdValue: FORM_THRESHOLDS.ROM_MIN,
        triggered: repWindow.maxHeightRatio < FORM_THRESHOLDS.ROM_MIN,
      }),
      diagnosticCue({
        issueId: 'standing-dumbbell-lateral-raises.over_raise',
        metricKeys: ['peakHeightRatio'],
        direction: 'above',
        value: repWindow.maxHeightRatio,
        thresholdPath: 'formThresholds.OVER_RAISE_WARN',
        thresholdValue: FORM_THRESHOLDS.OVER_RAISE_WARN,
        triggered: repWindow.maxHeightRatio > FORM_THRESHOLDS.OVER_RAISE_WARN,
      }),
      diagnosticCue({
        issueId: 'standing-dumbbell-lateral-raises.elbow_bend',
        metricKeys: ['minStraightnessRatio'],
        direction: 'below',
        value: repWindow.minStraightnessRatio,
        thresholdPath: 'formThresholds.ELBOW_STRAIGHTNESS_WARN',
        thresholdValue: FORM_THRESHOLDS.ELBOW_STRAIGHTNESS_WARN,
        eligible: hasStraightness,
        triggered: hasStraightness && repWindow.minStraightnessRatio < FORM_THRESHOLDS.ELBOW_STRAIGHTNESS_WARN,
        support: repWindow.straightnessSampleCount,
        skippedReason: 'insufficient_straightness_samples',
      }),
      diagnosticCue({
        issueId: 'standing-dumbbell-lateral-raises.torso_warn',
        metricKeys: ['torsoLean', 'sagittalTorsoSway', 'hipSwayRatio'],
        direction: 'above',
        thresholdPath: [
          'formThresholds.TORSO_LEAN_WARN',
          'formThresholds.SAGITTAL_SWAY_WARN',
          'formThresholds.HIP_SWAY_WARN',
        ],
        thresholdValue: {
          torsoLean: FORM_THRESHOLDS.TORSO_LEAN_WARN,
          sagittalTorsoSway: FORM_THRESHOLDS.SAGITTAL_SWAY_WARN,
          hipSwayRatio: FORM_THRESHOLDS.HIP_SWAY_WARN,
        },
        eligible: torsoEligible,
        triggered: torsoWarningTriggered(repWindow),
        support: Math.max(
          repWindow.torsoWarnSampleCount,
          repWindow.sagittalSwayWarnSampleCount,
          repWindow.hipSwayWarnSampleCount,
        ),
        skippedReason: 'insufficient_torso_samples',
      }),
      diagnosticCue({
        issueId: 'standing-dumbbell-lateral-raises.asymmetry',
        metricKeys: ['topHeightAsymmetry'],
        direction: 'above',
        value: repWindow.topHeightAsymmetry,
        thresholdPath: 'formThresholds.ASYMMETRY_WARN',
        thresholdValue: FORM_THRESHOLDS.ASYMMETRY_WARN,
        eligible: hasTopAsymmetry,
        triggered: hasTopAsymmetry && repWindow.topHeightAsymmetry > FORM_THRESHOLDS.ASYMMETRY_WARN,
        support: repWindow.topFrameCount,
        skippedReason: 'insufficient_top_samples',
      }),
      diagnosticCue({
        issueId: 'standing-dumbbell-lateral-raises.tempo_up',
        metricKeys: ['tRaise'],
        direction: 'below',
        value: tRaise,
        thresholdPath: 'formThresholds.TEMPO_RAISE_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_RAISE_MIN,
        eligible: tRaise !== null,
        triggered: tRaise !== null && tRaise > 0 && tRaise < FORM_THRESHOLDS.TEMPO_RAISE_MIN,
        skippedReason: 'top_not_detected',
      }),
      diagnosticCue({
        issueId: 'standing-dumbbell-lateral-raises.tempo_down',
        metricKeys: ['tLower'],
        direction: 'below',
        value: tLower,
        thresholdPath: 'formThresholds.TEMPO_LOWER_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_LOWER_MIN,
        eligible: hasLowering,
        triggered: hasLowering && tLower !== null && tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN,
        skippedReason: 'lowering_start_not_detected',
      }),
      diagnosticCue({
        issueId: 'standing-dumbbell-lateral-raises.shoulder_shrug',
        metricKeys: ['shrugPct'],
        direction: 'above',
        value: cueShrugPct,
        thresholdPath: 'formThresholds.SHRUG_WARN',
        thresholdValue: FORM_THRESHOLDS.SHRUG_WARN,
        eligible: hasShrug,
        triggered: cueShrugPct > FORM_THRESHOLDS.SHRUG_WARN,
        support: Math.max(repWindow.shrugWarnSampleCount, repWindow.headShrugWarnSampleCount),
        skippedReason: 'insufficient_shrug_samples',
      }),
      diagnosticCue({
        issueId: 'standing-dumbbell-lateral-raises.wrong_plane',
        metricKeys: ['peakLateralReachRatio'],
        direction: 'below',
        value: repWindow.maxLateralReachRatio,
        thresholdPath: 'formThresholds.LATERAL_REACH_MIN',
        thresholdValue: FORM_THRESHOLDS.LATERAL_REACH_MIN,
        eligible: hasLateralReach,
        triggered: hasLateralReach && repWindow.maxLateralReachRatio < FORM_THRESHOLDS.LATERAL_REACH_MIN,
        support: repWindow.lateralReachSampleCount,
        skippedReason: 'insufficient_lateral_path_samples',
      }),
    ],
  });
}

// ============================================================================
// MAIN UPDATE LOGIC
// ============================================================================

function updateLateralRaiseState(
  keypoints: Keypoint[],
  state: LateralRaiseState,
  frameContext?: ExerciseFrameContext,
): LateralRaiseState {
  const t = Date.now() / 1000;
  const imageKeypoints = frameContext?.imageKeypoints ?? keypoints;
  const worldKeypoints = frameContext?.worldKeypoints;

  // -- Warmup gate --
  if (!state.warmedUp) {
    const stable = state.warmupGate.update(imageKeypoints);
    if (!stable) return state;
    state.warmedUp = true;
  }

  // -- Fetch keypoints --
  const ls = getKeypoint(imageKeypoints, 'left_shoulder');
  const rs = getKeypoint(imageKeypoints, 'right_shoulder');
  const le = getKeypoint(imageKeypoints, 'left_elbow');
  const re = getKeypoint(imageKeypoints, 'right_elbow');
  const lw = getKeypoint(imageKeypoints, 'left_wrist');
  const rw = getKeypoint(imageKeypoints, 'right_wrist');
  const lh = getKeypoint(imageKeypoints, 'left_hip');
  const rh = getKeypoint(imageKeypoints, 'right_hip');

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
  const rawLeftLateralReach = computeLateralReachRatio(
    'left',
    ls!,
    le!,
    leftWristVisible ? lw! : null,
    lh!,
    rh!,
    ls!,
    rs!,
  );
  const rawRightLateralReach = computeLateralReachRatio(
    'right',
    rs!,
    re!,
    rightWristVisible ? rw! : null,
    lh!,
    rh!,
    ls!,
    rs!,
  );

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
  const rawSagittalTorsoAngle = computeSagittalTorsoAngle(worldKeypoints);
  const rawHipCenter = allTorsoVisible ? computeHipCenter(lh!, rh!) : null;
  const rawTorsoHeight = allTorsoVisible ? computeTorsoHeight(lh!, rh!, ls!, rs!) : null;
  const rawShoulderHeadGap = computeShoulderHeadGap(imageKeypoints);
  const viewAngle = estimateFrontViewAngle(worldKeypoints, state.viewAngleSmoothedDeg);
  if (viewAngle.smoothedAngleDeg !== null) {
    state.viewAngleSmoothedDeg = viewAngle.smoothedAngleDeg;
  }
  const leftHeightConf = minKeypointConfidence(imageKeypoints, [
    'left_shoulder', 'left_elbow', leftWristVisible ? 'left_wrist' : 'left_elbow', 'left_hip', 'right_hip',
  ]);
  const rightHeightConf = minKeypointConfidence(imageKeypoints, [
    'right_shoulder', 'right_elbow', rightWristVisible ? 'right_wrist' : 'right_elbow', 'left_hip', 'right_hip',
  ]);
  const leftStraightnessConf = leftWristVisible
    ? minKeypointConfidence(imageKeypoints, ['left_shoulder', 'left_elbow', 'left_wrist'])
    : 0;
  const rightStraightnessConf = rightWristVisible
    ? minKeypointConfidence(imageKeypoints, ['right_shoulder', 'right_elbow', 'right_wrist'])
    : 0;
  const torsoConf = minKeypointConfidence(imageKeypoints, [
    'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
  ]);
  const lateralReachConf = Math.min(leftHeightConf, rightHeightConf);
  const headShrugConf = rawShoulderHeadGap !== null
    ? minKeypointConfidence(imageKeypoints, ['nose', 'left_shoulder', 'right_shoulder'])
    : 0;
  const worldTorsoConf = worldKeypoints
    ? minKeypointConfidence(worldKeypoints, ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'])
    : 0;

  // -- Smooth ratios --
  const smoothedLeftHeightRatio = state.leftHeightRatioTracker.push(rawLeftHeightRatio, leftHeightConf);
  const smoothedRightHeightRatio = state.rightHeightRatioTracker.push(rawRightHeightRatio, rightHeightConf);
  const smoothedAvgHeightRatio = (smoothedLeftHeightRatio + smoothedRightHeightRatio) / 2;
  const fastLeftHeightRatio = state.leftHeightRatioTracker.medianValue;
  const fastRightHeightRatio = state.rightHeightRatioTracker.medianValue;
  const fastAvgHeightRatio = (fastLeftHeightRatio + fastRightHeightRatio) / 2;
  const smoothedLeftLateralReach = state.leftLateralReachTracker.push(rawLeftLateralReach, leftHeightConf);
  const smoothedRightLateralReach = state.rightLateralReachTracker.push(rawRightLateralReach, rightHeightConf);
  const smoothedAvgLateralReach = (smoothedLeftLateralReach + smoothedRightLateralReach) / 2;
  const fastLeftLateralReach = state.leftLateralReachTracker.medianValue;
  const fastRightLateralReach = state.rightLateralReachTracker.medianValue;
  const fastAvgLateralReach = (fastLeftLateralReach + fastRightLateralReach) / 2;
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
  state.smoothedLeftLateralReach = isNaN(smoothedLeftLateralReach) ? state.smoothedLeftLateralReach : smoothedLeftLateralReach;
  state.smoothedRightLateralReach = isNaN(smoothedRightLateralReach) ? state.smoothedRightLateralReach : smoothedRightLateralReach;
  state.smoothedAvgLateralReach = isNaN(smoothedAvgLateralReach) ? state.smoothedAvgLateralReach : smoothedAvgLateralReach;
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
    const torsoH = rawTorsoHeight ?? 0;
    if (torsoH > 0.01) {
      state.restTorsoHeight = state.restTorsoHeight === null
        ? torsoH
        : Math.min(state.restTorsoHeight, torsoH);
    }
    if (rawShoulderHeadGap !== null && headShrugConf >= FORM_CONFIDENCE_MIN) {
      state.restShoulderHeadGap = state.restShoulderHeadGap === null
        ? rawShoulderHeadGap
        : Math.max(state.restShoulderHeadGap, rawShoulderHeadGap);
    }
  }

  // -- Track rep start --
  if (prevPhase === 'REST' && state.phase === 'RAISING') {
    state.tRepStart = t;
    state.repWindow = initRepWindow(
      t,
      state.restTorsoHeight,
      state.restShoulderHeadGap,
      rawSagittalTorsoAngle,
      rawHipCenter,
    );
  }

  // -- Track TOP→LOWERING transition (true eccentric start) --
  if (prevPhase === 'TOP' && state.phase === 'LOWERING' && state.repWindow) {
    state.repWindow.tLoweringStart = t;
  }

  // -- Accumulate every frame that participates in a full or returned partial rep. --
  if (state.repWindow && (prevPhase !== 'REST' || state.phase !== 'REST')) {
    accumulateRepWindowFrame(state.repWindow, {
      t,
      phase: state.phase,
      avgHeightRatio: fastAvgHeightRatio,
      leftHeightRatio: fastLeftHeightRatio,
      rightHeightRatio: fastRightHeightRatio,
      avgLateralReach: fastAvgLateralReach,
      leftLateralReach: fastLeftLateralReach,
      rightLateralReach: fastRightLateralReach,
      lateralReachConf,
      leftHeightConf,
      rightHeightConf,
      leftStraightness: smoothedLeftStraightness,
      rightStraightness: smoothedRightStraightness,
      leftStraightnessConf,
      rightStraightnessConf,
      torsoLean: smoothedTorsoLean,
      torsoConf,
      sagittalTorsoAngle: rawSagittalTorsoAngle,
      worldTorsoConf,
      hipCenter: rawHipCenter,
      torsoHeight: rawTorsoHeight,
      shoulderHeadGap: rawShoulderHeadGap,
      headShrugConf,
      viewAngle,
    });
  }

  // -- Handle rep completion --
  if (fsmResult.repCompleted && state.repWindow) {
    state.repCount++;

    state.lastRepResult = buildLateralRaiseRepResult(state.repWindow, state.repCount);
    const messages = state.lastRepResult.messages;

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
      const duration = w.tEnd - w.tStart;
      if (isMeaningfulPartialRep({
        actualRom: w.maxHeightRatio,
        minRom: THRESHOLDS.MIN_PARTIAL_HEIGHT_RATIO,
        duration,
        minDuration: THRESHOLDS.MIN_REP_TIME,
      })) {
        state.repCount++;
        state.lastRepResult = buildLateralRaiseRepResult(w, state.repCount);
        const messages = state.lastRepResult.messages;
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
    lateralReachRatio: fmt(state.smoothedAvgLateralReach),
    maxHeightRatio: w ? fmt(w.maxHeightRatio) : null,
    maxHeightRatioDiff: w ? fmt(w.maxHeightRatioDiff) : null,
    topHeightAsymmetry: w ? fmt(w.topHeightAsymmetry) : null,
    maxLateralReachRatio: w ? fmt(w.maxLateralReachRatio) : null,
    minStraightness: w ? (w.minStraightnessRatio < 1.0 ? fmt(w.minStraightnessRatio) : null) : null,
    maxTorsoLean: w ? fmt(w.maxTorsoLean) : null,
    maxSagittalTorsoSway: w ? fmt(w.maxSagittalTorsoSway) : null,
    maxHipSwayRatio: w ? fmt(w.maxHipSwayRatio) : null,
    shrugPct: w ? fmt(Math.max(w.maxShrugPct, w.maxHeadShrugPct)) : null,
    viewAngleDeg: w ? fmt(w.lastViewAngleDeg ?? NaN) : fmt(state.viewAngleSmoothedDeg ?? NaN),
    maxViewAngleDeg: w ? fmt(w.maxViewAngleDeg) : null,
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
    repQualityWindowActive: false,
    _internal: withLateralRaiseConfig(config, () => initializeState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState, frameContext?: ExerciseFrameContext): ExerciseState => {
    const internal = state._internal as LateralRaiseState;
    withLateralRaiseConfig(config, () => updateLateralRaiseState(keypoints, internal, frameContext));

    // Map internal RepResult to framework RepResult
    const lastRepResult: FrameworkRepResult | null = internal.lastRepResult
      ? {
	          repIndex: internal.lastRepResult.repIndex,
	          score: internal.lastRepResult.score,
	          messages: internal.lastRepResult.messages,
	          scorable: internal.lastRepResult.scorable,
	          qualityWarnings: internal.lastRepResult.qualityWarnings,
	          diagnostics: internal.lastRepResult.diagnostics,
	        }
      : null;

    return {
      repCount: internal.repCount,
      lastRepResult,
      feedback: internal.feedback,
      feedbackTimestamp: internal.lastFeedbackTime > 0 ? internal.lastFeedbackTime : null,
      debugInfo: getDebugInfo(internal) as unknown as Record<string, unknown>,
      repQualityWindowActive: internal.repWindow !== null,
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
      'Lift with control \u2014 avoid swinging the weights up.': 'tempo_up',
      'Control the descent \u2014 lower the weights slowly.': 'tempo_down',
      'Relax your traps \u2014 don\'t shrug the weight up.': 'shoulder_shrug',
      'Raise out to your sides \u2014 avoid turning it into a front raise.': 'wrong_plane',
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
      {
        issueType: 'wrong_plane',
        priority: 22,
        messages: [
          'Raise out to your sides.',
          'Keep it lateral, not forward.',
          'Lead the weights out wide.',
        ],
      },
      {
        issueType: 'tempo_up',
        priority: 12,
        messages: [
          'Lift with control.',
          'Avoid swinging the weights up.',
          'Smooth out the raise.',
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
    'Lift with control \u2014 avoid swinging the weights up.':
      'Use a controlled raise instead of swinging the weights up with momentum.',
    'Control the descent \u2014 lower the weights slowly.':
      'Slow the eccentric phase \u2014 aim for 2-3 seconds down.',
    'Relax your traps \u2014 don\'t shrug the weight up.':
      'Focus on leading with your elbows, not your shoulders. If you\'re shrugging, the weight may be too heavy.',
    'Raise out to your sides \u2014 avoid turning it into a front raise.':
      'Keep the weights moving out to your sides so the side delts stay loaded.',
  },
  };
}

export const lateralRaiseDefinition: ExerciseDefinition = createLateralRaiseDefinition();
