import * as fs from 'fs';
import * as path from 'path';

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import {
  formatCameraStatusReplayReport,
  replayCameraAnalysisStatus,
  type CameraStatusReplayOptions,
  type CameraStatusReplayReport,
  type LandmarkRecording,
} from '../src/utils/exercises/replay';

const DEFAULT_CAMERA_STATUS_REPORT_DIR = path.join(
  'datasets',
  'form-heuristics',
  'reports',
  'camera-status',
);

function usage(): string {
  return [
    'Usage:',
    '  npm run dataset:camera-status-report -- path/to/recording.json',
    '  npm run dataset:camera-status-report -- datasets/form-heuristics/landmarks',
    '',
    'Optional:',
    `  --json-out path/to/report.json  Override default JSON output under ${DEFAULT_CAMERA_STATUS_REPORT_DIR}`,
    '  --include-frames                  Include per-frame status traces in JSON',
    '  --no-synthesize-gaps             Do not insert diagnostic no-pose samples into long silent gaps',
    '  --gap-threshold-ms 1000          Minimum timestamp gap before synthetic no-pose samples are inserted',
    '  --gap-frame-ms 33                Synthetic no-pose frame cadence inside long gaps',
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

function readPositiveNumberFlag(args: string[], flag: string): number {
  const value = args.shift();
  if (!value) throw new Error(`${flag} requires a number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function parseArgs(argv: string[]): {
  targetPath: string;
  jsonOut?: string;
  replayOptions: CameraStatusReplayOptions;
} {
  const args = [...argv];
  const positional: string[] = [];
  let jsonOut: string | undefined;
  const replayOptions: CameraStatusReplayOptions = {};

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) continue;
    if (arg === '--json-out') {
      const value = args.shift();
      if (!value) throw new Error('--json-out requires a path');
      jsonOut = value;
      continue;
    }
    if (arg === '--include-frames') {
      replayOptions.includeFrames = true;
      continue;
    }
    if (arg === '--no-synthesize-gaps') {
      replayOptions.synthesizeSilentGapFrames = false;
      continue;
    }
    if (arg === '--gap-threshold-ms') {
      replayOptions.syntheticGapThresholdMs = readPositiveNumberFlag(args, arg);
      continue;
    }
    if (arg === '--gap-frame-ms') {
      replayOptions.syntheticGapFrameIntervalMs = readPositiveNumberFlag(args, arg);
      continue;
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error(usage());
  }

  return { targetPath: positional[0], jsonOut, replayOptions };
}

function readRecording(filePath: string): LandmarkRecording | null {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<LandmarkRecording>;
  if (!Array.isArray(payload.frames) || typeof payload.exerciseName !== 'string') {
    return null;
  }
  return payload as LandmarkRecording;
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeFilenamePart(value: string): string {
  return value
    .replace(/\.json$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'camera-status-report';
}

function defaultJsonOutPath(resolvedTarget: string): string {
  const targetStat = fs.existsSync(resolvedTarget) ? fs.statSync(resolvedTarget) : null;
  const baseName = targetStat?.isFile()
    ? safeFilenamePart(path.basename(resolvedTarget))
    : `${safeFilenamePart(path.basename(resolvedTarget))}-${timestampForFilename()}`;
  return path.join(DEFAULT_CAMERA_STATUS_REPORT_DIR, `${baseName}.json`);
}

function writeJsonReport(filePath: string, payload: unknown): void {
  const resolvedOut = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(`JSON report: ${path.relative(process.cwd(), resolvedOut)}`);
}

function runReport(filePath: string, replayOptions: CameraStatusReplayOptions): {
  filePath: string;
  report: CameraStatusReplayReport;
} | null {
  const recording = readRecording(filePath);
  if (!recording) return null;

  const definition = ExerciseRegistry.get(recording.exerciseName);
  if (!definition) {
    throw new Error(
      `No registered exercise "${recording.exerciseName}" for ${filePath}. Registered exercises: ${ExerciseRegistry.list().join(', ')}`,
    );
  }

  return {
    filePath,
    report: replayCameraAnalysisStatus(definition, recording, replayOptions),
  };
}

function main(): void {
  const { targetPath, jsonOut, replayOptions } = parseArgs(process.argv.slice(2));
  const resolvedTarget = path.resolve(process.cwd(), targetPath);
  const resolvedJsonOut = jsonOut ?? defaultJsonOutPath(resolvedTarget);
  const files = listJsonFiles(resolvedTarget);
  if (files.length === 0) {
    throw new Error(`No JSON files found at ${resolvedTarget}`);
  }

  const reports: Array<{ filePath: string; report: CameraStatusReplayReport }> = [];
  let skipped = 0;

  for (const filePath of files) {
    const result = runReport(filePath, replayOptions);
    if (!result) {
      skipped++;
      continue;
    }
    reports.push(result);
    console.log(formatCameraStatusReplayReport(result.report, path.relative(process.cwd(), filePath)));
    if (files.length > 1) console.log('');
  }

  if (reports.length === 0) {
    throw new Error(`No LandmarkRecording JSON files found at ${resolvedTarget}`);
  }

  const payload = reports.length === 1
    ? { generatedAt: new Date().toISOString(), skipped, ...reports[0] }
    : { generatedAt: new Date().toISOString(), skipped, reports };
  writeJsonReport(resolvedJsonOut, payload);
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
