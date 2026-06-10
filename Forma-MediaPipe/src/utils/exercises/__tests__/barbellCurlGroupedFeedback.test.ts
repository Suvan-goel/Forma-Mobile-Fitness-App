import * as fs from 'fs';
import * as path from 'path';
import { barbellCurlDefinition } from '../definitions/barbellCurl';
import { evaluateCase } from '../dataset';
import type { DatasetCase } from '../dataset';
import {
  buildMlRepExamples,
  buildRuntimeMlFeatureVector,
} from '../ml/featureExtractor';
import { replayRecordingVerbose } from '../replay';
import {
  BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG,
  BARBELL_CURL_GROUPED_FEEDBACK_POLICY,
  BARBELL_CURL_GROUPED_FEEDBACK_FLAG,
  createBarbellCurlGroupedFallbackShadowState,
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

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readCsvRows(filePath: string): Array<Record<string, string>> {
  const lines = fs.readFileSync(filePath, 'utf8').trimEnd().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
  });
}

function loadDatasetCase(folder: 'validation' | 'testing', stem: string): DatasetCase {
  const repoRoot = process.cwd();
  const labelPath = path.join(
    repoRoot,
    'datasets/form-heuristics/labels',
    folder,
    'barbell-curl',
    `${stem}.json`,
  );
  const recordingPath = path.join(
    repoRoot,
    'datasets/form-heuristics/landmarks',
    folder,
    'barbell-curl',
    `${stem}.json`,
  );
  return {
    label: JSON.parse(fs.readFileSync(labelPath, 'utf8')),
    recording: JSON.parse(fs.readFileSync(recordingPath, 'utf8')),
    labelPath,
    recordingPath,
  };
}

function withGroupedFeedbackDisabled<T>(callback: () => T): T {
  const previousFlag = process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
  const previousLegacyFlag = process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
  process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '0';
  delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
  try {
    return callback();
  } finally {
    if (previousFlag === undefined) delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
    else process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = previousFlag;
    if (previousLegacyFlag === undefined) delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
    else process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK = previousLegacyFlag;
  }
}

function unprefixFeatureColumn(column: string): string {
  return column.startsWith('feature__') ? column.slice('feature__'.length) : column;
}

function nullableFeature(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

  it('is enabled by default and can be disabled by the Expo public flag', () => {
    delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
    delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(true);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '0';
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(false);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = 'false';
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(false);

    process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '1';
    expect(isBarbellCurlGroupedFeedbackEnabled()).toBe(true);
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

  it('matches frozen offline grouped-policy decisions on representative exported rows', () => {
    const repoRoot = process.cwd();
    const predictionsRows = readCsvRows(path.join(
      repoRoot,
      'datasets/form-heuristics/ml/barbell-curl/models/2026-06-08T17-27-07Z/predictions.csv',
    ));
    const audit = JSON.parse(fs.readFileSync(path.join(
      repoRoot,
      'datasets/form-heuristics/ml/barbell-curl/models/grouped_policy_combination_audit_2026-06-08T18-36-15Z.json',
    ), 'utf8')) as {
      rows: Array<{
        sourceVideo: string;
        repIndex: number;
        groups: Record<string, {
          issueId: string;
          prediction: number;
          candidateProbabilities: Record<string, number>;
        }>;
      }>;
    };

    const rowsByKey = new Map(
      predictionsRows.map((row) => [`${row.source_video}::${row.rep_index}`, row]),
    );
    const groupLabels = [
      'label_issue__barbell_curl_rom_issue',
      'label_issue__barbell_curl_torso_issue',
      'label_issue__barbell_curl_shoulder_issue',
      'label_issue__barbell_curl_tempo_issue',
    ];
    const representativeRows = new Map<string, (typeof audit.rows)[number]>();
    const cleanRow = audit.rows.find((row) => groupLabels.every((label) => row.groups[label]?.prediction === 0));
    if (cleanRow) representativeRows.set(`${cleanRow.sourceVideo}::${cleanRow.repIndex}`, cleanRow);
    for (const label of groupLabels) {
      const positive = audit.rows.find((row) => row.groups[label]?.prediction === 1);
      if (positive) representativeRows.set(`${positive.sourceVideo}::${positive.repIndex}`, positive);
    }

    expect(representativeRows.size).toBeGreaterThan(1);

    for (const auditRow of representativeRows.values()) {
      const csvRow = rowsByKey.get(`${auditRow.sourceVideo}::${auditRow.repIndex}`);
      expect(csvRow).toBeDefined();
      const features: Record<string, number | undefined> = {};
      for (const [key, value] of Object.entries(csvRow ?? {})) {
        if (!key.startsWith('feature__') || value === '') continue;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) features[key] = numeric;
      }
      const heuristicIssueIds = (csvRow?.heuristic_issue_ids ?? '').split(';').filter(Boolean);
      const result = predictBarbellCurlGroupedFeedback({ features, heuristicIssueIds });

      for (const label of groupLabels) {
        const expected = auditRow.groups[label];
        const actual = result.predictions.find((prediction) => prediction.issueId === expected.issueId);
        const actualValue = actual?.predicted ? 1 : 0;
        if (actualValue !== expected.prediction) {
          throw new Error(
            `${auditRow.sourceVideo} rep ${auditRow.repIndex} ${expected.issueId}: expected ${expected.prediction}, got ${actualValue}; skipped=${actual?.skippedReason ?? 'none'} prob=${actual?.probability ?? 'none'}`,
          );
        }
      }

      const rom = result.predictions.find((prediction) => prediction.issueId === 'barbell-curl.ROM_issue');
      const torso = result.predictions.find((prediction) => prediction.issueId === 'barbell-curl.torso_issue');
      expect(rom?.probability ?? 0).toBeCloseTo(
        auditRow.groups.label_issue__barbell_curl_rom_issue.candidateProbabilities['logistic_l1_pruned_all.repLevelTolerantOptimized'],
        8,
      );
      expect(torso?.probability ?? 0).toBeCloseTo(
        auditRow.groups.label_issue__barbell_curl_torso_issue.candidateProbabilities['random_forest.repLevelTolerantOptimizedDirectEvidenceGate'],
        8,
      );
    }
  });

  it('matches offline ROM and torso model features on representative saved replay windows', () => {
    withGroupedFeedbackDisabled(() => {
      const cases = [
        {
          folder: 'validation' as const,
          stem: 'val06-multi-rom-tempo',
          repIndex: 2,
          groupId: 'barbell-curl.ROM_issue',
          modelId: 'rom',
        },
        {
          folder: 'testing' as const,
          stem: 'test05-focus-torso-warn',
          repIndex: 2,
          groupId: 'barbell-curl.torso_issue',
          modelId: 'torso',
        },
      ];

      for (const parityCase of cases) {
        const datasetCase = loadDatasetCase(parityCase.folder, parityCase.stem);
        const replay = replayRecordingVerbose(barbellCurlDefinition, datasetCase.recording, {
          confidenceGating: true,
        });
        const caseEvaluation = evaluateCase(datasetCase, replay);
        const built = buildMlRepExamples({
          definition: barbellCurlDefinition,
          datasetCase,
          replay,
          caseEvaluation,
          labelFile: datasetCase.labelPath,
          recordingFile: datasetCase.recordingPath,
        });
        const example = built.examples.find((candidate) => candidate.repIndex === parityCase.repIndex);
        const matchedRep = caseEvaluation.matchedReps.find(
          (candidate) => candidate.expectedRepIndex === parityCase.repIndex,
        );
        const label = datasetCase.label.reps.find((candidate) => candidate.index === parityCase.repIndex);
        const prediction = replay.reps.find((candidate) => candidate.repIndex === matchedRep?.predictedRepIndex);

        expect(example).toBeDefined();
        expect(matchedRep).toBeDefined();
        expect(label).toBeDefined();
        expect(prediction).toBeDefined();
        if (!example || !matchedRep || !label || !prediction) continue;

        const frames = datasetCase.recording.frames.filter(
          (frame) => frame.timestamp >= label.startMs && frame.timestamp <= label.endMs,
        );
        const runtimeFeatures = buildRuntimeMlFeatureVector({
          definition: barbellCurlDefinition,
          frames,
          repIndex: label.index,
          durationMs: label.endMs - label.startMs,
          score: prediction.score,
          issueIds: prediction.issueIds,
          messages: prediction.messages,
          scorable: prediction.scorable ?? matchedRep.predictedScorable ?? null,
          confidence: prediction.confidence,
          qualityStatus: prediction.qualityStatus,
          qualityWarnings: prediction.qualityWarnings,
          diagnostics: matchedRep.predictedDiagnostics,
          view: matchedRep.predictedView,
          overlapMs: matchedRep.overlapMs,
          completionDeltaMs: matchedRep.completionDeltaMs,
        });

        const model = BARBELL_CURL_GROUPED_FEEDBACK_POLICY.models[parityCase.modelId];
        expect(model).toBeDefined();
        for (const column of model.featureColumns) {
          const offlineValue = nullableFeature(example.features[unprefixFeatureColumn(column)]);
          const runtimeValue = nullableFeature(runtimeFeatures[column]);
          if (offlineValue === null || runtimeValue === null) {
            expect(runtimeValue).toBe(offlineValue);
          } else {
            expect(runtimeValue).toBeCloseTo(offlineValue, 10);
          }
        }

        const offlineFeatures = Object.fromEntries(
          Object.entries(example.features).map(([key, value]) => [`feature__${key}`, value]),
        );
        const offlineResult = predictBarbellCurlGroupedFeedback({
          features: offlineFeatures,
          heuristicIssueIds: example.heuristic.issueIds,
        });
        const runtimeResult = predictBarbellCurlGroupedFeedback({
          features: runtimeFeatures,
          heuristicIssueIds: prediction.issueIds,
        });
        const offlinePrediction = offlineResult.predictions.find(
          (candidate) => candidate.issueId === parityCase.groupId,
        );
        const runtimePrediction = runtimeResult.predictions.find(
          (candidate) => candidate.issueId === parityCase.groupId,
        );

        expect(runtimePrediction?.probability ?? 0).toBeCloseTo(offlinePrediction?.probability ?? 0, 10);
        expect(runtimePrediction?.probabilityGate).toEqual(offlinePrediction?.probabilityGate);
        expect(runtimePrediction?.directEvidence).toEqual(offlinePrediction?.directEvidence);
        expect(runtimePrediction?.predicted).toBe(offlinePrediction?.predicted);
      }
    });
  });
});
