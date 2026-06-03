import {
  countOnlyCameraStatus,
  fullFeedbackCameraStatus,
  limitedFeedbackCameraStatus,
  resolveCameraAnalysisStatus,
  selectCameraAnalysisStatus,
  cameraStatusFromViewCueGating,
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
});
