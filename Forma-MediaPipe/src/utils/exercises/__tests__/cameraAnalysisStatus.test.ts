import {
  cameraLiveFeedbackReadinessStatus,
  cameraStatusFromCompletedRepReadiness,
  cameraStatusFromPoseStateReadiness,
  countOnlyCameraStatus,
  createCameraLiveFeedbackReadinessState,
  createRecentCompletedRepCameraStatusState,
  fullFeedbackCameraStatus,
  limitedFeedbackCameraStatus,
  recentCompletedRepCameraStatus,
  resolveCameraAnalysisStatus,
  selectCameraAnalysisStatus,
  shouldIncludeRecentCompletedRepCameraStatus,
  cameraStatusFromViewCueGating,
  updateCameraLiveFeedbackReadinessState,
  updateRecentCompletedRepCameraStatusState,
  type CameraAnalysisStatus,
} from '../shared/cameraAnalysisStatus';
import type { PoseQualitySnapshot, PoseQualityWarning } from '../shared/poseQuality';

function qualitySnapshot(
  status: PoseQualitySnapshot['status'],
  warnings: PoseQualityWarning[] = [],
): PoseQualitySnapshot {
  const confidence = status === 'high' ? 0.92 : status === 'medium' ? 0.68 : status === 'low' ? 0.3 : 0;
  return {
    status,
    confidence,
    rawConfidence: confidence,
    visibilityConfidence: confidence,
    stabilityConfidence: confidence,
    dropoutRate: status === 'lost' ? 1 : 0,
    jitter: 0,
    missingRequiredJoints: [],
    warnings,
    message: '',
    canJudgeForm: status === 'high' || status === 'medium',
    canScoreRep: status === 'high' || status === 'medium',
    sampleCount: 12,
    lowConfidenceFrameCount: status === 'low' || status === 'lost' ? 12 : 0,
  };
}

function poseStateReadiness(chains: Record<string, string>) {
  return {
    status: 'tracked',
    chains: Object.fromEntries(
      Object.entries(chains).map(([name, status]) => [name, { status }]),
    ),
  };
}

function appendLiveReadinessSamples(
  statuses: CameraAnalysisStatus[],
  timestamps: number[],
) {
  let state = createCameraLiveFeedbackReadinessState();
  for (let i = 0; i < statuses.length; i++) {
    state = updateCameraLiveFeedbackReadinessState(state, {
      nowMs: timestamps[i],
      sampleStatus: statuses[i],
    });
  }
  return state;
}

describe('CameraAnalysisStatus resolver', () => {
  it('lets tracking lost override every other status', () => {
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('lost', ['tracking_lost']),
      exerciseStatus: fullFeedbackCameraStatus('exercise'),
    });

    expect(result.selected?.message).toBe('Tracking was lost.');
    expect(result.selected?.source).toBe('poseQuality');
    expect(result.selected?.level).toBe('error');
  });

  it('lets framing warnings override limited feedback', () => {
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high', ['move_camera_back']),
      exerciseStatus: limitedFeedbackCameraStatus(),
    });

    expect(result.selected?.message).toBe('Move the camera back.');
    expect(result.selected?.category).toBe('framing');
  });

  it('lets view and scoring warnings override tracking good', () => {
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high'),
      exerciseWarnings: ['side_view_uncertain'],
    });

    expect(result.selected?.message).toBe('Turn side-on so I can judge your form.');
    expect(result.selected?.source).toBe('exercise');
  });

  it('shows limited feedback when cue gating allows partial scoring', () => {
    const partialStatus = cameraStatusFromViewCueGating({
      viewRequired: 'side',
      viewCueGating: {
        finalSafeCueFamilies: ['rangeOfMotion', 'tempo'],
        finalUnsafeCueFamilies: ['bilateralGeometry'],
        viewBlockedCueFamilies: ['bilateralGeometry'],
        poseStateBlockedCueFamilies: [],
        finalScorableReason: 'partial_view_scoring',
        sideViewGatePassed: false,
        partialViewScoringAllowed: true,
      },
    });
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high'),
      exerciseWarnings: ['side_view_uncertain'],
      exerciseStatus: partialStatus,
    });

    expect(result.selected?.message).toBe('Limited feedback - adjust angle for full analysis');
    expect(result.selected?.details?.feedbackMode).toBe('limited');
  });

  it('does not let soft generic key-joint warnings override useful exercise feedback', () => {
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high', ['keep_key_joints_in_frame']),
      exerciseStatus: fullFeedbackCameraStatus('exercise'),
    });

    expect(result.selected?.message).toBe('Full feedback available');
    expect(result.selected?.source).toBe('exercise');
  });

  it('does not let soft missing-joint warnings override limited exercise feedback', () => {
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('medium', ['missing_required_joints']),
      exerciseStatus: limitedFeedbackCameraStatus({
        reason: 'partial_view_scoring',
      }),
    });

    expect(result.selected?.message).toBe('Limited feedback - adjust angle for full analysis');
    expect(result.selected?.details?.feedbackMode).toBe('limited');
  });

  it('lets invalid subject tracking override limited or full feedback', () => {
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high'),
      exerciseStatus: limitedFeedbackCameraStatus(),
      poseStateStatus: {
        level: 'error',
        category: 'tracking',
        message: 'Tracking was lost.',
        priority: 1000,
        source: 'poseState',
        reason: 'invalid_subject_collapsed_torso',
        details: { feedbackMode: 'unavailable' },
      },
    });

    expect(result.selected?.message).toBe('Tracking was lost.');
    expect(result.selected?.source).toBe('poseState');
  });

  it('shows tracking good only when no higher-priority issue exists', () => {
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high'),
    });

    expect(result.selected?.message).toBe('Tracking good');
    expect(result.selected?.priority).toBeLessThan(200);
  });

  it('keeps stable order when priorities tie', () => {
    const first: CameraAnalysisStatus = {
      level: 'info',
      category: 'feedbackAvailability',
      message: 'First status',
      priority: 10,
      source: 'exercise',
    };
    const second: CameraAnalysisStatus = {
      ...first,
      message: 'Second status',
    };

    expect(selectCameraAnalysisStatus([first, second])?.message).toBe('First status');
  });

  it('summarizes Cable Row partial view scoring as limited feedback', () => {
    const status = cameraStatusFromViewCueGating({
      viewRequired: 'side',
      viewCueGating: {
        finalSafeCueFamilies: ['rangeOfMotion'],
        finalUnsafeCueFamilies: ['bilateralGeometry'],
        viewBlockedCueFamilies: ['bilateralGeometry'],
        poseStateBlockedCueFamilies: [],
        finalScorableReason: 'partial_view_scoring',
        sideViewGatePassed: false,
        partialViewScoringAllowed: true,
      },
    });

    expect(status?.message).toBe('Limited feedback - adjust angle for full analysis');
    expect(status?.details?.safeCueFamilies).toContain('rangeOfMotion');
    expect(status?.details?.blockedCueFamilies).toContain('bilateralGeometry');
  });

  it('summarizes Lateral Raise oblique partial feedback with front view context', () => {
    const status = cameraStatusFromViewCueGating({
      viewRequired: 'front',
      viewCurrent: 'oblique',
      viewCueGating: {
        finalSafeCueFamilies: ['armHeight', 'tempo'],
        finalUnsafeCueFamilies: ['symmetry'],
        viewBlockedCueFamilies: ['symmetry'],
        poseStateBlockedCueFamilies: [],
        finalScorableReason: 'partial_view_scoring',
        frontViewGatePassed: false,
        partialViewScoringAllowed: true,
      },
    });

    expect(status?.message).toBe('Limited feedback - adjust angle for full analysis');
    expect(status?.details?.viewRequired).toBe('front');
    expect(status?.details?.viewCurrent).toBe('oblique');
  });

  it('uses count-only messaging for unscorable cue gating', () => {
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high'),
      exerciseStatus: countOnlyCameraStatus({
        reason: 'side_view_uncertain',
      }),
    });

    expect(result.selected?.message).toBe('Count only - improve camera angle for form feedback');
    expect(result.selected?.details?.feedbackMode).toBe('countOnly');
  });

  it('summarizes completed partially scoreable reps as recent limited feedback', () => {
    const status = cameraStatusFromCompletedRepReadiness({
      repResult: {
        scorable: true,
        diagnostics: {
          scorable: true,
          reliability: {
            scoreabilityCandidate: 'partiallyScoreable',
            usableChains: ['leftArm'],
            weakChains: ['rightArm'],
            safeCueFamilies: ['rangeOfMotion'],
            unsafeCueFamilies: ['bilateralGeometry'],
          },
        },
      },
    });

    expect(status?.source).toBe('completedRep');
    expect(status?.message).toBe('Limited feedback - keep key joints visible');
    expect(status?.details?.feedbackMode).toBe('limited');
    expect(status?.details?.weakChains).toContain('rightArm');
    expect(status?.details?.blockedCueFamilies).toContain('bilateralGeometry');
  });

  it('summarizes completed not-scoreable reps as recent count-only feedback', () => {
    const status = cameraStatusFromCompletedRepReadiness({
      repResult: {
        scorable: false,
        diagnostics: {
          scorable: false,
          reliability: {
            scoreabilityCandidate: 'notScoreable',
            usableChains: [],
            weakChains: ['leftArm', 'rightArm'],
            safeCueFamilies: [],
            unsafeCueFamilies: ['rangeOfMotion'],
          },
        },
      },
    });

    expect(status?.message).toBe('Count only - keep key joints visible');
    expect(status?.details?.feedbackMode).toBe('countOnly');
    expect(status?.reason).toBe('pose_reliability_not_scoreable');
  });

  it('summarizes completed tracking-quality unscored reps as recent count-only feedback', () => {
    const status = cameraStatusFromCompletedRepReadiness({
      repResult: { scorable: true },
      trackingQualityScorable: false,
    });

    expect(status?.message).toBe('Count only - keep key joints visible');
    expect(status?.details?.feedbackMode).toBe('countOnly');
    expect(status?.reason).toBe('completed_rep_tracking_quality_unscorable');
  });

  it('lets recent completed-rep limited feedback beat generic full readiness', () => {
    const recentStatus = cameraStatusFromCompletedRepReadiness({
      repResult: {
        scorable: true,
        diagnostics: {
          scorable: true,
          reliability: {
            scoreabilityCandidate: 'partiallyScoreable',
            usableChains: ['leftArm'],
            weakChains: ['rightArm'],
            safeCueFamilies: ['rangeOfMotion'],
            unsafeCueFamilies: [],
          },
        },
      },
    });
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high'),
      exerciseStatus: fullFeedbackCameraStatus('exercise'),
      additionalStatuses: [recentStatus],
    });

    expect(result.selected?.source).toBe('completedRep');
    expect(result.selected?.details?.feedbackMode).toBe('limited');
  });

  it('keeps tracking lost and critical framing above recent completed-rep feedback', () => {
    const recentStatus = countOnlyCameraStatus({ source: 'completedRep' });
    const lost = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('lost', ['tracking_lost']),
      additionalStatuses: [recentStatus],
    });
    const framedOut = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high', ['move_camera_back']),
      additionalStatuses: [recentStatus],
    });

    expect(lost.selected?.source).toBe('poseQuality');
    expect(lost.selected?.reason).toBe('tracking_lost');
    expect(framedOut.selected?.source).toBe('poseQuality');
    expect(framedOut.selected?.category).toBe('framing');
  });

  it('holds recent completed-rep feedback briefly, then expires it', () => {
    const recentStatus = limitedFeedbackCameraStatus({ source: 'completedRep' });
    const state = updateRecentCompletedRepCameraStatusState(
      createRecentCompletedRepCameraStatusState(),
      {
        nowMs: 1000,
        completedRepStatus: recentStatus,
        holdMs: 1000,
      },
    );

    expect(recentCompletedRepCameraStatus(state, 1500)).toBe(recentStatus);
    expect(recentCompletedRepCameraStatus(state, 2001)).toBeNull();
  });

  it('clears a recent completed-rep hold after sustained full readiness', () => {
    const recentStatus = limitedFeedbackCameraStatus({ source: 'completedRep' });
    let state = updateRecentCompletedRepCameraStatusState(
      createRecentCompletedRepCameraStatusState(),
      {
        nowMs: 1000,
        completedRepStatus: recentStatus,
        holdMs: 5000,
      },
    );

    for (const nowMs of [1100, 1200]) {
      state = updateRecentCompletedRepCameraStatusState(state, {
        nowMs,
        currentReadinessStatus: fullFeedbackCameraStatus('exercise'),
        fullReadinessClearFrames: 3,
      });
      expect(recentCompletedRepCameraStatus(state, nowMs)).toBe(recentStatus);
    }

    state = updateRecentCompletedRepCameraStatusState(state, {
      nowMs: 1300,
      currentReadinessStatus: fullFeedbackCameraStatus('exercise'),
      fullReadinessClearFrames: 3,
    });

    expect(recentCompletedRepCameraStatus(state, 1300)).toBeNull();
  });

  it('keeps sustained live limited readiness after recent completed-rep hold expires', () => {
    const recentState = updateRecentCompletedRepCameraStatusState(
      createRecentCompletedRepCameraStatusState(),
      {
        nowMs: 1000,
        completedRepStatus: limitedFeedbackCameraStatus({ source: 'completedRep' }),
        holdMs: 1000,
      },
    );
    const liveState = appendLiveReadinessSamples(
      [
        limitedFeedbackCameraStatus({ source: 'poseState', reason: 'pose_partial' }),
        limitedFeedbackCameraStatus({ source: 'poseState', reason: 'pose_partial' }),
        limitedFeedbackCameraStatus({ source: 'poseState', reason: 'pose_partial' }),
      ],
      [1750, 2000, 2250],
    );

    expect(recentCompletedRepCameraStatus(recentState, 2251)).toBeNull();
    expect(cameraLiveFeedbackReadinessStatus(liveState, 2251)?.details?.feedbackMode).toBe('limited');
  });

  it('uses sustained live full readiness instead of stale recent limited readiness', () => {
    const recentStatus = limitedFeedbackCameraStatus({ source: 'completedRep' });
    const liveState = appendLiveReadinessSamples(
      [
        fullFeedbackCameraStatus('poseState'),
        fullFeedbackCameraStatus('poseState'),
        fullFeedbackCameraStatus('poseState'),
      ],
      [1000, 1250, 1500],
    );
    const liveStatus = cameraLiveFeedbackReadinessStatus(liveState, 1500);

    expect(liveStatus?.details?.feedbackMode).toBe('full');
    expect(shouldIncludeRecentCompletedRepCameraStatus({
      recentStatus,
      liveFeedbackReadinessStatus: liveStatus,
    })).toBe(false);
  });

  it('does not let one full sample immediately override sustained limited readiness', () => {
    const liveState = appendLiveReadinessSamples(
      [
        limitedFeedbackCameraStatus({ source: 'poseState' }),
        limitedFeedbackCameraStatus({ source: 'poseState' }),
        limitedFeedbackCameraStatus({ source: 'poseState' }),
        fullFeedbackCameraStatus('poseState'),
      ],
      [1000, 1200, 1400, 1600],
    );

    expect(cameraLiveFeedbackReadinessStatus(liveState, 1600)?.details?.feedbackMode).toBe('limited');
  });

  it('does not let one limited sample immediately override sustained full readiness', () => {
    const liveState = appendLiveReadinessSamples(
      [
        fullFeedbackCameraStatus('poseState'),
        fullFeedbackCameraStatus('poseState'),
        fullFeedbackCameraStatus('poseState'),
        limitedFeedbackCameraStatus({ source: 'poseState' }),
      ],
      [1000, 1200, 1400, 1600],
    );

    expect(cameraLiveFeedbackReadinessStatus(liveState, 1600)?.details?.feedbackMode).toBe('full');
  });

  it('lets tracking lost override live readiness and recent completed-rep readiness', () => {
    const liveState = appendLiveReadinessSamples(
      [
        limitedFeedbackCameraStatus({ source: 'poseState' }),
        limitedFeedbackCameraStatus({ source: 'poseState' }),
        limitedFeedbackCameraStatus({ source: 'poseState' }),
      ],
      [1000, 1250, 1500],
    );
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('lost', ['tracking_lost']),
      additionalStatuses: [
        cameraLiveFeedbackReadinessStatus(liveState, 1500),
        limitedFeedbackCameraStatus({ source: 'completedRep' }),
      ],
    });

    expect(result.selected?.reason).toBe('tracking_lost');
    expect(result.selected?.source).toBe('poseQuality');
  });

  it('lets critical framing override live readiness', () => {
    const liveState = appendLiveReadinessSamples(
      [
        fullFeedbackCameraStatus('poseState'),
        fullFeedbackCameraStatus('poseState'),
        fullFeedbackCameraStatus('poseState'),
      ],
      [1000, 1250, 1500],
    );
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high', ['move_camera_back']),
      additionalStatuses: [cameraLiveFeedbackReadinessStatus(liveState, 1500)],
    });

    expect(result.selected?.category).toBe('framing');
    expect(result.selected?.source).toBe('poseQuality');
  });

  it('keeps existing tracking-good fallback when live readiness is unavailable', () => {
    const result = resolveCameraAnalysisStatus({
      poseQuality: qualitySnapshot('high'),
      additionalStatuses: [
        cameraLiveFeedbackReadinessStatus(createCameraLiveFeedbackReadinessState(), 1000),
      ],
    });

    expect(result.selected?.reason).toBe('tracking_good');
    expect(result.selected?.source).toBe('poseQuality');
  });

  it('uses recent completed-rep readiness only as fallback or matching reinforcement', () => {
    const recentStatus = limitedFeedbackCameraStatus({ source: 'completedRep' });
    const liveLimited = limitedFeedbackCameraStatus({ source: 'liveReadiness' });
    const liveFull = fullFeedbackCameraStatus('liveReadiness');

    expect(shouldIncludeRecentCompletedRepCameraStatus({
      recentStatus,
      liveFeedbackReadinessStatus: null,
    })).toBe(true);
    expect(shouldIncludeRecentCompletedRepCameraStatus({
      recentStatus,
      liveFeedbackReadinessStatus: liveLimited,
    })).toBe(true);
    expect(shouldIncludeRecentCompletedRepCameraStatus({
      recentStatus,
      liveFeedbackReadinessStatus: liveFull,
    })).toBe(false);
  });

  it('maps Barbell Curl current PoseState readiness to full feedback when both arms and torso are reliable', () => {
    const status = cameraStatusFromPoseStateReadiness({
      exerciseName: 'Barbell Curl',
      poseState: poseStateReadiness({
        torso: 'reliable',
        leftArm: 'reliable',
        rightArm: 'reliable',
      }),
    });

    expect(status?.details?.feedbackMode).toBe('full');
    expect(status?.reason).toBe('barbell_curl_pose_state_full_readiness');
  });

  it('maps Barbell Curl current PoseState readiness to limited feedback with one reliable arm and torso', () => {
    const status = cameraStatusFromPoseStateReadiness({
      exerciseName: 'Barbell Curl',
      poseState: poseStateReadiness({
        torso: 'reliable',
        leftArm: 'reliable',
        rightArm: 'unreliable',
      }),
    });

    expect(status?.details?.feedbackMode).toBe('limited');
    expect(status?.details?.weakChains).toContain('rightArm');
  });

  it('maps Barbell Curl current PoseState readiness to count-only without a reliable primary arm chain', () => {
    const status = cameraStatusFromPoseStateReadiness({
      exerciseName: 'Barbell Curl',
      poseState: poseStateReadiness({
        torso: 'reliable',
        leftArm: 'unreliable',
        rightArm: 'partial',
      }),
    });

    expect(status?.details?.feedbackMode).toBe('countOnly');
    expect(status?.reason).toBe('barbell_curl_pose_state_count_only_readiness');
  });
});
