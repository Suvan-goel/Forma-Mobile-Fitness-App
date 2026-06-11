/**
 * Barbell Squat Exercise Definition
 *
 * Side-view squat analysis using knee reach ratio as the primary FSM driver.
 * Knee reach ratio: dist2D(hip,ankle) / (dist2D(hip,knee) + dist2D(knee,ankle))
 *   ~0.95-0.98 = legs fully extended (standing), ~0.60-0.70 = deep squat
 *
 * Evaluates true side-view depth, lockout, torso lean, heel lift, and tempo.
 *
 * FSM: IDLE -> STANDING -> DESCENDING -> BOTTOM -> ASCENDING -> STANDING
 * - IDLE gate: user must hold a standing pose for 0.8s before FSM activates
 * - After first rep, FSM resets to STANDING (skips IDLE)
 *
 * The only export is `squatDefinition`.
 */

import {
  Keypoint,
  calculateSignedVerticalAngleSagittal,
  calculateVerticalAngle,
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
  RepViewQualityDiagnostic,
} from '../types';
import {
  createDefaultTunableSpec,
  getConfigValue,
  mergeHeuristicConfig,
  runWithConfigBindings,
} from '../heuristicConfig';
import {
  buildRepDiagnostics,
  diagnosticCue,
  diagnosticLabelMetric,
  diagnosticMetric,
} from '../shared/diagnostics';
import { LOW_ROM_FEEDBACK, isMeaningfulPartialRep } from '../shared/partialReps';
import { createPoseStateReliabilityAggregator } from '../../pose/buildPoseState';
import {
  interpretPoseStateReliabilitySummary,
  type RepReliabilityInterpretation,
} from '../shared/reliabilityInterpretation';
import { cameraStatusFromExerciseFeedbackReadiness } from '../shared/liveAnalysisStatus';
import type { PoseStateReliabilitySummary } from '../../pose/PoseState';
import type { CameraAnalysisStatus } from '../shared/cameraAnalysisStatus';
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
  MIN_PARTIAL_ROM: 0.10,
  /** Minimum ratio ROM for a full rep to count */
  MIN_REP_ROM: 0.15,
  /** Minimum frames in rep window for a rep to count */
  MIN_REP_FRAMES: 8,
} as const;

/** Form heuristic thresholds — ratio-based fallback for knee, angle-based for true depth/torso/foot */
const FORM_THRESHOLDS = {
  // Knee-ratio fallback depth: lower ratio = deeper squat. Parallel ~ ratio 0.60-0.65.
  DEPTH_WARN: 0.70,   // min ratio > 0.70 = not quite parallel
  DEPTH_FAIL: 0.76,   // min ratio > 0.76 = clearly shallow
  // True side-view thigh depth: positive = hip above knee (shallow), 0 = roughly parallel.
  THIGH_DEPTH_WARN: 12,
  THIGH_DEPTH_FAIL: 22,
  // Lockout: max ratio below this = incomplete lockout
  LOCKOUT_FAIL: 0.95,
  LOCKOUT_BASELINE_DELTA_FAIL: 0.035,
  // ROM: minimum ratio change during rep
  ROM_MIN: 0.20,
  // Torso lean (forward lean from vertical, via hip-shoulder vector — already camera-invariant)
  TORSO_LEAN_WARN: 40, // max torso lean > 40 degrees (natural squat lean is 15-35)
  TORSO_LEAN_FAIL: 50, // max torso lean > 50 degrees
  TORSO_LEAN_DELTA_WARN: 12,
  TORSO_LEAN_DELTA_FAIL: 18,
  // Heel lift: foot pitch increase from the standing baseline.
  HEEL_LIFT_WARN: 12,
  HEEL_LIFT_MIN_SUPPORT: 0.2,
  HEEL_LIFT_MIN_ELIGIBLE_SUPPORT: 0.35,
  // Side-view quality: left/right body width divided by body height.
  SIDE_VIEW_WIDTH_WARN: 0.18,
  SIDE_VIEW_WIDTH_FAIL: 0.28,
  // Multi-view quality: world shoulder yaw angle, where 0 = front and ~90 = side.
  FRONT_VIEW_MAX: 35,
  OBLIQUE_VIEW_MAX: 65,
  VIEW_MIN_SAMPLES: 5,
  VIEW_CONFIDENCE_MIN: 0.3,
  METRIC_CONFIDENCE_MIN: 0.3,
  BASELINE_CONFIDENCE_MIN: 0.3,
  SIDE_VIEW_MIN_SUPPORT: 0.45,
  FRONT_VIEW_MIN_SUPPORT: 0.45,
  OBLIQUE_VIEW_MIN_SUPPORT: 0.45,
  WORLD_KNEE_RATIO_MIN_SUPPORT: 0.35,
  // Front-view knee tracking: inward knee offset from hip-to-ankle line.
  KNEE_VALGUS_WARN: 0.10,
  KNEE_VALGUS_FAIL: 0.16,
  KNEE_TRACKING_CONFIDENCE_MIN: 0.3,
  KNEE_VALGUS_MIN_SUPPORT: 0.20,
  KNEE_VALGUS_MIN_ELIGIBLE_SUPPORT: 0.35,
  // Tempo
  TEMPO_CONCENTRIC_MIN: 0.3,  // ascent too fast (seconds)
  TEMPO_ECCENTRIC_MIN: 0.8,   // descent too fast (seconds)
} as const;

/**
 * Continuous penalty curve parameters.
 *
 * Depth uses the true thigh-depth angle when eligible and falls back to the
 * legacy knee reach ratio when hip/knee visibility is insufficient.
 *
 * Max total penalty: 100 -> worst possible rep = 0.
 */
const SCORE_CURVES = {
  THIGH_DEPTH: { deadzone: 5, scale: 0.10, cap: 35 },
  DEPTH:   { deadzone: 0.66, scale: 3000, cap: 35 },
  LOCKOUT: { ideal: 0.98,    scale: 15000, cap: 20 },
  TORSO:   { deadzone: 30,   scale: 0.06, cap: 30 },
  HEEL_LIFT: { deadzone: 8, scale: 0.35, cap: 15 },
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
const viewMinSamplesTunable = SQUAT_TUNABLE_SPEC.tunables.find(
  (tunable) => tunable.path === 'formThresholds.VIEW_MIN_SAMPLES',
);
if (viewMinSamplesTunable) {
  viewMinSamplesTunable.min = 1;
  viewMinSamplesTunable.max = 15;
  viewMinSamplesTunable.step = 1;
}
SQUAT_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'barbell-squat.depth_short', metricKey: 'thighDepthAngle', thresholdPath: 'formThresholds.THIGH_DEPTH_WARN', direction: 'above' },
  { issueId: 'barbell-squat.lockout_short', metricKey: 'lockoutRatio', thresholdPath: 'formThresholds.LOCKOUT_FAIL', direction: 'below' },
  { issueId: 'barbell-squat.lockout_short', metricKey: 'lockoutDeltaRatio', thresholdPath: 'formThresholds.LOCKOUT_BASELINE_DELTA_FAIL', direction: 'above' },
  { issueId: 'barbell-squat.incomplete_rom', metricKey: 'romRatio', thresholdPath: 'formThresholds.ROM_MIN', direction: 'below' },
  { issueId: 'barbell-squat.heel_lift', metricKey: 'heelLiftDeltaDeg', thresholdPath: 'formThresholds.HEEL_LIFT_WARN', direction: 'above' },
  { issueId: 'barbell-squat.heel_lift', metricKey: 'heelLiftOverThresholdSupport', thresholdPath: 'formThresholds.HEEL_LIFT_MIN_SUPPORT', direction: 'above' },
  { issueId: 'barbell-squat.heel_lift', metricKey: 'heelLiftEligibleSupport', thresholdPath: 'formThresholds.HEEL_LIFT_MIN_ELIGIBLE_SUPPORT', direction: 'above' },
  { issueId: 'barbell-squat.torso_fail', metricKey: 'torsoLeanSigned', thresholdPath: 'formThresholds.TORSO_LEAN_FAIL', direction: 'above' },
  { issueId: 'barbell-squat.torso_warn', metricKey: 'torsoLeanSigned', thresholdPath: 'formThresholds.TORSO_LEAN_WARN', direction: 'above' },
  { issueId: 'barbell-squat.torso_fail', metricKey: 'torsoLeanDelta', thresholdPath: 'formThresholds.TORSO_LEAN_DELTA_FAIL', direction: 'above' },
  { issueId: 'barbell-squat.torso_warn', metricKey: 'torsoLeanDelta', thresholdPath: 'formThresholds.TORSO_LEAN_DELTA_WARN', direction: 'above' },
  { issueId: 'barbell-squat.tempo_up', metricKey: 'tUp', thresholdPath: 'formThresholds.TEMPO_CONCENTRIC_MIN', direction: 'below' },
  { issueId: 'barbell-squat.tempo_down', metricKey: 'tDown', thresholdPath: 'formThresholds.TEMPO_ECCENTRIC_MIN', direction: 'below' },
];
SQUAT_TUNABLE_SPEC.tunables = SQUAT_TUNABLE_SPEC.tunables.filter((tunable) =>
  !tunable.path.includes('KNEE_VALGUS') &&
  !tunable.path.includes('KNEE_TRACKING') &&
  !tunable.path.includes('FRONT_VIEW') &&
  !tunable.path.includes('OBLIQUE_VIEW')
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
type SideViewQuality = 'good' | 'warn' | 'fail' | 'unknown';
type SquatViewClass = 'side' | 'front' | 'oblique' | 'unknown';
type SquatMetricSource = 'world' | 'image';
type SquatSide = 'left' | 'right';

interface SquatViewEstimate {
  viewClass: SquatViewClass;
  confidence: number;
  angleDeg: number | null;
  source: 'world' | 'image_width' | 'unknown';
}

interface KneeTrackingEstimate {
  offsetRatio: number;
  confidence: number;
  supportedSides: number;
}

interface KneeRatioEstimate {
  ratio: number;
  confidence: number;
  source: SquatMetricSource;
}

interface MovementKneeRatioEstimate extends KneeRatioEstimate {
  left: KneeRatioEstimate | null;
  right: KneeRatioEstimate | null;
}

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
  endKneeRatio: number | null;
  minRawKneeRatio: number;
  maxRawKneeRatio: number;
  endRawKneeRatio: number | null;
  lockoutBaselineRatio: number | null;
  kneeRatioSampleCount: number;
  worldKneeRatioSampleCount: number;
  imageKneeRatioSampleCount: number;
  leftKneeRatioMin: number;
  leftKneeRatioMax: number;
  leftKneeRatioEnd: number | null;
  leftRawKneeRatioMin: number;
  leftRawKneeRatioMax: number;
  leftRawKneeRatioEnd: number | null;
  leftKneeRatioSampleCount: number;
  leftWorldKneeRatioSampleCount: number;
  leftImageKneeRatioSampleCount: number;
  leftKneeRatioConfidenceSum: number;
  rightKneeRatioMin: number;
  rightKneeRatioMax: number;
  rightKneeRatioEnd: number | null;
  rightRawKneeRatioMin: number;
  rightRawKneeRatioMax: number;
  rightRawKneeRatioEnd: number | null;
  rightKneeRatioSampleCount: number;
  rightWorldKneeRatioSampleCount: number;
  rightImageKneeRatioSampleCount: number;
  rightKneeRatioConfidenceSum: number;
  /** True thigh depth angle: positive = shallow, 0 = parallel, negative = below parallel */
  minThighDepthAngle: number;
  minRawThighDepthAngle: number;
  thighDepthSampleCount: number;
  thighDepthConfidenceSum: number;
  /** Max torso forward lean (degrees from vertical) during rep */
  maxTorsoLean: number;
  maxRawTorsoLean: number;
  torsoLeanBaseline: number | null;
  maxTorsoLeanDelta: number;
  torsoLeanSignedBaseline: number | null;
  maxTorsoLeanSigned: number;
  maxRawTorsoLeanSigned: number;
  maxTorsoLeanSignedDelta: number;
  torsoLeanSampleCount: number;
  torsoLeanConfidenceSum: number;
  torsoWorldSampleCount: number;
  torsoImageSampleCount: number;
  /** Heel lift relative to standing foot pitch baseline */
  footPitchBaseline: number | null;
  maxHeelLiftDeltaDeg: number;
  maxRawHeelLiftDeltaDeg: number;
  heelLiftSampleCount: number;
  heelLiftTriggeredSampleCount: number;
  heelLiftConfidenceSum: number;
  /** Side-view quality diagnostics */
  maxSideViewWidthRatio: number;
  sideViewSampleCount: number;
  sideViewConfidenceSum: number;
  /** Multi-view diagnostics */
  viewSampleCount: number;
  sideViewClassSampleCount: number;
  frontViewClassSampleCount: number;
  obliqueViewClassSampleCount: number;
  unknownViewClassSampleCount: number;
  viewConfidenceSum: number;
  viewConfidenceMin: number;
  maxViewAngleDeg: number;
  viewAngleSampleCount: number;
  /** Front-view knee tracking */
  maxKneeTrackingOffsetRatio: number;
  kneeTrackingSampleCount: number;
  kneeTrackingTriggeredSampleCount: number;
  kneeTrackingConfidenceSum: number;
  /** Timestamps */
  tStart: number;
  tBottom: number | null;
  tMovementEnd: number | null;
  tConfirmedEnd: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
  pendingCompletionFrames: number | null;
  /** True when a meaningful partial rep was counted from a reset before bottom */
  partialRep: boolean;
  reliability: ReturnType<typeof createPoseStateReliabilityAggregator>;
}

interface SquatAngles {
  knee: number;
  kneeRatio: number; // reach ratio: camera-invariant
  rawKneeRatio: number;
  leftKneeRatio: number;
  rightKneeRatio: number;
  rawLeftKneeRatio: number;
  rawRightKneeRatio: number;
  leftKneeRatioConfidence: number;
  rightKneeRatioConfidence: number;
  leftKneeRatioSourceRank: number;
  rightKneeRatioSourceRank: number;
  torsoLean: number;
  torsoLeanSigned: number;
  rawTorsoLean: number;
  rawTorsoLeanSigned: number;
  hipAngle: number;
  thighDepthAngle: number;
  rawThighDepthAngle: number;
  footPitch: number;
  rawFootPitch: number;
  sideViewWidthRatio: number;
  kneeTrackingOffsetRatio: number;
  viewAngleDeg: number;
  viewConfidence: number;
  viewClassRank: number;
  kneeRatioSourceRank: number;
  torsoSourceRank: number;
  viewSourceRank: number;
}

interface SmoothedSquatAngles extends SquatAngles {}

interface RepResult {
  repIndex: number;
  romRatio: number; // ratio ROM (max - min reach ratio)
  tDown: number;
  tUp: number;
  score: number;
  messages: string[];
  scorable?: boolean;
  qualityWarnings?: FrameworkRepResult['qualityWarnings'];
  diagnostics?: FrameworkRepResult['diagnostics'];
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
  /** Baselines captured at the top of the next rep */
  standingTorsoLeanBaseline: number | null;
  standingTorsoLeanSignedBaseline: number | null;
  standingFootPitchBaseline: number | null;
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
  thighDepthAngle: number | null;
  depthRatio: number | null;
  lockoutRatio: number | null;
  lockoutBaselineRatio: number | null;
  lockoutDeltaRatio: number | null;
  romRatio: number | null;
  heelLiftDeltaDeg: number | null;
  heelLiftSupport: number | null;
  heelLiftEligibleSupport: number | null;
  heelLiftOverThresholdSupport: number | null;
  torsoLeanDelta: number | null;
  torsoLeanSigned: number | null;
  sideViewWidthRatio: number | null;
  sideViewQuality: SideViewQuality;
  partialRep: boolean;
  kneeRatioMin: number | null;
  kneeRatioMax: number | null;
  maxTorsoLean: number | null;
  rawKneeRatio: number | null;
  leftKneeRatio: number | null;
  rightKneeRatio: number | null;
  leftKneeRatioSupport: number | null;
  rightKneeRatioSupport: number | null;
  leftWorldKneeRatioSupport: number | null;
  rightWorldKneeRatioSupport: number | null;
  rawThighDepthAngle: number | null;
  rawTorsoLean: number | null;
  rawFootPitch: number | null;
  kneeTrackingOffsetRatio: number | null;
  kneeTrackingEligibleSupport: number | null;
  kneeTrackingOverThresholdSupport: number | null;
  viewClass: SquatViewClass;
  viewAngleDeg: number | null;
  metricSource: SquatMetricSource | null;
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

function emptyAngleHistory(): Record<keyof SquatAngles, number[]> {
  return {
    knee: [],
    kneeRatio: [],
    rawKneeRatio: [],
    leftKneeRatio: [],
    rightKneeRatio: [],
    rawLeftKneeRatio: [],
    rawRightKneeRatio: [],
    leftKneeRatioConfidence: [],
    rightKneeRatioConfidence: [],
    leftKneeRatioSourceRank: [],
    rightKneeRatioSourceRank: [],
    torsoLean: [],
    torsoLeanSigned: [],
    rawTorsoLean: [],
    rawTorsoLeanSigned: [],
    hipAngle: [],
    thighDepthAngle: [],
    rawThighDepthAngle: [],
    footPitch: [],
    rawFootPitch: [],
    sideViewWidthRatio: [],
    kneeTrackingOffsetRatio: [],
    viewAngleDeg: [],
    viewConfidence: [],
    viewClassRank: [],
    kneeRatioSourceRank: [],
    torsoSourceRank: [],
    viewSourceRank: [],
  };
}

function initRepWindow(
  tStart: number,
  initialKneeRatio?: number,
  baselines: {
    torsoLeanBaseline?: number | null;
    torsoLeanSignedBaseline?: number | null;
    footPitchBaseline?: number | null;
  } = {},
): SquatRepWindow {
  return {
    minKneeRatio: initialKneeRatio ?? Infinity,
    maxKneeRatio: initialKneeRatio ?? -Infinity,
    endKneeRatio: initialKneeRatio ?? null,
    minRawKneeRatio: initialKneeRatio ?? Infinity,
    maxRawKneeRatio: initialKneeRatio ?? -Infinity,
    endRawKneeRatio: initialKneeRatio ?? null,
    lockoutBaselineRatio:
      initialKneeRatio !== undefined && Number.isFinite(initialKneeRatio)
        ? initialKneeRatio
        : null,
    kneeRatioSampleCount: 0,
    worldKneeRatioSampleCount: 0,
    imageKneeRatioSampleCount: 0,
    leftKneeRatioMin: Infinity,
    leftKneeRatioMax: -Infinity,
    leftKneeRatioEnd: null,
    leftRawKneeRatioMin: Infinity,
    leftRawKneeRatioMax: -Infinity,
    leftRawKneeRatioEnd: null,
    leftKneeRatioSampleCount: 0,
    leftWorldKneeRatioSampleCount: 0,
    leftImageKneeRatioSampleCount: 0,
    leftKneeRatioConfidenceSum: 0,
    rightKneeRatioMin: Infinity,
    rightKneeRatioMax: -Infinity,
    rightKneeRatioEnd: null,
    rightRawKneeRatioMin: Infinity,
    rightRawKneeRatioMax: -Infinity,
    rightRawKneeRatioEnd: null,
    rightKneeRatioSampleCount: 0,
    rightWorldKneeRatioSampleCount: 0,
    rightImageKneeRatioSampleCount: 0,
    rightKneeRatioConfidenceSum: 0,
    minThighDepthAngle: Infinity,
    minRawThighDepthAngle: Infinity,
    thighDepthSampleCount: 0,
    thighDepthConfidenceSum: 0,
    maxTorsoLean: -Infinity,
    maxRawTorsoLean: -Infinity,
    torsoLeanBaseline: baselines.torsoLeanBaseline ?? null,
    maxTorsoLeanDelta: 0,
    torsoLeanSignedBaseline: baselines.torsoLeanSignedBaseline ?? null,
    maxTorsoLeanSigned: -Infinity,
    maxRawTorsoLeanSigned: -Infinity,
    maxTorsoLeanSignedDelta: 0,
    torsoLeanSampleCount: 0,
    torsoLeanConfidenceSum: 0,
    torsoWorldSampleCount: 0,
    torsoImageSampleCount: 0,
    footPitchBaseline: baselines.footPitchBaseline ?? null,
    maxHeelLiftDeltaDeg: 0,
    maxRawHeelLiftDeltaDeg: 0,
    heelLiftSampleCount: 0,
    heelLiftTriggeredSampleCount: 0,
    heelLiftConfidenceSum: 0,
    maxSideViewWidthRatio: -Infinity,
    sideViewSampleCount: 0,
    sideViewConfidenceSum: 0,
    viewSampleCount: 0,
    sideViewClassSampleCount: 0,
    frontViewClassSampleCount: 0,
    obliqueViewClassSampleCount: 0,
    unknownViewClassSampleCount: 0,
    viewConfidenceSum: 0,
    viewConfidenceMin: Infinity,
    maxViewAngleDeg: -Infinity,
    viewAngleSampleCount: 0,
    maxKneeTrackingOffsetRatio: 0,
    kneeTrackingSampleCount: 0,
    kneeTrackingTriggeredSampleCount: 0,
    kneeTrackingConfidenceSum: 0,
    tStart,
    tBottom: null,
    tMovementEnd: null,
    tConfirmedEnd: null,
    tEnd: tStart,
    frameCount: 0,
    pendingCompletionFrames: null,
    partialRep: false,
    reliability: createPoseStateReliabilityAggregator(),
  };
}

function initializeSquatState(): SquatState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    angleHistory: emptyAngleHistory(),
    smoothed: null,
    fast: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
    standingKneeRatioPeak: -Infinity,
    standingTorsoLeanBaseline: null,
    standingTorsoLeanSignedBaseline: null,
    standingFootPitchBaseline: null,
  };
}

function resetSquatAfterTrackingInterruption(currentState: SquatState): SquatState {
  return {
    ...currentState,
    fsm: initFSM(),
    repWindow: null,
    angleHistory: emptyAngleHistory(),
    smoothed: null,
    fast: null,
    standingKneeRatioPeak: -Infinity,
    standingTorsoLeanBaseline: null,
    standingTorsoLeanSignedBaseline: null,
    standingFootPitchBaseline: null,
  };
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

type Point2D = { x: number; y: number };
type Point3D = { x: number; y: number; z: number };

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

function getPoint3D(kp: Keypoint | null): Point3D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y, z: kp.z ?? 0 };
}

/** Euclidean distance in 2D */
function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Euclidean distance in 3D world space */
function dist3D(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Reach ratio for a 3-joint chain. 1.0 = straight, lower = more bent. */
function computeReachRatio(proximal: Point2D, joint: Point2D, distal: Point2D): number {
  const chainLen = dist2D(proximal, joint) + dist2D(joint, distal);
  if (chainLen < 1e-6) return 1.0;
  return dist2D(proximal, distal) / chainLen;
}

function computeReachRatio3D(proximal: Point3D, joint: Point3D, distal: Point3D): number {
  const chainLen = dist3D(proximal, joint) + dist3D(joint, distal);
  if (chainLen < 1e-6) return 1.0;
  return dist3D(proximal, distal) / chainLen;
}

function inferYDown(
  shoulder: Keypoint | null | undefined,
  hip: Keypoint | null | undefined,
  distal?: Keypoint | null,
): boolean {
  if (shoulder && hip && Math.abs(shoulder.y - hip.y) > 1e-6) {
    return shoulder.y < hip.y;
  }
  if (distal && hip && Math.abs(distal.y - hip.y) > 1e-6) {
    return distal.y > hip.y;
  }
  return true;
}

/** Positive when `lowerCandidate` is lower in the frame/world than `upperCandidate`. */
function downwardDelta(lowerCandidate: Point2D, upperCandidate: Point2D, yDown: boolean): number {
  return yDown
    ? lowerCandidate.y - upperCandidate.y
    : upperCandidate.y - lowerCandidate.y;
}

/**
 * Side-view thigh depth relative to horizontal.
 * Positive = hip above knee/shallow, 0 = roughly parallel, negative = below parallel.
 */
function calculateThighDepthAngle(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const hip = getKeypoint(keypoints, `${side}_hip`);
  const knee = getKeypoint(keypoints, `${side}_knee`);
  if (!hip || !knee || !isVisible(hip, VISIBILITY_THRESHOLD) || !isVisible(knee, VISIBILITY_THRESHOLD)) {
    return null;
  }

  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const ankle = getKeypoint(keypoints, `${side}_ankle`);
  const yDown = inferYDown(shoulder, hip, ankle);
  const hipPt = getPoint(hip)!;
  const kneePt = getPoint(knee)!;
  if (Math.abs(kneePt.x - hipPt.x) < 1e-4) {
    return null;
  }
  const shallowVertical = downwardDelta(kneePt, hipPt, yDown);
  const horizontal = Math.max(Math.abs(kneePt.x - hipPt.x), 1e-6);
  return Math.atan2(shallowVertical, horizontal) * 180 / Math.PI;
}

/**
 * Foot pitch from heel to toe. Higher values mean the heel is lifting relative
 * to the forefoot; the form metric uses this relative to the standing baseline.
 */
function calculateFootPitch(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const heel = getKeypoint(keypoints, `${side}_heel`);
  const footIndex = getKeypoint(keypoints, `${side}_foot_index`);
  const ankle = getKeypoint(keypoints, `${side}_ankle`);
  if (
    !heel ||
    !footIndex ||
    !ankle ||
    !isVisible(heel, VISIBILITY_THRESHOLD) ||
    !isVisible(footIndex, VISIBILITY_THRESHOLD) ||
    !isVisible(ankle, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const hip = getKeypoint(keypoints, `${side}_hip`);
  const yDown = inferYDown(shoulder, hip, ankle);
  const heelPt = getPoint(heel)!;
  const footPt = getPoint(footIndex)!;
  const toeBelowHeel = downwardDelta(footPt, heelPt, yDown);
  const horizontal = Math.max(Math.abs(footPt.x - heelPt.x), 1e-6);
  return Math.atan2(toeBelowHeel, horizontal) * 180 / Math.PI;
}

function inferFacingSign(keypoints: Keypoint[], side: 'left' | 'right'): number | null {
  const heel = getKeypoint(keypoints, `${side}_heel`);
  const footIndex = getKeypoint(keypoints, `${side}_foot_index`);
  if (
    heel &&
    footIndex &&
    isVisible(heel, VISIBILITY_THRESHOLD) &&
    isVisible(footIndex, VISIBILITY_THRESHOLD) &&
    Math.abs(footIndex.x - heel.x) > 1e-4
  ) {
    return Math.sign(footIndex.x - heel.x);
  }

  const hip = getKeypoint(keypoints, `${side}_hip`);
  const knee = getKeypoint(keypoints, `${side}_knee`);
  if (
    hip &&
    knee &&
    isVisible(hip, VISIBILITY_THRESHOLD) &&
    isVisible(knee, VISIBILITY_THRESHOLD) &&
    Math.abs(knee.x - hip.x) > 1e-4
  ) {
    return Math.sign(knee.x - hip.x);
  }

  return null;
}

function visibleMidpoint(
  a: Keypoint | null,
  b: Keypoint | null,
): Point2D | null {
  if (!a || !b || !isVisible(a, VISIBILITY_THRESHOLD) || !isVisible(b, VISIBILITY_THRESHOLD)) {
    return null;
  }
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function calculateSignedTorsoLean(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const facingSign = inferFacingSign(keypoints, side);
  if (facingSign === null || facingSign === 0) return null;

  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  const centeredShoulder = visibleMidpoint(ls, rs);
  const centeredHip = visibleMidpoint(lh, rh);
  const sideShoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const sideHip = getKeypoint(keypoints, `${side}_hip`);
  const shoulder = centeredShoulder ?? getPoint(isVisible(sideShoulder, VISIBILITY_THRESHOLD) ? sideShoulder : null);
  const hip = centeredHip ?? getPoint(isVisible(sideHip, VISIBILITY_THRESHOLD) ? sideHip : null);

  if (!shoulder || !hip) return null;

  const yDown = inferYDown(sideShoulder, sideHip, getKeypoint(keypoints, `${side}_ankle`));
  const vertical = Math.max(Math.abs(downwardDelta(hip, shoulder, yDown)), 1e-6);
  const forward = (shoulder.x - hip.x) * facingSign;
  return Math.atan2(forward, vertical) * 180 / Math.PI;
}

function calculateSideViewWidthRatio(keypoints: Keypoint[]): number | null {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');
  if (
    !ls ||
    !rs ||
    !lh ||
    !rh ||
    !isVisible(ls, VISIBILITY_THRESHOLD) ||
    !isVisible(rs, VISIBILITY_THRESHOLD) ||
    !isVisible(lh, VISIBILITY_THRESHOLD) ||
    !isVisible(rh, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  const shoulderWidth = Math.abs(ls.x - rs.x);
  const hipWidth = Math.abs(lh.x - rh.x);
  const bodyHeightPoints = keypoints.filter((kp) =>
    kp.name &&
    ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle']
      .includes(kp.name) &&
    isVisible(kp, VISIBILITY_THRESHOLD)
  );
  if (bodyHeightPoints.length < 2) return null;

  const yValues = bodyHeightPoints.map((kp) => kp.y);
  const bodyHeight = Math.max(...yValues) - Math.min(...yValues);
  if (bodyHeight < 1e-6) return null;
  return ((shoulderWidth + hipWidth) / 2) / bodyHeight;
}

function viewClassToRank(viewClass: SquatViewClass): number {
  if (viewClass === 'side') return 0;
  if (viewClass === 'front') return 1;
  if (viewClass === 'oblique') return 2;
  return 3;
}

function rankToViewClass(rank: number): SquatViewClass {
  const rounded = Math.round(rank);
  if (rounded === 0) return 'side';
  if (rounded === 1) return 'front';
  if (rounded === 2) return 'oblique';
  return 'unknown';
}

function sourceToRank(source: SquatMetricSource): number {
  return source === 'world' ? 1 : 0;
}

function rankToSource(rank: number): SquatMetricSource | null {
  if (!Number.isFinite(rank)) return null;
  return Math.round(rank) >= 1 ? 'world' : 'image';
}

function estimateWorldViewAngle(worldKeypoints: Keypoint[] | undefined): { angleDeg: number; confidence: number } | null {
  if (!worldKeypoints) return null;
  const ls = getKeypoint(worldKeypoints, 'left_shoulder');
  const rs = getKeypoint(worldKeypoints, 'right_shoulder');
  if (!isVisible(ls, VISIBILITY_THRESHOLD) || !isVisible(rs, VISIBILITY_THRESHOLD)) return null;
  const confidence = minKeypointConfidence(worldKeypoints, ['left_shoulder', 'right_shoulder']);
  if (confidence < FORM_THRESHOLDS.VIEW_CONFIDENCE_MIN) return null;
  const dx = Math.abs(rs!.x - ls!.x);
  const dz = Math.abs((rs!.z ?? 0) - (ls!.z ?? 0));
  return {
    angleDeg: Math.atan2(dz, Math.max(dx, 1e-6)) * (180 / Math.PI),
    confidence,
  };
}

function classifyViewAngle(angleDeg: number): SquatViewClass {
  if (angleDeg < FORM_THRESHOLDS.FRONT_VIEW_MAX) return 'front';
  if (angleDeg < FORM_THRESHOLDS.OBLIQUE_VIEW_MAX) return 'oblique';
  return 'side';
}

function estimateSquatView(
  imageKeypoints: Keypoint[],
  worldKeypoints: Keypoint[] | undefined,
  sideViewWidthRatio: number | null,
): SquatViewEstimate {
  const worldAngle = estimateWorldViewAngle(worldKeypoints);
  if (worldAngle) {
    return {
      viewClass: classifyViewAngle(worldAngle.angleDeg),
      confidence: worldAngle.confidence,
      angleDeg: worldAngle.angleDeg,
      source: 'world',
    };
  }

  const leftSideConfidence = minKeypointConfidence(imageKeypoints, [
    'left_shoulder',
    'left_hip',
    'left_knee',
    'left_ankle',
  ]);
  const rightSideConfidence = minKeypointConfidence(imageKeypoints, [
    'right_shoulder',
    'right_hip',
    'right_knee',
    'right_ankle',
  ]);
  if (
    Math.max(leftSideConfidence, rightSideConfidence) >= FORM_THRESHOLDS.VIEW_CONFIDENCE_MIN &&
    Math.min(leftSideConfidence, rightSideConfidence) < VISIBILITY_THRESHOLD
  ) {
    return {
      viewClass: 'side',
      confidence: Math.max(leftSideConfidence, rightSideConfidence),
      angleDeg: null,
      source: 'image_width',
    };
  }

  const imageConfidence = minKeypointConfidence(imageKeypoints, [
    'left_shoulder',
    'right_shoulder',
    'left_hip',
    'right_hip',
  ]);
  if (
    sideViewWidthRatio !== null &&
    Number.isFinite(sideViewWidthRatio) &&
    imageConfidence >= FORM_THRESHOLDS.VIEW_CONFIDENCE_MIN
  ) {
    const viewClass =
      sideViewWidthRatio <= FORM_THRESHOLDS.SIDE_VIEW_WIDTH_WARN
        ? 'side'
        : sideViewWidthRatio >= FORM_THRESHOLDS.SIDE_VIEW_WIDTH_FAIL
          ? 'front'
          : 'oblique';
    return {
      viewClass,
      confidence: imageConfidence,
      angleDeg: null,
      source: 'image_width',
    };
  }

  return {
    viewClass: 'unknown',
    confidence: 0,
    angleDeg: null,
    source: 'unknown',
  };
}

function calculateSagittalTorsoLean(keypoints: Keypoint[]): number | null {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');
  if (
    !isVisible(ls, VISIBILITY_THRESHOLD) ||
    !isVisible(rs, VISIBILITY_THRESHOLD) ||
    !isVisible(lh, VISIBILITY_THRESHOLD) ||
    !isVisible(rh, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  const hipCenter = {
    x: (lh!.x + rh!.x) / 2,
    y: (lh!.y + rh!.y) / 2,
    z: ((lh!.z ?? 0) + (rh!.z ?? 0)) / 2,
  };
  const shoulderCenter = {
    x: (ls!.x + rs!.x) / 2,
    y: (ls!.y + rs!.y) / 2,
    z: ((ls!.z ?? 0) + (rs!.z ?? 0)) / 2,
  };
  const angle = calculateSignedVerticalAngleSagittal(hipCenter, shoulderCenter, lh!, rh!, ls!, rs!);
  return Number.isFinite(angle) ? angle : null;
}

function lineXAtY(hip: Point2D, ankle: Point2D, kneeY: number): number {
  const dy = ankle.y - hip.y;
  if (Math.abs(dy) < 1e-6) return (hip.x + ankle.x) / 2;
  const t = Math.max(0, Math.min(1, (kneeY - hip.y) / dy));
  return hip.x + (ankle.x - hip.x) * t;
}

function sideKneeTrackingOffset(
  hip: Keypoint,
  knee: Keypoint,
  ankle: Keypoint,
  midlineX: number,
  normalizer: number,
): number {
  const lineX = lineXAtY(getPoint(hip)!, getPoint(ankle)!, knee.y);
  const towardMidlineSign = Math.sign(midlineX - lineX);
  if (towardMidlineSign === 0) return 0;
  return Math.max(0, (knee.x - lineX) * towardMidlineSign) / normalizer;
}

function calculateKneeTracking(imageKeypoints: Keypoint[]): KneeTrackingEstimate | null {
  const required = [
    'left_hip',
    'right_hip',
    'left_knee',
    'right_knee',
    'left_ankle',
    'right_ankle',
  ];
  const confidence = minKeypointConfidence(imageKeypoints, required);
  if (confidence < FORM_THRESHOLDS.KNEE_TRACKING_CONFIDENCE_MIN) return null;

  const lh = getKeypoint(imageKeypoints, 'left_hip');
  const rh = getKeypoint(imageKeypoints, 'right_hip');
  const lk = getKeypoint(imageKeypoints, 'left_knee');
  const rk = getKeypoint(imageKeypoints, 'right_knee');
  const la = getKeypoint(imageKeypoints, 'left_ankle');
  const ra = getKeypoint(imageKeypoints, 'right_ankle');
  if (!lh || !rh || !lk || !rk || !la || !ra) return null;

  const hipWidth = Math.abs(lh.x - rh.x);
  const stanceWidth = Math.abs(la.x - ra.x);
  const normalizer = Math.max(stanceWidth, hipWidth, 1e-6);
  const midlineX = (lh.x + rh.x + la.x + ra.x) / 4;
  const leftOffset = sideKneeTrackingOffset(lh, lk, la, midlineX, normalizer);
  const rightOffset = sideKneeTrackingOffset(rh, rk, ra, midlineX, normalizer);

  return {
    offsetRatio: Math.max(leftOffset, rightOffset),
    confidence,
    supportedSides: 2,
  };
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

function calculateKneeRatioForSide(
  keypoints: Keypoint[] | undefined,
  side: SquatSide,
  source: SquatMetricSource,
): KneeRatioEstimate | null {
  if (!keypoints) return null;
  const hip = getKeypoint(keypoints, `${side}_hip`);
  const knee = getKeypoint(keypoints, `${side}_knee`);
  const ankle = getKeypoint(keypoints, `${side}_ankle`);
  if (
    !hip ||
    !knee ||
    !ankle ||
    !isVisible(hip, VISIBILITY_THRESHOLD) ||
    !isVisible(knee, VISIBILITY_THRESHOLD) ||
    !isVisible(ankle, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  const confidence = minKeypointConfidence(keypoints, [
    `${side}_hip`,
    `${side}_knee`,
    `${side}_ankle`,
  ]);
  const ratio = source === 'world'
    ? computeReachRatio3D(getPoint3D(hip)!, getPoint3D(knee)!, getPoint3D(ankle)!)
    : computeReachRatio(getPoint(hip)!, getPoint(knee)!, getPoint(ankle)!);
  if (!Number.isFinite(ratio)) return null;
  return { ratio, confidence, source };
}

function weightedKneeRatioAverage(samples: KneeRatioEstimate[]): KneeRatioEstimate | null {
  if (samples.length === 0) return null;
  let numerator = 0;
  let denominator = 0;
  let confidenceSum = 0;
  for (const sample of samples) {
    const weight = Math.max(sample.confidence, 1e-6);
    numerator += sample.ratio * weight;
    denominator += weight;
    confidenceSum += sample.confidence;
  }
  if (denominator <= 0) return null;
  return {
    ratio: numerator / denominator,
    confidence: confidenceSum / samples.length,
    source: samples.some((sample) => sample.source === 'world') ? 'world' : 'image',
  };
}

function chooseSideKneeRatio(
  side: SquatSide,
  world: Record<SquatSide, KneeRatioEstimate | null>,
  image: Record<SquatSide, KneeRatioEstimate | null>,
): KneeRatioEstimate | null {
  return world[side] ?? image[side];
}

function selectMovementKneeRatio(
  side: SquatSide,
  viewClass: SquatViewClass,
  world: Record<SquatSide, KneeRatioEstimate | null>,
  image: Record<SquatSide, KneeRatioEstimate | null>,
): MovementKneeRatioEstimate | null {
  const left = world.left ?? image.left;
  const right = world.right ?? image.right;

  if (viewClass === 'front') {
    const worldSamples = [world.left, world.right].filter(
      (sample): sample is KneeRatioEstimate => sample !== null,
    );
    const imageSamples = [image.left, image.right].filter(
      (sample): sample is KneeRatioEstimate => sample !== null,
    );
    const aggregate = weightedKneeRatioAverage(worldSamples) ?? weightedKneeRatioAverage(imageSamples);
    return aggregate ? { ...aggregate, left, right } : null;
  }

  const selected = chooseSideKneeRatio(side, world, image);
  return selected ? { ...selected, left, right } : null;
}

function calculateSquatAngles(
  keypoints: Keypoint[],
  side: 'left' | 'right',
  frameContext?: ExerciseFrameContext,
): SquatAngles | null {
  const imageKeypoints = frameContext?.imageKeypoints ?? keypoints;
  const worldKeypoints = frameContext?.worldKeypoints;
  const sideViewWidthRatio = calculateSideViewWidthRatio(imageKeypoints);
  const viewEstimate = estimateSquatView(imageKeypoints, worldKeypoints, sideViewWidthRatio);
  const worldKneeRatios: Record<SquatSide, KneeRatioEstimate | null> = {
    left: calculateKneeRatioForSide(worldKeypoints, 'left', 'world'),
    right: calculateKneeRatioForSide(worldKeypoints, 'right', 'world'),
  };
  const imageKneeRatios: Record<SquatSide, KneeRatioEstimate | null> = {
    left: calculateKneeRatioForSide(imageKeypoints, 'left', 'image'),
    right: calculateKneeRatioForSide(imageKeypoints, 'right', 'image'),
  };
  const movementKneeRatio = selectMovementKneeRatio(side, viewEstimate.viewClass, worldKneeRatios, imageKneeRatios);
  if (!movementKneeRatio) return null;

  const metricSource = movementKneeRatio.source;
  let metricKeypoints = metricSource === 'world' && worldKeypoints ? worldKeypoints : imageKeypoints;
  let hip = getKeypoint(metricKeypoints, `${side}_hip`);
  let knee = getKeypoint(metricKeypoints, `${side}_knee`);
  let shoulder = getKeypoint(metricKeypoints, `${side}_shoulder`);
  const hasSelectedMetricLeg =
    hip &&
    knee &&
    getKeypoint(metricKeypoints, `${side}_ankle`) &&
    isVisible(hip, VISIBILITY_THRESHOLD) &&
    isVisible(knee, VISIBILITY_THRESHOLD) &&
    isVisible(getKeypoint(metricKeypoints, `${side}_ankle`), VISIBILITY_THRESHOLD);
  if (!hasSelectedMetricLeg) {
    metricKeypoints = imageKeypoints;
    hip = getKeypoint(metricKeypoints, `${side}_hip`);
    knee = getKeypoint(metricKeypoints, `${side}_knee`);
    shoulder = getKeypoint(metricKeypoints, `${side}_shoulder`);
  }

  const kneeRatio = movementKneeRatio.ratio;
  const hipPt = getPoint(hip) ?? getPoint(getKeypoint(imageKeypoints, `${side}_hip`));
  const kneePt = getPoint(knee) ?? getPoint(getKeypoint(imageKeypoints, `${side}_knee`));

  // Hip angle (shoulder-hip-knee): indicates hip hinge depth
  let hipAngle = 180;
  if (shoulder && hipPt && kneePt && isVisible(shoulder, VISIBILITY_THRESHOLD)) {
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
  if (shoulder && hipPt && kneePt && isVisible(shoulder, VISIBILITY_THRESHOLD)) {
    // Store hip reach ratio (not used for FSM, just debug)
    hipAngle = computeReachRatio(getPoint(shoulder)!, hipPt, kneePt);
  }

  // Torso forward lean from vertical
  const sagittalTorsoLean = worldKeypoints ? calculateSagittalTorsoLean(worldKeypoints) : null;
  const torsoLean = sagittalTorsoLean !== null
    ? Math.abs(sagittalTorsoLean)
    : calculateTorsoLean(metricKeypoints, side);
  const torsoLeanSigned = sagittalTorsoLean ?? calculateSignedTorsoLean(metricKeypoints, side);
  const torsoSource: SquatMetricSource = sagittalTorsoLean !== null ? 'world' : metricSource;
  const thighDepthAngle = calculateThighDepthAngle(imageKeypoints, side);
  const footPitch = calculateFootPitch(imageKeypoints, side);
  const kneeTracking = calculateKneeTracking(imageKeypoints);

  return {
    knee: kneeRatio,
    kneeRatio,
    rawKneeRatio: kneeRatio,
    leftKneeRatio: movementKneeRatio.left?.ratio ?? NaN,
    rightKneeRatio: movementKneeRatio.right?.ratio ?? NaN,
    rawLeftKneeRatio: movementKneeRatio.left?.ratio ?? NaN,
    rawRightKneeRatio: movementKneeRatio.right?.ratio ?? NaN,
    leftKneeRatioConfidence: movementKneeRatio.left?.confidence ?? NaN,
    rightKneeRatioConfidence: movementKneeRatio.right?.confidence ?? NaN,
    leftKneeRatioSourceRank: movementKneeRatio.left ? sourceToRank(movementKneeRatio.left.source) : NaN,
    rightKneeRatioSourceRank: movementKneeRatio.right ? sourceToRank(movementKneeRatio.right.source) : NaN,
    torsoLean: torsoLean ?? NaN,
    torsoLeanSigned: torsoLeanSigned ?? NaN,
    rawTorsoLean: torsoLean ?? NaN,
    rawTorsoLeanSigned: torsoLeanSigned ?? NaN,
    hipAngle,
    thighDepthAngle: thighDepthAngle ?? NaN,
    rawThighDepthAngle: thighDepthAngle ?? NaN,
    footPitch: footPitch ?? NaN,
    rawFootPitch: footPitch ?? NaN,
    sideViewWidthRatio: sideViewWidthRatio ?? NaN,
    kneeTrackingOffsetRatio: kneeTracking?.offsetRatio ?? NaN,
    viewAngleDeg: viewEstimate.angleDeg ?? NaN,
    viewConfidence: viewEstimate.confidence,
    viewClassRank: viewClassToRank(viewEstimate.viewClass),
    kneeRatioSourceRank: sourceToRank(metricSource),
    torsoSourceRank: sourceToRank(torsoSource),
    viewSourceRank: viewEstimate.source === 'world' ? 1 : viewEstimate.source === 'image_width' ? 0 : NaN,
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
  const keys: (keyof SquatAngles)[] = [
    'knee',
    'kneeRatio',
    'leftKneeRatio',
    'rightKneeRatio',
    'hipAngle',
    'torsoLean',
    'torsoLeanSigned',
    'thighDepthAngle',
    'footPitch',
    'sideViewWidthRatio',
    'kneeTrackingOffsetRatio',
    'viewAngleDeg',
  ];
  const passthroughKeys: (keyof SquatAngles)[] = [
    'rawKneeRatio',
    'rawLeftKneeRatio',
    'rawRightKneeRatio',
    'leftKneeRatioConfidence',
    'rightKneeRatioConfidence',
    'leftKneeRatioSourceRank',
    'rightKneeRatioSourceRank',
    'rawTorsoLean',
    'rawTorsoLeanSigned',
    'rawThighDepthAngle',
    'rawFootPitch',
    'viewConfidence',
    'viewClassRank',
    'kneeRatioSourceRank',
    'torsoSourceRank',
    'viewSourceRank',
  ];
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

    // smoothed = median + EMA: stable for standing baselines and live display
    const prev = prevSmoothed?.[key];
    smoothedResult[key] =
      prev !== undefined && !isNaN(prev)
        ? EMA_ALPHA * medianValue + (1 - EMA_ALPHA) * prev
        : medianValue;
  }

  for (const key of passthroughKeys) {
    const value = rawAngles[key];
    smoothedResult[key] = value;
    fastResult[key] = value;
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

const SQUAT_FEEDBACK = {
  DEPTH_FAIL: 'Squat deeper \u2014 aim to get your thighs parallel.',
  DEPTH_WARN: 'Try to go a little deeper for full range of motion.',
  LOCKOUT: 'Stand all the way up \u2014 fully extend your knees.',
  ROM: 'Incomplete rep \u2014 use a full range of motion.',
  TORSO_FAIL: 'Too much forward lean \u2014 keep your chest up.',
  TORSO_WARN: 'Stay more upright \u2014 brace your core.',
  HEEL_LIFT: 'Keep your heels planted \u2014 drive through your mid-foot.',
  TEMPO_UP: 'Control the ascent \u2014 don\'t bounce out of the hole.',
  TEMPO_DOWN: 'Slow the descent \u2014 control the weight down.',
} as const;

const SQUAT_RELIABILITY_JOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
] as const;

const SQUAT_SELECTED_LEG_CUE_FAMILIES = [
  'repCount',
  'tempo',
  'visibleLegPath',
  'depth',
  'kneeTracking',
  'hipKneePath',
  'ankleFootPosition',
  'heelLift',
  'setupStance',
] as const;

const SQUAT_DISTAL_FOOT_CUE_FAMILIES = [
  'ankleFootPosition',
  'heelLift',
  'setupStance',
] as const;

const SQUAT_ISSUE_CUE_FAMILIES: Record<string, string[]> = {
  'barbell-squat.depth_short': ['depth', 'hipKneePath', 'visibleLegPath'],
  'barbell-squat.lockout_short': ['visibleLegPath', 'hipKneePath'],
  'barbell-squat.incomplete_rom': ['depth', 'hipKneePath', 'visibleLegPath'],
  'barbell-squat.heel_lift': ['ankleFootPosition', 'heelLift'],
  'barbell-squat.torso_fail': ['torsoLean', 'barPathOrUpperBody'],
  'barbell-squat.torso_warn': ['torsoLean', 'barPathOrUpperBody'],
  'barbell-squat.tempo_up': ['tempo'],
  'barbell-squat.tempo_down': ['tempo'],
};

const SQUAT_MESSAGE_CUE_FAMILIES: Record<string, string[]> = {
  [SQUAT_FEEDBACK.DEPTH_FAIL]: ['depth', 'hipKneePath', 'visibleLegPath'],
  [SQUAT_FEEDBACK.DEPTH_WARN]: ['depth', 'hipKneePath', 'visibleLegPath'],
  [SQUAT_FEEDBACK.LOCKOUT]: ['visibleLegPath', 'hipKneePath'],
  [SQUAT_FEEDBACK.ROM]: ['depth', 'hipKneePath', 'visibleLegPath'],
  [SQUAT_FEEDBACK.HEEL_LIFT]: ['ankleFootPosition', 'heelLift'],
  [SQUAT_FEEDBACK.TORSO_FAIL]: ['torsoLean', 'barPathOrUpperBody'],
  [SQUAT_FEEDBACK.TORSO_WARN]: ['torsoLean', 'barPathOrUpperBody'],
  [SQUAT_FEEDBACK.TEMPO_UP]: ['tempo'],
  [SQUAT_FEEDBACK.TEMPO_DOWN]: ['tempo'],
};

type SquatSeverity = 'none' | 'warn' | 'fail';
type DepthSource = 'thighDepthAngle' | 'depthRatio';

interface SquatMetricSnapshot {
  view: SquatViewClass;
  viewQuality: RepViewQualityDiagnostic;
  sideConfirmed: boolean;
  frontConfirmed: boolean;
  obliqueConfirmed: boolean;
  scorable: boolean;
  qualityWarnings: FrameworkRepResult['qualityWarnings'];
  worldKneeRatioSupport: number | null;
  imageKneeRatioSupport: number | null;
  leftKneeRatio: number | null;
  rightKneeRatio: number | null;
  leftKneeRatioMin: number | null;
  rightKneeRatioMin: number | null;
  leftKneeRatioMax: number | null;
  rightKneeRatioMax: number | null;
  leftKneeRatioEnd: number | null;
  rightKneeRatioEnd: number | null;
  leftKneeRatioSupport: number | null;
  rightKneeRatioSupport: number | null;
  leftWorldKneeRatioSupport: number | null;
  rightWorldKneeRatioSupport: number | null;
  leftImageKneeRatioSupport: number | null;
  rightImageKneeRatioSupport: number | null;
  leftKneeRatioConfidence: number | undefined;
  rightKneeRatioConfidence: number | undefined;
  leftKneeRatioSource: SquatMetricSource | null;
  rightKneeRatioSource: SquatMetricSource | null;
  primaryMetricSource: SquatMetricSource | null;
  thighDepthEligible: boolean;
  sideOnlyMetricsEligible: boolean;
  thighDepthAngle: number | null;
  thighDepthConfidence: number | undefined;
  depthRatio: number;
  depthSource: DepthSource;
  depthValue: number;
  depthSeverity: SquatSeverity;
  lockoutRatio: number;
  lockoutBaselineRatio: number | null;
  lockoutDeltaRatio: number | null;
  lockoutEligible: boolean;
  lockoutShort: boolean;
  romRatio: number;
  romEligible: boolean;
  incompleteRom: boolean;
  partialRep: boolean;
  heelLiftEligible: boolean;
  heelLiftDeltaDeg: number | null;
  heelLiftSupport: number | null;
  heelLiftEligibleSupport: number | null;
  heelLiftOverThresholdSupport: number | null;
  heelLiftConfidence: number | undefined;
  heelLiftTriggered: boolean;
  kneeTrackingEligible: boolean;
  kneeTrackingOffsetRatio: number | null;
  kneeTrackingEligibleSupport: number | null;
  kneeTrackingOverThresholdSupport: number | null;
  kneeTrackingConfidence: number | undefined;
  kneeValgusTriggered: boolean;
  kneeValgusSeverity: SquatSeverity;
  torsoLean: number | null;
  torsoLeanDelta: number | null;
  torsoLeanSigned: number | null;
  torsoLeanSignedDelta: number | null;
  torsoLeanConfidence: number | undefined;
  torsoHasBaseline: boolean;
  torsoSignedEligible: boolean;
  torsoSeverity: SquatSeverity;
  sideViewWidthRatio: number | null;
  sideViewQuality: SideViewQuality;
  sideViewQualityRank: number | null;
  sideViewConfidence: number | undefined;
  viewClassRatioSide: number | null;
  viewClassRatioFront: number | null;
  viewClassRatioOblique: number | null;
  viewClassRatioUnknown: number | null;
  viewAverageConfidence: number | null;
  viewMinConfidence: number | null;
  maxViewAngleDeg: number | null;
  tDown: number | null;
  tUp: number | null;
  tBottom: number | null;
  tMovementEnd: number | null;
  tConfirmedEnd: number | null;
  movementEndDelaySeconds: number | null;
  tempoUpShort: boolean;
  tempoDownShort: boolean;
}

function confidenceAverage(sum: number, count: number): number | undefined {
  return count > 0 ? sum / count : undefined;
}

function finiteValue(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function supportRatio(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

function supportAtLeast(value: number | null, threshold: number): boolean {
  return value !== null && value >= threshold;
}

function averageViewConfidence(repWindow: SquatRepWindow): number | null {
  return repWindow.viewSampleCount > 0
    ? repWindow.viewConfidenceSum / repWindow.viewSampleCount
    : null;
}

function primarySourceFromCounts(
  worldCount: number,
  imageCount: number,
  sampleCount: number,
): SquatMetricSource | null {
  if (sampleCount <= 0) return null;
  return worldCount >= imageCount ? 'world' : 'image';
}

function buildSquatViewQuality(repWindow: SquatRepWindow): RepViewQualityDiagnostic {
  const sampleCount = repWindow.viewSampleCount;
  const hasSamples = sampleCount >= FORM_THRESHOLDS.VIEW_MIN_SAMPLES;
  const sideRatio = supportRatio(repWindow.sideViewClassSampleCount, sampleCount);
  const frontRatio = supportRatio(repWindow.frontViewClassSampleCount, sampleCount);
  const obliqueRatio = supportRatio(repWindow.obliqueViewClassSampleCount, sampleCount);
  const averageConfidence = averageViewConfidence(repWindow);
  const minConfidence = sampleCount > 0 && repWindow.viewConfidenceMin !== Infinity
    ? repWindow.viewConfidenceMin
    : null;
  const confidenceOk =
    averageConfidence !== null &&
    averageConfidence >= FORM_THRESHOLDS.VIEW_CONFIDENCE_MIN;
  const sideConfirmed = Boolean(
    hasSamples &&
    confidenceOk &&
    supportAtLeast(sideRatio, FORM_THRESHOLDS.SIDE_VIEW_MIN_SUPPORT),
  );
  const frontConfirmed = Boolean(
    hasSamples &&
    confidenceOk &&
    supportAtLeast(frontRatio, FORM_THRESHOLDS.FRONT_VIEW_MIN_SUPPORT),
  );
  const obliqueConfirmed = Boolean(
    hasSamples &&
    confidenceOk &&
    !sideConfirmed &&
    !frontConfirmed &&
    supportAtLeast(obliqueRatio, FORM_THRESHOLDS.OBLIQUE_VIEW_MIN_SUPPORT),
  );
  const viewUnknown = !sideConfirmed && !frontConfirmed && !obliqueConfirmed;

  return {
    status: sideConfirmed
      ? 'side_confirmed'
      : frontConfirmed
        ? 'front_confirmed'
        : obliqueConfirmed
          ? 'oblique_confirmed'
          : 'view_unknown',
    sideConfirmed,
    frontishConfirmed: frontConfirmed || obliqueConfirmed,
    frontConfirmed,
    obliqueConfirmed,
    viewUnknown,
    averageSideViewConfidence: averageConfidence,
    minSideViewConfidence: minConfidence,
    averageViewConfidence: averageConfidence,
    minViewConfidence: minConfidence,
    sampleCount,
  };
}

function diagnosticsViewFor(viewQuality: RepViewQualityDiagnostic): SquatViewClass {
  if (viewQuality.sideConfirmed) return 'side';
  if (viewQuality.frontConfirmed) return 'front';
  if (viewQuality.obliqueConfirmed) return 'oblique';
  return 'unknown';
}

function squatQualityWarnings(analysis: Pick<SquatMetricSnapshot, 'scorable' | 'frontConfirmed' | 'sideConfirmed' | 'obliqueConfirmed'>): FrameworkRepResult['qualityWarnings'] {
  if (analysis.scorable) return [];
  if (analysis.frontConfirmed || analysis.obliqueConfirmed) return ['side_view_uncertain'];
  return analysis.sideConfirmed
    ? ['missing_required_joints']
    : ['view_uncertain'];
}

function squatRepWindowAnalysisStatus(
  repWindow: SquatRepWindow,
  visibleSide: SquatSide,
): CameraAnalysisStatus | null {
  const analysis = analyzeSquatRep(repWindow);
  if (analysis.viewQuality.sampleCount < FORM_THRESHOLDS.VIEW_MIN_SAMPLES) return null;

  const reliability = reliabilityInterpretationForRepWindow(repWindow, visibleSide)?.interpretation ?? null;
  return cameraStatusFromExerciseFeedbackReadiness({
    reliability,
    viewReady: analysis.sideConfirmed,
    viewRequired: 'side',
    viewCurrent: analysis.view,
    scorable: analysis.scorable,
    fullReason: 'barbell_squat_live_full_feedback',
    viewBlockedReason: analysis.view === 'unknown'
      ? 'barbell_squat_view_uncertain'
      : 'barbell_squat_side_view_uncertain',
    viewBlockedMessage: 'Turn side-on for full form analysis',
  });
}

function squatCompletedRepAnalysisStatus(
  repResult: Pick<FrameworkRepResult, 'scorable' | 'qualityWarnings' | 'diagnostics'> | null,
): CameraAnalysisStatus | null {
  if (!repResult?.diagnostics) return null;
  const qualityWarnings = repResult.qualityWarnings ?? [];
  return cameraStatusFromExerciseFeedbackReadiness({
    reliability: repResult.diagnostics.reliability ?? null,
    viewReady: !qualityWarnings.includes('side_view_uncertain') && !qualityWarnings.includes('view_uncertain'),
    viewRequired: 'side',
    viewCurrent: repResult.diagnostics.view,
    scorable: repResult.scorable,
    fullReason: 'barbell_squat_completed_full_feedback',
    viewBlockedReason: qualityWarnings.includes('view_uncertain')
      ? 'barbell_squat_completed_view_uncertain'
      : 'barbell_squat_completed_side_view_uncertain',
    viewBlockedMessage: 'Turn side-on for full form analysis',
  });
}

function cueFamilyAllowed(allowedCueFamilies: ReadonlySet<string> | undefined, family: string): boolean {
  return !allowedCueFamilies || allowedCueFamilies.has(family);
}

function selectedLegChain(visibleSide: SquatSide): 'leftLeg' | 'rightLeg' {
  return visibleSide === 'left' ? 'leftLeg' : 'rightLeg';
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

function jointReliableForMostOfRep(summary: PoseStateReliabilitySummary, jointName: string): boolean {
  if (summary.totalFrames === 0) return false;
  const unreliableCount = summary.unreliableJointCounts[jointName] ?? 0;
  return unreliableCount / summary.totalFrames < 0.25;
}

function jointsReliableForMostOfRep(summary: PoseStateReliabilitySummary, jointNames: string[]): boolean {
  return jointNames.every(jointName => jointReliableForMostOfRep(summary, jointName));
}

function markChainUsable(interpretation: RepReliabilityInterpretation, chainName: string): void {
  interpretation.usableChains = uniqueStrings([...interpretation.usableChains, chainName]);
  interpretation.weakChains = interpretation.weakChains.filter(chain => chain !== chainName);
}

function markCueFamiliesSafe(interpretation: RepReliabilityInterpretation, families: readonly string[]): void {
  interpretation.safeCueFamilies = uniqueStrings([...interpretation.safeCueFamilies, ...families]);
  interpretation.unsafeCueFamilies = interpretation.unsafeCueFamilies.filter(
    family => !families.includes(family),
  );
}

function markCueFamiliesUnsafe(
  interpretation: RepReliabilityInterpretation,
  families: readonly string[],
  reason: string,
): void {
  const familySet = new Set(families);
  interpretation.safeCueFamilies = interpretation.safeCueFamilies.filter(
    family => !familySet.has(family),
  );
  interpretation.unsafeCueFamilies = uniqueStrings([
    ...interpretation.unsafeCueFamilies,
    ...families,
  ]);
  interpretation.reasons = uniqueStrings([...interpretation.reasons, reason]);
}

function reliabilityInterpretationForRepWindow(
  repWindow: SquatRepWindow,
  visibleSide: SquatSide,
): {
  summary: PoseStateReliabilitySummary;
  interpretation: RepReliabilityInterpretation;
} | null {
  const summary = repWindow.reliability.snapshot();
  if (summary.totalFrames === 0) return null;

  const baseInterpretation = interpretPoseStateReliabilitySummary('Barbell Squat', summary);
  const interpretation: RepReliabilityInterpretation = {
    ...baseInterpretation,
    usableChains: [...baseInterpretation.usableChains],
    weakChains: [...baseInterpretation.weakChains],
    safeCueFamilies: [...baseInterpretation.safeCueFamilies],
    unsafeCueFamilies: [...baseInterpretation.unsafeCueFamilies],
    reasons: [...baseInterpretation.reasons],
  };
  const selectedChain = selectedLegChain(visibleSide);
  const selectedLegReliable =
    baseInterpretation.usableChains.includes(selectedChain) ||
    jointsReliableForMostOfRep(summary, [
      `${visibleSide}_hip`,
      `${visibleSide}_knee`,
      `${visibleSide}_ankle`,
    ]);
  const selectedTorsoReliable =
    baseInterpretation.usableChains.includes('torso') ||
    jointsReliableForMostOfRep(summary, [
      `${visibleSide}_shoulder`,
      `${visibleSide}_hip`,
    ]);
  const selectedDistalFootReliable = jointsReliableForMostOfRep(summary, [
    `${visibleSide}_ankle`,
    `${visibleSide}_heel`,
    `${visibleSide}_foot_index`,
  ]);

  if (selectedLegReliable) {
    markChainUsable(interpretation, selectedChain);
    markCueFamiliesSafe(interpretation, ['tempo', 'visibleLegPath', 'kneeTracking']);
  } else {
    markCueFamiliesUnsafe(
      interpretation,
      SQUAT_SELECTED_LEG_CUE_FAMILIES,
      `${selectedChain}_selected_chain_weak`,
    );
  }

  if (selectedTorsoReliable) {
    markChainUsable(interpretation, 'torso');
    markCueFamiliesSafe(interpretation, ['torsoLean', 'barPathOrUpperBody']);
  } else {
    markCueFamiliesUnsafe(
      interpretation,
      ['repCount', 'depth', 'hipKneePath', 'torsoLean', 'barPathOrUpperBody', 'setupStance'],
      'selected_side_torso_weak',
    );
  }

  if (selectedLegReliable && selectedTorsoReliable) {
    markCueFamiliesSafe(interpretation, [
      'repCount',
      'tempo',
      'visibleLegPath',
      'depth',
      'kneeTracking',
      'hipKneePath',
      'torsoLean',
      'barPathOrUpperBody',
    ]);
    interpretation.countabilityCandidate =
      summary.trackingInterruptedFrames > 0 ? 'maybe' : 'countable';
  } else if (selectedLegReliable || selectedTorsoReliable) {
    interpretation.countabilityCandidate = 'maybe';
  } else {
    interpretation.countabilityCandidate = 'notCountable';
  }

  if (!selectedDistalFootReliable) {
    markCueFamiliesUnsafe(
      interpretation,
      SQUAT_DISTAL_FOOT_CUE_FAMILIES,
      'selected_distal_foot_weak',
    );
  } else if (selectedLegReliable) {
    markCueFamiliesSafe(interpretation, ['ankleFootPosition', 'heelLift']);
  }

  if (!selectedLegReliable || !selectedTorsoReliable) {
    interpretation.scoreabilityCandidate = 'notScoreable';
  } else if (interpretation.unsafeCueFamilies.length === 0) {
    interpretation.scoreabilityCandidate = 'fullyScoreable';
  } else {
    interpretation.scoreabilityCandidate = 'partiallyScoreable';
  }

  if (interpretation.unsafeCueFamilies.length > 0) {
    interpretation.reasons = uniqueStrings([...interpretation.reasons, 'some_cue_families_unsafe']);
  }

  return { summary, interpretation };
}

function safeCueFamilySet(interpretation: RepReliabilityInterpretation | null): ReadonlySet<string> | undefined {
  return interpretation ? new Set(interpretation.safeCueFamilies) : undefined;
}

function reliabilityAllowsScoring(
  interpretation: RepReliabilityInterpretation | null,
  visibleSide: SquatSide,
): boolean {
  if (!interpretation) return true;
  return (
    interpretation.scoreabilityCandidate !== 'notScoreable' &&
    interpretation.usableChains.includes(selectedLegChain(visibleSide)) &&
    interpretation.usableChains.includes('torso')
  );
}

function repScorableWithReliability(
  analysis: SquatMetricSnapshot,
  interpretation: RepReliabilityInterpretation | null,
  visibleSide: SquatSide,
): boolean {
  return analysis.scorable && reliabilityAllowsScoring(interpretation, visibleSide);
}

function qualityWarningsWithReliability(
  analysis: SquatMetricSnapshot,
  scorable: boolean,
  interpretation: RepReliabilityInterpretation | null,
): FrameworkRepResult['qualityWarnings'] {
  const warnings = [...(analysis.qualityWarnings ?? [])];
  if (interpretation && analysis.scorable && !scorable) {
    warnings.push('missing_required_joints');
  }
  return uniqueStrings(warnings) as FrameworkRepResult['qualityWarnings'];
}

function suppressUnsafeReliabilityMessages(
  messages: string[],
  interpretation: RepReliabilityInterpretation | null,
): string[] {
  if (!interpretation) return messages;

  const unsafeFamilies = new Set(interpretation.unsafeCueFamilies);
  return messages.filter((message) => {
    const families = SQUAT_MESSAGE_CUE_FAMILIES[message] ?? [];
    return families.every(family => !unsafeFamilies.has(family));
  });
}

function analyzeSquatRep(repWindow: SquatRepWindow): SquatMetricSnapshot {
  const viewQuality = buildSquatViewQuality(repWindow);
  const view = diagnosticsViewFor(viewQuality);
  const sideConfirmed = view === 'side';
  const frontConfirmed = view === 'front';
  const obliqueConfirmed = view === 'oblique';
  const worldKneeRatioSupport = supportRatio(
    repWindow.worldKneeRatioSampleCount,
    repWindow.kneeRatioSampleCount,
  );
  const imageKneeRatioSupport = supportRatio(
    repWindow.imageKneeRatioSampleCount,
    repWindow.kneeRatioSampleCount,
  );
  const leftKneeRatioSupport = supportRatio(repWindow.leftKneeRatioSampleCount, repWindow.frameCount);
  const rightKneeRatioSupport = supportRatio(repWindow.rightKneeRatioSampleCount, repWindow.frameCount);
  const leftWorldKneeRatioSupport = supportRatio(repWindow.leftWorldKneeRatioSampleCount, repWindow.frameCount);
  const rightWorldKneeRatioSupport = supportRatio(repWindow.rightWorldKneeRatioSampleCount, repWindow.frameCount);
  const leftImageKneeRatioSupport = supportRatio(repWindow.leftImageKneeRatioSampleCount, repWindow.frameCount);
  const rightImageKneeRatioSupport = supportRatio(repWindow.rightImageKneeRatioSampleCount, repWindow.frameCount);
  const scorable = sideConfirmed;
  const sideOnlyMetricsEligible = scorable && sideConfirmed;
  const primaryMetricSource: SquatMetricSource | null =
    primarySourceFromCounts(
      repWindow.worldKneeRatioSampleCount,
      repWindow.imageKneeRatioSampleCount,
      repWindow.kneeRatioSampleCount,
    );
  const leftKneeRatioSource = primarySourceFromCounts(
    repWindow.leftWorldKneeRatioSampleCount,
    repWindow.leftImageKneeRatioSampleCount,
    repWindow.leftKneeRatioSampleCount,
  );
  const rightKneeRatioSource = primarySourceFromCounts(
    repWindow.rightWorldKneeRatioSampleCount,
    repWindow.rightImageKneeRatioSampleCount,
    repWindow.rightKneeRatioSampleCount,
  );
  const thighDepthEligible =
    sideOnlyMetricsEligible &&
    repWindow.thighDepthSampleCount > 0 &&
    Number.isFinite(repWindow.minThighDepthAngle);
  const thighDepthAngle = thighDepthEligible ? repWindow.minThighDepthAngle : null;

  const depthRatio = finiteValue(repWindow.minKneeRatio, 1);
  const lockoutRatio = finiteValue(repWindow.endKneeRatio ?? repWindow.maxKneeRatio, 0);
  const lockoutBaselineRatio = repWindow.lockoutBaselineRatio;
  const lockoutDeltaRatio =
    lockoutBaselineRatio !== null
      ? Math.max(0, lockoutBaselineRatio - lockoutRatio)
      : null;
  const lockoutEligible = scorable;
  const lockoutShort = lockoutEligible
    ? (
        lockoutDeltaRatio !== null
          ? lockoutDeltaRatio > FORM_THRESHOLDS.LOCKOUT_BASELINE_DELTA_FAIL
          : lockoutRatio < FORM_THRESHOLDS.LOCKOUT_FAIL
      )
    : false;
  const romRatio = Math.max(0, lockoutRatio - depthRatio);
  const romEligible = lockoutEligible;
  const incompleteRom = romEligible && romRatio < FORM_THRESHOLDS.ROM_MIN;
  const partialRep = repWindow.partialRep;

  const depthSource: DepthSource = thighDepthEligible ? 'thighDepthAngle' : 'depthRatio';
  const depthValue = thighDepthEligible ? thighDepthAngle! : depthRatio;
  let depthSeverity: SquatSeverity = 'none';
  if (!sideOnlyMetricsEligible) {
    depthSeverity = 'none';
  } else if (thighDepthEligible) {
    if (depthValue > FORM_THRESHOLDS.THIGH_DEPTH_FAIL) {
      depthSeverity = 'fail';
    } else if (depthValue > FORM_THRESHOLDS.THIGH_DEPTH_WARN) {
      depthSeverity = 'warn';
    }
  } else if (depthValue > FORM_THRESHOLDS.DEPTH_FAIL) {
    depthSeverity = 'fail';
  } else if (depthValue > FORM_THRESHOLDS.DEPTH_WARN) {
    depthSeverity = 'warn';
  }

  const heelLiftEligible =
    sideOnlyMetricsEligible &&
    repWindow.footPitchBaseline !== null &&
    repWindow.heelLiftSampleCount > 0;
  const heelLiftEligibleSupport = repWindow.frameCount > 0
    ? repWindow.heelLiftSampleCount / repWindow.frameCount
    : null;
  const heelLiftOverThresholdSupport = repWindow.frameCount > 0
    ? repWindow.heelLiftTriggeredSampleCount / repWindow.frameCount
    : null;
  const heelLiftSupport = heelLiftOverThresholdSupport;
  const heelLiftDeltaDeg = heelLiftEligible ? repWindow.maxHeelLiftDeltaDeg : null;
  const heelLiftHasEnoughEligibleSupport =
    heelLiftEligible &&
    (heelLiftEligibleSupport ?? 0) >= FORM_THRESHOLDS.HEEL_LIFT_MIN_ELIGIBLE_SUPPORT;
  const heelLiftTriggered =
    heelLiftHasEnoughEligibleSupport &&
    heelLiftDeltaDeg !== null &&
    heelLiftDeltaDeg > FORM_THRESHOLDS.HEEL_LIFT_WARN &&
    (heelLiftOverThresholdSupport ?? 0) >= FORM_THRESHOLDS.HEEL_LIFT_MIN_SUPPORT;

  const kneeTrackingEligibleSupport = repWindow.frameCount > 0
    ? repWindow.kneeTrackingSampleCount / repWindow.frameCount
    : null;
  const kneeTrackingOverThresholdSupport = repWindow.frameCount > 0
    ? repWindow.kneeTrackingTriggeredSampleCount / repWindow.frameCount
    : null;
  const kneeTrackingEligible =
    scorable &&
    frontConfirmed &&
    kneeTrackingEligibleSupport !== null &&
    kneeTrackingEligibleSupport >= FORM_THRESHOLDS.KNEE_VALGUS_MIN_ELIGIBLE_SUPPORT;
  const kneeTrackingOffsetRatio =
    kneeTrackingEligible && Number.isFinite(repWindow.maxKneeTrackingOffsetRatio)
      ? repWindow.maxKneeTrackingOffsetRatio
      : null;
  const kneeValgusTriggered =
    kneeTrackingEligible &&
    kneeTrackingOffsetRatio !== null &&
    kneeTrackingOffsetRatio > FORM_THRESHOLDS.KNEE_VALGUS_WARN &&
    (kneeTrackingOverThresholdSupport ?? 0) >= FORM_THRESHOLDS.KNEE_VALGUS_MIN_SUPPORT;
  const kneeValgusSeverity: SquatSeverity = kneeValgusTriggered
    ? kneeTrackingOffsetRatio! > FORM_THRESHOLDS.KNEE_VALGUS_FAIL ? 'fail' : 'warn'
    : 'none';

  const torsoLeanEligible =
    sideOnlyMetricsEligible &&
    repWindow.torsoLeanSampleCount > 0 &&
    Number.isFinite(repWindow.maxTorsoLean);
  const torsoLean = torsoLeanEligible ? repWindow.maxTorsoLean : null;
  const torsoHasBaseline = torsoLeanEligible && repWindow.torsoLeanBaseline !== null;
  const torsoLeanAbsoluteDelta = torsoHasBaseline ? repWindow.maxTorsoLeanDelta : null;
  const torsoSignedEligible =
    sideOnlyMetricsEligible &&
    repWindow.torsoLeanSampleCount > 0 &&
    Number.isFinite(repWindow.maxTorsoLeanSigned);
  const torsoLeanSigned = torsoSignedEligible ? repWindow.maxTorsoLeanSigned : null;
  const torsoLeanSignedDelta =
    torsoSignedEligible && repWindow.torsoLeanSignedBaseline !== null
      ? repWindow.maxTorsoLeanSignedDelta
      : null;
  const torsoLeanDelta = torsoLeanSignedDelta ?? torsoLeanAbsoluteDelta;
  const torsoHasAnyBaseline = torsoLeanDelta !== null;
  let torsoSeverity: SquatSeverity = 'none';
  if (torsoLeanSigned !== null) {
    if (torsoLeanSignedDelta !== null) {
      if (
        torsoLeanSigned > FORM_THRESHOLDS.TORSO_LEAN_FAIL &&
        torsoLeanSignedDelta > FORM_THRESHOLDS.TORSO_LEAN_DELTA_FAIL
      ) {
        torsoSeverity = 'fail';
      } else if (
        torsoLeanSigned > FORM_THRESHOLDS.TORSO_LEAN_WARN &&
        torsoLeanSignedDelta > FORM_THRESHOLDS.TORSO_LEAN_DELTA_WARN
      ) {
        torsoSeverity = 'warn';
      }
    } else if (torsoLeanSigned > FORM_THRESHOLDS.TORSO_LEAN_FAIL) {
      torsoSeverity = 'fail';
    } else if (torsoLeanSigned > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
      torsoSeverity = 'warn';
    }
  } else if (torsoLean !== null) {
    if (torsoHasBaseline) {
      if (
        torsoLean > FORM_THRESHOLDS.TORSO_LEAN_FAIL &&
        (torsoLeanAbsoluteDelta ?? 0) > FORM_THRESHOLDS.TORSO_LEAN_DELTA_FAIL
      ) {
        torsoSeverity = 'fail';
      } else if (
        torsoLean > FORM_THRESHOLDS.TORSO_LEAN_WARN &&
        (torsoLeanAbsoluteDelta ?? 0) > FORM_THRESHOLDS.TORSO_LEAN_DELTA_WARN
      ) {
        torsoSeverity = 'warn';
      }
    } else if (torsoLean > FORM_THRESHOLDS.TORSO_LEAN_FAIL) {
      torsoSeverity = 'fail';
    } else if (torsoLean > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
      torsoSeverity = 'warn';
    }
  }

  const sideViewWidthEligible =
    repWindow.sideViewSampleCount > 0 &&
    Number.isFinite(repWindow.maxSideViewWidthRatio);
  const sideViewWidthRatio = sideViewWidthEligible ? repWindow.maxSideViewWidthRatio : null;
  let sideViewQuality: SideViewQuality = 'unknown';
  let sideViewQualityRank: number | null = null;
  if (sideViewWidthRatio !== null) {
    if (sideViewWidthRatio > FORM_THRESHOLDS.SIDE_VIEW_WIDTH_FAIL) {
      sideViewQuality = 'fail';
      sideViewQualityRank = 2;
    } else if (sideViewWidthRatio > FORM_THRESHOLDS.SIDE_VIEW_WIDTH_WARN) {
      sideViewQuality = 'warn';
      sideViewQualityRank = 1;
    } else {
      sideViewQuality = 'good';
      sideViewQualityRank = 0;
    }
  }

  const tMovementEnd = repWindow.tMovementEnd ?? repWindow.tConfirmedEnd ?? repWindow.tEnd;
  const tConfirmedEnd = repWindow.tConfirmedEnd ?? repWindow.tEnd;
  const tDown = repWindow.tBottom !== null ? repWindow.tBottom - repWindow.tStart : null;
  const tUp = repWindow.tBottom !== null ? tMovementEnd - repWindow.tBottom : null;
  const movementEndDelaySeconds = repWindow.tMovementEnd !== null
    ? Math.max(0, tConfirmedEnd - repWindow.tMovementEnd)
    : null;
  const tempoUpShort =
    scorable &&
    tUp !== null &&
    tUp > 0 &&
    tUp < FORM_THRESHOLDS.TEMPO_CONCENTRIC_MIN;
  const tempoDownShort =
    scorable &&
    tDown !== null &&
    tDown > 0 &&
    tDown < FORM_THRESHOLDS.TEMPO_ECCENTRIC_MIN;

  return {
    view,
    viewQuality,
    sideConfirmed,
    frontConfirmed,
    obliqueConfirmed,
    scorable,
    qualityWarnings: squatQualityWarnings({ scorable, frontConfirmed, sideConfirmed, obliqueConfirmed }),
    worldKneeRatioSupport,
    imageKneeRatioSupport,
    leftKneeRatio: Number.isFinite(repWindow.leftKneeRatioEnd ?? NaN) ? repWindow.leftKneeRatioEnd : null,
    rightKneeRatio: Number.isFinite(repWindow.rightKneeRatioEnd ?? NaN) ? repWindow.rightKneeRatioEnd : null,
    leftKneeRatioMin: Number.isFinite(repWindow.leftKneeRatioMin) ? repWindow.leftKneeRatioMin : null,
    rightKneeRatioMin: Number.isFinite(repWindow.rightKneeRatioMin) ? repWindow.rightKneeRatioMin : null,
    leftKneeRatioMax: Number.isFinite(repWindow.leftKneeRatioMax) ? repWindow.leftKneeRatioMax : null,
    rightKneeRatioMax: Number.isFinite(repWindow.rightKneeRatioMax) ? repWindow.rightKneeRatioMax : null,
    leftKneeRatioEnd: repWindow.leftKneeRatioEnd,
    rightKneeRatioEnd: repWindow.rightKneeRatioEnd,
    leftKneeRatioSupport,
    rightKneeRatioSupport,
    leftWorldKneeRatioSupport,
    rightWorldKneeRatioSupport,
    leftImageKneeRatioSupport,
    rightImageKneeRatioSupport,
    leftKneeRatioConfidence: confidenceAverage(
      repWindow.leftKneeRatioConfidenceSum,
      repWindow.leftKneeRatioSampleCount,
    ),
    rightKneeRatioConfidence: confidenceAverage(
      repWindow.rightKneeRatioConfidenceSum,
      repWindow.rightKneeRatioSampleCount,
    ),
    leftKneeRatioSource,
    rightKneeRatioSource,
    primaryMetricSource,
    thighDepthEligible,
    sideOnlyMetricsEligible,
    thighDepthAngle,
    thighDepthConfidence: confidenceAverage(
      repWindow.thighDepthConfidenceSum,
      repWindow.thighDepthSampleCount,
    ),
    depthRatio,
    depthSource,
    depthValue,
    depthSeverity,
    lockoutRatio,
    lockoutBaselineRatio,
    lockoutDeltaRatio,
    lockoutEligible,
    lockoutShort,
    romRatio,
    romEligible,
    incompleteRom,
    partialRep,
    heelLiftEligible,
    heelLiftDeltaDeg,
    heelLiftSupport,
    heelLiftEligibleSupport,
    heelLiftOverThresholdSupport,
    heelLiftConfidence: confidenceAverage(
      repWindow.heelLiftConfidenceSum,
      repWindow.heelLiftSampleCount,
    ),
    heelLiftTriggered,
    kneeTrackingEligible,
    kneeTrackingOffsetRatio,
    kneeTrackingEligibleSupport,
    kneeTrackingOverThresholdSupport,
    kneeTrackingConfidence: confidenceAverage(
      repWindow.kneeTrackingConfidenceSum,
      repWindow.kneeTrackingSampleCount,
    ),
    kneeValgusTriggered,
    kneeValgusSeverity,
    torsoLean,
    torsoLeanDelta,
    torsoLeanSigned,
    torsoLeanSignedDelta,
    torsoLeanConfidence: confidenceAverage(
      repWindow.torsoLeanConfidenceSum,
      repWindow.torsoLeanSampleCount,
    ),
    torsoHasBaseline: torsoHasAnyBaseline,
    torsoSignedEligible,
    torsoSeverity,
    sideViewWidthRatio,
    sideViewQuality,
    sideViewQualityRank,
    sideViewConfidence: confidenceAverage(
      repWindow.sideViewConfidenceSum,
      repWindow.sideViewSampleCount,
    ),
    viewClassRatioSide: supportRatio(repWindow.sideViewClassSampleCount, repWindow.viewSampleCount),
    viewClassRatioFront: supportRatio(repWindow.frontViewClassSampleCount, repWindow.viewSampleCount),
    viewClassRatioOblique: supportRatio(repWindow.obliqueViewClassSampleCount, repWindow.viewSampleCount),
    viewClassRatioUnknown: supportRatio(repWindow.unknownViewClassSampleCount, repWindow.viewSampleCount),
    viewAverageConfidence: averageViewConfidence(repWindow),
    viewMinConfidence: repWindow.viewSampleCount > 0 && repWindow.viewConfidenceMin !== Infinity
      ? repWindow.viewConfidenceMin
      : null,
    maxViewAngleDeg: repWindow.viewAngleSampleCount > 0 && Number.isFinite(repWindow.maxViewAngleDeg)
      ? repWindow.maxViewAngleDeg
      : null,
    tDown,
    tUp,
    tBottom: repWindow.tBottom,
    tMovementEnd,
    tConfirmedEnd,
    movementEndDelaySeconds,
    tempoUpShort,
    tempoDownShort,
  };
}

function applySquatCueSafety(
  analysis: SquatMetricSnapshot,
  allowedCueFamilies: ReadonlySet<string> | undefined,
): SquatMetricSnapshot {
  if (!allowedCueFamilies) return analysis;

  const safeAnalysis: SquatMetricSnapshot = { ...analysis };
  const legPathAllowed =
    cueFamilyAllowed(allowedCueFamilies, 'visibleLegPath') &&
    cueFamilyAllowed(allowedCueFamilies, 'hipKneePath');
  const depthAllowed =
    legPathAllowed &&
    cueFamilyAllowed(allowedCueFamilies, 'depth');
  const heelAllowed =
    cueFamilyAllowed(allowedCueFamilies, 'ankleFootPosition') &&
    cueFamilyAllowed(allowedCueFamilies, 'heelLift');

  if (!depthAllowed) {
    safeAnalysis.depthSeverity = 'none';
    safeAnalysis.incompleteRom = false;
  }
  if (!legPathAllowed) {
    safeAnalysis.lockoutShort = false;
  }
  if (!heelAllowed) {
    safeAnalysis.heelLiftTriggered = false;
  }
  if (!cueFamilyAllowed(allowedCueFamilies, 'kneeTracking')) {
    safeAnalysis.kneeValgusTriggered = false;
    safeAnalysis.kneeValgusSeverity = 'none';
  }
  if (
    !cueFamilyAllowed(allowedCueFamilies, 'torsoLean') ||
    !cueFamilyAllowed(allowedCueFamilies, 'barPathOrUpperBody')
  ) {
    safeAnalysis.torsoSeverity = 'none';
  }
  if (!cueFamilyAllowed(allowedCueFamilies, 'tempo')) {
    safeAnalysis.tempoUpShort = false;
    safeAnalysis.tempoDownShort = false;
  }

  return safeAnalysis;
}

function computeSquatRepScore(analysis: SquatMetricSnapshot): number {
  if (!analysis.scorable) return 0;

  let penalty = 0;

  if (analysis.sideOnlyMetricsEligible && analysis.thighDepthEligible && analysis.thighDepthAngle !== null) {
    const depthExcess = Math.max(0, analysis.thighDepthAngle - SCORE_CURVES.THIGH_DEPTH.deadzone);
    penalty += Math.min(
      SCORE_CURVES.THIGH_DEPTH.cap,
      SCORE_CURVES.THIGH_DEPTH.scale * depthExcess * depthExcess,
    );
  } else if (analysis.sideOnlyMetricsEligible) {
    const depthExcess = Math.max(0, analysis.depthRatio - SCORE_CURVES.DEPTH.deadzone);
    penalty += Math.min(SCORE_CURVES.DEPTH.cap, SCORE_CURVES.DEPTH.scale * depthExcess * depthExcess);
  }

  if (analysis.lockoutEligible) {
    const lockoutShortfall = analysis.lockoutDeltaRatio !== null
      ? Math.max(0, analysis.lockoutDeltaRatio - FORM_THRESHOLDS.LOCKOUT_BASELINE_DELTA_FAIL * 0.5)
      : Math.max(0, SCORE_CURVES.LOCKOUT.ideal - analysis.lockoutRatio);
    penalty += Math.min(SCORE_CURVES.LOCKOUT.cap, SCORE_CURVES.LOCKOUT.scale * lockoutShortfall * lockoutShortfall);
  }

  const torsoForScore = analysis.torsoLeanSigned ?? analysis.torsoLean;
  if (analysis.sideOnlyMetricsEligible && analysis.torsoSeverity !== 'none' && torsoForScore !== null) {
    const torsoExcess = Math.max(0, torsoForScore - SCORE_CURVES.TORSO.deadzone);
    penalty += Math.min(SCORE_CURVES.TORSO.cap, SCORE_CURVES.TORSO.scale * torsoExcess * torsoExcess);
  }

  if (analysis.sideOnlyMetricsEligible && analysis.heelLiftTriggered && analysis.heelLiftDeltaDeg !== null) {
    const heelExcess = Math.max(0, analysis.heelLiftDeltaDeg - SCORE_CURVES.HEEL_LIFT.deadzone);
    penalty += Math.min(SCORE_CURVES.HEEL_LIFT.cap, SCORE_CURVES.HEEL_LIFT.scale * heelExcess * heelExcess);
  }

  if (analysis.tUp !== null && analysis.tUp > 0 && analysis.tUp < SCORE_CURVES.TEMPO_CONCENTRIC.deadzone) {
    const deficit = SCORE_CURVES.TEMPO_CONCENTRIC.deadzone - analysis.tUp;
    penalty += Math.min(SCORE_CURVES.TEMPO_CONCENTRIC.cap, SCORE_CURVES.TEMPO_CONCENTRIC.scale * deficit * deficit);
  }
  if (analysis.tDown !== null && analysis.tDown > 0 && analysis.tDown < SCORE_CURVES.TEMPO_ECCENTRIC.deadzone) {
    const deficit = SCORE_CURVES.TEMPO_ECCENTRIC.deadzone - analysis.tDown;
    penalty += Math.min(SCORE_CURVES.TEMPO_ECCENTRIC.cap, SCORE_CURVES.TEMPO_ECCENTRIC.scale * deficit * deficit);
  }

  let score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  if ((analysis.romEligible && analysis.partialRep) || analysis.incompleteRom) {
    score = Math.min(score, 65);
  }
  if (analysis.sideOnlyMetricsEligible && analysis.depthSeverity === 'fail') {
    score = Math.min(score, 70);
  } else if (analysis.sideOnlyMetricsEligible && analysis.depthSeverity === 'warn') {
    score = Math.min(score, 85);
  }
  if (analysis.sideOnlyMetricsEligible && analysis.torsoSeverity === 'fail') {
    score = Math.min(score, 75);
  }
  if (analysis.lockoutShort) {
    score = Math.min(score, 85);
  }
  if (analysis.sideOnlyMetricsEligible && analysis.heelLiftTriggered) {
    score = Math.min(score, 85);
  }
  return score;
}

function shouldEmitIncompleteRomCue(analysis: SquatMetricSnapshot): boolean {
  return (
    (analysis.incompleteRom || analysis.partialRep) &&
    analysis.depthSeverity === 'none' &&
    !analysis.lockoutShort
  );
}

function generateFormMessages(analysis: SquatMetricSnapshot): string[] {
  const messages: string[] = [];
  if (!analysis.scorable) return messages;

  if (analysis.depthSeverity === 'fail') {
    messages.push(SQUAT_FEEDBACK.DEPTH_FAIL);
  } else if (analysis.depthSeverity === 'warn') {
    messages.push(SQUAT_FEEDBACK.DEPTH_WARN);
  }

  if (analysis.lockoutShort) {
    messages.push(SQUAT_FEEDBACK.LOCKOUT);
  }

  if (shouldEmitIncompleteRomCue(analysis)) {
    messages.push(SQUAT_FEEDBACK.ROM);
  }

  if (analysis.heelLiftTriggered) {
    messages.push(SQUAT_FEEDBACK.HEEL_LIFT);
  }

  if (analysis.torsoSeverity === 'fail') {
    messages.push(SQUAT_FEEDBACK.TORSO_FAIL);
  } else if (analysis.torsoSeverity === 'warn') {
    messages.push(SQUAT_FEEDBACK.TORSO_WARN);
  }

  if (analysis.tempoUpShort) {
    messages.push(SQUAT_FEEDBACK.TEMPO_UP);
  }
  if (analysis.tempoDownShort) {
    messages.push(SQUAT_FEEDBACK.TEMPO_DOWN);
  }

  return messages;
}

function evaluateForm(
  repWindow: SquatRepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): {
  score: number;
  messages: string[];
  analysis: SquatMetricSnapshot;
  scoringAnalysis: SquatMetricSnapshot;
} {
  const analysis = analyzeSquatRep(repWindow);
  const scoringAnalysis = applySquatCueSafety(analysis, allowedCueFamilies);
  const score = computeSquatRepScore(scoringAnalysis);
  const messages = generateFormMessages(scoringAnalysis);
  return { score, messages, analysis, scoringAnalysis };
}

function buildSquatDiagnostics(
  repWindow: SquatRepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
  analysis: SquatMetricSnapshot = analyzeSquatRep(repWindow),
): NonNullable<FrameworkRepResult['diagnostics']> {
  const hasTempo = analysis.scorable && analysis.tDown !== null && analysis.tUp !== null;
  const depthThresholdPath = analysis.depthSource === 'thighDepthAngle'
    ? 'formThresholds.THIGH_DEPTH_WARN'
    : 'formThresholds.DEPTH_WARN';
  const depthThresholdValue = analysis.depthSource === 'thighDepthAngle'
    ? FORM_THRESHOLDS.THIGH_DEPTH_WARN
    : FORM_THRESHOLDS.DEPTH_WARN;
  const torsoFailThresholdPath = analysis.torsoHasBaseline
    ? ['formThresholds.TORSO_LEAN_FAIL', 'formThresholds.TORSO_LEAN_DELTA_FAIL']
    : 'formThresholds.TORSO_LEAN_FAIL';
  const torsoWarnThresholdPath = analysis.torsoHasBaseline
    ? ['formThresholds.TORSO_LEAN_WARN', 'formThresholds.TORSO_LEAN_DELTA_WARN']
    : 'formThresholds.TORSO_LEAN_WARN';
  const torsoFailThresholdValue = analysis.torsoHasBaseline
    ? {
        torsoLean: FORM_THRESHOLDS.TORSO_LEAN_FAIL,
        torsoLeanDelta: FORM_THRESHOLDS.TORSO_LEAN_DELTA_FAIL,
      }
    : FORM_THRESHOLDS.TORSO_LEAN_FAIL;
  const torsoWarnThresholdValue = analysis.torsoHasBaseline
    ? {
        torsoLean: FORM_THRESHOLDS.TORSO_LEAN_WARN,
        torsoLeanDelta: FORM_THRESHOLDS.TORSO_LEAN_DELTA_WARN,
      }
    : FORM_THRESHOLDS.TORSO_LEAN_WARN;
  const torsoCueMetricKeys = analysis.torsoSignedEligible
    ? (analysis.torsoLeanSignedDelta !== null ? ['torsoLeanSigned', 'torsoLeanDelta'] : ['torsoLeanSigned'])
    : (analysis.torsoHasBaseline ? ['torsoLean', 'torsoLeanDelta'] : ['torsoLean']);
  const torsoCueValue = analysis.torsoLeanSignedDelta ?? analysis.torsoLeanSigned ?? (
    analysis.torsoHasBaseline ? analysis.torsoLeanDelta : analysis.torsoLean
  );

  return buildRepDiagnostics({
    exerciseName: 'Barbell Squat',
    repIndex,
    scorable: analysis.scorable,
    view: analysis.view,
    selectedSide: visibleSide,
    viewQuality: analysis.viewQuality,
    metrics: [
      diagnosticLabelMetric('viewClass', analysis.view, {
        sampleCount: repWindow.viewSampleCount,
      }),
      diagnosticLabelMetric('metricSource', analysis.primaryMetricSource, {
        sampleCount: repWindow.kneeRatioSampleCount,
        skippedReason: 'knee_ratio_unavailable',
      }),
      diagnosticMetric('viewClassRatioSide', analysis.viewClassRatioSide, { unit: 'ratio', sampleCount: repWindow.viewSampleCount }),
      diagnosticMetric('viewClassRatioFront', analysis.viewClassRatioFront, { unit: 'ratio', sampleCount: repWindow.viewSampleCount }),
      diagnosticMetric('viewClassRatioOblique', analysis.viewClassRatioOblique, { unit: 'ratio', sampleCount: repWindow.viewSampleCount }),
      diagnosticMetric('viewClassRatioUnknown', analysis.viewClassRatioUnknown, { unit: 'ratio', sampleCount: repWindow.viewSampleCount }),
      diagnosticMetric('viewAverageConfidence', analysis.viewAverageConfidence, {
        unit: 'ratio',
        eligible: analysis.viewAverageConfidence !== null,
        sampleCount: repWindow.viewSampleCount,
        skippedReason: 'view_class_unavailable',
      }),
      diagnosticMetric('viewMinConfidence', analysis.viewMinConfidence, {
        unit: 'ratio',
        eligible: analysis.viewMinConfidence !== null,
        sampleCount: repWindow.viewSampleCount,
        skippedReason: 'view_class_unavailable',
      }),
      diagnosticMetric('viewAngleDeg', analysis.maxViewAngleDeg, {
        unit: 'degrees',
        eligible: analysis.maxViewAngleDeg !== null,
        sampleCount: repWindow.viewAngleSampleCount,
        skippedReason: 'world_view_angle_unavailable',
      }),
      diagnosticMetric('worldKneeRatioSupport', analysis.worldKneeRatioSupport, {
        unit: 'ratio',
        eligible: repWindow.worldKneeRatioSampleCount > 0,
        sampleCount: repWindow.worldKneeRatioSampleCount,
        skippedReason: 'world_landmarks_unavailable',
      }),
      diagnosticMetric('imageKneeRatioSupport', analysis.imageKneeRatioSupport, {
        unit: 'ratio',
        eligible: repWindow.imageKneeRatioSampleCount > 0,
        sampleCount: repWindow.imageKneeRatioSampleCount,
        skippedReason: 'image_knee_ratio_unavailable',
      }),
      diagnosticLabelMetric('leftKneeRatioSource', analysis.leftKneeRatioSource, {
        sampleCount: repWindow.leftKneeRatioSampleCount,
        skippedReason: 'left_knee_ratio_unavailable',
      }),
      diagnosticLabelMetric('rightKneeRatioSource', analysis.rightKneeRatioSource, {
        sampleCount: repWindow.rightKneeRatioSampleCount,
        skippedReason: 'right_knee_ratio_unavailable',
      }),
      diagnosticMetric('leftKneeRatio', analysis.leftKneeRatio, {
        unit: 'ratio',
        eligible: analysis.leftKneeRatio !== null,
        confidence: analysis.leftKneeRatioConfidence,
        sampleCount: repWindow.leftKneeRatioSampleCount,
        skippedReason: 'left_knee_ratio_unavailable',
      }),
      diagnosticMetric('rightKneeRatio', analysis.rightKneeRatio, {
        unit: 'ratio',
        eligible: analysis.rightKneeRatio !== null,
        confidence: analysis.rightKneeRatioConfidence,
        sampleCount: repWindow.rightKneeRatioSampleCount,
        skippedReason: 'right_knee_ratio_unavailable',
      }),
      diagnosticMetric('leftKneeRatioMin', analysis.leftKneeRatioMin, {
        unit: 'ratio',
        eligible: analysis.leftKneeRatioMin !== null,
        confidence: analysis.leftKneeRatioConfidence,
        sampleCount: repWindow.leftKneeRatioSampleCount,
        skippedReason: 'left_knee_ratio_unavailable',
      }),
      diagnosticMetric('rightKneeRatioMin', analysis.rightKneeRatioMin, {
        unit: 'ratio',
        eligible: analysis.rightKneeRatioMin !== null,
        confidence: analysis.rightKneeRatioConfidence,
        sampleCount: repWindow.rightKneeRatioSampleCount,
        skippedReason: 'right_knee_ratio_unavailable',
      }),
      diagnosticMetric('leftKneeRatioMax', analysis.leftKneeRatioMax, {
        unit: 'ratio',
        eligible: analysis.leftKneeRatioMax !== null,
        confidence: analysis.leftKneeRatioConfidence,
        sampleCount: repWindow.leftKneeRatioSampleCount,
        skippedReason: 'left_knee_ratio_unavailable',
      }),
      diagnosticMetric('rightKneeRatioMax', analysis.rightKneeRatioMax, {
        unit: 'ratio',
        eligible: analysis.rightKneeRatioMax !== null,
        confidence: analysis.rightKneeRatioConfidence,
        sampleCount: repWindow.rightKneeRatioSampleCount,
        skippedReason: 'right_knee_ratio_unavailable',
      }),
      diagnosticMetric('leftKneeRatioEnd', analysis.leftKneeRatioEnd, {
        unit: 'ratio',
        eligible: analysis.leftKneeRatioEnd !== null,
        confidence: analysis.leftKneeRatioConfidence,
        sampleCount: repWindow.leftKneeRatioSampleCount,
        skippedReason: 'left_knee_ratio_unavailable',
      }),
      diagnosticMetric('rightKneeRatioEnd', analysis.rightKneeRatioEnd, {
        unit: 'ratio',
        eligible: analysis.rightKneeRatioEnd !== null,
        confidence: analysis.rightKneeRatioConfidence,
        sampleCount: repWindow.rightKneeRatioSampleCount,
        skippedReason: 'right_knee_ratio_unavailable',
      }),
      diagnosticMetric('leftKneeRatioSupport', analysis.leftKneeRatioSupport, {
        unit: 'ratio',
        eligible: analysis.leftKneeRatioSupport !== null,
        confidence: analysis.leftKneeRatioConfidence,
        sampleCount: repWindow.leftKneeRatioSampleCount,
        skippedReason: 'left_knee_ratio_unavailable',
      }),
      diagnosticMetric('rightKneeRatioSupport', analysis.rightKneeRatioSupport, {
        unit: 'ratio',
        eligible: analysis.rightKneeRatioSupport !== null,
        confidence: analysis.rightKneeRatioConfidence,
        sampleCount: repWindow.rightKneeRatioSampleCount,
        skippedReason: 'right_knee_ratio_unavailable',
      }),
      diagnosticMetric('leftWorldKneeRatioSupport', analysis.leftWorldKneeRatioSupport, {
        unit: 'ratio',
        eligible: repWindow.leftWorldKneeRatioSampleCount > 0,
        confidence: analysis.leftKneeRatioConfidence,
        sampleCount: repWindow.leftWorldKneeRatioSampleCount,
        skippedReason: 'left_world_knee_ratio_unavailable',
      }),
      diagnosticMetric('rightWorldKneeRatioSupport', analysis.rightWorldKneeRatioSupport, {
        unit: 'ratio',
        eligible: repWindow.rightWorldKneeRatioSampleCount > 0,
        confidence: analysis.rightKneeRatioConfidence,
        sampleCount: repWindow.rightWorldKneeRatioSampleCount,
        skippedReason: 'right_world_knee_ratio_unavailable',
      }),
      diagnosticMetric('leftImageKneeRatioSupport', analysis.leftImageKneeRatioSupport, {
        unit: 'ratio',
        eligible: repWindow.leftImageKneeRatioSampleCount > 0,
        confidence: analysis.leftKneeRatioConfidence,
        sampleCount: repWindow.leftImageKneeRatioSampleCount,
        skippedReason: 'left_image_knee_ratio_unavailable',
      }),
      diagnosticMetric('rightImageKneeRatioSupport', analysis.rightImageKneeRatioSupport, {
        unit: 'ratio',
        eligible: repWindow.rightImageKneeRatioSampleCount > 0,
        confidence: analysis.rightKneeRatioConfidence,
        sampleCount: repWindow.rightImageKneeRatioSampleCount,
        skippedReason: 'right_image_knee_ratio_unavailable',
      }),
      diagnosticMetric('rawKneeRatio', finiteValue(repWindow.minRawKneeRatio, NaN), {
        unit: 'ratio',
        eligible: repWindow.kneeRatioSampleCount > 0 && Number.isFinite(repWindow.minRawKneeRatio),
        sampleCount: repWindow.kneeRatioSampleCount,
        skippedReason: 'knee_ratio_unavailable',
      }),
      diagnosticMetric('fastKneeRatio', finiteValue(repWindow.minKneeRatio, NaN), {
        unit: 'ratio',
        eligible: repWindow.kneeRatioSampleCount > 0 && Number.isFinite(repWindow.minKneeRatio),
        sampleCount: repWindow.kneeRatioSampleCount,
        skippedReason: 'knee_ratio_unavailable',
      }),
      diagnosticMetric('movementKneeRatio', analysis.depthRatio, {
        unit: 'ratio',
        eligible: repWindow.kneeRatioSampleCount > 0,
        sampleCount: repWindow.kneeRatioSampleCount,
        skippedReason: 'knee_ratio_unavailable',
      }),
      diagnosticMetric('thighDepthAngle', analysis.thighDepthAngle, {
        unit: 'degrees',
        eligible: analysis.thighDepthEligible,
        confidence: analysis.thighDepthConfidence,
        sampleCount: repWindow.thighDepthSampleCount,
        skippedReason: analysis.sideOnlyMetricsEligible ? 'hip_knee_depth_unavailable' : 'not_side_view',
      }),
      diagnosticMetric('rawThighDepthAngle', finiteValue(repWindow.minRawThighDepthAngle, NaN), {
        unit: 'degrees',
        eligible: analysis.sideOnlyMetricsEligible && repWindow.thighDepthSampleCount > 0 && Number.isFinite(repWindow.minRawThighDepthAngle),
        confidence: analysis.thighDepthConfidence,
        sampleCount: repWindow.thighDepthSampleCount,
        skippedReason: analysis.sideOnlyMetricsEligible ? 'hip_knee_depth_unavailable' : 'not_side_view',
      }),
      diagnosticMetric('depthRatio', analysis.depthRatio, { unit: 'ratio' }),
      diagnosticMetric('lockoutRatio', analysis.lockoutRatio, {
        unit: 'ratio',
        eligible: analysis.lockoutEligible,
        sampleCount: repWindow.kneeRatioSampleCount,
        skippedReason: analysis.frontConfirmed ? 'world_knee_ratio_unavailable' : 'view_uncertain',
      }),
      diagnosticMetric('lockoutBaselineRatio', analysis.lockoutBaselineRatio, {
        unit: 'ratio',
        eligible: analysis.lockoutBaselineRatio !== null,
        sampleCount: analysis.lockoutBaselineRatio !== null ? 1 : 0,
        skippedReason: 'lockout_baseline_unavailable',
      }),
      diagnosticMetric('lockoutBaselineSampleCount', analysis.lockoutBaselineRatio !== null ? 1 : 0, {
        unit: 'count',
        eligible: analysis.lockoutBaselineRatio !== null,
        skippedReason: 'lockout_baseline_unavailable',
      }),
      diagnosticMetric('lockoutDeltaRatio', analysis.lockoutDeltaRatio, {
        unit: 'ratio',
        eligible: analysis.lockoutDeltaRatio !== null,
        skippedReason: 'lockout_baseline_unavailable',
      }),
      diagnosticMetric('romRatio', analysis.romRatio, {
        unit: 'ratio',
        eligible: analysis.romEligible,
        sampleCount: repWindow.kneeRatioSampleCount,
        skippedReason: analysis.frontConfirmed ? 'world_knee_ratio_unavailable' : 'view_uncertain',
      }),
      diagnosticMetric('heelLiftDeltaDeg', analysis.heelLiftDeltaDeg, {
        unit: 'degrees',
        eligible: analysis.heelLiftEligible,
        confidence: analysis.heelLiftConfidence,
        sampleCount: repWindow.heelLiftSampleCount,
        skippedReason: analysis.sideOnlyMetricsEligible ? 'foot_landmarks_unavailable' : 'not_side_view',
      }),
      diagnosticMetric('footPitchBaseline', repWindow.footPitchBaseline, {
        unit: 'degrees',
        eligible: analysis.sideOnlyMetricsEligible && repWindow.footPitchBaseline !== null,
        sampleCount: repWindow.footPitchBaseline !== null ? 1 : 0,
        skippedReason: analysis.sideOnlyMetricsEligible ? 'foot_baseline_unavailable' : 'not_side_view',
      }),
      diagnosticLabelMetric('footPitchBaselineSource', repWindow.footPitchBaseline !== null ? 'image' : null, {
        sampleCount: repWindow.footPitchBaseline !== null ? 1 : 0,
        skippedReason: 'foot_baseline_unavailable',
      }),
      diagnosticMetric('rawHeelLiftDeltaDeg', analysis.heelLiftEligible ? repWindow.maxRawHeelLiftDeltaDeg : null, {
        unit: 'degrees',
        eligible: analysis.heelLiftEligible,
        confidence: analysis.heelLiftConfidence,
        sampleCount: repWindow.heelLiftSampleCount,
        skippedReason: analysis.sideOnlyMetricsEligible ? 'foot_landmarks_unavailable' : 'not_side_view',
      }),
      diagnosticMetric('heelLiftSupport', analysis.heelLiftSupport, {
        unit: 'ratio',
        eligible: repWindow.heelLiftSampleCount > 0,
        confidence: analysis.heelLiftConfidence,
        sampleCount: repWindow.heelLiftSampleCount,
        skippedReason: 'foot_landmarks_unavailable',
      }),
      diagnosticMetric('heelLiftEligibleSupport', analysis.heelLiftEligibleSupport, {
        unit: 'ratio',
        eligible: analysis.heelLiftEligibleSupport !== null,
        confidence: analysis.heelLiftConfidence,
        sampleCount: repWindow.heelLiftSampleCount,
        skippedReason: 'foot_landmarks_unavailable',
      }),
      diagnosticMetric('heelLiftOverThresholdSupport', analysis.heelLiftOverThresholdSupport, {
        unit: 'ratio',
        eligible: analysis.heelLiftOverThresholdSupport !== null,
        confidence: analysis.heelLiftConfidence,
        sampleCount: repWindow.heelLiftSampleCount,
        skippedReason: 'foot_landmarks_unavailable',
      }),
      diagnosticMetric('torsoLean', analysis.torsoLean, {
        unit: 'degrees',
        eligible: analysis.torsoLean !== null,
        confidence: analysis.torsoLeanConfidence,
        sampleCount: repWindow.torsoLeanSampleCount,
        skippedReason: analysis.sideOnlyMetricsEligible ? 'torso_landmarks_unavailable' : 'not_side_view',
      }),
      diagnosticMetric('rawTorsoLean', analysis.torsoLean !== null ? repWindow.maxRawTorsoLean : null, {
        unit: 'degrees',
        eligible: analysis.torsoLean !== null,
        confidence: analysis.torsoLeanConfidence,
        sampleCount: repWindow.torsoLeanSampleCount,
        skippedReason: analysis.sideOnlyMetricsEligible ? 'torso_landmarks_unavailable' : 'not_side_view',
      }),
      diagnosticMetric('torsoLeanDelta', analysis.torsoLeanDelta, {
        unit: 'degrees',
        eligible: analysis.torsoHasBaseline,
        confidence: analysis.torsoLeanConfidence,
        sampleCount: repWindow.torsoLeanSampleCount,
        skippedReason: 'torso_baseline_unavailable',
      }),
      diagnosticMetric('torsoLeanBaseline', repWindow.torsoLeanBaseline, {
        unit: 'degrees',
        eligible: analysis.sideOnlyMetricsEligible && repWindow.torsoLeanBaseline !== null,
        sampleCount: repWindow.torsoLeanBaseline !== null ? 1 : 0,
        skippedReason: analysis.sideOnlyMetricsEligible ? 'torso_baseline_unavailable' : 'not_side_view',
      }),
      diagnosticMetric('torsoWorldSampleSupport', supportRatio(repWindow.torsoWorldSampleCount, repWindow.torsoLeanSampleCount), {
        unit: 'ratio',
        eligible: repWindow.torsoWorldSampleCount > 0,
        confidence: analysis.torsoLeanConfidence,
        sampleCount: repWindow.torsoWorldSampleCount,
        skippedReason: 'world_torso_unavailable',
      }),
      diagnosticMetric('torsoImageSampleSupport', supportRatio(repWindow.torsoImageSampleCount, repWindow.torsoLeanSampleCount), {
        unit: 'ratio',
        eligible: repWindow.torsoImageSampleCount > 0,
        confidence: analysis.torsoLeanConfidence,
        sampleCount: repWindow.torsoImageSampleCount,
        skippedReason: 'image_torso_unavailable',
      }),
      diagnosticMetric('torsoLeanSigned', analysis.torsoLeanSigned, {
        unit: 'degrees',
        eligible: analysis.torsoLeanSigned !== null,
        confidence: analysis.torsoLeanConfidence,
        sampleCount: repWindow.torsoLeanSampleCount,
        skippedReason: 'signed_torso_unavailable',
      }),
      diagnosticMetric('sideViewWidthRatio', analysis.sideViewWidthRatio, {
        unit: 'ratio',
        eligible: analysis.sideViewWidthRatio !== null,
        confidence: analysis.sideViewConfidence,
        sampleCount: repWindow.sideViewSampleCount,
        skippedReason: 'bilateral_body_width_unavailable',
      }),
      diagnosticMetric('sideViewQuality', analysis.sideViewQualityRank, {
        unit: 'count',
        eligible: analysis.sideViewQualityRank !== null,
        confidence: analysis.sideViewConfidence,
        sampleCount: repWindow.sideViewSampleCount,
        skippedReason: 'bilateral_body_width_unavailable',
      }),
      diagnosticMetric('kneeTrackingOffsetRatio', analysis.kneeTrackingOffsetRatio, {
        unit: 'ratio',
        eligible: analysis.kneeTrackingEligible,
        confidence: analysis.kneeTrackingConfidence,
        sampleCount: repWindow.kneeTrackingSampleCount,
        skippedReason: analysis.frontConfirmed ? 'knee_tracking_unavailable' : 'not_front_view',
      }),
      diagnosticMetric('kneeTrackingEligibleSupport', analysis.kneeTrackingEligibleSupport, {
        unit: 'ratio',
        eligible: analysis.kneeTrackingEligibleSupport !== null,
        confidence: analysis.kneeTrackingConfidence,
        sampleCount: repWindow.kneeTrackingSampleCount,
        skippedReason: analysis.frontConfirmed ? 'knee_tracking_unavailable' : 'not_front_view',
      }),
      diagnosticMetric('kneeTrackingOverThresholdSupport', analysis.kneeTrackingOverThresholdSupport, {
        unit: 'ratio',
        eligible: analysis.kneeTrackingOverThresholdSupport !== null,
        confidence: analysis.kneeTrackingConfidence,
        sampleCount: repWindow.kneeTrackingSampleCount,
        skippedReason: analysis.frontConfirmed ? 'knee_tracking_unavailable' : 'not_front_view',
      }),
      diagnosticMetric('partialRep', analysis.partialRep ? 1 : 0, { unit: 'count' }),
      diagnosticMetric('tDown', analysis.tDown, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
      diagnosticMetric('tUp', analysis.tUp, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
      diagnosticMetric('tBottom', analysis.tBottom, { unit: 'seconds', eligible: analysis.tBottom !== null, skippedReason: 'bottom_not_detected' }),
      diagnosticMetric('tMovementEnd', analysis.tMovementEnd, { unit: 'seconds', eligible: analysis.tMovementEnd !== null, skippedReason: 'movement_end_unavailable' }),
      diagnosticMetric('tConfirmedEnd', analysis.tConfirmedEnd, { unit: 'seconds', eligible: analysis.tConfirmedEnd !== null, skippedReason: 'confirmed_end_unavailable' }),
      diagnosticMetric('movementEndDelaySeconds', analysis.movementEndDelaySeconds, {
        unit: 'seconds',
        eligible: analysis.movementEndDelaySeconds !== null,
        skippedReason: 'movement_end_unavailable',
      }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'barbell-squat.depth_short',
        metricKeys: [analysis.depthSource],
        direction: 'above',
        value: analysis.depthValue,
        thresholdPath: depthThresholdPath,
        thresholdValue: depthThresholdValue,
        eligible: analysis.sideOnlyMetricsEligible,
        triggered: analysis.depthSeverity !== 'none',
        skippedReason: 'not_side_view',
      }),
      diagnosticCue({
        issueId: 'barbell-squat.lockout_short',
        metricKeys: analysis.lockoutDeltaRatio !== null ? ['lockoutDeltaRatio', 'lockoutBaselineRatio'] : ['lockoutRatio'],
        direction: analysis.lockoutDeltaRatio !== null ? 'above' : 'below',
        value: analysis.lockoutDeltaRatio ?? analysis.lockoutRatio,
        thresholdPath: analysis.lockoutDeltaRatio !== null
          ? 'formThresholds.LOCKOUT_BASELINE_DELTA_FAIL'
          : 'formThresholds.LOCKOUT_FAIL',
        thresholdValue: analysis.lockoutDeltaRatio !== null
          ? FORM_THRESHOLDS.LOCKOUT_BASELINE_DELTA_FAIL
          : FORM_THRESHOLDS.LOCKOUT_FAIL,
        eligible: analysis.lockoutEligible,
        triggered: analysis.lockoutShort,
        skippedReason: analysis.frontConfirmed ? 'world_knee_ratio_unavailable' : 'view_uncertain',
      }),
      diagnosticCue({
        issueId: 'barbell-squat.incomplete_rom',
        metricKeys: ['romRatio'],
        direction: 'below',
        value: analysis.romRatio,
        thresholdPath: 'formThresholds.ROM_MIN',
        thresholdValue: FORM_THRESHOLDS.ROM_MIN,
        eligible: analysis.romEligible,
        triggered: shouldEmitIncompleteRomCue(analysis),
        skippedReason: analysis.frontConfirmed ? 'world_knee_ratio_unavailable' : 'view_uncertain',
      }),
      diagnosticCue({
        issueId: 'barbell-squat.heel_lift',
        metricKeys: ['heelLiftDeltaDeg', 'heelLiftEligibleSupport', 'heelLiftOverThresholdSupport'],
        direction: 'above',
        value: analysis.heelLiftDeltaDeg,
        thresholdPath: [
          'formThresholds.HEEL_LIFT_WARN',
          'formThresholds.HEEL_LIFT_MIN_ELIGIBLE_SUPPORT',
          'formThresholds.HEEL_LIFT_MIN_SUPPORT',
        ],
        thresholdValue: {
          heelLiftDeltaDeg: FORM_THRESHOLDS.HEEL_LIFT_WARN,
          heelLiftEligibleSupport: FORM_THRESHOLDS.HEEL_LIFT_MIN_ELIGIBLE_SUPPORT,
          heelLiftOverThresholdSupport: FORM_THRESHOLDS.HEEL_LIFT_MIN_SUPPORT,
        },
        eligible: analysis.heelLiftEligible,
        triggered: analysis.heelLiftTriggered,
        support: analysis.heelLiftOverThresholdSupport ?? undefined,
        skippedReason: analysis.sideOnlyMetricsEligible ? 'foot_landmarks_unavailable' : 'not_side_view',
      }),
      diagnosticCue({
        issueId: 'barbell-squat.torso_fail',
        metricKeys: torsoCueMetricKeys,
        direction: 'above',
        value: torsoCueValue,
        thresholdPath: torsoFailThresholdPath,
        thresholdValue: torsoFailThresholdValue,
        eligible: analysis.sideOnlyMetricsEligible && (analysis.torsoLeanSigned ?? analysis.torsoLean) !== null,
        triggered: analysis.torsoSeverity === 'fail',
        skippedReason: analysis.sideOnlyMetricsEligible ? 'torso_landmarks_unavailable' : 'not_side_view',
      }),
      diagnosticCue({
        issueId: 'barbell-squat.torso_warn',
        metricKeys: torsoCueMetricKeys,
        direction: 'above',
        value: torsoCueValue,
        thresholdPath: torsoWarnThresholdPath,
        thresholdValue: torsoWarnThresholdValue,
        eligible: analysis.sideOnlyMetricsEligible && (analysis.torsoLeanSigned ?? analysis.torsoLean) !== null,
        triggered: analysis.torsoSeverity === 'warn',
        skippedReason: analysis.sideOnlyMetricsEligible ? 'torso_landmarks_unavailable' : 'not_side_view',
      }),
      diagnosticCue({
        issueId: 'barbell-squat.tempo_up',
        metricKeys: ['tUp'],
        direction: 'below',
        value: analysis.tUp,
        thresholdPath: 'formThresholds.TEMPO_CONCENTRIC_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_CONCENTRIC_MIN,
        eligible: hasTempo,
        triggered: analysis.tempoUpShort,
        skippedReason: 'bottom_not_detected',
      }),
      diagnosticCue({
        issueId: 'barbell-squat.tempo_down',
        metricKeys: ['tDown'],
        direction: 'below',
        value: analysis.tDown,
        thresholdPath: 'formThresholds.TEMPO_ECCENTRIC_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_ECCENTRIC_MIN,
        eligible: hasTempo,
        triggered: analysis.tempoDownShort,
        skippedReason: 'bottom_not_detected',
      }),
    ],
  });
}

function applyReliabilityCueGating(
  diagnostics: NonNullable<FrameworkRepResult['diagnostics']>,
  interpretation: RepReliabilityInterpretation | null,
  scorable: boolean,
): NonNullable<FrameworkRepResult['diagnostics']> {
  if (!interpretation) return { ...diagnostics, scorable };

  const unsafeFamilies = new Set(interpretation.unsafeCueFamilies);
  const suppressedIssueIds: string[] = [];
  const suppressedCueFamilies = new Set<string>();
  const cues = Object.fromEntries(
    Object.entries(diagnostics.cues).map(([issueId, cue]) => {
      const families = SQUAT_ISSUE_CUE_FAMILIES[issueId] ?? [];
      const unsafeFamily = families.find(family => unsafeFamilies.has(family));
      if (unsafeFamily) {
        suppressedIssueIds.push(issueId);
        for (const family of families) {
          if (unsafeFamilies.has(family)) suppressedCueFamilies.add(family);
        }
        return [issueId, {
          ...cue,
          eligible: false,
          triggered: false,
          skippedReason: `reliability_unsafe_${unsafeFamily}`,
        }];
      }
      return [issueId, cue];
    }),
  );

  return {
    ...diagnostics,
    scorable,
    cues,
    reliability: {
      ...interpretation,
      suppressedCueFamilies: Array.from(suppressedCueFamilies),
      suppressedIssueIds,
    },
  };
}

function shouldLogSquatReliability(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    !(typeof process !== 'undefined' && process.env.JEST_WORKER_ID)
  );
}

function logSquatRepReliability(
  repIndex: number,
  interpretation: RepReliabilityInterpretation | null,
  diagnostics: FrameworkRepResult['diagnostics'],
): void {
  if (!interpretation || !shouldLogSquatReliability()) return;
  const reliability = diagnostics?.reliability;
  console.log([
    `[SquatReliability] rep=${repIndex}`,
    `countability=${interpretation.countabilityCandidate}`,
    `scoreability=${interpretation.scoreabilityCandidate}`,
    `usableChains=${interpretation.usableChains.join(',') || 'none'}`,
    `weakChains=${interpretation.weakChains.join(',') || 'none'}`,
    `safeCueFamilies=${interpretation.safeCueFamilies.join(',') || 'none'}`,
    `unsafeCueFamilies=${interpretation.unsafeCueFamilies.join(',') || 'none'}`,
    `suppressedIssues=${reliability?.suppressedIssueIds?.join(',') || 'none'}`,
    `suppressedFamilies=${reliability?.suppressedCueFamilies?.join(',') || 'none'}`,
    `reasons=${interpretation.reasons.join(',') || 'none'}`,
  ].join(' '));
}

function poseStateHasRichReliabilityMetadata(poseState: NonNullable<ExerciseFrameContext['poseState']>): boolean {
  return SQUAT_RELIABILITY_JOINTS.some((jointName) => {
    const joint = poseState.joints[jointName];
    return (
      joint &&
      (
        joint.presence !== null ||
        joint.reasons.includes('presence_unknown') ||
        joint.reasons.includes('visibility_unknown')
      )
    );
  });
}

function observeSquatPoseState(
  repWindow: SquatRepWindow,
  frameContext: ExerciseFrameContext | undefined,
): void {
  const poseState = frameContext?.poseState;
  if (!poseState || !poseStateHasRichReliabilityMetadata(poseState)) return;
  repWindow.reliability.observe(poseState);
}

function buildSquatRepResult(args: {
  repWindow: SquatRepWindow;
  repIndex: number;
  visibleSide: SquatSide;
  romRatio: number;
  tDownFallback?: number;
  tUpFallback?: number;
}): RepResult {
  const reliability = reliabilityInterpretationForRepWindow(args.repWindow, args.visibleSide);
  const reliabilityInterpretation = reliability?.interpretation ?? null;
  const allowedCueFamilies = safeCueFamilySet(reliabilityInterpretation);
  const { score: qualityScore, messages, analysis } = evaluateForm(args.repWindow, allowedCueFamilies);
  const scorable = repScorableWithReliability(analysis, reliabilityInterpretation, args.visibleSide);
  const score = scorable ? qualityScore : 0;
  const finalMessages = suppressUnsafeReliabilityMessages(messages, reliabilityInterpretation);
  const qualityWarnings = qualityWarningsWithReliability(analysis, scorable, reliabilityInterpretation);
  const diagnostics = applyReliabilityCueGating(
    buildSquatDiagnostics(args.repWindow, args.repIndex, args.visibleSide, analysis),
    reliabilityInterpretation,
    scorable,
  );
  const tDown = analysis.tDown ?? args.tDownFallback ?? 0;
  const tUp = analysis.tUp ?? args.tUpFallback ?? 0;

  logSquatRepReliability(args.repIndex, reliabilityInterpretation, diagnostics);

  return {
    repIndex: args.repIndex,
    romRatio: args.romRatio,
    tDown,
    tUp,
    score,
    messages: finalMessages,
    scorable,
    qualityWarnings,
    diagnostics,
  };
}

function captureStandingBaselines(
  state: SquatState,
  imageKeypoints: Keypoint[],
  metricKeypoints: Keypoint[],
  visibleSide: 'left' | 'right',
  rawAngles: SquatAngles,
  fast: SmoothedSquatAngles,
  smoothed: SmoothedSquatAngles,
): void {
  state.standingKneeRatioPeak = Math.max(state.standingKneeRatioPeak, fast.kneeRatio);

  const torsoConf = minKeypointConfidence(metricKeypoints, [`${visibleSide}_shoulder`, `${visibleSide}_hip`]);
  if (torsoConf >= FORM_THRESHOLDS.BASELINE_CONFIDENCE_MIN && Number.isFinite(rawAngles.rawTorsoLean) && Number.isFinite(smoothed.torsoLean)) {
    state.standingTorsoLeanBaseline = smoothed.torsoLean;
  }
  if (torsoConf >= FORM_THRESHOLDS.BASELINE_CONFIDENCE_MIN && Number.isFinite(rawAngles.rawTorsoLeanSigned) && Number.isFinite(smoothed.torsoLeanSigned)) {
    state.standingTorsoLeanSignedBaseline = smoothed.torsoLeanSigned;
  }

  const footConf = minKeypointConfidence(imageKeypoints, [
    `${visibleSide}_heel`,
    `${visibleSide}_foot_index`,
    `${visibleSide}_ankle`,
  ]);
  if (footConf >= FORM_THRESHOLDS.BASELINE_CONFIDENCE_MIN && Number.isFinite(rawAngles.rawFootPitch) && Number.isFinite(smoothed.footPitch)) {
    state.standingFootPitchBaseline = smoothed.footPitch;
  }
}

function updateSideKneeRatio(
  repWindow: SquatRepWindow,
  side: SquatSide,
  rawValue: number,
  fastValue: number,
  sourceRank: number,
  confidence: number,
): void {
  if (!Number.isFinite(rawValue) || !Number.isFinite(fastValue)) return;

  const source = rankToSource(sourceRank);
  if (side === 'left') {
    repWindow.leftRawKneeRatioMin = Math.min(repWindow.leftRawKneeRatioMin, rawValue);
    repWindow.leftRawKneeRatioMax = Math.max(repWindow.leftRawKneeRatioMax, rawValue);
    repWindow.leftRawKneeRatioEnd = rawValue;
    repWindow.leftKneeRatioMin = Math.min(repWindow.leftKneeRatioMin, fastValue);
    repWindow.leftKneeRatioMax = Math.max(repWindow.leftKneeRatioMax, fastValue);
    repWindow.leftKneeRatioEnd = fastValue;
    repWindow.leftKneeRatioSampleCount++;
    repWindow.leftKneeRatioConfidenceSum += Number.isFinite(confidence) ? confidence : 0;
    if (source === 'world') repWindow.leftWorldKneeRatioSampleCount++;
    else if (source === 'image') repWindow.leftImageKneeRatioSampleCount++;
    return;
  }

  repWindow.rightRawKneeRatioMin = Math.min(repWindow.rightRawKneeRatioMin, rawValue);
  repWindow.rightRawKneeRatioMax = Math.max(repWindow.rightRawKneeRatioMax, rawValue);
  repWindow.rightRawKneeRatioEnd = rawValue;
  repWindow.rightKneeRatioMin = Math.min(repWindow.rightKneeRatioMin, fastValue);
  repWindow.rightKneeRatioMax = Math.max(repWindow.rightKneeRatioMax, fastValue);
  repWindow.rightKneeRatioEnd = fastValue;
  repWindow.rightKneeRatioSampleCount++;
  repWindow.rightKneeRatioConfidenceSum += Number.isFinite(confidence) ? confidence : 0;
  if (source === 'world') repWindow.rightWorldKneeRatioSampleCount++;
  else if (source === 'image') repWindow.rightImageKneeRatioSampleCount++;
}

function updateRepWindowMetrics(
  repWindow: SquatRepWindow,
  imageKeypoints: Keypoint[],
  metricKeypoints: Keypoint[],
  visibleSide: 'left' | 'right',
  rawAngles: SquatAngles,
  fast: SmoothedSquatAngles,
  smoothed: SmoothedSquatAngles,
): void {
  if (Number.isFinite(rawAngles.rawKneeRatio) && Number.isFinite(fast.kneeRatio)) {
    repWindow.minRawKneeRatio = Math.min(repWindow.minRawKneeRatio, rawAngles.rawKneeRatio);
    repWindow.maxRawKneeRatio = Math.max(repWindow.maxRawKneeRatio, rawAngles.rawKneeRatio);
    repWindow.endRawKneeRatio = rawAngles.rawKneeRatio;
    repWindow.minKneeRatio = Math.min(repWindow.minKneeRatio, fast.kneeRatio);
    repWindow.maxKneeRatio = Math.max(repWindow.maxKneeRatio, fast.kneeRatio);
    repWindow.endKneeRatio = fast.kneeRatio;
    repWindow.kneeRatioSampleCount++;
    if (rankToSource(rawAngles.kneeRatioSourceRank) === 'world') {
      repWindow.worldKneeRatioSampleCount++;
    } else {
      repWindow.imageKneeRatioSampleCount++;
    }
  }
  updateSideKneeRatio(
    repWindow,
    'left',
    rawAngles.rawLeftKneeRatio,
    fast.leftKneeRatio,
    rawAngles.leftKneeRatioSourceRank,
    rawAngles.leftKneeRatioConfidence,
  );
  updateSideKneeRatio(
    repWindow,
    'right',
    rawAngles.rawRightKneeRatio,
    fast.rightKneeRatio,
    rawAngles.rightKneeRatioSourceRank,
    rawAngles.rightKneeRatioConfidence,
  );

  const thighDepthConf = minKeypointConfidence(imageKeypoints, [`${visibleSide}_hip`, `${visibleSide}_knee`]);
  if (
    thighDepthConf >= FORM_THRESHOLDS.METRIC_CONFIDENCE_MIN &&
    Number.isFinite(rawAngles.rawThighDepthAngle) &&
    Number.isFinite(fast.thighDepthAngle)
  ) {
    repWindow.minRawThighDepthAngle = Math.min(repWindow.minRawThighDepthAngle, rawAngles.rawThighDepthAngle);
    repWindow.minThighDepthAngle = Math.min(repWindow.minThighDepthAngle, fast.thighDepthAngle);
    repWindow.thighDepthSampleCount++;
    repWindow.thighDepthConfidenceSum += thighDepthConf;
  }

  const torsoConf = minKeypointConfidence(metricKeypoints, [`${visibleSide}_shoulder`, `${visibleSide}_hip`]);
  if (
    torsoConf >= FORM_THRESHOLDS.METRIC_CONFIDENCE_MIN &&
    Number.isFinite(rawAngles.rawTorsoLean) &&
    Number.isFinite(fast.torsoLean)
  ) {
    repWindow.maxRawTorsoLean = Math.max(repWindow.maxRawTorsoLean, rawAngles.rawTorsoLean);
    repWindow.maxTorsoLean = Math.max(repWindow.maxTorsoLean, fast.torsoLean);
    if (repWindow.torsoLeanBaseline !== null) {
      repWindow.maxTorsoLeanDelta = Math.max(
        repWindow.maxTorsoLeanDelta,
        Math.max(0, fast.torsoLean - repWindow.torsoLeanBaseline),
      );
    }
    repWindow.torsoLeanSampleCount++;
    repWindow.torsoLeanConfidenceSum += torsoConf;
    if (rankToSource(rawAngles.torsoSourceRank) === 'world') {
      repWindow.torsoWorldSampleCount++;
    } else {
      repWindow.torsoImageSampleCount++;
    }
  }
  if (
    torsoConf >= FORM_THRESHOLDS.METRIC_CONFIDENCE_MIN &&
    Number.isFinite(rawAngles.rawTorsoLeanSigned) &&
    Number.isFinite(fast.torsoLeanSigned)
  ) {
    repWindow.maxRawTorsoLeanSigned = Math.max(repWindow.maxRawTorsoLeanSigned, rawAngles.rawTorsoLeanSigned);
    repWindow.maxTorsoLeanSigned = Math.max(repWindow.maxTorsoLeanSigned, fast.torsoLeanSigned);
    if (repWindow.torsoLeanSignedBaseline !== null) {
      repWindow.maxTorsoLeanSignedDelta = Math.max(
        repWindow.maxTorsoLeanSignedDelta,
        Math.max(0, fast.torsoLeanSigned - repWindow.torsoLeanSignedBaseline),
      );
    }
  }

  const footConf = minKeypointConfidence(imageKeypoints, [
    `${visibleSide}_heel`,
    `${visibleSide}_foot_index`,
    `${visibleSide}_ankle`,
  ]);
  if (
    footConf >= FORM_THRESHOLDS.METRIC_CONFIDENCE_MIN &&
    repWindow.footPitchBaseline !== null &&
    Number.isFinite(rawAngles.rawFootPitch) &&
    Number.isFinite(fast.footPitch)
  ) {
    const heelLiftDelta = Math.max(0, fast.footPitch - repWindow.footPitchBaseline);
    const rawHeelLiftDelta = Math.max(0, rawAngles.rawFootPitch - repWindow.footPitchBaseline);
    repWindow.maxRawHeelLiftDeltaDeg = Math.max(repWindow.maxRawHeelLiftDeltaDeg, rawHeelLiftDelta);
    repWindow.maxHeelLiftDeltaDeg = Math.max(repWindow.maxHeelLiftDeltaDeg, heelLiftDelta);
    if (heelLiftDelta > FORM_THRESHOLDS.HEEL_LIFT_WARN) {
      repWindow.heelLiftTriggeredSampleCount++;
    }
    repWindow.heelLiftSampleCount++;
    repWindow.heelLiftConfidenceSum += footConf;
  }

  const sideViewConf = minKeypointConfidence(imageKeypoints, [
    'left_shoulder',
    'right_shoulder',
    'left_hip',
    'right_hip',
  ]);
  if (sideViewConf >= FORM_THRESHOLDS.VIEW_CONFIDENCE_MIN && Number.isFinite(fast.sideViewWidthRatio)) {
    repWindow.maxSideViewWidthRatio = Math.max(repWindow.maxSideViewWidthRatio, fast.sideViewWidthRatio);
    repWindow.sideViewSampleCount++;
    repWindow.sideViewConfidenceSum += sideViewConf;
  }

  const viewConfidence = Number.isFinite(rawAngles.viewConfidence) ? Math.max(0, rawAngles.viewConfidence) : 0;
  const viewClass = rankToViewClass(rawAngles.viewClassRank);
  repWindow.viewSampleCount++;
  repWindow.viewConfidenceSum += viewConfidence;
  repWindow.viewConfidenceMin = Math.min(repWindow.viewConfidenceMin, viewConfidence);
  if (viewClass === 'side') repWindow.sideViewClassSampleCount++;
  else if (viewClass === 'front') repWindow.frontViewClassSampleCount++;
  else if (viewClass === 'oblique') repWindow.obliqueViewClassSampleCount++;
  else repWindow.unknownViewClassSampleCount++;
  if (Number.isFinite(rawAngles.viewAngleDeg)) {
    repWindow.maxViewAngleDeg = Math.max(repWindow.maxViewAngleDeg, rawAngles.viewAngleDeg);
    repWindow.viewAngleSampleCount++;
  }

  const kneeTracking = calculateKneeTracking(imageKeypoints);
  if (
    kneeTracking &&
    Number.isFinite(rawAngles.kneeTrackingOffsetRatio)
    && Number.isFinite(fast.kneeTrackingOffsetRatio)
  ) {
    repWindow.maxKneeTrackingOffsetRatio = Math.max(
      repWindow.maxKneeTrackingOffsetRatio,
      fast.kneeTrackingOffsetRatio,
    );
    if (fast.kneeTrackingOffsetRatio > FORM_THRESHOLDS.KNEE_VALGUS_WARN) {
      repWindow.kneeTrackingTriggeredSampleCount++;
    }
    repWindow.kneeTrackingSampleCount++;
    repWindow.kneeTrackingConfidenceSum += kneeTracking.confidence;
  }
}

function finalizeRepWindow(
  state: SquatState,
  visibleSide: 'left' | 'right',
  fastKneeRatio: number,
): void {
  if (!state.repWindow) return;
  const romRatio = state.repWindow.maxKneeRatio - state.repWindow.minKneeRatio;

  if (romRatio < THRESHOLDS.MIN_REP_ROM || state.repWindow.frameCount < THRESHOLDS.MIN_REP_FRAMES) {
    state.repWindow = null;
    state.fsm = resetFSMToStanding();
    state.standingKneeRatioPeak = fastKneeRatio;
    return;
  }

  state.repCount++;
  state.repWindow.tConfirmedEnd = state.repWindow.tEnd;

  state.lastRepResult = buildSquatRepResult({
    repWindow: state.repWindow,
    repIndex: state.repCount,
    visibleSide,
    romRatio,
  });

  state.feedback = state.lastRepResult.messages.length > 0
    ? state.lastRepResult.messages.join('\n')
    : state.lastRepResult.scorable
      ? 'Great rep!'
      : null;
  state.lastFeedbackTime = state.repWindow.tEnd;
  state.repWindow = null;
  state.fsm = resetFSMToStanding();
  state.standingKneeRatioPeak = fastKneeRatio;
}

function pendingLockoutReady(repWindow: SquatRepWindow): boolean {
  const analysis = analyzeSquatRep(repWindow);
  return !analysis.lockoutShort || (repWindow.pendingCompletionFrames ?? 0) >= 6;
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateSquatState(
  keypoints: Keypoint[],
  currentState: SquatState,
  frameContext?: ExerciseFrameContext,
): SquatState {
  const t = Date.now() / 1000;
  const imageKeypoints = frameContext?.imageKeypoints ?? keypoints;
  const metricKeypoints = frameContext?.worldKeypoints ?? keypoints;

  if (frameContext?.trackingInterrupted) {
    return resetSquatAfterTrackingInterruption(currentState);
  }

  // Only update visible side in IDLE/STANDING — lock it during active rep phases
  // to prevent mid-rep side switching that corrupts angle measurements.
  const inActiveRep =
    currentState.repWindow !== null ||
    (currentState.fsm.phase !== 'IDLE' && currentState.fsm.phase !== 'STANDING');
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(metricKeypoints);

  const rawAngles = calculateSquatAngles(keypoints, visibleSide, frameContext);
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
    captureStandingBaselines(newState, imageKeypoints, metricKeypoints, visibleSide, rawAngles, fast, smoothed);
  }

  // Update FSM — uses fast (median-only) ratio to avoid smoothing-induced misses
  const fsmResult = updateFSM(currentState.fsm, fast.kneeRatio, t, fast.torsoLean);
  newState.fsm = fsmResult.fsm;

  // Handle partial rep — count meaningful returned partials, but ignore tiny pulses.
  if (fsmResult.partialRep) {
    if (newState.repWindow) {
      newState.repWindow.tEnd = t;
      newState.repWindow.frameCount++;
      observeSquatPoseState(newState.repWindow, frameContext);
      updateRepWindowMetrics(newState.repWindow, imageKeypoints, metricKeypoints, visibleSide, rawAngles, fast, smoothed);
    }

    const finalPartialROM = newState.repWindow
      ? newState.repWindow.maxKneeRatio - newState.repWindow.minKneeRatio
      : 0;
    const finalPartialFrames = newState.repWindow?.frameCount ?? 0;

    if (
      newState.repWindow &&
      isMeaningfulPartialRep({
        actualRom: finalPartialROM,
        minRom: THRESHOLDS.MIN_PARTIAL_ROM,
        frameCount: finalPartialFrames,
        minFrames: THRESHOLDS.MIN_REP_FRAMES,
      })
    ) {
      newState.repCount++;
      newState.repWindow.partialRep = true;
      newState.repWindow.tMovementEnd = newState.repWindow.tEnd;
      newState.repWindow.tConfirmedEnd = newState.repWindow.tEnd;
      const tDown = newState.repWindow.tEnd - newState.repWindow.tStart;
      newState.lastRepResult = buildSquatRepResult({
        repWindow: newState.repWindow,
        repIndex: newState.repCount,
        visibleSide,
        romRatio: finalPartialROM,
        tDownFallback: tDown,
        tUpFallback: 0,
      });
      newState.feedback = newState.lastRepResult.messages.length > 0
        ? newState.lastRepResult.messages.join('\n')
        : newState.lastRepResult.scorable
          ? 'Good rep.'
          : null;
      newState.lastFeedbackTime = t;
    } else if (finalPartialROM > 0) {
      newState.feedback = LOW_ROM_FEEDBACK;
      newState.lastFeedbackTime = t;
    }
    // Either way, reset the rep window and let FSM return to STANDING
    newState.repWindow = null;
    newState.standingKneeRatioPeak = fast.kneeRatio;
    return newState;
  }

  if (newState.repWindow && newState.repWindow.pendingCompletionFrames !== null) {
    newState.repWindow.tEnd = t;
    newState.repWindow.frameCount++;
    newState.repWindow.pendingCompletionFrames++;
    observeSquatPoseState(newState.repWindow, frameContext);
    updateRepWindowMetrics(newState.repWindow, imageKeypoints, metricKeypoints, visibleSide, rawAngles, fast, smoothed);

    if (pendingLockoutReady(newState.repWindow)) {
      finalizeRepWindow(newState, visibleSide, fast.kneeRatio);
    }
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
      standingRatio !== undefined && !isNaN(standingRatio) ? standingRatio : fast.kneeRatio,
      {
        torsoLeanBaseline: newState.standingTorsoLeanBaseline,
        torsoLeanSignedBaseline: newState.standingTorsoLeanSignedBaseline,
        footPitchBaseline: newState.standingFootPitchBaseline,
      },
    );
    newState.standingKneeRatioPeak = -Infinity;
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;
    observeSquatPoseState(window, frameContext);
    updateRepWindowMetrics(window, imageKeypoints, metricKeypoints, visibleSide, rawAngles, fast, smoothed);

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
    newState.repWindow.tEnd = t;
    newState.repWindow.tMovementEnd ??= t;
    newState.repWindow.frameCount++;
    observeSquatPoseState(newState.repWindow, frameContext);
    updateRepWindowMetrics(newState.repWindow, imageKeypoints, metricKeypoints, visibleSide, rawAngles, fast, smoothed);
    newState.repWindow.pendingCompletionFrames = 0;
    if (pendingLockoutReady(newState.repWindow)) {
      finalizeRepWindow(newState, visibleSide, fast.kneeRatio);
    }
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
  const analysis = repWin ? analyzeSquatRep(repWin) : null;
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
    thighDepthAngle: fmt(angles?.thighDepthAngle),
    depthRatio: analysis ? fmt(analysis.depthRatio) : null,
    lockoutRatio: analysis ? fmt(analysis.lockoutRatio) : null,
    lockoutBaselineRatio: analysis && analysis.lockoutBaselineRatio !== null ? fmt(analysis.lockoutBaselineRatio) : null,
    lockoutDeltaRatio: analysis && analysis.lockoutDeltaRatio !== null ? fmt(analysis.lockoutDeltaRatio) : null,
    romRatio: analysis ? fmt(analysis.romRatio) : null,
    heelLiftDeltaDeg: analysis && analysis.heelLiftDeltaDeg !== null ? fmt(analysis.heelLiftDeltaDeg) : null,
    heelLiftSupport: analysis && analysis.heelLiftSupport !== null ? fmt(analysis.heelLiftSupport) : null,
    heelLiftEligibleSupport: analysis && analysis.heelLiftEligibleSupport !== null ? fmt(analysis.heelLiftEligibleSupport) : null,
    heelLiftOverThresholdSupport: analysis && analysis.heelLiftOverThresholdSupport !== null ? fmt(analysis.heelLiftOverThresholdSupport) : null,
    torsoLeanDelta: analysis && analysis.torsoLeanDelta !== null ? fmt(analysis.torsoLeanDelta) : null,
    torsoLeanSigned: analysis && analysis.torsoLeanSigned !== null ? fmt(analysis.torsoLeanSigned) : null,
    sideViewWidthRatio: analysis && analysis.sideViewWidthRatio !== null ? fmt(analysis.sideViewWidthRatio) : null,
    sideViewQuality: analysis?.sideViewQuality ?? 'unknown',
    partialRep: analysis?.partialRep ?? false,
    kneeRatioMin: repWin && repWin.minKneeRatio !== Infinity ? fmt(repWin.minKneeRatio) : null,
    kneeRatioMax: repWin && repWin.maxKneeRatio !== -Infinity ? fmt(repWin.maxKneeRatio) : null,
    maxTorsoLean: repWin && repWin.maxTorsoLean !== -Infinity ? fmt(repWin.maxTorsoLean) : null,
    rawKneeRatio: repWin && repWin.minRawKneeRatio !== Infinity ? fmt(repWin.minRawKneeRatio) : fmt(angles?.rawKneeRatio),
    leftKneeRatio: analysis?.leftKneeRatio ?? fmt(angles?.leftKneeRatio),
    rightKneeRatio: analysis?.rightKneeRatio ?? fmt(angles?.rightKneeRatio),
    leftKneeRatioSupport: analysis?.leftKneeRatioSupport ?? null,
    rightKneeRatioSupport: analysis?.rightKneeRatioSupport ?? null,
    leftWorldKneeRatioSupport: analysis?.leftWorldKneeRatioSupport ?? null,
    rightWorldKneeRatioSupport: analysis?.rightWorldKneeRatioSupport ?? null,
    rawThighDepthAngle: repWin && repWin.minRawThighDepthAngle !== Infinity ? fmt(repWin.minRawThighDepthAngle) : fmt(angles?.rawThighDepthAngle),
    rawTorsoLean: repWin && repWin.maxRawTorsoLean !== -Infinity ? fmt(repWin.maxRawTorsoLean) : fmt(angles?.rawTorsoLean),
    rawFootPitch: fmt(angles?.rawFootPitch),
    kneeTrackingOffsetRatio: analysis && analysis.kneeTrackingOffsetRatio !== null ? fmt(analysis.kneeTrackingOffsetRatio) : fmt(angles?.kneeTrackingOffsetRatio),
    kneeTrackingEligibleSupport: analysis && analysis.kneeTrackingEligibleSupport !== null ? fmt(analysis.kneeTrackingEligibleSupport) : null,
    kneeTrackingOverThresholdSupport: analysis && analysis.kneeTrackingOverThresholdSupport !== null ? fmt(analysis.kneeTrackingOverThresholdSupport) : null,
    viewClass: analysis?.view ?? rankToViewClass(angles?.viewClassRank ?? 3),
    viewAngleDeg: analysis && analysis.maxViewAngleDeg !== null ? fmt(analysis.maxViewAngleDeg) : fmt(angles?.viewAngleDeg),
    metricSource: analysis?.primaryMetricSource ?? rankToSource(angles?.kneeRatioSourceRank ?? NaN),
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

function configNumber(config: ExerciseHeuristicConfig, path: string, issues: string[]): number | null {
  const value = getConfigValue(config, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`Squat config "${path}" must be a finite number.`);
    return null;
  }
  return value;
}

function requireOrdered(
  config: ExerciseHeuristicConfig,
  issues: string[],
  firstPath: string,
  secondPath: string,
  allowEqual = false,
): void {
  const first = configNumber(config, firstPath, issues);
  const second = configNumber(config, secondPath, issues);
  if (first === null || second === null) return;
  const ok = allowEqual ? first <= second : first < second;
  if (!ok) {
    issues.push(
      `Squat config ordering invalid: "${firstPath}" (${first}) must be ${allowEqual ? '<=' : '<'} "${secondPath}" (${second}).`,
    );
  }
}

function validateScoreCurves(config: ExerciseHeuristicConfig, issues: string[]): void {
  const scoreCurves = getConfigValue(config, 'scoreCurves');
  if (scoreCurves === null || typeof scoreCurves !== 'object' || Array.isArray(scoreCurves)) {
    issues.push('Squat config "scoreCurves" must be an object.');
    return;
  }

  for (const [curveName, curve] of Object.entries(scoreCurves)) {
    if (curve === null || typeof curve !== 'object' || Array.isArray(curve)) {
      issues.push(`Squat score curve "${curveName}" must be an object.`);
      continue;
    }
    for (const [key, value] of Object.entries(curve)) {
      const path = `scoreCurves.${curveName}.${key}`;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(`Squat config "${path}" must be a finite number.`);
        continue;
      }
      if (key === 'scale' && value <= 0) {
        issues.push(`Squat config "${path}" must be greater than 0.`);
      }
      if (key === 'cap' && value < 0) {
        issues.push(`Squat config "${path}" must be greater than or equal to 0.`);
      }
      if ((key === 'deadzone' || key === 'ideal') && value < 0) {
        issues.push(`Squat config "${path}" must be greater than or equal to 0.`);
      }
    }
  }
}

function validateSquatHeuristicConfig(config: ExerciseHeuristicConfig): string[] {
  const issues: string[] = [];

  requireOrdered(config, issues, 'thresholds.BOTTOM_ENTER', 'thresholds.BOTTOM_EXIT');
  requireOrdered(config, issues, 'thresholds.BOTTOM_EXIT', 'thresholds.DESCENDING_ENTER');
  requireOrdered(config, issues, 'thresholds.DESCENDING_ENTER', 'thresholds.STANDING_REENTER', true);
  requireOrdered(config, issues, 'thresholds.STANDING_REENTER', 'thresholds.PARTIAL_REP_RESET', true);
  requireOrdered(config, issues, 'thresholds.PARTIAL_REP_RESET', 'thresholds.DESCENT_CLOCK_START', true);
  requireOrdered(config, issues, 'thresholds.MIN_PARTIAL_ROM', 'thresholds.MIN_REP_ROM');

  for (const path of [
    'thresholds.DESCENT_CLOCK_START',
    'thresholds.DESCENDING_ENTER',
    'thresholds.BOTTOM_ENTER',
    'thresholds.BOTTOM_EXIT',
    'thresholds.STANDING_REENTER',
    'thresholds.PARTIAL_REP_RESET',
    'thresholds.IDLE_STANDING_MIN',
    'thresholds.MIN_PARTIAL_ROM',
    'thresholds.MIN_REP_ROM',
    'formThresholds.DEPTH_WARN',
    'formThresholds.DEPTH_FAIL',
    'formThresholds.LOCKOUT_FAIL',
    'formThresholds.LOCKOUT_BASELINE_DELTA_FAIL',
    'formThresholds.ROM_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value < 0 || value > 1)) {
      issues.push(`Squat config "${path}" must be between 0 and 1.`);
    }
  }

  for (const path of [
    'thresholds.MIN_REP_TIME',
    'thresholds.MIN_DESCENDING_TIME',
    'thresholds.STANDING_HOLD_TIME',
    'thresholds.MIN_REP_FRAMES',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && value <= 0) {
      issues.push(`Squat config "${path}" must be greater than 0.`);
    }
  }

  requireOrdered(config, issues, 'formThresholds.DEPTH_WARN', 'formThresholds.DEPTH_FAIL');
  requireOrdered(config, issues, 'formThresholds.THIGH_DEPTH_WARN', 'formThresholds.THIGH_DEPTH_FAIL');
  requireOrdered(config, issues, 'formThresholds.TORSO_LEAN_WARN', 'formThresholds.TORSO_LEAN_FAIL');
  requireOrdered(config, issues, 'formThresholds.TORSO_LEAN_DELTA_WARN', 'formThresholds.TORSO_LEAN_DELTA_FAIL');
  requireOrdered(config, issues, 'formThresholds.SIDE_VIEW_WIDTH_WARN', 'formThresholds.SIDE_VIEW_WIDTH_FAIL');
  requireOrdered(config, issues, 'formThresholds.FRONT_VIEW_MAX', 'formThresholds.OBLIQUE_VIEW_MAX');
  requireOrdered(config, issues, 'formThresholds.KNEE_VALGUS_WARN', 'formThresholds.KNEE_VALGUS_FAIL');

  const lockoutDelta = configNumber(config, 'formThresholds.LOCKOUT_BASELINE_DELTA_FAIL', issues);
  if (lockoutDelta !== null && (lockoutDelta <= 0 || lockoutDelta >= 0.15)) {
    issues.push('Squat config "formThresholds.LOCKOUT_BASELINE_DELTA_FAIL" must be greater than 0 and less than 0.15.');
  }

  const heelSupport = configNumber(config, 'formThresholds.HEEL_LIFT_MIN_SUPPORT', issues);
  if (heelSupport !== null && (heelSupport < 0 || heelSupport > 1)) {
    issues.push('Squat config "formThresholds.HEEL_LIFT_MIN_SUPPORT" must be between 0 and 1.');
  }
  const heelEligibleSupport = configNumber(config, 'formThresholds.HEEL_LIFT_MIN_ELIGIBLE_SUPPORT', issues);
  if (heelEligibleSupport !== null && (heelEligibleSupport < 0 || heelEligibleSupport > 1)) {
    issues.push('Squat config "formThresholds.HEEL_LIFT_MIN_ELIGIBLE_SUPPORT" must be between 0 and 1.');
  }
  for (const path of ['formThresholds.SIDE_VIEW_WIDTH_WARN', 'formThresholds.SIDE_VIEW_WIDTH_FAIL']) {
    const value = configNumber(config, path, issues);
    if (value !== null && value <= 0) {
      issues.push(`Squat config "${path}" must be greater than 0.`);
    }
  }
  for (const path of [
    'formThresholds.VIEW_CONFIDENCE_MIN',
    'formThresholds.METRIC_CONFIDENCE_MIN',
    'formThresholds.BASELINE_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_MIN_SUPPORT',
    'formThresholds.FRONT_VIEW_MIN_SUPPORT',
    'formThresholds.OBLIQUE_VIEW_MIN_SUPPORT',
    'formThresholds.WORLD_KNEE_RATIO_MIN_SUPPORT',
    'formThresholds.KNEE_TRACKING_CONFIDENCE_MIN',
    'formThresholds.KNEE_VALGUS_MIN_SUPPORT',
    'formThresholds.KNEE_VALGUS_MIN_ELIGIBLE_SUPPORT',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value < 0 || value > 1)) {
      issues.push(`Squat config "${path}" must be between 0 and 1.`);
    }
  }
  for (const path of [
    'formThresholds.FRONT_VIEW_MAX',
    'formThresholds.OBLIQUE_VIEW_MAX',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 90)) {
      issues.push(`Squat config "${path}" must be greater than 0 and at most 90.`);
    }
  }
  const viewSamples = configNumber(config, 'formThresholds.VIEW_MIN_SAMPLES', issues);
  if (viewSamples !== null && (!Number.isInteger(viewSamples) || viewSamples <= 0)) {
    issues.push('Squat config "formThresholds.VIEW_MIN_SAMPLES" must be a positive integer.');
  }
  for (const path of ['formThresholds.KNEE_VALGUS_WARN', 'formThresholds.KNEE_VALGUS_FAIL']) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 1)) {
      issues.push(`Squat config "${path}" must be greater than 0 and at most 1.`);
    }
  }

  validateScoreCurves(config, issues);

  return issues;
}

export function createSquatDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_SQUAT_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
    name: 'Barbell Squat',
    requiredView: 'any',

    createState: (): ExerciseState => ({
      repCount: 0,
      lastRepResult: null,
      feedback: null,
      feedbackTimestamp: null,
      debugInfo: {},
      repQualityWindowActive: false,
      liveQualityWarnings: [],
      liveAnalysisStatus: null,
      _internal: withSquatConfig(config, () => initializeSquatState()),
    }),

    update: (keypoints: Keypoint[], state: ExerciseState, frameContext?: ExerciseFrameContext): ExerciseState => {
      const internal = state._internal as SquatState;
      const newInternal = withSquatConfig(config, () => updateSquatState(keypoints, internal, frameContext));

      const lastRepResult: FrameworkRepResult | null = newInternal.lastRepResult
        ? {
            repIndex: newInternal.lastRepResult.repIndex,
            score: newInternal.lastRepResult.score,
            messages: newInternal.lastRepResult.messages,
            scorable: newInternal.lastRepResult.scorable,
            qualityWarnings: newInternal.lastRepResult.qualityWarnings,
            diagnostics: newInternal.lastRepResult.diagnostics,
          }
        : null;
      const completedNewRep = newInternal.repCount > state.repCount;
      const updateLiveCameraAnalysis = completedNewRep || frameContext?.cameraAnalysisStatusRequested !== false;
      const liveQualityWarnings = newInternal.repWindow
        ? squatQualityWarnings(analyzeSquatRep(newInternal.repWindow))
        : completedNewRep
          ? (lastRepResult?.qualityWarnings ?? [])
          : [];
      const liveAnalysisStatus = updateLiveCameraAnalysis
        ? newInternal.repWindow
          ? squatRepWindowAnalysisStatus(newInternal.repWindow, newInternal.visibleSide)
          : completedNewRep
            ? squatCompletedRepAnalysisStatus(lastRepResult)
            : null
        : (state.liveAnalysisStatus ?? null);

      return {
        repCount: newInternal.repCount,
        lastRepResult,
        feedback: newInternal.feedback,
        feedbackTimestamp: newInternal.lastFeedbackTime > 0 ? newInternal.lastFeedbackTime : null,
        debugInfo: getSquatDebugInfo(newInternal) as unknown as Record<string, unknown>,
        repQualityWindowActive: newInternal.repWindow !== null,
        liveQualityWarnings,
        liveAnalysisStatus,
        _internal: newInternal,
      };
    },

    heuristicConfig: config,
    tunableSpec: SQUAT_TUNABLE_SPEC,
    tunedConfigPath: 'src/utils/exercises/definitions/tuned/squat.json',
    createVariant: (variantConfig) =>
      createSquatDefinition(mergeHeuristicConfig(config, variantConfig)),
    validateHeuristicConfig: validateSquatHeuristicConfig,

    ttsConfig: {
      feedbackToIssue: {
        [SQUAT_FEEDBACK.DEPTH_FAIL]: 'depth_short',
        [SQUAT_FEEDBACK.DEPTH_WARN]: 'depth_short',
        [SQUAT_FEEDBACK.LOCKOUT]: 'lockout_short',
        [SQUAT_FEEDBACK.ROM]: 'incomplete_rom',
        [SQUAT_FEEDBACK.TORSO_FAIL]: 'torso_fail',
        [SQUAT_FEEDBACK.TORSO_WARN]: 'torso_warn',
        [SQUAT_FEEDBACK.HEEL_LIFT]: 'heel_lift',
        [SQUAT_FEEDBACK.TEMPO_UP]: 'tempo_up',
        [SQUAT_FEEDBACK.TEMPO_DOWN]: 'tempo_down',
      },
      feedbackMessages: {
        [SQUAT_FEEDBACK.DEPTH_FAIL]: [
          'Squat deeper.',
          'Aim for parallel.',
          'Drop a little lower with control.',
        ],
        [SQUAT_FEEDBACK.DEPTH_WARN]: [
          'A little more depth.',
          "You're close. Sink a touch deeper.",
          'Find full depth next rep.',
        ],
        [SQUAT_FEEDBACK.LOCKOUT]: [
          'Stand all the way up.',
          'Finish tall at the top.',
          'Finish with your knees straight.',
        ],
        [SQUAT_FEEDBACK.HEEL_LIFT]: [
          'Keep your heels planted.',
          'Drive through your mid-foot.',
          'Keep pressure through your whole foot.',
        ],
        [SQUAT_FEEDBACK.TORSO_FAIL]: [
          'Chest up.',
          'Too much forward lean. Stay tall.',
          'Brace and keep your chest up.',
        ],
        [SQUAT_FEEDBACK.TORSO_WARN]: [
          'Stay more upright.',
          'Brace your core and keep your chest up.',
          'Keep your torso tall.',
        ],
        [SQUAT_FEEDBACK.TEMPO_UP]: [
          'Drive up with control.',
          "Don't bounce out of the bottom.",
          'Smooth ascent, stay braced.',
        ],
        [SQUAT_FEEDBACK.TEMPO_DOWN]: [
          'Control it on the way down.',
          'Slow the descent.',
          "Don't drop into the squat.",
        ],
      },
      issueDefinitions: [
        {
          issueType: 'heel_lift',
          priority: 20,
          messages: [
            'Keep your heels planted.',
            'Drive through your mid-foot.',
            'Keep pressure through your whole foot.',
          ],
        },
      ],
    },

    summaryConfig: {
      [SQUAT_FEEDBACK.DEPTH_FAIL]:
        'Focus on hip mobility and ankle flexibility to achieve parallel depth. Try box squats to build confidence at depth.',
      [SQUAT_FEEDBACK.DEPTH_WARN]:
        'You\'re close to parallel \u2014 work on ankle mobility and try paused squats to build strength at the bottom.',
      [SQUAT_FEEDBACK.LOCKOUT]:
        'Fully lock out at the top of each rep to complete the range of motion.',
      [SQUAT_FEEDBACK.ROM]:
        'Achieve complete range of motion from standing to at least parallel.',
      [SQUAT_FEEDBACK.HEEL_LIFT]:
        'Keep your heels planted and push through your mid-foot to maintain balance and consistent force through the rep.',
      [SQUAT_FEEDBACK.TORSO_FAIL]:
        'Excessive forward lean shifts load to your lower back. Strengthen your upper back and core, and check ankle mobility.',
      [SQUAT_FEEDBACK.TORSO_WARN]:
        'Take a deep breath and brace your core before each rep. Think about driving your chest up as you ascend.',
      [SQUAT_FEEDBACK.TEMPO_UP]:
        'Drive up with control \u2014 bouncing at the bottom puts extra stress on your knees.',
      [SQUAT_FEEDBACK.TEMPO_DOWN]:
        'Aim for a 2-3 second descent. Controlled eccentrics build more strength and protect your joints.',
    },
  };
}

export const squatDefinition: ExerciseDefinition = createSquatDefinition();
