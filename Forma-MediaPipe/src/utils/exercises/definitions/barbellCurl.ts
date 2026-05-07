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
  mergeHeuristicConfig,
  runWithConfigBindings,
} from '../heuristicConfig';
import { LOW_ROM_FEEDBACK, isMeaningfulPartialRep } from '../shared/partialReps';
import {
  buildRepDiagnostics,
  diagnosticCue,
  diagnosticMetric,
} from '../shared/diagnostics';
import tunedConfig from './tuned/barbellCurl.json';
import type {
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  ExerciseState,
  RepResult as FrameworkRepResult,
} from '../types';

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
  WRIST_NEUTRAL: 180, // straight wrist reference
  WRIST_DEV_WARN: 25,
  WRIST_DEV_DURATION: 0.5, // 50% of rep
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

/** Smoothing parameters */
const MEDIAN_WINDOW = 4;
const EMA_ALPHA = 0.4;
const VISIBILITY_THRESHOLD = 0.15;
const TEMPO_UP_MIN_SAFETY_FLOOR = 0.15;
const ELBOW_FLARE_MIN_CONFIDENT_SAMPLES = 4;
const ELBOW_FLARE_WARN_SAMPLE_RATIO = 0.25;
const ELBOW_FLARE_FAIL_SAMPLE_RATIO = 0.2;
const WRIST_MIN_CONFIDENT_SAMPLES = 4;

/** Warm-up: require N consecutive stable frames before enabling FSM */
const WARMUP_REQUIRED = 12;          // ~0.6s at 20fps
const WARMUP_VISIBILITY_MIN = 0.3;   // avg visibility of 8 key joints must exceed this

const DEFAULT_BARBELL_CURL_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_BARBELL_CURL_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_BARBELL_CURL_HEURISTIC_CONFIG,
  tunedConfig,
);

const BARBELL_CURL_TUNABLE_SPEC = createDefaultTunableSpec(
  'Barbell Curl',
  DEFAULT_BARBELL_CURL_HEURISTIC_CONFIG,
);
BARBELL_CURL_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'barbell-curl.incomplete_flex', metricKey: 'minCurlRatio', thresholdPath: 'formThresholds.FLEX_RATIO_WARN', direction: 'above' },
  { issueId: 'barbell-curl.incomplete_extend', metricKey: 'maxCurlRatio', thresholdPath: 'formThresholds.EXTEND_RATIO_WARN', direction: 'below' },
  { issueId: 'barbell-curl.incomplete_rom', metricKey: 'romRatio', thresholdPath: 'thresholds.ROM_MIN', direction: 'below' },
  { issueId: 'barbell-curl.shoulder_fail', metricKey: 'shoulderDelta', thresholdPath: 'formThresholds.SHOULDER_FAIL', direction: 'above' },
  { issueId: 'barbell-curl.shoulder_warn', metricKey: 'shoulderDelta', thresholdPath: 'formThresholds.SHOULDER_WARN', direction: 'above' },
  { issueId: 'barbell-curl.torso_fail', metricKey: 'torsoDelta', thresholdPath: 'formThresholds.TORSO_FAIL', direction: 'above' },
  { issueId: 'barbell-curl.torso_warn', metricKey: 'torsoDelta', thresholdPath: 'formThresholds.TORSO_WARN', direction: 'above' },
  { issueId: 'barbell-curl.elbow_flare', metricKey: 'elbowFlareMaxDeg', thresholdPath: 'formThresholds.ELBOW_FLARE_WARN', direction: 'above' },
  { issueId: 'barbell-curl.tempo_up', metricKey: 'tUp', thresholdPath: 'formThresholds.TEMPO_UP_MIN', direction: 'below' },
  { issueId: 'barbell-curl.tempo_down', metricKey: 'tDown', thresholdPath: 'formThresholds.TEMPO_DOWN_MIN', direction: 'below' },
  { issueId: 'barbell-curl.asymmetry', metricKey: 'asymmetryRatio', thresholdPath: 'formThresholds.SYMMETRY_ROM_RATIO', direction: 'above' },
  { issueId: 'barbell-curl.wrist_curl', metricKey: 'wristDeviationRatio', thresholdPath: 'formThresholds.WRIST_DEV_DURATION', direction: 'above' },
];

const BARBELL_CURL_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
];

function withBarbellCurlConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, BARBELL_CURL_CONFIG_BINDINGS, fn);
}

// ============================================================================
// CONTINUOUS PENALTY FUNCTIONS (ratio-based where applicable)
// All use quadratic ramps: penalty(x) = min(cap, scale * max(0, x - deadzone)^2)
// ============================================================================

/** Torso swing penalty — max 35 pts. Deadzone 10deg (shoulder drift + breathing/sway/noise).
 *  Already camera-invariant: measures delta within a single rep. */
function penaltyTorso(delta: number): number {
  const d = Math.max(0, delta - 10);
  return Math.min(35, 0.40 * d * d);
}

/** Shoulder movement penalty — max 30 pts. Deadzone 10deg (normal stabilisation).
 *  Already camera-invariant: measures delta within a single rep. */
function penaltyShoulder(delta: number): number {
  const d = Math.max(0, delta - 10);
  return Math.min(30, 0.018 * d * d);
}

/** ROM shortfall penalty — ratio-based, no foreshortening compensation needed.
 *  max 35 pts. Flex (min ratio too high) + extension (max ratio too low).
 *
 *  Target: minRatio ≤ 0.48 (fully curled), maxRatio ≥ 0.93 (fully extended).
 *  Ratios are inherently camera-invariant. */
function penaltyROM(minRatio: number, maxRatio: number): number {
  // Flex shortfall: penalize if min ratio is above 0.48 (didn't curl enough)
  const FLEX_TARGET = 0.48;
  const flexShortfall = Math.max(0, minRatio - FLEX_TARGET);
  // Scale: at ratio 0.58 (10% short), penalty = 300 * 0.10^2 = 3pts
  // At ratio 0.68 (20% short), penalty = 300 * 0.20^2 = 12pts
  const flexPenalty = Math.min(20, 300 * flexShortfall * flexShortfall);

  // Extension shortfall: penalize if max ratio is below 0.93 (didn't extend enough)
  const EXT_TARGET = 0.93;
  const extShortfall = Math.max(0, EXT_TARGET - maxRatio);
  // Scale: at ratio 0.83 (10% short), penalty = 300 * 0.10^2 = 3pts
  const extPenalty = Math.min(20, 300 * extShortfall * extShortfall);

  return Math.min(35, flexPenalty + extPenalty);
}

/** Tempo penalty — max 20 pts. Concentric < 0.4s or eccentric < 0.5s. */
function penaltyTempo(tUp: number, tDown: number): number {
  let upPenalty = 0;
  if (tUp > 0 && tUp < 0.4) {
    const deficit = 0.4 - tUp;
    upPenalty = Math.min(10, 60 * deficit * deficit);
  }
  let downPenalty = 0;
  if (tDown > 0 && tDown < 0.5) {
    const deficit = 0.5 - tDown;
    downPenalty = Math.min(10, 40 * deficit * deficit);
  }
  return Math.min(20, upPenalty + downPenalty);
}

/** Elbow flare penalty — max 20 pts. Deadzone 15deg (some natural abduction is normal). */
function penaltyElbowFlare(maxFlareDeg: number): number {
  const d = Math.max(0, maxFlareDeg - 15);
  return Math.min(20, 0.022 * d * d);
}

/** Asymmetry penalty — ratio-based. max 15 pts.
 *  Compares reach ratio differences between arms (camera-invariant). */
function penaltyAsymmetry(deltaMinRatio: number, deltaRomRatio: number): number {
  // Scale: at 0.10 diff, penalty = 500 * 0.10^2 = 5pts. At 0.20 diff = 20pts (capped at 10).
  const minPenalty = Math.min(10, 500 * deltaMinRatio * deltaMinRatio);
  const romPenalty = Math.min(10, 500 * deltaRomRatio * deltaRomRatio);
  return Math.min(15, minPenalty + romPenalty);
}

/** Wrist deviation penalty — max 10 pts. Counts only sustained wrist curling. */
function penaltyWristDeviation(deviationFrameRatio: number): number {
  const d = Math.max(0, deviationFrameRatio - 0.25);
  return Math.min(10, 80 * d * d);
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

function getWristDeviationFrameRatio(
  repWindow: RepWindow,
  isFrontal: boolean,
  primaryIsLeft: boolean,
): number {
  const sideRatio = (side: CurlSide): number => {
    const samples = repWindow.wrist[side];
    if (samples.confidentSamples < WRIST_MIN_CONFIDENT_SAMPLES) return 0;
    return sampleRatio(samples.deviationSamples, samples.confidentSamples);
  };

  if (isFrontal) return Math.max(sideRatio('left'), sideRatio('right'));
  return primaryIsLeft ? sideRatio('left') : sideRatio('right');
}

/** Compute a continuous rep score from ratio-based measurements. */
function computeRepScore(
  repWindow: RepWindow,
  leftArm: ArmFSM,
  _rightArm: ArmFSM,
  viewAngle: ViewAngle = { angleDeg: 0, smoothedAngleDeg: 0, zone: 'frontal', primarySide: 'both' }
): number {
  const { minAngles, maxAngles } = repWindow;
  const isFrontal = viewAngle.zone === 'frontal';
  const isSide = viewAngle.zone === 'side';
  const primaryIsLeft = viewAngle.primarySide !== 'right';

  // Torso penalty (delta-based, already camera-invariant)
  const deltaTorso = isFinite(maxAngles.torso - minAngles.torso)
    ? maxAngles.torso - minAngles.torso
    : 0;
  const torsoP = penaltyTorso(deltaTorso);

  // Shoulder penalty (delta-based, skip at side angles)
  let shoulderP = 0;
  if (!isSide) {
    const deltaShL = maxAngles.leftShoulder - minAngles.leftShoulder;
    const deltaShR = maxAngles.rightShoulder - minAngles.rightShoulder;
    const shValues: number[] = [];
    if (isFinite(deltaShL)) shValues.push(deltaShL);
    if (isFinite(deltaShR)) shValues.push(deltaShR);
    const maxDeltaSh = shValues.length > 0 ? Math.max(...shValues) : 0;
    shoulderP = penaltyShoulder(maxDeltaSh);
  }

  // ROM penalty — ratio-based (camera-invariant, no foreshortening compensation)
  const leftRatioOk = isFinite(repWindow.ratios.minLeftRatio) && isFinite(repWindow.ratios.maxLeftRatio);
  const rightRatioOk = isFinite(repWindow.ratios.minRightRatio) && isFinite(repWindow.ratios.maxRightRatio);
  let minRatio: number;
  let maxRatio: number;
  if (isFrontal) {
    minRatio = Math.min(
      leftRatioOk ? repWindow.ratios.minLeftRatio : Infinity,
      rightRatioOk ? repWindow.ratios.minRightRatio : Infinity
    );
    maxRatio = Math.max(
      leftRatioOk ? repWindow.ratios.maxLeftRatio : -Infinity,
      rightRatioOk ? repWindow.ratios.maxRightRatio : -Infinity
    );
  } else {
    minRatio = primaryIsLeft
      ? (leftRatioOk ? repWindow.ratios.minLeftRatio : 0.45)
      : (rightRatioOk ? repWindow.ratios.minRightRatio : 0.45);
    maxRatio = primaryIsLeft
      ? (leftRatioOk ? repWindow.ratios.maxLeftRatio : 0.95)
      : (rightRatioOk ? repWindow.ratios.maxRightRatio : 0.95);
  }
  const romP = penaltyROM(
    isFinite(minRatio) ? minRatio : 0.45,
    isFinite(maxRatio) ? maxRatio : 0.95
  );

  const { tUp, tDown } = getRepTempoDurations(repWindow, leftArm, _rightArm, viewAngle);
  const tempoP = penaltyTempo(tUp, tDown);

  // Asymmetry penalty — ratio-based (camera-invariant)
  let asymmetryP = 0;
  if (isFrontal && leftRatioOk && rightRatioOk) {
    const romLRatio = repWindow.ratios.maxLeftRatio - repWindow.ratios.minLeftRatio;
    const romRRatio = repWindow.ratios.maxRightRatio - repWindow.ratios.minRightRatio;
    const deltaMinRatio = Math.abs(repWindow.ratios.minLeftRatio - repWindow.ratios.minRightRatio);
    const deltaRomRatio = Math.abs(romLRatio - romRRatio);
    asymmetryP = penaltyAsymmetry(deltaMinRatio, deltaRomRatio);
  }

  // Elbow flare penalty (frontal only)
  const flareSummary = getElbowFlareSummary(repWindow, isFrontal);
  const elbowFlareP = flareSummary.sustainedWarn || flareSummary.sustainedFail
    ? penaltyElbowFlare(flareSummary.maxFlareDeg)
    : 0;

  const wristDeviationFrameRatio = getWristDeviationFrameRatio(repWindow, isFrontal, primaryIsLeft);
  const wristP = penaltyWristDeviation(wristDeviationFrameRatio);

  const total = torsoP + shoulderP + romP + tempoP + asymmetryP + elbowFlareP + wristP;
  return Math.max(0, Math.min(100, Math.round(100 - total)));
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

const SIDES = ['left', 'right'] as const;
type CurlSide = typeof SIDES[number];
type ArmState = 'REST' | 'UP' | 'TOP' | 'DOWN';

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
}

interface RepSampleCounts {
  confidentSamples: number;
  deviationSamples: number;
}

interface RepElbowFlareCounts {
  confidentSamples: number;
  warnSamples: number;
  failSamples: number;
  maxFlareDeg: number;
}

interface RepWindow {
  /** Rolling min/max for angular metrics during the rep (torso, shoulder, wrist — still angle-based) */
  minAngles: AngleSet;
  maxAngles: AngleSet;
  /** Rolling min/max reach ratios per arm — the primary metric for ROM/flex/extend evaluation */
  ratios: {
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
  /** Wrist deviation history using confident wrist/index samples as the denominator. */
  wrist: Record<CurlSide, RepSampleCounts>;
  /** Sustained elbow flare samples. Frontal view only. */
  elbowFlare: Record<CurlSide, RepElbowFlareCounts>;
}

interface AngleSet {
  leftElbow: number;
  rightElbow: number;
  leftShoulder: number;
  rightShoulder: number;
  leftTorso: number;
  rightTorso: number;
  torso: number; // midline (hip center -> shoulder center) for better swing detection
  leftWrist: number;
  rightWrist: number;
  /** Reach ratio: dist(shoulder,wrist) / (dist(shoulder,elbow) + dist(elbow,wrist)).
   *  ~1.0 = fully extended, ~0.4 = fully curled. Camera-angle invariant. */
  leftRatio: number;
  rightRatio: number;
}

interface SmoothedAngles extends AngleSet {}

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
  };
}

function initSampleCounts(): RepSampleCounts {
  return { confidentSamples: 0, deviationSamples: 0 };
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
      leftWrist: Infinity,
      rightWrist: Infinity,
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
      leftWrist: -Infinity,
      rightWrist: -Infinity,
      leftRatio: -Infinity,
      rightRatio: -Infinity,
    },
    ratios: {
      minLeftRatio: Infinity,
      maxLeftRatio: -Infinity,
      minRightRatio: Infinity,
      maxRightRatio: -Infinity,
    },
    tStart,
    tEnd: tStart,
    frameCount: 0,
    tempo: { left: initRepTempoSide(), right: initRepTempoSide() },
    wrist: { left: initSampleCounts(), right: initSampleCounts() },
    elbowFlare: { left: initElbowFlareCounts(), right: initElbowFlareCounts() },
  };
}

function initializeBarbellCurlState(): BarbellCurlState {
  return {
    leftArm: initArmFSM(),
    rightArm: initArmFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    angleHistory: {
      leftElbow: [],
      rightElbow: [],
      leftShoulder: [],
      rightShoulder: [],
      leftTorso: [],
      rightTorso: [],
      torso: [],
      leftWrist: [],
      rightWrist: [],
      leftRatio: [],
      rightRatio: [],
    },
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

/**
 * Compute normalized arm reach ratio for one arm.
 * reach = dist2D(shoulder, wrist) / (dist2D(shoulder, elbow) + dist2D(elbow, wrist))
 *
 * ~0.95-1.0  = arm nearly straight (full extension)
 * ~0.70-0.85 = forearm foreshortened (pointing into depth axis)
 */
function computeArmReachRatio(keypoints: Keypoint[], side: 'left' | 'right'): number {
  // Reach ratio is calibrated on world (3D) landmarks. Image landmarks lack z and
  // produce foreshortened distances that make the ratio unreliable for front-on curls.
  if (keypoints.length === 0 || keypoints[0].z === undefined) return NaN;

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

  const segmentLength = dist2D(shoulder, elbow) + dist2D(elbow, wrist);
  if (segmentLength < 1e-6) return NaN;

  return dist2D(shoulder, wrist) / segmentLength;
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

function hasVisibleJoints(keypoints: Keypoint[], names: string[], threshold = VISIBILITY_THRESHOLD): boolean {
  return names.every((name) => {
    const point = getKeypoint(keypoints, name);
    return Boolean(point && isVisible(point, threshold));
  });
}

function hasWristConfidence(keypoints: Keypoint[], side: CurlSide): boolean {
  return hasVisibleJoints(keypoints, [`${side}_elbow`, `${side}_wrist`, `${side}_index`]);
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
}

/**
 * Calculate all 8 joint angles from keypoints.
 * Uses existing calculation functions.
 */
function calculateJointAngles(keypoints: Keypoint[]): AngleSet | null {
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');
  const leftElbow = getKeypoint(keypoints, 'left_elbow');
  const rightElbow = getKeypoint(keypoints, 'right_elbow');
  const leftWrist = getKeypoint(keypoints, 'left_wrist');
  const rightWrist = getKeypoint(keypoints, 'right_wrist');
  const leftHip = getKeypoint(keypoints, 'left_hip');
  const rightHip = getKeypoint(keypoints, 'right_hip');
  const leftIndex = getKeypoint(keypoints, 'left_index');
  const rightIndex = getKeypoint(keypoints, 'right_index');

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
          const angle = calculateSignedVerticalAngleSagittal(
            hipCenter,
            shoulderCenter,
            getPoint(leftHip)!,
            getPoint(rightHip)!,
            getPoint(leftShoulder)!,
            getPoint(rightShoulder)!
          );
          return Number.isNaN(angle) ? 0 : angle;
        })()
      : NaN;

  // Wrist angles (2D — elbow-wrist-index as proxy for wrist deviation)
  const leftWristAngle =
    leftOk && leftIndex && isVisible(leftIndex, VISIBILITY_THRESHOLD)
      ? calculateAngle2D(getPoint(leftElbow)!, getPoint(leftWrist)!, getPoint(leftIndex)!)
      : 180; // neutral if not visible
  const rightWristAngle =
    rightOk && rightIndex && isVisible(rightIndex, VISIBILITY_THRESHOLD)
      ? calculateAngle2D(getPoint(rightElbow)!, getPoint(rightWrist)!, getPoint(rightIndex)!)
      : 180;

  // Reach ratios — the primary camera-invariant metric for curl detection
  const leftRatio = leftOk
    ? computeArmReachRatio(keypoints, 'left')
    : NaN;
  const rightRatio = rightOk
    ? computeArmReachRatio(keypoints, 'right')
    : NaN;

  return {
    leftElbow: leftElbowAngle,
    rightElbow: rightElbowAngle,
    leftShoulder: leftShoulderAngle,
    rightShoulder: rightShoulderAngle,
    leftTorso: leftTorsoAngle,
    rightTorso: rightTorsoAngle,
    torso: torsoAngle,
    leftWrist: leftWristAngle,
    rightWrist: rightWristAngle,
    leftRatio,
    rightRatio,
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
    'leftWrist',
    'rightWrist',
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
  repIndex: number = 0
): { score: number; messages: string[] } {
  const { minAngles, maxAngles, ratios } = repWindow;
  const messages: string[] = [];
  const isFrontal = viewAngle.zone === 'frontal';
  const isSide = viewAngle.zone === 'side';
  const primaryIsLeft = viewAngle.primarySide !== 'right';

  const leftRatioOk = isFinite(ratios.minLeftRatio) && isFinite(ratios.maxLeftRatio);
  const rightRatioOk = isFinite(ratios.minRightRatio) && isFinite(ratios.maxRightRatio);

  // Determine min/max ratios based on view
  let minRatio: number;
  let maxRatio: number;
  if (isFrontal) {
    minRatio = Math.min(
      leftRatioOk ? ratios.minLeftRatio : Infinity,
      rightRatioOk ? ratios.minRightRatio : Infinity
    );
    maxRatio = Math.max(
      leftRatioOk ? ratios.maxLeftRatio : -Infinity,
      rightRatioOk ? ratios.maxRightRatio : -Infinity
    );
  } else {
    minRatio = primaryIsLeft
      ? (leftRatioOk ? ratios.minLeftRatio : Infinity)
      : (rightRatioOk ? ratios.minRightRatio : Infinity);
    maxRatio = primaryIsLeft
      ? (leftRatioOk ? ratios.maxLeftRatio : -Infinity)
      : (rightRatioOk ? ratios.maxRightRatio : -Infinity);
  }

  const severeMessages: string[] = [];
  const warningMessages: string[] = [];
  const romMessages: string[] = [];
  const elbowMessages: string[] = [];
  const tempoAsymmetryMessages: string[] = [];
  const wristMessages: string[] = [];

  // ROM metrics — ratio-based
  const romLRatio = leftRatioOk ? ratios.maxLeftRatio - ratios.minLeftRatio : 0;
  const romRRatio = rightRatioOk ? ratios.maxRightRatio - ratios.minRightRatio : 0;
  const primaryRomRatio = primaryIsLeft ? romLRatio : romRRatio;

  // 1. Severe shoulder involvement / severe torso swing
  // 2. Shoulder warning / torso warning
  const deltaShL = maxAngles.leftShoulder - minAngles.leftShoulder;
  const deltaShR = maxAngles.rightShoulder - minAngles.rightShoulder;
  if (!isSide) {
    const shValues: number[] = [];
    if (isFinite(deltaShL)) shValues.push(deltaShL);
    if (isFinite(deltaShR)) shValues.push(deltaShR);
    const maxDeltaSh = shValues.length > 0 ? Math.max(...shValues) : 0;

    if (maxDeltaSh > FORM_THRESHOLDS.SHOULDER_FAIL) {
      severeMessages.push('Too much shoulder involvement — reduce the weight.');
    } else if (maxDeltaSh > FORM_THRESHOLDS.SHOULDER_WARN) {
      warningMessages.push('Upper arms moving — keep elbows pinned to your sides.');
    }
  }

  const deltaTorso = maxAngles.torso - minAngles.torso;
  const torsoWarnThreshold = repIndex === 0
    ? FORM_THRESHOLDS.TORSO_FAIL
    : FORM_THRESHOLDS.TORSO_WARN;
  if (isFinite(deltaTorso)) {
    if (deltaTorso > FORM_THRESHOLDS.TORSO_FAIL) {
      severeMessages.push('Excessive body swing — this is cheating the rep.');
    } else if (deltaTorso > torsoWarnThreshold) {
      warningMessages.push("Don't swing your torso — stay upright and controlled.");
    }
  }

  // 3. ROM feedback
  if (isFinite(minRatio) && minRatio > FORM_THRESHOLDS.FLEX_RATIO_WARN) {
    romMessages.push('Flex more at the top of the curl.');
  }
  if (isFinite(maxRatio) && maxRatio < FORM_THRESHOLDS.EXTEND_RATIO_WARN) {
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
  if (isFrontal) {
    const flareSummary = getElbowFlareSummary(repWindow, isFrontal);
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

  if (isFrontal && leftRatioOk && rightRatioOk) {
    const deltaMinRatio = Math.abs(ratios.minLeftRatio - ratios.minRightRatio);
    const deltaRomRatio = Math.abs(romLRatio - romRRatio);
    if (deltaMinRatio > FORM_THRESHOLDS.SYMMETRY_MIN_RATIO || deltaRomRatio > FORM_THRESHOLDS.SYMMETRY_ROM_RATIO) {
      tempoAsymmetryMessages.push('Arms are uneven — curl both sides together.');
    }
  }

  // 6. Wrist neutrality — only after sustained deviation to avoid hand-keypoint flicker.
  const wristDeviationFrameRatio = getWristDeviationFrameRatio(repWindow, isFrontal, primaryIsLeft);
  if (wristDeviationFrameRatio >= FORM_THRESHOLDS.WRIST_DEV_DURATION) {
    wristMessages.push('Keep your wrists neutral \u2014 avoid curling them in.');
  }

  messages.push(
    ...severeMessages,
    ...warningMessages,
    ...romMessages,
    ...elbowMessages,
    ...tempoAsymmetryMessages,
    ...wristMessages,
  );

  // Score: continuous penalty curves
  const score = computeRepScore(repWindow, leftArm, rightArm, viewAngle);

  return { score, messages };
}

function viewDiagnostic(viewAngle: ViewAngle): 'front' | 'side' | 'oblique' {
  if (viewAngle.zone === 'frontal') return 'front';
  return viewAngle.zone;
}

function maxWristConfidentSamples(repWindow: RepWindow, isFrontal: boolean, primaryIsLeft: boolean): number {
  if (isFrontal) {
    return Math.max(repWindow.wrist.left.confidentSamples, repWindow.wrist.right.confidentSamples);
  }
  return primaryIsLeft ? repWindow.wrist.left.confidentSamples : repWindow.wrist.right.confidentSamples;
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

function buildBarbellCurlDiagnostics(
  repWindow: RepWindow,
  leftArm: ArmFSM,
  rightArm: ArmFSM,
  viewAngle: ViewAngle,
  repIndex: number,
): FrameworkRepResult['diagnostics'] {
  const { ratios, minAngles, maxAngles } = repWindow;
  const isFrontal = viewAngle.zone === 'frontal';
  const isSide = viewAngle.zone === 'side';
  const primaryIsLeft = viewAngle.primarySide !== 'right';
  const leftRatioOk = isFinite(ratios.minLeftRatio) && isFinite(ratios.maxLeftRatio);
  const rightRatioOk = isFinite(ratios.minRightRatio) && isFinite(ratios.maxRightRatio);
  const romLRatio = leftRatioOk ? ratios.maxLeftRatio - ratios.minLeftRatio : 0;
  const romRRatio = rightRatioOk ? ratios.maxRightRatio - ratios.minRightRatio : 0;
  const romRatio = getRepWindowRomRatio(repWindow, viewAngle);
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
  const flexTriggered = typeof minRatio === 'number' && isFinite(minRatio) && minRatio > FORM_THRESHOLDS.FLEX_RATIO_WARN;
  const extendTriggered = typeof maxRatio === 'number' && isFinite(maxRatio) && maxRatio < FORM_THRESHOLDS.EXTEND_RATIO_WARN;
  const incompleteRomTriggered = isFrontal
    ? (romLRatio < THRESHOLDS.ROM_MIN || romRRatio < THRESHOLDS.ROM_MIN) && !flexTriggered && !extendTriggered
    : romRatio < THRESHOLDS.ROM_MIN && !flexTriggered && !extendTriggered;

  const shoulderDeltas = [
    maxAngles.leftShoulder - minAngles.leftShoulder,
    maxAngles.rightShoulder - minAngles.rightShoulder,
  ].filter(value => Number.isFinite(value));
  const shoulderDelta = shoulderDeltas.length > 0 ? Math.max(...shoulderDeltas) : null;
  const torsoDelta = maxAngles.torso - minAngles.torso;
  const torsoWarnThreshold = repIndex === 0 ? FORM_THRESHOLDS.TORSO_FAIL : FORM_THRESHOLDS.TORSO_WARN;
  const flareSummary = getElbowFlareSummary(repWindow, isFrontal);
  const flareSupport = maxElbowFlareSupport(repWindow);
  const { tUp, tDown } = getRepTempoDurations(repWindow, leftArm, rightArm, viewAngle);
  const asymmetryRatio =
    isFrontal && leftRatioOk && rightRatioOk
      ? Math.max(
          Math.abs(ratios.minLeftRatio - ratios.minRightRatio),
          Math.abs(romLRatio - romRRatio),
        )
      : null;
  const asymmetryTriggered =
    isFrontal &&
    leftRatioOk &&
    rightRatioOk &&
    (Math.abs(ratios.minLeftRatio - ratios.minRightRatio) > FORM_THRESHOLDS.SYMMETRY_MIN_RATIO ||
      Math.abs(romLRatio - romRRatio) > FORM_THRESHOLDS.SYMMETRY_ROM_RATIO);
  const wristDeviationRatio = getWristDeviationFrameRatio(repWindow, isFrontal, primaryIsLeft);
  const wristSamples = maxWristConfidentSamples(repWindow, isFrontal, primaryIsLeft);

  return buildRepDiagnostics({
    exerciseName: 'Barbell Curl',
    repIndex,
    view: viewDiagnostic(viewAngle),
    selectedSide: viewAngle.primarySide,
    metrics: [
      diagnosticMetric('minCurlRatio', minRatio, { unit: 'ratio' }),
      diagnosticMetric('maxCurlRatio', maxRatio, { unit: 'ratio' }),
      diagnosticMetric('romRatio', romRatio, { unit: 'ratio' }),
      diagnosticMetric('leftRomRatio', romLRatio, { unit: 'ratio', eligible: leftRatioOk, skippedReason: 'left_arm_unavailable' }),
      diagnosticMetric('rightRomRatio', romRRatio, { unit: 'ratio', eligible: rightRatioOk, skippedReason: 'right_arm_unavailable' }),
      diagnosticMetric('shoulderDelta', shoulderDelta, { unit: 'degrees', eligible: !isSide && shoulderDelta !== null, skippedReason: 'side_view_or_shoulder_unavailable' }),
      diagnosticMetric('torsoDelta', torsoDelta, { unit: 'degrees' }),
      diagnosticMetric('elbowFlareMaxDeg', flareSummary.maxFlareDeg, {
        unit: 'degrees',
        eligible: isFrontal && flareSupport.sampleCount >= ELBOW_FLARE_MIN_CONFIDENT_SAMPLES,
        sampleCount: flareSupport.sampleCount,
        skippedReason: isFrontal ? 'insufficient_elbow_flare_samples' : 'not_front_view',
      }),
      diagnosticMetric('elbowFlareSupportRatio', flareSupport.support, {
        unit: 'ratio',
        eligible: isFrontal && flareSupport.sampleCount >= ELBOW_FLARE_MIN_CONFIDENT_SAMPLES,
        sampleCount: flareSupport.sampleCount,
        skippedReason: isFrontal ? 'insufficient_elbow_flare_samples' : 'not_front_view',
      }),
      diagnosticMetric('tUp', tUp, { unit: 'seconds', eligible: tUp > 0, skippedReason: 'curl_up_timestamp_unavailable' }),
      diagnosticMetric('tDown', tDown, { unit: 'seconds', eligible: tDown > 0, skippedReason: 'lowering_timestamp_unavailable' }),
      diagnosticMetric('asymmetryRatio', asymmetryRatio, { unit: 'ratio', eligible: isFrontal && asymmetryRatio !== null, skippedReason: 'not_front_view_or_side_missing' }),
      diagnosticMetric('wristDeviationRatio', wristDeviationRatio, {
        unit: 'ratio',
        eligible: wristSamples >= WRIST_MIN_CONFIDENT_SAMPLES,
        sampleCount: wristSamples,
        skippedReason: 'insufficient_wrist_samples',
      }),
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
        metricKeys: ['maxCurlRatio'],
        direction: 'below',
        value: maxRatio,
        thresholdPath: 'formThresholds.EXTEND_RATIO_WARN',
        thresholdValue: FORM_THRESHOLDS.EXTEND_RATIO_WARN,
        triggered: extendTriggered,
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
        metricKeys: ['shoulderDelta'],
        direction: 'above',
        value: shoulderDelta,
        thresholdPath: 'formThresholds.SHOULDER_FAIL',
        thresholdValue: FORM_THRESHOLDS.SHOULDER_FAIL,
        eligible: !isSide && shoulderDelta !== null,
        triggered: !isSide && shoulderDelta !== null && shoulderDelta > FORM_THRESHOLDS.SHOULDER_FAIL,
        skippedReason: 'side_view_or_shoulder_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.shoulder_warn',
        metricKeys: ['shoulderDelta'],
        direction: 'above',
        value: shoulderDelta,
        thresholdPath: 'formThresholds.SHOULDER_WARN',
        thresholdValue: FORM_THRESHOLDS.SHOULDER_WARN,
        eligible: !isSide && shoulderDelta !== null,
        triggered:
          !isSide &&
          shoulderDelta !== null &&
          shoulderDelta > FORM_THRESHOLDS.SHOULDER_WARN &&
          shoulderDelta <= FORM_THRESHOLDS.SHOULDER_FAIL,
        skippedReason: 'side_view_or_shoulder_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.torso_fail',
        metricKeys: ['torsoDelta'],
        direction: 'above',
        value: torsoDelta,
        thresholdPath: 'formThresholds.TORSO_FAIL',
        thresholdValue: FORM_THRESHOLDS.TORSO_FAIL,
        triggered: Number.isFinite(torsoDelta) && torsoDelta > FORM_THRESHOLDS.TORSO_FAIL,
      }),
      diagnosticCue({
        issueId: 'barbell-curl.torso_warn',
        metricKeys: ['torsoDelta'],
        direction: 'above',
        value: torsoDelta,
        thresholdPath: 'formThresholds.TORSO_WARN',
        thresholdValue: torsoWarnThreshold,
        triggered:
          Number.isFinite(torsoDelta) &&
          torsoDelta > torsoWarnThreshold &&
          torsoDelta <= FORM_THRESHOLDS.TORSO_FAIL,
      }),
      diagnosticCue({
        issueId: 'barbell-curl.elbow_flare',
        metricKeys: ['elbowFlareMaxDeg', 'elbowFlareSupportRatio'],
        direction: 'above',
        value: flareSummary.maxFlareDeg,
        thresholdPath: 'formThresholds.ELBOW_FLARE_WARN',
        thresholdValue: FORM_THRESHOLDS.ELBOW_FLARE_WARN,
        eligible: isFrontal && flareSupport.sampleCount >= ELBOW_FLARE_MIN_CONFIDENT_SAMPLES,
        support: flareSupport.support,
        triggered: isFrontal && (flareSummary.sustainedWarn || flareSummary.sustainedFail),
        skippedReason: isFrontal ? 'insufficient_elbow_flare_samples' : 'not_front_view',
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
        metricKeys: ['asymmetryRatio'],
        direction: 'above',
        value: asymmetryRatio,
        thresholdPath: 'formThresholds.SYMMETRY_ROM_RATIO',
        thresholdValue: FORM_THRESHOLDS.SYMMETRY_ROM_RATIO,
        eligible: isFrontal && asymmetryRatio !== null,
        triggered: asymmetryTriggered,
        skippedReason: 'not_front_view_or_side_missing',
      }),
      diagnosticCue({
        issueId: 'barbell-curl.wrist_curl',
        metricKeys: ['wristDeviationRatio'],
        direction: 'above',
        value: wristDeviationRatio,
        thresholdPath: 'formThresholds.WRIST_DEV_DURATION',
        thresholdValue: FORM_THRESHOLDS.WRIST_DEV_DURATION,
        eligible: wristSamples >= WRIST_MIN_CONFIDENT_SAMPLES,
        support: wristDeviationRatio,
        triggered: wristSamples >= WRIST_MIN_CONFIDENT_SAMPLES && wristDeviationRatio >= FORM_THRESHOLDS.WRIST_DEV_DURATION,
        skippedReason: 'insufficient_wrist_samples',
      }),
    ],
  });
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateBarbellCurlState(
  keypoints: Keypoint[],
  currentState: BarbellCurlState
): BarbellCurlState {
  const t = Date.now() / 1000; // seconds

  // Estimate view angle
  const viewAngle = estimateViewAngle(keypoints, currentState.viewAngle.smoothedAngleDeg);

  // Calculate raw angles
  const rawAngles = calculateJointAngles(keypoints);
  if (!rawAngles) {
    return { ...currentState, displayAngles: null, viewAngle };
  }

  // Apply smoothing — returns fast (median-only) and smoothed (median+EMA)
  const { smoothed, fast } = applySmoothing(rawAngles, currentState.angleHistory, currentState.smoothed);

  // Warm-up gate: require consecutive stable frames before enabling FSM
  const frameStable = isFrameStable(keypoints);
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
  const leftValid = !isNaN(fast.leftRatio);
  const rightValid = !isNaN(fast.rightRatio);

  // If neither arm is valid, bail
  if (!leftValid && !rightValid) {
    return newState;
  }

  const isSingleArm = !leftValid || !rightValid;

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
  const leftWasInRep = leftValid && currentState.leftArm.state !== 'REST';
  const rightWasInRep = rightValid && currentState.rightArm.state !== 'REST';
  const shouldAccumulate = inRep || leftWasInRep || rightWasInRep;

  if (newState.repWindow && shouldAccumulate) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

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

    for (const side of SIDES) {
      const wristKey = `${side}Wrist` as keyof AngleSet;
      if (hasWristConfidence(keypoints, side) && Number.isFinite(smoothed[wristKey])) {
        updateMinMax(window, wristKey, smoothed[wristKey]);
        const samples = window.wrist[side];
        samples.confidentSamples++;
        if (Math.abs(smoothed[wristKey] - FORM_THRESHOLDS.WRIST_NEUTRAL) > FORM_THRESHOLDS.WRIST_DEV_WARN) {
          samples.deviationSamples++;
        }
      }
    }

    // Track reach ratios using current-frame-valid fast values to capture true depth/lockout.
    if (Number.isFinite(rawAngles.leftRatio) && Number.isFinite(fast.leftRatio)) {
      updateMinMax(window, 'leftRatio', fast.leftRatio);
      window.ratios.minLeftRatio = Math.min(window.ratios.minLeftRatio, fast.leftRatio);
      window.ratios.maxLeftRatio = Math.max(window.ratios.maxLeftRatio, fast.leftRatio);
      updateRepTempoSide(window.tempo.left, fast.leftRatio, t);
    }
    if (Number.isFinite(rawAngles.rightRatio) && Number.isFinite(fast.rightRatio)) {
      updateMinMax(window, 'rightRatio', fast.rightRatio);
      window.ratios.minRightRatio = Math.min(window.ratios.minRightRatio, fast.rightRatio);
      window.ratios.maxRightRatio = Math.max(window.ratios.maxRightRatio, fast.rightRatio);
      updateRepTempoSide(window.tempo.right, fast.rightRatio, t);
    }

    // Track elbow flare (frontal only — lateral deviation is visible facing the camera)
    if (viewAngle.zone === 'frontal') {
      for (const side of SIDES) {
        const flare = computeElbowFlareDeg(keypoints, side);
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
  if (viewAngle.zone === 'frontal' && !isSingleArm) {
    // FRONTAL MODE: two-arm sync logic
    const bothInRest = newState.leftArm.state === 'REST' && newState.rightArm.state === 'REST';
    const leftJustFinished = prevLeftState === 'DOWN' && newState.leftArm.state === 'REST';
    const rightJustFinished = prevRightState === 'DOWN' && newState.rightArm.state === 'REST';
    const leftPartialFinished = prevLeftState === 'UP' && newState.leftArm.partialReturnedToRest;
    const rightPartialFinished = prevRightState === 'UP' && newState.rightArm.partialReturnedToRest;

    if (bothInRest && (leftJustFinished || rightJustFinished || leftPartialFinished || rightPartialFinished) && newState.repWindow) {
      const leftEndTime = newState.leftArm.tDownToRest ?? t;
      const rightEndTime = newState.rightArm.tDownToRest ?? t;
      const syncDelta = Math.abs(leftEndTime - rightEndTime);

      if (syncDelta <= THRESHOLDS.SYNC_WINDOW) {
        if (leftJustFinished || rightJustFinished) {
          completeRep(newState, t, viewAngle);
        } else {
          completePartialRepIfMeaningful(newState, t, viewAngle);
        }
      } else {
        // Not synced — reset
        resetBarbellCurlRepTracking(newState);
      }
    }
  } else {
    // OBLIQUE/SIDE MODE or single-arm: count rep from the primary (visible) arm
    const primaryArm = getPrimaryArm(viewAngle, leftValid, rightValid);
    const armState = primaryArm === 'left' ? newState.leftArm : newState.rightArm;
    const prevArmState = primaryArm === 'left' ? prevLeftState : prevRightState;

    const justFinished = prevArmState === 'DOWN' && armState.state === 'REST';
    const partialFinished = prevArmState === 'UP' && armState.partialReturnedToRest;

    if (justFinished && newState.repWindow) {
      completeRep(newState, t, viewAngle);
    } else if (partialFinished && newState.repWindow) {
      completePartialRepIfMeaningful(newState, t, viewAngle);
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
    return Math.max(leftRom, rightRom);
  }
  return viewAngle.primarySide === 'right' ? rightRom : leftRom;
}

function resetBarbellCurlRepTracking(newState: BarbellCurlState): void {
  newState.repWindow = null;
  newState.leftArm = initArmFSM();
  newState.rightArm = initArmFSM();
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
  newState.repCount++;

  const romLRatio = newState.leftArm.maxRatio - newState.leftArm.minRatio;
  const romRRatio = newState.rightArm.maxRatio - newState.rightArm.minRatio;

  const { tUp, tDown } = getRepTempoDurations(
    newState.repWindow!,
    newState.leftArm,
    newState.rightArm,
    viewAngle,
  );

  const { score, messages } = evaluateForm(
    newState.repWindow!,
    newState.leftArm,
    newState.rightArm,
    viewAngle,
    newState.repCount
  );

  newState.lastRepResult = {
    repIndex: newState.repCount,
    romLRatio,
    romRRatio,
    tUp,
    tDown,
    score,
    messages,
    diagnostics: buildBarbellCurlDiagnostics(
      newState.repWindow!,
      newState.leftArm,
      newState.rightArm,
      viewAngle,
      newState.repCount,
    ),
  };

  if (messages.length > 0) {
    newState.feedback = messages.join('\n');
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

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    repQualityWindowActive: false,
    _internal: withBarbellCurlConfig(config, () => initializeBarbellCurlState()),
  }),

  update: (keypoints, state) => {
    const internal = state._internal as BarbellCurlState;
    const newInternal = withBarbellCurlConfig(
      config,
      () => updateBarbellCurlState(keypoints, internal),
    );

    // Map internal RepResult to framework RepResult
    const lastRepResult: FrameworkRepResult | null = newInternal.lastRepResult
      ? {
          repIndex: newInternal.lastRepResult.repIndex,
          score: newInternal.lastRepResult.score,
          messages: newInternal.lastRepResult.messages,
          diagnostics: newInternal.lastRepResult.diagnostics,
        }
      : null;

    return {
      repCount: newInternal.repCount,
      lastRepResult,
      feedback: newInternal.feedback,
      feedbackTimestamp: newInternal.lastFeedbackTime > 0 ? newInternal.lastFeedbackTime : null,
      debugInfo: getBarbellCurlDebugInfo(newInternal) as Record<string, unknown>,
      repQualityWindowActive: newInternal.repWindow !== null,
      _internal: newInternal,
    };
  },

  heuristicConfig: config,
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
      'Keep your wrists neutral \u2014 avoid curling them in.': 'wrist_curl',
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
      'Keep your wrists neutral \u2014 avoid curling them in.': 10,
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
      {
        issueType: 'wrist_curl',
        priority: 10,
        messages: [
          'Keep your wrists straight.',
          "Don't curl your wrists in.",
          'Keep your wrists neutral.',
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
    'Keep your wrists neutral \u2014 avoid curling them in.': 'Keep wrists straight and stacked with your forearms so the curl stays focused on the biceps.',
  },
  };
}

export const barbellCurlDefinition: ExerciseDefinition = createBarbellCurlDefinition();
