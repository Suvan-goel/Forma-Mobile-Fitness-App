/**
 * Cable Pushdowns -- Exercise Definition
 *
 * Side view, reach ratio as primary driver (camera-invariant).
 * FSM: REST -> EXTENDING -> EXTENDED -> RETURNING -> REST
 * Arms start bent (ratio ~0.50-0.65), push down to near-full extension (ratio ~0.95-1.0),
 * then return. One rep = full push-down + controlled return.
 *
 * Reach ratio = dist2D(shoulder,wrist) / (dist2D(shoulder,elbow) + dist2D(elbow,wrist))
 *   low ratio  = arm bent (start/rest position)
 *   high ratio = arm extended (lockout position)
 *
 * The only export is `cablePushdownDefinition`.
 */

import {
  Keypoint,
  calculateAngle,
  calculateAngle2D,
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
  diagnosticLabelMetric,
  diagnosticMetric,
} from '../shared/diagnostics';
import {
  applyCableCueGatingToDiagnostics,
  resolveCableViewCueDecision,
  type CableCueViewRequirement,
} from '../shared/cableViewGating';
import {
  cameraStatusFromViewCueGating,
  countOnlyCameraStatus,
  type CameraAnalysisStatus,
} from '../shared/cameraAnalysisStatus';
import { createPoseStateReliabilityAggregator } from '../../pose/buildPoseState';
import {
  interpretPoseStateReliabilitySummary,
  type RepReliabilityInterpretation,
} from '../shared/reliabilityInterpretation';
import tunedConfig from './tuned/cablePushdown.json';
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
// HELPERS (module-private)
// ============================================================================

type Point2D = { x: number; y: number };
type LandmarkSourceName = 'world' | 'image' | 'fallback';

interface MetricSample {
  value: number;
  source: LandmarkSourceName;
  keypoints: Keypoint[];
}

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

/** Euclidean distance using only x, y. */
function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute normalized arm reach ratio.
 * reach = dist2D(shoulder, wrist) / (dist2D(shoulder, elbow) + dist2D(elbow, wrist))
 *
 * ~0.95-1.0  = arm nearly straight (full extension / lockout)
 * ~0.50-0.65 = arm bent (start position)
 */
function computeReachRatio(
  keypoints: Keypoint[],
  side: 'left' | 'right'
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

  const shoulderPt = getPoint(shoulder)!;
  const elbowPt = getPoint(elbow)!;
  const wristPt = getPoint(wrist)!;

  const segmentLength = dist2D(shoulderPt, elbowPt) + dist2D(elbowPt, wristPt);
  if (segmentLength < 1e-6) return NaN;

  return dist2D(shoulderPt, wristPt) / segmentLength;
}

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (reach ratios) */
const THRESHOLDS = {
  /** Ratio above which the push clock starts before the FSM commits */
  PUSH_CLOCK_START: 0.62,
  /** Minimum movement above resting top ratio before the push clock starts */
  PUSH_CLOCK_DELTA: 0.04,
  /** Ratio above which we transition REST -> EXTENDING (arm starting to straighten) */
  EXTENDING_ENTER: 0.65,
  /** Minimum movement above resting top ratio before a rep can start */
  MOVEMENT_START_DELTA: 0.08,
  /** Ratio above which we consider near-full extension (EXTENDING -> EXTENDED) */
  EXTENDED_ENTER: 0.95,
  /** Ratio below which we leave EXTENDED (hysteresis) (EXTENDED -> RETURNING) */
  EXTENDED_EXIT: 0.93,
  /** Ratio below which the return is complete (RETURNING -> REST) */
  REST_REENTER: 0.65,
  /** Extra buffer above the observed top position for dynamic return completion */
  RETURN_COMPLETE_BUFFER: 0.03,
  /** Minimum rep duration (seconds) */
  MIN_REP_TIME: 0.5,
  /** Minimum ratio ROM for a returned partial rep to count */
  MIN_PARTIAL_ROM: 0.135,
} as const;

/** Form heuristic thresholds (discrete messages) */
const FORM_THRESHOLDS = {
  /** Max ratio below which extension is insufficient (didn't lock out) */
  EXTENSION_FAIL: 0.95,
  /** Min ratio above which starting flexion is insufficient (didn't bend enough) */
  FLEXION_FAIL: 0.68,
  /** Shoulder angle delta above which elbows are drifting */
  ELBOW_DRIFT_WARN: 20,
  /** Starting shoulder angle above which elbows begin too far forward */
  ELBOW_FORWARD_WARN: 18,
  /** Absolute torso deviation from vertical above which there is excessive lean */
  TORSO_LEAN_WARN: 14,
  /** Torso change from baseline above which the user is rocking */
  TORSO_ROCK_WARN: 12,
  /** Minimum support at full lockout before the rep is considered stable */
  LOCKOUT_HOLD_MIN_MS: 300,
  /** Maximum brief gap still treated as the same lockout hold segment */
  LOCKOUT_GAP_TOLERANCE_MS: 80,
  /** Concentric (push down) too fast threshold (seconds) */
  TEMPO_PUSH_MIN: 0.25,
  /** Eccentric (return) too fast threshold (seconds) */
  TEMPO_RETURN_MIN: 0.4,
  /** Velocity spike ratio above which the push was rushed */
  TEMPO_PUSH_SPIKE_WARN: 2.8,
  /** Velocity spike ratio above which the return snapped back */
  TEMPO_RETURN_SPIKE_WARN: 2.8,
  /** Average side-view confidence below which a counted rep is marked unscorable */
  SIDE_VIEW_AVG_CONFIDENCE_MIN: 0.45,
  /** Minimum side-view confidence below which a counted rep is marked unscorable */
  SIDE_VIEW_MIN_CONFIDENCE_MIN: 0.25,
  /** Minimum side-view samples required before classifying a rep's view quality */
  SIDE_VIEW_MIN_SAMPLES: 5,
} as const;

/**
 * Continuous penalty curve parameters for scoring.
 *
 * | Category             | Cap | Deadzone           | Scale | Key Input                         |
 * |----------------------|-----|--------------------|-------|-----------------------------------|
 * | ROM extension        | 30  | 0 (ratio shortfall)| 300   | ideal ratio - max ratio           |
 * | ROM flexion          | 20  | 0 (ratio excess)   | 200   | min ratio - ideal start ratio     |
 * | Elbow drift          | 25  | 15                 | 0.03  | max shoulder angle delta          |
 * | Elbow forward        | 12  | 12                 | 0.03  | starting shoulder angle           |
 * | Torso lean           | 25  | 8                  | 0.10  | max torso deviation from vertical |
 * | Torso rock           | 15  | 8                  | 0.08  | torso movement from baseline      |
 * | Lockout hold         | 8   | 0ms deficit        | 0.001 | lockout hold deficit              |
 * | Tempo push           | 12  | 0.3s               | 60    | concentric time deficit           |
 * | Tempo return         | 8   | 0.4s               | 40    | eccentric time deficit            |
 * | Push/return spike    | 8/10| 2.8x               | 2     | robust velocity spike ratio       |
 *
 * Penalty caps sum above 100, and `computeScore` clamps the final score
 * to 0..100 so multiple severe faults cannot produce negative scores.
 */
const PENALTY_CONFIGS = {
  EXTENSION_ROM: { cap: 30, deadzone: 0, scale: 300 } as PenaltyConfig,
  FLEXION_ROM:   { cap: 20, deadzone: 0, scale: 200 } as PenaltyConfig,
  ELBOW_DRIFT:   { cap: 25, deadzone: 15, scale: 0.03 } as PenaltyConfig,
  ELBOW_FORWARD: { cap: 12, deadzone: 12, scale: 0.03 } as PenaltyConfig,
  TORSO_LEAN:    { cap: 25, deadzone: 8, scale: 0.10 } as PenaltyConfig,
  TORSO_ROCK:    { cap: 15, deadzone: 8, scale: 0.08 } as PenaltyConfig,
  LOCKOUT_HOLD:  { cap: 8,  deadzone: 0, scale: 0.001 } as PenaltyConfig,
  TEMPO_PUSH:    { cap: 12, deadzone: 0.3, scale: 60 } as PenaltyConfig,
  TEMPO_RETURN:  { cap: 8,  deadzone: 0.4, scale: 40 } as PenaltyConfig,
  PUSH_SPIKE:    { cap: 8,  deadzone: 2.8, scale: 2 } as PenaltyConfig,
  RETURN_SPIKE:  { cap: 10, deadzone: 2.8, scale: 2 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;
const FORM_CONFIDENCE_MIN = 0.3;
const SETUP_SIDE_VIEW_MIN_SAMPLES = 8;
const FEEDBACK_COOLDOWN_SECONDS = 2.0;
const VELOCITY_SPIKE_MIN_SAMPLES = 4;
const WORLD_IMAGE_REACH_RATIO_MAX_DELTA = 0.2;
const ONE_SIDE_SIDE_VIEW_CONFIDENCE = 0.6;
const SIDE_VIEW_SETUP_FEEDBACK = 'Turn side-on so I can judge your pushdown.';

const DEFAULT_CABLE_PUSHDOWN_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  penaltyConfigs: PENALTY_CONFIGS,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_CABLE_PUSHDOWN_HEURISTIC_CONFIG = mergeHeuristicConfig(
  DEFAULT_CABLE_PUSHDOWN_HEURISTIC_CONFIG,
  tunedConfig,
);

const CABLE_PUSHDOWN_TUNABLE_SPEC = createDefaultTunableSpec(
  'Cable Pushdowns',
  DEFAULT_CABLE_PUSHDOWN_HEURISTIC_CONFIG,
);

function upsertCablePushdownTunable(tunable: NumericTunable): void {
  const index = CABLE_PUSHDOWN_TUNABLE_SPEC.tunables.findIndex(existing => existing.path === tunable.path);
  if (index >= 0) {
    CABLE_PUSHDOWN_TUNABLE_SPEC.tunables[index] = tunable;
  } else {
    CABLE_PUSHDOWN_TUNABLE_SPEC.tunables.push(tunable);
  }
}

([
  { path: 'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN', min: 0.25, max: 0.75, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN', min: 0.10, max: 0.55, step: 0.05, kind: 'feedback' },
  { path: 'formThresholds.SIDE_VIEW_MIN_SAMPLES', min: 3, max: 10, step: 1, kind: 'feedback' },
  { path: 'formThresholds.LOCKOUT_GAP_TOLERANCE_MS', min: 0, max: 180, step: 10, kind: 'feedback' },
  { path: 'penaltyConfigs.EXTENSION_ROM.cap', min: 0, max: 50, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.EXTENSION_ROM.deadzone', min: 0, max: 0.08, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.EXTENSION_ROM.scale', min: 50, max: 700, step: 25, kind: 'scoring' },
  { path: 'penaltyConfigs.FLEXION_ROM.cap', min: 0, max: 40, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.FLEXION_ROM.deadzone', min: 0, max: 0.15, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.FLEXION_ROM.scale', min: 50, max: 500, step: 25, kind: 'scoring' },
  { path: 'penaltyConfigs.ELBOW_DRIFT.cap', min: 0, max: 40, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.ELBOW_DRIFT.deadzone', min: 0, max: 35, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.ELBOW_DRIFT.scale', min: 0.005, max: 0.10, step: 0.005, kind: 'scoring' },
  { path: 'penaltyConfigs.ELBOW_FORWARD.cap', min: 0, max: 30, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.ELBOW_FORWARD.deadzone', min: 0, max: 35, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.ELBOW_FORWARD.scale', min: 0.005, max: 0.10, step: 0.005, kind: 'scoring' },
  { path: 'penaltyConfigs.TORSO_LEAN.cap', min: 0, max: 40, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TORSO_LEAN.deadzone', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TORSO_LEAN.scale', min: 0.02, max: 0.25, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.TORSO_ROCK.cap', min: 0, max: 30, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TORSO_ROCK.deadzone', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TORSO_ROCK.scale', min: 0.02, max: 0.20, step: 0.01, kind: 'scoring' },
  { path: 'penaltyConfigs.LOCKOUT_HOLD.cap', min: 0, max: 20, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.LOCKOUT_HOLD.deadzone', min: 0, max: 100, step: 10, kind: 'scoring' },
  { path: 'penaltyConfigs.LOCKOUT_HOLD.scale', min: 0.0002, max: 0.004, step: 0.0002, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_PUSH.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_PUSH.deadzone', min: 0.1, max: 0.8, step: 0.05, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_PUSH.scale', min: 20, max: 140, step: 5, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_RETURN.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_RETURN.deadzone', min: 0.1, max: 1.0, step: 0.05, kind: 'scoring' },
  { path: 'penaltyConfigs.TEMPO_RETURN.scale', min: 20, max: 120, step: 5, kind: 'scoring' },
  { path: 'penaltyConfigs.PUSH_SPIKE.cap', min: 0, max: 20, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.PUSH_SPIKE.deadzone', min: 1.2, max: 6, step: 0.1, kind: 'scoring' },
  { path: 'penaltyConfigs.PUSH_SPIKE.scale', min: 0.5, max: 6, step: 0.25, kind: 'scoring' },
  { path: 'penaltyConfigs.RETURN_SPIKE.cap', min: 0, max: 25, step: 1, kind: 'scoring' },
  { path: 'penaltyConfigs.RETURN_SPIKE.deadzone', min: 1.2, max: 6, step: 0.1, kind: 'scoring' },
  { path: 'penaltyConfigs.RETURN_SPIKE.scale', min: 0.5, max: 6, step: 0.25, kind: 'scoring' },
] satisfies NumericTunable[]).forEach(upsertCablePushdownTunable);

CABLE_PUSHDOWN_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'cable-pushdowns.lockout_short', metricKey: 'extensionRatio', thresholdPath: 'formThresholds.EXTENSION_FAIL', direction: 'below' },
  { issueId: 'cable-pushdowns.lockout_short', metricKey: 'lockoutHoldMs', thresholdPath: 'formThresholds.LOCKOUT_HOLD_MIN_MS', direction: 'below' },
  { issueId: 'cable-pushdowns.rom_short', metricKey: 'flexionRatio', thresholdPath: 'formThresholds.FLEXION_FAIL', direction: 'above' },
  { issueId: 'cable-pushdowns.elbow_drift', metricKey: 'elbowDriftDelta', thresholdPath: 'formThresholds.ELBOW_DRIFT_WARN', direction: 'above' },
  { issueId: 'cable-pushdowns.elbow_forward', metricKey: 'elbowForwardAngle', thresholdPath: 'formThresholds.ELBOW_FORWARD_WARN', direction: 'above' },
  { issueId: 'cable-pushdowns.torso_warn', metricKey: 'torsoAbsoluteDeviation', thresholdPath: 'formThresholds.TORSO_LEAN_WARN', direction: 'above' },
  { issueId: 'cable-pushdowns.torso_rocking', metricKey: 'torsoRockDelta', thresholdPath: 'formThresholds.TORSO_ROCK_WARN', direction: 'above' },
  { issueId: 'cable-pushdowns.tempo_down', metricKey: 'tPush', thresholdPath: 'formThresholds.TEMPO_PUSH_MIN', direction: 'below' },
  { issueId: 'cable-pushdowns.tempo_down', metricKey: 'pushVelocitySpikeRatio', thresholdPath: 'formThresholds.TEMPO_PUSH_SPIKE_WARN', direction: 'above' },
  { issueId: 'cable-pushdowns.tempo_up', metricKey: 'tReturn', thresholdPath: 'formThresholds.TEMPO_RETURN_MIN', direction: 'below' },
  { issueId: 'cable-pushdowns.tempo_up', metricKey: 'returnVelocitySpikeRatio', thresholdPath: 'formThresholds.TEMPO_RETURN_SPIKE_WARN', direction: 'above' },
];

const CABLE_PUSHDOWN_ISSUE_CUE_FAMILIES: Record<string, string[]> = {
  'cable-pushdowns.lockout_short': ['handlePath', 'wristSpecific', 'visibleArmPath'],
  'cable-pushdowns.rom_short': ['handlePath', 'wristSpecific', 'visibleArmPath'],
  'cable-pushdowns.elbow_drift': ['elbowPath'],
  'cable-pushdowns.elbow_forward': ['elbowPath'],
  'cable-pushdowns.torso_warn': ['torsoControl'],
  'cable-pushdowns.torso_rocking': ['torsoControl'],
  'cable-pushdowns.tempo_down': ['tempo'],
  'cable-pushdowns.tempo_up': ['tempo'],
};

const CABLE_PUSHDOWN_MESSAGE_CUE_FAMILIES: Record<string, string[]> = {
  'Extend fully \u2014 lock out at the bottom of each rep.': ['handlePath', 'wristSpecific', 'visibleArmPath'],
  'Start with a deeper bend \u2014 bring your forearms closer to your biceps.': ['handlePath', 'wristSpecific', 'visibleArmPath'],
  'Keep your elbows pinned to your sides \u2014 avoid letting them drift.': ['elbowPath'],
  'Start with your elbows tucked by your sides.': ['elbowPath'],
  'Stay upright \u2014 avoid leaning into the pushdown.': ['torsoControl'],
  'Keep your torso steady through the pushdown.': ['torsoControl'],
  'Slow down the push \u2014 control the extension.': ['tempo'],
  "Control the return \u2014 don't let the weight snap back.": ['tempo'],
};

const CABLE_PUSHDOWN_SELECTED_ARM_CUE_FAMILIES = [
  'repCount',
  'tempo',
  'visibleArmPath',
  'handlePath',
  'elbowPath',
  'wristSpecific',
] as const;

const CABLE_PUSHDOWN_CUE_FAMILIES = [
  'repCount',
  'tempo',
  'torsoControl',
  'visibleArmPath',
  'handlePath',
  'elbowPath',
  'wristSpecific',
  'bilateralSymmetry',
] as const;

const CABLE_PUSHDOWN_MEANINGFUL_CUE_FAMILIES = [
  'tempo',
  'torsoControl',
  'visibleArmPath',
  'handlePath',
  'elbowPath',
  'wristSpecific',
] as const;

const CABLE_PUSHDOWN_CUE_VIEW_REQUIREMENTS: Record<string, CableCueViewRequirement> = {
  repCount: 'selectedSideOk',
  tempo: 'selectedSideOk',
  torsoControl: 'selectedSideOk',
  visibleArmPath: 'selectedSideOk',
  handlePath: 'sidePreferred',
  elbowPath: 'sidePreferred',
  wristSpecific: 'selectedSideOk',
  bilateralSymmetry: 'bilateralGeometryRequired',
};

const CABLE_PUSHDOWN_RELIABILITY_JOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
] as const;

const CABLE_PUSHDOWN_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'penaltyConfigs', target: PENALTY_CONFIGS as unknown as Record<string, unknown> },
];

function withCablePushdownConfig<T>(
  config: ExerciseHeuristicConfig,
  fn: () => T,
): T {
  return runWithConfigBindings(config, CABLE_PUSHDOWN_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type CablePushdownPhase = 'REST' | 'EXTENDING' | 'EXTENDED' | 'RETURNING';

interface CablePushdownFSM {
  phase: CablePushdownPhase;
  /** Timestamp when push began (REST -> EXTENDING) */
  tRepStart: number | null;
  /** Timestamp when the user first moved out of the bent start position */
  tPushStart: number | null;
  /** Timestamp when full extension was reached */
  tExtended: number | null;
  /** Timestamp when rep completed (RETURNING -> REST) */
  tRepEnd: number | null;
}

interface RepWindow {
  /** Resting top ratio captured before the push started */
  startRatio: number;
  /** Min reach ratio during rep (should be low -- bent position at start/end) */
  minRatio: number;
  /** Max reach ratio during rep (should be high -- extended at bottom) */
  maxRatio: number;
  /** Shoulder angle at rep start (baseline) */
  shoulderAngleBaseline: number | null;
  /** Max absolute shoulder angle delta from baseline during rep */
  maxShoulderDelta: number;
  /** Starting shoulder angle used to catch elbows that begin too far forward */
  elbowForwardAngleAtStart: number | null;
  /** Shoulder metric support */
  shoulderAngleConfidenceSum: number;
  shoulderAngleSampleCount: number;
  shoulderSourceCounts: Record<LandmarkSourceName, number>;
  /** Signed torso deviation baseline */
  torsoDevBaseline: number | null;
  /** Max absolute torso deviation from vertical during rep */
  maxTorsoAbsoluteDev: number;
  /** Max total torso movement from baseline */
  maxTorsoRockDelta: number;
  /** Torso metric support */
  torsoDevConfidenceSum: number;
  torsoDevSampleCount: number;
  torsoSourceCounts: Record<LandmarkSourceName, number>;
  /** Sum/min/sample count for side-view confidence */
  sideViewConfidenceSum: number;
  sideViewConfidenceMin: number;
  sideViewConfidenceSamples: number;
  /** Runtime PoseState reliability observed during this active rep. */
  reliability: ReturnType<typeof createPoseStateReliabilityAggregator>;
  /** Velocity support for rushed push / snap-back return checks */
  lastVelocityRatio: number | null;
  lastVelocityTimestamp: number | null;
  pushVelocityValues: number[];
  returnVelocityValues: number[];
  /** Longest continuous raw full-extension support window */
  currentLockoutStartAt: number | null;
  currentLockoutLastAt: number | null;
  lockoutSampleCount: number;
  bestLockoutHoldMs: number;
  /** Timestamps */
  tStart: number;
  tExtended: number | null;
  tReturnStart: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
  diagnostics?: FrameworkRepResult['diagnostics'];
  scorable?: boolean;
  qualityWarnings?: FrameworkRepResult['qualityWarnings'];
}

interface CablePushdownState {
  fsm: CablePushdownFSM;
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
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
  /** Minimum smoothed ratio observed during REST phase (pre-seeds rep window) */
  restMinRatio: number;
  /** Rolling side-view confidence while waiting for the user to begin */
  setupSideViewConfidences: number[];
}

interface CablePushdownDebugInfo {
  phase: CablePushdownPhase;
  side: 'left' | 'right';
  warmedUp: boolean;
  ratio: number | null;
  fastRatio: number | null;
  shoulderAngle: number | null;
  torsoDev: number | null;
  sideViewConfidence: number | null;
  // Rep window
  ratioMin: number | null;
  ratioMax: number | null;
  shoulderDelta: number | null;
  elbowForwardAngle: number | null;
  torsoDevMax: number | null;
  torsoRockDelta: number | null;
  pushVelocitySpikeRatio: number | null;
  returnVelocitySpikeRatio: number | null;
}

function isFiniteMetric(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function visibleKeypoint(
  keypoints: Keypoint[],
  name: string,
  threshold = VISIBILITY_THRESHOLD,
): Keypoint | null {
  const keypoint = getKeypoint(keypoints, name);
  return isVisible(keypoint, threshold) ? keypoint : null;
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
): Array<{ name: LandmarkSourceName; keypoints: Keypoint[] }> {
  const sources: Array<{ name: LandmarkSourceName; keypoints: Keypoint[] }> = [];
  const pushUnique = (name: LandmarkSourceName, keypoints: Keypoint[] | undefined) => {
    if (!keypoints || keypoints.length === 0) return;
    if (sources.some(source => source.keypoints === keypoints)) return;
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
  source: { name: LandmarkSourceName; keypoints: Keypoint[] },
  frameContext: ExerciseFrameContext | undefined,
  side: 'left' | 'right',
): boolean {
  if (source.name !== 'world') return true;
  const imageKeypoints = frameContext?.imageKeypoints;
  if (!imageKeypoints) return true;

  const imageReachRatio = computeReachRatio(imageKeypoints, side);
  const sourceReachRatio = computeReachRatio(source.keypoints, side);
  if (!isFiniteMetric(imageReachRatio) || !isFiniteMetric(sourceReachRatio)) return true;

  return Math.abs(sourceReachRatio - imageReachRatio) <= WORLD_IMAGE_REACH_RATIO_MAX_DELTA;
}

function calculateShoulderAngleSample(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
  side: 'left' | 'right',
): MetricSample | null {
  for (const source of landmarkSources(frameContext, fallbackKeypoints)) {
    if (!sourceMatchesImageReach(source, frameContext, side)) continue;
    if (minKeypointConfidence(source.keypoints, [`${side}_hip`, `${side}_shoulder`, `${side}_elbow`]) < FORM_CONFIDENCE_MIN) {
      continue;
    }
    const hip = getKeypoint(source.keypoints, `${side}_hip`);
    const shoulder = getKeypoint(source.keypoints, `${side}_shoulder`);
    const elbow = getKeypoint(source.keypoints, `${side}_elbow`);
    if (!hip || !shoulder || !elbow) continue;
    const value = source.name === 'world'
      ? calculateAngle(hip, shoulder, elbow)
      : calculateAngle2D(hip, shoulder, elbow);
    if (isFiniteMetric(value) && value >= 0 && value < 179) {
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
  useDepth = false,
): number | null {
  const shoulder = visibleKeypoint(keypoints, `${side}_shoulder`, FORM_CONFIDENCE_MIN);
  const hip = visibleKeypoint(keypoints, `${side}_hip`, FORM_CONFIDENCE_MIN);
  if (!shoulder || !hip) return null;

  if (useDepth && keypoints.some(keypoint => Math.abs(keypoint.z ?? 0) > 1e-6)) {
    const vy = shoulder.y - hip.y;
    const vz = (shoulder.z ?? 0) - (hip.z ?? 0);
    const mag = Math.sqrt(vy * vy + vz * vz);
    if (mag >= 1e-6) return Math.atan2(vz, Math.abs(vy)) * 57.29577951308232;
  }

  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return null;
  return Math.atan2(dx, Math.abs(dy)) * 57.29577951308232;
}

function calculateTorsoDeviationSample(
  frameContext: ExerciseFrameContext | undefined,
  fallbackKeypoints: Keypoint[],
  side: 'left' | 'right',
): MetricSample | null {
  for (const source of landmarkSources(frameContext, fallbackKeypoints)) {
    if (!sourceMatchesImageReach(source, frameContext, side)) continue;
    const value = source.name === 'world'
      ? calculateSagittalTorsoDeviation(source.keypoints) ?? calculateSelectedSideTorsoDeviation(source.keypoints, side, true)
      : calculateSelectedSideTorsoDeviation(source.keypoints, side, false);
    if (isFiniteMetric(value)) {
      return { value, source: source.name, keypoints: source.keypoints };
    }
  }
  return null;
}

function calculateSideViewConfidence(
  keypoints: Keypoint[],
  selectedSide?: 'left' | 'right',
): number | null {
  const leftShoulder = visibleKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = visibleKeypoint(keypoints, 'right_shoulder');
  const leftHip = visibleKeypoint(keypoints, 'left_hip');
  const rightHip = visibleKeypoint(keypoints, 'right_hip');
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    if (!selectedSide) return null;
    const selectedShoulder = visibleKeypoint(keypoints, `${selectedSide}_shoulder`);
    const selectedHip = visibleKeypoint(keypoints, `${selectedSide}_hip`);
    const selectedElbow = visibleKeypoint(keypoints, `${selectedSide}_elbow`);
    const selectedWrist = visibleKeypoint(keypoints, `${selectedSide}_wrist`);
    const oppositeSide = selectedSide === 'left' ? 'right' : 'left';
    const oppositeShoulder = visibleKeypoint(keypoints, `${oppositeSide}_shoulder`);
    const oppositeHip = visibleKeypoint(keypoints, `${oppositeSide}_hip`);
    const selectedTorsoHeight = selectedShoulder && selectedHip
      ? Math.abs(selectedHip.y - selectedShoulder.y)
      : 0;

    if (
      selectedShoulder &&
      selectedHip &&
      selectedElbow &&
      selectedWrist &&
      selectedTorsoHeight > 1e-6 &&
      (!oppositeShoulder || !oppositeHip)
    ) {
      return ONE_SIDE_SIDE_VIEW_CONFIDENCE;
    }

    return null;
  }

  const leftTorso = Math.abs(leftHip.y - leftShoulder.y);
  const rightTorso = Math.abs(rightHip.y - rightShoulder.y);
  const torsoHeight = (leftTorso + rightTorso) * 0.5;
  if (torsoHeight <= 1e-6) return null;

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const hipWidth = Math.abs(leftHip.x - rightHip.x);
  const widthRatio = ((shoulderWidth + hipWidth) * 0.5) / torsoHeight;
  return 1 - Math.max(0, Math.min(1, (widthRatio - 0.30) / (0.55 - 0.30)));
}

function averageSideViewConfidence(repWindow: RepWindow): number | null {
  if (repWindow.sideViewConfidenceSamples === 0) return null;
  return repWindow.sideViewConfidenceSum / repWindow.sideViewConfidenceSamples;
}

function buildCablePushdownViewQuality(repWindow: RepWindow): RepViewQualityDiagnostic {
  const averageConfidence = averageSideViewConfidence(repWindow);
  const hasEnoughSamples =
    repWindow.sideViewConfidenceSamples >= FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES &&
    averageConfidence !== null;
  const sideConfirmed = Boolean(
    hasEnoughSamples &&
    averageConfidence! >= FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN &&
    repWindow.sideViewConfidenceMin >= FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN,
  );
  const frontishConfirmed = Boolean(hasEnoughSamples && !sideConfirmed);
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
    minSideViewConfidence: repWindow.sideViewConfidenceMin === Infinity
      ? null
      : repWindow.sideViewConfidenceMin,
    sampleCount: repWindow.sideViewConfidenceSamples,
  };
}

function diagnosticsViewFor(
  viewQuality: RepViewQualityDiagnostic,
): NonNullable<FrameworkRepResult['diagnostics']>['view'] {
  if (viewQuality.sideConfirmed) return 'side';
  if (viewQuality.frontishConfirmed) return 'front';
  return 'unknown';
}

function isCablePushdownRepScorable(repWindow: RepWindow): boolean {
  return buildCablePushdownViewQuality(repWindow).sideConfirmed;
}

function cablePushdownQualityWarnings(repWindow: RepWindow): FrameworkRepResult['qualityWarnings'] {
  return isCablePushdownRepScorable(repWindow) ? [] : ['side_view_uncertain'];
}

function averageSetupSideViewConfidence(state: CablePushdownState): number | null {
  const samples = state.setupSideViewConfidences;
  if (samples.length === 0) return null;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function minSetupSideViewConfidence(state: CablePushdownState): number | null {
  if (state.setupSideViewConfidences.length === 0) return null;
  return Math.min(...state.setupSideViewConfidences);
}

function shouldShowSetupSideViewFeedback(state: CablePushdownState, t: number): boolean {
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

function cablePushdownSetupQualityWarnings(state: CablePushdownState): FrameworkRepResult['qualityWarnings'] {
  if (state.setupSideViewConfidences.length < SETUP_SIDE_VIEW_MIN_SAMPLES) return [];
  const averageConfidence = averageSetupSideViewConfidence(state);
  const minConfidence = minSetupSideViewConfidence(state);
  return (
    averageConfidence !== null &&
    minConfidence !== null &&
    (
      averageConfidence < FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN ||
      minConfidence < FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN
    )
  )
    ? ['side_view_uncertain']
    : [];
}

function cablePushdownRepWindowAnalysisStatus(
  repWindow: RepWindow,
  visibleSide: 'left' | 'right',
): CameraAnalysisStatus | null {
  if (repWindow.sideViewConfidenceSamples < FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES) return null;
  const reliability = reliabilityInterpretationForRepWindow(repWindow, visibleSide);
  const reliabilityInterpretation = reliability?.interpretation ?? null;
  const cueDecision = resolveCableViewCueDecision({
    allCueFamilies: CABLE_PUSHDOWN_CUE_FAMILIES,
    meaningfulCueFamilies: CABLE_PUSHDOWN_MEANINGFUL_CUE_FAMILIES,
    cueViewRequirements: CABLE_PUSHDOWN_CUE_VIEW_REQUIREMENTS,
    sideViewGatePassed: isCablePushdownRepScorable(repWindow),
    interpretation: reliabilityInterpretation,
    selectedSide: visibleSide,
  });
  return cameraStatusFromViewCueGating({
    viewCueGating: cueDecision,
    reliability: reliabilityInterpretation,
    viewRequired: 'side',
    source: 'exercise',
  });
}

function cablePushdownSetupAnalysisStatus(state: CablePushdownState): CameraAnalysisStatus | null {
  const warnings = cablePushdownSetupQualityWarnings(state) ?? [];
  if (!warnings.includes('side_view_uncertain')) return null;
  return countOnlyCameraStatus({
    source: 'exercise',
    reason: 'setup_side_view_uncertain',
    message: 'Turn side-on for full form analysis',
    details: {
      feedbackMode: 'countOnly',
      viewRequired: 'side',
    },
  });
}

function lockoutHoldMs(repWindow: RepWindow): number | null {
  return repWindow.lockoutSampleCount > 0 ? repWindow.bestLockoutHoldMs : null;
}

function percentile(sortedValues: number[], percentileValue: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.max(
    0,
    Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * percentileValue)),
  );
  return sortedValues[index];
}

function velocitySpikeRatio(values: number[]): number | null {
  if (values.length < VELOCITY_SPIKE_MIN_SAMPLES) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const high = percentile(sorted, 0.9);
  if (median === null || high === null || median <= 1e-6) return null;
  return high / median;
}

function pushVelocitySpikeRatio(repWindow: RepWindow): number | null {
  return velocitySpikeRatio(repWindow.pushVelocityValues);
}

function returnVelocitySpikeRatio(repWindow: RepWindow): number | null {
  return velocitySpikeRatio(repWindow.returnVelocityValues);
}

function cueFamilyAllowed(allowedCueFamilies: ReadonlySet<string> | undefined, family: string): boolean {
  return !allowedCueFamilies || allowedCueFamilies.has(family);
}

function selectedArmChain(visibleSide: 'left' | 'right'): 'leftArm' | 'rightArm' {
  return visibleSide === 'left' ? 'leftArm' : 'rightArm';
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

  const baseInterpretation = interpretPoseStateReliabilitySummary('Cable Pushdowns', summary);
  const selectedChain = selectedArmChain(visibleSide);
  if (baseInterpretation.usableChains.includes(selectedChain)) {
    return { summary, interpretation: baseInterpretation };
  }

  const selectedArmUnsafeFamilies = new Set<string>(CABLE_PUSHDOWN_SELECTED_ARM_CUE_FAMILIES);
  const safeCueFamilies = baseInterpretation.safeCueFamilies.filter(
    family => !selectedArmUnsafeFamilies.has(family),
  );
  const unsafeCueFamilies = uniqueStrings([
    ...baseInterpretation.unsafeCueFamilies,
    ...CABLE_PUSHDOWN_SELECTED_ARM_CUE_FAMILIES,
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
  visibleSide: 'left' | 'right',
): boolean {
  if (!interpretation) return true;
  return (
    interpretation.scoreabilityCandidate !== 'notScoreable' &&
    interpretation.usableChains.includes(selectedArmChain(visibleSide)) &&
    interpretation.usableChains.includes('torso')
  );
}

function repScorableWithReliability(
  repWindow: RepWindow,
  interpretation: RepReliabilityInterpretation | null,
  visibleSide: 'left' | 'right',
): boolean {
  return isCablePushdownRepScorable(repWindow) && reliabilityAllowsScoring(interpretation, visibleSide);
}

function suppressUnsafeReliabilityMessages(
  messages: string[],
  interpretation: RepReliabilityInterpretation | null,
): string[] {
  if (!interpretation) return messages;

  const unsafeFamilies = new Set(interpretation.unsafeCueFamilies);
  return messages.filter((message) => {
    const families = CABLE_PUSHDOWN_MESSAGE_CUE_FAMILIES[message] ?? [];
    return families.every(family => !unsafeFamilies.has(family));
  });
}

function applyCablePushdownCueGating(
  diagnostics: NonNullable<FrameworkRepResult['diagnostics']>,
  interpretation: RepReliabilityInterpretation | null,
  decision: ReturnType<typeof resolveCableViewCueDecision>,
): NonNullable<FrameworkRepResult['diagnostics']> {
  const withReliability = interpretation
    ? {
        ...diagnostics,
        reliability: {
          ...interpretation,
          suppressedCueFamilies: [],
          suppressedIssueIds: [],
        },
      }
    : diagnostics;

  return applyCableCueGatingToDiagnostics({
    diagnostics: withReliability,
    decision,
    issueCueFamilies: CABLE_PUSHDOWN_ISSUE_CUE_FAMILIES,
  });
}

function shouldLogCablePushdownReliability(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    !(typeof process !== 'undefined' && process.env.JEST_WORKER_ID)
  );
}

function logCablePushdownRepReliability(
  repIndex: number,
  interpretation: RepReliabilityInterpretation | null,
  diagnostics: FrameworkRepResult['diagnostics'],
): void {
  if (!interpretation || !shouldLogCablePushdownReliability()) return;
  const reliability = diagnostics?.reliability;
  console.log([
    `[CablePushdownReliability] rep=${repIndex}`,
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

function formatCablePushdownScoringRatio(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

function cablePushdownScoringReason(args: {
  sideViewPassed: boolean;
  reliabilityAllowed: boolean;
  scorable: boolean;
  qualityWarnings: FrameworkRepResult['qualityWarnings'];
  diagnostics?: FrameworkRepResult['diagnostics'];
}): string {
  const viewCueGating = args.diagnostics?.viewCueGating;
  if (viewCueGating?.finalScorableReason) return viewCueGating.finalScorableReason;
  if (viewCueGating?.finalUnscorableReason) return viewCueGating.finalUnscorableReason;
  if (!args.sideViewPassed) {
    return args.qualityWarnings?.includes('side_view_uncertain')
      ? 'side_view_uncertain'
      : 'bad_view';
  }
  if (!args.reliabilityAllowed) return 'pose_reliability_not_scoreable';
  return args.scorable ? 'scoreable' : 'unknown_unscored';
}

function logCablePushdownScoringDecision(args: {
  repIndex: number;
  repWindow: RepWindow;
  visibleSide: 'left' | 'right';
  scorable: boolean;
  qualityWarnings: FrameworkRepResult['qualityWarnings'];
  interpretation: RepReliabilityInterpretation | null;
  diagnostics: NonNullable<FrameworkRepResult['diagnostics']>;
}): void {
  if (!shouldLogCablePushdownReliability()) return;

  const sideViewPassed = isCablePushdownRepScorable(args.repWindow);
  const reliabilityAllowed = reliabilityAllowsScoring(args.interpretation, args.visibleSide);
  const viewQuality = args.diagnostics.viewQuality ?? buildCablePushdownViewQuality(args.repWindow);
  const averageSide = averageSideViewConfidence(args.repWindow);
  const minSide = args.repWindow.sideViewConfidenceSamples > 0
    ? args.repWindow.sideViewConfidenceMin
    : null;
  const viewCueGating = args.diagnostics.viewCueGating;
  console.log([
    `[CablePushdownScoring] rep=${args.repIndex}`,
    `scorable=${args.scorable}`,
    `reason=${cablePushdownScoringReason({
      sideViewPassed,
      reliabilityAllowed,
      scorable: args.scorable,
      qualityWarnings: args.qualityWarnings,
      diagnostics: args.diagnostics,
    })}`,
    `reliability=${args.interpretation?.scoreabilityCandidate ?? 'n/a'}`,
    `qualityWarnings=${args.qualityWarnings?.join(',') || 'none'}`,
    `view=${args.diagnostics.view ?? 'unknown'}`,
    `viewStatus=${viewQuality.status}`,
    `sideConfirmed=${viewQuality.sideConfirmed}`,
    `frontishConfirmed=${viewQuality.frontishConfirmed === true}`,
    `viewUnknown=${viewQuality.viewUnknown}`,
    `avgSide=${formatCablePushdownScoringRatio(averageSide)}`,
    `minSide=${formatCablePushdownScoringRatio(minSide)}`,
    `sideSamples=${args.repWindow.sideViewConfidenceSamples}`,
    `thresholds=avg>=${FORM_THRESHOLDS.SIDE_VIEW_AVG_CONFIDENCE_MIN.toFixed(2)},min>=${FORM_THRESHOLDS.SIDE_VIEW_MIN_CONFIDENCE_MIN.toFixed(2)},samples>=${FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES}`,
    `exerciseScorableGate=${sideViewPassed ? 'passed' : 'failed'}`,
    `partialViewScoring=${viewCueGating?.partialViewScoringAllowed === true ? 'allowed' : 'blocked'}`,
    `viewBlocked=${viewCueGating?.viewBlockedCueFamilies.join(',') || 'none'}`,
    `finalSafe=${viewCueGating?.finalSafeCueFamilies.join(',') || 'none'}`,
    `reliabilityAllowsScoring=${reliabilityAllowed}`,
    `setupWarning=${args.qualityWarnings?.includes('side_view_uncertain') === true}`,
    'globalAdjustedQuality=not_available_check_CameraScreen',
  ].join(' '));
}

function poseStateHasRichReliabilityMetadata(poseState: NonNullable<ExerciseFrameContext['poseState']>): boolean {
  return CABLE_PUSHDOWN_RELIABILITY_JOINTS.some((jointName) => {
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

function observeCablePushdownPoseState(
  repWindow: RepWindow,
  frameContext: ExerciseFrameContext | undefined,
): void {
  const poseState = frameContext?.poseState;
  if (!poseState || !poseStateHasRichReliabilityMetadata(poseState)) return;
  repWindow.reliability.observe(poseState);
}

function initialSourceCounts(): Record<LandmarkSourceName, number> {
  return { world: 0, image: 0, fallback: 0 };
}

function dominantSourceLabel(counts: Record<LandmarkSourceName, number>): LandmarkSourceName | null {
  let bestSource: LandmarkSourceName | null = null;
  let bestCount = 0;
  for (const source of ['world', 'image', 'fallback'] as const) {
    if (counts[source] > bestCount) {
      bestSource = source;
      bestCount = counts[source];
    }
  }
  return bestSource;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): CablePushdownFSM {
  return {
    phase: 'REST',
    tRepStart: null,
    tPushStart: null,
    tExtended: null,
    tRepEnd: null,
  };
}

function initRepWindow(tStart: number, initialRatio?: number): RepWindow {
  return {
    startRatio: initialRatio ?? Infinity,
    minRatio: initialRatio ?? Infinity,
    maxRatio: initialRatio ?? -Infinity,
    shoulderAngleBaseline: null,
    maxShoulderDelta: 0,
    elbowForwardAngleAtStart: null,
    shoulderAngleConfidenceSum: 0,
    shoulderAngleSampleCount: 0,
    shoulderSourceCounts: initialSourceCounts(),
    torsoDevBaseline: null,
    maxTorsoAbsoluteDev: 0,
    maxTorsoRockDelta: 0,
    torsoDevConfidenceSum: 0,
    torsoDevSampleCount: 0,
    torsoSourceCounts: initialSourceCounts(),
    sideViewConfidenceSum: 0,
    sideViewConfidenceMin: Infinity,
    sideViewConfidenceSamples: 0,
    reliability: createPoseStateReliabilityAggregator(),
    lastVelocityRatio: null,
    lastVelocityTimestamp: null,
    pushVelocityValues: [],
    returnVelocityValues: [],
    currentLockoutStartAt: null,
    currentLockoutLastAt: null,
    lockoutSampleCount: 0,
    bestLockoutHoldMs: 0,
    tStart,
    tExtended: null,
    tReturnStart: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function createCablePushdownWarmupGate(): WarmupGate {
  return new WarmupGate({
    requiredJoints: [
      'left_shoulder', 'left_elbow', 'left_wrist', 'left_hip',
      'right_shoulder', 'right_elbow', 'right_wrist', 'right_hip',
    ],
    requiredFrames: 10,
    visibilityThreshold: 0.2,
  });
}

function resetCablePushdownAfterTrackingInterruption(
  currentState: CablePushdownState,
): CablePushdownState {
  return {
    ...currentState,
    fsm: initFSM(),
    repWindow: null,
    ratioTracker: new SmoothedAngleTracker(),
    shoulderTracker: new SmoothedAngleTracker(),
    torsoTracker: new SmoothedAngleTracker(),
    warmupGate: createCablePushdownWarmupGate(),
    warmedUp: false,
    smoothedRatio: null,
    fastRatio: null,
    smoothedShoulder: null,
    smoothedTorso: null,
    restMinRatio: Infinity,
    setupSideViewConfidences: [],
  };
}

function initializeCablePushdownState(): CablePushdownState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    ratioTracker: new SmoothedAngleTracker(),
    shoulderTracker: new SmoothedAngleTracker(),
    torsoTracker: new SmoothedAngleTracker(),
    warmupGate: createCablePushdownWarmupGate(),
    warmedUp: false,
    smoothedRatio: null,
    fastRatio: null,
    smoothedShoulder: null,
    smoothedTorso: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
    restMinRatio: Infinity,
    setupSideViewConfidences: [],
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
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: CablePushdownFSM;
  repCompleted: boolean;
}

function updateFSM(
  currentFSM: CablePushdownFSM,
  ratio: number,
  t: number,
  restReferenceRatio: number | null,
  repStartRatio: number | null,
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;
  const clockStartThreshold = restReferenceRatio !== null && Number.isFinite(restReferenceRatio)
    ? Math.max(THRESHOLDS.PUSH_CLOCK_START, restReferenceRatio + THRESHOLDS.PUSH_CLOCK_DELTA)
    : THRESHOLDS.PUSH_CLOCK_START;
  const extendingEnterThreshold = restReferenceRatio !== null && Number.isFinite(restReferenceRatio)
    ? Math.max(THRESHOLDS.EXTENDING_ENTER, restReferenceRatio + THRESHOLDS.MOVEMENT_START_DELTA)
    : THRESHOLDS.EXTENDING_ENTER;
  const returnCompleteThreshold = repStartRatio !== null && Number.isFinite(repStartRatio)
    ? Math.max(THRESHOLDS.REST_REENTER, repStartRatio + THRESHOLDS.RETURN_COMPLETE_BUFFER)
    : THRESHOLDS.REST_REENTER;

  switch (fsm.phase) {
    case 'REST':
      // Waiting for push to begin. When ratio rises past threshold (arm straightening),
      // transition to EXTENDING.
      if (ratio > clockStartThreshold) {
        fsm.tPushStart ??= t;
      } else {
        fsm.tPushStart = null;
      }

      if (ratio > extendingEnterThreshold) {
        fsm.phase = 'EXTENDING';
        fsm.tRepStart = fsm.tPushStart ?? t;
        fsm.tExtended = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'EXTENDING':
      // Actively pushing down. When near-full extension reached, transition.
      if (ratio > THRESHOLDS.EXTENDED_ENTER) {
        fsm.phase = 'EXTENDED';
        fsm.tExtended = t;
      } else if (ratio < returnCompleteThreshold && fsm.tRepStart !== null) {
        // Went back to bent without extending -- reset
        fsm.phase = 'REST';
        fsm.tRepStart = null;
        fsm.tPushStart = null;
      }
      break;

    case 'EXTENDED':
      // At full extension. When ratio drops (arm bending back), transition.
      if (ratio < THRESHOLDS.EXTENDED_EXIT) {
        fsm.phase = 'RETURNING';
      }
      break;

    case 'RETURNING':
      // Controlled return. When ratio drops to bent position, rep is complete.
      if (
        ratio < returnCompleteThreshold &&
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

function computeCablePushdownScore(
  repWindow: RepWindow,
  allowedCueFamilies?: ReadonlySet<string>,
): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM -- extension: ideal max ratio is 0.98+. Shortfall = max(0, 0.98 - maxRatio)
  if (cueFamilyAllowed(allowedCueFamilies, 'handlePath')) {
    const extensionShortfall = Math.max(0, 0.98 - repWindow.maxRatio);
    penalties.push({ value: extensionShortfall, config: PENALTY_CONFIGS.EXTENSION_ROM });
  }

  // 2. ROM -- flexion: ideal min ratio is 0.55 or below. Excess = max(0, minRatio - 0.55)
  if (cueFamilyAllowed(allowedCueFamilies, 'visibleArmPath')) {
    const flexionExcess = Math.max(0, repWindow.minRatio - 0.55);
    penalties.push({ value: flexionExcess, config: PENALTY_CONFIGS.FLEXION_ROM });
  }

  // 3. Elbow drift (shoulder angle delta)
  if (cueFamilyAllowed(allowedCueFamilies, 'elbowPath') && repWindow.shoulderAngleSampleCount > 0) {
    penalties.push({ value: repWindow.maxShoulderDelta, config: PENALTY_CONFIGS.ELBOW_DRIFT });
    penalties.push({
      value: repWindow.elbowForwardAngleAtStart ?? 0,
      config: PENALTY_CONFIGS.ELBOW_FORWARD,
    });
  }

  // 4. Torso mechanics
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoControl') && repWindow.torsoDevSampleCount > 0) {
    penalties.push({ value: repWindow.maxTorsoAbsoluteDev, config: PENALTY_CONFIGS.TORSO_LEAN });
    penalties.push({ value: repWindow.maxTorsoRockDelta, config: PENALTY_CONFIGS.TORSO_ROCK });
  }

  const holdMs = lockoutHoldMs(repWindow);
  if (
    cueFamilyAllowed(allowedCueFamilies, 'handlePath') &&
    holdMs !== null &&
    repWindow.maxRatio >= FORM_THRESHOLDS.EXTENSION_FAIL
  ) {
    const holdDeficit = Math.max(0, FORM_THRESHOLDS.LOCKOUT_HOLD_MIN_MS - holdMs);
    penalties.push({ value: holdDeficit, config: PENALTY_CONFIGS.LOCKOUT_HOLD });
  }

  // 5. Tempo
  if (cueFamilyAllowed(allowedCueFamilies, 'tempo') && repWindow.tExtended !== null) {
    const tPush = repWindow.tExtended - repWindow.tStart;  // concentric (push down)
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tExtended); // eccentric (return)

    // Penalize if too fast (deficit is pre-computed, so pass with deadzone: 0)
    if (tPush > 0 && tPush < PENALTY_CONFIGS.TEMPO_PUSH.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_PUSH.deadzone - tPush;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_PUSH, deadzone: 0 } });
    }
    if (tReturn > 0 && tReturn < PENALTY_CONFIGS.TEMPO_RETURN.deadzone) {
      const deficit = PENALTY_CONFIGS.TEMPO_RETURN.deadzone - tReturn;
      penalties.push({ value: deficit, config: { ...PENALTY_CONFIGS.TEMPO_RETURN, deadzone: 0 } });
    }
  }
  const pushSpikeRatio = pushVelocitySpikeRatio(repWindow);
  if (cueFamilyAllowed(allowedCueFamilies, 'tempo') && pushSpikeRatio !== null) {
    penalties.push({ value: pushSpikeRatio, config: PENALTY_CONFIGS.PUSH_SPIKE });
  }
  const returnSpikeRatio = returnVelocitySpikeRatio(repWindow);
  if (cueFamilyAllowed(allowedCueFamilies, 'tempo') && returnSpikeRatio !== null) {
    penalties.push({ value: returnSpikeRatio, config: PENALTY_CONFIGS.RETURN_SPIKE });
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

  // 1. Extension ROM -- didn't lock out fully (max ratio too low)
  const holdMs = lockoutHoldMs(repWindow);
  if (
    cueFamilyAllowed(allowedCueFamilies, 'handlePath') &&
    (
      repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_FAIL ||
      (holdMs !== null &&
        repWindow.maxRatio >= FORM_THRESHOLDS.EXTENSION_FAIL &&
        holdMs < FORM_THRESHOLDS.LOCKOUT_HOLD_MIN_MS)
    )
  ) {
    messages.push('Extend fully \u2014 lock out at the bottom of each rep.');
  }

  // 2. Flexion ROM -- didn't bend enough at the top (min ratio too high)
  if (cueFamilyAllowed(allowedCueFamilies, 'visibleArmPath') && repWindow.minRatio > FORM_THRESHOLDS.FLEXION_FAIL) {
    messages.push('Start with a deeper bend \u2014 bring your forearms closer to your biceps.');
  }

  // 3. Elbow drift (shoulder movement)
  if (cueFamilyAllowed(allowedCueFamilies, 'elbowPath') && repWindow.maxShoulderDelta > FORM_THRESHOLDS.ELBOW_DRIFT_WARN) {
    messages.push('Keep your elbows pinned to your sides \u2014 avoid letting them drift.');
  }
  if (
    cueFamilyAllowed(allowedCueFamilies, 'elbowPath') &&
    (repWindow.elbowForwardAngleAtStart ?? 0) > FORM_THRESHOLDS.ELBOW_FORWARD_WARN
  ) {
    messages.push('Start with your elbows tucked by your sides.');
  }

  // 4. Torso lean
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoControl') && repWindow.maxTorsoAbsoluteDev > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Stay upright \u2014 avoid leaning into the pushdown.');
  }
  if (cueFamilyAllowed(allowedCueFamilies, 'torsoControl') && repWindow.maxTorsoRockDelta > FORM_THRESHOLDS.TORSO_ROCK_WARN) {
    messages.push('Keep your torso steady through the pushdown.');
  }

  // 5. Tempo
  const pushSpikeRatio = pushVelocitySpikeRatio(repWindow);
  const returnSpikeRatio = returnVelocitySpikeRatio(repWindow);
  if (cueFamilyAllowed(allowedCueFamilies, 'tempo') && repWindow.tExtended !== null) {
    const tPush = repWindow.tExtended - repWindow.tStart;
    const tReturn = repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tExtended);

    if (
      (tPush > 0 && tPush < FORM_THRESHOLDS.TEMPO_PUSH_MIN) ||
      (pushSpikeRatio !== null && pushSpikeRatio > FORM_THRESHOLDS.TEMPO_PUSH_SPIKE_WARN)
    ) {
      messages.push('Slow down the push \u2014 control the extension.');
    }
    if (
      (tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) ||
      (returnSpikeRatio !== null && returnSpikeRatio > FORM_THRESHOLDS.TEMPO_RETURN_SPIKE_WARN)
    ) {
      messages.push('Control the return \u2014 don\'t let the weight snap back.');
    }
  }

  return messages;
}

function buildCablePushdownDiagnostics(
  repWindow: RepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
  scorable: boolean,
): NonNullable<FrameworkRepResult['diagnostics']> {
  const hasTempo = repWindow.tExtended !== null;
  const tPush = repWindow.tExtended !== null ? repWindow.tExtended - repWindow.tStart : null;
  const tReturn = repWindow.tExtended !== null
    ? repWindow.tEnd - (repWindow.tReturnStart ?? repWindow.tExtended)
    : null;
  const sideViewConfidence = averageSideViewConfidence(repWindow);
  const hasSideViewConfidence = repWindow.sideViewConfidenceSamples >= FORM_THRESHOLDS.SIDE_VIEW_MIN_SAMPLES;
  const viewQuality = buildCablePushdownViewQuality(repWindow);
  const holdMs = lockoutHoldMs(repWindow);
  const shortLockoutHold = holdMs !== null &&
    repWindow.maxRatio >= FORM_THRESHOLDS.EXTENSION_FAIL &&
    holdMs < FORM_THRESHOLDS.LOCKOUT_HOLD_MIN_MS;
  const pushSpikeRatio = pushVelocitySpikeRatio(repWindow);
  const returnSpikeRatio = returnVelocitySpikeRatio(repWindow);
  const hasShoulderMetric = repWindow.shoulderAngleSampleCount > 0;
  const hasTorsoMetric = repWindow.torsoDevSampleCount > 0;
  const shoulderConfidence = hasShoulderMetric
    ? repWindow.shoulderAngleConfidenceSum / repWindow.shoulderAngleSampleCount
    : undefined;
  const torsoConfidence = hasTorsoMetric
    ? repWindow.torsoDevConfidenceSum / repWindow.torsoDevSampleCount
    : undefined;
  const shoulderSource = hasShoulderMetric ? dominantSourceLabel(repWindow.shoulderSourceCounts) : null;
  const torsoSource = hasTorsoMetric ? dominantSourceLabel(repWindow.torsoSourceCounts) : null;
  return buildRepDiagnostics({
    exerciseName: 'Cable Pushdowns',
    repIndex,
    view: diagnosticsViewFor(viewQuality),
    selectedSide: visibleSide,
    scorable,
    viewQuality,
    metrics: [
      diagnosticMetric('extensionRatio', repWindow.maxRatio, { unit: 'ratio' }),
      diagnosticMetric('flexionRatio', repWindow.minRatio, { unit: 'ratio' }),
      diagnosticMetric('romRatio', repWindow.maxRatio - repWindow.minRatio, { unit: 'ratio' }),
      diagnosticMetric('elbowDriftDelta', hasShoulderMetric ? repWindow.maxShoulderDelta : null, {
        unit: 'degrees',
        eligible: hasShoulderMetric,
        confidence: shoulderConfidence,
        sampleCount: repWindow.shoulderAngleSampleCount,
        skippedReason: 'shoulder_angle_unavailable',
      }),
      diagnosticMetric('elbowForwardAngle', hasShoulderMetric ? repWindow.elbowForwardAngleAtStart : null, {
        unit: 'degrees',
        eligible: hasShoulderMetric,
        confidence: shoulderConfidence,
        sampleCount: repWindow.shoulderAngleSampleCount,
        skippedReason: 'shoulder_angle_unavailable',
      }),
      diagnosticLabelMetric('shoulderMetricSource', shoulderSource, {
        sampleCount: repWindow.shoulderAngleSampleCount,
        skippedReason: 'shoulder_angle_unavailable',
      }),
      diagnosticMetric('torsoAbsoluteDeviation', hasTorsoMetric ? repWindow.maxTorsoAbsoluteDev : null, {
        unit: 'degrees',
        eligible: hasTorsoMetric,
        confidence: torsoConfidence,
        sampleCount: repWindow.torsoDevSampleCount,
        skippedReason: 'torso_chain_unavailable',
      }),
      diagnosticMetric('torsoRockDelta', hasTorsoMetric ? repWindow.maxTorsoRockDelta : null, {
        unit: 'degrees',
        eligible: hasTorsoMetric,
        confidence: torsoConfidence,
        sampleCount: repWindow.torsoDevSampleCount,
        skippedReason: 'torso_chain_unavailable',
      }),
      diagnosticLabelMetric('torsoMetricSource', torsoSource, {
        sampleCount: repWindow.torsoDevSampleCount,
        skippedReason: 'torso_chain_unavailable',
      }),
      diagnosticMetric('lockoutHoldMs', holdMs, {
        unit: 'milliseconds',
        eligible: holdMs !== null,
        skippedReason: 'lockout_hold_unavailable',
      }),
      diagnosticMetric('pushVelocitySpikeRatio', pushSpikeRatio, {
        unit: 'ratio',
        eligible: pushSpikeRatio !== null,
        sampleCount: repWindow.pushVelocityValues.length,
        skippedReason: 'push_velocity_unavailable',
      }),
      diagnosticMetric('returnVelocitySpikeRatio', returnSpikeRatio, {
        unit: 'ratio',
        eligible: returnSpikeRatio !== null,
        sampleCount: repWindow.returnVelocityValues.length,
        skippedReason: 'return_velocity_unavailable',
      }),
      diagnosticMetric('sideViewConfidence', sideViewConfidence, {
        unit: 'ratio',
        eligible: hasSideViewConfidence,
        sampleCount: repWindow.sideViewConfidenceSamples,
        skippedReason: 'insufficient_side_view_samples',
      }),
      diagnosticMetric('tPush', tPush, { unit: 'seconds', eligible: hasTempo, skippedReason: 'extension_not_detected' }),
      diagnosticMetric('tReturn', tReturn, { unit: 'seconds', eligible: hasTempo, skippedReason: 'extension_not_detected' }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'cable-pushdowns.lockout_short',
        metricKeys: ['extensionRatio', 'lockoutHoldMs'],
        direction: 'below',
        value: repWindow.maxRatio,
        thresholdPath: ['formThresholds.EXTENSION_FAIL', 'formThresholds.LOCKOUT_HOLD_MIN_MS'],
        thresholdValue: {
          extensionRatio: FORM_THRESHOLDS.EXTENSION_FAIL,
          lockoutHoldMs: FORM_THRESHOLDS.LOCKOUT_HOLD_MIN_MS,
        },
        triggered: repWindow.maxRatio < FORM_THRESHOLDS.EXTENSION_FAIL || shortLockoutHold,
      }),
      diagnosticCue({
        issueId: 'cable-pushdowns.rom_short',
        metricKeys: ['flexionRatio'],
        direction: 'above',
        value: repWindow.minRatio,
        thresholdPath: 'formThresholds.FLEXION_FAIL',
        thresholdValue: FORM_THRESHOLDS.FLEXION_FAIL,
        triggered: repWindow.minRatio > FORM_THRESHOLDS.FLEXION_FAIL,
      }),
      diagnosticCue({
        issueId: 'cable-pushdowns.elbow_drift',
        metricKeys: ['elbowDriftDelta'],
        direction: 'above',
        value: hasShoulderMetric ? repWindow.maxShoulderDelta : null,
        thresholdPath: 'formThresholds.ELBOW_DRIFT_WARN',
        thresholdValue: FORM_THRESHOLDS.ELBOW_DRIFT_WARN,
        eligible: hasShoulderMetric,
        triggered: hasShoulderMetric && repWindow.maxShoulderDelta > FORM_THRESHOLDS.ELBOW_DRIFT_WARN,
        skippedReason: 'shoulder_angle_unavailable',
      }),
      diagnosticCue({
        issueId: 'cable-pushdowns.elbow_forward',
        metricKeys: ['elbowForwardAngle'],
        direction: 'above',
        value: hasShoulderMetric ? repWindow.elbowForwardAngleAtStart : null,
        thresholdPath: 'formThresholds.ELBOW_FORWARD_WARN',
        thresholdValue: FORM_THRESHOLDS.ELBOW_FORWARD_WARN,
        eligible: hasShoulderMetric,
        triggered: hasShoulderMetric && (repWindow.elbowForwardAngleAtStart ?? 0) > FORM_THRESHOLDS.ELBOW_FORWARD_WARN,
        skippedReason: 'shoulder_angle_unavailable',
      }),
      diagnosticCue({
        issueId: 'cable-pushdowns.torso_warn',
        metricKeys: ['torsoAbsoluteDeviation'],
        direction: 'above',
        value: hasTorsoMetric ? repWindow.maxTorsoAbsoluteDev : null,
        thresholdPath: 'formThresholds.TORSO_LEAN_WARN',
        thresholdValue: FORM_THRESHOLDS.TORSO_LEAN_WARN,
        eligible: hasTorsoMetric,
        triggered: hasTorsoMetric && repWindow.maxTorsoAbsoluteDev > FORM_THRESHOLDS.TORSO_LEAN_WARN,
        skippedReason: 'torso_chain_unavailable',
      }),
      diagnosticCue({
        issueId: 'cable-pushdowns.torso_rocking',
        metricKeys: ['torsoRockDelta'],
        direction: 'above',
        value: hasTorsoMetric ? repWindow.maxTorsoRockDelta : null,
        thresholdPath: 'formThresholds.TORSO_ROCK_WARN',
        thresholdValue: FORM_THRESHOLDS.TORSO_ROCK_WARN,
        eligible: hasTorsoMetric,
        triggered: hasTorsoMetric && repWindow.maxTorsoRockDelta > FORM_THRESHOLDS.TORSO_ROCK_WARN,
        skippedReason: 'torso_chain_unavailable',
      }),
      diagnosticCue({
        issueId: 'cable-pushdowns.tempo_down',
        metricKeys: ['tPush', 'pushVelocitySpikeRatio'],
        direction: 'below',
        value: tPush,
        thresholdPath: ['formThresholds.TEMPO_PUSH_MIN', 'formThresholds.TEMPO_PUSH_SPIKE_WARN'],
        thresholdValue: {
          tPush: FORM_THRESHOLDS.TEMPO_PUSH_MIN,
          pushVelocitySpikeRatio: FORM_THRESHOLDS.TEMPO_PUSH_SPIKE_WARN,
        },
        eligible: hasTempo,
        triggered: hasTempo && (
          (tPush !== null && tPush > 0 && tPush < FORM_THRESHOLDS.TEMPO_PUSH_MIN) ||
          (pushSpikeRatio !== null && pushSpikeRatio > FORM_THRESHOLDS.TEMPO_PUSH_SPIKE_WARN)
        ),
        skippedReason: 'extension_not_detected',
      }),
      diagnosticCue({
        issueId: 'cable-pushdowns.tempo_up',
        metricKeys: ['tReturn', 'returnVelocitySpikeRatio'],
        direction: 'below',
        value: tReturn,
        thresholdPath: ['formThresholds.TEMPO_RETURN_MIN', 'formThresholds.TEMPO_RETURN_SPIKE_WARN'],
        thresholdValue: {
          tReturn: FORM_THRESHOLDS.TEMPO_RETURN_MIN,
          returnVelocitySpikeRatio: FORM_THRESHOLDS.TEMPO_RETURN_SPIKE_WARN,
        },
        eligible: hasTempo,
        triggered: hasTempo && (
          (tReturn !== null && tReturn > 0 && tReturn < FORM_THRESHOLDS.TEMPO_RETURN_MIN) ||
          (returnSpikeRatio !== null && returnSpikeRatio > FORM_THRESHOLDS.TEMPO_RETURN_SPIKE_WARN)
        ),
        skippedReason: 'extension_not_detected',
      }),
    ],
  });
}

function buildCablePushdownRepResult(
  repWindow: RepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
): RepResult {
  const reliability = reliabilityInterpretationForRepWindow(repWindow, visibleSide);
  const reliabilityInterpretation = reliability?.interpretation ?? null;
  const sideViewScorable = isCablePushdownRepScorable(repWindow);
  const cueDecision = resolveCableViewCueDecision({
    allCueFamilies: CABLE_PUSHDOWN_CUE_FAMILIES,
    meaningfulCueFamilies: CABLE_PUSHDOWN_MEANINGFUL_CUE_FAMILIES,
    cueViewRequirements: CABLE_PUSHDOWN_CUE_VIEW_REQUIREMENTS,
    sideViewGatePassed: sideViewScorable,
    interpretation: reliabilityInterpretation,
    selectedSide: visibleSide,
  });
  const scorable = cueDecision.scorable;
  const score = scorable ? computeCablePushdownScore(repWindow, cueDecision.finalAllowedCueFamilies) : 0;
  const canShowCueFeedback = sideViewScorable || cueDecision.partialViewScoringAllowed;
  const messages = canShowCueFeedback
    ? generateFormMessages(repWindow, cueDecision.finalAllowedCueFamilies)
    : [];
  const finalMessages = suppressUnsafeReliabilityMessages(messages, reliabilityInterpretation);
  const qualityWarnings = cablePushdownQualityWarnings(repWindow);
  const diagnostics = applyCablePushdownCueGating(
    buildCablePushdownDiagnostics(repWindow, repIndex, visibleSide, scorable),
    reliabilityInterpretation,
    cueDecision,
  );
  logCablePushdownRepReliability(repIndex, reliabilityInterpretation, diagnostics);
  logCablePushdownScoringDecision({
    repIndex,
    repWindow,
    visibleSide,
    scorable,
    qualityWarnings,
    interpretation: reliabilityInterpretation,
    diagnostics,
  });
  return {
    repIndex,
    score,
    messages: finalMessages,
    scorable,
    qualityWarnings,
    diagnostics,
  };
}

function recordRepWindowFrame(
  window: RepWindow,
  options: {
    t: number;
    rawRatio: number;
    smoothedRatio: number;
    shoulderAngle: number | null;
    shoulderSource: LandmarkSourceName | null;
    rawShoulderConfidence: number | null;
    torsoDev: number | null;
    torsoSource: LandmarkSourceName | null;
    rawTorsoConfidence: number | null;
    sideViewConfidence: number | null;
    previousPhase: CablePushdownPhase;
    nextPhase: CablePushdownPhase;
  },
): void {
  const {
    t,
    rawRatio,
    smoothedRatio,
    shoulderAngle,
    shoulderSource,
    rawShoulderConfidence,
    torsoDev,
    torsoSource,
    rawTorsoConfidence,
    sideViewConfidence,
    previousPhase,
    nextPhase,
  } = options;

  window.tEnd = t;
  window.frameCount++;

  if (!isNaN(smoothedRatio)) {
    window.minRatio = Math.min(window.minRatio, smoothedRatio);
  }
  if (!isNaN(rawRatio)) {
    window.maxRatio = Math.max(window.maxRatio, rawRatio);
    if (rawRatio >= THRESHOLDS.EXTENDED_ENTER) {
      window.currentLockoutStartAt ??= t;
      window.currentLockoutLastAt = t;
      window.lockoutSampleCount++;
      window.bestLockoutHoldMs = Math.max(
        window.bestLockoutHoldMs,
        (t - window.currentLockoutStartAt) * 1000,
      );
    } else if (window.currentLockoutLastAt !== null) {
      const gapMs = (t - window.currentLockoutLastAt) * 1000;
      if (gapMs > FORM_THRESHOLDS.LOCKOUT_GAP_TOLERANCE_MS) {
        window.currentLockoutStartAt = null;
        window.currentLockoutLastAt = null;
      }
    }
  }

  if (sideViewConfidence !== null) {
    window.sideViewConfidenceSum += sideViewConfidence;
    window.sideViewConfidenceMin = Math.min(window.sideViewConfidenceMin, sideViewConfidence);
    window.sideViewConfidenceSamples++;
  }

  if (shoulderAngle !== null) {
    window.shoulderAngleSampleCount++;
    if (shoulderSource) window.shoulderSourceCounts[shoulderSource]++;
    window.shoulderAngleConfidenceSum += rawShoulderConfidence ?? FORM_CONFIDENCE_MIN;
    if (window.shoulderAngleBaseline === null) {
      window.shoulderAngleBaseline = shoulderAngle;
      window.elbowForwardAngleAtStart = shoulderAngle;
    }
    const delta = Math.abs(shoulderAngle - window.shoulderAngleBaseline);
    window.maxShoulderDelta = Math.max(window.maxShoulderDelta, delta);
  }

  if (torsoDev !== null) {
    window.torsoDevSampleCount++;
    if (torsoSource) window.torsoSourceCounts[torsoSource]++;
    window.torsoDevConfidenceSum += rawTorsoConfidence ?? FORM_CONFIDENCE_MIN;
    if (window.torsoDevBaseline === null) {
      window.torsoDevBaseline = torsoDev;
    }
    const torsoDelta = Math.abs(torsoDev - window.torsoDevBaseline);
    window.maxTorsoAbsoluteDev = Math.max(window.maxTorsoAbsoluteDev, Math.abs(torsoDev));
    window.maxTorsoRockDelta = Math.max(window.maxTorsoRockDelta, torsoDelta);
  }

  if (nextPhase === 'EXTENDED' && window.tExtended === null) {
    window.tExtended = t;
  }
  if (previousPhase === 'EXTENDED' && nextPhase === 'RETURNING' && window.tReturnStart === null) {
    window.tReturnStart = t;
  }

  const previousRatio = window.lastVelocityRatio;
  const previousTimestamp = window.lastVelocityTimestamp;
  if (
    previousRatio !== null &&
    previousTimestamp !== null &&
    t > previousTimestamp
  ) {
    const dt = t - previousTimestamp;
    const pushVelocity = Math.max(0, (rawRatio - previousRatio) / dt);
    const returnVelocity = Math.max(0, (previousRatio - rawRatio) / dt);
    if (
      Number.isFinite(pushVelocity) &&
      pushVelocity > 0 &&
      (previousPhase === 'EXTENDING' || nextPhase === 'EXTENDING')
    ) {
      window.pushVelocityValues.push(pushVelocity);
    }
    if (
      Number.isFinite(returnVelocity) &&
      returnVelocity > 0 &&
      (previousPhase === 'RETURNING' || nextPhase === 'RETURNING')
    ) {
      window.returnVelocityValues.push(returnVelocity);
    }
  }
  window.lastVelocityRatio = rawRatio;
  window.lastVelocityTimestamp = t;
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updateCablePushdownState(
  keypoints: Keypoint[],
  currentState: CablePushdownState,
  frameContext?: ExerciseFrameContext,
): CablePushdownState {
  const t = Date.now() / 1000;

  if (frameContext?.trackingInterrupted) {
    return resetCablePushdownAfterTrackingInterruption(currentState);
  }

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
  // transient confidence changes do not splice two arms into one rep.
  const inActiveRep = currentState.fsm.phase !== 'REST';
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(signalKeypoints);

  // Calculate raw values
  const rawRatio = computeReachRatio(signalKeypoints, visibleSide);
  const shoulderSample = calculateShoulderAngleSample(frameContext, keypoints, visibleSide);
  const torsoSample = calculateTorsoDeviationSample(frameContext, keypoints, visibleSide);
  const rawShoulder = shoulderSample?.value ?? null;
  const rawTorsoDev = torsoSample?.value ?? null;
  const rawShoulderSource = shoulderSample?.source ?? null;
  const rawTorsoSource = torsoSample?.source ?? null;
  const rawShoulderConfidence = shoulderSample
    ? minKeypointConfidence(shoulderSample.keypoints, [`${visibleSide}_hip`, `${visibleSide}_shoulder`, `${visibleSide}_elbow`])
    : null;
  const rawTorsoConfidence = torsoSample
    ? minKeypointConfidence(torsoSample.keypoints, [`${visibleSide}_hip`, `${visibleSide}_shoulder`])
    : null;
  const sideViewConfidence = calculateSideViewConfidence(signalKeypoints, visibleSide);
  const ratioConf = minKeypointConfidence(signalKeypoints, [
    `${visibleSide}_shoulder`, `${visibleSide}_elbow`, `${visibleSide}_wrist`,
  ]);

  // If we can't compute the ratio, bail out
  if (isNaN(rawRatio)) {
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
  const smoothedRatio = currentState.ratioTracker.push(rawRatio, ratioConf);
  const fastRatio = currentState.ratioTracker.medianValue;
  const smoothedShoulder = rawShoulder !== null
    ? currentState.shoulderTracker.push(rawShoulder)
    : currentState.shoulderTracker.value;
  const smoothedTorso = rawTorsoDev !== null
    ? currentState.torsoTracker.push(rawTorsoDev)
    : currentState.torsoTracker.value;
  const medianShoulder = currentState.shoulderTracker.medianValue;
  const medianTorso = currentState.torsoTracker.medianValue;

  const newState: CablePushdownState = {
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

  const shoulderAngleForForm = rawShoulder !== null && isFiniteMetric(medianShoulder)
    ? medianShoulder
    : null;
  const torsoDevForForm = rawTorsoDev !== null && isFiniteMetric(medianTorso)
    ? medianTorso
    : null;

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

  // Track minimum ratio during REST before the FSM check. This lets the
  // movement-start gate distinguish a shallow static top from an actual push.
  if (currentState.fsm.phase === 'REST' && currentState.repWindow === null && !isNaN(smoothedRatio)) {
    newState.restMinRatio = Math.min(currentState.restMinRatio, smoothedRatio);
  }

  // Update FSM
  const restReferenceRatio = newState.restMinRatio !== Infinity ? newState.restMinRatio : null;
  const repStartRatio = currentState.repWindow && currentState.repWindow.startRatio !== Infinity
    ? currentState.repWindow.startRatio
    : null;
  const fsmResult = updateFSM(currentState.fsm, fastRatio, t, restReferenceRatio, repStartRatio);
  newState.fsm = fsmResult.fsm;

  const returnedPartial =
    currentState.fsm.phase === 'EXTENDING' &&
    newState.fsm.phase === 'REST' &&
    !fsmResult.repCompleted &&
    newState.repWindow !== null;

  if (returnedPartial && newState.repWindow) {
    const window = newState.repWindow;
    observeCablePushdownPoseState(window, frameContext);
    recordRepWindowFrame(window, {
      t,
      rawRatio,
      smoothedRatio,
      shoulderAngle: shoulderAngleForForm,
      shoulderSource: rawShoulderSource,
      rawShoulderConfidence,
      torsoDev: torsoDevForForm,
      torsoSource: rawTorsoSource,
      rawTorsoConfidence,
      sideViewConfidence,
      previousPhase: currentState.fsm.phase,
      nextPhase: newState.fsm.phase,
    });
    const actualRom = window.maxRatio - window.minRatio;
    const duration = window.tEnd - window.tStart;

    if (isMeaningfulPartialRep({
      actualRom,
      minRom: THRESHOLDS.MIN_PARTIAL_ROM,
      duration,
      minDuration: THRESHOLDS.MIN_REP_TIME,
    })) {
      newState.repCount++;
      const repResult = buildCablePushdownRepResult(window, newState.repCount, visibleSide);
      const messages = repResult.messages;
      newState.lastRepResult = repResult;
      newState.feedback = repResult.scorable === false
        ? SIDE_VIEW_SETUP_FEEDBACK
        : messages.length > 0
          ? messages.join('\n')
          : 'Good rep.';
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
    // Pre-seed minRatio with the resting bent ratio so flexion ROM is measured correctly
    if (currentState.restMinRatio !== Infinity) {
      newState.repWindow.minRatio = currentState.restMinRatio;
      newState.repWindow.startRatio = currentState.restMinRatio;
    }
    newState.restMinRatio = Infinity; // Reset for next rep
  }

  if (newState.repWindow && inRep) {
    observeCablePushdownPoseState(newState.repWindow, frameContext);
    recordRepWindowFrame(newState.repWindow, {
      t,
      rawRatio,
      smoothedRatio,
      shoulderAngle: shoulderAngleForForm,
      shoulderSource: rawShoulderSource,
      rawShoulderConfidence,
      torsoDev: torsoDevForForm,
      torsoSource: rawTorsoSource,
      rawTorsoConfidence,
      sideViewConfidence,
      previousPhase: currentState.fsm.phase,
      nextPhase: newState.fsm.phase,
    });
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    observeCablePushdownPoseState(newState.repWindow, frameContext);
    recordRepWindowFrame(newState.repWindow, {
      t,
      rawRatio,
      smoothedRatio,
      shoulderAngle: shoulderAngleForForm,
      shoulderSource: rawShoulderSource,
      rawShoulderConfidence,
      torsoDev: torsoDevForForm,
      torsoSource: rawTorsoSource,
      rawTorsoConfidence,
      sideViewConfidence,
      previousPhase: currentState.fsm.phase,
      nextPhase: newState.fsm.phase,
    });

    newState.repCount++;

    const repResult = buildCablePushdownRepResult(newState.repWindow, newState.repCount, visibleSide);
    const messages = repResult.messages;
    newState.lastRepResult = repResult;

    if (messages.length > 0) {
      newState.feedback = messages.join('\n');
    } else if (repResult.scorable === false) {
      newState.feedback = SIDE_VIEW_SETUP_FEEDBACK;
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

function getDebugInfo(state: CablePushdownState): CablePushdownDebugInfo {
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
    sideViewConfidence: repWin ? fmt(averageSideViewConfidence(repWin)) : fmt(averageSetupSideViewConfidence(state)),
    ratioMin: repWin && repWin.minRatio !== Infinity ? fmt(repWin.minRatio) : null,
    ratioMax: repWin && repWin.maxRatio !== -Infinity ? fmt(repWin.maxRatio) : null,
    shoulderDelta: repWin ? fmt(repWin.maxShoulderDelta) : null,
    elbowForwardAngle: repWin ? fmt(repWin.elbowForwardAngleAtStart) : null,
    torsoDevMax: repWin ? fmt(repWin.maxTorsoAbsoluteDev) : null,
    torsoRockDelta: repWin ? fmt(repWin.maxTorsoRockDelta) : null,
    pushVelocitySpikeRatio: repWin ? fmt(pushVelocitySpikeRatio(repWin)) : null,
    returnVelocitySpikeRatio: repWin ? fmt(returnVelocitySpikeRatio(repWin)) : null,
  };
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================

function configNumber(config: ExerciseHeuristicConfig, path: string, issues: string[]): number | null {
  const value = getConfigValue(config, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`Cable Pushdowns config "${path}" must be a finite number.`);
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
      `Cable Pushdowns config ordering invalid: "${firstPath}" (${first}) must be ${allowEqual ? '<=' : '<'} "${secondPath}" (${second}).`,
    );
  }
}

function validatePenaltyConfigs(config: ExerciseHeuristicConfig, issues: string[]): void {
  const penaltyConfigs = getConfigValue(config, 'penaltyConfigs');
  if (penaltyConfigs === null || typeof penaltyConfigs !== 'object' || Array.isArray(penaltyConfigs)) {
    issues.push('Cable Pushdowns config "penaltyConfigs" must be an object.');
    return;
  }

  for (const [penaltyName, penaltyConfig] of Object.entries(penaltyConfigs)) {
    if (penaltyConfig === null || typeof penaltyConfig !== 'object' || Array.isArray(penaltyConfig)) {
      issues.push(`Cable Pushdowns penalty config "${penaltyName}" must be an object.`);
      continue;
    }
    for (const [key, value] of Object.entries(penaltyConfig)) {
      const path = `penaltyConfigs.${penaltyName}.${key}`;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(`Cable Pushdowns config "${path}" must be a finite number.`);
        continue;
      }
      if (key === 'scale' && value <= 0) {
        issues.push(`Cable Pushdowns config "${path}" must be greater than 0.`);
      }
      if (key === 'cap' && value < 0) {
        issues.push(`Cable Pushdowns config "${path}" must be greater than or equal to 0.`);
      }
      if (key === 'deadzone' && value < 0) {
        issues.push(`Cable Pushdowns config "${path}" must be greater than or equal to 0.`);
      }
    }
  }
}

function validateCablePushdownHeuristicConfig(config: ExerciseHeuristicConfig): string[] {
  const issues: string[] = [];

  requireOrdered(config, issues, 'thresholds.PUSH_CLOCK_START', 'thresholds.EXTENDING_ENTER', true);
  requireOrdered(config, issues, 'thresholds.PUSH_CLOCK_DELTA', 'thresholds.MOVEMENT_START_DELTA', true);
  requireOrdered(config, issues, 'thresholds.REST_REENTER', 'thresholds.EXTENDING_ENTER', true);
  requireOrdered(config, issues, 'thresholds.EXTENDING_ENTER', 'thresholds.EXTENDED_EXIT');
  requireOrdered(config, issues, 'thresholds.EXTENDED_EXIT', 'thresholds.EXTENDED_ENTER');
  requireOrdered(config, issues, 'thresholds.RETURN_COMPLETE_BUFFER', 'thresholds.EXTENDING_ENTER');
  requireOrdered(config, issues, 'thresholds.MIN_PARTIAL_ROM', 'thresholds.EXTENDING_ENTER');
  requireOrdered(config, issues, 'thresholds.REST_REENTER', 'formThresholds.FLEXION_FAIL', true);
  requireOrdered(config, issues, 'formThresholds.FLEXION_FAIL', 'thresholds.EXTENDED_ENTER');
  requireOrdered(config, issues, 'thresholds.EXTENDED_EXIT', 'formThresholds.EXTENSION_FAIL', true);
  requireOrdered(config, issues, 'thresholds.EXTENDED_ENTER', 'formThresholds.EXTENSION_FAIL', true);
  requireOrdered(
    config,
    issues,
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    true,
  );

  const minPartialRom = configNumber(config, 'thresholds.MIN_PARTIAL_ROM', issues);
  const extendedEnter = configNumber(config, 'thresholds.EXTENDED_ENTER', issues);
  const restReenter = configNumber(config, 'thresholds.REST_REENTER', issues);
  if (minPartialRom !== null && extendedEnter !== null && restReenter !== null) {
    const fullRom = extendedEnter - restReenter;
    if (minPartialRom <= 0 || minPartialRom >= fullRom) {
      issues.push(
        `Cable Pushdowns config "thresholds.MIN_PARTIAL_ROM" (${minPartialRom}) must be greater than 0 and less than EXTENDED_ENTER - REST_REENTER (${fullRom}).`,
      );
    }
  }

  for (const path of [
    'thresholds.PUSH_CLOCK_START',
    'thresholds.PUSH_CLOCK_DELTA',
    'thresholds.EXTENDING_ENTER',
    'thresholds.MOVEMENT_START_DELTA',
    'thresholds.EXTENDED_ENTER',
    'thresholds.EXTENDED_EXIT',
    'thresholds.REST_REENTER',
    'thresholds.RETURN_COMPLETE_BUFFER',
    'thresholds.MIN_PARTIAL_ROM',
    'formThresholds.EXTENSION_FAIL',
    'formThresholds.FLEXION_FAIL',
    'formThresholds.SIDE_VIEW_AVG_CONFIDENCE_MIN',
    'formThresholds.SIDE_VIEW_MIN_CONFIDENCE_MIN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && (value < 0 || value > 1)) {
      issues.push(`Cable Pushdowns config "${path}" must be between 0 and 1.`);
    }
  }

  for (const path of [
    'thresholds.MIN_REP_TIME',
    'formThresholds.ELBOW_DRIFT_WARN',
    'formThresholds.ELBOW_FORWARD_WARN',
    'formThresholds.TORSO_LEAN_WARN',
    'formThresholds.TORSO_ROCK_WARN',
    'formThresholds.LOCKOUT_HOLD_MIN_MS',
    'formThresholds.TEMPO_PUSH_MIN',
    'formThresholds.TEMPO_RETURN_MIN',
    'formThresholds.TEMPO_PUSH_SPIKE_WARN',
    'formThresholds.TEMPO_RETURN_SPIKE_WARN',
  ]) {
    const value = configNumber(config, path, issues);
    if (value !== null && value <= 0) {
      issues.push(`Cable Pushdowns config "${path}" must be greater than 0.`);
    }
  }

  const lockoutGap = configNumber(config, 'formThresholds.LOCKOUT_GAP_TOLERANCE_MS', issues);
  if (lockoutGap !== null && lockoutGap < 0) {
    issues.push('Cable Pushdowns config "formThresholds.LOCKOUT_GAP_TOLERANCE_MS" must be greater than or equal to 0.');
  }

  const sideViewMinSamples = configNumber(config, 'formThresholds.SIDE_VIEW_MIN_SAMPLES', issues);
  if (
    sideViewMinSamples !== null &&
    (!Number.isInteger(sideViewMinSamples) || sideViewMinSamples <= 0)
  ) {
    issues.push('Cable Pushdowns config "formThresholds.SIDE_VIEW_MIN_SAMPLES" must be a positive integer.');
  }

  validatePenaltyConfigs(config, issues);
  return issues;
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createCablePushdownDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_CABLE_PUSHDOWN_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
    name: 'Cable Pushdowns',
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
      _internal: withCablePushdownConfig(config, () => initializeCablePushdownState()),
    }),

    update: (keypoints: Keypoint[], state: ExerciseState, frameContext?: ExerciseFrameContext): ExerciseState => {
      const internal = state._internal as CablePushdownState;
      const newInternal = withCablePushdownConfig(
        config,
        () => updateCablePushdownState(keypoints, internal, frameContext),
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
      const updateLiveCameraAnalysis = completedNewRep || frameContext?.cameraAnalysisStatusRequested !== false;
      const liveQualityWarnings = updateLiveCameraAnalysis
        ? newInternal.repWindow
          ? cablePushdownQualityWarnings(newInternal.repWindow)
          : completedNewRep
            ? (lastRepResult?.qualityWarnings ?? [])
            : cablePushdownSetupQualityWarnings(newInternal)
        : (state.liveQualityWarnings ?? []);
      const liveAnalysisStatus = updateLiveCameraAnalysis
        ? newInternal.repWindow
          ? cablePushdownRepWindowAnalysisStatus(newInternal.repWindow, newInternal.visibleSide)
          : completedNewRep
            ? cameraStatusFromViewCueGating({
                viewCueGating: lastRepResult?.diagnostics?.viewCueGating,
                reliability: lastRepResult?.diagnostics?.reliability,
                viewRequired: 'side',
                source: 'exercise',
              })
            : cablePushdownSetupAnalysisStatus(newInternal)
        : (state.liveAnalysisStatus ?? null);

      return {
        repCount: newInternal.repCount,
        lastRepResult,
        feedback: newInternal.feedback,
        feedbackTimestamp: newInternal.lastFeedbackTime > 0 ? newInternal.lastFeedbackTime : null,
        debugInfo: getDebugInfo(newInternal) as unknown as Record<string, unknown>,
        repQualityWindowActive: newInternal.repWindow !== null,
        liveQualityWarnings,
        liveAnalysisStatus,
        _internal: newInternal,
      };
    },

    heuristicConfig: config,
    tunableSpec: CABLE_PUSHDOWN_TUNABLE_SPEC,
    tunedConfigPath: 'src/utils/exercises/definitions/tuned/cablePushdown.json',
    createVariant: (variantConfig) =>
      createCablePushdownDefinition(mergeHeuristicConfig(config, variantConfig)),
    validateHeuristicConfig: validateCablePushdownHeuristicConfig,

    ttsConfig: {
      feedbackToIssue: {
        'Extend fully \u2014 lock out at the bottom of each rep.': 'lockout_short',
        'Start with a deeper bend \u2014 bring your forearms closer to your biceps.': 'rom_short',
        'Keep your elbows pinned to your sides \u2014 avoid letting them drift.': 'elbow_drift',
        'Start with your elbows tucked by your sides.': 'elbow_forward',
        'Stay upright \u2014 avoid leaning into the pushdown.': 'torso_warn',
        'Keep your torso steady through the pushdown.': 'torso_rocking',
        'Slow down the push \u2014 control the extension.': 'tempo_down',
        "Control the return \u2014 don't let the weight snap back.": 'tempo_up',
      },
      feedbackMessages: {
        'Extend fully \u2014 lock out at the bottom of each rep.': [
          'Lock out at the bottom.',
          'Finish the pushdown.',
          'Full extension at the bottom.',
        ],
        'Start with a deeper bend \u2014 bring your forearms closer to your biceps.': [
          'Start from a deeper bend.',
          'Let it come up for a fuller stretch.',
          'More bend at the top before you press.',
        ],
        'Stay upright \u2014 avoid leaning into the pushdown.': [
          'Stay tall through the pushdown.',
          'Less lean. Let the triceps do it.',
          'Brace your core and stay upright.',
        ],
        'Start with your elbows tucked by your sides.': [
          'Start with elbows tucked.',
          'Set your elbows by your sides first.',
          'Bring your elbows back before you press.',
        ],
        'Keep your torso steady through the pushdown.': [
          'Keep your torso steady.',
          'Brace and press without rocking.',
          'No body swing on the pushdown.',
        ],
        'Slow down the push \u2014 control the extension.': [
          'Press down with control.',
          'Control the pushdown.',
          'Press with control, no rushing.',
        ],
        "Control the return \u2014 don't let the weight snap back.": [
          'Control the return.',
          "Don't let it snap back.",
          'Resist the weight on the way up.',
        ],
      },
      issueDefinitions: [
        {
          issueType: 'rom_short',
          priority: 20,
          messages: [
            'Get a fuller stretch at the top.',
            'Deeper starting position.',
            'Bring it up higher.',
          ],
        },
        {
          issueType: 'elbow_drift',
          priority: 25,
          messages: [
            'Keep your elbows pinned.',
            'Elbows tight to your sides.',
            'Lock those elbows in place.',
          ],
        },
        {
          issueType: 'elbow_forward',
          priority: 24,
          messages: [
            'Start with elbows tucked.',
            'Set your elbows by your sides.',
            'Pull your elbows back before pressing.',
          ],
        },
        {
          issueType: 'torso_rocking',
          priority: 18,
          messages: [
            'Keep your torso steady.',
            'Brace without rocking.',
            'No body swing.',
          ],
        },
      ],
    },

    summaryConfig: {
      'Extend fully \u2014 lock out at the bottom of each rep.':
        'Focus on achieving full lockout at the bottom of each rep for maximum tricep activation.',
      'Start with a deeper bend \u2014 bring your forearms closer to your biceps.':
        'Allow a deeper stretch at the top position to maximize the range of motion.',
      'Keep your elbows pinned to your sides \u2014 avoid letting them drift.':
        'Keep your elbows locked to your sides throughout the movement to isolate the triceps.',
      'Start with your elbows tucked by your sides.':
        'Begin each rep with your elbows tucked by your sides before pressing down.',
      'Stay upright \u2014 avoid leaning into the pushdown.':
        'Maintain an upright posture \u2014 leaning forward uses momentum instead of tricep strength.',
      'Keep your torso steady through the pushdown.':
        'Brace your torso and avoid rocking so the triceps drive the movement.',
      'Slow down the push \u2014 control the extension.':
        'Control the concentric phase \u2014 aim for 1-2 seconds on the push down.',
      "Control the return \u2014 don't let the weight snap back.":
        'Slow the eccentric phase \u2014 resist the weight on the way up for 2-3 seconds.',
    },
  };
}

export const cablePushdownDefinition: ExerciseDefinition = createCablePushdownDefinition();
