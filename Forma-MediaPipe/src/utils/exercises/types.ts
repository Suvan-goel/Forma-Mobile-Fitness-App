/**
 * Exercise Framework — Core Types
 *
 * Standard interfaces for all exercises. CameraScreen interacts with
 * exercises only through these types + ExerciseRegistry.
 */

import type { Keypoint } from '../poseAnalysis';
import type {
  ExerciseQualityProfile,
  PoseQualitySnapshot,
  PoseQualityStatus,
  PoseQualityWarning,
} from './shared/poseQuality';
import type { PoseState } from '../pose/PoseState';
import type {
  CountabilityCandidate,
  ScoreabilityCandidate,
} from './shared/reliabilityInterpretation';
import type { CameraAnalysisStatus } from './shared/cameraAnalysisStatus';

// ============================================================================
// ExerciseState — the standard external state every exercise exposes
// ============================================================================

export interface ExerciseState {
  /** Rep counter (integer, starts at 0) */
  repCount: number;
  /** Last completed rep's result (score + messages), or null if no reps yet */
  lastRepResult: RepResult | null;
  /** Current visual feedback string, or null */
  feedback: string | null;
  /** Timestamp of last feedback in seconds (for auto-clear) */
  feedbackTimestamp: number | null;
  /** Debug info for on-screen overlay (exercise-specific shape, opaque to CameraScreen) */
  debugInfo: Record<string, unknown>;
  /** Rolling tracking quality for the current frame/window. */
  quality?: PoseQualitySnapshot;
  /**
   * True while this frame belongs to an active rep-quality scoring window.
   * Omitted by legacy definitions to preserve whole-window accumulation.
   */
  repQualityWindowActive?: boolean;
  /** Display-only live setup/view warnings for the camera tracking pill. */
  liveQualityWarnings?: PoseQualityWarning[];
  /** Display-only live camera-analysis status. Does not affect counting or scoring. */
  liveAnalysisStatus?: CameraAnalysisStatus | null;
  /** Opaque internal state — only the exercise's own update() reads/writes this */
  _internal: unknown;
}

export interface ExerciseFrameContext {
  worldKeypoints?: Keypoint[];
  imageKeypoints?: Keypoint[];
  primarySource: 'world' | 'image';
  timestampMs?: number;
  silentGapMs?: number;
  trackingInterrupted?: boolean;
  reacquisitionFrameIndex?: number;
  poseState?: PoseState;
  /**
   * Status/readiness UI work is display-only. Live callers can set this false
   * on ordinary analyzer frames so rep-counting FSMs keep their old hot-path
   * cadence while the camera pill refreshes at a lower rate.
   */
  cameraAnalysisStatusRequested?: boolean;
}

// ============================================================================
// RepResult — per-rep scoring and feedback
// ============================================================================

export interface RepResult {
  repIndex: number;
  score: number; // 0-100
  messages: string[]; // Visual feedback strings (may be empty for perfect rep)
  /**
   * Stable issue identifiers for dataset evaluation.
   * Runtime UI/TTS still uses messages; dataset tooling derives this when absent.
   */
  issueIds?: string[];
  /** 0-1 tracking confidence over the rep window. */
  confidence?: number;
  /** Tracking quality over the rep window. */
  qualityStatus?: PoseQualityStatus;
  /** Actionable tracking warnings that affected this rep. */
  qualityWarnings?: PoseQualityWarning[];
  /**
   * Exercise-specific scoring gate. A rep can be countable but unscorable when
   * the movement signal is visible and form-critical landmarks are not.
   */
  scorable?: boolean;
  /** Compact per-rep diagnostics for replay, dataset review, and optimisation. */
  diagnostics?: RepDiagnostics;
}

// ============================================================================
// ExerciseTTSConfig — TTS integration for an exercise
// ============================================================================

export interface ExerciseTTSConfig {
  /** Maps exact visual feedback strings to IssueType strings */
  feedbackToIssue: Record<string, string>;
  /** Optional exact feedback-string TTS pools for more exercise-specific voice cues */
  feedbackMessages?: Record<string, string[]>;
  /** Optional exact feedback-string priorities. Higher values are spoken first. */
  feedbackPriorities?: Record<string, number>;
  /** New IssueType definitions with priority and message pools (only for types not already registered) */
  issueDefinitions?: Array<{
    issueType: string;
    priority: number;
    messages: string[];
  }>;
}

export type ExerciseHeuristicConfigValue = number | string | boolean | null | object;

export interface ExerciseHeuristicConfig {
  [key: string]: ExerciseHeuristicConfigValue;
}

export interface NumericTunable {
  path: string;
  min: number;
  max: number;
  step: number;
  kind: 'fsm' | 'feedback' | 'scoring';
}

export type DiagnosticDirection = 'above' | 'below' | 'range' | 'outside_range';

export type DiagnosticUnit =
  | 'ratio'
  | 'percent'
  | 'degrees'
  | 'seconds'
  | 'milliseconds'
  | 'count'
  | 'pixels';

export interface RepMetricDiagnostic {
  key: string;
  value: number | null;
  unit?: DiagnosticUnit;
  eligible: boolean;
  label?: string;
  confidence?: number;
  sampleCount?: number;
  skippedReason?: string;
}

export interface RepCueDiagnostic {
  issueId: string;
  metricKeys: string[];
  triggered: boolean;
  eligible: boolean;
  direction: DiagnosticDirection;
  thresholdPath?: string | string[];
  thresholdValue?: number | Record<string, number>;
  margin?: number | null;
  support?: number;
  skippedReason?: string;
}

export type ViewQualityStatus =
  | 'side_confirmed'
  | 'frontish_confirmed'
  | 'front_confirmed'
  | 'oblique_confirmed'
  | 'view_unknown';

export interface RepViewQualityDiagnostic {
  status: ViewQualityStatus;
  sideConfirmed: boolean;
  /** Legacy side-only exercise bucket; kept for existing diagnostics consumers. */
  frontishConfirmed?: boolean;
  frontConfirmed?: boolean;
  obliqueConfirmed?: boolean;
  viewUnknown: boolean;
  averageSideViewConfidence?: number | null;
  minSideViewConfidence?: number | null;
  averageViewConfidence?: number | null;
  minViewConfidence?: number | null;
  sampleCount: number;
}

export interface RepReliabilityDiagnostic {
  countabilityCandidate: CountabilityCandidate;
  scoreabilityCandidate: ScoreabilityCandidate;
  usableChains: string[];
  weakChains: string[];
  safeCueFamilies: string[];
  unsafeCueFamilies: string[];
  reasons: string[];
  suppressedCueFamilies?: string[];
  suppressedIssueIds?: string[];
}

export interface RepViewCueGatingDiagnostic {
  viewBlockedCueFamilies: string[];
  poseStateBlockedCueFamilies: string[];
  finalSafeCueFamilies: string[];
  finalUnsafeCueFamilies: string[];
  finalScorableReason?: string;
  finalUnscorableReason?: string;
  sideViewGatePassed: boolean;
  frontViewGatePassed?: boolean;
  partialViewScoringAllowed: boolean;
}

export interface RepMlGroupedFeedbackDiagnostic {
  enabled: boolean;
  applied: boolean;
  policyId: string;
  modelRunId: string;
  featureSchemaVersion: string;
  latencyMs?: number;
  heuristicIssueIds?: string[];
  selectedIssueId?: string | null;
  selectedMessage?: string | null;
  issueIds: string[];
  messages: string[];
  warnings?: string[];
  featureMissingness?: Record<string, { missing: number; total: number }>;
  candidateProbabilityGroups?: string[];
  candidateGateBlockedGroups?: Array<{
    issueId: string;
    reason: string;
  }>;
  finalPredictedGroups?: string[];
  fallbackShadow?: {
    policyName: string;
    fallbackUserFacingFlagEnabled?: boolean;
    existingMlGroupedPredictions: string[];
    fallbackGroups: string[];
    fallbackGroupsWouldShow: string[];
    fallbackSelectedIssueId?: string | null;
    fallbackSelectedMessage?: string | null;
    policies: Array<{
      name: string;
      groupId: string;
      message: string;
      currentPolicyPredicted: boolean;
      wouldPredict: boolean;
      fallbackWouldPredict: boolean;
      evidenceCount: number;
      requiredEvidenceCount: number;
      contributingReps: number[];
      blockReasons: string[];
      evidence: Array<{
        repIndex: number;
        issueIds: string[];
        passes: boolean;
        blockReasons: string[];
        flexMargin?: number | null;
        shoulderWarnMargin?: number | null;
        tempoUpMargin?: number | null;
        torsoRawDelta?: number | null;
        torsoRobustDelta?: number | null;
        torsoSustained3Support?: number | null;
        torsoSustained5Support?: number | null;
        torsoProbability?: number | null;
        directEvidencePass?: boolean;
        sustainedEvidencePass?: boolean;
        rawSpikeBlocked?: boolean;
        cueSafetyPass: boolean;
        scorable: boolean;
        trackingClean: boolean;
      }>;
    }>;
  };
  predictions: Array<{
    issueId: string;
    message: string;
    policyName: string;
    probability?: number | null;
    threshold?: number | null;
    eligible: boolean;
    predicted: boolean;
    skippedReason?: string;
    probabilityGate?: {
      threshold: number | null;
      passes: boolean;
    };
    safety?: {
      scorable: boolean;
      heuristicScorable: {
        featureColumn: string;
        value: number | null;
        passes: boolean;
        missing: boolean;
      };
      diagnosticScorable: {
        featureColumn: string;
        value: number | null;
        passes: boolean;
        missing: boolean;
      };
      childEligibility: Array<{
        issueId: string;
        eligible: boolean;
        scorableIssue: {
          featureColumn: string;
          value: number | null;
          passes: boolean;
          missing: boolean;
        };
        cueEligible: {
          featureColumn: string;
          value: number | null;
          passes: boolean;
          missing: boolean;
        };
      }>;
    };
    directEvidence?: {
      featureColumn: string;
      value: number | null;
      threshold: number;
      passes: boolean;
      missing: boolean;
    };
    debugFeatures?: Record<string, number | null>;
    missingImportantFeatures?: string[];
    shadowAlternatives?: Array<{
      id: string;
      wouldPredict: boolean;
      reason: string;
      probabilityThreshold?: number;
      directEvidenceRequired?: boolean;
    }>;
    childPredictions?: Array<{
      issueId: string;
      policy: string;
      probability?: number | null;
      heuristicPresent: boolean;
      eligible: boolean;
      predicted: boolean;
      skippedReason?: string;
    }>;
  }>;
}

export interface RepDiagnostics {
  exerciseName: string;
  repIndex: number;
  view?: 'front' | 'side' | 'oblique' | 'unknown';
  selectedSide?: 'left' | 'right' | 'both' | 'unknown';
  scorable: boolean;
  viewQuality?: RepViewQualityDiagnostic;
  reliability?: RepReliabilityDiagnostic;
  viewCueGating?: RepViewCueGatingDiagnostic;
  mlGroupedFeedback?: RepMlGroupedFeedbackDiagnostic;
  metrics: Record<string, RepMetricDiagnostic>;
  cues: Record<string, RepCueDiagnostic>;
}

export interface DiagnosticTuningEntry {
  issueId: string;
  metricKey: string;
  thresholdPath: string;
  direction: DiagnosticDirection;
  minPositiveCases?: number;
  minNegativeCases?: number;
  minEligibleSamples?: number;
}

export interface TunableSpec {
  exerciseName: string;
  tunables: NumericTunable[];
  diagnosticTuning?: DiagnosticTuningEntry[];
  search?: {
    randomCandidates?: number;
    survivorCount?: number;
    refinementRounds?: number;
    seed?: number;
    applyGates?: {
      minValidationImprovement?: number;
      maxTestRepCountAccuracyRegression?: number;
      maxTestCleanFalsePositiveRegression?: number;
      maxTestViewAccuracyRegression?: number;
      maxTestScorableAccuracyRegression?: number;
      maxTestScoreInRangeRegression?: number;
      maxTestScoreMeanMissRegression?: number;
      minTestScoreEvaluatedReps?: number;
      minTestScoreInRangeRate?: number;
      maxTestScoreMeanAbsoluteMiss?: number;
    };
  };
}

export interface OptimizationResult {
  exerciseName: string;
  applied: boolean;
  reason: string;
  winningConfig: ExerciseHeuristicConfig | null;
  reportPath?: string;
}

// ============================================================================
// ExerciseDefinition — the contract every exercise must satisfy
// ============================================================================

export interface ExerciseDefinition {
  /** Display name (must match exerciseName in route params / exercise catalog) */
  name: string;

  /** Required camera view for this exercise */
  requiredView: 'front' | 'side' | 'any';

  /** Optional profile for confidence-aware pose quality checks. */
  qualityProfile?: ExerciseQualityProfile;

  /** Create a fresh state object for this exercise */
  createState: () => ExerciseState;

  /** Process one frame of landmarks. Returns updated state (may mutate _internal). */
  update: (keypoints: Keypoint[], currentState: ExerciseState, frameContext?: ExerciseFrameContext) => ExerciseState;

  /**
   * Default deterministic heuristic config for this exercise.
   * Current production definitions use their embedded defaults; dataset tooling
   * reads this metadata and future definitions can expose createVariant().
   */
  heuristicConfig?: ExerciseHeuristicConfig;

  /**
   * Optional test-time variant factory for offline optimisation.
   * The app should register and use the default definition; optimiser scripts
   * may call this to replay candidate threshold configs.
   */
  createVariant?: (config: ExerciseHeuristicConfig) => ExerciseDefinition;

  /** Declares which numeric config values the offline optimiser may tune. */
  tunableSpec?: TunableSpec;

  /** Optional guard for rejecting unsafe generated configs before replay. */
  validateHeuristicConfig?: (config: ExerciseHeuristicConfig) => string[];

  /** Repo-relative JSON file where the optimiser writes the active tuned config. */
  tunedConfigPath?: string;

  /**
   * Stable dataset issue ids keyed by exact visual feedback string.
   * If omitted, tooling derives ids from ttsConfig as "<exercise-slug>.<issueType>".
   */
  feedbackToIssueId?: Record<string, string>;

  /**
   * TTS config for this exercise.
   * Maps this exercise's visual feedback strings to IssueTypes and provides message pools.
   * Merged into the global TTS maps at registration time.
   */
  ttsConfig: ExerciseTTSConfig;

  /**
   * Set summary config for this exercise.
   * Maps visual feedback strings to improvement suggestions.
   * Merged into the global FEEDBACK_TO_IMPROVEMENT map at registration time.
   */
  summaryConfig: Record<string, string>;
}
