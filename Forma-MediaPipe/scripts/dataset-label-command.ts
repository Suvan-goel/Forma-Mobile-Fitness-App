import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import {
  createDraftLabelFromReplay,
  type DatasetSplit,
} from '../src/utils/exercises/dataset';
import { replayRecordingVerbose, slugifyExerciseName } from '../src/utils/exercises/replay';
import type { ExerciseDefinition } from '../src/utils/exercises/types';
import type { LandmarkRecording } from '../src/utils/exercises/replay';
import {
  DATASET_ROOT,
  readJson,
  writeJson,
} from './dataset-common';

export interface DatasetOutputPaths {
  exerciseSlug: string;
  splitFolder: string;
  videoPath: string;
  landmarkPath: string;
  labelPath: string;
  sourceVideo: string;
  landmarkFile: string;
}

export interface DraftLabelCommandOptions {
  exercise: string;
  video: string;
  landmarks: string;
  split: DatasetSplit;
  labelOut?: string;
  force: boolean;
  datasetRoot?: string;
}

export interface PrepareDatasetCommandOptions {
  exercise: string;
  video: string;
  split: DatasetSplit;
  landmarksOut?: string;
  labelOut?: string;
  force: boolean;
  datasetRoot?: string;
  description?: string;
  frameStride?: string;
  model?: string;
}

export interface DraftLabelCommandResult {
  labelPath: string;
  landmarkPath: string;
  predictedReps: number;
}

type ParsedArgs = Record<string, string | boolean>;

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function stringArg(args: ParsedArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function requiredStringArg(args: ParsedArgs, key: string): string {
  const value = stringArg(args, key);
  if (!value) throw new Error(`Missing required --${key} argument.`);
  return value;
}

function splitArg(args: ParsedArgs): DatasetSplit {
  const value = stringArg(args, 'split') ?? 'train';
  if (value !== 'train' && value !== 'validation' && value !== 'test') {
    throw new Error('--split must be train, validation, or test.');
  }
  return value;
}

export function datasetSplitFolder(split: DatasetSplit): string {
  if (split === 'train') return 'training';
  if (split === 'test') return 'testing';
  return 'validation';
}

function resolveDatasetRoot(datasetRoot?: string): string {
  return path.resolve(process.cwd(), datasetRoot ?? DATASET_ROOT);
}

function resolveUserPath(filePath: string): string {
  return path.resolve(process.cwd(), filePath);
}

function toDatasetRelativePath(datasetRoot: string, filePath: string): string {
  const relative = path.relative(datasetRoot, filePath);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/');
  }
  return filePath.split(path.sep).join('/');
}

export function readDatasetCommandArgs(): string[] {
  const raw = process.env.FORMA_DATASET_COMMAND_ARGS;
  if (!raw) return process.argv.slice(2);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
    throw new Error('FORMA_DATASET_COMMAND_ARGS must be a JSON array of strings.');
  }
  return parsed;
}

export function parseDraftLabelCommandArgs(argv: string[]): DraftLabelCommandOptions {
  const args = parseArgs(argv);
  return {
    exercise: requiredStringArg(args, 'exercise'),
    video: requiredStringArg(args, 'video'),
    landmarks: requiredStringArg(args, 'landmarks'),
    split: splitArg(args),
    labelOut: stringArg(args, 'out') ?? stringArg(args, 'label-out'),
    force: args.force === true,
    datasetRoot: stringArg(args, 'dataset-root'),
  };
}

export function parsePrepareCommandArgs(argv: string[]): PrepareDatasetCommandOptions {
  const args = parseArgs(argv);
  return {
    exercise: requiredStringArg(args, 'exercise'),
    video: requiredStringArg(args, 'video'),
    split: splitArg(args),
    landmarksOut: stringArg(args, 'landmarks-out'),
    labelOut: stringArg(args, 'out') ?? stringArg(args, 'label-out'),
    force: args.force === true,
    datasetRoot: stringArg(args, 'dataset-root'),
    description: stringArg(args, 'description'),
    frameStride: stringArg(args, 'frame-stride'),
    model: stringArg(args, 'model'),
  };
}

export function resolveExerciseDefinition(exerciseName: string): ExerciseDefinition {
  const definition = ExerciseRegistry.get(exerciseName);
  if (!definition) {
    throw new Error(
      `No registered exercise "${exerciseName}". Available exercises: ${ExerciseRegistry.list().join(', ')}`,
    );
  }
  return definition;
}

export function deriveDatasetOutputPaths(args: {
  definition: ExerciseDefinition;
  video: string;
  split?: DatasetSplit;
  landmarks?: string;
  labelOut?: string;
  datasetRoot?: string;
}): DatasetOutputPaths {
  const datasetRoot = resolveDatasetRoot(args.datasetRoot);
  const videoPath = resolveUserPath(args.video);
  const exerciseSlug = slugifyExerciseName(args.definition.name);
  const splitFolder = datasetSplitFolder(args.split ?? 'train');
  const basename = path.basename(videoPath, path.extname(videoPath));
  const landmarkPath = args.landmarks
    ? resolveUserPath(args.landmarks)
    : path.join(datasetRoot, 'landmarks', splitFolder, exerciseSlug, `${basename}.json`);
  const labelPath = args.labelOut
    ? resolveUserPath(args.labelOut)
    : path.join(datasetRoot, 'labels', splitFolder, exerciseSlug, `${basename}.json`);

  return {
    exerciseSlug,
    splitFolder,
    videoPath,
    landmarkPath,
    labelPath,
    sourceVideo: toDatasetRelativePath(datasetRoot, videoPath),
    landmarkFile: toDatasetRelativePath(datasetRoot, landmarkPath),
  };
}

export function assertFileExists(filePath: string, description: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${description} not found: ${filePath}`);
  }
}

export function assertCanWriteFile(filePath: string, force: boolean, description: string): void {
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`${description} already exists: ${filePath}. Pass --force to overwrite.`);
  }
}

export function runDraftLabelCommand(
  options: DraftLabelCommandOptions,
): DraftLabelCommandResult {
  const definition = resolveExerciseDefinition(options.exercise);
  const paths = deriveDatasetOutputPaths({
    definition,
    video: options.video,
    split: options.split,
    landmarks: options.landmarks,
    labelOut: options.labelOut,
    datasetRoot: options.datasetRoot,
  });

  assertFileExists(paths.videoPath, 'Video');
  assertFileExists(paths.landmarkPath, 'Landmark JSON');
  assertCanWriteFile(paths.labelPath, options.force, 'Label JSON');

  const recording = readJson<LandmarkRecording>(paths.landmarkPath);
  if (recording.exerciseName !== definition.name) {
    throw new Error(
      `Landmark exerciseName "${recording.exerciseName}" does not match "${definition.name}".`,
    );
  }

  const replay = replayRecordingVerbose(definition, recording);
  const label = createDraftLabelFromReplay({
    definition,
    recording,
    replay,
    sourceVideo: paths.sourceVideo,
    landmarkFile: paths.landmarkFile,
    split: options.split,
  });

  writeJson(paths.labelPath, label);
  return {
    labelPath: paths.labelPath,
    landmarkPath: paths.landmarkPath,
    predictedReps: replay.finalRepCount,
  };
}

function runExtractor(options: PrepareDatasetCommandOptions, landmarkPath: string): void {
  const scriptPath = path.resolve(process.cwd(), 'scripts/extract-video-landmarks.py');
  const args = [
    scriptPath,
    '--exercise',
    options.exercise,
    '--video',
    resolveUserPath(options.video),
    '--out',
    landmarkPath,
  ];

  if (options.description) args.push('--description', options.description);
  if (options.frameStride) args.push('--frame-stride', options.frameStride);
  if (options.model) args.push('--model', resolveUserPath(options.model));

  const result = spawnSync('python3', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Landmark extraction failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

export function runPrepareCommand(options: PrepareDatasetCommandOptions): DraftLabelCommandResult {
  const definition = resolveExerciseDefinition(options.exercise);
  const paths = deriveDatasetOutputPaths({
    definition,
    video: options.video,
    split: options.split,
    landmarks: options.landmarksOut,
    labelOut: options.labelOut,
    datasetRoot: options.datasetRoot,
  });

  assertFileExists(paths.videoPath, 'Video');
  assertCanWriteFile(paths.landmarkPath, options.force, 'Landmark JSON');
  assertCanWriteFile(paths.labelPath, options.force, 'Label JSON');

  fs.mkdirSync(path.dirname(paths.landmarkPath), { recursive: true });
  runExtractor({ ...options, exercise: definition.name }, paths.landmarkPath);

  return runDraftLabelCommand({
    exercise: definition.name,
    video: paths.videoPath,
    landmarks: paths.landmarkPath,
    split: options.split,
    labelOut: paths.labelPath,
    force: true,
    datasetRoot: options.datasetRoot,
  });
}
