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
  calculateVerticalAngle,
  getKeypoint,
  isVisible,
  minKeypointConfidence,
} from '../../poseAnalysis';

import type {
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  ExerciseState,
  RepResult as FrameworkRepResult,
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
  diagnosticMetric,
} from '../shared/diagnostics';
import { LOW_ROM_FEEDBACK, isMeaningfulPartialRep } from '../shared/partialReps';
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
  lockoutBaselineRatio: number | null;
  /** True thigh depth angle: positive = shallow, 0 = parallel, negative = below parallel */
  minThighDepthAngle: number;
  thighDepthSampleCount: number;
  thighDepthConfidenceSum: number;
  /** Max torso forward lean (degrees from vertical) during rep */
  maxTorsoLean: number;
  torsoLeanBaseline: number | null;
  maxTorsoLeanDelta: number;
  torsoLeanSignedBaseline: number | null;
  maxTorsoLeanSigned: number;
  maxTorsoLeanSignedDelta: number;
  torsoLeanSampleCount: number;
  torsoLeanConfidenceSum: number;
  /** Heel lift relative to standing foot pitch baseline */
  footPitchBaseline: number | null;
  maxHeelLiftDeltaDeg: number;
  heelLiftSampleCount: number;
  heelLiftTriggeredSampleCount: number;
  heelLiftConfidenceSum: number;
  /** Side-view quality diagnostics */
  maxSideViewWidthRatio: number;
  sideViewSampleCount: number;
  sideViewConfidenceSum: number;
  /** Timestamps */
  tStart: number;
  tBottom: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
  pendingCompletionFrames: number | null;
  /** True when a meaningful partial rep was counted from a reset before bottom */
  partialRep: boolean;
}

interface SquatAngles {
  knee: number;
  kneeRatio: number; // reach ratio: camera-invariant
  torsoLean: number;
  torsoLeanSigned: number;
  hipAngle: number;
  thighDepthAngle: number;
  footPitch: number;
  sideViewWidthRatio: number;
}

interface SmoothedSquatAngles extends SquatAngles {}

interface RepResult {
  repIndex: number;
  romRatio: number; // ratio ROM (max - min reach ratio)
  tDown: number;
  tUp: number;
  score: number;
  messages: string[];
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
    lockoutBaselineRatio:
      initialKneeRatio !== undefined && Number.isFinite(initialKneeRatio)
        ? initialKneeRatio
        : null,
    minThighDepthAngle: Infinity,
    thighDepthSampleCount: 0,
    thighDepthConfidenceSum: 0,
    maxTorsoLean: -Infinity,
    torsoLeanBaseline: baselines.torsoLeanBaseline ?? null,
    maxTorsoLeanDelta: 0,
    torsoLeanSignedBaseline: baselines.torsoLeanSignedBaseline ?? null,
    maxTorsoLeanSigned: -Infinity,
    maxTorsoLeanSignedDelta: 0,
    torsoLeanSampleCount: 0,
    torsoLeanConfidenceSum: 0,
    footPitchBaseline: baselines.footPitchBaseline ?? null,
    maxHeelLiftDeltaDeg: 0,
    heelLiftSampleCount: 0,
    heelLiftTriggeredSampleCount: 0,
    heelLiftConfidenceSum: 0,
    maxSideViewWidthRatio: -Infinity,
    sideViewSampleCount: 0,
    sideViewConfidenceSum: 0,
    tStart,
    tBottom: null,
    tEnd: tStart,
    frameCount: 0,
    pendingCompletionFrames: null,
    partialRep: false,
  };
}

function initializeSquatState(): SquatState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    angleHistory: {
      knee: [],
      kneeRatio: [],
      torsoLean: [],
      torsoLeanSigned: [],
      hipAngle: [],
      thighDepthAngle: [],
      footPitch: [],
      sideViewWidthRatio: [],
    },
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

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

type Point2D = { x: number; y: number };

function getPoint(kp: Keypoint | null): Point2D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y };
}

/** Euclidean distance in 2D */
function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Reach ratio for a 3-joint chain. 1.0 = straight, lower = more bent. */
function computeReachRatio(proximal: Point2D, joint: Point2D, distal: Point2D): number {
  const chainLen = dist2D(proximal, joint) + dist2D(joint, distal);
  if (chainLen < 1e-6) return 1.0;
  return dist2D(proximal, distal) / chainLen;
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

function calculateSquatAngles(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): SquatAngles | null {
  const hip = getKeypoint(keypoints, `${side}_hip`);
  const knee = getKeypoint(keypoints, `${side}_knee`);
  const ankle = getKeypoint(keypoints, `${side}_ankle`);
  const shoulder = getKeypoint(keypoints, `${side}_shoulder`);

  const hasLeg =
    hip && knee && ankle &&
    isVisible(hip, VISIBILITY_THRESHOLD) &&
    isVisible(knee, VISIBILITY_THRESHOLD) &&
    isVisible(ankle, VISIBILITY_THRESHOLD);

  if (!hasLeg) return null;

  const hipPt = getPoint(hip)!;
  const kneePt = getPoint(knee)!;
  const anklePt = getPoint(ankle)!;

  // Knee reach ratio (hip-knee-ankle): ~0.97 = fully extended, ~0.60 = deep squat
  const kneeRatio = computeReachRatio(hipPt, kneePt, anklePt);

  // Hip angle (shoulder-hip-knee): indicates hip hinge depth
  let hipAngle = 180;
  if (shoulder && isVisible(shoulder, VISIBILITY_THRESHOLD)) {
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
  if (shoulder && isVisible(shoulder, VISIBILITY_THRESHOLD)) {
    // Store hip reach ratio (not used for FSM, just debug)
    hipAngle = computeReachRatio(getPoint(shoulder)!, hipPt, kneePt);
  }

  // Torso forward lean from vertical
  const torsoLean = calculateTorsoLean(keypoints, side);
  const torsoLeanSigned = calculateSignedTorsoLean(keypoints, side);
  const thighDepthAngle = calculateThighDepthAngle(keypoints, side);
  const footPitch = calculateFootPitch(keypoints, side);
  const sideViewWidthRatio = calculateSideViewWidthRatio(keypoints);

  return {
    knee: kneeRatio,
    kneeRatio,
    torsoLean: torsoLean ?? NaN,
    torsoLeanSigned: torsoLeanSigned ?? NaN,
    hipAngle,
    thighDepthAngle: thighDepthAngle ?? NaN,
    footPitch: footPitch ?? NaN,
    sideViewWidthRatio: sideViewWidthRatio ?? NaN,
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
    'torsoLean',
    'torsoLeanSigned',
    'hipAngle',
    'thighDepthAngle',
    'footPitch',
    'sideViewWidthRatio',
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

    // smoothed = median + EMA: stable for form evaluation
    const prev = prevSmoothed?.[key];
    smoothedResult[key] =
      prev !== undefined && !isNaN(prev)
        ? EMA_ALPHA * medianValue + (1 - EMA_ALPHA) * prev
        : medianValue;
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

type SquatSeverity = 'none' | 'warn' | 'fail';
type DepthSource = 'thighDepthAngle' | 'depthRatio';

interface SquatMetricSnapshot {
  thighDepthEligible: boolean;
  thighDepthAngle: number | null;
  thighDepthConfidence: number | undefined;
  depthRatio: number;
  depthSource: DepthSource;
  depthValue: number;
  depthSeverity: SquatSeverity;
  lockoutRatio: number;
  lockoutBaselineRatio: number | null;
  lockoutDeltaRatio: number | null;
  lockoutShort: boolean;
  romRatio: number;
  incompleteRom: boolean;
  partialRep: boolean;
  heelLiftEligible: boolean;
  heelLiftDeltaDeg: number | null;
  heelLiftSupport: number | null;
  heelLiftEligibleSupport: number | null;
  heelLiftOverThresholdSupport: number | null;
  heelLiftConfidence: number | undefined;
  heelLiftTriggered: boolean;
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
  tDown: number | null;
  tUp: number | null;
  tempoUpShort: boolean;
  tempoDownShort: boolean;
}

function confidenceAverage(sum: number, count: number): number | undefined {
  return count > 0 ? sum / count : undefined;
}

function finiteValue(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function analyzeSquatRep(repWindow: SquatRepWindow): SquatMetricSnapshot {
  const thighDepthEligible =
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
  const lockoutShort =
    lockoutDeltaRatio !== null
      ? lockoutDeltaRatio > FORM_THRESHOLDS.LOCKOUT_BASELINE_DELTA_FAIL
      : lockoutRatio < FORM_THRESHOLDS.LOCKOUT_FAIL;
  const romRatio = Math.max(0, lockoutRatio - depthRatio);
  const incompleteRom = romRatio < FORM_THRESHOLDS.ROM_MIN;
  const partialRep = repWindow.partialRep;

  const depthSource: DepthSource = thighDepthEligible ? 'thighDepthAngle' : 'depthRatio';
  const depthValue = thighDepthEligible ? thighDepthAngle! : depthRatio;
  let depthSeverity: SquatSeverity = 'none';
  if (thighDepthEligible) {
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

  const torsoLeanEligible =
    repWindow.torsoLeanSampleCount > 0 &&
    Number.isFinite(repWindow.maxTorsoLean);
  const torsoLean = torsoLeanEligible ? repWindow.maxTorsoLean : null;
  const torsoHasBaseline = torsoLeanEligible && repWindow.torsoLeanBaseline !== null;
  const torsoLeanAbsoluteDelta = torsoHasBaseline ? repWindow.maxTorsoLeanDelta : null;
  const torsoSignedEligible =
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

  const tDown = repWindow.tBottom !== null ? repWindow.tBottom - repWindow.tStart : null;
  const tUp = repWindow.tBottom !== null ? repWindow.tEnd - repWindow.tBottom : null;
  const tempoUpShort =
    tUp !== null &&
    tUp > 0 &&
    tUp < FORM_THRESHOLDS.TEMPO_CONCENTRIC_MIN;
  const tempoDownShort =
    tDown !== null &&
    tDown > 0 &&
    tDown < FORM_THRESHOLDS.TEMPO_ECCENTRIC_MIN;

  return {
    thighDepthEligible,
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
    lockoutShort,
    romRatio,
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
    tDown,
    tUp,
    tempoUpShort,
    tempoDownShort,
  };
}

function computeSquatRepScore(analysis: SquatMetricSnapshot): number {
  let penalty = 0;

  if (analysis.thighDepthEligible && analysis.thighDepthAngle !== null) {
    const depthExcess = Math.max(0, analysis.thighDepthAngle - SCORE_CURVES.THIGH_DEPTH.deadzone);
    penalty += Math.min(
      SCORE_CURVES.THIGH_DEPTH.cap,
      SCORE_CURVES.THIGH_DEPTH.scale * depthExcess * depthExcess,
    );
  } else {
    const depthExcess = Math.max(0, analysis.depthRatio - SCORE_CURVES.DEPTH.deadzone);
    penalty += Math.min(SCORE_CURVES.DEPTH.cap, SCORE_CURVES.DEPTH.scale * depthExcess * depthExcess);
  }

  const lockoutShortfall = analysis.lockoutDeltaRatio !== null
    ? Math.max(0, analysis.lockoutDeltaRatio - FORM_THRESHOLDS.LOCKOUT_BASELINE_DELTA_FAIL * 0.5)
    : Math.max(0, SCORE_CURVES.LOCKOUT.ideal - analysis.lockoutRatio);
  penalty += Math.min(SCORE_CURVES.LOCKOUT.cap, SCORE_CURVES.LOCKOUT.scale * lockoutShortfall * lockoutShortfall);

  const torsoForScore = analysis.torsoLeanSigned ?? analysis.torsoLean;
  if (analysis.torsoSeverity !== 'none' && torsoForScore !== null) {
    const torsoExcess = Math.max(0, torsoForScore - SCORE_CURVES.TORSO.deadzone);
    penalty += Math.min(SCORE_CURVES.TORSO.cap, SCORE_CURVES.TORSO.scale * torsoExcess * torsoExcess);
  }

  if (analysis.heelLiftTriggered && analysis.heelLiftDeltaDeg !== null) {
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

  if (analysis.partialRep || analysis.incompleteRom) {
    score = Math.min(score, 65);
  }
  if (analysis.depthSeverity === 'fail') {
    score = Math.min(score, 70);
  } else if (analysis.depthSeverity === 'warn') {
    score = Math.min(score, 85);
  }
  if (analysis.torsoSeverity === 'fail') {
    score = Math.min(score, 75);
  }
  if (analysis.lockoutShort) {
    score = Math.min(score, 85);
  }
  if (analysis.heelLiftTriggered) {
    score = Math.min(score, 85);
  }

  return score;
}

function generateFormMessages(analysis: SquatMetricSnapshot): string[] {
  const messages: string[] = [];
  let hasDepthOrRomCue = false;

  if (analysis.depthSeverity === 'fail') {
    messages.push(SQUAT_FEEDBACK.DEPTH_FAIL);
    hasDepthOrRomCue = true;
  } else if (analysis.depthSeverity === 'warn') {
    messages.push(SQUAT_FEEDBACK.DEPTH_WARN);
    hasDepthOrRomCue = true;
  }

  if (analysis.lockoutShort) {
    messages.push(SQUAT_FEEDBACK.LOCKOUT);
  }

  if (analysis.incompleteRom) {
    messages.push(SQUAT_FEEDBACK.ROM);
    hasDepthOrRomCue = true;
  }

  if (analysis.partialRep && !hasDepthOrRomCue) {
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
): { score: number; messages: string[]; analysis: SquatMetricSnapshot } {
  const analysis = analyzeSquatRep(repWindow);
  const score = computeSquatRepScore(analysis);
  const messages = generateFormMessages(analysis);
  return { score, messages, analysis };
}

function buildSquatDiagnostics(
  repWindow: SquatRepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
  analysis: SquatMetricSnapshot = analyzeSquatRep(repWindow),
): FrameworkRepResult['diagnostics'] {
  const hasTempo = analysis.tDown !== null && analysis.tUp !== null;
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
    view: 'side',
    selectedSide: visibleSide,
    metrics: [
      diagnosticMetric('thighDepthAngle', analysis.thighDepthAngle, {
        unit: 'degrees',
        eligible: analysis.thighDepthEligible,
        confidence: analysis.thighDepthConfidence,
        sampleCount: repWindow.thighDepthSampleCount,
        skippedReason: 'hip_knee_depth_unavailable',
      }),
      diagnosticMetric('depthRatio', analysis.depthRatio, { unit: 'ratio' }),
      diagnosticMetric('lockoutRatio', analysis.lockoutRatio, { unit: 'ratio' }),
      diagnosticMetric('lockoutBaselineRatio', analysis.lockoutBaselineRatio, {
        unit: 'ratio',
        eligible: analysis.lockoutBaselineRatio !== null,
        skippedReason: 'lockout_baseline_unavailable',
      }),
      diagnosticMetric('lockoutDeltaRatio', analysis.lockoutDeltaRatio, {
        unit: 'ratio',
        eligible: analysis.lockoutDeltaRatio !== null,
        skippedReason: 'lockout_baseline_unavailable',
      }),
      diagnosticMetric('romRatio', analysis.romRatio, { unit: 'ratio' }),
      diagnosticMetric('heelLiftDeltaDeg', analysis.heelLiftDeltaDeg, {
        unit: 'degrees',
        eligible: analysis.heelLiftEligible,
        confidence: analysis.heelLiftConfidence,
        sampleCount: repWindow.heelLiftSampleCount,
        skippedReason: 'foot_landmarks_unavailable',
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
        skippedReason: 'torso_landmarks_unavailable',
      }),
      diagnosticMetric('torsoLeanDelta', analysis.torsoLeanDelta, {
        unit: 'degrees',
        eligible: analysis.torsoHasBaseline,
        confidence: analysis.torsoLeanConfidence,
        sampleCount: repWindow.torsoLeanSampleCount,
        skippedReason: 'torso_baseline_unavailable',
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
      diagnosticMetric('partialRep', analysis.partialRep ? 1 : 0, { unit: 'count' }),
      diagnosticMetric('tDown', analysis.tDown, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
      diagnosticMetric('tUp', analysis.tUp, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'barbell-squat.depth_short',
        metricKeys: [analysis.depthSource],
        direction: 'above',
        value: analysis.depthValue,
        thresholdPath: depthThresholdPath,
        thresholdValue: depthThresholdValue,
        triggered: analysis.depthSeverity !== 'none',
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
        triggered: analysis.lockoutShort,
      }),
      diagnosticCue({
        issueId: 'barbell-squat.incomplete_rom',
        metricKeys: ['romRatio'],
        direction: 'below',
        value: analysis.romRatio,
        thresholdPath: 'formThresholds.ROM_MIN',
        thresholdValue: FORM_THRESHOLDS.ROM_MIN,
        triggered: analysis.incompleteRom || analysis.partialRep,
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
        skippedReason: 'foot_landmarks_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-squat.torso_fail',
        metricKeys: torsoCueMetricKeys,
        direction: 'above',
        value: torsoCueValue,
        thresholdPath: torsoFailThresholdPath,
        thresholdValue: torsoFailThresholdValue,
        eligible: (analysis.torsoLeanSigned ?? analysis.torsoLean) !== null,
        triggered: analysis.torsoSeverity === 'fail',
        skippedReason: 'torso_landmarks_unavailable',
      }),
      diagnosticCue({
        issueId: 'barbell-squat.torso_warn',
        metricKeys: torsoCueMetricKeys,
        direction: 'above',
        value: torsoCueValue,
        thresholdPath: torsoWarnThresholdPath,
        thresholdValue: torsoWarnThresholdValue,
        eligible: (analysis.torsoLeanSigned ?? analysis.torsoLean) !== null,
        triggered: analysis.torsoSeverity === 'warn',
        skippedReason: 'torso_landmarks_unavailable',
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

function captureStandingBaselines(
  state: SquatState,
  keypoints: Keypoint[],
  visibleSide: 'left' | 'right',
  fast: SmoothedSquatAngles,
  smoothed: SmoothedSquatAngles,
): void {
  state.standingKneeRatioPeak = Math.max(state.standingKneeRatioPeak, fast.kneeRatio);

  const torsoConf = minKeypointConfidence(keypoints, [`${visibleSide}_shoulder`, `${visibleSide}_hip`]);
  if (torsoConf >= 0.3 && Number.isFinite(smoothed.torsoLean)) {
    state.standingTorsoLeanBaseline = smoothed.torsoLean;
  }
  if (torsoConf >= 0.3 && Number.isFinite(smoothed.torsoLeanSigned)) {
    state.standingTorsoLeanSignedBaseline = smoothed.torsoLeanSigned;
  }

  const footConf = minKeypointConfidence(keypoints, [
    `${visibleSide}_heel`,
    `${visibleSide}_foot_index`,
    `${visibleSide}_ankle`,
  ]);
  if (footConf >= 0.3 && Number.isFinite(smoothed.footPitch)) {
    state.standingFootPitchBaseline = smoothed.footPitch;
  }
}

function updateRepWindowMetrics(
  repWindow: SquatRepWindow,
  keypoints: Keypoint[],
  visibleSide: 'left' | 'right',
  fast: SmoothedSquatAngles,
  smoothed: SmoothedSquatAngles,
): void {
  if (!isNaN(fast.kneeRatio)) {
    repWindow.minKneeRatio = Math.min(repWindow.minKneeRatio, fast.kneeRatio);
    repWindow.maxKneeRatio = Math.max(repWindow.maxKneeRatio, fast.kneeRatio);
    repWindow.endKneeRatio = fast.kneeRatio;
  }

  const thighDepthConf = minKeypointConfidence(keypoints, [`${visibleSide}_hip`, `${visibleSide}_knee`]);
  if (thighDepthConf >= 0.3 && Number.isFinite(fast.thighDepthAngle)) {
    repWindow.minThighDepthAngle = Math.min(repWindow.minThighDepthAngle, fast.thighDepthAngle);
    repWindow.thighDepthSampleCount++;
    repWindow.thighDepthConfidenceSum += thighDepthConf;
  }

  const torsoConf = minKeypointConfidence(keypoints, [`${visibleSide}_shoulder`, `${visibleSide}_hip`]);
  if (torsoConf >= 0.3 && Number.isFinite(fast.torsoLean)) {
    repWindow.maxTorsoLean = Math.max(repWindow.maxTorsoLean, fast.torsoLean);
    if (repWindow.torsoLeanBaseline !== null) {
      repWindow.maxTorsoLeanDelta = Math.max(
        repWindow.maxTorsoLeanDelta,
        Math.max(0, fast.torsoLean - repWindow.torsoLeanBaseline),
      );
    }
    repWindow.torsoLeanSampleCount++;
    repWindow.torsoLeanConfidenceSum += torsoConf;
  }
  if (torsoConf >= 0.3 && Number.isFinite(fast.torsoLeanSigned)) {
    repWindow.maxTorsoLeanSigned = Math.max(repWindow.maxTorsoLeanSigned, fast.torsoLeanSigned);
    if (repWindow.torsoLeanSignedBaseline !== null) {
      repWindow.maxTorsoLeanSignedDelta = Math.max(
        repWindow.maxTorsoLeanSignedDelta,
        Math.max(0, fast.torsoLeanSigned - repWindow.torsoLeanSignedBaseline),
      );
    }
  }

  const footConf = minKeypointConfidence(keypoints, [
    `${visibleSide}_heel`,
    `${visibleSide}_foot_index`,
    `${visibleSide}_ankle`,
  ]);
  if (
    footConf >= 0.3 &&
    repWindow.footPitchBaseline !== null &&
    Number.isFinite(fast.footPitch)
  ) {
    const heelLiftDelta = Math.max(0, fast.footPitch - repWindow.footPitchBaseline);
    repWindow.maxHeelLiftDeltaDeg = Math.max(repWindow.maxHeelLiftDeltaDeg, heelLiftDelta);
    if (heelLiftDelta > FORM_THRESHOLDS.HEEL_LIFT_WARN) {
      repWindow.heelLiftTriggeredSampleCount++;
    }
    repWindow.heelLiftSampleCount++;
    repWindow.heelLiftConfidenceSum += footConf;
  }

  const sideViewConf = minKeypointConfidence(keypoints, [
    'left_shoulder',
    'right_shoulder',
    'left_hip',
    'right_hip',
  ]);
  if (sideViewConf >= 0.3 && Number.isFinite(fast.sideViewWidthRatio)) {
    repWindow.maxSideViewWidthRatio = Math.max(repWindow.maxSideViewWidthRatio, fast.sideViewWidthRatio);
    repWindow.sideViewSampleCount++;
    repWindow.sideViewConfidenceSum += sideViewConf;
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

  const tDown = state.repWindow.tBottom
    ? state.repWindow.tBottom - state.repWindow.tStart
    : 0;
  const tUp = state.repWindow.tBottom
    ? state.repWindow.tEnd - state.repWindow.tBottom
    : 0;

  const { score, messages, analysis } = evaluateForm(state.repWindow);

  state.lastRepResult = {
    repIndex: state.repCount,
    romRatio,
    tDown,
    tUp,
    score,
    messages,
    diagnostics: buildSquatDiagnostics(state.repWindow, state.repCount, visibleSide, analysis),
  };

  state.feedback = messages.length > 0 ? messages.join('\n') : 'Great rep!';
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
  currentState: SquatState
): SquatState {
  const t = Date.now() / 1000;

  // Only update visible side in IDLE/STANDING — lock it during active rep phases
  // to prevent mid-rep side switching that corrupts angle measurements.
  const inActiveRep =
    currentState.repWindow !== null ||
    (currentState.fsm.phase !== 'IDLE' && currentState.fsm.phase !== 'STANDING');
  const visibleSide = inActiveRep ? currentState.visibleSide : selectVisibleSide(keypoints);

  const rawAngles = calculateSquatAngles(keypoints, visibleSide);
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
    captureStandingBaselines(newState, keypoints, visibleSide, fast, smoothed);
  }

  // Update FSM — uses fast (median-only) ratio to avoid smoothing-induced misses
  const fsmResult = updateFSM(currentState.fsm, fast.kneeRatio, t, fast.torsoLean);
  newState.fsm = fsmResult.fsm;

  // Handle partial rep — count meaningful returned partials, but ignore tiny pulses.
  if (fsmResult.partialRep) {
    if (newState.repWindow) {
      newState.repWindow.tEnd = t;
      newState.repWindow.frameCount++;
      updateRepWindowMetrics(newState.repWindow, keypoints, visibleSide, fast, smoothed);
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
      const tDown = newState.repWindow.tEnd - newState.repWindow.tStart;
      const { score, messages, analysis } = evaluateForm(newState.repWindow);
      newState.lastRepResult = {
        repIndex: newState.repCount,
        romRatio: finalPartialROM,
        tDown,
        tUp: 0,
        score,
        messages,
        diagnostics: buildSquatDiagnostics(newState.repWindow, newState.repCount, visibleSide, analysis),
      };
      newState.feedback = messages.length > 0 ? messages.join('\n') : 'Good rep.';
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
    updateRepWindowMetrics(newState.repWindow, keypoints, visibleSide, fast, smoothed);

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
    updateRepWindowMetrics(window, keypoints, visibleSide, fast, smoothed);

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
    newState.repWindow.frameCount++;
    updateRepWindowMetrics(newState.repWindow, keypoints, visibleSide, fast, smoothed);
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

  validateScoreCurves(config, issues);

  return issues;
}

export function createSquatDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_SQUAT_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
  name: 'Barbell Squat',
  requiredView: 'side',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    repQualityWindowActive: false,
    _internal: withSquatConfig(config, () => initializeSquatState()),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as SquatState;
    const newInternal = withSquatConfig(config, () => updateSquatState(keypoints, internal));

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
      debugInfo: getSquatDebugInfo(newInternal) as unknown as Record<string, unknown>,
      repQualityWindowActive: newInternal.repWindow !== null,
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
