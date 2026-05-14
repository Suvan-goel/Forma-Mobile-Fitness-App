import {
  DATASET_ROOT,
  evaluateBaseline,
  formatEvaluationSummary,
  formatLoadSummary,
  loadDatasetCasesWithSummary,
  writeJsonReport,
} from './dataset-common';
import type { DatasetSplit } from '../src/utils/exercises/dataset';

const shouldRun = process.env.FORMA_RUN_DATASET_EVALUATE === '1';
const VALID_SPLITS = new Set<DatasetSplit>(['train', 'validation', 'test']);

function parseSplitFilter(value: string | undefined): DatasetSplit[] | undefined {
  const rawSplits = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!rawSplits || rawSplits.length === 0) return undefined;

  return rawSplits.map((split) => {
    const normalized = split === 'training'
      ? 'train'
      : split === 'testing'
        ? 'test'
        : split;
    if (!VALID_SPLITS.has(normalized as DatasetSplit)) {
      throw new Error(
        `Invalid FORMA_DATASET_SPLITS value "${split}". Use train, validation, or test.`,
      );
    }
    return normalized as DatasetSplit;
  });
}

if (!shouldRun) {
  describe('Dataset evaluation', () => {
    it.skip('is opt-in via npm run dataset:evaluate', () => {});
  });
} else {
  describe('Dataset evaluation', () => {
    it('evaluates labelled landmark recordings against current heuristics', () => {
      const exerciseName = process.env.FORMA_DATASET_EXERCISE?.trim() || undefined;
      const splits = parseSplitFilter(
        process.env.FORMA_DATASET_SPLITS ?? process.env.FORMA_DATASET_SPLIT,
      );
      const { cases, summary } = loadDatasetCasesWithSummary({ exerciseName, splits });
      if (cases.length === 0) {
        console.log(`No reviewed label JSON files found under ${DATASET_ROOT}/labels.`);
        console.log(formatLoadSummary(summary));
        expect(true).toBe(true);
        return;
      }

      const evaluation = evaluateBaseline(cases);
      const reportPath = writeJsonReport('evaluation', { loadSummary: summary, evaluation });
      if (exerciseName) console.log(`Exercise filter: ${exerciseName}`);
      if (splits) console.log(`Split filter: ${splits.join(', ')}`);
      console.log(formatLoadSummary(summary));
      console.log(formatEvaluationSummary(evaluation));
      console.log(`Report: ${reportPath}`);

      expect(evaluation.totals.cases).toBe(cases.length);
    });
  });
}
