import policyJson from './barbellCurlGroupedFeedbackPolicy.json';

export const BARBELL_CURL_GROUPED_FEEDBACK_FLAG = 'EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK';

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
  featureMissingness: Record<string, { missing: number; total: number }>;
  warnings: string[];
}

export const BARBELL_CURL_GROUPED_FEEDBACK_POLICY = policyJson as unknown as BarbellCurlGroupedPolicy;

let loggedEnabled = false;

function flagValue(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env[BARBELL_CURL_GROUPED_FEEDBACK_FLAG]
    ?? process.env.ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK;
}

export function isBarbellCurlGroupedFeedbackEnabled(): boolean {
  const value = flagValue();
  return value === '1' || value?.toLowerCase() === 'true';
}

export function logBarbellCurlGroupedFeedbackEnabledOnce(): void {
  if (loggedEnabled || !isBarbellCurlGroupedFeedbackEnabled()) return;
  loggedEnabled = true;
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') return;
  console.info(
    `[BarbellCurlMLFeedback] ${BARBELL_CURL_GROUPED_FEEDBACK_FLAG}=1; using ${BARBELL_CURL_GROUPED_FEEDBACK_POLICY.policyId}`,
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

function groupedEligible(features: FeatureVector, issueIds: string[]): boolean {
  return scorable(features) && issueIds.some((issueId) => issueAddEligible(features, issueId));
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
    };
  }

  const probability = predictModel(model, features);
  const eligible = groupedEligible(features, group.childIssueIds);
  let predicted = probability >= group.threshold && eligible;
  let skippedReason: string | undefined;

  if (!eligible) skippedReason = 'no_child_cue_eligible';
  if (group.kind === 'thresholded_model_with_direct_evidence') {
    const evidence = featureValue(features, group.directEvidence.featureColumn);
    const evidencePasses = evidence !== null && evidence >= group.directEvidence.threshold;
    predicted = predicted && evidencePasses;
    if (probability >= group.threshold && eligible && !evidencePasses) {
      skippedReason = 'direct_evidence_gate_failed';
    }
  }

  return {
    issueId: group.id,
    message: group.message,
    priority: group.priority,
    policyName: group.policyName,
    probability,
    threshold: group.threshold,
    eligible,
    predicted,
    ...(skippedReason ? { skippedReason } : {}),
  };
}

export function predictBarbellCurlGroupedFeedback(input: {
  features: FeatureVector;
  heuristicIssueIds: string[];
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

  return {
    enabled: true,
    applied: true,
    policyId: BARBELL_CURL_GROUPED_FEEDBACK_POLICY.policyId,
    modelRunId: BARBELL_CURL_GROUPED_FEEDBACK_POLICY.modelRunId,
    featureSchemaVersion: BARBELL_CURL_GROUPED_FEEDBACK_POLICY.featureSchemaVersion,
    latencyMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt,
    heuristicIssueIds: input.heuristicIssueIds,
    issueIds: selected.map((prediction) => prediction.issueId),
    messages: top ? [top.message] : [],
    selectedIssueId: top?.issueId ?? null,
    selectedMessage: top?.message ?? null,
    predictions,
    featureMissingness,
    warnings,
  };
}
