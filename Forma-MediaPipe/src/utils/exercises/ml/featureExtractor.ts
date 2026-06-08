import type { Keypoint } from '../../poseAnalysis';
import { calculateAngle } from '../../poseAnalysis';
import type { CaseEvaluation, DatasetCase, RepEvaluation } from '../dataset';
import {
  getExerciseLabelPolicy,
  getLabelableIssues,
  isIssueLabelableForView,
} from '../dataset/labelPolicy';
import type { RepLabel, RepViewLabel } from '../dataset/types';
import type { LandmarkRecordingFrame, ReplayRepPrediction, ReplayResultVerbose } from '../replay';
import { slugifyExerciseName } from '../replay';
import type { ExerciseDefinition, RepCueDiagnostic, RepDiagnostics, RepMetricDiagnostic } from '../types';
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
const VISIBILITY_THRESHOLD = 0.5;

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

export interface BuildRuntimeMlFeatureVectorOptions {
  definition: ExerciseDefinition;
  frames: LandmarkRecordingFrame[];
  repIndex: number;
  durationMs: number;
  score: number | null;
  issueIds: string[];
  messages: string[];
  scorable?: boolean | null;
  confidence?: number | null;
  qualityStatus?: string;
  qualityWarnings?: unknown[];
  diagnostics?: RepDiagnostics;
  view?: RepViewLabel;
  overlapMs?: number | null;
  completionDeltaMs?: number | null;
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

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function addPercentileStats(features: MlFeatureVector, prefix: string, values: number[]): void {
  addStats(features, prefix, values);
  setFeature(features, `${prefix}.p10`, percentile(values, 0.1));
  setFeature(features, `${prefix}.p25`, percentile(values, 0.25));
  setFeature(features, `${prefix}.p50`, percentile(values, 0.5));
  setFeature(features, `${prefix}.p75`, percentile(values, 0.75));
  setFeature(features, `${prefix}.p90`, percentile(values, 0.9));
  setFeature(features, `${prefix}.p95`, percentile(values, 0.95));
}

function countWithin(values: number[], predicate: (value: number) => boolean): number | null {
  if (values.length === 0) return null;
  return values.filter(predicate).length;
}

function ratio(numerator: number | null, denominator: number): number | null {
  if (numerator === null || denominator === 0) return null;
  return numerator / denominator;
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

function midpoint(a: Keypoint, b: Keypoint): Keypoint {
  return {
    name: 'midpoint',
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    score: Math.min(a.score, b.score),
  };
}

function keypointReliable(keypoint: Keypoint | undefined): keypoint is Keypoint {
  return !!keypoint && Number.isFinite(keypoint.score) && keypoint.score >= VISIBILITY_THRESHOLD;
}

type ArmSide = 'left' | 'right';

function armReliable(keypoints: Keypoint[], side: ArmSide): boolean {
  return (
    keypointReliable(keypointByName(keypoints, `${side}_shoulder`)) &&
    keypointReliable(keypointByName(keypoints, `${side}_elbow`)) &&
    keypointReliable(keypointByName(keypoints, `${side}_wrist`))
  );
}

function torsoReliable(keypoints: Keypoint[]): boolean {
  return (
    keypointReliable(keypointByName(keypoints, 'left_shoulder')) &&
    keypointReliable(keypointByName(keypoints, 'right_shoulder')) &&
    keypointReliable(keypointByName(keypoints, 'left_hip')) &&
    keypointReliable(keypointByName(keypoints, 'right_hip'))
  );
}

function normalizerFromTorso(keypoints: Keypoint[]): number | null {
  const leftShoulder = keypointByName(keypoints, 'left_shoulder');
  const rightShoulder = keypointByName(keypoints, 'right_shoulder');
  const leftHip = keypointByName(keypoints, 'left_hip');
  const rightHip = keypointByName(keypoints, 'right_hip');
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
  const torso = distance(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip));
  return torso > 0 ? torso : null;
}

function sideElbowAngle(keypoints: Keypoint[], side: ArmSide): number | null {
  const shoulder = keypointByName(keypoints, `${side}_shoulder`);
  const elbow = keypointByName(keypoints, `${side}_elbow`);
  const wrist = keypointByName(keypoints, `${side}_wrist`);
  if (!shoulder || !elbow || !wrist) return null;
  return calculateAngle(shoulder, elbow, wrist);
}

function sideWristY(keypoints: Keypoint[], side: ArmSide): number | null {
  const wrist = keypointByName(keypoints, `${side}_wrist`);
  return wrist && Number.isFinite(wrist.y) ? wrist.y : null;
}

function averageNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return (a + b) / 2;
}

function addEndpointHoldFeatures(features: MlFeatureVector, prefix: string, values: number[], lowIsTop: boolean): void {
  if (values.length === 0) {
    setFeature(features, `${prefix}.top_hold_frames`, null);
    setFeature(features, `${prefix}.bottom_hold_frames`, null);
    setFeature(features, `${prefix}.top_hold_ratio`, null);
    setFeature(features, `${prefix}.bottom_hold_ratio`, null);
    return;
  }
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(0.000001, maxValue - minValue);
  const lowBand = minValue + range * 0.1;
  const highBand = maxValue - range * 0.1;
  const topFrames = countWithin(values, (value) => lowIsTop ? value <= lowBand : value >= highBand);
  const bottomFrames = countWithin(values, (value) => lowIsTop ? value >= highBand : value <= lowBand);
  setFeature(features, `${prefix}.top_hold_frames`, topFrames);
  setFeature(features, `${prefix}.bottom_hold_frames`, bottomFrames);
  setFeature(features, `${prefix}.top_hold_ratio`, ratio(topFrames, values.length));
  setFeature(features, `${prefix}.bottom_hold_ratio`, ratio(bottomFrames, values.length));
}

function medianFrameIntervalMs(frames: DatasetCase['recording']['frames']): number | null {
  if (frames.length < 2) return null;
  const intervals: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const dt = frames[index].timestamp - frames[index - 1].timestamp;
    if (Number.isFinite(dt) && dt > 0) intervals.push(dt);
  }
  return percentile(intervals, 0.5);
}

function phaseDurationMs(frames: DatasetCase['recording']['frames']): number | null {
  if (frames.length < 2) return null;
  return Math.max(0, frames[frames.length - 1].timestamp - frames[0].timestamp);
}

function longestRun(values: number[], predicate: (value: number) => boolean): number {
  let current = 0;
  let longest = 0;
  for (const value of values) {
    if (predicate(value)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function robustRange(values: number[], low = 0.1, high = 0.9): number | null {
  const lowValue = percentile(values, low);
  const highValue = percentile(values, high);
  return lowValue !== null && highValue !== null ? highValue - lowValue : null;
}

function setSupportFeatures(features: MlFeatureVector, prefix: string, values: number[], predicate: (value: number) => boolean): void {
  if (values.length === 0) {
    setFeature(features, `${prefix}.support_frames`, null);
    setFeature(features, `${prefix}.support_ratio`, null);
    setFeature(features, `${prefix}.longest_run_frames`, null);
    return;
  }
  const supportFrames = values.filter(predicate).length;
  setFeature(features, `${prefix}.support_frames`, supportFrames);
  setFeature(features, `${prefix}.support_ratio`, supportFrames / values.length);
  setFeature(features, `${prefix}.longest_run_frames`, longestRun(values, predicate));
}

function estimatedSampleDurationMs(sampleCount: number, sourceFrames: DatasetCase['recording']['frames']): number | null {
  const intervalMs = medianFrameIntervalMs(sourceFrames);
  return intervalMs === null ? null : sampleCount * intervalMs;
}

function normalizedShortfall(value: number | null, target: number): number | null {
  if (value === null || target <= 0) return null;
  return Math.max(0, target - value) / target;
}

function frameAverageWristY(frame: DatasetCase['recording']['frames'][number], reliableOnly = false): number | null {
  const keypoints = frameKeypoints(frame);
  const values: number[] = [];
  for (const side of ['left', 'right'] as const) {
    const wrist = keypointByName(keypoints, `${side}_wrist`);
    if (!wrist) continue;
    if (reliableOnly && !keypointReliable(wrist)) continue;
    if (Number.isFinite(wrist.y)) values.push(wrist.y);
  }
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function framesAtOrBelowWristQuantile(
  frames: DatasetCase['recording']['frames'],
  quantile: number,
): DatasetCase['recording']['frames'] {
  const samples = frames
    .map((frame, index) => {
      const y = frameAverageWristY(frame, true);
      return y === null ? null : { index, y };
    })
    .filter((sample): sample is { index: number; y: number } => sample !== null);
  const cutoff = percentile(samples.map((sample) => sample.y), quantile);
  return cutoff === null ? [] : samples.filter((sample) => sample.y <= cutoff).map((sample) => frames[sample.index]);
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
    let dropoutFrames = 0;

    for (const frame of frames) {
      const keypoint = keypointByName(frameKeypoints(frame), joint);
      if (!keypoint) {
        dropoutFrames += 1;
        continue;
      }
      if (Number.isFinite(keypoint.x)) xs.push(keypoint.x);
      if (Number.isFinite(keypoint.y)) ys.push(keypoint.y);
      if (Number.isFinite(keypoint.z)) zs.push(keypoint.z as number);
      if (Number.isFinite(keypoint.score)) scores.push(keypoint.score);
      if (!Number.isFinite(keypoint.score) || keypoint.score < VISIBILITY_THRESHOLD) dropoutFrames += 1;
    }

    const prefix = `landmark.${joint}`;
    addStats(features, `${prefix}.x`, xs);
    addStats(features, `${prefix}.y`, ys);
    addStats(features, `${prefix}.z`, zs);
    addStats(features, `${prefix}.score`, scores);
    setFeature(features, `${prefix}.visible_rate`, frames.length === 0 ? null : scores.length / frames.length);
    setFeature(features, `${prefix}.dropout_rate`, frames.length === 0 ? null : dropoutFrames / frames.length);
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
  const average = mean(velocities);
  const deviation = std(velocities, average);
  const spikeThreshold = average !== null && deviation !== null ? average + 2 * deviation : null;
  setFeature(
    features,
    `${prefix}.velocity_spike_count`,
    spikeThreshold === null ? null : velocities.filter((velocity) => velocity > spikeThreshold).length,
  );
}

function addAngleStats(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
  side: 'left' | 'right',
): void {
  const elbowAngles: number[] = [];
  const shoulderAngles: number[] = [];
  for (const frame of frames) {
    const keypoints = frameKeypoints(frame);
    const shoulder = keypointByName(keypoints, `${side}_shoulder`);
    const elbow = keypointByName(keypoints, `${side}_elbow`);
    const wrist = keypointByName(keypoints, `${side}_wrist`);
    const hip = keypointByName(keypoints, `${side}_hip`);
    if (shoulder && elbow && wrist) elbowAngles.push(calculateAngle(shoulder, elbow, wrist));
    if (elbow && shoulder && hip) shoulderAngles.push(calculateAngle(elbow, shoulder, hip));
  }
  addStats(features, `biomech.${side}.elbow_angle`, elbowAngles);
  addStats(features, `biomech.${side}.shoulder_angle`, shoulderAngles);
}

function addTorsoStats(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
): void {
  const torsoLeanDeg: number[] = [];
  const shoulderXs: number[] = [];
  const hipXs: number[] = [];
  for (const frame of frames) {
    const keypoints = frameKeypoints(frame);
    const leftShoulder = keypointByName(keypoints, 'left_shoulder');
    const rightShoulder = keypointByName(keypoints, 'right_shoulder');
    const leftHip = keypointByName(keypoints, 'left_hip');
    const rightHip = keypointByName(keypoints, 'right_hip');
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) continue;
    const shoulderMid = midpoint(leftShoulder, rightShoulder);
    const hipMid = midpoint(leftHip, rightHip);
    shoulderXs.push(shoulderMid.x);
    hipXs.push(hipMid.x);
    const dx = shoulderMid.x - hipMid.x;
    const dy = shoulderMid.y - hipMid.y;
    torsoLeanDeg.push(Math.atan2(dx, Math.abs(dy) || 0.001) * (180 / Math.PI));
  }
  addStats(features, 'biomech.torso.lean_deg', torsoLeanDeg);
  addStats(features, 'biomech.torso.shoulder_mid_x', shoulderXs);
  addStats(features, 'biomech.torso.hip_mid_x', hipXs);
}

function addSymmetryStats(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
): void {
  const elbowAngleDiffs: number[] = [];
  const wristYDiffs: number[] = [];
  for (const frame of frames) {
    const keypoints = frameKeypoints(frame);
    const leftShoulder = keypointByName(keypoints, 'left_shoulder');
    const leftElbow = keypointByName(keypoints, 'left_elbow');
    const leftWrist = keypointByName(keypoints, 'left_wrist');
    const rightShoulder = keypointByName(keypoints, 'right_shoulder');
    const rightElbow = keypointByName(keypoints, 'right_elbow');
    const rightWrist = keypointByName(keypoints, 'right_wrist');
    if (leftShoulder && leftElbow && leftWrist && rightShoulder && rightElbow && rightWrist) {
      elbowAngleDiffs.push(
        Math.abs(
          calculateAngle(leftShoulder, leftElbow, leftWrist) -
          calculateAngle(rightShoulder, rightElbow, rightWrist),
        ),
      );
      wristYDiffs.push(Math.abs(leftWrist.y - rightWrist.y));
    }
  }
  addStats(features, 'biomech.symmetry.elbow_angle_abs_diff', elbowAngleDiffs);
  addStats(features, 'biomech.symmetry.wrist_y_abs_diff', wristYDiffs);
}

function addPhaseTimingFeatures(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
): void {
  const wristYSeries = frames
    .map((frame) => {
      const keypoints = frameKeypoints(frame);
      const left = keypointByName(keypoints, 'left_wrist');
      const right = keypointByName(keypoints, 'right_wrist');
      if (left && right) return { timestamp: frame.timestamp, y: (left.y + right.y) / 2 };
      if (left) return { timestamp: frame.timestamp, y: left.y };
      if (right) return { timestamp: frame.timestamp, y: right.y };
      return null;
    })
    .filter((sample): sample is { timestamp: number; y: number } => sample !== null);

  if (wristYSeries.length < 2) {
    setFeature(features, 'phase.first_segment_ms', null);
    setFeature(features, 'phase.second_segment_ms', null);
    setFeature(features, 'phase.wrist_y_range', null);
    return;
  }

  const ys = wristYSeries.map((sample) => sample.y);
  const minIndex = ys.indexOf(Math.min(...ys));
  const maxIndex = ys.indexOf(Math.max(...ys));
  const extremeIndex = Math.min(minIndex, maxIndex);
  const start = wristYSeries[0].timestamp;
  const end = wristYSeries[wristYSeries.length - 1].timestamp;
  const extreme = wristYSeries[extremeIndex].timestamp;
  setFeature(features, 'phase.first_segment_ms', Math.max(0, extreme - start));
  setFeature(features, 'phase.second_segment_ms', Math.max(0, end - extreme));
  setFeature(features, 'phase.wrist_y_range', Math.max(...ys) - Math.min(...ys));
}

function splitFramesByWristEndpoint(frames: DatasetCase['recording']['frames']): {
  first: DatasetCase['recording']['frames'];
  second: DatasetCase['recording']['frames'];
  top: DatasetCase['recording']['frames'];
  bottom: DatasetCase['recording']['frames'];
} {
  const samples = frames
    .map((frame, index) => {
      const keypoints = frameKeypoints(frame);
      const y = averageNullable(sideWristY(keypoints, 'left'), sideWristY(keypoints, 'right'));
      return y === null ? null : { index, y };
    })
    .filter((sample): sample is { index: number; y: number } => sample !== null);

  if (samples.length === 0) return { first: frames, second: [], top: [], bottom: [] };

  const topCutoff = percentile(samples.map((sample) => sample.y), 0.1);
  const bottomCutoff = percentile(samples.map((sample) => sample.y), 0.9);
  const top = topCutoff === null ? [] : samples.filter((sample) => sample.y <= topCutoff).map((sample) => frames[sample.index]);
  const bottom = bottomCutoff === null ? [] : samples.filter((sample) => sample.y >= bottomCutoff).map((sample) => frames[sample.index]);
  const extreme = samples.reduce((best, sample) => sample.y < best.y ? sample : best, samples[0]);
  return {
    first: frames.slice(0, extreme.index + 1),
    second: frames.slice(extreme.index),
    top,
    bottom,
  };
}

function armAngleSamples(frames: DatasetCase['recording']['frames'], side: ArmSide, reliableOnly = false): number[] {
  const values: number[] = [];
  for (const frame of frames) {
    const keypoints = frameKeypoints(frame);
    if (reliableOnly && !armReliable(keypoints, side)) continue;
    const angle = sideElbowAngle(keypoints, side);
    if (angle !== null && Number.isFinite(angle)) values.push(angle);
  }
  return values;
}

function wristYSamples(frames: DatasetCase['recording']['frames'], side: ArmSide, reliableOnly = false): number[] {
  const values: number[] = [];
  for (const frame of frames) {
    const keypoints = frameKeypoints(frame);
    if (reliableOnly && !armReliable(keypoints, side)) continue;
    const y = sideWristY(keypoints, side);
    if (y !== null && Number.isFinite(y)) values.push(y);
  }
  return values;
}

function extensionRatiosFromAngles(angles: number[]): number[] {
  return angles.map((angle) => angle / 180).filter((value) => Number.isFinite(value));
}

function addBottomExtensionFeatures(
  features: MlFeatureVector,
  prefix: string,
  angles: number[],
  sourceFrames: DatasetCase['recording']['frames'],
  phaseFrames: DatasetCase['recording']['frames'],
): void {
  const ratios = extensionRatiosFromAngles(angles);
  const shortfallFrom92 = ratios.map((value) => Math.max(0, 0.92 - value));
  const shortfallFrom95 = ratios.map((value) => Math.max(0, 0.95 - value));
  addPercentileStats(features, `${prefix}.bottom_elbow_angle_deg`, angles);
  addPercentileStats(features, `${prefix}.bottom_extension_ratio`, ratios);
  addPercentileStats(features, `${prefix}.bottom_shortfall_from_0_92`, shortfallFrom92);
  addPercentileStats(features, `${prefix}.bottom_shortfall_from_0_95`, shortfallFrom95);
  setFeature(features, `${prefix}.bottom_reliable_frame_count`, angles.length);
  setFeature(features, `${prefix}.bottom_reliable_frame_ratio`, phaseFrames.length === 0 ? null : angles.length / phaseFrames.length);
  setFeature(features, `${prefix}.bottom_hold_duration_ms`, estimatedSampleDurationMs(angles.length, sourceFrames));
  setFeature(features, `${prefix}.bottom_endpoint_stability_std`, std(ratios, mean(ratios)));
  setSupportFeatures(features, `${prefix}.short_extension_below_0_88`, ratios, (value) => value <= 0.88);
  setSupportFeatures(features, `${prefix}.short_extension_below_0_90`, ratios, (value) => value <= 0.9);
  setSupportFeatures(features, `${prefix}.extension_shortfall_above_0_04`, shortfallFrom92, (value) => value >= 0.04);
}

function addMlFeatureV2RomEndpointFeatures(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
  diagnostics?: ReplayRepPrediction['diagnostics'],
): void {
  const split = splitFramesByWristEndpoint(frames);
  const selectedSide = diagnostics?.selectedSide === 'right' ? 'right' : diagnostics?.selectedSide === 'left' ? 'left' : null;
  const leftAngles = armAngleSamples(frames, 'left', true);
  const rightAngles = armAngleSamples(frames, 'right', true);
  const leftWrist = wristYSamples(frames, 'left', true);
  const rightWrist = wristYSamples(frames, 'right', true);
  const leftRom = leftAngles.length === 0 ? null : Math.max(...leftAngles) - Math.min(...leftAngles);
  const rightRom = rightAngles.length === 0 ? null : Math.max(...rightAngles) - Math.min(...rightAngles);

  for (const [side, angles, wrist, rom] of [
    ['left', leftAngles, leftWrist, leftRom],
    ['right', rightAngles, rightWrist, rightRom],
  ] as const) {
    addPercentileStats(features, `v2.rom.${side}.elbow_angle_deg`, angles);
    addPercentileStats(features, `v2.rom.${side}.wrist_y`, wrist);
    setFeature(features, `v2.rom.${side}.rom_deg`, rom);
    setFeature(features, `v2.rom.${side}.reliable_frame_count`, angles.length);
    setFeature(features, `v2.rom.${side}.reliable_frame_ratio`, frames.length === 0 ? null : angles.length / frames.length);
    addEndpointHoldFeatures(features, `v2.rom.${side}.elbow_angle_deg`, angles, true);
  }

  const pairedBilateralAngles = leftAngles
    .map((left, index) => averageNullable(left, rightAngles[index] ?? null))
    .filter((value): value is number => value !== null);
  addPercentileStats(features, 'v2.rom.bilateral.elbow_angle_deg', pairedBilateralAngles);
  setFeature(features, 'v2.rom.bilateral.average_rom_deg', mean([leftRom, rightRom].filter((value): value is number => value !== null)));
  setFeature(features, 'v2.rom.left_right_rom_diff_deg', leftRom !== null && rightRom !== null ? Math.abs(leftRom - rightRom) : null);
  setFeature(features, 'v2.rom.left_right_rom_ratio', leftRom !== null && rightRom !== null && Math.max(leftRom, rightRom) > 0
    ? Math.min(leftRom, rightRom) / Math.max(leftRom, rightRom)
    : null);

  const selectedAngles = selectedSide === 'left' ? leftAngles : selectedSide === 'right' ? rightAngles : pairedBilateralAngles;
  const selectedRom = selectedSide === 'left' ? leftRom : selectedSide === 'right' ? rightRom : mean([leftRom, rightRom].filter((value): value is number => value !== null));
  addPercentileStats(features, 'v2.rom.selected_arm.elbow_angle_deg', selectedAngles);
  setFeature(features, 'v2.rom.selected_arm.rom_deg', selectedRom);
  addEndpointHoldFeatures(features, 'v2.rom.selected_arm.elbow_angle_deg', selectedAngles, true);

  const bottomLeft = armAngleSamples(split.bottom, 'left', true);
  const bottomRight = armAngleSamples(split.bottom, 'right', true);
  const bottomBilateral = bottomLeft
    .map((left, index) => averageNullable(left, bottomRight[index] ?? null))
    .filter((value): value is number => value !== null);
  const bottomSelected = selectedSide === 'left'
    ? bottomLeft
    : selectedSide === 'right'
      ? bottomRight
      : bottomBilateral;
  addBottomExtensionFeatures(features, 'v2.rom.extension.left', bottomLeft, frames, split.bottom);
  addBottomExtensionFeatures(features, 'v2.rom.extension.right', bottomRight, frames, split.bottom);
  addBottomExtensionFeatures(features, 'v2.rom.extension.bilateral', bottomBilateral, frames, split.bottom);
  addBottomExtensionFeatures(features, 'v2.rom.extension.selected_arm', bottomSelected, frames, split.bottom);
  const selectedBottomRatioP50 = percentile(extensionRatiosFromAngles(bottomSelected), 0.5);
  const bilateralBottomRatioP50 = percentile(extensionRatiosFromAngles(bottomBilateral), 0.5);
  const leftBottomRatioP50 = percentile(extensionRatiosFromAngles(bottomLeft), 0.5);
  const rightBottomRatioP50 = percentile(extensionRatiosFromAngles(bottomRight), 0.5);
  setFeature(
    features,
    'v2.rom.extension.selected_vs_bilateral_bottom_ratio_diff',
    selectedBottomRatioP50 !== null && bilateralBottomRatioP50 !== null
      ? Math.abs(selectedBottomRatioP50 - bilateralBottomRatioP50)
      : null,
  );
  setFeature(
    features,
    'v2.rom.extension.left_right_bottom_ratio_diff',
    leftBottomRatioP50 !== null && rightBottomRatioP50 !== null
      ? Math.abs(leftBottomRatioP50 - rightBottomRatioP50)
      : null,
  );
  setFeature(
    features,
    'v2.rom.extension.selected_arm.bottom_extension_margin_from_0_92',
    selectedBottomRatioP50 === null ? null : selectedBottomRatioP50 - 0.92,
  );
  setFeature(
    features,
    'v2.rom.extension.selected_arm.normalized_shortfall_from_0_92',
    normalizedShortfall(selectedBottomRatioP50, 0.92),
  );

  for (const [name, phaseFrames] of Object.entries({
    concentric: split.first,
    eccentric: split.second,
    top_endpoint: split.top,
    bottom_endpoint: split.bottom,
  })) {
    const phaseLeft = armAngleSamples(phaseFrames, 'left', true);
    const phaseRight = armAngleSamples(phaseFrames, 'right', true);
    const phaseBilateral = phaseLeft
      .map((left, index) => averageNullable(left, phaseRight[index] ?? null))
      .filter((value): value is number => value !== null);
    const phaseSelected = selectedSide === 'left'
      ? phaseLeft
      : selectedSide === 'right'
        ? phaseRight
        : phaseBilateral;
    addPercentileStats(features, `v2.rom.phase.${name}.bilateral_elbow_angle_deg`, phaseBilateral);
    addPercentileStats(features, `v2.rom.phase.${name}.selected_arm_elbow_angle_deg`, phaseSelected);
    setFeature(features, `v2.rom.phase.${name}.frame_count`, phaseFrames.length);
    setFeature(
      features,
      `v2.rom.phase.${name}.selected_reliable_frame_ratio`,
      phaseFrames.length === 0 ? null : phaseSelected.length / phaseFrames.length,
    );
  }
}

function phaseWristVelocities(frames: DatasetCase['recording']['frames']): number[] {
  return wristVelocityDetails(frames, false).absolute;
}

interface WristVelocityDetails {
  absolute: number[];
  upward: number[];
  downward: number[];
  signed: number[];
  pairCount: number;
  reliablePairCount: number;
  gapCount: number;
  maxGapMs: number | null;
}

function wristVelocityDetails(frames: DatasetCase['recording']['frames'], reliableOnly: boolean): WristVelocityDetails {
  const absolute: number[] = [];
  const upward: number[] = [];
  const downward: number[] = [];
  const signed: number[] = [];
  let reliablePairCount = 0;
  let gapCount = 0;
  let maxGapMs: number | null = null;
  const medianInterval = medianFrameIntervalMs(frames);
  for (let index = 1; index < frames.length; index += 1) {
    const dtMs = frames[index].timestamp - frames[index - 1].timestamp;
    if (!Number.isFinite(dtMs) || dtMs <= 0) continue;
    if (medianInterval !== null && dtMs > medianInterval * 2.5) gapCount += 1;
    maxGapMs = maxGapMs === null ? dtMs : Math.max(maxGapMs, dtMs);
    const previous = frameAverageWristY(frames[index - 1], reliableOnly);
    const current = frameAverageWristY(frames[index], reliableOnly);
    const prevReliable = frameAverageWristY(frames[index - 1], true) !== null;
    const currReliable = frameAverageWristY(frames[index], true) !== null;
    if (prevReliable && currReliable) reliablePairCount += 1;
    const prevY = previous;
    const currY = current;
    if (prevY === null || currY === null) continue;
    const dt = Math.max(0.001, dtMs / 1000);
    const signedVelocity = (prevY - currY) / dt;
    signed.push(signedVelocity);
    absolute.push(Math.abs(signedVelocity));
    if (signedVelocity > 0) upward.push(signedVelocity);
    if (signedVelocity < 0) downward.push(Math.abs(signedVelocity));
  }
  return {
    absolute,
    upward,
    downward,
    signed,
    pairCount: Math.max(0, frames.length - 1),
    reliablePairCount,
    gapCount,
    maxGapMs,
  };
}

function addTempoPhaseFeatures(
  features: MlFeatureVector,
  prefix: string,
  phaseFrames: DatasetCase['recording']['frames'],
  sourceFrames: DatasetCase['recording']['frames'],
): void {
  const velocity = wristVelocityDetails(phaseFrames, false);
  const reliableVelocity = wristVelocityDetails(phaseFrames, true);
  const duration = phaseDurationMs(phaseFrames);
  addPercentileStats(features, `${prefix}.wrist_velocity`, velocity.absolute);
  addPercentileStats(features, `${prefix}.reliable_wrist_velocity`, reliableVelocity.absolute);
  addPercentileStats(features, `${prefix}.upward_wrist_velocity`, velocity.upward);
  addPercentileStats(features, `${prefix}.downward_wrist_velocity`, velocity.downward);
  setFeature(features, `${prefix}.duration_ms`, duration);
  setFeature(features, `${prefix}.sample_count`, phaseFrames.length);
  setFeature(features, `${prefix}.velocity_sample_count`, velocity.absolute.length);
  setFeature(features, `${prefix}.reliable_velocity_sample_count`, reliableVelocity.absolute.length);
  setFeature(
    features,
    `${prefix}.reliable_velocity_sample_ratio`,
    velocity.pairCount === 0 ? null : reliableVelocity.absolute.length / velocity.pairCount,
  );
  setFeature(features, `${prefix}.phase_duration_reliability`, phaseFrames.length === 0 ? null : reliableVelocity.reliablePairCount / Math.max(1, phaseFrames.length - 1));
  setFeature(features, `${prefix}.tracking_gap_count`, velocity.gapCount);
  setFeature(features, `${prefix}.max_tracking_gap_ms`, velocity.maxGapMs);
  setFeature(features, `${prefix}.estimated_sample_duration_ms`, estimatedSampleDurationMs(phaseFrames.length, sourceFrames));
  for (const target of [700, 900, 1100, 1300]) {
    setFeature(features, `${prefix}.duration_shortfall_${target}ms`, normalizedShortfall(duration, target));
  }
  const p75 = percentile(velocity.absolute, 0.75);
  const p90 = percentile(velocity.absolute, 0.9);
  const shortfall1100 = normalizedShortfall(duration, 1100);
  setFeature(
    features,
    `${prefix}.fast_evidence`,
    p90 === null
      ? null
      : p90 * (1 + (shortfall1100 ?? 0)),
  );
  setFeature(
    features,
    `${prefix}.sustained_fast_evidence`,
    p75 === null
      ? null
      : p75 * (1 + (shortfall1100 ?? 0)),
  );
}

function addMlFeatureV2TempoFeatures(features: MlFeatureVector, frames: DatasetCase['recording']['frames']): void {
  const split = splitFramesByWristEndpoint(frames);
  const concentricDuration = phaseDurationMs(split.first);
  const eccentricDuration = phaseDurationMs(split.second);
  setFeature(features, 'v2.tempo.concentric_duration_ms', concentricDuration);
  setFeature(features, 'v2.tempo.eccentric_duration_ms', eccentricDuration);
  setFeature(features, 'v2.tempo.up_phase_duration_ms', concentricDuration);
  setFeature(features, 'v2.tempo.down_phase_duration_ms', eccentricDuration);
  setFeature(features, 'v2.tempo.concentric_eccentric_ratio', concentricDuration !== null && eccentricDuration !== null && eccentricDuration > 0
    ? concentricDuration / eccentricDuration
    : null);
  setFeature(features, 'v2.tempo.up_down_duration_ratio', concentricDuration !== null && eccentricDuration !== null && eccentricDuration > 0
    ? concentricDuration / eccentricDuration
    : null);
  setFeature(features, 'v2.tempo.duration_balance_abs_log_ratio', concentricDuration !== null && eccentricDuration !== null && concentricDuration > 0 && eccentricDuration > 0
    ? Math.abs(Math.log(concentricDuration / eccentricDuration))
    : null);

  for (const [name, phaseFrames] of Object.entries({ concentric: split.first, eccentric: split.second, full: frames })) {
    addTempoPhaseFeatures(features, `v2.tempo.${name}`, phaseFrames, frames);
    const velocities = phaseWristVelocities(phaseFrames);
    const lowVelocity = percentile(velocities, 0.1);
    setFeature(features, `v2.tempo.${name}.low_velocity_frame_count`, lowVelocity === null ? null : velocities.filter((value) => value <= lowVelocity).length);
  }
  const fullLowVelocity = percentile(phaseWristVelocities(frames), 0.15);
  const topVelocities = phaseWristVelocities(split.top);
  const bottomVelocities = phaseWristVelocities(split.bottom);
  setFeature(features, 'v2.tempo.top_pause_frames', fullLowVelocity === null ? null : topVelocities.filter((value) => value <= fullLowVelocity).length);
  setFeature(features, 'v2.tempo.bottom_pause_frames', fullLowVelocity === null ? null : bottomVelocities.filter((value) => value <= fullLowVelocity).length);
  setFeature(
    features,
    'v2.tempo.top_pause_duration_ms',
    fullLowVelocity === null ? null : estimatedSampleDurationMs(topVelocities.filter((value) => value <= fullLowVelocity).length, frames),
  );
  setFeature(
    features,
    'v2.tempo.bottom_pause_duration_ms',
    fullLowVelocity === null ? null : estimatedSampleDurationMs(bottomVelocities.filter((value) => value <= fullLowVelocity).length, frames),
  );
  setFeature(features, 'v2.tempo.top_endpoint_sample_count', split.top.length);
  setFeature(features, 'v2.tempo.bottom_endpoint_sample_count', split.bottom.length);
  setFeature(features, 'v2.tempo.fast_up_evidence', features['v2.tempo.concentric.fast_evidence']);
  setFeature(features, 'v2.tempo.fast_down_evidence', features['v2.tempo.eccentric.fast_evidence']);
  setFeature(features, 'v2.tempo.fast_up_duration_shortfall_1100ms', features['v2.tempo.concentric.duration_shortfall_1100ms']);
  setFeature(features, 'v2.tempo.fast_down_duration_shortfall_1100ms', features['v2.tempo.eccentric.duration_shortfall_1100ms']);
  setFeature(features, 'v2.tempo.phase_completeness', frames.length === 0 ? null : Math.min(split.first.length, split.second.length) / frames.length);
}

function shoulderMidpoint(frame: DatasetCase['recording']['frames'][number], reliableOnly = false): Keypoint | null {
  const keypoints = frameKeypoints(frame);
  const left = keypointByName(keypoints, 'left_shoulder');
  const right = keypointByName(keypoints, 'right_shoulder');
  if (reliableOnly && (!keypointReliable(left) || !keypointReliable(right))) return null;
  return left && right ? midpoint(left, right) : null;
}

function hipMidpoint(frame: DatasetCase['recording']['frames'][number], reliableOnly = false): Keypoint | null {
  const keypoints = frameKeypoints(frame);
  const left = keypointByName(keypoints, 'left_hip');
  const right = keypointByName(keypoints, 'right_hip');
  if (reliableOnly && (!keypointReliable(left) || !keypointReliable(right))) return null;
  return left && right ? midpoint(left, right) : null;
}

function torsoLeanSample(frame: DatasetCase['recording']['frames'][number]): number | null {
  const keypoints = frameKeypoints(frame);
  if (!torsoReliable(keypoints)) return null;
  const leftShoulder = keypointByName(keypoints, 'left_shoulder');
  const rightShoulder = keypointByName(keypoints, 'right_shoulder');
  const leftHip = keypointByName(keypoints, 'left_hip');
  const rightHip = keypointByName(keypoints, 'right_hip');
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const hipMid = midpoint(leftHip, rightHip);
  return Math.atan2(shoulderMid.x - hipMid.x, Math.abs(shoulderMid.y - hipMid.y) || 0.001) * (180 / Math.PI);
}

function shoulderRelativeToHipVector(frame: DatasetCase['recording']['frames'][number]): { x: number; y: number; z: number } | null {
  const shoulder = shoulderMidpoint(frame, true);
  const hip = hipMidpoint(frame, true);
  if (!shoulder || !hip) return null;
  const keypoints = frameKeypoints(frame);
  const normalizer = normalizerFromTorso(keypoints);
  if (normalizer === null) return null;
  return {
    x: (shoulder.x - hip.x) / normalizer,
    y: (shoulder.y - hip.y) / normalizer,
    z: ((shoulder.z ?? 0) - (hip.z ?? 0)) / normalizer,
  };
}

function vectorDistance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function sideShoulderAngle(frame: DatasetCase['recording']['frames'][number], side: ArmSide): number | null {
  const keypoints = frameKeypoints(frame);
  if (!armReliable(keypoints, side)) return null;
  const elbow = keypointByName(keypoints, `${side}_elbow`);
  const shoulder = keypointByName(keypoints, `${side}_shoulder`);
  const hip = keypointByName(keypoints, `${side}_hip`);
  if (!elbow || !shoulder || !hip || !keypointReliable(hip)) return null;
  return calculateAngle(elbow, shoulder, hip);
}

function firstNonNull<T>(values: Array<T | null>): T | null {
  for (const value of values) {
    if (value !== null) return value;
  }
  return null;
}

function addMlFeatureV2ShoulderTorsoFeatures(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
  diagnostics?: ReplayRepPrediction['diagnostics'],
): void {
  const split = splitFramesByWristEndpoint(frames);
  const selectedSide = diagnostics?.selectedSide === 'right' ? 'right' : diagnostics?.selectedSide === 'left' ? 'left' : null;
  const topHalf = framesAtOrBelowWristQuantile(frames, 0.5);
  const baseShoulder = firstNonNull(frames.map((frame) => shoulderMidpoint(frame, true)));
  const baseHip = firstNonNull(frames.map((frame) => hipMidpoint(frame, true)));
  const baseRelative = firstNonNull(frames.map(shoulderRelativeToHipVector));
  const baseLeftShoulderAngle = firstNonNull(frames.map((frame) => sideShoulderAngle(frame, 'left')));
  const baseRightShoulderAngle = firstNonNull(frames.map((frame) => sideShoulderAngle(frame, 'right')));
  const shoulderDrift = (phaseFrames: DatasetCase['recording']['frames']) => phaseFrames
    .map((frame) => {
      const current = shoulderMidpoint(frame, true);
      return current && baseShoulder ? distance(current, baseShoulder) : null;
    })
    .filter((value): value is number => value !== null);
  const hipDrift = (phaseFrames: DatasetCase['recording']['frames']) => phaseFrames
    .map((frame) => {
      const current = hipMidpoint(frame, true);
      return current && baseHip ? distance(current, baseHip) : null;
    })
    .filter((value): value is number => value !== null);
  const relativeDrift = (phaseFrames: DatasetCase['recording']['frames']) => phaseFrames
    .map((frame) => {
      const current = shoulderRelativeToHipVector(frame);
      return current && baseRelative ? vectorDistance(current, baseRelative) : null;
    })
    .filter((value): value is number => value !== null);
  const upperArmAngleChange = (phaseFrames: DatasetCase['recording']['frames'], side: ArmSide) => {
    const base = side === 'left' ? baseLeftShoulderAngle : baseRightShoulderAngle;
    return phaseFrames
      .map((frame) => {
        const angle = sideShoulderAngle(frame, side);
        return angle !== null && base !== null ? Math.abs(angle - base) : null;
      })
      .filter((value): value is number => value !== null);
  };
  const torsoLean = (phaseFrames: DatasetCase['recording']['frames']) => phaseFrames
    .map(torsoLeanSample)
    .filter((value): value is number => value !== null);

  for (const [name, phaseFrames] of Object.entries({
    full: frames,
    concentric: split.first,
    eccentric: split.second,
    top_half: topHalf,
    top_endpoint: split.top,
  })) {
    const shoulder = shoulderDrift(phaseFrames);
    const shoulderP90 = percentile(shoulder, 0.9);
    const shoulderP75 = percentile(shoulder, 0.75);
    addPercentileStats(features, `v2.shoulder.${name}.drift`, shoulder);
    setFeature(features, `v2.shoulder.${name}.sustained_drift_frames`, shoulderP90 === null ? null : shoulder.filter((value) => value >= shoulderP90).length);
    setFeature(features, `v2.shoulder.${name}.support_ratio`, phaseFrames.length === 0 ? null : shoulder.length / phaseFrames.length);
    setSupportFeatures(features, `v2.shoulder.${name}.drift_above_0_03`, shoulder, (value) => value >= 0.03);
    setSupportFeatures(features, `v2.shoulder.${name}.drift_above_0_05`, shoulder, (value) => value >= 0.05);
    setSupportFeatures(features, `v2.shoulder.${name}.sustained_drift_above_p75`, shoulder, (value) => shoulderP75 !== null && value >= shoulderP75);

    const relativeShoulder = relativeDrift(phaseFrames);
    addPercentileStats(features, `v2.shoulder.${name}.relative_to_hip_drift`, relativeShoulder);
    setSupportFeatures(features, `v2.shoulder.${name}.relative_to_hip_drift_above_0_03`, relativeShoulder, (value) => value >= 0.03);
    setSupportFeatures(features, `v2.shoulder.${name}.relative_to_hip_drift_above_0_05`, relativeShoulder, (value) => value >= 0.05);

    const leftUpperArm = upperArmAngleChange(phaseFrames, 'left');
    const rightUpperArm = upperArmAngleChange(phaseFrames, 'right');
    const selectedUpperArm = selectedSide === 'left'
      ? leftUpperArm
      : selectedSide === 'right'
        ? rightUpperArm
        : leftUpperArm
          .map((left, index) => averageNullable(left, rightUpperArm[index] ?? null))
          .filter((value): value is number => value !== null);
    addPercentileStats(features, `v2.shoulder.${name}.upper_arm_angle_change.left`, leftUpperArm);
    addPercentileStats(features, `v2.shoulder.${name}.upper_arm_angle_change.right`, rightUpperArm);
    addPercentileStats(features, `v2.shoulder.${name}.upper_arm_angle_change.selected`, selectedUpperArm);
    setSupportFeatures(features, `v2.shoulder.${name}.upper_arm_angle_change.selected_above_8deg`, selectedUpperArm, (value) => value >= 8);
    setSupportFeatures(features, `v2.shoulder.${name}.upper_arm_angle_change.selected_above_12deg`, selectedUpperArm, (value) => value >= 12);

    const torso = torsoLean(phaseFrames);
    const absTorso = torso.map(Math.abs);
    const torsoP90 = percentile(absTorso, 0.9);
    const torsoP95 = percentile(absTorso, 0.95);
    const torsoMax = absTorso.length === 0 ? null : Math.max(...absTorso);
    addPercentileStats(features, `v2.torso.${name}.lean_deg`, torso);
    addPercentileStats(features, `v2.torso.${name}.abs_lean_deg`, absTorso);
    setFeature(features, `v2.torso.${name}.sustained_lean_frames`, torsoP90 === null ? null : absTorso.filter((value) => value >= torsoP90).length);
    setFeature(features, `v2.torso.${name}.reliable_frame_ratio`, phaseFrames.length === 0 ? null : torso.length / phaseFrames.length);
    setFeature(features, `v2.torso.${name}.robust_abs_delta_p75_minus_p25`, robustRange(absTorso, 0.25, 0.75));
    setFeature(features, `v2.torso.${name}.robust_abs_delta_p90_minus_p10`, robustRange(absTorso, 0.1, 0.9));
    setFeature(features, `v2.torso.${name}.robust_abs_delta_p95_minus_p05`, robustRange(absTorso, 0.05, 0.95));
    setFeature(
      features,
      `v2.torso.${name}.outlier_spike_indicator`,
      torsoMax !== null && torsoP95 !== null ? torsoMax - torsoP95 : null,
    );
    setFeature(
      features,
      `v2.torso.${name}.raw_vs_robust_spike_ratio`,
      torsoMax !== null && torsoP90 !== null
        ? torsoMax / Math.max(0.000001, torsoP90)
        : null,
    );
    setSupportFeatures(features, `v2.torso.${name}.sustained_lean_above_3deg`, absTorso, (value) => value >= 3);
    setSupportFeatures(features, `v2.torso.${name}.sustained_lean_above_5deg`, absTorso, (value) => value >= 5);
    setSupportFeatures(features, `v2.torso.${name}.sustained_lean_above_8deg`, absTorso, (value) => value >= 8);

    const hip = hipDrift(phaseFrames);
    addPercentileStats(features, `v2.torso.${name}.anchor.hip_mid_drift`, hip);
  }

  const fullTorso = torsoLean(frames).map(Math.abs);
  const p10 = percentile(fullTorso, 0.1);
  const p90 = percentile(fullTorso, 0.9);
  const p05 = percentile(fullTorso, 0.05);
  const p95 = percentile(fullTorso, 0.95);
  const maxValue = fullTorso.length === 0 ? null : Math.max(...fullTorso);
  setFeature(features, 'v2.torso.robust_abs_delta_p90_minus_p10', p10 !== null && p90 !== null ? p90 - p10 : null);
  setFeature(features, 'v2.torso.robust_abs_delta_p95_minus_p05', p05 !== null && p95 !== null ? p95 - p05 : null);
  setFeature(features, 'v2.torso.robust_abs_delta_p75_minus_p25', robustRange(fullTorso, 0.25, 0.75));
  setFeature(features, 'v2.torso.outlier_spike_abs_delta', maxValue !== null && p90 !== null ? maxValue - p90 : null);
  setFeature(features, 'v2.torso.raw_vs_robust_spike_ratio', maxValue !== null && p90 !== null ? maxValue / Math.max(0.000001, p90) : null);
  setFeature(features, 'v2.torso.anchor_reliable_frame_ratio', frames.length === 0 ? null : fullTorso.length / frames.length);
  const firstQuarter = frames.slice(0, Math.max(1, Math.ceil(frames.length / 4)));
  const firstQuarterAbsTorso = torsoLean(firstQuarter).map(Math.abs);
  setFeature(features, 'v2.torso.baseline_stability.first_quarter_abs_lean_std', std(firstQuarterAbsTorso, mean(firstQuarterAbsTorso)));
  setFeature(features, 'v2.torso.baseline_stability.first_quarter_robust_abs_delta_p90_minus_p10', robustRange(firstQuarterAbsTorso, 0.1, 0.9));
  setBooleanFeature(features, 'v2.shoulder.selected_side_available', selectedSide !== null);
}

function elbowFlareOffset(frame: DatasetCase['recording']['frames'][number], side: ArmSide): number | null {
  const keypoints = frameKeypoints(frame);
  if (!armReliable(keypoints, side)) return null;
  const shoulder = keypointByName(keypoints, `${side}_shoulder`);
  const elbow = keypointByName(keypoints, `${side}_elbow`);
  const wrist = keypointByName(keypoints, `${side}_wrist`);
  if (!shoulder || !elbow || !wrist) return null;
  const torso = normalizerFromTorso(keypoints);
  const fallback = Math.abs(shoulder.x - wrist.x);
  const normalizer = torso ?? (fallback > 0 ? fallback : 1);
  return Math.abs(elbow.x - ((shoulder.x + wrist.x) / 2)) / Math.max(0.000001, normalizer);
}

function addMlFeatureV2ElbowAsymmetryFeatures(features: MlFeatureVector, frames: DatasetCase['recording']['frames']): void {
  const split = splitFramesByWristEndpoint(frames);
  for (const [name, phaseFrames] of Object.entries({ full: frames, concentric: split.first, eccentric: split.second, top_half: split.top })) {
    const leftFlare = phaseFrames.map((frame) => elbowFlareOffset(frame, 'left')).filter((value): value is number => value !== null);
    const rightFlare = phaseFrames.map((frame) => elbowFlareOffset(frame, 'right')).filter((value): value is number => value !== null);
    const bilateral = leftFlare
      .map((left, index) => averageNullable(left, rightFlare[index] ?? null))
      .filter((value): value is number => value !== null);
    addPercentileStats(features, `v2.elbow_flare.${name}.left_offset`, leftFlare);
    addPercentileStats(features, `v2.elbow_flare.${name}.right_offset`, rightFlare);
    addPercentileStats(features, `v2.elbow_flare.${name}.bilateral_offset`, bilateral);
    const p75 = percentile(bilateral, 0.75);
    setFeature(features, `v2.elbow_flare.${name}.support_ratio_above_p75`, p75 === null || bilateral.length === 0 ? null : bilateral.filter((value) => value >= p75).length / bilateral.length);
    const leftMean = mean(leftFlare);
    const rightMean = mean(rightFlare);
    setFeature(features, `v2.elbow_flare.${name}.left_right_consistency`, leftMean !== null && rightMean !== null
      ? 1 - Math.abs(leftMean - rightMean) / Math.max(0.000001, Math.max(leftMean, rightMean))
      : null);
  }

  const leftAngles = armAngleSamples(frames, 'left', true);
  const rightAngles = armAngleSamples(frames, 'right', true);
  const leftRange = leftAngles.length === 0 ? null : Math.max(...leftAngles) - Math.min(...leftAngles);
  const rightRange = rightAngles.length === 0 ? null : Math.max(...rightAngles) - Math.min(...rightAngles);
  setFeature(features, 'v2.asymmetry.reliability_weighted_rom_diff_deg', leftRange !== null && rightRange !== null ? Math.abs(leftRange - rightRange) : null);
  setFeature(features, 'v2.asymmetry.left_right_reliability_imbalance', frames.length === 0 ? null : Math.abs(leftAngles.length - rightAngles.length) / frames.length);
  setFeature(features, 'v2.asymmetry.left_right_endpoint_top_diff_deg', leftAngles.length > 0 && rightAngles.length > 0
    ? Math.abs((percentile(leftAngles, 0.1) ?? 0) - (percentile(rightAngles, 0.1) ?? 0))
    : null);
  setFeature(features, 'v2.asymmetry.left_right_endpoint_bottom_diff_deg', leftAngles.length > 0 && rightAngles.length > 0
    ? Math.abs((percentile(leftAngles, 0.9) ?? 0) - (percentile(rightAngles, 0.9) ?? 0))
    : null);
  const leftTopIndex = leftAngles.length === 0 ? null : leftAngles.indexOf(Math.min(...leftAngles));
  const rightTopIndex = rightAngles.length === 0 ? null : rightAngles.indexOf(Math.min(...rightAngles));
  setFeature(features, 'v2.asymmetry.top_endpoint_timing_delta_frames', leftTopIndex !== null && rightTopIndex !== null ? Math.abs(leftTopIndex - rightTopIndex) : null);
}

function addMlFeatureV2ReliabilityFeatures(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
  diagnostics?: ReplayRepPrediction['diagnostics'],
): void {
  const chainFrames = {
    left_arm: frames.filter((frame) => armReliable(frameKeypoints(frame), 'left')).length,
    right_arm: frames.filter((frame) => armReliable(frameKeypoints(frame), 'right')).length,
    torso: frames.filter((frame) => torsoReliable(frameKeypoints(frame))).length,
  };
  for (const [chain, count] of Object.entries(chainFrames)) {
    setFeature(features, `v2.reliability.${chain}.reliable_frame_count`, count);
    setFeature(features, `v2.reliability.${chain}.reliable_frame_ratio`, frames.length === 0 ? null : count / frames.length);
  }
  setFeature(features, 'v2.reliability.usable_chain_count', diagnostics?.reliability?.usableChains.length ?? null);
  setFeature(features, 'v2.reliability.weak_chain_count', diagnostics?.reliability?.weakChains.length ?? null);
  setFeature(features, 'v2.reliability.safe_cue_family_count', diagnostics?.reliability?.safeCueFamilies.length ?? null);
  setFeature(features, 'v2.reliability.unsafe_cue_family_count', diagnostics?.reliability?.unsafeCueFamilies.length ?? null);
  setFeature(features, 'v2.reliability.view_blocked_cue_family_count', diagnostics?.viewCueGating?.viewBlockedCueFamilies.length ?? null);
  setFeature(features, 'v2.reliability.pose_state_blocked_cue_family_count', diagnostics?.viewCueGating?.poseStateBlockedCueFamilies.length ?? null);
  setFeature(features, 'v2.view.front_support_ratio', diagnostics?.metrics.frontViewSupportRatio?.value);
  setFeature(features, 'v2.view.side_support_ratio', diagnostics?.metrics.sideViewSupportRatio?.value);
  setFeature(features, 'v2.view.support_ratio', diagnostics?.metrics.viewSupportRatio?.value);
  setBooleanFeature(features, 'v2.safety.scorable', diagnostics?.scorable);
  setBooleanFeature(features, 'v2.safety.partial_view_scoring_allowed', diagnostics?.viewCueGating?.partialViewScoringAllowed);
}

function addMlFeatureV2(
  features: MlFeatureVector,
  frames: DatasetCase['recording']['frames'],
  diagnostics?: ReplayRepPrediction['diagnostics'],
): void {
  addMlFeatureV2RomEndpointFeatures(features, frames, diagnostics);
  addMlFeatureV2TempoFeatures(features, frames);
  addMlFeatureV2ShoulderTorsoFeatures(features, frames, diagnostics);
  addMlFeatureV2ElbowAsymmetryFeatures(features, frames);
  addMlFeatureV2ReliabilityFeatures(features, frames, diagnostics);
}

function issueScorableMask(
  definition: ExerciseDefinition,
  label: RepLabel,
  fallbackView?: RepViewLabel,
): Record<string, boolean> {
  const policy = getExerciseLabelPolicy(definition.name);
  const view = label.view ?? fallbackView ?? 'unknown';
  const baseScorable = label.scorable ?? true;
  const issues = getLabelableIssues(definition);
  return Object.fromEntries(
    issues.map((issue) => [
      issue.issueId,
      baseScorable && (!policy || isIssueLabelableForView(policy, issue.issueId, view)),
    ]),
  );
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
  definition: ExerciseDefinition,
  datasetCase: DatasetCase,
  label: RepLabel,
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
  setFeature(features, 'rep.start_confidence', frames[0] ? mean(frameKeypoints(frames[0]).map((keypoint) => keypoint.score)) : null);
  setFeature(features, 'rep.end_confidence', frames[frames.length - 1] ? mean(frameKeypoints(frames[frames.length - 1]).map((keypoint) => keypoint.score)) : null);

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
  addAngleStats(features, frames, 'left');
  addAngleStats(features, frames, 'right');
  addTorsoStats(features, frames);
  addSymmetryStats(features, frames);
  addPhaseTimingFeatures(features, frames);
  addMlFeatureV2(features, frames, diagnostics);

  const mask = issueScorableMask(definition, label, rep.predictedView);
  for (const [issueId, scorable] of Object.entries(mask)) {
    setBooleanFeature(features, `scorable.issue.${safeFeaturePart(issueId)}`, scorable);
  }

  return features;
}

function prefixRuntimeFeatures(features: MlFeatureVector): MlFeatureVector {
  return Object.fromEntries(
    Object.entries(features).map(([key, value]) => [`feature__${key}`, value]),
  );
}

export function buildRuntimeMlFeatureVector(options: BuildRuntimeMlFeatureVectorOptions): MlFeatureVector {
  const features: MlFeatureVector = {};
  const frames = options.frames;
  const durationMs = Math.max(0, options.durationMs);
  const diagnostics = options.diagnostics;

  setFeature(features, 'rep.duration_ms', durationMs);
  setFeature(features, 'rep.frame_count', frames.length);
  setFeature(features, 'rep.fps_estimate', durationMs > 0 ? (frames.length * 1000) / durationMs : null);
  setFeature(features, 'rep.overlap_ms', options.overlapMs);
  setFeature(features, 'rep.completion_delta_ms', options.completionDeltaMs);
  setFeature(features, 'rep.start_confidence', frames[0] ? mean(frameKeypoints(frames[0]).map((keypoint) => keypoint.score)) : null);
  setFeature(features, 'rep.end_confidence', frames[frames.length - 1] ? mean(frameKeypoints(frames[frames.length - 1]).map((keypoint) => keypoint.score)) : null);

  setFeature(features, 'heuristic.score', options.score);
  setFeature(features, 'heuristic.issue_count', options.issueIds.length);
  setBooleanFeature(features, 'heuristic.has_issue', options.issueIds.length > 0);
  setBooleanFeature(features, 'heuristic.scorable', options.scorable ?? diagnostics?.scorable);

  setFeature(features, 'pose.confidence', options.confidence);
  setFeature(features, 'pose.warning_count', options.qualityWarnings?.length ?? 0);
  for (const status of POSE_QUALITY_STATUSES) {
    setBooleanFeature(features, `pose.status.${status}`, options.qualityStatus === status);
  }

  for (const issueId of options.issueIds) {
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
  addAngleStats(features, frames, 'left');
  addAngleStats(features, frames, 'right');
  addTorsoStats(features, frames);
  addSymmetryStats(features, frames);
  addPhaseTimingFeatures(features, frames);
  addMlFeatureV2(features, frames, diagnostics);

  const view = options.view ?? diagnostics?.view ?? 'unknown';
  const mask = issueScorableMask(
    options.definition,
    {
      index: options.repIndex,
      startMs: 0,
      endMs: durationMs,
      issueIds: [],
      view,
      scorable: options.scorable ?? diagnostics?.scorable ?? true,
    },
    view,
  );
  for (const [issueId, scorable] of Object.entries(mask)) {
    setBooleanFeature(features, `scorable.issue.${safeFeaturePart(issueId)}`, scorable);
  }

  return prefixRuntimeFeatures(features);
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
        issueSeverities: label.issueSeverities,
        issueScorable: issueScorableMask(options.definition, label, rep.predictedView),
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
      features: buildFeatures(options.definition, options.datasetCase, label, rep, prediction),
      grouping: {
        subjectId: options.datasetCase.label.captureMetadata?.subjectId,
        participantId: options.datasetCase.label.captureMetadata?.participantId,
        sessionId: options.datasetCase.label.captureMetadata?.sessionId,
        cameraSetupId: options.datasetCase.label.captureMetadata?.cameraSetupId,
        environmentId: options.datasetCase.label.captureMetadata?.environmentId,
        collectionMode: options.datasetCase.label.captureMetadata?.collectionMode,
        deviceModel: options.datasetCase.label.captureMetadata?.deviceModel,
        lightingCondition: options.datasetCase.label.captureMetadata?.lightingCondition,
        reviewerId: options.datasetCase.label.captureMetadata?.reviewerId,
        reviewerConfidence: options.datasetCase.label.captureMetadata?.reviewerConfidence,
      },
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
