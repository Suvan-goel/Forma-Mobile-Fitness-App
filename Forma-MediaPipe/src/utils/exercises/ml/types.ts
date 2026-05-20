import type { DatasetSplit } from '../dataset';
import type { RepViewLabel } from '../dataset/types';
import type { PoseQualityStatus, PoseQualityWarning } from '../shared/poseQuality';

export const ML_REP_EXAMPLE_SCHEMA_VERSION = 1;
export const ML_FEATURE_SCHEMA_VERSION = 'rep-features-v1';

export type MlFeatureValue = number | null;
export type MlFeatureVector = Record<string, MlFeatureValue>;

export interface MlRepTiming {
  expectedStartMs: number;
  expectedEndMs: number;
  predictedStartMs: number | null;
  predictedEndMs: number | null;
  completedAtMs: number | null;
  durationMs: number;
  overlapMs: number;
  completionDeltaMs: number | null;
}

export interface MlLabelVector {
  issueIds: string[];
  clean: boolean;
  scorable: boolean;
  view?: RepViewLabel;
  expectedScoreRange?: [number, number];
}

export interface MlHeuristicVector {
  issueIds: string[];
  clean: boolean;
  score: number | null;
  messages: string[];
  scorable: boolean | null;
  view?: RepViewLabel;
  confidence: number | null;
  qualityStatus?: PoseQualityStatus;
  qualityWarnings: PoseQualityWarning[];
}

export interface MlRepExample {
  schemaVersion: typeof ML_REP_EXAMPLE_SCHEMA_VERSION;
  featureSchemaVersion: typeof ML_FEATURE_SCHEMA_VERSION;
  id: string;
  exerciseName: string;
  exerciseSlug: string;
  split: DatasetSplit;
  sourceVideo: string;
  landmarkFile?: string;
  labelFile?: string;
  recordingFile?: string;
  repIndex: number;
  timing: MlRepTiming;
  labels: MlLabelVector;
  heuristic: MlHeuristicVector;
  features: MlFeatureVector;
  metadata: {
    captureMetadata?: object;
    recordingMetadata?: object;
    heuristicConfigVersion?: string;
    poseModelName?: string;
    poseModelPath?: string;
  };
}

export interface MlDatasetSummaryBucket {
  cases: number;
  examples: number;
  cleanExamples: number;
  issueExamples: number;
  unscorableExamples: number;
}

export interface MlDatasetManifest {
  schemaVersion: 1;
  featureSchemaVersion: typeof ML_FEATURE_SCHEMA_VERSION;
  generatedAt: string;
  exerciseName: string;
  exerciseSlug: string;
  includeDrafts: boolean;
  datasetRoot: string;
  outputs: {
    jsonl: string;
    csv: string;
    manifest: string;
  };
  counts: {
    discoveredLabelFiles: number;
    loadedCases: number;
    exportedExamples: number;
    skippedMissingMatchedPrediction: number;
    skippedMissingDiagnostics: number;
  };
  splits: Partial<Record<DatasetSplit, MlDatasetSummaryBucket>>;
  issueCounts: Record<string, number>;
  heuristicIssueCounts: Record<string, number>;
  featureNames: string[];
  labelColumns: Record<string, string>;
}
