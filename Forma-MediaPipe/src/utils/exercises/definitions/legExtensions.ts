/**
 * Leg Extensions -- Exercise Definition
 *
 * Side view, knee reach ratio as primary driver.
 * FSM: REST -> EXTENDING -> EXTENDED -> RETURNING -> REST
 * Legs start bent (ratio ~0.55-0.65), extend to near-full extension (ratio ~0.93-1.0),
 * then return. One rep = full extension + controlled return.
 *
 * Ratio = dist2D(hip,ankle) / (dist2D(hip,knee) + dist2D(knee,ankle))
 * High ratio = leg extended (straight). Low ratio = leg bent.
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
  calculateVerticalAngle,
  getKeypoint,
  isVisible,
  minKeypointConfidence,
} from '../../poseAnalysis';

import { SmoothedAngleTracker } from '../shared/SmoothedAngleTracker';
import { WarmupGate } from '../shared/WarmupGate';
import { computePenaltyPoints, computeScoreFromPenaltyPoints, type PenaltyConfig } from '../shared/scoring';
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
  diagnosticLabelMetric,
  diagnosticMetric,
} from '../shared/diagnostics';
import { createPoseStateReliabilityAggregator } from '../../pose/buildPoseState';
import {
  interpretPoseStateReliabilitySummary,
  type RepReliabilityInterpretation,
} from '../shared/reliabilityInterpretation';
import tunedConfig from './tuned/legExtensions.json';
import type { PoseStateReliabilitySummary } from '../../pose/PoseState';

import type {
  ExerciseDefinition,
  ExerciseFrameContext,
  ExerciseHeuristicConfig,
  ExerciseState,
  NumericTunable,
  RepViewQualityDiagnostic,
  RepResult as FrameworkRepResult,
} from '../types';

// ============================================================================
// MODULE-PRIVATE HELPERS
// ============================================================================

type Point2D = { x: number; y: number };
type LandmarkSourceName = 'image' | 'world' | 'fallback';

interface MetricSample {
  value: number;
  confidence: number;
  keypoints: Keypoint[];
  source: LandmarkSourceName;
}

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

/** Euclidean distance between two 2D points. */
function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function finiteMetric(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sortedFinite(values: number[]): number[] {
  return values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function median(values: number[]): number | null {
  const sorted = sortedFinite(values);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function robustHigh(values: number[]): number | null {
  const sorted = sortedFinite(values);
  if (sorted.length === 0) return null;
  if (sorted.length < THRESHOLDS.ROBUST_EXTREMA_MIN_SAMPLES) return sorted[sorted.length - 1];
  const index = Math.max(0, Math.floor((sorted.length - 1) * 0.9));
  return sorted[index];
}

function robustLow(values: number[]): number | null {
  const sorted = sortedFinite(values);
  if (sorted.length === 0) return null;
  if (sorted.length < THRESHOLDS.ROBUST_EXTREMA_MIN_SAMPLES) return sorted[0];
  const index = Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * 0.1));
  return sorted[index];
}

function pushRolling(values: number[], value: number | null | undefined, maxLength: number): void {
  if (!finiteMetric(value)) return;
  values.push(value);
  while (values.length > maxLength) values.shift();
}

/**
 * Compute normalized knee reach ratio.
 * ratio = dist2D(hip,ankle) / (dist2D(hip,knee) + dist2D(knee,ankle))
 *
 * ~0.55-0.65 = leg bent (seated start position)
 * ~0.93-1.0  = leg nearly straight (full extension)
 */
function computeReachRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): number | null {
  const hipKp = getKeypoint(keypoints, `${side}_hip`);
  const kneeKp = getKeypoint(keypoints, `${side}_knee`);
  const ankleKp = getKeypoint(keypoints, `${side}_ankle`);

  if (
    !hipKp || !kneeKp || !ankleKp ||
    !isVisible(hipKp, VISIBILITY_THRESHOLD) ||
    !isVisible(kneeKp, VISIBILITY_THRESHOLD) ||
    !isVisible(ankleKp, VISIBILITY_THRESHOLD)
  ) {
    return null;
  }

  const hip = getPoint(hipKp)!;
  const knee = getPoint(kneeKp)!;
  const ankle = getPoint(ankleKp)!;

  const segmentSum = dist2D(hip, knee) + dist2D(knee, ankle);
  if (segmentSum < 1e-6) return null;

  return dist2D(hip, ankle) / segmentSum;
}

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (reach ratio) -- knee reach ratio */
const THRESHOLDS = {
  /** Ratio above which the extension clock starts before the FSM commits */
  EXTEND_CLOCK_START: 0.56,
  /** Ratio above which we transition REST -> EXTENDING */
  EXTENDING_ENTER: 0.60,
  /** Ratio above which we consider near-full extension (EXTENDING -> EXTENDED) */
  EXTENDED_ENTER: 0.72,
  /** Ratio below which we leave EXTENDED (hysteresis) (EXTENDED -> RETURNING) */
  EXTENDED_EXIT: 0.63,
  /** Ratio below which the return is complete (RETURNING -> REST) */
  REST_REENTER: 0.58,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
  /** Minimum ratio ROM for a returned partial rep to count */
  MIN_PARTIAL_ROM: 0.13,
  /** Minimum knee-angle ROM for a returned partial rep to count when knee angles are available */
  MIN_PARTIAL_KNEE_ROM: 18,
  /** Minimum samples before robust extrema replace raw extrema */
  ROBUST_EXTREMA_MIN_SAMPLES: 3,
  /** Sustained lockout duration required before true lockout is confirmed */
  LOCKOUT_CONFIRM_MS: 80,
  /** Sustained non-lockout duration required before return timing starts */
  RETURN_CONFIRM_MS: 80,
  /** Rolling REST samples retained for baseline capture */
  BASELINE_WINDOW_FRAMES: 15,
  /** Minimum REST samples needed before baseline uses REST instead of first in-rep sample */
  BASELINE_MIN_SAMPLES: 5,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Max ratio below which extension is insufficient */
  EXTENSION_FAIL: 0.93,
  /** Min ratio above which starting flexion is insufficient */
  FLEXION_FAIL: 0.65,
  /** Max knee angle below which top extension is insufficient */
  KNEE_EXTENSION_FAIL: 160,
  /** Ideal lockout angle for conservative knee-angle score support */
  KNEE_EXTENSION_IDEAL: 170,
  /** Min knee angle above which bottom flexion is insufficient */
  KNEE_FLEXION_FAIL: 105,
  /** Torso movement from baseline above which there is excessive lean */
  TORSO_LEAN_WARN: 30,
  /** Hip angle change that indicates lifting hips off the seat */
  HIP_LIFT_WARN: 7,
  /** Normalized upward hip movement that indicates lifting off the seat */
  HIP_RISE_RATIO_WARN: 0.04,
  /** Minimum lockout pause before returning (seconds) */
  TOP_HOLD_MIN: 0.12,
  /** Near-peak ratio band for top-hold detection */
  TOP_HOLD_RATIO_BAND: 0.015,
  /** Near-peak knee-angle band for top-hold detection */
  TOP_HOLD_KNEE_BAND: 4,
  /** Maximum near-peak ratio velocity considered a stable hold */
  TOP_HOLD_MAX_RATIO_VELOCITY: 0.18,
  /** Maximum near-peak knee velocity considered a stable hold */
  TOP_HOLD_MAX_KNEE_VELOCITY: 60,
  /** Average side-view confidence below which the rep is marked unscorable */
  SIDE_VIEW_AVG_CONFIDENCE_MIN: 0.45,
  /** Minimum side-view confidence below which the rep is marked unscorable */
  SIDE_VIEW_MIN_CONFIDENCE_MIN: 0.25,
  /** Minimum side-view samples required before view quality can mark a rep unscorable */
  SIDE_VIEW_MIN_SAMPLES: 5,
  /** Concentric (extend) too fast threshold (seconds) */
  TEMPO_EXTEND_MIN: 0.35,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.55,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category             | Cap | Deadzone        | Scale | Key Input                             |
 * |----------------------|-----|-----------------|-------|---------------------------------------|
 * | ROM extension        | 45  | 0 (shortfall)   | 800   | ideal ratio (0.97) - maxRatio         |
 * | ROM flexion          | 20  | 0.10            | 400   | minRatio - ideal start ratio (0.58)   |
 * | Knee extension ROM   | 8   | 0               | 0.03  | ideal knee angle - max knee angle     |
 * | Knee flexion ROM     | 6   | 0               | 0.02  | min knee angle - bottom target        |
 * | Torso lean           | 25  | 25              | 0.04  | max torso movement from baseline      |
 * | Hip lift             | 30  | 5               | 0.15  | max hip angle delta from baseline     |
 * | Hip rise             | 10  | 0.03            | 3500  | normalized upward hip movement        |
 * | Top hold             | 4   | 0s              | 120   | top-hold time deficit                 |
 * | Tempo extend         | 8   | 0               | 60    | concentric time deficit               |
 * | Tempo return         | 10  | 0               | 40    | eccentric time deficit                |
 *
 * Ratio+knee ROM and hip-angle+hip-rise support metrics are grouped when
 * scoring so one visible issue does not stack duplicate penalties.
 */
const PENALTY_CONFIGS = {
  EXTENSION_ROM: { cap: 45, deadzone: 0, scale: 800 } as PenaltyConfig,
  FLEXION_ROM:   { cap: 20, deadzone: 0.10, scale: 400 } as PenaltyConfig,
  KNEE_EXTENSION_ROM: { cap: 8, deadzone: 0, scale: 0.03 } as PenaltyConfig,
  KNEE_FLEXION_ROM:   { cap: 6, deadzone: 0, scale: 0.02 } as PenaltyConfig,
  TORSO_LEAN:    { cap: 25, deadzone: 25, scale: 0.04 } as PenaltyConfig,
  HIP_LIFT:      { cap: 30, deadzone: 5, scale: 0.15 } as PenaltyConfig,
  HIP_RISE:      { cap: 10, deadzone: 0.03, scale: 3500 } as PenaltyConfig,
  TOP_HOLD:      { cap: 4, deadzone: 0, scale: 120 } as PenaltyConfig,
  TEMPO_EXTEND:  { cap: 8, deadzone: 0, scale: 60 } as PenaltyConfig,
  TEMPO_RETURN:  { cap: 10, deadzone: 0, scale: 40 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;
const FORM_CONFIDENCE_MIN = 0.3;
const KNEE_FLEXION_IDEAL = 95;

const DEFAULT_LEG_EXTENSIONS_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_LEG_EXTENSIONS_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_LEG_EXTENSIONS_HEURISTIC_CONFIG,
  tunedConfig,
);

const LEG_EXTENSIONS_TUNABLE_SPEC = createDefaultTunableSpec(
  'Leg Extensions',
  DEFAULT_LEG_EXTENSIONS_HEURISTIC_CONFIG,
);

function upsertLegExtensionTunable(tunable: NumericTunable): void {
  const index = LEG_EXTENSIONS_TUNABLE_SPEC.tunables.findIndex(existing => existing.path === tunable.path);
  if (index >= 0) {
    LEG_EXTENSIONS_TUNABLE_SPEC.tunables[index] = tunable;
  } else {
    LEG_EXTENSIONS_TUNABLE_SPEC.tunables.push(tunable);
  }
}

([
  { path: 'formThresholds.TEMPO_EXTEND_MIN', min: 0.1, max: 1.2, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.TEMPO_RETURN_MIN', min: 0.1, max: 1.5, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.TOP_HOLD_MIN', min: 0.02, max: 0.5, step: 0.02, kind: 'feedback' },
  { path: 'formThresholds.HIP_RISE_RATIO_WARN', min: 0.01, max: 0.12, step: 0.01, kind: 'feedback' },
  { path: 'formThresholds.TOP_HOLD_RATIO_BAND', min: 0.005, max: 0.05, step: 0.005, kind: 'feedback' },
  { path: 'formThresholds.TOP_HOLD_KNEE_BAND', min: 1, max: 10, step: 1, kind: 'feedback' },
  { path: 'formThresholds.TOP_HOLD_MAX_RATIO_VELOCITY', min: 0.05, max: 0.6, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.TOP_HOLD_MAX_KNEE_VELOCITY', min: 20, max: 160, step: 10, kind: 'feedback' },
  { path: 'formThresholds.KNEE_EXTENSION_FAIL', min: 140, max: 175, step: 1, kind: 'feedback' },
  { path: 'formThresholds.KNEE_EXTENSION_IDEAL', min: 150, max: 180, step: 1, kind: 'scoring' },
  { path: 'formThresholds.KNEE_FLEXION_FAIL', min: 80, max: 130, step: 1, kind: 'feedback' },
  { path: 'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN', min: 0.2, max: 0.75, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', min: 0.1, max: 0.5, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.SIDE_VIEW_MIN_SAMPLES', min: 3, max: 12, step: 1, kind: 'feedback' },
  { path: 'thresholds.MIN_PARTIAL_KNEE_ROM', min: 8, max: 45, step: 1, kind: 'fsm' },
  { path: 'thresholds.ROBUST_EXTREMA_MIN_SAMPLES', min: 2, max: 6, step: 1, kind: 'fsm' },
  { path: 'thresholds.LOCKOUT_CONFIRM_MS', min: 30, max: 200, step: 10, kind: 'fsm' },
  { path: 'thresholds.RETURN_CONFIRM_MS', min: 30, max: 200, step: 10, kind: 'fsm' },
  { path: 'thresholds.BASELINE_MIN_SAMPLES', min: 1, max: 12, step: 1, kind: 'fsm' },
  { path: 'penaltyConfigs.KNEE_EXTENSION_ROM.cap', min: 0, max: 15, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.KNEE_EXTENSION_ROM.scale', min: 0.005, max: 0.08, step: 0.005, kind: 'scoring' },
  { path: 'penaltyConfigs.KNEE_FLEXION_ROM.cap', min: 0, max: 12, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.HIP_RISE.cap', min: 0, max: 18, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.HIP_RISE.deadzone', min: 0, max: 0.08, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.TOP_HOLD.cap', min: 0, max: 8, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TOP_HOLD.scale', min: 20, max: 220, step: 10, kind: 'scoring' },
] satisfies NumericTunable[]).forEach(upsertLegExtensionTunable);

LEG_EXTENSIONS_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'leg-extensions.lockout_short', metricKey: 'extensionRatio', thresholdPath: 'formThresholds.EXTENSION_FAIL', direction: 'below' },
  { issueId: 'leg-extensions.lockout_short', metricKey: 'kneeExtensionAngle', thresholdPath: 'formThresholds.KNEE_EXTENSION_FAIL', direction: 'below' },
  { issueId: 'leg-extensions.rom_short_leg_ext', metricKey: 'flexionRatio', thresholdPath: 'formThresholds.FLEXION_FAIL', direction: 'above' },
  { issueId: 'leg-extensions.rom_short_leg_ext', metricKey: 'kneeFlexionAngle', thresholdPath: 'formThresholds.KNEE_FLEXION_FAIL', direction: 'above' },
  { issueId: 'leg-extensions.torso_warn', metricKey: 'torsoDeviation', thresholdPath: 'formThresholds.TORSO_LEAN_WARN', direction: 'above' },
  { issueId: 'leg-extensions.hip_lift', metricKey: 'hipDelta', thresholdPath: 'formThresholds.HIP_LIFT_WARN', direction: 'above' },
  { issueId: 'leg-extensions.hip_lift', metricKey: 'hipRiseRatio', thresholdPath: 'formThresholds.HIP_RISE_RATIO_WARN', direction: 'above' },
  { issueId: 'leg-extensions.tempo_up', metricKey: 'tExtend', thresholdPath: 'formThresholds.TEMPO_EXTEND_MIN', direction: 'below' },
  { issueId: 'leg-extensions.tempo_down', metricKey: 'tReturn', thresholdPath: 'formThresholds.TEMPO_RETURN_MIN', direction: 'below' },
  { issueId: 'leg-extensions.top_hold_short', metricKey: 'topHoldSeconds', thresholdPath: 'formThresholds.TOP_HOLD_MIN', direction: 'below' },
];

const LEG_EXTENSION_ISSUE_CUE_FAMILIES: Record<string, string[]> = {
  'leg-extensions.lockout_short': ['distalEndpoint', 'rangeOfMotion', 'lockout', 'kneeExtension', 'visibleLegPath'],
  'leg-extensions.rom_short_leg_ext': ['distalEndpoint', 'rangeOfMotion', 'kneeExtension', 'visibleLegPath'],
  'leg-extensions.torso_warn': ['torsoSetup'],
  'leg-extensions.hip_lift': ['torsoSetup'],
  'leg-extensions.top_hold_short': ['distalEndpoint', 'lockout', 'rangeOfMotion'],
  'leg-extensions.tempo_up': ['tempo'],
  'leg-extensions.tempo_down': ['tempo'],
};

const LEG_EXTENSION_MESSAGE_CUE_FAMILIES: Record<string, string[]> = {
  'Extend fully \u2014 straighten your legs completely at the top.': ['distalEndpoint', 'rangeOfMotion', 'lockout', 'kneeExtension', 'visibleLegPath'],
  'Lower the weight more \u2014 start from a deeper bend.': ['distalEndpoint', 'rangeOfMotion', 'kneeExtension', 'visibleLegPath'],
  'Keep your back against the pad \u2014 avoid leaning forward.': ['torsoSetup'],
  "Keep your hips on the seat \u2014 don't lift off the pad.": ['torsoSetup'],
  'Pause briefly at full extension.': ['distalEndpoint', 'lockout', 'rangeOfMotion'],
  'Slow down the extension \u2014 control the lift.': ['tempo'],
  "Control the return \u2014 don't let the weight drop.": ['tempo'],
};

const LEG_EXTENSION_SELECTED_LEG_CUE_FAMILIES = [
  'repCount',
  'tempo',
  'visibleLegPath',
  'kneeExtension',
  'rangeOfMotion',
  'lockout',
  'distalEndpoint',
] as const;

const LEG_EXTENSION_RELIABILITY_JOINTS = [
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

const LEG_EXTENSIONS_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withLegExtensionsConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, LEG_EXTENSIONS_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LegExtensionPhase = 'REST' | 'EXTENDING' | 'EXTENDED' | 'RETURNING';
type LegExtensionBaselineSource = 'rest' | 'rep_start';

interface BaselineSamples {
  torsoDev: number[];
  hipAngle: number[];
  hipY: number[];
}

interface RepFrameSample {
  t: number;
  ratio: number;
  kneeAngle: number | null;
}

interface LegExtensionFSM {
  phase: LegExtensionPhase;
  /** Timestamp when extension began (REST -> EXTENDING) */
  tRepStart: number | null;
  /** Timestamp when the user first moved out of the bent start position */
  tExtendStart: number | null;
  /** Timestamp when full extension was reached */
  tExtended: number | null;
  /** Timestamp when rep completed (RETURNING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min ratio during rep (should be low -- bent position at start/end) */
  minRatio: number;
  /** Max ratio during rep (should be high -- extended) */
  maxRatio: number;
  rawMinRatio: number;
  rawMaxRatio: number;
  ratioSamples: number[];
  /** Min knee angle during rep (should be low -- bent position) */
  minKneeAngle: number;
  /** Max knee angle during rep (should be high -- extended) */
  maxKneeAngle: number;
  rawMinKneeAngle: number;
  rawMaxKneeAngle: number;
  kneeAngleSamples: number[];
  kneeAngleSampleCount: number;
  kneeAngleConfidenceSum: number;
  /** Hip angle at rep start (baseline) */
  hipAngleBaseline: number | null;
  hipBaselineSource: LegExtensionBaselineSource | null;
  /** Max absolute hip angle delta from baseline during rep */
  maxHipDelta: number;
  rawMaxHipDelta: number;
  hipDeltaSamples: number[];
  hipYBaseline: number | null;
  maxHipRiseRatio: number;
  rawMaxHipRiseRatio: number;
  hipRiseRatioSamples: number[];
  hipRiseSampleCount: number;
  /** Torso angle baseline at rep start */
  torsoDevBaseline: number | null;
  torsoBaselineSource: LegExtensionBaselineSource | null;
  baselineSampleCount: number;
  /** Max torso movement from baseline during rep */
  maxTorsoDev: number;
  rawMaxTorsoDev: number;
  torsoDevSamples: number[];
  /** Max absolute torso deviation from vertical during rep (diagnostic only) */
  maxTorsoAbsDev: number;
  torsoSampleCount: number;
  torsoConfidenceSum: number;
  /** Timestamps */
  tStart: number;
  /** FSM extension timestamp (early top phase for counting stability) */
  tExtended: number | null;
  /** True lockout timestamp used for tempo and top-hold cues */
  tLockout: number | null;
  tReturnStart: number | null;
  topHoldMs: number | null;
  lockoutStreakCount: number;
  lockoutStreakStart: number | null;
  returnStreakCount: number;
  returnStreakStart: number | null;
  sideViewConfidenceSamples: number;
  sideViewConfidenceSum: number;
  sideViewConfidenceMin: number;
  selectedSideSamples: number;
  tEnd: number;
  /** Runtime PoseState reliability observed during this active rep. */
  reliability: ReturnType<typeof createPoseStateReliabilityAggregator>;
  /** Frame count */
  frameCount: number;
  frameSamples: RepFrameSample[];
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
  scorable?: boolean;
  qualityWarnings?: FrameworkRepResult['qualityWarnings'];
  diagnostics?: FrameworkRepResult['diagnostics'];
}

interface LegExtensionState {
  fsm: LegExtensionFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  /** Smoothed trackers */
  ratioTracker: SmoothedAngleTracker;
  hipTracker: SmoothedAngleTracker;
  torsoTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Current smoothed values for debug */
  smoothedRatio: number | null;
  /** Median-only ratio used for responsive FSM transitions */
  fastRatio: number | null;
  currentKneeAngle: number | null;
  currentHipRiseRatio: number | null;
  smoothedHip: number | null;
  smoothedTorso: number | null;
  /** Feedback */
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
  /** Minimum smoothed ratio observed in REST before the current rep starts */
  restMinRatio: number;
  /** True once we have observed a bent/rest setup after state creation */
  hasSeenBentRest: boolean;
  preWindowLockoutStreakCount: number;
  preWindowLockoutStreakStart: number | null;
  baselineSamples: Record<'left' | 'right', BaselineSamples>;
}

interface LegExtensionDebugInfo {
  phase: LegExtensionPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  ratio: number | null;
  fastRatio: number | null;
  kneeAngle: number | null;
  hipAngle: number | null;
  hipRiseRatio: number | null;
  torsoDev: number | null;
  // Rep window
  ratioMin: number | null;
  ratioMax: number | null;
  kneeAngleMin: number | null;
  kneeAngleMax: number | null;
  hipDelta: number | null;
  hipRiseMax: number | null;
  torsoDevMax: number | null;
  topHoldMs: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): LegExtensionFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tExtendStart: null,
    tExtended: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number, initialRatio?: number): RepWindow {
  const hasInitialRatio = finiteMetric(initialRatio);
  return {
    minRatio: hasInitialRatio ? initialRatio : Infinity,
    maxRatio: hasInitialRatio ? initialRatio : -Infinity,
    rawMinRatio: hasInitialRatio ? initialRatio : Infinity,
    rawMaxRatio: hasInitialRatio ? initialRatio : -Infinity,
    ratioSamples: hasInitialRatio ? [initialRatio] : [],
    minKneeAngle: Infinity,
    maxKneeAngle: -Infinity,
    rawMinKneeAngle: Infinity,
    rawMaxKneeAngle: -Infinity,
    kneeAngleSamples: [],
    kneeAngleSampleCount: 0,
    kneeAngleConfidenceSum: 0,
    hipAngleBaseline: null,
    hipBaselineSource: null,
    maxHipDelta: 0,
    rawMaxHipDelta: 0,
    hipDeltaSamples: [],
    hipYBaseline: null,
    maxHipRiseRatio: 0,
    rawMaxHipRiseRatio: 0,
    hipRiseRatioSamples: [],
    hipRiseSampleCount: 0,
    torsoDevBaseline: null,
    torsoBaselineSource: null,
    baselineSampleCount: 0,
    maxTorsoDev: 0,
    rawMaxTorsoDev: 0,
    torsoDevSamples: [],
    maxTorsoAbsDev: -Infinity,
    torsoSampleCount: 0,
    torsoConfidenceSum: 0,
    tStart,
    tExtended: null,
    tLockout: null,
    tReturnStart: null,
    topHoldMs: null,
    lockoutStreakCount: 0,
    lockoutStreakStart: null,
    returnStreakCount: 0,
    returnStreakStart: null,
    sideViewConfidenceSamples: 0,
    sideViewConfidenceSum: 0,
    sideViewConfidenceMin: Infinity,
    selectedSideSamples: 0,
    tEnd: tStart,
    reliability: createPoseStateReliabilityAggregator(),
    frameCount: 0,
    frameSamples: [],
  };
}

function createLegExtensionWarmupGate(): WarmupGate {
  return new WarmupGate({
    requiredJoints: [
      'left_hip', 'left_knee', 'left_ankle',
      'right_hip', 'right_knee', 'right_ankle',
      'left_shoulder', 'right_shoulder',
    ],
    requiredFrames: 10,
    visibilityThreshold: 0.2,
  });
}

function resetBaselineSamples(): Record<'left' | 'right', BaselineSamples> {
  return {
    left: { torsoDev: [], hipAngle: [], hipY: [] },
    right: { torsoDev: [], hipAngle: [], hipY: [] },
  };
}

function resetLegExtensionAfterTrackingInterruption(
  currentState: LegExtensionState,
): LegExtensionState {
  return {
    ...currentState,
    fsm: initFSM(),
    repWindow: null,
    ratioTracker: new SmoothedAngleTracker({ medianWindow: 3, emaAlpha: 0.5 }),
    hipTracker: new SmoothedAngleTracker(),
    torsoTracker: new SmoothedAngleTracker(),
    warmupGate: createLegExtensionWarmupGate(),
    warmedUp: false,
    smoothedRatio: null,
    fastRatio: null,
    currentKneeAngle: null,
    currentHipRiseRatio: null,
    smoothedHip: null,
    smoothedTorso: null,
    restMinRatio: Infinity,
    hasSeenBentRest: false,
    preWindowLockoutStreakCount: 0,
    preWindowLockoutStreakStart: null,
    baselineSamples: resetBaselineSamples(),
  };
}

function initializeLegExtensionState(): LegExtensionState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    ratioTracker: new SmoothedAngleTracker({ medianWindow: 3, emaAlpha: 0.5 }),
    hipTracker: new SmoothedAngleTracker(),
    torsoTracker: new SmoothedAngleTracker(),
    warmupGate: createLegExtensionWarmupGate(),
    warmedUp: false,
    smoothedRatio: null,
    fastRatio: null,
    currentKneeAngle: null,
    currentHipRiseRatio: null,
    smoothedHip: null,
    smoothedTorso: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
    restMinRatio: Infinity,
    hasSeenBentRest: false,
    preWindowLockoutStreakCount: 0,
    preWindowLockoutStreakStart: null,
    baselineSamples: resetBaselineSamples(),
  };
}

function recordRestBaselineSample(
  state: LegExtensionState,
  side: 'left' | 'right',
  rawTorsoDev: number | null,
  rawHipAngle: number | null,
  hipY: number | null,
): void {
  const samples = state.baselineSamples[side];
  pushRolling(samples.torsoDev, rawTorsoDev, THRESHOLDS.BASELINE_WINDOW_FRAMES);
  pushRolling(samples.hipAngle, rawHipAngle, THRESHOLDS.BASELINE_WINDOW_FRAMES);
  pushRolling(samples.hipY, hipY, THRESHOLDS.BASELINE_WINDOW_FRAMES);
}

function applyRestBaselines(window: RepWindow, samples: BaselineSamples): void {
  const torsoBaseline = samples.torsoDev.length >= THRESHOLDS.BASELINE_MIN_SAMPLES
    ? median(samples.torsoDev)
    : null;
  if (torsoBaseline !== null) {
    window.torsoDevBaseline = torsoBaseline;
    window.torsoBaselineSource = 'rest';
    window.baselineSampleCount = Math.max(window.baselineSampleCount, samples.torsoDev.length);
  }

  const hipAngleBaseline = samples.hipAngle.length >= THRESHOLDS.BASELINE_MIN_SAMPLES
    ? median(samples.hipAngle)
    : null;
  if (hipAngleBaseline !== null) {
    window.hipAngleBaseline = hipAngleBaseline;
    window.hipBaselineSource = 'rest';
    window.baselineSampleCount = Math.max(window.baselineSampleCount, samples.hipAngle.length);
  }

  const hipYBaseline = samples.hipY.length >= THRESHOLDS.BASELINE_MIN_SAMPLES
    ? median(samples.hipY)
    : null;
  if (hipYBaseline !== null) {
    window.hipYBaseline = hipYBaseline;
    window.hipBaselineSource = 'rest';
    window.baselineSampleCount = Math.max(window.baselineSampleCount, samples.hipY.length);
  }
}

function seedRatioSample(window: RepWindow, ratio: number, t: number): void {
  if (!finiteMetric(ratio)) return;
  window.rawMinRatio = Math.min(window.rawMinRatio, ratio);
  window.rawMaxRatio = Math.max(window.rawMaxRatio, ratio);
  window.ratioSamples.push(ratio);
  window.frameSamples.push({ t, ratio, kneeAngle: null });
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
// ANGLE CALCULATION (hip angle + torso deviation kept as-is)
// ============================================================================

function visibleKeypoint(
  keypoints: Keypoint[],
  name: string,
  threshold = VISIBILITY_THRESHOLD,
): Keypoint | null {
  const keypoint = getKeypoint(keypoints, name);
  return isVisible(keypoint, threshold) ? keypoint : null;
}

function landmarkSources(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
): Array<{ name: LandmarkSourceName; keypoints: Keypoint[] }> {
  const sources: Array<{ name: LandmarkSourceName; keypoints: Keypoint[] }> = [];
  const pushUnique = (name: LandmarkSourceName, keypoints: Keypoint[] | undefined) => {
    if (!keypoints || keypoints.length === 0) return;
    if (sources.some(source => source.keypoints === keypoints)) return;
    sources.push({ name, keypoints });
  };

  pushUnique('image', frameContext?.imageKeypoints);
  pushUnique('world', frameContext?.worldKeypoints);
  pushUnique('fallback', fallbackKeypoints);
  return sources;
}

function signalSourceKeypoints(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
): Keypoint[] {
  return frameContext?.imageKeypoints ?? fallbackKeypoints;
}

function calculateKneeAngle(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  const knee = visibleKeypoint(keypoints, `${side}_knee`);
  const ankle = visibleKeypoint(keypoints, `${side}_ankle`);
  if (!hip || !knee || !ankle) return null;

  const value = calculateAngle2D(
    getPoint(hip)!,
    getPoint(knee)!,
    getPoint(ankle)!,
  );
  return finiteMetric(value) && value > 0 && value <= 180 ? value : null;
}

function calculateLegChainLength(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  const knee = visibleKeypoint(keypoints, `${side}_knee`);
  const ankle = visibleKeypoint(keypoints, `${side}_ankle`);
  if (!hip || !knee || !ankle) return null;

  const length = dist2D(getPoint(hip)!, getPoint(knee)!) + dist2D(getPoint(knee)!, getPoint(ankle)!);
  return length > 1e-6 ? length : null;
}

function sideBodyLength(keypoints: Keypoint[], side: 'left' | 'right'): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`);
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  const knee = visibleKeypoint(keypoints, `${side}_knee`);
  const ankle = visibleKeypoint(keypoints, `${side}_ankle`);
  if (!shoulder || !hip || !knee || !ankle) return null;

  const length =
    dist2D(getPoint(shoulder)!, getPoint(hip)!) +
    dist2D(getPoint(hip)!, getPoint(knee)!) +
    dist2D(getPoint(knee)!, getPoint(ankle)!);
  return length > 1e-6 ? length : null;
}

function calculateSideViewConfidence(keypoints: Keypoint[]): number | null {
  const widths: number[] = [];
  for (const joint of ['shoulder', 'hip', 'knee', 'ankle']) {
    const left = visibleKeypoint(keypoints, `left_${joint}`);
    const right = visibleKeypoint(keypoints, `right_${joint}`);
    if (left && right) {
      widths.push(dist2D(getPoint(left)!, getPoint(right)!));
    }
  }
  if (widths.length < 2) return null;

  const bodyLengths = [
    sideBodyLength(keypoints, 'left'),
    sideBodyLength(keypoints, 'right'),
  ].filter(finiteMetric);
  if (bodyLengths.length === 0) return null;

  const widthRatio = average(widths) / average(bodyLengths);
  return 1 - clamp01((widthRatio - 0.08) / (0.24 - 0.08));
}

function calculateHipRiseRatio(
  currentHipY: number,
  baselineHipY: number,
  legChainLength: number | null,
): number | null {
  if (!legChainLength || legChainLength <= 1e-6) return null;
  return Math.max(0, (baselineHipY - currentHipY) / legChainLength);
}

function calculateTorsoDeviationSample(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
  side: 'left' | 'right',
): MetricSample | null {
  for (const source of landmarkSources(frameContext, fallbackKeypoints)) {
    const shoulder = visibleKeypoint(source.keypoints, `${side}_shoulder`, FORM_CONFIDENCE_MIN);
    const hip = visibleKeypoint(source.keypoints, `${side}_hip`, FORM_CONFIDENCE_MIN);
    if (!shoulder || !hip) continue;

    const value = calculateVerticalAngle(hip, shoulder);
    if (!finiteMetric(value)) continue;
    return {
      value,
      confidence: minKeypointConfidence(source.keypoints, [`${side}_shoulder`, `${side}_hip`]),
      keypoints: source.keypoints,
      source: source.name,
    };
  }
  return null;
}

/**
 * Calculate the hip angle (shoulder-hip-knee) in 2D.
 * Measures how much the torso-thigh angle deviates -- if the user lifts
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
 * Uses calculateVerticalAngle() which handles both Y-up (world landmarks)
 * and Y-down (image landmarks) coordinate systems correctly.
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

  return calculateVerticalAngle(hip, shoulder);
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
  ratio: number,
  t: number,
  allowStart: boolean,
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Waiting for extension to begin. When ratio exceeds threshold,
      // transition to EXTENDING.
      if (allowStart && ratio > THRESHOLDS.EXTEND_CLOCK_START) {
        fsm.tExtendStart ??= t;
      } else {
        fsm.tExtendStart = null;
      }

      if (allowStart && ratio > THRESHOLDS.EXTENDING_ENTER) {
        fsm.phase = 'EXTENDING';
        fsm.tRepStart = fsm.tExtendStart ?? t;
        fsm.tExtended = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'EXTENDING':
      // Actively extending. When near-full extension reached, transition.
      if (ratio > THRESHOLDS.EXTENDED_ENTER) {
        fsm.phase = 'EXTENDED';
        fsm.tExtended = t;
      } else if (ratio < THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Went back to bent without extending -- reset
        fsm.phase = 'REST';
        fsm.tRepStart = null;
        fsm.tExtendStart = null;
      }
      break;

    case 'EXTENDED':
      // At full extension. When ratio drops back (hysteresis), transition.
      if (ratio < THRESHOLDS.EXTENDED_EXIT) {
        fsm.phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      // Controlled return. When ratio returns to bent position, rep is complete.
      if (
        ratio < THRESHOLDS.REST_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'REST';
        fsm.tRepEnd = t;
        repCompleted = true;
      } else if (ratio > THRESHOLDS.EXTENDED_ENTER) {
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

function hasKneeExtensionMetric(repWindow: RepWindow): boolean {
  return repWindow.kneeAngleSampleCount > 0 && repWindow.maxKneeAngle !== -Infinity;
}

function hasKneeFlexionMetric(repWindow: RepWindow): boolean {
  return repWindow.kneeAngleSampleCount > 0 && repWindow.minKneeAngle !== Infinity;
}

function hasTorsoMetric(repWindow: RepWindow): boolean {
  return repWindow.torsoSampleCount > 0;
}

function hasHipRiseMetric(repWindow: RepWindow): boolean {
  return repWindow.hipRiseSampleCount > 0;
}

function averageSideViewConfidence(repWindow: RepWindow): number | null {
  if (repWindow.sideViewConfidenceSamples === 0) return null;
  return repWindow.sideViewConfidenceSum / repWindow.sideViewConfidenceSamples;
}

function buildLegExtensionViewQuality(repWindow: RepWindow): RepViewQualityDiagnostic {
  const averageConfidence = averageSideViewConfidence(repWindow);
  const hasEnoughSamples =
    repWindow.sideViewConfidenceSamples >= FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES &&
    averageConfidence !== null;
  const bilateralSideConfirmed = Boolean(
    hasEnoughSamples &&
    averageConfidence! >= FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN &&
    repWindow.sideViewConfidenceMin >= FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN,
  );
  const selectedSideConfirmed = repWindow.selectedSideSamples >= FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES;
  const sideConfirmed = bilateralSideConfirmed || (!hasEnoughSamples && selectedSideConfirmed);
  const frontishConfirmed = Boolean(hasEnoughSamples && !bilateralSideConfirmed);
  return {
    status: sideConfirmed
      ? 'side_confirmed'
      : frontishConfirmed
        ? 'frontish_confirmed'
        : 'view_unknown',
    sideConfirmed,
    frontishConfirmed,
    viewUnknown: !sideConfirmed && !frontishConfirmed,
    averageSideViewConfidence: averageConfidence,
    minSideViewConfidence: repWindow.sideViewConfidenceSamples > 0
      ? repWindow.sideViewConfidenceMin
      : null,
    sampleCount: hasEnoughSamples ? repWindow.sideViewConfidenceSamples : repWindow.selectedSideSamples,
  };
}

function diagnosticsViewFor(viewQuality: RepViewQualityDiagnostic): NonNullable<FrameworkRepResult['diagnostics']>['view'] {
  if (viewQuality.sideConfirmed) return 'side';
  if (viewQuality.frontishConfirmed) return 'front';
  return 'unknown';
}

function sideViewIsScorable(repWindow: RepWindow): boolean {
  return buildLegExtensionViewQuality(repWindow).sideConfirmed;
}

function legExtensionQualityWarnings(repWindow: RepWindow): FrameworkRepResult['qualityWarnings'] {
  return sideViewIsScorable(repWindow) ? [] : ['side_view_uncertain'];
}

function cueFamilyAllowed(allowedCueFamilies: ReadonlySet<string> | undefined, family: string): boolean {
  return !allowedCueFamilies || allowedCueFamilies.has(family);
}

function cueFamiliesAllowed(
  allowedCueFamilies: ReadonlySet<string> | undefined,
  families: string[],
): boolean {
  return families.every(family => cueFamilyAllowed(allowedCueFamilies, family));
}

function selectedLegChain(visibleSide: 'left' | 'right'): 'leftLeg' | 'rightLeg' {
  return visibleSide === 'left' ? 'leftLeg' : 'rightLeg';
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

function reliabilityInterpretationForRepWindow(
  repWindow: RepWindow,
  visibleSide: 'left' | 'right',
): {
  summary: PoseStateReliabilitySummary;
  interpretation: RepReliabilityInterpretation;
} | null {
  const summary = repWindow.reliability.snapshot();
  if (summary.totalFrames === 0) return null;

  const baseInterpretation = interpretPoseStateReliabilitySummary('Leg Extensions', summary);
  const selectedChain = selectedLegChain(visibleSide);
  if (baseInterpretation.usableChains.includes(selectedChain)) {
    return { summary, interpretation: baseInterpretation };
  }

  const selectedLegUnsafeFamilies = new Set<string>(LEG_EXTENSION_SELECTED_LEG_CUE_FAMILIES);
  const safeCueFamilies = baseInterpretation.safeCueFamilies.filter(
    family => !selectedLegUnsafeFamilies.has(family),
  );
  const unsafeCueFamilies = uniqueStrings([
    ...baseInterpretation.unsafeCueFamilies,
    ...LEG_EXTENSION_SELECTED_LEG_CUE_FAMILIES,
  ]);

  return {
    summary,
    interpretation: {
      ...baseInterpretation,
      countabilityCandidate:
        baseInterpretation.countabilityCandidate === 'countable'
          ? 'maybe'
          : baseInterpretation.countabilityCandidate,
      scoreabilityCandidate:
        baseInterpretation.scoreabilityCandidate === 'fullyScoreable'
          ? 'partiallyScoreable'
          : baseInterpretation.scoreabilityCandidate,
      safeCueFamilies,
      unsafeCueFamilies,
      reasons: uniqueStrings([
        ...baseInterpretation.reasons,
        `${selectedChain}_selected_chain_weak`,
        'selected_leg_cue_families_unsafe',
      ]),
    },
  };
}

function safeCueFamilySet(interpretation: RepReliabilityInterpretation | null): ReadonlySet<string> | undefined {
  return interpretation ? new Set(interpretation.safeCueFamilies) : undefined;
}

function reliabilityAllowsScoring(
  interpretation: RepReliabilityInterpretation | null,
  visibleSide: 'left' | 'right',
): boolean {
  if (!interpretation) return true;
  return (
    interpretation.scoreabilityCandidate !== 'notScoreable' &&
    interpretation.usableChains.includes(selectedLegChain(visibleSide)) &&
    interpretation.usableChains.includes('torso')
  );
}

function repScorableWithReliability(
  repWindow: RepWindow,
  interpretation: RepReliabilityInterpretation | null,
  visibleSide: 'left' | 'right',
): boolean {
  return sideViewIsScorable(repWindow) && reliabilityAllowsScoring(interpretation, visibleSide);
}

function suppressUnsafeReliabilityMessages(
  messages: string[],
  interpretation: RepReliabilityInterpretation | null,
): string[] {
  if (!interpretation) return messages;

  const unsafeFamilies = new Set(interpretation.unsafeCueFamilies);
  return messages.filter((message) => {
    const families = LEG_EXTENSION_MESSAGE_CUE_FAMILIES[message] ?? [];
    return families.every(family => !unsafeFamilies.has(family));
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
      const families = LEG_EXTENSION_ISSUE_CUE_FAMILIES[issueId] ?? [];
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

function shouldLogLegExtensionReliability(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    !(typeof process !== 'undefined' && process.env.JEST_WORKER_ID)
  );
}

function logLegExtensionRepReliability(
  repIndex: number,
  interpretation: RepReliabilityInterpretation | null,
  diagnostics: FrameworkRepResult['diagnostics'],
): void {
  if (!interpretation || !shouldLogLegExtensionReliability()) return;
  const reliability = diagnostics?.reliability;
  console.log([
    `[LegExtensionReliability] rep=${repIndex}`,
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
  return LEG_EXTENSION_RELIABILITY_JOINTS.some((jointName) => {
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

function observeLegExtensionPoseState(
  repWindow: RepWindow,
  frameContext: ExerciseFrameContext | undefined,
): void {
  const poseState = frameContext?.poseState;
  if (!poseState || !poseStateHasRichReliabilityMetadata(poseState)) return;
  repWindow.reliability.observe(poseState);
}

function isLockoutShort(repWindow: RepWindow): boolean {
  const ratioShort = repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_FAIL;
  const kneeShortOrUnavailable =
    !hasKneeExtensionMetric(repWindow) ||
    repWindow.maxKneeAngle < FORM_THRESHOLDS.KNEE_EXTENSION_FAIL;
  return ratioShort && kneeShortOrUnavailable;
}

function isFlexionShort(repWindow: RepWindow): boolean {
  const ratioShort = repWindow.minRatio > FORM_THRESHOLDS.FLEXION_FAIL;
  const kneeShortOrUnavailable =
    !hasKneeFlexionMetric(repWindow) ||
    repWindow.minKneeAngle > FORM_THRESHOLDS.KNEE_FLEXION_FAIL;
  return ratioShort && kneeShortOrUnavailable;
}

function isHipLift(repWindow: RepWindow): boolean {
  return (
    repWindow.maxHipDelta > FORM_THRESHOLDS.HIP_LIFT_WARN ||
    repWindow.maxHipRiseRatio > FORM_THRESHOLDS.HIP_RISE_RATIO_WARN
  );
}

function topHoldSeconds(repWindow: RepWindow): number | null {
  if (repWindow.topHoldMs !== null) return repWindow.topHoldMs / 1000;
  if (repWindow.tLockout === null || repWindow.tReturnStart === null) return null;
  return Math.max(0, repWindow.tReturnStart - repWindow.tLockout);
}

function topHoldMilliseconds(repWindow: RepWindow): number | null {
  const seconds = topHoldSeconds(repWindow);
  return seconds === null ? null : seconds * 1000;
}

function lockoutTempo(repWindow: RepWindow): { tExtend: number | null; tReturn: number | null } {
  if (repWindow.tLockout === null) {
    return { tExtend: null, tReturn: null };
  }
  return {
    tExtend: repWindow.tLockout - repWindow.tStart,
    tReturn: repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tLockout),
  };
}

function isTopHoldShort(repWindow: RepWindow): boolean {
  const hold = topHoldSeconds(repWindow);
  return (
    repWindow.tLockout !== null &&
    hold !== null &&
    !isLockoutShort(repWindow) &&
    hold < FORM_THRESHOLDS.TOP_HOLD_MIN
  );
}

function isMeaningfulLegExtensionPartialRep(repWindow: RepWindow, duration: number): boolean {
  if (!Number.isFinite(duration) || duration < THRESHOLDS.MIN_REP_TIME) return false;
  if (hasKneeExtensionMetric(repWindow) && hasKneeFlexionMetric(repWindow)) {
    const kneeRom = repWindow.maxKneeAngle - repWindow.minKneeAngle;
    return Number.isFinite(kneeRom) && kneeRom >= THRESHOLDS.MIN_PARTIAL_KNEE_ROM;
  }

  return isMeaningfulPartialRep({
    actualRom: repWindow.maxRatio - repWindow.minRatio,
    minRom: THRESHOLDS.MIN_PARTIAL_ROM,
    duration,
    minDuration: THRESHOLDS.MIN_REP_TIME,
  });
}

function computeLegExtensionScore(
  repWindow: RepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): number {
  const penaltyPoints: number[] = [];
  const pushPenalty = (value: number, config: PenaltyConfig) => {
    penaltyPoints.push(computePenaltyPoints(value, config));
  };

  // 1. ROM -- extension: ideal maxRatio is 0.97+. Shortfall = max(0, 0.97 - maxRatio)
  if (cueFamiliesAllowed(allowedCueFamilies, ['rangeOfMotion', 'lockout', 'kneeExtension', 'distalEndpoint'])) {
    const extensionShortfall = Math.max(0, 0.97 - repWindow.maxRatio);
    let extensionPenalty = computePenaltyPoints(extensionShortfall, PENALTY_CONFIGS.EXTENSION_ROM);
    if (hasKneeExtensionMetric(repWindow)) {
      const kneeExtensionShortfall = Math.max(0, FORM_THRESHOLDS.KNEE_EXTENSION_IDEAL - repWindow.maxKneeAngle);
      extensionPenalty = Math.max(
        extensionPenalty,
        computePenaltyPoints(kneeExtensionShortfall, PENALTY_CONFIGS.KNEE_EXTENSION_ROM),
      );
    }
    penaltyPoints.push(extensionPenalty);
  }

  // 2. ROM -- flexion: ideal minRatio is 0.58 or below. Excess = max(0, minRatio - 0.58)
  if (cueFamiliesAllowed(allowedCueFamilies, ['rangeOfMotion', 'kneeExtension', 'distalEndpoint'])) {
    const flexionExcess = Math.max(0, repWindow.minRatio - 0.58);
    let flexionPenalty = computePenaltyPoints(flexionExcess, PENALTY_CONFIGS.FLEXION_ROM);
    if (hasKneeFlexionMetric(repWindow)) {
      const kneeFlexionExcess = Math.max(0, repWindow.minKneeAngle - KNEE_FLEXION_IDEAL);
      flexionPenalty = Math.max(
        flexionPenalty,
        computePenaltyPoints(kneeFlexionExcess, PENALTY_CONFIGS.KNEE_FLEXION_ROM),
      );
    }
    penaltyPoints.push(flexionPenalty);
  }

  // 3. Torso lean
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoSetup') && hasTorsoMetric(repWindow)) {
    pushPenalty(repWindow.maxTorsoDev, PENALTY_CONFIGS.TORSO_LEAN);
  }

  // 4. Hip lift (hip angle delta from baseline)
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoSetup')) {
    let hipLiftPenalty = computePenaltyPoints(repWindow.maxHipDelta, PENALTY_CONFIGS.HIP_LIFT);
    if (hasHipRiseMetric(repWindow)) {
      hipLiftPenalty = Math.max(
        hipLiftPenalty,
        computePenaltyPoints(repWindow.maxHipRiseRatio, PENALTY_CONFIGS.HIP_RISE),
      );
    }
    penaltyPoints.push(hipLiftPenalty);
  }

  const hold = topHoldSeconds(repWindow);
  if (
    cueFamiliesAllowed(allowedCueFamilies, ['lockout', 'distalEndpoint']) &&
    hold !== null &&
    !isLockoutShort(repWindow) &&
    hold < FORM_THRESHOLDS.TOP_HOLD_MIN
  ) {
    const deficit = FORM_THRESHOLDS.TOP_HOLD_MIN - hold;
    pushPenalty(deficit, PENALTY_CONFIGS.TOP_HOLD);
  }

  // 5. Tempo
  const { tExtend, tReturn } = lockoutTempo(repWindow);
  if (cueFamilyAllowed(allowedCueFamilies, 'tempo') && tExtend !== null && tReturn !== null) {

    // Penalize if too fast using the same thresholds that drive feedback.
    if (tExtend > 0 && tExtend < FORM_THRESHOLDS.TEMPO_EXTEND_MIN) {
      const deficit = FORM_THRESHOLDS.TEMPO_EXTEND_MIN - tExtend;
      pushPenalty(deficit, PENALTY_CONFIGS.TEMPO_EXTEND);
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      const deficit = FORM_THRESHOLDS.TEMPO_RETURN_MIN - tReturn;
      pushPenalty(deficit, PENALTY_CONFIGS.TEMPO_RETURN);
    }
  }

  return computeScoreFromPenaltyPoints(penaltyPoints);
}

// ============================================================================
// FORM MESSAGES (discrete thresholds)
// ============================================================================

function generateFormMessages(
  repWindow: RepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): string[] {
  const messages: string[] = [];

  // 1. Extension ROM -- didn't reach full extension
  if (
    cueFamiliesAllowed(allowedCueFamilies, ['rangeOfMotion', 'lockout', 'kneeExtension', 'distalEndpoint']) &&
    isLockoutShort(repWindow)
  ) {
    messages.push('Extend fully \u2014 straighten your legs completely at the top.');
  }

  // 2. Flexion ROM -- didn't bend enough at the bottom
  if (
    cueFamiliesAllowed(allowedCueFamilies, ['rangeOfMotion', 'kneeExtension', 'distalEndpoint']) &&
    isFlexionShort(repWindow)
  ) {
    messages.push('Lower the weight more \u2014 start from a deeper bend.');
  }

  // 3. Torso lean
  if (
    cueFamilyAllowed(allowedCueFamilies, 'torsoSetup') &&
    hasTorsoMetric(repWindow) &&
    repWindow.maxTorsoDev > FORM_THRESHOLDS.TORSO_LEAN_WARN
  ) {
    messages.push('Keep your back against the pad \u2014 avoid leaning forward.');
  }

  // 4. Hip lift
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoSetup') && isHipLift(repWindow)) {
    messages.push('Keep your hips on the seat \u2014 don\'t lift off the pad.');
  }

  if (cueFamiliesAllowed(allowedCueFamilies, ['lockout', 'distalEndpoint']) && isTopHoldShort(repWindow)) {
    messages.push('Pause briefly at full extension.');
  }

  // 5. Tempo (measured to true lockout, not the early FSM EXTENDED phase)
  const { tExtend, tReturn } = lockoutTempo(repWindow);
  if (cueFamilyAllowed(allowedCueFamilies, 'tempo') && tExtend !== null && tReturn !== null) {

    if (tExtend > 0 && tExtend < FORM_THRESHOLDS.TEMPO_EXTEND_MIN) {
      messages.push('Slow down the extension \u2014 control the lift.');
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      messages.push('Control the return \u2014 don\'t let the weight drop.');
    }
  }

  return messages;
}

function buildLegExtensionDiagnostics(
  repWindow: RepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
  scorable: boolean,
): NonNullable<FrameworkRepResult['diagnostics']> {
  const hasTempo = repWindow.tLockout !== null;
  const { tExtend, tReturn } = lockoutTempo(repWindow);
  const hasKnee = hasKneeExtensionMetric(repWindow) && hasKneeFlexionMetric(repWindow);
  const hasTorso = hasTorsoMetric(repWindow);
  const hasHipRise = hasHipRiseMetric(repWindow);
  const sideViewConfidence = averageSideViewConfidence(repWindow);
  const viewQuality = buildLegExtensionViewQuality(repWindow);
  const hasSideViewConfidence = repWindow.sideViewConfidenceSamples >= FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES;
  const holdSeconds = topHoldSeconds(repWindow);
  const holdMs = topHoldMilliseconds(repWindow);
  const lockoutShort = isLockoutShort(repWindow);
  const flexionShort = isFlexionShort(repWindow);
  const hipLift = isHipLift(repWindow);
  const topHoldShort = isTopHoldShort(repWindow);
  const torsoConfidence = hasTorso ? repWindow.torsoConfidenceSum / repWindow.torsoSampleCount : undefined;
  const kneeConfidence = repWindow.kneeAngleSampleCount > 0
    ? repWindow.kneeAngleConfidenceSum / repWindow.kneeAngleSampleCount
    : undefined;
  const hipLiftSupport = Math.max(
    repWindow.maxHipDelta / FORM_THRESHOLDS.HIP_LIFT_WARN,
    repWindow.maxHipRiseRatio / FORM_THRESHOLDS.HIP_RISE_RATIO_WARN,
  );
  return buildRepDiagnostics({
    exerciseName: 'Leg Extensions',
    repIndex,
    view: diagnosticsViewFor(viewQuality),
    selectedSide: visibleSide,
    scorable,
    viewQuality,
    metrics: [
      diagnosticMetric('extensionRatio', repWindow.maxRatio, { unit: 'ratio' }),
      diagnosticMetric('flexionRatio', repWindow.minRatio, { unit: 'ratio' }),
      diagnosticMetric('romRatio', repWindow.maxRatio - repWindow.minRatio, { unit: 'ratio' }),
      diagnosticMetric('extensionRatioRaw', repWindow.rawMaxRatio !== -Infinity ? repWindow.rawMaxRatio : null, { unit: 'ratio' }),
      diagnosticMetric('flexionRatioRaw', repWindow.rawMinRatio !== Infinity ? repWindow.rawMinRatio : null, { unit: 'ratio' }),
      diagnosticMetric('kneeExtensionAngle', hasKneeExtensionMetric(repWindow) ? repWindow.maxKneeAngle : null, {
        unit: 'degrees',
        eligible: hasKneeExtensionMetric(repWindow),
        confidence: kneeConfidence,
        sampleCount: repWindow.kneeAngleSampleCount,
        skippedReason: 'knee_angle_unavailable',
      }),
      diagnosticMetric('kneeFlexionAngle', hasKneeFlexionMetric(repWindow) ? repWindow.minKneeAngle : null, {
        unit: 'degrees',
        eligible: hasKneeFlexionMetric(repWindow),
        confidence: kneeConfidence,
        sampleCount: repWindow.kneeAngleSampleCount,
        skippedReason: 'knee_angle_unavailable',
      }),
      diagnosticMetric('kneeAngleRom', hasKnee ? repWindow.maxKneeAngle - repWindow.minKneeAngle : null, {
        unit: 'degrees',
        eligible: hasKnee,
        confidence: kneeConfidence,
        sampleCount: repWindow.kneeAngleSampleCount,
        skippedReason: 'knee_angle_unavailable',
      }),
      diagnosticMetric('kneeExtensionAngleRaw', repWindow.rawMaxKneeAngle !== -Infinity ? repWindow.rawMaxKneeAngle : null, {
        unit: 'degrees',
        eligible: hasKneeExtensionMetric(repWindow),
        confidence: kneeConfidence,
        sampleCount: repWindow.kneeAngleSampleCount,
        skippedReason: 'knee_angle_unavailable',
      }),
      diagnosticMetric('kneeFlexionAngleRaw', repWindow.rawMinKneeAngle !== Infinity ? repWindow.rawMinKneeAngle : null, {
        unit: 'degrees',
        eligible: hasKneeFlexionMetric(repWindow),
        confidence: kneeConfidence,
        sampleCount: repWindow.kneeAngleSampleCount,
        skippedReason: 'knee_angle_unavailable',
      }),
      diagnosticMetric('torsoDeviation', hasTorso ? repWindow.maxTorsoDev : null, {
        unit: 'degrees',
        eligible: hasTorso,
        confidence: torsoConfidence,
        sampleCount: repWindow.torsoSampleCount,
        skippedReason: 'torso_chain_unavailable',
      }),
      diagnosticMetric('torsoDeviationRaw', hasTorso ? repWindow.rawMaxTorsoDev : null, {
        unit: 'degrees',
        eligible: hasTorso,
        confidence: torsoConfidence,
        sampleCount: repWindow.torsoSampleCount,
        skippedReason: 'torso_chain_unavailable',
      }),
      diagnosticMetric('torsoAbsoluteDeviation', repWindow.maxTorsoAbsDev !== -Infinity ? repWindow.maxTorsoAbsDev : null, {
        unit: 'degrees',
        eligible: repWindow.maxTorsoAbsDev !== -Infinity,
        confidence: torsoConfidence,
        sampleCount: repWindow.torsoSampleCount,
        skippedReason: 'torso_chain_unavailable',
      }),
      diagnosticMetric('hipDelta', repWindow.maxHipDelta, { unit: 'degrees' }),
      diagnosticMetric('hipDeltaRaw', repWindow.rawMaxHipDelta, { unit: 'degrees' }),
      diagnosticMetric('hipRiseRatio', hasHipRise ? repWindow.maxHipRiseRatio : null, {
        unit: 'ratio',
        eligible: hasHipRise,
        sampleCount: repWindow.hipRiseSampleCount,
        skippedReason: 'hip_position_unavailable',
      }),
      diagnosticMetric('hipRiseRatioRaw', hasHipRise ? repWindow.rawMaxHipRiseRatio : null, {
        unit: 'ratio',
        eligible: hasHipRise,
        sampleCount: repWindow.hipRiseSampleCount,
        skippedReason: 'hip_position_unavailable',
      }),
      diagnosticMetric('baselineSampleCount', repWindow.baselineSampleCount, { unit: 'count' }),
      diagnosticLabelMetric('torsoBaselineSource', repWindow.torsoBaselineSource, {
        sampleCount: repWindow.baselineSampleCount,
        skippedReason: 'torso_baseline_unavailable',
      }),
      diagnosticLabelMetric('hipBaselineSource', repWindow.hipBaselineSource, {
        sampleCount: repWindow.baselineSampleCount,
        skippedReason: 'hip_baseline_unavailable',
      }),
      diagnosticMetric('sideViewConfidence', sideViewConfidence, {
        unit: 'ratio',
        eligible: hasSideViewConfidence,
        sampleCount: repWindow.sideViewConfidenceSamples,
        skippedReason: 'insufficient_side_view_samples',
      }),
      diagnosticMetric('sideViewConfidenceMin', viewQuality.minSideViewConfidence ?? null, {
        unit: 'ratio',
        eligible: hasSideViewConfidence,
        sampleCount: repWindow.sideViewConfidenceSamples,
        skippedReason: 'insufficient_side_view_samples',
      }),
      diagnosticMetric('sideViewConfirmed', viewQuality.sideConfirmed ? 1 : 0, { unit: 'count' }),
      diagnosticMetric('frontishViewConfirmed', viewQuality.frontishConfirmed ? 1 : 0, { unit: 'count' }),
      diagnosticMetric('viewUnknown', viewQuality.viewUnknown ? 1 : 0, { unit: 'count' }),
      diagnosticMetric('topHoldSeconds', holdSeconds, { unit: 'seconds', eligible: holdSeconds !== null, skippedReason: 'lockout_hold_unavailable' }),
      diagnosticMetric('topHoldMs', holdMs, { unit: 'milliseconds', eligible: holdMs !== null, skippedReason: 'lockout_hold_unavailable' }),
      diagnosticMetric('tExtend', tExtend, { unit: 'seconds', eligible: hasTempo, skippedReason: 'lockout_not_detected' }),
      diagnosticMetric('tReturn', tReturn, { unit: 'seconds', eligible: hasTempo, skippedReason: 'lockout_not_detected' }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'leg-extensions.lockout_short',
        metricKeys: ['extensionRatio', 'kneeExtensionAngle'],
        direction: 'below',
        value: repWindow.maxRatio,
        thresholdPath: ['formThresholds.EXTENSION_FAIL', 'formThresholds.KNEE_EXTENSION_FAIL'],
        thresholdValue: {
          extensionRatio: FORM_THRESHOLDS.EXTENSION_FAIL,
          kneeExtensionAngle: FORM_THRESHOLDS.KNEE_EXTENSION_FAIL,
        },
        triggered: lockoutShort,
      }),
      diagnosticCue({
        issueId: 'leg-extensions.rom_short_leg_ext',
        metricKeys: ['flexionRatio', 'kneeFlexionAngle'],
        direction: 'above',
        value: repWindow.minRatio,
        thresholdPath: ['formThresholds.FLEXION_FAIL', 'formThresholds.KNEE_FLEXION_FAIL'],
        thresholdValue: {
          flexionRatio: FORM_THRESHOLDS.FLEXION_FAIL,
          kneeFlexionAngle: FORM_THRESHOLDS.KNEE_FLEXION_FAIL,
        },
        triggered: flexionShort,
      }),
      diagnosticCue({
        issueId: 'leg-extensions.torso_warn',
        metricKeys: ['torsoDeviation'],
        direction: 'above',
        value: hasTorso ? repWindow.maxTorsoDev : null,
        thresholdPath: 'formThresholds.TORSO_LEAN_WARN',
        thresholdValue: FORM_THRESHOLDS.TORSO_LEAN_WARN,
        eligible: hasTorso,
        triggered: hasTorso && repWindow.maxTorsoDev > FORM_THRESHOLDS.TORSO_LEAN_WARN,
        skippedReason: 'torso_chain_unavailable',
      }),
      diagnosticCue({
        issueId: 'leg-extensions.hip_lift',
        metricKeys: ['hipDelta', 'hipRiseRatio'],
        direction: 'above',
        value: null,
        thresholdPath: ['formThresholds.HIP_LIFT_WARN', 'formThresholds.HIP_RISE_RATIO_WARN'],
        thresholdValue: {
          hipDelta: FORM_THRESHOLDS.HIP_LIFT_WARN,
          hipRiseRatio: FORM_THRESHOLDS.HIP_RISE_RATIO_WARN,
        },
        support: hipLiftSupport,
        triggered: hipLift,
      }),
      diagnosticCue({
        issueId: 'leg-extensions.top_hold_short',
        metricKeys: ['topHoldSeconds'],
        direction: 'below',
        value: holdSeconds,
        thresholdPath: 'formThresholds.TOP_HOLD_MIN',
        thresholdValue: FORM_THRESHOLDS.TOP_HOLD_MIN,
        eligible: holdSeconds !== null,
        triggered: topHoldShort,
        skippedReason: 'lockout_hold_unavailable',
      }),
      diagnosticCue({
        issueId: 'leg-extensions.tempo_up',
        metricKeys: ['tExtend'],
        direction: 'below',
        value: tExtend,
        thresholdPath: 'formThresholds.TEMPO_EXTEND_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_EXTEND_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tExtend !== null && tExtend > 0 && tExtend < FORM_THRESHOLDS.TEMPO_EXTEND_MIN,
        skippedReason: 'lockout_not_detected',
      }),
      diagnosticCue({
        issueId: 'leg-extensions.tempo_down',
        metricKeys: ['tReturn'],
        direction: 'below',
        value: tReturn,
        thresholdPath: 'formThresholds.TEMPO_RETURN_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_RETURN_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tReturn !== null && tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN,
        skippedReason: 'lockout_not_detected',
      }),
    ],
  });
}

function buildLegExtensionRepResult(
  repWindow: RepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
): RepResult {
  const reliability = reliabilityInterpretationForRepWindow(repWindow, visibleSide);
  const reliabilityInterpretation = reliability?.interpretation ?? null;
  const allowedCueFamilies = safeCueFamilySet(reliabilityInterpretation);
  const scorable = repScorableWithReliability(repWindow, reliabilityInterpretation, visibleSide);
  // ScoreabilityCandidate controls reliability safety; final scorable also
  // includes the exercise side-view gate. Keep the historical score calculation
  // for diagnostics even if the view gate later marks the rep unscorable.
  const score = reliabilityAllowsScoring(reliabilityInterpretation, visibleSide)
    ? computeLegExtensionScore(repWindow, allowedCueFamilies)
    : 0;
  const messages = suppressUnsafeReliabilityMessages(
    generateFormMessages(repWindow, allowedCueFamilies),
    reliabilityInterpretation,
  );
  const qualityWarnings = legExtensionQualityWarnings(repWindow);
  const diagnostics = applyReliabilityCueGating(
    buildLegExtensionDiagnostics(repWindow, repIndex, visibleSide, scorable),
    reliabilityInterpretation,
    scorable,
  );
  logLegExtensionRepReliability(repIndex, reliabilityInterpretation, diagnostics);

  return {
    repIndex,
    score,
    messages,
    scorable,
    qualityWarnings,
    diagnostics,
  };
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function frameReachedLockout(rawRatio: number, rawKneeAngle: number | null): boolean {
  return (
    rawRatio >= FORM_THRESHOLDS.EXTENSION_FAIL ||
    (rawKneeAngle !== null && rawKneeAngle >= FORM_THRESHOLDS.KNEE_EXTENSION_FAIL)
  );
}

function durationMsSince(start: number | null, t: number): number {
  if (start === null) return 0;
  return Math.max(0, (t - start) * 1000);
}

function hasPersistedFor(start: number | null, t: number, requiredMs: number): boolean {
  return start !== null && durationMsSince(start, t) + 1e-6 >= requiredMs;
}

function sampleNearPeak(sample: RepFrameSample, window: RepWindow): boolean {
  const ratioNearPeak =
    finiteMetric(sample.ratio) &&
    window.maxRatio !== -Infinity &&
    sample.ratio >= window.maxRatio - FORM_THRESHOLDS.TOP_HOLD_RATIO_BAND;
  const kneeNearPeak =
    sample.kneeAngle !== null &&
    window.maxKneeAngle !== -Infinity &&
    sample.kneeAngle >= window.maxKneeAngle - FORM_THRESHOLDS.TOP_HOLD_KNEE_BAND;
  return ratioNearPeak || kneeNearPeak;
}

function computeTopHoldFromSamples(window: RepWindow): number | null {
  if (window.tLockout === null) return null;
  const lockout = window.tLockout;
  const cutoff = window.tReturnStart ?? window.tEnd;
  const peakSample = window.frameSamples.find((sample) => (
    sample.t >= lockout &&
    (
      sample.ratio >= window.rawMaxRatio - 1e-6 ||
      (sample.kneeAngle !== null && sample.kneeAngle >= window.rawMaxKneeAngle - 1e-6)
    )
  ));
  const holdStart = peakSample?.t ?? lockout;
  const samples = window.frameSamples
    .filter((sample) => sample.t >= holdStart && sample.t <= cutoff)
    .sort((a, b) => a.t - b.t);

  let currentHoldSeconds = 0;
  let maxHoldSeconds = 0;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    const dt = current.t - previous.t;
    if (!Number.isFinite(dt) || dt <= 0) continue;

    const ratioVelocity = Math.abs(current.ratio - previous.ratio) / dt;
    const ratioStable = ratioVelocity <= FORM_THRESHOLDS.TOP_HOLD_MAX_RATIO_VELOCITY;
    const kneeVelocity = previous.kneeAngle !== null && current.kneeAngle !== null
      ? Math.abs(current.kneeAngle - previous.kneeAngle) / dt
      : Infinity;
    const kneeStable = kneeVelocity <= FORM_THRESHOLDS.TOP_HOLD_MAX_KNEE_VELOCITY;
    const ratioNotDropping = current.ratio >= previous.ratio - 1e-4;
    const kneeNotDropping = previous.kneeAngle !== null && current.kneeAngle !== null
      ? current.kneeAngle >= previous.kneeAngle - 0.5
      : false;
    const segmentHeld =
      sampleNearPeak(previous, window) &&
      sampleNearPeak(current, window) &&
      (ratioNotDropping || kneeNotDropping) &&
      (ratioStable || kneeStable);

    if (segmentHeld) {
      currentHoldSeconds += dt;
      maxHoldSeconds = Math.max(maxHoldSeconds, currentHoldSeconds);
    } else {
      currentHoldSeconds = 0;
    }
  }

  return maxHoldSeconds * 1000;
}

function refreshRepWindowMetrics(window: RepWindow): void {
  const minRatio = robustLow(window.ratioSamples);
  const maxRatio = robustHigh(window.ratioSamples);
  if (minRatio !== null) window.minRatio = minRatio;
  if (maxRatio !== null) window.maxRatio = maxRatio;

  const minKneeAngle = robustLow(window.kneeAngleSamples);
  const maxKneeAngle = robustHigh(window.kneeAngleSamples);
  if (minKneeAngle !== null) window.minKneeAngle = minKneeAngle;
  if (maxKneeAngle !== null) window.maxKneeAngle = maxKneeAngle;

  const maxHipDelta = robustHigh(window.hipDeltaSamples);
  if (maxHipDelta !== null) window.maxHipDelta = maxHipDelta;

  const maxHipRiseRatio = robustHigh(window.hipRiseRatioSamples);
  if (maxHipRiseRatio !== null) window.maxHipRiseRatio = maxHipRiseRatio;

  const maxTorsoDev = robustHigh(window.torsoDevSamples);
  if (maxTorsoDev !== null) window.maxTorsoDev = maxTorsoDev;

  window.topHoldMs = computeTopHoldFromSamples(window);
}

function recordFrameInWindow(args: {
  window: RepWindow;
  signalKeypoints: Keypoint[];
  visibleSide: 'left' | 'right';
  rawRatio: number;
  smoothedRatio: number;
  rawKneeAngle: number | null;
  rawHipAngle: number | null;
  rawTorsoDev: number | null;
  torsoConfidence: number | null;
  sideViewConfidence: number | null;
  t: number;
  incrementFrame?: boolean;
}): void {
  const {
    window,
    signalKeypoints,
    visibleSide,
    rawRatio,
    smoothedRatio,
    rawKneeAngle,
    rawHipAngle,
    rawTorsoDev,
    torsoConfidence,
    sideViewConfidence,
    t,
    incrementFrame = false,
  } = args;

  window.tEnd = t;
  if (incrementFrame) window.frameCount++;

  if (finiteMetric(rawRatio)) {
    window.rawMinRatio = Math.min(window.rawMinRatio, rawRatio);
    window.rawMaxRatio = Math.max(window.rawMaxRatio, rawRatio);
    window.ratioSamples.push(rawRatio);
  }
  window.frameSamples.push({ t, ratio: rawRatio, kneeAngle: rawKneeAngle });

  if (sideViewConfidence !== null) {
    window.sideViewConfidenceSum += sideViewConfidence;
    window.sideViewConfidenceMin = Math.min(window.sideViewConfidenceMin, sideViewConfidence);
    window.sideViewConfidenceSamples++;
  }

  const selectedSideConfidence = minKeypointConfidence(signalKeypoints, [
    `${visibleSide}_shoulder`,
    `${visibleSide}_hip`,
    `${visibleSide}_knee`,
    `${visibleSide}_ankle`,
  ]);
  if (selectedSideConfidence >= FORM_CONFIDENCE_MIN) {
    window.selectedSideSamples++;
  }

  if (rawKneeAngle !== null) {
    window.rawMinKneeAngle = Math.min(window.rawMinKneeAngle, rawKneeAngle);
    window.rawMaxKneeAngle = Math.max(window.rawMaxKneeAngle, rawKneeAngle);
    window.kneeAngleSamples.push(rawKneeAngle);
    window.kneeAngleSampleCount++;
    window.kneeAngleConfidenceSum += minKeypointConfidence(signalKeypoints, [
      `${visibleSide}_hip`, `${visibleSide}_knee`, `${visibleSide}_ankle`,
    ]);
  }

  if (rawHipAngle !== null) {
    if (window.hipAngleBaseline === null) {
      window.hipAngleBaseline = rawHipAngle;
      window.hipBaselineSource = 'rep_start';
      window.baselineSampleCount = Math.max(window.baselineSampleCount, 1);
    }
    const hipConf = minKeypointConfidence(signalKeypoints, [
      `${visibleSide}_shoulder`, `${visibleSide}_hip`, `${visibleSide}_knee`,
    ]);
    if (hipConf >= FORM_CONFIDENCE_MIN) {
      const delta = Math.abs(rawHipAngle - window.hipAngleBaseline);
      window.rawMaxHipDelta = Math.max(window.rawMaxHipDelta, delta);
      window.hipDeltaSamples.push(delta);
    }
  }

  const hip = visibleKeypoint(signalKeypoints, `${visibleSide}_hip`, FORM_CONFIDENCE_MIN);
  const legChainLength = calculateLegChainLength(signalKeypoints, visibleSide);
  if (hip && legChainLength !== null) {
    if (window.hipYBaseline === null) {
      window.hipYBaseline = hip.y;
      window.hipBaselineSource = 'rep_start';
      window.baselineSampleCount = Math.max(window.baselineSampleCount, 1);
    }
    const hipRiseRatio = calculateHipRiseRatio(hip.y, window.hipYBaseline, legChainLength);
    if (hipRiseRatio !== null) {
      window.rawMaxHipRiseRatio = Math.max(window.rawMaxHipRiseRatio, hipRiseRatio);
      window.hipRiseRatioSamples.push(hipRiseRatio);
      window.hipRiseSampleCount++;
    }
  }

  if (rawTorsoDev !== null) {
    if (window.torsoDevBaseline === null) {
      window.torsoDevBaseline = rawTorsoDev;
      window.torsoBaselineSource = 'rep_start';
      window.baselineSampleCount = Math.max(window.baselineSampleCount, 1);
    }
    window.maxTorsoAbsDev = Math.max(window.maxTorsoAbsDev, rawTorsoDev);
    const torsoDelta = Math.abs(rawTorsoDev - window.torsoDevBaseline);
    window.rawMaxTorsoDev = Math.max(window.rawMaxTorsoDev, torsoDelta);
    window.torsoDevSamples.push(torsoDelta);
    window.torsoSampleCount++;
    window.torsoConfidenceSum += torsoConfidence ?? 0;
  }

  const lockedOut = frameReachedLockout(rawRatio, rawKneeAngle);
  if (window.tLockout === null) {
    if (lockedOut) {
      window.lockoutStreakStart ??= t;
      window.lockoutStreakCount++;
      if (hasPersistedFor(window.lockoutStreakStart, t, THRESHOLDS.LOCKOUT_CONFIRM_MS)) {
        window.tLockout = window.lockoutStreakStart;
      }
    } else {
      window.lockoutStreakCount = 0;
      window.lockoutStreakStart = null;
    }
  } else if (window.tReturnStart === null) {
    if (!lockedOut) {
      window.returnStreakStart ??= t;
      window.returnStreakCount++;
      if (hasPersistedFor(window.returnStreakStart, t, THRESHOLDS.RETURN_CONFIRM_MS)) {
        window.tReturnStart = window.returnStreakStart;
      }
    } else {
      window.returnStreakCount = 0;
      window.returnStreakStart = null;
    }
  }

  refreshRepWindowMetrics(window);
}

function updateLegExtensionState(
  keypoints: Keypoint[],
  currentState: LegExtensionState,
  frameContext?: ExerciseFrameContext,
): LegExtensionState {
  const timestampMs = typeof frameContext?.timestampMs === 'number' && Number.isFinite(frameContext.timestampMs)
    ? frameContext.timestampMs
    : Date.now();
  const t = timestampMs / 1000;
  const signalKeypoints = signalSourceKeypoints(frameContext, keypoints);

  if (frameContext?.trackingInterrupted) {
    return resetLegExtensionAfterTrackingInterruption(currentState);
  }

  // Warmup gate
  if (!currentState.warmedUp) {
    const ready = currentState.warmupGate.update(signalKeypoints);
    if (!ready) {
      return currentState;
    }
    currentState.warmedUp = true;
  }

  // Only update visible side in REST -- lock it during active rep phases
  // to prevent mid-rep side switching that corrupts measurements.
  const inActiveRep = currentState.fsm.phase !== 'REST';
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(signalKeypoints);

  // Calculate raw values
  const rawRatio = computeReachRatio(signalKeypoints, visibleSide);
  const rawKneeAngle = calculateKneeAngle(signalKeypoints, visibleSide);
  const rawHip = calculateHipAngle(signalKeypoints, visibleSide);
  const torsoSample = calculateTorsoDeviationSample(frameContext, signalKeypoints, visibleSide);
  const rawTorsoDev = torsoSample?.value ?? null;
  const sideViewConfidence = calculateSideViewConfidence(signalKeypoints);
  const currentRepWindow = currentState.repWindow;
  const hip = visibleKeypoint(signalKeypoints, `${visibleSide}_hip`, FORM_CONFIDENCE_MIN);
  const currentHipRiseRatio = hip && currentRepWindow && currentRepWindow.hipYBaseline !== null
    ? calculateHipRiseRatio(hip.y, currentRepWindow.hipYBaseline, calculateLegChainLength(signalKeypoints, visibleSide))
    : null;

  // If we can't compute the ratio, bail out
  if (rawRatio === null) {
    return {
      ...currentState,
      visibleSide,
      smoothedRatio: null,
      fastRatio: null,
      currentKneeAngle: null,
      currentHipRiseRatio: null,
      smoothedHip: null,
      smoothedTorso: null,
    };
  }

  // Smooth values
  const smoothedRatio = currentState.ratioTracker.push(rawRatio, undefined, timestampMs);
  const fastRatio = currentState.ratioTracker.medianValue;
  const smoothedHip = rawHip !== null
    ? currentState.hipTracker.push(rawHip, undefined, timestampMs)
    : currentState.hipTracker.value;
  const smoothedTorso = rawTorsoDev !== null
    ? currentState.torsoTracker.push(rawTorsoDev, undefined, timestampMs)
    : currentState.torsoTracker.value;

  const newState: LegExtensionState = {
    ...currentState,
    visibleSide,
    smoothedRatio,
    fastRatio: isNaN(fastRatio) ? null : fastRatio,
    currentKneeAngle: rawKneeAngle,
    currentHipRiseRatio,
    smoothedHip: isNaN(smoothedHip) ? null : smoothedHip,
    smoothedTorso: isNaN(smoothedTorso) ? null : smoothedTorso,
  };

  if (isNaN(fastRatio)) {
    return newState;
  }

  const validBentRestSetup =
    currentState.fsm.phase === 'REST' &&
    fastRatio <= THRESHOLDS.EXTENDING_ENTER;
  if (validBentRestSetup) {
    newState.hasSeenBentRest = true;
    recordRestBaselineSample(newState, visibleSide, rawTorsoDev, rawHip, hip?.y ?? null);
  }

  const currentFrameLockedOut = frameReachedLockout(rawRatio, rawKneeAngle);
  if (!currentState.repWindow) {
    if (currentFrameLockedOut) {
      newState.preWindowLockoutStreakCount = currentState.preWindowLockoutStreakCount + 1;
      newState.preWindowLockoutStreakStart = currentState.preWindowLockoutStreakStart ?? t;
    } else {
      newState.preWindowLockoutStreakCount = 0;
      newState.preWindowLockoutStreakStart = null;
    }
  }

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, fastRatio, t, newState.hasSeenBentRest);
  newState.fsm = fsmResult.fsm;

  const returnedPartial =
    currentState.fsm.phase === 'EXTENDING' &&
    newState.fsm.phase === 'REST' &&
    !fsmResult.repCompleted &&
    newState.repWindow !== null;

  if (returnedPartial && newState.repWindow) {
    const window = newState.repWindow;
    observeLegExtensionPoseState(window, frameContext);
    recordFrameInWindow({
      window,
      signalKeypoints,
      visibleSide,
      rawRatio,
      smoothedRatio,
      rawKneeAngle,
      rawHipAngle: rawHip,
      rawTorsoDev,
      torsoConfidence: torsoSample?.confidence ?? null,
      sideViewConfidence,
      t,
    });
    refreshRepWindowMetrics(window);
    const actualRom = window.maxRatio - window.minRatio;
    const duration = window.tEnd - window.tStart;

    if (isMeaningfulLegExtensionPartialRep(window, duration)) {
      newState.repCount++;
      const repResult = buildLegExtensionRepResult(window, newState.repCount, visibleSide);
      const messages = repResult.messages;
      newState.lastRepResult = repResult;
      newState.feedback = messages.length > 0 ? messages.join('\n') : 'Good rep.';
      newState.lastFeedbackTime = t;
    } else if (actualRom > 0) {
      newState.feedback = LOW_ROM_FEEDBACK;
      newState.lastFeedbackTime = t;
    }

    newState.repWindow = null;
    newState.fsm = initFSM();
    return newState;
  }

  if (newState.fsm.phase === 'REST' && !isNaN(smoothedRatio)) {
    newState.restMinRatio = Math.min(newState.restMinRatio, smoothedRatio);
  }

  // Track rep window while actively in a rep (not REST)
  const inRep = newState.fsm.phase !== 'REST';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(newState.fsm.tRepStart ?? t, rawRatio);
    applyRestBaselines(newState.repWindow, newState.baselineSamples[visibleSide]);
    newState.repWindow.lockoutStreakCount = currentState.preWindowLockoutStreakCount;
    newState.repWindow.lockoutStreakStart = currentState.preWindowLockoutStreakStart;
    if (currentState.restMinRatio !== Infinity) {
      seedRatioSample(newState.repWindow, currentState.restMinRatio, newState.fsm.tRepStart ?? t);
      refreshRepWindowMetrics(newState.repWindow);
    }
    newState.restMinRatio = Infinity;
    newState.preWindowLockoutStreakCount = 0;
    newState.preWindowLockoutStreakStart = null;
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    observeLegExtensionPoseState(window, frameContext);
    recordFrameInWindow({
      window,
      signalKeypoints,
      visibleSide,
      rawRatio,
      smoothedRatio,
      rawKneeAngle,
      rawHipAngle: rawHip,
      rawTorsoDev,
      torsoConfidence: torsoSample?.confidence ?? null,
      sideViewConfidence,
      t,
      incrementFrame: true,
    });

    // Record extended timestamp
    if (newState.fsm.phase === 'EXTENDED' && window.tExtended === null) {
      window.tExtended = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    observeLegExtensionPoseState(newState.repWindow, frameContext);
    recordFrameInWindow({
      window: newState.repWindow,
      signalKeypoints,
      visibleSide,
      rawRatio,
      smoothedRatio,
      rawKneeAngle,
      rawHipAngle: rawHip,
      rawTorsoDev,
      torsoConfidence: torsoSample?.confidence ?? null,
      sideViewConfidence,
      t,
    });
    refreshRepWindowMetrics(newState.repWindow);

    newState.repCount++;

    const repResult = buildLegExtensionRepResult(newState.repWindow, newState.repCount, visibleSide);
    const messages = repResult.messages;
    newState.lastRepResult = repResult;

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
    ratio: fmt(state.smoothedRatio),
    fastRatio: fmt(state.fastRatio),
    kneeAngle: fmt(state.currentKneeAngle),
    hipAngle: fmt(state.smoothedHip),
    hipRiseRatio: fmt(state.currentHipRiseRatio),
    torsoDev: fmt(state.smoothedTorso),
    ratioMin: repWin && repWin.minRatio !== Infinity ? fmt(repWin.minRatio) : null,
    ratioMax: repWin && repWin.maxRatio !== -Infinity ? fmt(repWin.maxRatio) : null,
    kneeAngleMin: repWin && repWin.minKneeAngle !== Infinity ? fmt(repWin.minKneeAngle) : null,
    kneeAngleMax: repWin && repWin.maxKneeAngle !== -Infinity ? fmt(repWin.maxKneeAngle) : null,
    hipDelta: repWin ? fmt(repWin.maxHipDelta) : null,
    hipRiseMax: repWin ? fmt(repWin.maxHipRiseRatio) : null,
    torsoDevMax: repWin ? fmt(repWin.maxTorsoDev) : null,
    topHoldMs: repWin ? fmt(topHoldMilliseconds(repWin)) : null,
  };
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================

function configNumber(config: ExerciseHeuristicConfig, path: string, issues: string[]): number | null {
  const value = getConfigValue(config, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`Leg Extensions config "${path}" must be a finite number.`);
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
  const valid = allowEqual ? first <= second : first < second;
  if (!valid) {
    issues.push(
      `Leg Extensions config ordering invalid: "${firstPath}" (${first}) must be ${allowEqual ? '<=' : '<'} "${secondPath}" (${second}).`,
    );
  }
}

function validatePenaltyConfigs(config: ExerciseHeuristicConfig, issues: string[]): void {
  const penaltyConfigs = getConfigValue(config, 'penaltyConfigs');
  if (penaltyConfigs === null || typeof penaltyConfigs !== 'object' || Array.isArray(penaltyConfigs)) {
    issues.push('Leg Extensions config "penaltyConfigs" must be an object.');
    return;
  }

  for (const [penaltyName, penaltyConfig] of Object.entries(penaltyConfigs)) {
    if (penaltyConfig === null || typeof penaltyConfig !== 'object' || Array.isArray(penaltyConfig)) {
      issues.push(`Leg Extensions penalty config "${penaltyName}" must be an object.`);
      continue;
    }
    for (const [key, value] of Object.entries(penaltyConfig)) {
      const path = `penaltyConfigs.${penaltyName}.${key}`;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(`Leg Extensions config "${path}" must be a finite number.`);
        continue;
      }
      if (key === 'scale' && value <= 0) {
        issues.push(`Leg Extensions config "${path}" must be greater than 0.`);
      }
      if (key === 'cap' && value < 0) {
        issues.push(`Leg Extensions config "${path}" must be greater than or equal to 0.`);
      }
      if (key === 'deadzone' && value < 0) {
        issues.push(`Leg Extensions config "${path}" must be greater than or equal to 0.`);
      }
    }
  }
}

function validatePositiveInteger(config: ExerciseHeuristicConfig, issues: string[], path: string): number | null {
  const value = configNumber(config, path, issues);
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    issues.push(`Leg Extensions config "${path}" must be a positive integer.`);
  }
  return value;
}

function validateLegExtensionsHeuristicConfig(config: ExerciseHeuristicConfig): string[] {
  const issues: string[] = [];

  requireOrdered(config, issues, 'thresholds.EXTEND_CLOCK_START', 'thresholds.REST_REENTER');
  requireOrdered(config, issues, 'thresholds.REST_REENTER', 'thresholds.EXTENDING_ENTER', true);
  requireOrdered(config, issues, 'thresholds.EXTENDING_ENTER', 'thresholds.EXTENDED_EXIT');
  requireOrdered(config, issues, 'thresholds.EXTENDED_EXIT', 'thresholds.EXTENDED_ENTER');
  requireOrdered(config, issues, 'formThresholds.FLEXION_FAIL', 'formThresholds.EXTENSION_FAIL');
  requireOrdered(config, issues, 'formThresholds.KNEE_FLEXION_FAIL', 'formThresholds.KNEE_EXTENSION_FAIL');
  requireOrdered(config, issues, 'formThresholds.KNEE_EXTENSION_FAIL', 'formThresholds.KNEE_EXTENSION_IDEAL', true);
  requireOrdered(config, issues, 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', 'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN', true);

  const minPartialRom = configNumber(config, 'thresholds.MIN_PARTIAL_ROM', issues);
  const minPartialKneeRom = configNumber(config, 'thresholds.MIN_PARTIAL_KNEE_ROM', issues);
  const extendedEnter = configNumber(config, 'thresholds.EXTENDED_ENTER', issues);
  const restReenter = configNumber(config, 'thresholds.REST_REENTER', issues);
  const kneeExtensionFail = configNumber(config, 'formThresholds.KNEE_EXTENSION_FAIL', issues);
  const kneeFlexionFail = configNumber(config, 'formThresholds.KNEE_FLEXION_FAIL', issues);
  if (
    minPartialRom !== null &&
    extendedEnter !== null &&
    restReenter !== null &&
    minPartialRom >= extendedEnter - restReenter
  ) {
    issues.push(
      'Leg Extensions config "thresholds.MIN_PARTIAL_ROM" must be less than EXTENDED_ENTER - REST_REENTER.',
    );
  }
  if (
    minPartialKneeRom !== null &&
    kneeExtensionFail !== null &&
    kneeFlexionFail !== null &&
    (minPartialKneeRom <= 0 || minPartialKneeRom >= kneeExtensionFail - kneeFlexionFail)
  ) {
    issues.push(
      'Leg Extensions config "thresholds.MIN_PARTIAL_KNEE_ROM" must be greater than 0 and less than KNEE_EXTENSION_FAIL - KNEE_FLEXION_FAIL.',
    );
  }

  for (const path of [
    'thresholds.EXTEND_CLOCK_START',
    'thresholds.EXTENDING_ENTER',
    'thresholds.EXTENDED_ENTER',
    'thresholds.EXTENDED_EXIT',
    'thresholds.REST_REENTER',
    'thresholds.MIN_PARTIAL_ROM',
    'formThresholds.EXTENSION_FAIL',
    'formThresholds.FLEXION_FAIL',
    'formThresholds.HIP_RISE_RATIO_WARN',
    'formThresholds.TOP_HOLD_RATIO_BAND',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 1.2)) {
      issues.push(`Leg Extensions config "${path}" must be greater than 0 and at most 1.2.`);
    }
  }

  for (const path of [
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 1)) {
      issues.push(`Leg Extensions config "${path}" must be greater than 0 and at most 1.`);
    }
  }

  for (const path of [
    'thresholds.MIN_REP_TIME',
    'formThresholds.TORSO_LEAN_WARN',
    'formThresholds.HIP_LIFT_WARN',
    'formThresholds.TOP_HOLD_MIN',
    'formThresholds.TOP_HOLD_KNEE_BAND',
    'formThresholds.TOP_HOLD_MAX_RATIO_VELOCITY',
    'formThresholds.TOP_HOLD_MAX_KNEE_VELOCITY',
    'formThresholds.TEMPO_EXTEND_MIN',
    'formThresholds.TEMPO_RETURN_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && value <= 0) {
      issues.push(`Leg Extensions config "${path}" must be greater than 0.`);
    }
  }

  for (const path of [
    'formThresholds.KNEE_EXTENSION_FAIL',
    'formThresholds.KNEE_EXTENSION_IDEAL',
    'formThresholds.KNEE_FLEXION_FAIL',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 180)) {
      issues.push(`Leg Extensions config "${path}" must be greater than 0 and at most 180.`);
    }
  }

  const baselineWindow = validatePositiveInteger(config, issues, 'thresholds.BASELINE_WINDOW_FRAMES');
  const baselineMin = validatePositiveInteger(config, issues, 'thresholds.BASELINE_MIN_SAMPLES');
  validatePositiveInteger(config, issues, 'thresholds.ROBUST_EXTREMA_MIN_SAMPLES');
  validatePositiveInteger(config, issues, 'formThresholds.SIDE_VIEW_MIN_SAMPLES');
  validatePositiveInteger(config, issues, 'thresholds.LOCKOUT_CONFIRM_MS');
  validatePositiveInteger(config, issues, 'thresholds.RETURN_CONFIRM_MS');
  for (const path of ['thresholds.LOCKOUT_CONFIRM_MS', 'thresholds.RETURN_CONFIRM_MS']) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 500)) {
      issues.push(`Leg Extensions config "${path}" must be greater than 0 and at most 500.`);
    }
  }
  if (baselineWindow !== null && baselineMin !== null && baselineMin > baselineWindow) {
    issues.push(
      'Leg Extensions config "thresholds.BASELINE_MIN_SAMPLES" must be less than or equal to BASELINE_WINDOW_FRAMES.',
    );
  }

  validatePenaltyConfigs(config, issues);
  return issues;
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createLegExtensionsDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_LEG_EXTENSIONS_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Leg Extensions',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    repQualityWindowActive: false,
    liveQualityWarnings: [],
    _internal: withLegExtensionsConfig(config, () => initializeLegExtensionState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState, frameContext?: ExerciseFrameContext): ExerciseState => {
    const internal = state._internal as LegExtensionState;
    const newInternal = withLegExtensionsConfig(
      config,
      () => updateLegExtensionState(keypoints, internal, frameContext),
    );

    // Map internal RepResult to framework RepResult
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
    const liveQualityWarnings = newInternal.repWindow
      ? legExtensionQualityWarnings(newInternal.repWindow)
      : completedNewRep
        ? (lastRepResult?.qualityWarnings ?? [])
        : [];

    return {
      repCount: newInternal.repCount,
      lastRepResult,
      feedback: newInternal.feedback,
      feedbackTimestamp: newInternal.lastFeedbackTime > 0 ? newInternal.lastFeedbackTime : null,
      debugInfo: getDebugInfo(newInternal) as unknown as Record<string, unknown>,
      repQualityWindowActive: newInternal.repWindow !== null,
      liveQualityWarnings,
      _internal: newInternal,
    };
  },

  heuristicConfig: config,
  tunableSpec: LEG_EXTENSIONS_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/legExtensions.json',
  createVariant: (variantConfig) =>
    createLegExtensionsDefinition(mergeHeuristicConfig(config, variantConfig)),
  validateHeuristicConfig: validateLegExtensionsHeuristicConfig,

  ttsConfig: {
    feedbackToIssue: {
      'Extend fully \u2014 straighten your legs completely at the top.': 'lockout_short',
      'Lower the weight more \u2014 start from a deeper bend.': 'rom_short_leg_ext',
      'Keep your back against the pad \u2014 avoid leaning forward.': 'torso_warn',
      "Keep your hips on the seat \u2014 don't lift off the pad.": 'hip_lift',
      'Pause briefly at full extension.': 'top_hold_short',
      'Slow down the extension \u2014 control the lift.': 'tempo_up',
      "Control the return \u2014 don't let the weight drop.": 'tempo_down',
    },
    feedbackMessages: {
      'Extend fully \u2014 straighten your legs completely at the top.': [
        'Straighten your legs fully.',
        'Finish the rep at the top.',
        'Squeeze the quads at full extension.',
      ],
      'Keep your back against the pad \u2014 avoid leaning forward.': [
        'Keep your back against the pad.',
        'Stay pinned to the backrest.',
        'Sit tall with your back supported.',
      ],
      "Keep your hips on the seat \u2014 don't lift off the pad.": [
        'Hips stay on the seat.',
        'Keep your hips down.',
        'No lifting off the pad.',
      ],
      'Pause briefly at full extension.': [
        'Pause at the top.',
        'Hold the squeeze briefly.',
        'Brief pause at full extension.',
      ],
      'Slow down the extension \u2014 control the lift.': [
        'Slow the extension.',
        'Lift with control.',
        'Smooth squeeze to the top.',
      ],
      "Control the return \u2014 don't let the weight drop.": [
        'Control the return.',
        "Don't let the weight drop.",
        'Lower the weight slowly.',
      ],
    },
    issueDefinitions: [
      {
        issueType: 'rom_short_leg_ext',
        priority: 20,
        messages: [
          'Use a deeper bend at the bottom.',
          'Start from a deeper bend.',
          'More range at the bottom.',
        ],
      },
      {
        issueType: 'hip_lift',
        priority: 25,
        messages: [
          'Stay seated.',
          'Keep your hips on the pad.',
          'Keep your seat planted.',
        ],
      },
      {
        issueType: 'top_hold_short',
        priority: 15,
        messages: [
          'Pause at the top.',
          'Hold the squeeze briefly.',
          'Brief pause at full extension.',
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
    'Pause briefly at full extension.':
      'Pause briefly at full knee extension and squeeze the quads before lowering.',
    'Slow down the extension \u2014 control the lift.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the extension.',
    "Control the return \u2014 don't let the weight drop.":
      'Slow the eccentric phase \u2014 resist the weight on the way down for 2-3 seconds.',
  },
  };
}

export const legExtensionsDefinition: ExerciseDefinition = createLegExtensionsDefinition();
