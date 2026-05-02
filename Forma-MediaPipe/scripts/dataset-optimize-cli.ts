#!/usr/bin/env node

import { runDatasetOptimizeCommand } from './dataset-optimize';

try {
  runDatasetOptimizeCommand(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
