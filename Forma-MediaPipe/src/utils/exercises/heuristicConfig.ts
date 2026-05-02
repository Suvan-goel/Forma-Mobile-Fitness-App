import type {
  ExerciseHeuristicConfig,
  NumericTunable,
  TunableSpec,
} from './types';

type ConfigBinding = {
  path: string;
  target: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function cloneConfig<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneConfig(item)) as T;
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = cloneConfig(child);
  }
  return result as T;
}

export function mergeHeuristicConfig<T extends ExerciseHeuristicConfig>(
  base: T,
  override?: ExerciseHeuristicConfig,
): T {
  if (!override) return cloneConfig(base);
  const result = cloneConfig(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeHeuristicConfig(current as ExerciseHeuristicConfig, value as ExerciseHeuristicConfig)
        : cloneConfig(value);
  }
  return result as T;
}

export function getConfigValue(config: ExerciseHeuristicConfig, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!isPlainObject(current)) return undefined;
    return current[key];
  }, config);
}

export function setConfigValue<T extends ExerciseHeuristicConfig>(
  config: T,
  path: string,
  value: unknown,
): T {
  const result = cloneConfig(config) as Record<string, unknown>;
  const parts = path.split('.');
  let cursor = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cursor[key];
    cursor[key] = isPlainObject(next) ? { ...next } : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return result as T;
}

function assignObject(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  for (const [key, value] of Object.entries(source)) {
    target[key] = isPlainObject(value) ? cloneConfig(value) : value;
  }
}

export function runWithConfigBindings<T>(
  config: ExerciseHeuristicConfig,
  bindings: ConfigBinding[],
  fn: () => T,
): T {
  const previous = bindings.map((binding) => ({
    binding,
    value: cloneConfig(binding.target),
  }));

  try {
    for (const binding of bindings) {
      const nextValue = getConfigValue(config, binding.path);
      if (isPlainObject(nextValue)) {
        assignObject(binding.target, nextValue);
      }
    }
    return fn();
  } finally {
    for (const entry of previous) {
      assignObject(entry.binding.target, entry.value);
    }
  }
}

function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, (step.toString().split('.')[1] ?? '').length);
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

export function clampTunableValue(value: number, tunable: NumericTunable): number {
  return roundToStep(Math.min(tunable.max, Math.max(tunable.min, value)), tunable.step);
}

function inferTunable(path: string, value: number, kind: NumericTunable['kind']): NumericTunable {
  if (value <= 1.2) {
    return {
      path,
      min: Math.max(0, roundToStep(value - 0.08, 0.01)),
      max: Math.min(1.2, roundToStep(value + 0.08, 0.01)),
      step: 0.01,
      kind,
    };
  }

  if (value <= 5) {
    return {
      path,
      min: Math.max(0.01, roundToStep(value * 0.5, 0.05)),
      max: roundToStep(value * 1.5, 0.05),
      step: 0.05,
      kind,
    };
  }

  return {
    path,
    min: roundToStep(value * 0.7, 1),
    max: roundToStep(value * 1.3, 1),
    step: 1,
    kind,
  };
}

function collectNumericTunables(
  prefix: string,
  value: unknown,
  kind: NumericTunable['kind'],
  tunables: NumericTunable[],
): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    tunables.push(inferTunable(prefix, value, kind));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectNumericTunables(`${prefix}.${key}`, child, kind, tunables);
  }
}

export function createDefaultTunableSpec(
  exerciseName: string,
  config: ExerciseHeuristicConfig,
  search?: TunableSpec['search'],
): TunableSpec {
  const tunables: NumericTunable[] = [];
  collectNumericTunables('thresholds', config.thresholds, 'fsm', tunables);
  collectNumericTunables('formThresholds', config.formThresholds, 'feedback', tunables);
  return {
    exerciseName,
    tunables,
    search: {
      randomCandidates: 500,
      survivorCount: 12,
      refinementRounds: 2,
      seed: 1337,
      ...search,
      applyGates: {
        minValidationImprovement: 0.001,
        maxTestRepCountAccuracyRegression: 0,
        maxTestCleanFalsePositiveRegression: 0.02,
        ...search?.applyGates,
      },
    },
  };
}
