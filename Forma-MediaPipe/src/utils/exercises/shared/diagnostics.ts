import type {
  DiagnosticDirection,
  DiagnosticUnit,
  RepCueDiagnostic,
  RepDiagnostics,
  RepMetricDiagnostic,
} from '../types';

export function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function diagnosticMetric(
  key: string,
  value: number | null | undefined,
  options: {
    unit?: DiagnosticUnit;
    eligible?: boolean;
    confidence?: number;
    sampleCount?: number;
    skippedReason?: string;
  } = {},
): RepMetricDiagnostic {
  const normalized = finiteOrNull(value);
  const eligible = options.eligible ?? normalized !== null;
  return {
    key,
    value: normalized,
    unit: options.unit,
    eligible: eligible && normalized !== null,
    confidence: options.confidence,
    sampleCount: options.sampleCount,
    skippedReason: eligible && normalized !== null ? undefined : options.skippedReason ?? 'metric_unavailable',
  };
}

export function diagnosticLabelMetric(
  key: string,
  label: string | null | undefined,
  options: {
    sampleCount?: number;
    skippedReason?: string;
  } = {},
): RepMetricDiagnostic {
  const eligible = typeof label === 'string' && label.length > 0;
  return {
    key,
    value: null,
    eligible,
    label: eligible ? label : undefined,
    sampleCount: options.sampleCount,
    skippedReason: eligible ? undefined : options.skippedReason ?? 'metric_unavailable',
  };
}

function marginFor(
  direction: DiagnosticDirection,
  value: number | null,
  threshold: number | null,
): number | null {
  if (value === null || threshold === null) return null;
  if (direction === 'above') return value - threshold;
  if (direction === 'below') return threshold - value;
  return null;
}

function thresholdNumber(thresholdValue?: number | Record<string, number>): number | null {
  if (typeof thresholdValue === 'number' && Number.isFinite(thresholdValue)) return thresholdValue;
  return null;
}

export function diagnosticCue(options: {
  issueId: string;
  metricKeys: string[];
  direction: DiagnosticDirection;
  triggered: boolean;
  eligible?: boolean;
  value?: number | null;
  thresholdPath?: string | string[];
  thresholdValue?: number | Record<string, number>;
  support?: number;
  skippedReason?: string;
}): RepCueDiagnostic {
  const eligible = options.eligible ?? true;
  const value = finiteOrNull(options.value);
  const threshold = thresholdNumber(options.thresholdValue);
  return {
    issueId: options.issueId,
    metricKeys: options.metricKeys,
    triggered: eligible ? options.triggered : false,
    eligible,
    direction: options.direction,
    thresholdPath: options.thresholdPath,
    thresholdValue: options.thresholdValue,
    margin: marginFor(options.direction, value, threshold),
    support: options.support,
    skippedReason: eligible ? undefined : options.skippedReason ?? 'cue_ineligible',
  };
}

export function skippedCue(options: {
  issueId: string;
  metricKeys: string[];
  direction: DiagnosticDirection;
  thresholdPath?: string | string[];
  thresholdValue?: number | Record<string, number>;
  skippedReason: string;
}): RepCueDiagnostic {
  return diagnosticCue({
    ...options,
    triggered: false,
    eligible: false,
  });
}

export function buildRepDiagnostics(options: {
  exerciseName: string;
  repIndex: number;
  scorable?: boolean;
  view?: RepDiagnostics['view'];
  selectedSide?: RepDiagnostics['selectedSide'];
  viewQuality?: RepDiagnostics['viewQuality'];
  reliability?: RepDiagnostics['reliability'];
  metrics: RepMetricDiagnostic[];
  cues: RepCueDiagnostic[];
}): RepDiagnostics {
  return {
    exerciseName: options.exerciseName,
    repIndex: options.repIndex,
    view: options.view,
    selectedSide: options.selectedSide,
    scorable: options.scorable ?? true,
    viewQuality: options.viewQuality,
    reliability: options.reliability,
    metrics: Object.fromEntries(options.metrics.map((metric) => [metric.key, metric])),
    cues: Object.fromEntries(options.cues.map((cue) => [cue.issueId, cue])),
  };
}
