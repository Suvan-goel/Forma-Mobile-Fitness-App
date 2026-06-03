/**
 * Barbell Curl — Exercise Definition (Exercise Framework)
 *
 * Uses ratio-based metrics for camera-angle-invariant form detection.
 * Primary metric: reach ratio = dist(shoulder,wrist) / (dist(shoulder,elbow) + dist(elbow,wrist))
 *   - Fully extended arm: ~0.95-1.0
 *   - Fully curled (top of curl): ~0.40-0.50
 *   - Camera-invariant: foreshortening scales numerator and denominator equally
 *
 * The only export is `barbellCurlDefinition`.
 */

import {
  Keypoint,
  calculateAngle2D,
  calculateSignedVerticalAngle,
  calculateSignedVerticalAngleSagittal,
  calculateShoulderFlexionAngle,
  getKeypoint,
  isVisible,
} from '../../poseAnalysis';

import {
  createDefaultTunableSpec,
  getConfigValue,
  mergeHeuristicConfig,
  runWithConfigBindings,
} from '../heuristicConfig';
import { createPoseStateReliabilityAggregator } from '../../pose/buildPoseState';
import { LOW_ROM_FEEDBACK, isMeaningfulPartialRep } from '../shared/partialReps';
import {
  buildRepDiagnostics,
  diagnosticCue,
  diagnosticLabelMetric,
  diagnosticMetric,
} from '../shared/diagnostics';
import {
  interpretPoseStateReliabilitySummary,
  type RepReliabilityInterpretation,
} from '../shared/reliabilityInterpretation';
import tunedConfig from './tuned/barbellCurl.json';
import type {
  ExerciseDefinition,
  ExerciseFrameContext,
  ExerciseHeuristicConfig,
  ExerciseState,
  NumericTunable,
  RepViewQualityDiagnostic,
  RepResult as FrameworkRepResult,
} from '../types';
import type { PoseStateReliabilitySummary } from '../../pose/PoseState';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/**
 * FSM thresholds — ratio-based (camera-angle invariant).
 * Reach ratio: dist(shoulder,wrist) / (dist(shoulder,elbow) + dist(elbow,wrist))
 *   1.0 = perfectly straight arm, 0.0 = wrist at shoulder
 */
const THRESHOLDS = {
  /** Reach ratio above which arm is considered fully extended → rep complete */
  EXTENDED_ENTER: 0.90,
  /** Reach ratio below which we start detecting upward motion from REST */
  EXTENDED_EXIT: 0.90,
  /** Reach ratio below which arm is considered fully curled → top of curl */
  FLEXED_ENTER: 0.54,
  /** Reach ratio above which we start detecting downward motion from TOP */
  FLEXED_EXIT: 0.57,
  /** Ratio rebound from the deepest curl that marks the start of lowering. */
  FLEXED_EXIT_DELTA: 0.04,
  MIN_REP_TIME: 0.25, // seconds
  SYNC_WINDOW: 0.75, // seconds between arms
  /** Minimum reach ratio ROM (max - min) for a valid rep */
  ROM_MIN: 0.38,
  /** Minimum ratio ROM for a returned partial rep to count */
  MIN_PARTIAL_ROM: 0.19,
  /** Minimum per-arm ROM required to treat an arm as participating in a bilateral rep. */
  MIN_ARM_PARTICIPATION_ROM: 0.19,
  /** Min seconds the arm must be in DOWN state before normal completion.
   *  Filters pose-estimation noise spikes. */
  MIN_DOWN_GUARD: 0.10,
} as const;

/** Form heuristic thresholds — ratios where applicable, degrees for angular metrics */
const FORM_THRESHOLDS = {
  // Shoulder movement delta (degrees) — already camera-invariant as a delta
  SHOULDER_WARN: 45,
  SHOULDER_FAIL: 65,
  // Torso swing delta (degrees) — already camera-invariant (sagittal projection)
  TORSO_WARN: 15,
  TORSO_FAIL: 22,
  TEMPO_UP_MIN: 0.05,
  TEMPO_DOWN_MIN: 0.15,
  /** Symmetry: max allowed ratio difference between arms */
  SYMMETRY_MIN_RATIO: 0.10, // min reach ratio difference between arms
  SYMMETRY_ROM_RATIO: 0.12, // ROM ratio difference between arms
  /** Elbow flare: angle of the upper arm from vertical in the frontal plane. */
  ELBOW_FLARE_WARN: 30,
  ELBOW_FLARE_FAIL: 45,
  /** Reach ratio thresholds for form messages */
  FLEX_RATIO_WARN: 0.55,  // min ratio above this → "flex more at top"
  EXTEND_RATIO_WARN: 0.90, // max ratio below this → "extend fully"
} as const;

const PENALTY_CONFIGS = {
  TORSO: { cap: 35, scale: 0.40, deadzone: 0 },
  SHOULDER: { cap: 30, scale: 0.018, deadzone: 0 },
  ROM_FLEX: { cap: 20, scale: 300, deadzone: 0 },
  ROM_EXTEND: { cap: 20, scale: 300, deadzone: 0 },
  ROM_TOTAL: { cap: 15, scale: 250, deadzone: 0 },
  TEMPO_UP: { cap: 10, scale: 60, deadzone: 0 },
  TEMPO_DOWN: { cap: 10, scale: 40, deadzone: 0 },
  ELBOW_FLARE: { cap: 20, scale: 0.022, deadzone: 0 },
  ASYMMETRY_MIN: { cap: 10, scale: 500, deadzone: 0 },
  ASYMMETRY_ROM: { cap: 10, scale: 500, deadzone: 0 },
  SYNC_DELTA: { cap: 8, scale: 20, deadzone: 0 },
} as const;

const VIEW_QUALITY_THRESHOLDS = {
  MIN_SAMPLES: 4,
  FRONT_MIN_SUPPORT: 0.60,
  SIDE_MIN_SUPPORT: 0.55,
  PRIMARY_SIDE_MIN_SUPPORT: 0.60,
} as const;

/** Smoothing parameters */
const MEDIAN_WINDOW = 4;
const EMA_ALPHA = 0.4;
const VISIBILITY_THRESHOLD = 0.15;
const TEMPO_UP_MIN_SAFETY_FLOOR = 0.15;
const ELBOW_FLARE_MIN_CONFIDENT_SAMPLES = 4;
const ELBOW_FLARE_WARN_SAMPLE_RATIO = 0.25;
const ELBOW_FLARE_FAIL_SAMPLE_RATIO = 0.2;

/** Warm-up: require N consecutive stable frames before enabling FSM */
const WARMUP_REQUIRED = 12;          // ~0.6s at 20fps
const WARMUP_VISIBILITY_MIN = 0.3;   // avg visibility of 8 key joints must exceed this

const DEFAULT_BARBELL_CURL_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
  viewQualityThresholds: VIEW_QUALITY_THRESHOLDS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_BARBELL_CURL_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_BARBELL_CURL_HEURISTIC_CONFIG,
  tunedConfig,
);

const BARBELL_CURL_TUNABLE_SPEC = createDefaultTunableSpec(
  'Barbell Curl',
  ACTIVE_BARBELL_CURL_HEURISTIC_CONFIG,
);

function upsertBarbellCurlTunable(tunable: NumericTunable): void {
  const existingIndex = BARBELL_CURL_TUNABLE_SPEC.tunables.findIndex((entry) => entry.path === tunable.path);
  if (existingIndex >= 0) {
    BARBELL_CURL_TUNABLE_SPEC.tunables[existingIndex] = tunable;
    return;
  }
  BARBELL_CURL_TUNABLE_SPEC.tunables.push(tunable);
}

BARBELL_CURL_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'barbell-curl.incomplete_flex', metricKey: 'minCurlRatio', thresholdPath: 'formThresholds.FLEX_RATIO_WARN', direction: 'above' },
  { issueId: 'barbell-curl.incomplete_extend', metricKey: 'returnMaxCurlRatio', thresholdPath: 'formThresholds.EXTEND_RATIO_WARN', direction: 'below' },
  { issueId: 'barbell-curl.incomplete_rom', metricKey: 'romRatio', thresholdPath: 'thresholds.ROM_MIN', direction: 'below' },
  { issueId: 'barbell-curl.shoulder_fail', metricKey: 'shoulderDelta', thresholdPath: 'formThresholds.SHOULDER_FAIL', direction: 'above' },
  { issueId: 'barbell-curl.shoulder_warn', metricKey: 'shoulderDelta', thresholdPath: 'formThresholds.SHOULDER_WARN', direction: 'above' },
  { issueId: 'barbell-curl.torso_fail', metricKey: 'torsoDelta', thresholdPath: 'formThresholds.TORSO_FAIL', direction: 'above' },
  { issueId: 'barbell-curl.torso_warn', metricKey: 'torsoDelta', thresholdPath: 'formThresholds.TORSO_WARN', direction: 'above' },
  { issueId: 'barbell-curl.elbow_flare', metricKey: 'elbowFlareMaxDeg', thresholdPath: 'formThresholds.ELBOW_FLARE_WARN', direction: 'above', minEligibleSamples: ELBOW_FLARE_MIN_CONFIDENT_SAMPLES, minPositiveCases: 2, minNegativeCases: 2 },
  { issueId: 'barbell-curl.tempo_up', metricKey: 'tUp', thresholdPath: 'formThresholds.TEMPO_UP_MIN', direction: 'below' },
  { issueId: 'barbell-curl.tempo_down', metricKey: 'tDown', thresholdPath: 'formThresholds.TEMPO_DOWN_MIN', direction: 'below' },
  { issueId: 'barbell-curl.asymmetry', metricKey: 'asymmetryMinRatio', thresholdPath: 'formThresholds.SYMMETRY_MIN_RATIO', direction: 'above', minPositiveCases: 2, minNegativeCases: 2 },
  { issueId: 'barbell-curl.asymmetry', metricKey: 'asymmetryRomRatio', thresholdPath: 'formThresholds.SYMMETRY_ROM_RATIO', direction: 'above', minPositiveCases: 2, minNegativeCases: 2 },
  { issueId: 'barbell-curl.asymmetry', metricKey: 'syncDelta', thresholdPath: 'thresholds.SYNC_WINDOW', direction: 'above', minPositiveCases: 2, minNegativeCases: 2 },
];

[
  { path: 'viewQualityThresholds.MIN_SAMPLES', min: 2, max: 20, step: 1 },
  { path: 'viewQualityThresholds.FRONT_MIN_SUPPORT', min: 0.3, max: 0.95, step: 0.05 },
  { path: 'viewQualityThresholds.SIDE_MIN_SUPPORT', min: 0.3, max: 0.95, step: 0.05 },
  { path: 'viewQualityThresholds.PRIMARY_SIDE_MIN_SUPPORT', min: 0.3, max: 0.95, step: 0.05 },
].forEach((entry) => upsertBarbellCurlTunable({ ...entry, kind: 'feedback' }));

const BARBELL_CURL_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
  { path: 'viewQualityThresholds', target: VIEW_QUALITY_THRESHOLDS as unknown as Record<string, unknown> },
];

const BARBELL_CURL_ISSUE_CUE_FAMILIES: Record<string, string> = {
  'barbell-curl.incomplete_flex': 'visibleArmRom',
  'barbell-curl.incomplete_extend': 'visibleArmRom',
  'barbell-curl.incomplete_rom': 'bilateralArmRom',
  'barbell-curl.shoulder_fail': 'visibleArmRom',
  'barbell-curl.shoulder_warn': 'visibleArmRom',
  'barbell-curl.torso_fail': 'torsoControl',
  'barbell-curl.torso_warn': 'torsoControl',
  'barbell-curl.elbow_flare': 'bilateralArmRom',
  'barbell-curl.tempo_up': 'tempo',
  'barbell-curl.tempo_down': 'tempo',
  'barbell-curl.asymmetry': 'bilateralSymmetry',
};

const BARBELL_CURL_MESSAGE_CUE_FAMILIES: Record<string, string> = {
  'Flex more at the top of the curl.': 'visibleArmRom',
  'Extend fully at the bottom.': 'visibleArmRom',
  'Incomplete rep — curl all the way up and fully extend.': 'bilateralArmRom',
  'Too much shoulder involvement — reduce the weight.': 'visibleArmRom',
  'Upper arms moving — keep elbows pinned to your sides.': 'visibleArmRom',
  'Excessive body swing — this is cheating the rep.': 'torsoControl',
  "Don't swing your torso — stay upright and controlled.": 'torsoControl',
  "Keep your elbows in — don't flare them out to the sides.": 'bilateralArmRom',
  "Tuck your elbows in — they're drifting outward.": 'bilateralArmRom',
  'Slow down — control the curl.': 'tempo',
  "Control the lowering — don't drop the weight.": 'tempo',
  'Arms are uneven — curl both sides together.': 'bilateralSymmetry',
};

const BARBELL_CURL_QUALITY_PROFILE: NonNullable<ExerciseDefinition['qualityProfile']> = {
  exerciseName: 'Barbell Curl',
  requiredView: 'front',
  framingScope: 'key_joints',
  requiredJointGroups: [
    {
      id: 'front_bilateral',
      label: 'front bilateral arms',
      joints: [
        'left_shoulder',
        'right_shoulder',
        'left_elbow',
        'right_elbow',
        'left_wrist',
        'right_wrist',
        'left_hip',
        'right_hip',
      ],
    },
    {
      id: 'left_primary_arm',
      label: 'left primary arm',
      joints: ['left_shoulder', 'left_elbow', 'left_wrist', 'left_hip', 'right_shoulder', 'right_hip'],
    },
    {
      id: 'right_primary_arm',
      label: 'right primary arm',
      joints: ['right_shoulder', 'right_elbow', 'right_wrist', 'right_hip', 'left_shoulder', 'left_hip'],
    },
  ],
  minRequiredVisibility: VISIBILITY_THRESHOLD,
};

function withBarbellCurlConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, BARBELL_CURL_CONFIG_BINDINGS, fn);
}

function mergedBarbellCurlConfig(config: ExerciseHeuristicConfig): ExerciseHeuristicConfig {
  return mergeHeuristicConfig(DEFAULT_BARBELL_CURL_HEURISTIC_CONFIG, config);
}

function finiteConfigNumber(
  config: ExerciseHeuristicConfig,
  path: string,
  errors: string[],
): number {
  const value = getConfigValue(config, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number.`);
    return NaN;
  }
  return value;
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireConfigObject(
  config: ExerciseHeuristicConfig,
  path: string,
  errors: string[],
): boolean {
  const value = getConfigValue(config, path);
  if (!isConfigObject(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  return true;
}

function requireGreaterThan(
  config: ExerciseHeuristicConfig,
  leftPath: string,
  rightPath: string,
  errors: string[],
  allowEqual = false,
): void {
  const left = finiteConfigNumber(config, leftPath, errors);
  const right = finiteConfigNumber(config, rightPath, errors);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return;
  if (allowEqual ? left < right : left <= right) {
    errors.push(`${leftPath} must be ${allowEqual ? 'greater than or equal to' : 'greater than'} ${rightPath}.`);
  }
}

function requireRange(
  config: ExerciseHeuristicConfig,
  path: string,
  min: number,
  max: number,
  errors: string[],
): void {
  const value = finiteConfigNumber(config, path, errors);
  if (!Number.isFinite(value)) return;
  if (value < min || value > max) {
    errors.push(`${path} must be between ${min} and ${max}.`);
  }
}

function validatePenaltyConfig(config: ExerciseHeuristicConfig, key: PenaltyConfigKey, errors: string[]): void {
  const prefix = `penaltyConfigs.${key}`;
  if (!requireConfigObject(config, prefix, errors)) return;
  const cap = finiteConfigNumber(config, `${prefix}.cap`, errors);
  const scale = finiteConfigNumber(config, `${prefix}.scale`, errors);
  const deadzone = finiteConfigNumber(config, `${prefix}.deadzone`, errors);
  if (Number.isFinite(cap) && cap < 0) errors.push(`${prefix}.cap must be non-negative.`);
  if (Number.isFinite(scale) && scale <= 0) errors.push(`${prefix}.scale must be greater than 0.`);
  if (Number.isFinite(deadzone) && deadzone < 0) errors.push(`${prefix}.deadzone must be non-negative.`);
}

export function validateBarbellCurlHeuristicConfig(config: ExerciseHeuristicConfig): string[] {
  const activeConfig = mergedBarbellCurlConfig(config);
  const errors: string[] = [];
  const hasViewQualityConfig = requireConfigObject(activeConfig, 'viewQualityThresholds', errors);
  const hasPenaltyConfigs = requireConfigObject(activeConfig, 'penaltyConfigs', errors);

  requireGreaterThan(activeConfig, 'thresholds.FLEXED_EXIT', 'thresholds.FLEXED_ENTER', errors);
  requireGreaterThan(activeConfig, 'thresholds.EXTENDED_EXIT', 'thresholds.FLEXED_EXIT', errors);
  requireGreaterThan(activeConfig, 'thresholds.EXTENDED_ENTER', 'thresholds.FLEXED_EXIT', errors);
  requireGreaterThan(activeConfig, 'thresholds.EXTENDED_EXIT', 'thresholds.EXTENDED_ENTER', errors, true);
  requireRange(activeConfig, 'thresholds.FLEXED_EXIT_DELTA', 0, 0.25, errors);
  requireRange(activeConfig, 'thresholds.MIN_REP_TIME', 0.05, 5, errors);
  requireRange(activeConfig, 'thresholds.MIN_DOWN_GUARD', 0, 2, errors);
  requireRange(activeConfig, 'thresholds.SYNC_WINDOW', 0.05, 5, errors);
  requireGreaterThan(activeConfig, 'thresholds.ROM_MIN', 'thresholds.MIN_PARTIAL_ROM', errors, true);
  requireGreaterThan(activeConfig, 'thresholds.MIN_PARTIAL_ROM', 'thresholds.MIN_ARM_PARTICIPATION_ROM', errors, true);

  requireGreaterThan(activeConfig, 'formThresholds.SHOULDER_FAIL', 'formThresholds.SHOULDER_WARN', errors);
  requireGreaterThan(activeConfig, 'formThresholds.TORSO_FAIL', 'formThresholds.TORSO_WARN', errors);
  requireGreaterThan(activeConfig, 'formThresholds.ELBOW_FLARE_FAIL', 'formThresholds.ELBOW_FLARE_WARN', errors);
  requireRange(activeConfig, 'formThresholds.TEMPO_UP_MIN', 0.01, 10, errors);
  requireRange(activeConfig, 'formThresholds.TEMPO_DOWN_MIN', 0.01, 10, errors);
  requireRange(activeConfig, 'formThresholds.SYMMETRY_MIN_RATIO', 0, 1, errors);
  requireRange(activeConfig, 'formThresholds.SYMMETRY_ROM_RATIO', 0, 1, errors);
  requireRange(activeConfig, 'formThresholds.FLEX_RATIO_WARN', 0, 1.2, errors);
  requireRange(activeConfig, 'formThresholds.EXTEND_RATIO_WARN', 0, 1.2, errors);
  requireGreaterThan(activeConfig, 'formThresholds.FLEX_RATIO_WARN', 'thresholds.FLEXED_ENTER', errors, true);
  requireGreaterThan(activeConfig, 'formThresholds.EXTEND_RATIO_WARN', 'thresholds.EXTENDED_ENTER', errors, true);
  requireGreaterThan(activeConfig, 'formThresholds.EXTEND_RATIO_WARN', 'thresholds.EXTENDED_EXIT', errors, true);
  requireGreaterThan(activeConfig, 'formThresholds.EXTEND_RATIO_WARN', 'formThresholds.FLEX_RATIO_WARN', errors);

  if (hasViewQualityConfig) {
    const minSamples = finiteConfigNumber(activeConfig, 'viewQualityThresholds.MIN_SAMPLES', errors);
    if (Number.isFinite(minSamples) && (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 120)) {
      errors.push('viewQualityThresholds.MIN_SAMPLES must be an integer between 1 and 120.');
    }
    requireRange(activeConfig, 'viewQualityThresholds.FRONT_MIN_SUPPORT', 0, 1, errors);
    requireRange(activeConfig, 'viewQualityThresholds.SIDE_MIN_SUPPORT', 0, 1, errors);
    requireRange(activeConfig, 'viewQualityThresholds.PRIMARY_SIDE_MIN_SUPPORT', 0, 1, errors);
  }

  if (hasPenaltyConfigs) {
    for (const key of Object.keys(PENALTY_CONFIGS) as PenaltyConfigKey[]) {
      validatePenaltyConfig(activeConfig, key, errors);
    }
  }

  return errors;
}

// ============================================================================
// CONTINUOUS PENALTY FUNCTIONS (ratio-based where applicable)
// All use quadratic ramps: penalty(x) = min(cap, scale * max(0, x - deadzone)^2)
// ============================================================================

type PenaltyConfigKey = keyof typeof PENALTY_CONFIGS;

function penaltyAbove(value: number, threshold: number, configKey: PenaltyConfigKey): number {
  const config = PENALTY_CONFIGS[configKey];
  const d = Math.max(0, value - threshold - config.deadzone);
  return Math.min(config.cap, config.scale * d * d);
}

function penaltyBelow(value: number, threshold: number, configKey: PenaltyConfigKey): number {
  const config = PENALTY_CONFIGS[configKey];
  const d = Math.max(0, threshold - value - config.deadzone);
  return Math.min(config.cap, config.scale * d * d);
}

/** Torso swing penalty. Already camera-invariant: measures delta within a single rep. */
function penaltyTorso(delta: number): number {
  return penaltyAbove(delta, FORM_THRESHOLDS.TORSO_WARN, 'TORSO');
}

/** Shoulder movement penalty. Already camera-invariant: measures delta within a single rep. */
function penaltyShoulder(delta: number): number {
  return penaltyAbove(delta, FORM_THRESHOLDS.SHOULDER_WARN, 'SHOULDER');
}

/** ROM shortfall penalty — ratio-based, no foreshortening compensation needed. */
function penaltyROM(minRatio: number, returnMaxRatio: number | null, romRatio: number): number {
  const flexPenalty = penaltyAbove(minRatio, FORM_THRESHOLDS.FLEX_RATIO_WARN, 'ROM_FLEX');
  const extPenalty = returnMaxRatio !== null
    ? penaltyBelow(returnMaxRatio, FORM_THRESHOLDS.EXTEND_RATIO_WARN, 'ROM_EXTEND')
    : 0;
  const totalPenalty = penaltyBelow(romRatio, THRESHOLDS.ROM_MIN, 'ROM_TOTAL');
  return Math.min(35, flexPenalty + extPenalty + totalPenalty);
}

/** Tempo penalty — tuned thresholds, capped as secondary feedback. */
function penaltyTempo(tUp: number, tDown: number): number {
  const upPenalty = tUp > 0 ? penaltyBelow(tUp, getEffectiveTempoUpMin(), 'TEMPO_UP') : 0;
  const downPenalty = tDown > 0 ? penaltyBelow(tDown, FORM_THRESHOLDS.TEMPO_DOWN_MIN, 'TEMPO_DOWN') : 0;
  return Math.min(20, upPenalty + downPenalty);
}

/** Elbow flare penalty. */
function penaltyElbowFlare(maxFlareDeg: number): number {
  return penaltyAbove(maxFlareDeg, FORM_THRESHOLDS.ELBOW_FLARE_WARN, 'ELBOW_FLARE');
}

/** Asymmetry penalty — ratio-based. Compares reach ratio differences between arms. */
function penaltyAsymmetry(deltaMinRatio: number, deltaRomRatio: number, syncDelta: number | null): number {
  const minPenalty = penaltyAbove(deltaMinRatio, FORM_THRESHOLDS.SYMMETRY_MIN_RATIO, 'ASYMMETRY_MIN');
  const romPenalty = penaltyAbove(deltaRomRatio, FORM_THRESHOLDS.SYMMETRY_ROM_RATIO, 'ASYMMETRY_ROM');
  const syncPenalty = syncDelta !== null ? penaltyAbove(syncDelta, THRESHOLDS.SYNC_WINDOW, 'SYNC_DELTA') : 0;
  return Math.min(15, minPenalty + romPenalty + syncPenalty);
}

function getConcentricDuration(arm: ArmFSM): number {
  return arm.tUpToTop !== null && arm.tRestToUp !== null ? arm.tUpToTop - arm.tRestToUp : 0;
}

function getEccentricDuration(arm: ArmFSM): number {
  const loweringStart = arm.tTopToDown !== null ? arm.tTopToDown : arm.tUpToTop;
  return arm.tDownToRest !== null && loweringStart !== null ? arm.tDownToRest - loweringStart : 0;
}

function getEffectiveTempoUpMin(): number {
  return FORM_THRESHOLDS.TEMPO_UP_MIN > 0
    ? FORM_THRESHOLDS.TEMPO_UP_MIN
    : TEMPO_UP_MIN_SAFETY_FLOOR;
}

function getRepTempoForSide(repWindow: RepWindow, arm: ArmFSM, side: CurlSide): { tUp: number; tDown: number } {
  const tempo = repWindow.tempo[side];
  const tUp =
    tempo.curlStartAt !== null &&
    tempo.deepestAt !== null &&
    tempo.deepestAt > tempo.curlStartAt
      ? tempo.deepestAt - tempo.curlStartAt
      : getConcentricDuration(arm);
  const loweringStart = tempo.loweringStartAt ?? tempo.deepestAt;
  const tDown =
    loweringStart !== null &&
    tempo.extensionReturnAt !== null &&
    tempo.extensionReturnAt > loweringStart
      ? tempo.extensionReturnAt - loweringStart
      : getEccentricDuration(arm);

  return { tUp, tDown };
}

function getRepTempoDurations(
  repWindow: RepWindow,
  leftArm: ArmFSM,
  rightArm: ArmFSM,
  viewAngle: ViewAngle,
): { tUp: number; tDown: number } {
  const isFrontal = viewAngle.zone === 'frontal';
  const primaryIsLeft = viewAngle.primarySide !== 'right';
  const leftTempo = getRepTempoForSide(repWindow, leftArm, 'left');
  const rightTempo = getRepTempoForSide(repWindow, rightArm, 'right');

  if (isFrontal) {
    return {
      tUp: leftTempo.tUp > 0 && rightTempo.tUp > 0
        ? (leftTempo.tUp + rightTempo.tUp) / 2
        : Math.max(leftTempo.tUp, rightTempo.tUp),
      tDown: leftTempo.tDown > 0 && rightTempo.tDown > 0
        ? (leftTempo.tDown + rightTempo.tDown) / 2
        : Math.max(leftTempo.tDown, rightTempo.tDown),
    };
  }

  return primaryIsLeft ? leftTempo : rightTempo;
}

function sampleRatio(samples: number, total: number): number {
  return total > 0 ? samples / total : 0;
}

function getElbowFlareSummary(
  repWindow: RepWindow,
  isFrontal: boolean,
): { sustainedWarn: boolean; sustainedFail: boolean; maxFlareDeg: number } {
  if (!isFrontal) return { sustainedWarn: false, sustainedFail: false, maxFlareDeg: 0 };

  let sustainedWarn = false;
  let sustainedFail = false;
  let maxFlareDeg = 0;

  for (const side of SIDES) {
    const samples = repWindow.elbowFlare[side];
    if (samples.confidentSamples < ELBOW_FLARE_MIN_CONFIDENT_SAMPLES) continue;
    const warnRatio = sampleRatio(samples.warnSamples, samples.confidentSamples);
    const failRatio = sampleRatio(samples.failSamples, samples.confidentSamples);
    sustainedWarn = sustainedWarn || warnRatio >= ELBOW_FLARE_WARN_SAMPLE_RATIO;
    sustainedFail = sustainedFail || failRatio >= ELBOW_FLARE_FAIL_SAMPLE_RATIO;
    if (warnRatio >= ELBOW_FLARE_WARN_SAMPLE_RATIO || failRatio >= ELBOW_FLARE_FAIL_SAMPLE_RATIO) {
      maxFlareDeg = Math.max(maxFlareDeg, samples.maxFlareDeg);
    }
  }

  return { sustainedWarn, sustainedFail, maxFlareDeg };
}

function sideRatioOk(repWindow: RepWindow, side: CurlSide): boolean {
  if (side === 'left') {
    return Number.isFinite(repWindow.ratios.minLeftRatio) && Number.isFinite(repWindow.ratios.maxLeftRatio);
  }
  return Number.isFinite(repWindow.ratios.minRightRatio) && Number.isFinite(repWindow.ratios.maxRightRatio);
}

function sideRomRatio(repWindow: RepWindow, side: CurlSide): number {
  if (!sideRatioOk(repWindow, side)) return 0;
  if (side === 'left') return repWindow.ratios.maxLeftRatio - repWindow.ratios.minLeftRatio;
  return repWindow.ratios.maxRightRatio - repWindow.ratios.minRightRatio;
}

function sideReturnMaxRatio(repWindow: RepWindow, side: CurlSide): number | null {
  const value = repWindow.tempo[side].returnMaxRatio;
  return Number.isFinite(value) ? value : null;
}

function getReturnMaxCurlRatio(repWindow: RepWindow, viewAngle: ViewAngle): number | null {
  if (viewAngle.zone === 'frontal') {
    const values = SIDES
      .map((side) => sideReturnMaxRatio(repWindow, side))
      .filter((value): value is number => value !== null);
    return values.length > 0 ? Math.min(...values) : null;
  }

  return sideReturnMaxRatio(repWindow, primarySideForView(viewAngle));
}

function sideParticipated(repWindow: RepWindow, side: CurlSide): boolean {
  return (
    repWindow.ratioSamples[side].validSamples > 0 &&
    sideRomRatio(repWindow, side) >= THRESHOLDS.MIN_ARM_PARTICIPATION_ROM
  );
}

function primarySideForView(viewAngle: ViewAngle): CurlSide {
  return viewAngle.primarySide === 'right' ? 'right' : 'left';
}

function finiteDelta(min: number, max: number): number | null {
  const delta = max - min;
  return Number.isFinite(delta) ? delta : null;
}

function cueFamilyAllowed(allowedCueFamilies: ReadonlySet<string> | undefined, family: string): boolean {
  return !allowedCueFamilies || allowedCueFamilies.has(family);
}

interface ShoulderDeltaSummary {
  left: number | null;
  right: number | null;
  primary: number | null;
  scoring: number | null;
  skippedReason: string | null;
}

function getShoulderDeltaSummary(repWindow: RepWindow, viewAngle: ViewAngle): ShoulderDeltaSummary {
  const left = finiteDelta(repWindow.minAngles.leftShoulder, repWindow.maxAngles.leftShoulder);
  const right = finiteDelta(repWindow.minAngles.rightShoulder, repWindow.maxAngles.rightShoulder);
  const values = [left, right].filter((value): value is number => value !== null);

  if (viewAngle.zone === 'frontal') {
    const scoring = values.length > 0 ? Math.max(...values) : null;
    return {
      left,
      right,
      primary: null,
      scoring,
      skippedReason: scoring === null ? 'shoulder_unavailable' : null,
    };
  }

  const primary = primarySideForView(viewAngle) === 'left' ? left : right;
  return {
    left,
    right,
    primary,
    scoring: primary,
    skippedReason: primary === null ? 'primary_shoulder_unavailable' : null,
  };
}

/** Compute a continuous rep score from ratio-based measurements. */
function computeRepScore(
  repWindow: RepWindow,
  leftArm: ArmFSM,
  _rightArm: ArmFSM,
  viewAngle: ViewAngle = { angleDeg: 0, smoothedAngleDeg: 0, zone: 'frontal', primarySide: 'both' },
  viewQuality?: RepViewQualityDiagnostic,
  allowedCueFamilies?: ReadonlySet<string>,
): number {
  const { minAngles, maxAngles } = repWindow;
  const isFrontal = viewAngle.zone === 'frontal';
  const frontFormEligible = isFrontal && (viewQuality?.frontishConfirmed ?? true);
  const primaryIsLeft = viewAngle.primarySide !== 'right';

  // Torso penalty (delta-based, already camera-invariant)
  const deltaTorso = isFinite(maxAngles.torso - minAngles.torso)
    ? maxAngles.torso - minAngles.torso
    : 0;
  const torsoP = cueFamilyAllowed(allowedCueFamilies, 'torsoControl') ? penaltyTorso(deltaTorso) : 0;

  // Shoulder penalty: frontal uses bilateral max; side/oblique uses selected primary side.
  const shoulderSummary = getShoulderDeltaSummary(repWindow, viewAngle);
  const shoulderP =
    cueFamilyAllowed(allowedCueFamilies, 'visibleArmRom') && shoulderSummary.scoring !== null
      ? penaltyShoulder(shoulderSummary.scoring)
      : 0;

  // ROM penalty — ratio-based (camera-invariant, no foreshortening compensation)
  const leftRatioOk = isFinite(repWindow.ratios.minLeftRatio) && isFinite(repWindow.ratios.maxLeftRatio);
  const rightRatioOk = isFinite(repWindow.ratios.minRightRatio) && isFinite(repWindow.ratios.maxRightRatio);
  let minRatio: number;
  if (isFrontal) {
    minRatio = Math.min(
      leftRatioOk ? repWindow.ratios.minLeftRatio : Infinity,
      rightRatioOk ? repWindow.ratios.minRightRatio : Infinity
    );
  } else {
    minRatio = primaryIsLeft
      ? (leftRatioOk ? repWindow.ratios.minLeftRatio : 0.45)
      : (rightRatioOk ? repWindow.ratios.minRightRatio : 0.45);
  }
  const romRatio = getRepWindowRomRatio(repWindow, viewAngle);
  const returnMaxRatio = getReturnMaxCurlRatio(repWindow, viewAngle);
  const romP = cueFamilyAllowed(allowedCueFamilies, 'visibleArmRom')
    ? penaltyROM(
        isFinite(minRatio) ? minRatio : 0.45,
        returnMaxRatio,
        romRatio,
      )
    : 0;

  const { tUp, tDown } = getRepTempoDurations(repWindow, leftArm, _rightArm, viewAngle);
  const tempoP = cueFamilyAllowed(allowedCueFamilies, 'tempo') ? penaltyTempo(tUp, tDown) : 0;

  // Asymmetry penalty — ratio-based (camera-invariant)
  let asymmetryP = 0;
  if (cueFamilyAllowed(allowedCueFamilies, 'bilateralSymmetry') && frontFormEligible && leftRatioOk && rightRatioOk) {
    const romLRatio = repWindow.ratios.maxLeftRatio - repWindow.ratios.minLeftRatio;
    const romRRatio = repWindow.ratios.maxRightRatio - repWindow.ratios.minRightRatio;
    const deltaMinRatio = Math.abs(repWindow.ratios.minLeftRatio - repWindow.ratios.minRightRatio);
    const deltaRomRatio = Math.abs(romLRatio - romRRatio);
    asymmetryP = penaltyAsymmetry(deltaMinRatio, deltaRomRatio, repWindow.metadata.syncDelta);
  }

  // Elbow flare penalty (frontal only)
  const flareSummary = getElbowFlareSummary(repWindow, frontFormEligible);
  const elbowFlareP = cueFamilyAllowed(allowedCueFamilies, 'bilateralArmRom') && (flareSummary.sustainedWarn || flareSummary.sustainedFail)
    ? penaltyElbowFlare(flareSummary.maxFlareDeg)
    : 0;

  const total = torsoP + shoulderP + romP + tempoP + asymmetryP + elbowFlareP;
  return Math.max(0, Math.min(100, Math.round(100 - total)));
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

const SIDES = ['left', 'right'] as const;
type CurlSide = typeof SIDES[number];
type ArmState = 'REST' | 'UP' | 'TOP' | 'DOWN';
type LandmarkSource = 'world' | 'image';
type RatioDistanceMode = 'world_3d' | 'image_2d';
type TorsoAnchorSource = 'shoulder_center' | 'unavailable';

interface ArmFSM {
  state: ArmState;
  /** Time when transitioned to REST (for MIN_REP_TIME check) */
  tRestEntry: number | null;
  /** Min/max reach ratio during current rep */
  minRatio: number;
  maxRatio: number;
  /** Timestamps for tempo calculation */
  tRestToUp: number | null;
  tUpToTop: number | null;
  tTopToDown: number | null;
  tDownToRest: number | null;
  /** Guard: arm must reach full extension (ratio >= EXTENDED_EXIT) while in REST before a new rep
   *  can start. Prevents cascade false reps after a premature noise-spike completion. */
  hasReachedExtension: boolean;
  /** True for the frame where an UP-state partial returned to REST before TOP. */
  partialReturnedToRest: boolean;
}

interface RepTempoSide {
  curlStartAt: number | null;
  deepestAt: number | null;
  loweringStartAt: number | null;
  extensionReturnAt: number | null;
  minRatio: number;
  maxRatio: number;
  returnMaxRatio: number;
}

interface RepElbowFlareCounts {
  confidentSamples: number;
  warnSamples: number;
  failSamples: number;
  maxFlareDeg: number;
}

interface RepRatioSampleCounts {
  validSamples: number;
  dropoutSamples: number;
}

interface RepViewSamples {
  total: number;
  front: number;
  oblique: number;
  side: number;
  bilateralValid: number;
  primaryLeft: number;
  primaryRight: number;
}

interface RepMetadata {
  landmarkSource: LandmarkSource;
  ratioDistanceMode: RatioDistanceMode;
  torsoAnchorSources: Record<TorsoAnchorSource, number>;
  completionView: ViewAngle | null;
  selectedSideAtCompletion: ViewAngle['primarySide'] | null;
  syncDelta: number | null;
}

interface RepWindow {
  /** Rolling min/max for angular metrics during the rep (torso and shoulder). */
  minAngles: AngleSet;
  maxAngles: AngleSet;
  /** Rolling min/max reach ratios per arm — the primary metric for ROM/flex/extend evaluation */
  ratios: {
    minLeftRatio: number;
    maxLeftRatio: number;
    minRightRatio: number;
    maxRightRatio: number;
  };
  rawRatios: {
    minLeftRatio: number;
    maxLeftRatio: number;
    minRightRatio: number;
    maxRightRatio: number;
  };
  /** Start/end timestamps */
  tStart: number;
  tEnd: number;
  /** Frame count for duration calculations */
  frameCount: number;
  /** Fast-ratio timestamps used for tempo scoring independent of FSM guard delay. */
  tempo: Record<CurlSide, RepTempoSide>;
  /** Sustained elbow flare samples. Frontal view only. */
  elbowFlare: Record<CurlSide, RepElbowFlareCounts>;
  /** Current-frame ratio sample validity for diagnostics and view quality. */
  ratioSamples: Record<CurlSide, RepRatioSampleCounts>;
  viewSamples: RepViewSamples;
  reliability: ReturnType<typeof createPoseStateReliabilityAggregator>;
  metadata: RepMetadata;
}

interface AngleSet {
  leftElbow: number;
  rightElbow: number;
  leftShoulder: number;
  rightShoulder: number;
  leftTorso: number;
  rightTorso: number;
  torso: number; // midline (hip center -> shoulder center) for better swing detection
  /** Reach ratio: dist(shoulder,wrist) / (dist(shoulder,elbow) + dist(elbow,wrist)).
   *  ~1.0 = fully extended, ~0.4 = fully curled. Camera-angle invariant. */
  leftRatio: number;
  rightRatio: number;
}

interface SmoothedAngles extends AngleSet {}

interface JointAnglesResult {
  angles: AngleSet;
  torsoAnchorSource: TorsoAnchorSource;
  ratioDistanceMode: RatioDistanceMode;
}

/** Exercise-specific RepResult (richer than framework RepResult) */
interface RepResult {
  repIndex: number;
  /** ROM as ratio delta (maxRatio - minRatio) per arm */
  romLRatio: number;
  romRRatio: number;
  tUp: number;
  tDown: number;
  score: number;
  messages: string[];
  scorable?: boolean;
  qualityWarnings?: FrameworkRepResult['qualityWarnings'];
  diagnostics?: FrameworkRepResult['diagnostics'];
}

type ViewZone = 'frontal' | 'oblique' | 'side';

interface ViewAngle {
  /** Estimated rotation from frontal, 0deg = facing camera, 90deg = side */
  angleDeg: number;
  /** Smoothed angle (EMA) for stable zone classification */
  smoothedAngleDeg: number;
  /** Which zone the user is in */
  zone: ViewZone;
  /** Which side faces the camera ('both' when frontal) */
  primarySide: 'left' | 'right' | 'both';
}

interface BarbellCurlState {
  leftArm: ArmFSM;
  rightArm: ArmFSM;
  repCount: number;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  angleHistory: { [K in keyof AngleSet]: number[] }; // For median filter
  smoothed: SmoothedAngles | null; // EMA smoothed angles
  /** Median-only values (no EMA) — fed to FSM to avoid smoothing lag at extremes. */
  fast: SmoothedAngles | null;
  displayAngles: AngleSet | null; // Smoothed angles for UI
  feedback: string | null;
  lastFeedbackTime: number;
  viewAngle: ViewAngle;
  /** Consecutive stable frames seen — FSM disabled until >= WARMUP_REQUIRED */
  warmupFrames: number;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initArmFSM(): ArmFSM {
  return {
    state: 'REST',
    tRestEntry: null,
    minRatio: Infinity,
    maxRatio: -Infinity,
    tRestToUp: null,
    tUpToTop: null,
    tTopToDown: null,
    tDownToRest: null,
    hasReachedExtension: false,
    partialReturnedToRest: false,
  };
}

function initRepTempoSide(): RepTempoSide {
  return {
    curlStartAt: null,
    deepestAt: null,
    loweringStartAt: null,
    extensionReturnAt: null,
    minRatio: Infinity,
    maxRatio: -Infinity,
    returnMaxRatio: -Infinity,
  };
}

function initElbowFlareCounts(): RepElbowFlareCounts {
  return {
    confidentSamples: 0,
    warnSamples: 0,
    failSamples: 0,
    maxFlareDeg: 0,
  };
}

function initRepWindow(tStart: number): RepWindow {
  return {
    minAngles: {
      leftElbow: Infinity,
      rightElbow: Infinity,
      leftShoulder: Infinity,
      rightShoulder: Infinity,
      leftTorso: Infinity,
      rightTorso: Infinity,
      torso: Infinity,
      leftRatio: Infinity,
      rightRatio: Infinity,
    },
    maxAngles: {
      leftElbow: -Infinity,
      rightElbow: -Infinity,
      leftShoulder: -Infinity,
      rightShoulder: -Infinity,
      leftTorso: -Infinity,
      rightTorso: -Infinity,
      torso: -Infinity,
      leftRatio: -Infinity,
      rightRatio: -Infinity,
    },
    ratios: {
      minLeftRatio: Infinity,
      maxLeftRatio: -Infinity,
      minRightRatio: Infinity,
      maxRightRatio: -Infinity,
    },
    rawRatios: {
      minLeftRatio: Infinity,
      maxLeftRatio: -Infinity,
      minRightRatio: Infinity,
      maxRightRatio: -Infinity,
    },
    tStart,
    tEnd: tStart,
    frameCount: 0,
    tempo: { left: initRepTempoSide(), right: initRepTempoSide() },
    elbowFlare: { left: initElbowFlareCounts(), right: initElbowFlareCounts() },
    ratioSamples: {
      left: { validSamples: 0, dropoutSamples: 0 },
      right: { validSamples: 0, dropoutSamples: 0 },
    },
    viewSamples: {
      total: 0,
      front: 0,
      oblique: 0,
      side: 0,
      bilateralValid: 0,
      primaryLeft: 0,
      primaryRight: 0,
    },
    reliability: createPoseStateReliabilityAggregator(),
    metadata: {
      landmarkSource: 'image',
      ratioDistanceMode: 'image_2d',
      torsoAnchorSources: {
        shoulder_center: 0,
        unavailable: 0,
      },
      completionView: null,
      selectedSideAtCompletion: null,
      syncDelta: null,
    },
  };
}

function initAngleHistory(): BarbellCurlState['angleHistory'] {
  return {
    leftElbow: [],
    rightElbow: [],
    leftShoulder: [],
    rightShoulder: [],
    leftTorso: [],
    rightTorso: [],
    torso: [],
    leftRatio: [],
    rightRatio: [],
  };
}

function initializeBarbellCurlState(): BarbellCurlState {
  return {
    leftArm: initArmFSM(),
    rightArm: initArmFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    angleHistory: initAngleHistory(),
    smoothed: null,
    fast: null,
    displayAngles: null,
    feedback: null,
    lastFeedbackTime: 0,
    viewAngle: { angleDeg: 0, smoothedAngleDeg: 0, zone: 'frontal', primarySide: 'both' },
    warmupFrames: 0,
  };
}

// ============================================================================
// VIEW-ANGLE ESTIMATION
// ============================================================================

const VIEW_ANGLE_EMA = 0.25; // Smoothing for view angle (lower = more stable)
const FRONTAL_MAX = 20;      // 0-20deg = frontal
const OBLIQUE_MAX = 55;      // 20-55deg = oblique, 55+ = side

/**
 * Estimate how rotated the user is from frontal view using shoulder geometry.
 * World landmarks: X = left-right (meters), Z = depth (meters).
 * At frontal view, shoulder X-distance is large, Z-distance ~0.
 * As user rotates, X shrinks and Z grows.
 */
function estimateViewAngle(
  keypoints: Keypoint[],
  prevSmoothed: number
): ViewAngle {
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');

  // Need both shoulders with reasonable visibility
  if (
    !leftShoulder || !rightShoulder ||
    !isVisible(leftShoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(rightShoulder, VISIBILITY_THRESHOLD)
  ) {
    // Can't estimate — hold previous smoothed value
    return classifyViewAngle(prevSmoothed, prevSmoothed, 'both');
  }

  const dx = Math.abs(rightShoulder.x - leftShoulder.x);
  const dz = Math.abs((rightShoulder.z ?? 0) - (leftShoulder.z ?? 0));

  // atan2(depth, width) -> 0deg when flat (frontal), 90deg when one shoulder behind the other
  const rawAngleDeg = Math.atan2(dz, dx) * 57.29577951308232;

  // EMA smooth to avoid jitter
  const smoothed = VIEW_ANGLE_EMA * rawAngleDeg + (1 - VIEW_ANGLE_EMA) * prevSmoothed;

  // Determine which side faces the camera: the shoulder with smaller Z is closer.
  // In world coords, smaller Z = closer to camera.
  const leftZ = leftShoulder.z ?? 0;
  const rightZ = rightShoulder.z ?? 0;
  const closerSide: 'left' | 'right' | 'both' =
    Math.abs(leftZ - rightZ) < 0.02 ? 'both' : leftZ < rightZ ? 'left' : 'right';

  return classifyViewAngle(rawAngleDeg, smoothed, closerSide);
}

function classifyViewAngle(
  rawDeg: number,
  smoothedDeg: number,
  closerSide: 'left' | 'right' | 'both'
): ViewAngle {
  let zone: ViewZone;
  if (smoothedDeg < FRONTAL_MAX) {
    zone = 'frontal';
  } else if (smoothedDeg < OBLIQUE_MAX) {
    zone = 'oblique';
  } else {
    zone = 'side';
  }

  const primarySide = zone === 'frontal' ? 'both' : closerSide;

  return { angleDeg: rawDeg, smoothedAngleDeg: smoothedDeg, zone, primarySide };
}

// ============================================================================
// FRAME STABILITY CHECK
// ============================================================================

/** Check if the current frame has sufficient average visibility across key joints. */
function isFrameStable(keypoints: Keypoint[]): boolean {
  const names = [
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist',
    'left_hip', 'right_hip',
  ];
  let totalVis = 0;
  for (const name of names) {
    const kp = getKeypoint(keypoints, name);
    totalVis += kp?.score ?? 0;
  }
  return (totalVis / names.length) >= WARMUP_VISIBILITY_MIN;
}

// ============================================================================
// ANGLE CALCULATION
// ============================================================================

type Point3D = { x: number; y: number; z?: number };

function getPoint(kp: Keypoint | null): Point3D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y, z: kp.z };
}

/** Euclidean distance using only x, y (ignores z). */
function dist2D(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Euclidean distance using x, y, z for world landmarks. */
function dist3D(a: Point3D, b: Point3D): number {
  if (a.z === undefined || b.z === undefined) return NaN;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distanceForRatio(a: Point3D, b: Point3D, mode: RatioDistanceMode): number {
  return mode === 'world_3d' ? dist3D(a, b) : dist2D(a, b);
}

function getTorsoUpperAnchor(
  shoulderCenter: Point3D | null,
): { point: Point3D | null; source: TorsoAnchorSource } {
  if (shoulderCenter) {
    return { point: shoulderCenter, source: 'shoulder_center' };
  }

  return { point: null, source: 'unavailable' };
}

/**
 * Compute normalized arm reach ratio for one arm.
 * reach = dist(shoulder, wrist) / (dist(shoulder, elbow) + dist(elbow, wrist))
 *
 * ~0.95-1.0  = arm nearly straight (full extension)
 * ~0.70-0.85 = forearm foreshortened (pointing into depth axis)
 */
function computeArmReachRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right',
  ratioDistanceMode: RatioDistanceMode,
): number {
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const elbow = getKeypoint(keypoints, `${side}_elbow`);
  const wrist = getKeypoint(keypoints, `${side}_wrist`);

  if (
    !shoulder || !elbow || !wrist ||
    !isVisible(shoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(elbow, VISIBILITY_THRESHOLD) ||
    !isVisible(wrist, VISIBILITY_THRESHOLD)
  ) {
    return NaN;
  }

  const shoulderPoint = getPoint(shoulder)!;
  const elbowPoint = getPoint(elbow)!;
  const wristPoint = getPoint(wrist)!;
  const upperArm = distanceForRatio(shoulderPoint, elbowPoint, ratioDistanceMode);
  const forearm = distanceForRatio(elbowPoint, wristPoint, ratioDistanceMode);
  const reach = distanceForRatio(shoulderPoint, wristPoint, ratioDistanceMode);
  const segmentLength = upperArm + forearm;
  if (!Number.isFinite(segmentLength) || !Number.isFinite(reach) || segmentLength < 1e-6) return NaN;

  return reach / segmentLength;
}

/**
 * Compute elbow flare angle for one arm: angle of the upper arm from vertical in the
 * frontal (coronal) plane. 0° = elbow directly below shoulder; increases as elbow flares out.
 */
function computeElbowFlareDeg(keypoints: Keypoint[], side: 'left' | 'right'): number {
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);
  const elbow = getKeypoint(keypoints, `${side}_elbow`);

  if (
    !shoulder || !elbow ||
    !isVisible(shoulder, VISIBILITY_THRESHOLD) ||
    !isVisible(elbow, VISIBILITY_THRESHOLD)
  ) return NaN;

  const dx = Math.abs(elbow.x - shoulder.x);
  const dy = Math.abs(elbow.y - shoulder.y);
  if (dx < 1e-6 && dy < 1e-6) return 0;

  return Math.atan2(dx, dy) * 57.29577951308232;
}

function updateMinMax(window: RepWindow, key: keyof AngleSet, value: number): void {
  if (!Number.isFinite(value)) return;
  window.minAngles[key] = Math.min(window.minAngles[key], value);
  window.maxAngles[key] = Math.max(window.maxAngles[key], value);
}

function updateRepTempoSide(tempo: RepTempoSide, ratio: number, t: number): void {
  if (!Number.isFinite(ratio)) return;

  if (ratio < THRESHOLDS.EXTENDED_EXIT && tempo.curlStartAt === null) {
    tempo.curlStartAt = t;
  }

  if (ratio < tempo.minRatio) {
    tempo.minRatio = ratio;
    tempo.deepestAt = t;
  }
  tempo.maxRatio = Math.max(tempo.maxRatio, ratio);

  const reachedCurlTop = tempo.minRatio <= THRESHOLDS.FLEXED_EXIT;
  const isAfterDeepest = tempo.deepestAt !== null && t > tempo.deepestAt;
  if (
    reachedCurlTop &&
    isAfterDeepest &&
    tempo.loweringStartAt === null &&
    (ratio > tempo.minRatio + THRESHOLDS.FLEXED_EXIT_DELTA || ratio > THRESHOLDS.FLEXED_EXIT)
  ) {
    tempo.loweringStartAt = t;
  }

  if (
    tempo.loweringStartAt !== null &&
    tempo.extensionReturnAt === null &&
    ratio >= THRESHOLDS.EXTENDED_ENTER
  ) {
    tempo.extensionReturnAt = t;
  }

  if (tempo.loweringStartAt !== null) {
    tempo.returnMaxRatio = Math.max(tempo.returnMaxRatio, ratio);
  }
}

/**
 * Calculate all 8 joint angles from keypoints.
 * Uses existing calculation functions.
 */
function calculateJointAngles(
  keypoints: Keypoint[],
  ratioDistanceMode: RatioDistanceMode,
): JointAnglesResult | null {
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');
  const leftElbow = getKeypoint(keypoints, 'left_elbow');
  const rightElbow = getKeypoint(keypoints, 'right_elbow');
  const leftWrist = getKeypoint(keypoints, 'left_wrist');
  const rightWrist = getKeypoint(keypoints, 'right_wrist');
  const leftHip = getKeypoint(keypoints, 'left_hip');
  const rightHip = getKeypoint(keypoints, 'right_hip');

  const leftOk =
    leftShoulder &&
    leftElbow &&
    leftWrist &&
    leftHip &&
    isVisible(leftShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(leftElbow, VISIBILITY_THRESHOLD) &&
    isVisible(leftWrist, VISIBILITY_THRESHOLD) &&
    isVisible(leftHip, VISIBILITY_THRESHOLD);

  const rightOk =
    rightShoulder &&
    rightElbow &&
    rightWrist &&
    rightHip &&
    isVisible(rightShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(rightElbow, VISIBILITY_THRESHOLD) &&
    isVisible(rightWrist, VISIBILITY_THRESHOLD) &&
    isVisible(rightHip, VISIBILITY_THRESHOLD);

  if (!leftOk && !rightOk) return null;

  // Elbow angles (2D — reliable for FSM rep counting at all views)
  const leftElbowAngle = leftOk
    ? calculateAngle2D(getPoint(leftShoulder)!, getPoint(leftElbow)!, getPoint(leftWrist)!)
    : NaN;
  const rightElbowAngle = rightOk
    ? calculateAngle2D(getPoint(rightShoulder)!, getPoint(rightElbow)!, getPoint(rightWrist)!)
    : NaN;

  // Shoulder angles (flexion only) - project upper arm onto sagittal plane
  const leftShoulderAngle =
    leftOk && rightShoulder && isVisible(rightShoulder, VISIBILITY_THRESHOLD)
      ? calculateShoulderFlexionAngle(
          getPoint(leftHip)!,
          getPoint(leftShoulder)!,
          getPoint(leftElbow)!,
          getPoint(rightShoulder)!
        )
      : NaN;
  const rightShoulderAngle =
    rightOk && leftShoulder && isVisible(leftShoulder, VISIBILITY_THRESHOLD)
      ? calculateShoulderFlexionAngle(
          getPoint(rightHip)!,
          getPoint(rightShoulder)!,
          getPoint(rightElbow)!,
          getPoint(leftShoulder)!
        )
      : NaN;

  // Torso angles (hip-shoulder, signed: + = forward, - = back)
  const leftTorsoAngle = leftOk
    ? calculateSignedVerticalAngle(getPoint(leftHip)!, getPoint(leftShoulder)!)
    : NaN;
  const rightTorsoAngle = rightOk
    ? calculateSignedVerticalAngle(getPoint(rightHip)!, getPoint(rightShoulder)!)
    : NaN;

  // Midline torso angle: hip center -> head (nose or mid-ear). Projected onto sagittal plane.
  const hipCenter =
    leftHip && rightHip && isVisible(leftHip, VISIBILITY_THRESHOLD) && isVisible(rightHip, VISIBILITY_THRESHOLD)
      ? {
          x: (leftHip.x + rightHip.x) / 2,
          y: (leftHip.y + rightHip.y) / 2,
          z: ((leftHip.z ?? 0) + (rightHip.z ?? 0)) / 2,
        }
      : null;
  const shoulderCenter =
    leftShoulder &&
    rightShoulder &&
    isVisible(leftShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(rightShoulder, VISIBILITY_THRESHOLD)
      ? {
          x: (leftShoulder.x + rightShoulder.x) / 2,
          y: (leftShoulder.y + rightShoulder.y) / 2,
          z: ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0)) / 2,
        }
      : null;
  const torsoAngle =
    hipCenter && shoulderCenter && leftShoulder && rightShoulder
      ? (() => {
          const upperAnchor = getTorsoUpperAnchor(shoulderCenter);
          if (!upperAnchor.point) return NaN;
          const angle = calculateSignedVerticalAngleSagittal(
            hipCenter,
            upperAnchor.point,
            getPoint(leftHip)!,
            getPoint(rightHip)!,
            getPoint(leftShoulder)!,
            getPoint(rightShoulder)!
          );
          return Number.isNaN(angle) ? 0 : angle;
        })()
      : NaN;
  const torsoAnchorSource = getTorsoUpperAnchor(shoulderCenter).source;

  // Reach ratios — the primary camera-invariant metric for curl detection
  const leftRatio = leftOk
    ? computeArmReachRatio(keypoints, 'left', ratioDistanceMode)
    : NaN;
  const rightRatio = rightOk
    ? computeArmReachRatio(keypoints, 'right', ratioDistanceMode)
    : NaN;

  return {
    angles: {
      leftElbow: leftElbowAngle,
      rightElbow: rightElbowAngle,
      leftShoulder: leftShoulderAngle,
      rightShoulder: rightShoulderAngle,
      leftTorso: leftTorsoAngle,
      rightTorso: rightTorsoAngle,
      torso: torsoAngle,
      leftRatio,
      rightRatio,
    },
    torsoAnchorSource,
    ratioDistanceMode,
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
  rawAngles: AngleSet,
  history: BarbellCurlState['angleHistory'],
  prevSmoothed: SmoothedAngles | null
): { smoothed: SmoothedAngles; fast: SmoothedAngles } {
  const keys: (keyof AngleSet)[] = [
    'leftElbow',
    'rightElbow',
    'leftShoulder',
    'rightShoulder',
    'leftTorso',
    'rightTorso',
    'torso',
    'leftRatio',
    'rightRatio',
  ];

  const smoothedResult: Partial<SmoothedAngles> = {};
  const fastResult: Partial<SmoothedAngles> = {};

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
    // fast = median only: used for FSM transitions to avoid EMA lag at extremes
    fastResult[key] = medianValue;

    const prev = prevSmoothed?.[key];
    smoothedResult[key] =
      prev !== undefined && !isNaN(prev)
        ? EMA_ALPHA * medianValue + (1 - EMA_ALPHA) * prev
        : medianValue;
  }

  return {
    smoothed: smoothedResult as SmoothedAngles,
    fast: fastResult as SmoothedAngles,
  };
}

// ============================================================================
// FSM LOGIC
// ============================================================================

/**
 * Update arm FSM using reach ratio (camera-angle invariant).
 * Ratio: 1.0 = fully extended, ~0.4 = fully curled.
 * Transitions are inverted vs angle: low ratio = curled (was low angle), high ratio = extended.
 */
function updateArmFSM(arm: ArmFSM, reachRatio: number, t: number): ArmFSM {
  const newArm = { ...arm };

  switch (arm.state) {
    case 'REST':
      // Track whether the arm has returned to full extension since the last rep.
      // Prevents cascade false reps: a noise spike causes premature completion,
      // FSMs reset, and the arm (still curled at ~0.5) would immediately re-enter UP.
      if (reachRatio >= THRESHOLDS.EXTENDED_EXIT) {
        newArm.hasReachedExtension = true;
      }
      if (newArm.hasReachedExtension && reachRatio < THRESHOLDS.EXTENDED_EXIT) {
        newArm.state = 'UP';
        newArm.tRestEntry = null;
        newArm.tRestToUp = t;
        newArm.minRatio = reachRatio;
        newArm.maxRatio = reachRatio;
        newArm.hasReachedExtension = false;
        newArm.partialReturnedToRest = false;
      }
      break;

    case 'UP':
      newArm.minRatio = Math.min(newArm.minRatio, reachRatio);
      newArm.maxRatio = Math.max(newArm.maxRatio, reachRatio);
      if (reachRatio < THRESHOLDS.FLEXED_ENTER) {
        newArm.state = 'TOP';
        newArm.tUpToTop = t;
      } else if (reachRatio >= THRESHOLDS.EXTENDED_EXIT) {
        // Arm returned to near-full extension without curling deep enough — reset cleanly.
        // Mark as a returned partial so the rep window can decide whether this was
        // meaningful enough to count instead of silently discarding half reps.
        newArm.state = 'REST';
        newArm.hasReachedExtension = true;
        newArm.tRestEntry = t;
        newArm.tDownToRest = t;
        newArm.tUpToTop = null;
        newArm.partialReturnedToRest = true;
      }
      break;

    case 'TOP':
      newArm.minRatio = Math.min(newArm.minRatio, reachRatio);
      newArm.maxRatio = Math.max(newArm.maxRatio, reachRatio);
      if (
        reachRatio > THRESHOLDS.FLEXED_EXIT ||
        reachRatio > newArm.minRatio + THRESHOLDS.FLEXED_EXIT_DELTA
      ) {
        newArm.state = 'DOWN';
        newArm.tTopToDown = t;
      }
      break;

    case 'DOWN':
      newArm.minRatio = Math.min(newArm.minRatio, reachRatio);
      newArm.maxRatio = Math.max(newArm.maxRatio, reachRatio);
      if (
        reachRatio > THRESHOLDS.EXTENDED_ENTER &&
        newArm.tRestToUp !== null &&
        t - newArm.tRestToUp >= THRESHOLDS.MIN_REP_TIME &&
        // Require minimum dwell in DOWN before completing — filters noise spikes
        (newArm.tTopToDown === null || t - newArm.tTopToDown >= THRESHOLDS.MIN_DOWN_GUARD)
      ) {
        // Normal completion: full extension reached
        newArm.state = 'REST';
        newArm.tRestEntry = t;
        newArm.tDownToRest = t;
        newArm.partialReturnedToRest = false;
      } else if (
        reachRatio < THRESHOLDS.FLEXED_EXIT &&
        newArm.tRestToUp !== null &&
        t - newArm.tRestToUp >= THRESHOLDS.MIN_REP_TIME &&
        newArm.tTopToDown !== null && t - newArm.tTopToDown >= FORM_THRESHOLDS.TEMPO_DOWN_MIN
      ) {
        // Re-flexion escape: arm is curling again without full extension.
        // Force completion — rep will be counted and penalized for incomplete ROM.
        newArm.state = 'REST';
        newArm.tRestEntry = t;
        newArm.tDownToRest = t;
        newArm.partialReturnedToRest = false;
      }
      break;
  }

  return newArm;
}

// ============================================================================
// FORM EVALUATION
// ============================================================================

function evaluateForm(
  repWindow: RepWindow,
  leftArm: ArmFSM,
  rightArm: ArmFSM,
  viewAngle: ViewAngle,
  viewQuality: RepViewQualityDiagnostic,
  allowedCueFamilies?: ReadonlySet<string>,
): { score: number; messages: string[] } {
  const { minAngles, maxAngles, ratios } = repWindow;
  const messages: string[] = [];
  const isFrontal = viewAngle.zone === 'frontal';
  const frontFormEligible = isFrontal && viewQuality.frontishConfirmed === true;
  const primaryIsLeft = viewAngle.primarySide !== 'right';

  const leftRatioOk = isFinite(ratios.minLeftRatio) && isFinite(ratios.maxLeftRatio);
  const rightRatioOk = isFinite(ratios.minRightRatio) && isFinite(ratios.maxRightRatio);

  // Determine min/max ratios based on view
  let minRatio: number;
  if (isFrontal) {
    minRatio = Math.min(
      leftRatioOk ? ratios.minLeftRatio : Infinity,
      rightRatioOk ? ratios.minRightRatio : Infinity
    );
  } else {
    minRatio = primaryIsLeft
      ? (leftRatioOk ? ratios.minLeftRatio : Infinity)
      : (rightRatioOk ? ratios.minRightRatio : Infinity);
  }
  const returnMaxRatio = getReturnMaxCurlRatio(repWindow, viewAngle);

  const severeMessages: string[] = [];
  const warningMessages: string[] = [];
  const romMessages: string[] = [];
  const elbowMessages: string[] = [];
  const tempoAsymmetryMessages: string[] = [];

  // ROM metrics — ratio-based
  const romLRatio = leftRatioOk ? ratios.maxLeftRatio - ratios.minLeftRatio : 0;
  const romRRatio = rightRatioOk ? ratios.maxRightRatio - ratios.minRightRatio : 0;
  const primaryRomRatio = primaryIsLeft ? romLRatio : romRRatio;

  // 1. Severe shoulder involvement / severe torso swing
  // 2. Shoulder warning / torso warning
  const shoulderSummary = getShoulderDeltaSummary(repWindow, viewAngle);
  if (shoulderSummary.scoring !== null) {
    if (shoulderSummary.scoring > FORM_THRESHOLDS.SHOULDER_FAIL) {
      severeMessages.push('Too much shoulder involvement — reduce the weight.');
    } else if (shoulderSummary.scoring > FORM_THRESHOLDS.SHOULDER_WARN) {
      warningMessages.push('Upper arms moving — keep elbows pinned to your sides.');
    }
  }

  const deltaTorso = maxAngles.torso - minAngles.torso;
  if (isFinite(deltaTorso)) {
    if (deltaTorso > FORM_THRESHOLDS.TORSO_FAIL) {
      severeMessages.push('Excessive body swing — this is cheating the rep.');
    } else if (deltaTorso > FORM_THRESHOLDS.TORSO_WARN) {
      warningMessages.push("Don't swing your torso — stay upright and controlled.");
    }
  }

  // 3. ROM feedback
  if (isFinite(minRatio) && minRatio > FORM_THRESHOLDS.FLEX_RATIO_WARN) {
    romMessages.push('Flex more at the top of the curl.');
  }
  if (returnMaxRatio !== null && returnMaxRatio < FORM_THRESHOLDS.EXTEND_RATIO_WARN) {
    romMessages.push('Extend fully at the bottom.');
  }
  if (isFrontal) {
    if ((romLRatio < THRESHOLDS.ROM_MIN || romRRatio < THRESHOLDS.ROM_MIN) && romMessages.length === 0) {
      romMessages.push('Incomplete rep — curl all the way up and fully extend.');
    }
  } else {
    if (primaryRomRatio < THRESHOLDS.ROM_MIN && romMessages.length === 0) {
      romMessages.push('Incomplete rep — curl all the way up and fully extend.');
    }
  }

  // 4. Elbow flare (frontal only)
  if (frontFormEligible) {
    const flareSummary = getElbowFlareSummary(repWindow, true);
    if (flareSummary.sustainedFail) {
      elbowMessages.push("Keep your elbows in — don't flare them out to the sides.");
    } else if (flareSummary.sustainedWarn) {
      elbowMessages.push('Tuck your elbows in — they\'re drifting outward.');
    }
  }

  // 5. Tempo and asymmetry
  const { tUp, tDown } = getRepTempoDurations(repWindow, leftArm, rightArm, viewAngle);

  if (tUp <= getEffectiveTempoUpMin() && tUp > 0) {
    tempoAsymmetryMessages.push('Slow down — control the curl.');
  }
  if (tDown > 0 && tDown < FORM_THRESHOLDS.TEMPO_DOWN_MIN) {
    tempoAsymmetryMessages.push("Control the lowering — don't drop the weight.");
  }

  if (frontFormEligible && leftRatioOk && rightRatioOk) {
    const deltaMinRatio = Math.abs(ratios.minLeftRatio - ratios.minRightRatio);
    const deltaRomRatio = Math.abs(romLRatio - romRRatio);
    const syncDelta = repWindow.metadata.syncDelta;
    if (
      deltaMinRatio > FORM_THRESHOLDS.SYMMETRY_MIN_RATIO ||
      deltaRomRatio > FORM_THRESHOLDS.SYMMETRY_ROM_RATIO ||
      (syncDelta !== null && syncDelta > THRESHOLDS.SYNC_WINDOW)
    ) {
      tempoAsymmetryMessages.push('Arms are uneven — curl both sides together.');
    }
  }

  messages.push(
    ...severeMessages,
    ...warningMessages,
    ...romMessages,
    ...elbowMessages,
    ...tempoAsymmetryMessages,
  );

  // Score: continuous penalty curves
  const score = computeRepScore(repWindow, leftArm, rightArm, viewAngle, viewQuality, allowedCueFamilies);

  return { score, messages };
}

function reliabilityInterpretationForRepWindow(repWindow: RepWindow): {
  summary: PoseStateReliabilitySummary;
  interpretation: RepReliabilityInterpretation;
} | null {
  const summary = repWindow.reliability.snapshot();
  if (summary.totalFrames === 0) return null;
  return {
    summary,
    interpretation: interpretPoseStateReliabilitySummary('Barbell Curl', summary),
  };
}

function safeCueFamilySet(interpretation: RepReliabilityInterpretation | null): ReadonlySet<string> | undefined {
  return interpretation ? new Set(interpretation.safeCueFamilies) : undefined;
}

function suppressUnsafeReliabilityMessages(
  messages: string[],
  interpretation: RepReliabilityInterpretation | null,
): string[] {
  if (!interpretation) return messages;
  if (interpretation.scoreabilityCandidate === 'notScoreable') return [];

  const unsafeFamilies = new Set(interpretation.unsafeCueFamilies);
  return messages.filter((message) => {
    const family = BARBELL_CURL_MESSAGE_CUE_FAMILIES[message];
    return !family || !unsafeFamilies.has(family);
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
      const family = BARBELL_CURL_ISSUE_CUE_FAMILIES[issueId];
      if (family && unsafeFamilies.has(family)) {
        suppressedIssueIds.push(issueId);
        suppressedCueFamilies.add(family);
        return [issueId, {
          ...cue,
          eligible: false,
          triggered: false,
          skippedReason: `reliability_unsafe_${family}`,
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

function shouldLogBarbellCurlReliability(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    !(typeof process !== 'undefined' && process.env.JEST_WORKER_ID)
  );
}

function logBarbellCurlRepReliability(
  repIndex: number,
  interpretation: RepReliabilityInterpretation | null,
  diagnostics: FrameworkRepResult['diagnostics'],
): void {
  if (!interpretation || !shouldLogBarbellCurlReliability()) return;
  const reliability = diagnostics?.reliability;
  console.log([
    `[BarbellCurlReliability] rep=${repIndex}`,
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

function viewDiagnostic(viewAngle: ViewAngle): 'front' | 'side' | 'oblique' {
  if (viewAngle.zone === 'frontal') return 'front';
  return viewAngle.zone;
}

function maxElbowFlareSupport(repWindow: RepWindow): { sampleCount: number; support: number } {
  let sampleCount = 0;
  let support = 0;
  for (const side of SIDES) {
    const samples = repWindow.elbowFlare[side];
    sampleCount = Math.max(sampleCount, samples.confidentSamples);
    support = Math.max(
      support,
      sampleRatio(samples.warnSamples, samples.confidentSamples),
      sampleRatio(samples.failSamples, samples.confidentSamples),
    );
  }
  return { sampleCount, support };
}

function ratioSampleSupport(repWindow: RepWindow, side: CurlSide): number {
  return sampleRatio(repWindow.ratioSamples[side].validSamples, repWindow.viewSamples.total);
}

function dominantTorsoAnchorSource(repWindow: RepWindow): TorsoAnchorSource {
  let dominant: TorsoAnchorSource = 'unavailable';
  let dominantCount = -1;
  for (const source of Object.keys(repWindow.metadata.torsoAnchorSources) as TorsoAnchorSource[]) {
    const count = repWindow.metadata.torsoAnchorSources[source];
    if (count > dominantCount) {
      dominant = source;
      dominantCount = count;
    }
  }
  return dominant;
}

function buildBarbellCurlViewQuality(
  repWindow: RepWindow,
  viewAngle: ViewAngle,
): RepViewQualityDiagnostic {
  const total = repWindow.viewSamples.total;
  const frontSupport = sampleRatio(repWindow.viewSamples.bilateralValid, total);
  const frontZoneSupport = sampleRatio(repWindow.viewSamples.front, total);
  const selectedSide = viewAngle.primarySide === 'right' ? 'right' : 'left';
  const selectedSupport = ratioSampleSupport(repWindow, selectedSide);
  const sideSamples = repWindow.viewSamples.oblique + repWindow.viewSamples.side;
  const sideZoneSupport = sampleRatio(sideSamples, total);
  const selectedPrimarySamples = selectedSide === 'left'
    ? repWindow.viewSamples.primaryLeft
    : repWindow.viewSamples.primaryRight;
  const primarySideSupport = sampleRatio(selectedPrimarySamples, sideSamples);
  const frontishConfirmed =
    total >= VIEW_QUALITY_THRESHOLDS.MIN_SAMPLES &&
    viewAngle.zone === 'frontal' &&
    frontZoneSupport >= VIEW_QUALITY_THRESHOLDS.FRONT_MIN_SUPPORT &&
    frontSupport >= VIEW_QUALITY_THRESHOLDS.FRONT_MIN_SUPPORT;
  const sideConfirmed =
    total >= VIEW_QUALITY_THRESHOLDS.MIN_SAMPLES &&
    viewAngle.zone !== 'frontal' &&
    sideZoneSupport >= VIEW_QUALITY_THRESHOLDS.SIDE_MIN_SUPPORT &&
    selectedSupport >= VIEW_QUALITY_THRESHOLDS.SIDE_MIN_SUPPORT &&
    primarySideSupport >= VIEW_QUALITY_THRESHOLDS.PRIMARY_SIDE_MIN_SUPPORT;

  return {
    status: sideConfirmed ? 'side_confirmed' : frontishConfirmed ? 'frontish_confirmed' : 'view_unknown',
    sideConfirmed,
    frontishConfirmed,
    viewUnknown: !sideConfirmed && !frontishConfirmed,
    averageSideViewConfidence: viewAngle.zone === 'frontal'
      ? Math.min(frontZoneSupport, frontSupport)
      : Math.min(sideZoneSupport, selectedSupport),
    minSideViewConfidence: viewAngle.zone === 'frontal'
      ? Math.min(frontZoneSupport, frontSupport)
      : Math.min(sideZoneSupport, selectedSupport, primarySideSupport),
    sampleCount: total,
  };
}

function getBarbellCurlQualityWarnings(
  viewQuality: RepViewQualityDiagnostic,
  viewAngle: ViewAngle,
): FrameworkRepResult['qualityWarnings'] {
  if (!viewQuality.viewUnknown) return [];
  return viewAngle.zone === 'frontal' ? ['front_view_uncertain'] : ['side_view_uncertain'];
}

function buildBarbellCurlDiagnostics(
  repWindow: RepWindow,
  leftArm: ArmFSM,
  rightArm: ArmFSM,
  viewAngle: ViewAngle,
  repIndex: number,
  scorable: boolean,
  viewQuality: RepViewQualityDiagnostic,
): NonNullable<FrameworkRepResult['diagnostics']> {
  const { ratios, minAngles, maxAngles } = repWindow;
  const isFrontal = viewAngle.zone === 'frontal';
  const frontFormEligible = isFrontal && viewQuality.frontishConfirmed === true;
  const primaryIsLeft = viewAngle.primarySide !== 'right';
  const leftRatioOk = isFinite(ratios.minLeftRatio) && isFinite(ratios.maxLeftRatio);
  const rightRatioOk = isFinite(ratios.minRightRatio) && isFinite(ratios.maxRightRatio);
  const romLRatio = leftRatioOk ? ratios.maxLeftRatio - ratios.minLeftRatio : 0;
  const romRRatio = rightRatioOk ? ratios.maxRightRatio - ratios.minRightRatio : 0;
  const romRatio = getRepWindowRomRatio(repWindow, viewAngle);
  const rawLeftOk = Number.isFinite(repWindow.rawRatios.minLeftRatio) && Number.isFinite(repWindow.rawRatios.maxLeftRatio);
  const rawRightOk = Number.isFinite(repWindow.rawRatios.minRightRatio) && Number.isFinite(repWindow.rawRatios.maxRightRatio);
  const selectedSide = viewAngle.primarySide === 'right' ? 'right' : viewAngle.primarySide === 'left' ? 'left' : 'both';
  const primarySide = primarySideForView(viewAngle);
  const frontSupportRatio = sampleRatio(repWindow.viewSamples.bilateralValid, repWindow.viewSamples.total);
  const frontZoneSupportRatio = sampleRatio(repWindow.viewSamples.front, repWindow.viewSamples.total);
  const primarySideSupportRatio = ratioSampleSupport(repWindow, primarySide);
  const sideSamples = repWindow.viewSamples.oblique + repWindow.viewSamples.side;
  const sideZoneSupportRatio = sampleRatio(sideSamples, repWindow.viewSamples.total);
  const sideViewSupportRatio = viewAngle.zone === 'frontal'
    ? sampleRatio(repWindow.viewSamples.front, repWindow.viewSamples.total)
    : sampleRatio(viewAngle.primarySide === 'right' ? repWindow.viewSamples.primaryRight : repWindow.viewSamples.primaryLeft, sideSamples);
  const viewSupportRatio = isFrontal
    ? Math.min(frontZoneSupportRatio, frontSupportRatio)
    : Math.min(sideZoneSupportRatio, sideViewSupportRatio, primarySideSupportRatio);
  const minRatio = isFrontal
    ? Math.min(leftRatioOk ? ratios.minLeftRatio : Infinity, rightRatioOk ? ratios.minRightRatio : Infinity)
    : primaryIsLeft
      ? (leftRatioOk ? ratios.minLeftRatio : null)
      : (rightRatioOk ? ratios.minRightRatio : null);
  const maxRatio = isFrontal
    ? Math.max(leftRatioOk ? ratios.maxLeftRatio : -Infinity, rightRatioOk ? ratios.maxRightRatio : -Infinity)
    : primaryIsLeft
      ? (leftRatioOk ? ratios.maxLeftRatio : null)
      : (rightRatioOk ? ratios.maxRightRatio : null);
  const leftReturnMaxRatio = sideReturnMaxRatio(repWindow, 'left');
  const rightReturnMaxRatio = sideReturnMaxRatio(repWindow, 'right');
  const returnMaxRatio = getReturnMaxCurlRatio(repWindow, viewAngle);
  const flexTriggered = typeof minRatio === 'number' && isFinite(minRatio) && minRatio > FORM_THRESHOLDS.FLEX_RATIO_WARN;
  const extendTriggered = returnMaxRatio !== null && returnMaxRatio < FORM_THRESHOLDS.EXTEND_RATIO_WARN;
  const incompleteRomTriggered = isFrontal
    ? (romLRatio < THRESHOLDS.ROM_MIN || romRRatio < THRESHOLDS.ROM_MIN) && !flexTriggered && !extendTriggered
    : romRatio < THRESHOLDS.ROM_MIN && !flexTriggered && !extendTriggered;

  const shoulderSummary = getShoulderDeltaSummary(repWindow, viewAngle);
  const shoulderDelta = shoulderSummary.scoring;
  const torsoDelta = maxAngles.torso - minAngles.torso;
  const torsoAvailable = Number.isFinite(torsoDelta);
  const flareSummary = getElbowFlareSummary(repWindow, frontFormEligible);
  const flareSupport = maxElbowFlareSupport(repWindow);
  const { tUp, tDown } = getRepTempoDurations(repWindow, leftArm, rightArm, viewAngle);
  const asymmetryMinRatio = isFrontal && leftRatioOk && rightRatioOk
    ? Math.abs(ratios.minLeftRatio - ratios.minRightRatio)
    : null;
  const asymmetryRomRatio = isFrontal && leftRatioOk && rightRatioOk
    ? Math.abs(romLRatio - romRRatio)
    : null;
  const asymmetryRatio =
    asymmetryMinRatio !== null && asymmetryRomRatio !== null
      ? Math.max(asymmetryMinRatio, asymmetryRomRatio)
      : null;
  const asymmetryEligible =
    frontFormEligible &&
    leftRatioOk &&
    rightRatioOk &&
    sideParticipated(repWindow, 'left') &&
    sideParticipated(repWindow, 'right');
  const frontOnlySkippedReason = isFrontal && !viewQuality.frontishConfirmed
    ? 'front_view_unconfirmed'
    : isFrontal
      ? 'bilateral_participation_missing'
      : 'not_front_view';
  const asymmetryTriggered =
    asymmetryEligible &&
    ((asymmetryMinRatio ?? 0) > FORM_THRESHOLDS.SYMMETRY_MIN_RATIO ||
      (asymmetryRomRatio ?? 0) > FORM_THRESHOLDS.SYMMETRY_ROM_RATIO ||
      (repWindow.metadata.syncDelta !== null && repWindow.metadata.syncDelta > THRESHOLDS.SYNC_WINDOW));

  return buildRepDiagnostics({
    exerciseName: 'Barbell Curl',
    repIndex,
    view: viewDiagnostic(viewAngle),
    selectedSide,
    scorable,
    viewQuality,
    metrics: [
      diagnosticLabelMetric('landmarkSource', repWindow.metadata.landmarkSource, { sampleCount: repWindow.frameCount }),
      diagnosticLabelMetric('ratioDistanceMode', repWindow.metadata.ratioDistanceMode, { sampleCount: repWindow.frameCount }),
      diagnosticLabelMetric('torsoAnchorSource', dominantTorsoAnchorSource(repWindow), { sampleCount: repWindow.frameCount }),
      diagnosticMetric('viewAngleDeg', viewAngle.angleDeg, { unit: 'degrees', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('smoothedViewAngleDeg', viewAngle.smoothedAngleDeg, { unit: 'degrees', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('minCurlRatio', minRatio, { unit: 'ratio' }),
      diagnosticMetric('maxCurlRatio', maxRatio, { unit: 'ratio' }),
      diagnosticMetric('returnMaxCurlRatio', returnMaxRatio, { unit: 'ratio', eligible: returnMaxRatio !== null, skippedReason: 'return_extension_unavailable' }),
      diagnosticMetric('romRatio', romRatio, { unit: 'ratio' }),
      diagnosticMetric('leftRomRatio', romLRatio, { unit: 'ratio', eligible: leftRatioOk, skippedReason: 'left_arm_unavailable' }),
      diagnosticMetric('rightRomRatio', romRRatio, { unit: 'ratio', eligible: rightRatioOk, skippedReason: 'right_arm_unavailable' }),
      diagnosticMetric('leftReturnMaxCurlRatio', leftReturnMaxRatio, { unit: 'ratio', eligible: leftReturnMaxRatio !== null, skippedReason: 'left_return_extension_unavailable' }),
      diagnosticMetric('rightReturnMaxCurlRatio', rightReturnMaxRatio, { unit: 'ratio', eligible: rightReturnMaxRatio !== null, skippedReason: 'right_return_extension_unavailable' }),
      diagnosticMetric('rawLeftMinCurlRatio', rawLeftOk ? repWindow.rawRatios.minLeftRatio : null, { unit: 'ratio', eligible: rawLeftOk, skippedReason: 'left_raw_ratio_unavailable' }),
      diagnosticMetric('rawLeftMaxCurlRatio', rawLeftOk ? repWindow.rawRatios.maxLeftRatio : null, { unit: 'ratio', eligible: rawLeftOk, skippedReason: 'left_raw_ratio_unavailable' }),
      diagnosticMetric('rawRightMinCurlRatio', rawRightOk ? repWindow.rawRatios.minRightRatio : null, { unit: 'ratio', eligible: rawRightOk, skippedReason: 'right_raw_ratio_unavailable' }),
      diagnosticMetric('rawRightMaxCurlRatio', rawRightOk ? repWindow.rawRatios.maxRightRatio : null, { unit: 'ratio', eligible: rawRightOk, skippedReason: 'right_raw_ratio_unavailable' }),
      diagnosticMetric('leftValidSamples', repWindow.ratioSamples.left.validSamples, { unit: 'count', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('rightValidSamples', repWindow.ratioSamples.right.validSamples, { unit: 'count', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('leftDropoutSamples', repWindow.ratioSamples.left.dropoutSamples, { unit: 'count', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('rightDropoutSamples', repWindow.ratioSamples.right.dropoutSamples, { unit: 'count', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('viewSupportRatio', viewSupportRatio, { unit: 'ratio', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('frontViewSupportRatio', frontSupportRatio, { unit: 'ratio', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('frontZoneSupportRatio', frontZoneSupportRatio, { unit: 'ratio', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('sideViewSupportRatio', sideViewSupportRatio, { unit: 'ratio', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('sideZoneSupportRatio', sideZoneSupportRatio, { unit: 'ratio', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('primarySideSupportRatio', primarySideSupportRatio, { unit: 'ratio', sampleCount: repWindow.viewSamples.total }),
      diagnosticMetric('leftShoulderDelta', shoulderSummary.left, { unit: 'degrees', eligible: shoulderSummary.left !== null, skippedReason: 'left_shoulder_unavailable' }),
      diagnosticMetric('rightShoulderDelta', shoulderSummary.right, { unit: 'degrees', eligible: shoulderSummary.right !== null, skippedReason: 'right_shoulder_unavailable' }),
      diagnosticMetric('primaryShoulderDelta', shoulderSummary.primary, {
        unit: 'degrees',
        eligible: !isFrontal && shoulderSummary.primary !== null,
        skippedReason: isFrontal ? 'not_primary_side_view' : 'primary_shoulder_unavailable',
      }),
      diagnosticMetric('shoulderDelta', shoulderDelta, {
        unit: 'degrees',
        eligible: shoulderDelta !== null,
        skippedReason: shoulderSummary.skippedReason ?? 'shoulder_unavailable',
      }),
      diagnosticMetric('torsoDelta', torsoDelta, { unit: 'degrees', eligible: torsoAvailable, skippedReason: 'torso_unavailable' }),
      diagnosticMetric('elbowFlareMaxDeg', flareSummary.maxFlareDeg, {
        unit: 'degrees',
        eligible: frontFormEligible && flareSupport.sampleCount >= ELBOW_FLARE_MIN_CONFIDENT_SAMPLES,
        sampleCount: flareSupport.sampleCount,
        skippedReason: isFrontal && !viewQuality.frontishConfirmed
          ? 'front_view_unconfirmed'
          : isFrontal
            ? 'insufficient_elbow_flare_samples'
            : 'not_front_view',
      }),
      diagnosticMetric('elbowFlareSupportRatio', flareSupport.support, {
        unit: 'ratio',
        eligible: frontFormEligible && flareSupport.sampleCount >= ELBOW_FLARE_MIN_CONFIDENT_SAMPLES,
        sampleCount: flareSupport.sampleCount,
        skippedReason: isFrontal && !viewQuality.frontishConfirmed
          ? 'front_view_unconfirmed'
          : isFrontal
            ? 'insufficient_elbow_flare_samples'
            : 'not_front_view',
      }),
      diagnosticMetric('tUp', tUp, { unit: 'seconds', eligible: tUp > 0, skippedReason: 'curl_up_timestamp_unavailable' }),
      diagnosticMetric('tDown', tDown, { unit: 'seconds', eligible: tDown > 0, skippedReason: 'lowering_timestamp_unavailable' }),
      diagnosticMetric('asymmetryRatio', asymmetryRatio, { unit: 'ratio', eligible: asymmetryEligible && asymmetryRatio !== null, skippedReason: frontOnlySkippedReason }),
      diagnosticMetric('asymmetryMinRatio', asymmetryMinRatio, { unit: 'ratio', eligible: asymmetryEligible && asymmetryMinRatio !== null, skippedReason: frontOnlySkippedReason }),
      diagnosticMetric('asymmetryRomRatio', asymmetryRomRatio, { unit: 'ratio', eligible: asymmetryEligible && asymmetryRomRatio !== null, skippedReason: frontOnlySkippedReason }),
      diagnosticMetric('syncDelta', repWindow.metadata.syncDelta, { unit: 'seconds', eligible: asymmetryEligible && repWindow.metadata.syncDelta !== null, skippedReason: asymmetryEligible ? 'sync_completion_unavailable' : frontOnlySkippedReason }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'barbell-curl.incomplete_flex',
        metricKeys: ['minCurlRatio'],
        direction: 'above',
        value: minRatio,
        thresholdPath: 'formThresholds.FLEX_RATIO_WARN',
        thresholdValue: FORM_THRESHOLDS.FLEX_RATIO_WARN,
        triggered: flexTriggered,
      }),
      diagnosticCue({
        issueId: 'barbell-curl.incomplete_extend',
        metricKeys: ['returnMaxCurlRatio'],
        direction: 'below',
        value: returnMaxRatio,
        thresholdPath: 'formThresholds.EXTEND_RATIO_WARN',
        thresholdValue: FORM_THRESHOLDS.EXTEND_RATIO_WARN,
        eligible: returnMaxRatio !== null,
        triggered: extendTriggered,
        skippedReason: 'return_extension_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.incomplete_rom',
        metricKeys: ['romRatio'],
        direction: 'below',
        value: romRatio,
        thresholdPath: 'thresholds.ROM_MIN',
        thresholdValue: THRESHOLDS.ROM_MIN,
        triggered: incompleteRomTriggered,
      }),
      diagnosticCue({
        issueId: 'barbell-curl.shoulder_fail',
        metricKeys: ['shoulderDelta', 'primaryShoulderDelta'],
        direction: 'above',
        value: shoulderDelta,
        thresholdPath: 'formThresholds.SHOULDER_FAIL',
        thresholdValue: FORM_THRESHOLDS.SHOULDER_FAIL,
        eligible: shoulderDelta !== null,
        triggered: shoulderDelta !== null && shoulderDelta > FORM_THRESHOLDS.SHOULDER_FAIL,
        skippedReason: shoulderSummary.skippedReason ?? 'shoulder_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.shoulder_warn',
        metricKeys: ['shoulderDelta', 'primaryShoulderDelta'],
        direction: 'above',
        value: shoulderDelta,
        thresholdPath: 'formThresholds.SHOULDER_WARN',
        thresholdValue: FORM_THRESHOLDS.SHOULDER_WARN,
        eligible: shoulderDelta !== null,
        triggered:
          shoulderDelta !== null &&
          shoulderDelta > FORM_THRESHOLDS.SHOULDER_WARN &&
          shoulderDelta <= FORM_THRESHOLDS.SHOULDER_FAIL,
        skippedReason: shoulderSummary.skippedReason ?? 'shoulder_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.torso_fail',
        metricKeys: ['torsoDelta'],
        direction: 'above',
        value: torsoDelta,
        thresholdPath: 'formThresholds.TORSO_FAIL',
        thresholdValue: FORM_THRESHOLDS.TORSO_FAIL,
        eligible: torsoAvailable,
        triggered: torsoAvailable && torsoDelta > FORM_THRESHOLDS.TORSO_FAIL,
        skippedReason: 'torso_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.torso_warn',
        metricKeys: ['torsoDelta'],
        direction: 'above',
        value: torsoDelta,
        thresholdPath: 'formThresholds.TORSO_WARN',
        thresholdValue: FORM_THRESHOLDS.TORSO_WARN,
        eligible: torsoAvailable,
        triggered:
          torsoAvailable &&
          torsoDelta > FORM_THRESHOLDS.TORSO_WARN &&
          torsoDelta <= FORM_THRESHOLDS.TORSO_FAIL,
        skippedReason: 'torso_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.elbow_flare',
        metricKeys: ['elbowFlareMaxDeg', 'elbowFlareSupportRatio'],
        direction: 'above',
        value: flareSummary.maxFlareDeg,
        thresholdPath: 'formThresholds.ELBOW_FLARE_WARN',
        thresholdValue: FORM_THRESHOLDS.ELBOW_FLARE_WARN,
        eligible: frontFormEligible && flareSupport.sampleCount >= ELBOW_FLARE_MIN_CONFIDENT_SAMPLES,
        support: flareSupport.support,
        triggered: frontFormEligible && (flareSummary.sustainedWarn || flareSummary.sustainedFail),
        skippedReason: isFrontal && !viewQuality.frontishConfirmed
          ? 'front_view_unconfirmed'
          : isFrontal
            ? 'insufficient_elbow_flare_samples'
            : 'not_front_view',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.tempo_up',
        metricKeys: ['tUp'],
        direction: 'below',
        value: tUp,
        thresholdPath: 'formThresholds.TEMPO_UP_MIN',
        thresholdValue: getEffectiveTempoUpMin(),
        eligible: tUp > 0,
        triggered: tUp > 0 && tUp <= getEffectiveTempoUpMin(),
        skippedReason: 'curl_up_timestamp_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.tempo_down',
        metricKeys: ['tDown'],
        direction: 'below',
        value: tDown,
        thresholdPath: 'formThresholds.TEMPO_DOWN_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_DOWN_MIN,
        eligible: tDown > 0,
        triggered: tDown > 0 && tDown < FORM_THRESHOLDS.TEMPO_DOWN_MIN,
        skippedReason: 'lowering_timestamp_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.asymmetry',
        metricKeys: ['asymmetryMinRatio', 'asymmetryRomRatio', 'syncDelta'],
        direction: 'above',
        value: asymmetryRatio,
        thresholdPath: [
          'formThresholds.SYMMETRY_MIN_RATIO',
          'formThresholds.SYMMETRY_ROM_RATIO',
          'thresholds.SYNC_WINDOW',
        ],
        thresholdValue: {
          minRatio: FORM_THRESHOLDS.SYMMETRY_MIN_RATIO,
          romRatio: FORM_THRESHOLDS.SYMMETRY_ROM_RATIO,
          syncDelta: THRESHOLDS.SYNC_WINDOW,
        },
        eligible: asymmetryEligible && asymmetryRatio !== null,
        triggered: asymmetryTriggered,
        skippedReason: frontOnlySkippedReason,
      }),
    ],
  });
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateBarbellCurlState(
  keypoints: Keypoint[],
  currentState: BarbellCurlState,
  frameContext?: ExerciseFrameContext,
): BarbellCurlState {
  const timestampMs = typeof frameContext?.timestampMs === 'number' && Number.isFinite(frameContext.timestampMs)
    ? frameContext.timestampMs
    : Date.now();
  const t = timestampMs / 1000; // seconds
  const mechanicsKeypoints = frameContext?.worldKeypoints?.length
    ? frameContext.worldKeypoints
    : frameContext?.imageKeypoints?.length
      ? frameContext.imageKeypoints
      : keypoints;
  const landmarkSource: LandmarkSource = frameContext?.worldKeypoints?.length ? 'world' : 'image';
  const ratioDistanceMode: RatioDistanceMode = landmarkSource === 'world' ? 'world_3d' : 'image_2d';

  // Estimate view angle
  const viewAngle = frameContext?.trackingInterrupted
    ? estimateViewAngle(mechanicsKeypoints, 0)
    : estimateViewAngle(mechanicsKeypoints, currentState.viewAngle.smoothedAngleDeg);

  if (frameContext?.trackingInterrupted) {
    return resetBarbellCurlAfterTrackingInterruption(currentState, viewAngle);
  }

  // Calculate raw angles
  const rawResult = calculateJointAngles(mechanicsKeypoints, ratioDistanceMode);
  if (!rawResult) {
    return { ...currentState, displayAngles: null, viewAngle };
  }
  const rawAngles = rawResult.angles;

  // Apply smoothing — returns fast (median-only) and smoothed (median+EMA)
  const { smoothed, fast } = applySmoothing(rawAngles, currentState.angleHistory, currentState.smoothed);

  // Warm-up gate: require consecutive stable frames before enabling FSM
  const frameStable = isFrameStable(mechanicsKeypoints);
  let warmupFrames = currentState.warmupFrames;
  if (frameStable) {
    warmupFrames = Math.min(warmupFrames + 1, WARMUP_REQUIRED + 1);
  } else {
    warmupFrames = Math.max(0, warmupFrames - 2); // decay faster than accumulate
  }

  // Update display angles (use smoothed for stable UI)
  const newState: BarbellCurlState = {
    ...currentState,
    smoothed,
    fast,
    displayAngles: smoothed,
    viewAngle,
    warmupFrames,
  };

  // Skip FSM until skeleton is stable
  if (warmupFrames < WARMUP_REQUIRED) {
    return newState;
  }

  // Use fast (median-only) ratios for FSM: avoids EMA lag that prevents reaching extremes
  const leftValid = Number.isFinite(rawAngles.leftRatio) && Number.isFinite(fast.leftRatio);
  const rightValid = Number.isFinite(rawAngles.rightRatio) && Number.isFinite(fast.rightRatio);

  // If neither arm is valid and no rep is active, bail. During an active rep,
  // keep the window alive so dropout samples are visible in diagnostics, but
  // do not advance the FSM from held/smoothed values.
  if (!leftValid && !rightValid && !currentState.repWindow) {
    return newState;
  }

  // Update per-arm FSMs using fast (median-only) reach ratios
  const prevLeftState = currentState.leftArm.state;
  const prevRightState = currentState.rightArm.state;
  if (leftValid) {
    newState.leftArm = updateArmFSM(currentState.leftArm, fast.leftRatio, t);
  }
  if (rightValid) {
    newState.rightArm = updateArmFSM(currentState.rightArm, fast.rightRatio, t);
  }

  // Track rep window (accumulate data while any active arm is not in REST)
  const leftInRep = leftValid && newState.leftArm.state !== 'REST';
  const rightInRep = rightValid && newState.rightArm.state !== 'REST';
  const inRep = leftInRep || rightInRep;
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(t);
  }

  // Include the transition frame (DOWN→REST): the angle that triggered completion
  // must be recorded so evaluateForm sees the actual peak extension, not the prior frame.
  const leftWasInRep = currentState.leftArm.state !== 'REST';
  const rightWasInRep = currentState.rightArm.state !== 'REST';
  const shouldAccumulate = inRep || leftWasInRep || rightWasInRep;

  if (newState.repWindow && shouldAccumulate) {
    const window = newState.repWindow;
    window.metadata.landmarkSource = landmarkSource;
    window.metadata.ratioDistanceMode = rawResult.ratioDistanceMode;
    window.metadata.torsoAnchorSources[rawResult.torsoAnchorSource]++;
    window.tEnd = t;
    window.frameCount++;
    if (frameContext?.poseState) {
      window.reliability.observe(frameContext.poseState);
    }
    window.viewSamples.total++;
    if (viewAngle.zone === 'frontal') window.viewSamples.front++;
    else if (viewAngle.zone === 'oblique') window.viewSamples.oblique++;
    else window.viewSamples.side++;
    if (viewAngle.primarySide === 'left') window.viewSamples.primaryLeft++;
    if (viewAngle.primarySide === 'right') window.viewSamples.primaryRight++;
    if (leftValid && rightValid) window.viewSamples.bilateralValid++;

    // Update min/max only when the current frame has a valid source chain.
    for (const key of [
      'leftElbow', 'rightElbow',
      'leftShoulder', 'rightShoulder',
      'leftTorso', 'rightTorso',
      'torso',
    ] as const) {
      if (Number.isFinite(rawAngles[key])) {
        updateMinMax(window, key, smoothed[key]);
      }
    }

    // Track reach ratios using current-frame-valid fast values to capture true depth/lockout.
    if (Number.isFinite(rawAngles.leftRatio) && Number.isFinite(fast.leftRatio)) {
      window.ratioSamples.left.validSamples++;
      updateMinMax(window, 'leftRatio', fast.leftRatio);
      window.ratios.minLeftRatio = Math.min(window.ratios.minLeftRatio, fast.leftRatio);
      window.ratios.maxLeftRatio = Math.max(window.ratios.maxLeftRatio, fast.leftRatio);
      window.rawRatios.minLeftRatio = Math.min(window.rawRatios.minLeftRatio, rawAngles.leftRatio);
      window.rawRatios.maxLeftRatio = Math.max(window.rawRatios.maxLeftRatio, rawAngles.leftRatio);
      updateRepTempoSide(window.tempo.left, fast.leftRatio, t);
    } else {
      window.ratioSamples.left.dropoutSamples++;
    }
    if (Number.isFinite(rawAngles.rightRatio) && Number.isFinite(fast.rightRatio)) {
      window.ratioSamples.right.validSamples++;
      updateMinMax(window, 'rightRatio', fast.rightRatio);
      window.ratios.minRightRatio = Math.min(window.ratios.minRightRatio, fast.rightRatio);
      window.ratios.maxRightRatio = Math.max(window.ratios.maxRightRatio, fast.rightRatio);
      window.rawRatios.minRightRatio = Math.min(window.rawRatios.minRightRatio, rawAngles.rightRatio);
      window.rawRatios.maxRightRatio = Math.max(window.rawRatios.maxRightRatio, rawAngles.rightRatio);
      updateRepTempoSide(window.tempo.right, fast.rightRatio, t);
    } else {
      window.ratioSamples.right.dropoutSamples++;
    }

    // Track elbow flare (frontal only — lateral deviation is visible facing the camera)
    if (viewAngle.zone === 'frontal') {
      for (const side of SIDES) {
        const flare = computeElbowFlareDeg(mechanicsKeypoints, side);
        if (Number.isFinite(flare)) {
          const samples = window.elbowFlare[side];
          samples.confidentSamples++;
          samples.maxFlareDeg = Math.max(samples.maxFlareDeg, flare);
          if (flare > FORM_THRESHOLDS.ELBOW_FLARE_WARN) samples.warnSamples++;
          if (flare > FORM_THRESHOLDS.ELBOW_FLARE_FAIL) samples.failSamples++;
        }
      }
    }
  }

  // Rep completion logic
  if (viewAngle.zone === 'frontal') {
    // FRONTAL MODE: require both arms to participate. Desync is counted and
    // diagnosed as asymmetry instead of silently dropping the rep.
    const bothInRest = newState.leftArm.state === 'REST' && newState.rightArm.state === 'REST';
    const leftJustFinished = prevLeftState === 'DOWN' && newState.leftArm.state === 'REST';
    const rightJustFinished = prevRightState === 'DOWN' && newState.rightArm.state === 'REST';
    const leftPartialFinished = prevLeftState === 'UP' && newState.leftArm.partialReturnedToRest;
    const rightPartialFinished = prevRightState === 'UP' && newState.rightArm.partialReturnedToRest;

    if (bothInRest && (leftJustFinished || rightJustFinished || leftPartialFinished || rightPartialFinished) && newState.repWindow) {
      const leftParticipated = sideParticipated(newState.repWindow, 'left');
      const rightParticipated = sideParticipated(newState.repWindow, 'right');
      const leftEndTime = newState.leftArm.tDownToRest;
      const rightEndTime = newState.rightArm.tDownToRest;

      if (leftParticipated && rightParticipated && leftEndTime !== null && rightEndTime !== null) {
        newState.repWindow.metadata.syncDelta = Math.abs(leftEndTime - rightEndTime);
        if (leftPartialFinished || rightPartialFinished) {
          completePartialRepIfMeaningful(newState, t, viewAngle);
        } else {
          completeRep(newState, t, viewAngle);
        }
      } else {
        // Single-arm movement in a front-view barbell curl is not a clean bilateral rep.
        resetBarbellCurlRepTracking(newState);
      }
    }
  } else {
    // OBLIQUE/SIDE MODE: count from the selected visible primary arm only.
    const primaryArm = getPrimaryArm(viewAngle, leftValid, rightValid);
    const armState = primaryArm === 'left' ? newState.leftArm : newState.rightArm;
    const prevArmState = primaryArm === 'left' ? prevLeftState : prevRightState;
    const primaryParticipated = newState.repWindow ? sideParticipated(newState.repWindow, primaryArm) : false;

    const justFinished = prevArmState === 'DOWN' && armState.state === 'REST';
    const partialFinished = prevArmState === 'UP' && armState.partialReturnedToRest;

    if (justFinished && newState.repWindow && primaryParticipated) {
      completeRep(newState, t, viewAngle);
    } else if (partialFinished && newState.repWindow && primaryParticipated) {
      completePartialRepIfMeaningful(newState, t, viewAngle);
    } else if ((justFinished || partialFinished) && newState.repWindow) {
      resetBarbellCurlRepTracking(newState);
    }
  }

  // Clear feedback after duration
  if (newState.feedback && t - newState.lastFeedbackTime > 2.0) {
    newState.feedback = null;
  }

  return newState;
}

/** Determine which arm to use as primary for rep counting in non-frontal modes. */
function getPrimaryArm(
  viewAngle: ViewAngle,
  leftValid: boolean,
  rightValid: boolean
): 'left' | 'right' {
  if (leftValid && !rightValid) return 'left';
  if (rightValid && !leftValid) return 'right';
  if (viewAngle.primarySide === 'left') return 'left';
  if (viewAngle.primarySide === 'right') return 'right';
  return 'left';
}

function getRepWindowRomRatio(repWindow: RepWindow, viewAngle: ViewAngle): number {
  const leftOk = isFinite(repWindow.ratios.minLeftRatio) && isFinite(repWindow.ratios.maxLeftRatio);
  const rightOk = isFinite(repWindow.ratios.minRightRatio) && isFinite(repWindow.ratios.maxRightRatio);
  const leftRom = leftOk ? repWindow.ratios.maxLeftRatio - repWindow.ratios.minLeftRatio : 0;
  const rightRom = rightOk ? repWindow.ratios.maxRightRatio - repWindow.ratios.minRightRatio : 0;

  if (viewAngle.zone === 'frontal') {
    return leftOk && rightOk ? Math.min(leftRom, rightRom) : Math.max(leftRom, rightRom);
  }
  return viewAngle.primarySide === 'right' ? rightRom : leftRom;
}

function resetBarbellCurlRepTracking(newState: BarbellCurlState): void {
  newState.repWindow = null;
  newState.leftArm = initArmFSM();
  newState.rightArm = initArmFSM();
}

function resetBarbellCurlAfterTrackingInterruption(
  currentState: BarbellCurlState,
  viewAngle: ViewAngle,
): BarbellCurlState {
  return {
    ...currentState,
    repWindow: null,
    leftArm: initArmFSM(),
    rightArm: initArmFSM(),
    angleHistory: initAngleHistory(),
    smoothed: null,
    fast: null,
    displayAngles: null,
    viewAngle,
    warmupFrames: 0,
  };
}

function completePartialRepIfMeaningful(
  newState: BarbellCurlState,
  t: number,
  viewAngle: ViewAngle
): void {
  const window = newState.repWindow;
  if (!window) return;

  const actualRom = getRepWindowRomRatio(window, viewAngle);
  const duration = window.tEnd - window.tStart;

  if (isMeaningfulPartialRep({
    actualRom,
    minRom: THRESHOLDS.MIN_PARTIAL_ROM,
    duration,
    minDuration: THRESHOLDS.MIN_REP_TIME,
  })) {
    completeRep(newState, t, viewAngle);
    return;
  }

  newState.feedback = LOW_ROM_FEEDBACK;
  newState.lastFeedbackTime = t;
  resetBarbellCurlRepTracking(newState);
}

/** Complete a rep: evaluate form, update state, reset FSMs. */
function completeRep(
  newState: BarbellCurlState,
  t: number,
  viewAngle: ViewAngle
): void {
  const repWindow = newState.repWindow;
  if (!repWindow) return;

  repWindow.metadata.completionView = viewAngle;
  repWindow.metadata.selectedSideAtCompletion = viewAngle.primarySide;
  const viewQuality = buildBarbellCurlViewQuality(repWindow, viewAngle);
  const scorable = !viewQuality.viewUnknown;
  const qualityWarnings = getBarbellCurlQualityWarnings(viewQuality, viewAngle);
  const reliability = reliabilityInterpretationForRepWindow(repWindow);
  const reliabilityInterpretation = reliability?.interpretation ?? null;
  const allowedCueFamilies = safeCueFamilySet(reliabilityInterpretation);
  const reliabilityAllowsScoring = reliabilityInterpretation?.scoreabilityCandidate !== 'notScoreable';
  const finalScorable = scorable && reliabilityAllowsScoring;

  newState.repCount++;

  const romLRatio = sideRomRatio(repWindow, 'left');
  const romRRatio = sideRomRatio(repWindow, 'right');

  const { tUp, tDown } = getRepTempoDurations(
    repWindow,
    newState.leftArm,
    newState.rightArm,
    viewAngle,
  );

  const { score, messages } = evaluateForm(
    repWindow,
    newState.leftArm,
    newState.rightArm,
    viewAngle,
    viewQuality,
    allowedCueFamilies,
  );
  const finalMessages = suppressUnsafeReliabilityMessages(messages, reliabilityInterpretation);
  const diagnostics = applyReliabilityCueGating(
    buildBarbellCurlDiagnostics(
      repWindow,
      newState.leftArm,
      newState.rightArm,
      viewAngle,
      newState.repCount,
      finalScorable,
      viewQuality,
    ),
    reliabilityInterpretation,
    finalScorable,
  );
  const finalScore = finalScorable ? score : 0;

  newState.lastRepResult = {
    repIndex: newState.repCount,
    romLRatio,
    romRRatio,
    tUp,
    tDown,
    score: finalScore,
    messages: finalMessages,
    scorable: finalScorable,
    qualityWarnings,
    diagnostics,
  };

  logBarbellCurlRepReliability(newState.repCount, reliabilityInterpretation, diagnostics);

  if (!finalScorable) {
    newState.feedback = 'Form view unclear.';
  } else if (finalMessages.length > 0) {
    newState.feedback = finalMessages.join('\n');
  } else {
    newState.feedback = viewAngle.zone === 'frontal' ? 'Great rep!' : 'Good rep.';
  }
  newState.lastFeedbackTime = t;

  resetBarbellCurlRepTracking(newState);
}

// ============================================================================
// DEBUG HELPERS (module-private — exposed via debugInfo in ExerciseState)
// ============================================================================

const _formatAngle = (v: number) =>
  typeof v === 'number' && !isNaN(v) && isFinite(v) ? v : null;
const _safeDelta = (min: number, max: number) =>
  _formatAngle(min !== Infinity && max !== -Infinity ? max - min : NaN);

function getBarbellCurlDebugInfo(state: BarbellCurlState): {
  leftArmState: string;
  rightArmState: string;
  view: ViewAngle;
  warmupFrames: number;
  current: {
    leftElbow: number | null;
    rightElbow: number | null;
    leftRatio: number | null;
    rightRatio: number | null;
    fastLeftRatio: number | null;
    fastRightRatio: number | null;
    leftShoulder: number | null;
    rightShoulder: number | null;
    torso: number | null;
  };
  repRatios: {
    minLeft: number | null;
    maxLeft: number | null;
    minRight: number | null;
    maxRight: number | null;
    romLeft: number | null;
    romRight: number | null;
  } | null;
  repDelta: {
    leftElbow: number | null;
    rightElbow: number | null;
    leftShoulder: number | null;
    rightShoulder: number | null;
    torso: number | null;
  } | null;
} {
  const angles = state.displayAngles;
  const window = state.repWindow;
  const current = {
    leftElbow: _formatAngle(angles?.leftElbow ?? NaN),
    rightElbow: _formatAngle(angles?.rightElbow ?? NaN),
    leftRatio: _formatAngle(angles?.leftRatio ?? NaN),
    rightRatio: _formatAngle(angles?.rightRatio ?? NaN),
    fastLeftRatio: _formatAngle(state.fast?.leftRatio ?? NaN),
    fastRightRatio: _formatAngle(state.fast?.rightRatio ?? NaN),
    leftShoulder: _formatAngle(angles?.leftShoulder ?? NaN),
    rightShoulder: _formatAngle(angles?.rightShoulder ?? NaN),
    torso: _formatAngle(angles?.torso ?? NaN),
  };
  const repRatios = window
    ? {
        minLeft: _formatAngle(window.ratios.minLeftRatio),
        maxLeft: _formatAngle(window.ratios.maxLeftRatio),
        minRight: _formatAngle(window.ratios.minRightRatio),
        maxRight: _formatAngle(window.ratios.maxRightRatio),
        romLeft: isFinite(window.ratios.maxLeftRatio) && isFinite(window.ratios.minLeftRatio)
          ? _formatAngle(window.ratios.maxLeftRatio - window.ratios.minLeftRatio) : null,
        romRight: isFinite(window.ratios.maxRightRatio) && isFinite(window.ratios.minRightRatio)
          ? _formatAngle(window.ratios.maxRightRatio - window.ratios.minRightRatio) : null,
      }
    : null;
  const repDelta = window
    ? {
        leftElbow: _safeDelta(window.minAngles.leftElbow, window.maxAngles.leftElbow),
        rightElbow: _safeDelta(window.minAngles.rightElbow, window.maxAngles.rightElbow),
        leftShoulder: _safeDelta(window.minAngles.leftShoulder, window.maxAngles.leftShoulder),
        rightShoulder: _safeDelta(window.minAngles.rightShoulder, window.maxAngles.rightShoulder),
        torso: _safeDelta(window.minAngles.torso, window.maxAngles.torso),
      }
    : null;
  return {
    leftArmState: state.leftArm.state,
    rightArmState: state.rightArm.state,
    view: state.viewAngle,
    warmupFrames: state.warmupFrames,
    current,
    repRatios,
    repDelta,
  };
}

// ============================================================================
// EXERCISE DEFINITION — the only export
// ============================================================================

export function createBarbellCurlDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_BARBELL_CURL_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Barbell Curl',
  requiredView: 'front',
  qualityProfile: BARBELL_CURL_QUALITY_PROFILE,

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    repQualityWindowActive: false,
    liveQualityWarnings: [],
    _internal: withBarbellCurlConfig(config, () => initializeBarbellCurlState()),
  }),

  update: (keypoints, state, frameContext) => {
    const internal = state._internal as BarbellCurlState;
    const newInternal = withBarbellCurlConfig(
      config,
      () => updateBarbellCurlState(keypoints, internal, frameContext),
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
      ? getBarbellCurlQualityWarnings(
          buildBarbellCurlViewQuality(newInternal.repWindow, newInternal.viewAngle),
          newInternal.viewAngle,
        )
      : completedNewRep
        ? (lastRepResult?.qualityWarnings ?? [])
        : [];

    return {
      repCount: newInternal.repCount,
      lastRepResult,
      feedback: newInternal.feedback,
      feedbackTimestamp: newInternal.lastFeedbackTime > 0 ? newInternal.lastFeedbackTime : null,
      debugInfo: getBarbellCurlDebugInfo(newInternal) as Record<string, unknown>,
      repQualityWindowActive: newInternal.repWindow !== null,
      liveQualityWarnings,
      _internal: newInternal,
    };
  },

  heuristicConfig: config,
  validateHeuristicConfig: validateBarbellCurlHeuristicConfig,
  tunableSpec: BARBELL_CURL_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/barbellCurl.json',
  createVariant: (variantConfig) =>
    createBarbellCurlDefinition(mergeHeuristicConfig(config, variantConfig)),

  ttsConfig: {
    feedbackToIssue: {
      'Flex more at the top of the curl.': 'incomplete_flex',
      'Extend fully at the bottom.': 'incomplete_extend',
      'Incomplete rep — curl all the way up and fully extend.': 'incomplete_rom',
      'Too much shoulder involvement — reduce the weight.': 'shoulder_fail',
      'Upper arms moving — keep elbows pinned to your sides.': 'shoulder_warn',
      'Excessive body swing — this is cheating the rep.': 'torso_fail',
      "Don't swing your torso — stay upright and controlled.": 'torso_warn',
      'Slow down — control the curl.': 'tempo_up',
      "Control the lowering — don't drop the weight.": 'tempo_down',
      'Arms are uneven — curl both sides together.': 'asymmetry',
      "Keep your elbows in — don't flare them out to the sides.": 'elbow_flare',
      "Tuck your elbows in — they're drifting outward.": 'elbow_flare',
    },
    feedbackPriorities: {
      'Too much shoulder involvement — reduce the weight.': 60,
      'Excessive body swing — this is cheating the rep.': 60,
      'Upper arms moving — keep elbows pinned to your sides.': 50,
      "Don't swing your torso — stay upright and controlled.": 50,
      'Flex more at the top of the curl.': 40,
      'Extend fully at the bottom.': 40,
      'Incomplete rep — curl all the way up and fully extend.': 40,
      "Keep your elbows in — don't flare them out to the sides.": 30,
      "Tuck your elbows in — they're drifting outward.": 30,
      'Slow down — control the curl.': 20,
      "Control the lowering — don't drop the weight.": 20,
      'Arms are uneven — curl both sides together.': 20,
    },
    issueDefinitions: [
      {
        issueType: 'elbow_flare',
        priority: 30,
        messages: [
          'Keep your elbows tucked.',
          'Elbows in. Keep the curl strict.',
          'Keep your elbows from flaring.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Flex more at the top of the curl.': 'Full ROM at top — contract the bicep fully before lowering.',
    'Extend fully at the bottom.': 'Extend arms completely at the bottom for a full stretch.',
    'Incomplete rep — curl all the way up and fully extend.': 'Achieve complete range of motion in both directions.',
    'Too much shoulder involvement — reduce the weight.': 'Reduce weight and focus on isolating the bicep.',
    'Upper arms moving — keep elbows pinned to your sides.': 'Minimize elbow drift — keep elbows close to your body.',
    'Excessive body swing — this is cheating the rep.': 'Reduce torso momentum — use strict, controlled form.',
    "Don't swing your torso — stay upright and controlled.": 'Brace your core and keep torso stationary throughout.',
    'Slow down — control the curl.': 'Slow the concentric phase — aim for 1-2 seconds up.',
    "Control the lowering — don't drop the weight.": 'Slow the eccentric phase — 2-3 seconds down.',
    'Arms are uneven — curl both sides together.': 'Focus on symmetry — curl both arms at the same speed.',
    "Keep your elbows in — don't flare them out to the sides.": 'Keep elbows pinned to your sides — flaring reduces bicep isolation.',
    "Tuck your elbows in — they're drifting outward.": 'Focus on keeping elbows close to your body throughout the curl.',
  },
  };
}

export const barbellCurlDefinition: ExerciseDefinition = createBarbellCurlDefinition();
