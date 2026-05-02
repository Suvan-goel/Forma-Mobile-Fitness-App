import {
  DATASET_ROOT,
  evaluateBaseline,
  formatEvaluationSummary,
  formatLoadSummary,
  loadDatasetCasesWithSummary,
  writeJsonReport,
} from './dataset-common';

const shouldRun = process.env.FORMA_RUN_DATASET_EVALUATE === '1';

if (!shouldRun) {
  describe('Dataset evaluation', () => {
    it.skip('is opt-in via npm run dataset:evaluate', () => {});
  });
} else {
  describe('Dataset evaluation', () => {
    it('evaluates labelled landmark recordings against current heuristics', () => {
      const { cases, summary } = loadDatasetCasesWithSummary();
      if (cases.length === 0) {
        console.log(`No reviewed label JSON files found under ${DATASET_ROOT}/labels.`);
        console.log(formatLoadSummary(summary));
        expect(true).toBe(true);
        return;
      }

      const evaluation = evaluateBaseline(cases);
      const reportPath = writeJsonReport('evaluation', { loadSummary: summary, evaluation });
      console.log(formatLoadSummary(summary));
      console.log(formatEvaluationSummary(evaluation));
      console.log(`Report: ${reportPath}`);

      expect(evaluation.totals.cases).toBe(cases.length);
    });
  });
}
