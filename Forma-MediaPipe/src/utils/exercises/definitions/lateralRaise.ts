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
import {
  computePenaltyPoints,
  computeScoreFromPenaltyPoints,
  PenaltyConfig,
} from '../shared/scoring';
import { LOW_ROM_FEEDBACK, isMeaningfulPartialRep } from '../shared/partialReps';
import {
  createDefaultTunableSpec,
  getConfigValue,
  mergeHeuristicConfig,
  runWithConfigBindings,
} from '../heuristicConfig';
import {
  buildRepDiagnostics,
  diagnosticCue,
  diagnosticMetric,
} from '../shared/diagnostics';
import { createPoseStateReliabilityAggregator } from '../../pose/buildPoseState';
import {
  interpretPoseStateReliabilitySummary,
  type RepReliabilityInterpretation,
} from '../shared/reliabilityInterpretation';
import tunedConfig from './tuned/lateralRaise.json';
import type { PoseStateReliabilitySummary } from '../../pose/PoseState';

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
  /** Minimum observed wrist endpoint coverage before a rep can be form-scored. */
  WRIST_ENDPOINT_SCORABLE_MIN_COVERAGE: 0.75,
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
// Keep the first labelled-data pass from independently tuning world-only torso
// sub-signals against one aggregated torso_warn label.
LATERAL_RAISE_TUNABLE_SPEC.tunables = LATERAL_RAISE_TUNABLE_SPEC.tunables
  .filter(tunable => ![
    'formThresholds.MIN_FORM_SAMPLES',
    'formThresholds.SAGITTAL_SWAY_WARN',
    'formThresholds.HIP_SWAY_WARN',
  ].includes(tunable.path))
  .map((tunable) => {
    switch (tunable.path) {
      case 'formThresholds.TORSO_LEAN_WARN':
        return { ...tunable, min: 1, max: 8, step: 0.25 };
      case 'formThresholds.TEMPO_RAISE_MIN':
        return { ...tunable, min: 0.15, max: 0.45, step: 0.05 };
      case 'formThresholds.TEMPO_LOWER_MIN':
        return { ...tunable, min: 0.20, max: 0.55, step: 0.05 };
      default:
        return tunable;
    }
  });
LATERAL_RAISE_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'standing-dumbbell-lateral-raises.rom_height', metricKey: 'peakHeightRatio', thresholdPath: 'formThresholds.ROM_MIN', direction: 'below' },
  { issueId: 'standing-dumbbell-lateral-raises.over_raise', metricKey: 'peakHeightRatio', thresholdPath: 'formThresholds.OVER_RAISE_WARN', direction: 'above' },
  { issueId: 'standing-dumbbell-lateral-raises.elbow_bend', metricKey: 'minStraightnessRatio', thresholdPath: 'formThresholds.ELBOW_STRAIGHTNESS_WARN', direction: 'below' },
  { issueId: 'standing-dumbbell-lateral-raises.torso_warn', metricKey: 'torsoLean', thresholdPath: 'formThresholds.TORSO_LEAN_WARN', direction: 'above' },
  { issueId: 'standing-dumbbell-lateral-raises.asymmetry', metricKey: 'topHeightAsymmetry', thresholdPath: 'formThresholds.ASYMMETRY_WARN', direction: 'above' },
  { issueId: 'standing-dumbbell-lateral-raises.tempo_down', metricKey: 'tLower', thresholdPath: 'formThresholds.TEMPO_LOWER_MIN', direction: 'below' },
  { issueId: 'standing-dumbbell-lateral-raises.shoulder_shrug', metricKey: 'shrugPct', thresholdPath: 'formThresholds.SHRUG_WARN', direction: 'above' },
  { issueId: 'standing-dumbbell-lateral-raises.wrong_plane', metricKey: 'weakestPeakLateralReachRatio', thresholdPath: 'formThresholds.LATERAL_REACH_MIN', direction: 'below' },
  { issueId: 'standing-dumbbell-lateral-raises.tempo_up', metricKey: 'tRaise', thresholdPath: 'formThresholds.TEMPO_RAISE_MIN', direction: 'below' },
];

const LATERAL_RAISE_ISSUE_CUE_FAMILIES: Record<string, string> = {
  'standing-dumbbell-lateral-raises.rom_height': 'visibleArmRaise',
  'standing-dumbbell-lateral-raises.over_raise': 'visibleArmRaise',
  'standing-dumbbell-lateral-raises.elbow_bend': 'shoulderElbowWristPath',
  'standing-dumbbell-lateral-raises.torso_warn': 'torsoControl',
  'standing-dumbbell-lateral-raises.asymmetry': 'bilateralRaiseSymmetry',
  'standing-dumbbell-lateral-raises.tempo_up': 'visibleArmRaise',
  'standing-dumbbell-lateral-raises.tempo_down': 'visibleArmRaise',
  'standing-dumbbell-lateral-raises.shoulder_shrug': 'torsoControl',
  'standing-dumbbell-lateral-raises.wrong_plane': 'shoulderElbowWristPath',
};

const LATERAL_RAISE_ALL_CUE_FAMILIES = [
  'repCount',
  'visibleArmRaise',
  'torsoControl',
  'shoulderElbowWristPath',
  'wristEndpoint',
  'bilateralRaiseSymmetry',
] as const;

type LateralRaiseCueFamily = typeof LATERAL_RAISE_ALL_CUE_FAMILIES[number];
type LateralRaiseCueViewRequirement =
  | 'anyView'
  | 'selectedSideOk'
  | 'frontRequired'
  | 'bilateralGeometryRequired';

const LATERAL_RAISE_MEANINGFUL_VIEW_CUE_FAMILIES: readonly LateralRaiseCueFamily[] = [
  'visibleArmRaise',
  'torsoControl',
];

const LATERAL_RAISE_CUE_VIEW_REQUIREMENTS: Record<LateralRaiseCueFamily, LateralRaiseCueViewRequirement> = {
  repCount: 'selectedSideOk',
  visibleArmRaise: 'selectedSideOk',
  torsoControl: 'anyView',
  shoulderElbowWristPath: 'frontRequired',
  wristEndpoint: 'selectedSideOk',
  bilateralRaiseSymmetry: 'bilateralGeometryRequired',
};

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

interface ShoulderHeadGapEstimate {
  gap: number;
  confidence: number;
  source: string;
}

interface RepFrameMetrics {
  t: number;
  phase: LateralRaisePhase;
  avgHeightRatio: number;
  leftHeightRatio: number;
  rightHeightRatio: number;
  leftWristEndpointObserved: boolean;
  rightWristEndpointObserved: boolean;
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
  shoulderHeadSource: string | null;
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
  /** Head landmark used by baselineShoulderHeadGap. */
  baselineShoulderHeadSource: string | null;
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
  wristEndpointSampleCount: number;
  wristEndpointObservedCount: number;
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
  /** Runtime PoseState reliability observed during this active rep. */
  reliability: ReturnType<typeof createPoseStateReliabilityAggregator>;
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
  /** Head landmark used by restShoulderHeadGap. */
  restShoulderHeadSource: string | null;
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

interface LateralRaiseViewCueDecision {
  finalSafeCueFamilies: string[];
  finalUnsafeCueFamilies: string[];
  viewBlockedCueFamilies: string[];
  poseStateBlockedCueFamilies: string[];
  finalAllowedCueFamilies: ReadonlySet<string>;
  frontViewGatePassed: boolean;
  partialViewScoringAllowed: boolean;
  scorable: boolean;
  finalScorableReason?: string;
  finalUnscorableReason?: string;
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

function createLateralRaiseWarmupGate(): WarmupGate {
  return new WarmupGate({
    requiredJoints: [
      'left_shoulder', 'right_shoulder',
      'left_elbow', 'right_elbow',
      'left_hip', 'right_hip',
      'left_wrist', 'right_wrist',
    ],
  });
}

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
    warmupGate: createLateralRaiseWarmupGate(),
    warmedUp: false,
    restTorsoHeight: null,
    restShoulderHeadGap: null,
    restShoulderHeadSource: null,
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

function resetLateralRaiseAfterTrackingInterruption(state: LateralRaiseState): void {
  state.phase = 'REST';
  state.tRepStart = null;
  state.repWindow = null;
  state.leftHeightRatioTracker = new SmoothedAngleTracker();
  state.rightHeightRatioTracker = new SmoothedAngleTracker();
  state.leftStraightnessTracker = new SmoothedAngleTracker();
  state.rightStraightnessTracker = new SmoothedAngleTracker();
  state.leftLateralReachTracker = new SmoothedAngleTracker();
  state.rightLateralReachTracker = new SmoothedAngleTracker();
  state.torsoLeanTracker = new SmoothedAngleTracker();
  state.warmupGate = createLateralRaiseWarmupGate();
  state.warmedUp = false;
  state.restTorsoHeight = null;
  state.restShoulderHeadGap = null;
  state.restShoulderHeadSource = null;
  state.smoothedLeftHeightRatio = 0;
  state.smoothedRightHeightRatio = 0;
  state.smoothedAvgHeightRatio = 0;
  state.smoothedLeftStraightness = 1.0;
  state.smoothedRightStraightness = 1.0;
  state.smoothedLeftLateralReach = 0;
  state.smoothedRightLateralReach = 0;
  state.smoothedAvgLateralReach = 0;
  state.smoothedTorsoLean = 0;
  state.viewAngleSmoothedDeg = null;
}

function initRepWindow(
  tStart: number,
  baselineTorsoHeight: number | null,
  baselineShoulderHeadGap: number | null,
  baselineShoulderHeadSource: string | null,
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
    baselineShoulderHeadSource,
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
    wristEndpointSampleCount: 0,
    wristEndpointObservedCount: 0,
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
    reliability: createPoseStateReliabilityAggregator(),
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

function estimateWristEndpointFromElbow(
  name: string,
  shoulder: Keypoint,
  elbow: Keypoint,
): Keypoint {
  const estimated: Keypoint = {
    name,
    x: elbow.x + (elbow.x - shoulder.x),
    y: elbow.y + (elbow.y - shoulder.y),
    score: Math.min(shoulder.score, elbow.score),
  };
  if (shoulder.z !== undefined || elbow.z !== undefined) {
    estimated.z = (elbow.z ?? 0) + ((elbow.z ?? 0) - (shoulder.z ?? 0));
  }
  return estimated;
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
 * Wrist reach is required; wrist-dependent form cues are ineligible when wrists
 * are not visible, while rep counting uses an elbow-estimated endpoint separately.
 */
function computeLateralReachRatio(
  side: 'left' | 'right',
  shoulder: Keypoint,
  wrist: Keypoint,
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
  return Math.max(0, (wrist.x - shoulder.x) * outward) / torsoHeight;
}

function computeHipCenter(leftHip: Keypoint, rightHip: Keypoint): { x: number; y: number } {
  return {
    x: (leftHip.x + rightHip.x) / 2,
    y: (leftHip.y + rightHip.y) / 2,
  };
}

function computeShoulderHeadGap(keypoints: Keypoint[]): ShoulderHeadGapEstimate | null {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  if (!isVisible(ls, VISIBILITY_THRESHOLD) || !isVisible(rs, VISIBILITY_THRESHOLD)) return null;

  const headCandidates = ['nose', 'left_ear', 'right_ear']
    .map((name) => ({ name, point: getKeypoint(keypoints, name) }))
    .filter((candidate): candidate is { name: string; point: Keypoint } =>
      isVisible(candidate.point, VISIBILITY_THRESHOLD)
    );
  if (headCandidates.length === 0) return null;

  const midShoulderY = (ls.y + rs.y) / 2;
  const selectedHead = headCandidates.reduce((best, candidate) => (
    candidate.point.y < best.point.y ? candidate : best
  ), headCandidates[0]);
  const gap = Math.abs(midShoulderY - selectedHead.point.y);
  return gap > 0.01
    ? { gap, confidence: Math.min(ls.score, rs.score, selectedHead.point.score), source: selectedHead.name }
    : null;
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

function hasScorableFrontView(repWindow: RepWindow): boolean {
  const ratio = nonFrontViewSampleRatio(repWindow);
  if (!hasEnoughViewAngleSamples(repWindow) || ratio === null) return false;
  return ratio < FRONT_VIEW_WARN_SAMPLE_RATIO;
}

function wristEndpointCoverage(repWindow: RepWindow): number | null {
  if (repWindow.wristEndpointSampleCount === 0) return null;
  return repWindow.wristEndpointObservedCount / repWindow.wristEndpointSampleCount;
}

function hasScorableWristCoverage(repWindow: RepWindow): boolean {
  const coverage = wristEndpointCoverage(repWindow);
  return coverage !== null && coverage >= FORM_THRESHOLDS.WRIST_ENDPOINT_SCORABLE_MIN_COVERAGE;
}

function isLateralRaiseRepScorable(repWindow: RepWindow): boolean {
  return hasScorableFrontView(repWindow) && hasScorableWristCoverage(repWindow);
}

function lateralRaiseQualityWarnings(repWindow: RepWindow): FrameworkRepResult['qualityWarnings'] {
  const warnings: FrameworkRepResult['qualityWarnings'] = [];
  if (!hasScorableFrontView(repWindow)) warnings.push('front_view_uncertain');
  if (!hasScorableWristCoverage(repWindow)) warnings.push('arms_hidden');
  return warnings;
}

function weakestPeakLateralReachRatio(repWindow: RepWindow): number {
  return Math.min(repWindow.maxLeftLateralReachRatio, repWindow.maxRightLateralReachRatio);
}

function diagnosticView(repWindow: RepWindow): ViewDiagnostic {
  const ratio = nonFrontViewSampleRatio(repWindow);
  if (!hasEnoughViewAngleSamples(repWindow) || ratio === null) return 'unknown';
  if (ratio < FRONT_VIEW_WARN_SAMPLE_RATIO) return 'front';
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
  repWindow.wristEndpointSampleCount += 2;
  repWindow.wristEndpointObservedCount +=
    (metrics.leftWristEndpointObserved ? 1 : 0) +
    (metrics.rightWristEndpointObserved ? 1 : 0);

  repWindow.maxHeightRatio = Math.max(repWindow.maxHeightRatio, metrics.avgHeightRatio);
  repWindow.maxLeftHeightRatio = Math.max(repWindow.maxLeftHeightRatio, metrics.leftHeightRatio);
  repWindow.maxRightHeightRatio = Math.max(repWindow.maxRightHeightRatio, metrics.rightHeightRatio);

  const nearTop = metrics.avgHeightRatio >= THRESHOLDS.TOP_EXIT;
  const asymmetryNearTop = Math.max(metrics.leftHeightRatio, metrics.rightHeightRatio) >= THRESHOLDS.TOP_EXIT;
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
    if (asymmetryNearTop) {
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

  if (
    metrics.shoulderHeadGap !== null &&
    metrics.shoulderHeadSource !== null &&
    metrics.headShrugConf >= FORM_CONFIDENCE_MIN
  ) {
    if (repWindow.baselineShoulderHeadGap === null) {
      repWindow.baselineShoulderHeadGap = metrics.shoulderHeadGap;
      repWindow.baselineShoulderHeadSource = metrics.shoulderHeadSource;
    }
    if (repWindow.baselineShoulderHeadSource === metrics.shoulderHeadSource) {
      const headShrug = (repWindow.baselineShoulderHeadGap - metrics.shoulderHeadGap) / repWindow.baselineShoulderHeadGap * 100;
      if (headShrug > 0) {
        repWindow.maxHeadShrugPct = Math.max(repWindow.maxHeadShrugPct, headShrug);
      }
      if (headShrug > FORM_THRESHOLDS.SHRUG_WARN) {
        repWindow.headShrugWarnSampleCount++;
      }
      repWindow.headShrugSampleCount++;
    }
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

function cueFamilyAllowed(allowedCueFamilies: ReadonlySet<string> | undefined, family: string): boolean {
  return !allowedCueFamilies || allowedCueFamilies.has(family);
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

function sortedUnique(values: Iterable<string>): string[] {
  return uniqueStrings(values).sort((a, b) => a.localeCompare(b));
}

function reliabilityInterpretationForRepWindow(repWindow: RepWindow): {
  summary: PoseStateReliabilitySummary;
  interpretation: RepReliabilityInterpretation;
} | null {
  const summary = repWindow.reliability.snapshot();
  if (summary.totalFrames === 0) return null;
  return {
    summary,
    interpretation: interpretPoseStateReliabilitySummary('Standing Dumbbell Lateral Raises', summary),
  };
}

function hasUsableArmChain(interpretation: RepReliabilityInterpretation | null): boolean {
  if (!interpretation) return true;
  return interpretation.usableChains.includes('leftArm') || interpretation.usableChains.includes('rightArm');
}

function hasUsableArmAndTorso(interpretation: RepReliabilityInterpretation | null): boolean {
  if (!interpretation) return false;
  return (
    interpretation.scoreabilityCandidate !== 'notScoreable' &&
    hasUsableArmChain(interpretation) &&
    interpretation.usableChains.includes('torso')
  );
}

function reliabilityAllowsScoring(interpretation: RepReliabilityInterpretation | null): boolean {
  return (
    !interpretation ||
    (
      interpretation.scoreabilityCandidate !== 'notScoreable' &&
      hasUsableArmChain(interpretation)
    )
  );
}

function lateralRaiseCueFamilyAllowedByView(
  requirement: LateralRaiseCueViewRequirement,
  frontViewGatePassed: boolean,
  viewEvidenceAvailable: boolean,
  partialViewCandidate: boolean,
): boolean {
  if (frontViewGatePassed) return true;
  if (!viewEvidenceAvailable) return true;
  switch (requirement) {
    case 'anyView':
      return true;
    case 'selectedSideOk':
      return partialViewCandidate;
    case 'frontRequired':
    case 'bilateralGeometryRequired':
      return false;
    default:
      return false;
  }
}

function resolveLateralRaiseViewCueDecision(
  repWindow: RepWindow,
  interpretation: RepReliabilityInterpretation | null,
): LateralRaiseViewCueDecision {
  const frontViewGatePassed = hasScorableFrontView(repWindow);
  const view = diagnosticView(repWindow);
  const viewEvidenceAvailable = view !== 'unknown';
  const partialViewCandidate = view === 'oblique';
  const legacyQualityScorable = isLateralRaiseRepScorable(repWindow);
  const armAndTorsoUsable = hasUsableArmAndTorso(interpretation);
  const reliabilitySafeFamilies = new Set(
    interpretation
      ? interpretation.safeCueFamilies
      : (frontViewGatePassed || !viewEvidenceAvailable) ? LATERAL_RAISE_ALL_CUE_FAMILIES : [],
  );
  const poseStateBlockedCueFamilies = sortedUnique(interpretation?.unsafeCueFamilies ?? []);
  const poseStateBlockedSet = new Set(poseStateBlockedCueFamilies);
  const viewBlockedCueFamilies: string[] = [];
  const finalSafeCueFamilies: string[] = [];
  const finalUnsafeCueFamilies: string[] = [];

  for (const family of LATERAL_RAISE_ALL_CUE_FAMILIES) {
    const requirement = LATERAL_RAISE_CUE_VIEW_REQUIREMENTS[family];
    const viewAllows = lateralRaiseCueFamilyAllowedByView(
      requirement,
      frontViewGatePassed,
      viewEvidenceAvailable,
      partialViewCandidate,
    );
    const poseStateAllows = reliabilitySafeFamilies.has(family) && !poseStateBlockedSet.has(family);

    if (!viewAllows) viewBlockedCueFamilies.push(family);
    if (viewAllows && poseStateAllows) finalSafeCueFamilies.push(family);
    else finalUnsafeCueFamilies.push(family);
  }

  const finalSafeSet = new Set(finalSafeCueFamilies);
  const hasMeaningfulSafeCue = LATERAL_RAISE_MEANINGFUL_VIEW_CUE_FAMILIES.some((family) => (
    finalSafeSet.has(family)
  ));
  const reliabilityScorable = interpretation
    ? reliabilityAllowsScoring(interpretation)
    : legacyQualityScorable;
  const partialViewScoringAllowed = Boolean(
    interpretation &&
    !frontViewGatePassed &&
    partialViewCandidate &&
    armAndTorsoUsable &&
    hasMeaningfulSafeCue
  );
  const scorable = interpretation
    ? reliabilityScorable && (frontViewGatePassed || partialViewScoringAllowed)
    : legacyQualityScorable;

  let finalScorableReason: string | undefined;
  let finalUnscorableReason: string | undefined;
  if (scorable) {
    finalScorableReason = frontViewGatePassed ? 'front_view_confirmed' : 'partial_view_scoring';
  } else if (!interpretation && !frontViewGatePassed) {
    finalUnscorableReason = 'front_view_uncertain';
  } else if (!reliabilityScorable) {
    finalUnscorableReason = interpretation
      ? 'pose_reliability_not_scoreable'
      : 'missing_required_joints';
  } else if (!frontViewGatePassed && !armAndTorsoUsable) {
    finalUnscorableReason = 'front_view_failed_visible_arm_or_torso_unreliable';
  } else if (!hasMeaningfulSafeCue) {
    finalUnscorableReason = 'no_meaningful_safe_cue_families';
  } else {
    finalUnscorableReason = 'front_view_uncertain';
  }

  return {
    finalSafeCueFamilies: sortedUnique(finalSafeCueFamilies),
    finalUnsafeCueFamilies: sortedUnique(finalUnsafeCueFamilies),
    viewBlockedCueFamilies: sortedUnique(viewBlockedCueFamilies),
    poseStateBlockedCueFamilies,
    finalAllowedCueFamilies: new Set(finalSafeCueFamilies),
    frontViewGatePassed,
    partialViewScoringAllowed,
    scorable,
    finalScorableReason,
    finalUnscorableReason,
  };
}

function computeRepWindowScore(
  repWindow: RepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): number {
  const penaltyPoints: number[] = [];
  const addPenalty = (value: number, config: PenaltyConfig) => {
    penaltyPoints.push(computePenaltyPoints(value, config));
  };

  // 1. ROM shortfall — ideal is ratio 1.0 (shoulder level). FSM ensures ≥0.85.
  if (cueFamilyAllowed(allowedCueFamilies, 'visibleArmRaise')) {
    const romShortfall = Math.max(0, IDEAL.MAX_HEIGHT_RATIO - repWindow.maxHeightRatio);
    addPenalty(romShortfall, PENALTY_CONFIGS.ROM);
  }

  // 2. Arm straightness — ideal is 0.97 (slight bend OK). Lower = more bend = worse.
  if (
    cueFamilyAllowed(allowedCueFamilies, 'shoulderElbowWristPath') &&
    hasEnoughSamples(repWindow.straightnessSampleCount)
  ) {
    const straightnessDeficit = Math.max(0, IDEAL.MIN_STRAIGHTNESS - repWindow.minStraightnessRatio);
    addPenalty(straightnessDeficit, PENALTY_CONFIGS.ARM_STRAIGHT);
  }

  // 3. Torso lean — lower is better (deadzone handles small amounts)
  const torsoPenaltyPoints: number[] = [];
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoControl')) {
    if (hasEnoughSamples(repWindow.torsoSampleCount)) {
      torsoPenaltyPoints.push(computePenaltyPoints(repWindow.maxTorsoLean, PENALTY_CONFIGS.TORSO_LEAN));
    }
    if (hasEnoughSamples(repWindow.sagittalSwaySampleCount)) {
      torsoPenaltyPoints.push(computePenaltyPoints(repWindow.maxSagittalTorsoSway, PENALTY_CONFIGS.SAGITTAL_SWAY));
    }
    if (hasEnoughSamples(repWindow.hipSwaySampleCount)) {
      torsoPenaltyPoints.push(computePenaltyPoints(repWindow.maxHipSwayRatio, PENALTY_CONFIGS.HIP_SWAY));
    }
    if (torsoPenaltyPoints.length > 0) {
      penaltyPoints.push(Math.max(...torsoPenaltyPoints));
    }
  }

  // 4. Tempo — lightly penalize swingy raises and uncontrolled descents.
  if (cueFamilyAllowed(allowedCueFamilies, 'visibleArmRaise') && repWindow.tTop !== null) {
    const tRaise = repWindow.tTop - repWindow.tStart;
    if (tRaise > 0 && tRaise < IDEAL.CONCENTRIC_TIME) {
      addPenalty(IDEAL.CONCENTRIC_TIME - tRaise, PENALTY_CONFIGS.TEMPO_RAISE);
    }
  }
  if (cueFamilyAllowed(allowedCueFamilies, 'visibleArmRaise') && repWindow.tLoweringStart !== null) {
    const tLower = repWindow.tEnd - repWindow.tLoweringStart;
    if (tLower > 0 && tLower < IDEAL.ECCENTRIC_TIME) {
      const deficit = IDEAL.ECCENTRIC_TIME - tLower;
      addPenalty(deficit, PENALTY_CONFIGS.TEMPO_LOWER);
    }
  }

  // 5. Asymmetry — sustained top-phase difference between arms.
  if (
    cueFamilyAllowed(allowedCueFamilies, 'bilateralRaiseSymmetry') &&
    hasEnoughSamples(repWindow.topFrameCount)
  ) {
    addPenalty(repWindow.topHeightAsymmetry, PENALTY_CONFIGS.ASYMMETRY);
  }

  // 6. Shoulder shrug — torso-height or optional head-relative support.
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoControl')) {
    addPenalty(effectiveShrugPct(repWindow), PENALTY_CONFIGS.SHRUG);
  }

  // 7. Over-raising — above shoulder level shifts tension and often invites shrugging.
  if (cueFamilyAllowed(allowedCueFamilies, 'visibleArmRaise')) {
    const overRaise = Math.max(0, repWindow.maxHeightRatio - IDEAL.MAX_HEIGHT_RATIO);
    addPenalty(overRaise, PENALTY_CONFIGS.OVER_RAISE);
  }

  // 8. Wrong plane — height without enough outward reach is a front/scaption raise.
  if (
    cueFamilyAllowed(allowedCueFamilies, 'shoulderElbowWristPath') &&
    hasEnoughSamples(repWindow.lateralReachSampleCount)
  ) {
    const lateralReachShortfall = Math.max(0, FORM_THRESHOLDS.LATERAL_REACH_MIN - weakestPeakLateralReachRatio(repWindow));
    addPenalty(lateralReachShortfall, PENALTY_CONFIGS.LATERAL_PATH);
  }

  return computeScoreFromPenaltyPoints(penaltyPoints);
}

// ============================================================================
// FORM FEEDBACK (discrete messages for visual display)
// ============================================================================

function generateFormMessages(
  repWindow: RepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): string[] {
  const messages: string[] = [];

  // 1. ROM — raise height (ratio-based)
  if (
    cueFamilyAllowed(allowedCueFamilies, 'visibleArmRaise') &&
    repWindow.maxHeightRatio < FORM_THRESHOLDS.ROM_MIN
  ) {
    messages.push('Raise higher \u2014 aim for shoulder level.');
  }

  // 2. Over-raise (ratio-based)
  if (
    cueFamilyAllowed(allowedCueFamilies, 'visibleArmRaise') &&
    repWindow.maxHeightRatio > FORM_THRESHOLDS.OVER_RAISE_WARN
  ) {
    messages.push('Stop around shoulder height \u2014 avoid lifting too high.');
  }

  // 3. Arm straightness (ratio-based)
  if (
    cueFamilyAllowed(allowedCueFamilies, 'shoulderElbowWristPath') &&
    hasEnoughSamples(repWindow.straightnessSampleCount) &&
    repWindow.minStraightnessRatio < FORM_THRESHOLDS.ELBOW_STRAIGHTNESS_WARN
  ) {
    messages.push('Keep your arms straighter \u2014 avoid excessive elbow bend.');
  }

  // 4. Torso lean/sway
  if (
    cueFamilyAllowed(allowedCueFamilies, 'torsoControl') &&
    torsoWarningTriggered(repWindow)
  ) {
    messages.push('Stay upright \u2014 avoid swaying or leaning.');
  }

  // 5. Asymmetry (sustained near top, not single-frame spikes)
  if (
    cueFamilyAllowed(allowedCueFamilies, 'bilateralRaiseSymmetry') &&
    hasEnoughSamples(repWindow.topFrameCount) &&
    repWindow.topHeightAsymmetry > FORM_THRESHOLDS.ASYMMETRY_WARN
  ) {
    messages.push('Even it out \u2014 raise both arms to the same height.');
  }

  // 6. Raise tempo
  if (cueFamilyAllowed(allowedCueFamilies, 'visibleArmRaise') && repWindow.tTop !== null) {
    const tRaise = repWindow.tTop - repWindow.tStart;
    if (tRaise > 0 && tRaise < FORM_THRESHOLDS.TEMPO_RAISE_MIN) {
      messages.push('Lift with control \u2014 avoid swinging the weights up.');
    }
  }

  // 7. Eccentric tempo
  if (cueFamilyAllowed(allowedCueFamilies, 'visibleArmRaise') && repWindow.tLoweringStart !== null) {
    const tLower = repWindow.tEnd - repWindow.tLoweringStart;
    if (tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN) {
      messages.push('Control the descent \u2014 lower the weights slowly.');
    }
  }

  // 8. Shoulder shrug
  if (
    cueFamilyAllowed(allowedCueFamilies, 'torsoControl') &&
    effectiveShrugPct(repWindow) > FORM_THRESHOLDS.SHRUG_WARN
  ) {
    messages.push('Relax your traps \u2014 don\'t shrug the weight up.');
  }

  // 9. Wrong plane
  if (
    cueFamilyAllowed(allowedCueFamilies, 'shoulderElbowWristPath') &&
    hasEnoughSamples(repWindow.lateralReachSampleCount) &&
    weakestPeakLateralReachRatio(repWindow) < FORM_THRESHOLDS.LATERAL_REACH_MIN
  ) {
    messages.push('Raise out to your sides \u2014 avoid turning it into a front raise.');
  }

  return messages;
}

function lateralRaiseViewCueGatingDiagnostic(
  decision: LateralRaiseViewCueDecision,
): NonNullable<FrameworkRepResult['diagnostics']>['viewCueGating'] {
  return {
    viewBlockedCueFamilies: decision.viewBlockedCueFamilies,
    poseStateBlockedCueFamilies: decision.poseStateBlockedCueFamilies,
    finalSafeCueFamilies: decision.finalSafeCueFamilies,
    finalUnsafeCueFamilies: decision.finalUnsafeCueFamilies,
    finalScorableReason: decision.finalScorableReason,
    finalUnscorableReason: decision.finalUnscorableReason,
    sideViewGatePassed: decision.frontViewGatePassed,
    frontViewGatePassed: decision.frontViewGatePassed,
    partialViewScoringAllowed: decision.partialViewScoringAllowed,
  };
}

function applyLateralRaiseCueGating(
  diagnostics: NonNullable<FrameworkRepResult['diagnostics']>,
  interpretation: RepReliabilityInterpretation | null,
  decision: LateralRaiseViewCueDecision,
): NonNullable<FrameworkRepResult['diagnostics']> {
  const viewBlockedFamilies = new Set(decision.viewBlockedCueFamilies);
  const poseStateBlockedFamilies = new Set(decision.poseStateBlockedCueFamilies);
  const suppressedIssueIds: string[] = [];
  const suppressedCueFamilies = new Set<string>();
  const cues = Object.fromEntries(
    Object.entries(diagnostics.cues).map(([issueId, cue]) => {
      const family = LATERAL_RAISE_ISSUE_CUE_FAMILIES[issueId];
      if (!family) return [issueId, cue];
      const viewBlocked = viewBlockedFamilies.has(family);
      const poseStateBlocked = poseStateBlockedFamilies.has(family);
      if (!viewBlocked && !poseStateBlocked) return [issueId, cue];

      suppressedIssueIds.push(issueId);
      suppressedCueFamilies.add(family);
      return [issueId, {
        ...cue,
        eligible: false,
        triggered: false,
        skippedReason: viewBlocked
          ? `view_unsafe_${family}`
          : `reliability_unsafe_${family}`,
      }];
    }),
  );

  return {
    ...diagnostics,
    scorable: decision.scorable,
    cues,
    viewCueGating: lateralRaiseViewCueGatingDiagnostic(decision),
    reliability: interpretation
      ? {
          ...interpretation,
          suppressedCueFamilies: sortedUnique(suppressedCueFamilies),
          suppressedIssueIds: sortedUnique(suppressedIssueIds),
        }
      : diagnostics.reliability,
  };
}

function shouldLogLateralRaiseReliability(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    !(typeof process !== 'undefined' && process.env.JEST_WORKER_ID)
  );
}

function logLateralRaiseRepReliability(
  repIndex: number,
  interpretation: RepReliabilityInterpretation | null,
  diagnostics: FrameworkRepResult['diagnostics'],
): void {
  if (!interpretation || !shouldLogLateralRaiseReliability()) return;
  const reliability = diagnostics?.reliability;
  console.log([
    `[LateralRaiseReliability] rep=${repIndex}`,
    `countability=${interpretation.countabilityCandidate}`,
    `scoreability=${interpretation.scoreabilityCandidate}`,
    `usableChains=${interpretation.usableChains.join(',') || 'none'}`,
    `weakChains=${interpretation.weakChains.join(',') || 'none'}`,
    `safeCueFamilies=${interpretation.safeCueFamilies.join(',') || 'none'}`,
    `unsafeCueFamilies=${interpretation.unsafeCueFamilies.join(',') || 'none'}`,
    `suppressedIssues=${reliability?.suppressedIssueIds?.join(',') || 'none'}`,
    `suppressedFamilies=${reliability?.suppressedCueFamilies?.join(',') || 'none'}`,
    `frontViewGate=${diagnostics?.viewCueGating?.frontViewGatePassed === true ? 'passed' : 'failed'}`,
    `partialViewScoring=${diagnostics?.viewCueGating?.partialViewScoringAllowed === true ? 'allowed' : 'blocked'}`,
    `reasons=${interpretation.reasons.join(',') || 'none'}`,
  ].join(' '));
}

function buildLateralRaiseRepResult(repWindow: RepWindow, repIndex: number): RepResult {
  const reliability = reliabilityInterpretationForRepWindow(repWindow);
  const reliabilityInterpretation = reliability?.interpretation ?? null;
  const cueDecision = resolveLateralRaiseViewCueDecision(repWindow, reliabilityInterpretation);
  const allowedCueFamilies = cueDecision.finalAllowedCueFamilies;
  const messages = generateFormMessages(repWindow, allowedCueFamilies);
  const diagnostics = applyLateralRaiseCueGating(
    buildLateralRaiseDiagnostics(repWindow, repIndex, cueDecision.scorable),
    reliabilityInterpretation,
    cueDecision,
  );
  // Score only from cue families that survive both PoseState and view gating.
  const score = cueDecision.finalAllowedCueFamilies.size > 0 && reliabilityAllowsScoring(reliabilityInterpretation)
    ? computeRepWindowScore(repWindow, allowedCueFamilies)
    : 0;
  logLateralRaiseRepReliability(repIndex, reliabilityInterpretation, diagnostics);

  return {
    repIndex,
    score,
    messages,
    scorable: cueDecision.scorable,
    qualityWarnings: lateralRaiseQualityWarnings(repWindow),
    diagnostics,
  };
}

function buildLateralRaiseDiagnostics(
  repWindow: RepWindow,
  repIndex: number,
  scorable = isLateralRaiseRepScorable(repWindow),
): NonNullable<FrameworkRepResult['diagnostics']> {
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
  const hasWristEndpointSamples = repWindow.wristEndpointSampleCount > 0;
  const wristEndpointCoverageValue = wristEndpointCoverage(repWindow);
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
    scorable,
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
      diagnosticMetric('weakestPeakLateralReachRatio', weakestPeakLateralReachRatio(repWindow), {
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
      diagnosticMetric('wristEndpointCoverage', wristEndpointCoverageValue, {
        unit: 'ratio',
        eligible: hasWristEndpointSamples,
        sampleCount: repWindow.wristEndpointSampleCount,
        skippedReason: 'no_rep_frames',
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
        unit: 'percent',
        eligible: hasShrug,
        sampleCount: Math.max(repWindow.shrugSampleCount, repWindow.headShrugSampleCount),
        skippedReason: 'insufficient_shrug_samples',
      }),
      diagnosticMetric('headShrugPct', repWindow.maxHeadShrugPct, {
        unit: 'percent',
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
        metricKeys: ['weakestPeakLateralReachRatio'],
        direction: 'below',
        value: weakestPeakLateralReachRatio(repWindow),
        thresholdPath: 'formThresholds.LATERAL_REACH_MIN',
        thresholdValue: FORM_THRESHOLDS.LATERAL_REACH_MIN,
        eligible: hasLateralReach,
        triggered: hasLateralReach && weakestPeakLateralReachRatio(repWindow) < FORM_THRESHOLDS.LATERAL_REACH_MIN,
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

  if (frameContext?.trackingInterrupted) {
    resetLateralRaiseAfterTrackingInterruption(state);
    return state;
  }

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
  // Uses an explicit elbow-projected endpoint only for rep-count continuity
  // when wrist landmarks drop out; wrist-dependent form cues remain ineligible.
  const leftWristVisible = isVisible(lw, VISIBILITY_THRESHOLD);
  const rightWristVisible = isVisible(rw, VISIBILITY_THRESHOLD);
  const leftWristEndpoint = leftWristVisible
    ? lw!
    : estimateWristEndpointFromElbow('left_wrist_estimated', ls!, le!);
  const rightWristEndpoint = rightWristVisible
    ? rw!
    : estimateWristEndpointFromElbow('right_wrist_estimated', rs!, re!);
  const rawLeftHeightRatio = computeArmHeightRatio(leftWristEndpoint, lh!, rh!, ls!, rs!);
  const rawRightHeightRatio = computeArmHeightRatio(rightWristEndpoint, lh!, rh!, ls!, rs!);
  const rawLeftLateralReach = leftWristVisible
    ? computeLateralReachRatio('left', ls!, lw!, lh!, rh!, ls!, rs!)
    : NaN;
  const rawRightLateralReach = rightWristVisible
    ? computeLateralReachRatio('right', rs!, rw!, lh!, rh!, ls!, rs!)
    : NaN;

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
  const rawShoulderHeadGapEstimate = computeShoulderHeadGap(imageKeypoints);
  const rawShoulderHeadGap = rawShoulderHeadGapEstimate?.gap ?? null;
  const rawShoulderHeadSource = rawShoulderHeadGapEstimate?.source ?? null;
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
  const lateralReachConf = leftWristVisible && rightWristVisible ? Math.min(leftHeightConf, rightHeightConf) : 0;
  const headShrugConf = rawShoulderHeadGapEstimate?.confidence ?? 0;
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
      if (state.restShoulderHeadGap === null || rawShoulderHeadGap > state.restShoulderHeadGap) {
        state.restShoulderHeadGap = rawShoulderHeadGap;
        state.restShoulderHeadSource = rawShoulderHeadSource;
      }
    }
  }

  // -- Track rep start --
  if (prevPhase === 'REST' && state.phase === 'RAISING') {
    state.tRepStart = t;
    state.repWindow = initRepWindow(
      t,
      state.restTorsoHeight,
      state.restShoulderHeadGap,
      state.restShoulderHeadSource,
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
    if (frameContext?.poseState) {
      state.repWindow.reliability.observe(frameContext.poseState);
    }
    accumulateRepWindowFrame(state.repWindow, {
      t,
      phase: state.phase,
      avgHeightRatio: fastAvgHeightRatio,
      leftHeightRatio: fastLeftHeightRatio,
      rightHeightRatio: fastRightHeightRatio,
      leftWristEndpointObserved: leftWristVisible,
      rightWristEndpointObserved: rightWristVisible,
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
      shoulderHeadSource: rawShoulderHeadSource,
      headShrugConf,
      viewAngle,
    });
  }

  // -- Handle rep completion --
  if (fsmResult.repCompleted && state.repWindow) {
    state.repCount++;

    state.lastRepResult = buildLateralRaiseRepResult(state.repWindow, state.repCount);
    const messages = state.lastRepResult.messages;

    if (state.lastRepResult.scorable === false) {
      state.feedback = 'Form view unclear.';
    } else if (messages.length > 0) {
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
        state.feedback = state.lastRepResult.scorable === false
          ? 'Form view unclear.'
          : messages.length > 0 ? messages.join('\n') : 'Good rep.';
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
// CONFIG VALIDATION
// ============================================================================

function configNumber(config: ExerciseHeuristicConfig, path: string, issues: string[]): number | null {
  const value = getConfigValue(config, path);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  issues.push(`Lateral Raise config "${path}" must be a finite number.`);
  return null;
}

function requireOrdered(
  config: ExerciseHeuristicConfig,
  issues: string[],
  lowerPath: string,
  upperPath: string,
  allowEqual = false,
): void {
  const lower = configNumber(config, lowerPath, issues);
  const upper = configNumber(config, upperPath, issues);
  if (lower === null || upper === null) return;
  const valid = allowEqual ? lower <= upper : lower < upper;
  if (!valid) {
    issues.push(
      `Lateral Raise config "${lowerPath}" must be ${allowEqual ? 'less than or equal to' : 'less than'} "${upperPath}".`,
    );
  }
}

function requirePositive(config: ExerciseHeuristicConfig, issues: string[], path: string): void {
  const value = configNumber(config, path, issues);
  if (value !== null && value <= 0) {
    issues.push(`Lateral Raise config "${path}" must be greater than 0.`);
  }
}

function requireNonNegative(config: ExerciseHeuristicConfig, issues: string[], path: string): void {
  const value = configNumber(config, path, issues);
  if (value !== null && value < 0) {
    issues.push(`Lateral Raise config "${path}" must be greater than or equal to 0.`);
  }
}

function requirePositiveInteger(config: ExerciseHeuristicConfig, issues: string[], path: string): void {
  const value = configNumber(config, path, issues);
  if (value !== null && (!Number.isInteger(value) || value <= 0)) {
    issues.push(`Lateral Raise config "${path}" must be a positive integer.`);
  }
}

function validatePenaltyConfigs(config: ExerciseHeuristicConfig, issues: string[]): void {
  const penaltyConfigs = getConfigValue(config, 'penaltyConfigs');
  if (penaltyConfigs === null || typeof penaltyConfigs !== 'object' || Array.isArray(penaltyConfigs)) {
    issues.push('Lateral Raise config "penaltyConfigs" must be an object.');
    return;
  }

  for (const [penaltyName, penaltyConfig] of Object.entries(penaltyConfigs)) {
    if (penaltyConfig === null || typeof penaltyConfig !== 'object' || Array.isArray(penaltyConfig)) {
      issues.push(`Lateral Raise penalty config "${penaltyName}" must be an object.`);
      continue;
    }
    for (const [key, value] of Object.entries(penaltyConfig)) {
      const path = `penaltyConfigs.${penaltyName}.${key}`;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(`Lateral Raise config "${path}" must be a finite number.`);
        continue;
      }
      if ((key === 'cap' || key === 'deadzone' || key === 'scale') && value < 0) {
        issues.push(`Lateral Raise config "${path}" must be greater than or equal to 0.`);
      }
    }
  }
}

function validateLateralRaiseHeuristicConfig(config: ExerciseHeuristicConfig): string[] {
  const issues: string[] = [];

  requireOrdered(config, issues, 'thresholds.REST_ENTER', 'thresholds.RAISING_ENTER', true);
  requireOrdered(config, issues, 'thresholds.RAISING_ENTER', 'thresholds.MIN_PARTIAL_HEIGHT_RATIO');
  requireOrdered(config, issues, 'thresholds.MIN_PARTIAL_HEIGHT_RATIO', 'thresholds.TOP_EXIT');
  requireOrdered(config, issues, 'thresholds.TOP_EXIT', 'thresholds.TOP_ENTER');
  requireOrdered(config, issues, 'thresholds.TOP_ENTER', 'formThresholds.ROM_MIN', true);
  requireOrdered(config, issues, 'formThresholds.ROM_MIN', 'formThresholds.OVER_RAISE_WARN');

  for (const path of [
    'thresholds.REST_ENTER',
    'thresholds.RAISING_ENTER',
    'thresholds.MIN_PARTIAL_HEIGHT_RATIO',
    'thresholds.TOP_EXIT',
    'thresholds.TOP_ENTER',
    'formThresholds.ROM_MIN',
    'formThresholds.OVER_RAISE_WARN',
  ]) {
    requireNonNegative(config, issues, path);
  }

  for (const path of [
    'thresholds.MIN_REP_TIME',
    'formThresholds.TEMPO_RAISE_MIN',
    'formThresholds.TEMPO_LOWER_MIN',
  ]) {
    requirePositive(config, issues, path);
  }

  for (const path of [
    'formThresholds.ELBOW_STRAIGHTNESS_WARN',
    'formThresholds.TORSO_LEAN_WARN',
    'formThresholds.ASYMMETRY_WARN',
    'formThresholds.SHRUG_WARN',
    'formThresholds.LATERAL_REACH_MIN',
    'formThresholds.SAGITTAL_SWAY_WARN',
    'formThresholds.HIP_SWAY_WARN',
    'formThresholds.WRIST_ENDPOINT_SCORABLE_MIN_COVERAGE',
  ]) {
    requireNonNegative(config, issues, path);
  }

  const elbowStraightness = configNumber(config, 'formThresholds.ELBOW_STRAIGHTNESS_WARN', issues);
  if (elbowStraightness !== null && elbowStraightness > 1) {
    issues.push('Lateral Raise config "formThresholds.ELBOW_STRAIGHTNESS_WARN" must be at most 1.');
  }

  const wristCoverage = configNumber(config, 'formThresholds.WRIST_ENDPOINT_SCORABLE_MIN_COVERAGE', issues);
  if (wristCoverage !== null && wristCoverage > 1) {
    issues.push('Lateral Raise config "formThresholds.WRIST_ENDPOINT_SCORABLE_MIN_COVERAGE" must be at most 1.');
  }

  requirePositiveInteger(config, issues, 'formThresholds.MIN_FORM_SAMPLES');
  validatePenaltyConfigs(config, issues);

  return issues;
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
    liveQualityWarnings: [],
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
    const completedNewRep = internal.repCount > state.repCount;
    const liveQualityWarnings = internal.repWindow
      ? lateralRaiseQualityWarnings(internal.repWindow)
      : completedNewRep
        ? (lastRepResult?.qualityWarnings ?? [])
        : [];

    return {
      repCount: internal.repCount,
      lastRepResult,
      feedback: internal.feedback,
      feedbackTimestamp: internal.lastFeedbackTime > 0 ? internal.lastFeedbackTime : null,
      debugInfo: getDebugInfo(internal) as unknown as Record<string, unknown>,
      repQualityWindowActive: internal.repWindow !== null,
      liveQualityWarnings,
      _internal: internal,
    };
  },

  heuristicConfig: config,
  tunableSpec: LATERAL_RAISE_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/lateralRaise.json',
  validateHeuristicConfig: validateLateralRaiseHeuristicConfig,
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
