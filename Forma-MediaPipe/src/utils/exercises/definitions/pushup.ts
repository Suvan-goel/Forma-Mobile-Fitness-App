/**
 * Push-Up Exercise Definition
 *
 * Wraps the existing pushupHeuristics logic into the ExerciseDefinition
 * interface. All heuristics, FSM, scoring, and form evaluation code is
 * copied here verbatim and made module-private. The only export is
 * `pushupDefinition`.
 */

import {
  Keypoint,
  calculateAngle,
  calculateAngle2D,
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
} from '../types';
import { createDefaultTunableSpec, mergeHeuristicConfig, runWithConfigBindings } from '../heuristicConfig';
import { LOW_ROM_FEEDBACK, isMeaningfulPartialRep } from '../shared/partialReps';
import {
  buildRepDiagnostics,
  diagnosticCue,
  diagnosticMetric,
} from '../shared/diagnostics';
import tunedConfig from './tuned/pushup.json';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/**
 * FSM thresholds — ratio-based for elbow (camera-invariant).
 * Elbow reach ratio: dist(shoulder,wrist) / (dist(shoulder,elbow) + dist(elbow,wrist))
 *   ~0.95-0.98 = arms fully extended (plank), ~0.60-0.70 = bottom of pushup
 *
 * Body alignment and IDLE gate remain angle-based (they measure pose orientation,
 * not limb flexion, so angles are the correct metric).
 */
const THRESHOLDS = {
  /** Reach ratio below which we transition PLANK -> DESCENDING */
  DESCENDING_ENTER: 0.985,
  /** Reach ratio above which we transition ASCENDING -> PLANK */
  PLANK_REENTER: 0.92,
  /** Reach ratio below which we reach BOTTOM.
   *  Camera-invariant — no foreshortening compensation needed. */
  BOTTOM_ENTER: 0.73,
  /** Reach ratio above which we leave BOTTOM (hysteresis) */
  BOTTOM_EXIT: 0.77,
  /** Minimum time (seconds) for a rep to count */
  MIN_REP_TIME: 0.4,
  /** Partial rep: ratio above which we reset from DESCENDING without hitting BOTTOM */
  PARTIAL_REP_RESET: 0.93,
  /** Minimum time (seconds) in DESCENDING before a partial-rep reset can trigger */
  MIN_DESCENDING_TIME: 0.25,
  /** Minimum body alignment angle for plank detection in IDLE gate (degrees — pose metric) */
  PLANK_BODY_MIN: 165,
  /** Maximum body alignment angle for plank detection in IDLE gate */
  PLANK_BODY_MAX: 195,
  /** Seconds the user must hold plank before FSM activates from IDLE */
  PLANK_HOLD_TIME: 1.0,
  /** Minimum torso inclination from vertical for plank detection (degrees) */
  TORSO_INCLINE_MIN: 65,
  /** Maximum torso inclination from vertical for plank detection (degrees) */
  TORSO_INCLINE_MAX: 115,
  /** Reach ratio above which arms are considered extended (for IDLE gate) */
  IDLE_ARMS_EXTENDED: 0.92,
  /** Minimum ratio ROM for a returned partial rep to count */
  MIN_PARTIAL_ROM: 0.11,
  /** Minimum analyzed frames for a completed full rep to be trusted */
  MIN_REP_FRAMES: 8,
  /** Extreme normalized shoulder/wrist offset blocks initial setup. */
  SHOULDER_WRIST_SETUP_FAIL: 0.22,
  /** Minimum selected-side confidence edge over the hidden side for side-view setup. */
  SIDE_VIEW_MIN_SCORE_EDGE: 0.08,
  /** Max visible torso width as a fraction of body length before likely diagonal/front view. */
  SIDE_VIEW_MAX_WIDTH_RATIO: 0.2,
} as const;

/** Form heuristic thresholds — ratio-based for elbow, angle-based for hip/body */
const FORM_THRESHOLDS = {
  // Depth: min ratio above this = insufficient depth
  DEPTH_FAIL: 0.73,
  // Lockout: max ratio below this = incomplete lockout
  LOCKOUT_FAIL: 0.93,
  // ROM: minimum ratio change during rep
  ROM_MIN: 0.22,
  // Hip alignment (shoulder-hip-ankle angle — already camera-invariant as a body pose metric)
  HIP_SAG_FAIL: 155,
  HIP_SAG_WARN: 165,
  HIP_PIKE_FAIL: 195,
  HIP_PIKE_WARN: 185,
  // Hip deviation (as fraction of shoulder-ankle distance — already ratio-based)
  HIP_DEV_SAG_FAIL: 0.1,
  HIP_DEV_SAG_WARN: 0.05,
  HIP_DEV_PIKE_FAIL: 0.1,
  HIP_DEV_PIKE_WARN: 0.05,
  // Head-spine angle (hip -> shoulder -> nose). This catches obvious head
  // dropping/craning without trying to infer subtle neck position.
  HEAD_SPINE_WARN: 150,
  // Tempo
  TEMPO_CONCENTRIC_MIN: 0.15,
  TEMPO_ECCENTRIC_MIN: 0.2,
  // Setup/form sanity
  SHOULDER_WRIST_WARN: 0.12,
  // Secondary depth proxy: only used when elbow ratio is borderline.
  DEPTH_BORDERLINE: 0.68,
  SHOULDER_DROP_MIN: -0.42,
} as const;

/**
 * Continuous penalty curve parameters — ratio-based for depth/lockout.
 *
 * | Category          | Cap | Deadzone     | Scale | Key Input                     |
 * |-------------------|-----|--------------|-------|-------------------------------|
 * | Depth shortfall   | 30  | 0.62 (ratio) | 300   | min ratio - no penalty below  |
 * | Lockout shortfall | 25  | 0.97 (ideal) | 300   | ideal - max ratio             |
 * | Hip alignment     | 35  | +/-8 from 180| 0.04  | worst body-angle deviation    |
 * | Tempo             | 20  | up: 0.3s     | 60/40 | concentric / eccentric time   |
 */
const SCORE_CURVES = {
  DEPTH: { deadzone: 0.62, scale: 300, cap: 30 },
  LOCKOUT: { ideal: 0.97, scale: 300, cap: 25 },
  HIP: { deadzone: 8, scale: 0.04, cap: 35, neutral: 180 },
  HIP_DEV: { deadzone: 0.04, scale: 1200, cap: 35 },
  HEAD: { min: 165, scale: 0.04, cap: 10 },
  TEMPO_CONCENTRIC: { deadzone: 0.3, scale: 60, cap: 10 },
  TEMPO_ECCENTRIC: { deadzone: 0.4, scale: 40, cap: 10 },
} as const;

/** Smoothing parameters */
const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.3;
const VISIBILITY_THRESHOLD = 0.2;
const FORM_CONFIDENCE_MIN = 0.3;
const SETUP_FEEDBACK = 'Set the camera side-on with your full body in frame.';
const SHOULDER_STACK_FEEDBACK = 'Stack your shoulders over your hands.';

const DEFAULT_PUSHUP_HEURISTIC_CONFIG = {
  thresholds: THRESHOLDS,
  formThresholds: FORM_THRESHOLDS,
  scoreCurves: SCORE_CURVES,
} satisfies ExerciseHeuristicConfig;

const ACTIVE_PUSHUP_HEURISTIC_CONFIG = mergeHeuristicConfig(DEFAULT_PUSHUP_HEURISTIC_CONFIG, tunedConfig);

const PUSHUP_TUNABLE_SPEC = createDefaultTunableSpec('Push-Up', DEFAULT_PUSHUP_HEURISTIC_CONFIG);
PUSHUP_TUNABLE_SPEC.diagnosticTuning = [
  { issueId: 'push-up.depth_short', metricKey: 'depthRatio', thresholdPath: 'formThresholds.DEPTH_FAIL', direction: 'above' },
  { issueId: 'push-up.lockout_short', metricKey: 'lockoutRatio', thresholdPath: 'formThresholds.LOCKOUT_FAIL', direction: 'below' },
  { issueId: 'push-up.incomplete_rom', metricKey: 'romRatio', thresholdPath: 'formThresholds.ROM_MIN', direction: 'below' },
  { issueId: 'push-up.hip_sag', metricKey: 'hipSagDeviation', thresholdPath: 'formThresholds.HIP_DEV_SAG_WARN', direction: 'above' },
  { issueId: 'push-up.hip_pike', metricKey: 'hipPikeDeviation', thresholdPath: 'formThresholds.HIP_DEV_PIKE_WARN', direction: 'above' },
  { issueId: 'push-up.head_position', metricKey: 'headSpineAngle', thresholdPath: 'formThresholds.HEAD_SPINE_WARN', direction: 'below' },
  { issueId: 'push-up.shoulder_stack', metricKey: 'shoulderWristOffset', thresholdPath: 'formThresholds.SHOULDER_WRIST_WARN', direction: 'above' },
  { issueId: 'push-up.tempo_up', metricKey: 'tUp', thresholdPath: 'formThresholds.TEMPO_CONCENTRIC_MIN', direction: 'below' },
  { issueId: 'push-up.tempo_down', metricKey: 'tDown', thresholdPath: 'formThresholds.TEMPO_ECCENTRIC_MIN', direction: 'below' },
];

const PUSHUP_CONFIG_BINDINGS = [
  { path: 'thresholds', target: THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'formThresholds', target: FORM_THRESHOLDS as unknown as Record<string, unknown> },
  { path: 'scoreCurves', target: SCORE_CURVES as unknown as Record<string, unknown> },
];

function withPushupConfig<T>(config: ExerciseHeuristicConfig, fn: () => T): T {
  return runWithConfigBindings(config, PUSHUP_CONFIG_BINDINGS, fn);
}

// ============================================================================
// TYPES (module-private)
// ============================================================================

type PushupPhase = 'IDLE' | 'PLANK' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';

type PushupSetupWarning =
  | 'not_side_view'
  | 'body_not_horizontal'
  | 'full_body_not_visible'
  | 'arm_chain_hidden'
  | 'lower_body_hidden'
  | 'camera_too_close'
  | 'shoulder_wrist_misaligned';

interface PushupSetupQuality {
  acceptable: boolean;
  confidence: number;
  warnings: PushupSetupWarning[];
}

interface PushupFSM {
  phase: PushupPhase;
  /** Timestamp when rep started (PLANK -> DESCENDING) */
  tRepStart: number | null;
  /** Timestamp when BOTTOM was reached */
  tBottom: number | null;
  /** Timestamp when rep completed (ASCENDING -> PLANK) */
  tRepEnd: number | null;
  /** Timestamp when user first showed valid plank pose in IDLE (null = not stable) */
  tIdleStableSince: number | null;
}

interface PushupRepWindow {
  /** Min/max elbow reach ratio during rep (primary — camera-invariant) */
  minElbowRatio: number;
  maxElbowRatio: number;
  /** Min/max body alignment angle (shoulder-hip-ankle) */
  minBodyAngle: number;
  maxBodyAngle: number;
  /** Min/max hip deviation (positive = sag, negative = pike) */
  minHipDev: number;
  maxHipDev: number;
  /** Min/max head-spine angle */
  minHeadSpine: number;
  maxHeadSpine: number;
  /** Shoulder/wrist stack offset: larger = less stacked */
  maxShoulderWristOffset: number;
  /** Max shoulder drop toward hand line; larger/less negative = lower/deeper */
  maxShoulderDropRatio: number;
  /** Visibility/scorability counters for active-rep form landmarks */
  bodyJudgeableFrames: number;
  headJudgeableFrames: number;
  setupWarningFrames: number;
  /** Timestamps */
  tStart: number;
  tBottom: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
}

interface PushupAngles {
  elbow: number;
  elbowRatio: number; // reach ratio: camera-invariant
  bodyAlignment: number;
  hipDeviation: number; // normalized: positive = sag, negative = pike
  headSpine: number;
  shoulderWristOffset: number;
  shoulderDropRatio: number;
}

interface PushupFrameSignals extends PushupAngles {
  side: 'left' | 'right';
  torsoInclinationImage: number | null;
  setupQuality: PushupSetupQuality;
  bodyJudgeable: boolean;
  headJudgeable: boolean;
}

interface SmoothedPushupAngles extends PushupAngles {
  side: 'left' | 'right';
  torsoInclinationImage: number | null;
  setupQuality: PushupSetupQuality;
  bodyJudgeable: boolean;
  headJudgeable: boolean;
}

interface RepResult {
  repIndex: number;
  romRatio: number; // ratio ROM (max - min reach ratio)
  tDown: number; // eccentric (descent)
  tUp: number; // concentric (ascent)
  score: number;
  messages: string[];
  scorable: boolean;
  diagnostics?: FrameworkRepResult['diagnostics'];
}

interface PushupState {
  fsm: PushupFSM;
  repCount: number;
  repWindow: PushupRepWindow | null;
  lastRepResult: RepResult | null;
  angleHistory: Record<keyof PushupAngles, number[]>;
  smoothed: SmoothedPushupAngles | null;
  /** Median-only values (no EMA) — used for FSM to avoid smoothing lag at extremes. */
  fast: SmoothedPushupAngles | null;
  displayAngles: PushupAngles | null;
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
  /** Side locked for the current active rep; prevents side switching mid-rep. */
  activeSide: 'left' | 'right' | null;
  /** Best extended elbow ratio observed while waiting in plank. Seeds top lockout ROM. */
  plankMaxElbowRatio: number;
  /** Last computed torso inclination from vertical (for debug display) */
  lastTorsoInclination: number | null;
  lastSetupQuality: PushupSetupQuality | null;
}

/** Debug info for on-screen pushup diagnostics */
interface PushupDebugInfo {
  phase: PushupPhase;
  side: 'left' | 'right';
  elbow: number | null;
  elbowRatio: number | null;
  bodyAlignment: number | null;
  hipDev: number | null;
  headSpine: number | null;
  torsoInclination: number | null;
  shoulderWristOffset: number | null;
  shoulderDropRatio: number | null;
  setupWarnings: PushupSetupWarning[];
  setupAcceptable: boolean | null;
  elbowRatioMin: number | null;
  elbowRatioMax: number | null;
  bodyAngleMin: number | null;
  bodyAngleMax: number | null;
  hipDevMin: number | null;
  hipDevMax: number | null;
}

interface FSMUpdateResult {
  fsm: PushupFSM;
  repCompleted: boolean;
  partialRep: boolean;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initFSM(): PushupFSM {
  return {
    phase: 'IDLE',
    tRepStart: null,
    tBottom: null,
    tRepEnd: null,
    tIdleStableSince: null,
  };
}

/** Reset FSM to PLANK after a completed rep (skips IDLE gate). */
function resetFSMToPlank(): PushupFSM {
  return {
    phase: 'PLANK',
    tRepStart: null,
    tBottom: null,
    tRepEnd: null,
    tIdleStableSince: null,
  };
}

function initRepWindow(tStart: number): PushupRepWindow {
  return {
    minElbowRatio: Infinity,
    maxElbowRatio: -Infinity,
    minBodyAngle: Infinity,
    maxBodyAngle: -Infinity,
    minHipDev: Infinity,
    maxHipDev: -Infinity,
    minHeadSpine: Infinity,
    maxHeadSpine: -Infinity,
    maxShoulderWristOffset: -Infinity,
    maxShoulderDropRatio: -Infinity,
    bodyJudgeableFrames: 0,
    headJudgeableFrames: 0,
    setupWarningFrames: 0,
    tStart,
    tBottom: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

function initializePushupState(): PushupState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    angleHistory: {
      elbow: [],
      elbowRatio: [],
      bodyAlignment: [],
      hipDeviation: [],
      headSpine: [],
      shoulderWristOffset: [],
      shoulderDropRatio: [],
    },
    smoothed: null,
    fast: null,
    displayAngles: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
    activeSide: null,
    plankMaxElbowRatio: -Infinity,
    lastTorsoInclination: null,
    lastSetupQuality: null,
  };
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

type Point3D = { x: number; y: number; z?: number };

function getPoint(kp: Keypoint | null): Point3D | null {
  if (!kp) return null;
  return { x: kp.x, y: kp.y, z: kp.z };
}

/** Euclidean distance in 2D */
function dist2D(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Reach ratio for a 3-joint chain. 1.0 = straight, lower = more bent. */
function computeReachRatio(proximal: Point3D, joint: Point3D, distal: Point3D): number {
  const chainLen = dist2D(proximal, joint) + dist2D(joint, distal);
  if (chainLen < 1e-6) return 1.0;
  return dist2D(proximal, distal) / chainLen;
}

/**
 * Perpendicular distance from point P to line AB, normalized by AB length.
 * Positive = hip is visually below the shoulder-ankle line (sag), negative = above (pike).
 * Uses screen Y direction for sign so facing left/right does not invert feedback.
 */
function calculateHipDeviation(shoulder: Point3D, hip: Point3D, ankle: Point3D): number {
  const abx = ankle.x - shoulder.x;
  const aby = ankle.y - shoulder.y;
  const abLenSq = abx * abx + aby * aby;
  const abLen = Math.sqrt(abLenSq);
  if (abLen < 1e-8) return 0;

  const apx = hip.x - shoulder.x;
  const apy = hip.y - shoulder.y;

  const projectionT = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const lineYAtHip = shoulder.y + projectionT * aby;

  return (hip.y - lineYAtHip) / abLen;
}

/**
 * Calculate the inclination of the torso vector relative to the vertical Y-axis.
 * Uses midpoints of both shoulders and both hips when available, falls back to
 * the visible side's shoulder and hip.
 *
 * Returns degrees: 0 = standing vertical (torso aligned with Y-axis),
 *                  90 = horizontal (plank position).
 * Returns null if required landmarks aren't visible.
 */
function calculateTorsoInclination(keypoints: Keypoint[], visibleSide: 'left' | 'right'): number | null {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  let shoulderX: number, shoulderY: number;
  let hipX: number, hipY: number;

  // Prefer midpoints of both sides for accuracy
  const lsVis = isVisible(ls, VISIBILITY_THRESHOLD);
  const rsVis = isVisible(rs, VISIBILITY_THRESHOLD);
  const lhVis = isVisible(lh, VISIBILITY_THRESHOLD);
  const rhVis = isVisible(rh, VISIBILITY_THRESHOLD);

  if (lsVis && rsVis) {
    shoulderX = (ls!.x + rs!.x) / 2;
    shoulderY = (ls!.y + rs!.y) / 2;
  } else if (lsVis) {
    shoulderX = ls!.x;
    shoulderY = ls!.y;
  } else if (rsVis) {
    shoulderX = rs!.x;
    shoulderY = rs!.y;
  } else {
    // Fall back to visible side
    const s = getKeypoint(keypoints, `${visibleSide}_shoulder`);
    if (!s || !isVisible(s, VISIBILITY_THRESHOLD)) return null;
    shoulderX = s.x;
    shoulderY = s.y;
  }

  if (lhVis && rhVis) {
    hipX = (lh!.x + rh!.x) / 2;
    hipY = (lh!.y + rh!.y) / 2;
  } else if (lhVis) {
    hipX = lh!.x;
    hipY = lh!.y;
  } else if (rhVis) {
    hipX = rh!.x;
    hipY = rh!.y;
  } else {
    const h = getKeypoint(keypoints, `${visibleSide}_hip`);
    if (!h || !isVisible(h, VISIBILITY_THRESHOLD)) return null;
    hipX = h.x;
    hipY = h.y;
  }

  // Torso vector: shoulder -> hip (in screen coords, Y points down)
  const dx = hipX - shoulderX;
  const dy = hipY - shoulderY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-8) return null;

  // Angle relative to vertical Y-axis (0,1) in screen coords:
  // cos(theta) = dot((dx,dy), (0,1)) / len = dy / len
  const cosTheta = dy / len;
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180 / Math.PI);

  return angleDeg;
}

// ============================================================================
// VISIBLE SIDE SELECTION
// ============================================================================

/**
 * Determine which side of the body has better landmark visibility.
 * From a side view, one side is closer to the camera.
 */
function selectVisibleSide(keypoints: Keypoint[]): 'left' | 'right' {
  const leftParts = ['left_shoulder', 'left_elbow', 'left_wrist', 'left_hip', 'left_ankle'];
  const rightParts = ['right_shoulder', 'right_elbow', 'right_wrist', 'right_hip', 'right_ankle'];

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

function sideChainScore(keypoints: Keypoint[], side: 'left' | 'right'): number {
  const names = [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`, `${side}_hip`, `${side}_ankle`];
  let sum = 0;
  for (const name of names) {
    sum += getKeypoint(keypoints, name)?.score ?? 0;
  }
  return sum / names.length;
}

function looksLikeNormalizedImageCoordinatesForPushup(keypoints: Keypoint[], side: 'left' | 'right'): boolean {
  const names = [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`, `${side}_hip`, `${side}_ankle`];
  const points = names
    .map((name) => getKeypoint(keypoints, name))
    .filter((point): point is Keypoint => !!point && point.score >= VISIBILITY_THRESHOLD);
  if (points.length < 4) return false;
  return points.every((point) => point.x >= -0.05 && point.x <= 1.05 && point.y >= -0.05 && point.y <= 1.05);
}

function addFrameBoundsWarnings(
  warnings: Set<PushupSetupWarning>,
  keypoints: Keypoint[],
  side: 'left' | 'right',
): void {
  if (!looksLikeNormalizedImageCoordinatesForPushup(keypoints, side)) return;
  const names = ['nose', `${side}_shoulder`, `${side}_elbow`, `${side}_wrist`, `${side}_hip`, `${side}_ankle`];
  const visible = names
    .map((name) => getKeypoint(keypoints, name))
    .filter((point): point is Keypoint => !!point && point.score >= VISIBILITY_THRESHOLD);
  if (visible.length < 4) return;

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of visible) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  if (minX < 0.03 || maxX > 0.97 || minY < 0.03 || maxY > 0.97) {
    warnings.add('full_body_not_visible');
  }
  if (maxX - minX > 0.86 || maxY - minY > 0.92) {
    warnings.add('camera_too_close');
  }
}

function addSideViewWarnings(warnings: Set<PushupSetupWarning>, keypoints: Keypoint[], side: 'left' | 'right'): void {
  const opposite = side === 'left' ? 'right' : 'left';
  const selectedScore = sideChainScore(keypoints, side);
  const oppositeScore = sideChainScore(keypoints, opposite);

  const selectedShoulder = getPoint(getKeypoint(keypoints, `${side}_shoulder`));
  const selectedAnkle = getPoint(getKeypoint(keypoints, `${side}_ankle`));
  const leftShoulder = getPoint(getKeypoint(keypoints, 'left_shoulder'));
  const rightShoulder = getPoint(getKeypoint(keypoints, 'right_shoulder'));
  const leftHip = getPoint(getKeypoint(keypoints, 'left_hip'));
  const rightHip = getPoint(getKeypoint(keypoints, 'right_hip'));

  if (!selectedShoulder || !selectedAnkle) return;
  const bodyLen = dist2D(selectedShoulder, selectedAnkle);
  if (bodyLen < 1e-6) return;

  const widths: number[] = [];
  if (leftShoulder && rightShoulder) widths.push(dist2D(leftShoulder, rightShoulder));
  if (leftHip && rightHip) widths.push(dist2D(leftHip, rightHip));
  if (widths.length === 0) return;

  const widthRatio = widths.reduce((sum, width) => sum + width, 0) / widths.length / bodyLen;
  const bothSidesClear = selectedScore >= 0.55 && oppositeScore >= 0.55;
  const ambiguousSide = bothSidesClear && Math.abs(selectedScore - oppositeScore) < THRESHOLDS.SIDE_VIEW_MIN_SCORE_EDGE;

  if (
    widthRatio > THRESHOLDS.SIDE_VIEW_MAX_WIDTH_RATIO ||
    (ambiguousSide && widthRatio > THRESHOLDS.SIDE_VIEW_MAX_WIDTH_RATIO * 0.5)
  ) {
    warnings.add('not_side_view');
  }
}

function calculateShoulderWristOffset(imageKeypoints: Keypoint[], side: 'left' | 'right'): number {
  const shoulder = getPoint(getKeypoint(imageKeypoints, `${side}_shoulder`));
  const wrist = getPoint(getKeypoint(imageKeypoints, `${side}_wrist`));
  const ankle = getPoint(getKeypoint(imageKeypoints, `${side}_ankle`));
  if (!shoulder || !wrist || !ankle) return NaN;
  const bodyLen = dist2D(shoulder, ankle);
  if (bodyLen < 1e-6) return NaN;
  return Math.abs(shoulder.x - wrist.x) / bodyLen;
}

function calculateShoulderDropRatio(imageKeypoints: Keypoint[], side: 'left' | 'right'): number {
  const shoulder = getPoint(getKeypoint(imageKeypoints, `${side}_shoulder`));
  const wrist = getPoint(getKeypoint(imageKeypoints, `${side}_wrist`));
  const ankle = getPoint(getKeypoint(imageKeypoints, `${side}_ankle`));
  if (!shoulder || !wrist || !ankle) return NaN;
  const bodyLen = dist2D(shoulder, ankle);
  if (bodyLen < 1e-6) return NaN;
  return (shoulder.y - wrist.y) / bodyLen;
}

function evaluateSetupQuality(
  imageKeypoints: Keypoint[],
  side: 'left' | 'right',
  elbowRatio: number,
  bodyAlignment: number,
  torsoInclination: number | null,
  shoulderWristOffset: number,
): PushupSetupQuality {
  const warnings = new Set<PushupSetupWarning>();
  const armConf = minKeypointConfidence(imageKeypoints, [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`]);
  const lowerConf = minKeypointConfidence(imageKeypoints, [`${side}_hip`, `${side}_ankle`]);

  if (armConf < VISIBILITY_THRESHOLD) warnings.add('arm_chain_hidden');
  if (lowerConf < VISIBILITY_THRESHOLD) warnings.add('lower_body_hidden');

  const torsoHorizontal =
    torsoInclination !== null &&
    torsoInclination >= THRESHOLDS.TORSO_INCLINE_MIN &&
    torsoInclination <= THRESHOLDS.TORSO_INCLINE_MAX;
  if (!torsoHorizontal) warnings.add('body_not_horizontal');

  addFrameBoundsWarnings(warnings, imageKeypoints, side);
  addSideViewWarnings(warnings, imageKeypoints, side);

  const shoulderStackExtreme =
    Number.isFinite(shoulderWristOffset) && shoulderWristOffset > THRESHOLDS.SHOULDER_WRIST_SETUP_FAIL;
  if (
    shoulderStackExtreme ||
    (Number.isFinite(shoulderWristOffset) && shoulderWristOffset > FORM_THRESHOLDS.SHOULDER_WRIST_WARN)
  ) {
    warnings.add('shoulder_wrist_misaligned');
  }

  const armsExtended = elbowRatio > THRESHOLDS.IDLE_ARMS_EXTENDED;
  const bodyAligned =
    Number.isFinite(bodyAlignment) &&
    bodyAlignment >= THRESHOLDS.PLANK_BODY_MIN &&
    bodyAlignment <= THRESHOLDS.PLANK_BODY_MAX;
  const blockingWarnings: PushupSetupWarning[] = [
    'not_side_view',
    'body_not_horizontal',
    'full_body_not_visible',
    'arm_chain_hidden',
    'lower_body_hidden',
    'camera_too_close',
  ];
  const hasBlockingWarning = blockingWarnings.some((warning) => warnings.has(warning));
  const acceptable = armsExtended && bodyAligned && !hasBlockingWarning && !shoulderStackExtreme;
  const confidence = Math.max(0, Math.min(1, 1 - warnings.size * 0.16));

  return {
    acceptable,
    confidence,
    warnings: Array.from(warnings),
  };
}

function calculatePushupFrameSignals(
  metricKeypoints: Keypoint[],
  imageKeypoints: Keypoint[],
  side: 'left' | 'right',
): PushupFrameSignals | null {
  const prefix = side;
  const shoulder = getKeypoint(metricKeypoints, `${prefix}_shoulder`);
  const elbow = getKeypoint(metricKeypoints, `${prefix}_elbow`);
  const wrist = getKeypoint(metricKeypoints, `${prefix}_wrist`);
  const hip = getKeypoint(metricKeypoints, `${prefix}_hip`);
  const ankle = getKeypoint(metricKeypoints, `${prefix}_ankle`);
  const imageShoulder = getKeypoint(imageKeypoints, `${prefix}_shoulder`);
  const imageHip = getKeypoint(imageKeypoints, `${prefix}_hip`);
  const imageAnkle = getKeypoint(imageKeypoints, `${prefix}_ankle`);
  const imageNose = getKeypoint(imageKeypoints, 'nose');

  // Minimum required: shoulder, elbow, wrist for elbow angle
  const hasArm =
    shoulder &&
    elbow &&
    wrist &&
    isVisible(shoulder, VISIBILITY_THRESHOLD) &&
    isVisible(elbow, VISIBILITY_THRESHOLD) &&
    isVisible(wrist, VISIBILITY_THRESHOLD);

  if (!hasArm) return null;

  // Elbow angle (2D -- kept for debug display)
  const elbowAngle = calculateAngle2D(getPoint(shoulder)!, getPoint(elbow)!, getPoint(wrist)!);

  // Elbow reach ratio (camera-invariant primary metric)
  const elbowRatioVal = computeReachRatio(getPoint(shoulder)!, getPoint(elbow)!, getPoint(wrist)!);

  // Body alignment (shoulder-hip-ankle)
  let bodyAlignmentAngle = NaN;
  let hipDeviation = NaN;
  const hasBody = hip && ankle && isVisible(hip, VISIBILITY_THRESHOLD) && isVisible(ankle, VISIBILITY_THRESHOLD);

  if (hasBody) {
    bodyAlignmentAngle = calculateAngle(getPoint(shoulder)!, getPoint(hip)!, getPoint(ankle)!);
    // Normalize hip deviation by shoulder-ankle distance
  }

  const hasImageBody =
    imageShoulder &&
    imageHip &&
    imageAnkle &&
    isVisible(imageShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(imageHip, VISIBILITY_THRESHOLD) &&
    isVisible(imageAnkle, VISIBILITY_THRESHOLD);

  if (hasImageBody) {
    hipDeviation = calculateHipDeviation(getPoint(imageShoulder)!, getPoint(imageHip)!, getPoint(imageAnkle)!);
  }

  // Head-spine angle (hip -> shoulder -> nose)
  let headSpineAngle = NaN;
  if (
    imageHip &&
    imageShoulder &&
    imageNose &&
    isVisible(imageHip, VISIBILITY_THRESHOLD) &&
    isVisible(imageShoulder, VISIBILITY_THRESHOLD) &&
    isVisible(imageNose, VISIBILITY_THRESHOLD)
  ) {
    headSpineAngle = calculateAngle2D(getPoint(imageHip)!, getPoint(imageShoulder)!, getPoint(imageNose)!);
  }

  const torsoInclination = calculateTorsoInclination(imageKeypoints, side);
  const shoulderWristOffset = calculateShoulderWristOffset(imageKeypoints, side);
  const shoulderDropRatio = calculateShoulderDropRatio(imageKeypoints, side);
  const bodyConf = minKeypointConfidence(metricKeypoints, [`${side}_shoulder`, `${side}_hip`, `${side}_ankle`]);
  const headConf = minKeypointConfidence(imageKeypoints, [`${side}_hip`, `${side}_shoulder`, 'nose']);
  const setupQuality = evaluateSetupQuality(
    imageKeypoints,
    side,
    elbowRatioVal,
    bodyAlignmentAngle,
    torsoInclination,
    shoulderWristOffset,
  );

  return {
    side,
    elbow: elbowAngle,
    elbowRatio: elbowRatioVal,
    bodyAlignment: bodyAlignmentAngle,
    hipDeviation,
    headSpine: headSpineAngle,
    shoulderWristOffset,
    shoulderDropRatio,
    torsoInclinationImage: torsoInclination,
    setupQuality,
    bodyJudgeable:
      Number.isFinite(bodyAlignmentAngle) && Number.isFinite(hipDeviation) && bodyConf >= FORM_CONFIDENCE_MIN,
    headJudgeable: Number.isFinite(headSpineAngle) && headConf >= FORM_CONFIDENCE_MIN,
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
  rawAngles: PushupFrameSignals,
  history: PushupState['angleHistory'],
  prevSmoothed: SmoothedPushupAngles | null,
): { smoothed: SmoothedPushupAngles; fast: SmoothedPushupAngles } {
  const keys: (keyof PushupAngles)[] = [
    'elbow',
    'elbowRatio',
    'bodyAlignment',
    'hipDeviation',
    'headSpine',
    'shoulderWristOffset',
    'shoulderDropRatio',
  ];
  const smoothedResult: Partial<SmoothedPushupAngles> = {};
  const fastResult: Partial<SmoothedPushupAngles> = {};

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
    // fast = median only: tracks extremes within ~1-2 frames for FSM decisions
    fastResult[key] = medianValue;

    const prev = prevSmoothed?.[key];
    smoothedResult[key] =
      prev !== undefined && !isNaN(prev) ? EMA_ALPHA * medianValue + (1 - EMA_ALPHA) * prev : medianValue;
  }

  return {
    smoothed: {
      ...(smoothedResult as PushupAngles),
      side: rawAngles.side,
      torsoInclinationImage: rawAngles.torsoInclinationImage,
      setupQuality: rawAngles.setupQuality,
      bodyJudgeable: rawAngles.bodyJudgeable,
      headJudgeable: rawAngles.headJudgeable,
    },
    fast: {
      ...(fastResult as PushupAngles),
      side: rawAngles.side,
      torsoInclinationImage: rawAngles.torsoInclinationImage,
      setupQuality: rawAngles.setupQuality,
      bodyJudgeable: rawAngles.bodyJudgeable,
      headJudgeable: rawAngles.headJudgeable,
    },
  };
}

// ============================================================================
// FSM LOGIC
// ============================================================================

/**
 * Update FSM using elbow reach ratio (camera-invariant).
 * Ratio: 1.0 = fully extended, ~0.6 = bottom of pushup.
 * IDLE gate still uses body alignment angle and torso inclination (pose metrics).
 */
function updateFSM(
  currentFSM: PushupFSM,
  elbowRatio: number,
  t: number,
  bodyAlignment: number,
  torsoInclination: number | null,
  setupQuality: PushupSetupQuality,
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;
  let partialRep = false;

  switch (fsm.phase) {
    case 'IDLE': {
      const armsExtended = elbowRatio > THRESHOLDS.IDLE_ARMS_EXTENDED;
      const bodyAligned =
        Number.isFinite(bodyAlignment) &&
        bodyAlignment >= THRESHOLDS.PLANK_BODY_MIN &&
        bodyAlignment <= THRESHOLDS.PLANK_BODY_MAX;

      const torsoHorizontal =
        torsoInclination !== null &&
        torsoInclination >= THRESHOLDS.TORSO_INCLINE_MIN &&
        torsoInclination <= THRESHOLDS.TORSO_INCLINE_MAX;
      const torsoDefinitelyNot = torsoInclination !== null && !torsoHorizontal;

      if (armsExtended && bodyAligned && torsoHorizontal && setupQuality.acceptable) {
        if (fsm.tIdleStableSince === null) {
          fsm.tIdleStableSince = t;
        } else if (t - fsm.tIdleStableSince >= THRESHOLDS.PLANK_HOLD_TIME) {
          fsm.phase = 'PLANK';
          fsm.tIdleStableSince = null;
        }
      } else if (!armsExtended || !bodyAligned || torsoDefinitelyNot || !setupQuality.acceptable) {
        fsm.tIdleStableSince = null;
      }
      break;
    }

    case 'PLANK':
      if (elbowRatio < THRESHOLDS.DESCENDING_ENTER) {
        fsm.phase = 'DESCENDING';
        fsm.tRepStart = t;
        fsm.tBottom = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'DESCENDING':
      if (elbowRatio < THRESHOLDS.BOTTOM_ENTER) {
        fsm.phase = 'BOTTOM';
        fsm.tBottom = t;
      } else if (
        elbowRatio > THRESHOLDS.PARTIAL_REP_RESET &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_DESCENDING_TIME
      ) {
        fsm.phase = 'PLANK';
        partialRep = true;
        fsm.tRepStart = null;
      }
      break;

    case 'BOTTOM':
      if (elbowRatio > THRESHOLDS.BOTTOM_EXIT) {
        fsm.phase = 'ASCENDING';
      }
      break;

    case 'ASCENDING':
      if (
        elbowRatio > THRESHOLDS.PLANK_REENTER &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_REP_TIME
      ) {
        fsm.phase = 'PLANK';
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

// ---- Continuous scoring (quadratic penalty curves) ----

/**
 * Compute a continuous pushup rep score.
 * Small errors produce small but real drops; a perfect 100 is rare and earned.
 *
 * Each category: min(cap, scale * max(0, x - deadzone)^2)
 */
function computePushupRepScore(repWindow: PushupRepWindow): number {
  let penalty = 0;

  // 1. Depth shortfall — lower minRatio is better (closer to 0.60)
  const depthExcess = Math.max(0, repWindow.minElbowRatio - SCORE_CURVES.DEPTH.deadzone);
  penalty += Math.min(SCORE_CURVES.DEPTH.cap, SCORE_CURVES.DEPTH.scale * depthExcess * depthExcess);

  // 2. Lockout shortfall — higher maxRatio is better (closer to 0.97+)
  const lockoutShortfall = Math.max(0, SCORE_CURVES.LOCKOUT.ideal - repWindow.maxElbowRatio);
  penalty += Math.min(SCORE_CURVES.LOCKOUT.cap, SCORE_CURVES.LOCKOUT.scale * lockoutShortfall * lockoutShortfall);

  // 3. Hip alignment -- body should be ~180 (straight line)
  //    Deadzone: +/-8 from 180 (172-188 is fine)
  //    Sag (minBodyAngle < 172) and pike (maxBodyAngle > 188) measured independently;
  //    worst direction drives the penalty.
  const hasBodyAngles = Number.isFinite(repWindow.minBodyAngle) && Number.isFinite(repWindow.maxBodyAngle);
  const hasHipDeviation = Number.isFinite(repWindow.minHipDev) && Number.isFinite(repWindow.maxHipDev);
  const sagDev = hasBodyAngles
    ? Math.max(0, SCORE_CURVES.HIP.neutral - SCORE_CURVES.HIP.deadzone - repWindow.minBodyAngle)
    : 0;
  const pikeDev = hasBodyAngles
    ? Math.max(0, repWindow.maxBodyAngle - (SCORE_CURVES.HIP.neutral + SCORE_CURVES.HIP.deadzone))
    : 0;
  const worstHipAngleDev = Math.max(sagDev, pikeDev);
  const signedHipDev = hasHipDeviation ? Math.max(Math.abs(repWindow.minHipDev), Math.abs(repWindow.maxHipDev)) : 0;
  const hipDevExcess = Math.max(0, signedHipDev - SCORE_CURVES.HIP_DEV.deadzone);
  const hipAnglePenalty = SCORE_CURVES.HIP.scale * worstHipAngleDev * worstHipAngleDev;
  const hipDevPenalty = SCORE_CURVES.HIP_DEV.scale * hipDevExcess * hipDevExcess;
  penalty += Math.min(SCORE_CURVES.HIP.cap, Math.max(hipAnglePenalty, hipDevPenalty));

  // 4. Head/neck alignment -- obvious head drop/crane out of plank line
  const headShortfall = Number.isFinite(repWindow.minHeadSpine)
    ? Math.max(0, SCORE_CURVES.HEAD.min - repWindow.minHeadSpine)
    : 0;
  penalty += Math.min(SCORE_CURVES.HEAD.cap, SCORE_CURVES.HEAD.scale * headShortfall * headShortfall);

  // 5. Tempo -- too fast in either direction
  if (repWindow.tBottom !== null) {
    const tEccentric = repWindow.tBottom - repWindow.tStart;
    const tConcentric = repWindow.tEnd - repWindow.tBottom;

    // Concentric (push up): penalize below 0.3s
    if (tConcentric > 0 && tConcentric < SCORE_CURVES.TEMPO_CONCENTRIC.deadzone) {
      const deficit = SCORE_CURVES.TEMPO_CONCENTRIC.deadzone - tConcentric;
      penalty += Math.min(SCORE_CURVES.TEMPO_CONCENTRIC.cap, SCORE_CURVES.TEMPO_CONCENTRIC.scale * deficit * deficit);
    }
    // Eccentric (descent): penalize below 0.4s
    if (tEccentric > 0 && tEccentric < SCORE_CURVES.TEMPO_ECCENTRIC.deadzone) {
      const deficit = SCORE_CURVES.TEMPO_ECCENTRIC.deadzone - tEccentric;
      penalty += Math.min(SCORE_CURVES.TEMPO_ECCENTRIC.cap, SCORE_CURVES.TEMPO_ECCENTRIC.scale * deficit * deficit);
    }
  }

  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

// ---- Discrete messages (visual feedback) ----

/**
 * Generate visual feedback messages using discrete thresholds.
 * These are independent of the continuous score -- a rep can score 92 and
 * still surface an actionable message.
 */
function generateFormMessages(repWindow: PushupRepWindow): string[] {
  const messages: string[] = [];

  // 1. Depth (ratio-based)
  const shoulderDropInsufficient =
    Number.isFinite(repWindow.maxShoulderDropRatio) &&
    repWindow.maxShoulderDropRatio < FORM_THRESHOLDS.SHOULDER_DROP_MIN;
  if (
    repWindow.minElbowRatio > FORM_THRESHOLDS.DEPTH_FAIL ||
    (repWindow.minElbowRatio > FORM_THRESHOLDS.DEPTH_BORDERLINE && shoulderDropInsufficient)
  ) {
    messages.push('Go deeper \u2014 aim for elbows at 90 degrees.');
  }

  // 2. Lockout (ratio-based)
  if (repWindow.maxElbowRatio < FORM_THRESHOLDS.LOCKOUT_FAIL) {
    messages.push('Lock out your arms fully at the top.');
  }

  // 3. ROM (ratio-based)
  const romRatio = repWindow.maxElbowRatio - repWindow.minElbowRatio;
  if (romRatio < FORM_THRESHOLDS.ROM_MIN && messages.length === 0) {
    messages.push('Incomplete rep \u2014 full range of motion from lockout to 90 degrees.');
  }

  // 4. Hip alignment -- dual metric cross-check
  const minBody = repWindow.minBodyAngle;
  const maxBody = repWindow.maxBodyAngle;
  const minDev = repWindow.minHipDev;
  const maxDev = repWindow.maxHipDev;

  const hasBodyAngles = Number.isFinite(minBody) && Number.isFinite(maxBody);
  const hasHipDeviation = Number.isFinite(minDev) && Number.isFinite(maxDev);

  if (hasHipDeviation && maxDev > FORM_THRESHOLDS.HIP_DEV_SAG_FAIL) {
    messages.push('Hips are sagging \u2014 engage your core to maintain a straight line.');
  } else if (
    hasBodyAngles &&
    hasHipDeviation &&
    minBody < FORM_THRESHOLDS.HIP_SAG_WARN &&
    maxDev > FORM_THRESHOLDS.HIP_DEV_SAG_WARN
  ) {
    messages.push('Keep your hips up \u2014 your body line is dropping.');
  }

  if (hasHipDeviation && minDev < -FORM_THRESHOLDS.HIP_DEV_PIKE_FAIL) {
    messages.push('Hips are piking up \u2014 lower them to maintain a straight plank.');
  } else if (
    hasBodyAngles &&
    hasHipDeviation &&
    maxBody > FORM_THRESHOLDS.HIP_PIKE_WARN &&
    minDev < -FORM_THRESHOLDS.HIP_DEV_PIKE_WARN
  ) {
    messages.push('Hips are riding high \u2014 aim for a straight body line.');
  }

  // 5. Head/neck alignment
  if (Number.isFinite(repWindow.minHeadSpine) && repWindow.minHeadSpine < FORM_THRESHOLDS.HEAD_SPINE_WARN) {
    messages.push('Keep your head neutral \u2014 align your neck with your spine.');
  }

  if (
    Number.isFinite(repWindow.maxShoulderWristOffset) &&
    repWindow.maxShoulderWristOffset > FORM_THRESHOLDS.SHOULDER_WRIST_WARN
  ) {
    messages.push(SHOULDER_STACK_FEEDBACK);
  }

  if (repWindow.frameCount > 0 && repWindow.setupWarningFrames / repWindow.frameCount > 0.4) {
    messages.push(SETUP_FEEDBACK);
  }

  // 6. Tempo
  if (repWindow.tBottom !== null) {
    const tEccentric = repWindow.tBottom - repWindow.tStart;
    const tConcentric = repWindow.tEnd - repWindow.tBottom;

    if (tConcentric > 0 && tConcentric < FORM_THRESHOLDS.TEMPO_CONCENTRIC_MIN) {
      messages.push('Slow down the push \u2014 control the movement.');
    }
    if (tEccentric > 0 && tEccentric < FORM_THRESHOLDS.TEMPO_ECCENTRIC_MIN) {
      messages.push("Control the descent \u2014 don't drop into the pushup.");
    }
  }

  return messages;
}

/**
 * Evaluate a completed pushup rep.
 * - `score`: continuous quadratic penalty curves (small errors -> small drops)
 * - `messages`: discrete threshold-based feedback (actionable coaching cues)
 * The two systems are independent per CLAUDE.md section 13.
 */
function evaluateForm(repWindow: PushupRepWindow): { score: number; messages: string[]; scorable: boolean } {
  const score = computePushupRepScore(repWindow);
  const messages = generateFormMessages(repWindow);
  const bodyCoverage = repWindow.frameCount === 0 ? 0 : repWindow.bodyJudgeableFrames / repWindow.frameCount;
  const headCoverage = repWindow.frameCount === 0 ? 0 : repWindow.headJudgeableFrames / repWindow.frameCount;
  const setupWarningRate = repWindow.frameCount === 0 ? 1 : repWindow.setupWarningFrames / repWindow.frameCount;
  const scorable = bodyCoverage >= 0.6 && headCoverage >= 0.6 && setupWarningRate <= 0.4;
  return { score, messages, scorable };
}

function buildPushupDiagnostics(
  repWindow: PushupRepWindow,
  repIndex: number,
  visibleSide: 'left' | 'right',
  scorable: boolean,
): FrameworkRepResult['diagnostics'] {
  const romRatio = repWindow.maxElbowRatio - repWindow.minElbowRatio;
  const tDown = repWindow.tBottom !== null ? repWindow.tBottom - repWindow.tStart : null;
  const tUp = repWindow.tBottom !== null ? repWindow.tEnd - repWindow.tBottom : null;
  const hasTempo = repWindow.tBottom !== null;
  const hasBodyAngles = Number.isFinite(repWindow.minBodyAngle) && Number.isFinite(repWindow.maxBodyAngle);
  const hasHipDeviation = Number.isFinite(repWindow.minHipDev) && Number.isFinite(repWindow.maxHipDev);
  const hasHead = Number.isFinite(repWindow.minHeadSpine);
  const hasShoulderStack = Number.isFinite(repWindow.maxShoulderWristOffset);
  const shoulderDropInsufficient =
    Number.isFinite(repWindow.maxShoulderDropRatio) &&
    repWindow.maxShoulderDropRatio < FORM_THRESHOLDS.SHOULDER_DROP_MIN;
  const setupWarningRate = repWindow.frameCount === 0 ? 1 : repWindow.setupWarningFrames / repWindow.frameCount;
  const hipSagDeviation = hasHipDeviation ? repWindow.maxHipDev : null;
  const hipPikeDeviation = hasHipDeviation ? -repWindow.minHipDev : null;

  return buildRepDiagnostics({
    exerciseName: 'Push-Up',
    repIndex,
    view: 'side',
    selectedSide: visibleSide,
    scorable,
    metrics: [
      diagnosticMetric('depthRatio', repWindow.minElbowRatio, { unit: 'ratio' }),
      diagnosticMetric('lockoutRatio', repWindow.maxElbowRatio, { unit: 'ratio' }),
      diagnosticMetric('romRatio', romRatio, { unit: 'ratio' }),
      diagnosticMetric('bodyMinAngle', repWindow.minBodyAngle, { unit: 'degrees', eligible: hasBodyAngles, skippedReason: 'body_chain_unavailable' }),
      diagnosticMetric('bodyMaxAngle', repWindow.maxBodyAngle, { unit: 'degrees', eligible: hasBodyAngles, skippedReason: 'body_chain_unavailable' }),
      diagnosticMetric('hipSagDeviation', hipSagDeviation, { unit: 'ratio', eligible: hasHipDeviation, skippedReason: 'hip_chain_unavailable' }),
      diagnosticMetric('hipPikeDeviation', hipPikeDeviation, { unit: 'ratio', eligible: hasHipDeviation, skippedReason: 'hip_chain_unavailable' }),
      diagnosticMetric('headSpineAngle', repWindow.minHeadSpine, { unit: 'degrees', eligible: hasHead, skippedReason: 'head_chain_unavailable' }),
      diagnosticMetric('shoulderWristOffset', repWindow.maxShoulderWristOffset, { unit: 'ratio', eligible: hasShoulderStack, skippedReason: 'shoulder_stack_unavailable' }),
      diagnosticMetric('setupWarningRate', setupWarningRate, { unit: 'ratio', sampleCount: repWindow.frameCount }),
      diagnosticMetric('tDown', tDown, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
      diagnosticMetric('tUp', tUp, { unit: 'seconds', eligible: hasTempo, skippedReason: 'bottom_not_detected' }),
    ],
    cues: [
      diagnosticCue({
        issueId: 'push-up.depth_short',
        metricKeys: ['depthRatio'],
        direction: 'above',
        value: repWindow.minElbowRatio,
        thresholdPath: 'formThresholds.DEPTH_FAIL',
        thresholdValue: FORM_THRESHOLDS.DEPTH_FAIL,
        triggered:
          repWindow.minElbowRatio > FORM_THRESHOLDS.DEPTH_FAIL ||
          (repWindow.minElbowRatio > FORM_THRESHOLDS.DEPTH_BORDERLINE && shoulderDropInsufficient),
      }),
      diagnosticCue({
        issueId: 'push-up.lockout_short',
        metricKeys: ['lockoutRatio'],
        direction: 'below',
        value: repWindow.maxElbowRatio,
        thresholdPath: 'formThresholds.LOCKOUT_FAIL',
        thresholdValue: FORM_THRESHOLDS.LOCKOUT_FAIL,
        triggered: repWindow.maxElbowRatio < FORM_THRESHOLDS.LOCKOUT_FAIL,
      }),
      diagnosticCue({
        issueId: 'push-up.incomplete_rom',
        metricKeys: ['romRatio'],
        direction: 'below',
        value: romRatio,
        thresholdPath: 'formThresholds.ROM_MIN',
        thresholdValue: FORM_THRESHOLDS.ROM_MIN,
        triggered: romRatio < FORM_THRESHOLDS.ROM_MIN,
      }),
      diagnosticCue({
        issueId: 'push-up.hip_sag',
        metricKeys: ['hipSagDeviation', 'bodyMinAngle'],
        direction: 'above',
        value: hipSagDeviation,
        thresholdPath: 'formThresholds.HIP_DEV_SAG_WARN',
        thresholdValue: FORM_THRESHOLDS.HIP_DEV_SAG_WARN,
        eligible: hasHipDeviation,
        triggered:
          hasHipDeviation &&
          (repWindow.maxHipDev > FORM_THRESHOLDS.HIP_DEV_SAG_FAIL ||
            (hasBodyAngles &&
              repWindow.minBodyAngle < FORM_THRESHOLDS.HIP_SAG_WARN &&
              repWindow.maxHipDev > FORM_THRESHOLDS.HIP_DEV_SAG_WARN)),
        skippedReason: 'hip_chain_unavailable',
      }),
      diagnosticCue({
        issueId: 'push-up.hip_pike',
        metricKeys: ['hipPikeDeviation', 'bodyMaxAngle'],
        direction: 'above',
        value: hipPikeDeviation,
        thresholdPath: 'formThresholds.HIP_DEV_PIKE_WARN',
        thresholdValue: FORM_THRESHOLDS.HIP_DEV_PIKE_WARN,
        eligible: hasHipDeviation,
        triggered:
          hasHipDeviation &&
          (-repWindow.minHipDev > FORM_THRESHOLDS.HIP_DEV_PIKE_FAIL ||
            (hasBodyAngles &&
              repWindow.maxBodyAngle > FORM_THRESHOLDS.HIP_PIKE_WARN &&
              -repWindow.minHipDev > FORM_THRESHOLDS.HIP_DEV_PIKE_WARN)),
        skippedReason: 'hip_chain_unavailable',
      }),
      diagnosticCue({
        issueId: 'push-up.head_position',
        metricKeys: ['headSpineAngle'],
        direction: 'below',
        value: repWindow.minHeadSpine,
        thresholdPath: 'formThresholds.HEAD_SPINE_WARN',
        thresholdValue: FORM_THRESHOLDS.HEAD_SPINE_WARN,
        eligible: hasHead,
        triggered: hasHead && repWindow.minHeadSpine < FORM_THRESHOLDS.HEAD_SPINE_WARN,
        skippedReason: 'head_chain_unavailable',
      }),
      diagnosticCue({
        issueId: 'push-up.shoulder_stack',
        metricKeys: ['shoulderWristOffset'],
        direction: 'above',
        value: repWindow.maxShoulderWristOffset,
        thresholdPath: 'formThresholds.SHOULDER_WRIST_WARN',
        thresholdValue: FORM_THRESHOLDS.SHOULDER_WRIST_WARN,
        eligible: hasShoulderStack,
        triggered: hasShoulderStack && repWindow.maxShoulderWristOffset > FORM_THRESHOLDS.SHOULDER_WRIST_WARN,
        skippedReason: 'shoulder_stack_unavailable',
      }),
      diagnosticCue({
        issueId: 'push-up.camera_setup',
        metricKeys: ['setupWarningRate'],
        direction: 'above',
        value: setupWarningRate,
        thresholdPath: 'setupWarningRate',
        thresholdValue: 0.4,
        triggered: setupWarningRate > 0.4,
      }),
      diagnosticCue({
        issueId: 'push-up.tempo_up',
        metricKeys: ['tUp'],
        direction: 'below',
        value: tUp,
        thresholdPath: 'formThresholds.TEMPO_CONCENTRIC_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_CONCENTRIC_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tUp !== null && tUp > 0 && tUp < FORM_THRESHOLDS.TEMPO_CONCENTRIC_MIN,
        skippedReason: 'bottom_not_detected',
      }),
      diagnosticCue({
        issueId: 'push-up.tempo_down',
        metricKeys: ['tDown'],
        direction: 'below',
        value: tDown,
        thresholdPath: 'formThresholds.TEMPO_ECCENTRIC_MIN',
        thresholdValue: FORM_THRESHOLDS.TEMPO_ECCENTRIC_MIN,
        eligible: hasTempo,
        triggered: hasTempo && tDown !== null && tDown > 0 && tDown < FORM_THRESHOLDS.TEMPO_ECCENTRIC_MIN,
        skippedReason: 'bottom_not_detected',
      }),
    ],
  });
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

function updatePushupState(
  keypoints: Keypoint[],
  currentState: PushupState,
  frameContext?: ExerciseFrameContext,
): PushupState {
  const t = Date.now() / 1000;
  const metricKeypoints = frameContext?.worldKeypoints ?? keypoints;
  const imageKeypoints = frameContext?.imageKeypoints ?? keypoints;

  const currentInRep = currentState.fsm.phase !== 'PLANK' && currentState.fsm.phase !== 'IDLE';
  const detectedSide = selectVisibleSide(imageKeypoints);
  const visibleSide = currentInRep && currentState.activeSide ? currentState.activeSide : detectedSide;

  // Calculate raw signals using the more visible side. Metric landmarks drive
  // range/angle math; image landmarks drive screen-space setup and signed form.
  const rawAngles = calculatePushupFrameSignals(metricKeypoints, imageKeypoints, visibleSide);
  if (!rawAngles) {
    return { ...currentState, displayAngles: null, visibleSide };
  }

  // Apply smoothing — returns fast (median-only) and smoothed (median+EMA)
  const { smoothed, fast } = applySmoothing(rawAngles, currentState.angleHistory, currentState.smoothed);

  const newState: PushupState = {
    ...currentState,
    smoothed,
    fast,
    displayAngles: smoothed,
    visibleSide,
    lastSetupQuality: fast.setupQuality,
  };

  // Use fast (median-only) ratio for FSM: avoids EMA lag that prevents reaching extremes
  if (isNaN(fast.elbowRatio)) {
    return newState;
  }

  // Compute torso inclination for IDLE gate from image-space landmarks.
  const torsoInclination = fast.torsoInclinationImage;
  newState.lastTorsoInclination = torsoInclination;

  // Update FSM using fast ratio to avoid smoothing-induced misses at BOTTOM and PLANK
  const prevPhase = currentState.fsm.phase;
  const fsmResult = updateFSM(
    currentState.fsm,
    fast.elbowRatio,
    t,
    fast.bodyAlignment,
    torsoInclination,
    fast.setupQuality,
  );
  newState.fsm = fsmResult.fsm;

  if (
    currentState.fsm.phase === 'IDLE' &&
    !fast.setupQuality.acceptable &&
    fast.setupQuality.warnings.length > 0 &&
    t - currentState.lastFeedbackTime > 2.0
  ) {
    newState.feedback = SETUP_FEEDBACK;
    newState.lastFeedbackTime = t;
  }

  if (prevPhase === 'PLANK' || prevPhase === 'IDLE') {
    newState.plankMaxElbowRatio = Math.max(currentState.plankMaxElbowRatio, fast.elbowRatio);
  }

  if (prevPhase === 'PLANK' && newState.fsm.phase === 'DESCENDING') {
    newState.activeSide = visibleSide;
  }

  // Handle returned partials: count meaningful ROM, ignore tiny setup pulses.
  if (fsmResult.partialRep) {
    if (newState.repWindow) {
      newState.repWindow.tEnd = t;
      if (!isNaN(fast.elbowRatio)) {
        newState.repWindow.minElbowRatio = Math.min(newState.repWindow.minElbowRatio, fast.elbowRatio);
        newState.repWindow.maxElbowRatio = Math.max(newState.repWindow.maxElbowRatio, fast.elbowRatio);
      }
      if (!isNaN(smoothed.bodyAlignment) && smoothed.bodyJudgeable) {
        newState.repWindow.minBodyAngle = Math.min(newState.repWindow.minBodyAngle, smoothed.bodyAlignment);
        newState.repWindow.maxBodyAngle = Math.max(newState.repWindow.maxBodyAngle, smoothed.bodyAlignment);
      }
      if (!isNaN(smoothed.hipDeviation) && smoothed.bodyJudgeable) {
        newState.repWindow.minHipDev = Math.min(newState.repWindow.minHipDev, smoothed.hipDeviation);
        newState.repWindow.maxHipDev = Math.max(newState.repWindow.maxHipDev, smoothed.hipDeviation);
      }
      if (!isNaN(smoothed.headSpine) && smoothed.headJudgeable) {
        newState.repWindow.minHeadSpine = Math.min(newState.repWindow.minHeadSpine, smoothed.headSpine);
        newState.repWindow.maxHeadSpine = Math.max(newState.repWindow.maxHeadSpine, smoothed.headSpine);
      }
      if (!isNaN(smoothed.shoulderWristOffset)) {
        newState.repWindow.maxShoulderWristOffset = Math.max(
          newState.repWindow.maxShoulderWristOffset,
          smoothed.shoulderWristOffset,
        );
      }
      if (!isNaN(smoothed.shoulderDropRatio)) {
        newState.repWindow.maxShoulderDropRatio = Math.max(
          newState.repWindow.maxShoulderDropRatio,
          smoothed.shoulderDropRatio,
        );
      }
      if (smoothed.bodyJudgeable) newState.repWindow.bodyJudgeableFrames++;
      if (smoothed.headJudgeable) newState.repWindow.headJudgeableFrames++;
      if (!fast.setupQuality.acceptable && fast.setupQuality.warnings.length > 0) {
        newState.repWindow.setupWarningFrames++;
      }

      const romRatio = newState.repWindow.maxElbowRatio - newState.repWindow.minElbowRatio;
      const duration = newState.repWindow.tEnd - newState.repWindow.tStart;
      if (
        isMeaningfulPartialRep({
          actualRom: romRatio,
          minRom: THRESHOLDS.MIN_PARTIAL_ROM,
          duration,
          minDuration: THRESHOLDS.MIN_DESCENDING_TIME,
        })
      ) {
        newState.repCount++;
        const { score, messages, scorable } = evaluateForm(newState.repWindow);
        newState.lastRepResult = {
          repIndex: newState.repCount,
          romRatio,
          tDown: duration,
          tUp: 0,
          score,
          messages,
          scorable,
          diagnostics: buildPushupDiagnostics(newState.repWindow, newState.repCount, visibleSide, scorable),
        };
        newState.feedback = messages.length > 0 ? messages.join('\n') : 'Good rep.';
      } else {
        newState.feedback = LOW_ROM_FEEDBACK;
      }
      newState.lastFeedbackTime = t;
    } else {
      newState.feedback = LOW_ROM_FEEDBACK;
      newState.lastFeedbackTime = t;
    }
    newState.repWindow = null;
    newState.activeSide = null;
    newState.plankMaxElbowRatio = -Infinity;
    return newState;
  }

  // Track rep window while actively in a rep (not PLANK or IDLE)
  const inRep = newState.fsm.phase !== 'PLANK' && newState.fsm.phase !== 'IDLE';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(t);
    if (isFinite(currentState.plankMaxElbowRatio)) {
      newState.repWindow.maxElbowRatio = Math.max(newState.repWindow.maxElbowRatio, currentState.plankMaxElbowRatio);
    }
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update min/max elbow ratio using fast (median-only) to capture true depth/lockout
    if (!isNaN(fast.elbowRatio)) {
      window.minElbowRatio = Math.min(window.minElbowRatio, fast.elbowRatio);
      window.maxElbowRatio = Math.max(window.maxElbowRatio, fast.elbowRatio);
    }
    if (!isNaN(smoothed.bodyAlignment) && smoothed.bodyJudgeable) {
      window.minBodyAngle = Math.min(window.minBodyAngle, smoothed.bodyAlignment);
      window.maxBodyAngle = Math.max(window.maxBodyAngle, smoothed.bodyAlignment);
    }
    if (!isNaN(smoothed.hipDeviation) && smoothed.bodyJudgeable) {
      window.minHipDev = Math.min(window.minHipDev, smoothed.hipDeviation);
      window.maxHipDev = Math.max(window.maxHipDev, smoothed.hipDeviation);
    }
    if (!isNaN(smoothed.headSpine) && smoothed.headJudgeable) {
      window.minHeadSpine = Math.min(window.minHeadSpine, smoothed.headSpine);
      window.maxHeadSpine = Math.max(window.maxHeadSpine, smoothed.headSpine);
    }
    if (!isNaN(smoothed.shoulderWristOffset)) {
      window.maxShoulderWristOffset = Math.max(window.maxShoulderWristOffset, smoothed.shoulderWristOffset);
    }
    if (!isNaN(smoothed.shoulderDropRatio)) {
      window.maxShoulderDropRatio = Math.max(window.maxShoulderDropRatio, smoothed.shoulderDropRatio);
    }
    if (smoothed.bodyJudgeable) window.bodyJudgeableFrames++;
    if (smoothed.headJudgeable) window.headJudgeableFrames++;
    if (!fast.setupQuality.acceptable && fast.setupQuality.warnings.length > 0) {
      window.setupWarningFrames++;
    }

    // Record bottom timestamp
    if (newState.fsm.phase === 'BOTTOM' && window.tBottom === null) {
      window.tBottom = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    const romRatio = newState.repWindow.maxElbowRatio - newState.repWindow.minElbowRatio;
    const duration = newState.repWindow.tEnd - newState.repWindow.tStart;
    const meaningfulFullRep = isMeaningfulPartialRep({
      actualRom: romRatio,
      minRom: THRESHOLDS.MIN_PARTIAL_ROM,
      duration,
      minDuration: THRESHOLDS.MIN_REP_TIME,
      frameCount: newState.repWindow.frameCount,
      minFrames: THRESHOLDS.MIN_REP_FRAMES,
    });

    if (!meaningfulFullRep) {
      newState.feedback = LOW_ROM_FEEDBACK;
      newState.lastFeedbackTime = t;
      newState.repWindow = null;
      newState.fsm = resetFSMToPlank();
      newState.activeSide = null;
      newState.plankMaxElbowRatio = -Infinity;
      return newState;
    }

    newState.repCount++;

    const tDown = newState.repWindow.tBottom ? newState.repWindow.tBottom - newState.repWindow.tStart : 0;
    const tUp = newState.repWindow.tBottom ? newState.repWindow.tEnd - newState.repWindow.tBottom : 0;

    const { score, messages, scorable } = evaluateForm(newState.repWindow);

    newState.lastRepResult = {
      repIndex: newState.repCount,
      romRatio,
      tDown,
      tUp,
      score,
      messages,
      scorable,
      diagnostics: buildPushupDiagnostics(newState.repWindow, newState.repCount, visibleSide, scorable),
    };

    if (messages.length > 0) {
      newState.feedback = messages.join('\n');
    } else {
      newState.feedback = 'Great rep!';
    }
    newState.lastFeedbackTime = t;

    // Reset rep window and FSM timestamps (skip IDLE -- gate only applies at start)
    newState.repWindow = null;
    newState.fsm = resetFSMToPlank();
    newState.activeSide = null;
    newState.plankMaxElbowRatio = -Infinity;
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

function getPushupDebugInfo(state: PushupState): PushupDebugInfo {
  const angles = state.displayAngles;
  const repWin = state.repWindow;
  const fmt = (v: number | undefined): number | null => (v !== undefined && !isNaN(v) && isFinite(v) ? v : null);
  const fmtW = (min: number, max: number): number | null =>
    min !== Infinity && max !== -Infinity ? (fmt(min) ?? fmt(max)) : null;

  return {
    phase: state.fsm.phase,
    side: state.visibleSide,
    elbow: fmt(angles?.elbow),
    elbowRatio: fmt(angles?.elbowRatio),
    bodyAlignment: fmt(angles?.bodyAlignment),
    hipDev: fmt(angles?.hipDeviation),
    headSpine: fmt(angles?.headSpine),
    torsoInclination: fmt(state.lastTorsoInclination ?? undefined),
    shoulderWristOffset: fmt(angles?.shoulderWristOffset),
    shoulderDropRatio: fmt(angles?.shoulderDropRatio),
    setupWarnings: state.lastSetupQuality?.warnings ?? [],
    setupAcceptable: state.lastSetupQuality?.acceptable ?? null,
    elbowRatioMin: repWin ? fmtW(repWin.minElbowRatio, repWin.maxElbowRatio) && fmt(repWin.minElbowRatio) : null,
    elbowRatioMax: repWin ? fmtW(repWin.minElbowRatio, repWin.maxElbowRatio) && fmt(repWin.maxElbowRatio) : null,
    bodyAngleMin: repWin ? fmtW(repWin.minBodyAngle, repWin.maxBodyAngle) && fmt(repWin.minBodyAngle) : null,
    bodyAngleMax: repWin ? fmtW(repWin.minBodyAngle, repWin.maxBodyAngle) && fmt(repWin.maxBodyAngle) : null,
    hipDevMin: repWin ? fmtW(repWin.minHipDev, repWin.maxHipDev) && fmt(repWin.minHipDev) : null,
    hipDevMax: repWin ? fmtW(repWin.minHipDev, repWin.maxHipDev) && fmt(repWin.maxHipDev) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export function createPushupDefinition(
  config: ExerciseHeuristicConfig = ACTIVE_PUSHUP_HEURISTIC_CONFIG,
): ExerciseDefinition {
  return {
    name: 'Push-Up',
    requiredView: 'side',

    createState: (): ExerciseState => ({
      repCount: 0,
      lastRepResult: null,
      feedback: null,
      feedbackTimestamp: null,
      debugInfo: {},
      repQualityWindowActive: false,
      _internal: withPushupConfig(config, () => initializePushupState()),
    }),

    update: (keypoints: Keypoint[], state: ExerciseState, frameContext?: ExerciseFrameContext): ExerciseState => {
      const internal = state._internal as PushupState;
      const newInternal = withPushupConfig(config, () => updatePushupState(keypoints, internal, frameContext));

      // Map internal RepResult to framework RepResult
      const lastRepResult: FrameworkRepResult | null = newInternal.lastRepResult
        ? {
            repIndex: newInternal.lastRepResult.repIndex,
            score: newInternal.lastRepResult.score,
            messages: newInternal.lastRepResult.messages,
            scorable: newInternal.lastRepResult.scorable,
            diagnostics: newInternal.lastRepResult.diagnostics,
          }
        : null;

      return {
        repCount: newInternal.repCount,
        lastRepResult,
        feedback: newInternal.feedback,
        feedbackTimestamp: newInternal.lastFeedbackTime > 0 ? newInternal.lastFeedbackTime : null,
        debugInfo: getPushupDebugInfo(newInternal) as unknown as Record<string, unknown>,
        repQualityWindowActive: newInternal.repWindow !== null,
        _internal: newInternal,
      };
    },

    heuristicConfig: config,
    tunableSpec: PUSHUP_TUNABLE_SPEC,
    tunedConfigPath: 'src/utils/exercises/definitions/tuned/pushup.json',
    createVariant: (variantConfig) => createPushupDefinition(mergeHeuristicConfig(config, variantConfig)),

    ttsConfig: {
      feedbackToIssue: {
        'Go deeper \u2014 try to hit 90 degrees.': 'depth_short',
        'Go deeper \u2014 aim for elbows at 90 degrees.': 'depth_short',
        'Lock out your arms fully at the top.': 'lockout_short',
        'Incomplete rep \u2014 full range of motion from lockout to 90 degrees.': 'incomplete_rom',
        'Hips are sagging \u2014 engage your core to maintain a straight line.': 'hip_sag',
        'Keep your hips up \u2014 your body line is dropping.': 'hip_sag',
        'Hips are piking up \u2014 lower them to maintain a straight plank.': 'hip_pike',
        'Hips are riding high \u2014 aim for a straight body line.': 'hip_pike',
        'Keep your head neutral \u2014 align your neck with your spine.': 'head_position',
        'Slow down the push \u2014 control the movement.': 'tempo_up',
        "Control the descent \u2014 don't drop into the pushup.": 'tempo_down',
        [SHOULDER_STACK_FEEDBACK]: 'shoulder_stack',
        [SETUP_FEEDBACK]: 'camera_setup',
      },
      feedbackMessages: {
        'Slow down the push \u2014 control the movement.': [
          'Press up with control.',
          'Press up steady.',
          'Smooth push to the top.',
        ],
      },
      issueDefinitions: [
        {
          issueType: 'head_position',
          priority: 12,
          messages: ['Keep your head neutral.', 'Neck in line with your spine.', 'Look down. Keep your neck long.'],
        },
        {
          issueType: 'shoulder_stack',
          priority: 8,
          messages: ['Stack shoulders over hands.', 'Bring shoulders over your hands.', 'Hands under shoulders.'],
        },
        {
          issueType: 'camera_setup',
          priority: 20,
          messages: ['Set the camera side on.', 'Keep your full body in frame.', 'Side view, full body in frame.'],
        },
      ],
    },

    summaryConfig: {
      'Go deeper \u2014 try to hit 90 degrees.': 'Focus on reaching full push-up depth before returning to plank.',
      'Go deeper \u2014 aim for elbows at 90 degrees.': 'Focus on hitting full depth each rep.',
      'Lock out your arms fully at the top.': 'Fully extend at the top of each rep for complete range of motion.',
      'Incomplete rep \u2014 full range of motion from lockout to 90 degrees.':
        'Achieve complete range of motion in both directions.',
      'Hips are sagging \u2014 engage your core to maintain a straight line.':
        'Strengthen your core \u2014 try planks as an accessory exercise.',
      'Keep your hips up \u2014 your body line is dropping.': 'Focus on maintaining a rigid plank throughout each rep.',
      'Hips are piking up \u2014 lower them to maintain a straight plank.':
        'Think about pushing the ground away while keeping your body rigid.',
      'Hips are riding high \u2014 aim for a straight body line.':
        'Keep your body in a straight line from head to heels.',
      'Keep your head neutral \u2014 align your neck with your spine.':
        'Keep your neck aligned with your spine instead of dropping or craning your head.',
      'Slow down the push \u2014 control the movement.': 'Slow the concentric phase \u2014 aim for 1-2 seconds up.',
      "Control the descent \u2014 don't drop into the pushup.": 'Slow the eccentric phase \u2014 2-3 seconds down.',
      [SHOULDER_STACK_FEEDBACK]: 'Set your hands under your shoulders before each rep.',
      [SETUP_FEEDBACK]: 'Use a side-on camera angle and keep your full body in frame.',
    },
  };
}

export const pushupDefinition: ExerciseDefinition = createPushupDefinition();
