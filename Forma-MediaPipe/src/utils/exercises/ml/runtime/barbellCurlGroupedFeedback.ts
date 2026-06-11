import policyJson from './barbellCurlGroupedFeedbackPolicy.json';

export const BARBELL_CURL_GROUPED_FEEDBACK_FLAG = 'EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK';
export const BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG =
  'EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FALLBACK_FEEDBACK';

type FeatureVector = Record<string, number | null | undefined>;

type ModelKind = 'logistic_regression' | 'random_forest';

interface RuntimeModelBase {
  kind: ModelKind;
  target: string;
  modelKind: string;
  featureColumns: string[];
  imputerStatistics: Array<number | null>;
  trainingThreshold: number | null;
}

interface LogisticRuntimeModel extends RuntimeModelBase {
  kind: 'logistic_regression';
  scalerMean: Array<number | null>;
  scalerScale: Array<number | null>;
  coef: Array<number | null>;
  intercept: number | null;
}

interface RandomForestTree {
  childrenLeft: number[];
  childrenRight: number[];
  feature: number[];
  threshold: Array<number | null>;
  positiveProbability: Array<number | null>;
}

interface RandomForestRuntimeModel extends RuntimeModelBase {
  kind: 'random_forest';
  trees: RandomForestTree[];
}

type RuntimeModel = LogisticRuntimeModel | RandomForestRuntimeModel;

type FinePolicy =
  | 'heuristic-only'
  | 'disabled'
  | 'suppress-only'
  | 'suppress-only-high-precision'
  | 'ml-add-only-high-confidence'
  | 'hard-negative-safe-add'
  | 'suppress-and-add';

interface ChildPolicy {
  issueId: string;
  modelId: string;
  policy: FinePolicy;
  suppressThreshold: number | null;
  addThreshold: number | null;
}

interface RuntimeGroupBase {
  id: string;
  key: string;
  message: string;
  priority: number;
  policyName: string;
}

interface ThresholdedGroup extends RuntimeGroupBase {
  kind: 'thresholded_model';
  modelId: string;
  threshold: number;
  childIssueIds: string[];
}

interface DirectEvidenceGroup extends RuntimeGroupBase {
  kind: 'thresholded_model_with_direct_evidence';
  modelId: string;
  threshold: number;
  childIssueIds: string[];
  directEvidence: {
    featureColumn: string;
    threshold: number;
  };
}

interface CollapsedFineGroup extends RuntimeGroupBase {
  kind: 'collapsed_fine_policy';
  childPolicies: ChildPolicy[];
}

type RuntimeGroup = ThresholdedGroup | DirectEvidenceGroup | CollapsedFineGroup;

interface BarbellCurlGroupedPolicy {
  schemaVersion: number;
  policyId: string;
  exercise: string;
  modelRunId: string;
  featureSchemaVersion: string;
  groups: RuntimeGroup[];
  models: Record<string, RuntimeModel>;
}

export interface BarbellCurlGroupedChildPrediction {
  issueId: string;
  policy: FinePolicy;
  probability: number | null;
  heuristicPresent: boolean;
  eligible: boolean;
  predicted: boolean;
  skippedReason?: string;
}

export interface BarbellCurlGroupedBooleanGateDiagnostic {
  featureColumn: string;
  value: number | null;
  passes: boolean;
  missing: boolean;
}

export interface BarbellCurlGroupedNumericGateDiagnostic {
  featureColumn: string;
  value: number | null;
  threshold: number;
  passes: boolean;
  missing: boolean;
}

export interface BarbellCurlGroupedProbabilityGateDiagnostic {
  threshold: number | null;
  passes: boolean;
}

export interface BarbellCurlGroupedChildEligibilityDiagnostic {
  issueId: string;
  eligible: boolean;
  scorableIssue: BarbellCurlGroupedBooleanGateDiagnostic;
  cueEligible: BarbellCurlGroupedBooleanGateDiagnostic;
}

export interface BarbellCurlGroupedSafetyDiagnostic {
  scorable: boolean;
  heuristicScorable: BarbellCurlGroupedBooleanGateDiagnostic;
  diagnosticScorable: BarbellCurlGroupedBooleanGateDiagnostic;
  childEligibility: BarbellCurlGroupedChildEligibilityDiagnostic[];
}

export interface BarbellCurlGroupedShadowAlternativeDiagnostic {
  id: string;
  wouldPredict: boolean;
  reason: string;
  probabilityThreshold?: number;
  directEvidenceRequired?: boolean;
}

export interface BarbellCurlGroupedRepeatedFallbackEvidence {
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
}

export interface BarbellCurlGroupedFallbackShadowState {
  romIncompleteFlexEvidence: BarbellCurlGroupedRepeatedFallbackEvidence[];
  shoulderWarnEvidence: BarbellCurlGroupedRepeatedFallbackEvidence[];
  tempoUpEvidence: BarbellCurlGroupedRepeatedFallbackEvidence[];
  torsoSustainedEvidence: BarbellCurlGroupedRepeatedFallbackEvidence[];
}

export interface BarbellCurlGroupedFallbackPolicyDiagnostic {
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
  evidence: BarbellCurlGroupedRepeatedFallbackEvidence[];
}

export interface BarbellCurlGroupedFallbackShadowDiagnostic {
  policyName: 'barbellCurlGroupedWithRepeatedFallbackShadow';
  fallbackUserFacingFlagEnabled: boolean;
  existingMlGroupedPredictions: string[];
  fallbackGroups: string[];
  fallbackGroupsWouldShow: string[];
  fallbackSelectedIssueId: string | null;
  fallbackSelectedMessage: string | null;
  policies: BarbellCurlGroupedFallbackPolicyDiagnostic[];
}

export interface BarbellCurlGroupedPrediction {
  issueId: string;
  message: string;
  priority: number;
  policyName: string;
  probability: number | null;
  threshold: number | null;
  eligible: boolean;
  predicted: boolean;
  skippedReason?: string;
  childPredictions?: BarbellCurlGroupedChildPrediction[];
  probabilityGate?: BarbellCurlGroupedProbabilityGateDiagnostic;
  safety?: BarbellCurlGroupedSafetyDiagnostic;
  directEvidence?: BarbellCurlGroupedNumericGateDiagnostic;
  debugFeatures?: Record<string, number | null>;
  missingImportantFeatures?: string[];
  shadowAlternatives?: BarbellCurlGroupedShadowAlternativeDiagnostic[];
}

export interface BarbellCurlGroupedCandidateGateBlock {
  issueId: string;
  reason: string;
}

export interface BarbellCurlGroupedFeedbackResult {
  enabled: boolean;
  applied: boolean;
  policyId: string;
  modelRunId: string;
  featureSchemaVersion: string;
  latencyMs: number;
  heuristicIssueIds: string[];
  issueIds: string[];
  messages: string[];
  selectedIssueId: string | null;
  selectedMessage: string | null;
  predictions: BarbellCurlGroupedPrediction[];
  candidateProbabilityGroups: string[];
  candidateGateBlockedGroups: BarbellCurlGroupedCandidateGateBlock[];
  finalPredictedGroups: string[];
  fallbackShadow?: BarbellCurlGroupedFallbackShadowDiagnostic;
  featureMissingness: Record<string, { missing: number; total: number }>;
  warnings: string[];
}

export const BARBELL_CURL_GROUPED_FEEDBACK_POLICY = policyJson as unknown as BarbellCurlGroupedPolicy;

let loggedEnabled = false;

const ROM_GROUP_ID = 'barbell-curl.ROM_issue';
const TORSO_GROUP_ID = 'barbell-curl.torso_issue';
const SHOULDER_GROUP_ID = 'barbell-curl.shoulder_issue';
const TEMPO_GROUP_ID = 'barbell-curl.tempo_issue';

const IMPORTANT_DEBUG_FEATURES_BY_GROUP: Record<string, string[]> = {
  [ROM_GROUP_ID]: [
    'feature__diagnostic.metric.romratio.value',
    'feature__diagnostic.metric.mincurlratio.value',
    'feature__diagnostic.metric.returnmaxcurlratio.value',
    'feature__diagnostic.metric.rawleftmincurlratio.value',
    'feature__diagnostic.metric.rawrightmincurlratio.value',
    'feature__diagnostic.cue.barbell_curl_incomplete_rom.margin',
    'feature__diagnostic.cue.barbell_curl_incomplete_rom.eligible',
    'feature__diagnostic.cue.barbell_curl_incomplete_flex.margin',
    'feature__diagnostic.cue.barbell_curl_incomplete_extend.margin',
    'feature__v2.rom.flexion.selected_arm.top_shortfall_from_0_19.p75',
    'feature__v2.rom.extension.selected_arm.bottom_shortfall_from_0_92.p75',
    'feature__v2.rom.selected_arm.curl_ratio.min',
    'feature__v2.rom.selected_arm.curl_ratio.max',
    'feature__v2.rom.bilateral.curl_ratio.mean',
    'feature__v2.view.front_support_ratio',
    'feature__v2.view.support_ratio',
  ],
  [TORSO_GROUP_ID]: [
    'feature__diagnostic.metric.torsodeltaraw.value',
    'feature__diagnostic.metric.torsodelta.value',
    'feature__diagnostic.cue.barbell_curl_torso_warn.margin',
    'feature__diagnostic.cue.barbell_curl_torso_fail.margin',
    'feature__diagnostic.cue.barbell_curl_torso_warn.eligible',
    'feature__diagnostic.cue.barbell_curl_torso_fail.eligible',
    'feature__v2.torso.robust_abs_delta_p90_minus_p10',
    'feature__v2.torso.full.sustained_lean_above_3deg.support_ratio',
    'feature__v2.torso.full.sustained_lean_above_5deg.support_ratio',
    'feature__v2.torso.raw_delta.max',
    'feature__v2.torso.raw_delta.range',
    'feature__v2.reliability.safe_cue_family_count',
    'feature__v2.reliability.unsafe_cue_family_count',
    'feature__v2.view.front_support_ratio',
    'feature__v2.view.support_ratio',
  ],
};

function flagSetting(): { source: string; value: string } | null {
  if (typeof process === 'undefined') return null;
  const publicValue = process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG];
  if (publicValue !== undefined) return { source: BARBELL_CURL_GROUPED_FEEDBACK_FLAG, value: publicValue };
  const legacyValue = process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
  if (legacyValue !== undefined) return { source: 'ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK', value: legacyValue };
  return null;
}

function flagValue(): string | undefined {
  return flagSetting()?.value;
}

function fallbackFlagValue(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env[BARBELL_CURL_GROUPED_FALLBACK_FEEDBACK_FLAG];
}

function explicitEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

export function isBarbellCurlGroupedFeedbackEnabled(): boolean {
  return explicitEnabled(flagValue());
}

export function isBarbellCurlGroupedFallbackFeedbackEnabled(): boolean {
  return isBarbellCurlGroupedFeedbackEnabled() && explicitEnabled(fallbackFlagValue());
}

export function logBarbellCurlGroupedFeedbackEnabledOnce(): void {
  if (loggedEnabled || !isBarbellCurlGroupedFeedbackEnabled()) return;
  loggedEnabled = true;
  if (
    typeof __DEV__ === 'undefined' ||
    !__DEV__ ||
    (typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID))
  ) {
    return;
  }
  const setting = flagSetting();
  const source = setting ? `${setting.source}=${setting.value}` : 'disabled';
  console.info(
    `[BarbellCurlMLFeedback] ${source}; using ${BARBELL_CURL_GROUPED_FEEDBACK_POLICY.policyId}`,
  );
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function featureValue(features: FeatureVector, column: string): number | null {
  return finiteNumber(features[column]);
}

function imputedFeatureVector(model: RuntimeModel, features: FeatureVector): number[] {
  const values: number[] = [];
  model.featureColumns.forEach((column, index) => {
    const statistic = finiteNumber(model.imputerStatistics[index]);
    if (statistic === null) return;
    const raw = featureValue(features, column);
    values.push(raw ?? statistic);
  });
  return values;
}

function predictLogistic(model: LogisticRuntimeModel, features: FeatureVector): number {
  const values = imputedFeatureVector(model, features);
  let score = finiteNumber(model.intercept) ?? 0;
  for (let index = 0; index < values.length; index++) {
    const mean = finiteNumber(model.scalerMean[index]) ?? 0;
    const scale = finiteNumber(model.scalerScale[index]) ?? 1;
    const coef = finiteNumber(model.coef[index]) ?? 0;
    const normalized = scale === 0 ? 0 : (values[index] - mean) / scale;
    score += normalized * coef;
  }
  return sigmoid(score);
}

function predictTree(tree: RandomForestTree, values: number[]): number {
  let node = 0;
  while (true) {
    const left = tree.childrenLeft[node];
    const right = tree.childrenRight[node];
    if (left < 0 || right < 0) return finiteNumber(tree.positiveProbability[node]) ?? 0;
    const featureIndex = tree.feature[node];
    const threshold = finiteNumber(tree.threshold[node]);
    if (featureIndex < 0 || threshold === null) return finiteNumber(tree.positiveProbability[node]) ?? 0;
    node = values[featureIndex] <= threshold ? left : right;
  }
}

function predictRandomForest(model: RandomForestRuntimeModel, features: FeatureVector): number {
  if (model.trees.length === 0) return 0;
  const values = imputedFeatureVector(model, features);
  const total = model.trees.reduce((sum, tree) => sum + predictTree(tree, values), 0);
  return total / model.trees.length;
}

function predictModel(model: RuntimeModel, features: FeatureVector): number {
  return model.kind === 'logistic_regression'
    ? predictLogistic(model, features)
    : predictRandomForest(model, features);
}

function missingFeatureSummary(model: RuntimeModel, features: FeatureVector): { missing: number; total: number } {
  let missing = 0;
  let total = 0;
  model.featureColumns.forEach((column, index) => {
    if (finiteNumber(model.imputerStatistics[index]) === null) return;
    total++;
    if (featureValue(features, column) === null) missing++;
  });
  return { missing, total };
}

function safeIssuePart(issueId: string): string {
  return issueId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isTruthyFeature(features: FeatureVector, column: string): boolean {
  return (featureValue(features, column) ?? 0) >= 0.5;
}

function booleanGate(features: FeatureVector, column: string): BarbellCurlGroupedBooleanGateDiagnostic {
  const value = featureValue(features, column);
  return {
    featureColumn: column,
    value,
    passes: (value ?? 0) >= 0.5,
    missing: value === null,
  };
}

function numericGate(
  features: FeatureVector,
  column: string,
  threshold: number,
): BarbellCurlGroupedNumericGateDiagnostic {
  const value = featureValue(features, column);
  return {
    featureColumn: column,
    value,
    threshold,
    passes: value !== null && value >= threshold,
    missing: value === null,
  };
}

function scorable(features: FeatureVector): boolean {
  const heuristicScorable = featureValue(features, 'feature__heuristic.scorable');
  const diagnosticScorable = featureValue(features, 'feature__diagnostic.scorable');
  if (heuristicScorable !== null && heuristicScorable < 0.5) return false;
  if (diagnosticScorable !== null && diagnosticScorable < 0.5) return false;
  return heuristicScorable !== null || diagnosticScorable !== null;
}

function issueAddEligible(features: FeatureVector, issueId: string): boolean {
  const suffix = safeIssuePart(issueId);
  return scorable(features)
    && isTruthyFeature(features, `feature__scorable.issue.${suffix}`)
    && isTruthyFeature(features, `feature__diagnostic.cue.${suffix}.eligible`);
}

function heuristicIssuePresent(
  features: FeatureVector,
  heuristicIssueIds: Set<string>,
  issueId: string,
): boolean {
  const suffix = safeIssuePart(issueId);
  return heuristicIssueIds.has(issueId) || isTruthyFeature(features, `feature__heuristic.issue.${suffix}`);
}

function issueCueTriggeredOrPositiveMargin(features: FeatureVector, issueId: string): boolean {
  const suffix = safeIssuePart(issueId);
  return isTruthyFeature(features, `feature__diagnostic.cue.${suffix}.triggered`)
    || (featureValue(features, `feature__diagnostic.cue.${suffix}.margin`) ?? 0) > 0;
}

function noTrackingInterruption(features: FeatureVector): boolean {
  return (featureValue(features, 'feature__v2.tempo.full.tracking_gap_count') ?? 0) <= 0
    && (featureValue(features, 'feature__v2.tempo.full.max_tracking_gap_ms') ?? 0) <= 0;
}

function cueReliabilitySafe(features: FeatureVector): boolean {
  return (featureValue(features, 'feature__v2.reliability.unsafe_cue_family_count') ?? 0) <= 0;
}

function conservativeIssueAddEligible(features: FeatureVector, issueId: string): boolean {
  return issueAddEligible(features, issueId)
    && noTrackingInterruption(features)
    && cueReliabilitySafe(features);
}

function trackingContaminationClean(features: FeatureVector): boolean {
  return (featureValue(features, 'feature__v2.tempo.full.max_tracking_gap_ms') ?? 0) <= 250;
}

function torsoSustainedEvidence(features: FeatureVector): boolean {
  const sustained3 = featureValue(features, 'feature__v2.torso.full.sustained_lean_above_3deg.support_ratio') ?? 0;
  const sustained5 = featureValue(features, 'feature__v2.torso.full.sustained_lean_above_5deg.support_ratio') ?? 0;
  return sustained3 >= 0.05 || sustained5 >= 0.05;
}

function torsoRobustAndSustainedEvidence(features: FeatureVector): boolean {
  const robustDelta = featureValue(features, 'feature__v2.torso.robust_abs_delta_p90_minus_p10') ?? 0;
  return robustDelta >= 1.2 && torsoSustainedEvidence(features);
}

function createFallbackEvidenceStore(): BarbellCurlGroupedRepeatedFallbackEvidence[] {
  return [];
}

export function createBarbellCurlGroupedFallbackShadowState(): BarbellCurlGroupedFallbackShadowState {
  return {
    romIncompleteFlexEvidence: createFallbackEvidenceStore(),
    shoulderWarnEvidence: createFallbackEvidenceStore(),
    tempoUpEvidence: createFallbackEvidenceStore(),
    torsoSustainedEvidence: createFallbackEvidenceStore(),
  };
}

function upsertEvidence(
  evidence: BarbellCurlGroupedRepeatedFallbackEvidence[],
  next: BarbellCurlGroupedRepeatedFallbackEvidence,
): void {
  const existingIndex = evidence.findIndex((entry) => entry.repIndex === next.repIndex);
  if (existingIndex >= 0) evidence[existingIndex] = next;
  else evidence.push(next);
  evidence.sort((a, b) => a.repIndex - b.repIndex);
  if (evidence.length > 50) evidence.splice(0, evidence.length - 50);
}

function repeatedEvidence(
  evidence: BarbellCurlGroupedRepeatedFallbackEvidence[],
): BarbellCurlGroupedRepeatedFallbackEvidence[] {
  return evidence.filter((entry) => entry.passes);
}

function finiteFeature(features: FeatureVector, column: string): number | null {
  return featureValue(features, column);
}

function romRepeatedEvidenceForRep(
  repIndex: number,
  features: FeatureVector,
  heuristicIssueIds: Set<string>,
): BarbellCurlGroupedRepeatedFallbackEvidence {
  const issueId = 'barbell-curl.incomplete_flex';
  const flexMargin = finiteFeature(features, 'feature__diagnostic.cue.barbell_curl_incomplete_flex.margin');
  const heuristicPresent = heuristicIssuePresent(features, heuristicIssueIds, issueId);
  const scorableRep = scorable(features);
  const cueSafetyPass = issueAddEligible(features, issueId) && cueReliabilitySafe(features);
  const trackingClean = trackingContaminationClean(features);
  const marginPass = flexMargin === null || flexMargin >= 0.04;
  const blockReasons = [
    ...(!heuristicPresent ? ['missing_heuristic_incomplete_flex'] : []),
    ...(!scorableRep ? ['rep_not_scorable'] : []),
    ...(!cueSafetyPass ? ['rom_cue_not_safe_or_eligible'] : []),
    ...(!trackingClean ? ['tracking_interruption_contamination'] : []),
    ...(!marginPass ? ['flex_margin_below_0_04'] : []),
  ];
  return {
    repIndex,
    issueIds: heuristicPresent ? [issueId] : [],
    passes: blockReasons.length === 0,
    blockReasons,
    flexMargin,
    cueSafetyPass,
    scorable: scorableRep,
    trackingClean,
  };
}

function shoulderWarnRepeatedEvidenceForRep(
  repIndex: number,
  features: FeatureVector,
  heuristicIssueIds: Set<string>,
): BarbellCurlGroupedRepeatedFallbackEvidence {
  const warnIssue = 'barbell-curl.shoulder_warn';
  const failIssue = 'barbell-curl.shoulder_fail';
  const shoulderWarnMargin = finiteFeature(features, 'feature__diagnostic.cue.barbell_curl_shoulder_warn.margin');
  const hasWarn = heuristicIssuePresent(features, heuristicIssueIds, warnIssue);
  const hasFail = heuristicIssuePresent(features, heuristicIssueIds, failIssue);
  const scorableRep = scorable(features);
  const cueSafetyPass =
    (issueAddEligible(features, warnIssue) || issueAddEligible(features, failIssue)) &&
    cueReliabilitySafe(features);
  const trackingClean = trackingContaminationClean(features);
  // Margin units are degrees above SHOULDER_WARN; require a meaningful exceedance
  // so marginal threshold crossings cannot accumulate into a fallback.
  const marginPass = shoulderWarnMargin === null || shoulderWarnMargin >= 4;
  const blockReasons = [
    ...(!hasWarn && !hasFail ? ['missing_heuristic_shoulder_warn_or_fail'] : []),
    ...(!scorableRep ? ['rep_not_scorable'] : []),
    ...(!cueSafetyPass ? ['shoulder_cue_not_safe_or_eligible'] : []),
    ...(!trackingClean ? ['tracking_interruption_contamination'] : []),
    ...(!marginPass ? ['shoulder_warn_margin_below_4deg'] : []),
  ];
  return {
    repIndex,
    issueIds: [hasWarn ? warnIssue : null, hasFail ? failIssue : null].filter(Boolean) as string[],
    passes: blockReasons.length === 0,
    blockReasons,
    shoulderWarnMargin,
    cueSafetyPass,
    scorable: scorableRep,
    trackingClean,
  };
}

function tempoUpRepeatedEvidenceForRep(
  repIndex: number,
  features: FeatureVector,
  heuristicIssueIds: Set<string>,
): BarbellCurlGroupedRepeatedFallbackEvidence {
  const issueId = 'barbell-curl.tempo_up';
  const tempoUpMargin = finiteFeature(features, 'feature__diagnostic.cue.barbell_curl_tempo_up.margin');
  const heuristicPresent = heuristicIssuePresent(features, heuristicIssueIds, issueId);
  const scorableRep = scorable(features);
  const cueSafetyPass = issueAddEligible(features, issueId) && cueReliabilitySafe(features);
  const trackingClean = trackingContaminationClean(features);
  // Margin units are seconds faster than TEMPO_UP_MIN; tracking gaps can fake a
  // fast concentric, so tracking cleanliness plus a real margin are both required.
  const marginPass = tempoUpMargin === null || tempoUpMargin >= 0.02;
  const blockReasons = [
    ...(!heuristicPresent ? ['missing_heuristic_tempo_up'] : []),
    ...(!scorableRep ? ['rep_not_scorable'] : []),
    ...(!cueSafetyPass ? ['tempo_cue_not_safe_or_eligible'] : []),
    ...(!trackingClean ? ['tracking_interruption_contamination'] : []),
    ...(!marginPass ? ['tempo_up_margin_below_0_02s'] : []),
  ];
  return {
    repIndex,
    issueIds: heuristicPresent ? [issueId] : [],
    passes: blockReasons.length === 0,
    blockReasons,
    tempoUpMargin,
    cueSafetyPass,
    scorable: scorableRep,
    trackingClean,
  };
}

function torsoRepeatedEvidenceForRep(
  repIndex: number,
  features: FeatureVector,
  heuristicIssueIds: Set<string>,
  torsoPrediction: BarbellCurlGroupedPrediction | undefined,
): BarbellCurlGroupedRepeatedFallbackEvidence {
  const warnIssue = 'barbell-curl.torso_warn';
  const failIssue = 'barbell-curl.torso_fail';
  const hasWarn = heuristicIssuePresent(features, heuristicIssueIds, warnIssue);
  const hasFail = heuristicIssuePresent(features, heuristicIssueIds, failIssue);
  const scorableRep = scorable(features);
  const cueSafetyPass =
    (issueAddEligible(features, warnIssue) || issueAddEligible(features, failIssue)) &&
    cueReliabilitySafe(features);
  const trackingClean = trackingContaminationClean(features);
  const torsoRawDelta = finiteFeature(features, 'feature__diagnostic.metric.torsodeltaraw.value');
  const torsoRobustDelta = finiteFeature(features, 'feature__v2.torso.robust_abs_delta_p90_minus_p10');
  const torsoSustained3Support = finiteFeature(
    features,
    'feature__v2.torso.full.sustained_lean_above_3deg.support_ratio',
  );
  const torsoSustained5Support = finiteFeature(
    features,
    'feature__v2.torso.full.sustained_lean_above_5deg.support_ratio',
  );
  const directEvidencePass = torsoPrediction?.directEvidence?.passes ?? false;
  const sustainedEvidencePass = torsoSustainedEvidence(features);
  const rawSpikeBlocked = directEvidencePass && !sustainedEvidencePass;
  const blockReasons = [
    ...(!hasWarn && !hasFail ? ['missing_heuristic_torso_warn_or_fail'] : []),
    ...(!scorableRep ? ['rep_not_scorable'] : []),
    ...(!cueSafetyPass ? ['torso_cue_not_safe_or_eligible'] : []),
    ...(!trackingClean ? ['tracking_interruption_contamination'] : []),
    ...(!directEvidencePass ? ['direct_torso_evidence_failed'] : []),
    ...(!sustainedEvidencePass ? ['sustained_torso_evidence_failed'] : []),
    ...(rawSpikeBlocked ? ['raw_spike_contamination_signature'] : []),
  ];
  return {
    repIndex,
    issueIds: [hasWarn ? warnIssue : null, hasFail ? failIssue : null].filter(Boolean) as string[],
    passes: blockReasons.length === 0,
    blockReasons,
    torsoRawDelta,
    torsoRobustDelta,
    torsoSustained3Support,
    torsoSustained5Support,
    torsoProbability: torsoPrediction?.probability ?? null,
    directEvidencePass,
    sustainedEvidencePass,
    rawSpikeBlocked,
    cueSafetyPass,
    scorable: scorableRep,
    trackingClean,
  };
}

function groupedEligible(features: FeatureVector, issueIds: string[]): boolean {
  return scorable(features) && issueIds.some((issueId) => issueAddEligible(features, issueId));
}

function groupChildIssueIds(group: RuntimeGroup): string[] {
  return group.kind === 'collapsed_fine_policy'
    ? group.childPolicies.map((child) => child.issueId)
    : group.childIssueIds;
}

function issueEligibilityDetails(
  features: FeatureVector,
  issueId: string,
): BarbellCurlGroupedChildEligibilityDiagnostic {
  const suffix = safeIssuePart(issueId);
  const scorableIssue = booleanGate(features, `feature__scorable.issue.${suffix}`);
  const cueEligible = booleanGate(features, `feature__diagnostic.cue.${suffix}.eligible`);
  return {
    issueId,
    eligible: scorable(features) && scorableIssue.passes && cueEligible.passes,
    scorableIssue,
    cueEligible,
  };
}

function groupSafetyDetails(
  features: FeatureVector,
  issueIds: string[],
): BarbellCurlGroupedSafetyDiagnostic {
  return {
    scorable: scorable(features),
    heuristicScorable: booleanGate(features, 'feature__heuristic.scorable'),
    diagnosticScorable: booleanGate(features, 'feature__diagnostic.scorable'),
    childEligibility: issueIds.map((issueId) => issueEligibilityDetails(features, issueId)),
  };
}

function debugFeatureSnapshot(groupId: string, features: FeatureVector): {
  debugFeatures?: Record<string, number | null>;
  missingImportantFeatures?: string[];
} {
  const columns = IMPORTANT_DEBUG_FEATURES_BY_GROUP[groupId];
  if (!columns) return {};
  const debugFeatures = Object.fromEntries(
    columns.map((column) => [column, featureValue(features, column)]),
  );
  return {
    debugFeatures,
    missingImportantFeatures: columns.filter((column) => debugFeatures[column] === null),
  };
}

function shadowAlternativesForGroup(
  group: RuntimeGroup,
  features: FeatureVector,
  heuristicIssueIds: Set<string>,
  probability: number | null,
  eligible: boolean,
  directEvidence?: BarbellCurlGroupedNumericGateDiagnostic,
): BarbellCurlGroupedShadowAlternativeDiagnostic[] | undefined {
  if (probability === null) return undefined;
  if (group.id === ROM_GROUP_ID) {
    const relaxedThreshold = 0.75;
    const incompleteFlex = 'barbell-curl.incomplete_flex';
    const incompleteExtend = 'barbell-curl.incomplete_extend';
    const incompleteRom = 'barbell-curl.incomplete_rom';
    const hasIncompleteFlex = heuristicIssuePresent(features, heuristicIssueIds, incompleteFlex);
    const hasIncompleteExtend = heuristicIssuePresent(features, heuristicIssueIds, incompleteExtend);
    const hasIncompleteRom = heuristicIssuePresent(features, heuristicIssueIds, incompleteRom);
    const flexEligible = issueAddEligible(features, incompleteFlex);
    const flexSafe = conservativeIssueAddEligible(features, incompleteFlex);
    const extendSafe = conservativeIssueAddEligible(features, incompleteExtend);
    const romSafe = conservativeIssueAddEligible(features, incompleteRom);
    const flexEndpointEvidence = issueCueTriggeredOrPositiveMargin(features, incompleteFlex);
    return [
      {
        id: 'rom_threshold_0_75',
        probabilityThreshold: relaxedThreshold,
        wouldPredict: probability >= relaxedThreshold && eligible,
        reason: eligible ? 'relaxed_probability_threshold' : 'blocked_by_safety_or_cue_gate',
      },
      {
        id: 'rom_heuristic_incomplete_flex_fallback',
        wouldPredict: hasIncompleteFlex && flexEligible,
        reason: !flexEligible
          ? 'blocked_by_incomplete_flex_safety_or_cue_gate'
          : hasIncompleteFlex
            ? 'heuristic_incomplete_flex_and_cue_gate_pass'
            : 'blocked_by_missing_heuristic_incomplete_flex',
      },
      {
        id: 'rom_heuristic_incomplete_flex_safe_fallback',
        wouldPredict: hasIncompleteFlex && flexSafe,
        reason: !flexSafe
          ? 'blocked_by_incomplete_flex_conservative_safety_gate'
          : hasIncompleteFlex
            ? 'heuristic_incomplete_flex_and_conservative_safety_pass'
            : 'blocked_by_missing_heuristic_incomplete_flex',
      },
      {
        id: 'rom_heuristic_incomplete_flex_endpoint_fallback',
        directEvidenceRequired: true,
        wouldPredict: hasIncompleteFlex && flexSafe && flexEndpointEvidence,
        reason: !flexSafe
          ? 'blocked_by_incomplete_flex_conservative_safety_gate'
          : !flexEndpointEvidence
            ? 'blocked_by_incomplete_flex_endpoint_evidence'
            : hasIncompleteFlex
              ? 'heuristic_incomplete_flex_and_endpoint_evidence_pass'
              : 'blocked_by_missing_heuristic_incomplete_flex',
      },
      {
        id: 'rom_heuristic_flex_extend_fallback',
        wouldPredict: (hasIncompleteFlex && flexSafe) || (hasIncompleteExtend && extendSafe),
        reason:
          (hasIncompleteFlex && flexSafe) || (hasIncompleteExtend && extendSafe)
            ? 'heuristic_flex_or_extend_and_conservative_safety_pass'
            : 'blocked_by_missing_safe_heuristic_flex_or_extend',
      },
      {
        id: 'rom_heuristic_flex_extend_rom_fallback',
        wouldPredict:
          (hasIncompleteFlex && flexSafe) ||
          (hasIncompleteExtend && extendSafe) ||
          (hasIncompleteRom && romSafe),
        reason:
          (hasIncompleteFlex && flexSafe) ||
          (hasIncompleteExtend && extendSafe) ||
          (hasIncompleteRom && romSafe)
            ? 'heuristic_rom_family_and_conservative_safety_pass'
            : 'blocked_by_missing_safe_heuristic_rom_family_issue',
      },
    ];
  }
  if (group.id === TORSO_GROUP_ID) {
    const relaxedThreshold = 0.55;
    const hasHeuristicTorsoWarn = heuristicIssuePresent(features, heuristicIssueIds, 'barbell-curl.torso_warn');
    const hasHeuristicTorsoFail = heuristicIssuePresent(features, heuristicIssueIds, 'barbell-curl.torso_fail');
    const hasAnyHeuristicTorso =
      hasHeuristicTorsoWarn ||
      hasHeuristicTorsoFail ||
      heuristicIssueIds.has(TORSO_GROUP_ID) ||
      isTruthyFeature(features, 'feature__heuristic.issue.barbell_curl_torso_issue');
    const hasFailHeuristic = hasHeuristicTorsoFail;
    const hasWarnOrFailHeuristic = hasHeuristicTorsoWarn || hasFailHeuristic;
    const fallbackEligible = eligible && (directEvidence?.passes ?? false);
    const sustainedEvidence = torsoSustainedEvidence(features);
    const robustAndSustainedEvidence = torsoRobustAndSustainedEvidence(features);
    const rawSpikeContamination = fallbackEligible && !sustainedEvidence;
    const directEvidenceAndRobust = fallbackEligible && robustAndSustainedEvidence;
    return [
      {
        id: 'torso_probability_only',
        probabilityThreshold: group.kind === 'thresholded_model_with_direct_evidence' ? group.threshold : undefined,
        directEvidenceRequired: false,
        wouldPredict:
          group.kind === 'thresholded_model_with_direct_evidence' &&
          probability >= group.threshold &&
          eligible,
        reason: eligible ? 'runtime_threshold_without_direct_evidence_gate' : 'blocked_by_safety_or_cue_gate',
      },
      {
        id: 'torso_heuristic_direct_evidence_fallback',
        directEvidenceRequired: true,
        wouldPredict: fallbackEligible && hasAnyHeuristicTorso,
        reason: !eligible
          ? 'blocked_by_safety_or_cue_gate'
          : !(directEvidence?.passes ?? false)
            ? 'blocked_by_direct_evidence_gate'
            : hasAnyHeuristicTorso
              ? 'heuristic_torso_and_direct_evidence_pass'
              : 'blocked_by_missing_heuristic_torso_issue',
      },
      {
        id: 'torso_fail_no_raw_spike_fallback',
        directEvidenceRequired: true,
        wouldPredict: fallbackEligible && hasFailHeuristic && !rawSpikeContamination,
        reason: !eligible
          ? 'blocked_by_safety_or_cue_gate'
          : !(directEvidence?.passes ?? false)
            ? 'blocked_by_direct_evidence_gate'
            : rawSpikeContamination
              ? 'blocked_by_raw_spike_contamination_signature'
              : hasFailHeuristic
                ? 'heuristic_torso_fail_and_no_raw_spike_signature'
                : 'blocked_by_missing_heuristic_torso_fail',
      },
      {
        id: 'torso_fail_rf05_robust_fallback',
        probabilityThreshold: 0.5,
        directEvidenceRequired: true,
        wouldPredict: hasFailHeuristic && directEvidenceAndRobust && probability >= 0.5,
        reason: !eligible
          ? 'blocked_by_safety_or_cue_gate'
          : !(directEvidence?.passes ?? false)
            ? 'blocked_by_direct_evidence_gate'
            : !robustAndSustainedEvidence
              ? 'blocked_by_weak_robust_or_sustained_torso_evidence'
              : probability < 0.5
                ? 'blocked_by_torso_probability_below_0_5'
                : hasFailHeuristic
                  ? 'heuristic_torso_fail_rf05_and_robust_evidence_pass'
                  : 'blocked_by_missing_heuristic_torso_fail',
      },
      {
        id: 'torso_fail_only_fallback',
        directEvidenceRequired: true,
        wouldPredict: fallbackEligible && hasFailHeuristic,
        reason: !eligible
          ? 'blocked_by_safety_or_cue_gate'
          : !(directEvidence?.passes ?? false)
            ? 'blocked_by_direct_evidence_gate'
            : hasFailHeuristic
              ? 'heuristic_torso_fail_and_direct_evidence_pass'
              : 'blocked_by_missing_heuristic_torso_fail',
      },
      {
        id: 'torso_warn_fail_fallback',
        directEvidenceRequired: true,
        wouldPredict: fallbackEligible && hasWarnOrFailHeuristic,
        reason: !eligible
          ? 'blocked_by_safety_or_cue_gate'
          : !(directEvidence?.passes ?? false)
            ? 'blocked_by_direct_evidence_gate'
            : hasWarnOrFailHeuristic
              ? 'heuristic_torso_warn_or_fail_and_direct_evidence_pass'
              : 'blocked_by_missing_heuristic_torso_warn_or_fail',
      },
      {
        id: 'torso_threshold_0_55_with_direct_evidence',
        probabilityThreshold: relaxedThreshold,
        directEvidenceRequired: true,
        wouldPredict: probability >= relaxedThreshold && eligible && (directEvidence?.passes ?? false),
        reason: directEvidence?.passes
          ? (eligible ? 'relaxed_probability_threshold' : 'blocked_by_safety_or_cue_gate')
          : 'blocked_by_direct_evidence_gate',
      },
      {
        id: 'torso_direct_evidence_only',
        directEvidenceRequired: true,
        wouldPredict: eligible && (directEvidence?.passes ?? false),
        reason: directEvidence?.passes ? 'direct_evidence_passes' : 'blocked_by_direct_evidence_gate',
      },
    ];
  }
  return undefined;
}

function modelById(modelId: string): RuntimeModel | null {
  return BARBELL_CURL_GROUPED_FEEDBACK_POLICY.models[modelId] ?? null;
}

function evaluateFinePolicy(
  child: ChildPolicy,
  features: FeatureVector,
  heuristicIssueIds: Set<string>,
): BarbellCurlGroupedChildPrediction {
  const heuristicPresent = heuristicIssueIds.has(child.issueId);
  if (child.policy === 'disabled') {
    return {
      issueId: child.issueId,
      policy: child.policy,
      probability: null,
      heuristicPresent,
      eligible: false,
      predicted: false,
      skippedReason: 'policy_disabled',
    };
  }

  const model = modelById(child.modelId);
  const probability = model ? predictModel(model, features) : null;
  const eligible = issueAddEligible(features, child.issueId);
  let predicted = false;
  let skippedReason: string | undefined;

  if (!scorable(features)) {
    skippedReason = 'rep_not_scorable';
  } else if (child.policy === 'heuristic-only') {
    predicted = heuristicPresent;
  } else if (!model || probability === null) {
    skippedReason = 'model_unavailable';
  } else if (child.policy === 'suppress-only' || child.policy === 'suppress-only-high-precision') {
    const threshold = child.suppressThreshold ?? 0.25;
    predicted = heuristicPresent && probability > threshold;
  } else if (child.policy === 'ml-add-only-high-confidence' || child.policy === 'hard-negative-safe-add') {
    const threshold = child.addThreshold ?? 0.75;
    predicted = heuristicPresent || (probability >= threshold && eligible);
    if (!heuristicPresent && probability >= threshold && !eligible) skippedReason = 'cue_not_eligible';
  } else if (child.policy === 'suppress-and-add') {
    const suppress = child.suppressThreshold ?? 0.25;
    const add = child.addThreshold ?? 0.75;
    predicted = heuristicPresent ? probability > suppress : probability >= add && eligible;
    if (!heuristicPresent && probability >= add && !eligible) skippedReason = 'cue_not_eligible';
  }

  return {
    issueId: child.issueId,
    policy: child.policy,
    probability,
    heuristicPresent,
    eligible,
    predicted,
    ...(skippedReason ? { skippedReason } : {}),
  };
}

function evaluateGroup(
  group: RuntimeGroup,
  features: FeatureVector,
  heuristicIssueIds: Set<string>,
): BarbellCurlGroupedPrediction {
  if (!scorable(features)) {
    return {
      issueId: group.id,
      message: group.message,
      priority: group.priority,
      policyName: group.policyName,
      probability: null,
      threshold: null,
      eligible: false,
      predicted: false,
      skippedReason: 'rep_not_scorable',
      safety: groupSafetyDetails(features, groupChildIssueIds(group)),
      ...debugFeatureSnapshot(group.id, features),
    };
  }

  if (group.kind === 'collapsed_fine_policy') {
    const childPredictions = group.childPolicies.map((child) => evaluateFinePolicy(child, features, heuristicIssueIds));
    const predicted = childPredictions.some((child) => child.predicted);
    const eligible = childPredictions.some((child) => child.eligible || child.heuristicPresent);
    return {
      issueId: group.id,
      message: group.message,
      priority: group.priority,
      policyName: group.policyName,
      probability: childPredictions.reduce<number | null>((max, child) => {
        if (child.probability === null) return max;
        return max === null ? child.probability : Math.max(max, child.probability);
      }, null),
      threshold: null,
      eligible,
      predicted,
      childPredictions,
      safety: groupSafetyDetails(features, group.childPolicies.map((child) => child.issueId)),
      ...(!eligible ? { skippedReason: 'no_child_cue_eligible' } : {}),
    };
  }

  const model = modelById(group.modelId);
  if (!model) {
    return {
      issueId: group.id,
      message: group.message,
      priority: group.priority,
      policyName: group.policyName,
      probability: null,
      threshold: group.threshold,
      eligible: false,
      predicted: false,
      skippedReason: 'model_unavailable',
      safety: groupSafetyDetails(features, group.childIssueIds),
      ...debugFeatureSnapshot(group.id, features),
    };
  }

  const probability = predictModel(model, features);
  const safety = groupSafetyDetails(features, group.childIssueIds);
  const eligible = groupedEligible(features, group.childIssueIds);
  const probabilityGate = {
    threshold: group.threshold,
    passes: probability >= group.threshold,
  };
  let directEvidence: BarbellCurlGroupedNumericGateDiagnostic | undefined;
  let predicted = probabilityGate.passes && eligible;
  let skippedReason: string | undefined;

  if (!eligible) skippedReason = 'no_child_cue_eligible';
  else if (!probabilityGate.passes) skippedReason = 'probability_below_threshold';
  if (group.kind === 'thresholded_model_with_direct_evidence') {
    directEvidence = numericGate(features, group.directEvidence.featureColumn, group.directEvidence.threshold);
    predicted = predicted && directEvidence.passes;
    if (probabilityGate.passes && eligible && !directEvidence.passes) {
      skippedReason = 'direct_evidence_gate_failed';
    }
  }
  const shadowAlternatives = shadowAlternativesForGroup(
    group,
    features,
    heuristicIssueIds,
    probability,
    eligible,
    directEvidence,
  );

  return {
    issueId: group.id,
    message: group.message,
    priority: group.priority,
    policyName: group.policyName,
    probability,
    threshold: group.threshold,
    eligible,
    predicted,
    probabilityGate,
    safety,
    ...(directEvidence ? { directEvidence } : {}),
    ...debugFeatureSnapshot(group.id, features),
    ...(shadowAlternatives ? { shadowAlternatives } : {}),
    ...(skippedReason ? { skippedReason } : {}),
  };
}

function groupPriority(predictions: BarbellCurlGroupedPrediction[], groupId: string): number {
  return predictions.find((prediction) => prediction.issueId === groupId)?.priority ?? 0;
}

function groupMessage(predictions: BarbellCurlGroupedPrediction[], groupId: string): string {
  return predictions.find((prediction) => prediction.issueId === groupId)?.message ?? '';
}

function fallbackPolicyDiagnostic(input: {
  name: string;
  groupId: string;
  message: string;
  currentPolicyPredicted: boolean;
  currentRepIndex: number;
  evidence: BarbellCurlGroupedRepeatedFallbackEvidence[];
  requiredEvidenceCount: number;
}): BarbellCurlGroupedFallbackPolicyDiagnostic {
  const contributingEvidence = repeatedEvidence(input.evidence);
  const currentEvidence = input.evidence.find((entry) => entry.repIndex === input.currentRepIndex);
  const currentRepContributes = currentEvidence?.passes ?? false;
  const contributingReps = contributingEvidence.map((entry) => entry.repIndex);
  const fallbackWouldPredict =
    !input.currentPolicyPredicted &&
    currentRepContributes &&
    contributingEvidence.length >= input.requiredEvidenceCount;
  const blockReasons = input.currentPolicyPredicted
    ? ['current_ml_group_already_predicted']
    : fallbackWouldPredict
      ? []
      : [
          ...(!currentRepContributes ? ['current_rep_does_not_contribute_evidence'] : []),
          `requires_${input.requiredEvidenceCount}_contributing_reps`,
          ...Array.from(new Set(currentEvidence?.blockReasons ?? input.evidence.flatMap((entry) => entry.blockReasons))),
        ];
  return {
    name: input.name,
    groupId: input.groupId,
    message: input.message,
    currentPolicyPredicted: input.currentPolicyPredicted,
    wouldPredict: input.currentPolicyPredicted || fallbackWouldPredict,
    fallbackWouldPredict,
    evidenceCount: contributingEvidence.length,
    requiredEvidenceCount: input.requiredEvidenceCount,
    contributingReps,
    blockReasons,
    evidence: input.evidence.slice(-8),
  };
}

function computeFallbackShadow(input: {
  repIndex: number;
  features: FeatureVector;
  heuristicIssueIds: Set<string>;
  predictions: BarbellCurlGroupedPrediction[];
  finalPredictedGroups: string[];
  state: BarbellCurlGroupedFallbackShadowState;
}): BarbellCurlGroupedFallbackShadowDiagnostic {
  const romPrediction = input.predictions.find((prediction) => prediction.issueId === ROM_GROUP_ID);
  const torsoPrediction = input.predictions.find((prediction) => prediction.issueId === TORSO_GROUP_ID);
  const shoulderPrediction = input.predictions.find((prediction) => prediction.issueId === SHOULDER_GROUP_ID);
  const tempoPrediction = input.predictions.find((prediction) => prediction.issueId === TEMPO_GROUP_ID);
  upsertEvidence(
    input.state.romIncompleteFlexEvidence,
    romRepeatedEvidenceForRep(input.repIndex, input.features, input.heuristicIssueIds),
  );
  upsertEvidence(
    input.state.shoulderWarnEvidence,
    shoulderWarnRepeatedEvidenceForRep(input.repIndex, input.features, input.heuristicIssueIds),
  );
  upsertEvidence(
    input.state.tempoUpEvidence,
    tempoUpRepeatedEvidenceForRep(input.repIndex, input.features, input.heuristicIssueIds),
  );
  upsertEvidence(
    input.state.torsoSustainedEvidence,
    torsoRepeatedEvidenceForRep(input.repIndex, input.features, input.heuristicIssueIds, torsoPrediction),
  );

  const policies = [
    fallbackPolicyDiagnostic({
      name: 'rom_repeated_incomplete_flex_fallback',
      groupId: ROM_GROUP_ID,
      message: romPrediction?.message ?? 'Use a fuller range of motion.',
      currentPolicyPredicted: romPrediction?.predicted ?? false,
      currentRepIndex: input.repIndex,
      evidence: input.state.romIncompleteFlexEvidence,
      requiredEvidenceCount: 2,
    }),
    fallbackPolicyDiagnostic({
      name: 'shoulder_warn_repeated_fallback',
      groupId: SHOULDER_GROUP_ID,
      message: shoulderPrediction?.message ?? 'Avoid using your shoulders to lift the bar.',
      currentPolicyPredicted: shoulderPrediction?.predicted ?? false,
      currentRepIndex: input.repIndex,
      evidence: input.state.shoulderWarnEvidence,
      requiredEvidenceCount: 2,
    }),
    fallbackPolicyDiagnostic({
      name: 'tempo_up_repeated_fallback',
      groupId: TEMPO_GROUP_ID,
      message: tempoPrediction?.message ?? 'Control the speed of the rep.',
      currentPolicyPredicted: tempoPrediction?.predicted ?? false,
      currentRepIndex: input.repIndex,
      evidence: input.state.tempoUpEvidence,
      requiredEvidenceCount: 2,
    }),
    fallbackPolicyDiagnostic({
      name: 'torso_repeated_sustained_fallback',
      groupId: TORSO_GROUP_ID,
      message: torsoPrediction?.message ?? 'Keep your torso still.',
      currentPolicyPredicted: torsoPrediction?.predicted ?? false,
      currentRepIndex: input.repIndex,
      evidence: input.state.torsoSustainedEvidence,
      requiredEvidenceCount: 2,
    }),
  ];
  const fallbackGroups = policies
    .filter((policy) => policy.fallbackWouldPredict)
    .map((policy) => policy.groupId);
  const fallbackGroupsWouldShow = Array.from(new Set([...input.finalPredictedGroups, ...fallbackGroups]));
  // Selection rule: fallbacks fill silence, they never override the main policy.
  // A fallback-only group can only be selected when the main policy predicted
  // nothing; among groups of the same tier, policy priority decides. Without
  // this, a high-priority fallback (ROM, priority 80) fired by co-expressed
  // endpoint evidence steals the message from a correct main-policy torso or
  // shoulder prediction — measured as +16 wrong names on the labeled dataset.
  const mainPredicted = new Set(input.finalPredictedGroups);
  const fallbackSelectedIssueId = fallbackGroupsWouldShow
    .slice()
    .sort((a, b) => {
      const tierA = mainPredicted.has(a) ? 1 : 0;
      const tierB = mainPredicted.has(b) ? 1 : 0;
      if (tierA !== tierB) return tierB - tierA;
      return groupPriority(input.predictions, b) - groupPriority(input.predictions, a);
    })[0] ?? null;

  return {
    policyName: 'barbellCurlGroupedWithRepeatedFallbackShadow',
    fallbackUserFacingFlagEnabled: isBarbellCurlGroupedFallbackFeedbackEnabled(),
    existingMlGroupedPredictions: input.finalPredictedGroups,
    fallbackGroups,
    fallbackGroupsWouldShow,
    fallbackSelectedIssueId,
    fallbackSelectedMessage: fallbackSelectedIssueId ? groupMessage(input.predictions, fallbackSelectedIssueId) : null,
    policies,
  };
}

export function predictBarbellCurlGroupedFeedback(input: {
  features: FeatureVector;
  heuristicIssueIds: string[];
  repIndex?: number;
  fallbackShadowState?: BarbellCurlGroupedFallbackShadowState;
}): BarbellCurlGroupedFeedbackResult {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const warnings: string[] = [];
  const heuristicIssueIds = new Set(input.heuristicIssueIds);
  const featureMissingness = Object.fromEntries(
    Object.entries(BARBELL_CURL_GROUPED_FEEDBACK_POLICY.models).map(([modelId, model]) => [
      modelId,
      missingFeatureSummary(model, input.features),
    ]),
  );
  const predictions = BARBELL_CURL_GROUPED_FEEDBACK_POLICY.groups.map((group) => {
    try {
      return evaluateGroup(group, input.features, heuristicIssueIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${group.id}: ${message}`);
      return {
        issueId: group.id,
        message: group.message,
        priority: group.priority,
        policyName: group.policyName,
        probability: null,
        threshold: null,
        eligible: false,
        predicted: false,
        skippedReason: 'runtime_error',
      };
    }
  });

  const selected = predictions
    .filter((prediction) => prediction.predicted)
    .sort((a, b) => b.priority - a.priority);
  const top = selected[0] ?? null;
  const candidateProbabilityGroups = predictions
    .filter((prediction) => prediction.probabilityGate?.passes)
    .map((prediction) => prediction.issueId);
  const candidateGateBlockedGroups = predictions
    .filter((prediction) => prediction.probabilityGate?.passes && !prediction.predicted)
    .map((prediction) => ({
      issueId: prediction.issueId,
      reason: prediction.skippedReason ?? 'blocked',
    }));
  const finalPredictedGroups = selected.map((prediction) => prediction.issueId);
  const fallbackShadow = input.fallbackShadowState
    ? computeFallbackShadow({
        repIndex: input.repIndex ?? 0,
        features: input.features,
        heuristicIssueIds,
        predictions,
        finalPredictedGroups,
        state: input.fallbackShadowState,
      })
    : undefined;

  // When the fallback user-facing flag is on (requires the base grouped flag too),
  // promote the repeated-evidence fallback groups into the user-facing output.
  // fallbackGroupsWouldShow is the union of main-policy predictions and fallback
  // groups; fallbackSelectedIssueId is already priority-sorted. With the flag off,
  // fallbacks stay shadow-only and output is unchanged.
  const fallbackUserFacing = fallbackShadow?.fallbackUserFacingFlagEnabled === true;
  const userFacingIssueIds = fallbackUserFacing && fallbackShadow
    ? fallbackShadow.fallbackGroupsWouldShow
    : selected.map((prediction) => prediction.issueId);
  const userFacingSelectedIssueId = fallbackUserFacing && fallbackShadow
    ? fallbackShadow.fallbackSelectedIssueId
    : top?.issueId ?? null;
  const userFacingSelectedMessage = fallbackUserFacing && fallbackShadow
    ? fallbackShadow.fallbackSelectedMessage
    : top?.message ?? null;

  return {
    enabled: true,
    applied: true,
    policyId: BARBELL_CURL_GROUPED_FEEDBACK_POLICY.policyId,
    modelRunId: BARBELL_CURL_GROUPED_FEEDBACK_POLICY.modelRunId,
    featureSchemaVersion: BARBELL_CURL_GROUPED_FEEDBACK_POLICY.featureSchemaVersion,
    latencyMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt,
    heuristicIssueIds: input.heuristicIssueIds,
    issueIds: userFacingIssueIds,
    messages: userFacingSelectedMessage ? [userFacingSelectedMessage] : [],
    selectedIssueId: userFacingSelectedIssueId,
    selectedMessage: userFacingSelectedMessage,
    predictions,
    candidateProbabilityGroups,
    candidateGateBlockedGroups,
    finalPredictedGroups,
    ...(fallbackShadow ? { fallbackShadow } : {}),
    featureMissingness,
    warnings,
  };
}
