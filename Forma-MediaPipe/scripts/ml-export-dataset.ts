import * as fs from 'fs';
import * as path from 'path';

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import type { DatasetSplit } from '../src/utils/exercises/dataset';
import { slugifyExerciseName } from '../src/utils/exercises/replay';
import {
  buildMlDataset,
  csvEscape,
  mlExampleBaseColumns,
  mlExampleToCsvRow,
  safeColumnPart,
} from '../src/utils/exercises/ml';
import {
  DATASET_ROOT,
  loadDatasetCasesWithSummary,
  writeJson,
} from './dataset-common';

type ParsedArgs = Record<string, string | boolean>;

const VALID_SPLITS = new Set<DatasetSplit>(['train', 'validation', 'test']);

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
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

function stringArg(args: ParsedArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseSplits(value: string | undefined): DatasetSplit[] | undefined {
  const raw = value
    ?.split(',')
    .map((split) => split.trim())
    .filter(Boolean);
  if (!raw || raw.length === 0) return undefined;

  return raw.map((split) => {
    const normalized = split === 'training'
      ? 'train'
      : split === 'testing'
        ? 'test'
        : split;
    if (!VALID_SPLITS.has(normalized as DatasetSplit)) {
      throw new Error(`Invalid split "${split}". Use train, validation, or test.`);
    }
    return normalized as DatasetSplit;
  });
}

function repoRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function writeCsv(filePath: string, rows: Record<string, string | number>[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (rows.length === 0) {
    fs.writeFileSync(filePath, '');
    return;
  }
  const columns = Object.keys(rows[0]);
  const lines = [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column] ?? '')).join(',')),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function usage(): string {
  return [
    'Usage:',
    '  npm run ml:export -- --exercise "Barbell Curl" [--include-drafts] [--splits train,validation,test]',
    '',
    'Options:',
    '  --exercise        Registered exercise name. Defaults to "Barbell Curl".',
    '  --include-drafts  Include draft labels for local smoke tests.',
    '  --splits          Comma-separated split filter.',
    '  --dataset-root    Dataset root. Defaults to datasets/form-heuristics.',
    '  --out-dir         Output directory. Defaults to <dataset-root>/ml/<exercise-slug>.',
  ].join('\n');
}

export function runMlExportDatasetCommand(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  if (args.help === true || args.h === true) {
    console.log(usage());
    return;
  }

  const exerciseName = stringArg(args, 'exercise') ?? 'Barbell Curl';
  const definition = ExerciseRegistry.get(exerciseName);
  if (!definition) {
    throw new Error(
      `No registered exercise "${exerciseName}". Available exercises: ${ExerciseRegistry.list().join(', ')}`,
    );
  }

  const datasetRoot = path.resolve(process.cwd(), stringArg(args, 'dataset-root') ?? DATASET_ROOT);
  const exerciseSlug = slugifyExerciseName(definition.name);
  const outDir = path.resolve(
    process.cwd(),
    stringArg(args, 'out-dir') ?? path.join(datasetRoot, 'ml', exerciseSlug),
  );
  const jsonlPath = path.join(outDir, 'rep_examples.jsonl');
  const csvPath = path.join(outDir, 'features.csv');
  const manifestPath = path.join(outDir, 'manifest.json');
  const includeDrafts = args['include-drafts'] === true || args.includeDrafts === true;
  const splits = parseSplits(stringArg(args, 'splits') ?? stringArg(args, 'split'));

  const { cases, summary } = loadDatasetCasesWithSummary({
    datasetRoot,
    exerciseName: definition.name,
    splits,
    includeDrafts,
    logSkippedDrafts: true,
  });

  const result = buildMlDataset({
    exerciseName: definition.name,
    definition,
    cases,
    datasetRoot: repoRelative(datasetRoot),
    includeDrafts,
    discoveredLabelFiles: summary.labelFilesDiscovered,
    outputs: {
      jsonl: repoRelative(jsonlPath),
      csv: repoRelative(csvPath),
      manifest: repoRelative(manifestPath),
    },
  });

  const featureNames = result.manifest.featureNames;
  const labelColumns = result.manifest.labelColumns;
  const heuristicIssueIds = Array.from(
    new Set([
      ...Object.keys(result.manifest.heuristicIssueCounts),
      ...Object.keys(result.manifest.issueCounts),
    ]),
  ).sort();
  const heuristicIssueColumns = heuristicIssueIds.map((issueId) => `heuristic_issue__${safeColumnPart(issueId)}`);
  const csvColumns = [
    ...mlExampleBaseColumns(),
    ...Object.values(labelColumns),
    ...heuristicIssueColumns,
    ...featureNames.map((featureName) => `feature__${featureName}`),
  ];
  const csvRows = result.examples.map((example) => {
    const row = mlExampleToCsvRow(example, featureNames, labelColumns, heuristicIssueIds);
    return Object.fromEntries(csvColumns.map((column) => [column, row[column] ?? '']));
  });

  writeJsonl(jsonlPath, result.examples);
  writeCsv(csvPath, csvRows);
  writeJson(manifestPath, result.manifest);

  console.log(`Exercise: ${definition.name}`);
  console.log(`Cases loaded: ${cases.length}`);
  console.log(`Examples exported: ${result.examples.length}`);
  console.log(`JSONL: ${repoRelative(jsonlPath)}`);
  console.log(`CSV: ${repoRelative(csvPath)}`);
  console.log(`Manifest: ${repoRelative(manifestPath)}`);
}

runMlExportDatasetCommand();
