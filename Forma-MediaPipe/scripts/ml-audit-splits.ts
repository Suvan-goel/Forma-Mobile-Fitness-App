import {
  buildMlSplitAuditReport,
} from '../src/utils/exercises/ml/audits';
import {
  loadLabelReferences,
  parseMlArgs,
  repoRelative,
  resolveExercise,
  stringArg,
  writeMlAuditReport,
} from './ml-audit-common';

function usage(): string {
  return [
    'Usage:',
    '  npm run ml:audit-splits -- --exercise "Barbell Curl"',
    '',
    'Options:',
    '  --exercise                    Registered exercise name. Defaults to "Barbell Curl".',
    '  --include-drafts              Include draft labels in split auditing.',
    '  --allow-camera-setup-overlap  Permit the same cameraSetupId across splits.',
  ].join('\n');
}

export function runMlAuditSplitsCommand(argv = process.argv.slice(2)): void {
  const args = parseMlArgs(argv);
  if (args.help === true || args.h === true) {
    console.log(usage());
    return;
  }

  const definition = resolveExercise(stringArg(args, 'exercise'));
  const labels = loadLabelReferences(args, definition.name);
  const report = buildMlSplitAuditReport({
    definition,
    labels,
    includeDrafts: args['include-drafts'] === true,
    allowCameraSetupAcrossSplits: args['allow-camera-setup-overlap'] === true,
  });
  const reportPath = writeMlAuditReport(args, definition.name, 'split_audit', report);

  console.log(`Exercise: ${definition.name}`);
  console.log(`Labels audited: ${report.summary.labelFiles}`);
  console.log(`Grouping policy: ${report.summary.groupingPolicy}`);
  console.log(`Findings: ${report.findings.length}`);
  console.log(`Passed: ${report.passed ? 'yes' : 'no'}`);
  console.log(`Report: ${repoRelative(reportPath)}`);

  if (!report.passed) process.exitCode = 1;
}

runMlAuditSplitsCommand();
