/**
 * Pushup Heuristics - Forma Specification
 *
 * Implements deterministic pushup detection and form coaching using
 * side-view camera with single-body FSM. Mirrors the barbellCurlHeuristics
 * pattern but tracks elbow angle and body alignment.
 */

import {
  Keypoint,
  calculateAngle,
  calculateAngle2D,
  getKeypoint,
  isVisible,
} from './poseAnalysis';

// ============================================================================
// CONSTANTS & THRESHOLDS
// ============================================================================

/** FSM thresholds (degrees) */
export const THRESHOLDS = {
  /** Elbow angle below which we transition PLANK -> DESCENDING */
  DESCENDING_ENTER: 150,
  /** Elbow angle above which we transition ASCENDING -> PLANK.
   *  A fully extended arm reads 155-170° in 2D CV depending on camera angle
   *  and whether the user hyperextends. 155° accepts a "soft lockout" (e.g.
   *  164.2° observed) while still requiring meaningful extension from BOTTOM. */
  PLANK_REENTER: 155,
  /** Elbow angle below which we reach BOTTOM.
   *  Relaxed from 95° to 105° — a physical 90° often reads 96-100° in 2D
   *  camera projection due to foreshortening and landmark jitter. */
  BOTTOM_ENTER: 105,
  /** Elbow angle above which we leave BOTTOM (hysteresis above BOTTOM_ENTER) */
  BOTTOM_EXIT: 112,
  /** Minimum time (seconds) for a rep to count */
  MIN_REP_TIME: 0.4,
  /** Partial rep: if in DESCENDING and elbow returns above this without hitting BOTTOM */
  PARTIAL_REP_RESET: 150,
  /** Minimum time (seconds) in DESCENDING before a partial-rep reset can trigger.
   *  Prevents flip-flopping when hovering near the DESCENDING_ENTER threshold. */
  MIN_DESCENDING_TIME: 0.25,
  /** Minimum body alignment angle for plank detection in IDLE gate */
  PLANK_BODY_MIN: 165,
  /** Maximum body alignment angle for plank detection in IDLE gate */
  PLANK_BODY_MAX: 195,
  /** Seconds the user must hold plank before FSM activates from IDLE */
  PLANK_HOLD_TIME: 1.0,
  /** Minimum torso inclination from vertical for plank detection (degrees).
   *  Standing ≈ 0°, planking ≈ 90°. 65° rejects upright postures. */
  TORSO_INCLINE_MIN: 65,
  /** Maximum torso inclination from vertical for plank detection (degrees).
   *  Allows slight decline/incline pushups but rejects inverted poses. */
  TORSO_INCLINE_MAX: 115,
} as const;

/** Form heuristic thresholds */
export const FORM_THRESHOLDS = {
  // Depth (aligned with BOTTOM_ENTER — if the FSM accepted it, only penalize beyond this)
  DEPTH_FAIL: 110, // min elbow > 110° means insufficient depth
  // Lockout (aligned with PLANK_REENTER — penalize only if clearly short of extension)
  LOCKOUT_FAIL: 150, // max elbow < 150° means incomplete lockout
  // ROM
  ROM_MIN: 60, // minimum ROM in degrees
  // Hip alignment (shoulder-hip-ankle angle)
  HIP_SAG_FAIL: 155,
  HIP_SAG_WARN: 165,
  HIP_PIKE_FAIL: 195,
  HIP_PIKE_WARN: 185,
  // Hip deviation (as fraction of shoulder-ankle distance)
  HIP_DEV_SAG_FAIL: 0.10,
  HIP_DEV_SAG_WARN: 0.05,
  HIP_DEV_PIKE_FAIL: 0.10,
  HIP_DEV_PIKE_WARN: 0.05,
  // Tempo
  TEMPO_CONCENTRIC_MIN: 0.15, // seconds — ascent too fast
  TEMPO_ECCENTRIC_MIN: 0.20, // seconds — descent too fast
} as const;

/**
 * Continuous penalty curve parameters for `computePushupRepScore()`.
 * Each category: min(cap, scale × max(0, x − deadzone)²)
 *
 * | Category          | Cap | Deadzone           | Scale | Key Input                     |
 * |-------------------|-----|--------------------|-------|-------------------------------|
 * | Depth shortfall   | 30  | 90° (minElbow)     | 0.03  | min elbow angle during rep    |
 * | Lockout shortfall | 25  | 165° (maxElbow)    | 0.10  | ideal lockout − max elbow     |
 * | Hip alignment     | 35  | ±8° from 180°      | 0.04  | worst body-angle deviation    |
 * | Tempo             | 20  | up: 0.3s, dn: 0.4s | 60/40 | concentric / eccentric time   |
 *
 * Max total penalty: 110 → worst possible rep = 0.
 */
const SCORE_CURVES = {
  DEPTH:   { deadzone: 90,  scale: 0.03, cap: 30 },
  LOCKOUT: { ideal: 165,    scale: 0.10, cap: 25 },
  HIP:     { deadzone: 8,   scale: 0.04, cap: 35, neutral: 180 },
  TEMPO_CONCENTRIC: { deadzone: 0.3, scale: 60, cap: 10 },
  TEMPO_ECCENTRIC:  { deadzone: 0.4, scale: 40, cap: 10 },
} as const;

/** Smoothing parameters */
const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.3;
const VISIBILITY_THRESHOLD = 0.1;

// ============================================================================
// TYPES
// ============================================================================

export type PushupPhase = 'IDLE' | 'PLANK' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';

export interface PushupFSM {
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

export interface PushupRepWindow {
  /** Min/max elbow angle during rep */
  minElbow: number;
  maxElbow: number;
  /** Min/max body alignment angle (shoulder-hip-ankle) */
  minBodyAngle: number;
  maxBodyAngle: number;
  /** Min/max hip deviation (positive = sag, negative = pike) */
  minHipDev: number;
  maxHipDev: number;
  /** Min/max head-spine angle */
  minHeadSpine: number;
  maxHeadSpine: number;
  /** Timestamps */
  tStart: number;
  tBottom: number | null;
  tEnd: number;
  /** Frame count */
  frameCount: number;
}

export interface PushupAngles {
  elbow: number;
  bodyAlignment: number;
  hipDeviation: number; // normalized: positive = sag, negative = pike
  headSpine: number;
}

export interface SmoothedPushupAngles extends PushupAngles {}

export interface RepResult {
  repIndex: number;
  rom: number;
  tDown: number; // eccentric (descent)
  tUp: number; // concentric (ascent)
  score: number;
  messages: string[];
}

export interface PushupState {
  fsm: PushupFSM;
  repCount: number;
  repWindow: PushupRepWindow | null;
  lastRepResult: RepResult | null;
  angleHistory: Record<keyof PushupAngles, number[]>;
  smoothed: SmoothedPushupAngles | null;
  displayAngles: PushupAngles | null;
  feedback: string | null;
  lastFeedbackTime: number;
  /** Which side of the body is more visible */
  visibleSide: 'left' | 'right';
  /** Last computed torso inclination from vertical (for debug display) */
  lastTorsoInclination: number | null;
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
    minElbow: Infinity,
    maxElbow: -Infinity,
    minBodyAngle: Infinity,
    maxBodyAngle: -Infinity,
    minHipDev: Infinity,
    maxHipDev: -Infinity,
    minHeadSpine: Infinity,
    maxHeadSpine: -Infinity,
    tStart,
    tBottom: null,
    tEnd: tStart,
    frameCount: 0,
  };
}

export function initializePushupState(): PushupState {
  return {
    fsm: initFSM(),
    repCount: 0,
    repWindow: null,
    lastRepResult: null,
    angleHistory: {
      elbow: [],
      bodyAlignment: [],
      hipDeviation: [],
      headSpine: [],
    },
    smoothed: null,
    displayAngles: null,
    feedback: null,
    lastFeedbackTime: 0,
    visibleSide: 'left',
    lastTorsoInclination: null,
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

/**
 * Perpendicular distance from point P to line AB, normalized by AB length.
 * Positive = P is below the line (sag), Negative = P is above (pike).
 * "Below" is defined by the cross product sign in the XY plane.
 */
function calculateHipDeviation(
  shoulder: Point3D,
  hip: Point3D,
  ankle: Point3D
): number {
  // Vector AB = ankle - shoulder
  const abx = ankle.x - shoulder.x;
  const aby = ankle.y - shoulder.y;
  const abLen = Math.sqrt(abx * abx + aby * aby);
  if (abLen < 1e-8) return 0;

  // Vector AP = hip - shoulder
  const apx = hip.x - shoulder.x;
  const apy = hip.y - shoulder.y;

  // Cross product (2D): AB x AP = abx*apy - aby*apx
  // Positive cross = hip is on one side; negative = other side
  const cross = abx * apy - aby * apx;

  // Normalized perpendicular distance
  // Convention: positive = sag (hip below line), negative = pike (hip above line)
  // In screen coords (Y down), if shoulder is to the left and ankle to the right:
  //   positive cross = hip is below the line = sag
  return cross / abLen;
}

/**
 * Calculate the inclination of the torso vector relative to the vertical Y-axis.
 * Uses midpoints of both shoulders and both hips when available, falls back to
 * the visible side's shoulder and hip.
 *
 * Returns degrees: 0° = standing vertical (torso aligned with Y-axis),
 *                  90° = horizontal (plank position).
 * Returns null if required landmarks aren't visible.
 */
function calculateTorsoInclination(
  keypoints: Keypoint[],
  visibleSide: 'left' | 'right'
): number | null {
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

  // Torso vector: shoulder → hip (in screen coords, Y points down)
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

function calculatePushupAngles(
  keypoints: Keypoint[],
  side: 'left' | 'right'
): PushupAngles | null {
  const prefix = side;
  const shoulder = getKeypoint(keypoints, `${prefix}_shoulder`);
  const elbow = getKeypoint(keypoints, `${prefix}_elbow`);
  const wrist = getKeypoint(keypoints, `${prefix}_wrist`);
  const hip = getKeypoint(keypoints, `${prefix}_hip`);
  const ankle = getKeypoint(keypoints, `${prefix}_ankle`);
  const nose = getKeypoint(keypoints, 'nose');

  // Minimum required: shoulder, elbow, wrist for elbow angle
  const hasArm =
    shoulder && elbow && wrist &&
    isVisible(shoulder, VISIBILITY_THRESHOLD) &&
    isVisible(elbow, VISIBILITY_THRESHOLD) &&
    isVisible(wrist, VISIBILITY_THRESHOLD);

  if (!hasArm) return null;

  // Elbow angle (2D — side view, XY plane captures flexion)
  const elbowAngle = calculateAngle2D(
    getPoint(shoulder)!,
    getPoint(elbow)!,
    getPoint(wrist)!
  );

  // Body alignment (shoulder-hip-ankle)
  let bodyAlignmentAngle = 180; // default: straight
  let hipDeviation = 0;
  const hasBody =
    hip && ankle &&
    isVisible(hip, VISIBILITY_THRESHOLD) &&
    isVisible(ankle, VISIBILITY_THRESHOLD);

  if (hasBody) {
    bodyAlignmentAngle = calculateAngle(
      getPoint(shoulder)!,
      getPoint(hip)!,
      getPoint(ankle)!
    );
    // Normalize hip deviation by shoulder-ankle distance
    const shoulderPt = getPoint(shoulder)!;
    const hipPt = getPoint(hip)!;
    const anklePt = getPoint(ankle)!;
    const saDistX = anklePt.x - shoulderPt.x;
    const saDistY = anklePt.y - shoulderPt.y;
    const saDist = Math.sqrt(saDistX * saDistX + saDistY * saDistY);
    if (saDist > 1e-8) {
      hipDeviation = calculateHipDeviation(shoulderPt, hipPt, anklePt) / saDist;
    }
  }

  // Head-spine angle (hip -> shoulder -> nose)
  let headSpineAngle = 165; // default neutral
  if (hip && nose &&
      isVisible(hip, VISIBILITY_THRESHOLD) &&
      isVisible(nose, VISIBILITY_THRESHOLD)) {
    headSpineAngle = calculateAngle2D(
      getPoint(hip)!,
      getPoint(shoulder)!,
      getPoint(nose)!
    );
  }

  return {
    elbow: elbowAngle,
    bodyAlignment: bodyAlignmentAngle,
    hipDeviation,
    headSpine: headSpineAngle,
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
  rawAngles: PushupAngles,
  history: PushupState['angleHistory'],
  prevSmoothed: SmoothedPushupAngles | null
): SmoothedPushupAngles {
  const keys: (keyof PushupAngles)[] = ['elbow', 'bodyAlignment', 'hipDeviation', 'headSpine'];
  const result: Partial<SmoothedPushupAngles> = {};

  for (const key of keys) {
    const value = rawAngles[key];
    if (isNaN(value)) {
      result[key] = prevSmoothed?.[key] ?? NaN;
      continue;
    }

    // Update circular buffer
    history[key].push(value);
    if (history[key].length > MEDIAN_WINDOW) {
      history[key].shift();
    }

    // Median filter
    const medianValue = median(history[key]);

    // EMA
    const prev = prevSmoothed?.[key];
    result[key] =
      prev !== undefined && !isNaN(prev)
        ? EMA_ALPHA * medianValue + (1 - EMA_ALPHA) * prev
        : medianValue;
  }

  return result as SmoothedPushupAngles;
}

// ============================================================================
// FSM LOGIC
// ============================================================================

interface FSMUpdateResult {
  fsm: PushupFSM;
  repCompleted: boolean;
  partialRep: boolean;
}

function updateFSM(
  currentFSM: PushupFSM,
  elbowAngle: number,
  t: number,
  bodyAlignment: number,
  torsoInclination: number | null
): FSMUpdateResult {
  const fsm = { ...currentFSM };
  let repCompleted = false;
  let partialRep = false;

  switch (fsm.phase) {
    case 'IDLE': {
      const armsExtended = elbowAngle > THRESHOLDS.PLANK_REENTER;
      const bodyAligned =
        bodyAlignment >= THRESHOLDS.PLANK_BODY_MIN &&
        bodyAlignment <= THRESHOLDS.PLANK_BODY_MAX;
      const torsoHorizontal =
        torsoInclination !== null &&
        torsoInclination >= THRESHOLDS.TORSO_INCLINE_MIN &&
        torsoInclination <= THRESHOLDS.TORSO_INCLINE_MAX;

      if (armsExtended && bodyAligned && torsoHorizontal) {
        if (fsm.tIdleStableSince === null) {
          fsm.tIdleStableSince = t;
        } else if (t - fsm.tIdleStableSince >= THRESHOLDS.PLANK_HOLD_TIME) {
          fsm.phase = 'PLANK';
          fsm.tIdleStableSince = null;
        }
      } else {
        fsm.tIdleStableSince = null;
      }
      break;
    }

    case 'PLANK':
      if (elbowAngle < THRESHOLDS.DESCENDING_ENTER) {
        fsm.phase = 'DESCENDING';
        fsm.tRepStart = t;
        fsm.tBottom = null;
        fsm.tRepEnd = null;
      }
      break;

    case 'DESCENDING':
      if (elbowAngle < THRESHOLDS.BOTTOM_ENTER) {
        fsm.phase = 'BOTTOM';
        fsm.tBottom = t;
      } else if (
        elbowAngle > THRESHOLDS.PARTIAL_REP_RESET &&
        fsm.tRepStart !== null &&
        t - fsm.tRepStart >= THRESHOLDS.MIN_DESCENDING_TIME
      ) {
        // Returned to extension without reaching depth — partial rep
        // (debounced: must have been descending for MIN_DESCENDING_TIME to avoid
        //  flip-flopping when the user hovers near the DESCENDING_ENTER threshold)
        fsm.phase = 'PLANK';
        partialRep = true;
        fsm.tRepStart = null;
      }
      break;

    case 'BOTTOM':
      if (elbowAngle > THRESHOLDS.BOTTOM_EXIT) {
        fsm.phase = 'ASCENDING';
      }
      break;

    case 'ASCENDING':
      if (
        elbowAngle > THRESHOLDS.PLANK_REENTER &&
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
 * Each category: min(cap, scale × max(0, x − deadzone)²)
 */
function computePushupRepScore(repWindow: PushupRepWindow): number {
  let penalty = 0;

  // 1. Depth shortfall — lower minElbow is better (closer to 90°)
  //    At 90°: 0, at 95°: 0.75, at 100°: 3, at 105°: 6.75, at 110°: 12
  const depthExcess = Math.max(0, repWindow.minElbow - SCORE_CURVES.DEPTH.deadzone);
  penalty += Math.min(SCORE_CURVES.DEPTH.cap, SCORE_CURVES.DEPTH.scale * depthExcess * depthExcess);

  // 2. Lockout shortfall — higher maxElbow is better (closer to 170°+)
  //    At 165°+: 0, at 160°: 2.5, at 155°: 10, at 150°: 22.5
  const lockoutShortfall = Math.max(0, SCORE_CURVES.LOCKOUT.ideal - repWindow.maxElbow);
  penalty += Math.min(SCORE_CURVES.LOCKOUT.cap, SCORE_CURVES.LOCKOUT.scale * lockoutShortfall * lockoutShortfall);

  // 3. Hip alignment — body should be ~180° (straight line)
  //    Deadzone: ±8° from 180° (172–188° is fine)
  //    Sag (minBodyAngle < 172) and pike (maxBodyAngle > 188) measured independently;
  //    worst direction drives the penalty.
  const sagDev = Math.max(0, (SCORE_CURVES.HIP.neutral - SCORE_CURVES.HIP.deadzone) - repWindow.minBodyAngle);
  const pikeDev = Math.max(0, repWindow.maxBodyAngle - (SCORE_CURVES.HIP.neutral + SCORE_CURVES.HIP.deadzone));
  const worstHipDev = Math.max(sagDev, pikeDev);
  penalty += Math.min(SCORE_CURVES.HIP.cap, SCORE_CURVES.HIP.scale * worstHipDev * worstHipDev);

  // 4. Tempo — too fast in either direction
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
 * These are independent of the continuous score — a rep can score 92 and
 * still surface an actionable message.
 */
function generateFormMessages(repWindow: PushupRepWindow): string[] {
  const messages: string[] = [];

  // 1. Depth
  if (repWindow.minElbow > FORM_THRESHOLDS.DEPTH_FAIL) {
    messages.push('Go deeper \u2014 aim for elbows at 90 degrees.');
  }

  // 2. Lockout
  if (repWindow.maxElbow < FORM_THRESHOLDS.LOCKOUT_FAIL) {
    messages.push('Lock out your arms fully at the top.');
  }

  // 3. ROM (only if depth and lockout didn't already flag)
  const rom = repWindow.maxElbow - repWindow.minElbow;
  if (rom < FORM_THRESHOLDS.ROM_MIN && messages.length === 0) {
    messages.push('Incomplete rep \u2014 full range of motion from lockout to 90 degrees.');
  }

  // 4. Hip alignment — dual metric cross-check
  const minBody = repWindow.minBodyAngle;
  const maxBody = repWindow.maxBodyAngle;
  const minDev = repWindow.minHipDev;
  const maxDev = repWindow.maxHipDev;

  if (minBody < FORM_THRESHOLDS.HIP_SAG_FAIL && maxDev > FORM_THRESHOLDS.HIP_DEV_SAG_FAIL) {
    messages.push('Hips are sagging \u2014 engage your core to maintain a straight line.');
  } else if (minBody < FORM_THRESHOLDS.HIP_SAG_WARN && maxDev > FORM_THRESHOLDS.HIP_DEV_SAG_WARN) {
    messages.push('Keep your hips up \u2014 your body line is dropping.');
  }

  if (maxBody > FORM_THRESHOLDS.HIP_PIKE_FAIL && minDev < -FORM_THRESHOLDS.HIP_DEV_PIKE_FAIL) {
    messages.push('Hips are piking up \u2014 lower them to maintain a straight plank.');
  } else if (maxBody > FORM_THRESHOLDS.HIP_PIKE_WARN && minDev < -FORM_THRESHOLDS.HIP_DEV_PIKE_WARN) {
    messages.push('Hips are riding high \u2014 aim for a straight body line.');
  }

  // 5. Tempo
  if (repWindow.tBottom !== null) {
    const tEccentric = repWindow.tBottom - repWindow.tStart;
    const tConcentric = repWindow.tEnd - repWindow.tBottom;

    if (tConcentric > 0 && tConcentric < FORM_THRESHOLDS.TEMPO_CONCENTRIC_MIN) {
      messages.push('Slow down the push \u2014 control the movement.');
    }
    if (tEccentric > 0 && tEccentric < FORM_THRESHOLDS.TEMPO_ECCENTRIC_MIN) {
      messages.push('Control the descent \u2014 don\'t drop into the pushup.');
    }
  }

  return messages;
}

/**
 * Evaluate a completed pushup rep.
 * - `score`: continuous quadratic penalty curves (small errors → small drops)
 * - `messages`: discrete threshold-based feedback (actionable coaching cues)
 * The two systems are independent per CLAUDE.md §13.
 */
function evaluateForm(
  repWindow: PushupRepWindow
): { score: number; messages: string[] } {
  const score = computePushupRepScore(repWindow);
  const messages = generateFormMessages(repWindow);
  return { score, messages };
}

// ============================================================================
// UPDATE LOGIC
// ============================================================================

export function updatePushupState(
  keypoints: Keypoint[],
  currentState: PushupState
): PushupState {
  const t = Date.now() / 1000;

  // Update visible side periodically (every ~30 frames via side check)
  const visibleSide = selectVisibleSide(keypoints);

  // Calculate raw angles using the more visible side
  const rawAngles = calculatePushupAngles(keypoints, visibleSide);
  if (!rawAngles) {
    return { ...currentState, displayAngles: null, visibleSide };
  }

  // Apply smoothing
  const smoothed = applySmoothing(rawAngles, currentState.angleHistory, currentState.smoothed);

  const newState: PushupState = {
    ...currentState,
    smoothed,
    displayAngles: smoothed,
    visibleSide,
  };

  // Skip FSM if elbow angle is NaN
  if (isNaN(smoothed.elbow)) {
    return newState;
  }

  // Compute torso inclination for IDLE gate (uses raw keypoints, not smoothed —
  // the 1s hold timer provides sufficient noise filtering)
  const torsoInclination = calculateTorsoInclination(keypoints, visibleSide);
  newState.lastTorsoInclination = torsoInclination;

  // Update FSM
  const fsmResult = updateFSM(currentState.fsm, smoothed.elbow, t, smoothed.bodyAlignment, torsoInclination);
  newState.fsm = fsmResult.fsm;

  // Handle partial rep — still counts but flags shallow depth
  if (fsmResult.partialRep) {
    newState.repCount++;
    newState.feedback = 'Go deeper \u2014 try to hit 90 degrees.';
    newState.lastFeedbackTime = t;
    newState.repWindow = null;
    return newState;
  }

  // Track rep window while actively in a rep (not PLANK or IDLE)
  const inRep = newState.fsm.phase !== 'PLANK' && newState.fsm.phase !== 'IDLE';
  if (inRep && !currentState.repWindow) {
    newState.repWindow = initRepWindow(t);
  }

  if (newState.repWindow && inRep) {
    const window = newState.repWindow;
    window.tEnd = t;
    window.frameCount++;

    // Update min/max for all angles
    if (!isNaN(smoothed.elbow)) {
      window.minElbow = Math.min(window.minElbow, smoothed.elbow);
      window.maxElbow = Math.max(window.maxElbow, smoothed.elbow);
    }
    if (!isNaN(smoothed.bodyAlignment)) {
      window.minBodyAngle = Math.min(window.minBodyAngle, smoothed.bodyAlignment);
      window.maxBodyAngle = Math.max(window.maxBodyAngle, smoothed.bodyAlignment);
    }
    if (!isNaN(smoothed.hipDeviation)) {
      window.minHipDev = Math.min(window.minHipDev, smoothed.hipDeviation);
      window.maxHipDev = Math.max(window.maxHipDev, smoothed.hipDeviation);
    }
    if (!isNaN(smoothed.headSpine)) {
      window.minHeadSpine = Math.min(window.minHeadSpine, smoothed.headSpine);
      window.maxHeadSpine = Math.max(window.maxHeadSpine, smoothed.headSpine);
    }

    // Record bottom timestamp
    if (newState.fsm.phase === 'BOTTOM' && window.tBottom === null) {
      window.tBottom = t;
    }
  }

  // Rep completed
  if (fsmResult.repCompleted && newState.repWindow) {
    newState.repCount++;

    const rom = newState.repWindow.maxElbow - newState.repWindow.minElbow;
    const tDown = newState.repWindow.tBottom
      ? newState.repWindow.tBottom - newState.repWindow.tStart
      : 0;
    const tUp = newState.repWindow.tBottom
      ? newState.repWindow.tEnd - newState.repWindow.tBottom
      : 0;

    const { score, messages } = evaluateForm(newState.repWindow);

    newState.lastRepResult = {
      repIndex: newState.repCount,
      rom,
      tDown,
      tUp,
      score,
      messages,
    };

    if (messages.length > 0) {
      newState.feedback = messages.join('\n');
    } else {
      newState.feedback = 'Great rep!';
    }
    newState.lastFeedbackTime = t;

    // Reset rep window and FSM timestamps (skip IDLE — gate only applies at start)
    newState.repWindow = null;
    newState.fsm = resetFSMToPlank();
  }

  // Clear feedback after 2 seconds
  if (newState.feedback && t - newState.lastFeedbackTime > 2.0) {
    newState.feedback = null;
  }

  return newState;
}

// ============================================================================
// UI HELPERS
// ============================================================================

export function getPushupRepCount(state: PushupState): number {
  return state.repCount;
}

export function getPushupFormScore(state: PushupState): number {
  return state.lastRepResult?.score ?? 0;
}

export function getPushupFeedback(state: PushupState): string | null {
  return state.feedback;
}

/** Debug info for on-screen pushup diagnostics */
export interface PushupDebugInfo {
  phase: PushupPhase;
  side: 'left' | 'right';
  elbow: number | null;
  bodyAlignment: number | null;
  hipDev: number | null;
  headSpine: number | null;
  /** Torso inclination from vertical (0°=standing, 90°=plank) */
  torsoInclination: number | null;
  // Rep window deltas (min/max during current rep)
  elbowMin: number | null;
  elbowMax: number | null;
  bodyAngleMin: number | null;
  bodyAngleMax: number | null;
  hipDevMin: number | null;
  hipDevMax: number | null;
  headSpineMin: number | null;
  headSpineMax: number | null;
}

export function getPushupDebugInfo(state: PushupState): PushupDebugInfo {
  const angles = state.displayAngles;
  const window = state.repWindow;
  const fmt = (v: number | undefined): number | null =>
    v !== undefined && !isNaN(v) && isFinite(v) ? v : null;
  const fmtW = (min: number, max: number): number | null =>
    min !== Infinity && max !== -Infinity ? fmt(min) ?? fmt(max) : null;

  return {
    phase: state.fsm.phase,
    side: state.visibleSide,
    elbow: fmt(angles?.elbow),
    bodyAlignment: fmt(angles?.bodyAlignment),
    hipDev: fmt(angles?.hipDeviation),
    headSpine: fmt(angles?.headSpine),
    torsoInclination: fmt(state.lastTorsoInclination ?? undefined),
    elbowMin: window ? fmtW(window.minElbow, window.maxElbow) && fmt(window.minElbow) : null,
    elbowMax: window ? fmtW(window.minElbow, window.maxElbow) && fmt(window.maxElbow) : null,
    bodyAngleMin: window ? fmtW(window.minBodyAngle, window.maxBodyAngle) && fmt(window.minBodyAngle) : null,
    bodyAngleMax: window ? fmtW(window.minBodyAngle, window.maxBodyAngle) && fmt(window.maxBodyAngle) : null,
    hipDevMin: window ? fmtW(window.minHipDev, window.maxHipDev) && fmt(window.minHipDev) : null,
    hipDevMax: window ? fmtW(window.minHipDev, window.maxHipDev) && fmt(window.maxHipDev) : null,
    headSpineMin: window ? fmtW(window.minHeadSpine, window.maxHeadSpine) && fmt(window.minHeadSpine) : null,
    headSpineMax: window ? fmtW(window.minHeadSpine, window.maxHeadSpine) && fmt(window.maxHeadSpine) : null,
  };
}
