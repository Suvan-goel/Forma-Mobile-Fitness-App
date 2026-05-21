import {
  buildMlLabelAuditReport,
} from '../src/utils/exercises/ml/audits';
import {
  loadLabelReferences,
  numberArg,
  parseMlArgs,
  repoRelative,
  resolveExercise,
  stringArg,
  writeMlAuditReport,
} from './ml-audit-common';

function usage(): string {
  return [
    'Usage:',
    '  npm run ml:audit-labels -- --exercise "Barbell Curl" [--allow-drafts] [--require-severity]',
    '',
    'Options:',
    '  --exercise               Registered exercise name. Defaults to "Barbell Curl".',
    '  --allow-drafts           Do not fail solely because labels are draft.',
    '  --require-severity       Require issueSeverities for labelled positive issues.',
    '  --min-positive-per-issue Minimum positive labels before warning. Default 1.',
    '  --min-negative-per-issue Minimum negative labels before warning. Default 1.',
  ].join('\n');
}

export function runMlAuditLabelsCommand(argv = process.argv.slice(2)): void {
  const args = parseMlArgs(argv);
  if (args.help === true || args.h === true) {
    console.log(usage());
    return;
  }

  const definition = resolveExercise(stringArg(args, 'exercise'));
  const labels = loadLabelReferences(args, definition.name);
  const report = buildMlLabelAuditReport({
    definition,
    labels,
    allowDrafts: args['allow-drafts'] === true,
    requireSeverity: args['require-severity'] === true,
    minPositivePerIssue: numberArg(args, 'min-positive-per-issue', 1),
    minNegativePerIssue: numberArg(args, 'min-negative-per-issue', 1),
  });
  const reportPath = writeMlAuditReport(args, definition.name, 'label_audit', report);

  console.log(`Exercise: ${definition.name}`);
  console.log(`Labels: ${report.summary.labelFiles}`);
  console.log(`Reviewed: ${report.summary.reviewedFiles}`);
  console.log(`Draft: ${report.summary.draftFiles}`);
  console.log(`Findings: ${report.findings.length}`);
  console.log(`Passed: ${report.passed ? 'yes' : 'no'}`);
  console.log(`Report: ${repoRelative(reportPath)}`);

  if (!report.passed) process.exitCode = 1;
}

runMlAuditLabelsCommand();
