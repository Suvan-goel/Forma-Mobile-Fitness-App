import { cableRowDefinition } from '../definitions/cableRow';
import {
  BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG,
  BARBELL_CURL_GROUPED_FEEDBACK_POLICY,
  BARBELL_CURL_GROUPED_FEEDBACK_FLAG,
  createBarbellCurlGroupedFallbackShadowState,
  isBarbellCurlGroupedFallbackFeedbackEnabled,
  isBarbellCurlGroupedFeedbackEnabled,
  predictBarbellCurlGroupedFeedback,
} from '../ml/runtime/barbellCurlGroupedFeedback';

function baseFeatures(scorable: boolean): Record<string, number> {
  return {
    'feature__heuristic.scorable': scorable ? 1 : 0,
    'feature__diagnostic.scorable': scorable ? 1 : 0,
  };
}

function torsoFallbackFeatures(directEvidenceValue: number): Record<string, number> {
  return {
    ...baseFeatures(true),
    'feature__scorable.issue.barbell_curl_torso_warn': 1,
    'feature__scorable.issue.barbell_curl_torso_fail': 1,
    'feature__diagnostic.cue.barbell_curl_torso_warn.eligible': 1,
    'feature__diagnostic.cue.barbell_curl_torso_fail.eligible': 1,
    'feature__diagnostic.metric.torsodeltaraw.value': directEvidenceValue,
    'feature__v2.reliability.unsafe_cue_family_count': 0,
    'feature__v2.tempo.full.max_tracking_gap_ms': 0,
  };
}

function romFallbackFeatures(): Record<string, number> {
  return {
    ...baseFeatures(true),
    'feature__scorable.issue.barbell_curl_incomplete_flex': 1,
    'feature__diagnostic.cue.barbell_curl_incomplete_flex.eligible': 1,
    'feature__diagnostic.cue.barbell_curl_incomplete_flex.margin': 0.08,
    'feature__diagnostic.cue.barbell_curl_incomplete_flex.triggered': 1,
    'feature__v2.reliability.unsafe_cue_family_count': 0,
    'feature__v2.tempo.full.tracking_gap_count': 0,
    'feature__v2.tempo.full.max_tracking_gap_ms': 0,
  };
}

function shadowAlternative(
  result: ReturnType<typeof predictBarbellCurlGroupedFeedback>,
  groupId: string,
  id: string,
) {
  return result.predictions
    .find((prediction) => prediction.issueId === groupId)
    ?.shadowAlternatives
    ?.find((alternative) => alternative.id === id);
}

function fallbackPolicy(
  result: ReturnType<typeof predictBarbellCurlGroupedFeedback>,
  name: string,
) {
  return result.fallbackShadow?.policies.find((policy) => policy.name === name);
}

describe('Barbell Curl grouped ML feedback runtime policy', () => {
  const originalFlag = process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
  const originalLegacyFlag = process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
  const originalFallbackFlag = process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
    else process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = originalFlag;
    if (originalLegacyFlag === undefined) delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
    else process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK = originalLegacyFlag;
    if (originalFallbackFlag === undefined) delete process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG];
    else process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG] = originalFallbackFlag;
  });

  it('keeps grouped feedback disabled unless the base flag is explicitly enabled', () => {
    delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
    delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(false);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '0';
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(false);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = 'false';
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(false);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '1';
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(true);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = 'true';
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(true);
  });

  it('supports the legacy grouped-feedback flag only when the public flag is unset', () => {
    delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
    process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK = 'true';
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(true);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '0';
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(false);
  });

  it('keeps fallback feedback disabled unless both grouped and fallback flags are explicitly enabled', () => {
    delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
    delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
    delete process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG];
    expect(isBarbellCurlGroupedFallbackFeedbackEnabled()).toBe(false);

    process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG] = '1';
    expect(isBarbellCurlGroupedFallbackFeedbackEnabled()).toBe(false);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '1';
    expect(isBarbellCurlGroupedFallbackFeedbackEnabled()).toBe(true);

    process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG] = 'false';
    expect(isBarbellCurlGroupedFallbackFeedbackEnabled()).toBe(false);
  });

  it('fails closed when the completed rep is not scorable', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: baseFeatures(false),
      heuristicIssueIds: ['barbell-curl.shoulder_warn'],
    });

    expect(result.messages).toEqual([]);
    expect(result.issueIds).toEqual([]);
    expect(result.predictions.every((prediction) => prediction.predicted === false)).toBe(true);
    expect(result.predictions.every((prediction) => prediction.skippedReason === 'rep_not_scorable')).toBe(true);
  });

  it('collapses the selected shoulder fine-policy into one grouped cue', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: baseFeatures(true),
      heuristicIssueIds: ['barbell-curl.shoulder_warn'],
    });

    expect(result.selectedIssueId).toBe('barbell-curl.shoulder_issue');
    expect(result.messages).toEqual(['Avoid using your shoulders to lift the bar.']);
    expect(result.issueIds).toContain('barbell-curl.shoulder_issue');
    expect(result.messages).toHaveLength(1);
  });

  it('reports torso heuristic/direct-evidence fallback as shadow-only diagnostics', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: torsoFallbackFeatures(12),
      heuristicIssueIds: ['barbell-curl.torso_warn'],
    });

    expect(result.issueIds).not.toContain('barbell-curl.torso_issue');
    expect(shadowAlternative(result, 'barbell-curl.torso_issue', 'torso_heuristic_direct_evidence_fallback')).toMatchObject({
      wouldPredict: true,
      reason: 'heuristic_torso_and_direct_evidence_pass',
    });
    expect(shadowAlternative(result, 'barbell-curl.torso_issue', 'torso_warn_fail_fallback')).toMatchObject({
      wouldPredict: true,
      reason: 'heuristic_torso_warn_or_fail_and_direct_evidence_pass',
    });
    expect(shadowAlternative(result, 'barbell-curl.torso_issue', 'torso_fail_only_fallback')).toMatchObject({
      wouldPredict: false,
      reason: 'blocked_by_missing_heuristic_torso_fail',
    });
  });

  it('keeps the torso fail-only shadow fallback narrower than warn/fail', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: torsoFallbackFeatures(12),
      heuristicIssueIds: ['barbell-curl.torso_fail'],
    });

    expect(shadowAlternative(result, 'barbell-curl.torso_issue', 'torso_fail_only_fallback')).toMatchObject({
      wouldPredict: true,
      reason: 'heuristic_torso_fail_and_direct_evidence_pass',
    });
  });

  it('blocks torso fallback shadows when direct evidence fails', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: torsoFallbackFeatures(2),
      heuristicIssueIds: ['barbell-curl.torso_fail'],
    });

    expect(shadowAlternative(result, 'barbell-curl.torso_issue', 'torso_heuristic_direct_evidence_fallback')).toMatchObject({
      wouldPredict: false,
      reason: 'blocked_by_direct_evidence_gate',
    });
    expect(shadowAlternative(result, 'barbell-curl.torso_issue', 'torso_fail_only_fallback')).toMatchObject({
      wouldPredict: false,
      reason: 'blocked_by_direct_evidence_gate',
    });
  });

  it('reports ROM incomplete-flex fallback as shadow-only diagnostics', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: romFallbackFeatures(),
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
    });

    expect(result.issueIds).not.toContain('barbell-curl.ROM_issue');
    expect(shadowAlternative(result, 'barbell-curl.ROM_issue', 'rom_heuristic_incomplete_flex_fallback')).toMatchObject({
      wouldPredict: true,
      reason: 'heuristic_incomplete_flex_and_cue_gate_pass',
    });
    expect(shadowAlternative(result, 'barbell-curl.ROM_issue', 'rom_heuristic_incomplete_flex_safe_fallback')).toMatchObject({
      wouldPredict: true,
      reason: 'heuristic_incomplete_flex_and_conservative_safety_pass',
    });
    expect(shadowAlternative(result, 'barbell-curl.ROM_issue', 'rom_heuristic_incomplete_flex_endpoint_fallback')).toMatchObject({
      wouldPredict: true,
      reason: 'heuristic_incomplete_flex_and_endpoint_evidence_pass',
    });
  });

  it('does not treat clean incomplete-rom heuristic noise as an incomplete-flex fallback', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: {
        ...baseFeatures(true),
        'feature__scorable.issue.barbell_curl_incomplete_rom': 1,
        'feature__diagnostic.cue.barbell_curl_incomplete_rom.eligible': 1,
        'feature__diagnostic.cue.barbell_curl_incomplete_rom.margin': 0.1,
        'feature__v2.reliability.unsafe_cue_family_count': 0,
        'feature__v2.tempo.full.tracking_gap_count': 0,
        'feature__v2.tempo.full.max_tracking_gap_ms': 0,
      },
      heuristicIssueIds: ['barbell-curl.incomplete_rom'],
    });

    expect(shadowAlternative(result, 'barbell-curl.ROM_issue', 'rom_heuristic_incomplete_flex_fallback')).toMatchObject({
      wouldPredict: false,
      reason: 'blocked_by_incomplete_flex_safety_or_cue_gate',
    });
  });

  it('blocks ROM incomplete-flex shadow fallback when cue safety is missing', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: {
        ...romFallbackFeatures(),
        'feature__diagnostic.cue.barbell_curl_incomplete_flex.eligible': 0,
      },
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
    });

    expect(shadowAlternative(result, 'barbell-curl.ROM_issue', 'rom_heuristic_incomplete_flex_fallback')).toMatchObject({
      wouldPredict: false,
      reason: 'blocked_by_incomplete_flex_safety_or_cue_gate',
    });
    expect(shadowAlternative(result, 'barbell-curl.ROM_issue', 'rom_heuristic_incomplete_flex_safe_fallback')).toMatchObject({
      wouldPredict: false,
      reason: 'blocked_by_incomplete_flex_conservative_safety_gate',
    });
  });

  it('blocks proposed narrow torso shadows on raw-spike contamination signatures', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: {
        ...torsoFallbackFeatures(83),
        'feature__v2.torso.robust_abs_delta_p90_minus_p10': 0.4,
        'feature__v2.torso.full.sustained_lean_above_3deg.support_ratio': 0,
        'feature__v2.torso.full.sustained_lean_above_5deg.support_ratio': 0,
      },
      heuristicIssueIds: ['barbell-curl.torso_fail'],
    });

    expect(result.issueIds).not.toContain('barbell-curl.torso_issue');
    expect(shadowAlternative(result, 'barbell-curl.torso_issue', 'torso_fail_no_raw_spike_fallback')).toMatchObject({
      wouldPredict: false,
      reason: 'blocked_by_raw_spike_contamination_signature',
    });
    expect(shadowAlternative(result, 'barbell-curl.torso_issue', 'torso_fail_rf05_robust_fallback')).toMatchObject({
      wouldPredict: false,
      reason: 'blocked_by_weak_robust_or_sustained_torso_evidence',
    });
  });

  it('reports repeated ROM incomplete-flex fallback after two safe contributing reps', () => {
    const fallbackShadowState = createBarbellCurlGroupedFallbackShadowState();
    const first = predictBarbellCurlGroupedFeedback({
      features: romFallbackFeatures(),
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 1,
      fallbackShadowState,
    });
    const second = predictBarbellCurlGroupedFeedback({
      features: {
        ...romFallbackFeatures(),
        'feature__diagnostic.cue.barbell_curl_incomplete_flex.margin': 0.05,
      },
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 2,
      fallbackShadowState,
    });

    expect(fallbackPolicy(first, 'rom_repeated_incomplete_flex_fallback')).toMatchObject({
      fallbackWouldPredict: false,
      evidenceCount: 1,
      contributingReps: [1],
    });
    expect(fallbackPolicy(second, 'rom_repeated_incomplete_flex_fallback')).toMatchObject({
      fallbackWouldPredict: true,
      evidenceCount: 2,
      contributingReps: [1, 2],
    });
    expect(second.fallbackShadow?.fallbackGroups).toContain('barbell-curl.ROM_issue');
    expect(second.fallbackShadow?.fallbackGroupsWouldShow).toContain('barbell-curl.ROM_issue');
    expect(second.fallbackShadow?.fallbackSelectedMessage).toBe('Use a fuller range of motion.');
    expect(second.issueIds).not.toContain('barbell-curl.ROM_issue');
    expect(second.messages).toEqual([]);
  });

  it('does not report repeated ROM fallback for one isolated incomplete-flex rep', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: romFallbackFeatures(),
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 1,
      fallbackShadowState: createBarbellCurlGroupedFallbackShadowState(),
    });

    expect(fallbackPolicy(result, 'rom_repeated_incomplete_flex_fallback')).toMatchObject({
      fallbackWouldPredict: false,
      evidenceCount: 1,
      contributingReps: [1],
    });
    expect(result.fallbackShadow?.fallbackGroups).toEqual([]);
  });

  it('blocks repeated ROM fallback when cue safety or tracking contamination fails', () => {
    const fallbackShadowState = createBarbellCurlGroupedFallbackShadowState();
    predictBarbellCurlGroupedFeedback({
      features: {
        ...romFallbackFeatures(),
        'feature__diagnostic.cue.barbell_curl_incomplete_flex.eligible': 0,
      },
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 1,
      fallbackShadowState,
    });
    const result = predictBarbellCurlGroupedFeedback({
      features: {
        ...romFallbackFeatures(),
        'feature__v2.tempo.full.max_tracking_gap_ms': 600,
      },
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 2,
      fallbackShadowState,
    });
    const policy = fallbackPolicy(result, 'rom_repeated_incomplete_flex_fallback');

    expect(policy?.fallbackWouldPredict).toBe(false);
    expect(policy?.evidenceCount).toBe(0);
    expect(policy?.evidence.map((entry) => entry.blockReasons)).toEqual([
      ['rom_cue_not_safe_or_eligible'],
      ['tracking_interruption_contamination'],
    ]);
  });

  it('reports repeated torso sustained fallback after two safe torso warn/fail reps', () => {
    const fallbackShadowState = createBarbellCurlGroupedFallbackShadowState();
    const features = {
      ...torsoFallbackFeatures(24),
      'feature__v2.torso.robust_abs_delta_p90_minus_p10': 3.2,
      'feature__v2.torso.full.sustained_lean_above_3deg.support_ratio': 0.25,
      'feature__v2.torso.full.sustained_lean_above_5deg.support_ratio': 0,
    };
    predictBarbellCurlGroupedFeedback({
      features,
      heuristicIssueIds: ['barbell-curl.torso_warn'],
      repIndex: 1,
      fallbackShadowState,
    });
    const result = predictBarbellCurlGroupedFeedback({
      features,
      heuristicIssueIds: ['barbell-curl.torso_fail'],
      repIndex: 2,
      fallbackShadowState,
    });

    expect(fallbackPolicy(result, 'torso_repeated_sustained_fallback')).toMatchObject({
      fallbackWouldPredict: true,
      evidenceCount: 2,
      contributingReps: [1, 2],
    });
    expect(result.fallbackShadow?.fallbackGroups).toContain('barbell-curl.torso_issue');
    expect(result.fallbackShadow?.fallbackGroupsWouldShow).toContain('barbell-curl.torso_issue');
    expect(result.fallbackShadow?.fallbackSelectedMessage).toBe('Keep your torso still.');
    expect(result.issueIds).not.toContain('barbell-curl.torso_issue');
    expect(result.messages).toEqual([]);
  });

  it('blocks repeated torso fallback on raw-spike contamination signatures', () => {
    const fallbackShadowState = createBarbellCurlGroupedFallbackShadowState();
    const rawSpikeFeatures = {
      ...torsoFallbackFeatures(84),
      'feature__v2.torso.robust_abs_delta_p90_minus_p10': 1.4,
      'feature__v2.torso.full.sustained_lean_above_3deg.support_ratio': 0.04,
      'feature__v2.torso.full.sustained_lean_above_5deg.support_ratio': 0.04,
    };
    predictBarbellCurlGroupedFeedback({
      features: rawSpikeFeatures,
      heuristicIssueIds: ['barbell-curl.torso_fail'],
      repIndex: 1,
      fallbackShadowState,
    });
    const result = predictBarbellCurlGroupedFeedback({
      features: rawSpikeFeatures,
      heuristicIssueIds: ['barbell-curl.torso_fail'],
      repIndex: 2,
      fallbackShadowState,
    });
    const policy = fallbackPolicy(result, 'torso_repeated_sustained_fallback');

    expect(policy?.fallbackWouldPredict).toBe(false);
    expect(policy?.evidenceCount).toBe(0);
    expect(policy?.evidence.every((entry) => entry.rawSpikeBlocked)).toBe(true);
    expect(policy?.evidence.flatMap((entry) => entry.blockReasons)).toContain('raw_spike_contamination_signature');
  });

  it('does not report repeated torso fallback for one isolated torso warning', () => {
    const result = predictBarbellCurlGroupedFeedback({
      features: {
        ...torsoFallbackFeatures(22),
        'feature__v2.torso.robust_abs_delta_p90_minus_p10': 2.8,
        'feature__v2.torso.full.sustained_lean_above_3deg.support_ratio': 0.2,
        'feature__v2.torso.full.sustained_lean_above_5deg.support_ratio': 0,
      },
      heuristicIssueIds: ['barbell-curl.torso_warn'],
      repIndex: 1,
      fallbackShadowState: createBarbellCurlGroupedFallbackShadowState(),
    });

    expect(fallbackPolicy(result, 'torso_repeated_sustained_fallback')).toMatchObject({
      fallbackWouldPredict: false,
      evidenceCount: 1,
      contributingReps: [1],
    });
    expect(result.fallbackShadow?.fallbackGroups).toEqual([]);
  });

  it('keeps repeated fallbacks shadow-only when the fallback feature flag is off', () => {
    process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG] = '0';
    const fallbackShadowState = createBarbellCurlGroupedFallbackShadowState();
    predictBarbellCurlGroupedFeedback({
      features: romFallbackFeatures(),
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 1,
      fallbackShadowState,
    });
    const result = predictBarbellCurlGroupedFeedback({
      features: romFallbackFeatures(),
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 2,
      fallbackShadowState,
    });

    expect(result.fallbackShadow?.fallbackUserFacingFlagEnabled).toBe(false);
    expect(result.fallbackShadow?.fallbackGroups).toContain('barbell-curl.ROM_issue');
    expect(result.issueIds).not.toContain('barbell-curl.ROM_issue');
    expect(result.messages).toEqual([]);
    expect(result.selectedIssueId).toBeNull();
    expect(result.selectedMessage).toBeNull();
  });

  it('gates fallback user-facing diagnostics behind the grouped feedback base flag', () => {
    process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG] = '1';
    delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
    delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
    const baseDisabledState = createBarbellCurlGroupedFallbackShadowState();
    predictBarbellCurlGroupedFeedback({
      features: romFallbackFeatures(),
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 1,
      fallbackShadowState: baseDisabledState,
    });
    const disabledResult = predictBarbellCurlGroupedFeedback({
      features: romFallbackFeatures(),
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 2,
      fallbackShadowState: baseDisabledState,
    });
    expect(disabledResult.fallbackShadow?.fallbackUserFacingFlagEnabled).toBe(false);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = 'true';
    const baseEnabledState = createBarbellCurlGroupedFallbackShadowState();
    predictBarbellCurlGroupedFeedback({
      features: romFallbackFeatures(),
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 1,
      fallbackShadowState: baseEnabledState,
    });
    const enabledResult = predictBarbellCurlGroupedFeedback({
      features: romFallbackFeatures(),
      heuristicIssueIds: ['barbell-curl.incomplete_flex'],
      repIndex: 2,
      fallbackShadowState: baseEnabledState,
    });
    expect(enabledResult.fallbackShadow?.fallbackUserFacingFlagEnabled).toBe(true);
  });

  it('validates the bundled runtime policy artifact shape without offline ML files', () => {
    const policy = BARBELL_CURL_GROUPED_FEEDBACK_POLICY;
    expect(policy.policyId).toBe('barbell-curl-grouped-feedback-v1-20260608T183615Z');
    expect(policy.modelRunId).toBe('2026-06-08T17-27-07Z');
    expect(policy.featureSchemaVersion).toBe('rep-features-v2');

    const groups = Object.fromEntries(policy.groups.map((group) => [group.id, group as any]));
    expect(Object.keys(groups).sort()).toEqual([
      'barbell-curl.ROM_issue',
      'barbell-curl.shoulder_issue',
      'barbell-curl.tempo_issue',
      'barbell-curl.torso_issue',
    ]);
    expect(groups['barbell-curl.ROM_issue']).toMatchObject({
      kind: 'thresholded_model',
      modelId: 'rom',
      threshold: 0.85,
    });
    expect(groups['barbell-curl.torso_issue']).toMatchObject({
      kind: 'thresholded_model_with_direct_evidence',
      modelId: 'torso',
      threshold: 0.67,
      directEvidence: {
        featureColumn: 'feature__diagnostic.metric.torsodeltaraw.value',
      },
    });
    expect(groups['barbell-curl.shoulder_issue'].childPolicies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issueId: 'barbell-curl.shoulder_warn', policy: 'heuristic-only' }),
        expect.objectContaining({ issueId: 'barbell-curl.shoulder_fail', policy: 'ml-add-only-high-confidence' }),
      ]),
    );

    for (const [modelId, model] of Object.entries(policy.models) as Array<[string, any]>) {
      expect(['logistic_regression', 'random_forest']).toContain(model.kind);
      expect(model.featureColumns.length).toBeGreaterThan(0);
      expect(model.imputerStatistics).toHaveLength(model.featureColumns.length);
      const imputedFeatureCount = model.imputerStatistics.filter((value: unknown) => typeof value === 'number').length;
      if (model.kind === 'logistic_regression') {
        expect(model.coef).toHaveLength(imputedFeatureCount);
        expect(model.scalerMean).toHaveLength(imputedFeatureCount);
        expect(model.scalerScale).toHaveLength(imputedFeatureCount);
        expect(typeof model.intercept).toBe('number');
      } else {
        expect(modelId).toBe('torso');
        expect(model.trees.length).toBeGreaterThan(0);
        for (const tree of model.trees) {
          expect(tree.childrenLeft).toHaveLength(tree.childrenRight.length);
          expect(tree.feature).toHaveLength(tree.threshold.length);
          expect(tree.positiveProbability).toHaveLength(tree.feature.length);
        }
      }
    }
  });

  it('runs deterministic grouped-policy inference from inline fixtures only', () => {
    const fixtures = [
      {
        name: 'clean scorable rep',
        features: baseFeatures(true),
        heuristicIssueIds: [],
        expectedIssueIds: [],
        expectedMessages: [],
      },
      {
        name: 'heuristic shoulder warning collapsed to grouped cue',
        features: baseFeatures(true),
        heuristicIssueIds: ['barbell-curl.shoulder_warn'],
        expectedIssueIds: ['barbell-curl.shoulder_issue'],
        expectedMessages: ['Avoid using your shoulders to lift the bar.'],
      },
      {
        name: 'ROM fallback evidence remains diagnostic-only',
        features: romFallbackFeatures(),
        heuristicIssueIds: ['barbell-curl.incomplete_flex'],
        expectedIssueIds: [],
        expectedMessages: [],
      },
    ];

    for (const fixture of fixtures) {
      const result = predictBarbellCurlGroupedFeedback({
        features: fixture.features,
        heuristicIssueIds: fixture.heuristicIssueIds,
      });
      expect(result.policyId).toBe(BARBELL_CURL_GROUPED_FEEDBACK_POLICY.policyId);
      expect(result.modelRunId).toBe(BARBELL_CURL_GROUPED_FEEDBACK_POLICY.modelRunId);
      expect(result.issueIds).toEqual(fixture.expectedIssueIds);
      expect(result.messages).toEqual(fixture.expectedMessages);
      expect(result.predictions).toHaveLength(BARBELL_CURL_GROUPED_FEEDBACK_POLICY.groups.length);
    }
  });

  it('does not attach grouped ML diagnostics to a non-Barbell exercise when flags are enabled', () => {
    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '1';
    process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG] = '1';

    const state = cableRowDefinition.update([], cableRowDefinition.createState(), {
      primarySource: 'image',
      cameraAnalysisStatusRequested: true,
    });

    expect(state.repCount).toBe(0);
    expect(state.lastRepResult?.diagnostics?.mlGroupedFeedback).toBeUndefined();
  });
});
