/**
 * Lying Leg Curl -- Exercise Definition
 *
 * Side view, knee reach ratio (hip-ankle distance / leg-chain length) as
 * primary driver.  Ratio is camera-distance-invariant.
 *
 * Person lies prone on a leg curl machine. Legs start extended (ratio ~0.96-0.98),
 * curl up to peak flexion (ratio ~0.35-0.50), then return.
 *
 * FSM: REST -> CURLING -> CURLED -> LOWERING -> REST
 * One rep = full curl up + controlled lower back down.
 *
 * Form checks:
 *   1. Knee flexion ROM   -- did they curl far enough?  (minRatio)
 *   2. Knee extension ROM -- did they fully extend?     (maxRatio)
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
  minKeypointConfidence,
} from '../../poseAnalysis';

import { SmoothedAngleTracker } from '../shared/SmoothedAngleTracker';
import { WarmupGate } from '../shared/WarmupGate';
import { computeScore, type PenaltyConfig } from '../shared/scoring';
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
import tunedConfig from './tuned/lyingLegCurl.json';

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
type DistalEndpointName = 'ankle' | 'heel' | 'foot_index';
type DistalEndpoint = { name: DistalEndpointName; keypoint: Keypoint };

/** Euclidean distance between two 2D points. */
function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute "reach ratio" for a three-joint chain: A-B-C.
 *   ratio = dist(A,C) / (dist(A,B) + dist(B,C))
 *
 * Returns 1.0 when perfectly straight, approaches 0 when fully folded.
 * Camera-distance-invariant because both numerator and denominator scale
 * identically with distance.
 */
function computeReachRatio(a: Point2D, b: Point2D, c: Point2D): number {
  const chainLen = dist2D(a, b) + dist2D(b, c);
  if (chainLen === 0) return 1;
  return dist2D(a, c) / chainLen;
}

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
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
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function averageFiniteOrNull(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length > 0 ? average(finite) : null;
}

function averagePoint(values: Point2D[]): Point2D | null {
  if (values.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const value of values) {
    x += value.x;
    y += value.y;
  }
  return { x: x / values.length, y: y / values.length };
}

function sortedFinite(values: number[]): number[] {
  return values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
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

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds — knee reach ratio (hip-ankle / chain length) */
const THRESHOLDS = {
  /** Ratio below which the curl clock starts before the FSM commits */
  CURL_CLOCK_START: 0.96,
  /** Ratio below which we transition REST -> CURLING (legs start to bend) */
  CURLING_ENTER: 0.90,
  /** Ratio below which we consider peak flexion (CURLING -> CURLED) */
  CURLED_ENTER: 0.55,
  /** Ratio above which we leave CURLED (hysteresis) (CURLED -> LOWERING) */
  CURLED_EXIT: 0.58,
  /** Ratio above which the extension is complete (LOWERING -> REST) */
  REST_REENTER: 0.90,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
  /** Minimum ratio ROM for a returned partial rep to count */
  MIN_PARTIAL_ROM: 0.18,
  /** Minimum samples before robust extrema replace raw extrema */
  ROBUST_EXTREMA_MIN_SAMPLES: 3,
  /** Rolling REST samples retained for extension baseline capture */
  REST_SAMPLE_WINDOW_FRAMES: 20,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min ratio above which flexion is insufficient (didn't curl enough) */
  FLEXION_FAIL: 0.55,
  /** Ideal flexion ratio for scoring */
  FLEXION_IDEAL_RATIO: 0.45,
  /** Max ratio below which extension is insufficient (didn't straighten) */
  EXTENSION_FAIL: 0.93,
  /** Ideal extension ratio for scoring */
  EXTENSION_IDEAL_RATIO: 0.97,
  /** Min knee angle above which top flexion is insufficient */
  KNEE_FLEXION_FAIL: 115,
  /** Ideal knee flexion angle for conservative knee-angle score support */
  KNEE_FLEXION_IDEAL: 95,
  /** Max knee angle below which bottom extension is insufficient */
  KNEE_EXTENSION_FAIL: 160,
  /** Ideal bottom extension angle for conservative knee-angle score support */
  KNEE_EXTENSION_IDEAL: 170,
  /** Hip angle delta from baseline above which hips are lifting */
  HIP_LIFT_WARN: 12,
  /** Normalized upward hip movement above which hips are lifting */
  HIP_RISE_RATIO_WARN: 0.04,
  /** Normalized thigh/knee drift above which the thigh is moving off the pad */
  THIGH_DRIFT_RATIO_WARN: 0.06,
  /** Minimum squeeze/pause at the curled position (seconds) */
  TOP_HOLD_MIN: 0.12,
  /** Maximum near-top ratio velocity considered a stable hold */
  TOP_HOLD_VELOCITY_MAX: 0.08,
  /** Concentric (curl up) too fast threshold (seconds) */
  TEMPO_CURL_MIN: 0.5,
  /** Eccentric (lower down) too fast threshold (seconds) */
  TEMPO_LOWER_MIN: 0.8,
  /** Velocity spike ratio above which the rep looks bouncy/jerky */
  TEMPO_JERK_SPIKE_WARN: 2.5,
  /** Absolute ratio velocity above which the rep looks bouncy/jerky */
  TEMPO_JERK_VELOCITY_WARN: 8.0,
  /** Minimum ratio velocity sample included in jerk/bounce analysis */
  VELOCITY_SAMPLE_MIN: 0.04,
  /** Average side-view confidence below which the rep is not scorable */
  SIDE_VIEW_AVG_CONFIDENCE_MIN: 0.45,
  /** Minimum side-view confidence below which the rep is not scorable */
  SIDE_VIEW_MIN_CONFIDENCE_MIN: 0.25,
  /** Minimum side-view samples before enforcing the side-view gate */
  SIDE_VIEW_MIN_SAMPLES: 5,
  /** Per-frame landmark confidence below which a form-critical sample is low quality */
  PRIMARY_CONFIDENCE_MIN: 0.3,
  /** Max low-confidence sample rate before a counted rep is marked unscorable */
  LOW_CONFIDENCE_MAX_RATE: 0.35,
  /** Minimum knee-angle samples before knee-angle ROM can affect score/feedback */
  KNEE_METRIC_MIN_SAMPLES: 5,
  /** Minimum knee-angle sample rate before knee-angle ROM can affect score/feedback */
  KNEE_METRIC_MIN_SAMPLE_RATE: 0.35,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category          | Cap | Deadzone | Scale | Key Input                            |
 * |-------------------|-----|----------|-------|--------------------------------------|
 * | ROM flexion       | 40  | 0        | 1000  | max(0, minRatio - ideal) excess      |
 * | ROM extension     | 35  | 0        | 3500  | max(0, ideal - maxRatio) shortfall   |
 * | Knee flexion ROM  | 12  | 0        | 0.04  | min knee angle - ideal flexion        |
 * | Knee extension    | 10  | 0        | 0.04  | ideal extension - max knee angle      |
 * | Hip lift          | 30  | 8        | 0.20  | max hip angle delta from baseline     |
 * | Hip rise          | 15  | 0.03     | 20000 | normalized upward hip movement        |
 * | Thigh movement    | 12  | 0.04     | 5000  | normalized hip-knee vector drift       |
 * | Top hold          | 5   | 0        | 160   | top-hold time deficit                 |
 * | Tempo curl        | 15  | 0        | 80    | concentric time deficit              |
 * | Tempo lower       | 15  | 0        | 45    | eccentric time deficit               |
 * | Tempo jerk        | 10  | 0        | 8     | velocity spike/absolute excess        |
 *
 * Max total penalty: 199 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  FLEXION_ROM:         { cap: 40, deadzone: 0, scale: 1000 } as PenaltyConfig,
  EXTENSION_ROM:       { cap: 35, deadzone: 0, scale: 3500 } as PenaltyConfig,
  KNEE_FLEXION_ROM:    { cap: 12, deadzone: 0, scale: 0.04 } as PenaltyConfig,
  KNEE_EXTENSION_ROM:  { cap: 10, deadzone: 0, scale: 0.04 } as PenaltyConfig,
  HIP_LIFT:            { cap: 30, deadzone: 8, scale: 0.20 } as PenaltyConfig,
  HIP_RISE:            { cap: 15, deadzone: 0.03, scale: 20000 } as PenaltyConfig,
  THIGH_MOVEMENT:      { cap: 12, deadzone: 0.04, scale: 5000 } as PenaltyConfig,
  TOP_HOLD:            { cap: 5, deadzone: 0, scale: 160 } as PenaltyConfig,
  TEMPO_CURL:          { cap: 15, deadzone: 0, scale: 80 } as PenaltyConfig,
  TEMPO_LOWER:         { cap: 15, deadzone: 0, scale: 45 } as PenaltyConfig,
  TEMPO_JERK:          { cap: 10, deadzone: 0, scale: 8 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;
const FORM_CONFIDENCE_MIN = 0.3;

const DEFAULT_LYING_LEG_CURL_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_LYING_LEG_CURL_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_LYING_LEG_CURL_HEURISTIC_CONFIG,
  tunedConfig,
);

const LYING_LEG_CURL_TUNABLE_SPEC = createDefaultTunableSpec(
  'Lying Leg Curl',
  DEFAULT_LYING_LEG_CURL_HEURISTIC_CONFIG,
);

function upsertLyingLegCurlTunable(tunable: NumericTunable): void {
  const index = LYING_LEG_CURL_TUNABLE_SPEC.tunables.findIndex(existing => existing.path === tunable.path);
  if (index >= 0) {
    LYING_LEG_CURL_TUNABLE_SPEC.tunables[index] = tunable;
  } else {
    LYING_LEG_CURL_TUNABLE_SPEC.tunables.push(tunable);
  }
}

([
  { path: 'thresholds.ROBUST_EXTREMA_MIN_SAMPLES', min: 1, max: 5, step: 1, kind: 'fsm' },
  { path: 'formThresholds.KNEE_FLEXION_FAIL', min: 90, max: 135, step: 1, kind: 'feedback' },
  { path: 'formThresholds.KNEE_FLEXION_IDEAL', min: 70, max: 115, step: 1, kind: 'scoring' },
  { path: 'formThresholds.KNEE_EXTENSION_FAIL', min: 145, max: 175, step: 1, kind: 'feedback' },
  { path: 'formThresholds.KNEE_EXTENSION_IDEAL', min: 155, max: 180, step: 1, kind: 'scoring' },
  { path: 'formThresholds.FLEXION_IDEAL_RATIO', min: 0.30, max: 0.60, step: 0.01, kind: 'scoring' },
  { path: 'formThresholds.EXTENSION_IDEAL_RATIO', min: 0.90, max: 1.05, step: 0.01, kind: 'scoring' },
  { path: 'formThresholds.HIP_RISE_RATIO_WARN', min: 0.01, max: 0.12, step: 0.01, kind: 'feedback' },
  { path: 'formThresholds.THIGH_DRIFT_RATIO_WARN', min: 0.02, max: 0.14, step: 0.01, kind: 'feedback' },
  { path: 'formThresholds.TOP_HOLD_MIN', min: 0, max: 0.5, step: 0.02, kind: 'feedback' },
  { path: 'formThresholds.TOP_HOLD_VELOCITY_MAX', min: 0.02, max: 0.30, step: 0.01, kind: 'feedback' },
  { path: 'formThresholds.TEMPO_CURL_MIN', min: 0.15, max: 1.2, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.TEMPO_LOWER_MIN', min: 0.2, max: 1.8, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.TEMPO_JERK_SPIKE_WARN', min: 2, max: 10, step: 0.1, kind: 'feedback' },
  { path: 'formThresholds.TEMPO_JERK_VELOCITY_WARN', min: 3, max: 14, step: 0.1, kind: 'feedback' },
  { path: 'formThresholds.VELOCITY_SAMPLE_MIN', min: 0.01, max: 0.20, step: 0.01, kind: 'feedback' },
  { path: 'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN', min: 0.2, max: 0.75, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', min: 0.1, max: 0.5, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.SIDE_VIEW_MIN_SAMPLES', min: 3, max: 10, step: 1, kind: 'feedback' },
  { path: 'formThresholds.LOW_CONFIDENCE_MAX_RATE', min: 0.15, max: 0.6, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.KNEE_METRIC_MIN_SAMPLES', min: 1, max: 12, step: 1, kind: 'feedback' },
  { path: 'formThresholds.KNEE_METRIC_MIN_SAMPLE_RATE', min: 0.1, max: 0.8, step: 0.05, kind: 'feedback' },
  { path: 'penaltyConfigs.FLEXION_ROM.cap', min: 20, max: 60, step: 5, kind: 'scoring' },
  { path: 'penaltyConfigs.FLEXION_ROM.deadzone', min: 0, max: 0.05, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.FLEXION_ROM.scale', min: 500, max: 2500, step: 100, kind: 'scoring' },
  { path: 'penaltyConfigs.EXTENSION_ROM.cap', min: 15, max: 50, step: 5, kind: 'scoring' },
  { path: 'penaltyConfigs.EXTENSION_ROM.deadzone', min: 0, max: 0.05, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.EXTENSION_ROM.scale', min: 1000, max: 6000, step: 250, kind: 'scoring' },
  { path: 'penaltyConfigs.KNEE_FLEXION_ROM.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.KNEE_FLEXION_ROM.deadzone', min: 0, max: 10, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.KNEE_FLEXION_ROM.scale', min: 0.01, max: 0.10, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.KNEE_EXTENSION_ROM.cap', min: 0, max: 20, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.KNEE_EXTENSION_ROM.deadzone', min: 0, max: 10, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.KNEE_EXTENSION_ROM.scale', min: 0.01, max: 0.10, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.HIP_LIFT.cap', min: 10, max: 45, step: 5, kind: 'scoring' },
  { path: 'penaltyConfigs.HIP_LIFT.deadzone', min: 0, max: 18, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.HIP_LIFT.scale', min: 0.05, max: 0.5, step: 0.05, kind: 'scoring' },
  { path: 'penaltyConfigs.HIP_RISE.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.HIP_RISE.deadzone', min: 0, max: 0.08, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.HIP_RISE.scale', min: 5000, max: 40000, step: 1000, kind: 'scoring' },
  { path: 'penaltyConfigs.THIGH_MOVEMENT.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.THIGH_MOVEMENT.deadzone', min: 0, max: 0.10, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.THIGH_MOVEMENT.scale', min: 1000, max: 15000, step: 500, kind: 'scoring' },
  { path: 'penaltyConfigs.TOP_HOLD.cap', min: 0, max: 10, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TOP_HOLD.deadzone', min: 0, max: 0.10, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.TOP_HOLD.scale', min: 40, max: 300, step: 20, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_CURL.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_CURL.scale', min: 20, max: 160, step: 10, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_LOWER.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_LOWER.scale', min: 15, max: 120, step: 5, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_JERK.cap', min: 0, max: 20, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_JERK.deadzone', min: 0, max: 3, step: 0.1, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_JERK.scale', min: 0.5, max: 8, step: 0.5, kind: 'scoring' },
] satisfies NumericTunable[]).forEach(upsertLyingLegCurlTunable);

LYING_LEG_CURL_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'lying-leg-curl.rom_curl_short', metricKey: 'curlDepthRatio', thresholdPath: 'formThresholds.FLEXION_FAIL', direction: 'above' },
  { issueId: 'lying-leg-curl.rom_curl_short', metricKey: 'kneeFlexionAngle', thresholdPath: 'formThresholds.KNEE_FLEXION_FAIL', direction: 'above' },
  { issueId: 'lying-leg-curl.rom_extend_short', metricKey: 'extensionRatio', thresholdPath: 'formThresholds.EXTENSION_FAIL', direction: 'below' },
  { issueId: 'lying-leg-curl.rom_extend_short', metricKey: 'kneeExtensionAngle', thresholdPath: 'formThresholds.KNEE_EXTENSION_FAIL', direction: 'below' },
  { issueId: 'lying-leg-curl.hip_lift', metricKey: 'hipDelta', thresholdPath: 'formThresholds.HIP_LIFT_WARN', direction: 'above' },
  { issueId: 'lying-leg-curl.hip_lift', metricKey: 'hipRiseRatio', thresholdPath: 'formThresholds.HIP_RISE_RATIO_WARN', direction: 'above' },
  { issueId: 'lying-leg-curl.thigh_movement', metricKey: 'thighDriftRatio', thresholdPath: 'formThresholds.THIGH_DRIFT_RATIO_WARN', direction: 'above' },
  { issueId: 'lying-leg-curl.top_hold_short', metricKey: 'topHoldSeconds', thresholdPath: 'formThresholds.TOP_HOLD_MIN', direction: 'below' },
  { issueId: 'lying-leg-curl.tempo_up', metricKey: 'tCurl', thresholdPath: 'formThresholds.TEMPO_CURL_MIN', direction: 'below' },
  { issueId: 'lying-leg-curl.tempo_down', metricKey: 'tLower', thresholdPath: 'formThresholds.TEMPO_LOWER_MIN', direction: 'below' },
  { issueId: 'lying-leg-curl.tempo_jerk', metricKey: 'velocitySpikeRatio', thresholdPath: 'formThresholds.TEMPO_JERK_SPIKE_WARN', direction: 'above' },
  { issueId: 'lying-leg-curl.side_view_uncertain', metricKey: 'sideViewConfidence', thresholdPath: 'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN', direction: 'below' },
  { issueId: 'lying-leg-curl.side_view_uncertain', metricKey: 'sideViewConfidenceMin', thresholdPath: 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', direction: 'below' },
];

const LYING_LEG_CURL_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withLyingLegCurlConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, LYING_LEG_CURL_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LyingLegCurlPhase = 'REST' | 'CURLING' | 'CURLED' | 'LOWERING';

interface LyingLegCurlFSM {
  phase: LyingLegCurlPhase;
  /** Timestamp when curl began (REST -> CURLING) */
  tRepStart: number | null;
  /** Timestamp when the user first moved out of full extension */
  tCurlStart: number | null;
  /** Timestamp when peak flexion was reached */
  tCurled: number | null;
  /** Timestamp when rep completed (LOWERING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min ratio during rep (should be low -- peak flexion) */
  minRatio: number;
  ratioSamples: number[];
  /** Max ratio during rep (should be high -- full extension at start/end) */
  maxRatio: number;
  /** Min knee angle during rep (should be low -- peak flexion) */
  minKneeAngle: number;
  /** Max knee angle during rep (should be high -- full extension) */
  maxKneeAngle: number;
  kneeAngleSamples: number[];
  kneeAngleSampleCount: number;
  kneeAngleConfidenceSum: number;
  /** Return/lowering phase extension samples. Starting extension must not mask a short return. */
  returnRatioSamples: number[];
  returnMaxRatio: number;
  returnKneeAngleSamples: number[];
  returnMaxKneeAngle: number;
  returnKneeAngleSampleCount: number;
  returnKneeAngleConfidenceSum: number;
  /** Hip angle at rep start (baseline for detecting lift) */
  hipAngleBaseline: number | null;
  /** Max absolute hip angle delta from baseline during rep */
  maxHipDelta: number;
  hipDeltaSamples: number[];
  hipYBaseline: number | null;
  maxHipRiseRatio: number;
  hipRiseRatioSamples: number[];
  hipRiseSampleCount: number;
  thighVectorBaseline: Point2D | null;
  maxThighDriftRatio: number;
  thighDriftRatioSamples: number[];
  thighDriftSampleCount: number;
  distalEndpointCounts: Record<DistalEndpointName, number>;
  /** Low-confidence form-critical samples during the active rep */
  lowConfidenceFrames: number;
  /** Time accumulated near peak curl with very low ratio velocity */
  topHoldSeconds: number;
  /** Ratio-velocity samples for jerk/bounce detection */
  lastRatioForVelocity: number | null;
  lastRatioVelocityAt: number | null;
  velocitySamples: number;
  velocitySum: number;
  velocitySampleValues: number[];
  curlVelocitySampleValues: number[];
  lowerVelocitySampleValues: number[];
  maxVelocity: number;
  maxCurlVelocity: number;
  maxLowerVelocity: number;
  /** Side-view confidence across the rep */
  sideViewConfidenceSamples: number;
  sideViewConfidenceSum: number;
  sideViewConfidenceMin: number;
  /** Timestamps */
  tStart: number;
  tCurled: number | null;
  tLowerStart: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
  scorable?: boolean;
  qualityWarnings?: FrameworkRepResult['qualityWarnings'];
  diagnostics?: FrameworkRepResult['diagnostics'];
}

interface PendingCompletedRep {
  window: RepWindow;
  visibleSide: 'left' | 'right';
  completedAt: number;
}

interface LyingLegCurlState {
  fsm: LyingLegCurlFSM;
  repCount: number;
  repWindow: RepWindow | null;
  pendingCompletedRep: PendingCompletedRep | null;
  lastRepResult: RepResult | null;
  /** Smoothed trackers */
  ratioTracker: SmoothedAngleTracker;
  hipTracker: SmoothedAngleTracker;
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
  /** Feedback */
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
  /** Maximum smoothed ratio observed in REST before the current rep starts */
  restMaxRatio: number;
  /** Maximum knee angle observed in REST before the current rep starts */
  restMaxKneeAngle: number;
  restRatioSamples: number[];
  restKneeAngleSamples: number[];
  restHipAngleSamples: number[];
  restHipYSamples: number[];
  restThighVectorSamples: Point2D[];
}

interface LyingLegCurlDebugInfo {
  phase: LyingLegCurlPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  ratio: number | null;
  fastRatio: number | null;
  kneeAngle: number | null;
  hipAngle: number | null;
  hipRiseRatio: number | null;
  // Rep window
  ratioMin: number | null;
  ratioMax: number | null;
  kneeAngleMin: number | null;
  kneeAngleMax: number | null;
  hipDelta: number | null;
  hipRiseMax: number | null;
  thighDriftRatio: number | null;
  distalEndpoint: string | null;
  topHoldSeconds: number | null;
  velocitySpikeRatio: number | null;
  sideViewConfidence: number | null;
  scorable: boolean | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): LyingLegCurlFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tCurlStart: null,
    tCurled: null,
    tRepEnd: null,
  };
}

function initRepWindow(
  tStart: number,
  initialRatio?: number,
  initialKneeAngle?: number | null,
): RepWindow {
  const hasInitialKneeAngle = finiteMetric(initialKneeAngle);
  return {
    minRatio: initialRatio ?? Infinity,
    ratioSamples: [],
    maxRatio: initialRatio ?? -Infinity,
    minKneeAngle: hasInitialKneeAngle ? initialKneeAngle : Infinity,
    maxKneeAngle: hasInitialKneeAngle ? initialKneeAngle : -Infinity,
    kneeAngleSamples: [],
    kneeAngleSampleCount: 0,
    kneeAngleConfidenceSum: 0,
    returnRatioSamples: [],
    returnMaxRatio: -Infinity,
    returnKneeAngleSamples: [],
    returnMaxKneeAngle: -Infinity,
    returnKneeAngleSampleCount: 0,
    returnKneeAngleConfidenceSum: 0,
    hipAngleBaseline: null,
    maxHipDelta: 0,
    hipDeltaSamples: [],
    hipYBaseline: null,
    maxHipRiseRatio: 0,
    hipRiseRatioSamples: [],
    hipRiseSampleCount: 0,
    thighVectorBaseline: null,
    maxThighDriftRatio: 0,
    thighDriftRatioSamples: [],
    thighDriftSampleCount: 0,
    distalEndpointCounts: {
      ankle: 0,
      heel: 0,
      foot_index: 0,
    },
    lowConfidenceFrames: 0,
    topHoldSeconds: 0,
    lastRatioForVelocity: null,
    lastRatioVelocityAt: null,
    velocitySamples: 0,
    velocitySum: 0,
    velocitySampleValues: [],
    curlVelocitySampleValues: [],
    lowerVelocitySampleValues: [],
    maxVelocity: 0,
    maxCurlVelocity: 0,
    maxLowerVelocity: 0,
    sideViewConfidenceSamples: 0,
    sideViewConfidenceSum: 0,
    sideViewConfidenceMin: Infinity,
    tStart,
    tCurled: null,
    tLowerStart: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function initializeLyingLegCurlState(): LyingLegCurlState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    pendingCompletedRep: null,
    lastRepResult: null,
    ratioTracker: new SmoothedAngleTracker(),
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
    smoothedRatio: null,
    fastRatio: null,
    currentKneeAngle: null,
    currentHipRiseRatio: null,
    smoothedHip: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
    restMaxRatio: -Infinity,
    restMaxKneeAngle: -Infinity,
    restRatioSamples: [],
    restKneeAngleSamples: [],
    restHipAngleSamples: [],
    restHipYSamples: [],
    restThighVectorSamples: [],
  };
}

function resetRestBaselines(state: LyingLegCurlState): void {
  state.restMaxRatio = -Infinity;
  state.restMaxKneeAngle = -Infinity;
  state.restRatioSamples = [];
  state.restKneeAngleSamples = [];
  state.restHipAngleSamples = [];
  state.restHipYSamples = [];
  state.restThighVectorSamples = [];
}

// ============================================================================
// VISIBLE SIDE SELECTION
// ============================================================================

function selectVisibleSide(keypoints: Keypoint[]): 'left' | 'right' {
  const leftParts = ['left_hip', 'left_knee', 'left_shoulder'];
  const rightParts = ['right_hip', 'right_knee', 'right_shoulder'];

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
  leftScore += selectDistalEndpoint(keypoints, 'left', 0)?.keypoint.score ?? 0;
  rightScore += selectDistalEndpoint(keypoints, 'right', 0)?.keypoint.score ?? 0;

  return leftScore >= rightScore ? 'left' : 'right';
}

function signalSourceKeypoints(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
): Keypoint[] {
  return frameContext?.imageKeypoints ?? fallbackKeypoints;
}

function visibleKeypoint(
  keypoints: Keypoint[],
  name: string,
  threshold = VISIBILITY_THRESHOLD,
): Keypoint | null {
  const keypoint = getKeypoint(keypoints, name);
  return isVisible(keypoint, threshold) ? keypoint : null;
}

function distalEndpointKey(side: 'left' | 'right', endpoint: DistalEndpointName): string {
  return `${side}_${endpoint}`;
}

function selectDistalEndpoint(
  keypoints: Keypoint[],
  side: 'left' | 'right',
  threshold = VISIBILITY_THRESHOLD,
): DistalEndpoint | null {
  for (const endpoint of ['ankle', 'heel', 'foot_index'] satisfies DistalEndpointName[]) {
    const keypoint = visibleKeypoint(keypoints, distalEndpointKey(side, endpoint), threshold);
    if (keypoint) return { name: endpoint, keypoint };
  }
  return null;
}

function distalEndpointConfidence(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number {
  const endpoint = selectDistalEndpoint(keypoints, side, 0);
  return endpoint?.keypoint.score ?? 0;
}

// ============================================================================
// RATIO & ANGLE CALCULATION
// ============================================================================

/**
 * Calculate the knee reach ratio (hip-ankle / chain) in 2D.
 * ~0.96-0.98 when legs extended, ~0.35-0.50 when fully curled.
 */
function calculateKneeRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right',
  distalEndpoint = selectDistalEndpoint(keypoints, side),
): number | null {
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  const knee = visibleKeypoint(keypoints, `${side}_knee`);
  if (!hip || !knee || !distalEndpoint) return null;

  const hipPt = getPoint(hip)!;
  const kneePt = getPoint(knee)!;
  const distalPt = getPoint(distalEndpoint.keypoint)!;

  return computeReachRatio(hipPt, kneePt, distalPt);
}

function calculateKneeAngle(
  keypoints: Keypoint[],
  side: 'left' | 'right',
  distalEndpoint = selectDistalEndpoint(keypoints, side),
): number | null {
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  const knee = visibleKeypoint(keypoints, `${side}_knee`);
  if (!hip || !knee || !distalEndpoint) return null;

  const value = calculateAngle2D(
    getPoint(hip)!,
    getPoint(knee)!,
    getPoint(distalEndpoint.keypoint)!,
  );
  return finiteMetric(value) && value > 0 && value <= 180 ? value : null;
}

function calculateLegChainLength(
  keypoints: Keypoint[],
  side: 'left' | 'right',
  distalEndpoint = selectDistalEndpoint(keypoints, side),
): number | null {
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  const knee = visibleKeypoint(keypoints, `${side}_knee`);
  if (!hip || !knee || !distalEndpoint) return null;

  const length =
    dist2D(getPoint(hip)!, getPoint(knee)!) +
    dist2D(getPoint(knee)!, getPoint(distalEndpoint.keypoint)!);
  return length > 1e-6 ? length : null;
}

function calculateHipRiseRatio(
  currentHipY: number,
  baselineHipY: number,
  legChainLength: number | null,
): number | null {
  if (!legChainLength || legChainLength <= 1e-6) return null;
  return Math.max(0, (baselineHipY - currentHipY) / legChainLength);
}

function calculateThighVector(keypoints: Keypoint[], side: 'left' | 'right'): Point2D | null {
  const hip = visibleKeypoint(keypoints, `${side}_hip`, FORM_CONFIDENCE_MIN);
  const knee = visibleKeypoint(keypoints, `${side}_knee`, FORM_CONFIDENCE_MIN);
  if (!hip || !knee) return null;
  return {
    x: knee.x - hip.x,
    y: knee.y - hip.y,
  };
}

function calculateThighDriftRatio(
  currentVector: Point2D,
  baselineVector: Point2D,
  legChainLength: number | null,
): number | null {
  if (!legChainLength || legChainLength <= 1e-6) return null;
  return dist2D(currentVector, baselineVector) / legChainLength;
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
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`);
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  const knee = visibleKeypoint(keypoints, `${side}_knee`);
  if (!shoulder || !hip || !knee) return null;

  return calculateAngle2D(
    getPoint(shoulder)!,
    getPoint(hip)!,
    getPoint(knee)!
  );
}

function sideBodyLength(keypoints: Keypoint[], side: 'left' | 'right'): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`);
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  const knee = visibleKeypoint(keypoints, `${side}_knee`);
  const distalEndpoint = selectDistalEndpoint(keypoints, side);
  if (!shoulder || !hip || !knee || !distalEndpoint) return null;

  const length =
    dist2D(getPoint(shoulder)!, getPoint(hip)!) +
    dist2D(getPoint(hip)!, getPoint(knee)!) +
    dist2D(getPoint(knee)!, getPoint(distalEndpoint.keypoint)!);
  return length > 1e-6 ? length : null;
}

function calculateSideViewConfidence(keypoints: Keypoint[]): number | null {
  const widths: number[] = [];
  for (const joint of ['shoulder', 'hip', 'knee']) {
    const left = visibleKeypoint(keypoints, `left_${joint}`);
    const right = visibleKeypoint(keypoints, `right_${joint}`);
    if (left && right) widths.push(dist2D(getPoint(left)!, getPoint(right)!));
  }
  const leftDistal = selectDistalEndpoint(keypoints, 'left');
  const rightDistal = selectDistalEndpoint(keypoints, 'right');
  if (leftDistal && rightDistal) {
    widths.push(dist2D(getPoint(leftDistal.keypoint)!, getPoint(rightDistal.keypoint)!));
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

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: LyingLegCurlFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: LyingLegCurlFSM,
  ratio: number,
  t: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Legs extended (high ratio). When ratio drops, begin curl.
      if (ratio < THRESHOLDS.CURL_CLOCK_START) {
        fsm.tCurlStart ??= t;
      } else {
        fsm.tCurlStart = null;
      }

      if (ratio < THRESHOLDS.CURLING_ENTER) {
        fsm.phase = 'CURLING';
        fsm.tRepStart = fsm.tCurlStart ?? t;
        fsm.tCurled = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'CURLING':
      // Actively curling up. When peak flexion reached (low ratio), transition.
      if (ratio < THRESHOLDS.CURLED_ENTER) {
        fsm.phase = 'CURLED';
        fsm.tCurled = t;
      } else if (ratio > THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Extended back out without curling far enough -- reset
        fsm.phase = 'REST';
        fsm.tRepStart = null;
        fsm.tCurlStart = null;
      }
      break;

    case 'CURLED':
      // At peak flexion (low ratio). When ratio rises back (hysteresis), transition.
      if (ratio > THRESHOLDS.CURLED_EXIT) {
        fsm.phase = 'LOWERING';
      }
      break;

    case 'LOWERING':
      // Controlled eccentric. When legs return to extended position (high ratio), rep complete.
      if (
        ratio > THRESHOLDS.REST_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'REST';
        fsm.tRepEnd = t;
        repCompleted = true;
      } else if (ratio < THRESHOLDS.CURLED_ENTER) {
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

const FEEDBACK = {
  CURL_SHORT: 'Curl higher \u2014 bring your heels closer to your glutes.',
  EXTEND_SHORT: 'Extend fully \u2014 straighten your legs at the bottom.',
  HIP_LIFT: 'Keep your hips down \u2014 avoid lifting off the pad.',
  TEMPO_CURL: 'Slow down the curl \u2014 control the contraction.',
  TEMPO_LOWER: 'Control the descent \u2014 lower the weight slowly.',
  TOP_HOLD: 'Pause briefly at the top \u2014 squeeze your hamstrings.',
  TEMPO_JERK: 'Move smoothly \u2014 avoid bouncing the weight.',
  SIDE_VIEW: 'Turn fully side-on so I can judge your leg curl.',
  THIGH_MOVEMENT: 'Keep your thighs down \u2014 only your lower legs should move.',
  TRACKING_SETUP: 'Keep your hips, knees, and lower legs visible so I can judge your curl.',
} as const;

function hasKneeAngleSamples(repWindow: RepWindow): boolean {
  const sampleRate = repWindow.frameCount > 0
    ? repWindow.kneeAngleSampleCount / repWindow.frameCount
    : 0;
  return repWindow.kneeAngleSampleCount >= FORM_THRESHOLDS.KNEE_METRIC_MIN_SAMPLES &&
    sampleRate >= FORM_THRESHOLDS.KNEE_METRIC_MIN_SAMPLE_RATE &&
    Number.isFinite(repWindow.minKneeAngle) &&
    Number.isFinite(repWindow.maxKneeAngle);
}

function returnExtensionRatio(repWindow: RepWindow): number {
  return Number.isFinite(repWindow.returnMaxRatio)
    ? repWindow.returnMaxRatio
    : repWindow.maxRatio;
}

function hasReturnKneeAngleSamples(repWindow: RepWindow): boolean {
  const sampleRate = repWindow.returnRatioSamples.length > 0
    ? repWindow.returnKneeAngleSampleCount / repWindow.returnRatioSamples.length
    : 0;
  return repWindow.returnKneeAngleSampleCount >= FORM_THRESHOLDS.KNEE_METRIC_MIN_SAMPLES &&
    sampleRate >= FORM_THRESHOLDS.KNEE_METRIC_MIN_SAMPLE_RATE &&
    Number.isFinite(repWindow.returnMaxKneeAngle);
}

function averageKneeAngleConfidence(repWindow: RepWindow): number | null {
  if (repWindow.kneeAngleSampleCount === 0) return null;
  return repWindow.kneeAngleConfidenceSum / repWindow.kneeAngleSampleCount;
}

function averageReturnKneeAngleConfidence(repWindow: RepWindow): number | null {
  if (repWindow.returnKneeAngleSampleCount === 0) return null;
  return repWindow.returnKneeAngleConfidenceSum / repWindow.returnKneeAngleSampleCount;
}

function averageSideViewConfidence(repWindow: RepWindow): number | null {
  if (repWindow.sideViewConfidenceSamples === 0) return null;
  return repWindow.sideViewConfidenceSum / repWindow.sideViewConfidenceSamples;
}

function topHoldSeconds(repWindow: RepWindow): number | null {
  if (repWindow.tCurled === null) return null;
  return repWindow.topHoldSeconds;
}

function velocitySpikeRatio(repWindow: RepWindow): number | null {
  if (repWindow.velocitySamples === 0) return null;
  const mean = repWindow.velocitySum / repWindow.velocitySamples;
  if (mean <= 1e-6) return null;
  return repWindow.maxVelocity / mean;
}

function mostUsedDistalEndpoint(repWindow: RepWindow): DistalEndpointName | null {
  let bestEndpoint: DistalEndpointName | null = null;
  let bestCount = 0;
  for (const endpoint of ['ankle', 'heel', 'foot_index'] satisfies DistalEndpointName[]) {
    const count = repWindow.distalEndpointCounts[endpoint];
    if (count > bestCount) {
      bestEndpoint = endpoint;
      bestCount = count;
    }
  }
  return bestEndpoint;
}

function curlDepthShort(repWindow: RepWindow): boolean {
  return (
    repWindow.minRatio > FORM_THRESHOLDS.FLEXION_FAIL ||
    (hasKneeAngleSamples(repWindow) && repWindow.minKneeAngle > FORM_THRESHOLDS.KNEE_FLEXION_FAIL)
  );
}

function extensionShort(repWindow: RepWindow): boolean {
  return (
    returnExtensionRatio(repWindow) < FORM_THRESHOLDS.EXTENSION_FAIL ||
    (hasReturnKneeAngleSamples(repWindow) && repWindow.returnMaxKneeAngle < FORM_THRESHOLDS.KNEE_EXTENSION_FAIL)
  );
}

function hipLiftTriggered(repWindow: RepWindow): boolean {
  return (
    repWindow.maxHipDelta > FORM_THRESHOLDS.HIP_LIFT_WARN ||
    repWindow.maxHipRiseRatio > FORM_THRESHOLDS.HIP_RISE_RATIO_WARN
  );
}

function thighMovementTriggered(repWindow: RepWindow): boolean {
  return repWindow.maxThighDriftRatio > FORM_THRESHOLDS.THIGH_DRIFT_RATIO_WARN;
}

function topHoldShort(repWindow: RepWindow): boolean {
  const hold = topHoldSeconds(repWindow);
  return hold !== null && hold < FORM_THRESHOLDS.TOP_HOLD_MIN;
}

function tempoJerkTriggered(repWindow: RepWindow): boolean {
  const spikeRatio = velocitySpikeRatio(repWindow);
  return (
    repWindow.maxCurlVelocity > FORM_THRESHOLDS.TEMPO_JERK_VELOCITY_WARN ||
    repWindow.maxLowerVelocity > FORM_THRESHOLDS.TEMPO_JERK_VELOCITY_WARN ||
    (spikeRatio !== null && spikeRatio > FORM_THRESHOLDS.TEMPO_JERK_SPIKE_WARN)
  );
}

function sideViewIsScorable(repWindow: RepWindow): boolean {
  if (repWindow.sideViewConfidenceSamples < FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES) return true;
  const averageConfidence = averageSideViewConfidence(repWindow);
  if (averageConfidence === null) return true;
  return (
    averageConfidence >= FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN &&
    repWindow.sideViewConfidenceMin >= FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN
  );
}

function primaryConfidenceIsScorable(repWindow: RepWindow): boolean {
  if (repWindow.frameCount === 0) return false;
  const lowRate = repWindow.lowConfidenceFrames / repWindow.frameCount;
  return lowRate <= FORM_THRESHOLDS.LOW_CONFIDENCE_MAX_RATE;
}

function isLyingLegCurlRepScorable(repWindow: RepWindow): boolean {
  return sideViewIsScorable(repWindow) && primaryConfidenceIsScorable(repWindow);
}

function lyingLegCurlQualityWarnings(repWindow: RepWindow): FrameworkRepResult['qualityWarnings'] {
  const warnings: FrameworkRepResult['qualityWarnings'] = [];
  if (!sideViewIsScorable(repWindow)) warnings.push('side_view_uncertain');
  if (!primaryConfidenceIsScorable(repWindow)) warnings.push('missing_required_joints');
  return warnings;
}

function buildLyingLegCurlViewQuality(repWindow: RepWindow): RepViewQualityDiagnostic {
  const averageConfidence = averageSideViewConfidence(repWindow);
  const hasEnoughSamples =
    repWindow.sideViewConfidenceSamples >= FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES &&
    averageConfidence !== null;
  const bilateralSideConfirmed = Boolean(
    hasEnoughSamples &&
    averageConfidence! >= FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN &&
    repWindow.sideViewConfidenceMin >= FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN,
  );
  const frontishConfirmed = Boolean(hasEnoughSamples && !bilateralSideConfirmed);
  const singleSideConfirmed = Boolean(!hasEnoughSamples && primaryConfidenceIsScorable(repWindow));
  const sideConfirmed = bilateralSideConfirmed || singleSideConfirmed;
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
    sampleCount: repWindow.sideViewConfidenceSamples,
  };
}

function computeLyingLegCurlScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM -- flexion: ideal minRatio is configurable. Excess = max(0, minRatio - ideal)
  const flexionExcess = Math.max(0, repWindow.minRatio - FORM_THRESHOLDS.FLEXION_IDEAL_RATIO);
  penalties.push({ value: flexionExcess, config: PENALTY_CONFIGS.FLEXION_ROM });

  // 2. ROM -- extension: use return-phase extension so starting posture cannot hide a short return.
  const extensionShortfall = Math.max(0, FORM_THRESHOLDS.EXTENSION_IDEAL_RATIO - returnExtensionRatio(repWindow));
  penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });

  if (hasKneeAngleSamples(repWindow)) {
    const kneeFlexionExcess = Math.max(0, repWindow.minKneeAngle - FORM_THRESHOLDS.KNEE_FLEXION_IDEAL);
    penalties.push({ value: kneeFlexionExcess, config: PENALTY_CONFIGS.KNEE_FLEXION_ROM });
  }

  if (hasReturnKneeAngleSamples(repWindow)) {
    const kneeExtensionShortfall = Math.max(0, FORM_THRESHOLDS.KNEE_EXTENSION_IDEAL - repWindow.returnMaxKneeAngle);
    penalties.push({ value: kneeExtensionShortfall, config: PENALTY_CONFIGS.KNEE_EXTENSION_ROM });
  }

  // 3. Hip lift (hip angle delta + normalized vertical hip rise)
  penalties.push({ value: repWindow.maxHipDelta, config: PENALTY_CONFIGS.HIP_LIFT });
  penalties.push({ value: repWindow.maxHipRiseRatio, config: PENALTY_CONFIGS.HIP_RISE });
  penalties.push({ value: repWindow.maxThighDriftRatio, config: PENALTY_CONFIGS.THIGH_MOVEMENT });

  const hold = topHoldSeconds(repWindow);
  if (hold !== null && hold < FORM_THRESHOLDS.TOP_HOLD_MIN) {
    const deficit = FORM_THRESHOLDS.TOP_HOLD_MIN - hold;
    penalties.push({ value: deficit, config: PENALTY_CONFIGS.TOP_HOLD });
  }

  // 4. Tempo and jerk/bounce
  if (repWindow.tCurled !== null) {
    const tCurl = repWindow.tCurled - repWindow.tStart;    // concentric (curl up)
    const tLower = repWindow.tEnd - (repWindow.tLowerStart ?? repWindow.tCurled); // eccentric (lower down)

    // Penalize against the same thresholds that drive feedback.
    if (tCurl > 0 && tCurl < FORM_THRESHOLDS.TEMPO_CURL_MIN) {
      const deficit = FORM_THRESHOLDS.TEMPO_CURL_MIN - tCurl;
      penalties.push({ value: deficit, config: PENALTY_CONFIGS.TEMPO_CURL });
    }
    if (tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN) {
      const deficit = FORM_THRESHOLDS.TEMPO_LOWER_MIN - tLower;
      penalties.push({ value: deficit, config: PENALTY_CONFIGS.TEMPO_LOWER });
    }
  }

  const spikeRatio = velocitySpikeRatio(repWindow);
  const jerkExcess = Math.max(
    spikeRatio !== null ? spikeRatio - FORM_THRESHOLDS.TEMPO_JERK_SPIKE_WARN : 0,
    repWindow.maxCurlVelocity - FORM_THRESHOLDS.TEMPO_JERK_VELOCITY_WARN,
    repWindow.maxLowerVelocity - FORM_THRESHOLDS.TEMPO_JERK_VELOCITY_WARN,
    0,
  );
  penalties.push({ value: jerkExcess, config: PENALTY_CONFIGS.TEMPO_JERK });

  return computeScore(penalties);
}

// ============================================================================
// FORM MESSAGES (discrete thresholds)
// ============================================================================

function generateFormMessages(repWindow: RepWindow): string[] {
  const messages: string[] = [];

  // 1. Flexion ROM -- didn't curl far enough (minRatio too high)
  if (curlDepthShort(repWindow)) {
    messages.push(FEEDBACK.CURL_SHORT);
  }

  // 2. Extension ROM -- didn't straighten fully (maxRatio too low)
  if (extensionShort(repWindow)) {
    messages.push(FEEDBACK.EXTEND_SHORT);
  }

  // 3. Hip lift
  if (hipLiftTriggered(repWindow)) {
    messages.push(FEEDBACK.HIP_LIFT);
  }

  if (thighMovementTriggered(repWindow)) {
    messages.push(FEEDBACK.THIGH_MOVEMENT);
  }

  if (topHoldShort(repWindow)) {
    messages.push(FEEDBACK.TOP_HOLD);
  }

  // 4. Tempo
  if (repWindow.tCurled !== null) {
    const tCurl = repWindow.tCurled - repWindow.tStart;
    const tLower = repWindow.tEnd - (repWindow.tLowerStart ?? repWindow.tCurled);

    if (tCurl > 0 && tCurl < FORM_THRESHOLDS.TEMPO_CURL_MIN) {
      messages.push(FEEDBACK.TEMPO_CURL);
    }
    if (tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN) {
      messages.push(FEEDBACK.TEMPO_LOWER);
    }
  }

  if (tempoJerkTriggered(repWindow)) {
    messages.push(FEEDBACK.TEMPO_JERK);
  }

  if (!sideViewIsScorable(repWindow)) {
    messages.push(FEEDBACK.SIDE_VIEW);
  }

  return messages;
}

function buildLyingLegCurlDiagnostics(
  repWindow: RepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
  scorable: boolean,
): FrameworkRepResult['diagnostics'] {
  const hasTempo = repWindow.tCurled !== null;
  const tCurl = repWindow.tCurled !== null ? repWindow.tCurled - repWindow.tStart : null;
  const tLower = repWindow.tCurled !== null ? repWindow.tEnd - (repWindow.tLowerStart ?? repWindow.tCurled) : null;
  const hasKnee = hasKneeAngleSamples(repWindow);
  const hasReturnKnee = hasReturnKneeAngleSamples(repWindow);
  const hasHipAngle = repWindow.hipDeltaSamples.length > 0;
  const hasHipRise = repWindow.hipRiseSampleCount > 0;
  const hasSideViewConfidence = repWindow.sideViewConfidenceSamples >= FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES;
  const sideViewConfidence = averageSideViewConfidence(repWindow);
  const spikeRatio = velocitySpikeRatio(repWindow);
  const hold = topHoldSeconds(repWindow);
  const viewQuality = buildLyingLegCurlViewQuality(repWindow);
  const distalEndpoint = mostUsedDistalEndpoint(repWindow);
  const extensionRatio = returnExtensionRatio(repWindow);
  return buildRepDiagnostics({
    exerciseName: 'Lying Leg Curl',
    repIndex,
    scorable,
    view: viewQuality.sideConfirmed ? 'side' : viewQuality.frontishConfirmed ? 'front' : 'unknown',
    selectedSide: visibleSide,
    viewQuality,
    metrics: [
      diagnosticMetric('curlDepthRatio', repWindow.minRatio, { unit: 'ratio' }),
      diagnosticMetric('extensionRatio', extensionRatio, {
        unit: 'ratio',
        sampleCount: repWindow.returnRatioSamples.length,
      }),
      diagnosticMetric('romRatio', repWindow.maxRatio - repWindow.minRatio, { unit: 'ratio' }),
      diagnosticLabelMetric('distalEndpoint', distalEndpoint, {
        sampleCount: Object.values(repWindow.distalEndpointCounts).reduce((sum, count) => sum + count, 0),
        skippedReason: 'distal_endpoint_unavailable',
      }),
      diagnosticMetric('kneeFlexionAngle', hasKnee ? repWindow.minKneeAngle : null, {
        unit: 'degrees',
        eligible: hasKnee,
        confidence: averageKneeAngleConfidence(repWindow) ?? undefined,
        sampleCount: repWindow.kneeAngleSampleCount,
        skippedReason: 'insufficient_knee_angle_samples',
      }),
      diagnosticMetric('kneeExtensionAngle', hasReturnKnee ? repWindow.returnMaxKneeAngle : null, {
        unit: 'degrees',
        eligible: hasReturnKnee,
        confidence: averageReturnKneeAngleConfidence(repWindow) ?? undefined,
        sampleCount: repWindow.returnKneeAngleSampleCount,
        skippedReason: 'insufficient_return_knee_angle_samples',
      }),
      diagnosticMetric('hipDelta', hasHipAngle ? repWindow.maxHipDelta : null, {
        unit: 'degrees',
        eligible: hasHipAngle,
        sampleCount: repWindow.hipDeltaSamples.length,
        skippedReason: 'insufficient_hip_angle_samples',
      }),
      diagnosticMetric('hipRiseRatio', repWindow.maxHipRiseRatio, {
        unit: 'ratio',
        eligible: hasHipRise,
        sampleCount: repWindow.hipRiseSampleCount,
        skippedReason: 'insufficient_hip_rise_samples',
      }),
      diagnosticMetric('thighDriftRatio', repWindow.maxThighDriftRatio, {
        unit: 'ratio',
        eligible: repWindow.thighDriftSampleCount > 0,
        sampleCount: repWindow.thighDriftSampleCount,
        skippedReason: 'insufficient_thigh_drift_samples',
      }),
      diagnosticMetric('topHoldSeconds', hold, {
        unit: 'seconds',
        eligible: hold !== null,
        skippedReason: 'curled_position_not_detected',
      }),
      diagnosticMetric('tCurl', tCurl, { unit: 'seconds', eligible: hasTempo, skippedReason: 'curled_position_not_detected' }),
      diagnosticMetric('tLower', tLower, { unit: 'seconds', eligible: hasTempo, skippedReason: 'curled_position_not_detected' }),
      diagnosticMetric('velocitySpikeRatio', spikeRatio, {
        eligible: spikeRatio !== null,
        sampleCount: repWindow.velocitySamples,
        skippedReason: 'insufficient_velocity_samples',
      }),
      diagnosticMetric('maxCurlVelocity', repWindow.maxCurlVelocity),
      diagnosticMetric('maxLowerVelocity', repWindow.maxLowerVelocity),
      diagnosticMetric('sideViewConfidence', sideViewConfidence, {
        unit: 'ratio',
        eligible: hasSideViewConfidence,
        sampleCount: repWindow.sideViewConfidenceSamples,
        skippedReason: 'insufficient_side_view_samples',
      }),
      diagnosticMetric('sideViewConfidenceMin', viewQuality.minSideViewConfidence, {
        unit: 'ratio',
        eligible: hasSideViewConfidence,
        sampleCount: repWindow.sideViewConfidenceSamples,
        skippedReason: 'insufficient_side_view_samples',
      }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'lying-leg-curl.rom_curl_short',
        metricKeys: ['curlDepthRatio', 'kneeFlexionAngle'],
        direction: 'above',
        value: repWindow.minRatio,
        thresholdPath: ['formThresholds.FLEXION_FAIL', 'formThresholds.KNEE_FLEXION_FAIL'],
        thresholdValue: {
          FLEXION_FAIL: FORM_THRESHOLDS.FLEXION_FAIL,
          KNEE_FLEXION_FAIL: FORM_THRESHOLDS.KNEE_FLEXION_FAIL,
        },
        triggered: curlDepthShort(repWindow),
      }),
      diagnosticCue({
        issueId: 'lying-leg-curl.rom_extend_short',
        metricKeys: ['extensionRatio', 'kneeExtensionAngle'],
        direction: 'below',
        value: extensionRatio,
        thresholdPath: ['formThresholds.EXTENSION_FAIL', 'formThresholds.KNEE_EXTENSION_FAIL'],
        thresholdValue: {
          EXTENSION_FAIL: FORM_THRESHOLDS.EXTENSION_FAIL,
          KNEE_EXTENSION_FAIL: FORM_THRESHOLDS.KNEE_EXTENSION_FAIL,
        },
        triggered: extensionShort(repWindow),
      }),
      diagnosticCue({
        issueId: 'lying-leg-curl.hip_lift',
        metricKeys: ['hipDelta', 'hipRiseRatio'],
        direction: 'above',
        value: repWindow.maxHipDelta,
        thresholdPath: ['formThresholds.HIP_LIFT_WARN', 'formThresholds.HIP_RISE_RATIO_WARN'],
        thresholdValue: {
          HIP_LIFT_WARN: FORM_THRESHOLDS.HIP_LIFT_WARN,
          HIP_RISE_RATIO_WARN: FORM_THRESHOLDS.HIP_RISE_RATIO_WARN,
        },
        eligible: hasHipAngle || hasHipRise,
        triggered: hipLiftTriggered(repWindow),
        skippedReason: 'insufficient_hip_lift_samples',
      }),
      diagnosticCue({
        issueId: 'lying-leg-curl.thigh_movement',
        metricKeys: ['thighDriftRatio'],
        direction: 'above',
        value: repWindow.maxThighDriftRatio,
        thresholdPath: 'formThresholds.THIGH_DRIFT_RATIO_WARN',
        thresholdValue: FORM_THRESHOLDS.THIGH_DRIFT_RATIO_WARN,
        eligible: repWindow.thighDriftSampleCount > 0,
        triggered: thighMovementTriggered(repWindow),
        skippedReason: 'insufficient_thigh_drift_samples',
      }),
      diagnosticCue({
        issueId: 'lying-leg-curl.top_hold_short',
        metricKeys: ['topHoldSeconds'],
        direction: 'below',
        value: hold,
        thresholdPath: 'formThresholds.TOP_HOLD_MIN',
        thresholdValue: FORM_THRESHOLDS.TOP_HOLD_MIN,
        eligible: hold !== null,
        triggered: topHoldShort(repWindow),
        skippedReason: 'curled_position_not_detected',
      }),
      diagnosticCue({
        issueId: 'lying-leg-curl.tempo_up',
        metricKeys: ['tCurl'],
        direction: 'below',
        value: tCurl,
        thresholdPath: 'formThresholds.TEMPO_CURL_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_CURL_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tCurl !== null && tCurl > 0 && tCurl < FORM_THRESHOLDS.TEMPO_CURL_MIN,
        skippedReason: 'curled_position_not_detected',
      }),
      diagnosticCue({
        issueId: 'lying-leg-curl.tempo_down',
        metricKeys: ['tLower'],
        direction: 'below',
        value: tLower,
        thresholdPath: 'formThresholds.TEMPO_LOWER_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_LOWER_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tLower !== null && tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN,
        skippedReason: 'curled_position_not_detected',
      }),
      diagnosticCue({
        issueId: 'lying-leg-curl.tempo_jerk',
        metricKeys: ['velocitySpikeRatio', 'maxCurlVelocity', 'maxLowerVelocity'],
        direction: 'above',
        value: spikeRatio,
        thresholdPath: ['formThresholds.TEMPO_JERK_SPIKE_WARN', 'formThresholds.TEMPO_JERK_VELOCITY_WARN'],
        thresholdValue: {
          TEMPO_JERK_SPIKE_WARN: FORM_THRESHOLDS.TEMPO_JERK_SPIKE_WARN,
          TEMPO_JERK_VELOCITY_WARN: FORM_THRESHOLDS.TEMPO_JERK_VELOCITY_WARN,
        },
        eligible: spikeRatio !== null,
        triggered: tempoJerkTriggered(repWindow),
        skippedReason: 'insufficient_velocity_samples',
      }),
      diagnosticCue({
        issueId: 'lying-leg-curl.side_view_uncertain',
        metricKeys: ['sideViewConfidence'],
        direction: 'below',
        value: sideViewConfidence,
        thresholdPath: 'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
        thresholdValue: FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN,
        eligible: hasSideViewConfidence,
        triggered: hasSideViewConfidence && !sideViewIsScorable(repWindow),
        skippedReason: 'insufficient_side_view_samples',
      }),
    ],
  });
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

interface RepFrameMetrics {
  ratio: number;
  fastRatio: number;
  velocityRatio: number;
  kneeAngle: number | null;
  kneeConfidence: number;
  hipAngle: number | null;
  hipConfidence: number;
  ratioConfidence: number;
  hipY: number | null;
  legChainLength: number | null;
  thighVector: Point2D | null;
  distalEndpoint: DistalEndpointName | null;
  sideViewConfidence: number | null;
  phase: LyingLegCurlPhase;
  t: number;
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

  const returnMaxRatio = robustHigh(window.returnRatioSamples);
  if (returnMaxRatio !== null) window.returnMaxRatio = returnMaxRatio;

  const returnMaxKneeAngle = robustHigh(window.returnKneeAngleSamples);
  if (returnMaxKneeAngle !== null) window.returnMaxKneeAngle = returnMaxKneeAngle;

  const maxHipDelta = robustHigh(window.hipDeltaSamples);
  if (maxHipDelta !== null) window.maxHipDelta = maxHipDelta;

  const maxHipRiseRatio = robustHigh(window.hipRiseRatioSamples);
  if (maxHipRiseRatio !== null) window.maxHipRiseRatio = maxHipRiseRatio;

  const maxThighDriftRatio = robustHigh(window.thighDriftRatioSamples);
  if (maxThighDriftRatio !== null) window.maxThighDriftRatio = maxThighDriftRatio;

  const maxVelocity = robustHigh(window.velocitySampleValues);
  if (maxVelocity !== null) window.maxVelocity = maxVelocity;

  const maxCurlVelocity = robustHigh(window.curlVelocitySampleValues);
  if (maxCurlVelocity !== null) window.maxCurlVelocity = maxCurlVelocity;

  const maxLowerVelocity = robustHigh(window.lowerVelocitySampleValues);
  if (maxLowerVelocity !== null) window.maxLowerVelocity = maxLowerVelocity;
}

function updateRepWindowReturnExtension(window: RepWindow, sample: RepFrameMetrics): void {
  if (window.tLowerStart === null) return;

  window.returnRatioSamples.push(sample.velocityRatio);
  window.returnMaxRatio = Math.max(window.returnMaxRatio, sample.velocityRatio);
  if (sample.kneeAngle !== null && sample.kneeConfidence >= FORM_CONFIDENCE_MIN) {
    window.returnKneeAngleSamples.push(sample.kneeAngle);
    window.returnMaxKneeAngle = Math.max(window.returnMaxKneeAngle, sample.kneeAngle);
    window.returnKneeAngleSampleCount++;
    window.returnKneeAngleConfidenceSum += sample.kneeConfidence;
  }

  refreshRepWindowMetrics(window);
}

function markRepWindowLowConfidenceDropout(
  window: RepWindow,
  t: number,
  sideViewConfidence: number | null,
): void {
  window.tEnd = t;
  window.frameCount++;
  window.lowConfidenceFrames++;
  if (sideViewConfidence !== null) {
    window.sideViewConfidenceSamples++;
    window.sideViewConfidenceSum += sideViewConfidence;
    window.sideViewConfidenceMin = Math.min(window.sideViewConfidenceMin, sideViewConfidence);
  }
}

function updateRepWindowMetrics(window: RepWindow, sample: RepFrameMetrics): void {
  window.tEnd = sample.t;
  window.frameCount++;
  window.ratioSamples.push(sample.ratio);
  window.minRatio = Math.min(window.minRatio, sample.ratio);
  window.maxRatio = Math.max(window.maxRatio, sample.ratio);
  if (sample.distalEndpoint) {
    window.distalEndpointCounts[sample.distalEndpoint]++;
  }

  const lowConfidenceSample =
    sample.ratioConfidence < FORM_THRESHOLDS.PRIMARY_CONFIDENCE_MIN ||
    sample.kneeConfidence < FORM_THRESHOLDS.PRIMARY_CONFIDENCE_MIN ||
    sample.kneeAngle === null;
  if (lowConfidenceSample) {
    window.lowConfidenceFrames++;
  }

  if (sample.kneeAngle !== null && sample.kneeConfidence >= FORM_CONFIDENCE_MIN) {
    window.kneeAngleSamples.push(sample.kneeAngle);
    window.minKneeAngle = Math.min(window.minKneeAngle, sample.kneeAngle);
    window.maxKneeAngle = Math.max(window.maxKneeAngle, sample.kneeAngle);
    window.kneeAngleSampleCount++;
    window.kneeAngleConfidenceSum += sample.kneeConfidence;
  }

  if (window.tLowerStart !== null) {
    updateRepWindowReturnExtension(window, sample);
  }

  if (sample.hipAngle !== null && sample.hipConfidence >= FORM_CONFIDENCE_MIN) {
    if (window.hipAngleBaseline === null) {
      window.hipAngleBaseline = sample.hipAngle;
    }
    const delta = Math.abs(sample.hipAngle - window.hipAngleBaseline);
    window.hipDeltaSamples.push(delta);
    window.maxHipDelta = Math.max(window.maxHipDelta, delta);
  }

  if (sample.hipY !== null && sample.hipConfidence >= FORM_CONFIDENCE_MIN) {
    if (window.hipYBaseline === null) {
      window.hipYBaseline = sample.hipY;
    }
    const hipRise = calculateHipRiseRatio(sample.hipY, window.hipYBaseline, sample.legChainLength);
    if (hipRise !== null) {
      window.hipRiseRatioSamples.push(hipRise);
      window.maxHipRiseRatio = Math.max(window.maxHipRiseRatio, hipRise);
      window.hipRiseSampleCount++;
    }
  }

  if (sample.thighVector !== null && sample.kneeConfidence >= FORM_CONFIDENCE_MIN) {
    if (window.thighVectorBaseline === null) {
      window.thighVectorBaseline = sample.thighVector;
    }
    const drift = calculateThighDriftRatio(
      sample.thighVector,
      window.thighVectorBaseline,
      sample.legChainLength,
    );
    if (drift !== null) {
      window.thighDriftRatioSamples.push(drift);
      window.maxThighDriftRatio = Math.max(window.maxThighDriftRatio, drift);
      window.thighDriftSampleCount++;
    }
  }

  if (sample.sideViewConfidence !== null) {
    window.sideViewConfidenceSamples++;
    window.sideViewConfidenceSum += sample.sideViewConfidence;
    window.sideViewConfidenceMin = Math.min(window.sideViewConfidenceMin, sample.sideViewConfidence);
  }

  if (window.lastRatioForVelocity !== null && window.lastRatioVelocityAt !== null) {
    const dt = sample.t - window.lastRatioVelocityAt;
    if (dt > 0) {
      const delta = sample.velocityRatio - window.lastRatioForVelocity;
      const velocity = Math.abs(delta) / dt;
      if (velocity >= FORM_THRESHOLDS.VELOCITY_SAMPLE_MIN) {
        window.velocitySamples++;
        window.velocitySum += velocity;
        window.velocitySampleValues.push(velocity);
        window.maxVelocity = Math.max(window.maxVelocity, velocity);
        if (delta < 0) {
          window.curlVelocitySampleValues.push(velocity);
          window.maxCurlVelocity = Math.max(window.maxCurlVelocity, velocity);
        } else if (delta > 0) {
          window.lowerVelocitySampleValues.push(velocity);
          window.maxLowerVelocity = Math.max(window.maxLowerVelocity, velocity);
        }
      }
      if (
        sample.phase === 'CURLED' &&
        sample.fastRatio <= FORM_THRESHOLDS.FLEXION_FAIL &&
        velocity <= FORM_THRESHOLDS.TOP_HOLD_VELOCITY_MAX
      ) {
        window.topHoldSeconds += dt;
      }
    }
  }
  window.lastRatioForVelocity = sample.velocityRatio;
  window.lastRatioVelocityAt = sample.t;
  refreshRepWindowMetrics(window);
}

function completeRep(
  state: LyingLegCurlState,
  window: RepWindow,
  visibleSide: 'left' | 'right',
  cleanFeedback: string,
  t: number,
): void {
  state.repCount++;
  const score = computeLyingLegCurlScore(window);
  const formMessages = generateFormMessages(window);
  const scorable = isLyingLegCurlRepScorable(window);
  const qualityWarnings = lyingLegCurlQualityWarnings(window);
  const messages = !scorable && qualityWarnings?.includes('side_view_uncertain')
    ? [FEEDBACK.SIDE_VIEW]
    : !scorable && qualityWarnings?.includes('missing_required_joints')
      ? [FEEDBACK.TRACKING_SETUP]
      : formMessages;

  state.lastRepResult = {
    repIndex: state.repCount,
    score,
    messages,
    scorable,
    qualityWarnings,
    diagnostics: buildLyingLegCurlDiagnostics(window, state.repCount, visibleSide, scorable),
  };

  if (messages.length > 0) {
    state.feedback = messages.join('\n');
  } else {
    state.feedback = cleanFeedback;
  }
  state.lastFeedbackTime = t;
}

function updateLyingLegCurlState(
  keypoints: Keypoint[],
  currentState: LyingLegCurlState,
  frameContext?: ExerciseFrameContext,
): LyingLegCurlState {
  const timestampMs = typeof frameContext?.timestampMs === 'number' && Number.isFinite(frameContext.timestampMs)
    ? frameContext.timestampMs
    : Date.now();
  const t = timestampMs / 1000;
  const signalKeypoints = signalSourceKeypoints(frameContext, keypoints);

  // Warmup gate
  if (!currentState.warmedUp) {
    const ready = currentState.warmupGate.update(signalKeypoints);
    if (!ready) {
      return currentState;
    }
    currentState.warmedUp = true;
  }

  // Select visible side in REST, then lock it through the active rep so
  // transient confidence changes do not splice two legs into one rep.
  const inActiveRep = currentState.fsm.phase !== 'REST';
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(signalKeypoints);

  // Calculate raw ratio and hip angle
  const distalEndpoint = selectDistalEndpoint(signalKeypoints, visibleSide);
  const rawRatio = calculateKneeRatio(signalKeypoints, visibleSide, distalEndpoint);
  const rawKneeAngle = calculateKneeAngle(signalKeypoints, visibleSide, distalEndpoint);
  const rawHip = calculateHipAngle(signalKeypoints, visibleSide);
  const ratioConf = minKeypointConfidence(signalKeypoints, [
    `${visibleSide}_hip`, `${visibleSide}_knee`,
  ]);
  const distalConf = distalEndpoint?.keypoint.score ?? 0;
  const primaryRatioConf = Math.min(ratioConf, distalConf);
  const kneeConf = primaryRatioConf;
  const hipConf = minKeypointConfidence(signalKeypoints, [
    `${visibleSide}_shoulder`, `${visibleSide}_hip`, `${visibleSide}_knee`,
  ]);
  const hip = visibleKeypoint(signalKeypoints, `${visibleSide}_hip`, FORM_CONFIDENCE_MIN);
  const legChainLength = calculateLegChainLength(signalKeypoints, visibleSide, distalEndpoint);
  const thighVector = calculateThighVector(signalKeypoints, visibleSide);
  const sideViewConfidence = calculateSideViewConfidence(frameContext?.imageKeypoints ?? signalKeypoints);

  // If we can't even compute the ratio, keep the rep alive but account for
  // the missing form-critical signal in the active rep's scorable gate.
  if (rawRatio === null) {
    const newState: LyingLegCurlState = {
      ...currentState,
      visibleSide,
      smoothedRatio: null,
      fastRatio: null,
      currentKneeAngle: null,
      currentHipRiseRatio: null,
      smoothedHip: null,
    };
    const dropoutWindow = newState.repWindow ?? newState.pendingCompletedRep?.window ?? null;
    if (dropoutWindow) {
      markRepWindowLowConfidenceDropout(dropoutWindow, t, sideViewConfidence);
    }
    if (
      newState.pendingCompletedRep &&
      t - newState.pendingCompletedRep.completedAt + 1e-6 >= THRESHOLDS.MIN_REP_TIME
    ) {
      const pending = newState.pendingCompletedRep;
      completeRep(newState, pending.window, pending.visibleSide, 'Great rep!', t);
      newState.pendingCompletedRep = null;
    }
    return {
      ...newState,
    };
  }

  // Smooth values through tracker pipeline
  const smoothedRatio = currentState.ratioTracker.push(rawRatio, primaryRatioConf, timestampMs);
  const fastRatio = currentState.ratioTracker.medianValue;
  const smoothedHip = rawHip !== null
    ? currentState.hipTracker.push(rawHip, hipConf, timestampMs)
    : currentState.hipTracker.value;

  const newState: LyingLegCurlState = {
    ...currentState,
    visibleSide,
    smoothedRatio,
    fastRatio: isNaN(fastRatio) ? null : fastRatio,
    currentKneeAngle: rawKneeAngle,
    currentHipRiseRatio: null,
    smoothedHip: isNaN(smoothedHip) ? null : smoothedHip,
  };

  if (isNaN(fastRatio)) {
    return newState;
  }

  if (!inActiveRep && currentState.visibleSide !== visibleSide) {
    resetRestBaselines(newState);
  }

  if (newState.pendingCompletedRep) {
    const pending = newState.pendingCompletedRep;
    const startingNextRep = fastRatio < THRESHOLDS.CURLING_ENTER;
    const pendingSample: RepFrameMetrics = {
      ratio: smoothedRatio,
      fastRatio,
      velocityRatio: rawRatio,
      kneeAngle: rawKneeAngle,
      kneeConfidence: kneeConf,
      hipAngle: isNaN(smoothedHip) ? null : smoothedHip,
      hipConfidence: hipConf,
      ratioConfidence: primaryRatioConf,
      hipY: hip?.y ?? null,
      legChainLength,
      thighVector,
      distalEndpoint: distalEndpoint?.name ?? null,
      sideViewConfidence,
      phase: newState.fsm.phase,
      t,
    };

    if (!startingNextRep) {
      updateRepWindowReturnExtension(pending.window, pendingSample);
    }

    if (
      startingNextRep ||
      !extensionShort(pending.window) ||
      t - pending.completedAt + 1e-6 >= THRESHOLDS.MIN_REP_TIME
    ) {
      completeRep(newState, pending.window, pending.visibleSide, 'Great rep!', t);
      newState.pendingCompletedRep = null;
    }
  }

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, fastRatio, t);
  newState.fsm = fsmResult.fsm;

  if (newState.fsm.phase === 'REST' && !fsmResult.repCompleted && !isNaN(smoothedRatio)) {
    newState.restMaxRatio = Math.max(newState.restMaxRatio, smoothedRatio);
    newState.restRatioSamples = [...newState.restRatioSamples, smoothedRatio]
      .slice(-THRESHOLDS.REST_SAMPLE_WINDOW_FRAMES);
    if (rawKneeAngle !== null && kneeConf >= FORM_CONFIDENCE_MIN) {
      newState.restMaxKneeAngle = Math.max(newState.restMaxKneeAngle, rawKneeAngle);
      newState.restKneeAngleSamples = [...newState.restKneeAngleSamples, rawKneeAngle]
        .slice(-THRESHOLDS.REST_SAMPLE_WINDOW_FRAMES);
    }
    if (!isNaN(smoothedHip) && hipConf >= FORM_CONFIDENCE_MIN) {
      newState.restHipAngleSamples = [...newState.restHipAngleSamples, smoothedHip]
        .slice(-THRESHOLDS.REST_SAMPLE_WINDOW_FRAMES);
    }
    if (hip && hipConf >= FORM_CONFIDENCE_MIN) {
      newState.restHipYSamples = [...newState.restHipYSamples, hip.y]
        .slice(-THRESHOLDS.REST_SAMPLE_WINDOW_FRAMES);
    }
    if (thighVector !== null) {
      newState.restThighVectorSamples = [...newState.restThighVectorSamples, thighVector]
        .slice(-THRESHOLDS.REST_SAMPLE_WINDOW_FRAMES);
    }
  }

  // Track rep window while actively in a rep (not REST)
  const inRep = newState.fsm.phase !== 'REST';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(newState.fsm.tRepStart ?? t, rawRatio, rawKneeAngle);
    newState.repWindow.ratioSamples.push(...newState.restRatioSamples);
    newState.repWindow.kneeAngleSamples.push(...newState.restKneeAngleSamples);
    newState.repWindow.kneeAngleSampleCount += newState.restKneeAngleSamples.length;
    newState.repWindow.kneeAngleConfidenceSum += newState.restKneeAngleSamples.length * FORM_CONFIDENCE_MIN;
    if (newState.restMaxRatio !== -Infinity) {
      newState.repWindow.maxRatio = newState.restMaxRatio;
    }
    if (newState.restMaxKneeAngle !== -Infinity) {
      newState.repWindow.maxKneeAngle = newState.restMaxKneeAngle;
    }
    newState.repWindow.hipAngleBaseline = averageFiniteOrNull(newState.restHipAngleSamples);
    newState.repWindow.hipYBaseline = averageFiniteOrNull(newState.restHipYSamples);
    newState.repWindow.thighVectorBaseline = averagePoint(newState.restThighVectorSamples);
    resetRestBaselines(newState);
  }

  const returnedPartial =
    currentState.fsm.phase === 'CURLING' &&
    newState.fsm.phase === 'REST' &&
    !fsmResult.repCompleted &&
    newState.repWindow !== null;

  if (
    currentState.fsm.phase === 'CURLED' &&
    newState.fsm.phase === 'LOWERING' &&
    newState.repWindow?.tLowerStart === null
  ) {
    newState.repWindow.tLowerStart = t;
  }

  if (newState.repWindow && (inRep || fsmResult.repCompleted || returnedPartial)) {
    const hipRiseRatio = hip && newState.repWindow.hipYBaseline !== null
      ? calculateHipRiseRatio(hip.y, newState.repWindow.hipYBaseline, legChainLength)
      : null;
    newState.currentHipRiseRatio = hipRiseRatio;
    updateRepWindowMetrics(newState.repWindow, {
      ratio: smoothedRatio,
      fastRatio,
      velocityRatio: rawRatio,
      kneeAngle: rawKneeAngle,
      kneeConfidence: kneeConf,
      hipAngle: isNaN(smoothedHip) ? null : smoothedHip,
      hipConfidence: hipConf,
      ratioConfidence: primaryRatioConf,
      hipY: hip?.y ?? null,
      legChainLength,
      thighVector,
      distalEndpoint: distalEndpoint?.name ?? null,
      sideViewConfidence,
      phase: newState.fsm.phase,
      t,
    });

    // Record curled timestamp
    if (newState.fsm.phase === 'CURLED' && newState.repWindow.tCurled === null) {
      newState.repWindow.tCurled = t;
    }
  }

  if (returnedPartial && newState.repWindow) {
    const window = newState.repWindow;
    const actualRom = window.maxRatio - window.minRatio;
    const duration = window.tEnd - window.tStart;

    if (isMeaningfulPartialRep({
      actualRom,
      minRom: THRESHOLDS.MIN_PARTIAL_ROM,
      duration,
      minDuration: THRESHOLDS.MIN_REP_TIME,
    })) {
      completeRep(newState, window, visibleSide, 'Good rep.', t);
    } else if (actualRom > 0) {
      newState.feedback = LOW_ROM_FEEDBACK;
      newState.lastFeedbackTime = t;
    }

    newState.repWindow = null;
    newState.fsm = initFSM();
    return newState;
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    const completedWindow = newState.repWindow;

    // Reset rep window and FSM
    newState.repWindow = null;
    newState.fsm = initFSM();
    if (extensionShort(completedWindow)) {
      newState.pendingCompletedRep = {
        window: completedWindow,
        visibleSide,
        completedAt: t,
      };
    } else {
      completeRep(newState, completedWindow, visibleSide, 'Great rep!', t);
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

function getDebugInfo(state: LyingLegCurlState): LyingLegCurlDebugInfo {
  const fmt = (v: number | null | undefined): number | null =>
    v !== null && v !== undefined && !isNaN(v) && isFinite(v) ? v : null;

  const fmtRatio = (v: number | null | undefined): number | null => {
    if (v === null || v === undefined || isNaN(v) || !isFinite(v)) return null;
    return Math.round(v * 1000) / 1000; // 3 decimal places for ratios
  };

  const repWin = state.repWindow ?? state.pendingCompletedRep?.window ?? null;

  return {
    phase: state.fsm.phase,
    side: state.visibleSide,
    warmedUp: state.warmedUp,
    ratio: fmtRatio(state.smoothedRatio),
    fastRatio: fmtRatio(state.fastRatio),
    kneeAngle: fmt(state.currentKneeAngle),
    hipAngle: fmt(state.smoothedHip),
    hipRiseRatio: fmtRatio(state.currentHipRiseRatio),
    ratioMin: repWin && repWin.minRatio !== Infinity ? fmtRatio(repWin.minRatio) : null,
    ratioMax: repWin && repWin.maxRatio !== -Infinity ? fmtRatio(repWin.maxRatio) : null,
    kneeAngleMin: repWin && repWin.minKneeAngle !== Infinity ? fmt(repWin.minKneeAngle) : null,
    kneeAngleMax: repWin && repWin.maxKneeAngle !== -Infinity ? fmt(repWin.maxKneeAngle) : null,
    hipDelta: repWin ? fmt(repWin.maxHipDelta) : null,
    hipRiseMax: repWin ? fmtRatio(repWin.maxHipRiseRatio) : null,
    thighDriftRatio: repWin ? fmtRatio(repWin.maxThighDriftRatio) : null,
    distalEndpoint: repWin ? mostUsedDistalEndpoint(repWin) : null,
    topHoldSeconds: repWin ? fmt(repWin.topHoldSeconds) : null,
    velocitySpikeRatio: repWin ? fmt(velocitySpikeRatio(repWin)) : null,
    sideViewConfidence: repWin ? fmt(averageSideViewConfidence(repWin)) : null,
    scorable: repWin ? isLyingLegCurlRepScorable(repWin) : null,
  };
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================

function configNumber(config: ExerciseHeuristicConfig, path: string, issues: string[]): number | null {
  const value = getConfigValue(config, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`Lying Leg Curl config "${path}" must be a finite number.`);
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
      `Lying Leg Curl config ordering invalid: "${firstPath}" (${first}) must be ${allowEqual ? '<=' : '<'} "${secondPath}" (${second}).`,
    );
  }
}

function validatePositiveInteger(config: ExerciseHeuristicConfig, issues: string[], path: string): number | null {
  const value = configNumber(config, path, issues);
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    issues.push(`Lying Leg Curl config "${path}" must be a positive integer.`);
  }
  return value;
}

function validatePenaltyConfigs(config: ExerciseHeuristicConfig, issues: string[]): void {
  const penaltyConfigs = getConfigValue(config, 'penaltyConfigs');
  if (penaltyConfigs === null || typeof penaltyConfigs !== 'object' || Array.isArray(penaltyConfigs)) {
    issues.push('Lying Leg Curl config "penaltyConfigs" must be an object.');
    return;
  }

  for (const [penaltyName, penaltyConfig] of Object.entries(penaltyConfigs)) {
    if (penaltyConfig === null || typeof penaltyConfig !== 'object' || Array.isArray(penaltyConfig)) {
      issues.push(`Lying Leg Curl penalty config "${penaltyName}" must be an object.`);
      continue;
    }

    const fields = penaltyConfig as Record<string, unknown>;
    const cap = fields.cap;
    const deadzone = fields.deadzone;
    const scale = fields.scale;
    const pathPrefix = `penaltyConfigs.${penaltyName}`;

    if (typeof cap !== 'number' || !Number.isFinite(cap)) {
      issues.push(`Lying Leg Curl config "${pathPrefix}.cap" must be a finite number.`);
    } else if (cap < 0) {
      issues.push(`Lying Leg Curl config "${pathPrefix}.cap" must be greater than or equal to 0.`);
    }

    if (typeof deadzone !== 'number' || !Number.isFinite(deadzone)) {
      issues.push(`Lying Leg Curl config "${pathPrefix}.deadzone" must be a finite number.`);
    } else if (deadzone < 0) {
      issues.push(`Lying Leg Curl config "${pathPrefix}.deadzone" must be greater than or equal to 0.`);
    }

    if (typeof scale !== 'number' || !Number.isFinite(scale)) {
      issues.push(`Lying Leg Curl config "${pathPrefix}.scale" must be a finite number.`);
    } else if (scale < 0 || (scale === 0 && cap !== 0)) {
      issues.push(`Lying Leg Curl config "${pathPrefix}.scale" must be greater than 0 unless cap is 0.`);
    }
  }
}

function validateLyingLegCurlHeuristicConfig(config: ExerciseHeuristicConfig): string[] {
  const issues: string[] = [];

  requireOrdered(config, issues, 'thresholds.CURLED_ENTER', 'thresholds.CURLED_EXIT');
  requireOrdered(config, issues, 'thresholds.CURLED_EXIT', 'thresholds.CURLING_ENTER');
  requireOrdered(config, issues, 'thresholds.CURLING_ENTER', 'thresholds.CURL_CLOCK_START');
  requireOrdered(config, issues, 'thresholds.CURLING_ENTER', 'thresholds.REST_REENTER', true);
  requireOrdered(config, issues, 'formThresholds.FLEXION_IDEAL_RATIO', 'formThresholds.FLEXION_FAIL', true);
  requireOrdered(config, issues, 'formThresholds.EXTENSION_FAIL', 'formThresholds.EXTENSION_IDEAL_RATIO', true);
  requireOrdered(
    config,
    issues,
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    true,
  );
  requireOrdered(config, issues, 'formThresholds.KNEE_FLEXION_IDEAL', 'formThresholds.KNEE_FLEXION_FAIL', true);
  requireOrdered(config, issues, 'formThresholds.KNEE_EXTENSION_FAIL', 'formThresholds.KNEE_EXTENSION_IDEAL', true);

  const minPartialRom = configNumber(config, 'thresholds.MIN_PARTIAL_ROM', issues);
  const curlingEnter = configNumber(config, 'thresholds.CURLING_ENTER', issues);
  const curledEnter = configNumber(config, 'thresholds.CURLED_ENTER', issues);
  if (
    minPartialRom !== null &&
    curlingEnter !== null &&
    curledEnter !== null &&
    minPartialRom >= curlingEnter - curledEnter
  ) {
    issues.push(
      'Lying Leg Curl config "thresholds.MIN_PARTIAL_ROM" must be less than CURLING_ENTER - CURLED_ENTER.',
    );
  }

  for (const path of [
    'thresholds.CURL_CLOCK_START',
    'thresholds.CURLING_ENTER',
    'thresholds.CURLED_ENTER',
    'thresholds.CURLED_EXIT',
    'thresholds.REST_REENTER',
    'thresholds.MIN_PARTIAL_ROM',
    'formThresholds.FLEXION_FAIL',
    'formThresholds.FLEXION_IDEAL_RATIO',
    'formThresholds.EXTENSION_FAIL',
    'formThresholds.EXTENSION_IDEAL_RATIO',
    'formThresholds.HIP_RISE_RATIO_WARN',
    'formThresholds.THIGH_DRIFT_RATIO_WARN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 1.2)) {
      issues.push(`Lying Leg Curl config "${path}" must be greater than 0 and at most 1.2.`);
    }
  }

  for (const path of [
    'thresholds.MIN_REP_TIME',
    'formThresholds.TOP_HOLD_MIN',
    'formThresholds.TEMPO_CURL_MIN',
    'formThresholds.TEMPO_LOWER_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && value < 0) {
      issues.push(`Lying Leg Curl config "${path}" must be greater than or equal to 0.`);
    }
  }

  for (const path of [
    'formThresholds.TOP_HOLD_VELOCITY_MAX',
    'formThresholds.TEMPO_JERK_SPIKE_WARN',
    'formThresholds.TEMPO_JERK_VELOCITY_WARN',
    'formThresholds.VELOCITY_SAMPLE_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && value <= 0) {
      issues.push(`Lying Leg Curl config "${path}" must be greater than 0.`);
    }
  }

  for (const path of [
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
    'formThresholds.PRIMARY_CONFIDENCE_MIN',
    'formThresholds.LOW_CONFIDENCE_MAX_RATE',
    'formThresholds.KNEE_METRIC_MIN_SAMPLE_RATE',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value < 0 || value > 1)) {
      issues.push(`Lying Leg Curl config "${path}" must be between 0 and 1.`);
    }
  }

  for (const path of [
    'formThresholds.KNEE_FLEXION_FAIL',
    'formThresholds.KNEE_FLEXION_IDEAL',
    'formThresholds.KNEE_EXTENSION_FAIL',
    'formThresholds.KNEE_EXTENSION_IDEAL',
    'formThresholds.HIP_LIFT_WARN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 180)) {
      issues.push(`Lying Leg Curl config "${path}" must be greater than 0 and at most 180.`);
    }
  }

  validatePositiveInteger(config, issues, 'thresholds.ROBUST_EXTREMA_MIN_SAMPLES');
  validatePositiveInteger(config, issues, 'thresholds.REST_SAMPLE_WINDOW_FRAMES');
  validatePositiveInteger(config, issues, 'formThresholds.SIDE_VIEW_MIN_SAMPLES');
  validatePositiveInteger(config, issues, 'formThresholds.KNEE_METRIC_MIN_SAMPLES');

  validatePenaltyConfigs(config, issues);
  return issues;
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createLyingLegCurlDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_LYING_LEG_CURL_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Lying Leg Curl',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    repQualityWindowActive: false,
    _internal: withLyingLegCurlConfig(config, () => initializeLyingLegCurlState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState, frameContext?: ExerciseFrameContext): ExerciseState => {
    const internal = state._internal as LyingLegCurlState;
    const newInternal = withLyingLegCurlConfig(
      config,
      () => updateLyingLegCurlState(keypoints, internal, frameContext),
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

    return {
      repCount: newInternal.repCount,
      lastRepResult,
      feedback: newInternal.feedback,
      feedbackTimestamp: newInternal.lastFeedbackTime > 0 ? newInternal.lastFeedbackTime : null,
      debugInfo: getDebugInfo(newInternal) as unknown as Record<string, unknown>,
      repQualityWindowActive: newInternal.repWindow !== null || newInternal.pendingCompletedRep !== null,
      _internal: newInternal,
    };
  },

  heuristicConfig: config,
  tunableSpec: LYING_LEG_CURL_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/lyingLegCurl.json',
  createVariant: (variantConfig) =>
    createLyingLegCurlDefinition(mergeHeuristicConfig(config, variantConfig)),
  validateHeuristicConfig: validateLyingLegCurlHeuristicConfig,

  ttsConfig: {
    feedbackToIssue: {
      [FEEDBACK.CURL_SHORT]: 'rom_curl_short',
      [FEEDBACK.EXTEND_SHORT]: 'rom_extend_short',
      [FEEDBACK.HIP_LIFT]: 'hip_lift',
      [FEEDBACK.TEMPO_CURL]: 'tempo_up',
      [FEEDBACK.TEMPO_LOWER]: 'tempo_down',
      [FEEDBACK.TOP_HOLD]: 'top_hold_short',
      [FEEDBACK.TEMPO_JERK]: 'tempo_jerk',
      [FEEDBACK.SIDE_VIEW]: 'side_view_uncertain',
      [FEEDBACK.THIGH_MOVEMENT]: 'thigh_movement',
    },
    feedbackMessages: {
      [FEEDBACK.HIP_LIFT]: [
        'Keep your hips down.',
        'Press your hips into the pad.',
        "Don't lift your hips during the curl.",
      ],
      [FEEDBACK.TOP_HOLD]: [
        'Pause and squeeze at the top.',
        'Hold the curl briefly.',
        'Squeeze your hamstrings up top.',
      ],
      [FEEDBACK.TEMPO_JERK]: [
        'Keep it smooth.',
        'No bouncing the weight.',
        'Smooth reps. Control the machine.',
      ],
      [FEEDBACK.SIDE_VIEW]: [
        'Turn fully side-on.',
        'Set the camera side-on.',
        'I need a side view to judge this.',
      ],
      [FEEDBACK.THIGH_MOVEMENT]: [
        'Keep your thighs down.',
        'Only your lower legs should move.',
        'Keep your knees pressed into the pad.',
      ],
    },
    issueDefinitions: [
      {
        issueType: 'rom_curl_short',
        priority: 25,
        messages: [
          'Curl it all the way up.',
          'Bring your heels closer to your glutes.',
          'Full range on the curl.',
        ],
      },
      {
        issueType: 'rom_extend_short',
        priority: 20,
        messages: [
          'Straighten fully at the bottom.',
          'Full extension before the next rep.',
          'Let your legs straighten.',
        ],
      },
      {
        issueType: 'hip_lift',
        priority: 30,
        messages: [
          'Keep your hips down.',
          'Keep your hips on the pad.',
          'Don\'t lift your hips.',
        ],
      },
      {
        issueType: 'top_hold_short',
        priority: 18,
        messages: [
          'Pause at the top.',
          'Squeeze briefly up top.',
          'Hold the curl for a beat.',
        ],
      },
      {
        issueType: 'tempo_jerk',
        priority: 22,
        messages: [
          'Keep it smooth.',
          'No bouncing the weight.',
          'Control the machine.',
        ],
      },
      {
        issueType: 'side_view_uncertain',
        priority: 35,
        messages: [
          'Turn fully side-on.',
          'Move the camera to your side.',
          'I need a side view to judge this.',
        ],
      },
      {
        issueType: 'thigh_movement',
        priority: 24,
        messages: [
          'Keep your thighs down.',
          'Only your lower legs should move.',
          'Keep your knees on the pad.',
        ],
      },
    ],
  },

  summaryConfig: {
    [FEEDBACK.CURL_SHORT]:
      'Focus on curling your heels as close to your glutes as possible for full hamstring contraction.',
    [FEEDBACK.EXTEND_SHORT]:
      'Fully straighten your legs at the bottom of each rep to maximize range of motion.',
    [FEEDBACK.HIP_LIFT]:
      'Press your hips into the pad throughout the movement \u2014 lifting uses momentum instead of hamstring strength.',
    [FEEDBACK.TEMPO_CURL]:
      'Control the concentric phase \u2014 aim for 1-2 seconds on the curl up.',
    [FEEDBACK.TEMPO_LOWER]:
      'Slow the eccentric phase \u2014 resist the weight on the way down for 2-3 seconds.',
    [FEEDBACK.TOP_HOLD]:
      'Pause briefly at peak flexion and squeeze your hamstrings before lowering.',
    [FEEDBACK.TEMPO_JERK]:
      'Move smoothly through the rep instead of bouncing or letting the machine yank your legs.',
    [FEEDBACK.SIDE_VIEW]:
      'Set the camera fully side-on so your hip, knee, and ankle path can be judged accurately.',
    [FEEDBACK.THIGH_MOVEMENT]:
      'Keep your thighs pinned to the pad so the hamstrings move the weight instead of your hips or knees.',
  },
  };
}

export const lyingLegCurlDefinition: ExerciseDefinition = createLyingLegCurlDefinition();
