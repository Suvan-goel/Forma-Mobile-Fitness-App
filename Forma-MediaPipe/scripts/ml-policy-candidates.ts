/**
 * Grouped-feedback policy candidate sweep (pre-registered)
 * ========================================================
 * Evaluates a fixed grid of policy-gate variants against the labeled Barbell
 * Curl dataset, using the real runtime predictor with `policyGroupsOverride`
 * (models and fallback logic stay frozen; only group gates change):
 *
 *   shoulder: shoulder_warn heuristic-only -> ml-add-only-high-confidence at
 *             t in {0.95, 0.90, 0.85} (shoulder_fail unchanged)
 *   tempo:    tempo_up suppress-only -> suppress-and-add at the same grid
 *             (suppression behavior preserved; tempo_down unchanged)
 *   torso:    direct-evidence gate kept or dropped
 *   rom:      group threshold in {0.85, 0.75}
 *
 * Selection rule (pre-registered — do not hill-climb beyond this):
 *   1. clean FPs and wrong-names must not exceed the frozen baseline on the
 *      full dataset AND on every leave-one-recording-out subset;
 *   2. every changed threshold needs >=0.02 probability headroom above the
 *      nearest eligible clean-rep probability below it;
 *   3. rank survivors by fewest missed, then fewest changed knobs, then
 *      largest minimum margin.
 *
 * IMPORTANT: these numbers come from single-subject data. The winner is a
 * dev-flag candidate only; promotion to production waits for the Phase 2
 * multi-subject bake-off.
 *
 * Run:  npx tsx scripts/ml-policy-candidates.ts
 */
import * as path from 'path';

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
  type BarbellCurlGroupedRuntimeGroup,
} from '../src/utils/exercises/ml/runtime/barbellCurlGroupedFeedback';
import { getGroupedFeedbackGroupForFineIssueId } from '../src/utils/exercises/groupedFeedback';
import { DATASET_ROOT, loadDatasetCasesWithSummary } from './dataset-common';

const EXERCISE_NAME = 'Barbell Curl';
const SHOULDER_GROUP = 'barbell-curl.shoulder_issue';
const TEMPO_GROUP = 'barbell-curl.tempo_issue';
const TORSO_GROUP = 'barbell-curl.torso_issue';
const ROM_GROUP = 'barbell-curl.ROM_issue';
const MIN_MARGIN = 0.02;

interface VariantSpec {
  name: string;
  shoulderAdd: number | null;
  tempoAdd: number | null;
  torsoDropDirectEvidence: boolean;
  romThreshold: number;
  changedKnobs: number;
}

interface RepOutcome {
  labelFile: string;
  clean: boolean;
  outcome: 'correct_silence' | 'false_positive' | 'correct_name' | 'wrong_name' | 'missed';
}

interface VariantResult {
  spec: VariantSpec;
  cleanFps: number;
  wrongNames: number;
  missed: number;
  correctNames: number;
  loroNonWorsening: boolean;
  minMargin: number | null;
  marginNotes: string[];
}

function groupsForFineIssues(fineIssueIds: readonly string[]): string[] {
  const groups = new Set<string>();
  for (const fineId of fineIssueIds) {
    const group = getGroupedFeedbackGroupForFineIssueId(EXERCISE_NAME, fineId);
    if (group) groups.add(group.id);
  }
  return Array.from(groups);
}

function prefixedFeatures(features: Record<string, number | null>): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(features).map(([key, value]) => [`feature__${key}`, value]),
  );
}

function buildVariantGroups(spec: VariantSpec): BarbellCurlGroupedRuntimeGroup[] {
  return BARBELL_CURL_GROUPED_FEEDBACK_POLICY.groups.map((group): BarbellCurlGroupedRuntimeGroup => {
    if (group.id === SHOULDER_GROUP && spec.shoulderAdd !== null && group.kind === 'collapsed_fine_policy') {
      return {
        ...group,
        childPolicies: group.childPolicies.map((child) => (
          child.issueId === 'barbell-curl.shoulder_warn'
            ? { ...child, policy: 'ml-add-only-high-confidence' as const, addThreshold: spec.shoulderAdd }
            : child
        )),
      };
    }
    if (group.id === TEMPO_GROUP && spec.tempoAdd !== null && group.kind === 'collapsed_fine_policy') {
      return {
        ...group,
        childPolicies: group.childPolicies.map((child) => (
          child.issueId === 'barbell-curl.tempo_up'
            ? { ...child, policy: 'suppress-and-add' as const, addThreshold: spec.tempoAdd }
            : child
        )),
      };
    }
    if (group.id === TORSO_GROUP && spec.torsoDropDirectEvidence && group.kind === 'thresholded_model_with_direct_evidence') {
      const { directEvidence: _dropped, ...rest } = group;
      return { ...rest, kind: 'thresholded_model' as const };
    }
    if (group.id === ROM_GROUP && group.kind === 'thresholded_model' && group.threshold !== spec.romThreshold) {
      return { ...group, threshold: spec.romThreshold };
    }
    return group;
  });
}

function evaluateVariant(
  spec: VariantSpec,
  byRecording: Map<string, MlRepExample[]>,
): RepOutcome[] {
  const groups = buildVariantGroups(spec);
  const outcomes: RepOutcome[] = [];
  for (const [labelFile, reps] of byRecording) {
    const fallbackState = createBarbellCurlGroupedFallbackShadowState();
    for (const example of reps) {
      if (example.timing.predictedStartMs === null) continue;
      const mlResult = predictBarbellCurlGroupedFeedback({
        features: prefixedFeatures(example.features as Record<string, number | null>),
        heuristicIssueIds: example.heuristic.issueIds,
        repIndex: example.repIndex,
        fallbackShadowState: fallbackState,
        policyGroupsOverride: groups,
      });
      if (example.labels.scorable === false) continue;
      const truthGroups = groupsForFineIssues(example.labels.issueIds);
      const selected = mlResult.selectedIssueId;
      let outcome: RepOutcome['outcome'];
      if (truthGroups.length === 0) {
        outcome = selected === null ? 'correct_silence' : 'false_positive';
      } else if (selected === null) {
        outcome = 'missed';
      } else {
        outcome = truthGroups.includes(selected) ? 'correct_name' : 'wrong_name';
      }
      outcomes.push({
        labelFile: path.basename(labelFile),
        clean: truthGroups.length === 0,
        outcome,
      });
    }
  }
  return outcomes;
}

function tally(outcomes: RepOutcome[]) {
  return {
    cleanFps: outcomes.filter((o) => o.outcome === 'false_positive').length,
    wrongNames: outcomes.filter((o) => o.outcome === 'wrong_name').length,
    missed: outcomes.filter((o) => o.outcome === 'missed').length,
    correctNames: outcomes.filter((o) => o.outcome === 'correct_name').length,
  };
}

/** Non-worsening vs baseline on the full set and every leave-one-recording-out subset. */
function loroNonWorsening(variant: RepOutcome[], baseline: RepOutcome[]): boolean {
  const files = Array.from(new Set(baseline.map((o) => o.labelFile)));
  for (const heldOut of [null, ...files]) {
    const v = tally(variant.filter((o) => o.labelFile !== heldOut));
    const b = tally(baseline.filter((o) => o.labelFile !== heldOut));
    if (v.cleanFps > b.cleanFps || v.wrongNames > b.wrongNames) return false;
  }
  return true;
}

interface ProbabilityRecord {
  clean: boolean;
  shoulderWarnP: number | null;
  shoulderWarnEligible: boolean;
  tempoUpP: number | null;
  tempoUpEligible: boolean;
  torsoP: number | null;
  torsoEligible: boolean;
  romP: number | null;
  romEligible: boolean;
}

/** Headroom between a threshold and the nearest eligible clean-rep probability below it. */
function marginFor(
  records: ProbabilityRecord[],
  threshold: number,
  probabilityOf: (r: ProbabilityRecord) => number | null,
  eligibleOf: (r: ProbabilityRecord) => boolean,
): number | null {
  const cleanBelow = records
    .filter((r) => r.clean && eligibleOf(r))
    .map(probabilityOf)
    .filter((p): p is number => p !== null && p < threshold);
  if (cleanBelow.length === 0) return null;
  return threshold - Math.max(...cleanBelow);
}

async function main(): Promise<void> {
  const definition = ExerciseRegistry.get(EXERCISE_NAME);
  if (!definition) throw new Error(`Exercise not registered: ${EXERCISE_NAME}`);
  const datasetRoot = path.resolve(process.cwd(), DATASET_ROOT);
  const { cases, summary } = loadDatasetCasesWithSummary({
    datasetRoot,
    exerciseName: EXERCISE_NAME,
    includeDrafts: false,
    logSkippedDrafts: false,
  });
  const dataset = buildMlDataset({
    exerciseName: EXERCISE_NAME,
    definition,
    cases,
    datasetRoot: 'datasets/form-heuristics',
    includeDrafts: false,
    discoveredLabelFiles: summary.labelFilesDiscovered,
    outputs: { jsonl: '', csv: '', manifest: '' },
  });

  const byRecording = new Map<string, MlRepExample[]>();
  for (const example of dataset.examples) {
    const key = example.labelFile ?? `${example.split}:${example.recordingFile}`;
    if (!byRecording.has(key)) byRecording.set(key, []);
    byRecording.get(key)!.push(example);
  }
  for (const reps of byRecording.values()) {
    reps.sort((a, b) => a.timing.expectedStartMs - b.timing.expectedStartMs);
  }

  process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '1';
  process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG] = '1';

  // ── Probability records from a frozen-policy pass (probabilities are
  //    variant-invariant; only gates change) ────────────────────────────────
  const probabilityRecords: ProbabilityRecord[] = [];
  for (const [, reps] of byRecording) {
    const fallbackState = createBarbellCurlGroupedFallbackShadowState();
    for (const example of reps) {
      if (example.timing.predictedStartMs === null) continue;
      const mlResult = predictBarbellCurlGroupedFeedback({
        features: prefixedFeatures(example.features as Record<string, number | null>),
        heuristicIssueIds: example.heuristic.issueIds,
        repIndex: example.repIndex,
        fallbackShadowState: fallbackState,
      });
      if (example.labels.scorable === false) continue;
      const shoulder = mlResult.predictions.find((p) => p.issueId === SHOULDER_GROUP);
      const tempo = mlResult.predictions.find((p) => p.issueId === TEMPO_GROUP);
      const torso = mlResult.predictions.find((p) => p.issueId === TORSO_GROUP);
      const rom = mlResult.predictions.find((p) => p.issueId === ROM_GROUP);
      const shoulderWarn = shoulder?.childPredictions?.find((c) => c.issueId === 'barbell-curl.shoulder_warn');
      const tempoUp = tempo?.childPredictions?.find((c) => c.issueId === 'barbell-curl.tempo_up');
      probabilityRecords.push({
        clean: groupsForFineIssues(example.labels.issueIds).length === 0,
        shoulderWarnP: shoulderWarn?.probability ?? null,
        shoulderWarnEligible: shoulderWarn?.eligible ?? false,
        tempoUpP: tempoUp?.probability ?? null,
        tempoUpEligible: tempoUp?.eligible ?? false,
        torsoP: torso?.probability ?? null,
        torsoEligible: torso?.eligible ?? false,
        romP: rom?.probability ?? null,
        romEligible: rom?.eligible ?? false,
      });
    }
  }

  // ── Pre-registered grid ────────────────────────────────────────────────────
  const thresholdGrid = [null, 0.95, 0.9, 0.85];
  const specs: VariantSpec[] = [];
  for (const shoulderAdd of thresholdGrid) {
    for (const tempoAdd of thresholdGrid) {
      for (const torsoDrop of [false, true]) {
        for (const romThreshold of [0.85, 0.75]) {
          const changedKnobs =
            (shoulderAdd !== null ? 1 : 0) +
            (tempoAdd !== null ? 1 : 0) +
            (torsoDrop ? 1 : 0) +
            (romThreshold !== 0.85 ? 1 : 0);
          specs.push({
            name: [
              shoulderAdd !== null ? `sh@${shoulderAdd}` : 'sh=frozen',
              tempoAdd !== null ? `te@${tempoAdd}` : 'te=frozen',
              torsoDrop ? 'torso-ungated' : 'torso=frozen',
              `rom@${romThreshold}`,
            ].join(' '),
            shoulderAdd,
            tempoAdd,
            torsoDropDirectEvidence: torsoDrop,
            romThreshold,
            changedKnobs,
          });
        }
      }
    }
  }

  const baselineSpec = specs.find((s) => s.changedKnobs === 0)!;
  const baselineOutcomes = evaluateVariant(baselineSpec, byRecording);
  const baseline = tally(baselineOutcomes);
  console.log(`Baseline (frozen policy): correct=${baseline.correctNames} wrong=${baseline.wrongNames} missed=${baseline.missed} cleanFP=${baseline.cleanFps}\n`);

  const results: VariantResult[] = [];
  for (const spec of specs) {
    const outcomes = spec === baselineSpec ? baselineOutcomes : evaluateVariant(spec, byRecording);
    const totals = tally(outcomes);
    const marginNotes: string[] = [];
    const margins: number[] = [];
    if (spec.shoulderAdd !== null) {
      const m = marginFor(probabilityRecords, spec.shoulderAdd, (r) => r.shoulderWarnP, (r) => r.shoulderWarnEligible);
      if (m !== null) { margins.push(m); marginNotes.push(`shoulder_warn margin=${m.toFixed(3)}`); }
    }
    if (spec.tempoAdd !== null) {
      const m = marginFor(probabilityRecords, spec.tempoAdd, (r) => r.tempoUpP, (r) => r.tempoUpEligible);
      if (m !== null) { margins.push(m); marginNotes.push(`tempo_up margin=${m.toFixed(3)}`); }
    }
    if (spec.romThreshold !== 0.85) {
      const m = marginFor(probabilityRecords, spec.romThreshold, (r) => r.romP, (r) => r.romEligible);
      if (m !== null) { margins.push(m); marginNotes.push(`rom margin=${m.toFixed(3)}`); }
    }
    if (spec.torsoDropDirectEvidence) {
      const m = marginFor(probabilityRecords, 0.67, (r) => r.torsoP, (r) => r.torsoEligible);
      if (m !== null) { margins.push(m); marginNotes.push(`torso margin=${m.toFixed(3)}`); }
    }
    results.push({
      spec,
      ...totals,
      loroNonWorsening: loroNonWorsening(outcomes, baselineOutcomes),
      minMargin: margins.length > 0 ? Math.min(...margins) : null,
      marginNotes,
    });
  }

  // ── Apply selection rule ────────────────────────────────────────────────────
  const survivors = results.filter((r) =>
    r.spec.changedKnobs > 0 &&
    r.cleanFps <= baseline.cleanFps &&
    r.wrongNames <= baseline.wrongNames &&
    r.missed < baseline.missed &&
    r.loroNonWorsening &&
    (r.minMargin === null || r.minMargin >= MIN_MARGIN),
  );
  survivors.sort((a, b) =>
    a.missed - b.missed ||
    a.spec.changedKnobs - b.spec.changedKnobs ||
    (b.minMargin ?? 0) - (a.minMargin ?? 0),
  );

  console.log('All variants (correct/wrong/missed/cleanFP, LORO, minMargin):');
  for (const r of results.filter((x) => x.spec.changedKnobs > 0)) {
    console.log(
      `  ${r.spec.name.padEnd(48)} ${String(r.correctNames).padStart(3)}/${r.wrongNames}/${String(r.missed).padStart(2)}/${r.cleanFps}` +
      ` loro=${r.loroNonWorsening ? 'ok' : 'WORSENS'} margin=${r.minMargin?.toFixed(3) ?? '-'}`,
    );
  }

  console.log(`\nSurvivors of selection rule: ${survivors.length}`);
  for (const r of survivors.slice(0, 8)) {
    console.log(`  ${r.spec.name}: missed ${baseline.missed}->${r.missed}, correct ${baseline.correctNames}->${r.correctNames}, ${r.marginNotes.join(', ')}`);
  }
  if (survivors.length > 0) {
    const winner = survivors[0];
    console.log(`\nWINNER: ${winner.spec.name}`);
    console.log(`  missed ${baseline.missed} -> ${winner.missed} | correct ${baseline.correctNames} -> ${winner.correctNames} | wrong ${winner.wrongNames} | cleanFP ${winner.cleanFps}`);
    console.log('  Caveat: single-subject data; dev-flag candidate only until the Phase 2 multi-subject bake-off.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
