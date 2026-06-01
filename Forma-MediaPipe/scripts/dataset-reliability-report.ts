import * as fs from 'fs';
import * as path from 'path';

import type { LandmarkRecording } from '../src/utils/exercises/replay';
import type { ExerciseLabelFile } from '../src/utils/exercises/dataset';
import {
  formatLandmarkRecordingReliabilityReport,
  summarizeLandmarkRecordingReliability,
} from '../src/utils/exercises/replay';
import {
  formatLoadSummary,
  loadDatasetCasesWithSummary,
} from './dataset-common';

function usage(): string {
  return [
    'Usage:',
    '  npm run dataset:reliability-report -- path/to/recording.json',
    '  npm run dataset:reliability-report -- path/to/recording.json --label path/to/label.json',
    '  npm run dataset:reliability-report -- datasets/form-heuristics/landmarks',
    '  npm run dataset:reliability-report -- datasets/form-heuristics --labelled-cases',
    '',
    'Optional:',
    '  --json-out path/to/report.json',
    '  --include-drafts        Include draft labels with --labelled-cases',
  ].join('\n');
}

function listJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return root.endsWith('.json') ? [root] : [];

  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listJsonFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(entryPath);
  }
  return result.sort();
}

function parseArgs(argv: string[]): {
  targetPath: string;
  jsonOut?: string;
  labelPath?: string;
  labelledCases: boolean;
  includeDrafts: boolean;
} {
  const args = [...argv];
  let jsonOut: string | undefined;
  let labelPath: string | undefined;
  let labelledCases = false;
  let includeDrafts = false;
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) continue;
    if (arg === '--json-out') {
      const value = args.shift();
      if (!value) throw new Error('--json-out requires a path');
      jsonOut = value;
      continue;
    }
    if (arg === '--label') {
      const value = args.shift();
      if (!value) throw new Error('--label requires a path');
      labelPath = value;
      continue;
    }
    if (arg === '--labelled-cases') {
      labelledCases = true;
      continue;
    }
    if (arg === '--include-drafts') {
      includeDrafts = true;
      continue;
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error(usage());
  }

  if (labelPath && labelledCases) {
    throw new Error('--label and --labelled-cases cannot be used together');
  }

  return { targetPath: positional[0], jsonOut, labelPath, labelledCases, includeDrafts };
}

function readRecording(filePath: string): LandmarkRecording | null {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<LandmarkRecording>;
  if (!Array.isArray(payload.frames) || typeof payload.exerciseName !== 'string') {
    return null;
  }
  return payload as LandmarkRecording;
}

function readLabel(filePath: string): ExerciseLabelFile {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ExerciseLabelFile;
}

function main(): void {
  const { targetPath, jsonOut, labelPath, labelledCases, includeDrafts } = parseArgs(process.argv.slice(2));
  const resolvedTarget = path.resolve(process.cwd(), targetPath);
  if (labelledCases) {
    const { cases, summary } = loadDatasetCasesWithSummary({
      datasetRoot: resolvedTarget,
      includeDrafts,
      logSkippedDrafts: false,
    });
    const reports = cases.map((datasetCase) => {
      const report = summarizeLandmarkRecordingReliability(datasetCase.recording, { label: datasetCase.label });
      const filePath = datasetCase.recordingPath ?? 'unknown';
      console.log(formatLandmarkRecordingReliabilityReport(report, path.relative(process.cwd(), filePath)));
      console.log('');
      return {
        filePath,
        labelPath: datasetCase.labelPath,
        report,
      };
    });

    console.log(formatLoadSummary(summary));
    if (jsonOut) {
      const resolvedOut = path.resolve(process.cwd(), jsonOut);
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      fs.writeFileSync(
        resolvedOut,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), skipped: 0, reports }, null, 2)}\n`,
        'utf-8',
      );
      console.log(`JSON report: ${path.relative(process.cwd(), resolvedOut)}`);
    }
    if (reports.length === 0) {
      throw new Error(`No labelled LandmarkRecording cases found under ${resolvedTarget}`);
    }
    return;
  }

  const files = listJsonFiles(resolvedTarget);
  if (files.length === 0) {
    throw new Error(`No JSON files found at ${resolvedTarget}`);
  }
  if (labelPath && files.length !== 1) {
    throw new Error('--label can only be used when analysing one LandmarkRecording JSON file');
  }
  const label = labelPath ? readLabel(path.resolve(process.cwd(), labelPath)) : undefined;

  const reports: Array<{
    filePath: string;
    labelPath?: string;
    report: ReturnType<typeof summarizeLandmarkRecordingReliability>;
  }> = [];
  let skipped = 0;

  for (const filePath of files) {
    const recording = readRecording(filePath);
    if (!recording) {
      skipped++;
      continue;
    }
    const report = summarizeLandmarkRecordingReliability(recording, label ? { label } : {});
    reports.push({ filePath, ...(labelPath ? { labelPath: path.resolve(process.cwd(), labelPath) } : {}), report });
    console.log(formatLandmarkRecordingReliabilityReport(report, path.relative(process.cwd(), filePath)));
    if (files.length > 1) console.log('');
  }

  if (jsonOut) {
    const resolvedOut = path.resolve(process.cwd(), jsonOut);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(
      resolvedOut,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), skipped, reports }, null, 2)}\n`,
      'utf-8',
    );
    console.log(`JSON report: ${path.relative(process.cwd(), resolvedOut)}`);
  }

  if (reports.length === 0) {
    throw new Error(`No LandmarkRecording JSON files found at ${resolvedTarget}`);
  }
  if (skipped > 0) {
    console.log(`Skipped ${skipped} JSON file(s) that did not look like LandmarkRecording files.`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
