#!/usr/bin/env python3
"""Train offline feature-based ML experiments from exported Forma rep features."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import joblib
    import pandas as pd
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
except ModuleNotFoundError as exc:
    print(
        "Missing ML Python dependencies. Install them with:\n"
        "  python3 -m pip install -r scripts/requirements-ml.txt",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exercise", default="barbell-curl", help="Exercise slug.")
    parser.add_argument("--ml-dir", default="datasets/form-heuristics/ml", help="Root ML artifact directory.")
    parser.add_argument("--experiment-id", help="Stable experiment id. Defaults to UTC timestamp.")
    parser.add_argument("--target", default="all", help="Target issue id/column, or all.")
    parser.add_argument("--default-threshold", type=float, default=0.5, help="Fallback probability threshold.")
    parser.add_argument("--min-recall", type=float, default=0.65, help="Minimum validation recall when tuning thresholds.")
    parser.add_argument("--feature-allow-regex", help="Only include feature columns matching this regex.")
    parser.add_argument("--feature-block-regex", help="Exclude feature columns matching this regex.")
    parser.add_argument("--prune-features", action="store_true", help="Training-only cleanup: ignore all-null, single-valued, near-zero variance, and excessive-missingness feature columns.")
    parser.add_argument("--near-zero-variance-threshold", type=float, default=0.0, help="When --prune-features is set, drop numeric features with variance at or below this threshold. 0 keeps only exactly single-valued pruning.")
    parser.add_argument("--max-feature-missing-rate", type=float, default=1.0, help="When --prune-features is set, drop features with a missing rate greater than this value. 1 disables missingness pruning.")
    parser.add_argument("--require-holdout", action="store_true", help="Exit non-zero if validation/test splits are missing.")
    parser.add_argument(
        "--model-kinds",
        default="logistic,hist_gradient",
        help=(
            "Comma-separated model kinds: logistic,logistic_calibrated_sigmoid,"
            "logistic_calibrated_isotonic,random_forest,extra_trees,hist_gradient,"
            "logistic_l2_strong,logistic_l1,logistic_elasticnet,xgboost,lightgbm,"
            "catboost. Calibration suffixes _calibrated_sigmoid and "
            "_calibrated_isotonic are supported for sklearn-backed models."
        ),
    )
    return parser.parse_args()


def now_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def safe_column_part(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def binary_metrics(y_true: list[int], y_pred: list[int]) -> dict[str, float | int]:
    tp = sum(1 for truth, pred in zip(y_true, y_pred) if truth == 1 and pred == 1)
    fp = sum(1 for truth, pred in zip(y_true, y_pred) if truth == 0 and pred == 1)
    fn = sum(1 for truth, pred in zip(y_true, y_pred) if truth == 1 and pred == 0)
    tn = sum(1 for truth, pred in zip(y_true, y_pred) if truth == 0 and pred == 0)
    precision = 1.0 if tp + fp == 0 else tp / (tp + fp)
    recall = 1.0 if tp + fn == 0 else tp / (tp + fn)
    f1 = 0.0 if precision + recall == 0 else (2 * precision * recall) / (precision + recall)
    false_positive_rate = 0.0 if fp + tn == 0 else fp / (fp + tn)
    return {
        "count": len(y_true),
        "truePositives": tp,
        "falsePositives": fp,
        "falseNegatives": fn,
        "trueNegatives": tn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "falsePositiveRate": false_positive_rate,
    }


def calibration_buckets(y_true: list[int], probabilities: list[float], bucket_count: int = 10) -> list[dict[str, Any]]:
    buckets: list[dict[str, Any]] = []
    for bucket in range(bucket_count):
        low = bucket / bucket_count
        high = (bucket + 1) / bucket_count
        indexes = [
            index for index, probability in enumerate(probabilities)
            if probability >= low and (probability < high or bucket == bucket_count - 1)
        ]
        if not indexes:
            buckets.append({"low": low, "high": high, "count": 0, "meanProbability": None, "positiveRate": None})
            continue
        bucket_probs = [probabilities[index] for index in indexes]
        bucket_true = [y_true[index] for index in indexes]
        buckets.append({
            "low": low,
            "high": high,
            "count": len(indexes),
            "meanProbability": sum(bucket_probs) / len(bucket_probs),
            "positiveRate": sum(bucket_true) / len(bucket_true),
        })
    return buckets


def make_uncalibrated_model(kind: str) -> Any:
    if kind == "logistic":
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42)),
            ],
        )
    if kind == "logistic_l2_strong":
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                ("classifier", LogisticRegression(max_iter=2000, C=0.2, class_weight="balanced", random_state=42)),
            ],
        )
    if kind == "logistic_l1":
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                (
                    "classifier",
                    LogisticRegression(
                        max_iter=2000,
                        penalty="l1",
                        solver="liblinear",
                        C=0.5,
                        class_weight="balanced",
                        random_state=42,
                    ),
                ),
            ],
        )
    if kind == "logistic_elasticnet":
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                (
                    "classifier",
                    LogisticRegression(
                        max_iter=3000,
                        penalty="elasticnet",
                        solver="saga",
                        C=0.5,
                        l1_ratio=0.5,
                        class_weight="balanced",
                        random_state=42,
                    ),
                ),
            ],
        )
    if kind == "random_forest":
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("classifier", RandomForestClassifier(n_estimators=250, min_samples_leaf=2, class_weight="balanced", random_state=42)),
            ],
        )
    if kind == "extra_trees":
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "classifier",
                    ExtraTreesClassifier(
                        n_estimators=300,
                        min_samples_leaf=2,
                        class_weight="balanced",
                        random_state=42,
                        n_jobs=-1,
                    ),
                ),
            ],
        )
    if kind == "hist_gradient":
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("classifier", HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, l2_regularization=0.01, random_state=42)),
            ],
        )
    if kind == "xgboost":
        try:
            from xgboost import XGBClassifier  # type: ignore
        except ModuleNotFoundError as exc:
            raise ValueError("xgboost model requested but xgboost is not installed.") from exc
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("classifier", XGBClassifier(n_estimators=250, max_depth=3, learning_rate=0.05, eval_metric="logloss", random_state=42)),
            ],
        )
    if kind == "lightgbm":
        try:
            from lightgbm import LGBMClassifier  # type: ignore
        except ModuleNotFoundError as exc:
            raise ValueError("lightgbm model requested but lightgbm is not installed.") from exc
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("classifier", LGBMClassifier(n_estimators=250, learning_rate=0.05, class_weight="balanced", random_state=42)),
            ],
        )
    if kind == "catboost":
        try:
            from catboost import CatBoostClassifier  # type: ignore
        except ModuleNotFoundError as exc:
            raise ValueError("catboost model requested but catboost is not installed.") from exc
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "classifier",
                    CatBoostClassifier(
                        iterations=250,
                        learning_rate=0.05,
                        depth=4,
                        auto_class_weights="Balanced",
                        random_seed=42,
                        verbose=False,
                    ),
                ),
            ],
        )
    raise ValueError(f"Unknown model kind: {kind}")


def make_model(kind: str) -> Any:
    calibration_suffixes = {
        "_calibrated_sigmoid": "sigmoid",
        "_calibrated_isotonic": "isotonic",
    }
    if kind == "logistic_calibrated":
        kind = "logistic_calibrated_sigmoid"
    for suffix, method in calibration_suffixes.items():
        if kind.endswith(suffix):
            base_kind = kind.removesuffix(suffix)
            base_model = make_uncalibrated_model(base_kind)
            return CalibratedClassifierCV(estimator=base_model, method=method, cv=3)
    return make_uncalibrated_model(kind)


def predict_probability(model: Any, x_frame: pd.DataFrame) -> list[float]:
    if hasattr(model, "predict_proba"):
        return [float(value) for value in model.predict_proba(x_frame)[:, 1]]
    return [float(value) for value in model.predict(x_frame)]


def feature_importance(model: Any, feature_columns: list[str]) -> list[dict[str, Any]]:
    classifier = model[-1] if isinstance(model, Pipeline) else model
    values = getattr(classifier, "feature_importances_", None)
    if values is None:
        values = getattr(classifier, "coef_", None)
        if values is not None:
            values = values[0]
    if values is None:
        return []
    pairs = [{"feature": feature, "importance": float(abs(value))} for feature, value in zip(feature_columns, values)]
    return sorted(pairs, key=lambda item: item["importance"], reverse=True)[:50]


def select_feature_columns(columns: list[str], allow_regex: str | None, block_regex: str | None) -> list[str]:
    features = [column for column in columns if column.startswith("feature__")]
    if allow_regex:
        allow = re.compile(allow_regex)
        features = [column for column in features if allow.search(column)]
    if block_regex:
        block = re.compile(block_regex)
        features = [column for column in features if not block.search(column)]
    return features


def feature_group(column: str) -> str:
    parts = column.removeprefix("feature__").split(".")
    if len(parts) >= 2:
        return ".".join(parts[:2])
    return parts[0] if parts else "unknown"


def prune_feature_columns(
    df: pd.DataFrame,
    feature_columns: list[str],
    enabled: bool,
    near_zero_variance_threshold: float,
    max_missing_rate: float,
) -> tuple[list[str], dict[str, Any]]:
    report: dict[str, Any] = {
        "enabled": enabled,
        "schemaCompatibility": "Training-only pruning: features.csv is unchanged; ignored columns are omitted from model featureColumns.",
        "beforeCount": len(feature_columns),
        "afterCount": len(feature_columns),
        "removedCount": 0,
        "nearZeroVarianceThreshold": near_zero_variance_threshold,
        "maxMissingRate": max_missing_rate,
        "removedByReason": {
            "allNull": 0,
            "singleValued": 0,
            "nearZeroVariance": 0,
            "excessiveMissingness": 0,
        },
        "removedByGroup": {},
        "removedFeatures": [],
    }
    if not enabled:
        return feature_columns, report
    if not (0.0 <= max_missing_rate <= 1.0):
        raise SystemExit("--max-feature-missing-rate must be between 0 and 1.")
    if near_zero_variance_threshold < 0:
        raise SystemExit("--near-zero-variance-threshold must be >= 0.")

    selected: list[str] = []
    removed_features: list[dict[str, Any]] = []
    group_counts: dict[str, int] = {}
    reason_counts = report["removedByReason"]
    row_count = len(df)
    for column in feature_columns:
        series = pd.to_numeric(df[column], errors="coerce")
        non_null_count = int(series.notna().sum())
        missing_rate = 1.0 if row_count == 0 else 1 - (non_null_count / row_count)
        unique_count = int(series.nunique(dropna=True))
        variance = 0.0 if non_null_count <= 1 else float(series.var(skipna=True))
        reason: str | None = None
        if non_null_count == 0:
            reason = "allNull"
        elif max_missing_rate < 1.0 and missing_rate > max_missing_rate:
            reason = "excessiveMissingness"
        elif unique_count <= 1:
            reason = "singleValued"
        elif near_zero_variance_threshold > 0 and variance <= near_zero_variance_threshold:
            reason = "nearZeroVariance"

        if reason is None:
            selected.append(column)
            continue
        group = feature_group(column)
        reason_counts[reason] += 1
        group_counts[group] = group_counts.get(group, 0) + 1
        removed_features.append({
            "feature": column,
            "reason": reason,
            "group": group,
            "nonNullCount": non_null_count,
            "missingRate": missing_rate,
            "uniqueCount": unique_count,
            "variance": variance,
        })

    report["afterCount"] = len(selected)
    report["removedCount"] = len(removed_features)
    report["removedByGroup"] = dict(sorted(group_counts.items(), key=lambda item: (-item[1], item[0])))
    report["removedFeatures"] = removed_features
    return selected, report


def select_targets(label_columns: list[str], target_arg: str) -> list[str]:
    if target_arg == "all":
        return label_columns + ["target__has_issue"]
    candidates = [target_arg]
    if not target_arg.startswith("label_issue__") and target_arg != "target__has_issue":
        candidates.append(f"label_issue__{safe_column_part(target_arg)}")
    for candidate in candidates:
        if candidate in label_columns or candidate == "target__has_issue":
            return [candidate]
    raise SystemExit(f"Target not found: {target_arg}. Available targets: {', '.join(label_columns)}")


def tune_threshold(y_true: list[int], probabilities: list[float], default_threshold: float, min_recall: float) -> dict[str, Any]:
    if len(y_true) == 0:
        return {"threshold": default_threshold, "reason": "no_validation_rows", "metrics": None}
    if sum(y_true) == 0:
        best = min((threshold for threshold in [index / 100 for index in range(5, 96, 5)]), key=lambda t: sum(1 for p in probabilities if p >= t))
        return {"threshold": best, "reason": "validation_has_no_positives", "metrics": binary_metrics(y_true, [1 if p >= best else 0 for p in probabilities])}

    candidates: list[tuple[float, dict[str, float | int]]] = []
    for index in range(5, 96, 5):
        threshold = index / 100
        metrics = binary_metrics(y_true, [1 if probability >= threshold else 0 for probability in probabilities])
        candidates.append((threshold, metrics))
    eligible = [(threshold, metrics) for threshold, metrics in candidates if float(metrics["recall"]) >= min_recall]
    pool = eligible or candidates
    threshold, metrics = sorted(
        pool,
        key=lambda item: (
            float(item[1]["falsePositiveRate"]),
            -float(item[1]["f1"]),
            -float(item[1]["recall"]),
            item[0],
        ),
    )[0]
    return {
        "threshold": threshold,
        "reason": "validation_min_recall_met" if eligible else "no_threshold_met_min_recall",
        "metrics": metrics,
    }


def split_metrics(df: pd.DataFrame, target: str, y_all: pd.Series, probabilities: list[float], threshold: float) -> dict[str, Any]:
    result: dict[str, Any] = {}
    prob_series = pd.Series(probabilities, index=df.index)
    for split in ["train", "validation", "test"]:
        split_mask = df["split"] == split
        if int(split_mask.sum()) == 0:
            continue
        y_true = [int(value) for value in y_all[split_mask].tolist()]
        split_probs = [float(value) for value in prob_series[split_mask].tolist()]
        y_pred = [1 if value >= threshold else 0 for value in split_probs]
        result[split] = {
            **binary_metrics(y_true, y_pred),
            "calibrationBuckets": calibration_buckets(y_true, split_probs),
        }
    return result


def main() -> int:
    args = parse_args()
    exercise_dir = Path(args.ml_dir) / args.exercise
    csv_path = exercise_dir / "features.csv"
    manifest_path = exercise_dir / "manifest.json"
    if not csv_path.exists():
        raise SystemExit(f"Feature CSV not found: {csv_path}. Run npm run ml:export first.")

    df = pd.read_csv(csv_path)
    if df.empty:
        raise SystemExit(f"Feature CSV has no rows: {csv_path}")

    raw_feature_columns = select_feature_columns(list(df.columns), args.feature_allow_regex, args.feature_block_regex)
    feature_columns, feature_pruning_report = prune_feature_columns(
        df,
        raw_feature_columns,
        args.prune_features,
        args.near_zero_variance_threshold,
        args.max_feature_missing_rate,
    )
    label_columns = [column for column in df.columns if column.startswith("label_issue__")]
    if not feature_columns:
        raise SystemExit("No usable feature__ columns found in exported CSV.")
    if not label_columns:
        raise SystemExit("No label_issue__ columns found in exported CSV.")

    df["target__has_issue"] = 1 - pd.to_numeric(df["label_clean"], errors="coerce").fillna(1).astype(int)
    target_columns = select_targets(label_columns, args.target)
    x_all = df[feature_columns].apply(pd.to_numeric, errors="coerce")
    train_mask = df["split"] == "train"
    validation_mask = df["split"] == "validation"
    test_mask = df["split"] == "test"
    holdout_valid = int(validation_mask.sum()) > 0 and int(test_mask.sum()) > 0
    if int(train_mask.sum()) == 0:
        raise SystemExit("No train split rows found. Export reviewed train labels first.")
    if args.require_holdout and not holdout_valid:
        raise SystemExit("Validation and test splits are required for production-oriented ML claims.")

    model_kinds = [kind.strip() for kind in args.model_kinds.split(",") if kind.strip()]
    experiment_id = args.experiment_id or now_slug()
    model_dir = exercise_dir / "models" / experiment_id
    model_dir.mkdir(parents=True, exist_ok=True)
    predictions = df.copy()
    report: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "experimentId": experiment_id,
        "exercise": args.exercise,
        "featuresCsv": str(csv_path),
        "manifest": str(manifest_path),
        "config": {
            "target": args.target,
            "defaultThreshold": args.default_threshold,
            "minRecall": args.min_recall,
            "modelKinds": model_kinds,
            "featureAllowRegex": args.feature_allow_regex,
            "featureBlockRegex": args.feature_block_regex,
            "pruneFeatures": args.prune_features,
            "nearZeroVarianceThreshold": args.near_zero_variance_threshold,
            "maxFeatureMissingRate": args.max_feature_missing_rate,
        },
        "productionClaimValid": holdout_valid,
        "productionClaimBlockers": [] if holdout_valid else ["validation_or_test_split_missing"],
        "featureCount": len(feature_columns),
        "featureCountBeforePruning": len(raw_feature_columns),
        "featurePruning": feature_pruning_report,
        "rowCount": len(df),
        "splitCounts": {split: int((df["split"] == split).sum()) for split in ["train", "validation", "test"]},
        "targets": target_columns,
        "models": {},
    }

    for kind in model_kinds:
        report["models"][kind] = {}
        for target in target_columns:
            y_all = pd.to_numeric(df[target], errors="coerce").fillna(0).astype(int)
            y_train = y_all[train_mask]
            if y_train.nunique() < 2:
                report["models"][kind][target] = {
                    "trained": False,
                    "reason": "train_split_has_single_class",
                    "positiveTrainRows": int(y_train.sum()),
                    "trainRows": int(len(y_train)),
                }
                continue

            try:
                model = make_model(kind)
            except ValueError as error:
                report["models"][kind][target] = {"trained": False, "reason": str(error)}
                continue

            model.fit(x_all[train_mask], y_train)
            probabilities = predict_probability(model, x_all)
            validation_probs = [float(value) for value in pd.Series(probabilities, index=df.index)[validation_mask].tolist()]
            validation_truth = [int(value) for value in y_all[validation_mask].tolist()]
            threshold_report = tune_threshold(validation_truth, validation_probs, args.default_threshold, args.min_recall)
            threshold = float(threshold_report["threshold"])
            pred_column = f"ml__{kind}__{target}__pred"
            prob_column = f"ml__{kind}__{target}__prob"
            predictions[prob_column] = probabilities
            predictions[pred_column] = [1 if value >= threshold else 0 for value in probabilities]

            target_report: dict[str, Any] = {
                "trained": True,
                "positiveTrainRows": int(y_train.sum()),
                "trainRows": int(len(y_train)),
                "threshold": threshold_report,
                "metrics": split_metrics(df, target, y_all, probabilities, threshold),
                "topFeatures": feature_importance(model, feature_columns),
            }

            model_path = model_dir / f"{kind}__{target}.joblib"
            joblib.dump(
                {
                    "model": model,
                    "modelKind": kind,
                    "target": target,
                    "featureColumns": feature_columns,
                    "threshold": threshold,
                    "experimentId": experiment_id,
                },
                model_path,
            )
            target_report["modelPath"] = str(model_path)
            target_report["modelSizeBytes"] = model_path.stat().st_size
            report["models"][kind][target] = target_report

    predictions_path = model_dir / "predictions.csv"
    metrics_path = model_dir / "metrics.json"
    config_path = model_dir / "config.json"
    predictions.to_csv(predictions_path, index=False)
    metrics_path.write_text(json.dumps(report, indent=2) + "\n")
    config_path.write_text(json.dumps(report["config"], indent=2) + "\n")

    latest_predictions = exercise_dir / "models" / "latest_predictions.csv"
    latest_metrics = exercise_dir / "models" / "latest_metrics.json"
    shutil.copyfile(predictions_path, latest_predictions)
    shutil.copyfile(metrics_path, latest_metrics)

    print(f"Rows: {len(df)}")
    print(f"Features: {len(feature_columns)}")
    if args.prune_features:
        print(f"Features before pruning: {feature_pruning_report['beforeCount']}")
        print(f"Features removed by pruning: {feature_pruning_report['removedCount']}")
    print(f"Experiment: {experiment_id}")
    print(f"Production claim valid: {report['productionClaimValid']}")
    print(f"Model dir: {model_dir}")
    print(f"Predictions: {predictions_path}")
    print(f"Metrics: {metrics_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
