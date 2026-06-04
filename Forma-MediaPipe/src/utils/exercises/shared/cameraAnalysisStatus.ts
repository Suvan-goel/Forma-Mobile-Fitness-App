import {
  getPoseQualityMessage,
  type PoseQualitySnapshot,
  type PoseQualityWarning,
} from './poseQuality';

export type CameraAnalysisStatusLevel = 'good' | 'info' | 'warning' | 'error';

export type CameraAnalysisStatusCategory =
  | 'tracking'
  | 'framing'
  | 'exerciseSetup'
  | 'view'
  | 'feedbackAvailability'
  | 'occlusion'
  | 'countOnly';

export type CameraAnalysisStatusSource =
  | 'poseQuality'
  | 'exercise'
  | 'poseState'
  | 'viewCueGating'
  | 'completedRep'
  | 'global';

export type CameraAnalysisFeedbackMode = 'full' | 'limited' | 'countOnly' | 'unavailable';

export interface CameraAnalysisStatus {
  level: CameraAnalysisStatusLevel;
  category: CameraAnalysisStatusCategory;
  message: string;
  priority: number;
  source: CameraAnalysisStatusSource;
  reason?: string;
  details?: {
    feedbackMode?: CameraAnalysisFeedbackMode;
    safeCueFamilies?: string[];
    blockedCueFamilies?: string[];
    weakChains?: string[];
    usableChains?: string[];
    viewRequired?: string;
    viewCurrent?: string;
  };
}

export interface CameraAnalysisStatusResolution {
  selected: CameraAnalysisStatus | null;
  candidates: CameraAnalysisStatus[];
}

export interface ResolveCameraAnalysisStatusInput {
  poseQuality?: PoseQualitySnapshot | null;
  exerciseWarnings?: PoseQualityWarning[];
  exerciseStatus?: CameraAnalysisStatus | null;
  poseStateStatus?: CameraAnalysisStatus | null;
  viewCueGatingStatus?: CameraAnalysisStatus | null;
  additionalStatuses?: Array<CameraAnalysisStatus | null | undefined>;
}

type ViewCueGatingLike = {
  viewBlockedCueFamilies?: string[];
  poseStateBlockedCueFamilies?: string[];
  finalSafeCueFamilies?: string[];
  finalUnsafeCueFamilies?: string[];
  finalScorableReason?: string;
  finalUnscorableReason?: string;
  sideViewGatePassed?: boolean;
  frontViewGatePassed?: boolean;
  partialViewScoringAllowed?: boolean;
};

type ReliabilityLike = {
  scoreabilityCandidate?: string;
  usableChains?: string[];
  weakChains?: string[];
  safeCueFamilies?: string[];
  unsafeCueFamilies?: string[];
};

type CompletedRepReadinessLike = {
  scorable?: boolean;
  diagnostics?: {
    scorable?: boolean;
    view?: string;
    reliability?: ReliabilityLike | null;
    viewCueGating?: ViewCueGatingLike | null;
  } | null;
};

export interface RecentCompletedRepCameraStatusState {
  status: CameraAnalysisStatus | null;
  updatedAt: number;
  expiresAt: number;
  fullReadinessFrameCount: number;
};

export const CAMERA_ANALYSIS_STATUS_PRIORITY = {
  TRACKING_LOST: 1000,
  FRAMING_UNUSABLE: 920,
  OCCLUSION_UNUSABLE: 880,
  TRACKING_UNCERTAIN: 820,
  COUNT_ONLY: 790,
  LIMITED_FEEDBACK: 780,
  EXERCISE_VIEW_BLOCKING: 760,
  SOME_CUES_UNAVAILABLE: 480,
  FULL_FEEDBACK: 140,
  TRACKING_OKAY: 120,
  TRACKING_GOOD: 100,
} as const;

export const RECENT_COMPLETED_REP_CAMERA_STATUS_HOLD_MS = 1800;
export const RECENT_COMPLETED_REP_FULL_READINESS_CLEAR_FRAMES = 3;

const FRAMING_WARNINGS = new Set<PoseQualityWarning>([
  'move_camera_back',
  'move_camera_closer',
  'keep_full_body_in_frame',
  'keep_key_joints_in_frame',
]);

const OCCLUSION_WARNINGS = new Set<PoseQualityWarning>([
  'missing_required_joints',
  'knees_hidden',
  'feet_hidden',
  'arms_hidden',
  'torso_hidden',
]);

const VIEW_WARNINGS = new Set<PoseQualityWarning>([
  'side_view_uncertain',
  'front_view_uncertain',
  'view_uncertain',
]);

const SOFT_GENERIC_POSE_WARNINGS = new Set<PoseQualityWarning>([
  'keep_key_joints_in_frame',
  'missing_required_joints',
]);

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isFullFeedbackStatus(status?: CameraAnalysisStatus | null): boolean {
  return status?.details?.feedbackMode === 'full';
}

function shouldUseKeyJointMessage(
  reliability?: ReliabilityLike | null,
  reason?: string,
): boolean {
  if (reliability?.scoreabilityCandidate === 'notScoreable') return true;
  if ((reliability?.weakChains?.length ?? 0) > 0) return true;
  if (!reason) return false;
  return (
    reason.includes('reliability') ||
    reason.includes('unreliable') ||
    reason.includes('pose_state') ||
    reason.includes('tracking_quality') ||
    reason.includes('not_scoreable')
  );
}

function exerciseStatusAllowsUsefulFeedback(status?: CameraAnalysisStatus | null): boolean {
  const mode = status?.details?.feedbackMode;
  return mode === 'full' || mode === 'limited';
}

function shouldSuppressPoseQualityWarning(
  warning: PoseQualityWarning,
  exerciseStatus?: CameraAnalysisStatus | null,
): boolean {
  return SOFT_GENERIC_POSE_WARNINGS.has(warning) && exerciseStatusAllowsUsefulFeedback(exerciseStatus);
}

function messageForWarning(warning: PoseQualityWarning): string {
  return getPoseQualityMessage({
    status: warning === 'tracking_lost' ? 'lost' : 'medium',
    warnings: [warning],
  });
}

export function cameraStatusFromPoseQualityWarning(
  warning: PoseQualityWarning,
  source: CameraAnalysisStatusSource = 'poseQuality',
): CameraAnalysisStatus {
  if (warning === 'tracking_lost') {
    return {
      level: 'error',
      category: 'tracking',
      message: messageForWarning(warning),
      priority: CAMERA_ANALYSIS_STATUS_PRIORITY.TRACKING_LOST,
      source,
      reason: warning,
      details: { feedbackMode: 'unavailable' },
    };
  }

  if (FRAMING_WARNINGS.has(warning)) {
    return {
      level: 'warning',
      category: 'framing',
      message: messageForWarning(warning),
      priority: CAMERA_ANALYSIS_STATUS_PRIORITY.FRAMING_UNUSABLE,
      source,
      reason: warning,
      details: { feedbackMode: 'unavailable' },
    };
  }

  if (OCCLUSION_WARNINGS.has(warning)) {
    return {
      level: 'warning',
      category: 'occlusion',
      message: messageForWarning(warning),
      priority: CAMERA_ANALYSIS_STATUS_PRIORITY.OCCLUSION_UNUSABLE,
      source,
      reason: warning,
      details: { feedbackMode: 'countOnly' },
    };
  }

  if (VIEW_WARNINGS.has(warning)) {
    return {
      level: 'warning',
      category: 'view',
      message: messageForWarning(warning),
      priority: CAMERA_ANALYSIS_STATUS_PRIORITY.EXERCISE_VIEW_BLOCKING,
      source,
      reason: warning,
      details: {
        feedbackMode: 'countOnly',
        viewRequired: warning === 'front_view_uncertain' ? 'front' : warning === 'side_view_uncertain' ? 'side' : undefined,
      },
    };
  }

  return {
    level: 'warning',
    category: 'tracking',
    message: messageForWarning(warning),
    priority: CAMERA_ANALYSIS_STATUS_PRIORITY.COUNT_ONLY,
    source,
    reason: warning,
    details: { feedbackMode: 'limited' },
  };
}

export function cameraStatusFromPoseQuality(snapshot: PoseQualitySnapshot): CameraAnalysisStatus {
  if (snapshot.status === 'lost') {
    return {
      level: 'error',
      category: 'tracking',
      message: getPoseQualityMessage(snapshot),
      priority: CAMERA_ANALYSIS_STATUS_PRIORITY.TRACKING_LOST,
      source: 'poseQuality',
      reason: 'tracking_lost',
      details: { feedbackMode: 'unavailable' },
    };
  }

  if (snapshot.status === 'low') {
    return {
      level: 'warning',
      category: 'tracking',
      message: getPoseQualityMessage(snapshot),
      priority: CAMERA_ANALYSIS_STATUS_PRIORITY.TRACKING_UNCERTAIN,
      source: 'poseQuality',
      reason: 'tracking_uncertain',
      details: { feedbackMode: 'countOnly' },
    };
  }

  if (snapshot.status === 'medium') {
    return {
      level: 'info',
      category: 'tracking',
      message: getPoseQualityMessage(snapshot),
      priority: CAMERA_ANALYSIS_STATUS_PRIORITY.TRACKING_OKAY,
      source: 'poseQuality',
      reason: 'tracking_okay',
      details: { feedbackMode: 'limited' },
    };
  }

  return {
    level: 'good',
    category: 'tracking',
    message: getPoseQualityMessage(snapshot),
    priority: CAMERA_ANALYSIS_STATUS_PRIORITY.TRACKING_GOOD,
    source: 'poseQuality',
    reason: 'tracking_good',
    details: { feedbackMode: 'full' },
  };
}

export function fullFeedbackCameraStatus(
  source: CameraAnalysisStatusSource = 'exercise',
  reason = 'full_feedback_available',
): CameraAnalysisStatus {
  return {
    level: 'good',
    category: 'feedbackAvailability',
    message: 'Full feedback available',
    priority: CAMERA_ANALYSIS_STATUS_PRIORITY.FULL_FEEDBACK,
    source,
    reason,
    details: { feedbackMode: 'full' },
  };
}

export function limitedFeedbackCameraStatus(args: {
  message?: string;
  source?: CameraAnalysisStatusSource;
  reason?: string;
  priority?: number;
  details?: CameraAnalysisStatus['details'];
} = {}): CameraAnalysisStatus {
  return {
    level: 'info',
    category: 'feedbackAvailability',
    message: args.message ?? 'Limited feedback - adjust angle for full analysis',
    priority: args.priority ?? CAMERA_ANALYSIS_STATUS_PRIORITY.LIMITED_FEEDBACK,
    source: args.source ?? 'exercise',
    reason: args.reason ?? 'limited_feedback',
    details: {
      feedbackMode: 'limited',
      ...args.details,
    },
  };
}

export function countOnlyCameraStatus(args: {
  message?: string;
  source?: CameraAnalysisStatusSource;
  reason?: string;
  details?: CameraAnalysisStatus['details'];
} = {}): CameraAnalysisStatus {
  return {
    level: 'warning',
    category: 'countOnly',
    message: args.message ?? 'Count only - improve camera angle for form feedback',
    priority: CAMERA_ANALYSIS_STATUS_PRIORITY.COUNT_ONLY,
    source: args.source ?? 'exercise',
    reason: args.reason ?? 'count_only',
    details: {
      feedbackMode: 'countOnly',
      ...args.details,
    },
  };
}

export function cameraStatusFromViewCueGating(args: {
  viewCueGating?: ViewCueGatingLike | null;
  reliability?: ReliabilityLike | null;
  viewRequired?: 'front' | 'side';
  viewCurrent?: string;
  source?: CameraAnalysisStatusSource;
}): CameraAnalysisStatus | null {
  const { viewCueGating, reliability, viewRequired, viewCurrent, source = 'viewCueGating' } = args;
  if (!viewCueGating) return null;

  const blockedCueFamilies = uniqueStrings([
    ...(viewCueGating.viewBlockedCueFamilies ?? []),
    ...(viewCueGating.poseStateBlockedCueFamilies ?? []),
  ]);
  const details = {
    feedbackMode: 'full' as CameraAnalysisFeedbackMode,
    safeCueFamilies: viewCueGating.finalSafeCueFamilies ?? [],
    blockedCueFamilies,
    weakChains: reliability?.weakChains ?? [],
    usableChains: reliability?.usableChains ?? [],
    viewRequired,
    viewCurrent,
  };

  if (viewCueGating.finalUnscorableReason) {
    const reason = viewCueGating.finalUnscorableReason;
    const reliabilityBlocked = reason.includes('reliability') || reason.includes('unreliable');
    return countOnlyCameraStatus({
      source,
      reason,
      message: reliabilityBlocked
        ? 'Count only - keep key joints visible'
        : 'Count only - improve camera angle for form feedback',
      details: {
        ...details,
        feedbackMode: 'countOnly',
      },
    });
  }

  if (viewCueGating.partialViewScoringAllowed) {
    return limitedFeedbackCameraStatus({
      source,
      reason: viewCueGating.finalScorableReason ?? 'partial_view_scoring',
      details: {
        ...details,
        feedbackMode: 'limited',
      },
    });
  }

  if (blockedCueFamilies.length > 0) {
    return limitedFeedbackCameraStatus({
      source,
      reason: 'cue_families_unavailable',
      message: (viewCueGating.poseStateBlockedCueFamilies?.length ?? 0) > 0
        ? 'Limited feedback - keep key joints visible'
        : 'Limited feedback - some cues unavailable',
      priority: CAMERA_ANALYSIS_STATUS_PRIORITY.SOME_CUES_UNAVAILABLE,
      details: {
        ...details,
        feedbackMode: 'limited',
      },
    });
  }

  return {
    ...fullFeedbackCameraStatus(source, viewCueGating.finalScorableReason ?? 'full_feedback_available'),
    details,
  };
}

export function cameraStatusFromCompletedRepReadiness(args: {
  repResult?: CompletedRepReadinessLike | null;
  trackingQualityScorable?: boolean;
  source?: CameraAnalysisStatusSource;
}): CameraAnalysisStatus | null {
  const { repResult, source = 'completedRep' } = args;
  if (!repResult) return null;

  const diagnostics = repResult.diagnostics ?? null;
  const reliability = diagnostics?.reliability ?? null;
  const viewCueGating = diagnostics?.viewCueGating ?? null;
  const blockedCueFamilies = uniqueStrings([
    ...(viewCueGating?.viewBlockedCueFamilies ?? []),
    ...(viewCueGating?.poseStateBlockedCueFamilies ?? []),
    ...(reliability?.unsafeCueFamilies ?? []),
  ]);
  const details = {
    feedbackMode: 'full' as CameraAnalysisFeedbackMode,
    safeCueFamilies: viewCueGating?.finalSafeCueFamilies ?? reliability?.safeCueFamilies ?? [],
    blockedCueFamilies,
    weakChains: reliability?.weakChains ?? [],
    usableChains: reliability?.usableChains ?? [],
    viewCurrent: diagnostics?.view,
  };
  const finalUnscorableReason = viewCueGating?.finalUnscorableReason;
  const repMarkedUnscorable = repResult.scorable === false || diagnostics?.scorable === false;
  const trackingMarkedUnscorable = args.trackingQualityScorable === false;
  const reliabilityNotScoreable = reliability?.scoreabilityCandidate === 'notScoreable';

  if (finalUnscorableReason || repMarkedUnscorable || trackingMarkedUnscorable || reliabilityNotScoreable) {
    const reason = finalUnscorableReason
      ?? (reliabilityNotScoreable
        ? 'pose_reliability_not_scoreable'
        : trackingMarkedUnscorable
          ? 'completed_rep_tracking_quality_unscorable'
          : 'completed_rep_unscorable');
    return countOnlyCameraStatus({
      source,
      reason,
      message: shouldUseKeyJointMessage(reliability, reason)
        ? 'Count only - keep key joints visible'
        : 'Count only - improve camera angle for form feedback',
      details: {
        ...details,
        feedbackMode: 'countOnly',
      },
    });
  }

  if (
    reliability?.scoreabilityCandidate === 'partiallyScoreable' ||
    viewCueGating?.partialViewScoringAllowed === true
  ) {
    const reason = reliability?.scoreabilityCandidate === 'partiallyScoreable'
      ? 'completed_rep_partial_reliability'
      : viewCueGating?.finalScorableReason ?? 'completed_rep_partial_view_scoring';
    return limitedFeedbackCameraStatus({
      source,
      reason,
      message: shouldUseKeyJointMessage(reliability, reason)
        ? 'Limited feedback - keep key joints visible'
        : 'Limited feedback - adjust angle for full analysis',
      details: {
        ...details,
        feedbackMode: 'limited',
      },
    });
  }

  if (blockedCueFamilies.length > 0) {
    return limitedFeedbackCameraStatus({
      source,
      reason: 'completed_rep_some_cues_unavailable',
      message: (viewCueGating?.poseStateBlockedCueFamilies?.length ?? 0) > 0
        ? 'Limited feedback - keep key joints visible'
        : 'Limited feedback - some cues unavailable',
      priority: CAMERA_ANALYSIS_STATUS_PRIORITY.SOME_CUES_UNAVAILABLE,
      details: {
        ...details,
        feedbackMode: 'limited',
      },
    });
  }

  if (
    reliability?.scoreabilityCandidate === 'fullyScoreable' ||
    viewCueGating?.finalScorableReason
  ) {
    return {
      ...fullFeedbackCameraStatus(source, viewCueGating?.finalScorableReason ?? 'completed_rep_full_feedback'),
      details,
    };
  }

  return null;
}

export function createRecentCompletedRepCameraStatusState(): RecentCompletedRepCameraStatusState {
  return {
    status: null,
    updatedAt: 0,
    expiresAt: 0,
    fullReadinessFrameCount: 0,
  };
}

export function recentCompletedRepCameraStatus(
  state: RecentCompletedRepCameraStatusState,
  nowMs: number,
): CameraAnalysisStatus | null {
  if (!state.status) return null;
  if (nowMs > state.expiresAt) return null;
  return state.status;
}

export function updateRecentCompletedRepCameraStatusState(
  state: RecentCompletedRepCameraStatusState,
  args: {
    nowMs: number;
    completedRepStatus?: CameraAnalysisStatus | null;
    currentReadinessStatus?: CameraAnalysisStatus | null;
    holdMs?: number;
    fullReadinessClearFrames?: number;
  },
): RecentCompletedRepCameraStatusState {
  const holdMs = args.holdMs ?? RECENT_COMPLETED_REP_CAMERA_STATUS_HOLD_MS;
  const fullReadinessClearFrames = args.fullReadinessClearFrames
    ?? RECENT_COMPLETED_REP_FULL_READINESS_CLEAR_FRAMES;
  const completedRepMode = args.completedRepStatus?.details?.feedbackMode;

  if (completedRepMode === 'limited' || completedRepMode === 'countOnly' || completedRepMode === 'unavailable') {
    return {
      status: args.completedRepStatus ?? null,
      updatedAt: args.nowMs,
      expiresAt: args.nowMs + holdMs,
      fullReadinessFrameCount: 0,
    };
  }

  if (completedRepMode === 'full') {
    return createRecentCompletedRepCameraStatusState();
  }

  if (!state.status || args.nowMs > state.expiresAt) {
    return createRecentCompletedRepCameraStatusState();
  }

  const fullReadinessFrameCount = isFullFeedbackStatus(args.currentReadinessStatus)
    ? state.fullReadinessFrameCount + 1
    : 0;

  if (fullReadinessFrameCount >= fullReadinessClearFrames) {
    return createRecentCompletedRepCameraStatusState();
  }

  return {
    ...state,
    fullReadinessFrameCount,
  };
}

export function selectCameraAnalysisStatus(
  statuses: Array<CameraAnalysisStatus | null | undefined>,
): CameraAnalysisStatus | null {
  const candidates = statuses.filter((status): status is CameraAnalysisStatus => Boolean(status));
  if (candidates.length === 0) return null;
  return candidates
    .map((status, index) => ({ status, index }))
    .sort((a, b) => {
      const priorityDelta = b.status.priority - a.status.priority;
      if (priorityDelta !== 0) return priorityDelta;
      return a.index - b.index;
    })[0].status;
}

export function resolveCameraAnalysisStatus(
  input: ResolveCameraAnalysisStatusInput,
): CameraAnalysisStatusResolution {
  const candidates: CameraAnalysisStatus[] = [];

  if (input.poseQuality) {
    for (const warning of input.poseQuality.warnings) {
      if (shouldSuppressPoseQualityWarning(warning, input.exerciseStatus)) continue;
      candidates.push(cameraStatusFromPoseQualityWarning(warning, 'poseQuality'));
    }
    candidates.push(cameraStatusFromPoseQuality(input.poseQuality));
  }

  for (const warning of input.exerciseWarnings ?? []) {
    candidates.push(cameraStatusFromPoseQualityWarning(warning, 'exercise'));
  }

  for (const status of [
    input.exerciseStatus,
    input.poseStateStatus,
    input.viewCueGatingStatus,
    ...(input.additionalStatuses ?? []),
  ]) {
    if (status) candidates.push(status);
  }

  return {
    selected: selectCameraAnalysisStatus(candidates),
    candidates,
  };
}
