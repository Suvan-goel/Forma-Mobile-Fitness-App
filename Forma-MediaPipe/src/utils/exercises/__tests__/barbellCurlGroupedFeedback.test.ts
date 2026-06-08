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
  BARBELL_CURL_GROUPED_FEEDBACK_POLICY,
  BARBELL_CURL_GROUPED_FEEDBACK_FLAG,
  isBarbellCurlGroupedFeedbackEnabled,
  predictBarbellCurlGroupedFeedback,
} from '../ml/runtime/barbellCurlGroupedFeedback';

function baseFeatures(scorable: boolean): Record<string, number> {
  return {
    'feature__heuristic.scorable': scorable ? 1 : 0,
    'feature__diagnostic.scorable': scorable ? 1 : 0,
  };
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

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
    else process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = originalFlag;
    if (originalLegacyFlag === undefined) delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
    else process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK = originalLegacyFlag;
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
