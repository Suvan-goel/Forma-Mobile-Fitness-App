import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import {
  evaluateCase,
  generateRandomCandidates,
  refineCandidate,
  shouldApplyWinningConfig,
  summarizeEvaluations,
  validateCandidateConfig,
  validateTunableSpec,
  type CandidateConfig,
  type OptimizerSearchOptions,
} from '../src/utils/exercises/dataset';
import {
  clampTunableValue,
  getConfigValue,
  setConfigValue,
} from '../src/utils/exercises/heuristicConfig';
import { replayRecording, slugifyExerciseName } from '../src/utils/exercises/replay';
import {
  buildReplayFrameCache,
  replayRecordingWithFrameCache,
  type ReplayFrameCache,
} from '../src/utils/exercises/replay';
import type {
  CaseEvaluation,
  DatasetCase,
  DatasetEvaluation,
  DiagnosticEvaluationSummary,
  EvaluationMetrics,
  EvaluationTotals,
  QualityCoverageMetrics,
  RepEvaluation,
} from '../src/utils/exercises/dataset';
import type {
  DiagnosticTuningEntry,
  ExerciseDefinition,
  ExerciseHeuristicConfig,
  NumericTunable,
  RepCueDiagnostic,
  TunableSpec,
} from '../src/utils/exercises/types';
import {
  DATASET_ROOT,
  discoverReviewedDatasetExercises,
  formatEvaluationSummary,
  formatLoadSummary,
  loadDatasetCasesWithSummary,
  writeJson,
  type DatasetLoadSummary,
} from './dataset-common';

export type SelectionSplit = 'validation' | 'train' | 'all' | 'none';
export type OptimizerSelectionMode = 'current' | 'diagnostic';
export type OptimizerTunableGroup = 'all' | 'issue-feedback';
type CandidateSource = 'baseline' | 'random' | 'refined' | 'diagnostic';

export interface MinimumSplitCases {
  train: number;
  validation: number;
  test: number;
}

export interface OptimizerCommandOptions {
  datasetRoot?: string;
  exerciseFilter: string | null;
  dryRun: boolean;
  includeCaseDetails: boolean;
  includeDiagnostics?: boolean;
  selectionMode?: OptimizerSelectionMode;
  apply?: boolean;
  silent: boolean;
  reportPath: string | null;
  profile?: boolean;
  useReplayCache?: boolean;
  checkpointPath?: string | null;
  resumeCheckpoint?: boolean;
  checkpointEvery?: number;
  enforceCleanFpGates?: boolean;
  tunableGroup?: OptimizerTunableGroup;
  search: OptimizerSearchOptions;
  minCases: MinimumSplitCases;
}

export interface TunableReportEntry {
  path: string;
  currentValue: number | null;
  min: number;
  max: number;
  step: number;
  kind: NumericTunable['kind'];
  affectsRepCountingOrFsm: boolean;
  affectsIssueDetectionOnly: boolean;
  affectsBoth: boolean;
  recommendedGroup: 'count-fsm' | 'issue-feedback' | 'mixed-unsafe';
  activeInSearch: boolean;
  reason: string;
}

export interface RepCountStabilityWarning {
  candidateId: string;
  source: CandidateSource;
  split: SelectionSplit | 'train' | 'validation';
  changedPaths: string[];
  reason: string;
  changedTotalPredictedReps: boolean;
  changedRepCountAccuracy: boolean;
  changedPerCasePredictedReps: boolean;
  baselinePredictedReps: number;
  candidatePredictedReps: number;
  baselineRepCountAccuracy: number;
  candidateRepCountAccuracy: number;
  changedCasePredictedReps?: RepCountCaseChange[];
}

interface RepCountStabilityTracker {
  warningCount: number;
  warnings: RepCountStabilityWarning[];
  rejectCount: number;
  rejectedExamples: RepCountStabilityWarning[];
  rejectedForTrainRepCountChange: number;
  rejectedForValidationRepCountChange: number;
  mixedUnsafeTunablePaths: Set<string>;
}

export interface RepCountCaseSnapshot {
  sourceVideo: string;
  split: DatasetCase['label']['split'];
  expectedReps: number;
  predictedReps: number;
  repCountCorrect: boolean;
}

export interface RepCountCaseChange {
  sourceVideo: string;
  baselinePredictedReps: number;
  candidatePredictedReps: number;
  baselineRepCountCorrect: boolean;
  candidateRepCountCorrect: boolean;
}

export interface RepCountStabilitySplitSnapshot {
  expectedReps: number;
  predictedReps: number;
  repCountAccuracy: number;
  perCasePredictedReps: RepCountCaseSnapshot[];
}

export type RepCountStabilityBySplit = EvaluationBySplit<RepCountStabilitySplitSnapshot>;

interface RepCountStabilityCheckpointSummary {
  rejectCount: number;
  warningCount: number;
  rejectedForTrainRepCountChange: number;
  rejectedForValidationRepCountChange: number;
  mixedUnsafeTunables: string[];
}

export interface PerIssueMetricReport {
  issueId: string;
  truePositiveCount: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  precision: number;
  recall: number;
  f1: number;
  cleanFalsePositiveCount: number;
  hardNegativeCleanFalsePositiveCount: number;
}

export interface IssueOnlyMetricSnapshot {
  repCountAccuracy: number | null;
  predictedReps: number | null;
  expectedReps: number | null;
  cleanRepFalsePositiveRate: number | null;
  hardNegativeCleanFalsePositiveRate: number | null;
  issuePrecision: number | null;
  issueRecall: number | null;
  issueF1: number | null;
  weightedIssuePrecision: number | null;
  weightedIssueRecall: number | null;
  weightedIssueF1: number | null;
  perIssue: PerIssueMetricReport[];
}

export interface IssueOnlyReportSummary {
  enabled: boolean;
  candidateChangedRepCountAccuracy: boolean;
  warningCount: number;
  warnings: RepCountStabilityWarning[];
  mixedUnsafeTunables: string[];
  repCountStabilityRejectCount: number;
  repCountStabilityWarningCount: number;
  rejectedForTrainRepCountChange: number;
  rejectedForValidationRepCountChange: number;
  repCountStabilityRejectedExamples: RepCountStabilityWarning[];
  baselinePredictedRepsBySplit: RepCountStabilityBySplit;
  winnerPredictedRepsBySplit: RepCountStabilityBySplit;
  baseline: EvaluationBySplit<IssueOnlyMetricSnapshot>;
  winner: EvaluationBySplit<IssueOnlyMetricSnapshot>;
}

export type CleanRepBucketKey =
  | 'cleanFront'
  | 'hardNegativeClean'
  | 'issueRecordingClean'
  | 'partialViewClean'
  | 'unscorable';

export interface FalsePositiveIssueCount {
  issueId: string;
  count: number;
}

export interface CleanRepBucketSummary {
  cleanReps: number;
  falsePositiveReps: number;
  falsePositiveRate: number;
  falseIssueCount: number;
  averageFalseIssuesPerCleanRep: number;
  topFalsePositiveIssueIds: FalsePositiveIssueCount[];
}

export interface PerIssueCleanFalsePositiveSummary {
  issueId: string;
  cleanFalsePositiveCount: number;
  cleanFalsePositiveRate: number;
  hardNegativeCleanFalsePositiveCount: number;
  splitBreakdown: Record<'train' | 'validation' | 'test', number>;
  topRecordings: Array<{ recording: string; count: number }>;
}

export interface AsymmetrySubCueSummary {
  cleanFalsePositiveCount: number;
  truePositiveCount: number;
  falseNegativeCount: number;
}

export interface RomFalsePositiveExample {
  recording: string;
  split: string;
  repIndex: number | null;
  expectedStartMs: number | null;
  expectedEndMs: number | null;
  predictedStartMs: number | null;
  predictedEndMs: number | null;
  romRatio: number | null;
  romMinThreshold: number | null;
  minCurlRatio: number | null;
  returnMaxCurlRatio: number | null;
  incompleteFlexTriggered: boolean | null;
  incompleteExtendTriggered: boolean | null;
  incompleteRomTriggered: boolean | null;
  incompleteRomEmitted: boolean;
  incompleteRomSuppressedByPrecedence: boolean;
  view: string | null;
  scorable: boolean | null;
  reliability: Record<string, unknown> | null;
}

export interface TorsoFalsePositiveExample {
  recording: string;
  split: string;
  repIndex: number | null;
  issueId: string;
  expectedStartMs: number | null;
  expectedEndMs: number | null;
  predictedStartMs: number | null;
  predictedEndMs: number | null;
  torsoDelta: number | null;
  threshold: number | null;
  torsoSampleCount: number | null;
  trackingInterrupted: boolean | null;
  reacquiredTracking: boolean | null;
  spikeOrSustained: 'single_spike' | 'sustained' | 'unknown';
  poseOutlierSignals: {
    outlierCandidate: boolean | null;
    largeDelta: boolean | null;
    boneLengthJump: boolean | null;
  };
  reliabilityReasons: string[];
}

export interface RepCountBucketSummary {
  cases: number;
  repCountCorrect: number;
  repCountAccuracy: number;
}

export interface CleanSafetySummary {
  totalCleanScorableReps: number;
  buckets: Record<CleanRepBucketKey, CleanRepBucketSummary>;
  perIssueCleanFalsePositives: Record<string, PerIssueCleanFalsePositiveSummary>;
  asymmetrySubCues: Record<string, AsymmetrySubCueSummary>;
  romFalsePositiveDiagnostics: {
    count: number;
    examples: RomFalsePositiveExample[];
  };
  torsoFalsePositiveDiagnostics: {
    count: number;
    examples: TorsoFalsePositiveExample[];
  };
  repCountBuckets: Record<
    'cleanFront' | 'hardNegativeClean' | 'issueRecording' | 'partialView' | 'unscorable',
    RepCountBucketSummary
  >;
}

export interface CleanFpGateCheck {
  name: string;
  split: 'train' | 'validation';
  candidateRate: number | null;
  baselineRate: number | null;
  absoluteCap: number;
  minImprovement: number;
  passed: boolean;
  reason: string;
}

export interface CleanFpGateDiagnostics {
  enforced: boolean;
  passed: boolean;
  checks: CleanFpGateCheck[];
}

export interface CandidateDiagnosticScores {
  currentScore: number;
  legacyScore: number;
  cleanSafetyFirstScore: number;
  repCountGatedScore: number;
  issueF1AfterCleanGateScore: number;
}

export interface CandidateSafetyMetrics {
  cleanFpRateTrain: number | null;
  cleanFpRateValidation: number | null;
  hardNegativeCleanFpRateTrain: number | null;
  hardNegativeCleanFpRateValidation: number | null;
  trainRepCountAccuracy: number | null;
  validationRepCountAccuracy: number | null;
}

export interface EvaluationSummary {
  totals: EvaluationTotals;
  metrics: EvaluationMetrics;
  repCountSnapshot?: RepCountStabilitySplitSnapshot;
  qualityCoverage?: QualityCoverageMetrics;
  diagnosticSummary?: DiagnosticEvaluationSummary;
  cleanSafety?: CleanSafetySummary;
}

export interface EvaluatedCandidateSummary {
  id: string;
  source: CandidateSource;
  changedPaths?: string[];
  config: ExerciseHeuristicConfig;
  evaluation: EvaluationSummary;
  score: number;
  legacyScore: number;
  diagnosticScores?: CandidateDiagnosticScores;
}

interface CandidateEvaluationBatch {
  evaluated: EvaluatedCandidateSummary[];
  rejectedCount: number;
  rejectedExamples: string[];
}

export interface SearchResult {
  candidates: EvaluatedCandidateSummary[];
  specIssues: string[];
  rejectedCandidates: number;
  rejectedCandidateExamples: string[];
  options: Required<OptimizerSearchOptions>;
  sourceBreakdown: Record<CandidateSource, number>;
  diagnosticFallbackReason?: string;
  checkpointPath?: string;
}

export interface MinimumSplitGate {
  required: MinimumSplitCases;
  actual: MinimumSplitCases;
  passed: boolean;
  reason: string;
}

interface EvaluationBySplit<T> {
  all: T | null;
  train: T | null;
  validation: T | null;
  test: T | null;
}

interface InstrumentedCandidateConfig extends CandidateConfig {
  source: CandidateSource;
  changedPaths?: string[];
}

export interface ExerciseOptimisationReport {
  exerciseName: string;
  cases: number;
  loadSummary: DatasetLoadSummary;
  splitCounts: MinimumSplitCases;
  minimumSplitGate: MinimumSplitGate;
  supportsConfigVariants: boolean;
  canAutoApply: boolean;
  applied: boolean;
  dryRun: boolean;
  selectionMode: OptimizerSelectionMode;
  tunableGroup: OptimizerTunableGroup;
  reason: string;
  tunedConfigPath: string | null;
  selectionSplit: SelectionSplit;
  activeTunables: TunableReportEntry[];
  frozenTunables: TunableReportEntry[];
  search: SearchResult;
  baseline: EvaluationBySplit<EvaluationSummary>;
  baselineCaseDetails?: EvaluationBySplit<DatasetEvaluation>;
  winner: {
    id: string | null;
    config: ExerciseHeuristicConfig | null;
    all: EvaluationSummary | null;
    train: EvaluationSummary | null;
    validation: EvaluationSummary | null;
    test: EvaluationSummary | null;
  };
  winnerCaseDetails?: EvaluationBySplit<DatasetEvaluation>;
  rankedSelection: Array<{
    id: string;
    source: CandidateSource;
    changedPaths?: string[];
    config: ExerciseHeuristicConfig;
    evaluation: EvaluationSummary;
    score: number;
    legacyScore: number;
    diagnosticScores?: CandidateDiagnosticScores;
    cleanFpGateDiagnostics?: CleanFpGateDiagnostics;
    safetyMetrics?: CandidateSafetyMetrics;
  }>;
  issueOnlySummary?: IssueOnlyReportSummary;
}

export interface DatasetOptimisationReport {
  options: OptimizerCommandOptions;
  datasetRoot: string;
  discoveredExercises: string[];
  confidenceGating: boolean;
  baseline: EvaluationSummary | null;
  exercises: ExerciseOptimisationReport[];
  profile?: OptimizerProfileReport;
}

const OPTIMIZER_CONFIDENCE_GATING = true;
const CHECKPOINT_VERSION = 2;
const DEFAULT_CHECKPOINT_EVERY = 25;
const MAX_REP_COUNT_STABILITY_REJECTION_EXAMPLES = 50;

export const DEFAULT_MIN_SPLIT_CASES: MinimumSplitCases = {
  train: 1,
  validation: 1,
  test: 1,
};

export interface OptimizerProfileSection {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  bytes?: number;
}

export interface OptimizerProfileReport {
  startedAt: string;
  endedAt: string;
  totalMs: number;
  sections: Record<string, OptimizerProfileSection>;
}

interface OptimizerRuntimeContext {
  replayCache?: WeakMap<DatasetCase, ReplayFrameCache>;
  profiler?: OptimizerProfiler;
  checkpoint?: OptimizerCheckpointManager;
  checkpointPath?: string | null;
  resumeCheckpoint?: boolean;
  checkpointEvery?: number;
  tunableGroup?: OptimizerTunableGroup;
  tunableSpec?: TunableSpec;
  repCountBaseline?: EvaluationSummary | null;
  repCountBaselineSplit?: SelectionSplit | 'train' | 'validation';
  repCountStability?: RepCountStabilityTracker;
}

interface EvaluationRuntimeOptions {
  replayCache?: WeakMap<DatasetCase, ReplayFrameCache>;
  profiler?: OptimizerProfiler;
  profileSection?: string;
  splitProfileSections?: Partial<Record<DatasetCase['label']['split'], string>>;
}

interface OptimizerCheckpointCandidate {
  key: string;
  id: string;
  source: CandidateSource;
  changedPaths?: string[];
  config: ExerciseHeuristicConfig;
  evaluation: EvaluationSummary;
  score: number;
  legacyScore: number;
}

interface OptimizerCheckpointData {
  version: typeof CHECKPOINT_VERSION;
  exerciseName: string;
  selectionMode: OptimizerSelectionMode;
  tunableGroup: OptimizerTunableGroup;
  options: Required<OptimizerSearchOptions>;
  seed: number;
  phase: string;
  refinementRound: number;
  elapsedMs: number;
  generatedCandidateCount: number;
  generatedCandidates: Array<Pick<InstrumentedCandidateConfig, 'id' | 'source' | 'changedPaths' | 'config'>>;
  evaluatedCandidateCount: number;
  evaluatedCandidates: OptimizerCheckpointCandidate[];
  survivorIds: string[];
  bestCandidates: OptimizerCheckpointCandidate[];
  rejectedCandidates: number;
  rejectedCandidateExamples: string[];
  repCountStability?: RepCountStabilityCheckpointSummary;
  updatedAt: string;
}

export class OptimizerProfiler {
  private readonly startedAtMs = performance.now();
  private readonly startedAt = new Date().toISOString();
  private readonly sections = new Map<string, OptimizerProfileSection>();

  record(section: string, durationMs: number, bytes = 0): void {
    const current = this.sections.get(section);
    if (!current) {
      this.sections.set(section, {
        count: 1,
        totalMs: durationMs,
        minMs: durationMs,
        maxMs: durationMs,
        ...(bytes > 0 ? { bytes } : {}),
      });
      return;
    }
    current.count += 1;
    current.totalMs += durationMs;
    current.minMs = Math.min(current.minMs, durationMs);
    current.maxMs = Math.max(current.maxMs, durationMs);
    if (bytes > 0) current.bytes = (current.bytes ?? 0) + bytes;
  }

  time<T>(section: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.record(section, performance.now() - start);
    }
  }

  report(): OptimizerProfileReport {
    return {
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      totalMs: performance.now() - this.startedAtMs,
      sections: Object.fromEntries(this.sections.entries()),
    };
  }
}

function candidateCheckpointKey(candidate: Pick<InstrumentedCandidateConfig, 'id' | 'config'>): string {
  return `${candidate.id}:${JSON.stringify(candidate.config)}`;
}

class OptimizerCheckpointManager {
  private data: OptimizerCheckpointData | null = null;
  private readonly evaluatedByKey = new Map<string, OptimizerCheckpointCandidate>();
  private generatedCandidates: OptimizerCheckpointData['generatedCandidates'] = [];
  private lastSavedEvaluatedCount = 0;
  private readonly startedAtMs = performance.now();

  constructor(
    private readonly checkpointPath: string,
    private readonly exerciseName: string,
    private readonly selectionMode: OptimizerSelectionMode,
    private readonly tunableGroup: OptimizerTunableGroup,
    private readonly options: Required<OptimizerSearchOptions>,
    private readonly saveEvery: number,
    resume: boolean,
  ) {
    if (!resume || !fs.existsSync(checkpointPath)) return;
    const loaded = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8')) as OptimizerCheckpointData;
    const loadedTunableGroup = loaded.tunableGroup ?? 'all';
    if (
      loaded.version !== CHECKPOINT_VERSION ||
      loaded.exerciseName !== exerciseName ||
      loaded.selectionMode !== selectionMode ||
      loadedTunableGroup !== tunableGroup ||
      JSON.stringify(loaded.options) !== JSON.stringify(options)
    ) {
      throw new Error(`Checkpoint ${checkpointPath} does not match this optimizer run.`);
    }
    this.data = loaded;
    for (const candidate of loaded.evaluatedCandidates) {
      this.evaluatedByKey.set(candidate.key, candidate);
    }
    this.generatedCandidates = loaded.generatedCandidates ?? [];
    this.lastSavedEvaluatedCount = loaded.evaluatedCandidateCount;
  }

  get path(): string {
    return this.checkpointPath;
  }

  setGeneratedCandidates(candidates: InstrumentedCandidateConfig[]): void {
    const existing = new Set(this.generatedCandidates.map((candidate) => candidateCheckpointKey(candidate)));
    for (const candidate of candidates) {
      const key = candidateCheckpointKey(candidate);
      if (existing.has(key)) continue;
      existing.add(key);
      this.generatedCandidates.push({
        id: candidate.id,
        source: candidate.source,
        changedPaths: candidate.changedPaths,
        config: candidate.config,
      });
    }
  }

  getEvaluated(candidate: InstrumentedCandidateConfig): EvaluatedCandidateSummary | null {
    const checkpoint = this.evaluatedByKey.get(candidateCheckpointKey(candidate));
    if (!checkpoint) return null;
    return {
      id: checkpoint.id,
      source: checkpoint.source,
      changedPaths: checkpoint.changedPaths,
      config: checkpoint.config,
      evaluation: checkpoint.evaluation,
      score: checkpoint.score,
      legacyScore: checkpoint.legacyScore,
    };
  }

  recordEvaluated(candidate: EvaluatedCandidateSummary): void {
    const key = candidateCheckpointKey(candidate);
    if (this.evaluatedByKey.has(key)) return;
    this.evaluatedByKey.set(key, { key, ...candidate });
  }

  shouldSave(force = false): boolean {
    const evaluatedCount = this.evaluatedByKey.size;
    return (
      force ||
      evaluatedCount - this.lastSavedEvaluatedCount >= Math.max(1, this.saveEvery)
    );
  }

  maybeSave(args: {
    phase: string;
    refinementRound: number;
    evaluated: EvaluatedCandidateSummary[];
    rejectedCandidates: number;
    rejectedCandidateExamples: string[];
    repCountStability?: RepCountStabilityCheckpointSummary;
    force?: boolean;
  }): void {
    const evaluatedCount = this.evaluatedByKey.size;
    if (
      !args.force &&
      evaluatedCount - this.lastSavedEvaluatedCount < Math.max(1, this.saveEvery)
    ) {
      return;
    }
    this.save(args);
  }

  save(args: {
    phase: string;
    refinementRound: number;
    evaluated: EvaluatedCandidateSummary[];
    rejectedCandidates: number;
    rejectedCandidateExamples: string[];
    repCountStability?: RepCountStabilityCheckpointSummary;
  }): void {
    const evaluatedCandidates = Array.from(this.evaluatedByKey.values());
    const best = topEvaluatedCandidates(args.evaluated, this.options.survivorCount)
      .map((candidate) => this.evaluatedByKey.get(candidateCheckpointKey(candidate)))
      .filter((candidate): candidate is OptimizerCheckpointCandidate => Boolean(candidate));
    this.data = {
      version: CHECKPOINT_VERSION,
      exerciseName: this.exerciseName,
      selectionMode: this.selectionMode,
      tunableGroup: this.tunableGroup,
      options: this.options,
      seed: this.options.seed,
      phase: args.phase,
      refinementRound: args.refinementRound,
      elapsedMs: performance.now() - this.startedAtMs,
      generatedCandidateCount: this.generatedCandidates.length,
      generatedCandidates: this.generatedCandidates,
      evaluatedCandidateCount: evaluatedCandidates.length,
      evaluatedCandidates,
      survivorIds: topEvaluatedCandidates(args.evaluated, this.options.survivorCount).map(
        (candidate) => candidate.id,
      ),
      bestCandidates: best,
      rejectedCandidates: args.rejectedCandidates,
      rejectedCandidateExamples: args.rejectedCandidateExamples.slice(0, 5),
      repCountStability: args.repCountStability,
      updatedAt: new Date().toISOString(),
    };
    writeJson(this.checkpointPath, this.data);
    this.lastSavedEvaluatedCount = evaluatedCandidates.length;
  }
}

function emptyTotals(): EvaluationTotals {
  return {
    cases: 0,
    expectedReps: 0,
    predictedReps: 0,
    repCountCorrect: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    cleanReps: 0,
    cleanFalsePositives: 0,
    viewEvaluatedReps: 0,
    viewCorrectReps: 0,
    scorableEvaluatedReps: 0,
    scorableCorrectReps: 0,
    scoreEvaluatedReps: 0,
    scoreInRangeReps: 0,
    scoreRangeMissTotal: 0,
  };
}

function addTotals(target: EvaluationTotals, source: EvaluationTotals): void {
  target.cases += source.cases;
  target.expectedReps += source.expectedReps;
  target.predictedReps += source.predictedReps;
  target.repCountCorrect += source.repCountCorrect;
  target.truePositives += source.truePositives;
  target.falsePositives += source.falsePositives;
  target.falseNegatives += source.falseNegatives;
  target.cleanReps += source.cleanReps;
  target.cleanFalsePositives += source.cleanFalsePositives;
  target.viewEvaluatedReps += source.viewEvaluatedReps;
  target.viewCorrectReps += source.viewCorrectReps;
  target.scorableEvaluatedReps += source.scorableEvaluatedReps;
  target.scorableCorrectReps += source.scorableCorrectReps;
  target.scoreEvaluatedReps += source.scoreEvaluatedReps;
  target.scoreInRangeReps += source.scoreInRangeReps;
  target.scoreRangeMissTotal += source.scoreRangeMissTotal;
}

function metricsFromTotals(totals: EvaluationTotals): EvaluationMetrics {
  const precisionDenominator = totals.truePositives + totals.falsePositives;
  const recallDenominator = totals.truePositives + totals.falseNegatives;
  const issuePrecision =
    precisionDenominator === 0 ? 1 : totals.truePositives / precisionDenominator;
  const issueRecall = recallDenominator === 0 ? 1 : totals.truePositives / recallDenominator;
  const issueF1 =
    issuePrecision + issueRecall === 0
      ? 0
      : (2 * issuePrecision * issueRecall) / (issuePrecision + issueRecall);

  return {
    repCountAccuracy: totals.cases === 0 ? 1 : totals.repCountCorrect / totals.cases,
    issuePrecision,
    issueRecall,
    issueF1,
    cleanRepFalsePositiveRate:
      totals.cleanReps === 0 ? 0 : totals.cleanFalsePositives / totals.cleanReps,
    viewAccuracy:
      totals.viewEvaluatedReps === 0 ? 1 : totals.viewCorrectReps / totals.viewEvaluatedReps,
    scorableAccuracy:
      totals.scorableEvaluatedReps === 0 ? 1 : totals.scorableCorrectReps / totals.scorableEvaluatedReps,
    scoreInRangeRate:
      totals.scoreEvaluatedReps === 0 ? 1 : totals.scoreInRangeReps / totals.scoreEvaluatedReps,
    scoreMeanAbsoluteMiss:
      totals.scoreEvaluatedReps === 0 ? 0 : totals.scoreRangeMissTotal / totals.scoreEvaluatedReps,
  };
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function repCountSnapshotFromCaseEvaluations(
  caseEvaluations: CaseEvaluation[],
): RepCountStabilitySplitSnapshot {
  const totals = emptyTotals();
  for (const caseEvaluation of caseEvaluations) {
    addTotals(totals, caseEvaluation.totals);
  }
  return {
    expectedReps: totals.expectedReps,
    predictedReps: totals.predictedReps,
    repCountAccuracy: metricsFromTotals(totals).repCountAccuracy,
    perCasePredictedReps: caseEvaluations
      .map((caseEvaluation) => ({
        sourceVideo: caseEvaluation.sourceVideo,
        split: caseEvaluation.split,
        expectedReps: caseEvaluation.expectedReps,
        predictedReps: caseEvaluation.predictedReps,
        repCountCorrect: caseEvaluation.repCountCorrect,
      }))
      .sort((a, b) => a.sourceVideo.localeCompare(b.sourceVideo)),
  };
}

function repCountSnapshotFromSummary(
  summary: EvaluationSummary | null,
): RepCountStabilitySplitSnapshot | null {
  if (!summary) return null;
  return summary.repCountSnapshot ?? {
    expectedReps: summary.totals.expectedReps,
    predictedReps: summary.totals.predictedReps,
    repCountAccuracy: summary.metrics.repCountAccuracy,
    perCasePredictedReps: [],
  };
}

function repCountSplitSnapshots(
  summaries: EvaluationBySplit<EvaluationSummary>,
): RepCountStabilityBySplit {
  return {
    all: repCountSnapshotFromSummary(summaries.all),
    train: repCountSnapshotFromSummary(summaries.train),
    validation: repCountSnapshotFromSummary(summaries.validation),
    test: repCountSnapshotFromSummary(summaries.test),
  };
}

function sortedCounts(map: Map<string, number>): FalsePositiveIssueCount[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([issueId, count]) => ({ issueId, count }));
}

function sourceRecordingName(sourceVideo: string): string {
  return path.basename(sourceVideo, path.extname(sourceVideo));
}

function labelText(datasetCase: DatasetCase): string {
  return JSON.stringify([
    datasetCase.label.sourceVideo,
    datasetCase.label.notes,
    datasetCase.label.captureMetadata,
    ...datasetCase.label.reps.map((rep) => rep.notes),
  ]).toLowerCase();
}

function isHardNegativeCleanRecording(datasetCase: DatasetCase): boolean {
  const text = labelText(datasetCase);
  return (
    text.includes('hard-negative') ||
    text.includes('hard negative') ||
    text.includes('clean stress') ||
    text.includes('natural')
  );
}

function repLabelView(datasetCase: DatasetCase, repIndex: number | null): string {
  const labelRep =
    typeof repIndex === 'number'
      ? datasetCase.label.reps.find((rep) => rep.index === repIndex)
      : undefined;
  return labelRep?.view ?? datasetCase.label.captureMetadata?.cameraView ?? 'unknown';
}

function isPartialViewValue(view: string | undefined): boolean {
  return view === 'side' || view === 'oblique' || view === 'frontish';
}

function isPartialViewRep(datasetCase: DatasetCase, rep: RepEvaluation): boolean {
  return isPartialViewValue(repLabelView(datasetCase, rep.expectedRepIndex));
}

function isPartialViewRecording(datasetCase: DatasetCase): boolean {
  const captureView = datasetCase.label.captureMetadata?.cameraView;
  return (
    isPartialViewValue(captureView) ||
    datasetCase.label.reps.some((rep) => isPartialViewValue(rep.view))
  );
}

function hasIssueLabel(datasetCase: DatasetCase): boolean {
  return datasetCase.label.reps.some((rep) => rep.issueIds.length > 0);
}

function isCleanScorableRecording(datasetCase: DatasetCase): boolean {
  return datasetCase.label.reps.every(
    (rep) => (rep.scorable ?? true) && rep.issueIds.length === 0,
  );
}

function isCleanFrontRecording(datasetCase: DatasetCase): boolean {
  return isCleanScorableRecording(datasetCase) && !isPartialViewRecording(datasetCase);
}

function recordingBuckets(datasetCase: DatasetCase): Array<keyof CleanSafetySummary['repCountBuckets']> {
  const buckets: Array<keyof CleanSafetySummary['repCountBuckets']> = [];
  if (isCleanFrontRecording(datasetCase)) buckets.push('cleanFront');
  if (isHardNegativeCleanRecording(datasetCase) && isCleanScorableRecording(datasetCase)) {
    buckets.push('hardNegativeClean');
  }
  if (hasIssueLabel(datasetCase)) buckets.push('issueRecording');
  if (isPartialViewRecording(datasetCase)) buckets.push('partialView');
  if (datasetCase.label.reps.some((rep) => rep.scorable === false)) buckets.push('unscorable');
  return buckets;
}

function emptyBucketSummary(): CleanRepBucketSummary {
  return {
    cleanReps: 0,
    falsePositiveReps: 0,
    falsePositiveRate: 0,
    falseIssueCount: 0,
    averageFalseIssuesPerCleanRep: 0,
    topFalsePositiveIssueIds: [],
  };
}

function emptyMutableBucket() {
  return {
    cleanReps: 0,
    falsePositiveReps: 0,
    falseIssueCount: 0,
    issues: new Map<string, number>(),
  };
}

function finalizeBucket(bucket: ReturnType<typeof emptyMutableBucket>): CleanRepBucketSummary {
  return {
    cleanReps: bucket.cleanReps,
    falsePositiveReps: bucket.falsePositiveReps,
    falsePositiveRate: safeRate(bucket.falsePositiveReps, bucket.cleanReps),
    falseIssueCount: bucket.falseIssueCount,
    averageFalseIssuesPerCleanRep: safeRate(bucket.falseIssueCount, bucket.cleanReps),
    topFalsePositiveIssueIds: sortedCounts(bucket.issues).slice(0, 10),
  };
}

function emptyRepCountBucket(): RepCountBucketSummary {
  return { cases: 0, repCountCorrect: 0, repCountAccuracy: 0 };
}

function finalizeRepCountBucket(bucket: RepCountBucketSummary): RepCountBucketSummary {
  return {
    ...bucket,
    repCountAccuracy: safeRate(bucket.repCountCorrect, bucket.cases),
  };
}

function metricValue(rep: RepEvaluation, key: string): number | null {
  const value = rep.predictedDiagnostics?.metrics[key]?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricSampleCount(rep: RepEvaluation, key: string): number | null {
  const sampleCount = rep.predictedDiagnostics?.metrics[key]?.sampleCount;
  return typeof sampleCount === 'number' && Number.isFinite(sampleCount) ? sampleCount : null;
}

function cueThreshold(rep: RepEvaluation, issueId: string): number | null {
  const threshold = rep.predictedDiagnostics?.cues[issueId]?.thresholdValue;
  return typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : null;
}

function cueTriggered(rep: RepEvaluation, issueId: string): boolean | null {
  const cue = rep.predictedDiagnostics?.cues[issueId];
  return cue ? cue.triggered : null;
}

function cleanSafetyReliability(rep: RepEvaluation): Record<string, unknown> | null {
  const reliability = rep.predictedDiagnostics?.reliability;
  if (!reliability) return null;
  return {
    countabilityCandidate: reliability.countabilityCandidate,
    scoreabilityCandidate: reliability.scoreabilityCandidate,
    reasons: reliability.reasons,
    safeCueFamilies: reliability.safeCueFamilies,
    unsafeCueFamilies: reliability.unsafeCueFamilies,
    suppressedIssueIds: reliability.suppressedIssueIds ?? [],
  };
}

function asymmetrySubCueTriggers(rep: RepEvaluation): string[] {
  const cue = rep.predictedDiagnostics?.cues['barbell-curl.asymmetry'];
  if (!cue?.eligible) return ['ineligible'];
  const threshold = cue.thresholdValue;
  const thresholdObject =
    threshold && typeof threshold === 'object' && !Array.isArray(threshold) ? threshold : {};
  const result: string[] = [];
  const minRatioThreshold = thresholdObject.minRatio;
  const romRatioThreshold = thresholdObject.romRatio;
  const syncDeltaThreshold = thresholdObject.syncDelta;
  const minRatio = metricValue(rep, 'asymmetryMinRatio');
  const romRatio = metricValue(rep, 'asymmetryRomRatio');
  const syncDelta = metricValue(rep, 'syncDelta');
  if (
    typeof minRatioThreshold === 'number' &&
    minRatio !== null &&
    minRatio > minRatioThreshold
  ) {
    result.push('minRatio');
  }
  if (
    typeof romRatioThreshold === 'number' &&
    romRatio !== null &&
    romRatio > romRatioThreshold
  ) {
    result.push('romRatio');
  }
  if (
    typeof syncDeltaThreshold === 'number' &&
    syncDelta !== null &&
    syncDelta > syncDeltaThreshold
  ) {
    result.push('syncDelta');
  }
  if (result.length === 0 && cue.triggered) return ['unknown'];
  return result.length === 0 ? ['none'] : result;
}

function incrementCount(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

export function buildCleanSafetySummary(
  caseEvaluations: CaseEvaluation[],
  datasetCases: DatasetCase[],
): CleanSafetySummary {
  const bySource = new Map(datasetCases.map((datasetCase) => [datasetCase.label.sourceVideo, datasetCase]));
  const bucketKeys: CleanRepBucketKey[] = [
    'cleanFront',
    'hardNegativeClean',
    'issueRecordingClean',
    'partialViewClean',
    'unscorable',
  ];
  const buckets = Object.fromEntries(
    bucketKeys.map((key) => [key, emptyMutableBucket()]),
  ) as Record<CleanRepBucketKey, ReturnType<typeof emptyMutableBucket>>;
  const perIssue = new Map<string, {
    issueId: string;
    cleanFalsePositiveCount: number;
    hardNegativeCleanFalsePositiveCount: number;
    splitBreakdown: Record<'train' | 'validation' | 'test', number>;
    recordings: Map<string, number>;
  }>();
  const asymmetrySubCues = new Map<string, AsymmetrySubCueSummary>();
  const repCountBuckets = {
    cleanFront: emptyRepCountBucket(),
    hardNegativeClean: emptyRepCountBucket(),
    issueRecording: emptyRepCountBucket(),
    partialView: emptyRepCountBucket(),
    unscorable: emptyRepCountBucket(),
  };
  const romExamples: RomFalsePositiveExample[] = [];
  const torsoExamples: TorsoFalsePositiveExample[] = [];
  let totalCleanScorableReps = 0;

  const asymmetrySummary = (key: string): AsymmetrySubCueSummary => {
    const existing = asymmetrySubCues.get(key);
    if (existing) return existing;
    const created = {
      cleanFalsePositiveCount: 0,
      truePositiveCount: 0,
      falseNegativeCount: 0,
    };
    asymmetrySubCues.set(key, created);
    return created;
  };

  for (const caseEvaluation of caseEvaluations) {
    const datasetCase = bySource.get(caseEvaluation.sourceVideo);
    if (!datasetCase) continue;
    for (const bucketName of recordingBuckets(datasetCase)) {
      const bucket = repCountBuckets[bucketName];
      bucket.cases += 1;
      if (caseEvaluation.repCountCorrect) bucket.repCountCorrect += 1;
    }

    const recording = sourceRecordingName(caseEvaluation.sourceVideo);
    const hardNegativeClean =
      isHardNegativeCleanRecording(datasetCase) && isCleanScorableRecording(datasetCase);
    const cleanFrontRecording = isCleanFrontRecording(datasetCase);
    const issueRecording = hasIssueLabel(datasetCase);

    for (const rep of caseEvaluation.reps) {
      if (rep.matchStatus === 'extra_predicted') continue;
      const predictedIssues = rep.predictedIssueIds;
      const isCleanScorableRep = rep.expectedClean && rep.expectedScorable;
      const repBuckets: CleanRepBucketKey[] = [];
      if (isCleanScorableRep) {
        totalCleanScorableReps += 1;
        if (cleanFrontRecording) repBuckets.push('cleanFront');
        if (hardNegativeClean) repBuckets.push('hardNegativeClean');
        if (issueRecording) repBuckets.push('issueRecordingClean');
        if (isPartialViewRep(datasetCase, rep)) repBuckets.push('partialViewClean');
      } else if (!rep.expectedScorable) {
        repBuckets.push('unscorable');
      }

      for (const bucketName of repBuckets) {
        const bucket = buckets[bucketName];
        bucket.cleanReps += 1;
        if (predictedIssues.length > 0) {
          bucket.falsePositiveReps += 1;
          bucket.falseIssueCount += predictedIssues.length;
          for (const issueId of predictedIssues) incrementCount(bucket.issues, issueId);
        }
      }

      if (isCleanScorableRep && predictedIssues.length > 0) {
        for (const issueId of predictedIssues) {
          const issue = perIssue.get(issueId) ?? {
            issueId,
            cleanFalsePositiveCount: 0,
            hardNegativeCleanFalsePositiveCount: 0,
            splitBreakdown: { train: 0, validation: 0, test: 0 },
            recordings: new Map<string, number>(),
          };
          issue.cleanFalsePositiveCount += 1;
          if (hardNegativeClean) issue.hardNegativeCleanFalsePositiveCount += 1;
          issue.splitBreakdown[caseEvaluation.split] += 1;
          incrementCount(issue.recordings, recording);
          perIssue.set(issueId, issue);
        }
      }

      const expectedAsymmetry = rep.expectedIssueIds.includes('barbell-curl.asymmetry');
      const predictedAsymmetry = predictedIssues.includes('barbell-curl.asymmetry');
      if (isCleanScorableRep && predictedAsymmetry) {
        for (const subCue of asymmetrySubCueTriggers(rep)) {
          asymmetrySummary(subCue).cleanFalsePositiveCount += 1;
        }
      } else if (expectedAsymmetry && predictedAsymmetry) {
        for (const subCue of asymmetrySubCueTriggers(rep)) {
          asymmetrySummary(subCue).truePositiveCount += 1;
        }
      } else if (expectedAsymmetry && !predictedAsymmetry) {
        for (const subCue of asymmetrySubCueTriggers(rep)) {
          asymmetrySummary(subCue).falseNegativeCount += 1;
        }
      }

      if (
        isCleanScorableRep &&
        predictedIssues.includes('barbell-curl.incomplete_rom') &&
        romExamples.length < 20
      ) {
        const romThreshold = cueThreshold(rep, 'barbell-curl.incomplete_rom');
        const rawRomBelowThreshold =
          romThreshold !== null &&
          metricValue(rep, 'romRatio') !== null &&
          metricValue(rep, 'romRatio')! < romThreshold;
        const flexTriggered = cueTriggered(rep, 'barbell-curl.incomplete_flex');
        const extendTriggered = cueTriggered(rep, 'barbell-curl.incomplete_extend');
        const romTriggered = cueTriggered(rep, 'barbell-curl.incomplete_rom');
        romExamples.push({
          recording,
          split: caseEvaluation.split,
          repIndex: rep.expectedRepIndex,
          expectedStartMs: rep.expectedStartMs,
          expectedEndMs: rep.expectedEndMs,
          predictedStartMs: rep.predictedStartMs,
          predictedEndMs: rep.predictedEndMs,
          romRatio: metricValue(rep, 'romRatio'),
          romMinThreshold: romThreshold,
          minCurlRatio: metricValue(rep, 'minCurlRatio'),
          returnMaxCurlRatio: metricValue(rep, 'returnMaxCurlRatio'),
          incompleteFlexTriggered: flexTriggered,
          incompleteExtendTriggered: extendTriggered,
          incompleteRomTriggered: romTriggered,
          incompleteRomEmitted: predictedIssues.includes('barbell-curl.incomplete_rom'),
          incompleteRomSuppressedByPrecedence:
            rawRomBelowThreshold && romTriggered === false && Boolean(flexTriggered || extendTriggered),
          view: rep.predictedDiagnostics?.view ?? rep.predictedView ?? null,
          scorable: rep.predictedDiagnostics?.scorable ?? rep.predictedScorable ?? null,
          reliability: cleanSafetyReliability(rep),
        });
      }

      const torsoIssue = predictedIssues.find(
        (issueId) =>
          issueId === 'barbell-curl.torso_warn' || issueId === 'barbell-curl.torso_fail',
      );
      if (isCleanScorableRep && torsoIssue && torsoExamples.length < 20) {
        const reasons = rep.predictedDiagnostics?.reliability?.reasons ?? [];
        const reasonText = reasons.join(' ').toLowerCase();
        const torsoSampleCount = metricSampleCount(rep, 'torsoDelta');
        torsoExamples.push({
          recording,
          split: caseEvaluation.split,
          repIndex: rep.expectedRepIndex,
          issueId: torsoIssue,
          expectedStartMs: rep.expectedStartMs,
          expectedEndMs: rep.expectedEndMs,
          predictedStartMs: rep.predictedStartMs,
          predictedEndMs: rep.predictedEndMs,
          torsoDelta: metricValue(rep, 'torsoDelta'),
          threshold: cueThreshold(rep, torsoIssue),
          torsoSampleCount,
          trackingInterrupted:
            reasons.length === 0
              ? null
              : /missing|stale|lost|dropout|malformed|low_visibility|low_presence/.test(reasonText),
          reacquiredTracking: null,
          spikeOrSustained:
            torsoSampleCount === null
              ? 'unknown'
              : torsoSampleCount <= 1
                ? 'single_spike'
                : 'sustained',
          poseOutlierSignals: {
            outlierCandidate: reasons.length === 0 ? null : /outlier/.test(reasonText),
            largeDelta: reasons.length === 0 ? null : /large[_ -]?delta/.test(reasonText),
            boneLengthJump: reasons.length === 0 ? null : /bone[_ -]?length/.test(reasonText),
          },
          reliabilityReasons: reasons,
        });
      }
    }
  }

  return {
    totalCleanScorableReps,
    buckets: Object.fromEntries(
      bucketKeys.map((key) => [key, finalizeBucket(buckets[key])]),
    ) as Record<CleanRepBucketKey, CleanRepBucketSummary>,
    perIssueCleanFalsePositives: Object.fromEntries(
      Array.from(perIssue.values())
        .sort((a, b) => b.cleanFalsePositiveCount - a.cleanFalsePositiveCount || a.issueId.localeCompare(b.issueId))
        .map((issue) => [
          issue.issueId,
          {
            issueId: issue.issueId,
            cleanFalsePositiveCount: issue.cleanFalsePositiveCount,
            cleanFalsePositiveRate: safeRate(issue.cleanFalsePositiveCount, totalCleanScorableReps),
            hardNegativeCleanFalsePositiveCount: issue.hardNegativeCleanFalsePositiveCount,
            splitBreakdown: issue.splitBreakdown,
            topRecordings: Array.from(issue.recordings.entries())
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
              .slice(0, 10)
              .map(([recording, count]) => ({ recording, count })),
          },
        ]),
    ),
    asymmetrySubCues: Object.fromEntries(
      Array.from(asymmetrySubCues.entries()).sort(([a], [b]) => a.localeCompare(b)),
    ),
    romFalsePositiveDiagnostics: {
      count:
        perIssue.get('barbell-curl.incomplete_rom')?.cleanFalsePositiveCount ?? 0,
      examples: romExamples,
    },
    torsoFalsePositiveDiagnostics: {
      count:
        (perIssue.get('barbell-curl.torso_warn')?.cleanFalsePositiveCount ?? 0) +
        (perIssue.get('barbell-curl.torso_fail')?.cleanFalsePositiveCount ?? 0),
      examples: torsoExamples,
    },
    repCountBuckets: {
      cleanFront: finalizeRepCountBucket(repCountBuckets.cleanFront),
      hardNegativeClean: finalizeRepCountBucket(repCountBuckets.hardNegativeClean),
      issueRecording: finalizeRepCountBucket(repCountBuckets.issueRecording),
      partialView: finalizeRepCountBucket(repCountBuckets.partialView),
      unscorable: finalizeRepCountBucket(repCountBuckets.unscorable),
    },
  };
}

function scoreLegacyEvaluationSummary(evaluation: EvaluationSummary): number {
  return (
    evaluation.metrics.repCountAccuracy * 10000 +
    evaluation.metrics.issueF1 * 100 +
    evaluation.metrics.scoreInRangeRate * 3 -
    evaluation.metrics.scoreMeanAbsoluteMiss * 0.1 -
    evaluation.metrics.cleanRepFalsePositiveRate +
    evaluation.metrics.scorableAccuracy * 10 +
    evaluation.metrics.viewAccuracy * 5
  );
}

function scoreDiagnosticEvaluationSummary(evaluation: EvaluationSummary): number {
  const diagnostic = evaluation.diagnosticSummary;
  const diagnosticIssueF1 = diagnostic?.weightedIssueF1 ?? evaluation.metrics.issueF1;
  const nearThresholdRate =
    diagnostic && diagnostic.diagnosticRepCount > 0
      ? diagnostic.nearThresholdMismatchCount / diagnostic.diagnosticRepCount
      : 0;
  const scorableRate = evaluation.qualityCoverage?.scorableRate ?? 1;
  return (
    evaluation.metrics.repCountAccuracy * 10000 +
    diagnosticIssueF1 * 125 +
    evaluation.metrics.scoreInRangeRate * 3 -
    evaluation.metrics.scoreMeanAbsoluteMiss * 0.1 -
    evaluation.metrics.cleanRepFalsePositiveRate * 5 -
    nearThresholdRate * 10 +
    scorableRate * 5 +
    evaluation.metrics.scorableAccuracy * 10 +
    evaluation.metrics.viewAccuracy * 5
  );
}

function scoreEvaluationSummary(
  evaluation: EvaluationSummary,
  selectionMode: OptimizerSelectionMode,
): number {
  return selectionMode === 'diagnostic'
    ? scoreDiagnosticEvaluationSummary(evaluation)
    : scoreLegacyEvaluationSummary(evaluation);
}

function hardNegativeCleanFpRate(evaluation: EvaluationSummary | null | undefined): number | null {
  return evaluation?.cleanSafety?.buckets.hardNegativeClean.falsePositiveRate ?? null;
}

function cleanSafetyFirstScore(evaluation: EvaluationSummary): number {
  const diagnostic = evaluation.diagnosticSummary;
  const diagnosticIssueF1 = diagnostic?.weightedIssueF1 ?? evaluation.metrics.issueF1;
  const cleanFpRate = evaluation.metrics.cleanRepFalsePositiveRate;
  const hardNegativeFpRate = hardNegativeCleanFpRate(evaluation) ?? cleanFpRate;
  return (
    evaluation.metrics.repCountAccuracy * 1000 +
    diagnosticIssueF1 * 500 -
    cleanFpRate * 1500 -
    hardNegativeFpRate * 1000 +
    evaluation.metrics.scorableAccuracy * 10 +
    evaluation.metrics.viewAccuracy * 5
  );
}

function candidateDiagnosticScores(
  evaluation: EvaluationSummary,
  selectionMode: OptimizerSelectionMode,
  baseline?: EvaluationSummary | null,
  cleanGate?: CleanFpGateDiagnostics,
): CandidateDiagnosticScores {
  const currentScore = scoreEvaluationSummary(evaluation, selectionMode);
  const legacyScore = scoreLegacyEvaluationSummary(evaluation);
  const diagnosticIssueF1 = evaluation.diagnosticSummary?.weightedIssueF1 ?? evaluation.metrics.issueF1;
  const repCountGatePassed =
    !baseline || evaluation.metrics.repCountAccuracy >= baseline.metrics.repCountAccuracy - 0.05;
  const cleanGatePassed = cleanGate ? cleanGate.passed : true;
  return {
    currentScore,
    legacyScore,
    cleanSafetyFirstScore: cleanSafetyFirstScore(evaluation),
    repCountGatedScore: repCountGatePassed ? currentScore : -1_000_000_000,
    issueF1AfterCleanGateScore: cleanGatePassed ? diagnosticIssueF1 * 1000 : -1_000_000_000,
  };
}

const DEFAULT_CLEAN_FP_GATE_CAP = 0.5;
const DEFAULT_HARD_NEGATIVE_CLEAN_FP_GATE_CAP = 0.5;
const DEFAULT_MIN_CLEAN_FP_IMPROVEMENT = 0.05;
const DEFAULT_MAX_VALIDATION_REP_COUNT_REGRESSION = 0.1;

function gateCheck(args: {
  name: string;
  split: 'train' | 'validation';
  candidateRate: number | null;
  baselineRate: number | null;
  absoluteCap: number;
  minImprovement: number;
}): CleanFpGateCheck {
  const { candidateRate, baselineRate, absoluteCap, minImprovement } = args;
  if (candidateRate === null) {
    return {
      ...args,
      passed: true,
      reason: 'No eligible clean reps for this gate.',
    };
  }
  const improvement =
    baselineRate === null ? 0 : baselineRate - candidateRate;
  const passed = candidateRate <= absoluteCap || improvement >= minImprovement;
  return {
    ...args,
    passed,
    reason: passed
      ? `Passed: rate ${candidateRate.toFixed(4)} is under cap ${absoluteCap.toFixed(4)} or improved by ${improvement.toFixed(4)}.`
      : `Failed: rate ${candidateRate.toFixed(4)} exceeds cap ${absoluteCap.toFixed(4)} and improvement ${improvement.toFixed(4)} is below ${minImprovement.toFixed(4)}.`,
  };
}

export function buildCleanFpGateDiagnostics(args: {
  candidateTrain: EvaluationSummary | null;
  candidateValidation: EvaluationSummary | null;
  baselineTrain: EvaluationSummary | null;
  baselineValidation: EvaluationSummary | null;
  enforced: boolean;
}): CleanFpGateDiagnostics {
  const checks: CleanFpGateCheck[] = [
    gateCheck({
      name: 'train clean FP cap',
      split: 'train',
      candidateRate: args.candidateTrain?.metrics.cleanRepFalsePositiveRate ?? null,
      baselineRate: args.baselineTrain?.metrics.cleanRepFalsePositiveRate ?? null,
      absoluteCap: DEFAULT_CLEAN_FP_GATE_CAP,
      minImprovement: 0,
    }),
    gateCheck({
      name: 'train hard-negative clean FP cap',
      split: 'train',
      candidateRate: hardNegativeCleanFpRate(args.candidateTrain),
      baselineRate: hardNegativeCleanFpRate(args.baselineTrain),
      absoluteCap: DEFAULT_HARD_NEGATIVE_CLEAN_FP_GATE_CAP,
      minImprovement: 0,
    }),
    gateCheck({
      name: 'validation clean FP cap',
      split: 'validation',
      candidateRate: args.candidateValidation?.metrics.cleanRepFalsePositiveRate ?? null,
      baselineRate: args.baselineValidation?.metrics.cleanRepFalsePositiveRate ?? null,
      absoluteCap: DEFAULT_CLEAN_FP_GATE_CAP,
      minImprovement: DEFAULT_MIN_CLEAN_FP_IMPROVEMENT,
    }),
    gateCheck({
      name: 'validation hard-negative clean FP cap',
      split: 'validation',
      candidateRate: hardNegativeCleanFpRate(args.candidateValidation),
      baselineRate: hardNegativeCleanFpRate(args.baselineValidation),
      absoluteCap: DEFAULT_HARD_NEGATIVE_CLEAN_FP_GATE_CAP,
      minImprovement: DEFAULT_MIN_CLEAN_FP_IMPROVEMENT,
    }),
  ];
  if (args.candidateValidation && args.baselineValidation) {
    const regression =
      args.baselineValidation.metrics.repCountAccuracy -
      args.candidateValidation.metrics.repCountAccuracy;
    const passed = regression <= DEFAULT_MAX_VALIDATION_REP_COUNT_REGRESSION;
    checks.push({
      name: 'validation rep-count regression tolerance',
      split: 'validation',
      candidateRate: args.candidateValidation.metrics.repCountAccuracy,
      baselineRate: args.baselineValidation.metrics.repCountAccuracy,
      absoluteCap: args.baselineValidation.metrics.repCountAccuracy,
      minImprovement: -DEFAULT_MAX_VALIDATION_REP_COUNT_REGRESSION,
      passed,
      reason: passed
        ? `Passed: validation rep-count regression ${regression.toFixed(4)} is within tolerance.`
        : `Failed: validation rep-count regression ${regression.toFixed(4)} exceeds tolerance ${DEFAULT_MAX_VALIDATION_REP_COUNT_REGRESSION.toFixed(4)}.`,
    });
  }
  return {
    enforced: args.enforced,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function candidateSafetyMetrics(args: {
  train: EvaluationSummary | null;
  validation: EvaluationSummary | null;
}): CandidateSafetyMetrics {
  return {
    cleanFpRateTrain: args.train?.metrics.cleanRepFalsePositiveRate ?? null,
    cleanFpRateValidation: args.validation?.metrics.cleanRepFalsePositiveRate ?? null,
    hardNegativeCleanFpRateTrain: hardNegativeCleanFpRate(args.train),
    hardNegativeCleanFpRateValidation: hardNegativeCleanFpRate(args.validation),
    trainRepCountAccuracy: args.train?.metrics.repCountAccuracy ?? null,
    validationRepCountAccuracy: args.validation?.metrics.repCountAccuracy ?? null,
  };
}

function issueMetricReport(summary: EvaluationSummary | null): PerIssueMetricReport[] {
  if (!summary?.diagnosticSummary) return [];
  return Object.values(summary.diagnosticSummary.issueSummaries)
    .map((issue) => {
      const precisionDenominator = issue.truePositiveCount + issue.falsePositiveCount;
      const recallDenominator = issue.truePositiveCount + issue.falseNegativeCount;
      const precision = precisionDenominator === 0 ? 1 : issue.truePositiveCount / precisionDenominator;
      const recall = recallDenominator === 0 ? 1 : issue.truePositiveCount / recallDenominator;
      const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
      const cleanFp = summary.cleanSafety?.perIssueCleanFalsePositives[issue.issueId];
      return {
        issueId: issue.issueId,
        truePositiveCount: issue.truePositiveCount,
        falsePositiveCount: issue.falsePositiveCount,
        falseNegativeCount: issue.falseNegativeCount,
        precision,
        recall,
        f1,
        cleanFalsePositiveCount: cleanFp?.cleanFalsePositiveCount ?? 0,
        hardNegativeCleanFalsePositiveCount: cleanFp?.hardNegativeCleanFalsePositiveCount ?? 0,
      };
    })
    .sort((a, b) => a.issueId.localeCompare(b.issueId));
}

function issueOnlyMetricSnapshot(summary: EvaluationSummary | null): IssueOnlyMetricSnapshot | null {
  if (!summary) return null;
  return {
    repCountAccuracy: summary.metrics.repCountAccuracy,
    predictedReps: summary.totals.predictedReps,
    expectedReps: summary.totals.expectedReps,
    cleanRepFalsePositiveRate: summary.metrics.cleanRepFalsePositiveRate,
    hardNegativeCleanFalsePositiveRate: hardNegativeCleanFpRate(summary),
    issuePrecision: summary.metrics.issuePrecision,
    issueRecall: summary.metrics.issueRecall,
    issueF1: summary.metrics.issueF1,
    weightedIssuePrecision: summary.diagnosticSummary?.weightedIssuePrecision ?? null,
    weightedIssueRecall: summary.diagnosticSummary?.weightedIssueRecall ?? null,
    weightedIssueF1: summary.diagnosticSummary?.weightedIssueF1 ?? null,
    perIssue: issueMetricReport(summary),
  };
}

function issueOnlySplitSnapshots(
  summaries: EvaluationBySplit<EvaluationSummary>,
): EvaluationBySplit<IssueOnlyMetricSnapshot> {
  return {
    all: issueOnlyMetricSnapshot(summaries.all),
    train: issueOnlyMetricSnapshot(summaries.train),
    validation: issueOnlyMetricSnapshot(summaries.validation),
    test: issueOnlyMetricSnapshot(summaries.test),
  };
}

function buildIssueOnlyReportSummary(args: {
  enabled: boolean;
  tracker: RepCountStabilityTracker;
  baseline: EvaluationBySplit<EvaluationSummary>;
  winner: EvaluationBySplit<EvaluationSummary>;
}): IssueOnlyReportSummary | undefined {
  if (!args.enabled) return undefined;
  return {
    enabled: true,
    candidateChangedRepCountAccuracy: args.tracker.warningCount > 0 || args.tracker.rejectCount > 0,
    warningCount: args.tracker.warningCount,
    warnings: args.tracker.warnings,
    mixedUnsafeTunables: Array.from(args.tracker.mixedUnsafeTunablePaths).sort(),
    repCountStabilityRejectCount: args.tracker.rejectCount,
    repCountStabilityWarningCount: args.tracker.warningCount,
    rejectedForTrainRepCountChange: args.tracker.rejectedForTrainRepCountChange,
    rejectedForValidationRepCountChange: args.tracker.rejectedForValidationRepCountChange,
    repCountStabilityRejectedExamples: args.tracker.rejectedExamples,
    baselinePredictedRepsBySplit: repCountSplitSnapshots(args.baseline),
    winnerPredictedRepsBySplit: repCountSplitSnapshots(args.winner),
    baseline: issueOnlySplitSnapshots(args.baseline),
    winner: issueOnlySplitSnapshots(args.winner),
  };
}

function sortEvaluatedCandidates<T extends { score: number; legacyScore: number }>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => b.score - a.score || b.legacyScore - a.legacyScore);
}

function topEvaluatedCandidates<T extends { score: number; legacyScore: number }>(
  candidates: T[],
  count: number,
): T[] {
  return sortEvaluatedCandidates(candidates).slice(0, count);
}

function emptySourceBreakdown(): Record<CandidateSource, number> {
  return { baseline: 0, random: 0, refined: 0, diagnostic: 0 };
}

function sourceBreakdownFor(candidates: EvaluatedCandidateSummary[]): Record<CandidateSource, number> {
  const result = emptySourceBreakdown();
  for (const candidate of candidates) {
    result[candidate.source] += 1;
  }
  return result;
}

function issueOptimizerSearchSpec(spec: TunableSpec): TunableSpec {
  return {
    ...spec,
    tunables: spec.tunables.filter((tunable) => tunable.kind !== 'scoring'),
  };
}

function effectiveTunableGroup(options?: Pick<OptimizerCommandOptions, 'tunableGroup'>): OptimizerTunableGroup {
  return options?.tunableGroup ?? 'all';
}

function filterDiagnosticTuningForTunables(spec: TunableSpec, activePaths: Set<string>): TunableSpec['diagnosticTuning'] {
  return spec.diagnosticTuning?.filter((entry) => activePaths.has(entry.thresholdPath));
}

function filterTunableSpecForGroup(spec: TunableSpec, group: OptimizerTunableGroup): TunableSpec {
  if (group === 'all') return spec;
  const tunables = spec.tunables.filter((tunable) =>
    tunable.kind === 'feedback' && !tunable.path.startsWith('viewQualityThresholds.'),
  );
  const activePaths = new Set(tunables.map((tunable) => tunable.path));
  return {
    ...spec,
    tunables,
    diagnosticTuning: filterDiagnosticTuningForTunables(spec, activePaths),
  };
}

function optimizerSearchSpecForCases(
  spec: TunableSpec,
  cases: DatasetCase[],
  group: OptimizerTunableGroup,
): TunableSpec {
  const scoreAwareSpec = hasScoreRangeLabels(cases) ? spec : issueOptimizerSearchSpec(spec);
  return filterTunableSpecForGroup(scoreAwareSpec, group);
}

function hasScoreRangeLabels(cases: DatasetCase[]): boolean {
  return cases.some((datasetCase) =>
    datasetCase.label.reps.some((rep) => rep.scorable !== false && rep.expectedScoreRange),
  );
}

function classifyTunable(pathName: string, kind: NumericTunable['kind']): Omit<
  TunableReportEntry,
  'path' | 'currentValue' | 'min' | 'max' | 'step' | 'kind' | 'activeInSearch'
> {
  const countOnly = new Set([
    'thresholds.EXTENDED_ENTER',
    'thresholds.EXTENDED_EXIT',
    'thresholds.FLEXED_ENTER',
    'thresholds.FLEXED_EXIT',
    'thresholds.FLEXED_EXIT_DELTA',
    'thresholds.MIN_REP_TIME',
    'thresholds.MIN_PARTIAL_ROM',
    'thresholds.MIN_ARM_PARTICIPATION_ROM',
    'thresholds.MIN_DOWN_GUARD',
  ]);
  const mixedUnsafe = new Set([
    'thresholds.ROM_MIN',
    'thresholds.SYNC_WINDOW',
  ]);
  const viewSupport = pathName.startsWith('viewQualityThresholds.');

  if (viewSupport) {
    return {
      affectsRepCountingOrFsm: true,
      affectsIssueDetectionOnly: false,
      affectsBoth: true,
      recommendedGroup: 'mixed-unsafe',
      reason: 'View/scoreability support threshold can alter count suppression; frozen in issue-feedback mode.',
    };
  }
  if (countOnly.has(pathName)) {
    return {
      affectsRepCountingOrFsm: true,
      affectsIssueDetectionOnly: false,
      affectsBoth: false,
      recommendedGroup: 'count-fsm',
      reason: 'Rep-window/FSM threshold; frozen in issue-feedback mode.',
    };
  }
  if (mixedUnsafe.has(pathName)) {
    return {
      affectsRepCountingOrFsm: kind === 'fsm',
      affectsIssueDetectionOnly: false,
      affectsBoth: true,
      recommendedGroup: 'mixed-unsafe',
      reason: 'Issue cue threshold in the FSM threshold namespace; frozen until explicitly isolated.',
    };
  }
  if (kind === 'feedback') {
    return {
      affectsRepCountingOrFsm: false,
      affectsIssueDetectionOnly: true,
      affectsBoth: false,
      recommendedGroup: 'issue-feedback',
      reason: 'Form-feedback issue threshold; allowed in issue-feedback mode.',
    };
  }
  return {
    affectsRepCountingOrFsm: kind === 'fsm',
    affectsIssueDetectionOnly: false,
    affectsBoth: kind !== 'fsm',
    recommendedGroup: kind === 'fsm' ? 'count-fsm' : 'mixed-unsafe',
    reason: `${kind} tunable is not part of issue-feedback mode.`,
  };
}

function tunableReportEntries(
  definition: ExerciseDefinition,
  searchSpec: TunableSpec | null,
): TunableReportEntry[] {
  const activePaths = new Set(searchSpec?.tunables.map((tunable) => tunable.path) ?? []);
  const baseConfig = definition.heuristicConfig;
  return (definition.tunableSpec?.tunables ?? []).map((tunable) => {
    const currentValue = baseConfig ? getConfigValue(baseConfig, tunable.path) : null;
    return {
      path: tunable.path,
      currentValue: typeof currentValue === 'number' && Number.isFinite(currentValue) ? currentValue : null,
      min: tunable.min,
      max: tunable.max,
      step: tunable.step,
      kind: tunable.kind,
      activeInSearch: activePaths.has(tunable.path),
      ...classifyTunable(tunable.path, tunable.kind),
    };
  });
}

function changedTunablePaths(
  baseConfig: ExerciseHeuristicConfig,
  candidateConfig: ExerciseHeuristicConfig,
  spec: NonNullable<ExerciseDefinition['tunableSpec']>,
): string[] {
  return spec.tunables
    .map((tunable) => tunable.path)
    .filter((pathName) => getConfigValue(baseConfig, pathName) !== getConfigValue(candidateConfig, pathName));
}

function createRepCountStabilityTracker(): RepCountStabilityTracker {
  return {
    warningCount: 0,
    warnings: [],
    rejectCount: 0,
    rejectedExamples: [],
    rejectedForTrainRepCountChange: 0,
    rejectedForValidationRepCountChange: 0,
    mixedUnsafeTunablePaths: new Set<string>(),
  };
}

function repCountCaseChanges(
  baseline: RepCountStabilitySplitSnapshot | undefined,
  candidate: RepCountStabilitySplitSnapshot | undefined,
): RepCountCaseChange[] {
  if (!baseline || !candidate) return [];
  const baselineByVideo = new Map(
    baseline.perCasePredictedReps.map((entry) => [entry.sourceVideo, entry]),
  );
  const changes: RepCountCaseChange[] = [];
  for (const candidateCase of candidate.perCasePredictedReps) {
    const baselineCase = baselineByVideo.get(candidateCase.sourceVideo);
    if (!baselineCase) continue;
    if (
      baselineCase.predictedReps === candidateCase.predictedReps &&
      baselineCase.repCountCorrect === candidateCase.repCountCorrect
    ) {
      continue;
    }
    changes.push({
      sourceVideo: candidateCase.sourceVideo,
      baselinePredictedReps: baselineCase.predictedReps,
      candidatePredictedReps: candidateCase.predictedReps,
      baselineRepCountCorrect: baselineCase.repCountCorrect,
      candidateRepCountCorrect: candidateCase.repCountCorrect,
    });
  }
  return changes;
}

function buildRepCountStabilityEvent(args: {
  runtime: OptimizerRuntimeContext;
  definition: ExerciseDefinition;
  spec: TunableSpec;
  candidate: InstrumentedCandidateConfig;
  evaluation: EvaluationSummary;
}): RepCountStabilityWarning | null {
  if (args.runtime.tunableGroup !== 'issue-feedback') return null;
  const baseline = args.runtime.repCountBaseline;
  if (!baseline || !args.definition.heuristicConfig) return null;

  const predictedChanged = args.evaluation.totals.predictedReps !== baseline.totals.predictedReps;
  const accuracyChanged = args.evaluation.metrics.repCountAccuracy !== baseline.metrics.repCountAccuracy;
  const changedCases = repCountCaseChanges(baseline.repCountSnapshot, args.evaluation.repCountSnapshot);
  const perCaseChanged = changedCases.length > 0;
  if (!predictedChanged && !accuracyChanged && !perCaseChanged) return null;

  const changedPaths = args.candidate.changedPaths?.length
    ? args.candidate.changedPaths
    : changedTunablePaths(args.definition.heuristicConfig, args.candidate.config, args.spec);
  const split = args.runtime.repCountBaselineSplit ?? 'train';
  const reasons: string[] = [];
  if (predictedChanged) {
    reasons.push(`predicted reps ${baseline.totals.predictedReps} -> ${args.evaluation.totals.predictedReps}`);
  }
  if (accuracyChanged) {
    reasons.push(
      `rep-count accuracy ${baseline.metrics.repCountAccuracy.toFixed(4)} -> ${args.evaluation.metrics.repCountAccuracy.toFixed(4)}`,
    );
  }
  if (perCaseChanged) {
    reasons.push(`${changedCases.length} per-recording rep-count change(s)`);
  }
  return {
    candidateId: args.candidate.id,
    source: args.candidate.source,
    split,
    changedPaths,
    reason: `Issue-feedback rep-count instability on ${split}: ${reasons.join('; ')}.`,
    changedTotalPredictedReps: predictedChanged,
    changedRepCountAccuracy: accuracyChanged,
    changedPerCasePredictedReps: perCaseChanged,
    baselinePredictedReps: baseline.totals.predictedReps,
    candidatePredictedReps: args.evaluation.totals.predictedReps,
    baselineRepCountAccuracy: baseline.metrics.repCountAccuracy,
    candidateRepCountAccuracy: args.evaluation.metrics.repCountAccuracy,
    changedCasePredictedReps: changedCases.slice(0, 10),
  };
}

function recordRepCountStabilityRejection(
  tracker: RepCountStabilityTracker,
  event: RepCountStabilityWarning,
): void {
  event.changedPaths.forEach((pathName) => tracker.mixedUnsafeTunablePaths.add(pathName));
  tracker.rejectCount += 1;
  if (event.split === 'train') tracker.rejectedForTrainRepCountChange += 1;
  if (event.split === 'validation') tracker.rejectedForValidationRepCountChange += 1;
  if (tracker.rejectedExamples.length >= MAX_REP_COUNT_STABILITY_REJECTION_EXAMPLES) return;
  tracker.rejectedExamples.push(event);
}

function repCountStabilityCheckpointSummary(
  tracker: RepCountStabilityTracker | undefined,
): RepCountStabilityCheckpointSummary | undefined {
  if (!tracker) return undefined;
  return {
    rejectCount: tracker.rejectCount,
    warningCount: tracker.warningCount,
    rejectedForTrainRepCountChange: tracker.rejectedForTrainRepCountChange,
    rejectedForValidationRepCountChange: tracker.rejectedForValidationRepCountChange,
    mixedUnsafeTunables: Array.from(tracker.mixedUnsafeTunablePaths).sort(),
  };
}

function diagnosticSupportGate(args: {
  definition: ExerciseDefinition;
  baselineConfig: ExerciseHeuristicConfig;
  winnerConfig: ExerciseHeuristicConfig;
  winnerSelection: EvaluationSummary;
}): { passed: boolean; reason: string } {
  const spec = args.definition.tunableSpec;
  if (!spec?.diagnosticTuning || spec.diagnosticTuning.length === 0) {
    return { passed: true, reason: 'No diagnostic support gate configured.' };
  }
  const changedPaths = new Set(changedTunablePaths(args.baselineConfig, args.winnerConfig, spec));
  const failures: string[] = [];
  for (const entry of spec.diagnosticTuning) {
    if (!changedPaths.has(entry.thresholdPath)) continue;
    const issueSummary = args.winnerSelection.diagnosticSummary?.issueSummaries[entry.issueId];
    const minPositive = entry.minPositiveCases ?? 2;
    const minNegative = entry.minNegativeCases ?? 2;
    if (
      !issueSummary ||
      issueSummary.eligiblePositiveCount < minPositive ||
      issueSummary.eligibleNegativeCount < minNegative
    ) {
      failures.push(
        `${entry.issueId} support ${issueSummary?.eligiblePositiveCount ?? 0}/${minPositive} positive, ${issueSummary?.eligibleNegativeCount ?? 0}/${minNegative} negative`,
      );
    }
  }
  return failures.length === 0
    ? { passed: true, reason: 'Diagnostic support gate passed.' }
    : { passed: false, reason: `Rejected: diagnostic support gate failed (${failures.join('; ')}).` };
}

function replayCaseForOptimizer(
  definition: ExerciseDefinition,
  datasetCase: DatasetCase,
  config?: ExerciseHeuristicConfig,
  runtime: EvaluationRuntimeOptions = {},
) {
  const options = {
    ...(config ? { heuristicConfig: config } : {}),
    confidenceGating: OPTIMIZER_CONFIDENCE_GATING,
  };
  const frameCache = runtime.replayCache?.get(datasetCase);
  return frameCache
    ? replayRecordingWithFrameCache(definition, frameCache, options)
    : replayRecording(definition, datasetCase.recording, options);
}

export function buildOptimizerReplayCache(
  cases: DatasetCase[],
  profiler?: OptimizerProfiler,
): WeakMap<DatasetCase, ReplayFrameCache> {
  const cache = new WeakMap<DatasetCase, ReplayFrameCache>();
  const totalStart = performance.now();
  for (const datasetCase of cases) {
    const caseStart = performance.now();
    cache.set(datasetCase, buildReplayFrameCache(datasetCase.recording));
    profiler?.record('poseStateFrameContextPreparation', performance.now() - caseStart);
  }
  profiler?.record('replayFramePreparation', performance.now() - totalStart);
  return cache;
}

function combineQualityCoverageSummaries(
  summaries: Array<EvaluationSummary | null>,
): QualityCoverageMetrics | undefined {
  let totalReps = 0;
  let scoredReps = 0;
  let unscoredReps = 0;
  let weightedConfidence = 0;

  for (const summary of summaries) {
    const coverage = summary?.qualityCoverage;
    if (!coverage) continue;
    totalReps += coverage.totalReps;
    scoredReps += coverage.scoredReps;
    unscoredReps += coverage.unscoredReps;
    weightedConfidence += coverage.averageConfidence * coverage.totalReps;
  }

  if (totalReps === 0) return undefined;
  return {
    totalReps,
    scoredReps,
    unscoredReps,
    scorableRate: scoredReps / totalReps,
    averageConfidence: weightedConfidence / totalReps,
  };
}

function combineDistributions(
  distributions: DiagnosticEvaluationSummary['issueSummaries'][string]['expectedPositiveMetric'][],
): DiagnosticEvaluationSummary['issueSummaries'][string]['expectedPositiveMetric'] {
  const count = distributions.reduce((total, item) => total + item.count, 0);
  if (count === 0) return { count: 0, min: null, max: null, mean: null };
  const means = distributions.filter((item) => item.count > 0 && item.mean !== null);
  const mins = distributions
    .map((item) => item.min)
    .filter((value): value is number => typeof value === 'number');
  const maxes = distributions
    .map((item) => item.max)
    .filter((value): value is number => typeof value === 'number');
  const meanDenominator = means.reduce((total, item) => total + item.count, 0);
  return {
    count,
    min: mins.length === 0 ? null : Math.min(...mins),
    max: maxes.length === 0 ? null : Math.max(...maxes),
    mean:
      meanDenominator === 0
        ? null
        : means.reduce((total, item) => total + item.mean! * item.count, 0) / meanDenominator,
  };
}

function weightedAverageNullable(values: Array<{ value: number | null; weight: number }>): number | null {
  const weighted = values.filter((item) => item.value !== null && item.weight > 0);
  if (weighted.length === 0) return null;
  const denominator = weighted.reduce((total, item) => total + item.weight, 0);
  return weighted.reduce((total, item) => total + item.value! * item.weight, 0) / denominator;
}

function combineDiagnosticSummaries(
  summaries: Array<EvaluationSummary | null>,
): DiagnosticEvaluationSummary | undefined {
  const issueIds = new Set<string>();
  let diagnosticRepCount = 0;
  for (const summary of summaries) {
    const diagnostic = summary?.diagnosticSummary;
    if (!diagnostic) continue;
    diagnosticRepCount += diagnostic.diagnosticRepCount;
    Object.keys(diagnostic.issueSummaries).forEach((issueId) => issueIds.add(issueId));
  }

  if (diagnosticRepCount === 0) return undefined;

  const issueSummaries: DiagnosticEvaluationSummary['issueSummaries'] = {};
  let weightedTp = 0;
  let weightedFp = 0;
  let weightedFn = 0;
  let nearThresholdMismatchCount = 0;

  for (const issueId of issueIds) {
    const parts = summaries
      .map((summary) => summary?.diagnosticSummary?.issueSummaries[issueId])
      .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary));
    const eligiblePositiveCount = parts.reduce((total, item) => total + item.eligiblePositiveCount, 0);
    const eligibleNegativeCount = parts.reduce((total, item) => total + item.eligibleNegativeCount, 0);
    const truePositiveCount = parts.reduce((total, item) => total + item.truePositiveCount, 0);
    const falsePositiveCount = parts.reduce((total, item) => total + item.falsePositiveCount, 0);
    const falseNegativeCount = parts.reduce((total, item) => total + item.falseNegativeCount, 0);
    const skippedCount = parts.reduce((total, item) => total + item.skippedCount, 0);
    const ineligibleCount = parts.reduce((total, item) => total + item.ineligibleCount, 0);
    const issueNearThresholdMismatchCount = parts.reduce(
      (total, item) => total + item.nearThresholdMismatchCount,
      0,
    );
    const issueWeightedTp = parts.reduce((total, item) => total + item.weightedTruePositive, 0);
    const issueWeightedFp = parts.reduce((total, item) => total + item.weightedFalsePositive, 0);
    const issueWeightedFn = parts.reduce((total, item) => total + item.weightedFalseNegative, 0);
    weightedTp += issueWeightedTp;
    weightedFp += issueWeightedFp;
    weightedFn += issueWeightedFn;
    nearThresholdMismatchCount += issueNearThresholdMismatchCount;

    issueSummaries[issueId] = {
      issueId,
      eligiblePositiveCount,
      eligibleNegativeCount,
      truePositiveCount,
      falsePositiveCount,
      falseNegativeCount,
      skippedCount,
      ineligibleCount,
      expectedPositiveMetric: combineDistributions(parts.map((item) => item.expectedPositiveMetric)),
      expectedNegativeMetric: combineDistributions(parts.map((item) => item.expectedNegativeMetric)),
      nearThresholdMismatchCount: issueNearThresholdMismatchCount,
      averageConfidence: weightedAverageNullable(
        parts.map((item) => ({
          value: item.averageConfidence,
          weight: Math.max(1, item.eligiblePositiveCount + item.eligibleNegativeCount),
        })),
      ),
      averageSampleCount: weightedAverageNullable(
        parts.map((item) => ({
          value: item.averageSampleCount,
          weight: Math.max(1, item.eligiblePositiveCount + item.eligibleNegativeCount),
        })),
      ),
      weightedTruePositive: issueWeightedTp,
      weightedFalsePositive: issueWeightedFp,
      weightedFalseNegative: issueWeightedFn,
    };
  }

  const precisionDenominator = weightedTp + weightedFp;
  const recallDenominator = weightedTp + weightedFn;
  const weightedIssuePrecision = precisionDenominator === 0 ? 1 : weightedTp / precisionDenominator;
  const weightedIssueRecall = recallDenominator === 0 ? 1 : weightedTp / recallDenominator;
  const weightedIssueF1 =
    weightedIssuePrecision + weightedIssueRecall === 0
      ? 0
      : (2 * weightedIssuePrecision * weightedIssueRecall) /
        (weightedIssuePrecision + weightedIssueRecall);

  return {
    issueSummaries,
    weightedIssuePrecision,
    weightedIssueRecall,
    weightedIssueF1,
    nearThresholdMismatchCount,
    diagnosticRepCount,
  };
}

function combineCleanSafetySummaries(
  summaries: Array<EvaluationSummary | null>,
): CleanSafetySummary | undefined {
  const parts = summaries
    .map((summary) => summary?.cleanSafety)
    .filter((summary): summary is CleanSafetySummary => Boolean(summary));
  if (parts.length === 0) return undefined;

  const bucketKeys: CleanRepBucketKey[] = [
    'cleanFront',
    'hardNegativeClean',
    'issueRecordingClean',
    'partialViewClean',
    'unscorable',
  ];
  const buckets = Object.fromEntries(
    bucketKeys.map((key) => [key, emptyMutableBucket()]),
  ) as Record<CleanRepBucketKey, ReturnType<typeof emptyMutableBucket>>;
  for (const part of parts) {
    for (const key of bucketKeys) {
      const source = part.buckets[key] ?? emptyBucketSummary();
      buckets[key].cleanReps += source.cleanReps;
      buckets[key].falsePositiveReps += source.falsePositiveReps;
      buckets[key].falseIssueCount += source.falseIssueCount;
      for (const issue of source.topFalsePositiveIssueIds) {
        incrementCount(buckets[key].issues, issue.issueId, issue.count);
      }
    }
  }

  const totalCleanScorableReps = parts.reduce(
    (total, part) => total + part.totalCleanScorableReps,
    0,
  );
  const perIssue = new Map<string, PerIssueCleanFalsePositiveSummary & { recordings: Map<string, number> }>();
  for (const part of parts) {
    for (const issue of Object.values(part.perIssueCleanFalsePositives)) {
      const target = perIssue.get(issue.issueId) ?? {
        issueId: issue.issueId,
        cleanFalsePositiveCount: 0,
        cleanFalsePositiveRate: 0,
        hardNegativeCleanFalsePositiveCount: 0,
        splitBreakdown: { train: 0, validation: 0, test: 0 },
        topRecordings: [],
        recordings: new Map<string, number>(),
      };
      target.cleanFalsePositiveCount += issue.cleanFalsePositiveCount;
      target.hardNegativeCleanFalsePositiveCount += issue.hardNegativeCleanFalsePositiveCount;
      target.splitBreakdown.train += issue.splitBreakdown.train;
      target.splitBreakdown.validation += issue.splitBreakdown.validation;
      target.splitBreakdown.test += issue.splitBreakdown.test;
      for (const recording of issue.topRecordings) {
        incrementCount(target.recordings, recording.recording, recording.count);
      }
      perIssue.set(issue.issueId, target);
    }
  }

  const asymmetrySubCues = new Map<string, AsymmetrySubCueSummary>();
  for (const part of parts) {
    for (const [key, source] of Object.entries(part.asymmetrySubCues)) {
      const target = asymmetrySubCues.get(key) ?? {
        cleanFalsePositiveCount: 0,
        truePositiveCount: 0,
        falseNegativeCount: 0,
      };
      target.cleanFalsePositiveCount += source.cleanFalsePositiveCount;
      target.truePositiveCount += source.truePositiveCount;
      target.falseNegativeCount += source.falseNegativeCount;
      asymmetrySubCues.set(key, target);
    }
  }

  const repCountBucketKeys: Array<keyof CleanSafetySummary['repCountBuckets']> = [
    'cleanFront',
    'hardNegativeClean',
    'issueRecording',
    'partialView',
    'unscorable',
  ];
  const repCountBuckets = Object.fromEntries(
    repCountBucketKeys.map((key) => [key, emptyRepCountBucket()]),
  ) as CleanSafetySummary['repCountBuckets'];
  for (const part of parts) {
    for (const key of repCountBucketKeys) {
      repCountBuckets[key].cases += part.repCountBuckets[key].cases;
      repCountBuckets[key].repCountCorrect += part.repCountBuckets[key].repCountCorrect;
    }
  }

  return {
    totalCleanScorableReps,
    buckets: Object.fromEntries(
      bucketKeys.map((key) => [key, finalizeBucket(buckets[key])]),
    ) as Record<CleanRepBucketKey, CleanRepBucketSummary>,
    perIssueCleanFalsePositives: Object.fromEntries(
      Array.from(perIssue.values())
        .sort((a, b) => b.cleanFalsePositiveCount - a.cleanFalsePositiveCount || a.issueId.localeCompare(b.issueId))
        .map((issue) => [
          issue.issueId,
          {
            issueId: issue.issueId,
            cleanFalsePositiveCount: issue.cleanFalsePositiveCount,
            cleanFalsePositiveRate: safeRate(issue.cleanFalsePositiveCount, totalCleanScorableReps),
            hardNegativeCleanFalsePositiveCount: issue.hardNegativeCleanFalsePositiveCount,
            splitBreakdown: issue.splitBreakdown,
            topRecordings: Array.from(issue.recordings.entries())
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
              .slice(0, 10)
              .map(([recording, count]) => ({ recording, count })),
          },
        ]),
    ),
    asymmetrySubCues: Object.fromEntries(
      Array.from(asymmetrySubCues.entries()).sort(([a], [b]) => a.localeCompare(b)),
    ),
    romFalsePositiveDiagnostics: {
      count: parts.reduce((total, part) => total + part.romFalsePositiveDiagnostics.count, 0),
      examples: parts.flatMap((part) => part.romFalsePositiveDiagnostics.examples).slice(0, 20),
    },
    torsoFalsePositiveDiagnostics: {
      count: parts.reduce((total, part) => total + part.torsoFalsePositiveDiagnostics.count, 0),
      examples: parts.flatMap((part) => part.torsoFalsePositiveDiagnostics.examples).slice(0, 20),
    },
    repCountBuckets: {
      cleanFront: finalizeRepCountBucket(repCountBuckets.cleanFront),
      hardNegativeClean: finalizeRepCountBucket(repCountBuckets.hardNegativeClean),
      issueRecording: finalizeRepCountBucket(repCountBuckets.issueRecording),
      partialView: finalizeRepCountBucket(repCountBuckets.partialView),
      unscorable: finalizeRepCountBucket(repCountBuckets.unscorable),
    },
  };
}

function combineSummaries(summaries: Array<EvaluationSummary | null>): EvaluationSummary | null {
  const totals = emptyTotals();
  let hasAny = false;
  for (const summary of summaries) {
    if (!summary) continue;
    addTotals(totals, summary.totals);
    hasAny = true;
  }
  return hasAny
    ? {
        totals,
        metrics: metricsFromTotals(totals),
        repCountSnapshot: {
          expectedReps: totals.expectedReps,
          predictedReps: totals.predictedReps,
          repCountAccuracy: metricsFromTotals(totals).repCountAccuracy,
          perCasePredictedReps: summaries
            .flatMap((summary) => summary?.repCountSnapshot?.perCasePredictedReps ?? [])
            .sort((a, b) => a.sourceVideo.localeCompare(b.sourceVideo)),
        },
        qualityCoverage: combineQualityCoverageSummaries(summaries),
        diagnosticSummary: combineDiagnosticSummaries(summaries),
        cleanSafety: combineCleanSafetySummaries(summaries),
      }
    : null;
}

function flagValue(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (current === flag) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${flag}.`);
      }
      return value;
    }
    if (current.startsWith(`${flag}=`)) {
      const value = current.slice(flag.length + 1);
      if (!value) throw new Error(`Missing value for ${flag}.`);
      return value;
    }
  }
  return null;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseNonNegativeIntegerFlag(argv: string[], flag: string): number | undefined {
  const value = flagValue(argv, flag);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function parsePositiveIntegerFlag(argv: string[], flag: string): number | undefined {
  const parsed = parseNonNegativeIntegerFlag(argv, flag);
  if (parsed !== undefined && parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseSelectionMode(argv: string[]): OptimizerSelectionMode {
  const value = flagValue(argv, '--selection-mode') ?? 'diagnostic';
  if (value !== 'current' && value !== 'diagnostic') {
    throw new Error('--selection-mode must be "current" or "diagnostic".');
  }
  return value;
}

function parseTunableGroup(argv: string[]): OptimizerTunableGroup | undefined {
  if (hasFlag(argv, '--optimize-issues-only') || hasFlag(argv, '--freeze-count-tunables')) {
    return 'issue-feedback';
  }
  const value = flagValue(argv, '--tunable-group');
  if (value === null) return undefined;
  if (value !== 'all' && value !== 'issue-feedback') {
    throw new Error('--tunable-group must be "all" or "issue-feedback".');
  }
  return value;
}

export function parseOptimizerCommandOptions(argv: string[]): OptimizerCommandOptions {
  const apply = hasFlag(argv, '--apply') && !hasFlag(argv, '--dry-run');
  return {
    datasetRoot: flagValue(argv, '--dataset-root') ?? undefined,
    exerciseFilter: flagValue(argv, '--exercise'),
    dryRun: hasFlag(argv, '--dry-run'),
    includeCaseDetails: hasFlag(argv, '--include-case-details'),
    includeDiagnostics: !hasFlag(argv, '--no-diagnostics') || hasFlag(argv, '--include-diagnostics'),
    selectionMode: parseSelectionMode(argv),
    apply,
    silent: hasFlag(argv, '--silent'),
    reportPath: flagValue(argv, '--report'),
    profile: hasFlag(argv, '--profile'),
    useReplayCache: !hasFlag(argv, '--no-replay-cache'),
    checkpointPath: flagValue(argv, '--checkpoint'),
    resumeCheckpoint: hasFlag(argv, '--resume') || hasFlag(argv, '--resume-checkpoint'),
    checkpointEvery: parsePositiveIntegerFlag(argv, '--checkpoint-every'),
    enforceCleanFpGates: hasFlag(argv, '--enforce-clean-fp-gates'),
    tunableGroup: parseTunableGroup(argv),
    search: {
      randomCandidates: parseNonNegativeIntegerFlag(argv, '--random-candidates'),
      survivorCount:
        parseNonNegativeIntegerFlag(argv, '--survivors') ??
        parseNonNegativeIntegerFlag(argv, '--survivor-count'),
      refinementRounds: parseNonNegativeIntegerFlag(argv, '--refinement-rounds'),
      seed: parseNonNegativeIntegerFlag(argv, '--seed'),
    },
    minCases: {
      train:
        parseNonNegativeIntegerFlag(argv, '--min-train-cases') ??
        DEFAULT_MIN_SPLIT_CASES.train,
      validation:
        parseNonNegativeIntegerFlag(argv, '--min-validation-cases') ??
        DEFAULT_MIN_SPLIT_CASES.validation,
      test:
        parseNonNegativeIntegerFlag(argv, '--min-test-cases') ??
        DEFAULT_MIN_SPLIT_CASES.test,
    },
  };
}

export function evaluateCasesCompact(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  config?: ExerciseHeuristicConfig,
  runtime: EvaluationRuntimeOptions = {},
): EvaluationSummary | null {
  if (cases.length === 0) return null;
  const caseEvaluations = runtime.profiler?.time(runtime.profileSection ?? 'evaluation', () =>
    cases.map((datasetCase) =>
      evaluateCase(datasetCase, replayCaseForOptimizer(definition, datasetCase, config, runtime)),
    ),
  ) ?? cases.map((datasetCase) =>
    evaluateCase(datasetCase, replayCaseForOptimizer(definition, datasetCase, config, runtime)),
  );
  const detailed = summarizeEvaluations(caseEvaluations);
  return {
    totals: detailed.totals,
    metrics: detailed.metrics,
    repCountSnapshot: repCountSnapshotFromCaseEvaluations(caseEvaluations),
    qualityCoverage: detailed.qualityCoverage,
    diagnosticSummary: detailed.diagnosticSummary,
    cleanSafety: buildCleanSafetySummary(caseEvaluations, cases),
  };
}

export function evaluateCasesDetailed(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  config?: ExerciseHeuristicConfig,
  runtime: EvaluationRuntimeOptions = {},
): DatasetEvaluation | null {
  if (cases.length === 0) return null;
  return runtime.profiler?.time(runtime.profileSection ?? 'evaluationDetailed', () =>
    summarizeEvaluations(
      cases.map((datasetCase) =>
        evaluateCase(
          datasetCase,
          replayCaseForOptimizer(definition, datasetCase, config, runtime),
        ),
      ),
    ),
  ) ?? summarizeEvaluations(
    cases.map((datasetCase) =>
      evaluateCase(
        datasetCase,
        replayCaseForOptimizer(definition, datasetCase, config, runtime),
      ),
    ),
  );
}

function compactSummary(
  evaluation: DatasetEvaluation | null,
  datasetCases?: DatasetCase[],
): EvaluationSummary | null {
  if (!evaluation) return null;
  return {
    totals: evaluation.totals,
    metrics: evaluation.metrics,
    repCountSnapshot: repCountSnapshotFromCaseEvaluations(evaluation.cases),
    qualityCoverage: evaluation.qualityCoverage,
    diagnosticSummary: evaluation.diagnosticSummary,
    cleanSafety: datasetCases
      ? buildCleanSafetySummary(evaluation.cases, datasetCases)
      : undefined,
  };
}

function evaluateCaseEvaluations(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  config?: ExerciseHeuristicConfig,
  runtime: EvaluationRuntimeOptions = {},
): CaseEvaluation[] {
  if (cases.length === 0) return [];
  const evaluateOne = (datasetCase: DatasetCase) => {
    const run = () =>
      evaluateCase(datasetCase, replayCaseForOptimizer(definition, datasetCase, config, runtime));
    const splitSection = runtime.splitProfileSections?.[datasetCase.label.split];
    return runtime.profiler && splitSection ? runtime.profiler.time(splitSection, run) : run();
  };
  if (runtime.splitProfileSections) {
    return cases.map(evaluateOne);
  }
  return runtime.profiler?.time(runtime.profileSection ?? 'evaluation', () =>
    cases.map(evaluateOne),
  ) ?? cases.map(evaluateOne);
}

function summarizeCaseEvaluations(cases: CaseEvaluation[]): DatasetEvaluation | null {
  return cases.length > 0 ? summarizeEvaluations(cases) : null;
}

function evaluateSplitCompact(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  config?: ExerciseHeuristicConfig,
  runtime: EvaluationRuntimeOptions = {},
): EvaluationBySplit<EvaluationSummary> {
  const caseEvaluations = evaluateCaseEvaluations(definition, cases, config, runtime);
  const trainCases = cases.filter((datasetCase) => datasetCase.label.split === 'train');
  const validationCases = cases.filter((datasetCase) => datasetCase.label.split === 'validation');
  const testCases = cases.filter((datasetCase) => datasetCase.label.split === 'test');
  const train = summarizeCaseEvaluations(caseEvaluations.filter((item) => item.split === 'train'));
  const validation = summarizeCaseEvaluations(caseEvaluations.filter((item) => item.split === 'validation'));
  const test = summarizeCaseEvaluations(caseEvaluations.filter((item) => item.split === 'test'));
  return {
    all: compactSummary(summarizeCaseEvaluations(caseEvaluations), cases),
    train: compactSummary(train, trainCases),
    validation: compactSummary(validation, validationCases),
    test: compactSummary(test, testCases),
  };
}

function evaluateSplitDetailed(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  config?: ExerciseHeuristicConfig,
  runtime: EvaluationRuntimeOptions = {},
): EvaluationBySplit<DatasetEvaluation> {
  const caseEvaluations = evaluateCaseEvaluations(definition, cases, config, runtime);
  return {
    all: summarizeCaseEvaluations(caseEvaluations),
    train: summarizeCaseEvaluations(caseEvaluations.filter((item) => item.split === 'train')),
    validation: summarizeCaseEvaluations(caseEvaluations.filter((item) => item.split === 'validation')),
    test: summarizeCaseEvaluations(caseEvaluations.filter((item) => item.split === 'test')),
  };
}

function findTunable(spec: NonNullable<ExerciseDefinition['tunableSpec']>, pathName: string): NumericTunable | null {
  return spec.tunables.find((tunable) => tunable.path === pathName) ?? null;
}

function quantile(sortedValues: number[], q: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * q)));
  return sortedValues[index];
}

function cueMatchesDiagnosticEntry(cue: RepCueDiagnostic, entry: DiagnosticTuningEntry): boolean {
  if (!cue.metricKeys.includes(entry.metricKey)) return false;
  if (typeof cue.thresholdPath === 'string') {
    return cue.thresholdPath === entry.thresholdPath;
  }
  if (Array.isArray(cue.thresholdPath)) {
    return cue.thresholdPath.includes(entry.thresholdPath);
  }
  return true;
}

type DiagnosticMatchedRep = Pick<
  CaseEvaluation['matchedReps'][number],
  'expectedIssueIds' | 'predictedDiagnostics'
>;

function diagnosticMatchedRepsForCases(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  runtime: EvaluationRuntimeOptions = {},
): DiagnosticMatchedRep[] {
  const matchedReps: DiagnosticMatchedRep[] = [];
  for (const datasetCase of cases) {
    const prediction = replayCaseForOptimizer(definition, datasetCase, undefined, runtime);
    const evaluation = evaluateCase(datasetCase, prediction);
    matchedReps.push(...evaluation.matchedReps);
  }
  return matchedReps;
}

function valuesForDiagnosticEntry(
  matchedReps: DiagnosticMatchedRep[],
  entry: DiagnosticTuningEntry,
): { positives: number[]; negatives: number[]; skippedReason?: string } {
  const positives: number[] = [];
  const negatives: number[] = [];

  for (const rep of matchedReps) {
    const cue = rep.predictedDiagnostics?.cues[entry.issueId];
    const metric = rep.predictedDiagnostics?.metrics[entry.metricKey];
    if (!cue || !metric || !cue.eligible || !metric.eligible) continue;
    if (!cueMatchesDiagnosticEntry(cue, entry)) continue;
    if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) continue;
    if (
      entry.minEligibleSamples !== undefined &&
      (metric.sampleCount ?? cue.support ?? 0) < entry.minEligibleSamples
    ) {
      continue;
    }
    if (rep.expectedIssueIds.includes(entry.issueId)) positives.push(metric.value);
    else negatives.push(metric.value);
  }

  const minPositiveCases = entry.minPositiveCases ?? 2;
  const minNegativeCases = entry.minNegativeCases ?? 2;
  if (positives.length < minPositiveCases || negatives.length < minNegativeCases) {
    return {
      positives,
      negatives,
      skippedReason: `${entry.issueId} has insufficient eligible diagnostic support (${positives.length}/${minPositiveCases} positives, ${negatives.length}/${minNegativeCases} negatives).`,
    };
  }
  return { positives, negatives };
}

function thresholdCandidatesFromValues(
  positives: number[],
  negatives: number[],
  entry: DiagnosticTuningEntry,
  currentValue: number,
  tunable: NumericTunable,
): number[] {
  if (entry.direction !== 'above' && entry.direction !== 'below') return [];

  const rawValues = new Set<number>([
    currentValue - tunable.step,
    currentValue,
    currentValue + tunable.step,
  ]);
  const sortedPositive = [...positives].sort((a, b) => a - b);
  const sortedNegative = [...negatives].sort((a, b) => a - b);
  for (const q of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const positive = quantile(sortedPositive, q);
    const negative = quantile(sortedNegative, q);
    if (positive !== null) rawValues.add(positive);
    if (negative !== null) rawValues.add(negative);
  }

  const labelled = [
    ...positives.map((value) => ({ value, label: 'positive' as const })),
    ...negatives.map((value) => ({ value, label: 'negative' as const })),
  ].sort((a, b) => a.value - b.value);
  for (let i = 1; i < labelled.length; i++) {
    if (labelled[i - 1].label !== labelled[i].label) {
      rawValues.add((labelled[i - 1].value + labelled[i].value) / 2);
    }
  }

  return Array.from(rawValues)
    .map((value) => clampTunableValue(value, tunable))
    .filter((value) => value >= tunable.min && value <= tunable.max)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function generateDiagnosticCandidates(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  runtime: EvaluationRuntimeOptions = {},
  searchSpec?: TunableSpec,
): { candidates: InstrumentedCandidateConfig[]; fallbackReasons: string[] } {
  const spec = searchSpec ?? definition.tunableSpec;
  if (!definition.heuristicConfig || !spec?.diagnosticTuning || spec.diagnosticTuning.length === 0) {
    return { candidates: [], fallbackReasons: ['Exercise has no diagnosticTuning metadata.'] };
  }

  const candidates: InstrumentedCandidateConfig[] = [];
  const fallbackReasons: string[] = [];
  const matchedReps = runtime.profiler?.time('diagnosticExtraction', () =>
    diagnosticMatchedRepsForCases(definition, cases, runtime),
  ) ?? diagnosticMatchedRepsForCases(definition, cases, runtime);

  for (const entry of spec.diagnosticTuning) {
    const tunable = findTunable(spec, entry.thresholdPath);
    if (!tunable) {
      fallbackReasons.push(`${entry.issueId} threshold ${entry.thresholdPath} is not tunable.`);
      continue;
    }
    if (tunable.kind === 'scoring') {
      fallbackReasons.push(`${entry.issueId} threshold ${entry.thresholdPath} is score-only and is not tuned by the issue optimizer.`);
      continue;
    }
    const currentValue = getConfigValue(definition.heuristicConfig, entry.thresholdPath);
    if (typeof currentValue !== 'number' || !Number.isFinite(currentValue)) {
      fallbackReasons.push(`${entry.issueId} threshold ${entry.thresholdPath} is not numeric.`);
      continue;
    }
    const values = valuesForDiagnosticEntry(matchedReps, entry);
    if (values.skippedReason) {
      fallbackReasons.push(values.skippedReason);
      continue;
    }
    const thresholds = thresholdCandidatesFromValues(
      values.positives,
      values.negatives,
      entry,
      currentValue,
      tunable,
    );
    thresholds.forEach((threshold, index) => {
      if (threshold === currentValue) return;
      candidates.push({
        id: `diagnostic-${entry.issueId}-${index + 1}`,
        source: 'diagnostic',
        changedPaths: [entry.thresholdPath],
        config: setConfigValue(definition.heuristicConfig!, entry.thresholdPath, threshold),
      });
    });
  }

  return { candidates, fallbackReasons };
}

function combineDiagnosticCandidates(
  baseConfig: ExerciseHeuristicConfig,
  candidates: EvaluatedCandidateSummary[],
  limit: number,
): InstrumentedCandidateConfig[] {
  const byPath = new Map<string, EvaluatedCandidateSummary>();
  for (const candidate of candidates) {
    const pathName = candidate.changedPaths?.[0];
    if (!pathName) continue;
    const current = byPath.get(pathName);
    if (!current || candidate.score > current.score) {
      byPath.set(pathName, candidate);
    }
  }
  const singles = Array.from(byPath.values()).slice(0, Math.max(0, limit));
  const combined: InstrumentedCandidateConfig[] = [];
  for (let i = 0; i < singles.length; i++) {
    for (let j = i + 1; j < singles.length; j++) {
      let config = baseConfig;
      const changedPaths = [...(singles[i].changedPaths ?? []), ...(singles[j].changedPaths ?? [])];
      for (const candidate of [singles[i], singles[j]]) {
        for (const pathName of candidate.changedPaths ?? []) {
          config = setConfigValue(config, pathName, getConfigValue(candidate.config, pathName));
        }
      }
      combined.push({
        id: `diagnostic-combo-${i + 1}-${j + 1}`,
        source: 'diagnostic',
        changedPaths,
        config,
      });
    }
  }
  return combined.slice(0, limit);
}

function selectionCasesFor(
  trainCases: DatasetCase[],
  validationCases: DatasetCase[],
  allCases: DatasetCase[],
): { cases: DatasetCase[]; split: SelectionSplit } {
  if (validationCases.length > 0) return { cases: validationCases, split: 'validation' };
  if (trainCases.length > 0) return { cases: trainCases, split: 'train' };
  if (allCases.length > 0) return { cases: allCases, split: 'all' };
  return { cases: [], split: 'none' };
}

function evaluationForSplit<T>(
  split: SelectionSplit,
  evaluations: EvaluationBySplit<T>,
): T | null {
  if (split === 'validation') return evaluations.validation;
  if (split === 'train') return evaluations.train;
  if (split === 'all') return evaluations.all;
  return null;
}

function evaluateCandidatesCompact(
  definition: ExerciseDefinition,
  cases: DatasetCase[],
  candidates: InstrumentedCandidateConfig[],
  selectionMode: OptimizerSelectionMode = 'diagnostic',
  runtime: OptimizerRuntimeContext = {},
  checkpointArgs?: {
    phase: string;
    refinementRound: number;
    currentEvaluated: EvaluatedCandidateSummary[];
    rejectedCandidates: number;
    rejectedCandidateExamples: string[];
  },
): CandidateEvaluationBatch {
  const spec = runtime.tunableSpec ?? definition.tunableSpec;
  if (!spec) return { evaluated: [], rejectedCount: candidates.length, rejectedExamples: [] };

  const evaluated: EvaluatedCandidateSummary[] = [];
  let rejectedCount = 0;
  const rejectedExamples: string[] = [];

  for (const candidate of candidates) {
    const issues = validateCandidateConfig(candidate.config, spec, {
      validateConfig: definition.validateHeuristicConfig,
    });
    if (issues.length > 0) {
      rejectedCount += 1;
      if (rejectedExamples.length < 5) {
        rejectedExamples.push(`${candidate.id}: ${issues.join('; ')}`);
      }
      continue;
    }

    const cachedEvaluation = runtime.checkpoint?.getEvaluated(candidate);
    if (cachedEvaluation) {
      const rejection = buildRepCountStabilityEvent({
        runtime,
        definition,
        spec,
        candidate,
        evaluation: cachedEvaluation.evaluation,
      });
      if (rejection) {
        rejectedCount += 1;
        if (runtime.repCountStability) {
          recordRepCountStabilityRejection(runtime.repCountStability, rejection);
        }
        if (rejectedExamples.length < 5) rejectedExamples.push(`${candidate.id}: ${rejection.reason}`);
        continue;
      }
      evaluated.push(cachedEvaluation);
      continue;
    }

    const evaluation = evaluateCasesCompact(definition, cases, candidate.config, {
      replayCache: runtime.replayCache,
      profiler: runtime.profiler,
      profileSection: checkpointArgs?.phase === 'selection'
        ? 'validationEvaluation'
        : 'candidateTrainEvaluation',
    });
    if (evaluation) {
      const rejection = buildRepCountStabilityEvent({
        runtime,
        definition,
        spec,
        candidate,
        evaluation,
      });
      if (rejection) {
        rejectedCount += 1;
        if (runtime.repCountStability) {
          recordRepCountStabilityRejection(runtime.repCountStability, rejection);
        }
        if (rejectedExamples.length < 5) rejectedExamples.push(`${candidate.id}: ${rejection.reason}`);
        continue;
      }
      const summary = {
        id: candidate.id,
        source: candidate.source,
        changedPaths: candidate.changedPaths,
        config: candidate.config,
        evaluation,
        score: scoreEvaluationSummary(evaluation, selectionMode),
        legacyScore: scoreLegacyEvaluationSummary(evaluation),
        diagnosticScores: candidateDiagnosticScores(evaluation, selectionMode),
      };
      evaluated.push(summary);
      runtime.checkpoint?.recordEvaluated(summary);
      if (checkpointArgs && runtime.checkpoint?.shouldSave()) {
        runtime.checkpoint.save({
          phase: checkpointArgs.phase,
          refinementRound: checkpointArgs.refinementRound,
          evaluated: [...checkpointArgs.currentEvaluated, ...evaluated],
          rejectedCandidates: checkpointArgs.rejectedCandidates + rejectedCount,
          rejectedCandidateExamples: [
            ...checkpointArgs.rejectedCandidateExamples,
            ...rejectedExamples,
          ].slice(0, 5),
          repCountStability: repCountStabilityCheckpointSummary(runtime.repCountStability),
        });
      }
    }
  }

  return { evaluated, rejectedCount, rejectedExamples };
}

function dedupeCandidates(candidates: CandidateConfig[]): CandidateConfig[] {
  const seen = new Set<string>();
  const result: CandidateConfig[] = [];
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.config);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

export function searchExercise(
  definition: ExerciseDefinition,
  searchCases: DatasetCase[],
  searchOptions: OptimizerSearchOptions,
  selectionMode: OptimizerSelectionMode = 'diagnostic',
  runtime: OptimizerRuntimeContext = {},
): SearchResult {
  const fallbackOptions: Required<OptimizerSearchOptions> = {
    randomCandidates: searchOptions.randomCandidates ?? definition.tunableSpec?.search?.randomCandidates ?? 500,
    survivorCount: searchOptions.survivorCount ?? definition.tunableSpec?.search?.survivorCount ?? 12,
    refinementRounds:
      searchOptions.refinementRounds ?? definition.tunableSpec?.search?.refinementRounds ?? 2,
    seed: searchOptions.seed ?? definition.tunableSpec?.search?.seed ?? 1337,
  };
  const checkpointPath = runtime.checkpointPath
    ? path.resolve(process.cwd(), runtime.checkpointPath)
    : null;
  const tunableGroup = runtime.tunableGroup ?? 'all';
  const checkpoint = runtime.checkpoint ?? (
    checkpointPath
      ? new OptimizerCheckpointManager(
          checkpointPath,
          definition.name,
          selectionMode,
          tunableGroup,
          fallbackOptions,
          runtime.checkpointEvery ?? DEFAULT_CHECKPOINT_EVERY,
          runtime.resumeCheckpoint ?? false,
        )
      : undefined
  );
  const emptyResult = {
    candidates: [],
    specIssues: [],
    rejectedCandidates: 0,
    rejectedCandidateExamples: [],
    options: fallbackOptions,
    sourceBreakdown: emptySourceBreakdown(),
    ...(checkpointPath ? { checkpointPath } : {}),
  };
  if (!definition.heuristicConfig || !definition.tunableSpec || searchCases.length === 0) {
    return emptyResult;
  }

  const spec = optimizerSearchSpecForCases(definition.tunableSpec, searchCases, tunableGroup);
  const specIssues = validateTunableSpec(definition.heuristicConfig, spec);
  if (specIssues.length > 0) {
    return { ...emptyResult, specIssues };
  }
  const searchRepCountBaseline =
    tunableGroup === 'issue-feedback'
      ? runtime.repCountBaseline ?? evaluateCasesCompact(definition, searchCases, undefined, {
          replayCache: runtime.replayCache,
          profiler: runtime.profiler,
          profileSection: 'baselineTrainEvaluation',
        })
      : runtime.repCountBaseline;
  const searchRuntime = {
    ...runtime,
    checkpoint,
    tunableSpec: spec,
    repCountBaseline: searchRepCountBaseline,
    repCountBaselineSplit: runtime.repCountBaselineSplit ?? 'train',
  };

  let rejectedCandidates = 0;
  const rejectedCandidateExamples: string[] = [];

  const randomCandidates: InstrumentedCandidateConfig[] = (searchRuntime.profiler?.time('candidateGeneration', () =>
    generateRandomCandidates(
      definition.heuristicConfig!,
      spec,
      searchOptions,
    ),
  ) ?? generateRandomCandidates(
    definition.heuristicConfig,
    spec,
    searchOptions,
  )).map((candidate) => ({ ...candidate, source: 'random' }));

  const diagnostic = generateDiagnosticCandidates(definition, searchCases, {
    replayCache: searchRuntime.replayCache,
    profiler: searchRuntime.profiler,
  }, spec);
  checkpoint?.setGeneratedCandidates([...randomCandidates, ...diagnostic.candidates]);
  const randomBatch = evaluateCandidatesCompact(
    definition,
    searchCases,
    randomCandidates,
    selectionMode,
    searchRuntime,
    {
      phase: 'random',
      refinementRound: 0,
      currentEvaluated: [],
      rejectedCandidates,
      rejectedCandidateExamples,
    },
  );
  const diagnosticBatch = evaluateCandidatesCompact(
    definition,
    searchCases,
    diagnostic.candidates,
    selectionMode,
    searchRuntime,
    {
      phase: 'diagnostic',
      refinementRound: 0,
      currentEvaluated: randomBatch.evaluated,
      rejectedCandidates: rejectedCandidates + randomBatch.rejectedCount,
      rejectedCandidateExamples: [
        ...rejectedCandidateExamples,
        ...randomBatch.rejectedExamples,
      ].slice(0, 5),
    },
  );
  const diagnosticCombos = combineDiagnosticCandidates(
    definition.heuristicConfig,
    topEvaluatedCandidates(diagnosticBatch.evaluated, Math.min(fallbackOptions.survivorCount, 8)),
    Math.min(fallbackOptions.survivorCount, 8),
  );
  const diagnosticComboBatch = evaluateCandidatesCompact(
    definition,
    searchCases,
    diagnosticCombos,
    selectionMode,
    searchRuntime,
    {
      phase: 'diagnostic-combo',
      refinementRound: 0,
      currentEvaluated: [...randomBatch.evaluated, ...diagnosticBatch.evaluated],
      rejectedCandidates:
        rejectedCandidates + randomBatch.rejectedCount + diagnosticBatch.rejectedCount,
      rejectedCandidateExamples: [
        ...rejectedCandidateExamples,
        ...randomBatch.rejectedExamples,
        ...diagnosticBatch.rejectedExamples,
      ].slice(0, 5),
    },
  );
  let evaluated = sortEvaluatedCandidates([
    ...randomBatch.evaluated,
    ...diagnosticBatch.evaluated,
    ...diagnosticComboBatch.evaluated,
  ]);
  rejectedCandidates += randomBatch.rejectedCount;
  rejectedCandidates += diagnosticBatch.rejectedCount + diagnosticComboBatch.rejectedCount;
  rejectedCandidateExamples.push(...randomBatch.rejectedExamples);
  rejectedCandidateExamples.push(...diagnosticBatch.rejectedExamples, ...diagnosticComboBatch.rejectedExamples);

  for (let round = 1; round <= fallbackOptions.refinementRounds; round++) {
    const survivors = topEvaluatedCandidates(evaluated, fallbackOptions.survivorCount);
    if (survivors.length === 0) break;

    const refined: InstrumentedCandidateConfig[] = dedupeCandidates(
      survivors.flatMap((candidate) => refineCandidate(candidate, spec, round)),
    ).map((candidate) => ({
      ...candidate,
      source: 'refined',
      changedPaths: definition.heuristicConfig
        ? changedTunablePaths(definition.heuristicConfig, candidate.config, spec)
        : undefined,
    }));
    checkpoint?.setGeneratedCandidates([...randomCandidates, ...diagnostic.candidates, ...diagnosticCombos, ...refined]);
    const refinedBatch = evaluateCandidatesCompact(
      definition,
      searchCases,
      refined,
      selectionMode,
      searchRuntime,
      {
        phase: 'refined',
        refinementRound: round,
        currentEvaluated: evaluated,
        rejectedCandidates,
        rejectedCandidateExamples: rejectedCandidateExamples.slice(0, 5),
      },
    );
    rejectedCandidates += refinedBatch.rejectedCount;
    rejectedCandidateExamples.push(...refinedBatch.rejectedExamples);
    evaluated = sortEvaluatedCandidates([...survivors, ...refinedBatch.evaluated]);
  }

  const topCandidates = topEvaluatedCandidates(evaluated, fallbackOptions.survivorCount);
  checkpoint?.save({
    phase: 'complete',
    refinementRound: fallbackOptions.refinementRounds,
    evaluated,
    rejectedCandidates,
    rejectedCandidateExamples,
    repCountStability: repCountStabilityCheckpointSummary(searchRuntime.repCountStability),
  });
  return {
    candidates: topCandidates,
    specIssues,
    rejectedCandidates,
    rejectedCandidateExamples: rejectedCandidateExamples.slice(0, 5),
    options: fallbackOptions,
    sourceBreakdown: sourceBreakdownFor(topCandidates),
    ...(checkpointPath ? { checkpointPath } : {}),
    diagnosticFallbackReason:
      diagnostic.candidates.length === 0 && diagnostic.fallbackReasons.length > 0
        ? diagnostic.fallbackReasons.slice(0, 5).join(' ')
        : undefined,
  };
}

function writeTunedConfig(definition: ExerciseDefinition, config: ExerciseHeuristicConfig): string {
  if (!definition.tunedConfigPath) {
    throw new Error(`Exercise "${definition.name}" does not declare tunedConfigPath.`);
  }
  const targetPath = path.resolve(process.cwd(), definition.tunedConfigPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`);
  return targetPath;
}

function emptySearchResult(searchOptions: OptimizerSearchOptions): SearchResult {
  return {
    candidates: [],
    specIssues: [],
    rejectedCandidates: 0,
    rejectedCandidateExamples: [],
    options: {
      randomCandidates: searchOptions.randomCandidates ?? 500,
      survivorCount: searchOptions.survivorCount ?? 12,
      refinementRounds: searchOptions.refinementRounds ?? 2,
      seed: searchOptions.seed ?? 1337,
    },
    sourceBreakdown: emptySourceBreakdown(),
  };
}

function splitCountsFor(cases: DatasetCase[]): MinimumSplitCases {
  return {
    train: cases.filter((datasetCase) => datasetCase.label.split === 'train').length,
    validation: cases.filter((datasetCase) => datasetCase.label.split === 'validation').length,
    test: cases.filter((datasetCase) => datasetCase.label.split === 'test').length,
  };
}

export function minimumSplitGate(
  actual: MinimumSplitCases,
  required: MinimumSplitCases,
): MinimumSplitGate {
  const failures: string[] = [];
  if (actual.train < required.train) failures.push(`train ${actual.train}/${required.train}`);
  if (actual.validation < required.validation) {
    failures.push(`validation ${actual.validation}/${required.validation}`);
  }
  if (actual.test < required.test) failures.push(`test ${actual.test}/${required.test}`);

  return {
    actual,
    required,
    passed: failures.length === 0,
    reason:
      failures.length === 0
        ? 'Minimum split-size gate passed.'
        : `Rejected: minimum reviewed split counts not met (${failures.join(', ')}).`,
  };
}

export function optimizeExercise(
  exerciseName: string,
  exerciseCases: DatasetCase[],
  loadSummary: DatasetLoadSummary,
  options: OptimizerCommandOptions,
  runtime: OptimizerRuntimeContext = {},
): ExerciseOptimisationReport {
  const definition = ExerciseRegistry.get(exerciseName);
  if (!definition) throw new Error(`No registered exercise definition for "${exerciseName}"`);
  const selectionMode = options.selectionMode ?? 'diagnostic';
  const tunableGroup = effectiveTunableGroup(options);
  const shouldApply = options.apply ?? false;

  const trainCases = exerciseCases.filter((datasetCase) => datasetCase.label.split === 'train');
  const validationCases = exerciseCases.filter((datasetCase) => datasetCase.label.split === 'validation');
  const testCases = exerciseCases.filter((datasetCase) => datasetCase.label.split === 'test');
  const splitCounts = splitCountsFor(exerciseCases);
  const splitGate = minimumSplitGate(splitCounts, options.minCases);
  const selection = selectionCasesFor(trainCases, validationCases, exerciseCases);
  const searchSpec = definition.tunableSpec
    ? optimizerSearchSpecForCases(definition.tunableSpec, trainCases, tunableGroup)
    : null;
  const tunableEntries = tunableReportEntries(definition, searchSpec);
  const repCountStability = createRepCountStabilityTracker();

  const baseline = evaluateSplitCompact(definition, exerciseCases, undefined, {
    replayCache: runtime.replayCache,
    profiler: runtime.profiler,
    profileSection: 'baselineEvaluation',
    splitProfileSections: {
      train: 'baselineTrainEvaluation',
      validation: 'baselineValidationEvaluation',
      test: 'baselineTestEvaluation',
    },
  });
  const baselineSelection = evaluationForSplit(selection.split, baseline);
  const supportsConfigVariants = Boolean(definition.createVariant && definition.tunableSpec);
  const canAutoApply = Boolean(
    supportsConfigVariants &&
      definition.tunedConfigPath &&
      splitGate.passed &&
      shouldApply &&
      !options.dryRun,
  );

  const baseReport = {
    exerciseName,
    cases: exerciseCases.length,
    loadSummary,
    splitCounts,
    minimumSplitGate: splitGate,
    supportsConfigVariants,
    canAutoApply,
    applied: false,
    dryRun: options.dryRun,
    selectionMode,
    tunableGroup,
    reason: '',
    tunedConfigPath: definition.tunedConfigPath ?? null,
    selectionSplit: selection.split,
    activeTunables: tunableEntries.filter((tunable) => tunable.activeInSearch),
    frozenTunables: tunableEntries.filter((tunable) => !tunable.activeInSearch),
    search: emptySearchResult(options.search),
    baseline,
    baselineCaseDetails: options.includeCaseDetails
      ? evaluateSplitDetailed(definition, exerciseCases, undefined, {
          replayCache: runtime.replayCache,
          profiler: runtime.profiler,
          profileSection: 'baselineDetailedEvaluation',
        })
      : undefined,
    winner: {
      id: null,
      config: null,
      all: null,
      train: null,
      validation: null,
      test: null,
    },
    rankedSelection: [],
  } satisfies ExerciseOptimisationReport;

  if (!definition.createVariant || !definition.tunableSpec || !definition.tunedConfigPath || !baselineSelection) {
    return {
      ...baseReport,
      reason: 'Missing createVariant(), tunableSpec, tunedConfigPath, or selection cases.',
    };
  }

  if (trainCases.length === 0) {
    return {
      ...baseReport,
      reason: 'No reviewed train cases available for candidate discovery; no tuned config was written.',
    };
  }

  const search = searchExercise(definition, trainCases, options.search, selectionMode, {
    ...runtime,
    tunableGroup,
    repCountBaseline: baseline.train,
    repCountBaselineSplit: 'train',
    repCountStability,
  });
  if (search.specIssues.length > 0) {
    return {
      ...baseReport,
      search,
      reason: `Invalid tunable spec: ${search.specIssues.join(' ')}`,
    };
  }

  const baselineCandidate: EvaluatedCandidateSummary | null = definition.heuristicConfig
    ? {
        id: 'baseline',
        source: 'baseline',
        config: definition.heuristicConfig,
        evaluation: baselineSelection,
        score: scoreEvaluationSummary(baselineSelection, selectionMode),
        legacyScore: scoreLegacyEvaluationSummary(baselineSelection),
        diagnosticScores: candidateDiagnosticScores(baselineSelection, selectionMode, baselineSelection),
      }
    : null;
  const selectionBatch = evaluateCandidatesCompact(
    definition,
    selection.cases,
    search.candidates.map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      changedPaths: candidate.changedPaths,
      config: candidate.config,
    })),
    selectionMode,
    {
      replayCache: runtime.replayCache,
      profiler: runtime.profiler,
      tunableGroup,
      tunableSpec: searchSpec ?? undefined,
      repCountBaseline: baselineSelection,
      repCountBaselineSplit: selection.split,
      repCountStability,
    },
    {
      phase: 'selection',
      refinementRound: options.search.refinementRounds ?? definition.tunableSpec?.search?.refinementRounds ?? 0,
      currentEvaluated: [],
      rejectedCandidates: search.rejectedCandidates,
      rejectedCandidateExamples: search.rejectedCandidateExamples,
    },
  );
  const rankedSelectionRaw = sortEvaluatedCandidates(
    baselineCandidate ? [baselineCandidate, ...selectionBatch.evaluated] : selectionBatch.evaluated,
  );
  const searchCandidateById = new Map(search.candidates.map((candidate) => [candidate.id, candidate]));
  const rankedSelectionWithDiagnostics = rankedSelectionRaw.map((candidate) => {
    const trainEvaluation =
      candidate.id === 'baseline'
        ? baseline.train
        : searchCandidateById.get(candidate.id)?.evaluation ?? null;
    const validationEvaluation =
      selection.split === 'validation'
        ? candidate.evaluation
        : candidate.id === 'baseline'
          ? baseline.validation
          : null;
    const cleanFpGateDiagnostics = buildCleanFpGateDiagnostics({
      candidateTrain: trainEvaluation,
      candidateValidation: validationEvaluation,
      baselineTrain: baseline.train,
      baselineValidation: baseline.validation,
      enforced: Boolean(options.enforceCleanFpGates),
    });
    return {
      ...candidate,
      diagnosticScores: candidateDiagnosticScores(
        candidate.evaluation,
        selectionMode,
        baselineSelection,
        cleanFpGateDiagnostics,
      ),
      cleanFpGateDiagnostics,
      safetyMetrics: candidateSafetyMetrics({
        train: trainEvaluation,
        validation: validationEvaluation,
      }),
    };
  });
  const winnerPool = options.enforceCleanFpGates
    ? rankedSelectionWithDiagnostics.filter(
        (candidate) => candidate.id === 'baseline' || candidate.cleanFpGateDiagnostics.passed,
      )
    : rankedSelectionWithDiagnostics;
  const winner = winnerPool[0];

  const searchWithSelectionRejects = {
    ...search,
    rejectedCandidates: search.rejectedCandidates + selectionBatch.rejectedCount,
    rejectedCandidateExamples: [
      ...search.rejectedCandidateExamples,
      ...selectionBatch.rejectedExamples,
    ].slice(0, 5),
  };

  if (!winner) {
    return { ...baseReport, search: searchWithSelectionRejects, reason: 'No candidate could be evaluated.' };
  }

  const winnerEvaluations = evaluateSplitCompact(definition, exerciseCases, winner.config, {
    replayCache: runtime.replayCache,
    profiler: runtime.profiler,
    profileSection: 'winnerEvaluation',
    splitProfileSections: {
      train: 'winnerTrainEvaluation',
      validation: 'winnerValidationEvaluation',
      test: 'winnerTestEvaluation',
    },
  });
  const winnerSelection = evaluationForSplit(selection.split, winnerEvaluations);

  if (!winnerSelection) {
    return {
      ...baseReport,
      search: searchWithSelectionRejects,
      reason: 'Winning candidate has no selection evaluation.',
    };
  }

  let gate = splitGate.passed
    ? shouldApplyWinningConfig({
        baselineSelection,
        winnerSelection,
        baselineTest: baseline.test,
        winnerTest: winnerEvaluations.test,
        spec: definition.tunableSpec,
        selectionSplit: selection.split === 'none' ? undefined : selection.split,
        requireValidationSplit: true,
        requireTestSplit: true,
      })
    : { shouldApply: false, reason: splitGate.reason };

  if (
    gate.shouldApply &&
    winner.id !== 'baseline' &&
    definition.heuristicConfig &&
    selectionMode === 'diagnostic'
  ) {
    const supportGate = diagnosticSupportGate({
      definition,
      baselineConfig: definition.heuristicConfig,
      winnerConfig: winner.config,
      winnerSelection,
    });
    if (!supportGate.passed) {
      gate = { shouldApply: false, reason: supportGate.reason };
    }
  }

  let applied = false;
  let reason = gate.reason;
  if (gate.shouldApply && winner.id !== 'baseline' && (!shouldApply || options.dryRun)) {
    reason = `${gate.reason} Report-only mode; pass --apply to write tuned config JSON.`;
  } else if (gate.shouldApply && winner.id !== 'baseline') {
    const targetPath = writeTunedConfig(definition, winner.config);
    applied = true;
    reason = `${gate.reason} Wrote tuned config to ${targetPath}.`;
  }

  return {
    ...baseReport,
    canAutoApply,
    applied,
    reason,
    search: searchWithSelectionRejects,
    winner: {
      id: winner.id,
      config: winner.config,
      all: winnerEvaluations.all,
      train: winnerEvaluations.train,
      validation: winnerEvaluations.validation,
      test: winnerEvaluations.test,
    },
    winnerCaseDetails: options.includeCaseDetails
      ? evaluateSplitDetailed(definition, exerciseCases, winner.config, {
          replayCache: runtime.replayCache,
          profiler: runtime.profiler,
          profileSection: 'winnerDetailedEvaluation',
        })
      : undefined,
    rankedSelection: rankedSelectionWithDiagnostics.slice(0, 10),
    issueOnlySummary: buildIssueOnlyReportSummary({
      enabled: tunableGroup === 'issue-feedback',
      tracker: repCountStability,
      baseline,
      winner: winnerEvaluations,
    }),
  };
}

function reportPathFor(options: OptimizerCommandOptions, reportName: string): string {
  if (options.reportPath) return path.resolve(process.cwd(), options.reportPath);
  const datasetRoot = path.resolve(process.cwd(), options.datasetRoot ?? DATASET_ROOT);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(datasetRoot, 'reports', `${reportName}_${timestamp}.json`);
}

function writeOptimizationReport(
  reportName: string,
  report: unknown,
  options: OptimizerCommandOptions,
  profiler?: OptimizerProfiler,
): string {
  const targetPath = reportPathFor(options, reportName);
  if (!profiler) {
    writeJson(targetPath, report);
    return targetPath;
  }
  const start = performance.now();
  writeJson(targetPath, report);
  profiler.record('reportWriting', performance.now() - start);
  return targetPath;
}

function checkpointPathForExercise(
  options: OptimizerCommandOptions,
  exerciseName: string,
  exerciseCount: number,
): string | null {
  if (!options.checkpointPath) return null;
  const resolved = path.resolve(process.cwd(), options.checkpointPath);
  if (exerciseCount <= 1) return resolved;
  const ext = path.extname(resolved) || '.json';
  const base = ext ? resolved.slice(0, -ext.length) : resolved;
  return `${base}_${slugifyExerciseName(exerciseName)}${ext}`;
}

function resolveTargetDefinition(exerciseFilter: string | null): ExerciseDefinition | undefined {
  if (!exerciseFilter) return undefined;
  const definition = ExerciseRegistry.get(exerciseFilter);
  if (!definition) {
    throw new Error(
      `No registered exercise "${exerciseFilter}". Available exercises: ${ExerciseRegistry.list().join(', ')}`,
    );
  }
  return definition;
}

function discoverExercisesForCommand(options: OptimizerCommandOptions): {
  exercises: string[];
  targetDefinition: ExerciseDefinition | undefined;
} {
  const targetDefinition = resolveTargetDefinition(options.exerciseFilter);
  if (targetDefinition) return { exercises: [targetDefinition.name], targetDefinition };
  return {
    exercises: discoverReviewedDatasetExercises({ datasetRoot: options.datasetRoot }),
    targetDefinition: undefined,
  };
}

function stripEvaluationSummaryDiagnostics<T extends EvaluationSummary | null>(summary: T): T {
  if (!summary) return summary;
  const { diagnosticSummary: _diagnosticSummary, cleanSafety: _cleanSafety, ...rest } = summary;
  return rest as T;
}

function stripDatasetEvaluationDiagnostics<T extends DatasetEvaluation | null | undefined>(evaluation: T): T {
  if (!evaluation) return evaluation;
  const { diagnosticSummary: _diagnosticSummary, cases, ...rest } = evaluation;
  return {
    ...rest,
    cases: cases.map((caseEvaluation) => {
      const {
        diagnosticSummary: _caseDiagnosticSummary,
        reps,
        matchedReps: _matchedReps,
        missingExpectedReps: _missingExpectedReps,
        extraPredictedReps: _extraPredictedReps,
        ...caseRest
      } = caseEvaluation;
      const strippedReps = reps.map((rep) => {
        const { predictedDiagnostics: _predictedDiagnostics, ...repRest } = rep;
        return repRest;
      });
      return {
        ...caseRest,
        reps: strippedReps,
        matchedReps: strippedReps.filter((rep) => rep.matchStatus === 'matched'),
        missingExpectedReps: strippedReps.filter((rep) => rep.matchStatus === 'missing_expected'),
        extraPredictedReps: strippedReps.filter((rep) => rep.matchStatus === 'extra_predicted'),
      };
    }),
  } as T;
}

function stripSummarySplitDiagnostics(
  evaluations: EvaluationBySplit<EvaluationSummary>,
): EvaluationBySplit<EvaluationSummary> {
  return {
    all: stripEvaluationSummaryDiagnostics(evaluations.all),
    train: stripEvaluationSummaryDiagnostics(evaluations.train),
    validation: stripEvaluationSummaryDiagnostics(evaluations.validation),
    test: stripEvaluationSummaryDiagnostics(evaluations.test),
  };
}

function stripDetailedSplitDiagnostics(
  evaluations: EvaluationBySplit<DatasetEvaluation> | undefined,
): EvaluationBySplit<DatasetEvaluation> | undefined {
  if (!evaluations) return undefined;
  return {
    all: stripDatasetEvaluationDiagnostics(evaluations.all),
    train: stripDatasetEvaluationDiagnostics(evaluations.train),
    validation: stripDatasetEvaluationDiagnostics(evaluations.validation),
    test: stripDatasetEvaluationDiagnostics(evaluations.test),
  };
}

function stripExerciseReportDiagnostics(report: ExerciseOptimisationReport): ExerciseOptimisationReport {
  return {
    ...report,
    search: {
      ...report.search,
      candidates: report.search.candidates.map((candidate) => ({
        ...candidate,
        evaluation: stripEvaluationSummaryDiagnostics(candidate.evaluation),
        diagnosticScores: undefined,
      })),
    },
    baseline: stripSummarySplitDiagnostics(report.baseline),
    baselineCaseDetails: stripDetailedSplitDiagnostics(report.baselineCaseDetails),
    winner: {
      ...report.winner,
      all: stripEvaluationSummaryDiagnostics(report.winner.all),
      train: stripEvaluationSummaryDiagnostics(report.winner.train),
      validation: stripEvaluationSummaryDiagnostics(report.winner.validation),
      test: stripEvaluationSummaryDiagnostics(report.winner.test),
    },
    winnerCaseDetails: stripDetailedSplitDiagnostics(report.winnerCaseDetails),
    rankedSelection: report.rankedSelection.map((candidate) => ({
      ...candidate,
      evaluation: stripEvaluationSummaryDiagnostics(candidate.evaluation),
      diagnosticScores: undefined,
      cleanFpGateDiagnostics: undefined,
      safetyMetrics: undefined,
    })),
  };
}

export function runDatasetOptimize(options: OptimizerCommandOptions): {
  report: DatasetOptimisationReport;
  reportPath: string;
} {
  const profiler = options.profile ? new OptimizerProfiler() : undefined;
  const datasetRoot = path.resolve(process.cwd(), options.datasetRoot ?? DATASET_ROOT);
  const { exercises, targetDefinition } = discoverExercisesForCommand(options);
  const exerciseReports: ExerciseOptimisationReport[] = [];

  for (const exerciseName of exercises) {
    const { cases, summary } = profiler?.time('datasetLoading', () =>
      loadDatasetCasesWithSummary({
        datasetRoot,
        exerciseName,
        logSkippedDrafts: false,
        profile: {
          onLabelParsed: (event) => profiler.record('labelParsing', event.durationMs, event.bytes),
          onLandmarkParsed: (event) => profiler.record('landmarkJsonParsing', event.durationMs, event.bytes),
        },
      }),
    ) ?? loadDatasetCasesWithSummary({
      datasetRoot,
      exerciseName,
      logSkippedDrafts: false,
    });
    if (cases.length === 0) continue;
    const replayCache = options.useReplayCache === false
      ? undefined
      : buildOptimizerReplayCache(cases, profiler);
    exerciseReports.push(
      optimizeExercise(exerciseName, cases, summary, options, {
        replayCache,
        profiler,
        checkpointPath: checkpointPathForExercise(options, exerciseName, exercises.length),
        resumeCheckpoint: options.resumeCheckpoint,
        checkpointEvery: options.checkpointEvery,
      }),
    );
  }
  const reportExerciseReports =
    options.includeDiagnostics === false
      ? exerciseReports.map(stripExerciseReportDiagnostics)
      : exerciseReports;

  const report: DatasetOptimisationReport = {
    options,
    datasetRoot,
    discoveredExercises: exercises,
    confidenceGating: OPTIMIZER_CONFIDENCE_GATING,
    baseline: combineSummaries(reportExerciseReports.map((exercise) => exercise.baseline.all)),
    exercises: reportExerciseReports,
  };

  const reportName = targetDefinition
    ? `optimization_${slugifyExerciseName(targetDefinition.name)}`
    : 'optimization';
  const reportPath = writeOptimizationReport(reportName, report, options, profiler);
  if (profiler) {
    report.profile = profiler.report();
    writeJson(reportPath, report);
  }
  return { report, reportPath };
}

export function formatOptimizerConsoleSummary(args: {
  report: DatasetOptimisationReport;
  reportPath: string;
}): string {
  const lines: string[] = [];
  if (args.report.exercises.length === 0) {
    lines.push(
      `No reviewed label JSON files found under ${path.join(args.report.datasetRoot, 'labels')}.`,
    );
  } else if (args.report.baseline) {
    lines.push('Baseline metrics');
    lines.push(formatEvaluationSummary({ cases: [], ...args.report.baseline }));
  }

  for (const exercise of args.report.exercises) {
    lines.push('');
    lines.push(`${exercise.exerciseName}: ${exercise.reason}`);
    if (exercise.tunableGroup !== 'all') {
      lines.push(
        `Tunable group: ${exercise.tunableGroup} (${exercise.activeTunables.length} active, ${exercise.frozenTunables.length} frozen, ${exercise.issueOnlySummary?.repCountStabilityRejectCount ?? 0} rep-count stability reject(s), ${exercise.issueOnlySummary?.repCountStabilityWarningCount ?? 0} warning(s))`,
      );
    }
    lines.push(formatLoadSummary(exercise.loadSummary));
  }

  if (args.report.profile) {
    lines.push('');
    lines.push('Optimizer profile');
    const sections = Object.entries(args.report.profile.sections)
      .sort(([, a], [, b]) => b.totalMs - a.totalMs)
      .slice(0, 12);
    for (const [name, section] of sections) {
      const bytes = section.bytes ? `, ${(section.bytes / 1024 / 1024).toFixed(1)} MB` : '';
      lines.push(
        `${name}: ${section.totalMs.toFixed(1)}ms across ${section.count} call(s)${bytes}`,
      );
    }
  }

  lines.push(`Report: ${args.reportPath}`);
  return lines.join('\n');
}

export function runDatasetOptimizeCommand(
  argv: string[],
  logger: Pick<Console, 'log' | 'error'> = console,
): { report: DatasetOptimisationReport; reportPath: string } {
  const options = parseOptimizerCommandOptions(argv);
  const result = runDatasetOptimize(options);
  if (!options.silent) {
    logger.log(formatOptimizerConsoleSummary(result));
  }
  return result;
}
