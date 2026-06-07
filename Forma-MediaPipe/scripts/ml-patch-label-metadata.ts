import * as fs from 'fs';
import * as path from 'path';

import type { ExerciseCaptureMetadata, ExerciseLabelFile } from '../src/utils/exercises/dataset/types';
import {
  parseMlArgs,
  repoRelative,
  stringArg,
} from './ml-audit-common';

interface MetadataPatchEntry {
  labelPath?: string;
  patch?: {
    captureMetadata?: Partial<ExerciseCaptureMetadata>;
  };
  captureMetadata?: Partial<ExerciseCaptureMetadata>;
  metadata?: Partial<ExerciseCaptureMetadata>;
}

const REVIEWER_CONFIDENCE_VALUES = new Set(['high', 'medium', 'low', 'unknown']);
const PLACEHOLDER_VALUES = new Set([
  '',
  'todo',
  'tbd',
  'replace-me',
  'replace_me',
  '<subject-id>',
  '<session-id>',
  '<camera-setup-id>',
  'subject-unknown',
  'session-unknown',
  'camera-setup-unknown',
  'unknown-subject',
  'unknown-session',
  'unknown-camera',
]);

function usage(): string {
  return [
    'Usage:',
    '  npm run ml:patch-metadata -- --patch path/to/metadata-patch.json [--apply]',
    '',
    'Patch format:',
    '  Pass either the full ml:audit-labels report or an array of metadataPatchTemplate entries.',
    '  Fill entry.patch.captureMetadata manually before applying.',
    '',
    'Safety:',
    '  Defaults to dry-run mode.',
    '  Only captureMetadata is updated.',
    '  Empty/null placeholder metadata values are rejected.',
  ].join('\n');
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function writeJson(filePath: string, payload: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function entriesFromPayload(payload: unknown): MetadataPatchEntry[] {
  if (Array.isArray(payload)) return payload as MetadataPatchEntry[];
  if (!payload || typeof payload !== 'object') {
    throw new Error('Patch JSON must be an array, an audit report, or an object with an entries array.');
  }
  const object = payload as Record<string, unknown>;
  const entries = object.metadataPatchTemplate ?? object.entries ?? object.patches;
  if (!Array.isArray(entries)) {
    throw new Error('Patch JSON does not contain metadataPatchTemplate, entries, or patches array.');
  }
  return entries as MetadataPatchEntry[];
}

function valueIsPlaceholder(value: unknown, field: string): boolean {
  if (typeof value !== 'string') return true;
  const normalized = value.trim().toLowerCase();
  if (PLACEHOLDER_VALUES.has(normalized)) return true;
  if (field !== 'reviewerConfidence' && normalized === 'unknown') return true;
  if (field !== 'reviewerConfidence' && normalized.endsWith('-unknown')) return true;
  if (normalized.startsWith('<') && normalized.endsWith('>')) return true;
  return false;
}

function validateMetadata(labelPath: string, metadata: Partial<ExerciseCaptureMetadata>): string[] {
  const errors: string[] = [];
  if (valueIsPlaceholder(metadata.subjectId ?? metadata.participantId, 'subjectId')) {
    errors.push(`${labelPath}: provide captureMetadata.subjectId or participantId.`);
  }
  if (valueIsPlaceholder(metadata.sessionId, 'sessionId')) {
    errors.push(`${labelPath}: provide captureMetadata.sessionId.`);
  }
  if (valueIsPlaceholder(metadata.cameraSetupId, 'cameraSetupId')) {
    errors.push(`${labelPath}: provide captureMetadata.cameraSetupId.`);
  }
  if (valueIsPlaceholder(metadata.reviewerConfidence, 'reviewerConfidence')) {
    errors.push(`${labelPath}: provide captureMetadata.reviewerConfidence.`);
  } else if (!REVIEWER_CONFIDENCE_VALUES.has(String(metadata.reviewerConfidence).trim())) {
    errors.push(`${labelPath}: reviewerConfidence must be high, medium, low, or unknown.`);
  }
  return errors;
}

function metadataFromEntry(entry: MetadataPatchEntry): Partial<ExerciseCaptureMetadata> {
  return {
    ...(entry.metadata ?? {}),
    ...(entry.captureMetadata ?? {}),
    ...(entry.patch?.captureMetadata ?? {}),
  };
}

export function runMlPatchLabelMetadataCommand(argv = process.argv.slice(2)): void {
  const args = parseMlArgs(argv);
  if (args.help === true || args.h === true) {
    console.log(usage());
    return;
  }

  const patchPath = stringArg(args, 'patch');
  if (!patchPath) throw new Error('Missing --patch path.');
  const apply = args.apply === true;
  const entries = entriesFromPayload(readJson<unknown>(path.resolve(process.cwd(), patchPath)));
  const updates: Array<{
    labelPath: string;
    previousCaptureMetadata: ExerciseCaptureMetadata;
    nextCaptureMetadata: ExerciseCaptureMetadata;
  }> = [];
  const errors: string[] = [];

  for (const entry of entries) {
    const labelPath = entry.labelPath ? path.resolve(process.cwd(), entry.labelPath) : '';
    if (!labelPath) {
      errors.push('Patch entry is missing labelPath.');
      continue;
    }
    if (!fs.existsSync(labelPath)) {
      errors.push(`${labelPath}: label file does not exist.`);
      continue;
    }

    const label = readJson<ExerciseLabelFile>(labelPath);
    const previousCaptureMetadata = label.captureMetadata ?? {};
    const nextCaptureMetadata = {
      ...previousCaptureMetadata,
      ...metadataFromEntry(entry),
    };
    errors.push(...validateMetadata(labelPath, nextCaptureMetadata));
    updates.push({ labelPath, previousCaptureMetadata, nextCaptureMetadata });
  }

  if (errors.length > 0) {
    console.error('Metadata patch validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Patch entries: ${entries.length}`);
  console.log(`Validated updates: ${updates.length}`);
  console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);
  for (const update of updates) {
    console.log(`- ${repoRelative(update.labelPath)}`);
    console.log(`  from ${JSON.stringify(update.previousCaptureMetadata)}`);
    console.log(`  to   ${JSON.stringify(update.nextCaptureMetadata)}`);
  }

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to update label captureMetadata.');
    return;
  }

  for (const update of updates) {
    const label = readJson<ExerciseLabelFile>(update.labelPath);
    writeJson(update.labelPath, {
      ...label,
      captureMetadata: update.nextCaptureMetadata,
    });
  }
  console.log('Metadata patch applied.');
}

runMlPatchLabelMetadataCommand();
