#!/usr/bin/env python3
"""Evaluate offline ML predictions against heuristic and hybrid baselines."""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import pandas as pd
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
    parser.add_argument("--model", default="hist_gradient", help="Model kind to evaluate.")
    parser.add_argument("--threshold", type=float, default=0.5, help="Fallback ML prediction threshold.")
    parser.add_argument("--min-confidence", type=float, default=0.35, help="Hybrid confidence floor.")
    parser.add_argument("--suppress-threshold", type=float, default=0.25, help="Suppress heuristic issue when ML prob is at/below this value.")
    parser.add_argument("--add-threshold", type=float, default=0.75, help="Log ML-only additional issue candidates at/above this probability.")
    parser.add_argument("--gate-validation-clean-fp-cap", type=float, default=0.25, help="Report gate cap for validation clean false-positive rate.")
    parser.add_argument("--gate-validation-hard-negative-fp-cap", type=float, default=0.0, help="Report gate cap for validation hard-negative clean false-positive rate.")
    parser.add_argument("--gate-min-validation-recall", type=float, default=0.05, help="Report gate minimum validation recall to avoid clean safety by destroying all recall.")
    parser.add_argument("--predictions", help="Predictions CSV. Defaults to latest_predictions.csv.")
    return parser.parse_args()


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
        probs = [probabilities[index] for index in indexes]
        truth = [y_true[index] for index in indexes]
        buckets.append({
            "low": low,
            "high": high,
            "count": len(indexes),
            "meanProbability": sum(probs) / len(probs),
            "positiveRate": sum(truth) / len(truth),
        })
    return buckets


def clean_false_positive_rate(df: pd.DataFrame, prediction_columns: list[str]) -> float:
    clean_rows = df[pd.to_numeric(df["label_clean"], errors="coerce").fillna(0).astype(int) == 1]
    if len(clean_rows) == 0:
        return 0.0
    predicted_any = clean_rows[prediction_columns].sum(axis=1) > 0
    return float(predicted_any.mean())


def row_text(df: pd.DataFrame) -> pd.Series:
    parts: list[pd.Series] = []
    for column in ["source_video", "label_file", "recording_file"]:
        if column in df.columns:
            parts.append(df[column].fillna("").astype(str).str.lower())
    if not parts:
        return pd.Series([""] * len(df), index=df.index)
    result = parts[0]
    for part in parts[1:]:
        result = result + " " + part
    return result


def hard_negative_mask(df: pd.DataFrame) -> pd.Series:
    return row_text(df).str.contains("hard-negative", regex=False)


def clean_front_mask(df: pd.DataFrame) -> pd.Series:
    return row_text(df).str.contains("clean-front", regex=False)


def partial_view_mask(df: pd.DataFrame) -> pd.Series:
    text = row_text(df)
    return text.str.contains("partial", regex=False) | text.str.contains("occluded", regex=False) | text.str.contains("partial-side", regex=False) | text.str.contains("partial-oblique", regex=False)


def issue_recording_mask(df: pd.DataFrame, label_columns: list[str]) -> pd.Series:
    if "source_video" not in df.columns:
        return pd.Series([False] * len(df), index=df.index)
    issue_counts = df[label_columns].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int).sum(axis=1)
    per_recording_has_issue = issue_counts.groupby(df["source_video"]).transform("sum") > 0
    return per_recording_has_issue & ~hard_negative_mask(df) & ~clean_front_mask(df) & ~partial_view_mask(df)


def clean_rows_for(df: pd.DataFrame, mask: pd.Series | None = None) -> pd.DataFrame:
    clean = pd.to_numeric(df["label_clean"], errors="coerce").fillna(0).astype(int) == 1
    if mask is not None:
        clean = clean & mask.reindex(df.index, fill_value=False)
    return df[clean]


def false_positive_slice(df: pd.DataFrame, prediction_columns: list[str], mask: pd.Series | None = None) -> dict[str, Any]:
    clean_rows = clean_rows_for(df, mask)
    if len(clean_rows) == 0:
        return {
            "cleanRows": 0,
            "falsePositiveRows": 0,
            "falsePositiveRate": 0.0,
            "byRecording": [],
        }
    predictions = clean_rows[prediction_columns].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
    predicted_any = predictions.sum(axis=1) > 0
    by_recording: list[dict[str, Any]] = []
    if "source_video" in clean_rows.columns:
        for source_video, group in clean_rows.groupby("source_video"):
            group_predicted = predicted_any.loc[group.index]
            by_recording.append({
                "sourceVideo": str(source_video),
                "cleanRows": int(len(group)),
                "falsePositiveRows": int(group_predicted.sum()),
                "falsePositiveRate": 0.0 if len(group) == 0 else float(group_predicted.mean()),
            })
    return {
        "cleanRows": int(len(clean_rows)),
        "falsePositiveRows": int(predicted_any.sum()),
        "falsePositiveRate": float(predicted_any.mean()),
        "byRecording": sorted(by_recording, key=lambda item: (-item["falsePositiveRows"], item["sourceVideo"])),
    }


def per_issue_clean_false_positives(
    df: pd.DataFrame,
    label_columns: list[str],
    prediction_columns: dict[str, str],
    mask: pd.Series | None = None,
) -> dict[str, Any]:
    clean_rows = clean_rows_for(df, mask)
    result: dict[str, Any] = {}
    for label_column in label_columns:
        prediction_column = prediction_columns[label_column]
        if len(clean_rows) == 0:
            result[label_column] = {"cleanRows": 0, "falsePositiveRows": 0, "falsePositiveRate": 0.0}
            continue
        predictions = pd.to_numeric(clean_rows[prediction_column], errors="coerce").fillna(0).astype(int)
        result[label_column] = {
            "cleanRows": int(len(clean_rows)),
            "falsePositiveRows": int(predictions.sum()),
            "falsePositiveRate": float(predictions.mean()),
        }
    return result


def safety_slice_metrics(
    df: pd.DataFrame,
    label_columns: list[str],
    prediction_columns: dict[str, str],
) -> dict[str, Any]:
    columns = list(prediction_columns.values())
    slices = {
        "allClean": None,
        "hardNegativeClean": hard_negative_mask(df),
        "cleanFront": clean_front_mask(df),
        "issueRecordingClean": issue_recording_mask(df, label_columns),
        "partialViewClean": partial_view_mask(df),
    }
    return {
        "sliceDefinitions": {
            "allClean": "Rows with label_clean=1.",
            "hardNegativeClean": "Clean rows whose source/label/recording path contains hard-negative.",
            "cleanFront": "Clean rows whose source/label/recording path contains clean-front.",
            "issueRecordingClean": "Clean rows from recordings that also contain labelled issue reps, excluding hard-negative, clean-front, and partial-view recordings.",
            "partialViewClean": "Clean rows whose source/label/recording path contains partial or occluded.",
        },
        "slices": {
            name: false_positive_slice(df, columns, mask)
            for name, mask in slices.items()
        },
        "perIssueCleanFalsePositives": per_issue_clean_false_positives(df, label_columns, prediction_columns),
        "perIssueHardNegativeFalsePositives": per_issue_clean_false_positives(df, label_columns, prediction_columns, hard_negative_mask(df)),
    }


def evaluate_prediction_set(
    df: pd.DataFrame,
    label_columns: list[str],
    prediction_columns: dict[str, str],
    probability_columns: dict[str, str] | None = None,
) -> dict[str, Any]:
    per_issue: dict[str, Any] = {}
    all_true: list[int] = []
    all_pred: list[int] = []
    macro_f1_values: list[float] = []
    false_negatives_by_issue: dict[str, int] = {}
    for label_column in label_columns:
        prediction_column = prediction_columns[label_column]
        y_true = pd.to_numeric(df[label_column], errors="coerce").fillna(0).astype(int).tolist()
        y_pred = pd.to_numeric(df[prediction_column], errors="coerce").fillna(0).astype(int).tolist()
        metrics = binary_metrics(y_true, y_pred)
        if probability_columns and label_column in probability_columns:
            probabilities = pd.to_numeric(df[probability_columns[label_column]], errors="coerce").fillna(0).astype(float).tolist()
            metrics["calibrationBuckets"] = calibration_buckets(y_true, probabilities)
        per_issue[label_column] = metrics
        all_true.extend(y_true)
        all_pred.extend(y_pred)
        macro_f1_values.append(float(metrics["f1"]))
        false_negatives_by_issue[label_column] = int(metrics["falseNegatives"])
    aggregate = binary_metrics(all_true, all_pred)
    return {
        "aggregate": aggregate,
        "macroIssueF1": sum(macro_f1_values) / len(macro_f1_values) if macro_f1_values else 0,
        "microIssueF1": aggregate["f1"],
        "cleanRepFalsePositiveRate": clean_false_positive_rate(df, list(prediction_columns.values())),
        "safety": safety_slice_metrics(df, label_columns, prediction_columns),
        "falseNegativesByIssue": false_negatives_by_issue,
        "perIssue": per_issue,
    }


def bootstrap_f1(df: pd.DataFrame, label_columns: list[str], prediction_columns: dict[str, str], iterations: int = 200) -> dict[str, Any]:
    if len(df) < 30:
        return {"available": False, "reason": "fewer_than_30_rows"}
    rng = random.Random(42)
    values: list[float] = []
    indexes = list(df.index)
    for _ in range(iterations):
        sample_indexes = [rng.choice(indexes) for _ in indexes]
        sample = df.loc[sample_indexes]
        values.append(float(evaluate_prediction_set(sample, label_columns, prediction_columns)["aggregate"]["f1"]))
    values.sort()
    return {
        "available": True,
        "iterations": iterations,
        "p05": values[int(iterations * 0.05)],
        "p50": values[int(iterations * 0.5)],
        "p95": values[int(iterations * 0.95) - 1],
    }


def group_breakdown(df: pd.DataFrame, group_column: str, label_columns: list[str], prediction_columns: dict[str, str]) -> dict[str, Any]:
    if group_column not in df.columns:
        return {}
    result: dict[str, Any] = {}
    groups = df[group_column].fillna("unknown").replace("", "unknown")
    for group in sorted(groups.unique()):
        subset = df[groups == group]
        if len(subset) == 0:
            continue
        result[str(group)] = evaluate_prediction_set(subset, label_columns, prediction_columns)["aggregate"]
    return result


def transition_metrics_for_issue(y_true: pd.Series, heuristic: pd.Series, ml: pd.Series, hybrid: pd.Series) -> dict[str, int]:
    y = pd.to_numeric(y_true, errors="coerce").fillna(0).astype(int)
    h = pd.to_numeric(heuristic, errors="coerce").fillna(0).astype(int)
    m = pd.to_numeric(ml, errors="coerce").fillna(0).astype(int)
    hy = pd.to_numeric(hybrid, errors="coerce").fillna(0).astype(int)
    return {
        "heuristicFalsePositivesSuppressedByMl": int(((y == 0) & (h == 1) & (hy == 0)).sum()),
        "heuristicTruePositivesSuppressedByMl": int(((y == 1) & (h == 1) & (hy == 0)).sum()),
        "mlOnlyNewFalsePositives": int(((y == 0) & (h == 0) & (m == 1)).sum()),
        "mlOnlyTruePositivesAdded": int(((y == 1) & (h == 0) & (m == 1)).sum()),
        "hybridNewFalsePositives": int(((y == 0) & (h == 0) & (hy == 1)).sum()),
        "hybridTruePositivesAdded": int(((y == 1) & (h == 0) & (hy == 1)).sum()),
    }


def hybrid_transition_metrics(
    df: pd.DataFrame,
    label_columns: list[str],
    heuristic_columns: dict[str, str],
    ml_columns: dict[str, str],
    hybrid_columns: dict[str, str],
) -> dict[str, Any]:
    aggregate = {
        "heuristicFalsePositivesSuppressedByMl": 0,
        "heuristicTruePositivesSuppressedByMl": 0,
        "mlOnlyNewFalsePositives": 0,
        "mlOnlyTruePositivesAdded": 0,
        "hybridNewFalsePositives": 0,
        "hybridTruePositivesAdded": 0,
    }
    per_issue: dict[str, Any] = {}
    for label_column in label_columns:
        metrics = transition_metrics_for_issue(
            df[label_column],
            df[heuristic_columns[label_column]],
            df[ml_columns[label_column]],
            df[hybrid_columns[label_column]],
        )
        per_issue[label_column] = metrics
        for key, value in metrics.items():
            aggregate[key] += value
    return {
        "aggregate": aggregate,
        "perIssue": per_issue,
    }


def gate_results(
    validation_report: dict[str, Any],
    gate_clean_fp_cap: float,
    gate_hard_negative_fp_cap: float,
    gate_min_recall: float,
) -> dict[str, Any]:
    aggregate = validation_report["aggregate"]
    clean_fp = float(validation_report["cleanRepFalsePositiveRate"])
    hard_negative_fp = float(
        validation_report["safety"]["slices"]["hardNegativeClean"]["falsePositiveRate"],
    )
    recall = float(aggregate["recall"])
    checks = {
        "validationCleanFpWithinCap": clean_fp <= gate_clean_fp_cap,
        "validationHardNegativeFpWithinCap": hard_negative_fp <= gate_hard_negative_fp_cap,
        "validationRecallAboveFloor": recall >= gate_min_recall,
    }
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "metrics": {
            "validationCleanFalsePositiveRate": clean_fp,
            "validationHardNegativeFalsePositiveRate": hard_negative_fp,
            "validationRecall": recall,
            "validationF1": float(aggregate["f1"]),
        },
        "config": {
            "validationCleanFpCap": gate_clean_fp_cap,
            "validationHardNegativeFpCap": gate_hard_negative_fp_cap,
            "minValidationRecall": gate_min_recall,
        },
    }


def threshold_grid() -> list[float]:
    return [index / 100 for index in range(5, 96, 5)]


def threshold_metrics(
    df: pd.DataFrame,
    label_column: str,
    probability_column: str,
    threshold: float,
) -> dict[str, Any]:
    y_true = pd.to_numeric(df[label_column], errors="coerce").fillna(0).astype(int)
    probabilities = pd.to_numeric(df[probability_column], errors="coerce").fillna(0).astype(float)
    y_pred = (probabilities >= threshold).astype(int)
    metrics = binary_metrics(y_true.tolist(), y_pred.tolist())
    prediction_column = f"__threshold_eval_{label_column}_{str(threshold).replace('.', '_')}"
    tmp = df.copy()
    tmp[prediction_column] = y_pred
    return {
        "threshold": threshold,
        **metrics,
        "cleanFalsePositiveRate": clean_false_positive_rate(tmp, [prediction_column]),
        "hardNegativeFalsePositiveRate": false_positive_slice(tmp, [prediction_column], hard_negative_mask(tmp))["falsePositiveRate"],
    }


def choose_threshold_policy(candidates: list[dict[str, Any]], policy: str, clean_fp_cap: float, hard_negative_fp_cap: float, min_recall: float) -> dict[str, Any] | None:
    if not candidates:
        return None
    if policy == "balancedF1":
        pool = candidates
        key = lambda item: (float(item["f1"]), float(item["precision"]), -float(item["cleanFalsePositiveRate"]), float(item["recall"]), -float(item["threshold"]))
    elif policy == "highPrecisionCleanSafety":
        pool = [item for item in candidates if float(item["cleanFalsePositiveRate"]) <= clean_fp_cap] or candidates
        key = lambda item: (float(item["precision"]), float(item["f1"]), -float(item["cleanFalsePositiveRate"]), float(item["recall"]), -float(item["threshold"]))
    elif policy == "hardNegativeProtected":
        pool = [item for item in candidates if float(item["hardNegativeFalsePositiveRate"]) <= hard_negative_fp_cap] or candidates
        key = lambda item: (float(item["f1"]), -float(item["hardNegativeFalsePositiveRate"]), float(item["precision"]), float(item["recall"]), -float(item["threshold"]))
    elif policy == "recallFloor":
        pool = [item for item in candidates if float(item["recall"]) >= min_recall] or candidates
        key = lambda item: (float(item["f1"]), float(item["precision"]), -float(item["cleanFalsePositiveRate"]), -float(item["threshold"]))
    else:
        raise ValueError(f"Unknown threshold policy: {policy}")
    return dict(max(pool, key=key))


def threshold_policy_report(
    df: pd.DataFrame,
    label_columns: list[str],
    model: str,
    args: argparse.Namespace,
) -> dict[str, Any]:
    validation = df[df["split"] == "validation"].copy()
    if len(validation) == 0:
        return {"available": False, "reason": "no_validation_rows"}
    result: dict[str, Any] = {"available": True, "policies": {}}
    for label_column in label_columns:
        probability_column = f"ml__{model}__{label_column}__prob"
        prediction_column = f"ml__{model}__{label_column}__pred"
        if probability_column not in validation.columns:
            continue
        candidates = [
            threshold_metrics(validation, label_column, probability_column, threshold)
            for threshold in threshold_grid()
        ]
        current_threshold = None
        if prediction_column in validation.columns:
            probabilities = pd.to_numeric(validation[probability_column], errors="coerce").fillna(0).astype(float)
            predictions = pd.to_numeric(validation[prediction_column], errors="coerce").fillna(0).astype(int)
            current_matches = [
                threshold
                for threshold in threshold_grid()
                if ((probabilities >= threshold).astype(int) == predictions).all()
            ]
            current_threshold = current_matches[0] if current_matches else None
        result["policies"][label_column] = {
            "currentThreshold": current_threshold,
            "balancedF1": choose_threshold_policy(candidates, "balancedF1", args.gate_validation_clean_fp_cap, args.gate_validation_hard_negative_fp_cap, args.gate_min_validation_recall),
            "highPrecisionCleanSafety": choose_threshold_policy(candidates, "highPrecisionCleanSafety", args.gate_validation_clean_fp_cap, args.gate_validation_hard_negative_fp_cap, args.gate_min_validation_recall),
            "hardNegativeProtected": choose_threshold_policy(candidates, "hardNegativeProtected", args.gate_validation_clean_fp_cap, args.gate_validation_hard_negative_fp_cap, args.gate_min_validation_recall),
            "recallFloor": choose_threshold_policy(candidates, "recallFloor", args.gate_validation_clean_fp_cap, args.gate_validation_hard_negative_fp_cap, args.gate_min_validation_recall),
        }
    return result


def detected_models(df: pd.DataFrame) -> list[str]:
    models: set[str] = set()
    for column in df.columns:
        match = re.match(r"^ml__(.+)__label_issue__.+__prob$", column)
        if match:
            models.add(match.group(1))
    return sorted(models)


def prepare_model_predictions(
    df: pd.DataFrame,
    label_columns: list[str],
    model: str,
    args: argparse.Namespace,
) -> tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, int]]:
    heuristic_prediction_columns: dict[str, str] = {}
    ml_prediction_columns: dict[str, str] = {}
    hybrid_prediction_columns: dict[str, str] = {}
    suppression_prediction_columns: dict[str, str] = {}
    additive_prediction_columns: dict[str, str] = {}
    ml_probability_columns: dict[str, str] = {}
    candidate_counts = {"suppressedHeuristicIssues": 0, "mlOnlyIssues": 0}
    heuristic_scorable = pd.to_numeric(df.get("heuristic_scorable", 1), errors="coerce").fillna(1).astype(int)

    for label_column in label_columns:
        suffix = label_column.removeprefix("label_issue__")
        heuristic_column = f"heuristic_issue__{suffix}"
        ml_prob_column = f"ml__{model}__{label_column}__prob"
        ml_trained_pred_column = f"ml__{model}__{label_column}__pred"
        if heuristic_column not in df.columns:
            df[heuristic_column] = 0
        if ml_prob_column not in df.columns:
            raise SystemExit(f"Missing ML probability column for {label_column}: {ml_prob_column}")

        column_prefix = safe_model_column_part(model)
        ml_pred_column = f"eval_{column_prefix}__ml__{suffix}"
        hybrid_column = f"eval_{column_prefix}__hybrid__{suffix}"
        suppression_column = f"eval_{column_prefix}__ml_suppression__{suffix}"
        additive_column = f"eval_{column_prefix}__ml_additive__{suffix}"
        heuristic_eval_column = f"eval_{column_prefix}__heuristic__{suffix}"

        df[heuristic_eval_column] = pd.to_numeric(df[heuristic_column], errors="coerce").fillna(0).astype(int)
        probabilities = pd.to_numeric(df[ml_prob_column], errors="coerce").fillna(0)
        if ml_trained_pred_column in df.columns:
            df[ml_pred_column] = pd.to_numeric(df[ml_trained_pred_column], errors="coerce").fillna(0).astype(int)
        else:
            df[ml_pred_column] = (probabilities >= args.threshold).astype(int)

        hybrid_values: list[int] = []
        suppression_values: list[int] = []
        additive_values: list[int] = []
        for index, probability in enumerate(probabilities.tolist()):
            heuristic_value = int(df.iloc[index][heuristic_eval_column])
            ml_value = int(df.iloc[index][ml_pred_column])
            confidence = abs(probability - 0.5) * 2
            if int(heuristic_scorable.iloc[index]) == 0:
                hybrid_values.append(0)
                suppression_values.append(0)
                additive_values.append(0)
                continue
            if heuristic_value == 1 and probability <= args.suppress_threshold:
                candidate_counts["suppressedHeuristicIssues"] += 1
                suppression_values.append(0)
            else:
                suppression_values.append(heuristic_value)
            if heuristic_value == 0 and probability >= args.add_threshold:
                candidate_counts["mlOnlyIssues"] += 1
            additive_values.append(1 if heuristic_value == 1 or probability >= args.add_threshold else 0)

            if confidence < args.min_confidence:
                hybrid_values.append(heuristic_value)
            elif heuristic_value == 1 and probability <= args.suppress_threshold:
                hybrid_values.append(0)
            elif heuristic_value == 1 and ml_value == 1:
                hybrid_values.append(1)
            elif heuristic_value == 0 and ml_value == 1:
                hybrid_values.append(0)
            else:
                hybrid_values.append(heuristic_value)

        df[hybrid_column] = hybrid_values
        df[suppression_column] = suppression_values
        df[additive_column] = additive_values

        heuristic_prediction_columns[label_column] = heuristic_eval_column
        ml_prediction_columns[label_column] = ml_pred_column
        hybrid_prediction_columns[label_column] = hybrid_column
        suppression_prediction_columns[label_column] = suppression_column
        additive_prediction_columns[label_column] = additive_column
        ml_probability_columns[label_column] = ml_prob_column

    return (
        heuristic_prediction_columns,
        ml_prediction_columns,
        hybrid_prediction_columns,
        suppression_prediction_columns,
        additive_prediction_columns,
        ml_probability_columns,
        candidate_counts,
    )


def safe_model_column_part(model: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "_", model).strip("_")


def split_reports_for_model(
    df: pd.DataFrame,
    label_columns: list[str],
    columns: tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, int]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    (
        heuristic_prediction_columns,
        ml_prediction_columns,
        hybrid_prediction_columns,
        suppression_prediction_columns,
        additive_prediction_columns,
        ml_probability_columns,
        _candidate_counts,
    ) = columns
    split_reports: dict[str, Any] = {}
    present_splits = [split for split in ["train", "validation", "test"] if int((df["split"] == split).sum()) > 0]
    for split in present_splits:
        subset = df[df["split"] == split].copy()
        split_reports[split] = {
            "rowCount": len(subset),
            "heuristicOnly": evaluate_prediction_set(subset, label_columns, heuristic_prediction_columns),
            "currentOptimiserTunedHeuristic": evaluate_prediction_set(subset, label_columns, heuristic_prediction_columns),
            "mlOnly": evaluate_prediction_set(subset, label_columns, ml_prediction_columns, ml_probability_columns),
            "hybridConservative": evaluate_prediction_set(subset, label_columns, hybrid_prediction_columns),
            "heuristicWithMlSuppressions": evaluate_prediction_set(subset, label_columns, suppression_prediction_columns),
            "heuristicWithMlAdditionalFlags": evaluate_prediction_set(subset, label_columns, additive_prediction_columns),
            "hybridDeltas": hybrid_transition_metrics(
                subset,
                label_columns,
                heuristic_prediction_columns,
                ml_prediction_columns,
                hybrid_prediction_columns,
            ),
            "bootstrap": {
                "heuristicOnly": bootstrap_f1(subset, label_columns, heuristic_prediction_columns),
                "mlOnly": bootstrap_f1(subset, label_columns, ml_prediction_columns),
                "hybridConservative": bootstrap_f1(subset, label_columns, hybrid_prediction_columns),
            },
            "byView": group_breakdown(subset, "label_view", label_columns, hybrid_prediction_columns),
            "bySubject": group_breakdown(subset, "subject_id", label_columns, hybrid_prediction_columns),
            "bySession": group_breakdown(subset, "session_id", label_columns, hybrid_prediction_columns),
            "byCameraSetup": group_breakdown(subset, "camera_setup_id", label_columns, hybrid_prediction_columns),
        }
        subset["pose_quality_bucket"] = subset.get("heuristic_confidence", pd.Series(["unknown"] * len(subset))).apply(pose_quality_bucket)
        split_reports[split]["byPoseQuality"] = group_breakdown(subset, "pose_quality_bucket", label_columns, hybrid_prediction_columns)
        if split == "validation":
            split_reports[split]["gateResults"] = {
                "mlOnly": gate_results(
                    split_reports[split]["mlOnly"],
                    args.gate_validation_clean_fp_cap,
                    args.gate_validation_hard_negative_fp_cap,
                    args.gate_min_validation_recall,
                ),
                "hybridConservative": gate_results(
                    split_reports[split]["hybridConservative"],
                    args.gate_validation_clean_fp_cap,
                    args.gate_validation_hard_negative_fp_cap,
                    args.gate_min_validation_recall,
                ),
            }
    return split_reports


def compact_prediction_summary(prediction_report: dict[str, Any]) -> dict[str, Any]:
    aggregate = prediction_report["aggregate"]
    return {
        "precision": aggregate["precision"],
        "recall": aggregate["recall"],
        "f1": aggregate["f1"],
        "truePositives": aggregate["truePositives"],
        "falsePositives": aggregate["falsePositives"],
        "falseNegatives": aggregate["falseNegatives"],
        "cleanFalsePositiveRate": prediction_report["cleanRepFalsePositiveRate"],
        "hardNegativeFalsePositiveRate": prediction_report["safety"]["slices"]["hardNegativeClean"]["falsePositiveRate"],
    }


def build_model_comparison(
    df: pd.DataFrame,
    label_columns: list[str],
    models: list[str],
    args: argparse.Namespace,
) -> dict[str, Any]:
    comparison: dict[str, Any] = {
        "models": models,
        "splits": {},
    }
    for model in models:
        working = df.copy()
        columns = prepare_model_predictions(working, label_columns, model, args)
        split_reports = split_reports_for_model(working, label_columns, columns, args)
        for split, split_report in split_reports.items():
            split_bucket = comparison["splits"].setdefault(split, {})
            if "heuristicOnly" not in split_bucket:
                split_bucket["heuristicOnly"] = compact_prediction_summary(split_report["heuristicOnly"])
            split_bucket[f"{model}.mlOnly"] = compact_prediction_summary(split_report["mlOnly"])
            split_bucket[f"{model}.hybridConservative"] = compact_prediction_summary(split_report["hybridConservative"])
            if split == "validation":
                split_bucket[f"{model}.gates"] = split_report["gateResults"]
    return comparison


def pose_quality_bucket(confidence: Any) -> str:
    try:
        value = float(confidence)
    except (TypeError, ValueError):
        return "unknown"
    if value >= 0.8:
        return "high"
    if value >= 0.55:
        return "medium"
    return "low"


def recommendation(report: dict[str, Any], label_columns: list[str], split: str) -> dict[str, Any]:
    if split != "test":
        return {
            "status": "do_not_integrate",
            "reason": "No held-out test split is available.",
            "issuesAllowedToInfluence": [],
        }
    validation = report["splits"].get("validation")
    if validation:
        validation_gates = validation.get("gateResults", {})
        failed_modes = [
            mode
            for mode, result in validation_gates.items()
            if isinstance(result, dict) and not bool(result.get("passed", False))
        ]
        if failed_modes and len(failed_modes) == len(validation_gates):
            return {
                "status": "use_ml_offline_only",
                "reason": f"Validation safety gates failed for all evaluated ML modes: {', '.join(failed_modes)}.",
                "issuesAllowedToInfluence": [],
                "validationGateResults": validation_gates,
            }

    heuristic = report["splits"][split]["heuristicOnly"]
    ml = report["splits"][split]["mlOnly"]
    hybrid = report["splits"][split]["hybridConservative"]
    heuristic_f1 = float(heuristic["aggregate"]["f1"])
    ml_f1 = float(ml["aggregate"]["f1"])
    hybrid_f1 = float(hybrid["aggregate"]["f1"])
    heuristic_clean_fp = float(heuristic["cleanRepFalsePositiveRate"])
    ml_clean_fp = float(ml["cleanRepFalsePositiveRate"])
    hybrid_clean_fp = float(hybrid["cleanRepFalsePositiveRate"])

    allowed: list[str] = []
    for label_column in label_columns:
        h_issue = heuristic["perIssue"][label_column]
        ml_issue = ml["perIssue"][label_column]
        if float(ml_issue["f1"]) > float(h_issue["f1"]) and int(ml_issue["count"]) > 0:
            allowed.append(label_column)

    if ml_f1 <= heuristic_f1 and hybrid_f1 <= heuristic_f1:
        return {
            "status": "use_ml_offline_only",
            "reason": "ML/hybrid did not beat heuristic F1 on test.",
            "issuesAllowedToInfluence": [],
        }
    if ml_clean_fp > heuristic_clean_fp + 0.02 and hybrid_clean_fp > heuristic_clean_fp + 0.02:
        return {
            "status": "use_ml_offline_only",
            "reason": "ML/hybrid worsened clean-rep false positives beyond tolerance.",
            "issuesAllowedToInfluence": [],
        }
    if hybrid_f1 > heuristic_f1 and hybrid_clean_fp <= heuristic_clean_fp + 0.02:
        return {
            "status": "shadow_mode_candidate",
            "reason": "Conservative hybrid improved held-out F1 without material clean false-positive regression.",
            "issuesAllowedToInfluence": allowed,
        }
    return {
        "status": "shadow_mode_candidate",
        "reason": "ML improved at least one metric, but should remain shadow-only until reviewed by issue.",
        "issuesAllowedToInfluence": allowed,
    }


def main() -> int:
    args = parse_args()
    exercise_dir = Path(args.ml_dir) / args.exercise
    predictions_path = Path(args.predictions) if args.predictions else exercise_dir / "models" / "latest_predictions.csv"
    if not predictions_path.exists():
        raise SystemExit(f"Predictions CSV not found: {predictions_path}. Run npm run ml:train first.")

    df = pd.read_csv(predictions_path)
    if df.empty:
        raise SystemExit(f"Predictions CSV has no rows: {predictions_path}")

    label_columns = [column for column in df.columns if column.startswith("label_issue__")]
    if not label_columns:
        raise SystemExit("No label_issue__ columns found in predictions CSV.")

    selected_columns = prepare_model_predictions(df, label_columns, args.model, args)
    candidate_counts = selected_columns[-1]
    split_reports = split_reports_for_model(df, label_columns, selected_columns, args)
    present_splits = [split for split in ["train", "validation", "test"] if split in split_reports]
    models_available = detected_models(pd.read_csv(predictions_path))

    decision_split = "test" if "test" in split_reports else present_splits[-1] if present_splits else "none"
    report: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "exercise": args.exercise,
        "model": args.model,
        "predictionsCsv": str(predictions_path),
        "threshold": args.threshold,
        "minConfidence": args.min_confidence,
        "suppressThreshold": args.suppress_threshold,
        "addThreshold": args.add_threshold,
        "gateConfig": {
            "validationCleanFpCap": args.gate_validation_clean_fp_cap,
            "validationHardNegativeFpCap": args.gate_validation_hard_negative_fp_cap,
            "minValidationRecall": args.gate_min_validation_recall,
        },
        "rowCount": len(df),
        "candidateCounts": candidate_counts,
        "issueSupportCounts": {column: int(pd.to_numeric(df[column], errors="coerce").fillna(0).sum()) for column in label_columns},
        "thresholdPolicyReport": threshold_policy_report(pd.read_csv(predictions_path), label_columns, args.model, args),
        "modelComparison": build_model_comparison(pd.read_csv(predictions_path), label_columns, models_available, args),
        "splits": split_reports,
    }
    report["integrationRecommendation"] = recommendation(report, label_columns, decision_split)

    output_dir = exercise_dir / "models"
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    report_path = output_dir / f"evaluation_{timestamp}.json"
    latest_path = output_dir / "latest_evaluation.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    latest_path.write_text(json.dumps(report, indent=2) + "\n")

    decision = report["integrationRecommendation"]
    print(f"Rows: {len(df)}")
    if decision_split in split_reports:
        split = split_reports[decision_split]
        print(f"Decision split: {decision_split}")
        print(f"Heuristic F1: {split['heuristicOnly']['aggregate']['f1']:.3f}")
        print(f"ML F1: {split['mlOnly']['aggregate']['f1']:.3f}")
        print(f"Hybrid F1: {split['hybridConservative']['aggregate']['f1']:.3f}")
    print(f"Recommendation: {decision['status']} ({decision['reason']})")
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
