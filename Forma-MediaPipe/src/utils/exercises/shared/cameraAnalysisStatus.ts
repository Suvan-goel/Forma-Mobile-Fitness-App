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
  usableChains?: string[];
  weakChains?: string[];
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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
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
