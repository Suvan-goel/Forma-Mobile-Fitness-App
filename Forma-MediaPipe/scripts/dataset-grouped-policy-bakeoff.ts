/**
 * Grouped Feedback Policy Bake-off
 * ================================
 * Compares user-facing grouped-feedback decision policies head-to-head, per rep,
 * against the labeled Barbell Curl dataset. Focus metric: when a rep has a real
 * fault, does the single selected message name the RIGHT group?
 *
 * Policies:
 *   A — current runtime: frozen ML grouped policy + repeated-evidence fallback
 *       (both feature flags on, exactly what users see in dev today)
 *   B — heuristic-grouped: post-suppression heuristic fine issues mapped to
 *       grouped messages via the taxonomy; highest-priority group wins
 *   C — tiered heuristic: strong per-rep evidence fires immediately
 *       (fail-tier issues, large flex margin); weak evidence requires the same
 *       group on the previous rep too; tempo always requires repetition
 *
 * Outcomes per labeled scorable rep:
 *   clean rep   → correct_silence | false_positive
 *   faulty rep  → correct_name | wrong_name | missed
 *
 * Run:  npx tsx scripts/dataset-grouped-policy-bakeoff.ts
 * Output: console tables + datasets/form-heuristics/ml/barbell-curl/policy_bakeoff_latest.json
 */
import * as fs from 'fs';
import * as path from 'path';

// IMPORTANT: keep ML flags OFF while the dataset is built so replay produces
// pure heuristic outputs; flags are enabled only around the Policy A predict loop.
delete process.env.EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
delete process.env.EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FALLBACK_FEEDBACK;
delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import { buildMlDataset } from '../src/utils/exercises/ml';
import type { MlRepExample } from '../src/utils/exercises/ml/types';
import {
  predictBarbellCurlGroupedFeedback,
  createBarbellCurlGroupedFallbackShadowState,
  BARBELL_CURL_GROUPED_FEEDBACK_POLICY,
  BARBELL_CURL_GROUPED_FEEDBACK_FLAG,
  BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG,
} from '../src/utils/exercises/ml/runtime/barbellCurlGroupedFeedback';
import { getGroupedFeedbackGroupForFineIssueId } from '../src/utils/exercises/groupedFeedback';
import { DATASET_ROOT, loadDatasetCasesWithSummary } from './dataset-common';

const EXERCISE_NAME = 'Barbell Curl';
const GROUP_NONE = '(none)';
const ROM_STRONG_FLEX_MARGIN = 0.08;
const FLEX_MARGIN_FEATURE = 'diagnostic.cue.barbell_curl_incomplete_flex.margin';

type PolicyId = 'A_ml_plus_fallback' | 'B_heuristic_grouped' | 'C_tiered_heuristic';
const POLICY_IDS: PolicyId[] = ['A_ml_plus_fallback', 'B_heuristic_grouped', 'C_tiered_heuristic'];

const GROUP_PRIORITY: Record<string, number> = Object.fromEntries(
  BARBELL_CURL_GROUPED_FEEDBACK_POLICY.groups.map((group) => [group.id, group.priority]),
);

function shortGroup(groupId: string): string {
  return groupId.replace('barbell-curl.', '').replace('_issue', '');
}

function groupsForFineIssues(fineIssueIds: readonly string[]): string[] {
  const groups = new Set<string>();
  for (const fineId of fineIssueIds) {
    const group = getGroupedFeedbackGroupForFineIssueId(EXERCISE_NAME, fineId);
    if (group) groups.add(group.id);
  }
  return Array.from(groups);
}

function highestPriorityGroup(groups: readonly string[]): string | null {
  if (groups.length === 0) return null;
  return groups
    .slice()
    .sort((a, b) => (GROUP_PRIORITY[b] ?? 0) - (GROUP_PRIORITY[a] ?? 0))[0];
}

function prefixedFeatures(features: Record<string, number | null>): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(features).map(([key, value]) => [
      key.startsWith('feature__') ? key : `feature__${key}`,
      value,
    ]),
  );
}

interface RepOutcome {
  labelFile: string;
  split: string;
  repIndex: number;
  truthFine: string[];
  truthGroups: string[];
  primaryTruthGroup: string;
  heuristicFine: string[];
  selections: Record<PolicyId, string>;
}

interface PolicyTally {
  cleanReps: number;
  cleanFalsePositives: number;
  faultyReps: number;
  correctName: number;
  wrongName: number;
  missed: number;
  confusion: Record<string, Record<string, number>>;
  wrongNamePairs: Record<string, number>;
  wrongNameExamples: Record<string, string[]>;
}

function newTally(): PolicyTally {
  return {
    cleanReps: 0,
    cleanFalsePositives: 0,
    faultyReps: 0,
    correctName: 0,
    wrongName: 0,
    missed: 0,
    confusion: {},
    wrongNamePairs: {},
    wrongNameExamples: {},
  };
}

function recordOutcome(tally: PolicyTally, outcome: RepOutcome, policy: PolicyId): void {
  const selected = outcome.selections[policy];
  const truthKey = outcome.truthGroups.length === 0 ? GROUP_NONE : outcome.primaryTruthGroup;
  tally.confusion[truthKey] = tally.confusion[truthKey] ?? {};
  tally.confusion[truthKey][selected] = (tally.confusion[truthKey][selected] ?? 0) + 1;

  if (outcome.truthGroups.length === 0) {
    tally.cleanReps += 1;
    if (selected !== GROUP_NONE) tally.cleanFalsePositives += 1;
    return;
  }

  tally.faultyReps += 1;
  if (selected === GROUP_NONE) {
    tally.missed += 1;
  } else if (outcome.truthGroups.includes(selected)) {
    tally.correctName += 1;
  } else {
    tally.wrongName += 1;
    const pair = `${shortGroup(outcome.primaryTruthGroup)}→${shortGroup(selected)}`;
    tally.wrongNamePairs[pair] = (tally.wrongNamePairs[pair] ?? 0) + 1;
    tally.wrongNameExamples[pair] = tally.wrongNameExamples[pair] ?? [];
    if (tally.wrongNameExamples[pair].length < 5) {
      tally.wrongNameExamples[pair].push(`${outcome.labelFile}#rep${outcome.repIndex}`);
    }
  }
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function printTally(label: string, tallies: Record<PolicyId, PolicyTally>): void {
  console.log(`\n${'═'.repeat(76)}`);
  console.log(`  ${label}`);
  console.log('═'.repeat(76));
  console.log(
    '  policy                     | clean FP rate | correct name | wrong name | missed',
  );
  console.log(`  ${'-'.repeat(74)}`);
  for (const policy of POLICY_IDS) {
    const t = tallies[policy];
    console.log(
      `  ${policy.padEnd(26)} | ` +
        `${pct(t.cleanFalsePositives, t.cleanReps).padStart(8)} (${t.cleanFalsePositives}/${t.cleanReps})`.padEnd(15) +
        ` | ${pct(t.correctName, t.faultyReps).padStart(7)} (${t.correctName})`.padEnd(15) +
        ` | ${pct(t.wrongName, t.faultyReps).padStart(6)} (${t.wrongName})`.padEnd(13) +
        ` | ${pct(t.missed, t.faultyReps).padStart(6)} (${t.missed})`,
    );
  }
}

function printConfusion(policy: PolicyId, tally: PolicyTally): void {
  const truthKeys = Object.keys(tally.confusion).sort();
  const selectedKeys = Array.from(
    new Set(truthKeys.flatMap((truth) => Object.keys(tally.confusion[truth]))),
  ).sort();
  console.log(`\n  Confusion matrix — ${policy} (rows: primary truth, cols: selected)`);
  const header = ['truth\\selected', ...selectedKeys.map(shortGroup)].map((h) => h.padEnd(10)).join(' ');
  console.log(`    ${header}`);
  for (const truth of truthKeys) {
    const row = [
      shortGroup(truth).padEnd(14),
      ...selectedKeys.map((sel) => String(tally.confusion[truth][sel] ?? 0).padEnd(10)),
    ].join(' ');
    console.log(`    ${row}`);
  }
  const pairs = Object.entries(tally.wrongNamePairs).sort((a, b) => b[1] - a[1]);
  if (pairs.length > 0) {
    console.log(`  Top wrong-name patterns — ${policy}:`);
    for (const [pair, count] of pairs.slice(0, 6)) {
      console.log(`    ${pair} ×${count}   e.g. ${tally.wrongNameExamples[pair].slice(0, 3).join(', ')}`);
    }
  }
}

function main(): void {
  const definition = ExerciseRegistry.get(EXERCISE_NAME);
  if (!definition) throw new Error(`No definition for ${EXERCISE_NAME}`);

  const datasetRoot = path.resolve(process.cwd(), DATASET_ROOT);
  const { cases, summary } = loadDatasetCasesWithSummary({
    datasetRoot,
    exerciseName: EXERCISE_NAME,
    includeDrafts: false,
    logSkippedDrafts: false,
  });
  console.log(`Cases loaded: ${cases.length} (label files discovered: ${summary.labelFilesDiscovered})`);

  const dataset = buildMlDataset({
    exerciseName: EXERCISE_NAME,
    definition,
    cases,
    datasetRoot: 'datasets/form-heuristics',
    includeDrafts: false,
    discoveredLabelFiles: summary.labelFilesDiscovered,
    outputs: { jsonl: '', csv: '', manifest: '' },
  });
  console.log(`Rep examples: ${dataset.examples.length}`);

  // Group examples by label file, preserve rep order.
  const byRecording = new Map<string, MlRepExample[]>();
  for (const example of dataset.examples) {
    const key = example.labelFile ?? example.sourceVideo;
    if (!byRecording.has(key)) byRecording.set(key, []);
    byRecording.get(key)!.push(example);
  }
  for (const reps of byRecording.values()) {
    reps.sort((a, b) => a.timing.expectedStartMs - b.timing.expectedStartMs);
  }

  // Enable flags ONLY for the Policy A runtime predictions (user-facing path).
  process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '1';
  process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG] = '1';

  const outcomes: RepOutcome[] = [];
  const unmappedFineIssues = new Set<string>();
  let unmatchedReps = 0;
  let unscorableReps = 0;

  for (const [labelFile, reps] of byRecording) {
    const fallbackState = createBarbellCurlGroupedFallbackShadowState();
    let prevHeuristicGroups: string[] = [];

    for (const example of reps) {
      // Track unmapped fine label issues for transparency.
      for (const fineId of example.labels.issueIds) {
        if (!getGroupedFeedbackGroupForFineIssueId(EXERCISE_NAME, fineId)) {
          unmappedFineIssues.add(fineId);
        }
      }

      if (example.timing.predictedStartMs === null) {
        unmatchedReps += 1;
        continue;
      }
      // Policy A must see every matched rep to keep fallback evidence sequential,
      // so run it before the scorable filter.
      const mlResult = predictBarbellCurlGroupedFeedback({
        features: prefixedFeatures(example.features as Record<string, number | null>),
        heuristicIssueIds: example.heuristic.issueIds,
        repIndex: example.repIndex,
        fallbackShadowState: fallbackState,
      });

      const heuristicGroups = groupsForFineIssues(example.heuristic.issueIds);

      // Policy C evidence tiering.
      const heuristicFine = new Set(example.heuristic.issueIds);
      const flexMargin = (example.features as Record<string, number | null>)[FLEX_MARGIN_FEATURE];
      const firedC: string[] = [];
      for (const group of heuristicGroups) {
        const short = shortGroup(group);
        let strong = false;
        if (short === 'torso') strong = heuristicFine.has('barbell-curl.torso_fail');
        else if (short === 'shoulder') strong = heuristicFine.has('barbell-curl.shoulder_fail');
        else if (short === 'ROM') {
          strong = typeof flexMargin === 'number' && flexMargin >= ROM_STRONG_FLEX_MARGIN;
        }
        // tempo: never strong — repetition required
        if (strong || prevHeuristicGroups.includes(group)) firedC.push(group);
      }
      const prevGroupsForNextRep = heuristicGroups;

      if (example.labels.scorable === false) {
        unscorableReps += 1;
        prevHeuristicGroups = prevGroupsForNextRep;
        continue;
      }

      const truthGroups = groupsForFineIssues(example.labels.issueIds);
      outcomes.push({
        labelFile,
        split: example.split,
        repIndex: example.repIndex,
        truthFine: [...example.labels.issueIds],
        truthGroups,
        primaryTruthGroup: highestPriorityGroup(truthGroups) ?? GROUP_NONE,
        heuristicFine: [...example.heuristic.issueIds],
        selections: {
          A_ml_plus_fallback: mlResult.selectedIssueId ?? GROUP_NONE,
          B_heuristic_grouped: highestPriorityGroup(heuristicGroups) ?? GROUP_NONE,
          C_tiered_heuristic: highestPriorityGroup(firedC) ?? GROUP_NONE,
        },
      });
      prevHeuristicGroups = prevGroupsForNextRep;
    }
  }

  // Restore flag-off default for anything imported after this script.
  delete process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
  delete process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG];

  console.log(`\nEvaluated scorable matched reps: ${outcomes.length}`);
  console.log(`Skipped: ${unmatchedReps} unmatched (no predicted rep), ${unscorableReps} labeled-unscorable`);
  if (unmappedFineIssues.size > 0) {
    console.log(`Label fine issues with no grouped mapping (ignored): ${Array.from(unmappedFineIssues).join(', ')}`);
  }

  const overall: Record<PolicyId, PolicyTally> = {
    A_ml_plus_fallback: newTally(),
    B_heuristic_grouped: newTally(),
    C_tiered_heuristic: newTally(),
  };
  const bySplit = new Map<string, Record<PolicyId, PolicyTally>>();
  for (const outcome of outcomes) {
    if (!bySplit.has(outcome.split)) {
      bySplit.set(outcome.split, {
        A_ml_plus_fallback: newTally(),
        B_heuristic_grouped: newTally(),
        C_tiered_heuristic: newTally(),
      });
    }
    for (const policy of POLICY_IDS) {
      recordOutcome(overall[policy], outcome, policy);
      recordOutcome(bySplit.get(outcome.split)![policy], outcome, policy);
    }
  }

  printTally('OVERALL (all splits)', overall);
  for (const policy of POLICY_IDS) printConfusion(policy, overall[policy]);
  for (const [split, tallies] of Array.from(bySplit.entries()).sort()) {
    printTally(`SPLIT: ${split}`, tallies);
  }

  const reportPath = path.join(
    datasetRoot,
    'ml',
    'barbell-curl',
    'policy_bakeoff_latest.json',
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        exercise: EXERCISE_NAME,
        policyId: BARBELL_CURL_GROUPED_FEEDBACK_POLICY.policyId,
        romStrongFlexMargin: ROM_STRONG_FLEX_MARGIN,
        evaluatedReps: outcomes.length,
        unmatchedReps,
        unscorableReps,
        overall,
        bySplit: Object.fromEntries(bySplit),
        outcomes,
      },
      null,
      2,
    ),
  );
  console.log(`\nReport written: ${path.relative(process.cwd(), reportPath)}`);
}

main();
