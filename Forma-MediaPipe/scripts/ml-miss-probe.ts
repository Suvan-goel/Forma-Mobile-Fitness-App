/**
 * Missed-fault probability probe
 * ==============================
 * For every labeled scorable Barbell Curl rep, runs the deployed grouped-
 * feedback policy (Policy A: frozen ML + fallback, flags on) and records the
 * raw per-group model probabilities. Then answers the question that decides
 * whether more ML investment helps on the CURRENT dataset:
 *
 *   For faults the policy misses, is the truth-group probability near the
 *   decision threshold (threshold-limited -> recoverable by retuning at some
 *   clean-FP cost) or far below it (model-blind -> only data/features help)?
 *
 * Also prints, per group, a threshold sweep: misses recovered vs clean false
 * positives introduced at each candidate threshold.
 *
 * Run:  npx tsx scripts/ml-miss-probe.ts
 */
import * as path from 'path';

// Keep ML flags OFF while the dataset is built so replay produces pure
// heuristic outputs; flags are enabled only around the predict loop.
delete process.env.EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
delete process.env.EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FALLBACK_FEEDBACK;
delete process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import { buildMlDataset } from '../src/utils/exercises/ml';
import type { MlRepExample } from '../src/utils/exercises/ml/types';
import { DATASET_ROOT, loadDatasetCasesWithSummary } from './dataset-common';
import {
  predictBarbellCurlGroupedFeedback,
  createBarbellCurlGroupedFallbackShadowState,
  BARBELL_CURL_GROUPED_FEEDBACK_POLICY,
  BARBELL_CURL_GROUPED_FEEDBACK_FLAG,
  BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG,
} from '../src/utils/exercises/ml/runtime/barbellCurlGroupedFeedback';
import { getGroupedFeedbackGroupForFineIssueId } from '../src/utils/exercises/groupedFeedback';

const EXERCISE_NAME = 'Barbell Curl';

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

function prefixedFeatures(features: Record<string, number | null>): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(features).map(([key, value]) => [`feature__${key}`, value]),
  );
}

interface RepProbe {
  labelFile: string;
  split: string;
  repIndex: number;
  truthGroups: string[];
  finalPredictedGroups: string[];
  selected: string | null;
  groupProbes: Record<string, { probability: number | null; threshold: number | null; eligible: boolean; predicted: boolean }>;
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
  const examples: MlRepExample[] = dataset.examples;

  const byRecording = new Map<string, MlRepExample[]>();
  for (const example of examples) {
    const key = example.labelFile ?? `${example.split}:${example.recordingFile}`;
    if (!byRecording.has(key)) byRecording.set(key, []);
    byRecording.get(key)!.push(example);
  }
  for (const reps of byRecording.values()) {
    reps.sort((a, b) => a.timing.expectedStartMs - b.timing.expectedStartMs);
  }

  process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG] = '1';
  process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG] = '1';

  const probes: RepProbe[] = [];
  for (const [labelFile, reps] of byRecording) {
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

      const groupProbes: RepProbe['groupProbes'] = {};
      for (const prediction of mlResult.predictions) {
        groupProbes[prediction.issueId] = {
          probability: prediction.probability,
          threshold: prediction.threshold,
          eligible: prediction.eligible,
          predicted: prediction.predicted,
        };
      }
      probes.push({
        labelFile: path.basename(labelFile),
        split: example.split,
        repIndex: example.repIndex,
        truthGroups: groupsForFineIssues(example.labels.issueIds),
        finalPredictedGroups: mlResult.finalPredictedGroups,
        selected: mlResult.selectedIssueId,
        groupProbes,
      });
    }
  }

  // ── Outcomes (mirrors bake-off Policy A definitions) ──────────────────────
  const misses = probes.filter((p) => p.truthGroups.length > 0 && p.selected === null);
  const cleanReps = probes.filter((p) => p.truthGroups.length === 0);
  const cleanFps = cleanReps.filter((p) => p.selected !== null);
  const correct = probes.filter((p) => p.truthGroups.length > 0 && p.selected !== null && p.truthGroups.includes(p.selected));
  const wrong = probes.filter((p) => p.truthGroups.length > 0 && p.selected !== null && !p.truthGroups.includes(p.selected));
  console.log(`Scorable matched reps: ${probes.length} (clean ${cleanReps.length}, faulty ${probes.length - cleanReps.length})`);
  console.log(`Policy A outcomes: correct=${correct.length} wrong=${wrong.length} missed=${misses.length} cleanFP=${cleanFps.length}\n`);

  // ── Missed-fault probability anatomy ──────────────────────────────────────
  console.log('Missed faulty reps — truth-group model probability vs threshold:');
  const buckets: Record<string, number> = {};
  const perGroupMisses = new Map<string, Array<{ probe: RepProbe; probability: number | null; threshold: number | null; eligible: boolean }>>();
  for (const probe of misses) {
    for (const truthGroup of probe.truthGroups) {
      const gp = probe.groupProbes[truthGroup];
      if (!perGroupMisses.has(truthGroup)) perGroupMisses.set(truthGroup, []);
      perGroupMisses.get(truthGroup)!.push({
        probe,
        probability: gp?.probability ?? null,
        threshold: gp?.threshold ?? null,
        eligible: gp?.eligible ?? false,
      });
      let bucket: string;
      if (!gp || gp.probability === null) bucket = 'no_probability (model could not run)';
      else if (gp.threshold !== null && gp.probability >= gp.threshold) bucket = 'above_threshold_but_gated';
      else if (gp.threshold !== null && gp.probability >= gp.threshold - 0.15) bucket = 'near_threshold (within 0.15)';
      else if (gp.probability >= 0.3) bucket = 'mid_probability (0.3 .. thr-0.15)';
      else bucket = 'low_probability (<0.3 — model-blind)';
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
  }
  for (const [bucket, count] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${bucket}: ${count}`);
  }

  // ── Per-group threshold sweep: recovered misses vs new clean FPs ──────────
  console.log('\nThreshold sweep per group (recovered misses / new clean FPs; eligible reps only):');
  for (const group of BARBELL_CURL_GROUPED_FEEDBACK_POLICY.groups) {
    const groupMisses = perGroupMisses.get(group.id) ?? [];
    const currentThreshold = probes.find((p) => p.groupProbes[group.id]?.threshold !== null)
      ?.groupProbes[group.id]?.threshold ?? null;
    if (currentThreshold === null) {
      console.log(`  ${shortGroup(group.id)}: no probability threshold (policy kind: ${group.kind}) — misses attributed: ${groupMisses.length}`);
      continue;
    }
    const cleanProbs = cleanReps
      .map((p) => p.groupProbes[group.id])
      .filter((gp) => gp && gp.probability !== null && gp.eligible) as Array<{ probability: number }>;
    const missProbs = groupMisses.filter((m) => m.probability !== null && m.eligible) as Array<{ probability: number }>;
    const ineligibleMisses = groupMisses.filter((m) => m.probability === null || !m.eligible).length;
    const rows: string[] = [];
    for (const t of [currentThreshold, currentThreshold - 0.1, currentThreshold - 0.2, 0.5, 0.4, 0.3]) {
      if (t <= 0 || t > currentThreshold) continue;
      const recovered = missProbs.filter((m) => m.probability >= t).length;
      const newFps = cleanProbs.filter((c) => c.probability >= t).length;
      rows.push(`t=${t.toFixed(2)}: +${recovered} recovered / +${newFps} clean FPs`);
    }
    console.log(`  ${shortGroup(group.id)} (current t=${currentThreshold}, misses=${groupMisses.length}, ineligible/no-prob=${ineligibleMisses}):`);
    for (const row of rows) console.log(`    ${row}`);
  }

  // ── Hypothetical pure-probability sweep for collapsed groups ──────────────
  // shoulder/tempo have no group threshold (heuristic-gated sub-policies);
  // size what a plain thresholded model WOULD trade, using the group
  // probability the runtime already computes.
  console.log('\nHypothetical pure-probability sweep for gated groups (recovered misses / new clean FPs):');
  for (const groupId of ['barbell-curl.shoulder_issue', 'barbell-curl.tempo_issue']) {
    const groupMisses = (perGroupMisses.get(groupId) ?? [])
      .map((m) => m.probability)
      .filter((p): p is number => p !== null);
    const cleanProbs = cleanReps
      .map((p) => p.groupProbes[groupId]?.probability)
      .filter((p): p is number => typeof p === 'number');
    const rows = [0.95, 0.9, 0.85, 0.8, 0.7].map((t) => {
      const recovered = groupMisses.filter((p) => p >= t).length;
      const newFps = cleanProbs.filter((p) => p >= t).length;
      return `t=${t.toFixed(2)}: +${recovered} recovered / +${newFps} clean FPs`;
    });
    console.log(`  ${shortGroup(groupId)} (misses with probability: ${groupMisses.length}):`);
    for (const row of rows) console.log(`    ${row}`);
  }

  // ── Probability distribution context ───────────────────────────────────────
  console.log('\nMedian truth-group probability on missed vs correctly-named reps:');
  for (const group of BARBELL_CURL_GROUPED_FEEDBACK_POLICY.groups) {
    const missP = (perGroupMisses.get(group.id) ?? [])
      .map((m) => m.probability).filter((p): p is number => p !== null).sort((a, b) => a - b);
    const hitP = correct
      .filter((p) => p.selected === group.id)
      .map((p) => p.groupProbes[group.id]?.probability)
      .filter((p): p is number => typeof p === 'number').sort((a, b) => a - b);
    const med = (xs: number[]) => (xs.length ? xs[Math.floor(xs.length / 2)].toFixed(3) : '-');
    console.log(`  ${shortGroup(group.id)}: missed median p=${med(missP)} (n=${missP.length}) | named median p=${med(hitP)} (n=${hitP.length})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
