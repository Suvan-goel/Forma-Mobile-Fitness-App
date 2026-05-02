#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const command = process.argv[2];
const args = process.argv.slice(3);
const jestPassthroughFlags = new Set(['--silent']);
const jestArgs = args.filter((arg) => jestPassthroughFlags.has(arg));
const datasetArgs = args.filter((arg) => !jestPassthroughFlags.has(arg));

const commands = {
  'draft-label': {
    env: 'FORMA_RUN_DATASET_DRAFT_LABEL',
    testFile: 'scripts/dataset-draft-label.ts',
  },
  prepare: {
    env: 'FORMA_RUN_DATASET_PREPARE',
    testFile: 'scripts/dataset-prepare.ts',
  },
};

const selected = commands[command];
if (!selected) {
  console.error(`Unknown dataset command "${command}". Use draft-label or prepare.`);
  process.exit(1);
}

const jestBin = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'jest.cmd' : 'jest',
);

const result = spawnSync(
  jestBin,
  [selected.testFile, '--runInBand', '--no-coverage', '--verbose', ...jestArgs],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      [selected.env]: '1',
      FORMA_DATASET_COMMAND_ARGS: JSON.stringify(datasetArgs),
    },
  },
);

process.exit(result.status ?? 1);
