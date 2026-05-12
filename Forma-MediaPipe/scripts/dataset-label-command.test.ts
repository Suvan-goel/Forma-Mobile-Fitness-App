import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { UNSCORED_REP_FEEDBACK } from '../src/utils/exercises/shared/poseQuality';
import type { LandmarkRecording } from '../src/utils/exercises/replay';
import type { Keypoint } from '../src/utils/poseAnalysis';
import {
  assertCanWriteFile,
  assertFileExists,
  datasetSplitFolder,
  deriveDatasetOutputPaths,
  parseDraftLabelCommandArgs,
  parsePrepareCommandArgs,
  resolveExerciseDefinition,
  runDraftLabelCommand,
} from './dataset-label-command';

const FRAME_MS = 50;
const EXTENDED_WRIST_Y = 0.6;
const TOP_WRIST_Y = 1.2;

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function kp(name: string, x: number, y: number, z: number, score = 0.99): Keypoint {
  return { name, x, y, z, score };
}

function interpolate(from: number, to: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => {
    const p = frames <= 1 ? 1 : index / (frames - 1);
    return from + (to - from) * p;
  });
}

function fullCurlPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
    ...Array(4).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 18),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function armKeypoints(
  side: 'left' | 'right',
  x: number,
  z: number,
  wristY: number,
  visible: boolean,
  index: number,
  jitterOffset: number,
): Keypoint[] {
  const lowTrackingSample = index >= 16 && index <= 54 && index % 4 !== 0;
  const elbowScore = visible && !lowTrackingSample ? 0.99 : 0.05;
  const shoulderY = 1.4;
  const elbowY = 1.0;
  const elbowOffset = visible && index >= 20 && index <= 48 ? 1.0 : 0;
  const shiftedX = x + jitterOffset;
  const elbowX = shiftedX + (side === 'left' ? -elbowOffset : elbowOffset);

  return [
    kp(`${side}_shoulder`, shiftedX, shoulderY, z),
    kp(`${side}_elbow`, elbowX, elbowY, z, elbowScore),
    kp(`${side}_wrist`, shiftedX, wristY, z, elbowScore),
    kp(`${side}_index`, shiftedX, wristY + (wristY - elbowY) * 0.2, z, visible ? 0.99 : 0.05),
    kp(`${side}_hip`, shiftedX, 0.5, z),
  ];
}

function barbellCurlUnscorableBadFormRecording(): LandmarkRecording {
  const pathValues = fullCurlPath();
  return {
    exerciseName: 'Barbell Curl',
    metadata: {
      recordedAt: '2026-05-09T00:00:00.000Z',
      duration: (pathValues.length * FRAME_MS) / 1000,
      description: 'synthetic unscorable side-left curl with shoulder involvement',
    },
    frames: pathValues.map((wristY, index) => ({
      timestamp: index * FRAME_MS,
      keypoints: [
        kp('nose', 0, 1.72, -0.05),
        ...armKeypoints('left', -0.035, -0.25, wristY, true, index, index % 2 === 0 ? -0.22 : 0.22),
        ...armKeypoints('right', 0.035, 0.25, wristY, false, index, index % 2 === 0 ? -0.22 : 0.22),
      ],
    })),
  };
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
    const videoPath = path.join(root, 'videos/training/barbell-squat/squat_001.mp4');

    const paths = deriveDatasetOutputPaths({
      definition,
      video: videoPath,
      split: 'train',
      datasetRoot: root,
    });

    expect(paths.exerciseSlug).toBe('barbell-squat');
    expect(paths.splitFolder).toBe('training');
    expect(paths.landmarkPath).toBe(path.join(root, 'landmarks/training/barbell-squat/squat_001.json'));
    expect(paths.labelPath).toBe(path.join(root, 'labels/training/barbell-squat/squat_001.json'));
    expect(paths.sourceVideo).toBe('videos/training/barbell-squat/squat_001.mp4');
    expect(paths.landmarkFile).toBe('landmarks/training/barbell-squat/squat_001.json');
  });

  it('maps dataset split values to readable folder names', () => {
    expect(datasetSplitFolder('train')).toBe('training');
    expect(datasetSplitFolder('validation')).toBe('validation');
    expect(datasetSplitFolder('test')).toBe('testing');
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
    const videoPath = path.join(root, 'videos/training/barbell-squat/squat_001.mp4');
    const landmarkPath = path.join(root, 'landmarks/training/barbell-squat/squat_001.json');
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
      sourceVideo: 'videos/training/barbell-squat/squat_001.mp4',
      landmarkFile: 'landmarks/training/barbell-squat/squat_001.json',
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

  it('confidence-gates draft suggestions for unscorable Barbell Curl reps', () => {
    const videoPath = path.join(root, 'videos/training/barbell-curl/curl_001.mp4');
    const landmarkPath = path.join(root, 'landmarks/training/barbell-curl/curl_001.json');
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    fs.writeFileSync(videoPath, '');
    writeJson(landmarkPath, barbellCurlUnscorableBadFormRecording());

    const result = runDraftLabelCommand({
      exercise: 'Barbell Curl',
      video: videoPath,
      landmarks: landmarkPath,
      split: 'train',
      force: false,
      datasetRoot: root,
    });

    const label = JSON.parse(fs.readFileSync(result.labelPath, 'utf-8'));
    expect(label.expectedReps).toBe(1);
    expect(label.reps[0]).toMatchObject({
      scorable: false,
      suggestedIssueIds: [],
    });
    expect(label.reps[0].suggestedFeedbackMessages[0]).toContain(UNSCORED_REP_FEEDBACK);
  });
});
