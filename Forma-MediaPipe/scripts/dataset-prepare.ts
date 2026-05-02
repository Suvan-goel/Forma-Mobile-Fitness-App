import {
  parsePrepareCommandArgs,
  readDatasetCommandArgs,
  runPrepareCommand,
} from './dataset-label-command';

const shouldRun = process.env.FORMA_RUN_DATASET_PREPARE === '1';

if (!shouldRun) {
  describe('Dataset prepare', () => {
    it.skip('is opt-in via npm run dataset:prepare', () => {});
  });
} else {
  describe('Dataset prepare', () => {
    it('extracts landmarks and creates a draft label', () => {
      const result = runPrepareCommand(parsePrepareCommandArgs(readDatasetCommandArgs()));
      console.log(`Wrote landmarks: ${result.landmarkPath}`);
      console.log(`Wrote draft label: ${result.labelPath}`);
      console.log(`Predicted reps: ${result.predictedReps}`);
      expect(result.predictedReps).toBeGreaterThanOrEqual(0);
    });
  });
}
