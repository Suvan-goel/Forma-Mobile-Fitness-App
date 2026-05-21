import * as fs from 'fs';
import * as path from 'path';

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import type { ExerciseLabelFile } from '../src/utils/exercises/dataset';
import { slugifyExerciseName } from '../src/utils/exercises/replay';
import {
  DATASET_ROOT,
  isTemplateLabelFile,
  listJsonFiles,
  readJson,
  writeJson,
} from './dataset-common';

export type ParsedMlArgs = Record<string, string | boolean>;

export function parseMlArgs(argv: string[]): ParsedMlArgs {
  const result: ParsedMlArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

export function stringArg(args: ParsedMlArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function numberArg(args: ParsedMlArgs, key: string, fallback: number): number {
  const raw = stringArg(args, key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} must be a number.`);
  return parsed;
}

export function resolveExercise(name?: string) {
  const exerciseName = name ?? 'Barbell Curl';
  const definition = ExerciseRegistry.get(exerciseName);
  if (!definition) {
    throw new Error(`No registered exercise "${exerciseName}". Available exercises: ${ExerciseRegistry.list().join(', ')}`);
  }
  return definition;
}

export function datasetRootArg(args: ParsedMlArgs): string {
  return path.resolve(process.cwd(), stringArg(args, 'dataset-root') ?? DATASET_ROOT);
}

export function loadLabelReferences(args: ParsedMlArgs, exerciseName: string) {
  const datasetRoot = datasetRootArg(args);
  const labelsRoot = path.join(datasetRoot, 'labels');
  return listJsonFiles(labelsRoot)
    .filter((labelPath) => !isTemplateLabelFile(labelPath))
    .map((labelPath) => ({ labelPath, label: readJson<ExerciseLabelFile>(labelPath) }))
    .filter((reference) => reference.label.exerciseName === exerciseName);
}

export function writeMlAuditReport(args: ParsedMlArgs, exerciseName: string, name: string, report: unknown): string {
  const datasetRoot = datasetRootArg(args);
  const exerciseSlug = slugifyExerciseName(exerciseName);
  const outDir = path.resolve(
    process.cwd(),
    stringArg(args, 'out-dir') ?? path.join(datasetRoot, 'ml', exerciseSlug, 'audits'),
  );
  fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `${name}_${timestamp}.json`);
  writeJson(outPath, report);
  return outPath;
}

export function repoRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}
