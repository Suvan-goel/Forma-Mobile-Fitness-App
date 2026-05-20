import type { Keypoint } from '../../poseAnalysis';
import type { CaseEvaluation, DatasetCase, RepEvaluation } from '../dataset';
import type { ReplayRepPrediction, ReplayResultVerbose } from '../replay';
import { slugifyExerciseName } from '../replay';
import type { ExerciseDefinition, RepCueDiagnostic, RepMetricDiagnostic } from '../types';
import {
  ML_FEATURE_SCHEMA_VERSION,
  ML_REP_EXAMPLE_SCHEMA_VERSION,
  type MlFeatureVector,
  type MlRepExample,
} from './types';

const IMPORTANT_JOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
];

const POSE_QUALITY_STATUSES = ['high', 'medium', 'low', 'lost'];

export interface BuildMlRepExamplesOptions {
  definition: ExerciseDefinition;
  datasetCase: DatasetCase;
  replay: ReplayResultVerbose;
  caseEvaluation: CaseEvaluation;
  labelFile?: string;
  recordingFile?: string;
  heuristicConfigVersion?: string;
}

export interface BuildMlRepExamplesResult {
  examples: MlRepExample[];
  skippedMissingMatchedPrediction: number;
  skippedMissingDiagnostics: number;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolNumber(value: boolean | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  return value ? 1 : 0;
}

function safeFeaturePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function setFeature(features: MlFeatureVector, key: string, value: unknown): void {
  features[key] = finiteOrNull(value);
}

function setBooleanFeature(features: MlFeatureVector, key: string, value: boolean | undefined | null): void {
  features[key] = boolNumber(value);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function std(values: number[], average: number | null): number | null {
  if (values.length === 0 || average === null) return null;
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function addStats(features: MlFeatureVector, prefix: string, values: number[]): void {
  if (values.length === 0) {
    setFeature(features, `${prefix}.min`, null);
    setFeature(features, `${prefix}.max`, null);
    setFeature(features, `${prefix}.range`, null);
    setFeature(features, `${prefix}.mean`, null);
    setFeature(features, `${prefix}.std`, null);
    return;
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const average = mean(values);
  setFeature(features, `${prefix}.min`, minValue);
  setFeature(features, `${prefix}.max`, maxValue);
  setFeature(features, `${prefix}.range`, maxValue - minValue);
  setFeature(features, `${prefix}.mean`, average);
  setFeature(features, `${prefix}.std`, std(values, average));
}

function keypointByName(keypoints: Keypoint[] | undefined, name: string): Keypoint | undefined {
  return keypoints?.find((keypoint) => keypoint.name === name);
}

function frameKeypoints(frame: DatasetCase['recording']['frames'][number]): Keypoint[] {
  return frame.worldKeypoints ?? frame.keypoints;
}

function distance(a: Keypoint, b: Keypoint): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + dz ** 2);
}

function addKeypointStats(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
): void {
  for (const joint of IMPORTANT_JOINTS) {
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const scores: number[] = [];

    for (const frame of frames) {
      const keypoint = keypointByName(frameKeypoints(frame), joint);
      if (!keypoint) continue;
      if (Number.isFinite(keypoint.x)) xs.push(keypoint.x);
      if (Number.isFinite(keypoint.y)) ys.push(keypoint.y);
      if (Number.isFinite(keypoint.z)) zs.push(keypoint.z as number);
      if (Number.isFinite(keypoint.score)) scores.push(keypoint.score);
    }

    const prefix = `landmark.${joint}`;
    addStats(features, `${prefix}.x`, xs);
    addStats(features, `${prefix}.y`, ys);
    addStats(features, `${prefix}.z`, zs);
    addStats(features, `${prefix}.score`, scores);
    setFeature(features, `${prefix}.visible_rate`, frames.length === 0 ? null : scores.length / frames.length);
  }
}

function addVelocityStats(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
  joint: string,
): void {
  const velocities: number[] = [];
  let first: Keypoint | null = null;
  let last: Keypoint | null = null;

  for (let index = 1; index < frames.length; index += 1) {
    const previousFrame = frames[index - 1];
    const frame = frames[index];
    const previous = keypointByName(frameKeypoints(previousFrame), joint);
    const current = keypointByName(frameKeypoints(frame), joint);
    if (!previous || !current) continue;
    first ??= previous;
    last = current;
    const dtSeconds = Math.max(0.001, (frame.timestamp - previousFrame.timestamp) / 1000);
    velocities.push(distance(previous, current) / dtSeconds);
  }

  const prefix = `kinematic.${joint}`;
  addStats(features, `${prefix}.velocity`, velocities);
  setFeature(features, `${prefix}.displacement`, first && last ? distance(first, last) : null);
}

function addDiagnosticMetricFeatures(features: MlFeatureVector, metric: RepMetricDiagnostic): void {
  const key = safeFeaturePart(metric.key);
  const prefix = `diagnostic.metric.${key}`;
  setFeature(features, `${prefix}.value`, metric.value);
  setBooleanFeature(features, `${prefix}.eligible`, metric.eligible);
  setFeature(features, `${prefix}.confidence`, metric.confidence);
  setFeature(features, `${prefix}.sample_count`, metric.sampleCount);
}

function addDiagnosticCueFeatures(features: MlFeatureVector, cue: RepCueDiagnostic): void {
  const key = safeFeaturePart(cue.issueId);
  const prefix = `diagnostic.cue.${key}`;
  setBooleanFeature(features, `${prefix}.triggered`, cue.triggered);
  setBooleanFeature(features, `${prefix}.eligible`, cue.eligible);
  setFeature(features, `${prefix}.margin`, cue.margin);
  setFeature(features, `${prefix}.support`, cue.support);
}

function framesForRep(datasetCase: DatasetCase, rep: RepEvaluation): DatasetCase['recording']['frames'] {
  const start = rep.expectedStartMs ?? rep.predictedStartMs ?? 0;
  const end = rep.expectedEndMs ?? rep.predictedEndMs ?? start;
  return datasetCase.recording.frames.filter((frame) => frame.timestamp >= start && frame.timestamp <= end);
}

function buildFeatures(
  datasetCase: DatasetCase,
  rep: RepEvaluation,
  prediction: ReplayRepPrediction,
): MlFeatureVector {
  const features: MlFeatureVector = {};
  const frames = framesForRep(datasetCase, rep);
  const durationMs = Math.max(0, (rep.expectedEndMs ?? 0) - (rep.expectedStartMs ?? 0));
  const diagnostics = rep.predictedDiagnostics;

  setFeature(features, 'rep.duration_ms', durationMs);
  setFeature(features, 'rep.frame_count', frames.length);
  setFeature(features, 'rep.fps_estimate', durationMs > 0 ? (frames.length * 1000) / durationMs : null);
  setFeature(features, 'rep.overlap_ms', rep.overlapMs);
  setFeature(features, 'rep.completion_delta_ms', rep.completionDeltaMs);

  setFeature(features, 'heuristic.score', prediction.score);
  setFeature(features, 'heuristic.issue_count', prediction.issueIds.length);
  setBooleanFeature(features, 'heuristic.has_issue', prediction.issueIds.length > 0);
  setBooleanFeature(features, 'heuristic.scorable', prediction.scorable ?? diagnostics?.scorable);

  setFeature(features, 'pose.confidence', prediction.confidence);
  setFeature(features, 'pose.warning_count', prediction.qualityWarnings?.length ?? 0);
  for (const status of POSE_QUALITY_STATUSES) {
    setBooleanFeature(features, `pose.status.${status}`, prediction.qualityStatus === status);
  }

  for (const issueId of prediction.issueIds) {
    setBooleanFeature(features, `heuristic.issue.${safeFeaturePart(issueId)}`, true);
  }

  if (diagnostics) {
    setBooleanFeature(features, 'diagnostic.scorable', diagnostics.scorable);
    for (const [view, value] of Object.entries({
      front: diagnostics.view === 'front',
      side: diagnostics.view === 'side',
      oblique: diagnostics.view === 'oblique',
      unknown: diagnostics.view === 'unknown',
    })) {
      setBooleanFeature(features, `diagnostic.view.${view}`, value);
    }

    for (const metric of Object.values(diagnostics.metrics).sort((a, b) => a.key.localeCompare(b.key))) {
      addDiagnosticMetricFeatures(features, metric);
    }
    for (const cue of Object.values(diagnostics.cues).sort((a, b) => a.issueId.localeCompare(b.issueId))) {
      addDiagnosticCueFeatures(features, cue);
    }
  }

  addKeypointStats(features, frames);
  for (const joint of ['left_wrist', 'right_wrist', 'left_elbow', 'right_elbow', 'left_shoulder', 'right_shoulder']) {
    addVelocityStats(features, frames, joint);
  }

  return features;
}

function findPrediction(
  replay: ReplayResultVerbose,
  predictedRepIndex: number | null,
): ReplayRepPrediction | undefined {
  if (predictedRepIndex === null) return undefined;
  return replay.reps.find((rep) => rep.repIndex === predictedRepIndex);
}

export function buildMlRepExamples(options: BuildMlRepExamplesOptions): BuildMlRepExamplesResult {
  const exerciseSlug = slugifyExerciseName(options.definition.name);
  const examples: MlRepExample[] = [];
  let skippedMissingMatchedPrediction = 0;
  let skippedMissingDiagnostics = 0;

  for (const rep of options.caseEvaluation.matchedReps) {
    const label = options.datasetCase.label.reps.find((candidate) => candidate.index === rep.expectedRepIndex);
    const prediction = findPrediction(options.replay, rep.predictedRepIndex);
    if (!label || !prediction) {
      skippedMissingMatchedPrediction += 1;
      continue;
    }
    if (!rep.predictedDiagnostics) skippedMissingDiagnostics += 1;

    const durationMs = Math.max(0, label.endMs - label.startMs);
    const expectedIssueIds = [...rep.expectedIssueIds].sort();
    const predictedIssueIds = [...prediction.issueIds].sort();

    examples.push({
      schemaVersion: ML_REP_EXAMPLE_SCHEMA_VERSION,
      featureSchemaVersion: ML_FEATURE_SCHEMA_VERSION,
      id: [
        exerciseSlug,
        options.datasetCase.label.split,
        options.datasetCase.label.sourceVideo,
        `rep-${label.index}`,
      ].join('::'),
      exerciseName: options.definition.name,
      exerciseSlug,
      split: options.datasetCase.label.split,
      sourceVideo: options.datasetCase.label.sourceVideo,
      landmarkFile: options.datasetCase.label.landmarkFile,
      labelFile: options.labelFile,
      recordingFile: options.recordingFile,
      repIndex: label.index,
      timing: {
        expectedStartMs: label.startMs,
        expectedEndMs: label.endMs,
        predictedStartMs: rep.predictedStartMs,
        predictedEndMs: rep.predictedEndMs,
        completedAtMs: prediction.completedAt,
        durationMs,
        overlapMs: rep.overlapMs,
        completionDeltaMs: rep.completionDeltaMs,
      },
      labels: {
        issueIds: expectedIssueIds,
        clean: expectedIssueIds.length === 0,
        scorable: rep.expectedScorable,
        view: rep.expectedView,
        expectedScoreRange: rep.expectedScoreRange,
      },
      heuristic: {
        issueIds: predictedIssueIds,
        clean: predictedIssueIds.length === 0,
        score: finiteOrNull(prediction.score),
        messages: prediction.messages,
        scorable: prediction.scorable ?? rep.predictedScorable ?? null,
        view: rep.predictedView,
        confidence: finiteOrNull(prediction.confidence),
        qualityStatus: prediction.qualityStatus,
        qualityWarnings: prediction.qualityWarnings ?? [],
      },
      features: buildFeatures(options.datasetCase, rep, prediction),
      metadata: {
        captureMetadata: options.datasetCase.label.captureMetadata,
        recordingMetadata: options.datasetCase.recording.metadata,
        heuristicConfigVersion: options.heuristicConfigVersion,
        poseModelName: options.datasetCase.recording.metadata.modelName,
        poseModelPath: options.datasetCase.recording.metadata.modelPath,
      },
    });
  }

  return { examples, skippedMissingMatchedPrediction, skippedMissingDiagnostics };
}

export function collectFeatureNames(examples: MlRepExample[]): string[] {
  const names = new Set<string>();
  for (const example of examples) {
    for (const key of Object.keys(example.features)) names.add(key);
  }
  return Array.from(names).sort();
}

export function safeColumnPart(value: string): string {
  return safeFeaturePart(value);
}
