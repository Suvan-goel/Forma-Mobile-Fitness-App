/**
 * Machine Ab Crunches — Exercise Definition
 *
 * Side view, torso flexion angle as primary driver.
 * User sits in a machine ab crunch and curls their torso forward.
 * FSM: REST -> CRUNCHING -> BOTTOM -> RETURNING -> REST
 *
 * Primary angle: hip angle (shoulder-hip-knee) — decreases during crunch.
 * Form checks: ROM (crunch depth + returned extension), tempo, smoothness,
 * side-view quality, neck position, arm-pull proxy, and hip-stability proxy.
 *
 * The only export is `machineAbCrunchDefinition`.
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
  diagnosticMetric,
} from '../shared/diagnostics';
import { createPoseStateReliabilityAggregator } from '../../pose/buildPoseState';
import {
  interpretPoseStateReliabilitySummary,
  type RepReliabilityInterpretation,
} from '../shared/reliabilityInterpretation';
import { cameraStatusFromExerciseFeedbackReadiness } from '../shared/liveAnalysisStatus';
import tunedConfig from './tuned/machineAbCrunch.json';
import type { CameraAnalysisStatus } from '../shared/cameraAnalysisStatus';

import type {
  ExerciseDefinition,
  ExerciseFrameContext,
  ExerciseHeuristicConfig,
  ExerciseState,
  RepDiagnostics,
  RepResult as FrameworkRepResult,
} from '../types';
import type { PoseStateReliabilitySummary } from '../../pose/PoseState';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (degrees — hip angle: shoulder-hip-knee) */
const THRESHOLDS = {
  /** Hip angle below which the crunch clock starts before the FSM commits */
  CRUNCH_CLOCK_START: 128,
  /** Hip angle below which we transition REST -> CRUNCHING */
  CRUNCHING_ENTER: 112,
  /** Hip angle below which we consider bottom position (CRUNCHING -> BOTTOM) */
  BOTTOM_ENTER: 105,
  /** Hip angle above which we leave BOTTOM (hysteresis) (BOTTOM -> RETURNING) */
  BOTTOM_EXIT: 110,
  /** Hip angle above which CRUNCHING aborts (must be higher than REST_REENTER) */
  CRUNCHING_EXIT: 117,
  /** Hip angle above which the return is complete (RETURNING -> REST) */
  REST_REENTER: 114,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.5,
  /** Minimum hip-angle ROM for a returned partial rep to count */
  MIN_PARTIAL_ROM: 12,
  /** Minimum confidence for the primary hip chain to advance the FSM */
  PRIMARY_CONFIDENCE_MIN: 0.3,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Min hip angle above which crunch is too shallow */
  CRUNCH_ROM_FAIL: 112,
  /** Returned hip angle below which extension is incomplete */
  EXTENSION_ROM_FAIL: 122,
  /** Concentric (crunch down) too fast threshold (seconds) */
  TEMPO_CRUNCH_MIN: 0.25,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.4,
  /** Neck forward deviation threshold (degrees) — neck shouldn't jut forward */
  NECK_FORWARD_WARN: 45,
  /** Average side-view confidence below which the rep is not scorable */
  SIDE_VIEW_AVG_CONFIDENCE_MIN: 0.45,
  /** Minimum side-view confidence below which the rep is not scorable */
  SIDE_VIEW_MIN_CONFIDENCE_MIN: 0.25,
  /** Max angular velocity before a movement is considered jerky */
  TEMPO_JERK_VELOCITY_WARN: 140,
  /** Max/mean angular velocity ratio before a movement is considered jerky */
  TEMPO_JERK_SPIKE_WARN: 4,
  /** Arm movement relative to torso height above which arm pulling is likely */
  ARM_PULL_WARN: 0.25,
  /** Hip shift relative to torso height above which hips are not planted */
  HIP_SHIFT_WARN: 0.12,
} as const;

const SCORE_TARGETS = {
  /** Ideal deepest hip angle or lower */
  CRUNCH_IDEAL: 106,
  /** Ideal returned extension angle or higher */
  EXTENSION_IDEAL: 122,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * Max total penalty: 164 -> worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  CRUNCH_ROM:    { cap: 30, deadzone: 0, scale: 0.04 } as PenaltyConfig,
  EXTENSION_ROM: { cap: 50, deadzone: 0, scale: 0.12 } as PenaltyConfig,
  TEMPO_CRUNCH:  { cap: 40, deadzone: 0.27, scale: 3000 } as PenaltyConfig,
  TEMPO_RETURN:  { cap: 15, deadzone: 0.5, scale: 40 } as PenaltyConfig,
  NECK_FORWARD:  { cap: 5, deadzone: 40, scale: 0.01 } as PenaltyConfig,
  TEMPO_JERK:    { cap: 8, deadzone: 4, scale: 2 } as PenaltyConfig,
  ARM_PULL:      { cap: 8, deadzone: 0.25, scale: 120 } as PenaltyConfig,
  HIP_SHIFT:     { cap: 8, deadzone: 0.12, scale: 160 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;
const FORM_CONFIDENCE_MIN = 0.3;
const SIDE_VIEW_MIN_SAMPLES = 5;
const SETUP_SIDE_VIEW_MIN_SAMPLES = 8;
const FEEDBACK_COOLDOWN_SECONDS = 2.0;
const AUX_METRIC_MIN_SAMPLES = 5;
const NECK_FORWARD_MIN_SAMPLES = 5;

const FEEDBACK = {
  DEPTH_SHORT: 'Crunch deeper — bring your chest closer to your knees.',
  LOCKOUT_SHORT: 'Extend fully — return to the upright position.',
  NECK_FORWARD: 'Keep your neck neutral — avoid pulling with your head.',
  TEMPO_DOWN: 'Slow down the crunch — control the movement.',
  TEMPO_UP: 'Control the return — resist on the way back.',
  SIDE_VIEW: 'Turn fully side-on so I can judge your crunch.',
  TEMPO_JERK: 'Move smoothly — avoid jerking the weight.',
  ARM_PULL: 'Use your abs, not your arms — keep the handles light.',
  HIPS_MOVING: 'Keep your hips planted — flex from your waist.',
} as const;

const MACHINE_AB_CRUNCH_RELIABILITY_JOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ear',
  'right_ear',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
];

const MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES = [
  'torsoCrunchPath',
  'hipAngleRange',
  'kneeSupport',
  'shoulderHipAlignment',
];

const MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES: Record<string, string[]> = {
  'machine-ab-crunches.depth_short': MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES,
  'machine-ab-crunches.lockout_short': MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES,
  'machine-ab-crunches.neck_forward': ['setupPosture', 'shoulderHipAlignment', 'neckPosition'],
  'machine-ab-crunches.side_view_uncertain': [],
  'machine-ab-crunches.tempo_down': ['tempo'],
  'machine-ab-crunches.tempo_up': ['tempo'],
  'machine-ab-crunches.tempo_jerk': ['tempo'],
  'machine-ab-crunches.arm_pull': ['auxiliaryArmCue'],
  'machine-ab-crunches.hips_moving': ['setupPosture', 'kneeSupport', 'shoulderHipAlignment'],
};

const MACHINE_AB_CRUNCH_MESSAGE_CUE_FAMILIES: Record<string, string[]> = {
  [FEEDBACK.DEPTH_SHORT]: MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES['machine-ab-crunches.depth_short'],
  [FEEDBACK.LOCKOUT_SHORT]: MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES['machine-ab-crunches.lockout_short'],
  [FEEDBACK.NECK_FORWARD]: MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES['machine-ab-crunches.neck_forward'],
  [FEEDBACK.TEMPO_DOWN]: MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES['machine-ab-crunches.tempo_down'],
  [FEEDBACK.TEMPO_UP]: MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES['machine-ab-crunches.tempo_up'],
  [FEEDBACK.SIDE_VIEW]: MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES['machine-ab-crunches.side_view_uncertain'],
  [FEEDBACK.TEMPO_JERK]: MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES['machine-ab-crunches.tempo_jerk'],
  [FEEDBACK.ARM_PULL]: MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES['machine-ab-crunches.arm_pull'],
  [FEEDBACK.HIPS_MOVING]: MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES['machine-ab-crunches.hips_moving'],
};

const DEFAULT_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  scoreTargets: SCORE_TARGETS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG,
  tunedConfig,
);

const MACHINE_AB_CRUNCH_TUNABLE_SPEC = createDefaultTunableSpec(
  'Machine Ab Crunches',
  DEFAULT_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG,
);
MACHINE_AB_CRUNCH_TUNABLE_SPEC.tunables.push(
  { path: 'scoreTargets.CRUNCH_IDEAL', min: 80, max: 138, step: 1, kind: 'scoring' },
  { path: 'scoreTargets.EXTENSION_IDEAL', min: 90, max: 160, step: 1, kind: 'scoring' },
);
MACHINE_AB_CRUNCH_TUNABLE_SPEC.tunables = MACHINE_AB_CRUNCH_TUNABLE_SPEC.tunables.filter(
  (tunable) => tunable.path !== 'formThresholds.TEMPO_JERK_VELOCITY_WARN',
);
MACHINE_AB_CRUNCH_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'machine-ab-crunches.depth_short', metricKey: 'crunchDepthAngle', thresholdPath: 'formThresholds.CRUNCH_ROM_FAIL', direction: 'above' },
  { issueId: 'machine-ab-crunches.lockout_short', metricKey: 'extensionAngle', thresholdPath: 'formThresholds.EXTENSION_ROM_FAIL', direction: 'below' },
  { issueId: 'machine-ab-crunches.neck_forward', metricKey: 'neckForwardP90', thresholdPath: 'formThresholds.NECK_FORWARD_WARN', direction: 'above' },
  { issueId: 'machine-ab-crunches.side_view_uncertain', metricKey: 'sideViewConfidence', thresholdPath: 'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN', direction: 'below' },
  { issueId: 'machine-ab-crunches.side_view_uncertain', metricKey: 'sideViewMinConfidence', thresholdPath: 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', direction: 'below' },
  { issueId: 'machine-ab-crunches.tempo_down', metricKey: 'tCrunch', thresholdPath: 'formThresholds.TEMPO_CRUNCH_MIN', direction: 'below' },
  { issueId: 'machine-ab-crunches.tempo_up', metricKey: 'tReturn', thresholdPath: 'formThresholds.TEMPO_RETURN_MIN', direction: 'below' },
  { issueId: 'machine-ab-crunches.tempo_jerk', metricKey: 'velocitySpikeRatio', thresholdPath: 'formThresholds.TEMPO_JERK_SPIKE_WARN', direction: 'above' },
  { issueId: 'machine-ab-crunches.arm_pull', metricKey: 'armPullP90Ratio', thresholdPath: 'formThresholds.ARM_PULL_WARN', direction: 'above' },
  { issueId: 'machine-ab-crunches.hips_moving', metricKey: 'hipShiftP90Ratio', thresholdPath: 'formThresholds.HIP_SHIFT_WARN', direction: 'above' },
];

const MACHINE_AB_CRUNCH_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'scoreTargets', target: SCORE_TARGETS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withMachineAbCrunchConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, MACHINE_AB_CRUNCH_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type AbCrunchPhase = 'REST' | 'CRUNCHING' | 'BOTTOM' | 'RETURNING';
type AbCrunchSide = 'left' | 'right';

interface Point2D {
  x: number;
  y: number;
}

interface RelativePoint {
  x: number;
  y: number;
}

interface AuxBaselines {
  elbowRel: RelativePoint | null;
  wristRel: RelativePoint | null;
  hipRelToKnee: RelativePoint | null;
}

interface HipAngleSample {
  angle: number;
  side: AbCrunchSide;
  confidence: number;
}

interface RepWindow {
  tStart: number;
  tBottom: number | null;
  tReturnStart: number | null;
  tEnd: number;
  selectedSide: AbCrunchSide;
  /** Top angle before the crunch attempt */
  startExtensionAngle: number;
  /** Deepest angle reached during the crunch */
  crunchDepthAngle: number;
  /** Best extension reached after the crunch has started returning */
  returnExtensionAngle: number;
  /** Max neck forward deviation during rep */
  maxNeckForward: number;
  neckForwardSamples: number[];
  /** Tracking/quality counters */
  frameCount: number;
  lowConfidenceFrames: number;
  hipConfidenceSamples: number;
  hipConfidenceSum: number;
  sideViewConfidenceSum: number;
  sideViewConfidenceMin: number;
  sideViewConfidenceSamples: number;
  /** Smoothness */
  lastHipAngle: number | null;
  lastMetricTime: number | null;
  velocitySum: number;
  velocitySamples: number;
  maxAngularVelocity: number;
  maxCrunchVelocity: number;
  maxReturnVelocity: number;
  lastReturnExtensionGainTime: number | null;
  angularVelocitySamples: number[];
  /** Arm-pull proxy */
  baselineElbowRel: RelativePoint | null;
  baselineWristRel: RelativePoint | null;
  maxArmPullRatio: number;
  armPullSamples: number;
  armPullRatioSamples: number[];
  /** Hip-stability proxy */
  baselineHipRelToKnee: RelativePoint | null;
  maxHipShiftRatio: number;
  hipShiftSamples: number;
  hipShiftRatioSamples: number[];
  reliability: ReturnType<typeof createPoseStateReliabilityAggregator>;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
  scorable?: boolean;
  qualityWarnings?: FrameworkRepResult['qualityWarnings'];
  diagnostics?: FrameworkRepResult['diagnostics'];
}

interface AbCrunchState {
  phase: AbCrunchPhase;
  repCount: number;
  tRepStart: number | null;
  tCrunchStart: number | null;
  repWindow: RepWindow | null;
  lastRepResult: RepResult | null;
  /** Smoothed angle trackers */
  hipAngleTracker: SmoothedAngleTracker;
  neckAngleTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  warmedUp: boolean;
  /** Max hip angle observed during REST (pre-crunch extension) */
  restMaxHipAngle: number;
  /** Side selected in setup / active rep */
  selectedSide: AbCrunchSide | null;
  /** Setup side-view samples */
  setupSideViewConfidences: number[];
  /** Top/rest baselines used by auxiliary form proxies */
  restAuxBaselines: Record<AbCrunchSide, AuxBaselines>;
  /** Current smoothed values (for debug) */
  smoothedHipAngle: number;
  fastHipAngle: number;
  smoothedNeckAngle: number;
  currentSideViewConfidence: number | null;
  /** Visual feedback */
  feedback: string | null;
  lastFeedbackTime: number;
}

interface AbCrunchDebugInfo {
  phase: AbCrunchPhase;
  side: AbCrunchSide | null;
  warmedUp: boolean;
  hipAngle: number | null;
  fastHipAngle: number | null;
  neckAngle: number | null;
  startExtensionAngle: number | null;
  crunchDepthAngle: number | null;
  returnExtensionAngle: number | null;
  romAngle: number | null;
  maxNeckForward: number | null;
  sideViewConfidence: number | null;
  armPullRatio: number | null;
  hipShiftRatio: number | null;
  velocitySpikeRatio: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function emptyAuxBaselines(): AuxBaselines {
  return {
    elbowRel: null,
    wristRel: null,
    hipRelToKnee: null,
  };
}

function createRestAuxBaselines(): Record<AbCrunchSide, AuxBaselines> {
  return {
    left: emptyAuxBaselines(),
    right: emptyAuxBaselines(),
  };
}

function createAbCrunchWarmupGate(): WarmupGate {
  return new WarmupGate({
    requiredJoints: [
      'left_shoulder', 'right_shoulder',
      'left_hip', 'right_hip',
      'left_knee', 'right_knee',
    ],
    requiredFrames: 10,
    visibilityThreshold: 0.2,
  });
}

function resetAbCrunchAfterTrackingInterruption(state: AbCrunchState): AbCrunchState {
  Object.assign(state, {
    phase: 'REST',
    tRepStart: null,
    tCrunchStart: null,
    repWindow: null,
    hipAngleTracker: new SmoothedAngleTracker(),
    neckAngleTracker: new SmoothedAngleTracker(),
    warmupGate: createAbCrunchWarmupGate(),
    warmedUp: false,
    restMaxHipAngle: -Infinity,
    selectedSide: null,
    setupSideViewConfidences: [],
    restAuxBaselines: createRestAuxBaselines(),
    smoothedHipAngle: 170,
    fastHipAngle: 170,
    smoothedNeckAngle: 0,
    currentSideViewConfidence: null,
  });
  return state;
}

function initializeState(): AbCrunchState {
  return {
    phase: 'REST',
    repCount: 0,
    tRepStart: null,
    tCrunchStart: null,
    repWindow: null,
    lastRepResult: null,
    hipAngleTracker: new SmoothedAngleTracker(),
    neckAngleTracker: new SmoothedAngleTracker(),
    warmupGate: createAbCrunchWarmupGate(),
    warmedUp: false,
    restMaxHipAngle: -Infinity,
    selectedSide: null,
    setupSideViewConfidences: [],
    restAuxBaselines: createRestAuxBaselines(),
    smoothedHipAngle: 170,
    fastHipAngle: 170,
    smoothedNeckAngle: 0,
    currentSideViewConfidence: null,
    feedback: null,
    lastFeedbackTime: 0,
  };
}

function initRepWindow(tStart: number, selectedSide: AbCrunchSide, startExtensionAngle: number): RepWindow {
  return {
    tStart,
    tBottom: null,
    tReturnStart: null,
    tEnd: tStart,
    selectedSide,
    startExtensionAngle,
    crunchDepthAngle: Infinity,
    returnExtensionAngle: -Infinity,
    maxNeckForward: 0,
    neckForwardSamples: [],
    frameCount: 0,
    lowConfidenceFrames: 0,
    hipConfidenceSamples: 0,
    hipConfidenceSum: 0,
    sideViewConfidenceSum: 0,
    sideViewConfidenceMin: Infinity,
    sideViewConfidenceSamples: 0,
    lastHipAngle: null,
    lastMetricTime: null,
    velocitySum: 0,
    velocitySamples: 0,
    maxAngularVelocity: 0,
    maxCrunchVelocity: 0,
    maxReturnVelocity: 0,
    lastReturnExtensionGainTime: null,
    angularVelocitySamples: [],
    baselineElbowRel: null,
    baselineWristRel: null,
    maxArmPullRatio: 0,
    armPullSamples: 0,
    armPullRatioSamples: [],
    baselineHipRelToKnee: null,
    maxHipShiftRatio: 0,
    hipShiftSamples: 0,
    hipShiftRatioSamples: [],
    reliability: createPoseStateReliabilityAggregator(),
  };
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

function getPoint(kp: Keypoint): Point2D {
  return { x: kp.x, y: kp.y };
}

function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function signalKeypoints(frameContext: ExerciseFrameContext | undefined, fallbackKeypoints: Keypoint[]): Keypoint[] {
  return frameContext?.imageKeypoints ?? fallbackKeypoints;
}

function visibleKeypoint(keypoints: Keypoint[], name: string, threshold = VISIBILITY_THRESHOLD): Keypoint | null {
  const keypoint = getKeypoint(keypoints, name);
  return isVisible(keypoint, threshold) ? keypoint : null;
}

function sideConfidence(keypoints: Keypoint[], side: AbCrunchSide, names: string[]): number {
  return minKeypointConfidence(keypoints, names.map((name) => `${side}_${name}`));
}

function calculateHipAngleForSide(keypoints: Keypoint[], side: AbCrunchSide): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`);
  const hip = visibleKeypoint(keypoints, `${side}_hip`);
  const knee = visibleKeypoint(keypoints, `${side}_knee`);
  if (!shoulder || !hip || !knee) return null;
  return calculateAngle2D(getPoint(shoulder), getPoint(hip), getPoint(knee));
}

function computeHipAngleSample(
  keypoints: Keypoint[],
  preferredSide?: AbCrunchSide | null,
  allowFallback = true,
): HipAngleSample | null {
  const sides: AbCrunchSide[] = preferredSide ? [preferredSide, preferredSide === 'left' ? 'right' : 'left'] : ['left', 'right'];
  const samples: HipAngleSample[] = [];

  for (const side of sides) {
    const angle = calculateHipAngleForSide(keypoints, side);
    if (angle === null) continue;
    samples.push({
      angle,
      side,
      confidence: sideConfidence(keypoints, side, ['shoulder', 'hip', 'knee']),
    });
  }

  if (samples.length === 0) return null;
  const preferredSample = preferredSide
    ? samples.find((sample) => sample.side === preferredSide)
    : null;
  if (preferredSample) {
    if (!allowFallback || preferredSample.confidence >= THRESHOLDS.PRIMARY_CONFIDENCE_MIN) {
      return preferredSample;
    }
  }
  if (!allowFallback) {
    return null;
  }
  return samples.sort((a, b) => b.confidence - a.confidence)[0];
}

function computeNeckForwardAngle(keypoints: Keypoint[], preferredSide?: AbCrunchSide | null): number | null {
  const sides: AbCrunchSide[] = preferredSide ? [preferredSide, preferredSide === 'left' ? 'right' : 'left'] : ['left', 'right'];
  let best: { angle: number; confidence: number } | null = null;

  for (const side of sides) {
    const ear = visibleKeypoint(keypoints, `${side}_ear`);
    const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`);
    const hip = visibleKeypoint(keypoints, `${side}_hip`);
    if (!ear || !shoulder || !hip) continue;
    const angle = calculateAngle2D(getPoint(ear), getPoint(shoulder), getPoint(hip));
    const confidence = sideConfidence(keypoints, side, ['ear', 'shoulder', 'hip']);
    if (!best || confidence > best.confidence) {
      best = { angle: Math.max(0, 180 - angle), confidence };
    }
  }

  return best?.angle ?? null;
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

function calculateTorsoHeight(keypoints: Keypoint[], side: AbCrunchSide): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`, FORM_CONFIDENCE_MIN);
  const hip = visibleKeypoint(keypoints, `${side}_hip`, FORM_CONFIDENCE_MIN);
  if (!shoulder || !hip) return null;
  const height = Math.abs(hip.y - shoulder.y);
  return height > 1e-6 ? height : null;
}

function relativeToShoulder(keypoints: Keypoint[], side: AbCrunchSide, jointName: 'elbow' | 'wrist'): RelativePoint | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`, FORM_CONFIDENCE_MIN);
  const joint = visibleKeypoint(keypoints, `${side}_${jointName}`, FORM_CONFIDENCE_MIN);
  if (!shoulder || !joint) return null;
  return { x: joint.x - shoulder.x, y: joint.y - shoulder.y };
}

function relativeToKnee(keypoints: Keypoint[], side: AbCrunchSide): RelativePoint | null {
  const hip = visibleKeypoint(keypoints, `${side}_hip`, FORM_CONFIDENCE_MIN);
  const knee = visibleKeypoint(keypoints, `${side}_knee`, FORM_CONFIDENCE_MIN);
  if (!hip || !knee) return null;
  return { x: hip.x - knee.x, y: hip.y - knee.y };
}

function relativeDeltaRatio(current: RelativePoint | null, baseline: RelativePoint | null, scale: number | null): number | null {
  if (!current || !baseline || scale === null || scale <= 1e-6) return null;
  return dist2D(current, baseline) / scale;
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMResult {
  phase: AbCrunchPhase;
  repCompleted: boolean;
}

function updateFSM(
  currentPhase: AbCrunchPhase,
  hipAngle: number,
  t: number,
  tRepStart: number | null,
): FSMResult {
  let phase = currentPhase;
  let repCompleted = false;

  switch (phase) {
    case 'REST':
      if (hipAngle < THRESHOLDS.CRUNCHING_ENTER) {
        phase = 'CRUNCHING';
      }
      break;

    case 'CRUNCHING':
      if (hipAngle < THRESHOLDS.BOTTOM_ENTER) {
        phase = 'BOTTOM';
      } else if (hipAngle >= THRESHOLDS.CRUNCHING_EXIT) {
        phase = 'REST';
      }
      break;

    case 'BOTTOM':
      if (hipAngle > THRESHOLDS.BOTTOM_EXIT) {
        phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      if (
        hipAngle >= THRESHOLDS.REST_REENTER &&
        tRepStart !== null &&
        (t - tRepStart) >= THRESHOLDS.MIN_REP_TIME
      ) {
        phase = 'REST';
        repCompleted = true;
      } else if (hipAngle < THRESHOLDS.BOTTOM_ENTER) {
        phase = 'BOTTOM';
      }
      break;
  }

  return { phase, repCompleted };
}

// ============================================================================
// REP ANALYSIS, SCORING, DIAGNOSTICS
// ============================================================================

function averageSideViewConfidence(repWindow: RepWindow): number | null {
  if (repWindow.sideViewConfidenceSamples === 0) return null;
  return repWindow.sideViewConfidenceSum / repWindow.sideViewConfidenceSamples;
}

function averageHipConfidence(repWindow: RepWindow): number | null {
  if (repWindow.hipConfidenceSamples === 0) return null;
  return repWindow.hipConfidenceSum / repWindow.hipConfidenceSamples;
}

function velocitySpikeRatio(repWindow: RepWindow): number | null {
  if (repWindow.velocitySamples === 0) return null;
  const mean = repWindow.velocitySum / repWindow.velocitySamples;
  if (mean <= 1e-6) return null;
  return repWindow.maxAngularVelocity / mean;
}

function percentile(values: number[], percentileRatio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, percentileRatio));
  const index = Math.ceil(clamped * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function countAbove(values: number[], threshold: number): number {
  return values.reduce((count, value) => count + (value > threshold ? 1 : 0), 0);
}

function ratioAbove(values: number[], threshold: number): number | null {
  if (values.length === 0) return null;
  return countAbove(values, threshold) / values.length;
}

function returnExtensionAngle(repWindow: RepWindow): number {
  if (Number.isFinite(repWindow.returnExtensionAngle)) return repWindow.returnExtensionAngle;
  return repWindow.startExtensionAngle;
}

function returnDeficitAngle(repWindow: RepWindow): number {
  return Math.max(0, repWindow.startExtensionAngle - returnExtensionAngle(repWindow));
}

function returnCompletionRatio(repWindow: RepWindow): number | null {
  const fullReturnRom = repWindow.startExtensionAngle - repWindow.crunchDepthAngle;
  if (!Number.isFinite(fullReturnRom) || fullReturnRom <= 1e-6) return null;
  return clamp01((returnExtensionAngle(repWindow) - repWindow.crunchDepthAngle) / fullReturnRom);
}

function romAngle(repWindow: RepWindow): number {
  if (!Number.isFinite(repWindow.startExtensionAngle) || !Number.isFinite(repWindow.crunchDepthAngle)) return 0;
  return Math.max(0, repWindow.startExtensionAngle - repWindow.crunchDepthAngle);
}

function hasSideViewEvidence(repWindow: RepWindow): boolean {
  return repWindow.sideViewConfidenceSamples >= SIDE_VIEW_MIN_SAMPLES;
}

function sideViewIsScorable(repWindow: RepWindow): boolean {
  if (!hasSideViewEvidence(repWindow)) return false;
  const averageConfidence = averageSideViewConfidence(repWindow);
  if (averageConfidence === null) return false;
  return (
    averageConfidence >= FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN &&
    repWindow.sideViewConfidenceMin >= FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN
  );
}

function hipConfidenceIsScorable(repWindow: RepWindow): boolean {
  if (repWindow.frameCount === 0) return false;
  const lowRate = repWindow.lowConfidenceFrames / repWindow.frameCount;
  const averageConfidence = averageHipConfidence(repWindow);
  return lowRate <= 0.35 && (averageConfidence === null || averageConfidence >= THRESHOLDS.PRIMARY_CONFIDENCE_MIN);
}

function isAbCrunchRepScorable(repWindow: RepWindow): boolean {
  return sideViewIsScorable(repWindow) && hipConfidenceIsScorable(repWindow);
}

function abCrunchQualityWarnings(repWindow: RepWindow): FrameworkRepResult['qualityWarnings'] {
  const warnings: FrameworkRepResult['qualityWarnings'] = [];
  if (!sideViewIsScorable(repWindow)) warnings.push('side_view_uncertain');
  if (!hipConfidenceIsScorable(repWindow)) warnings.push('missing_required_joints');
  return warnings;
}

function abCrunchSetupAnalysisStatus(state: AbCrunchState): CameraAnalysisStatus | null {
  if (state.setupSideViewConfidences.length < SETUP_SIDE_VIEW_MIN_SAMPLES) return null;
  const average = state.setupSideViewConfidences.reduce((sum, value) => sum + value, 0) /
    state.setupSideViewConfidences.length;
  const min = Math.min(...state.setupSideViewConfidences);
  const sideReady =
    average >= FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN &&
    min >= FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN;
  return cameraStatusFromExerciseFeedbackReadiness({
    viewReady: sideReady,
    viewRequired: 'side',
    viewCurrent: sideReady ? 'side' : 'front',
    fullReason: 'machine_ab_crunch_setup_side_view_ready',
    viewBlockedReason: 'machine_ab_crunch_setup_side_view_uncertain',
    viewBlockedMessage: 'Turn side-on for full form analysis',
  });
}

function abCrunchRepWindowAnalysisStatus(repWindow: RepWindow): CameraAnalysisStatus | null {
  if (!hasSideViewEvidence(repWindow)) return null;
  const viewQuality = buildAbCrunchViewQuality(repWindow);
  const reliability = reliabilityInterpretationForRepWindow(repWindow)?.interpretation ?? null;
  return cameraStatusFromExerciseFeedbackReadiness({
    reliability,
    viewReady: viewQuality.sideConfirmed,
    viewRequired: 'side',
    viewCurrent: diagnosticsViewFor(viewQuality),
    scorable: hipConfidenceIsScorable(repWindow),
    fullReason: 'machine_ab_crunch_live_full_feedback',
    viewBlockedReason: 'machine_ab_crunch_side_view_uncertain',
    viewBlockedMessage: 'Turn side-on for full form analysis',
  });
}

function abCrunchCompletedRepAnalysisStatus(
  repResult: Pick<FrameworkRepResult, 'scorable' | 'qualityWarnings' | 'diagnostics'> | null,
): CameraAnalysisStatus | null {
  if (!repResult?.diagnostics) return null;
  const qualityWarnings = repResult.qualityWarnings ?? [];
  return cameraStatusFromExerciseFeedbackReadiness({
    reliability: repResult.diagnostics.reliability ?? null,
    viewReady: !qualityWarnings.includes('side_view_uncertain'),
    viewRequired: 'side',
    viewCurrent: repResult.diagnostics.view,
    scorable: repResult.scorable,
    fullReason: 'machine_ab_crunch_completed_full_feedback',
    viewBlockedReason: 'machine_ab_crunch_completed_side_view_uncertain',
    viewBlockedMessage: 'Turn side-on for full form analysis',
  });
}

function tempoJerkTriggered(repWindow: RepWindow): boolean {
  const spikeRatio = velocitySpikeRatio(repWindow);
  return spikeRatio !== null && spikeRatio > FORM_THRESHOLDS.TEMPO_JERK_SPIKE_WARN;
}

function armPullEligible(repWindow: RepWindow): boolean {
  return repWindow.armPullSamples >= AUX_METRIC_MIN_SAMPLES;
}

function hipShiftEligible(repWindow: RepWindow): boolean {
  return repWindow.hipShiftSamples >= AUX_METRIC_MIN_SAMPLES;
}

function neckForwardEligible(repWindow: RepWindow): boolean {
  return repWindow.neckForwardSamples.length >= NECK_FORWARD_MIN_SAMPLES;
}

function neckForwardCueValue(repWindow: RepWindow): number | null {
  return neckForwardEligible(repWindow)
    ? percentile(repWindow.neckForwardSamples, 0.9)
    : null;
}

function armPullCueValue(repWindow: RepWindow): number | null {
  return armPullEligible(repWindow)
    ? percentile(repWindow.armPullRatioSamples, 0.9)
    : null;
}

function hipShiftCueValue(repWindow: RepWindow): number | null {
  return hipShiftEligible(repWindow)
    ? percentile(repWindow.hipShiftRatioSamples, 0.9)
    : null;
}

function minSideViewConfidence(repWindow: RepWindow): number | null {
  return repWindow.sideViewConfidenceSamples > 0 && Number.isFinite(repWindow.sideViewConfidenceMin)
    ? repWindow.sideViewConfidenceMin
    : null;
}

function buildAbCrunchViewQuality(repWindow: RepWindow): NonNullable<RepDiagnostics['viewQuality']> {
  const hasSamples = hasSideViewEvidence(repWindow);
  const averageConfidence = averageSideViewConfidence(repWindow);
  const minConfidence = minSideViewConfidence(repWindow);
  const sideConfirmed = hasSamples && sideViewIsScorable(repWindow);
  const frontishConfirmed = hasSamples && !sideConfirmed;

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
    minSideViewConfidence: minConfidence,
    sampleCount: hasSamples ? repWindow.sideViewConfidenceSamples : repWindow.hipConfidenceSamples,
  };
}

function diagnosticsViewFor(viewQuality: NonNullable<RepDiagnostics['viewQuality']>): RepDiagnostics['view'] {
  if (viewQuality.sideConfirmed) return 'side';
  if (viewQuality.frontishConfirmed) return 'front';
  return 'unknown';
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

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

function removeCueFamilies(source: string[], families: Iterable<string>): string[] {
  const familySet = new Set(families);
  return source.filter(family => !familySet.has(family));
}

function jointUnreliableRate(summary: PoseStateReliabilitySummary, jointName: string): number {
  return (summary.unreliableJointCounts[jointName] ?? 0) / Math.max(1, summary.totalFrames);
}

function sideJointReliable(summary: PoseStateReliabilitySummary, side: AbCrunchSide, jointName: string): boolean {
  return summary.totalFrames > 0 && jointUnreliableRate(summary, `${side}_${jointName}`) < 0.25;
}

function selectedHipAngleReliable(summary: PoseStateReliabilitySummary, side: AbCrunchSide): boolean {
  return (
    sideJointReliable(summary, side, 'shoulder') &&
    sideJointReliable(summary, side, 'hip') &&
    sideJointReliable(summary, side, 'knee')
  );
}

function selectedAuxiliaryArmReliable(summary: PoseStateReliabilitySummary, side: AbCrunchSide): boolean {
  return (
    sideJointReliable(summary, side, 'elbow') &&
    sideJointReliable(summary, side, 'wrist')
  );
}

function selectedNeckReliable(summary: PoseStateReliabilitySummary, side: AbCrunchSide): boolean {
  return sideJointReliable(summary, side, 'ear');
}

interface AbCrunchReliabilityResult {
  summary: PoseStateReliabilitySummary;
  interpretation: RepReliabilityInterpretation;
  selectedHipAngleReliable: boolean;
}

function reliabilityInterpretationForRepWindow(repWindow: RepWindow): AbCrunchReliabilityResult | null {
  const summary = repWindow.reliability.snapshot();
  if (summary.totalFrames === 0) return null;

  const baseInterpretation = interpretPoseStateReliabilitySummary('Machine Ab Crunches', summary);
  const hipAngleReliable = selectedHipAngleReliable(summary, repWindow.selectedSide);
  const auxArmReliable = selectedAuxiliaryArmReliable(summary, repWindow.selectedSide);
  const neckReliable = selectedNeckReliable(summary, repWindow.selectedSide);

  let countabilityCandidate = baseInterpretation.countabilityCandidate;
  let scoreabilityCandidate = baseInterpretation.scoreabilityCandidate;
  let safeCueFamilies = [...baseInterpretation.safeCueFamilies];
  let unsafeCueFamilies = [...baseInterpretation.unsafeCueFamilies];
  const reasons = [...baseInterpretation.reasons];

  if (hipAngleReliable) {
    safeCueFamilies = uniqueStrings([...safeCueFamilies, ...MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES]);
    unsafeCueFamilies = removeCueFamilies(unsafeCueFamilies, MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES);
  } else {
    const unsafeFamilies = [
      'repCount',
      'tempo',
      ...MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES,
      'setupPosture',
    ];
    safeCueFamilies = removeCueFamilies(safeCueFamilies, unsafeFamilies);
    unsafeCueFamilies = uniqueStrings([...unsafeCueFamilies, ...unsafeFamilies]);
    countabilityCandidate = countabilityCandidate === 'countable' ? 'maybe' : countabilityCandidate;
    scoreabilityCandidate = scoreabilityCandidate === 'fullyScoreable'
      ? 'partiallyScoreable'
      : scoreabilityCandidate;
    reasons.push(`${repWindow.selectedSide}_hip_angle_signal_weak`, 'hip_angle_cue_families_unsafe');
  }

  if (auxArmReliable) {
    safeCueFamilies = uniqueStrings([...safeCueFamilies, 'auxiliaryArmCue']);
    unsafeCueFamilies = removeCueFamilies(unsafeCueFamilies, ['auxiliaryArmCue']);
  } else {
    safeCueFamilies = removeCueFamilies(safeCueFamilies, ['auxiliaryArmCue']);
    unsafeCueFamilies = uniqueStrings([...unsafeCueFamilies, 'auxiliaryArmCue']);
    scoreabilityCandidate = scoreabilityCandidate === 'fullyScoreable'
      ? 'partiallyScoreable'
      : scoreabilityCandidate;
    reasons.push(`${repWindow.selectedSide}_auxiliary_arm_weak`);
  }

  if (neckReliable) {
    safeCueFamilies = uniqueStrings([...safeCueFamilies, 'neckPosition']);
    unsafeCueFamilies = removeCueFamilies(unsafeCueFamilies, ['neckPosition']);
  } else {
    safeCueFamilies = removeCueFamilies(safeCueFamilies, ['neckPosition']);
    unsafeCueFamilies = uniqueStrings([...unsafeCueFamilies, 'neckPosition']);
    scoreabilityCandidate = scoreabilityCandidate === 'fullyScoreable'
      ? 'partiallyScoreable'
      : scoreabilityCandidate;
    reasons.push(`${repWindow.selectedSide}_ear_weak`);
  }

  return {
    summary,
    selectedHipAngleReliable: hipAngleReliable,
    interpretation: {
      ...baseInterpretation,
      countabilityCandidate,
      scoreabilityCandidate,
      safeCueFamilies: uniqueStrings(safeCueFamilies),
      unsafeCueFamilies: uniqueStrings(unsafeCueFamilies),
      reasons: uniqueStrings(reasons),
    },
  };
}

function safeCueFamilySet(interpretation: RepReliabilityInterpretation | null): ReadonlySet<string> | undefined {
  return interpretation ? new Set(interpretation.safeCueFamilies) : undefined;
}

function reliabilityAllowsScoring(reliability: AbCrunchReliabilityResult | null): boolean {
  if (!reliability) return true;
  return (
    reliability.interpretation.scoreabilityCandidate !== 'notScoreable' &&
    reliability.interpretation.usableChains.includes('torso') &&
    reliability.selectedHipAngleReliable
  );
}

function suppressUnsafeReliabilityMessages(
  messages: string[],
  interpretation: RepReliabilityInterpretation | null,
): string[] {
  if (!interpretation) return messages;

  const unsafeFamilies = new Set(interpretation.unsafeCueFamilies);
  return messages.filter((message) => {
    const families = MACHINE_AB_CRUNCH_MESSAGE_CUE_FAMILIES[message] ?? [];
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
      const families = MACHINE_AB_CRUNCH_ISSUE_CUE_FAMILIES[issueId] ?? [];
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

function shouldLogMachineAbCrunchReliability(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    !(typeof process !== 'undefined' && process.env.JEST_WORKER_ID)
  );
}

function logMachineAbCrunchRepReliability(
  repIndex: number,
  interpretation: RepReliabilityInterpretation | null,
  diagnostics: FrameworkRepResult['diagnostics'],
): void {
  if (!interpretation || !shouldLogMachineAbCrunchReliability()) return;
  const reliability = diagnostics?.reliability;
  console.log([
    `[MachineAbCrunchReliability] rep=${repIndex}`,
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
  return MACHINE_AB_CRUNCH_RELIABILITY_JOINTS.some((jointName) => {
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

function observeMachineAbCrunchPoseState(
  repWindow: RepWindow,
  frameContext: ExerciseFrameContext | undefined,
): void {
  const poseState = frameContext?.poseState;
  if (!poseState || !poseStateHasRichReliabilityMetadata(poseState)) return;
  repWindow.reliability.observe(poseState);
}

function computeAbCrunchScore(
  repWindow: RepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  if (cueFamiliesAllowed(allowedCueFamilies, MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES)) {
    const crunchShortfall = Math.max(0, repWindow.crunchDepthAngle - SCORE_TARGETS.CRUNCH_IDEAL);
    penalties.push({ value: crunchShortfall, config: PENALTY_CONFIGS.CRUNCH_ROM });
  }

  if (cueFamiliesAllowed(allowedCueFamilies, MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES)) {
    const extensionShortfall = Math.max(0, SCORE_TARGETS.EXTENSION_IDEAL - returnExtensionAngle(repWindow));
    penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });
  }

  const neckForward = neckForwardCueValue(repWindow);
  if (
    neckForward !== null &&
    cueFamiliesAllowed(allowedCueFamilies, ['setupPosture', 'shoulderHipAlignment', 'neckPosition'])
  ) {
    penalties.push({ value: neckForward, config: PENALTY_CONFIGS.NECK_FORWARD });
  }

  const spikeRatio = velocitySpikeRatio(repWindow);
  if (spikeRatio !== null && cueFamilyAllowed(allowedCueFamilies, 'tempo')) {
    penalties.push({ value: spikeRatio, config: PENALTY_CONFIGS.TEMPO_JERK });
  }
  const armPull = armPullCueValue(repWindow);
  if (armPull !== null && cueFamilyAllowed(allowedCueFamilies, 'auxiliaryArmCue')) {
    penalties.push({ value: armPull, config: PENALTY_CONFIGS.ARM_PULL });
  }
  const hipShift = hipShiftCueValue(repWindow);
  if (hipShift !== null && cueFamiliesAllowed(allowedCueFamilies, ['setupPosture', 'kneeSupport', 'shoulderHipAlignment'])) {
    penalties.push({ value: hipShift, config: PENALTY_CONFIGS.HIP_SHIFT });
  }

  if (repWindow.tBottom !== null && cueFamilyAllowed(allowedCueFamilies, 'tempo')) {
    const tCrunch = repWindow.tBottom - repWindow.tStart;
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tBottom);

    if (tCrunch > 0 && tCrunch < PENALTY_CONFIGS.TEMPO_CRUNCH.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_CRUNCH.deadzone - tCrunch;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_CRUNCH, deadzone: 0 } });
    }
    if (tReturn > 0 && tReturn < PENALTY_CONFIGS.TEMPO_RETURN.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_RETURN.deadzone - tReturn;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_RETURN, deadzone: 0 } });
    }
  }

  return computeScore(penalties);
}

function generateUnscorableMessages(repWindow: RepWindow): string[] {
  return !sideViewIsScorable(repWindow) ? [FEEDBACK.SIDE_VIEW] : [];
}

function generateFormMessages(
  repWindow: RepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): string[] {
  const messages: string[] = [];
  if (
    repWindow.crunchDepthAngle > FORM_THRESHOLDS.CRUNCH_ROM_FAIL &&
    cueFamiliesAllowed(allowedCueFamilies, MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES)
  ) {
    messages.push(FEEDBACK.DEPTH_SHORT);
  }
  if (
    returnExtensionAngle(repWindow) < FORM_THRESHOLDS.EXTENSION_ROM_FAIL &&
    cueFamiliesAllowed(allowedCueFamilies, MACHINE_AB_CRUNCH_HIP_ANGLE_CUE_FAMILIES)
  ) {
    messages.push(FEEDBACK.LOCKOUT_SHORT);
  }
  const neckForward = neckForwardCueValue(repWindow);
  if (
    neckForward !== null &&
    neckForward > FORM_THRESHOLDS.NECK_FORWARD_WARN &&
    cueFamiliesAllowed(allowedCueFamilies, ['setupPosture', 'shoulderHipAlignment', 'neckPosition'])
  ) {
    messages.push(FEEDBACK.NECK_FORWARD);
  }

  if (repWindow.tBottom !== null && cueFamilyAllowed(allowedCueFamilies, 'tempo')) {
    const tCrunch = repWindow.tBottom - repWindow.tStart;
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tBottom);

    if (tCrunch > 0 && tCrunch < FORM_THRESHOLDS.TEMPO_CRUNCH_MIN) {
      messages.push(FEEDBACK.TEMPO_DOWN);
    }
    if (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) {
      messages.push(FEEDBACK.TEMPO_UP);
    }
  }

  if (tempoJerkTriggered(repWindow) && cueFamilyAllowed(allowedCueFamilies, 'tempo')) {
    messages.push(FEEDBACK.TEMPO_JERK);
  }
  const armPull = armPullCueValue(repWindow);
  if (armPull !== null && armPull > FORM_THRESHOLDS.ARM_PULL_WARN && cueFamilyAllowed(allowedCueFamilies, 'auxiliaryArmCue')) {
    messages.push(FEEDBACK.ARM_PULL);
  }
  const hipShift = hipShiftCueValue(repWindow);
  if (
    hipShift !== null &&
    hipShift > FORM_THRESHOLDS.HIP_SHIFT_WARN &&
    cueFamiliesAllowed(allowedCueFamilies, ['setupPosture', 'kneeSupport', 'shoulderHipAlignment'])
  ) {
    messages.push(FEEDBACK.HIPS_MOVING);
  }

  return messages;
}

function buildAbCrunchDiagnostics(
  repWindow: RepWindow,
  repIndex: number,
  scorable: boolean,
): NonNullable<FrameworkRepResult['diagnostics']> {
  const hasTempo = repWindow.tBottom !== null;
  const tCrunch = repWindow.tBottom !== null ? repWindow.tBottom - repWindow.tStart : null;
  const tReturn = repWindow.tBottom !== null ? repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tBottom) : null;
  const sideViewConfidence = averageSideViewConfidence(repWindow);
  const sideViewMinConfidence = minSideViewConfidence(repWindow);
  const hasSideViewConfidence = hasSideViewEvidence(repWindow);
  const viewQuality = buildAbCrunchViewQuality(repWindow);
  const spikeRatio = velocitySpikeRatio(repWindow);
  const hasArmPull = armPullEligible(repWindow);
  const hasHipShift = hipShiftEligible(repWindow);
  const hasNeckForward = neckForwardEligible(repWindow);
  const neckForwardP90 = percentile(repWindow.neckForwardSamples, 0.9);
  const neckForwardSupportFrames = countAbove(repWindow.neckForwardSamples, FORM_THRESHOLDS.NECK_FORWARD_WARN);
  const neckForwardSupportRatio = ratioAbove(repWindow.neckForwardSamples, FORM_THRESHOLDS.NECK_FORWARD_WARN);
  const angularVelocityP95 = percentile(repWindow.angularVelocitySamples, 0.95);
  const velocitySupportFrames = countAbove(repWindow.angularVelocitySamples, FORM_THRESHOLDS.TEMPO_JERK_VELOCITY_WARN);
  const velocitySupportRatio = ratioAbove(repWindow.angularVelocitySamples, FORM_THRESHOLDS.TEMPO_JERK_VELOCITY_WARN);
  const armPullP90 = percentile(repWindow.armPullRatioSamples, 0.9);
  const armPullSupportFrames = countAbove(repWindow.armPullRatioSamples, FORM_THRESHOLDS.ARM_PULL_WARN);
  const armPullSupportRatio = ratioAbove(repWindow.armPullRatioSamples, FORM_THRESHOLDS.ARM_PULL_WARN);
  const hipShiftP90 = percentile(repWindow.hipShiftRatioSamples, 0.9);
  const hipShiftSupportFrames = countAbove(repWindow.hipShiftRatioSamples, FORM_THRESHOLDS.HIP_SHIFT_WARN);
  const hipShiftSupportRatio = ratioAbove(repWindow.hipShiftRatioSamples, FORM_THRESHOLDS.HIP_SHIFT_WARN);

  return buildRepDiagnostics({
    exerciseName: 'Machine Ab Crunches',
    repIndex,
    view: diagnosticsViewFor(viewQuality),
    selectedSide: repWindow.selectedSide,
    scorable,
    viewQuality,
    metrics: [
      diagnosticMetric('startExtensionAngle', repWindow.startExtensionAngle, { unit: 'degrees' }),
      diagnosticMetric('crunchDepthAngle', repWindow.crunchDepthAngle, { unit: 'degrees' }),
      diagnosticMetric('extensionAngle', returnExtensionAngle(repWindow), { unit: 'degrees' }),
      diagnosticMetric('returnDeficitAngle', returnDeficitAngle(repWindow), { unit: 'degrees' }),
      diagnosticMetric('returnCompletionRatio', returnCompletionRatio(repWindow), { unit: 'ratio' }),
      diagnosticMetric('romAngle', romAngle(repWindow), { unit: 'degrees' }),
      diagnosticMetric('neckForward', hasNeckForward ? repWindow.maxNeckForward : null, {
        unit: 'degrees',
        eligible: hasNeckForward,
        sampleCount: repWindow.neckForwardSamples.length,
        skippedReason: 'insufficient_neck_samples',
      }),
      diagnosticMetric('neckForwardP90', hasNeckForward ? neckForwardP90 : null, {
        unit: 'degrees',
        eligible: hasNeckForward,
        sampleCount: repWindow.neckForwardSamples.length,
        skippedReason: 'insufficient_neck_samples',
      }),
      diagnosticMetric('neckForwardOverThresholdFrames', hasNeckForward ? neckForwardSupportFrames : null, {
        unit: 'count',
        eligible: hasNeckForward,
        sampleCount: repWindow.neckForwardSamples.length,
        skippedReason: 'insufficient_neck_samples',
      }),
      diagnosticMetric('neckForwardOverThresholdFrameRatio', hasNeckForward ? neckForwardSupportRatio : null, {
        unit: 'ratio',
        eligible: hasNeckForward,
        sampleCount: repWindow.neckForwardSamples.length,
        skippedReason: 'insufficient_neck_samples',
      }),
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
      diagnosticMetric('hipChainConfidence', averageHipConfidence(repWindow), {
        unit: 'ratio',
        sampleCount: repWindow.hipConfidenceSamples,
      }),
      diagnosticMetric('maxAngularVelocityDegPerSec', repWindow.maxAngularVelocity, { unit: 'degrees' }),
      diagnosticMetric('maxCrunchVelocityDegPerSec', repWindow.maxCrunchVelocity, { unit: 'degrees' }),
      diagnosticMetric('maxReturnVelocityDegPerSec', repWindow.maxReturnVelocity, { unit: 'degrees' }),
      diagnosticMetric('angularVelocityP95DegPerSec', angularVelocityP95, {
        unit: 'degrees',
        sampleCount: repWindow.angularVelocitySamples.length,
        skippedReason: 'velocity_unavailable',
      }),
      diagnosticMetric('angularVelocityOverThresholdFrames', velocitySupportFrames, {
        unit: 'count',
        eligible: repWindow.angularVelocitySamples.length > 0,
        sampleCount: repWindow.angularVelocitySamples.length,
        skippedReason: 'velocity_unavailable',
      }),
      diagnosticMetric('angularVelocityOverThresholdFrameRatio', velocitySupportRatio, {
        unit: 'ratio',
        sampleCount: repWindow.angularVelocitySamples.length,
        skippedReason: 'velocity_unavailable',
      }),
      diagnosticMetric('velocitySpikeRatio', spikeRatio, {
        unit: 'ratio',
        eligible: spikeRatio !== null,
        skippedReason: 'velocity_unavailable',
      }),
      diagnosticMetric('armPullRatio', repWindow.maxArmPullRatio, {
        unit: 'ratio',
        eligible: hasArmPull,
        sampleCount: repWindow.armPullSamples,
        skippedReason: 'insufficient_arm_samples',
      }),
      diagnosticMetric('armPullP90Ratio', armPullP90, {
        unit: 'ratio',
        eligible: hasArmPull,
        sampleCount: repWindow.armPullSamples,
        skippedReason: 'insufficient_arm_samples',
      }),
      diagnosticMetric('armPullOverThresholdFrames', armPullSupportFrames, {
        unit: 'count',
        eligible: hasArmPull,
        sampleCount: repWindow.armPullSamples,
        skippedReason: 'insufficient_arm_samples',
      }),
      diagnosticMetric('armPullOverThresholdFrameRatio', armPullSupportRatio, {
        unit: 'ratio',
        eligible: hasArmPull,
        sampleCount: repWindow.armPullSamples,
        skippedReason: 'insufficient_arm_samples',
      }),
      diagnosticMetric('hipShiftRatio', repWindow.maxHipShiftRatio, {
        unit: 'ratio',
        eligible: hasHipShift,
        sampleCount: repWindow.hipShiftSamples,
        skippedReason: 'insufficient_hip_shift_samples',
      }),
      diagnosticMetric('hipShiftP90Ratio', hipShiftP90, {
        unit: 'ratio',
        eligible: hasHipShift,
        sampleCount: repWindow.hipShiftSamples,
        skippedReason: 'insufficient_hip_shift_samples',
      }),
      diagnosticMetric('hipShiftOverThresholdFrames', hipShiftSupportFrames, {
        unit: 'count',
        eligible: hasHipShift,
        sampleCount: repWindow.hipShiftSamples,
        skippedReason: 'insufficient_hip_shift_samples',
      }),
      diagnosticMetric('hipShiftOverThresholdFrameRatio', hipShiftSupportRatio, {
        unit: 'ratio',
        eligible: hasHipShift,
        sampleCount: repWindow.hipShiftSamples,
        skippedReason: 'insufficient_hip_shift_samples',
      }),
      diagnosticMetric('tCrunch', tCrunch, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
      diagnosticMetric('tReturn', tReturn, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'machine-ab-crunches.depth_short',
        metricKeys: ['crunchDepthAngle'],
        direction: 'above',
        value: repWindow.crunchDepthAngle,
        thresholdPath: 'formThresholds.CRUNCH_ROM_FAIL',
        thresholdValue: FORM_THRESHOLDS.CRUNCH_ROM_FAIL,
        triggered: repWindow.crunchDepthAngle > FORM_THRESHOLDS.CRUNCH_ROM_FAIL,
      }),
      diagnosticCue({
        issueId: 'machine-ab-crunches.lockout_short',
        metricKeys: ['extensionAngle'],
        direction: 'below',
        value: returnExtensionAngle(repWindow),
        thresholdPath: 'formThresholds.EXTENSION_ROM_FAIL',
        thresholdValue: FORM_THRESHOLDS.EXTENSION_ROM_FAIL,
        triggered: returnExtensionAngle(repWindow) < FORM_THRESHOLDS.EXTENSION_ROM_FAIL,
      }),
      diagnosticCue({
        issueId: 'machine-ab-crunches.side_view_uncertain',
        metricKeys: ['sideViewConfidence', 'sideViewMinConfidence'],
        direction: 'below',
        value: sideViewConfidence,
        thresholdPath: [
          'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
          'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
        ],
        thresholdValue: {
          SIDE_VIEW_AVG_CONFIDENCE_MIN: FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN,
          SIDE_VIEW_MIN_CONFIDENCE_MIN: FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN,
        },
        eligible: hasSideViewConfidence,
        triggered: hasSideViewConfidence && !sideViewIsScorable(repWindow),
        skippedReason: 'insufficient_side_view_samples',
      }),
      diagnosticCue({
        issueId: 'machine-ab-crunches.neck_forward',
        metricKeys: ['neckForwardP90', 'neckForward'],
        direction: 'above',
        value: hasNeckForward ? neckForwardP90 : null,
        thresholdPath: 'formThresholds.NECK_FORWARD_WARN',
        thresholdValue: FORM_THRESHOLDS.NECK_FORWARD_WARN,
        eligible: hasNeckForward,
        support: hasNeckForward ? neckForwardSupportRatio ?? undefined : undefined,
        triggered: hasNeckForward && neckForwardP90 !== null && neckForwardP90 > FORM_THRESHOLDS.NECK_FORWARD_WARN,
        skippedReason: 'insufficient_neck_samples',
      }),
      diagnosticCue({
        issueId: 'machine-ab-crunches.tempo_down',
        metricKeys: ['tCrunch'],
        direction: 'below',
        value: tCrunch,
        thresholdPath: 'formThresholds.TEMPO_CRUNCH_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_CRUNCH_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tCrunch !== null && tCrunch > 0 && tCrunch < FORM_THRESHOLDS.TEMPO_CRUNCH_MIN,
        skippedReason: 'bottom_not_detected',
      }),
      diagnosticCue({
        issueId: 'machine-ab-crunches.tempo_up',
        metricKeys: ['tReturn'],
        direction: 'below',
        value: tReturn,
        thresholdPath: 'formThresholds.TEMPO_RETURN_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_RETURN_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tReturn !== null && tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN,
        skippedReason: 'bottom_not_detected',
      }),
      diagnosticCue({
        issueId: 'machine-ab-crunches.tempo_jerk',
        metricKeys: ['velocitySpikeRatio', 'maxCrunchVelocityDegPerSec', 'maxReturnVelocityDegPerSec'],
        direction: 'above',
        value: spikeRatio,
        thresholdPath: 'formThresholds.TEMPO_JERK_SPIKE_WARN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_JERK_SPIKE_WARN,
        eligible: spikeRatio !== null,
        support: velocitySupportRatio ?? undefined,
        triggered: tempoJerkTriggered(repWindow),
        skippedReason: 'velocity_unavailable',
      }),
      diagnosticCue({
        issueId: 'machine-ab-crunches.arm_pull',
        metricKeys: ['armPullP90Ratio', 'armPullRatio'],
        direction: 'above',
        value: hasArmPull ? armPullP90 : null,
        thresholdPath: 'formThresholds.ARM_PULL_WARN',
        thresholdValue: FORM_THRESHOLDS.ARM_PULL_WARN,
        eligible: hasArmPull,
        support: armPullSupportRatio ?? undefined,
        triggered: hasArmPull && armPullP90 !== null && armPullP90 > FORM_THRESHOLDS.ARM_PULL_WARN,
        skippedReason: 'insufficient_arm_samples',
      }),
      diagnosticCue({
        issueId: 'machine-ab-crunches.hips_moving',
        metricKeys: ['hipShiftP90Ratio', 'hipShiftRatio'],
        direction: 'above',
        value: hasHipShift ? hipShiftP90 : null,
        thresholdPath: 'formThresholds.HIP_SHIFT_WARN',
        thresholdValue: FORM_THRESHOLDS.HIP_SHIFT_WARN,
        eligible: hasHipShift,
        support: hipShiftSupportRatio ?? undefined,
        triggered: hasHipShift && hipShiftP90 !== null && hipShiftP90 > FORM_THRESHOLDS.HIP_SHIFT_WARN,
        skippedReason: 'insufficient_hip_shift_samples',
      }),
    ],
  });
}

function buildAbCrunchRepResult(repWindow: RepWindow, repIndex: number): RepResult {
  const reliability = reliabilityInterpretationForRepWindow(repWindow);
  const reliabilityInterpretation = reliability?.interpretation ?? null;
  const allowedCueFamilies = safeCueFamilySet(reliabilityInterpretation);
  const qualityScorable = isAbCrunchRepScorable(repWindow);
  const scorable = qualityScorable && reliabilityAllowsScoring(reliability);
  const score = scorable ? computeAbCrunchScore(repWindow, allowedCueFamilies) : 0;
  const messages = qualityScorable
    ? suppressUnsafeReliabilityMessages(generateFormMessages(repWindow, allowedCueFamilies), reliabilityInterpretation)
    : generateUnscorableMessages(repWindow);
  const qualityWarnings = abCrunchQualityWarnings(repWindow);
  const diagnostics = applyReliabilityCueGating(
    buildAbCrunchDiagnostics(repWindow, repIndex, scorable),
    reliabilityInterpretation,
    scorable,
  );
  logMachineAbCrunchRepReliability(repIndex, reliabilityInterpretation, diagnostics);
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

function recordSetupSideView(state: AbCrunchState, sideViewConfidence: number | null, t: number): void {
  if (sideViewConfidence === null || state.phase !== 'REST' || state.repWindow) return;
  state.setupSideViewConfidences.push(sideViewConfidence);
  if (state.setupSideViewConfidences.length > SETUP_SIDE_VIEW_MIN_SAMPLES) {
    state.setupSideViewConfidences.shift();
  }
  if (state.setupSideViewConfidences.length < SETUP_SIDE_VIEW_MIN_SAMPLES) return;
  if (state.lastFeedbackTime > 0 && t - state.lastFeedbackTime <= FEEDBACK_COOLDOWN_SECONDS) return;

  const average = state.setupSideViewConfidences.reduce((sum, value) => sum + value, 0) / state.setupSideViewConfidences.length;
  const min = Math.min(...state.setupSideViewConfidences);
  if (
    average < FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN ||
    min < FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN
  ) {
    state.feedback = FEEDBACK.SIDE_VIEW;
    state.lastFeedbackTime = t;
  }
}

function ensureRepWindow(
  state: AbCrunchState,
  tStart: number,
  selectedSide: AbCrunchSide,
  initialAngle: number,
): RepWindow {
  if (!state.repWindow) {
    const startExtensionAngle = Number.isFinite(state.restMaxHipAngle)
      ? Math.max(state.restMaxHipAngle, initialAngle)
      : initialAngle;
    state.repWindow = initRepWindow(tStart, selectedSide, startExtensionAngle);
    const baselines = state.restAuxBaselines[selectedSide];
    state.repWindow.baselineElbowRel = baselines.elbowRel;
    state.repWindow.baselineWristRel = baselines.wristRel;
    state.repWindow.baselineHipRelToKnee = baselines.hipRelToKnee;
  }
  return state.repWindow;
}

function updateRestAuxBaselines(
  state: AbCrunchState,
  keypoints: Keypoint[],
  side: AbCrunchSide,
): void {
  const elbowRel = relativeToShoulder(keypoints, side, 'elbow');
  const wristRel = relativeToShoulder(keypoints, side, 'wrist');
  const hipRel = relativeToKnee(keypoints, side);
  if (!elbowRel && !wristRel && !hipRel) return;

  const baselines = state.restAuxBaselines[side];
  if (!baselines.elbowRel && elbowRel) baselines.elbowRel = elbowRel;
  if (!baselines.wristRel && wristRel) baselines.wristRel = wristRel;
  if (!baselines.hipRelToKnee && hipRel) baselines.hipRelToKnee = hipRel;
}

function resetRestAuxBaselines(state: AbCrunchState): void {
  state.restAuxBaselines = createRestAuxBaselines();
}

function updateRepWindowMetrics(
  repWindow: RepWindow,
  keypoints: Keypoint[],
  phase: AbCrunchPhase,
  prevPhase: AbCrunchPhase,
  hipAngle: number,
  fastHipAngle: number,
  hipConfidence: number,
  neckAngle: number,
  neckConfidence: number,
  sideViewConfidence: number | null,
  t: number,
): void {
  repWindow.tEnd = t;
  repWindow.frameCount++;
  repWindow.hipConfidenceSamples++;
  repWindow.hipConfidenceSum += hipConfidence;
  if (hipConfidence < THRESHOLDS.PRIMARY_CONFIDENCE_MIN) {
    repWindow.lowConfidenceFrames++;
  }

  repWindow.crunchDepthAngle = Math.min(repWindow.crunchDepthAngle, fastHipAngle);

  if (
    phase === 'RETURNING' ||
    prevPhase === 'RETURNING' ||
    (Number.isFinite(repWindow.crunchDepthAngle) && hipAngle > repWindow.crunchDepthAngle + 4)
  ) {
    if (fastHipAngle > repWindow.returnExtensionAngle + 0.25) {
      repWindow.lastReturnExtensionGainTime = t;
    }
    repWindow.returnExtensionAngle = Math.max(repWindow.returnExtensionAngle, fastHipAngle);
  }

  if (!isNaN(neckAngle) && isFinite(neckAngle) && neckConfidence >= FORM_CONFIDENCE_MIN) {
    repWindow.maxNeckForward = Math.max(repWindow.maxNeckForward, neckAngle);
    repWindow.neckForwardSamples.push(neckAngle);
  }

  if (sideViewConfidence !== null) {
    repWindow.sideViewConfidenceSamples++;
    repWindow.sideViewConfidenceSum += sideViewConfidence;
    repWindow.sideViewConfidenceMin = Math.min(repWindow.sideViewConfidenceMin, sideViewConfidence);
  }

  if (repWindow.lastHipAngle !== null && repWindow.lastMetricTime !== null) {
    const dt = t - repWindow.lastMetricTime;
    if (dt > 0.016) {
      const delta = hipAngle - repWindow.lastHipAngle;
      const velocity = Math.abs(delta) / dt;
      repWindow.velocitySamples++;
      repWindow.velocitySum += velocity;
      repWindow.maxAngularVelocity = Math.max(repWindow.maxAngularVelocity, velocity);
      repWindow.angularVelocitySamples.push(velocity);
      if (delta < 0) {
        repWindow.maxCrunchVelocity = Math.max(repWindow.maxCrunchVelocity, velocity);
      } else if (delta > 0) {
        repWindow.maxReturnVelocity = Math.max(repWindow.maxReturnVelocity, velocity);
      }
    }
  }
  repWindow.lastHipAngle = hipAngle;
  repWindow.lastMetricTime = t;

  const torsoHeight = calculateTorsoHeight(keypoints, repWindow.selectedSide);
  const elbowRel = relativeToShoulder(keypoints, repWindow.selectedSide, 'elbow');
  const wristRel = relativeToShoulder(keypoints, repWindow.selectedSide, 'wrist');
  if (!repWindow.baselineElbowRel && elbowRel) repWindow.baselineElbowRel = elbowRel;
  if (!repWindow.baselineWristRel && wristRel) repWindow.baselineWristRel = wristRel;
  const elbowDelta = relativeDeltaRatio(elbowRel, repWindow.baselineElbowRel, torsoHeight);
  const wristDelta = relativeDeltaRatio(wristRel, repWindow.baselineWristRel, torsoHeight);
  if (elbowDelta !== null || wristDelta !== null) {
    const armPullRatio = Math.max(elbowDelta ?? 0, wristDelta ?? 0);
    repWindow.armPullSamples++;
    repWindow.maxArmPullRatio = Math.max(repWindow.maxArmPullRatio, armPullRatio);
    repWindow.armPullRatioSamples.push(armPullRatio);
  }

  const hipRel = relativeToKnee(keypoints, repWindow.selectedSide);
  if (!repWindow.baselineHipRelToKnee && hipRel) repWindow.baselineHipRelToKnee = hipRel;
  const hipShift = relativeDeltaRatio(hipRel, repWindow.baselineHipRelToKnee, torsoHeight);
  if (hipShift !== null) {
    repWindow.hipShiftSamples++;
    repWindow.maxHipShiftRatio = Math.max(repWindow.maxHipShiftRatio, hipShift);
    repWindow.hipShiftRatioSamples.push(hipShift);
  }

  if (phase === 'BOTTOM' && repWindow.tBottom === null) {
    repWindow.tBottom = t;
  }

  if (
    prevPhase === 'BOTTOM' &&
    repWindow.crunchDepthAngle < Infinity &&
    fastHipAngle > repWindow.crunchDepthAngle + 6 &&
    repWindow.tReturnStart === null
  ) {
    repWindow.tReturnStart = t;
  }
}

function markRepWindowLowConfidence(
  repWindow: RepWindow,
  hipConfidence: number,
  sideViewConfidence: number | null,
): void {
  repWindow.frameCount++;
  repWindow.lowConfidenceFrames++;
  repWindow.hipConfidenceSamples++;
  repWindow.hipConfidenceSum += hipConfidence;
  if (sideViewConfidence !== null) {
    repWindow.sideViewConfidenceSamples++;
    repWindow.sideViewConfidenceSum += sideViewConfidence;
    repWindow.sideViewConfidenceMin = Math.min(repWindow.sideViewConfidenceMin, sideViewConfidence);
  }
}

function finalizeRep(state: AbCrunchState, repWindow: RepWindow, t: number): void {
  state.repCount++;
  state.lastRepResult = buildAbCrunchRepResult(repWindow, state.repCount);
  state.feedback = state.lastRepResult.messages.length > 0
    ? state.lastRepResult.messages.join('\n')
    : state.lastRepResult.scorable === false
      ? null
      : 'Great rep!';
  state.lastFeedbackTime = t;
  state.repWindow = null;
  state.tRepStart = null;
  state.tCrunchStart = null;
  state.setupSideViewConfidences = [];
  resetRestAuxBaselines(state);
}

function updateAbCrunchState(
  keypoints: Keypoint[],
  state: AbCrunchState,
  frameContext?: ExerciseFrameContext,
): AbCrunchState {
  const t = Date.now() / 1000;
  const analysisKeypoints = signalKeypoints(frameContext, keypoints);

  if (frameContext?.trackingInterrupted) {
    return resetAbCrunchAfterTrackingInterruption(state);
  }

  if (!state.warmedUp) {
    const stable = state.warmupGate.update(analysisKeypoints);
    if (!stable) return state;
    state.warmedUp = true;
  }

  const sideViewConfidence = calculateSideViewConfidence(analysisKeypoints);
  state.currentSideViewConfidence = sideViewConfidence;
  recordSetupSideView(state, sideViewConfidence, t);

  const preferredSide = state.repWindow?.selectedSide ?? state.selectedSide;
  const allowSideFallback = !(state.repWindow && state.repWindow.frameCount >= 3);
  const rawHipSample = computeHipAngleSample(analysisKeypoints, preferredSide, allowSideFallback);
  if (rawHipSample === null) {
    if (state.repWindow) {
      observeMachineAbCrunchPoseState(state.repWindow, frameContext);
      markRepWindowLowConfidence(state.repWindow, 0, sideViewConfidence);
    }
    return state;
  }

  if (rawHipSample.confidence < THRESHOLDS.PRIMARY_CONFIDENCE_MIN) {
    if (state.repWindow) {
      observeMachineAbCrunchPoseState(state.repWindow, frameContext);
      markRepWindowLowConfidence(state.repWindow, rawHipSample.confidence, sideViewConfidence);
    }
    if (state.feedback && t - state.lastFeedbackTime > 2.0) state.feedback = null;
    return state;
  }

  if (!state.repWindow) state.selectedSide = rawHipSample.side;

  const rawNeckAngle = computeNeckForwardAngle(analysisKeypoints, state.repWindow?.selectedSide ?? rawHipSample.side);
  const neckConf = sideConfidence(analysisKeypoints, state.repWindow?.selectedSide ?? rawHipSample.side, ['ear', 'shoulder', 'hip']);

  const smoothedHipAngle = state.hipAngleTracker.push(rawHipSample.angle, rawHipSample.confidence);
  const fastHipAngle = state.hipAngleTracker.medianValue;
  const smoothedNeckAngle = rawNeckAngle !== null
    ? state.neckAngleTracker.push(rawNeckAngle, neckConf)
    : state.neckAngleTracker.value;

  state.smoothedHipAngle = smoothedHipAngle;
  state.fastHipAngle = isNaN(fastHipAngle) ? smoothedHipAngle : fastHipAngle;
  state.smoothedNeckAngle = smoothedNeckAngle;

  if (state.phase === 'REST') {
    state.restMaxHipAngle = Math.max(state.restMaxHipAngle, smoothedHipAngle);
    if (!state.repWindow && rawHipSample.angle >= THRESHOLDS.CRUNCH_CLOCK_START) {
      updateRestAuxBaselines(state, analysisKeypoints, rawHipSample.side);
    }
    if (state.fastHipAngle < THRESHOLDS.CRUNCH_CLOCK_START) {
      state.tCrunchStart ??= t;
    } else {
      state.tCrunchStart = null;
    }
  }

  if (
    state.phase === 'REST' &&
    !state.repWindow &&
    isFinite(state.restMaxHipAngle) &&
    state.restMaxHipAngle - smoothedHipAngle >= THRESHOLDS.MIN_PARTIAL_ROM
  ) {
    const tStart = state.tCrunchStart ?? t;
    ensureRepWindow(state, tStart, rawHipSample.side, smoothedHipAngle);
  }

  const fsmResult = updateFSM(state.phase, state.fastHipAngle, t, state.tRepStart);
  const prevPhase = state.phase;
  state.phase = fsmResult.phase;

  if (prevPhase === 'REST' && state.phase === 'CRUNCHING') {
    state.selectedSide = state.repWindow?.selectedSide ?? rawHipSample.side;
    state.tRepStart = state.repWindow?.tStart ?? state.tCrunchStart ?? t;
    ensureRepWindow(state, state.tRepStart, state.selectedSide, smoothedHipAngle);
    state.restMaxHipAngle = -Infinity;
    state.tCrunchStart = null;
  }

  const inRep = state.phase !== 'REST';
  const trackingPartialInRest = state.phase === 'REST' && prevPhase === 'REST';
  if (state.repWindow && (inRep || trackingPartialInRest)) {
    observeMachineAbCrunchPoseState(state.repWindow, frameContext);
    updateRepWindowMetrics(
      state.repWindow,
      analysisKeypoints,
      state.phase,
      prevPhase,
      smoothedHipAngle,
      state.fastHipAngle,
      rawHipSample.confidence,
      smoothedNeckAngle,
      neckConf,
      sideViewConfidence,
      t,
    );
  }

  if (prevPhase === 'REST' && state.phase === 'REST' && state.repWindow) {
    const w = state.repWindow;
    const actualRom = romAngle(w);
    const duration = w.tEnd - w.tStart;
    const extension = returnExtensionAngle(w);
    const fullyReturned = extension >= FORM_THRESHOLDS.EXTENSION_ROM_FAIL;
    const partialReturnSettled =
      extension >= THRESHOLDS.REST_REENTER &&
      w.lastReturnExtensionGainTime !== null &&
      w.tEnd - w.lastReturnExtensionGainTime >= 0.35;
    const returnedToRest =
      actualRom >= THRESHOLDS.MIN_PARTIAL_ROM &&
      state.fastHipAngle > w.crunchDepthAngle + 6 &&
      (fullyReturned || partialReturnSettled);

    if (returnedToRest) {
      w.returnExtensionAngle = Math.max(w.returnExtensionAngle, smoothedHipAngle);
      if (isMeaningfulPartialRep({
        actualRom,
        minRom: THRESHOLDS.MIN_PARTIAL_ROM,
        duration,
        minDuration: THRESHOLDS.MIN_REP_TIME,
      })) {
        finalizeRep(state, w, t);
      } else if (actualRom > 0) {
        state.feedback = LOW_ROM_FEEDBACK;
        state.lastFeedbackTime = t;
        state.repWindow = null;
        state.tRepStart = null;
        state.tCrunchStart = null;
      }
    }
  }

  if (fsmResult.repCompleted && state.repWindow) {
    state.repWindow.returnExtensionAngle = Math.max(state.repWindow.returnExtensionAngle, state.fastHipAngle);
  }

  if (prevPhase === 'CRUNCHING' && state.phase === 'REST' && !fsmResult.repCompleted) {
    if (state.repWindow) {
      const w = state.repWindow;
      const actualRom = romAngle(w);
      const duration = w.tEnd - w.tStart;

      if (isMeaningfulPartialRep({
        actualRom,
        minRom: THRESHOLDS.MIN_PARTIAL_ROM,
        duration,
        minDuration: THRESHOLDS.MIN_REP_TIME,
      })) {
        finalizeRep(state, w, t);
      } else if (actualRom > 0) {
        state.feedback = LOW_ROM_FEEDBACK;
        state.lastFeedbackTime = t;
        state.repWindow = null;
        state.tRepStart = null;
        state.tCrunchStart = null;
      }
    }
  }

  if (state.feedback && t - state.lastFeedbackTime > 2.0) {
    state.feedback = null;
  }

  return state;
}

// ============================================================================
// DEBUG INFO
// ============================================================================

function getDebugInfo(state: AbCrunchState): AbCrunchDebugInfo {
  const fmt = (v: number): number | null =>
    !isNaN(v) && isFinite(v) ? v : null;

  const w = state.repWindow;
  return {
    phase: state.phase,
    side: w?.selectedSide ?? state.selectedSide,
    warmedUp: state.warmedUp,
    hipAngle: fmt(state.smoothedHipAngle),
    fastHipAngle: fmt(state.fastHipAngle),
    neckAngle: fmt(state.smoothedNeckAngle),
    startExtensionAngle: w ? fmt(w.startExtensionAngle) : null,
    crunchDepthAngle: w && w.crunchDepthAngle < Infinity ? fmt(w.crunchDepthAngle) : null,
    returnExtensionAngle: w && w.returnExtensionAngle > -Infinity ? fmt(w.returnExtensionAngle) : null,
    romAngle: w ? fmt(romAngle(w)) : null,
    maxNeckForward: w ? fmt(w.maxNeckForward) : null,
    sideViewConfidence: state.currentSideViewConfidence !== null ? fmt(state.currentSideViewConfidence) : null,
    armPullRatio: w && armPullEligible(w) ? fmt(w.maxArmPullRatio) : null,
    hipShiftRatio: w && hipShiftEligible(w) ? fmt(w.maxHipShiftRatio) : null,
    velocitySpikeRatio: w ? (velocitySpikeRatio(w) !== null ? fmt(velocitySpikeRatio(w)!) : null) : null,
  };
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================

function configNumber(config: ExerciseHeuristicConfig, path: string, issues: string[]): number | null {
  const value = getConfigValue(config, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`Machine Ab Crunch config "${path}" must be a finite number.`);
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
      `Machine Ab Crunch config ordering invalid: "${firstPath}" (${first}) must be ${allowEqual ? '<=' : '<'} "${secondPath}" (${second}).`,
    );
  }
}

function validatePenaltyConfigs(config: ExerciseHeuristicConfig, issues: string[]): void {
  const penaltyConfigs = getConfigValue(config, 'penaltyConfigs');
  if (penaltyConfigs === null || typeof penaltyConfigs !== 'object' || Array.isArray(penaltyConfigs)) {
    issues.push('Machine Ab Crunch config "penaltyConfigs" must be an object.');
    return;
  }

  for (const [penaltyName, penaltyConfig] of Object.entries(penaltyConfigs)) {
    if (penaltyConfig === null || typeof penaltyConfig !== 'object' || Array.isArray(penaltyConfig)) {
      issues.push(`Machine Ab Crunch penalty config "${penaltyName}" must be an object.`);
      continue;
    }
    for (const [key, value] of Object.entries(penaltyConfig)) {
      const path = `penaltyConfigs.${penaltyName}.${key}`;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(`Machine Ab Crunch config "${path}" must be a finite number.`);
        continue;
      }
      if (key === 'scale' && value <= 0) {
        issues.push(`Machine Ab Crunch config "${path}" must be greater than 0.`);
      }
      if (key === 'cap' && value < 0) {
        issues.push(`Machine Ab Crunch config "${path}" must be greater than or equal to 0.`);
      }
      if (key === 'deadzone' && value < 0) {
        issues.push(`Machine Ab Crunch config "${path}" must be greater than or equal to 0.`);
      }
    }
  }
}

function validateMachineAbCrunchHeuristicConfig(config: ExerciseHeuristicConfig): string[] {
  const issues: string[] = [];

  requireOrdered(config, issues, 'thresholds.BOTTOM_ENTER', 'thresholds.BOTTOM_EXIT');
  requireOrdered(config, issues, 'thresholds.BOTTOM_EXIT', 'thresholds.CRUNCHING_ENTER', true);
  requireOrdered(config, issues, 'thresholds.CRUNCHING_ENTER', 'thresholds.REST_REENTER', true);
  requireOrdered(config, issues, 'thresholds.REST_REENTER', 'thresholds.CRUNCHING_EXIT', true);
  requireOrdered(config, issues, 'thresholds.CRUNCHING_EXIT', 'thresholds.CRUNCH_CLOCK_START');
  requireOrdered(config, issues, 'scoreTargets.CRUNCH_IDEAL', 'formThresholds.CRUNCH_ROM_FAIL', true);
  requireOrdered(config, issues, 'formThresholds.CRUNCH_ROM_FAIL', 'formThresholds.EXTENSION_ROM_FAIL');
  requireOrdered(config, issues, 'formThresholds.EXTENSION_ROM_FAIL', 'scoreTargets.EXTENSION_IDEAL', true);
  requireOrdered(config, issues, 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', 'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN', true);

  for (const path of [
    'thresholds.CRUNCH_CLOCK_START',
    'thresholds.CRUNCHING_ENTER',
    'thresholds.BOTTOM_ENTER',
    'thresholds.BOTTOM_EXIT',
    'thresholds.CRUNCHING_EXIT',
    'thresholds.REST_REENTER',
    'thresholds.MIN_PARTIAL_ROM',
    'formThresholds.CRUNCH_ROM_FAIL',
    'formThresholds.EXTENSION_ROM_FAIL',
    'formThresholds.NECK_FORWARD_WARN',
    'formThresholds.TEMPO_JERK_VELOCITY_WARN',
    'scoreTargets.CRUNCH_IDEAL',
    'scoreTargets.EXTENSION_IDEAL',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value <= 0 || value > 180)) {
      issues.push(`Machine Ab Crunch config "${path}" must be greater than 0 and at most 180.`);
    }
  }

  for (const path of [
    'thresholds.MIN_REP_TIME',
    'formThresholds.TEMPO_CRUNCH_MIN',
    'formThresholds.TEMPO_RETURN_MIN',
    'formThresholds.TEMPO_JERK_SPIKE_WARN',
    'formThresholds.ARM_PULL_WARN',
    'formThresholds.HIP_SHIFT_WARN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && value <= 0) {
      issues.push(`Machine Ab Crunch config "${path}" must be greater than 0.`);
    }
  }

  for (const path of [
    'thresholds.PRIMARY_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value < 0 || value > 1)) {
      issues.push(`Machine Ab Crunch config "${path}" must be between 0 and 1.`);
    }
  }

  validatePenaltyConfigs(config, issues);
  return issues;
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createMachineAbCrunchDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_MACHINE_AB_CRUNCH_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Machine Ab Crunches',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    repQualityWindowActive: false,
    liveQualityWarnings: [],
    liveAnalysisStatus: null,
    _internal: withMachineAbCrunchConfig(config, () => initializeState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState, frameContext?: ExerciseFrameContext): ExerciseState => {
    const internal = state._internal as AbCrunchState;
    withMachineAbCrunchConfig(config, () => updateAbCrunchState(keypoints, internal, frameContext));

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
    const updateLiveCameraAnalysis = completedNewRep || frameContext?.cameraAnalysisStatusRequested !== false;
    const liveQualityWarnings = internal.repWindow
      ? abCrunchQualityWarnings(internal.repWindow)
      : completedNewRep
        ? (lastRepResult?.qualityWarnings ?? [])
        : [];
    const liveAnalysisStatus = updateLiveCameraAnalysis
      ? internal.repWindow
        ? abCrunchRepWindowAnalysisStatus(internal.repWindow)
        : completedNewRep
          ? abCrunchCompletedRepAnalysisStatus(lastRepResult)
          : abCrunchSetupAnalysisStatus(internal)
      : (state.liveAnalysisStatus ?? null);

    return {
      repCount: internal.repCount,
      lastRepResult,
      feedback: internal.feedback,
      feedbackTimestamp: internal.lastFeedbackTime > 0 ? internal.lastFeedbackTime : null,
      debugInfo: getDebugInfo(internal) as unknown as Record<string, unknown>,
      repQualityWindowActive: internal.repWindow !== null,
      liveQualityWarnings,
      liveAnalysisStatus,
      _internal: internal,
    };
  },

  heuristicConfig: config,
  tunableSpec: MACHINE_AB_CRUNCH_TUNABLE_SPEC,
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/machineAbCrunch.json',
  createVariant: (variantConfig) =>
    createMachineAbCrunchDefinition(mergeHeuristicConfig(config, variantConfig)),
  validateHeuristicConfig: validateMachineAbCrunchHeuristicConfig,

  ttsConfig: {
    feedbackToIssue: {
      [FEEDBACK.DEPTH_SHORT]: 'depth_short',
      [FEEDBACK.LOCKOUT_SHORT]: 'lockout_short',
      [FEEDBACK.NECK_FORWARD]: 'neck_forward',
      [FEEDBACK.TEMPO_DOWN]: 'tempo_down',
      [FEEDBACK.TEMPO_UP]: 'tempo_up',
      [FEEDBACK.SIDE_VIEW]: 'side_view_uncertain',
      [FEEDBACK.TEMPO_JERK]: 'tempo_jerk',
      [FEEDBACK.ARM_PULL]: 'arm_pull',
      [FEEDBACK.HIPS_MOVING]: 'hips_moving',
    },
    feedbackMessages: {
      [FEEDBACK.DEPTH_SHORT]: [
        'Crunch deeper.',
        'Bring your ribs toward your hips.',
        'Curl down a little farther.',
      ],
      [FEEDBACK.LOCKOUT_SHORT]: [
        'Return all the way upright.',
        'Reset tall before the next crunch.',
        'Open back up at the top.',
      ],
      [FEEDBACK.TEMPO_DOWN]: [
        'Slow the crunch down.',
        'Curl with control.',
        'Squeeze through your abs.',
      ],
      [FEEDBACK.TEMPO_UP]: [
        'Control the return.',
        'Resist on the way back.',
        'Come back up slowly.',
      ],
      [FEEDBACK.SIDE_VIEW]: [
        'Turn fully side-on.',
        'Set the camera perpendicular.',
        'Give me a clearer side view.',
      ],
      [FEEDBACK.TEMPO_JERK]: [
        'Move smoothly.',
        'No jerking the weight.',
        'Keep the crunch controlled.',
      ],
      [FEEDBACK.ARM_PULL]: [
        'Use your abs, not your arms.',
        'Keep the handles light.',
        'Let your abs drive the crunch.',
      ],
      [FEEDBACK.HIPS_MOVING]: [
        'Keep your hips planted.',
        'Anchor your hips to the seat.',
        'Flex from your waist.',
      ],
    },
    issueDefinitions: [
      {
        issueType: 'neck_forward',
        priority: 20,
        messages: [
          'Keep your neck neutral.',
          'Don\'t pull with your head.',
          'Chin stays tucked.',
          'Lead with your chest, not your head.',
        ],
      },
      {
        issueType: 'side_view_uncertain',
        priority: 90,
        messages: [
          'Turn fully side-on.',
          'Set the camera perpendicular.',
          'I need a clear side view.',
        ],
      },
      {
        issueType: 'tempo_jerk',
        priority: 35,
        messages: [
          'Move smoothly.',
          'Avoid jerking the weight.',
          'Keep the motion controlled.',
        ],
      },
      {
        issueType: 'arm_pull',
        priority: 45,
        messages: [
          'Use your abs, not your arms.',
          'Keep the handles light.',
          'Let your abs do the work.',
        ],
      },
      {
        issueType: 'hips_moving',
        priority: 40,
        messages: [
          'Keep your hips planted.',
          'Anchor your hips to the seat.',
          'Flex from your waist.',
        ],
      },
    ],
  },

  summaryConfig: {
    [FEEDBACK.DEPTH_SHORT]:
      'Focus on curling your torso forward fully to maximize ab engagement. Think about bringing your ribcage toward your pelvis.',
    [FEEDBACK.LOCKOUT_SHORT]:
      'Return to the full upright position between reps to maintain the full range of motion and get a stretch at the top.',
    [FEEDBACK.NECK_FORWARD]:
      'Keep your head in line with your spine throughout the movement. Pulling with your neck reduces ab activation and risks neck strain.',
    [FEEDBACK.TEMPO_DOWN]:
      'Control the concentric phase — aim for 1-2 seconds on the crunch down to maintain tension on your abs.',
    [FEEDBACK.TEMPO_UP]:
      'Slow the eccentric phase — resist the weight for 2-3 seconds on the way back for better ab engagement.',
    [FEEDBACK.SIDE_VIEW]:
      'Set the camera fully side-on so torso flexion, hip position, and neck position can be judged reliably.',
    [FEEDBACK.TEMPO_JERK]:
      'Use a smooth, controlled crunch instead of yanking the weight. Keep tension through the full movement.',
    [FEEDBACK.ARM_PULL]:
      'Grip the handles lightly and let the abs drive the movement instead of pulling hard with your arms.',
    [FEEDBACK.HIPS_MOVING]:
      'Keep your hips planted in the seat and flex from your waist so the movement stays focused on your abs.',
  },
  };
}

export const machineAbCrunchDefinition: ExerciseDefinition = createMachineAbCrunchDefinition();
