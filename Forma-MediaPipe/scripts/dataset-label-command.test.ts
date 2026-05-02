import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  assertCanWriteFile,
  assertFileExists,
  deriveDatasetOutputPaths,
  parseDraftLabelCommandArgs,
  parsePrepareCommandArgs,
  resolveExerciseDefinition,
  runDraftLabelCommand,
} from './dataset-label-command';

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

describe('dataset label commands', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-dataset-command-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('derives default output paths from exercise slug and video basename', () => {
    const definition = resolveExerciseDefinition('Barbell Squat');
    const videoPath = path.join(root, 'videos/barbell-squat/squat_001.mp4');

    const paths = deriveDatasetOutputPaths({ definition, video: videoPath, datasetRoot: root });

    expect(paths.exerciseSlug).toBe('barbell-squat');
    expect(paths.landmarkPath).toBe(path.join(root, 'landmarks/barbell-squat/squat_001.json'));
    expect(paths.labelPath).toBe(path.join(root, 'labels/barbell-squat/squat_001.json'));
    expect(paths.sourceVideo).toBe('videos/barbell-squat/squat_001.mp4');
    expect(paths.landmarkFile).toBe('landmarks/barbell-squat/squat_001.json');
  });

  it('refuses existing outputs unless force is enabled', () => {
    const target = path.join(root, 'labels/barbell-squat/squat_001.json');
    writeJson(target, {});

    expect(() => assertCanWriteFile(target, false, 'Label JSON')).toThrow(/Pass --force/);
    expect(() => assertCanWriteFile(target, true, 'Label JSON')).not.toThrow();
  });

  it('validates invalid exercises and missing files', () => {
    expect(() => resolveExerciseDefinition('No Such Exercise')).toThrow(/No registered exercise/);
    expect(() => assertFileExists(path.join(root, 'missing.json'), 'Landmark JSON')).toThrow(/not found/);
  });

  it('parses command arguments with safe defaults', () => {
    expect(
      parseDraftLabelCommandArgs([
        '--exercise',
        'Barbell Squat',
        '--video',
        'video.mp4',
        '--landmarks',
        'landmarks.json',
      ]),
    ).toMatchObject({ split: 'train', force: false });
    expect(
      parsePrepareCommandArgs([
        '--exercise',
        'Barbell Squat',
        '--video',
        'video.mp4',
        '--split',
        'validation',
        '--force',
      ]),
    ).toMatchObject({ split: 'validation', force: true });
  });

  it('creates a draft label from landmarks and protects it from accidental overwrite', () => {
    const videoPath = path.join(root, 'videos/barbell-squat/squat_001.mp4');
    const landmarkPath = path.join(root, 'landmarks/barbell-squat/squat_001.json');
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    fs.writeFileSync(videoPath, '');
    writeJson(landmarkPath, {
      exerciseName: 'Barbell Squat',
      metadata: {},
      frames: [],
    });

    const result = runDraftLabelCommand({
      exercise: 'Barbell Squat',
      video: videoPath,
      landmarks: landmarkPath,
      split: 'train',
      force: false,
      datasetRoot: root,
    });

    const label = JSON.parse(fs.readFileSync(result.labelPath, 'utf-8'));
    expect(label).toMatchObject({
      exerciseName: 'Barbell Squat',
      reviewStatus: 'draft',
      expectedReps: 0,
      reps: [],
      sourceVideo: 'videos/barbell-squat/squat_001.mp4',
      landmarkFile: 'landmarks/barbell-squat/squat_001.json',
    });

    expect(() =>
      runDraftLabelCommand({
        exercise: 'Barbell Squat',
        video: videoPath,
        landmarks: landmarkPath,
        split: 'train',
        force: false,
        datasetRoot: root,
      }),
    ).toThrow(/Pass --force/);

    expect(() =>
      runDraftLabelCommand({
        exercise: 'Barbell Squat',
        video: videoPath,
        landmarks: landmarkPath,
        split: 'train',
        force: true,
        datasetRoot: root,
      }),
    ).not.toThrow();
  });
});
