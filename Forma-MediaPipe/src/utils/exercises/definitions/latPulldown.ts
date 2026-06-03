/**
 * Cable Lat Pulldowns -- Exercise Definition
 *
 * Side or diagonal view, single (best-visible) arm reach-ratio as primary driver.
 * No symmetry tracking. Works from side, diagonal, or any angle where one arm
 * and the torso are visible.
 * FSM: REST -> PULLING -> BOTTOM -> RETURNING -> REST
 *
 * Reach ratio = dist2D(shoulder,wrist) / (dist2D(shoulder,elbow) + dist2D(elbow,wrist))
 * Arms extended overhead: ratio ~0.93-0.97. Pulled down: ratio ~0.40-0.55.
 * One rep = full pull-down + controlled return.
 *
 * The only export is `latPulldownDefinition`.
 */

import {
  Keypoint,
  calculateAngle,
  calculateSignedVerticalAngleSagittal,
  calculateVerticalAngle,
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
  diagnosticMetric,
} from '../shared/diagnostics';
import { createPoseStateReliabilityAggregator } from '../../pose/buildPoseState';
import {
  interpretPoseStateReliabilitySummary,
  type RepReliabilityInterpretation,
} from '../shared/reliabilityInterpretation';
import tunedConfig from './tuned/latPulldown.json';
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
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (reach ratio of the active arm) */
const THRESHOLDS = {
  /** Ratio below which we transition REST -> PULLING.
   *  Extended arm ~0.93-0.97; set to 0.93 to avoid false entry from noise. */
  PULLING_ENTER: 0.93,
  /** Ratio below which we consider bottom position (PULLING -> BOTTOM) */
  BOTTOM_ENTER: 0.58,
  /** Ratio above which we leave BOTTOM (hysteresis) (BOTTOM -> RETURNING) */
  BOTTOM_EXIT: 0.60,
  /** Ratio above which the return is complete (RETURNING -> REST) */
  REST_REENTER: 0.88,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.6,
  /** Minimum time (seconds) to stay in PULLING before allowing abort back to REST.
   *  Prevents rapid flicker when the idle arm ratio hovers near PULLING_ENTER. */
  PULLING_ABORT_MIN_TIME: 0.25,
  /** Minimum ratio ROM for a returned partial rep to count */
  MIN_PARTIAL_ROM: 0.13,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min ratio above which pull is insufficient (didn't pull deep enough) */
  PULL_ROM_FAIL: 0.60,
  /** Max ratio below which extension is insufficient */
  EXTENSION_ROM_FAIL: 0.90,
  /** Upper-arm drive delta below which the pull is too arm-dominant */
  ELBOW_DRIVE_FAIL: 30,
  /** Backward torso lean delta above which there is excessive lean */
  TORSO_LEAN_WARN: 18,
  /** Absolute torso lean above which the setup is too leaned back */
  TORSO_ABSOLUTE_WARN: 32,
  /** Total torso swing above which the rep is too momentum-driven */
  TORSO_ROCK_WARN: 24,
  /** Shoulder elevation ratio above which the user is shrugging */
  SHOULDER_SHRUG_WARN: 0.06,
  /** Concentric (pull down) too fast threshold (seconds). */
  TEMPO_PULL_MIN: 0.45,
  /** Eccentric (return) too fast threshold (seconds). */
  TEMPO_RETURN_MIN: 0.8,
  /** Average side-view confidence below which a counted rep is marked unscorable. */
  SIDE_VIEW_AVG_CONFIDENCE_MIN: 0.45,
  /** Minimum side-view confidence below which a counted rep is marked unscorable. */
  SIDE_VIEW_MIN_CONFIDENCE_MIN: 0.25,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * Scoring uses the values in PENALTY_CONFIGS below as the source of truth.
 * ROM and elbow-drive penalties are measured as shortfalls from the feedback
 * threshold; tempo penalties are measured as deficits from the minimum phase
 * duration.
 *
 * Max total penalty: 100 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  PULL_ROM:       { cap: 30, deadzone: 0, scale: 900 } as PenaltyConfig,
  EXTENSION_ROM:  { cap: 18, deadzone: 0, scale: 600 } as PenaltyConfig,
  ELBOW_DRIVE:    { cap: 15, deadzone: 0, scale: 0.02 } as PenaltyConfig,
  TORSO_LEAN:     { cap: 16, deadzone: 8, scale: 0.08 } as PenaltyConfig,
  TORSO_ABSOLUTE: { cap: 10, deadzone: 25, scale: 0.05 } as PenaltyConfig,
  TORSO_ROCK:     { cap: 12, deadzone: 18, scale: 0.15 } as PenaltyConfig,
  SHOULDER_SHRUG: { cap: 10, deadzone: 0.04, scale: 10000 } as PenaltyConfig,
  TEMPO_PULL:     { cap: 8,  deadzone: 0.45, scale: 40 } as PenaltyConfig,
  TEMPO_RETURN:   { cap: 12, deadzone: 0.8, scale: 80 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;
const FORM_CONFIDENCE_MIN = 0.3;
const FORM_METRIC_MIN_SAMPLES = 3;
const SIDE_VIEW_MIN_SAMPLES = 5;
const BILATERAL_MIN_SAMPLES = 5;
const WORLD_IMAGE_REACH_RATIO_MAX_DELTA = 0.2;
const WORLD_IMAGE_TORSO_DEV_MAX_DELTA = 12;

const DEFAULT_LAT_PULLDOWN_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_LAT_PULLDOWN_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_LAT_PULLDOWN_HEURISTIC_CONFIG,
  tunedConfig,
);

const LAT_PULLDOWN_TUNABLE_SPEC = createDefaultTunableSpec(
  'Cable Lat Pulldowns',
  DEFAULT_LAT_PULLDOWN_HEURISTIC_CONFIG,
);

function upsertLatPulldownTunable(tunable: NumericTunable): void {
  const index = LAT_PULLDOWN_TUNABLE_SPEC.tunables.findIndex((entry) => entry.path === tunable.path);
  if (index >= 0) LAT_PULLDOWN_TUNABLE_SPEC.tunables[index] = tunable;
  else LAT_PULLDOWN_TUNABLE_SPEC.tunables.push(tunable);
}

[
  { path: 'penaltyConfigs.PULL_ROM.cap', min: 0, max: 50, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.EXTENSION_ROM.cap', min: 0, max: 35, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.ELBOW_DRIVE.cap', min: 0, max: 30, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TORSO_LEAN.cap', min: 0, max: 30, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TORSO_ABSOLUTE.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TORSO_ROCK.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.SHOULDER_SHRUG.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_PULL.cap', min: 0, max: 20, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_RETURN.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
].forEach((tunable) => upsertLatPulldownTunable(tunable as NumericTunable));
LAT_PULLDOWN_TUNABLE_SPEC.search = {
  ...LAT_PULLDOWN_TUNABLE_SPEC.search,
  applyGates: {
    ...LAT_PULLDOWN_TUNABLE_SPEC.search?.applyGates,
    minTestScoreEvaluatedReps: 1,
    minTestScoreInRangeRate: 0.85,
    maxTestScoreMeanAbsoluteMiss: 7.5,
  },
};
LAT_PULLDOWN_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'cable-lat-pulldowns.rom_short', metricKey: 'pullDepthRatio', thresholdPath: 'formThresholds.PULL_ROM_FAIL', direction: 'above' },
  { issueId: 'cable-lat-pulldowns.lockout_short', metricKey: 'extensionRatio', thresholdPath: 'formThresholds.EXTENSION_ROM_FAIL', direction: 'below' },
  { issueId: 'cable-lat-pulldowns.elbow_drive', metricKey: 'upperArmDriveDelta', thresholdPath: 'formThresholds.ELBOW_DRIVE_FAIL', direction: 'below' },
  { issueId: 'cable-lat-pulldowns.torso_warn', metricKey: 'torsoLeanBackDelta', thresholdPath: 'formThresholds.TORSO_LEAN_WARN', direction: 'above' },
  { issueId: 'cable-lat-pulldowns.torso_warn', metricKey: 'torsoAbsoluteBackLean', thresholdPath: 'formThresholds.TORSO_ABSOLUTE_WARN', direction: 'above' },
  { issueId: 'cable-lat-pulldowns.torso_rocking', metricKey: 'torsoRockDelta', thresholdPath: 'formThresholds.TORSO_ROCK_WARN', direction: 'above' },
  { issueId: 'cable-lat-pulldowns.shoulder_shrug', metricKey: 'shoulderShrugRatio', thresholdPath: 'formThresholds.SHOULDER_SHRUG_WARN', direction: 'above' },
  { issueId: 'cable-lat-pulldowns.tempo_down', metricKey: 'tPull', thresholdPath: 'formThresholds.TEMPO_PULL_MIN', direction: 'below' },
  { issueId: 'cable-lat-pulldowns.tempo_up', metricKey: 'tReturn', thresholdPath: 'formThresholds.TEMPO_RETURN_MIN', direction: 'below' },
];

const LAT_PULLDOWN_ISSUE_CUE_FAMILIES: Record<string, string[]> = {
  'cable-lat-pulldowns.rom_short': ['rangeOfMotion', 'handlePath', 'wristSpecific', 'visibleArmPath'],
  'cable-lat-pulldowns.lockout_short': ['rangeOfMotion', 'handlePath', 'wristSpecific', 'visibleArmPath'],
  'cable-lat-pulldowns.elbow_drive': ['elbowPath', 'visibleArmPath'],
  'cable-lat-pulldowns.torso_warn': ['torsoControl'],
  'cable-lat-pulldowns.torso_rocking': ['torsoControl'],
  'cable-lat-pulldowns.shoulder_shrug': ['torsoControl'],
  'cable-lat-pulldowns.tempo_down': ['tempo'],
  'cable-lat-pulldowns.tempo_up': ['tempo'],
};

const LAT_PULLDOWN_MESSAGE_CUE_FAMILIES: Record<string, string[]> = {
  'Pull deeper \u2014 bring the bar to your upper chest.': ['rangeOfMotion', 'handlePath', 'wristSpecific', 'visibleArmPath'],
  'Extend fully \u2014 reach all the way up at the top.': ['rangeOfMotion', 'handlePath', 'wristSpecific', 'visibleArmPath'],
  'Drive your elbows down \u2014 pull with your lats, not just your arms.': ['elbowPath', 'visibleArmPath'],
  'Stay upright \u2014 avoid leaning back excessively.': ['torsoControl'],
  'Keep your torso steady through the pulldown.': ['torsoControl'],
  'Keep your shoulders down as you pull.': ['torsoControl'],
  'Slow down the pull \u2014 control the descent.': ['tempo'],
  'Control the return \u2014 resist the weight on the way up.': ['tempo'],
};

const LAT_PULLDOWN_SELECTED_ARM_CUE_FAMILIES = [
  'repCount',
  'tempo',
  'visibleArmPath',
  'handlePath',
  'elbowPath',
  'wristSpecific',
  'rangeOfMotion',
] as const;

const LAT_PULLDOWN_RELIABILITY_JOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
] as const;

const LAT_PULLDOWN_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withLatPulldownConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, LAT_PULLDOWN_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LatPulldownPhase = 'REST' | 'PULLING' | 'BOTTOM' | 'RETURNING';

interface RepWindow {
  /** Timestamps */
  tStart: number;
  tBottom: number | null;
  tEnd: number;
  /** Min reach ratio during the rep (lower = deeper pull) */
  minRatio: number;
  /** Max reach ratio during the rep (used for ROM extension scoring) */
  maxRatio: number;
  /** Max torso lean during the rep */
  maxTorsoLean: number;
  /** Upper-arm drive angle at rep start */
  upperArmDriveBaseline: number | null;
  /** Max upper-arm drive from baseline */
  maxUpperArmDriveDelta: number;
  /** Valid samples contributing to upper-arm drive diagnostics */
  upperArmDriveSamples: number;
  /** Signed torso angle baseline */
  torsoDevBaseline: number | null;
  /** Max backward torso lean delta from baseline */
  maxTorsoLeanBackDelta: number;
  /** Max forward torso lean delta from baseline */
  maxTorsoForwardDelta: number;
  /** Max absolute torso movement from baseline */
  maxTorsoDev: number;
  /** Max absolute torso lean from vertical */
  maxTorsoAbsoluteBackLean: number;
  /** Valid samples contributing to absolute torso lean diagnostics */
  torsoLeanSamples: number;
  /** Valid samples contributing to torso deviation diagnostics */
  torsoDevSamples: number;
  /** Image-space shoulder Y baseline */
  shoulderYBaseline: number | null;
  /** Max shoulder elevation normalized by torso height */
  maxShoulderShrugRatio: number;
  /** Valid samples contributing to shoulder shrug diagnostics */
  shoulderShrugSamples: number;
  /** Side-view confidence accumulation */
  sideViewConfidenceSum: number;
  sideViewConfidenceMin: number;
  sideViewConfidenceSamples: number;
  selectedSideSamples: number;
  /** Passive bilateral diagnostics, used only when both arms are visible. */
  bilateralSamples: number;
  leftMinRatio: number;
  leftMaxRatio: number;
  rightMinRatio: number;
  rightMaxRatio: number;
  /** Runtime PoseState reliability observed during this active rep. */
  reliability: ReturnType<typeof createPoseStateReliabilityAggregator>;
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

interface LatPulldownState {
  phase: LatPulldownPhase;
  repCount: number;
  /** Timestamp when the current rep started */
  tRepStart: number | null;
  /** Current rep window accumulator */
  repWindow: RepWindow | null;
  /** Side used for the just-completed frame; kept for stable debug traces. */
  debugSide: 'left' | 'right';
  /** Last completed rep result */
  lastRepResult: RepResult | null;
  /** Smoothed tracker for the active arm's reach ratio */
  ratioTracker: SmoothedAngleTracker;
  torsoLeanTracker: SmoothedAngleTracker;
  upperArmDriveTracker: SmoothedAngleTracker;
  torsoDevTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Which arm is being tracked this rep (picked per-REST based on visibility) */
  activeSide: 'left' | 'right';
  /** Max ratio observed during REST (pre-pull extension) */
  restMaxRatio: number;
  /** Timestamp of peak ratio during REST — used as the true pull start for
   *  tempo calculation so that the measurement is independent of when the FSM
   *  actually transitions to PULLING (which can be delayed by the extension gate
   *  timeout when the smoothed ratio doesn't reach PULLING_ENTER). */
  tRestPeakRatio: number | null;
  /** Mechanics baselines captured at the best top-position frame before a pull. */
  restUpperArmDriveBaseline: number | null;
  restTorsoDevBaseline: number | null;
  restShoulderYBaseline: number | null;
  /** Current smoothed values (for debug) */
  smoothedRatio: number;
  smoothedTorsoLean: number;
  smoothedUpperArmDrive: number | null;
  smoothedTorsoDev: number | null;
  /** After a rep completes, gate next rep start until user re-extends */
  requireExtensionBeforeNextRep: boolean;
  /** Timestamp when the last rep completed, for timeout fallback */
  tRepCompleted: number | null;
  /** Visual feedback */
  feedback: string | null;
  lastFeedbackTime: number;
}

interface LatPulldownDebugInfo {
  phase: LatPulldownPhase;
  warmedUp: boolean;
  activeSide: 'left' | 'right';
  ratio: number | null;
  torsoLean: number | null;
  minRatio: number | null;
  maxRatio: number | null;
  maxTorsoLean: number | null;
  upperArmDrive: number | null;
  upperArmDriveDelta: number | null;
  torsoLeanBackDelta: number | null;
  torsoForwardDelta: number | null;
  torsoRockDelta: number | null;
  torsoAbsoluteBackLean: number | null;
  shoulderShrugRatio: number | null;
  sideViewConfidence: number | null;
  viewQualityStatus: string | null;
  scorable: boolean | null;
}

type LandmarkSourceName = 'world' | 'image' | 'fallback';

interface LandmarkSource {
  name: LandmarkSourceName;
  keypoints: Keypoint[];
}

interface MetricSample {
  value: number;
  source: LandmarkSourceName;
  keypoints: Keypoint[];
  method?: 'sagittal' | 'selected_side';
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function createLatPulldownWarmupGate(): WarmupGate {
  return new WarmupGate({
    requiredJoints: [
      'left_shoulder', 'right_shoulder',
      'left_hip', 'right_hip',
    ],
    requiredFrames: 10,
    visibilityThreshold: 0.15,
  });
}

function resetLatPulldownAfterTrackingInterruption(state: LatPulldownState): LatPulldownState {
  return {
    ...state,
    phase: 'REST',
    tRepStart: null,
    repWindow: null,
    ratioTracker: new SmoothedAngleTracker(),
    torsoLeanTracker: new SmoothedAngleTracker(),
    upperArmDriveTracker: new SmoothedAngleTracker(),
    torsoDevTracker: new SmoothedAngleTracker(),
    warmupGate: createLatPulldownWarmupGate(),
    warmedUp: false,
    restMaxRatio: -Infinity,
    tRestPeakRatio: null,
    restUpperArmDriveBaseline: null,
    restTorsoDevBaseline: null,
    restShoulderYBaseline: null,
    requireExtensionBeforeNextRep: false,
    tRepCompleted: null,
    smoothedRatio: 1.0,
    smoothedTorsoLean: 0,
    smoothedUpperArmDrive: null,
    smoothedTorsoDev: null,
  };
}

function initializeState(): LatPulldownState {
  return {
    phase: 'REST',
    repCount: 0,
    tRepStart: null,
    repWindow: null,
    debugSide: 'right',
    lastRepResult: null,
    ratioTracker: new SmoothedAngleTracker(),
    torsoLeanTracker: new SmoothedAngleTracker(),
    upperArmDriveTracker: new SmoothedAngleTracker(),
    torsoDevTracker: new SmoothedAngleTracker(),
    warmupGate: createLatPulldownWarmupGate(),
    warmedUp: false,
    activeSide: 'right',
    restMaxRatio: -Infinity,
    tRestPeakRatio: null,
    restUpperArmDriveBaseline: null,
    restTorsoDevBaseline: null,
    restShoulderYBaseline: null,
    requireExtensionBeforeNextRep: false,
    tRepCompleted: null,
    smoothedRatio: 1.0,
    smoothedTorsoLean: 0,
    smoothedUpperArmDrive: null,
    smoothedTorsoDev: null,
    feedback: null,
    lastFeedbackTime: 0,
  };
}

function initRepWindow(tStart: number): RepWindow {
  return {
    tStart,
    tBottom: null,
    tEnd: tStart,
    minRatio: Infinity,
    maxRatio: -Infinity,
    maxTorsoLean: 0,
    upperArmDriveBaseline: null,
    maxUpperArmDriveDelta: 0,
    upperArmDriveSamples: 0,
    torsoDevBaseline: null,
    maxTorsoLeanBackDelta: 0,
    maxTorsoForwardDelta: 0,
    maxTorsoDev: 0,
    maxTorsoAbsoluteBackLean: 0,
    torsoLeanSamples: 0,
    torsoDevSamples: 0,
    shoulderYBaseline: null,
    maxShoulderShrugRatio: 0,
    shoulderShrugSamples: 0,
    sideViewConfidenceSum: 0,
    sideViewConfidenceMin: 1,
    sideViewConfidenceSamples: 0,
    selectedSideSamples: 0,
    bilateralSamples: 0,
    leftMinRatio: Infinity,
    leftMaxRatio: -Infinity,
    rightMinRatio: Infinity,
    rightMaxRatio: -Infinity,
    reliability: createPoseStateReliabilityAggregator(),
    frameCount: 0,
  };
}

// ============================================================================
// GEOMETRY HELPERS (module-private)
// ============================================================================

/** Euclidean distance between two keypoints in 2D (x, y). */
function dist2D(a: Keypoint, b: Keypoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the reach ratio for an arm: straight-line shoulder->wrist distance
 * divided by the total segment length (shoulder->elbow + elbow->wrist).
 *
 * Fully extended arm: ratio ~0.95-1.0
 * Fully bent arm: ratio ~0.35-0.55
 *
 * This metric is camera-distance-invariant because both numerator and
 * denominator scale equally with distance from the camera.
 */
function computeReachRatio(
  shoulder: Keypoint,
  elbow: Keypoint,
  wrist: Keypoint,
): number {
  const segmentSum = dist2D(shoulder, elbow) + dist2D(elbow, wrist);
  if (segmentSum < 1e-6) return 1.0; // degenerate case
  return dist2D(shoulder, wrist) / segmentSum;
}

function calculateArmReachRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right',
  threshold = VISIBILITY_THRESHOLD,
): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`, threshold);
  const elbow = visibleKeypoint(keypoints, `${side}_elbow`, threshold);
  const wrist = visibleKeypoint(keypoints, `${side}_wrist`, threshold);
  if (!shoulder || !elbow || !wrist) return null;
  return computeReachRatio(shoulder, elbow, wrist);
}

function selectVisibleSide(keypoints: Keypoint[]): 'left' | 'right' {
  const leftParts = ['left_shoulder', 'left_elbow', 'left_wrist', 'left_hip'];
  const rightParts = ['right_shoulder', 'right_elbow', 'right_wrist', 'right_hip'];

  let leftScore = 0;
  let rightScore = 0;
  for (const name of leftParts) leftScore += getKeypoint(keypoints, name)?.score ?? 0;
  for (const name of rightParts) rightScore += getKeypoint(keypoints, name)?.score ?? 0;
  return leftScore >= rightScore ? 'left' : 'right';
}

/**
 * Compute torso lean from vertical using a single shoulder + hip.
 * Uses calculateVerticalAngle() which handles both Y-up (world landmarks)
 * and Y-down (image landmarks) coordinate systems correctly.
 * Returns absolute lean angle in degrees (0 = perfectly upright).
 */
function computeTorsoLean(shoulder: Keypoint, hip: Keypoint): number {
  return calculateVerticalAngle(hip, shoulder);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isFiniteMetric(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function midpoint(a: Keypoint, b: Keypoint): Keypoint {
  return {
    name: `${a.name}_${b.name}_mid`,
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
    z: ((a.z ?? 0) + (b.z ?? 0)) * 0.5,
    score: Math.min(a.score, b.score),
  };
}

function distance3D(a: Keypoint, b: Keypoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function landmarkSources(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
): LandmarkSource[] {
  const sources: LandmarkSource[] = [];
  const pushUnique = (name: LandmarkSourceName, keypoints: Keypoint[] | undefined) => {
    if (!keypoints || keypoints.length === 0) return;
    if (sources.some((source) => source.keypoints === keypoints)) return;
    sources.push({ name, keypoints });
  };

  pushUnique('world', frameContext?.worldKeypoints);
  pushUnique('image', frameContext?.imageKeypoints);
  pushUnique('fallback', fallbackKeypoints);
  return sources;
}

function signalSourceKeypoints(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
): Keypoint[] {
  return frameContext?.imageKeypoints ?? fallbackKeypoints;
}

function sourceMatchesImageReach(
  source: LandmarkSource,
  frameContext: ExerciseFrameContext | undefined,
  side: 'left' | 'right',
): boolean {
  if (source.name !== 'world') return true;

  const imageKeypoints = frameContext?.imageKeypoints;
  if (!imageKeypoints) return true;

  const imageReachRatio = calculateArmReachRatio(imageKeypoints, side);
  const sourceReachRatio = calculateArmReachRatio(source.keypoints, side);
  if (imageReachRatio === null || sourceReachRatio === null) return true;

  return Math.abs(sourceReachRatio - imageReachRatio) <= WORLD_IMAGE_REACH_RATIO_MAX_DELTA;
}

function visibleKeypoint(
  keypoints: Keypoint[],
  name: string,
  threshold = VISIBILITY_THRESHOLD,
): Keypoint | null {
  const keypoint = getKeypoint(keypoints, name);
  return isVisible(keypoint, threshold) ? keypoint : null;
}

function calculateUpperArmDriveAngle(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const hip = visibleKeypoint(keypoints, `${side}_hip`, FORM_CONFIDENCE_MIN);
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`, FORM_CONFIDENCE_MIN);
  const elbow = visibleKeypoint(keypoints, `${side}_elbow`, FORM_CONFIDENCE_MIN);
  if (!hip || !shoulder || !elbow) return null;

  // At the top the upper arm points overhead (near 0). At the bottom the elbow
  // has driven down beside the torso (larger value).
  return 180 - calculateAngle(hip, shoulder, elbow);
}

function calculateUpperArmDriveSample(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
  side: 'left' | 'right',
): MetricSample | null {
  for (const source of landmarkSources(frameContext, fallbackKeypoints)) {
    if (minKeypointConfidence(source.keypoints, [`${side}_hip`, `${side}_shoulder`, `${side}_elbow`]) < FORM_CONFIDENCE_MIN) {
      continue;
    }
    if (!sourceMatchesImageReach(source, frameContext, side)) continue;
    const value = calculateUpperArmDriveAngle(source.keypoints, side);
    if (isFiniteMetric(value) && value >= 0 && value <= 180) {
      return { value, source: source.name, keypoints: source.keypoints };
    }
  }
  return null;
}

function calculateSagittalTorsoDeviation(keypoints: Keypoint[]): number | null {
  const leftHip = visibleKeypoint(keypoints, 'left_hip', FORM_CONFIDENCE_MIN);
  const rightHip = visibleKeypoint(keypoints, 'right_hip', FORM_CONFIDENCE_MIN);
  const leftShoulder = visibleKeypoint(keypoints, 'left_shoulder', FORM_CONFIDENCE_MIN);
  const rightShoulder = visibleKeypoint(keypoints, 'right_shoulder', FORM_CONFIDENCE_MIN);
  if (!leftHip || !rightHip || !leftShoulder || !rightShoulder) return null;

  const hipCenter = midpoint(leftHip, rightHip);
  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const torsoMag = distance3D(hipCenter, shoulderCenter);
  const coronalMag = distance3D(
    midpoint(leftHip, leftShoulder),
    midpoint(rightHip, rightShoulder),
  );
  if (torsoMag < 1e-6 || coronalMag < 1e-6) return null;

  const value = calculateSignedVerticalAngleSagittal(
    hipCenter,
    shoulderCenter,
    leftHip,
    rightHip,
    leftShoulder,
    rightShoulder,
  );
  return isFiniteMetric(value) ? value : null;
}

function calculateSelectedSideTorsoDeviation(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`, FORM_CONFIDENCE_MIN);
  const hip = visibleKeypoint(keypoints, `${side}_hip`, FORM_CONFIDENCE_MIN);
  if (!shoulder || !hip) return null;

  const vy = shoulder.y - hip.y;
  const vz = (shoulder.z ?? 0) - (hip.z ?? 0);
  const mag = Math.sqrt(vy * vy + vz * vz);
  if (mag < 1e-6) return null;
  return Math.atan2(vz, Math.abs(vy)) * 57.29577951308232;
}

function torsoDeviationForSource(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  return calculateSagittalTorsoDeviation(keypoints) ?? calculateSelectedSideTorsoDeviation(keypoints, side);
}

function sourceMatchesImageTorsoDeviation(
  source: LandmarkSource,
  frameContext: ExerciseFrameContext | undefined,
  side: 'left' | 'right',
): boolean {
  if (source.name !== 'world') return true;

  const imageKeypoints = frameContext?.imageKeypoints;
  if (!imageKeypoints) return true;

  const imageTorsoDev = torsoDeviationForSource(imageKeypoints, side);
  const sourceTorsoDev = torsoDeviationForSource(source.keypoints, side);
  if (imageTorsoDev === null || sourceTorsoDev === null) return true;

  return Math.abs(sourceTorsoDev - imageTorsoDev) <= WORLD_IMAGE_TORSO_DEV_MAX_DELTA;
}

function calculateTorsoDeviationSample(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
  side: 'left' | 'right',
): MetricSample | null {
  const sources = landmarkSources(frameContext, fallbackKeypoints);
  for (const source of sources) {
    if (!sourceMatchesImageReach(source, frameContext, side)) continue;
    if (!sourceMatchesImageTorsoDeviation(source, frameContext, side)) continue;
    const value = calculateSagittalTorsoDeviation(source.keypoints);
    if (isFiniteMetric(value)) {
      return { value, source: source.name, keypoints: source.keypoints, method: 'sagittal' };
    }
  }

  for (const source of sources) {
    if (!sourceMatchesImageReach(source, frameContext, side)) continue;
    if (!sourceMatchesImageTorsoDeviation(source, frameContext, side)) continue;
    const value = calculateSelectedSideTorsoDeviation(source.keypoints, side);
    if (isFiniteMetric(value)) {
      return { value, source: source.name, keypoints: source.keypoints, method: 'selected_side' };
    }
  }
  return null;
}

function calculateTorsoHeight(keypoints: Keypoint[], side: 'left' | 'right'): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`);
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  if (!shoulder || !hip) return null;
  const height = Math.abs(hip.y - shoulder.y);
  return height > 1e-6 ? height : null;
}

function calculateShoulderShrugRatio(
  currentShoulderY: number,
  baselineShoulderY: number,
  torsoHeight: number | null,
): number | null {
  if (torsoHeight === null) return null;
  return Math.max(0, baselineShoulderY - currentShoulderY) / torsoHeight;
}

function calculateSideViewConfidence(keypoints: Keypoint[]): number | null {
  const leftShoulder = visibleKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = visibleKeypoint(keypoints, 'right_shoulder');
  const leftHip = visibleKeypoint(keypoints, 'left_hip');
  const rightHip = visibleKeypoint(keypoints, 'right_hip');
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

  const leftTorso = Math.abs(leftHip.y - leftShoulder.y);
  const rightTorso = Math.abs(rightHip.y - rightShoulder.y);
  const torsoHeight = (leftTorso + rightTorso) * 0.5;
  if (torsoHeight <= 1e-6) return null;

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const hipWidth = Math.abs(leftHip.x - rightHip.x);
  const widthRatio = ((shoulderWidth + hipWidth) * 0.5) / torsoHeight;
  return 1 - clamp01((widthRatio - 0.30) / (0.55 - 0.30));
}

function averageSideViewConfidence(repWindow: RepWindow): number | null {
  if (repWindow.sideViewConfidenceSamples === 0) return null;
  return repWindow.sideViewConfidenceSum / repWindow.sideViewConfidenceSamples;
}

function updateSelectedSideSamples(
  repWindow: RepWindow,
  keypoints: Keypoint[],
  side: 'left' | 'right',
): void {
  const confidence = minKeypointConfidence(keypoints, [
    `${side}_shoulder`,
    `${side}_elbow`,
    `${side}_wrist`,
    `${side}_hip`,
  ]);
  if (confidence >= FORM_CONFIDENCE_MIN) {
    repWindow.selectedSideSamples++;
  }
}

function buildLatPulldownViewQuality(repWindow: RepWindow): RepViewQualityDiagnostic {
  const averageConfidence = averageSideViewConfidence(repWindow);
  const hasEnoughSamples =
    repWindow.sideViewConfidenceSamples >= SIDE_VIEW_MIN_SAMPLES &&
    averageConfidence !== null;
  const bilateralSideConfirmed = Boolean(
    hasEnoughSamples &&
    averageConfidence! >= FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN &&
    repWindow.sideViewConfidenceMin >= FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN,
  );
  const selectedSideConfirmed = repWindow.selectedSideSamples >= SIDE_VIEW_MIN_SAMPLES;
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

function isLatPulldownRepScorable(repWindow: RepWindow): boolean {
  return buildLatPulldownViewQuality(repWindow).sideConfirmed;
}

function latPulldownQualityWarnings(repWindow: RepWindow): FrameworkRepResult['qualityWarnings'] {
  return isLatPulldownRepScorable(repWindow) ? [] : ['side_view_uncertain'];
}

function diagnosticsViewFor(viewQuality: RepViewQualityDiagnostic): NonNullable<FrameworkRepResult['diagnostics']>['view'] {
  if (viewQuality.sideConfirmed) return 'side';
  if (viewQuality.frontishConfirmed) return 'front';
  return 'unknown';
}

function updateBilateralRatios(repWindow: RepWindow, keypoints: Keypoint[]): void {
  const leftRatio = calculateArmReachRatio(keypoints, 'left', FORM_CONFIDENCE_MIN);
  const rightRatio = calculateArmReachRatio(keypoints, 'right', FORM_CONFIDENCE_MIN);
  if (leftRatio === null || rightRatio === null) return;

  repWindow.bilateralSamples++;
  repWindow.leftMinRatio = Math.min(repWindow.leftMinRatio, leftRatio);
  repWindow.leftMaxRatio = Math.max(repWindow.leftMaxRatio, leftRatio);
  repWindow.rightMinRatio = Math.min(repWindow.rightMinRatio, rightRatio);
  repWindow.rightMaxRatio = Math.max(repWindow.rightMaxRatio, rightRatio);
}

function hasBilateralDiagnostics(repWindow: RepWindow): boolean {
  return (
    repWindow.bilateralSamples >= BILATERAL_MIN_SAMPLES &&
    repWindow.leftMinRatio < Infinity &&
    repWindow.rightMinRatio < Infinity &&
    repWindow.leftMaxRatio > -Infinity &&
    repWindow.rightMaxRatio > -Infinity
  );
}

function bilateralRomAsymmetry(repWindow: RepWindow): number | null {
  if (!hasBilateralDiagnostics(repWindow)) return null;
  const leftRom = repWindow.leftMaxRatio - repWindow.leftMinRatio;
  const rightRom = repWindow.rightMaxRatio - repWindow.rightMinRatio;
  return Math.abs(leftRom - rightRom);
}

function bilateralPullDepthAsymmetry(repWindow: RepWindow): number | null {
  if (!hasBilateralDiagnostics(repWindow)) return null;
  return Math.abs(repWindow.leftMinRatio - repWindow.rightMinRatio);
}

function bilateralExtensionAsymmetry(repWindow: RepWindow): number | null {
  if (!hasBilateralDiagnostics(repWindow)) return null;
  return Math.abs(repWindow.leftMaxRatio - repWindow.rightMaxRatio);
}

function hasUpperArmDriveDiagnostics(repWindow: RepWindow): boolean {
  return repWindow.upperArmDriveSamples >= FORM_METRIC_MIN_SAMPLES;
}

function hasTorsoLeanDiagnostics(repWindow: RepWindow): boolean {
  return repWindow.torsoLeanSamples >= FORM_METRIC_MIN_SAMPLES;
}

function hasTorsoDeviationDiagnostics(repWindow: RepWindow): boolean {
  return repWindow.torsoDevSamples >= FORM_METRIC_MIN_SAMPLES;
}

function hasShoulderShrugDiagnostics(repWindow: RepWindow): boolean {
  return repWindow.shoulderShrugSamples >= FORM_METRIC_MIN_SAMPLES;
}

function hasAnyTorsoWarnDiagnostics(repWindow: RepWindow): boolean {
  return hasTorsoDeviationDiagnostics(repWindow) || hasTorsoLeanDiagnostics(repWindow);
}

function torsoRockDelta(repWindow: RepWindow): number {
  if (repWindow.maxTorsoLeanBackDelta <= 0 || repWindow.maxTorsoForwardDelta <= 0) {
    return 0;
  }
  return repWindow.maxTorsoLeanBackDelta + repWindow.maxTorsoForwardDelta;
}

function torsoWarnValue(repWindow: RepWindow): number | null {
  const values: number[] = [];
  if (hasTorsoDeviationDiagnostics(repWindow)) values.push(repWindow.maxTorsoLeanBackDelta);
  if (hasTorsoLeanDiagnostics(repWindow)) values.push(repWindow.maxTorsoAbsoluteBackLean);
  return values.length > 0 ? Math.max(...values) : null;
}

function torsoWarnTriggered(repWindow: RepWindow): boolean {
  return (
    (
      hasTorsoDeviationDiagnostics(repWindow) &&
      repWindow.maxTorsoLeanBackDelta > FORM_THRESHOLDS.TORSO_LEAN_WARN
    ) ||
    (
      hasTorsoLeanDiagnostics(repWindow) &&
      repWindow.maxTorsoAbsoluteBackLean > FORM_THRESHOLDS.TORSO_ABSOLUTE_WARN
    )
  );
}

function cueFamilyAllowed(allowedCueFamilies: ReadonlySet<string> | undefined, family: string): boolean {
  return !allowedCueFamilies || allowedCueFamilies.has(family);
}

function selectedArmChain(activeSide: 'left' | 'right'): 'leftArm' | 'rightArm' {
  return activeSide === 'left' ? 'leftArm' : 'rightArm';
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

function reliabilityInterpretationForRepWindow(
  repWindow: RepWindow,
  activeSide: 'left' | 'right',
): {
  summary: PoseStateReliabilitySummary;
  interpretation: RepReliabilityInterpretation;
} | null {
  const summary = repWindow.reliability.snapshot();
  if (summary.totalFrames === 0) return null;

  const baseInterpretation = interpretPoseStateReliabilitySummary('Cable Lat Pulldowns', summary);
  const selectedChain = selectedArmChain(activeSide);
  if (baseInterpretation.usableChains.includes(selectedChain)) {
    return { summary, interpretation: baseInterpretation };
  }

  const selectedArmUnsafeFamilies = new Set<string>(LAT_PULLDOWN_SELECTED_ARM_CUE_FAMILIES);
  const safeCueFamilies = baseInterpretation.safeCueFamilies.filter(
    family => !selectedArmUnsafeFamilies.has(family),
  );
  const unsafeCueFamilies = uniqueStrings([
    ...baseInterpretation.unsafeCueFamilies,
    ...LAT_PULLDOWN_SELECTED_ARM_CUE_FAMILIES,
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
        'selected_arm_cue_families_unsafe',
      ]),
    },
  };
}

function safeCueFamilySet(interpretation: RepReliabilityInterpretation | null): ReadonlySet<string> | undefined {
  return interpretation ? new Set(interpretation.safeCueFamilies) : undefined;
}

function reliabilityAllowsScoring(
  interpretation: RepReliabilityInterpretation | null,
  activeSide: 'left' | 'right',
): boolean {
  if (!interpretation) return true;
  return (
    interpretation.scoreabilityCandidate !== 'notScoreable' &&
    interpretation.usableChains.includes(selectedArmChain(activeSide)) &&
    interpretation.usableChains.includes('torso')
  );
}

function repScorableWithReliability(
  repWindow: RepWindow,
  interpretation: RepReliabilityInterpretation | null,
  activeSide: 'left' | 'right',
): boolean {
  return isLatPulldownRepScorable(repWindow) && reliabilityAllowsScoring(interpretation, activeSide);
}

function suppressUnsafeReliabilityMessages(
  messages: string[],
  interpretation: RepReliabilityInterpretation | null,
): string[] {
  if (!interpretation) return messages;

  const unsafeFamilies = new Set(interpretation.unsafeCueFamilies);
  return messages.filter((message) => {
    const families = LAT_PULLDOWN_MESSAGE_CUE_FAMILIES[message] ?? [];
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
      const families = LAT_PULLDOWN_ISSUE_CUE_FAMILIES[issueId] ?? [];
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

function shouldLogLatPulldownReliability(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    !(typeof process !== 'undefined' && process.env.JEST_WORKER_ID)
  );
}

function logLatPulldownRepReliability(
  repIndex: number,
  interpretation: RepReliabilityInterpretation | null,
  diagnostics: FrameworkRepResult['diagnostics'],
): void {
  if (!interpretation || !shouldLogLatPulldownReliability()) return;
  const reliability = diagnostics?.reliability;
  console.log([
    `[LatPulldownReliability] rep=${repIndex}`,
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
  return LAT_PULLDOWN_RELIABILITY_JOINTS.some((jointName) => {
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

function observeLatPulldownPoseState(
  repWindow: RepWindow,
  frameContext: ExerciseFrameContext | undefined,
): void {
  const poseState = frameContext?.poseState;
  if (!poseState || !poseStateHasRichReliabilityMetadata(poseState)) return;
  repWindow.reliability.observe(poseState);
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMResult {
  phase: LatPulldownPhase;
  repCompleted: boolean;
}

function updateFSM(
  currentPhase: LatPulldownPhase,
  ratio: number,
  t: number,
  tRepStart: number | null,
  requireExtension: boolean,
): FSMResult {
  let phase = currentPhase;
  let repCompleted = false;

  switch (phase) {
    case 'REST':
      // Ratio drops below threshold = arm bending = pulling
      if (ratio < THRESHOLDS.PULLING_ENTER && !requireExtension) {
        phase = 'PULLING';
      }
      break;

    case 'PULLING':
      if (ratio < THRESHOLDS.BOTTOM_ENTER) {
        phase = 'BOTTOM';
      } else if (
        ratio > THRESHOLDS.REST_REENTER &&
        tRepStart !== null &&
        (t - tRepStart) >= THRESHOLDS.PULLING_ABORT_MIN_TIME
      ) {
        // Went back to extended without pulling deep enough -- reset.
        phase = 'REST';
      }
      break;

    case 'BOTTOM':
      if (ratio > THRESHOLDS.BOTTOM_EXIT) {
        phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      if (
        ratio > THRESHOLDS.REST_REENTER &&
        tRepStart !== null &&
        (t - tRepStart) >= THRESHOLDS.MIN_REP_TIME
      ) {
        phase = 'REST';
        repCompleted = true;
      } else if (ratio < THRESHOLDS.BOTTOM_ENTER) {
        phase = 'BOTTOM';
      }
      break;
  }

  return { phase, repCompleted };
}

// ============================================================================
// SCORING (continuous penalty curves)
// ============================================================================

function computeLatPulldownScore(
  repWindow: RepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM pull: target follows the tunable feedback threshold.
  if (cueFamilyAllowed(allowedCueFamilies, 'rangeOfMotion')) {
    const pullShortfall = Math.max(0, repWindow.minRatio - FORM_THRESHOLDS.PULL_ROM_FAIL);
    penalties.push({ value: pullShortfall, config: PENALTY_CONFIGS.PULL_ROM });
  }

  // 2. ROM extension: target follows the tunable feedback threshold.
  if (cueFamilyAllowed(allowedCueFamilies, 'rangeOfMotion')) {
    const extensionShortfall = Math.max(0, FORM_THRESHOLDS.EXTENSION_ROM_FAIL - repWindow.maxRatio);
    penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });
  }

  // 3. Upper-arm drive: elbows should travel down instead of only bending the arms.
  if (cueFamilyAllowed(allowedCueFamilies, 'elbowPath') && hasUpperArmDriveDiagnostics(repWindow)) {
    const upperArmDriveShortfall = Math.max(0, FORM_THRESHOLDS.ELBOW_DRIVE_FAIL - repWindow.maxUpperArmDriveDelta);
    penalties.push({ value: upperArmDriveShortfall, config: PENALTY_CONFIGS.ELBOW_DRIVE });
  }

  // 4. Torso and shoulder mechanics.
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoControl') && hasTorsoDeviationDiagnostics(repWindow)) {
    penalties.push({ value: repWindow.maxTorsoLeanBackDelta, config: PENALTY_CONFIGS.TORSO_LEAN });
    penalties.push({ value: torsoRockDelta(repWindow), config: PENALTY_CONFIGS.TORSO_ROCK });
  }
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoControl') && hasTorsoLeanDiagnostics(repWindow)) {
    penalties.push({ value: repWindow.maxTorsoAbsoluteBackLean, config: PENALTY_CONFIGS.TORSO_ABSOLUTE });
  }
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoControl') && hasShoulderShrugDiagnostics(repWindow)) {
    penalties.push({ value: repWindow.maxShoulderShrugRatio, config: PENALTY_CONFIGS.SHOULDER_SHRUG });
  }

  // 5. Tempo
  if (cueFamilyAllowed(allowedCueFamilies, 'tempo') && repWindow.tBottom !== null) {
    const tPull = repWindow.tBottom - repWindow.tStart;
    const tReturn = repWindow.tEnd - repWindow.tBottom;

    if (tPull > 0 && tPull < FORM_THRESHOLDS.TEMPO_PULL_MIN) {
      const deficit = FORM_THRESHOLDS.TEMPO_PULL_MIN - tPull;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_PULL, deadzone: 0 } });
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      const deficit = FORM_THRESHOLDS.TEMPO_RETURN_MIN - tReturn;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_RETURN, deadzone: 0 } });
    }
  }

  return computeScore(penalties);
}

// ============================================================================
// FORM MESSAGES (discrete thresholds)
// ============================================================================

function generateFormMessages(
  repWindow: RepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): string[] {
  const messages: string[] = [];

  if (cueFamilyAllowed(allowedCueFamilies, 'rangeOfMotion') && repWindow.minRatio > FORM_THRESHOLDS.PULL_ROM_FAIL) {
    messages.push('Pull deeper \u2014 bring the bar to your upper chest.');
  }

  if (cueFamilyAllowed(allowedCueFamilies, 'rangeOfMotion') && repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_ROM_FAIL) {
    messages.push('Extend fully \u2014 reach all the way up at the top.');
  }

  if (
    cueFamilyAllowed(allowedCueFamilies, 'elbowPath') &&
    hasUpperArmDriveDiagnostics(repWindow) &&
    repWindow.maxUpperArmDriveDelta < FORM_THRESHOLDS.ELBOW_DRIVE_FAIL
  ) {
    messages.push('Drive your elbows down \u2014 pull with your lats, not just your arms.');
  }

  if (cueFamilyAllowed(allowedCueFamilies, 'torsoControl') && torsoWarnTriggered(repWindow)) {
    messages.push('Stay upright \u2014 avoid leaning back excessively.');
  }

  if (
    cueFamilyAllowed(allowedCueFamilies, 'torsoControl') &&
    hasTorsoDeviationDiagnostics(repWindow) &&
    torsoRockDelta(repWindow) > FORM_THRESHOLDS.TORSO_ROCK_WARN
  ) {
    messages.push('Keep your torso steady through the pulldown.');
  }

  if (
    cueFamilyAllowed(allowedCueFamilies, 'torsoControl') &&
    hasShoulderShrugDiagnostics(repWindow) &&
    repWindow.maxShoulderShrugRatio > FORM_THRESHOLDS.SHOULDER_SHRUG_WARN
  ) {
    messages.push('Keep your shoulders down as you pull.');
  }

  if (cueFamilyAllowed(allowedCueFamilies, 'tempo') && repWindow.tBottom !== null) {
    const tPull = repWindow.tBottom - repWindow.tStart;
    const tReturn = repWindow.tEnd - repWindow.tBottom;

    if (tPull > 0 && tPull < FORM_THRESHOLDS.TEMPO_PULL_MIN) {
      messages.push('Slow down the pull \u2014 control the descent.');
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      messages.push('Control the return \u2014 resist the weight on the way up.');
    }
  }

  return messages;
}

function buildLatPulldownDiagnostics(
  repWindow: RepWindow,
  repIndex: number,
  activeSide: 'left' | 'right',
  scorable: boolean,
): NonNullable<FrameworkRepResult['diagnostics']> {
  const hasTempo = repWindow.tBottom !== null;
  const tPull = repWindow.tBottom !== null ? repWindow.tBottom - repWindow.tStart : null;
  const tReturn = repWindow.tBottom !== null ? repWindow.tEnd - repWindow.tBottom : null;
  const sideViewConfidence = averageSideViewConfidence(repWindow);
  const hasSideViewConfidence = repWindow.sideViewConfidenceSamples >= SIDE_VIEW_MIN_SAMPLES;
  const viewQuality = buildLatPulldownViewQuality(repWindow);
  const hasBilateral = hasBilateralDiagnostics(repWindow);
  const hasUpperArmDrive = hasUpperArmDriveDiagnostics(repWindow);
  const hasTorsoLean = hasTorsoLeanDiagnostics(repWindow);
  const hasTorsoDeviation = hasTorsoDeviationDiagnostics(repWindow);
  const hasTorsoWarn = hasAnyTorsoWarnDiagnostics(repWindow);
  const hasShoulderShrug = hasShoulderShrugDiagnostics(repWindow);
  const leftRomRatio = hasBilateral ? repWindow.leftMaxRatio - repWindow.leftMinRatio : null;
  const rightRomRatio = hasBilateral ? repWindow.rightMaxRatio - repWindow.rightMinRatio : null;
  return buildRepDiagnostics({
    exerciseName: 'Cable Lat Pulldowns',
    repIndex,
    view: diagnosticsViewFor(viewQuality),
    selectedSide: activeSide,
    scorable,
    viewQuality,
    metrics: [
      diagnosticMetric('pullDepthRatio', repWindow.minRatio, { unit: 'ratio' }),
      diagnosticMetric('extensionRatio', repWindow.maxRatio, { unit: 'ratio' }),
      diagnosticMetric('romRatio', repWindow.maxRatio - repWindow.minRatio, { unit: 'ratio' }),
      diagnosticMetric('upperArmDriveDelta', repWindow.maxUpperArmDriveDelta, {
        unit: 'degrees',
        eligible: hasUpperArmDrive,
        sampleCount: repWindow.upperArmDriveSamples,
        skippedReason: 'insufficient_upper_arm_drive_samples',
      }),
      diagnosticMetric('torsoLeanBackDelta', repWindow.maxTorsoLeanBackDelta, {
        unit: 'degrees',
        eligible: hasTorsoDeviation,
        sampleCount: repWindow.torsoDevSamples,
        skippedReason: 'insufficient_torso_deviation_samples',
      }),
      diagnosticMetric('torsoForwardDelta', repWindow.maxTorsoForwardDelta, {
        unit: 'degrees',
        eligible: hasTorsoDeviation,
        sampleCount: repWindow.torsoDevSamples,
        skippedReason: 'insufficient_torso_deviation_samples',
      }),
      diagnosticMetric('torsoRockDelta', torsoRockDelta(repWindow), {
        unit: 'degrees',
        eligible: hasTorsoDeviation,
        sampleCount: repWindow.torsoDevSamples,
        skippedReason: 'insufficient_torso_deviation_samples',
      }),
      diagnosticMetric('torsoAbsoluteBackLean', repWindow.maxTorsoAbsoluteBackLean, {
        unit: 'degrees',
        eligible: hasTorsoLean,
        sampleCount: repWindow.torsoLeanSamples,
        skippedReason: 'insufficient_torso_lean_samples',
      }),
      diagnosticMetric('shoulderShrugRatio', repWindow.maxShoulderShrugRatio, {
        unit: 'ratio',
        eligible: hasShoulderShrug,
        sampleCount: repWindow.shoulderShrugSamples,
        skippedReason: 'insufficient_shoulder_shrug_samples',
      }),
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
      diagnosticMetric('selectedSideSampleCount', repWindow.selectedSideSamples, { unit: 'count' }),
      diagnosticMetric('sideViewConfirmed', viewQuality.sideConfirmed ? 1 : 0, { unit: 'count' }),
      diagnosticMetric('frontishViewConfirmed', viewQuality.frontishConfirmed ? 1 : 0, { unit: 'count' }),
      diagnosticMetric('viewUnknown', viewQuality.viewUnknown ? 1 : 0, { unit: 'count' }),
      diagnosticMetric('bilateralSampleCount', repWindow.bilateralSamples, { unit: 'count' }),
      diagnosticMetric('leftPullDepthRatio', hasBilateral ? repWindow.leftMinRatio : null, {
        unit: 'ratio',
        eligible: hasBilateral,
        sampleCount: repWindow.bilateralSamples,
        skippedReason: 'bilateral_landmarks_unavailable',
      }),
      diagnosticMetric('rightPullDepthRatio', hasBilateral ? repWindow.rightMinRatio : null, {
        unit: 'ratio',
        eligible: hasBilateral,
        sampleCount: repWindow.bilateralSamples,
        skippedReason: 'bilateral_landmarks_unavailable',
      }),
      diagnosticMetric('leftExtensionRatio', hasBilateral ? repWindow.leftMaxRatio : null, {
        unit: 'ratio',
        eligible: hasBilateral,
        sampleCount: repWindow.bilateralSamples,
        skippedReason: 'bilateral_landmarks_unavailable',
      }),
      diagnosticMetric('rightExtensionRatio', hasBilateral ? repWindow.rightMaxRatio : null, {
        unit: 'ratio',
        eligible: hasBilateral,
        sampleCount: repWindow.bilateralSamples,
        skippedReason: 'bilateral_landmarks_unavailable',
      }),
      diagnosticMetric('leftRomRatio', leftRomRatio, {
        unit: 'ratio',
        eligible: hasBilateral,
        sampleCount: repWindow.bilateralSamples,
        skippedReason: 'bilateral_landmarks_unavailable',
      }),
      diagnosticMetric('rightRomRatio', rightRomRatio, {
        unit: 'ratio',
        eligible: hasBilateral,
        sampleCount: repWindow.bilateralSamples,
        skippedReason: 'bilateral_landmarks_unavailable',
      }),
      diagnosticMetric('bilateralRomAsymmetry', bilateralRomAsymmetry(repWindow), {
        unit: 'ratio',
        eligible: hasBilateral,
        sampleCount: repWindow.bilateralSamples,
        skippedReason: 'bilateral_landmarks_unavailable',
      }),
      diagnosticMetric('bilateralPullDepthAsymmetry', bilateralPullDepthAsymmetry(repWindow), {
        unit: 'ratio',
        eligible: hasBilateral,
        sampleCount: repWindow.bilateralSamples,
        skippedReason: 'bilateral_landmarks_unavailable',
      }),
      diagnosticMetric('bilateralExtensionAsymmetry', bilateralExtensionAsymmetry(repWindow), {
        unit: 'ratio',
        eligible: hasBilateral,
        sampleCount: repWindow.bilateralSamples,
        skippedReason: 'bilateral_landmarks_unavailable',
      }),
      diagnosticMetric('tPull', tPull, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
      diagnosticMetric('tReturn', tReturn, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'cable-lat-pulldowns.rom_short',
        metricKeys: ['pullDepthRatio'],
        direction: 'above',
        value: repWindow.minRatio,
        thresholdPath: 'formThresholds.PULL_ROM_FAIL',
        thresholdValue: FORM_THRESHOLDS.PULL_ROM_FAIL,
        triggered: repWindow.minRatio > FORM_THRESHOLDS.PULL_ROM_FAIL,
      }),
      diagnosticCue({
        issueId: 'cable-lat-pulldowns.lockout_short',
        metricKeys: ['extensionRatio'],
        direction: 'below',
        value: repWindow.maxRatio,
        thresholdPath: 'formThresholds.EXTENSION_ROM_FAIL',
        thresholdValue: FORM_THRESHOLDS.EXTENSION_ROM_FAIL,
        triggered: repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_ROM_FAIL,
      }),
      diagnosticCue({
        issueId: 'cable-lat-pulldowns.elbow_drive',
        metricKeys: ['upperArmDriveDelta'],
        direction: 'below',
        value: repWindow.maxUpperArmDriveDelta,
        thresholdPath: 'formThresholds.ELBOW_DRIVE_FAIL',
        thresholdValue: FORM_THRESHOLDS.ELBOW_DRIVE_FAIL,
        eligible: hasUpperArmDrive,
        triggered: hasUpperArmDrive && repWindow.maxUpperArmDriveDelta < FORM_THRESHOLDS.ELBOW_DRIVE_FAIL,
        support: repWindow.upperArmDriveSamples,
        skippedReason: 'insufficient_upper_arm_drive_samples',
      }),
      diagnosticCue({
        issueId: 'cable-lat-pulldowns.torso_warn',
        metricKeys: ['torsoLeanBackDelta', 'torsoAbsoluteBackLean'],
        direction: 'above',
        value: torsoWarnValue(repWindow),
        thresholdPath: ['formThresholds.TORSO_LEAN_WARN', 'formThresholds.TORSO_ABSOLUTE_WARN'],
        thresholdValue: {
          torsoLeanBackDelta: FORM_THRESHOLDS.TORSO_LEAN_WARN,
          torsoAbsoluteBackLean: FORM_THRESHOLDS.TORSO_ABSOLUTE_WARN,
        },
        eligible: hasTorsoWarn,
        triggered: hasTorsoWarn && torsoWarnTriggered(repWindow),
        support: Math.max(repWindow.torsoDevSamples, repWindow.torsoLeanSamples),
        skippedReason: 'insufficient_torso_samples',
      }),
      diagnosticCue({
        issueId: 'cable-lat-pulldowns.torso_rocking',
        metricKeys: ['torsoRockDelta'],
        direction: 'above',
        value: torsoRockDelta(repWindow),
        thresholdPath: 'formThresholds.TORSO_ROCK_WARN',
        thresholdValue: FORM_THRESHOLDS.TORSO_ROCK_WARN,
        eligible: hasTorsoDeviation,
        triggered: hasTorsoDeviation && torsoRockDelta(repWindow) > FORM_THRESHOLDS.TORSO_ROCK_WARN,
        support: repWindow.torsoDevSamples,
        skippedReason: 'insufficient_torso_deviation_samples',
      }),
      diagnosticCue({
        issueId: 'cable-lat-pulldowns.shoulder_shrug',
        metricKeys: ['shoulderShrugRatio'],
        direction: 'above',
        value: repWindow.maxShoulderShrugRatio,
        thresholdPath: 'formThresholds.SHOULDER_SHRUG_WARN',
        thresholdValue: FORM_THRESHOLDS.SHOULDER_SHRUG_WARN,
        eligible: hasShoulderShrug,
        triggered: hasShoulderShrug && repWindow.maxShoulderShrugRatio > FORM_THRESHOLDS.SHOULDER_SHRUG_WARN,
        support: repWindow.shoulderShrugSamples,
        skippedReason: 'insufficient_shoulder_shrug_samples',
      }),
      diagnosticCue({
        issueId: 'cable-lat-pulldowns.tempo_down',
        metricKeys: ['tPull'],
        direction: 'below',
        value: tPull,
        thresholdPath: 'formThresholds.TEMPO_PULL_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_PULL_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tPull !== null && tPull > 0 && tPull < FORM_THRESHOLDS.TEMPO_PULL_MIN,
        skippedReason: 'bottom_not_detected',
      }),
      diagnosticCue({
        issueId: 'cable-lat-pulldowns.tempo_up',
        metricKeys: ['tReturn'],
        direction: 'below',
        value: tReturn,
        thresholdPath: 'formThresholds.TEMPO_RETURN_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_RETURN_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tReturn !== null && tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN,
        skippedReason: 'bottom_not_detected',
      }),
    ],
  });
}

function buildLatPulldownRepResult(
  repWindow: RepWindow,
  repIndex: number,
  activeSide: 'left' | 'right',
): RepResult {
  const reliability = reliabilityInterpretationForRepWindow(repWindow, activeSide);
  const reliabilityInterpretation = reliability?.interpretation ?? null;
  const allowedCueFamilies = safeCueFamilySet(reliabilityInterpretation);
  const scorable = repScorableWithReliability(repWindow, reliabilityInterpretation, activeSide);
  // ScoreabilityCandidate controls reliability safety; final scorable also
  // includes the exercise view gate. Keep the historical score calculation for
  // diagnostics even if the view gate later marks the rep unscorable.
  const score = reliabilityAllowsScoring(reliabilityInterpretation, activeSide)
    ? computeLatPulldownScore(repWindow, allowedCueFamilies)
    : 0;
  const messages = suppressUnsafeReliabilityMessages(
    generateFormMessages(repWindow, allowedCueFamilies),
    reliabilityInterpretation,
  );
  const qualityWarnings = latPulldownQualityWarnings(repWindow);
  const diagnostics = applyReliabilityCueGating(
    buildLatPulldownDiagnostics(repWindow, repIndex, activeSide, scorable),
    reliabilityInterpretation,
    scorable,
  );
  logLatPulldownRepReliability(repIndex, reliabilityInterpretation, diagnostics);

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
// MAIN UPDATE LOGIC
// ============================================================================

function updateLatPulldownState(
  keypoints: Keypoint[],
  state: LatPulldownState,
  frameContext?: ExerciseFrameContext,
): LatPulldownState {
  const timestampMs =
    typeof frameContext?.timestampMs === 'number' && Number.isFinite(frameContext.timestampMs)
      ? frameContext.timestampMs
      : Date.now();
  const t = timestampMs / 1000;
  const signalKeypoints = signalSourceKeypoints(frameContext, keypoints);

  if (frameContext?.trackingInterrupted) {
    return resetLatPulldownAfterTrackingInterruption(state);
  }

  // -- Warmup gate --
  if (!state.warmedUp) {
    const stable = state.warmupGate.update(signalKeypoints);
    if (!stable) return state;
    state.warmedUp = true;
  }

  // -- Fetch keypoints --
  const ls = getKeypoint(signalKeypoints, 'left_shoulder');
  const rs = getKeypoint(signalKeypoints, 'right_shoulder');
  const le = getKeypoint(signalKeypoints, 'left_elbow');
  const re = getKeypoint(signalKeypoints, 'right_elbow');
  const lw = getKeypoint(signalKeypoints, 'left_wrist');
  const rw = getKeypoint(signalKeypoints, 'right_wrist');
  const lh = getKeypoint(signalKeypoints, 'left_hip');
  const rh = getKeypoint(signalKeypoints, 'right_hip');

  // -- Pick active side during REST; lock it during a rep --
  if (state.phase === 'REST' && !state.repWindow) {
    state.activeSide = selectVisibleSide(signalKeypoints);
  }

  const side = state.activeSide;
  state.debugSide = side;
  const shoulder = side === 'left' ? ls : rs;
  const elbow    = side === 'left' ? le : re;
  const wrist    = side === 'left' ? lw : rw;
  const hip      = side === 'left' ? lh : rh;

  const armVisible =
    isVisible(shoulder, VISIBILITY_THRESHOLD) &&
    isVisible(elbow, VISIBILITY_THRESHOLD) &&
    isVisible(wrist, VISIBILITY_THRESHOLD);

  if (!armVisible) return state;

  // -- Compute raw values --
  const rawRatio = computeReachRatio(shoulder!, elbow!, wrist!);
  const armConf = minKeypointConfidence(signalKeypoints, [
    `${side}_shoulder`, `${side}_elbow`, `${side}_wrist`,
  ]);
  const torsoConf = minKeypointConfidence(signalKeypoints, [
    `${side}_shoulder`, `${side}_hip`,
  ]);
  const upperArmSample = calculateUpperArmDriveSample(frameContext, keypoints, side);
  const torsoSample = calculateTorsoDeviationSample(frameContext, keypoints, side);
  const rawUpperArmDrive = upperArmSample?.value ?? null;
  const rawTorsoDev = torsoSample?.value ?? null;
  const sideViewConfidence = calculateSideViewConfidence(signalKeypoints);

  let rawTorsoLean: number | null = null;
  if (isVisible(shoulder, VISIBILITY_THRESHOLD) && isVisible(hip, VISIBILITY_THRESHOLD)) {
    rawTorsoLean = computeTorsoLean(shoulder!, hip!);
  }

  // -- Smooth values --
  const smoothedRatio = state.ratioTracker.push(rawRatio, armConf, timestampMs);
  const fastRatio = state.ratioTracker.medianValue;
  const smoothedTorsoLean = rawTorsoLean !== null
    ? state.torsoLeanTracker.push(rawTorsoLean, torsoConf, timestampMs)
    : state.torsoLeanTracker.value;
  const smoothedUpperArmDrive = rawUpperArmDrive !== null
    ? state.upperArmDriveTracker.push(rawUpperArmDrive, undefined, timestampMs)
    : state.upperArmDriveTracker.value;
  const smoothedTorsoDev = rawTorsoDev !== null
    ? state.torsoDevTracker.push(rawTorsoDev, undefined, timestampMs)
    : state.torsoDevTracker.value;

  if (isNaN(fastRatio)) return state;

  state.smoothedRatio = smoothedRatio;
  state.smoothedTorsoLean = isNaN(smoothedTorsoLean) ? state.smoothedTorsoLean : smoothedTorsoLean;
  state.smoothedUpperArmDrive = isNaN(smoothedUpperArmDrive) ? state.smoothedUpperArmDrive : smoothedUpperArmDrive;
  state.smoothedTorsoDev = isNaN(smoothedTorsoDev) ? state.smoothedTorsoDev : smoothedTorsoDev;

  // -- Track max ratio during REST (pre-pull extension) --
  if (state.phase === 'REST') {
    if (rawRatio >= state.restMaxRatio) {
      state.restMaxRatio = rawRatio;
      state.tRestPeakRatio = t;
      state.restUpperArmDriveBaseline = rawUpperArmDrive;
      state.restTorsoDevBaseline = rawTorsoDev;
      state.restShoulderYBaseline = isVisible(shoulder, FORM_CONFIDENCE_MIN) ? shoulder!.y : null;
    }
    if (state.requireExtensionBeforeNextRep) {
      const extensionReached = fastRatio >= THRESHOLDS.PULLING_ENTER;
      const timedOut = state.tRepCompleted !== null && (t - state.tRepCompleted) > 1.5;
      if (extensionReached || timedOut) {
        state.requireExtensionBeforeNextRep = false;
        state.tRepCompleted = null;
      }
    }
  }

  // -- FSM update --
  const fsmResult = updateFSM(state.phase, fastRatio, t, state.tRepStart, state.requireExtensionBeforeNextRep);
  const prevPhase = state.phase;
  state.phase = fsmResult.phase;

  // -- Track rep start --
  if (prevPhase === 'REST' && state.phase === 'PULLING') {
    state.tRepStart = t;
    // Use the time of peak ratio extension during REST as the true pull start
    // for tempo calculation.  This avoids artificially short tPull when the
    // extension-gate timeout fires and the FSM enters PULLING late (with the
    // smoothed ratio already well below PULLING_ENTER).
    const pullStartTime = state.tRestPeakRatio ?? t;
    state.repWindow = initRepWindow(pullStartTime);
    state.repWindow.maxRatio = Number.isFinite(state.restMaxRatio) ? state.restMaxRatio : rawRatio;
    state.repWindow.upperArmDriveBaseline = state.restUpperArmDriveBaseline ?? rawUpperArmDrive;
    state.repWindow.torsoDevBaseline = state.restTorsoDevBaseline ?? rawTorsoDev;
    state.repWindow.shoulderYBaseline = state.restShoulderYBaseline ?? (
      isVisible(shoulder, FORM_CONFIDENCE_MIN) ? shoulder!.y : null
    );
    state.restMaxRatio = -Infinity;
    state.tRestPeakRatio = null;
    state.restUpperArmDriveBaseline = null;
    state.restTorsoDevBaseline = null;
    state.restShoulderYBaseline = null;
  }

  // -- Accumulate rep window while in a rep --
  const inRep = state.phase !== 'REST';
  if (state.repWindow && inRep) {
    const w = state.repWindow;
    observeLatPulldownPoseState(w, frameContext);
    w.tEnd = t;
    w.frameCount++;
    w.minRatio = Math.min(w.minRatio, fastRatio);
    w.maxRatio = Math.max(w.maxRatio, rawRatio, fastRatio);
    if (sideViewConfidence !== null) {
      w.sideViewConfidenceSum += sideViewConfidence;
      w.sideViewConfidenceMin = Math.min(w.sideViewConfidenceMin, sideViewConfidence);
      w.sideViewConfidenceSamples++;
    }
    updateSelectedSideSamples(w, signalKeypoints, side);
    updateBilateralRatios(w, signalKeypoints);
    // Only update torso lean max when shoulder + hip have sufficient confidence.
    if (torsoConf >= 0.3 && !isNaN(smoothedTorsoLean)) {
      w.torsoLeanSamples++;
      w.maxTorsoLean = Math.max(w.maxTorsoLean, smoothedTorsoLean);
      w.maxTorsoAbsoluteBackLean = Math.max(w.maxTorsoAbsoluteBackLean, smoothedTorsoLean);
    }

    if (rawUpperArmDrive !== null) {
      w.upperArmDriveSamples++;
      if (w.upperArmDriveBaseline === null) {
        w.upperArmDriveBaseline = rawUpperArmDrive;
      }
      const driveDelta = rawUpperArmDrive - w.upperArmDriveBaseline;
      w.maxUpperArmDriveDelta = Math.max(w.maxUpperArmDriveDelta, Math.max(0, driveDelta));
    }

    if (rawTorsoDev !== null) {
      w.torsoDevSamples++;
      if (w.torsoDevBaseline === null) {
        w.torsoDevBaseline = rawTorsoDev;
      }
      const signedTorsoDelta = rawTorsoDev - w.torsoDevBaseline;
      const torsoDelta = Math.abs(signedTorsoDelta);
      w.maxTorsoLeanBackDelta = Math.max(w.maxTorsoLeanBackDelta, Math.max(0, -signedTorsoDelta));
      w.maxTorsoForwardDelta = Math.max(w.maxTorsoForwardDelta, Math.max(0, signedTorsoDelta));
      w.maxTorsoDev = Math.max(w.maxTorsoDev, torsoDelta);
    }

    const signalShoulder = visibleKeypoint(signalKeypoints, `${side}_shoulder`, FORM_CONFIDENCE_MIN);
    const torsoHeight = calculateTorsoHeight(signalKeypoints, side);
    if (signalShoulder) {
      if (w.shoulderYBaseline === null) {
        w.shoulderYBaseline = signalShoulder.y;
      }
      const shoulderShrugRatio = calculateShoulderShrugRatio(
        signalShoulder.y,
        w.shoulderYBaseline,
        torsoHeight,
      );
      if (shoulderShrugRatio !== null) {
        w.shoulderShrugSamples++;
        w.maxShoulderShrugRatio = Math.max(w.maxShoulderShrugRatio, shoulderShrugRatio);
      }
    }

    if (state.phase === 'BOTTOM' && w.tBottom === null && fastRatio <= THRESHOLDS.BOTTOM_ENTER) {
      w.tBottom = t;
    }
  }

  // -- Handle rep completion --
  if (fsmResult.repCompleted && state.repWindow) {
    observeLatPulldownPoseState(state.repWindow, frameContext);
    state.repWindow.maxRatio = Math.max(state.repWindow.maxRatio, rawRatio, fastRatio);
    if (sideViewConfidence !== null) {
      state.repWindow.sideViewConfidenceSum += sideViewConfidence;
      state.repWindow.sideViewConfidenceMin = Math.min(
        state.repWindow.sideViewConfidenceMin,
        sideViewConfidence,
      );
      state.repWindow.sideViewConfidenceSamples++;
    }
    updateSelectedSideSamples(state.repWindow, signalKeypoints, side);
    updateBilateralRatios(state.repWindow, signalKeypoints);

    state.repCount++;
    state.requireExtensionBeforeNextRep = true;
    state.tRepCompleted = t;

    const repResult = buildLatPulldownRepResult(state.repWindow, state.repCount, state.activeSide);
    const messages = repResult.messages;
    state.lastRepResult = repResult;

    state.feedback = messages.length > 0 ? messages.join('\n') : 'Great rep!';
    state.lastFeedbackTime = t;

    state.repWindow = null;
    state.tRepStart = null;
    state.debugSide = state.activeSide;
  }

  // -- Handle aborted pull (PULLING -> REST without rep completion) --
  if (prevPhase === 'PULLING' && state.phase === 'REST' && !fsmResult.repCompleted) {
    let countedPartial = false;
    if (state.repWindow) {
      const w = state.repWindow;
      observeLatPulldownPoseState(w, frameContext);
      w.tEnd = t;
      w.minRatio = Math.min(w.minRatio, fastRatio);
      w.maxRatio = Math.max(w.maxRatio, rawRatio, fastRatio);
      if (sideViewConfidence !== null) {
        w.sideViewConfidenceSum += sideViewConfidence;
        w.sideViewConfidenceMin = Math.min(w.sideViewConfidenceMin, sideViewConfidence);
        w.sideViewConfidenceSamples++;
      }
      updateSelectedSideSamples(w, signalKeypoints, side);
      updateBilateralRatios(w, signalKeypoints);
      const actualRom = w.maxRatio - w.minRatio;
      const duration = w.tEnd - w.tStart;

      if (isMeaningfulPartialRep({
        actualRom,
        minRom: THRESHOLDS.MIN_PARTIAL_ROM,
        duration,
        minDuration: THRESHOLDS.PULLING_ABORT_MIN_TIME,
      })) {
        state.repCount++;
        countedPartial = true;
        state.requireExtensionBeforeNextRep = true;
        state.tRepCompleted = t;
        const repResult = buildLatPulldownRepResult(w, state.repCount, state.activeSide);
        const messages = repResult.messages;
        state.lastRepResult = repResult;
        state.feedback = messages.length > 0 ? messages.join('\n') : 'Good rep.';
        state.lastFeedbackTime = t;
      } else if (actualRom > 0) {
        state.feedback = LOW_ROM_FEEDBACK;
        state.lastFeedbackTime = t;
      }
    }
    state.repWindow = null;
    state.tRepStart = null;
    if (!countedPartial) {
      state.requireExtensionBeforeNextRep = false;
      state.tRepCompleted = null;
    }
    state.tRestPeakRatio = null;
    state.restUpperArmDriveBaseline = null;
    state.restTorsoDevBaseline = null;
    state.restShoulderYBaseline = null;
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

function getDebugInfo(state: LatPulldownState): LatPulldownDebugInfo {
  const fmt = (v: number | null | undefined): number | null =>
    v !== null && v !== undefined && !isNaN(v) && isFinite(v) ? v : null;

  const w = state.repWindow;
  return {
    phase: state.phase,
    warmedUp: state.warmedUp,
    activeSide: state.debugSide,
    ratio: fmt(state.smoothedRatio),
    torsoLean: fmt(state.smoothedTorsoLean),
    minRatio: w ? (w.minRatio < Infinity ? fmt(w.minRatio) : null) : null,
    maxRatio: w ? (w.maxRatio > -Infinity ? fmt(w.maxRatio) : null) : null,
    maxTorsoLean: w ? fmt(w.maxTorsoLean) : null,
    upperArmDrive: fmt(state.smoothedUpperArmDrive),
    upperArmDriveDelta: w ? fmt(w.maxUpperArmDriveDelta) : null,
    torsoLeanBackDelta: w ? fmt(w.maxTorsoLeanBackDelta) : null,
    torsoForwardDelta: w ? fmt(w.maxTorsoForwardDelta) : null,
    torsoRockDelta: w ? fmt(torsoRockDelta(w)) : null,
    torsoAbsoluteBackLean: w ? fmt(w.maxTorsoAbsoluteBackLean) : null,
    shoulderShrugRatio: w ? fmt(w.maxShoulderShrugRatio) : null,
    sideViewConfidence: w ? fmt(averageSideViewConfidence(w)) : null,
    viewQualityStatus: w ? buildLatPulldownViewQuality(w).status : null,
    scorable: w ? isLatPulldownRepScorable(w) : null,
  };
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================

function configNumber(config: ExerciseHeuristicConfig, path: string, issues: string[]): number | null {
  const value = getConfigValue(config, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`Cable Lat Pulldowns config "${path}" must be a finite number.`);
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
      `Cable Lat Pulldowns config ordering invalid: "${firstPath}" (${first}) must be ${allowEqual ? '<=' : '<'} "${secondPath}" (${second}).`,
    );
  }
}

function validatePenaltyConfigs(config: ExerciseHeuristicConfig, issues: string[]): void {
  const penaltyConfigs = getConfigValue(config, 'penaltyConfigs');
  if (penaltyConfigs === null || typeof penaltyConfigs !== 'object' || Array.isArray(penaltyConfigs)) {
    issues.push('Cable Lat Pulldowns config "penaltyConfigs" must be an object.');
    return;
  }

  for (const [penaltyName, penaltyConfig] of Object.entries(penaltyConfigs)) {
    if (penaltyConfig === null || typeof penaltyConfig !== 'object' || Array.isArray(penaltyConfig)) {
      issues.push(`Cable Lat Pulldowns penalty config "${penaltyName}" must be an object.`);
      continue;
    }

    for (const [key, value] of Object.entries(penaltyConfig)) {
      const path = `penaltyConfigs.${penaltyName}.${key}`;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(`Cable Lat Pulldowns config "${path}" must be a finite number.`);
        continue;
      }
      if (key === 'scale' && value <= 0) {
        issues.push(`Cable Lat Pulldowns config "${path}" must be greater than 0.`);
      }
      if (key === 'cap' && value < 0) {
        issues.push(`Cable Lat Pulldowns config "${path}" must be greater than or equal to 0.`);
      }
      if (key === 'deadzone' && value < 0) {
        issues.push(`Cable Lat Pulldowns config "${path}" must be greater than or equal to 0.`);
      }
    }
  }
}

function validateLatPulldownHeuristicConfig(config: ExerciseHeuristicConfig): string[] {
  const issues: string[] = [];

  requireOrdered(config, issues, 'thresholds.BOTTOM_ENTER', 'thresholds.BOTTOM_EXIT');
  requireOrdered(config, issues, 'thresholds.BOTTOM_EXIT', 'thresholds.REST_REENTER');
  requireOrdered(config, issues, 'thresholds.REST_REENTER', 'thresholds.PULLING_ENTER');
  requireOrdered(config, issues, 'thresholds.BOTTOM_ENTER', 'formThresholds.PULL_ROM_FAIL', true);
  requireOrdered(config, issues, 'formThresholds.PULL_ROM_FAIL', 'thresholds.PULLING_ENTER');
  requireOrdered(config, issues, 'thresholds.REST_REENTER', 'formThresholds.EXTENSION_ROM_FAIL', true);
  requireOrdered(config, issues, 'formThresholds.EXTENSION_ROM_FAIL', 'thresholds.PULLING_ENTER', true);
  requireOrdered(
    config,
    issues,
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    true,
  );

  for (const path of [
    'thresholds.PULLING_ENTER',
    'thresholds.BOTTOM_ENTER',
    'thresholds.BOTTOM_EXIT',
    'thresholds.REST_REENTER',
    'thresholds.MIN_PARTIAL_ROM',
    'formThresholds.PULL_ROM_FAIL',
    'formThresholds.EXTENSION_ROM_FAIL',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 1)) {
      issues.push(`Cable Lat Pulldowns config "${path}" must be greater than 0 and at most 1.`);
    }
  }

  const minPartialRom = configNumber(config, 'thresholds.MIN_PARTIAL_ROM', issues);
  const pullingEnter = configNumber(config, 'thresholds.PULLING_ENTER', issues);
  const bottomEnter = configNumber(config, 'thresholds.BOTTOM_ENTER', issues);
  if (minPartialRom !== null && pullingEnter !== null && bottomEnter !== null) {
    const fullRom = pullingEnter - bottomEnter;
    if (minPartialRom <= 0 || minPartialRom >= fullRom) {
      issues.push(
        `Cable Lat Pulldowns config "thresholds.MIN_PARTIAL_ROM" (${minPartialRom}) must be greater than 0 and less than PULLING_ENTER - BOTTOM_ENTER (${fullRom}).`,
      );
    }
  }

  const minRepTime = configNumber(config, 'thresholds.MIN_REP_TIME', issues);
  const pullingAbortMinTime = configNumber(config, 'thresholds.PULLING_ABORT_MIN_TIME', issues);
  if (minRepTime !== null && minRepTime <= 0) {
    issues.push('Cable Lat Pulldowns config "thresholds.MIN_REP_TIME" must be greater than 0.');
  }
  if (pullingAbortMinTime !== null && pullingAbortMinTime <= 0) {
    issues.push('Cable Lat Pulldowns config "thresholds.PULLING_ABORT_MIN_TIME" must be greater than 0.');
  }
  if (minRepTime !== null && pullingAbortMinTime !== null && minRepTime < pullingAbortMinTime) {
    issues.push(
      `Cable Lat Pulldowns config ordering invalid: "thresholds.MIN_REP_TIME" (${minRepTime}) must be >= "thresholds.PULLING_ABORT_MIN_TIME" (${pullingAbortMinTime}).`,
    );
  }

  for (const path of [
    'formThresholds.ELBOW_DRIVE_FAIL',
    'formThresholds.TORSO_LEAN_WARN',
    'formThresholds.TORSO_ABSOLUTE_WARN',
    'formThresholds.TORSO_ROCK_WARN',
    'formThresholds.TEMPO_PULL_MIN',
    'formThresholds.TEMPO_RETURN_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && value <= 0) {
      issues.push(`Cable Lat Pulldowns config "${path}" must be greater than 0.`);
    }
  }

  const shoulderShrugWarn = configNumber(config, 'formThresholds.SHOULDER_SHRUG_WARN', issues);
  if (shoulderShrugWarn !== null && (shoulderShrugWarn <= 0 || shoulderShrugWarn >= 0.5)) {
    issues.push('Cable Lat Pulldowns config "formThresholds.SHOULDER_SHRUG_WARN" must be greater than 0 and less than 0.5.');
  }

  for (const path of [
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 1)) {
      issues.push(`Cable Lat Pulldowns config "${path}" must be greater than 0 and at most 1.`);
    }
  }

  validatePenaltyConfigs(config, issues);
  return issues;
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createLatPulldownDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_LAT_PULLDOWN_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Cable Lat Pulldowns',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    repQualityWindowActive: false,
    liveQualityWarnings: [],
    _internal: withLatPulldownConfig(config, () => initializeState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState, frameContext?: ExerciseFrameContext): ExerciseState => {
    const internal = state._internal as LatPulldownState;
    withLatPulldownConfig(config, () => updateLatPulldownState(keypoints, internal, frameContext));

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
      ? latPulldownQualityWarnings(internal.repWindow)
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
  tunableSpec: LAT_PULLDOWN_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/latPulldown.json',
  createVariant: (variantConfig) =>
    createLatPulldownDefinition(mergeHeuristicConfig(config, variantConfig)),
  validateHeuristicConfig: validateLatPulldownHeuristicConfig,

  ttsConfig: {
    feedbackToIssue: {
      'Pull deeper \u2014 bring the bar to your upper chest.': 'rom_short',
      'Extend fully \u2014 reach all the way up at the top.': 'lockout_short',
      'Drive your elbows down \u2014 pull with your lats, not just your arms.': 'elbow_drive',
      'Stay upright \u2014 avoid leaning back excessively.': 'torso_warn',
      'Keep your torso steady through the pulldown.': 'torso_rocking',
      'Keep your shoulders down as you pull.': 'shoulder_shrug',
      'Slow down the pull \u2014 control the descent.': 'tempo_down',
      'Control the return \u2014 resist the weight on the way up.': 'tempo_up',
    },
    feedbackMessages: {
      'Pull deeper \u2014 bring the bar to your upper chest.': [
        'Pull to your upper chest.',
        'Bring the bar a little lower.',
        'Finish the pull to your chest.',
      ],
      'Extend fully \u2014 reach all the way up at the top.': [
        'Reach all the way up.',
        'Full stretch at the top.',
        'Let your arms extend before the next pull.',
      ],
      'Drive your elbows down \u2014 pull with your lats, not just your arms.': [
        'Drive your elbows down.',
        'Lead with your elbows.',
        'Pull with your lats, not just your arms.',
      ],
      'Stay upright \u2014 avoid leaning back excessively.': [
        'Stay tall through the pull.',
        'Only a slight lean back.',
        'Less lean. Pull with your lats.',
      ],
      'Keep your torso steady through the pulldown.': [
        'Keep your torso steady.',
        'Brace and pull without rocking.',
        'Less body swing on the pulldown.',
      ],
      'Keep your shoulders down as you pull.': [
        'Keep your shoulders down.',
        'Pull down without shrugging.',
        'Relax your traps as you pull.',
      ],
      'Slow down the pull \u2014 control the descent.': [
        'Slow the pull down.',
        'Control the bar to your chest.',
        'Pull smoothly, no rushing.',
      ],
      'Control the return \u2014 resist the weight on the way up.': [
        'Control the bar on the way up.',
        'Resist on the way up.',
        'Let it rise with control.',
      ],
    },
  },

  summaryConfig: {
    'Pull deeper \u2014 bring the bar to your upper chest.':
      'Focus on pulling the bar all the way down to your upper chest for full lat activation.',
    'Extend fully \u2014 reach all the way up at the top.':
      'Allow your arms to extend fully at the top of each rep to get a full stretch in your lats.',
    'Drive your elbows down \u2014 pull with your lats, not just your arms.':
      'Lead the pulldown by driving your elbows down and in, rather than only bending your arms.',
    'Stay upright \u2014 avoid leaning back excessively.':
      'A slight lean back is fine, but excessive lean shifts the load away from your lats to your lower back.',
    'Keep your torso steady through the pulldown.':
      'Brace your torso and avoid rocking through the rep so the lats do the work.',
    'Keep your shoulders down as you pull.':
      'Keep your shoulders depressed and avoid shrugging so the movement stays lat-focused.',
    'Slow down the pull \u2014 control the descent.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the pull down.',
    'Control the return \u2014 resist the weight on the way up.':
      'Slow the eccentric phase \u2014 resist the weight for 2-3 seconds on the way up for better lat engagement.',
  },
  };
}

export const latPulldownDefinition: ExerciseDefinition = createLatPulldownDefinition();
