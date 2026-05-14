/**
 * Cable Row -- Exercise Definition
 *
 * Side view, reach-ratio as primary driver (camera-invariant).
 * FSM: REST -> PULLING -> CONTRACTED -> RETURNING -> REST
 *
 * Reach ratio = dist2D(shoulder,wrist) / (dist2D(shoulder,elbow) + dist2D(elbow,wrist))
 *   ~0.90-0.97 when arms are extended (REST)
 *   ~0.40-0.60 when fully contracted
 *
 * Form checks:
 *  - ROM (pull depth): ratio should drop below ~0.55 at contraction
 *  - ROM (full extension): ratio should return to ~0.95+ on each rep
 *  - Torso lean: torso should stay relatively upright; leaning back = momentum cheat
 *  - Shoulder retraction: upper arm should pull back sufficiently (hip-shoulder-elbow angle)
 *  - Tempo: controlled concentric (pull) and eccentric (return)
 *
 * The only export is `cableRowDefinition`.
 */

import {
  Keypoint,
  calculateAngle,
  calculateSignedVerticalAngleSagittal,
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
import tunedConfig from './tuned/cableRow.json';

import type {
  ExerciseDefinition,
  ExerciseFrameContext,
  ExerciseHeuristicConfig,
  ExerciseState,
  RepResult as FrameworkRepResult,
} from '../types';

// ============================================================================
// MODULE-PRIVATE HELPERS (dist2D / reach ratio)
// ============================================================================

/** Euclidean distance in the 2D image plane (x, y only). */
function dist2D(a: Keypoint, b: Keypoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute reach ratio for a three-joint chain.
 * ratio = dist2D(shoulder, wrist) / (dist2D(shoulder, elbow) + dist2D(elbow, wrist))
 *
 * Returns a value in [0, 1]:
 *   ~1.0  = arm fully extended (straight line)
 *   ~0.5  = arm significantly bent
 *   ~0.0  = wrist on top of shoulder (impossible in practice)
 */
function computeReachRatio(
  shoulder: Keypoint,
  elbow: Keypoint,
  wrist: Keypoint,
): number {
  const chainLen = dist2D(shoulder, elbow) + dist2D(elbow, wrist);
  if (chainLen < 1e-6) return 1; // degenerate -- avoid division by zero
  return dist2D(shoulder, wrist) / chainLen;
}

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (reach ratio) */
const THRESHOLDS = {
  /** Ratio below which we transition REST -> PULLING (arms starting to bend) */
  PULLING_ENTER: 0.90,
  /** Ratio below which we consider peak contraction (PULLING -> CONTRACTED) */
  CONTRACTED_ENTER: 0.60,
  /** Ratio above which we leave CONTRACTED (hysteresis) (CONTRACTED -> RETURNING) */
  CONTRACTED_EXIT: 0.63,
  /** Ratio above which the return is complete (RETURNING -> REST) */
  REST_REENTER: 0.90,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.5,
  /** Minimum ratio ROM for a returned partial rep to count */
  MIN_PARTIAL_ROM: 0.145,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min ratio above which pull depth is insufficient (didn't contract enough) */
  PULL_DEPTH_FAIL: 0.63,
  /** Max ratio below which arm extension is insufficient */
  EXTENSION_FAIL: 0.92,
  /** Shoulder retraction angle delta below which retraction is insufficient */
  RETRACTION_FAIL: 15,
  /** Backward torso delta from baseline above which there is excessive lean */
  TORSO_LEAN_WARN: 20,
  /** Total forward/back torso swing above which the rep is too momentum-driven */
  TORSO_ROCK_WARN: 24,
  /** Elbow-above-shoulder ratio above which the row path is too high */
  HIGH_ROW_WARN: 0.08,
  /** Handle/wrist height above a lower-rib target line above which the row path is too high */
  ROW_TARGET_HIGH_WARN: 0.10,
  /** Shoulder elevation ratio above which the user is shrugging */
  SHOULDER_SHRUG_WARN: 0.06,
  /** Concentric (pull) too fast threshold (seconds) */
  TEMPO_PULL_MIN: 0.3,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.4,
  /** Average side-view confidence below which a counted rep is marked unscorable */
  SIDE_VIEW_AVG_CONFIDENCE_MIN: 0.45,
  /** Minimum side-view confidence below which a counted rep is marked unscorable */
  SIDE_VIEW_MIN_CONFIDENCE_MIN: 0.25,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category             | Cap | Deadzone | Scale | Key Input                            |
 * |----------------------|-----|----------|-------|--------------------------------------|
 * | ROM pull depth       | 30  | 0        | 600   | min ratio excess above 0.55 target   |
 * | ROM extension        | 20  | 0        | 400   | max ratio shortfall below 0.95 target|
 * | Shoulder retraction  | 25  | 10       | 0.04  | retraction shortfall                 |
 * | Torso lean           | 25  | 8        | 0.10  | torso deviation delta from baseline  |
 * | Tempo pull           | 12  | 0.3s     | 60    | concentric time deficit              |
 * | Tempo return         | 8   | 0.4s     | 40    | eccentric time deficit               |
 *
 * Max total penalty: 120 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  PULL_DEPTH:        { cap: 30, deadzone: 0, scale: 600 } as PenaltyConfig,
  EXTENSION_ROM:     { cap: 20, deadzone: 0, scale: 400 } as PenaltyConfig,
  SHOULDER_RETRACT:  { cap: 25, deadzone: 10, scale: 0.04 } as PenaltyConfig,
  TORSO_LEAN:        { cap: 25, deadzone: 8, scale: 0.10 } as PenaltyConfig,
  TORSO_ROCK:        { cap: 10, deadzone: 24, scale: 0.03 } as PenaltyConfig,
  HIGH_ROW:          { cap: 10, deadzone: 0.08, scale: 1000 } as PenaltyConfig,
  SHOULDER_SHRUG:    { cap: 8,  deadzone: 0.06, scale: 1000 } as PenaltyConfig,
  TEMPO_PULL:        { cap: 12, deadzone: 0.3, scale: 60 } as PenaltyConfig,
  TEMPO_RETURN:      { cap: 8,  deadzone: 0.4, scale: 40 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;
const FORM_CONFIDENCE_MIN = 0.3;
const WORLD_IMAGE_REACH_RATIO_MAX_DELTA = 0.2;
const SIDE_VIEW_MIN_SAMPLES = 5;
const SETUP_SIDE_VIEW_MIN_SAMPLES = 8;
const FEEDBACK_COOLDOWN_SECONDS = 2.0;
const SIDE_VIEW_SETUP_FEEDBACK = 'Turn side-on so I can judge your row.';

const DEFAULT_CABLE_ROW_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_CABLE_ROW_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_CABLE_ROW_HEURISTIC_CONFIG,
  tunedConfig,
);

const CABLE_ROW_TUNABLE_SPEC = createDefaultTunableSpec(
  'Cable Row',
  DEFAULT_CABLE_ROW_HEURISTIC_CONFIG,
);
CABLE_ROW_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'cable-row.row_depth', metricKey: 'pullDepthRatio', thresholdPath: 'formThresholds.PULL_DEPTH_FAIL', direction: 'above' },
  { issueId: 'cable-row.row_extension', metricKey: 'extensionRatio', thresholdPath: 'formThresholds.EXTENSION_FAIL', direction: 'below' },
  { issueId: 'cable-row.shoulder_retraction', metricKey: 'shoulderRetractionDelta', thresholdPath: 'formThresholds.RETRACTION_FAIL', direction: 'below' },
  { issueId: 'cable-row.torso_warn', metricKey: 'torsoLeanBackDelta', thresholdPath: 'formThresholds.TORSO_LEAN_WARN', direction: 'above' },
  { issueId: 'cable-row.torso_rocking', metricKey: 'torsoRockDelta', thresholdPath: 'formThresholds.TORSO_ROCK_WARN', direction: 'above' },
  { issueId: 'cable-row.high_row', metricKey: 'elbowAboveShoulderRatio', thresholdPath: 'formThresholds.HIGH_ROW_WARN', direction: 'above' },
  { issueId: 'cable-row.high_row', metricKey: 'rowTargetHighRatio', thresholdPath: 'formThresholds.ROW_TARGET_HIGH_WARN', direction: 'above' },
  { issueId: 'cable-row.shoulder_shrug', metricKey: 'shoulderShrugRatio', thresholdPath: 'formThresholds.SHOULDER_SHRUG_WARN', direction: 'above' },
  { issueId: 'cable-row.tempo_down', metricKey: 'tPull', thresholdPath: 'formThresholds.TEMPO_PULL_MIN', direction: 'below' },
  { issueId: 'cable-row.tempo_up', metricKey: 'tReturn', thresholdPath: 'formThresholds.TEMPO_RETURN_MIN', direction: 'below' },
];

const CABLE_ROW_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withCableRowConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, CABLE_ROW_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type CableRowPhase = 'REST' | 'PULLING' | 'CONTRACTED' | 'RETURNING';
type LandmarkSourceName = 'world' | 'image' | 'fallback';
type TorsoMetricMethod = 'sagittal' | 'selected_side';

interface LandmarkSource {
  name: LandmarkSourceName;
  keypoints: Keypoint[];
}

interface MetricSample {
  value: number;
  source: LandmarkSourceName;
  keypoints: Keypoint[];
  method?: TorsoMetricMethod;
}

interface CableRowFSM {
  phase: CableRowPhase;
  /** Timestamp when pull began (REST -> PULLING) */
  tRepStart: number | null;
  /** Timestamp when peak contraction was reached */
  tContracted: number | null;
  /** Timestamp when rep completed (RETURNING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Min reach ratio during rep (should be low -- contracted position) */
  minRatio: number;
  /** Max reach ratio during rep (should be high -- extended position) */
  maxRatio: number;
  /** Raw shoulder angle at rep start (baseline for retraction delta) */
  shoulderAngleBaseline: number | null;
  /** Max change in raw shoulder angle from baseline (measures retraction amplitude) */
  maxShoulderDelta: number;
  /** Max wrong-direction shoulder movement from baseline */
  maxShoulderProtractionDelta: number;
  /** Raw torso deviation at rep start (baseline for dynamic lean measurement) */
  torsoDevBaseline: number | null;
  /** Max backward torso delta from baseline during rep */
  maxTorsoLeanBackDelta: number;
  /** Max forward torso delta from baseline during rep */
  maxTorsoForwardDelta: number;
  /** Image-space shoulder Y baseline for shoulder elevation checks */
  shoulderYBaseline: number | null;
  /** Max elbow height above shoulder, normalized by torso height */
  maxElbowAboveShoulderRatio: number;
  /** Max handle/wrist height above lower-rib target line, normalized by torso height */
  maxRowTargetHighRatio: number;
  /** Max shoulder elevation, normalized by torso height */
  maxShoulderShrugRatio: number;
  /** Side-view confidence accumulation */
  sideViewConfidenceSum: number;
  sideViewConfidenceMin: number;
  sideViewConfidenceSamples: number;
  /** Timestamps */
  tStart: number;
  tContracted: number | null;
  tReturnStart: number | null;
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

interface CableRowState {
  fsm: CableRowFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  /** Smoothed trackers */
  ratioTracker: SmoothedAngleTracker;
  shoulderTracker: SmoothedAngleTracker;
  torsoTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Current smoothed values for debug */
  smoothedRatio: number | null;
  /** Median-only ratio used for responsive FSM transitions */
  fastRatio: number | null;
  smoothedShoulder: number | null;
  smoothedTorso: number | null;
  /** Feedback */
  feedback: string | null;
  lastFeedbackTime: number;
  setupSideViewConfidences: number[];
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
}

interface CableRowDebugInfo {
  phase: CableRowPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  ratio: number | null;
  fastRatio: number | null;
  shoulderAngle: number | null;
  torsoDev: number | null;
  ratioMin: number | null;
  ratioMax: number | null;
  shoulderDelta: number | null;
  shoulderProtractionDelta: number | null;
  torsoLeanBackDelta: number | null;
  torsoForwardDelta: number | null;
  torsoRockDelta: number | null;
  elbowAboveShoulderRatio: number | null;
  rowTargetHighRatio: number | null;
  shoulderShrugRatio: number | null;
  sideViewConfidence: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): CableRowFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tContracted: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number, initialRatio?: number): RepWindow {
  return {
    minRatio: initialRatio ?? Infinity,
    maxRatio: initialRatio ?? -Infinity,
    shoulderAngleBaseline: null,
    maxShoulderDelta: 0,
    maxShoulderProtractionDelta: 0,
    torsoDevBaseline: null,
    maxTorsoLeanBackDelta: 0,
    maxTorsoForwardDelta: 0,
    shoulderYBaseline: null,
    maxElbowAboveShoulderRatio: 0,
    maxRowTargetHighRatio: 0,
    maxShoulderShrugRatio: 0,
    sideViewConfidenceSum: 0,
    sideViewConfidenceMin: 1,
    sideViewConfidenceSamples: 0,
    tStart,
    tContracted: null,
    tReturnStart: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function initializeCableRowState(): CableRowState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    ratioTracker: new SmoothedAngleTracker(),
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
    smoothedRatio: null,
    fastRatio: null,
    smoothedShoulder: null,
    smoothedTorso: null,
    feedback: null,
    lastFeedbackTime: 0,
    setupSideViewConfidences: [],
    visibleSide: 'left',
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
// ANGLE / RATIO CALCULATION
// ============================================================================

/**
 * Calculate the reach ratio for the arm chain (shoulder-elbow-wrist) in 2D.
 * ~0.90-0.97 when extended, ~0.40-0.60 when contracted.
 * Camera-invariant because it's a ratio of segment lengths.
 */
function calculateArmReachRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right',
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

  return computeReachRatio(shoulder, elbow, wrist);
}

/**
 * Calculate the upper arm angle relative to the torso (hip-shoulder-elbow) in 3D.
 * Measures shoulder extension/retraction during the row.
 * At start (arms extended): angle is smaller (~30-50deg, elbow in front).
 * At contraction (elbows back): angle increases (~70-90deg+, elbow alongside/behind torso).
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

  return 180 - calculateAngle(hip, shoulder, elbow);
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

function landmarkSources(frameContext: ExerciseFrameContext | undefined, fallbackKeypoints: Keypoint[]): LandmarkSource[] {
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

function signalSourceKeypoints(frameContext: ExerciseFrameContext | undefined, fallbackKeypoints: Keypoint[]): Keypoint[] {
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

function calculateShoulderAngleSample(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
  side: 'left' | 'right',
): MetricSample | null {
  for (const source of landmarkSources(frameContext, fallbackKeypoints)) {
    if (!sourceMatchesImageReach(source, frameContext, side)) {
      continue;
    }
    if (minKeypointConfidence(source.keypoints, [`${side}_hip`, `${side}_shoulder`, `${side}_elbow`]) < FORM_CONFIDENCE_MIN) {
      continue;
    }
    const value = calculateShoulderAngle(source.keypoints, side);
    if (isFiniteMetric(value) && value > 1 && value < 179) {
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

function calculateTorsoDeviationSample(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
  side: 'left' | 'right',
): MetricSample | null {
  const sources = landmarkSources(frameContext, fallbackKeypoints);
  for (const source of sources) {
    if (!sourceMatchesImageReach(source, frameContext, side)) {
      continue;
    }
    const value = calculateSagittalTorsoDeviation(source.keypoints);
    if (isFiniteMetric(value)) {
      return { value, source: source.name, keypoints: source.keypoints, method: 'sagittal' };
    }
  }

  for (const source of sources) {
    if (!sourceMatchesImageReach(source, frameContext, side)) {
      continue;
    }
    const value = calculateSelectedSideTorsoDeviation(source.keypoints, side);
    if (isFiniteMetric(value)) {
      return { value, source: source.name, keypoints: source.keypoints, method: 'selected_side' };
    }
  }
  return null;
}

function visibleKeypoint(
  keypoints: Keypoint[],
  name: string,
  threshold = VISIBILITY_THRESHOLD,
): Keypoint | null {
  const keypoint = getKeypoint(keypoints, name);
  return isVisible(keypoint, threshold) ? keypoint : null;
}

function calculateTorsoHeight(keypoints: Keypoint[], side: 'left' | 'right'): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`);
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  if (!shoulder || !hip) return null;
  const height = Math.abs(hip.y - shoulder.y);
  return height > 1e-6 ? height : null;
}

function calculateElbowAboveShoulderRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`, FORM_CONFIDENCE_MIN);
  const elbow = visibleKeypoint(keypoints, `${side}_elbow`, FORM_CONFIDENCE_MIN);
  const torsoHeight = calculateTorsoHeight(keypoints, side);
  if (!shoulder || !elbow || torsoHeight === null) return null;
  return Math.max(0, shoulder.y - elbow.y) / torsoHeight;
}

function calculateRowTargetHighRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right',
): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`, FORM_CONFIDENCE_MIN);
  const wrist = visibleKeypoint(keypoints, `${side}_wrist`, FORM_CONFIDENCE_MIN);
  const torsoHeight = calculateTorsoHeight(keypoints, side);
  if (!shoulder || !wrist || torsoHeight === null) return null;

  const lowerRibTargetY = shoulder.y + 0.35 * torsoHeight;
  return Math.max(0, lowerRibTargetY - wrist.y) / torsoHeight;
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

function isCableRowRepScorable(repWindow: RepWindow): boolean {
  if (repWindow.sideViewConfidenceSamples < SIDE_VIEW_MIN_SAMPLES) return true;
  const averageConfidence = averageSideViewConfidence(repWindow);
  if (averageConfidence === null) return true;
  return (
    averageConfidence >= FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN &&
    repWindow.sideViewConfidenceMin >= FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN
  );
}

function cableRowQualityWarnings(repWindow: RepWindow): FrameworkRepResult['qualityWarnings'] {
  return isCableRowRepScorable(repWindow) ? [] : ['side_view_uncertain'];
}

function averageSetupSideViewConfidence(state: CableRowState): number | null {
  const samples = state.setupSideViewConfidences;
  if (samples.length === 0) return null;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function minSetupSideViewConfidence(state: CableRowState): number | null {
  if (state.setupSideViewConfidences.length === 0) return null;
  return Math.min(...state.setupSideViewConfidences);
}

function shouldShowSetupSideViewFeedback(state: CableRowState, t: number): boolean {
  if (state.setupSideViewConfidences.length < SETUP_SIDE_VIEW_MIN_SAMPLES) return false;
  if (state.lastFeedbackTime > 0 && t - state.lastFeedbackTime <= FEEDBACK_COOLDOWN_SECONDS) return false;
  const averageConfidence = averageSetupSideViewConfidence(state);
  const minConfidence = minSetupSideViewConfidence(state);
  return (
    averageConfidence !== null &&
    minConfidence !== null &&
    (
      averageConfidence < FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN ||
      minConfidence < FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN
    )
  );
}

function highRowTriggered(repWindow: RepWindow): boolean {
  return (
    repWindow.maxElbowAboveShoulderRatio > FORM_THRESHOLDS.HIGH_ROW_WARN ||
    repWindow.maxRowTargetHighRatio > FORM_THRESHOLDS.ROW_TARGET_HIGH_WARN
  );
}

function highRowPenaltyValue(repWindow: RepWindow): number {
  return Math.max(
    0,
    repWindow.maxElbowAboveShoulderRatio - FORM_THRESHOLDS.HIGH_ROW_WARN,
    repWindow.maxRowTargetHighRatio - FORM_THRESHOLDS.ROW_TARGET_HIGH_WARN,
  );
}

function torsoRockDelta(repWindow: RepWindow): number {
  if (repWindow.maxTorsoLeanBackDelta <= 0 || repWindow.maxTorsoForwardDelta <= 0) {
    return 0;
  }
  return repWindow.maxTorsoLeanBackDelta + repWindow.maxTorsoForwardDelta;
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: CableRowFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: CableRowFSM,
  ratio: number,
  t: number
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;

  switch (fsm.phase) {
    case 'REST':
      // Waiting for pull to begin. When ratio drops below threshold,
      // transition to PULLING.
      if (ratio < THRESHOLDS.PULLING_ENTER) {
        fsm.phase = 'PULLING';
        fsm.tRepStart = t;
        fsm.tContracted = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'PULLING':
      // Actively pulling. When peak contraction reached, transition.
      if (ratio < THRESHOLDS.CONTRACTED_ENTER) {
        fsm.phase = 'CONTRACTED';
        fsm.tContracted = t;
      } else if (ratio > THRESHOLDS.REST_REENTER && fsm.tRepStart !== null) {
        // Went back to extended without contracting -- abort
        fsm.phase = 'REST';
        fsm.tRepStart = null;
      }
      break;

    case 'CONTRACTED':
      // At peak contraction. When ratio starts rising (hysteresis), transition.
      if (ratio > THRESHOLDS.CONTRACTED_EXIT) {
        fsm.phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      // Controlled return. When ratio returns to extended position, rep is complete.
      if (
        ratio > THRESHOLDS.REST_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'REST';
        fsm.tRepEnd = t;
        repCompleted = true;
      } else if (ratio < THRESHOLDS.CONTRACTED_ENTER) {
        // Went back to contraction -- return to CONTRACTED
        fsm.phase = 'CONTRACTED';
      }
      break;
  }

  return { fsm, repCompleted };
}

// ============================================================================
// SCORING (continuous penalty curves)
// ============================================================================

function computeCableRowScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];
  const fromThreshold = (config: PenaltyConfig): PenaltyConfig => ({ ...config, deadzone: 0 });

  // Keep scoring aligned with feedback thresholds so labelled-data tuning moves
  // cue behavior and score behavior together.
  const pullShortfall = Math.max(0, repWindow.minRatio - FORM_THRESHOLDS.PULL_DEPTH_FAIL);
  penalties.push({ value: pullShortfall, config: fromThreshold(PENALTY_CONFIGS.PULL_DEPTH) });

  const extensionShortfall = Math.max(0, FORM_THRESHOLDS.EXTENSION_FAIL - repWindow.maxRatio);
  penalties.push({ value: extensionShortfall, config: fromThreshold(PENALTY_CONFIGS.EXTENSION_ROM) });

  const retractionShortfall = Math.max(0, FORM_THRESHOLDS.RETRACTION_FAIL - repWindow.maxShoulderDelta);
  penalties.push({ value: retractionShortfall, config: fromThreshold(PENALTY_CONFIGS.SHOULDER_RETRACT) });

  penalties.push({
    value: Math.max(0, repWindow.maxTorsoLeanBackDelta - FORM_THRESHOLDS.TORSO_LEAN_WARN),
    config: fromThreshold(PENALTY_CONFIGS.TORSO_LEAN),
  });
  penalties.push({
    value: Math.max(0, torsoRockDelta(repWindow) - FORM_THRESHOLDS.TORSO_ROCK_WARN),
    config: fromThreshold(PENALTY_CONFIGS.TORSO_ROCK),
  });
  penalties.push({ value: highRowPenaltyValue(repWindow), config: fromThreshold(PENALTY_CONFIGS.HIGH_ROW) });
  penalties.push({
    value: Math.max(0, repWindow.maxShoulderShrugRatio - FORM_THRESHOLDS.SHOULDER_SHRUG_WARN),
    config: fromThreshold(PENALTY_CONFIGS.SHOULDER_SHRUG),
  });

  if (repWindow.tContracted !== null) {
    const tPull = repWindow.tContracted - repWindow.tStart;    // concentric (pull)
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tContracted); // eccentric (return)

    if (tPull > 0 && tPull < FORM_THRESHOLDS.TEMPO_PULL_MIN) {
      const deficit = FORM_THRESHOLDS.TEMPO_PULL_MIN - tPull;
      penalties.push({ value: deficit, config: fromThreshold(PENALTY_CONFIGS.TEMPO_PULL) });
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      const deficit = FORM_THRESHOLDS.TEMPO_RETURN_MIN - tReturn;
      penalties.push({ value: deficit, config: fromThreshold(PENALTY_CONFIGS.TEMPO_RETURN) });
    }
  }

  return computeScore(penalties);
}

// ============================================================================
// FORM MESSAGES (discrete thresholds)
// ============================================================================

function generateFormMessages(repWindow: RepWindow): string[] {
  const messages: string[] = [];

  // 1. Pull depth -- didn't contract enough (ratio stayed too high)
  if (repWindow.minRatio > FORM_THRESHOLDS.PULL_DEPTH_FAIL) {
    messages.push('Pull further back \u2014 squeeze your shoulder blades together.');
  }

  // 2. Extension -- didn't extend arms fully on return (ratio stayed too low)
  if (repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_FAIL) {
    messages.push('Extend your arms fully \u2014 get a full stretch at the front.');
  }

  // 3. Shoulder retraction -- didn't pull elbows back enough
  if (repWindow.maxShoulderDelta < FORM_THRESHOLDS.RETRACTION_FAIL) {
    messages.push('Drive your elbows back \u2014 focus on shoulder retraction.');
  }

  // 4. Torso lean
  if (repWindow.maxTorsoLeanBackDelta > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Stay upright \u2014 avoid leaning back during the pull.');
  }

  if (torsoRockDelta(repWindow) > FORM_THRESHOLDS.TORSO_ROCK_WARN) {
    messages.push('Keep your torso steady through the row.');
  }

  if (highRowTriggered(repWindow)) {
    messages.push('Keep your elbows lower \u2014 row toward your ribs.');
  }

  if (repWindow.maxShoulderShrugRatio > FORM_THRESHOLDS.SHOULDER_SHRUG_WARN) {
    messages.push('Keep your shoulders down as you pull.');
  }

  // 5. Tempo
  if (repWindow.tContracted !== null) {
    const tPull = repWindow.tContracted - repWindow.tStart;
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tContracted);

    if (tPull > 0 && tPull < FORM_THRESHOLDS.TEMPO_PULL_MIN) {
      messages.push('Slow down the pull \u2014 control the contraction.');
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      messages.push('Control the return \u2014 don\'t let the weight pull you forward.');
    }
  }

  return messages;
}

function buildCableRowDiagnostics(
  repWindow: RepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
): FrameworkRepResult['diagnostics'] {
  const hasTempo = repWindow.tContracted !== null;
  const tPull = repWindow.tContracted !== null ? repWindow.tContracted - repWindow.tStart : null;
  const tReturn = repWindow.tContracted !== null
    ? repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tContracted)
    : null;
  const sideViewConfidence = averageSideViewConfidence(repWindow);
  const hasSideViewConfidence = repWindow.sideViewConfidenceSamples >= SIDE_VIEW_MIN_SAMPLES;
  const sideViewMinConfidence = repWindow.sideViewConfidenceSamples > 0
    ? repWindow.sideViewConfidenceMin
    : null;
  const rockDelta = torsoRockDelta(repWindow);
  const scorable = isCableRowRepScorable(repWindow);
  return buildRepDiagnostics({
    exerciseName: 'Cable Row',
    repIndex,
    view: scorable ? 'side' : 'unknown',
    selectedSide: visibleSide,
    scorable,
    metrics: [
      diagnosticMetric('pullDepthRatio', repWindow.minRatio, { unit: 'ratio' }),
      diagnosticMetric('extensionRatio', repWindow.maxRatio, { unit: 'ratio' }),
      diagnosticMetric('romRatio', repWindow.maxRatio - repWindow.minRatio, { unit: 'ratio' }),
      diagnosticMetric('shoulderRetractionDelta', repWindow.maxShoulderDelta, { unit: 'degrees' }),
      diagnosticMetric('shoulderProtractionDelta', repWindow.maxShoulderProtractionDelta, { unit: 'degrees' }),
      diagnosticMetric('torsoLeanBackDelta', repWindow.maxTorsoLeanBackDelta, { unit: 'degrees' }),
      diagnosticMetric('torsoForwardDelta', repWindow.maxTorsoForwardDelta, { unit: 'degrees' }),
      diagnosticMetric('torsoRockDelta', rockDelta, { unit: 'degrees' }),
      diagnosticMetric('elbowAboveShoulderRatio', repWindow.maxElbowAboveShoulderRatio, { unit: 'ratio' }),
      diagnosticMetric('rowTargetHighRatio', repWindow.maxRowTargetHighRatio, { unit: 'ratio' }),
      diagnosticMetric('shoulderShrugRatio', repWindow.maxShoulderShrugRatio, { unit: 'ratio' }),
      diagnosticMetric('sideViewConfidence', sideViewConfidence, {
        unit: 'ratio',
        eligible: hasSideViewConfidence,
        sampleCount: repWindow.sideViewConfidenceSamples,
        skippedReason: 'insufficient_side_view_samples',
      }),
      diagnosticMetric('sideViewMinConfidence', sideViewMinConfidence, {
        unit: 'ratio',
        eligible: hasSideViewConfidence,
        sampleCount: repWindow.sideViewConfidenceSamples,
        skippedReason: 'insufficient_side_view_samples',
      }),
      diagnosticMetric('tPull', tPull, { unit: 'seconds', eligible: hasTempo, skippedReason: 'contracted_position_not_detected' }),
      diagnosticMetric('tReturn', tReturn, { unit: 'seconds', eligible: hasTempo, skippedReason: 'contracted_position_not_detected' }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'cable-row.row_depth',
        metricKeys: ['pullDepthRatio'],
        direction: 'above',
        value: repWindow.minRatio,
        thresholdPath: 'formThresholds.PULL_DEPTH_FAIL',
        thresholdValue: FORM_THRESHOLDS.PULL_DEPTH_FAIL,
        triggered: repWindow.minRatio > FORM_THRESHOLDS.PULL_DEPTH_FAIL,
      }),
      diagnosticCue({
        issueId: 'cable-row.row_extension',
        metricKeys: ['extensionRatio'],
        direction: 'below',
        value: repWindow.maxRatio,
        thresholdPath: 'formThresholds.EXTENSION_FAIL',
        thresholdValue: FORM_THRESHOLDS.EXTENSION_FAIL,
        triggered: repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_FAIL,
      }),
      diagnosticCue({
        issueId: 'cable-row.shoulder_retraction',
        metricKeys: ['shoulderRetractionDelta'],
        direction: 'below',
        value: repWindow.maxShoulderDelta,
        thresholdPath: 'formThresholds.RETRACTION_FAIL',
        thresholdValue: FORM_THRESHOLDS.RETRACTION_FAIL,
        triggered: repWindow.maxShoulderDelta < FORM_THRESHOLDS.RETRACTION_FAIL,
      }),
      diagnosticCue({
        issueId: 'cable-row.torso_warn',
        metricKeys: ['torsoLeanBackDelta'],
        direction: 'above',
        value: repWindow.maxTorsoLeanBackDelta,
        thresholdPath: 'formThresholds.TORSO_LEAN_WARN',
        thresholdValue: FORM_THRESHOLDS.TORSO_LEAN_WARN,
        triggered: repWindow.maxTorsoLeanBackDelta > FORM_THRESHOLDS.TORSO_LEAN_WARN,
      }),
      diagnosticCue({
        issueId: 'cable-row.torso_rocking',
        metricKeys: ['torsoRockDelta'],
        direction: 'above',
        value: rockDelta,
        thresholdPath: 'formThresholds.TORSO_ROCK_WARN',
        thresholdValue: FORM_THRESHOLDS.TORSO_ROCK_WARN,
        triggered: rockDelta > FORM_THRESHOLDS.TORSO_ROCK_WARN,
      }),
      diagnosticCue({
        issueId: 'cable-row.high_row',
        metricKeys: ['elbowAboveShoulderRatio', 'rowTargetHighRatio'],
        direction: 'above',
        value: Math.max(repWindow.maxElbowAboveShoulderRatio, repWindow.maxRowTargetHighRatio),
        thresholdPath: ['formThresholds.HIGH_ROW_WARN', 'formThresholds.ROW_TARGET_HIGH_WARN'],
        thresholdValue: {
          elbowAboveShoulderRatio: FORM_THRESHOLDS.HIGH_ROW_WARN,
          rowTargetHighRatio: FORM_THRESHOLDS.ROW_TARGET_HIGH_WARN,
        },
        triggered: highRowTriggered(repWindow),
      }),
      diagnosticCue({
        issueId: 'cable-row.shoulder_shrug',
        metricKeys: ['shoulderShrugRatio'],
        direction: 'above',
        value: repWindow.maxShoulderShrugRatio,
        thresholdPath: 'formThresholds.SHOULDER_SHRUG_WARN',
        thresholdValue: FORM_THRESHOLDS.SHOULDER_SHRUG_WARN,
        triggered: repWindow.maxShoulderShrugRatio > FORM_THRESHOLDS.SHOULDER_SHRUG_WARN,
      }),
      diagnosticCue({
        issueId: 'cable-row.tempo_down',
        metricKeys: ['tPull'],
        direction: 'below',
        value: tPull,
        thresholdPath: 'formThresholds.TEMPO_PULL_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_PULL_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tPull !== null && tPull > 0 && tPull < FORM_THRESHOLDS.TEMPO_PULL_MIN,
        skippedReason: 'contracted_position_not_detected',
      }),
      diagnosticCue({
        issueId: 'cable-row.tempo_up',
        metricKeys: ['tReturn'],
        direction: 'below',
        value: tReturn,
        thresholdPath: 'formThresholds.TEMPO_RETURN_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_RETURN_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tReturn !== null && tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN,
        skippedReason: 'contracted_position_not_detected',
      }),
    ],
  });
}

function buildCableRowRepResult(
  repWindow: RepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
): RepResult {
  const score = computeCableRowScore(repWindow);
  const messages = generateFormMessages(repWindow);
  const scorable = isCableRowRepScorable(repWindow);
  const qualityWarnings = cableRowQualityWarnings(repWindow);
  return {
    repIndex,
    score,
    messages,
    scorable,
    qualityWarnings,
    diagnostics: buildCableRowDiagnostics(repWindow, repIndex, visibleSide),
  };
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateCableRowState(
  keypoints: Keypoint[],
  currentState: CableRowState,
  frameContext?: ExerciseFrameContext,
): CableRowState {
  const t = Date.now() / 1000;
  const signalKeypoints = signalSourceKeypoints(frameContext, keypoints);

  // Warmup gate
  if (!currentState.warmedUp) {
    const ready = currentState.warmupGate.update(signalKeypoints);
    if (!ready) {
      return currentState;
    }
    currentState.warmedUp = true;
  }

  // Only update visible side in REST — lock it during active rep phases
  // to prevent mid-rep side switching that corrupts angle measurements.
  const inActiveRep = currentState.fsm.phase !== 'REST';
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(signalKeypoints);

  // Calculate raw values
  const rawRatio = calculateArmReachRatio(signalKeypoints, visibleSide);
  const shoulderSample = calculateShoulderAngleSample(frameContext, keypoints, visibleSide);
  const torsoSample = calculateTorsoDeviationSample(frameContext, keypoints, visibleSide);
  const rawShoulder = shoulderSample?.value ?? null;
  const rawTorsoDev = torsoSample?.value ?? null;
  const sideViewConfidence = calculateSideViewConfidence(signalKeypoints);

  // If we can't even compute the ratio, bail out
  if (rawRatio === null) {
    return {
      ...currentState,
      visibleSide,
      smoothedRatio: null,
      fastRatio: null,
      smoothedShoulder: null,
      smoothedTorso: null,
    };
  }

  // Smooth values
  const smoothedRatio = currentState.ratioTracker.push(rawRatio);
  const fastRatio = currentState.ratioTracker.medianValue;
  const smoothedShoulder = rawShoulder !== null
    ? currentState.shoulderTracker.push(rawShoulder)
    : currentState.shoulderTracker.value;
  const smoothedTorso = rawTorsoDev !== null
    ? currentState.torsoTracker.push(rawTorsoDev)
    : currentState.torsoTracker.value;

  const newState: CableRowState = {
    ...currentState,
    visibleSide,
    smoothedRatio,
    fastRatio: isNaN(fastRatio) ? null : fastRatio,
    smoothedShoulder: isNaN(smoothedShoulder) ? null : smoothedShoulder,
    smoothedTorso: isNaN(smoothedTorso) ? null : smoothedTorso,
  };

  if (isNaN(fastRatio)) {
    return newState;
  }

  if (currentState.fsm.phase === 'REST' && currentState.repWindow === null && sideViewConfidence !== null) {
    const setupSamples = [...currentState.setupSideViewConfidences, sideViewConfidence].slice(-SETUP_SIDE_VIEW_MIN_SAMPLES);
    newState.setupSideViewConfidences = setupSamples;
    if (shouldShowSetupSideViewFeedback(newState, t)) {
      newState.feedback = SIDE_VIEW_SETUP_FEEDBACK;
      newState.lastFeedbackTime = t;
    }
  } else if (currentState.fsm.phase !== 'REST') {
    newState.setupSideViewConfidences = [];
  }

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, fastRatio, t);
  newState.fsm = fsmResult.fsm;

  const returnedPartial =
    currentState.fsm.phase === 'PULLING' &&
    newState.fsm.phase === 'REST' &&
    !fsmResult.repCompleted &&
    newState.repWindow !== null;

  if (returnedPartial && newState.repWindow) {
    const window = newState.repWindow;
    window.tEnd = t;
    if (!isNaN(smoothedRatio)) {
      window.minRatio = Math.min(window.minRatio, smoothedRatio);
    }
    if (rawRatio !== null) {
      window.maxRatio = Math.max(window.maxRatio, rawRatio);
    }
    if (sideViewConfidence !== null) {
      window.sideViewConfidenceSum += sideViewConfidence;
      window.sideViewConfidenceMin = Math.min(window.sideViewConfidenceMin, sideViewConfidence);
      window.sideViewConfidenceSamples++;
    }
    const actualRom = window.maxRatio - window.minRatio;
    const duration = window.tEnd - window.tStart;

    if (isMeaningfulPartialRep({
      actualRom,
      minRom: THRESHOLDS.MIN_PARTIAL_ROM,
      duration,
      minDuration: THRESHOLDS.MIN_REP_TIME,
    })) {
      newState.repCount++;
      const repResult = buildCableRowRepResult(window, newState.repCount, visibleSide);
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

  // Track rep window while actively in a rep (not REST)
  const inRep = newState.fsm.phase !== 'REST';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(newState.fsm.tRepStart ?? t, rawRatio);
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update ratio min/max — use smoothed ratio for min (contracted peak)
    // and raw ratio for max (extended peak) to capture true ROM.
    if (!isNaN(smoothedRatio)) {
      window.minRatio = Math.min(window.minRatio, smoothedRatio);
    }
    if (rawRatio !== null) {
      window.maxRatio = Math.max(window.maxRatio, rawRatio);
    }
    if (sideViewConfidence !== null) {
      window.sideViewConfidenceSum += sideViewConfidence;
      window.sideViewConfidenceMin = Math.min(window.sideViewConfidenceMin, sideViewConfidence);
      window.sideViewConfidenceSamples++;
    }

    // Track shoulder angle delta from baseline (measures retraction).
    // Uses RAW shoulder angle — EMA smoothing dampens the peak delta,
    // causing the retraction check to fail even on good reps.
    // Only update when the three keypoints used by calculateShoulderAngle
    // (hip, shoulder, elbow) all have sufficient confidence.
    if (rawShoulder !== null) {
      if (window.shoulderAngleBaseline === null) {
        window.shoulderAngleBaseline = rawShoulder;
      }
      const shoulderDelta = rawShoulder - window.shoulderAngleBaseline;
      window.maxShoulderDelta = Math.max(window.maxShoulderDelta, Math.max(0, shoulderDelta));
      window.maxShoulderProtractionDelta = Math.max(
        window.maxShoulderProtractionDelta,
        Math.max(0, -shoulderDelta),
      );
    }

    // Track torso deviation as delta from baseline — the absolute angle from
    // vertical includes natural seated lean and body rotation artifacts, which
    // easily exceed the threshold even with perfect form. Measuring the CHANGE
    // from baseline captures dynamic lean during the pull (the actual concern).
    // Only update when shoulder + hip have sufficient confidence.
    if (rawTorsoDev !== null) {
      if (window.torsoDevBaseline === null) {
        window.torsoDevBaseline = rawTorsoDev;
      }
      const signedTorsoDelta = rawTorsoDev - window.torsoDevBaseline;
      window.maxTorsoLeanBackDelta = Math.max(
        window.maxTorsoLeanBackDelta,
        Math.max(0, -signedTorsoDelta),
      );
      window.maxTorsoForwardDelta = Math.max(
        window.maxTorsoForwardDelta,
        Math.max(0, signedTorsoDelta),
      );
    }

    const shoulder = visibleKeypoint(signalKeypoints, `${visibleSide}_shoulder`, FORM_CONFIDENCE_MIN);
    const torsoHeight = calculateTorsoHeight(signalKeypoints, visibleSide);
    if (shoulder) {
      if (window.shoulderYBaseline === null) {
        window.shoulderYBaseline = shoulder.y;
      }
      const shoulderShrugRatio = calculateShoulderShrugRatio(
        shoulder.y,
        window.shoulderYBaseline,
        torsoHeight,
      );
      if (shoulderShrugRatio !== null) {
        window.maxShoulderShrugRatio = Math.max(
          window.maxShoulderShrugRatio,
          shoulderShrugRatio,
        );
      }
    }

    if (fastRatio <= THRESHOLDS.CONTRACTED_EXIT) {
      const highRowRatio = calculateElbowAboveShoulderRatio(signalKeypoints, visibleSide);
      if (highRowRatio !== null) {
        window.maxElbowAboveShoulderRatio = Math.max(
          window.maxElbowAboveShoulderRatio,
          highRowRatio,
        );
      }
      const rowTargetHighRatio = calculateRowTargetHighRatio(signalKeypoints, visibleSide);
      if (rowTargetHighRatio !== null) {
        window.maxRowTargetHighRatio = Math.max(
          window.maxRowTargetHighRatio,
          rowTargetHighRatio,
        );
      }
    }

    // Record contracted timestamp
    if (newState.fsm.phase === 'CONTRACTED' && window.tContracted === null) {
      window.tContracted = t;
    }

    if (
      currentState.fsm.phase === 'CONTRACTED' &&
      newState.fsm.phase === 'RETURNING' &&
      window.tReturnStart === null
    ) {
      window.tReturnStart = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    // Record the completing frame's ratio — the rep window stops updating
    // once phase becomes REST, but the frame that triggers REST_REENTER has
    // the actual peak extension ratio and must be included.
    if (rawRatio !== null) {
      newState.repWindow.maxRatio = Math.max(newState.repWindow.maxRatio, rawRatio);
    }
    if (sideViewConfidence !== null) {
      newState.repWindow.sideViewConfidenceSum += sideViewConfidence;
      newState.repWindow.sideViewConfidenceMin = Math.min(
        newState.repWindow.sideViewConfidenceMin,
        sideViewConfidence,
      );
      newState.repWindow.sideViewConfidenceSamples++;
    }
    newState.repWindow.tEnd = t;

    newState.repCount++;

    const repResult = buildCableRowRepResult(newState.repWindow, newState.repCount, visibleSide);
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

function getDebugInfo(state: CableRowState): CableRowDebugInfo {
  const fmt = (v: number | null | undefined): number | null =>
    v !== null && v !== undefined && !isNaN(v) && isFinite(v) ? v : null;

  const repWin = state.repWindow;

  return {
    phase: state.fsm.phase,
    side: state.visibleSide,
    warmedUp: state.warmedUp,
    ratio: fmt(state.smoothedRatio),
    fastRatio: fmt(state.fastRatio),
    shoulderAngle: fmt(state.smoothedShoulder),
    torsoDev: fmt(state.smoothedTorso),
    ratioMin: repWin && repWin.minRatio !== Infinity ? fmt(repWin.minRatio) : null,
    ratioMax: repWin && repWin.maxRatio !== -Infinity ? fmt(repWin.maxRatio) : null,
    shoulderDelta: repWin ? fmt(repWin.maxShoulderDelta) : null,
    shoulderProtractionDelta: repWin ? fmt(repWin.maxShoulderProtractionDelta) : null,
    torsoLeanBackDelta: repWin ? fmt(repWin.maxTorsoLeanBackDelta) : null,
    torsoForwardDelta: repWin ? fmt(repWin.maxTorsoForwardDelta) : null,
    torsoRockDelta: repWin ? fmt(torsoRockDelta(repWin)) : null,
    elbowAboveShoulderRatio: repWin ? fmt(repWin.maxElbowAboveShoulderRatio) : null,
    rowTargetHighRatio: repWin ? fmt(repWin.maxRowTargetHighRatio) : null,
    shoulderShrugRatio: repWin ? fmt(repWin.maxShoulderShrugRatio) : null,
    sideViewConfidence: repWin ? fmt(averageSideViewConfidence(repWin)) : null,
  };
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================

function configNumber(config: ExerciseHeuristicConfig, path: string, issues: string[]): number | null {
  const value = getConfigValue(config, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`Cable Row config "${path}" must be a finite number.`);
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
      `Cable Row config ordering invalid: "${firstPath}" (${first}) must be ${allowEqual ? '<=' : '<'} "${secondPath}" (${second}).`,
    );
  }
}

function validatePenaltyConfigs(config: ExerciseHeuristicConfig, issues: string[]): void {
  const penaltyConfigs = getConfigValue(config, 'penaltyConfigs');
  if (penaltyConfigs === null || typeof penaltyConfigs !== 'object' || Array.isArray(penaltyConfigs)) {
    issues.push('Cable Row config "penaltyConfigs" must be an object.');
    return;
  }

  for (const [penaltyName, penaltyConfig] of Object.entries(penaltyConfigs)) {
    if (penaltyConfig === null || typeof penaltyConfig !== 'object' || Array.isArray(penaltyConfig)) {
      issues.push(`Cable Row penalty config "${penaltyName}" must be an object.`);
      continue;
    }
    for (const [key, value] of Object.entries(penaltyConfig)) {
      const path = `penaltyConfigs.${penaltyName}.${key}`;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(`Cable Row config "${path}" must be a finite number.`);
        continue;
      }
      if (key === 'scale' && value <= 0) {
        issues.push(`Cable Row config "${path}" must be greater than 0.`);
      }
      if (key === 'cap' && value < 0) {
        issues.push(`Cable Row config "${path}" must be greater than or equal to 0.`);
      }
      if (key === 'deadzone' && value < 0) {
        issues.push(`Cable Row config "${path}" must be greater than or equal to 0.`);
      }
    }
  }
}

function validateCableRowHeuristicConfig(config: ExerciseHeuristicConfig): string[] {
  const issues: string[] = [];

  requireOrdered(config, issues, 'thresholds.CONTRACTED_ENTER', 'thresholds.CONTRACTED_EXIT');
  requireOrdered(config, issues, 'thresholds.CONTRACTED_EXIT', 'thresholds.PULLING_ENTER');
  requireOrdered(config, issues, 'thresholds.PULLING_ENTER', 'thresholds.REST_REENTER', true);
  requireOrdered(config, issues, 'thresholds.MIN_PARTIAL_ROM', 'thresholds.PULLING_ENTER');
  requireOrdered(config, issues, 'thresholds.CONTRACTED_ENTER', 'formThresholds.PULL_DEPTH_FAIL', true);
  requireOrdered(config, issues, 'formThresholds.PULL_DEPTH_FAIL', 'thresholds.PULLING_ENTER');
  requireOrdered(config, issues, 'thresholds.REST_REENTER', 'formThresholds.EXTENSION_FAIL', true);
  requireOrdered(
    config,
    issues,
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    true,
  );

  for (const path of [
    'thresholds.PULLING_ENTER',
    'thresholds.CONTRACTED_ENTER',
    'thresholds.CONTRACTED_EXIT',
    'thresholds.REST_REENTER',
    'thresholds.MIN_PARTIAL_ROM',
    'formThresholds.PULL_DEPTH_FAIL',
    'formThresholds.EXTENSION_FAIL',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 1.2)) {
      issues.push(`Cable Row config "${path}" must be greater than 0 and at most 1.2.`);
    }
  }

  for (const path of [
    'thresholds.MIN_REP_TIME',
    'formThresholds.RETRACTION_FAIL',
    'formThresholds.TORSO_LEAN_WARN',
    'formThresholds.TORSO_ROCK_WARN',
    'formThresholds.TEMPO_PULL_MIN',
    'formThresholds.TEMPO_RETURN_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && value <= 0) {
      issues.push(`Cable Row config "${path}" must be greater than 0.`);
    }
  }

  for (const path of [
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 1)) {
      issues.push(`Cable Row config "${path}" must be greater than 0 and at most 1.`);
    }
  }

  for (const path of [
    'formThresholds.HIGH_ROW_WARN',
    'formThresholds.ROW_TARGET_HIGH_WARN',
    'formThresholds.SHOULDER_SHRUG_WARN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value >= 0.5)) {
      issues.push(`Cable Row config "${path}" must be greater than 0 and less than 0.5.`);
    }
  }

  validatePenaltyConfigs(config, issues);
  return issues;
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createCableRowDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_CABLE_ROW_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Cable Row',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    repQualityWindowActive: false,
    _internal: withCableRowConfig(config, () => initializeCableRowState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState, frameContext?: ExerciseFrameContext): ExerciseState => {
    const internal = state._internal as CableRowState;
    const newInternal = withCableRowConfig(
      config,
      () => updateCableRowState(keypoints, internal, frameContext),
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
      repQualityWindowActive: newInternal.repWindow !== null,
      _internal: newInternal,
    };
  },

  heuristicConfig: config,
  tunableSpec: CABLE_ROW_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/cableRow.json',
  createVariant: (variantConfig) =>
    createCableRowDefinition(mergeHeuristicConfig(config, variantConfig)),
  validateHeuristicConfig: validateCableRowHeuristicConfig,

  ttsConfig: {
    feedbackToIssue: {
      'Pull further back \u2014 squeeze your shoulder blades together.': 'row_depth',
      'Extend your arms fully \u2014 get a full stretch at the front.': 'row_extension',
      'Drive your elbows back \u2014 focus on shoulder retraction.': 'shoulder_retraction',
      'Stay upright \u2014 avoid leaning back during the pull.': 'torso_warn',
      'Keep your torso steady through the row.': 'torso_rocking',
      'Keep your elbows lower \u2014 row toward your ribs.': 'high_row',
      'Keep your shoulders down as you pull.': 'shoulder_shrug',
      'Slow down the pull \u2014 control the contraction.': 'tempo_down',
      "Control the return \u2014 don't let the weight pull you forward.": 'tempo_up',
    },
    feedbackMessages: {
      'Stay upright \u2014 avoid leaning back during the pull.': [
        'Stay upright as you pull.',
        'Less lean back. Keep the row strict.',
        'Brace tall and pull with your back.',
      ],
      'Keep your torso steady through the row.': [
        'Keep your torso steady.',
        'Brace and row without rocking.',
        'Less body swing. Keep it strict.',
      ],
      'Keep your elbows lower \u2014 row toward your ribs.': [
        'Row toward your ribs.',
        'Keep the elbows lower.',
        'Pull lower, not up toward the chest.',
      ],
      'Keep your shoulders down as you pull.': [
        'Keep your shoulders down.',
        'Relax the traps as you row.',
        'Pull back without shrugging.',
      ],
      'Slow down the pull \u2014 control the contraction.': [
        'Slow the pull.',
        'Control the squeeze.',
        'Pull back smoothly and squeeze.',
      ],
      "Control the return \u2014 don't let the weight pull you forward.": [
        'Control the return.',
        "Don't let the weight pull you forward.",
        'Reach forward with control.',
      ],
    },
    issueDefinitions: [
      {
        issueType: 'row_depth',
        priority: 25,
        messages: [
          'Pull it all the way back.',
          'Squeeze those shoulder blades.',
          'Pull deeper and squeeze.',
        ],
      },
      {
        issueType: 'row_extension',
        priority: 15,
        messages: [
          'Let your arms stretch forward.',
          'Full extension at the front.',
          'Find the full stretch.',
        ],
      },
      {
        issueType: 'shoulder_retraction',
        priority: 20,
        messages: [
          'Elbows back. Squeeze your shoulder blades.',
          'Squeeze your shoulder blades.',
          'Drive those elbows behind you.',
          ],
      },
      {
        issueType: 'torso_rocking',
        priority: 18,
        messages: [
          'Keep your torso steady.',
          'Brace and stop the body swing.',
          'Row without rocking your torso.',
        ],
      },
      {
        issueType: 'high_row',
        priority: 18,
        messages: [
          'Row toward your ribs.',
          'Keep your elbows lower.',
          'Pull lower with your elbows.',
        ],
      },
      {
        issueType: 'shoulder_shrug',
        priority: 16,
        messages: [
          'Keep your shoulders down.',
          'No shrug at the top.',
          'Pull without lifting your shoulders.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Pull further back \u2014 squeeze your shoulder blades together.':
      'Focus on pulling the handle all the way to your torso and squeezing your shoulder blades together at peak contraction.',
    'Extend your arms fully \u2014 get a full stretch at the front.':
      'Allow your arms to fully extend on each return to maximize the stretch and range of motion.',
    'Drive your elbows back \u2014 focus on shoulder retraction.':
      'Initiate the pull by driving your elbows back rather than curling with your arms. Think about squeezing a pencil between your shoulder blades.',
    'Stay upright \u2014 avoid leaning back during the pull.':
      'Maintain an upright torso throughout the movement. Leaning back uses momentum rather than back muscles.',
    'Keep your torso steady through the row.':
      'Brace your midsection and keep your torso quiet so the pull comes from your back rather than body swing.',
    'Keep your elbows lower \u2014 row toward your ribs.':
      'Pull the handle toward your lower ribs with elbows tracking back instead of rowing high toward your upper chest.',
    'Keep your shoulders down as you pull.':
      'Keep your shoulders relaxed and down so the row targets your back rather than turning into a shrug.',
    'Slow down the pull \u2014 control the contraction.':
      'Control the concentric phase \u2014 aim for 1-2 seconds on the pull to maximize muscle engagement.',
    "Control the return \u2014 don't let the weight pull you forward.":
      'Resist the weight on the return phase \u2014 aim for 2-3 seconds of controlled eccentric movement.',
  },
  };
}

export const cableRowDefinition: ExerciseDefinition = createCableRowDefinition();
