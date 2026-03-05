/**
 * Standing Dumbbell Lateral Raises -- Exercise Definition
 *
 * Front-view exercise tracking shoulder abduction angle as the primary driver.
 * Both arms are tracked independently for symmetry checking. Average abduction
 * drives the FSM; per-arm values feed the scoring system.
 *
 * FSM: REST -> RAISING -> TOP -> LOWERING -> REST
 * Primary angle: shoulder abduction (hip-shoulder-elbow)
 *
 * The only export is `lateralRaiseDefinition`.
 */

import {
  Keypoint,
  calculateAngle2D,
  getKeypoint,
  isVisible,
} from '../../poseAnalysis';

import type {
  ExerciseDefinition,
  ExerciseState,
  RepResult as FrameworkRepResult,
} from '../types';

import { SmoothedAngleTracker } from '../shared/SmoothedAngleTracker';
import { WarmupGate } from '../shared/WarmupGate';
import { computeScore, PenaltyConfig } from '../shared/scoring';

// ============================================================================
// CONSTANTS & THRESHOLDS (module-private)
// ============================================================================

/** FSM thresholds (degrees of shoulder abduction) */
const THRESHOLDS = {
  /** Abduction above which we leave REST and enter RAISING */
  RAISING_ENTER: 25,
  /** Abduction above which we transition RAISING -> TOP */
  TOP_ENTER: 70,
  /** Abduction below which we leave TOP (hysteresis) */
  TOP_EXIT: 65,
  /** Abduction below which we complete the rep (LOWERING -> REST) */
  REST_ENTER: 25,
  /** Minimum time (seconds) for a rep to count */
  MIN_REP_TIME: 0.5,
} as const;

/** Form heuristic thresholds (discrete -- for visual feedback messages) */
const FORM_THRESHOLDS = {
  /** Max abduction should reach at least this for good ROM */
  ROM_MIN: 80,
  /** Elbow angle below this triggers "keep arms straighter" */
  ELBOW_BEND_WARN: 140,
  /** Torso lateral lean above this triggers "stay upright" (lowered: 6→1.8 to catch subtle momentum sway) */
  TORSO_LEAN_WARN: 1.8,
  /** Abduction difference between arms above this triggers asymmetry */
  ASYMMETRY_WARN: 18,
  /**
   * Eccentric tempo threshold (seconds).
   * Measured from TOP→LOWERING transition (65°) to rep end (25°) — ~40° of travel.
   * A natural controlled lower covers this in ~0.4–0.6s, so only flag clearly dropped reps.
   */
  TEMPO_LOWER_MIN: 0.35,
  /**
   * Shoulder elevation (shrug) as percentage of torso height.
   * Measured as how much shoulders RISE above the rest-state baseline.
   * Raised from 8→12 to account for ~8–10% of natural shoulder rise during clean abduction.
   */
  SHRUG_WARN: 12,
} as const;

/** Ideal targets used by the scoring system (separate from penalty deadzones) */
const IDEAL = {
  /** Shoulder-level abduction (degrees) */
  MAX_ABDUCTION: 85,
  /** Nearly straight arm (degrees) */
  MIN_ELBOW_ANGLE: 160,
  /** Controlled eccentric time (seconds) — ideal for scoring, not the feedback cutoff */
  ECCENTRIC_TIME: 0.55,
} as const;

/**
 * Continuous penalty curve configs for scoring.
 *
 * Formula: min(cap, scale × max(0, value − deadzone)²)
 * "value" is the measured deviation from ideal (computed in computeRepWindowScore).
 * "deadzone" is the tolerance before penalty kicks in (NOT the ideal target).
 *
 * | Category     | Cap | Deadzone | Scale | Input                                         |
 * |--------------|-----|----------|-------|-----------------------------------------------|
 * | ROM          | 50  | 0°       | 0.50  | ideal 85° − maxAbduction                      |
 * | Elbow bend   | 20  | 20°      | 0.10  | ideal 160° − minElbowAngle                    |
 * | Torso lean   | 25  | 1.8°     | 200   | maxTorsoLean from vertical (tightened heavily) |
 * | Tempo lower  | 35  | 0.05s    | 1800  | ideal 0.55s − actual eccentric time            |
 * | Asymmetry    | 15  | 10°      | 0.04  | maxAbductionDiff between arms                 |
 * | Shrug        | 20  | 10%      | 0.50  | shoulder elevation % above rest baseline       |
 *
 * Max total penalty: 165 → worst possible rep = 0.
 */
const PENALTY_CONFIGS = {
  ROM:         { cap: 50, deadzone: 0,    scale: 0.50 } as PenaltyConfig,
  ELBOW_BEND:  { cap: 20, deadzone: 20,   scale: 0.10 } as PenaltyConfig,
  TORSO_LEAN:  { cap: 25, deadzone: 1.8,  scale: 200  } as PenaltyConfig,
  TEMPO_LOWER: { cap: 35, deadzone: 0.05, scale: 1800 } as PenaltyConfig,
  ASYMMETRY:   { cap: 15, deadzone: 10,   scale: 0.04 } as PenaltyConfig,
  SHRUG:       { cap: 20, deadzone: 10,   scale: 0.50 } as PenaltyConfig,
} as const;

const VISIBILITY_THRESHOLD = 0.15;

// ============================================================================
// TYPES (module-private)
// ============================================================================

type LateralRaisePhase = 'REST' | 'RAISING' | 'TOP' | 'LOWERING';

interface RepWindow {
  /** Timestamps */
  tStart: number;
  tTop: number | null;
  /** Timestamp of the TOP→LOWERING transition — the true eccentric start */
  tLoweringStart: number | null;
  tEnd: number;
  /** Max abduction reached (average of both arms) */
  maxAbduction: number;
  /** Max abduction per arm (for asymmetry) */
  maxLeftAbduction: number;
  maxRightAbduction: number;
  /** Max difference in abduction between arms at any frame */
  maxAbductionDiff: number;
  /** Min elbow angle during the rep (lower = more bend) */
  minElbowAngle: number;
  /** Max torso lateral lean during the rep */
  maxTorsoLean: number;
  /** Baseline torso height at rep start (for shrug detection) */
  baselineTorsoHeight: number | null;
  /** Max shoulder shrug as percentage of torso height compression */
  maxShrugPct: number;
  /** Frame count */
  frameCount: number;
}

interface LateralRaiseState {
  phase: LateralRaisePhase;
  repCount: number;
  /** Timestamp when the current rep started (REST -> RAISING) */
  tRepStart: number | null;
  /** Current rep window accumulator */
  repWindow: RepWindow | null;
  /** Last completed rep result */
  lastRepResult: RepResult | null;
  /** Smoothed angle trackers */
  leftAbductionTracker: SmoothedAngleTracker;
  rightAbductionTracker: SmoothedAngleTracker;
  leftElbowTracker: SmoothedAngleTracker;
  rightElbowTracker: SmoothedAngleTracker;
  torsoLeanTracker: SmoothedAngleTracker;
  /** Warmup gate */
  warmupGate: WarmupGate;
  /** Whether warmup has been passed */
  warmedUp: boolean;
  /**
   * Torso height (midHipY − midShoulderY) captured during REST.
   * Used as the shrug baseline so we measure shoulder ELEVATION above rest,
   * not torso height compression (which was incorrectly signed and noisy).
   */
  restTorsoHeight: number | null;
  /** Current smoothed values (for debug) */
  smoothedLeftAbduction: number;
  smoothedRightAbduction: number;
  smoothedAvgAbduction: number;
  smoothedLeftElbow: number;
  smoothedRightElbow: number;
  smoothedTorsoLean: number;
  /** Visual feedback */
  feedback: string | null;
  lastFeedbackTime: number;
}

interface RepResult {
  repIndex: number;
  score: number;
  messages: string[];
}

/** Debug info for on-screen overlay */
interface LateralRaiseDebugInfo {
  phase: LateralRaisePhase;
  warmedUp: boolean;
  leftAbduction: number | null;
  rightAbduction: number | null;
  avgAbduction: number | null;
  leftElbow: number | null;
  rightElbow: number | null;
  torsoLean: number | null;
  maxAbduction: number | null;
  maxAbductionDiff: number | null;
  minElbow: number | null;
  maxTorsoLean: number | null;
  shrugPct: number | null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializeState(): LateralRaiseState {
  return {
    phase: 'REST',
    repCount: 0,
    tRepStart: null,
    repWindow: null,
    lastRepResult: null,
    leftAbductionTracker: new SmoothedAngleTracker(),
    rightAbductionTracker: new SmoothedAngleTracker(),
    leftElbowTracker: new SmoothedAngleTracker(),
    rightElbowTracker: new SmoothedAngleTracker(),
    torsoLeanTracker: new SmoothedAngleTracker(),
    warmupGate: new WarmupGate({
      requiredJoints: [
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
        'left_hip', 'right_hip',
        'left_wrist', 'right_wrist',
      ],
    }),
    warmedUp: false,
    restTorsoHeight: null,
    smoothedLeftAbduction: 0,
    smoothedRightAbduction: 0,
    smoothedAvgAbduction: 0,
    smoothedLeftElbow: 180,
    smoothedRightElbow: 180,
    smoothedTorsoLean: 0,
    feedback: null,
    lastFeedbackTime: 0,
  };
}

function initRepWindow(tStart: number, baselineTorsoHeight: number | null): RepWindow {
  return {
    tStart,
    tTop: null,
    tLoweringStart: null,
    tEnd: tStart,
    maxAbduction: 0,
    maxLeftAbduction: 0,
    maxRightAbduction: 0,
    maxAbductionDiff: 0,
    minElbowAngle: 180,
    maxTorsoLean: 0,
    baselineTorsoHeight,
    maxShrugPct: 0,
    frameCount: 0,
  };
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

type Point2D = { x: number; y: number };

function getPoint(kp: Keypoint): Point2D {
  return { x: kp.x, y: kp.y };
}

/**
 * Compute shoulder abduction angle for one side.
 * Measured as the angle at the shoulder between hip-shoulder-elbow (2D).
 * Arms at sides: ~0-15 degrees. Arms at shoulder height: ~80-90 degrees.
 */
function computeAbduction(
  hip: Keypoint,
  shoulder: Keypoint,
  elbow: Keypoint,
): number {
  return calculateAngle2D(getPoint(hip), getPoint(shoulder), getPoint(elbow));
}

/**
 * Compute elbow angle (shoulder-elbow-wrist).
 * Straight arm: ~170-180 degrees. Bent: lower.
 */
function computeElbowAngle(
  shoulder: Keypoint,
  elbow: Keypoint,
  wrist: Keypoint,
): number {
  return calculateAngle2D(getPoint(shoulder), getPoint(elbow), getPoint(wrist));
}

/**
 * Compute lateral torso lean from front view.
 * Uses midpoint of shoulders and midpoint of hips.
 * Returns absolute lean angle in degrees from vertical.
 */
function computeTorsoLean(
  leftShoulder: Keypoint,
  rightShoulder: Keypoint,
  leftHip: Keypoint,
  rightHip: Keypoint,
): number {
  const midShoulderX = (leftShoulder.x + rightShoulder.x) / 2;
  const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const midHipX = (leftHip.x + rightHip.x) / 2;
  const midHipY = (leftHip.y + rightHip.y) / 2;

  // Angle of the shoulder-hip midline from vertical (Y axis)
  // atan2(dx, dy) gives angle from vertical; positive = lean right
  const dx = midHipX - midShoulderX;
  const dy = midHipY - midShoulderY;

  // Absolute lateral lean in degrees
  return Math.abs(Math.atan2(dx, dy) * (180 / Math.PI));
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMResult {
  phase: LateralRaisePhase;
  repCompleted: boolean;
}

function updateFSM(
  currentPhase: LateralRaisePhase,
  avgAbduction: number,
  t: number,
  tRepStart: number | null,
): FSMResult {
  let phase = currentPhase;
  let repCompleted = false;

  switch (phase) {
    case 'REST':
      if (avgAbduction > THRESHOLDS.RAISING_ENTER) {
        phase = 'RAISING';
      }
      break;

    case 'RAISING':
      if (avgAbduction >= THRESHOLDS.TOP_ENTER) {
        phase = 'TOP';
      } else if (avgAbduction < THRESHOLDS.REST_ENTER) {
        // Aborted raise -- back to rest without counting
        phase = 'REST';
      }
      break;

    case 'TOP':
      if (avgAbduction < THRESHOLDS.TOP_EXIT) {
        phase = 'LOWERING';
      }
      break;

    case 'LOWERING':
      if (avgAbduction < THRESHOLDS.REST_ENTER) {
        // Rep complete if enough time has passed
        if (tRepStart !== null && (t - tRepStart) >= THRESHOLDS.MIN_REP_TIME) {
          repCompleted = true;
        }
        phase = 'REST';
      } else if (avgAbduction >= THRESHOLDS.TOP_ENTER) {
        // User raised arms again before completing descent
        phase = 'TOP';
      }
      break;
  }

  return { phase, repCompleted };
}

// ============================================================================
// SCORING
// ============================================================================

function computeRepWindowScore(repWindow: RepWindow): number {
  const penalties: Array<{ value: number; config: PenaltyConfig }> = [];

  // 1. ROM shortfall -- ideal is 85° (shoulder level). FSM ensures ≥70° so range is 0-15°.
  const romShortfall = Math.max(0, IDEAL.MAX_ABDUCTION - repWindow.maxAbduction);
  penalties.push({ value: romShortfall, config: PENALTY_CONFIGS.ROM });

  // 2. Elbow bend -- ideal is 160° (slight bend OK). Lower = more bend = worse.
  const elbowBendExcess = Math.max(0, IDEAL.MIN_ELBOW_ANGLE - repWindow.minElbowAngle);
  penalties.push({ value: elbowBendExcess, config: PENALTY_CONFIGS.ELBOW_BEND });

  // 3. Torso lean -- lower is better (deadzone handles small amounts)
  penalties.push({ value: repWindow.maxTorsoLean, config: PENALTY_CONFIGS.TORSO_LEAN });

  // 4. Eccentric tempo only -- no penalty for concentric speed.
  // Use tLoweringStart (TOP→LOWERING transition) not tTop, so we measure only the
  // actual descent phase and don't inflate the time with the concentric + hold at peak.
  if (repWindow.tLoweringStart !== null) {
    const tLower = repWindow.tEnd - repWindow.tLoweringStart;
    if (tLower > 0 && tLower < IDEAL.ECCENTRIC_TIME) {
      const deficit = IDEAL.ECCENTRIC_TIME - tLower;
      penalties.push({ value: deficit, config: PENALTY_CONFIGS.TEMPO_LOWER });
    }
  }

  // 5. Asymmetry -- max abduction difference between arms
  penalties.push({ value: repWindow.maxAbductionDiff, config: PENALTY_CONFIGS.ASYMMETRY });

  // 6. Shoulder shrug -- torso height compression percentage
  penalties.push({ value: repWindow.maxShrugPct, config: PENALTY_CONFIGS.SHRUG });

  return computeScore(penalties);
}

// ============================================================================
// FORM FEEDBACK (discrete messages for visual display)
// ============================================================================

function generateFormMessages(repWindow: RepWindow): string[] {
  const messages: string[] = [];

  // 1. ROM -- raise height
  if (repWindow.maxAbduction < FORM_THRESHOLDS.ROM_MIN) {
    messages.push('Raise higher \u2014 aim for shoulder level.');
  }

  // 2. Elbow bend
  if (repWindow.minElbowAngle < FORM_THRESHOLDS.ELBOW_BEND_WARN) {
    messages.push('Keep your arms straighter \u2014 avoid excessive elbow bend.');
  }

  // 3. Torso lean
  if (repWindow.maxTorsoLean > FORM_THRESHOLDS.TORSO_LEAN_WARN) {
    messages.push('Stay upright \u2014 avoid swaying or leaning.');
  }

  // 4. Asymmetry
  if (repWindow.maxAbductionDiff > FORM_THRESHOLDS.ASYMMETRY_WARN) {
    messages.push('Even it out \u2014 raise both arms to the same height.');
  }

  // 5. Eccentric tempo only (no concentric check).
  // Measured from TOP→LOWERING transition to rep end — excludes the concentric + top hold.
  if (repWindow.tLoweringStart !== null) {
    const tLower = repWindow.tEnd - repWindow.tLoweringStart;
    if (tLower > 0 && tLower < FORM_THRESHOLDS.TEMPO_LOWER_MIN) {
      messages.push('Control the descent \u2014 lower the weights slowly.');
    }
  }

  // 6. Shoulder shrug
  if (repWindow.maxShrugPct > FORM_THRESHOLDS.SHRUG_WARN) {
    messages.push('Relax your traps \u2014 don\'t shrug the weight up.');
  }

  return messages;
}

// ============================================================================
// MAIN UPDATE LOGIC
// ============================================================================

function updateLateralRaiseState(
  keypoints: Keypoint[],
  state: LateralRaiseState,
): LateralRaiseState {
  const t = Date.now() / 1000;

  // -- Warmup gate --
  if (!state.warmedUp) {
    const stable = state.warmupGate.update(keypoints);
    if (!stable) return state;
    state.warmedUp = true;
  }

  // -- Fetch keypoints --
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const le = getKeypoint(keypoints, 'left_elbow');
  const re = getKeypoint(keypoints, 'right_elbow');
  const lw = getKeypoint(keypoints, 'left_wrist');
  const rw = getKeypoint(keypoints, 'right_wrist');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  // Require both sides visible (front-view exercise)
  const leftArmVisible =
    isVisible(ls, VISIBILITY_THRESHOLD) &&
    isVisible(le, VISIBILITY_THRESHOLD) &&
    isVisible(lh, VISIBILITY_THRESHOLD);
  const rightArmVisible =
    isVisible(rs, VISIBILITY_THRESHOLD) &&
    isVisible(re, VISIBILITY_THRESHOLD) &&
    isVisible(rh, VISIBILITY_THRESHOLD);

  if (!leftArmVisible || !rightArmVisible) {
    return state;
  }

  // -- Compute raw angles --
  const rawLeftAbduction = computeAbduction(lh!, ls!, le!);
  const rawRightAbduction = computeAbduction(rh!, rs!, re!);

  let rawLeftElbow = 180;
  let rawRightElbow = 180;
  if (isVisible(lw, VISIBILITY_THRESHOLD)) {
    rawLeftElbow = computeElbowAngle(ls!, le!, lw!);
  }
  if (isVisible(rw, VISIBILITY_THRESHOLD)) {
    rawRightElbow = computeElbowAngle(rs!, re!, rw!);
  }

  let rawTorsoLean = 0;
  const allTorsoVisible =
    isVisible(ls, VISIBILITY_THRESHOLD) &&
    isVisible(rs, VISIBILITY_THRESHOLD) &&
    isVisible(lh, VISIBILITY_THRESHOLD) &&
    isVisible(rh, VISIBILITY_THRESHOLD);
  if (allTorsoVisible) {
    rawTorsoLean = computeTorsoLean(ls!, rs!, lh!, rh!);
  }

  // -- Smooth angles --
  const smoothedLeftAbduction = state.leftAbductionTracker.push(rawLeftAbduction);
  const smoothedRightAbduction = state.rightAbductionTracker.push(rawRightAbduction);
  const smoothedAvgAbduction = (smoothedLeftAbduction + smoothedRightAbduction) / 2;
  const smoothedLeftElbow = state.leftElbowTracker.push(rawLeftElbow);
  const smoothedRightElbow = state.rightElbowTracker.push(rawRightElbow);
  const smoothedTorsoLean = state.torsoLeanTracker.push(rawTorsoLean);

  // Update display values (mutate in place for perf)
  state.smoothedLeftAbduction = smoothedLeftAbduction;
  state.smoothedRightAbduction = smoothedRightAbduction;
  state.smoothedAvgAbduction = smoothedAvgAbduction;
  state.smoothedLeftElbow = smoothedLeftElbow;
  state.smoothedRightElbow = smoothedRightElbow;
  state.smoothedTorsoLean = smoothedTorsoLean;

  // -- FSM update --
  const fsmResult = updateFSM(state.phase, smoothedAvgAbduction, t, state.tRepStart);
  const prevPhase = state.phase;
  state.phase = fsmResult.phase;

  // -- Capture rest-state torso height baseline (used for shrug detection) --
  // Updated every frame in REST so it reflects the true relaxed shoulder position
  // just before the rep starts.
  if (state.phase === 'REST' && allTorsoVisible) {
    const midShoulderY = (ls!.y + rs!.y) / 2;
    const midHipY = (lh!.y + rh!.y) / 2;
    const torsoH = midHipY - midShoulderY;
    if (torsoH > 0.01) {
      state.restTorsoHeight = torsoH;
    }
  }

  // -- Track rep start --
  if (prevPhase === 'REST' && state.phase === 'RAISING') {
    state.tRepStart = t;
    state.repWindow = initRepWindow(t, state.restTorsoHeight);
  }

  // -- Track TOP→LOWERING transition (true eccentric start) --
  if (prevPhase === 'TOP' && state.phase === 'LOWERING' && state.repWindow) {
    state.repWindow.tLoweringStart = t;
  }

  // -- Accumulate rep window while in a rep --
  const inRep = state.phase !== 'REST';
  if (state.repWindow && inRep) {
    const w = state.repWindow;
    w.tEnd = t;
    w.frameCount++;

    // Max abduction (average)
    w.maxAbduction = Math.max(w.maxAbduction, smoothedAvgAbduction);
    // Per-arm max abduction
    w.maxLeftAbduction = Math.max(w.maxLeftAbduction, smoothedLeftAbduction);
    w.maxRightAbduction = Math.max(w.maxRightAbduction, smoothedRightAbduction);
    // Max difference between arms at this frame
    const abductionDiff = Math.abs(smoothedLeftAbduction - smoothedRightAbduction);
    w.maxAbductionDiff = Math.max(w.maxAbductionDiff, abductionDiff);
    // Min elbow angle (worst bend)
    const minElbow = Math.min(smoothedLeftElbow, smoothedRightElbow);
    w.minElbowAngle = Math.min(w.minElbowAngle, minElbow);
    // Max torso lean
    w.maxTorsoLean = Math.max(w.maxTorsoLean, smoothedTorsoLean);

    // Shoulder shrug detection via shoulder ELEVATION above rest baseline.
    //
    // When shrugging, shoulders RISE (midShoulderY decreases in image coords where Y=0
    // is the top). This makes torsoHeight = midHipY − midShoulderY INCREASE.
    // elevation = (current − baseline) / baseline × 100 is therefore POSITIVE when
    // shrugging, which is the correct sign.
    //
    // The old formula used (baseline − current), which produced a NEGATIVE value for
    // shrugging and fired spuriously on noise/sway instead.
    if (allTorsoVisible) {
      const midShoulderY = (ls!.y + rs!.y) / 2;
      const midHipY = (lh!.y + rh!.y) / 2;
      const torsoHeight = midHipY - midShoulderY; // increases when shoulders rise
      if (torsoHeight > 0.01) {
        // Seed baseline from rest-state height (captured before rep started) if available.
        if (w.baselineTorsoHeight === null) {
          w.baselineTorsoHeight = torsoHeight;
        }
        const elevation = (torsoHeight - w.baselineTorsoHeight) / w.baselineTorsoHeight * 100;
        if (elevation > 0) {
          w.maxShrugPct = Math.max(w.maxShrugPct, elevation);
        }
      }
    }

    // Record TOP timestamp
    if (state.phase === 'TOP' && w.tTop === null) {
      w.tTop = t;
    }
  }

  // -- Handle rep completion --
  if (fsmResult.repCompleted && state.repWindow) {
    state.repCount++;

    const score = computeRepWindowScore(state.repWindow);
    const messages = generateFormMessages(state.repWindow);

    state.lastRepResult = {
      repIndex: state.repCount,
      score,
      messages,
    };

    if (messages.length > 0) {
      state.feedback = messages.join('\n');
    } else {
      state.feedback = 'Great rep!';
    }
    state.lastFeedbackTime = t;

    // Reset for next rep
    state.repWindow = null;
    state.tRepStart = null;
  }

  // -- Handle aborted raise (RAISING -> REST without rep completion) --
  if (prevPhase === 'RAISING' && state.phase === 'REST' && !fsmResult.repCompleted) {
    state.repWindow = null;
    state.tRepStart = null;
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

function getDebugInfo(state: LateralRaiseState): LateralRaiseDebugInfo {
  const fmt = (v: number): number | null =>
    !isNaN(v) && isFinite(v) ? v : null;

  const w = state.repWindow;
  return {
    phase: state.phase,
    warmedUp: state.warmedUp,
    leftAbduction: fmt(state.smoothedLeftAbduction),
    rightAbduction: fmt(state.smoothedRightAbduction),
    avgAbduction: fmt(state.smoothedAvgAbduction),
    leftElbow: fmt(state.smoothedLeftElbow),
    rightElbow: fmt(state.smoothedRightElbow),
    torsoLean: fmt(state.smoothedTorsoLean),
    maxAbduction: w ? fmt(w.maxAbduction) : null,
    maxAbductionDiff: w ? fmt(w.maxAbductionDiff) : null,
    minElbow: w ? (w.minElbowAngle < 180 ? fmt(w.minElbowAngle) : null) : null,
    maxTorsoLean: w ? fmt(w.maxTorsoLean) : null,
    shrugPct: w ? fmt(w.maxShrugPct) : null,
  };
}

// ============================================================================
// EXERCISE DEFINITION (the only export)
// ============================================================================

export const lateralRaiseDefinition: ExerciseDefinition = {
  name: 'Standing Dumbbell Lateral Raises',
  requiredView: 'front',

  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: initializeState(),
  }),

  update: (keypoints: Keypoint[], state: ExerciseState): ExerciseState => {
    const internal = state._internal as LateralRaiseState;
    updateLateralRaiseState(keypoints, internal);

    // Map internal RepResult to framework RepResult
    const lastRepResult: FrameworkRepResult | null = internal.lastRepResult
      ? {
          repIndex: internal.lastRepResult.repIndex,
          score: internal.lastRepResult.score,
          messages: internal.lastRepResult.messages,
        }
      : null;

    return {
      repCount: internal.repCount,
      lastRepResult,
      feedback: internal.feedback,
      feedbackTimestamp: internal.lastFeedbackTime > 0 ? internal.lastFeedbackTime : null,
      debugInfo: getDebugInfo(internal) as unknown as Record<string, unknown>,
      _internal: internal,
    };
  },

  ttsConfig: {
    feedbackToIssue: {
      'Raise higher \u2014 aim for shoulder level.': 'rom_height',
      'Keep your arms straighter \u2014 avoid excessive elbow bend.': 'elbow_bend',
      'Stay upright \u2014 avoid swaying or leaning.': 'torso_warn',
      'Even it out \u2014 raise both arms to the same height.': 'asymmetry',
      'Control the descent \u2014 lower the weights slowly.': 'tempo_down',
      'Relax your traps \u2014 don\'t shrug the weight up.': 'shoulder_shrug',
    },
    issueDefinitions: [
      {
        issueType: 'rom_height',
        priority: 25,
        messages: [
          'Get those arms up higher.',
          'Raise to shoulder height.',
          'Lift a bit higher.',
        ],
      },
      {
        issueType: 'elbow_bend',
        priority: 15,
        messages: [
          'Straighten your arms more.',
          'Less bend in the elbows.',
          'Keep arms extended.',
        ],
      },
      {
        issueType: 'shoulder_shrug',
        priority: 20,
        messages: [
          'Relax your shoulders down.',
          'Don\'t shrug, lead with your elbows.',
          'Keep your traps relaxed.',
        ],
      },
    ],
  },

  summaryConfig: {
    'Raise higher \u2014 aim for shoulder level.':
      'Focus on raising the dumbbells to shoulder height for full range of motion.',
    'Keep your arms straighter \u2014 avoid excessive elbow bend.':
      'Maintain a slight bend but keep arms mostly straight throughout the lift.',
    'Stay upright \u2014 avoid swaying or leaning.':
      'Brace your core and avoid using momentum to swing the weights up.',
    'Even it out \u2014 raise both arms to the same height.':
      'Focus on raising both arms evenly \u2014 consider using a mirror to check symmetry.',
    'Control the descent \u2014 lower the weights slowly.':
      'Slow the eccentric phase \u2014 aim for 2-3 seconds down.',
    'Relax your traps \u2014 don\'t shrug the weight up.':
      'Focus on leading with your elbows, not your shoulders. If you\'re shrugging, the weight may be too heavy.',
  },
};
