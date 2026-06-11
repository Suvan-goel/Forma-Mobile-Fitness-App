import {
  countOnlyCameraStatus,
  fullFeedbackCameraStatus,
  limitedFeedbackCameraStatus,
  type CameraAnalysisFeedbackMode,
  type CameraAnalysisStatus,
  type CameraAnalysisStatusSource,
} from './cameraAnalysisStatus';
import type { RepReliabilityInterpretation } from './reliabilityInterpretation';

type ReliabilityReadiness = Pick<
  RepReliabilityInterpretation,
  | 'countabilityCandidate'
  | 'scoreabilityCandidate'
  | 'safeCueFamilies'
  | 'unsafeCueFamilies'
  | 'weakChains'
  | 'usableChains'
>;

interface ExerciseFeedbackReadinessStatusArgs {
  source?: CameraAnalysisStatusSource;
  reliability?: ReliabilityReadiness | null;
  viewReady?: boolean | null;
  viewRequired?: string;
  viewCurrent?: string;
  scorable?: boolean | null;
  fullReason: string;
  limitedReason?: string;
  limitedMessage?: string;
  countOnlyReason?: string;
  countOnlyMessage?: string;
  viewBlockedReason?: string;
  viewBlockedMessage?: string;
}

function readinessDetails(
  mode: CameraAnalysisFeedbackMode,
  args: ExerciseFeedbackReadinessStatusArgs,
): CameraAnalysisStatus['details'] {
  return {
    feedbackMode: mode,
    safeCueFamilies: args.reliability?.safeCueFamilies ?? [],
    blockedCueFamilies: args.reliability?.unsafeCueFamilies ?? [],
    weakChains: args.reliability?.weakChains ?? [],
    usableChains: args.reliability?.usableChains ?? [],
    viewRequired: args.viewRequired,
    viewCurrent: args.viewCurrent,
  };
}

export function cameraStatusFromExerciseFeedbackReadiness(
  args: ExerciseFeedbackReadinessStatusArgs,
): CameraAnalysisStatus {
  const source = args.source ?? 'exercise';

  if (args.viewReady === false) {
    return countOnlyCameraStatus({
      source,
      reason: args.viewBlockedReason ?? 'exercise_view_not_ready',
      message: args.viewBlockedMessage ?? 'Count only - improve camera angle for form feedback',
      details: readinessDetails('countOnly', args),
    });
  }

  if (
    args.scorable === false ||
    args.reliability?.countabilityCandidate === 'notCountable' ||
    args.reliability?.scoreabilityCandidate === 'notScoreable'
  ) {
    return countOnlyCameraStatus({
      source,
      reason: args.countOnlyReason ?? 'pose_reliability_not_scoreable',
      message: args.countOnlyMessage ?? 'Count only - keep key joints visible',
      details: readinessDetails('countOnly', args),
    });
  }

  if (args.reliability?.scoreabilityCandidate === 'partiallyScoreable') {
    return limitedFeedbackCameraStatus({
      source,
      reason: args.limitedReason ?? 'pose_reliability_partially_scoreable',
      message: args.limitedMessage ?? 'Limited feedback - keep key joints visible',
      details: readinessDetails('limited', args),
    });
  }

  return {
    ...fullFeedbackCameraStatus(source, args.fullReason),
    details: readinessDetails('full', args),
  };
}
