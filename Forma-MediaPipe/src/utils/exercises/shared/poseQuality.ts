import type { Keypoint } from '../../poseAnalysis';
import type { ExerciseDefinition } from '../types';

export const POSE_QUALITY_LATENCY_TARGET_MS = 2;

export type PoseQualityStatus = 'high' | 'medium' | 'low' | 'lost';

export type PoseQualityWarning =
  | 'tracking_lost'
  | 'missing_required_joints'
  | 'knees_hidden'
  | 'feet_hidden'
  | 'arms_hidden'
  | 'torso_hidden'
  | 'move_camera_back'
  | 'move_camera_closer'
  | 'keep_full_body_in_frame'
  | 'keep_key_joints_in_frame'
  | 'side_view_uncertain'
  | 'front_view_uncertain'
  | 'view_uncertain'
  | 'unstable_tracking';

export interface RequiredJointGroup {
  id: string;
  label: string;
  joints: string[];
}

export interface ExerciseQualityProfile {
  exerciseName?: string;
  requiredView: 'front' | 'side' | 'any';
  requiredJoints?: string[];
  requiredJointGroups?: RequiredJointGroup[];
  importantJoints?: string[];
  framingScope?: 'full_body' | 'key_joints';
  framingJoints?: string[];
  tooSmallBoxThreshold?: number;
  minRequiredVisibility?: number;
  minImportantVisibility?: number;
  windowSize?: number;
}

export interface PoseQualitySnapshot {
  status: PoseQualityStatus;
  confidence: number;
  rawConfidence: number;
  visibilityConfidence: number;
  stabilityConfidence: number;
  dropoutRate: number;
  jitter: number;
  missingRequiredJoints: string[];
  warnings: PoseQualityWarning[];
  message: string;
  canJudgeForm: boolean;
  canScoreRep: boolean;
  sampleCount: number;
  lowConfidenceFrameCount: number;
  selectedGroupId?: string;
  evaluationDurationMs?: number;
}

export interface RepTrackingQuality {
  status: PoseQualityStatus;
  confidence: number;
  scorable: boolean;
  totalFrames: number;
  lowConfidenceFrames: number;
  warnings: PoseQualityWarning[];
  message: string;
}

export interface SetTrackingQualitySummary {
  status: PoseQualityStatus;
  confidence: number;
  totalReps: number;
  scoredReps: number;
  unscoredReps: number;
  warnings: PoseQualityWarning[];
  message: string;
}

interface FrameQuality {
  confidence: number;
  visibilityConfidence: number;
  jitter: number;
  warnings: PoseQualityWarning[];
  missingRequiredJoints: string[];
  selectedGroupId?: string;
}

export interface PoseQualityTrackerOptions {
  frameBoundsKeypoints?: Keypoint[];
}

export interface RepQualityWindowState {
  repCount: number;
  repQualityWindowActive?: boolean;
}

export const UNSCORED_REP_FEEDBACK = "I couldn't judge your form there.";

const DEFAULT_MIN_REQUIRED_VISIBILITY = 0.22;
const DEFAULT_MIN_IMPORTANT_VISIBILITY = 0.16;
const DEFAULT_WINDOW_SIZE = 15;
const JITTER_WARNING_THRESHOLD = 0.16;
const LOW_REP_FRAME_RATE_LIMIT = 0.4;
const DEFAULT_TOO_SMALL_BOX_THRESHOLD = 0.18;

const SIDE_CHAIN_LEFT = ['left_shoulder', 'left_elbow', 'left_wrist', 'left_hip'];
const SIDE_CHAIN_RIGHT = ['right_shoulder', 'right_elbow', 'right_wrist', 'right_hip'];
const LOWER_CHAIN_LEFT = ['left_hip', 'left_knee', 'left_ankle'];
const LOWER_CHAIN_RIGHT = ['right_hip', 'right_knee', 'right_ankle'];
const PUSHUP_SIDE_LEFT = ['left_shoulder', 'left_elbow', 'left_wrist', 'left_hip', 'left_ankle'];
const PUSHUP_SIDE_RIGHT = ['right_shoulder', 'right_elbow', 'right_wrist', 'right_hip', 'right_ankle'];

const DEFAULT_FRONT_PROFILE: ExerciseQualityProfile = {
  requiredView: 'front',
  requiredJoints: [
    'left_shoulder',
    'right_shoulder',
    'left_elbow',
    'right_elbow',
    'left_wrist',
    'right_wrist',
    'left_hip',
    'right_hip',
  ],
  importantJoints: ['left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
};

const DEFAULT_SIDE_PROFILE: ExerciseQualityProfile = {
  requiredView: 'side',
  requiredJointGroups: [
    { id: 'left_side', label: 'left side', joints: SIDE_CHAIN_LEFT },
    { id: 'right_side', label: 'right side', joints: SIDE_CHAIN_RIGHT },
  ],
  importantJoints: ['left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
};

const EXERCISE_QUALITY_PROFILES: Record<string, ExerciseQualityProfile> = {
  'Barbell Curl': {
    ...DEFAULT_FRONT_PROFILE,
    exerciseName: 'Barbell Curl',
    framingScope: 'key_joints',
  },
  'Standing Dumbbell Lateral Raises': {
    ...DEFAULT_FRONT_PROFILE,
    exerciseName: 'Standing Dumbbell Lateral Raises',
    framingScope: 'key_joints',
  },
  'Barbell Squat': {
    requiredView: 'any',
    exerciseName: 'Barbell Squat',
    framingScope: 'full_body',
    requiredJointGroups: [
      { id: 'left_side', label: 'left side', joints: ['left_shoulder', ...LOWER_CHAIN_LEFT] },
      { id: 'right_side', label: 'right side', joints: ['right_shoulder', ...LOWER_CHAIN_RIGHT] },
      {
        id: 'front_bilateral',
        label: 'front bilateral',
        joints: [
          'left_shoulder',
          'right_shoulder',
          'left_hip',
          'right_hip',
          'left_knee',
          'right_knee',
          'left_ankle',
          'right_ankle',
        ],
      },
    ],
    importantJoints: ['left_heel', 'right_heel', 'left_foot_index', 'right_foot_index'],
  },
  'Push-Up': {
    requiredView: 'side',
    exerciseName: 'Push-Up',
    framingScope: 'full_body',
    requiredJointGroups: [
      { id: 'left_side', label: 'left side', joints: PUSHUP_SIDE_LEFT },
      { id: 'right_side', label: 'right side', joints: PUSHUP_SIDE_RIGHT },
    ],
  },
  'Leg Extensions': {
    requiredView: 'side',
    exerciseName: 'Leg Extensions',
    framingScope: 'key_joints',
    requiredJointGroups: [
      { id: 'left_leg', label: 'left leg', joints: ['left_shoulder', ...LOWER_CHAIN_LEFT] },
      { id: 'right_leg', label: 'right leg', joints: ['right_shoulder', ...LOWER_CHAIN_RIGHT] },
    ],
    importantJoints: ['left_ankle', 'right_ankle'],
  },
  'Lying Leg Curl': {
    requiredView: 'side',
    exerciseName: 'Lying Leg Curl',
    framingScope: 'key_joints',
    requiredJointGroups: [
      { id: 'left_leg', label: 'left leg', joints: ['left_hip', 'left_knee'] },
      { id: 'right_leg', label: 'right leg', joints: ['right_hip', 'right_knee'] },
    ],
    importantJoints: [
      'left_shoulder',
      'right_shoulder',
      'left_ankle',
      'right_ankle',
      'left_heel',
      'right_heel',
      'left_foot_index',
      'right_foot_index',
    ],
  },
  'Machine Ab Crunches': {
    requiredView: 'side',
    exerciseName: 'Machine Ab Crunches',
    framingScope: 'key_joints',
    requiredJointGroups: [
      { id: 'left_side', label: 'left side', joints: ['left_shoulder', 'left_hip', 'left_knee'] },
      { id: 'right_side', label: 'right side', joints: ['right_shoulder', 'right_hip', 'right_knee'] },
    ],
    importantJoints: ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  },
  'Cable Pushdowns': {
    ...DEFAULT_SIDE_PROFILE,
    exerciseName: 'Cable Pushdowns',
    framingScope: 'key_joints',
  },
  'Cable Row': {
    ...DEFAULT_SIDE_PROFILE,
    exerciseName: 'Cable Row',
    framingScope: 'key_joints',
  },
  'Cable Lat Pulldowns': {
    ...DEFAULT_SIDE_PROFILE,
    exerciseName: 'Cable Lat Pulldowns',
    framingScope: 'key_joints',
  },
};

const WARNING_MESSAGES: Record<PoseQualityWarning, string> = {
  tracking_lost: 'Tracking was lost.',
  missing_required_joints: 'Ensure your key joints are clearly visible.',
  knees_hidden: 'Keep your knees visible.',
  feet_hidden: 'Keep your feet inside the frame.',
  arms_hidden: 'Keep your arms visible.',
  torso_hidden: 'Keep your torso visible.',
  move_camera_back: 'Move the camera back.',
  move_camera_closer: 'Move the camera closer.',
  keep_full_body_in_frame: 'Keep your full body inside the frame.',
  keep_key_joints_in_frame: 'Keep your key joints inside the frame.',
  side_view_uncertain: 'Turn side-on so I can judge your form.',
  front_view_uncertain: 'Face the camera so I can judge your form.',
  view_uncertain: 'Use a clear side or front view so I can judge your squat.',
  unstable_tracking: 'Hold steady.',
};

const ACTIONABLE_WARNING_PRIORITY: PoseQualityWarning[] = [
  'tracking_lost',
  'move_camera_back',
  'move_camera_closer',
  'keep_full_body_in_frame',
  'keep_key_joints_in_frame',
  'side_view_uncertain',
  'front_view_uncertain',
  'view_uncertain',
  'missing_required_joints',
  'knees_hidden',
  'feet_hidden',
  'arms_hidden',
  'torso_hidden',
  'unstable_tracking',
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function getKeypointMap(keypoints: Keypoint[]): Map<string, Keypoint> {
  const map = new Map<string, Keypoint>();
  for (const keypoint of keypoints) {
    if (keypoint?.name) map.set(keypoint.name, keypoint);
  }
  return map;
}

function keypointVisibility(map: Map<string, Keypoint>, name: string): number {
  return clamp01(map.get(name)?.score ?? 0);
}

function getRequiredGroups(profile: ExerciseQualityProfile): RequiredJointGroup[] {
  if (profile.requiredJointGroups && profile.requiredJointGroups.length > 0) {
    return profile.requiredJointGroups;
  }
  return [{
    id: 'required',
    label: 'required joints',
    joints: profile.requiredJoints ?? DEFAULT_FRONT_PROFILE.requiredJoints ?? [],
  }];
}

function selectBestRequiredGroup(
  map: Map<string, Keypoint>,
  groups: RequiredJointGroup[],
): RequiredJointGroup {
  let bestGroup = groups[0];
  let bestScore = -1;
  for (const group of groups) {
    const score = average(group.joints.map((joint) => keypointVisibility(map, joint)));
    if (score > bestScore) {
      bestGroup = group;
      bestScore = score;
    }
  }
  return bestGroup;
}

function warningForMissingJoints(missing: string[]): PoseQualityWarning[] {
  const warnings = new Set<PoseQualityWarning>();
  if (missing.length > 0) warnings.add('missing_required_joints');
  if (missing.some((joint) => joint.includes('_knee'))) warnings.add('knees_hidden');
  if (missing.some((joint) => joint.includes('_ankle') || joint.includes('_heel') || joint.includes('_foot'))) {
    warnings.add('feet_hidden');
  }
  if (missing.some((joint) => joint.includes('_elbow') || joint.includes('_wrist') || joint.includes('_shoulder'))) {
    warnings.add('arms_hidden');
  }
  if (missing.some((joint) => joint.includes('_hip') || joint.includes('_shoulder'))) {
    warnings.add('torso_hidden');
  }
  return Array.from(warnings);
}

function looksLikeNormalizedImageCoordinates(keypoints: Keypoint[]): boolean {
  const visible = keypoints.filter((keypoint) => keypoint.score > 0.2);
  if (visible.length < 8) return false;
  return visible.every((keypoint) => (
    keypoint.x >= -0.05 &&
    keypoint.x <= 1.05 &&
    keypoint.y >= -0.05 &&
    keypoint.y <= 1.05
  ));
}

function keypointsForFraming(
  keypoints: Keypoint[],
  profile: ExerciseQualityProfile,
  selectedGroup: RequiredJointGroup,
): Keypoint[] {
  const visible = keypoints.filter((keypoint) => keypoint.score > 0.2);
  if ((profile.framingScope ?? 'full_body') === 'full_body') return visible;

  const keypointMap = getKeypointMap(keypoints);
  const framingJoints = profile.framingJoints && profile.framingJoints.length > 0
    ? profile.framingJoints
    : Array.from(new Set([
        ...selectedGroup.joints,
        ...(profile.importantJoints ?? []),
      ]));

  return framingJoints
    .map((joint) => keypointMap.get(joint))
    .filter((keypoint): keypoint is Keypoint => Boolean(keypoint && keypoint.score > 0.2));
}

function frameBoundsWarnings(
  keypoints: Keypoint[],
  profile: ExerciseQualityProfile,
  selectedGroup: RequiredJointGroup,
): PoseQualityWarning[] {
  if (!looksLikeNormalizedImageCoordinates(keypoints)) return [];
  const framingScope = profile.framingScope ?? 'full_body';
  const visible = keypointsForFraming(keypoints, profile, selectedGroup);
  if (visible.length === 0) return [];

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const keypoint of visible) {
    minX = Math.min(minX, keypoint.x);
    minY = Math.min(minY, keypoint.y);
    maxX = Math.max(maxX, keypoint.x);
    maxY = Math.max(maxY, keypoint.y);
  }

  const warnings = new Set<PoseQualityWarning>();
  if (minX < 0.03 || maxX > 0.97 || minY < 0.03 || maxY > 0.97) {
    warnings.add(framingScope === 'key_joints' ? 'keep_key_joints_in_frame' : 'keep_full_body_in_frame');
  }
  if (maxX - minX > 0.86 || maxY - minY > 0.92) {
    warnings.add('move_camera_back');
  }
  const boxSize = Math.max(maxX - minX, maxY - minY);
  const tooSmallBoxThreshold = profile.tooSmallBoxThreshold ?? DEFAULT_TOO_SMALL_BOX_THRESHOLD;
  if (boxSize < tooSmallBoxThreshold) {
    warnings.add('move_camera_closer');
  }
  return Array.from(warnings);
}

function mostCommonWarnings(frames: FrameQuality[], minimumRatio: number): PoseQualityWarning[] {
  const counts = new Map<PoseQualityWarning, number>();
  for (const frame of frames) {
    for (const warning of frame.warnings) {
      counts.set(warning, (counts.get(warning) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count / frames.length >= minimumRatio)
    .sort((a, b) => b[1] - a[1])
    .map(([warning]) => warning);
}

function selectStatus(confidence: number, dropoutRate: number, jitter: number): PoseQualityStatus {
  if (confidence < 0.16 || dropoutRate >= 0.7) return 'lost';
  if (confidence >= 0.76 && dropoutRate <= 0.12 && jitter < JITTER_WARNING_THRESHOLD) return 'high';
  if (confidence >= 0.55 && dropoutRate <= 0.35) return 'medium';
  return 'low';
}

function frameQuality(
  keypoints: Keypoint[],
  profile: ExerciseQualityProfile,
  previousPositions: Map<string, { x: number; y: number; z: number }>,
  frameBoundsKeypoints?: Keypoint[],
): FrameQuality {
  if (keypoints.length === 0) {
    return {
      confidence: 0,
      visibilityConfidence: 0,
      jitter: 0,
      warnings: ['tracking_lost'],
      missingRequiredJoints: [],
    };
  }

  const map = getKeypointMap(keypoints);
  const minRequiredVisibility = profile.minRequiredVisibility ?? DEFAULT_MIN_REQUIRED_VISIBILITY;
  const minImportantVisibility = profile.minImportantVisibility ?? DEFAULT_MIN_IMPORTANT_VISIBILITY;
  const group = selectBestRequiredGroup(map, getRequiredGroups(profile));
  const requiredVisibilities = group.joints.map((joint) => keypointVisibility(map, joint));
  const missingRequiredJoints = group.joints.filter(
    (joint, index) => requiredVisibilities[index] < minRequiredVisibility,
  );
  const requiredCoverage = group.joints.length === 0
    ? 0
    : (group.joints.length - missingRequiredJoints.length) / group.joints.length;
  const requiredVisibility = average(requiredVisibilities);

  const importantJoints = profile.importantJoints ?? [];
  const importantVisibility = importantJoints.length > 0
    ? average(importantJoints.map((joint) => keypointVisibility(map, joint)))
    : requiredVisibility;
  const importantCoverage = importantJoints.length > 0
    ? importantJoints.filter((joint) => keypointVisibility(map, joint) >= minImportantVisibility).length / importantJoints.length
    : 1;

  const warnings = new Set<PoseQualityWarning>(warningForMissingJoints(missingRequiredJoints));
  for (const warning of frameBoundsWarnings(frameBoundsKeypoints ?? keypoints, profile, group)) warnings.add(warning);

  const trackedJoints = Array.from(new Set([...group.joints, ...importantJoints]));
  const displacements: number[] = [];
  for (const joint of trackedJoints) {
    const keypoint = map.get(joint);
    if (!keypoint || keypoint.score < minImportantVisibility) continue;
    const previous = previousPositions.get(joint);
    const current = { x: keypoint.x, y: keypoint.y, z: keypoint.z ?? 0 };
    if (previous) {
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      const dz = current.z - previous.z;
      displacements.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    previousPositions.set(joint, current);
  }

  const jitter = displacements.length > 0 ? average(displacements) : 0;
  if (jitter >= JITTER_WARNING_THRESHOLD) warnings.add('unstable_tracking');

  const visibilityConfidence = clamp01(
    requiredVisibility * 0.62 +
    requiredCoverage * 0.28 +
    importantVisibility * 0.07 +
    importantCoverage * 0.03,
  );
  const jitterPenalty = Math.min(0.22, jitter / JITTER_WARNING_THRESHOLD * 0.16);
  let confidence = clamp01(visibilityConfidence - jitterPenalty);
  if (missingRequiredJoints.length > 0) {
    confidence = Math.min(confidence, requiredCoverage * 0.7);
  }

  return {
    confidence,
    visibilityConfidence,
    jitter,
    warnings: Array.from(warnings),
    missingRequiredJoints,
    selectedGroupId: group.id,
  };
}

export function getPoseQualityMessage(snapshot: Pick<PoseQualitySnapshot | RepTrackingQuality | SetTrackingQualitySummary, 'status' | 'warnings'>): string {
  for (const warning of ACTIONABLE_WARNING_PRIORITY) {
    if (snapshot.warnings.includes(warning)) return WARNING_MESSAGES[warning];
  }
  if (snapshot.status === 'high') return 'Tracking good';
  const firstWarning = snapshot.warnings[0];
  if (firstWarning) return WARNING_MESSAGES[firstWarning];
  if (snapshot.status === 'medium') return 'Tracking okay';
  if (snapshot.status === 'low') return 'Tracking uncertain';
  return 'Tracking was lost.';
}

function uniqueWarnings(warnings: PoseQualityWarning[]): PoseQualityWarning[] {
  return Array.from(new Set(warnings));
}

function hasActionableWarning(warnings: PoseQualityWarning[]): boolean {
  return warnings.some((warning) => ACTIONABLE_WARNING_PRIORITY.includes(warning));
}

export function buildDisplayedPoseQuality(
  baseQuality: PoseQualitySnapshot,
  additionalWarnings: PoseQualityWarning[] = [],
): PoseQualitySnapshot {
  const warnings = uniqueWarnings([...baseQuality.warnings, ...additionalWarnings]);
  const status =
    baseQuality.status === 'high' && hasActionableWarning(warnings)
      ? 'medium'
      : baseQuality.status;

  const displayed: PoseQualitySnapshot = {
    ...baseQuality,
    status,
    warnings,
    message: '',
    canJudgeForm: status === 'high' || status === 'medium',
    canScoreRep: status === 'high' || status === 'medium',
  };
  displayed.message = getPoseQualityMessage(displayed);
  return displayed;
}

export function getUnscoredRepFeedback(repQuality: Pick<RepTrackingQuality, 'status' | 'warnings'>): string {
  const reason = getPoseQualityMessage(repQuality);
  const detail = (!reason || reason === 'Tracking good' || reason === 'Tracking okay' || reason === 'Tracking uncertain')
    ? WARNING_MESSAGES.missing_required_joints
    : reason;
  return `${UNSCORED_REP_FEEDBACK} ${detail}`;
}

export function getPoseQualityStatusLabel(status: PoseQualityStatus): string {
  if (status === 'high') return 'High';
  if (status === 'medium') return 'Medium';
  if (status === 'low') return 'Low';
  return 'Lost';
}

export function resolveExerciseQualityProfile(definition: ExerciseDefinition): ExerciseQualityProfile {
  const explicitProfile = definition.qualityProfile;
  if (explicitProfile) {
    return {
      ...explicitProfile,
      exerciseName: explicitProfile.exerciseName ?? definition.name,
      requiredView: explicitProfile.requiredView ?? definition.requiredView,
    };
  }

  const override = EXERCISE_QUALITY_PROFILES[definition.name];
  if (override) return override;

  if (definition.requiredView === 'side') {
    return { ...DEFAULT_SIDE_PROFILE, exerciseName: definition.name, requiredView: definition.requiredView };
  }
  if (definition.requiredView === 'front') {
    return { ...DEFAULT_FRONT_PROFILE, exerciseName: definition.name, requiredView: definition.requiredView };
  }
  return {
    exerciseName: definition.name,
    requiredView: 'any',
    requiredJointGroups: [
      { id: 'left_side', label: 'left side', joints: SIDE_CHAIN_LEFT },
      { id: 'right_side', label: 'right side', joints: SIDE_CHAIN_RIGHT },
    ],
    importantJoints: ['left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
  };
}

export class PoseQualityTracker {
  private frames: FrameQuality[] = [];
  private previousPositions = new Map<string, { x: number; y: number; z: number }>();
  private consecutiveLowFrames = 0;

  reset(): void {
    this.frames = [];
    this.previousPositions.clear();
    this.consecutiveLowFrames = 0;
  }

  update(
    keypoints: Keypoint[],
    profile: ExerciseQualityProfile,
    options?: PoseQualityTrackerOptions,
  ): PoseQualitySnapshot {
    const startedAt = Date.now();
    const activeProfile = {
      ...profile,
      windowSize: profile.windowSize ?? DEFAULT_WINDOW_SIZE,
    };
    const frame = frameQuality(
      keypoints,
      activeProfile,
      this.previousPositions,
      options?.frameBoundsKeypoints,
    );
    this.frames.push(frame);
    if (this.frames.length > activeProfile.windowSize!) this.frames.shift();

    const confidenceBeforeStability = average(this.frames.map((sample) => sample.confidence));
    const visibilityConfidence = average(this.frames.map((sample) => sample.visibilityConfidence));
    const jitter = average(this.frames.map((sample) => sample.jitter));
    const dropoutRate = this.frames.filter((sample) => sample.confidence < 0.16).length / this.frames.length;
    const stabilityConfidence = clamp01(1 - dropoutRate * 0.65 - Math.min(0.35, jitter / JITTER_WARNING_THRESHOLD * 0.22));
    const confidence = clamp01(confidenceBeforeStability * 0.82 + stabilityConfidence * 0.18);
    const missingRequiredRate = this.frames.filter((sample) => sample.missingRequiredJoints.length > 0).length / this.frames.length;
    let status = selectStatus(confidence, dropoutRate, jitter);
    if (missingRequiredRate >= 0.45 && status === 'medium') status = 'low';

    if (status === 'low' || status === 'lost') this.consecutiveLowFrames += 1;
    else this.consecutiveLowFrames = 0;

    const warnings = status === 'lost'
      ? Array.from(new Set<PoseQualityWarning>(['tracking_lost', ...mostCommonWarnings(this.frames, 0.25)]))
      : mostCommonWarnings(this.frames, 0.3);
    if (status === 'low' && warnings.length === 0) warnings.push('missing_required_joints');
    if (jitter >= JITTER_WARNING_THRESHOLD && !warnings.includes('unstable_tracking')) {
      warnings.push('unstable_tracking');
    }

    const endedAt = Date.now();
    const snapshot: PoseQualitySnapshot = {
      status,
      confidence,
      rawConfidence: confidenceBeforeStability,
      visibilityConfidence,
      stabilityConfidence,
      dropoutRate,
      jitter,
      missingRequiredJoints: Array.from(new Set(this.frames.flatMap((sample) => sample.missingRequiredJoints))),
      warnings,
      message: '',
      canJudgeForm: status === 'high' || status === 'medium',
      canScoreRep: status === 'high' || status === 'medium',
      sampleCount: this.frames.length,
      lowConfidenceFrameCount: this.consecutiveLowFrames,
      selectedGroupId: frame.selectedGroupId,
      evaluationDurationMs: endedAt - startedAt,
    };
    snapshot.message = getPoseQualityMessage(snapshot);
    return snapshot;
  }
}

export class RepQualityAccumulator {
  private samples: PoseQualitySnapshot[] = [];

  record(snapshot: PoseQualitySnapshot): void {
    this.samples.push(snapshot);
  }

  reset(): void {
    this.samples = [];
  }

  consume(): RepTrackingQuality {
    const summary = summarizeRepQuality(this.samples);
    this.reset();
    return summary;
  }
}

export class RepQualityWindowAccumulator {
  private readonly accumulator = new RepQualityAccumulator();
  private previousActive = false;
  private previousRepCount = 0;

  reset(repCount = 0): void {
    this.accumulator.reset();
    this.previousActive = false;
    this.previousRepCount = repCount;
  }

  recordFrame(snapshot: PoseQualitySnapshot, state: RepQualityWindowState): RepTrackingQuality | null {
    const completedRep = state.repCount > this.previousRepCount;
    const hasExplicitWindow = state.repQualityWindowActive !== undefined;
    const active = state.repQualityWindowActive ?? true;

    if (!hasExplicitWindow || active || completedRep) {
      this.accumulator.record(snapshot);
    }

    let completedQuality: RepTrackingQuality | null = null;
    if (completedRep) {
      completedQuality = this.accumulator.consume();
    } else if (hasExplicitWindow && this.previousActive && !active) {
      this.accumulator.reset();
    }

    this.previousActive = hasExplicitWindow ? active : false;
    this.previousRepCount = state.repCount;
    return completedQuality;
  }
}

export function summarizeRepQuality(samples: PoseQualitySnapshot[]): RepTrackingQuality {
  if (samples.length === 0) {
    return {
      status: 'lost',
      confidence: 0,
      scorable: false,
      totalFrames: 0,
      lowConfidenceFrames: 0,
      warnings: ['tracking_lost'],
      message: WARNING_MESSAGES.tracking_lost,
    };
  }

  const confidence = average(samples.map((sample) => sample.confidence));
  const lowConfidenceFrames = samples.filter((sample) => sample.status === 'low' || sample.status === 'lost').length;
  const lostFrames = samples.filter((sample) => sample.status === 'lost').length;
  const lowRate = lowConfidenceFrames / samples.length;
  const lostRate = lostFrames / samples.length;
  const warnings = mostCommonSnapshotWarnings(samples, 0.2);
  let status = selectStatus(
    confidence,
    lostRate,
    average(samples.map((sample) => sample.jitter)),
  );
  if (lowRate > LOW_REP_FRAME_RATE_LIMIT && status !== 'lost') status = 'low';
  if (lostRate > 0.45) status = 'lost';

  const scorable = (status === 'high' || status === 'medium') && lowRate <= LOW_REP_FRAME_RATE_LIMIT && lostRate <= 0.25;
  const summary: RepTrackingQuality = {
    status,
    confidence,
    scorable,
    totalFrames: samples.length,
    lowConfidenceFrames,
    warnings: scorable ? warnings : (warnings.length > 0 ? warnings : ['missing_required_joints']),
    message: '',
  };
  summary.message = scorable ? getPoseQualityMessage(summary) : `Tracking uncertain - ${getPoseQualityMessage(summary).toLowerCase()}`;
  return summary;
}

function mostCommonSnapshotWarnings(samples: Array<{ warnings: PoseQualityWarning[] }>, minimumRatio: number): PoseQualityWarning[] {
  const counts = new Map<PoseQualityWarning, number>();
  for (const sample of samples) {
    for (const warning of sample.warnings) {
      counts.set(warning, (counts.get(warning) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count / samples.length >= minimumRatio)
    .sort((a, b) => b[1] - a[1])
    .map(([warning]) => warning);
}

export function summarizeSetTrackingQuality(reps: RepTrackingQuality[]): SetTrackingQualitySummary {
  if (reps.length === 0) {
    return {
      status: 'lost',
      confidence: 0,
      totalReps: 0,
      scoredReps: 0,
      unscoredReps: 0,
      warnings: [],
      message: 'No tracking data',
    };
  }

  const confidence = average(reps.map((rep) => rep.confidence));
  const scoredReps = reps.filter((rep) => rep.scorable).length;
  const unscoredReps = reps.length - scoredReps;
  const unscoredRate = unscoredReps / reps.length;
  let status = selectStatus(confidence, unscoredRate, 0);
  if (unscoredRate > 0.5) status = 'low';
  if (unscoredRate === 1) status = 'lost';
  const warnings = mostCommonSnapshotWarnings(reps, 0.15);
  const label = getPoseQualityStatusLabel(status);
  const message = unscoredReps > 0
    ? `Tracking quality: ${label}. Form score based on ${scoredReps} of ${reps.length} reps.`
    : `Tracking quality: ${label}`;

  return {
    status,
    confidence,
    totalReps: reps.length,
    scoredReps,
    unscoredReps,
    warnings,
    message,
  };
}
