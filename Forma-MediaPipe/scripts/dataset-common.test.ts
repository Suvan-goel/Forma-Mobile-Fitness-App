import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isTemplateLabelFile, loadDatasetCases, loadDatasetCasesWithSummary } from './dataset-common';

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

describe('dataset case loading', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-dataset-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('ignores templates and draft labels by default while keeping reviewed and legacy labels', () => {
    writeJson(path.join(root, 'labels/barbell-squat/_template.json'), { not: 'a real label' });
    writeJson(path.join(root, 'labels/barbell-squat/draft.json'), {
      schemaVersion: 1,
      exerciseName: 'Barbell Squat',
      sourceVideo: 'videos/barbell-squat/draft.mp4',
      landmarkFile: 'landmarks/barbell-squat/draft.json',
      split: 'train',
      reviewStatus: 'draft',
      expectedReps: 0,
      reps: [],
    });
    writeJson(path.join(root, 'labels/barbell-squat/reviewed.json'), {
      schemaVersion: 1,
      exerciseName: 'Barbell Squat',
      sourceVideo: 'videos/barbell-squat/reviewed.mp4',
      landmarkFile: 'landmarks/barbell-squat/reviewed.json',
      split: 'train',
      reviewStatus: 'reviewed',
      expectedReps: 0,
      reps: [],
    });
    writeJson(path.join(root, 'labels/barbell-squat/legacy.json'), {
      schemaVersion: 1,
      exerciseName: 'Barbell Squat',
      sourceVideo: 'videos/barbell-squat/legacy.mp4',
      landmarkFile: 'landmarks/barbell-squat/legacy.json',
      split: 'train',
      expectedReps: 0,
      reps: [],
    });
    for (const name of ['draft', 'reviewed', 'legacy']) {
      writeJson(path.join(root, `landmarks/barbell-squat/${name}.json`), {
        exerciseName: 'Barbell Squat',
        metadata: {},
        frames: [],
      });
    }

    const cases = loadDatasetCases({ datasetRoot: root, logSkippedDrafts: false });

    expect(cases.map((datasetCase) => datasetCase.label.sourceVideo).sort()).toEqual([
      'videos/barbell-squat/legacy.mp4',
      'videos/barbell-squat/reviewed.mp4',
    ]);
    expect(loadDatasetCases({ datasetRoot: root, includeDrafts: true, logSkippedDrafts: false })).toHaveLength(3);
  });

  it('recognizes supported template filenames', () => {
    expect(isTemplateLabelFile('/tmp/labels/barbell-squat/_template.json')).toBe(true);
    expect(isTemplateLabelFile('/tmp/labels/barbell-squat/example.template.json')).toBe(true);
    expect(isTemplateLabelFile('/tmp/labels/barbell-squat/example.json')).toBe(false);
  });

  it('filters by exercise before reading landmark files', () => {
    writeJson(path.join(root, 'labels/barbell-squat/reviewed.json'), {
      schemaVersion: 1,
      exerciseName: 'Barbell Squat',
      sourceVideo: 'videos/barbell-squat/reviewed.mp4',
      landmarkFile: 'landmarks/barbell-squat/reviewed.json',
      split: 'train',
      reviewStatus: 'reviewed',
      expectedReps: 0,
      reps: [],
    });
    writeJson(path.join(root, 'labels/push-up/missing-landmarks.json'), {
      schemaVersion: 1,
      exerciseName: 'Push-up',
      sourceVideo: 'videos/push-up/missing-landmarks.mp4',
      landmarkFile: 'landmarks/push-up/missing-landmarks.json',
      split: 'train',
      reviewStatus: 'reviewed',
      expectedReps: 0,
      reps: [],
    });
    writeJson(path.join(root, 'landmarks/barbell-squat/reviewed.json'), {
      exerciseName: 'Barbell Squat',
      metadata: {},
      frames: [],
    });

    const { cases, summary } = loadDatasetCasesWithSummary({
      datasetRoot: root,
      exerciseName: 'Barbell Squat',
      logSkippedDrafts: false,
    });

    expect(cases).toHaveLength(1);
    expect(summary.exerciseLabelsSkipped).toBe(1);
    expect(summary.landmarkFilesRead).toBe(1);
  });
});
