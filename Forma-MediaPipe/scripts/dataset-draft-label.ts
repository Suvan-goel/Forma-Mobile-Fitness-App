import {
  parseDraftLabelCommandArgs,
  readDatasetCommandArgs,
  runDraftLabelCommand,
} from './dataset-label-command';

const shouldRun = process.env.FORMA_RUN_DATASET_DRAFT_LABEL === '1';

if (!shouldRun) {
  describe('Dataset draft label', () => {
    it.skip('is opt-in via npm run dataset:draft-label', () => {});
  });
} else {
  describe('Dataset draft label', () => {
    it('creates a draft label from existing landmarks', () => {
      const result = runDraftLabelCommand(parseDraftLabelCommandArgs(readDatasetCommandArgs()));
      console.log(`Wrote draft label: ${result.labelPath}`);
      console.log(`Predicted reps: ${result.predictedReps}`);
      expect(result.predictedReps).toBeGreaterThanOrEqual(0);
    });
  });
}
