/**
 * Generic Replay Tests — auto-discovers recordings and runs them
 * against the matching ExerciseDefinition from the registry.
 *
 * To add a test for any exercise:
 *   1. Record landmarks on-device (start/stop a set in dev mode)
 *   2. Save the JSON to __tests__/recordings/<name>.json
 *   3. Run `npm test` — it picks up the file automatically
 */

import * as fs from 'fs';
import * as path from 'path';
import { replayRecording } from './replayRunner';
import '../definitions/register';
import { ExerciseRegistry } from '../ExerciseRegistry';
import type { LandmarkRecording } from './types';

const RECORDINGS_DIR = path.join(__dirname, 'recordings');

function discoverRecordings(): Array<{ filename: string; recording: LandmarkRecording }> {
  if (!fs.existsSync(RECORDINGS_DIR)) return [];
  return fs
    .readdirSync(RECORDINGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(filename => ({
      filename,
      recording: JSON.parse(
        fs.readFileSync(path.join(RECORDINGS_DIR, filename), 'utf-8'),
      ) as LandmarkRecording,
    }));
}

const recordings = discoverRecordings();

if (recordings.length === 0) {
  describe('Replay Tests', () => {
    it('no recordings found — add JSON files to __tests__/recordings/', () => {
      // Placeholder so Jest doesn't report an empty suite
    });
  });
} else {
  describe.each(recordings)('$filename', ({ recording }) => {
    const definition = ExerciseRegistry.get(recording.exerciseName);

    if (!definition) {
      it(`should have a registered definition for "${recording.exerciseName}"`, () => {
        throw new Error(
          `No ExerciseDefinition found for "${recording.exerciseName}". ` +
          `Is it registered in definitions/register.ts?`,
        );
      });
      return;
    }

    it('counts the expected number of reps', () => {
      const result = replayRecording(definition, recording);
      expect(result.finalRepCount).toBe(recording.metadata.expectedReps);
    });

    it('scores within the expected range', () => {
      const [minScore, maxScore] = recording.metadata.expectedScoreRange;
      const result = replayRecording(definition, recording);
      result.repScores.forEach(score => {
        expect(score).toBeGreaterThanOrEqual(minScore);
        expect(score).toBeLessThanOrEqual(maxScore);
      });
    });
  });
}
