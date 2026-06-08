#!/usr/bin/env python3
"""Evaluate offline ML predictions against heuristic and hybrid baselines."""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import pandas as pd
    from pandas.errors import PerformanceWarning
except ModuleNotFoundError as exc:
    print(
        "Missing ML Python dependencies. Install them with:\n"
        "  python3 -m pip install -r scripts/requirements-ml.txt",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc

warnings.simplefilter("ignore", PerformanceWarning)


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
    parser.add_argument("--issue-policy-min-precision", type=float, default=0.35, help="Validation precision floor for optimized issue-specific hybrid policies.")
    parser.add_argument("--issue-policy-clean-fp-row-cap", type=int, default=1, help="Per-issue validation clean false-positive row cap for optimized issue-specific hybrid policies.")
    parser.add_argument("--issue-policy-hard-negative-fp-row-cap", type=int, default=0, help="Per-issue validation hard-negative clean false-positive row cap for optimized issue-specific hybrid policies.")
    parser.add_argument("--issue-policy-partial-view-fp-row-cap", type=int, default=0, help="Per-issue validation partial-view clean false-positive row cap for optimized issue-specific hybrid policies.")
    parser.add_argument("--grouped-policy-min-precision", type=float, default=0.75, help="Validation precision floor for Barbell Curl grouped-feedback rep-level policies.")
    parser.add_argument("--grouped-policy-clean-fp-row-cap", type=int, default=0, help="Validation clean false-positive row cap for Barbell Curl grouped-feedback rep-level policies.")
    parser.add_argument("--grouped-policy-hard-negative-fp-row-cap", type=int, default=0, help="Validation hard-negative clean false-positive row cap for Barbell Curl grouped-feedback rep-level policies.")
    parser.add_argument("--grouped-policy-partial-view-fp-row-cap", type=int, default=0, help="Validation partial-view clean false-positive row cap for Barbell Curl grouped-feedback rep-level policies.")
    parser.add_argument("--grouped-set-threshold", type=float, default=0.85, help="ML probability threshold for grouped set-level backup feedback.")
    parser.add_argument("--grouped-set-min-reps", type=int, default=2, help="Minimum eligible reps above threshold before grouped set-level backup feedback is shown.")
    parser.add_argument("--review-annotations", help="Optional offline review-annotation JSON sidecar for product-tolerant grouped-feedback safety metrics.")
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


def issue_suffix(label_column: str) -> str:
    return label_column.removeprefix("label_issue__")


def issue_slug(label_column: str) -> str:
    return issue_suffix(label_column).replace("_", ".")


def issue_severity_column(label_column: str) -> str:
    return f"label_issue_severity__{issue_suffix(label_column)}"


def numeric_int_series(df: pd.DataFrame, column: str, default: int = 0) -> pd.Series:
    if column not in df.columns:
        return pd.Series([default] * len(df), index=df.index)
    return pd.to_numeric(df[column], errors="coerce").fillna(default).astype(int)


def numeric_float_series(df: pd.DataFrame, column: str, default: float = 0.0) -> pd.Series:
    if column not in df.columns:
        return pd.Series([default] * len(df), index=df.index)
    return pd.to_numeric(df[column], errors="coerce").fillna(default).astype(float)


def severity_metrics(
    df: pd.DataFrame,
    label_columns: list[str],
    prediction_columns: dict[str, str],
) -> dict[str, Any]:
    groups = {
        "mildIssues": {"mild"},
        "clearModerateSevereIssues": {"clear", "moderate", "severe"},
        "unknownSeverityIssues": {"", "unknown", "nan", "none"},
    }
    result: dict[str, Any] = {
        "available": any(issue_severity_column(label_column) in df.columns for label_column in label_columns),
        "note": "Severity metrics count labelled positive issues only. Precision is reported in the aggregate/per-issue tables because negative rows do not have a severity.",
        "groups": {},
        "perIssue": {},
    }
    for group_name, accepted in groups.items():
        positives = 0
        true_positives = 0
        false_negatives = 0
        for label_column in label_columns:
            severity_column = issue_severity_column(label_column)
            if severity_column not in df.columns:
                continue
            labelled = numeric_int_series(df, label_column)
            predicted = numeric_int_series(df, prediction_columns[label_column])
            severities = df[severity_column].fillna("").astype(str).str.lower()
            mask = (labelled == 1) & severities.isin(accepted)
            positives += int(mask.sum())
            true_positives += int(((predicted == 1) & mask).sum())
            false_negatives += int(((predicted == 0) & mask).sum())
        result["groups"][group_name] = {
            "positiveSupport": positives,
            "truePositives": true_positives,
            "falseNegatives": false_negatives,
            "recall": 1.0 if positives == 0 else true_positives / positives,
        }
    for label_column in label_columns:
        severity_column = issue_severity_column(label_column)
        if severity_column not in df.columns:
            continue
        labelled = numeric_int_series(df, label_column)
        predicted = numeric_int_series(df, prediction_columns[label_column])
        severities = df[severity_column].fillna("").astype(str).str.lower()
        issue_result: dict[str, Any] = {}
        for group_name, accepted in groups.items():
            mask = (labelled == 1) & severities.isin(accepted)
            positive_support = int(mask.sum())
            true_positives = int(((predicted == 1) & mask).sum())
            issue_result[group_name] = {
                "positiveSupport": positive_support,
                "truePositives": true_positives,
                "falseNegatives": int(((predicted == 0) & mask).sum()),
                "recall": 1.0 if positive_support == 0 else true_positives / positive_support,
            }
        result["perIssue"][label_column] = issue_result
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
        "severity": severity_metrics(df, label_columns, prediction_columns),
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
        all_true: list[int] = []
        all_pred: list[int] = []
        for label_column in label_columns:
            all_true.extend(numeric_int_series(sample, label_column).tolist())
            all_pred.extend(numeric_int_series(sample, prediction_columns[label_column]).tolist())
        values.append(float(binary_metrics(all_true, all_pred)["f1"]))
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


def issue_name(label_column: str) -> str:
    return issue_slug(label_column)


def issue_clean_fp_count(df: pd.DataFrame, prediction_column: str, mask: pd.Series | None = None) -> int:
    clean_rows = clean_rows_for(df, mask)
    if len(clean_rows) == 0:
        return 0
    predictions = pd.to_numeric(clean_rows[prediction_column], errors="coerce").fillna(0).astype(int)
    return int(predictions.sum())


def false_positive_rows_for_series(
    df: pd.DataFrame,
    prediction: pd.Series,
    mask: pd.Series | None = None,
) -> int:
    clean_rows = clean_rows_for(df, mask)
    if len(clean_rows) == 0:
        return 0
    aligned = pd.to_numeric(prediction.reindex(clean_rows.index), errors="coerce").fillna(0).astype(int)
    return int(aligned.sum())


def issue_candidate_summary_from_series(
    validation: pd.DataFrame,
    label_column: str,
    heuristic: pd.Series,
    ml: pd.Series,
    candidate: pd.Series,
) -> dict[str, Any]:
    metrics = binary_metrics(
        numeric_int_series(validation, label_column).tolist(),
        pd.to_numeric(candidate.reindex(validation.index), errors="coerce").fillna(0).astype(int).tolist(),
    )
    transitions = transition_metrics_for_issue(
        validation[label_column],
        heuristic.reindex(validation.index),
        ml.reindex(validation.index),
        candidate.reindex(validation.index),
    )
    clean_rows = false_positive_rows_for_series(validation, candidate)
    hard_negative_rows = false_positive_rows_for_series(validation, candidate, hard_negative_mask(validation))
    clean_front_rows = false_positive_rows_for_series(validation, candidate, clean_front_mask(validation))
    issue_recording_rows = false_positive_rows_for_series(validation, candidate, issue_recording_mask(validation, [label_column]))
    partial_view_rows = false_positive_rows_for_series(validation, candidate, partial_view_mask(validation))
    return {
        **metrics,
        **transitions,
        "cleanFalsePositiveRows": clean_rows,
        "hardNegativeFalsePositiveRows": hard_negative_rows,
        "cleanFrontFalsePositiveRows": clean_front_rows,
        "issueRecordingCleanFalsePositiveRows": issue_recording_rows,
        "partialViewCleanFalsePositiveRows": partial_view_rows,
    }


def issue_candidate_summary(
    validation: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    ml_column: str,
    candidate_column: str,
) -> dict[str, Any]:
    return issue_candidate_summary_from_series(
        validation,
        label_column,
        validation[heuristic_column],
        validation[ml_column],
        validation[candidate_column],
    )


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


def row_example(
    row: pd.Series,
    issue: str,
    probability: float | None = None,
    policy_choice: dict[str, Any] | None = None,
) -> dict[str, Any]:
    suffix = issue.replace(".", "_")
    cue_prefix = f"feature__diagnostic.cue.{suffix}"
    example = {
        "sourceVideo": row.get("source_video"),
        "labelFile": row.get("label_file"),
        "recordingFile": row.get("recording_file"),
        "split": row.get("split"),
        "repIndex": int(row.get("rep_index", -1)) if pd.notna(row.get("rep_index", None)) else None,
        "startMs": row.get("start_ms"),
        "endMs": row.get("end_ms"),
        "issueId": issue,
        "labelView": row.get("label_view"),
        "labelScorable": row.get("label_scorable"),
        "heuristicScorable": row.get("heuristic_scorable"),
        "qualityStatus": row.get("heuristic_quality_status"),
        "probability": probability,
        "severity": row.get(f"label_issue_severity__{suffix}"),
        "policy": policy_choice.get("selected") if policy_choice else None,
        "suppressThreshold": policy_choice.get("suppressThreshold") if policy_choice else None,
        "addThreshold": policy_choice.get("addThreshold") if policy_choice else None,
        "cueEligible": row.get(f"{cue_prefix}.eligible"),
        "cueMargin": row.get(f"{cue_prefix}.margin"),
        "cueSupport": row.get(f"{cue_prefix}.support"),
        "cueTriggered": row.get(f"{cue_prefix}.triggered"),
        "issueScorableFeature": row.get(f"feature__scorable.issue.{suffix}"),
        "diagnosticScorableFeature": row.get("feature__diagnostic.scorable"),
    }
    return {key: value for key, value in example.items() if value is not None and not (isinstance(value, float) and pd.isna(value))}


def policy_review_examples(
    df: pd.DataFrame,
    label_columns: list[str],
    heuristic_columns: dict[str, str],
    ml_columns: dict[str, str],
    policy_columns: dict[str, str],
    probability_columns: dict[str, str],
    policy_choices: dict[str, Any] | None = None,
    limit: int = 20,
) -> dict[str, list[dict[str, Any]]]:
    categories = {
        "mlTruePositivesAdded": [],
        "mlFalsePositivesAdded": [],
        "heuristicFalsePositivesSuppressedByMl": [],
        "heuristicTruePositivesSuppressedByMl": [],
        "remainingHighImpactFalseNegatives": [],
        "remainingCleanFalsePositives": [],
    }
    clean = numeric_int_series(df, "label_clean")
    for label_column in label_columns:
        issue = issue_name(label_column)
        choice = policy_choices.get(label_column) if policy_choices else None
        truth = numeric_int_series(df, label_column)
        heuristic = numeric_int_series(df, heuristic_columns[label_column])
        policy = numeric_int_series(df, policy_columns[label_column])
        probability = numeric_float_series(df, probability_columns[label_column])
        severity_column = issue_severity_column(label_column)
        severities = df[severity_column].fillna("").astype(str).str.lower() if severity_column in df.columns else pd.Series([""] * len(df), index=df.index)
        clear_or_unknown = severities.isin({"clear", "moderate", "severe", "", "unknown", "nan", "none"})
        masks = {
            "mlTruePositivesAdded": (truth == 1) & (heuristic == 0) & (policy == 1),
            "mlFalsePositivesAdded": (truth == 0) & (heuristic == 0) & (policy == 1),
            "heuristicFalsePositivesSuppressedByMl": (truth == 0) & (heuristic == 1) & (policy == 0),
            "heuristicTruePositivesSuppressedByMl": (truth == 1) & (heuristic == 1) & (policy == 0),
            "remainingHighImpactFalseNegatives": (truth == 1) & (policy == 0) & clear_or_unknown,
            "remainingCleanFalsePositives": (clean == 1) & (policy == 1),
        }
        for category, mask in masks.items():
            indexes = list(df[mask].index)
            reverse = category in {"mlTruePositivesAdded", "mlFalsePositivesAdded", "remainingCleanFalsePositives"}
            indexes.sort(key=lambda index: float(probability.loc[index]), reverse=reverse)
            for index in indexes[:limit]:
                categories[category].append(row_example(df.loc[index], issue, float(probability.loc[index]), choice))
    for category, examples in categories.items():
        reverse = category in {"mlTruePositivesAdded", "mlFalsePositivesAdded", "remainingCleanFalsePositives"}
        examples.sort(key=lambda item: float(item.get("probability", 0.0)), reverse=reverse)
        categories[category] = examples[:limit]
    return categories


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


def primary_models_for_general_comparison(models: list[str]) -> list[str]:
    return [
        model
        for model in models
        if "group_subset" not in model and "pruned_all" not in model
    ]


def prepare_model_predictions(
    df: pd.DataFrame,
    label_columns: list[str],
    model: str,
    args: argparse.Namespace,
) -> tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, int]]:
    heuristic_prediction_columns: dict[str, str] = {}
    ml_prediction_columns: dict[str, str] = {}
    hybrid_prediction_columns: dict[str, str] = {}
    suppression_prediction_columns: dict[str, str] = {}
    additive_prediction_columns: dict[str, str] = {}
    suppress_and_add_prediction_columns: dict[str, str] = {}
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
        suppress_and_add_column = f"eval_{column_prefix}__ml_suppress_and_add__{suffix}"
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
        suppress_and_add_values: list[int] = []
        for index, probability in enumerate(probabilities.tolist()):
            heuristic_value = int(df.iloc[index][heuristic_eval_column])
            ml_value = int(df.iloc[index][ml_pred_column])
            confidence = abs(probability - 0.5) * 2
            if int(heuristic_scorable.iloc[index]) == 0:
                hybrid_values.append(0)
                suppression_values.append(0)
                additive_values.append(0)
                suppress_and_add_values.append(0)
                continue
            if heuristic_value == 1 and probability <= args.suppress_threshold:
                candidate_counts["suppressedHeuristicIssues"] += 1
                suppression_values.append(0)
            else:
                suppression_values.append(heuristic_value)
            if heuristic_value == 0 and probability >= args.add_threshold:
                candidate_counts["mlOnlyIssues"] += 1
            additive_values.append(1 if heuristic_value == 1 or probability >= args.add_threshold else 0)
            if heuristic_value == 1 and probability <= args.suppress_threshold:
                suppress_and_add_values.append(0)
            elif heuristic_value == 0 and probability >= args.add_threshold:
                suppress_and_add_values.append(1)
            else:
                suppress_and_add_values.append(heuristic_value)

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
        df[suppress_and_add_column] = suppress_and_add_values

        heuristic_prediction_columns[label_column] = heuristic_eval_column
        ml_prediction_columns[label_column] = ml_pred_column
        hybrid_prediction_columns[label_column] = hybrid_column
        suppression_prediction_columns[label_column] = suppression_column
        additive_prediction_columns[label_column] = additive_column
        suppress_and_add_prediction_columns[label_column] = suppress_and_add_column
        ml_probability_columns[label_column] = ml_prob_column

    return (
        heuristic_prediction_columns,
        ml_prediction_columns,
        hybrid_prediction_columns,
        suppression_prediction_columns,
        additive_prediction_columns,
        suppress_and_add_prediction_columns,
        ml_probability_columns,
        candidate_counts,
    )


def safe_model_column_part(model: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "_", model).strip("_")


def materialize_issue_policy(
    df: pd.DataFrame,
    label_columns: list[str],
    model: str,
    policy_name: str,
    source_columns: dict[str, str],
) -> dict[str, str]:
    policy_columns: dict[str, str] = {}
    column_prefix = safe_model_column_part(model)
    policy_part = safe_model_column_part(policy_name)
    for label_column in label_columns:
        suffix = label_column.removeprefix("label_issue__")
        policy_column = f"eval_{column_prefix}__policy_{policy_part}__{suffix}"
        df[policy_column] = pd.to_numeric(df[source_columns[label_column]], errors="coerce").fillna(0).astype(int)
        policy_columns[label_column] = policy_column
    return policy_columns


def issue_prediction_scorable_mask(df: pd.DataFrame) -> pd.Series:
    mask = numeric_int_series(df, "heuristic_scorable", 1) == 1
    if "feature__diagnostic.scorable" in df.columns:
        mask = mask & (numeric_float_series(df, "feature__diagnostic.scorable", 1.0) >= 0.5)
    return mask


def issue_add_eligibility_mask(df: pd.DataFrame, label_column: str) -> pd.Series:
    suffix = issue_suffix(label_column)
    mask = issue_prediction_scorable_mask(df)
    for column in [
        f"feature__scorable.issue.{suffix}",
        f"feature__diagnostic.cue.{suffix}.eligible",
    ]:
        if column in df.columns:
            mask = mask & (numeric_float_series(df, column, 0.0) >= 0.5)
    return mask


def policy_candidate_series(
    df: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    probability_column: str,
    policy: str,
    suppress_threshold: float | None = None,
    add_threshold: float | None = None,
) -> pd.Series:
    heuristic = numeric_int_series(df, heuristic_column)
    probability = numeric_float_series(df, probability_column)
    scorable = issue_prediction_scorable_mask(df)
    add_eligible = issue_add_eligibility_mask(df, label_column)
    if policy == "heuristic-only":
        result = heuristic
    elif policy == "disabled":
        result = pd.Series([0] * len(df), index=df.index)
    elif policy in {"suppress-only", "suppress-only-high-precision"}:
        threshold = 0.25 if suppress_threshold is None else suppress_threshold
        result = ((heuristic == 1) & (probability > threshold)).astype(int)
    elif policy in {"ml-add-only-high-confidence", "hard-negative-safe-add"}:
        threshold = 0.75 if add_threshold is None else add_threshold
        result = ((heuristic == 1) | ((probability >= threshold) & add_eligible)).astype(int)
    elif policy == "suppress-and-add":
        suppress = 0.25 if suppress_threshold is None else suppress_threshold
        add = 0.75 if add_threshold is None else add_threshold
        result = pd.Series(heuristic.tolist(), index=df.index).astype(int)
        result[(heuristic == 1) & (probability <= suppress)] = 0
        result[(heuristic == 0) & (probability >= add) & add_eligible] = 1
    else:
        raise ValueError(f"Unknown issue policy: {policy}")
    return result.where(scorable, 0).astype(int)


def issue_policy_severity_summary(
    validation: pd.DataFrame,
    label_column: str,
    prediction: pd.Series,
) -> dict[str, Any]:
    severity_column = issue_severity_column(label_column)
    if severity_column not in validation.columns:
        return {"available": False}
    result: dict[str, Any] = {"available": True}
    labelled = numeric_int_series(validation, label_column)
    predicted = pd.to_numeric(prediction.reindex(validation.index), errors="coerce").fillna(0).astype(int)
    severities = validation[severity_column].fillna("").astype(str).str.lower()
    for name, accepted in {
        "mildIssues": {"mild"},
        "clearModerateSevereIssues": {"clear", "moderate", "severe"},
        "unknownSeverityIssues": {"", "unknown", "nan", "none"},
    }.items():
        mask = (labelled == 1) & severities.isin(accepted)
        support = int(mask.sum())
        true_positives = int(((predicted == 1) & mask).sum())
        result[name] = {
            "positiveSupport": support,
            "truePositives": true_positives,
            "falseNegatives": int(((predicted == 0) & mask).sum()),
            "recall": 1.0 if support == 0 else true_positives / support,
        }
    return result


def issue_policy_allowed(
    summary: dict[str, Any],
    heuristic_summary: dict[str, Any],
    policy: str,
    args: argparse.Namespace,
) -> bool:
    if policy == "heuristic-only":
        return True
    if policy == "disabled":
        return float(heuristic_summary["f1"]) == 0.0 and int(heuristic_summary["cleanFalsePositiveRows"]) > 0
    if int(summary["hardNegativeFalsePositiveRows"]) > args.issue_policy_hard_negative_fp_row_cap:
        return False
    if int(summary["partialViewCleanFalsePositiveRows"]) > args.issue_policy_partial_view_fp_row_cap:
        return False
    allowed_clean_rows = min(
        int(heuristic_summary["cleanFalsePositiveRows"]),
        args.issue_policy_clean_fp_row_cap,
    )
    if int(summary["cleanFalsePositiveRows"]) > allowed_clean_rows:
        return False
    if int(summary["truePositives"]) > 0 and float(summary["precision"]) < args.issue_policy_min_precision:
        return False
    if int(summary["truePositives"]) == 0 and int(heuristic_summary["truePositives"]) > 0:
        return False
    if float(summary["f1"]) < float(heuristic_summary["f1"]):
        return False
    if policy in {"ml-add-only-high-confidence", "hard-negative-safe-add", "suppress-and-add"}:
        if int(summary["hybridTruePositivesAdded"]) <= 0:
            return False
        if int(summary["hardNegativeFalsePositiveRows"]) > 0:
            return False
    return True


def optimized_issue_policy_candidates(
    validation: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    ml_column: str,
    probability_column: str,
    args: argparse.Namespace,
) -> list[dict[str, Any]]:
    heuristic = numeric_int_series(validation, heuristic_column)
    ml = numeric_int_series(validation, ml_column)
    labelled = numeric_int_series(validation, label_column)
    probability = numeric_float_series(validation, probability_column)
    scorable = issue_prediction_scorable_mask(validation)
    add_eligible = issue_add_eligibility_mask(validation, label_column)
    clean = numeric_int_series(validation, "label_clean") == 1
    hard_negative = hard_negative_mask(validation)
    clean_front = clean_front_mask(validation)
    issue_recording = issue_recording_mask(validation, [label_column])
    partial_view = partial_view_mask(validation)
    severity_column = issue_severity_column(label_column)
    severities = (
        validation[severity_column].fillna("").astype(str).str.lower()
        if severity_column in validation.columns
        else pd.Series([""] * len(validation), index=validation.index)
    )
    candidates: list[dict[str, Any]] = []

    def local_policy_series(policy: str, suppress_threshold: float | None = None, add_threshold: float | None = None) -> pd.Series:
        if policy == "heuristic-only":
            result = heuristic
        elif policy == "disabled":
            result = pd.Series([0] * len(validation), index=validation.index)
        elif policy in {"suppress-only", "suppress-only-high-precision"}:
            threshold = 0.25 if suppress_threshold is None else suppress_threshold
            result = ((heuristic == 1) & (probability > threshold)).astype(int)
        elif policy in {"ml-add-only-high-confidence", "hard-negative-safe-add"}:
            threshold = 0.75 if add_threshold is None else add_threshold
            result = ((heuristic == 1) | ((probability >= threshold) & add_eligible)).astype(int)
        elif policy == "suppress-and-add":
            suppress = 0.25 if suppress_threshold is None else suppress_threshold
            add = 0.75 if add_threshold is None else add_threshold
            result = pd.Series(heuristic.tolist(), index=validation.index).astype(int)
            result[(heuristic == 1) & (probability <= suppress)] = 0
            result[(heuristic == 0) & (probability >= add) & add_eligible] = 1
        else:
            raise ValueError(f"Unknown issue policy: {policy}")
        return result.where(scorable, 0).astype(int)

    def local_severity_summary(prediction: pd.Series) -> dict[str, Any]:
        if severity_column not in validation.columns:
            return {"available": False}
        result: dict[str, Any] = {"available": True}
        for name, accepted in {
            "mildIssues": {"mild"},
            "clearModerateSevereIssues": {"clear", "moderate", "severe"},
            "unknownSeverityIssues": {"", "unknown", "nan", "none"},
        }.items():
            mask = (labelled == 1) & severities.isin(accepted)
            support = int(mask.sum())
            true_positives = int(((prediction == 1) & mask).sum())
            result[name] = {
                "positiveSupport": support,
                "truePositives": true_positives,
                "falseNegatives": int(((prediction == 0) & mask).sum()),
                "recall": 1.0 if support == 0 else true_positives / support,
            }
        return result

    def local_summary(candidate: pd.Series) -> dict[str, Any]:
        metrics = binary_metrics(labelled.tolist(), candidate.tolist())
        transitions = transition_metrics_for_issue(labelled, heuristic, ml, candidate)
        return {
            **metrics,
            **transitions,
            "cleanFalsePositiveRows": int(candidate[clean].sum()),
            "hardNegativeFalsePositiveRows": int(candidate[clean & hard_negative].sum()),
            "cleanFrontFalsePositiveRows": int(candidate[clean & clean_front].sum()),
            "issueRecordingCleanFalsePositiveRows": int(candidate[clean & issue_recording].sum()),
            "partialViewCleanFalsePositiveRows": int(candidate[clean & partial_view].sum()),
            "severity": local_severity_summary(candidate),
        }

    def add_candidate(policy: str, suppress_threshold: float | None = None, add_threshold: float | None = None) -> None:
        prediction = local_policy_series(policy, suppress_threshold, add_threshold)
        summary = local_summary(prediction)
        summary["policy"] = policy
        summary["suppressThreshold"] = suppress_threshold
        summary["addThreshold"] = add_threshold
        candidates.append(summary)

    add_candidate("heuristic-only")
    add_candidate("disabled")
    for threshold in [index / 100 for index in range(5, 51, 5)]:
        add_candidate("suppress-only", suppress_threshold=threshold)
    for threshold in [index / 100 for index in range(5, 31, 5)]:
        add_candidate("suppress-only-high-precision", suppress_threshold=threshold)
    for threshold in [index / 100 for index in range(55, 96, 5)]:
        add_candidate("ml-add-only-high-confidence", add_threshold=threshold)
        add_candidate("hard-negative-safe-add", add_threshold=threshold)
    for suppress_threshold in [index / 100 for index in range(5, 46, 5)]:
        for add_threshold in [index / 100 for index in range(55, 96, 5)]:
            add_candidate("suppress-and-add", suppress_threshold=suppress_threshold, add_threshold=add_threshold)
    return candidates


def choose_optimized_issue_policy(
    validation: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    ml_column: str,
    probability_column: str,
    args: argparse.Namespace,
) -> dict[str, Any]:
    candidates = optimized_issue_policy_candidates(
        validation,
        label_column,
        heuristic_column,
        ml_column,
        probability_column,
        args,
    )
    heuristic_summary = next(candidate for candidate in candidates if candidate["policy"] == "heuristic-only")
    allowed = [
        candidate
        for candidate in candidates
        if issue_policy_allowed(candidate, heuristic_summary, str(candidate["policy"]), args)
    ]
    if not allowed:
        allowed = [heuristic_summary]
    chosen = max(
        allowed,
        key=lambda item: (
            float(item["f1"]),
            float(item["recall"]),
            float(item["precision"]),
            int(item["hybridTruePositivesAdded"]),
            int(item["heuristicFalsePositivesSuppressedByMl"]),
            -int(item["cleanFalsePositiveRows"]),
            -int(item["hardNegativeFalsePositiveRows"]),
            -float(1.0 if item["addThreshold"] is None else item["addThreshold"]),
        ),
    )
    top_candidates = sorted(
        candidates,
        key=lambda item: (
            bool(issue_policy_allowed(item, heuristic_summary, str(item["policy"]), args)),
            float(item["f1"]),
            float(item["recall"]),
            float(item["precision"]),
            -int(item["cleanFalsePositiveRows"]),
            -int(item["hardNegativeFalsePositiveRows"]),
        ),
        reverse=True,
    )[:8]
    return {
        "issueId": issue_name(label_column),
        "selected": chosen["policy"],
        "suppressThreshold": chosen["suppressThreshold"],
        "addThreshold": chosen["addThreshold"],
        "readyForUserFacingFeedback": bool(
            chosen["policy"] not in {"disabled"}
            and int(chosen["hardNegativeFalsePositiveRows"]) <= args.issue_policy_hard_negative_fp_row_cap
            and int(chosen["cleanFalsePositiveRows"]) <= args.issue_policy_clean_fp_row_cap
            and float(chosen["precision"]) >= args.issue_policy_min_precision
            and float(chosen["f1"]) > 0
        ),
        "recommendation": "ready_for_shadow_review" if chosen["policy"] not in {"disabled"} and float(chosen["f1"]) > 0 else "hide_until_more_data",
        "heuristic": heuristic_summary,
        "selectedValidationMetrics": chosen,
        "allowedCandidateCount": len(allowed),
        "candidateCount": len(candidates),
        "topValidationCandidates": top_candidates,
        "gates": {
            "minPrecision": args.issue_policy_min_precision,
            "cleanFpRowCap": args.issue_policy_clean_fp_row_cap,
            "hardNegativeFpRowCap": args.issue_policy_hard_negative_fp_row_cap,
            "partialViewFpRowCap": args.issue_policy_partial_view_fp_row_cap,
        },
    }


def select_optimized_issue_policy_sources(
    df: pd.DataFrame,
    label_columns: list[str],
    model: str,
    heuristic_columns: dict[str, str],
    ml_columns: dict[str, str],
    probability_columns: dict[str, str],
    args: argparse.Namespace,
) -> tuple[dict[str, str], dict[str, Any]]:
    validation = df[df["split"] == "validation"].copy()
    choices: dict[str, Any] = {}
    policy_columns: dict[str, str] = {}
    column_prefix = safe_model_column_part(model)
    policy_part = "optimizedIssueHybrid"
    for label_column in label_columns:
        choice = choose_optimized_issue_policy(
            validation,
            label_column,
            heuristic_columns[label_column],
            ml_columns[label_column],
            probability_columns[label_column],
            args,
        )
        suffix = issue_suffix(label_column)
        output_column = f"eval_{column_prefix}__policy_{safe_model_column_part(policy_part)}__{suffix}"
        df[output_column] = policy_candidate_series(
            df,
            label_column,
            heuristic_columns[label_column],
            probability_columns[label_column],
            str(choice["selected"]),
            choice["suppressThreshold"],
            choice["addThreshold"],
        )
        policy_columns[label_column] = output_column
        choices[label_column] = choice
    return policy_columns, choices


def select_issue_specific_policy_sources(
    df: pd.DataFrame,
    label_columns: list[str],
    candidate_sets: dict[str, dict[str, str]],
    heuristic_columns: dict[str, str],
    ml_columns: dict[str, str],
    mode: str,
    args: argparse.Namespace,
) -> tuple[dict[str, str], dict[str, Any]]:
    validation = df[df["split"] == "validation"].copy()
    choices: dict[str, Any] = {}
    selected: dict[str, str] = {}
    for label_column in label_columns:
        heuristic_column = heuristic_columns[label_column]
        heuristic_summary = issue_candidate_summary(
            validation,
            label_column,
            heuristic_column,
            ml_columns[label_column],
            heuristic_column,
        )
        candidate_summaries = {
            name: issue_candidate_summary(
                validation,
                label_column,
                heuristic_column,
                ml_columns[label_column],
                columns[label_column],
            )
            for name, columns in candidate_sets.items()
        }

        chosen_name = "heuristicOnly"
        if mode == "issueSpecificSuppressOnly":
            suppress = candidate_summaries["suppressOnly"]
            if (
                suppress["heuristicFalsePositivesSuppressedByMl"] > 0
                and suppress["heuristicTruePositivesSuppressedByMl"] == 0
                and float(suppress["f1"]) >= float(heuristic_summary["f1"])
            ):
                chosen_name = "suppressOnly"
        elif mode == "highPrecisionHybrid":
            valid = [
                (name, summary)
                for name, summary in candidate_summaries.items()
                if name != "mlOnly"
                and float(summary["precision"]) >= max(0.8, float(heuristic_summary["precision"]))
                and int(summary["cleanFalsePositiveRows"]) <= int(heuristic_summary["cleanFalsePositiveRows"])
                and int(summary["hardNegativeFalsePositiveRows"]) <= int(heuristic_summary["hardNegativeFalsePositiveRows"])
                and float(summary["f1"]) >= float(heuristic_summary["f1"])
            ]
            if valid:
                chosen_name = max(
                    valid,
                    key=lambda item: (
                        float(item[1]["precision"]),
                        float(item[1]["f1"]),
                        -int(item[1]["cleanFalsePositiveRows"]),
                        int(item[1]["mlOnlyTruePositivesAdded"]),
                    ),
                )[0]
        elif mode == "hardNegativeSafeHybrid":
            valid = [
                (name, summary)
                for name, summary in candidate_summaries.items()
                if name != "mlOnly"
                and int(summary["hardNegativeFalsePositiveRows"]) <= int(heuristic_summary["hardNegativeFalsePositiveRows"])
                and float(summary["hardNegativeFalsePositiveRows"]) <= args.gate_validation_hard_negative_fp_cap * max(1, int(false_positive_slice(validation, [heuristic_column], hard_negative_mask(validation))["cleanRows"]))
                and int(summary["cleanFalsePositiveRows"]) <= int(heuristic_summary["cleanFalsePositiveRows"])
                and float(summary["f1"]) >= float(heuristic_summary["f1"])
            ]
            if valid:
                chosen_name = max(
                    valid,
                    key=lambda item: (
                        float(item[1]["f1"]),
                        float(item[1]["precision"]),
                        -int(item[1]["hardNegativeFalsePositiveRows"]),
                        -int(item[1]["cleanFalsePositiveRows"]),
                        int(item[1]["mlOnlyTruePositivesAdded"]),
                    ),
                )[0]
        else:
            raise ValueError(f"Unknown issue-specific policy mode: {mode}")

        selected[label_column] = candidate_sets[chosen_name][label_column]
        choices[label_column] = {
            "issueId": issue_name(label_column),
            "selected": chosen_name,
            "heuristic": heuristic_summary,
            "candidates": candidate_summaries,
        }
    return selected, choices


def build_policy_prediction_sets(
    df: pd.DataFrame,
    label_columns: list[str],
    model: str,
    heuristic_columns: dict[str, str],
    ml_columns: dict[str, str],
    hybrid_columns: dict[str, str],
    suppression_columns: dict[str, str],
    additive_columns: dict[str, str],
    suppress_and_add_columns: dict[str, str],
    args: argparse.Namespace,
) -> tuple[dict[str, dict[str, str]], dict[str, Any]]:
    base_sets = {
        "heuristicOnly": heuristic_columns,
        "mlOnly": ml_columns,
        "logisticStyleCurrentHybridBaseline": hybrid_columns,
        "suppressOnly": suppression_columns,
        "addOnly": additive_columns,
        "suppressAndAdd": suppress_and_add_columns,
    }
    policies: dict[str, dict[str, str]] = {
        **base_sets,
    }
    selection: dict[str, Any] = {
        "selectionSplit": "validation",
        "issueSpecificChoices": {},
    }
    issue_candidate_sets = {
        "heuristicOnly": heuristic_columns,
        "mlOnly": ml_columns,
        "suppressOnly": suppression_columns,
        "addOnly": additive_columns,
        "suppressAndAdd": suppress_and_add_columns,
    }
    for policy_name in ["issueSpecificSuppressOnly", "highPrecisionHybrid", "hardNegativeSafeHybrid"]:
        selected_sources, choices = select_issue_specific_policy_sources(
            df,
            label_columns,
            issue_candidate_sets,
            heuristic_columns,
            ml_columns,
            policy_name,
            args,
        )
        policies[policy_name] = materialize_issue_policy(df, label_columns, model, policy_name, selected_sources)
        selection["issueSpecificChoices"][policy_name] = choices
    optimized_columns, optimized_choices = select_optimized_issue_policy_sources(
        df,
        label_columns,
        model,
        heuristic_columns,
        ml_columns,
        {
            label_column: f"ml__{model}__{label_column}__prob"
            for label_column in label_columns
        },
        args,
    )
    policies["optimizedIssueHybrid"] = optimized_columns
    selection["issueSpecificChoices"]["optimizedIssueHybrid"] = optimized_choices
    return policies, selection


BARBELL_CURL_GROUPED_FEEDBACK_TARGETS: dict[str, dict[str, Any]] = {
    "label_issue__barbell_curl_rom_issue": {
        "feedbackId": "barbell-curl.ROM_issue",
        "feedbackText": "Use a fuller range of motion.",
        "childLabels": [
            "label_issue__barbell_curl_incomplete_flex",
            "label_issue__barbell_curl_incomplete_extend",
            "label_issue__barbell_curl_incomplete_rom",
        ],
    },
    "label_issue__barbell_curl_shoulder_issue": {
        "feedbackId": "barbell-curl.shoulder_issue",
        "feedbackText": "Avoid using your shoulders to lift the bar.",
        "childLabels": [
            "label_issue__barbell_curl_shoulder_warn",
            "label_issue__barbell_curl_shoulder_fail",
        ],
    },
    "label_issue__barbell_curl_torso_issue": {
        "feedbackId": "barbell-curl.torso_issue",
        "feedbackText": "Keep your torso still.",
        "childLabels": [
            "label_issue__barbell_curl_torso_warn",
            "label_issue__barbell_curl_torso_fail",
        ],
    },
    "label_issue__barbell_curl_tempo_issue": {
        "feedbackId": "barbell-curl.tempo_issue",
        "feedbackText": "Control the speed of the rep.",
        "childLabels": [
            "label_issue__barbell_curl_tempo_up",
            "label_issue__barbell_curl_tempo_down",
        ],
    },
}


BARBELL_CURL_GROUPED_DIRECT_EVIDENCE_FEATURES: dict[str, list[str]] = {
    "label_issue__barbell_curl_rom_issue": [
        "feature__diagnostic.cue.barbell_curl_incomplete_flex.margin",
        "feature__diagnostic.cue.barbell_curl_incomplete_extend.margin",
        "feature__diagnostic.cue.barbell_curl_incomplete_rom.margin",
        "feature__diagnostic.metric.romshortfallevidence.value",
        "feature__v2.rom.extension.selected_arm.bottom_shortfall_from_0_92.p50",
        "feature__v2.rom.extension.selected_arm.bottom_shortfall_from_0_92.p75",
        "feature__v2.rom.extension.selected_arm.bottom_shortfall_from_0_92.max",
        "feature__v2.rom.extension.selected_arm.bottom_shortfall_from_0_95.p50",
        "feature__v2.rom.extension.selected_arm.short_extension_below_0_88.support_ratio",
        "feature__v2.rom.extension.selected_arm.short_extension_below_0_90.support_ratio",
        "feature__v2.rom.extension.selected_arm.extension_shortfall_above_0_04.support_ratio",
        "feature__v2.rom.extension.selected_arm.normalized_shortfall_from_0_92",
        "feature__v2.rom.extension.bilateral.bottom_shortfall_from_0_92.p50",
        "feature__v2.rom.extension.bilateral.bottom_shortfall_from_0_92.p75",
        "feature__v2.rom.extension.left_right_bottom_ratio_diff",
        "feature__v2.rom.extension.selected_vs_bilateral_bottom_ratio_diff",
    ],
    "label_issue__barbell_curl_torso_issue": [
        "feature__diagnostic.cue.barbell_curl_torso_warn.margin",
        "feature__diagnostic.cue.barbell_curl_torso_fail.margin",
        "feature__diagnostic.metric.torsodelta.value",
        "feature__diagnostic.metric.torsodeltaraw.value",
        "feature__v2.torso.robust_abs_delta_p90_minus_p10",
        "feature__v2.torso.robust_abs_delta_p95_minus_p05",
        "feature__v2.torso.robust_abs_delta_p75_minus_p25",
        "feature__v2.torso.raw_vs_robust_spike_ratio",
        "feature__v2.torso.full.abs_lean_deg.range",
        "feature__v2.torso.full.abs_lean_deg.p90",
        "feature__v2.torso.full.abs_lean_deg.p95",
        "feature__v2.torso.full.robust_abs_delta_p90_minus_p10",
        "feature__v2.torso.full.robust_abs_delta_p95_minus_p05",
        "feature__v2.torso.full.sustained_lean_above_3deg.support_ratio",
        "feature__v2.torso.full.sustained_lean_above_5deg.support_ratio",
        "feature__v2.torso.full.sustained_lean_above_8deg.longest_run_frames",
        "feature__v2.torso.concentric.abs_lean_deg.range",
        "feature__v2.torso.concentric.abs_lean_deg.p90",
        "feature__v2.torso.concentric.abs_lean_deg.p95",
        "feature__v2.torso.concentric.robust_abs_delta_p90_minus_p10",
        "feature__v2.torso.concentric.sustained_lean_above_5deg.support_ratio",
        "feature__v2.torso.concentric.sustained_lean_above_8deg.longest_run_frames",
        "feature__v2.torso.concentric.sustained_lean_frames",
        "feature__v2.torso.eccentric.abs_lean_deg.range",
        "feature__v2.torso.eccentric.abs_lean_deg.p90",
        "feature__v2.torso.eccentric.abs_lean_deg.p95",
        "feature__v2.torso.eccentric.robust_abs_delta_p90_minus_p10",
        "feature__v2.torso.eccentric.sustained_lean_above_5deg.support_ratio",
        "feature__v2.torso.eccentric.sustained_lean_above_8deg.longest_run_frames",
        "feature__v2.torso.eccentric.sustained_lean_frames",
    ],
    "label_issue__barbell_curl_shoulder_issue": [
        "feature__diagnostic.cue.barbell_curl_shoulder_warn.margin",
        "feature__diagnostic.cue.barbell_curl_shoulder_fail.margin",
        "feature__diagnostic.metric.shoulderdelta.value",
        "feature__diagnostic.metric.primaryshoulderdelta.value",
        "feature__diagnostic.metric.leftshoulderdelta.value",
        "feature__diagnostic.metric.rightshoulderdelta.value",
        "feature__v2.shoulder.full.drift.p90",
        "feature__v2.shoulder.full.drift.p95",
        "feature__v2.shoulder.full.drift.range",
        "feature__v2.shoulder.full.sustained_drift_frames",
        "feature__v2.shoulder.full.drift_above_0_03.support_ratio",
        "feature__v2.shoulder.full.drift_above_0_05.support_ratio",
        "feature__v2.shoulder.full.relative_to_hip_drift.p90",
        "feature__v2.shoulder.full.relative_to_hip_drift.p95",
        "feature__v2.shoulder.full.relative_to_hip_drift_above_0_03.support_ratio",
        "feature__v2.shoulder.full.upper_arm_angle_change.selected.p90",
        "feature__v2.shoulder.full.upper_arm_angle_change.selected_above_8deg.support_ratio",
        "feature__v2.shoulder.concentric.drift.p90",
        "feature__v2.shoulder.concentric.drift.p95",
        "feature__v2.shoulder.concentric.sustained_drift_frames",
        "feature__v2.shoulder.concentric.drift_above_0_03.support_ratio",
        "feature__v2.shoulder.concentric.relative_to_hip_drift.p90",
        "feature__v2.shoulder.concentric.relative_to_hip_drift.p95",
        "feature__v2.shoulder.concentric.relative_to_hip_drift_above_0_03.support_ratio",
        "feature__v2.shoulder.concentric.upper_arm_angle_change.selected.p90",
        "feature__v2.shoulder.concentric.upper_arm_angle_change.selected_above_8deg.support_ratio",
        "feature__v2.shoulder.top_endpoint.drift.p90",
        "feature__v2.shoulder.top_endpoint.drift.p95",
        "feature__v2.shoulder.top_endpoint.sustained_drift_frames",
        "feature__v2.shoulder.top_endpoint.relative_to_hip_drift.p90",
        "feature__v2.shoulder.top_endpoint.relative_to_hip_drift.p95",
        "feature__v2.shoulder.top_endpoint.upper_arm_angle_change.selected.p90",
        "feature__v2.shoulder.top_half.drift.p90",
        "feature__v2.shoulder.top_half.relative_to_hip_drift.p90",
        "feature__v2.shoulder.top_half.upper_arm_angle_change.selected.p90",
    ],
    "label_issue__barbell_curl_tempo_issue": [
        "feature__diagnostic.cue.barbell_curl_tempo_up.margin",
        "feature__diagnostic.cue.barbell_curl_tempo_down.margin",
        "feature__diagnostic.metric.tup.value",
        "feature__diagnostic.metric.tdown.value",
        "feature__v2.tempo.fast_up_evidence",
        "feature__v2.tempo.fast_down_evidence",
        "feature__v2.tempo.fast_up_duration_shortfall_1100ms",
        "feature__v2.tempo.fast_down_duration_shortfall_1100ms",
        "feature__v2.tempo.concentric.wrist_velocity.p90",
        "feature__v2.tempo.concentric.wrist_velocity.max",
        "feature__v2.tempo.concentric.fast_evidence",
        "feature__v2.tempo.concentric.sustained_fast_evidence",
        "feature__v2.tempo.concentric.duration_shortfall_900ms",
        "feature__v2.tempo.concentric.duration_shortfall_1100ms",
        "feature__v2.tempo.concentric.reliable_wrist_velocity.p90",
        "feature__v2.tempo.eccentric.wrist_velocity.p90",
        "feature__v2.tempo.eccentric.wrist_velocity.max",
        "feature__v2.tempo.eccentric.fast_evidence",
        "feature__v2.tempo.eccentric.sustained_fast_evidence",
        "feature__v2.tempo.eccentric.duration_shortfall_900ms",
        "feature__v2.tempo.eccentric.duration_shortfall_1100ms",
        "feature__v2.tempo.eccentric.reliable_wrist_velocity.p90",
        "feature__v2.tempo.duration_balance_abs_log_ratio",
    ],
}


def review_annotation_template() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "description": "Offline-only grouped-feedback review annotations. These never mutate label files and only affect product-tolerant reporting metrics when passed to ml:evaluate with --review-annotations.",
        "annotations": [
            {
                "recordingId": "val08-hard-negative-front",
                "repIndex": 2,
                "startMs": 11250,
                "endMs": 13500,
                "acceptableBorderlineGroups": ["shoulder_issue"],
                "acceptableBorderlineIssues": ["barbell-curl.shoulder_warn"],
                "unacceptableGroups": [],
                "possibleLabelAmbiguity": False,
                "needsVisualReview": False,
                "reviewerNotes": "Mild shoulder assistance; acceptable as a light grouped shoulder warning.",
            }
        ],
    }


def group_token(value: str) -> str:
    token = str(value).strip().lower()
    token = token.removeprefix("label_issue__")
    token = token.replace("barbell-curl.", "")
    token = token.replace("barbell_curl.", "")
    token = token.replace("barbell_curl_", "")
    token = token.replace("-", "_")
    return token


def grouped_label_for_review_name(value: Any) -> str | None:
    token = group_token(str(value))
    for label_column, config in BARBELL_CURL_GROUPED_FEEDBACK_TARGETS.items():
        if token == group_token(label_column) or token == group_token(config["feedbackId"]):
            return label_column
        for child_label in config["childLabels"]:
            if token == group_token(child_label) or token == group_token(issue_name(child_label)):
                return label_column
    return None


def recording_id_for_review(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    return Path(text).stem


def row_recording_ids(row: pd.Series) -> set[str]:
    ids: set[str] = set()
    for column in ["source_video", "recording_file", "label_file"]:
        if column in row.index:
            ids.add(recording_id_for_review(row.get(column)))
    return {item for item in ids if item}


def int_or_none(value: Any) -> int | None:
    try:
        if pd.isna(value):
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def normalize_review_group_list(values: Any, warnings_out: list[str], field: str) -> list[str]:
    if values is None:
        return []
    if not isinstance(values, list):
        warnings_out.append(f"{field} should be a list; ignoring value.")
        return []
    groups: list[str] = []
    for value in values:
        group = grouped_label_for_review_name(value)
        if group is None:
            warnings_out.append(f"Unknown grouped feedback annotation value in {field}: {value}")
            continue
        if group not in groups:
            groups.append(group)
    return groups


def load_review_annotations(path: str | None) -> dict[str, Any]:
    if not path:
        return {
            "provided": False,
            "path": None,
            "annotations": [],
            "warnings": [],
            "template": review_annotation_template(),
        }
    annotation_path = Path(path)
    if not annotation_path.exists():
        raise SystemExit(f"Review annotations file not found: {annotation_path}")
    try:
        payload = json.loads(annotation_path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid review annotations JSON: {annotation_path}: {exc}") from exc
    warnings_out: list[str] = []
    raw_annotations = payload.get("annotations", [])
    if not isinstance(raw_annotations, list):
        raise SystemExit("Review annotations JSON must contain an annotations array.")
    annotations: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_annotations):
        if not isinstance(raw, dict):
            warnings_out.append(f"Annotation {index} is not an object; ignoring it.")
            continue
        recording_id = recording_id_for_review(raw.get("recordingId") or raw.get("sourceVideo") or raw.get("recordingFile") or raw.get("labelFile"))
        if not recording_id:
            warnings_out.append(f"Annotation {index} is missing recordingId/sourceVideo/recordingFile/labelFile; ignoring it.")
            continue
        acceptable_groups = normalize_review_group_list(raw.get("acceptableBorderlineGroups"), warnings_out, f"annotations[{index}].acceptableBorderlineGroups")
        acceptable_groups_from_issues = normalize_review_group_list(raw.get("acceptableBorderlineIssues"), warnings_out, f"annotations[{index}].acceptableBorderlineIssues")
        unacceptable_groups = normalize_review_group_list(raw.get("unacceptableGroups"), warnings_out, f"annotations[{index}].unacceptableGroups")
        annotations.append({
            "recordingId": recording_id,
            "repIndex": int_or_none(raw.get("repIndex")),
            "startMs": int_or_none(raw.get("startMs")),
            "endMs": int_or_none(raw.get("endMs")),
            "acceptableBorderlineGroups": sorted(set(acceptable_groups + acceptable_groups_from_issues)),
            "unacceptableGroups": sorted(set(unacceptable_groups)),
            "possibleLabelAmbiguity": bool(raw.get("possibleLabelAmbiguity", False)),
            "needsVisualReview": bool(raw.get("needsVisualReview", False)),
            "reviewerNotes": raw.get("reviewerNotes") or raw.get("notes") or "",
        })
    return {
        "provided": True,
        "path": str(annotation_path),
        "schemaVersion": payload.get("schemaVersion"),
        "annotations": annotations,
        "annotationCount": len(annotations),
        "warnings": warnings_out,
        "template": review_annotation_template(),
    }


def review_annotation_matches_row(annotation: dict[str, Any], row: pd.Series) -> bool:
    if annotation["recordingId"] not in row_recording_ids(row):
        return False
    rep_index = annotation.get("repIndex")
    if rep_index is not None and int_or_none(row.get("rep_index")) != rep_index:
        return False
    start_ms = annotation.get("startMs")
    if start_ms is not None and int_or_none(row.get("expected_start_ms")) != start_ms:
        return False
    end_ms = annotation.get("endMs")
    if end_ms is not None and int_or_none(row.get("expected_end_ms")) != end_ms:
        return False
    return True


def row_review_annotations(row: pd.Series, review_annotations: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        annotation
        for annotation in review_annotations.get("annotations", [])
        if review_annotation_matches_row(annotation, row)
    ]


def review_status_for_group(row: pd.Series, label_column: str, review_annotations: dict[str, Any]) -> dict[str, Any]:
    matches = row_review_annotations(row, review_annotations)
    explicit_unacceptable = any(label_column in annotation.get("unacceptableGroups", []) for annotation in matches)
    acceptable_borderline = any(label_column in annotation.get("acceptableBorderlineGroups", []) for annotation in matches)
    possible_label_ambiguity = any(bool(annotation.get("possibleLabelAmbiguity")) for annotation in matches)
    needs_visual_review = any(bool(annotation.get("needsVisualReview")) for annotation in matches)
    notes = [
        str(annotation.get("reviewerNotes"))
        for annotation in matches
        if annotation.get("reviewerNotes")
    ]
    if explicit_unacceptable:
        category = "unacceptable"
    elif acceptable_borderline:
        category = "acceptable_borderline"
    elif possible_label_ambiguity:
        category = "possible_label_ambiguity"
    elif needs_visual_review:
        category = "needs_visual_review"
    else:
        category = "unannotated"
    return {
        "category": category,
        "acceptableBorderline": acceptable_borderline and not explicit_unacceptable,
        "explicitUnacceptable": explicit_unacceptable,
        "possibleLabelAmbiguity": possible_label_ambiguity,
        "needsVisualReview": needs_visual_review,
        "reviewerNotes": notes,
    }


def tolerant_metric_values(tp: int, fp: int, fn: int) -> dict[str, Any]:
    precision = 1.0 if tp + fp == 0 else tp / (tp + fp)
    recall = 1.0 if tp + fn == 0 else tp / (tp + fn)
    f1 = 0.0 if precision + recall == 0 else (2 * precision * recall) / (precision + recall)
    return {
        "truePositives": tp,
        "falsePositives": fp,
        "falseNegatives": fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
    }


def tolerant_grouped_policy_metrics(
    df: pd.DataFrame,
    grouped_labels: list[str],
    prediction_columns: dict[str, str],
    review_annotations: dict[str, Any],
) -> dict[str, Any]:
    all_tp = 0
    all_fp = 0
    all_fn = 0
    strict_all_tp = 0
    strict_all_fp = 0
    strict_all_fn = 0
    per_group: dict[str, Any] = {}
    clean = numeric_int_series(df, "label_clean") == 1
    hard_negative = hard_negative_mask(df)
    strict_clean_rows: set[Any] = set()
    strict_hard_negative_rows: set[Any] = set()
    unacceptable_clean_rows: set[Any] = set()
    unacceptable_hard_negative_rows: set[Any] = set()
    acceptable_clean_rows: set[Any] = set()
    acceptable_hard_negative_rows: set[Any] = set()
    possible_ambiguity_rows: set[Any] = set()
    visual_review_rows: set[Any] = set()
    examples: list[dict[str, Any]] = []

    for label_column in grouped_labels:
        prediction_column = prediction_columns[label_column]
        truth = numeric_int_series(df, label_column)
        pred = numeric_int_series(df, prediction_column)
        group_tp = 0
        group_fp = 0
        group_fn = 0
        strict_group_tp = 0
        strict_group_fp = 0
        strict_group_fn = 0
        acceptable_count = 0
        unacceptable_count = 0
        hard_acceptable_count = 0
        hard_unacceptable_count = 0
        strict_hard_count = 0
        strict_clean_count = 0
        for index, row in df.iterrows():
            y = int(truth.loc[index])
            p = int(pred.loc[index])
            if y == 1 and p == 1:
                group_tp += 1
                strict_group_tp += 1
            elif y == 1 and p == 0:
                group_fn += 1
                strict_group_fn += 1
            elif y == 0 and p == 1:
                strict_group_fp += 1
                status = review_status_for_group(row, label_column, review_annotations)
                is_clean = bool(clean.loc[index])
                is_hard_negative = bool(hard_negative.loc[index])
                if is_clean:
                    strict_clean_count += 1
                    strict_clean_rows.add(index)
                if is_hard_negative and is_clean:
                    strict_hard_count += 1
                    strict_hard_negative_rows.add(index)
                if status["possibleLabelAmbiguity"]:
                    possible_ambiguity_rows.add(index)
                if status["needsVisualReview"]:
                    visual_review_rows.add(index)
                if status["acceptableBorderline"]:
                    acceptable_count += 1
                    if is_clean:
                        acceptable_clean_rows.add(index)
                    if is_hard_negative and is_clean:
                        acceptable_hard_negative_rows.add(index)
                        hard_acceptable_count += 1
                else:
                    group_fp += 1
                    unacceptable_count += 1
                    if is_clean:
                        unacceptable_clean_rows.add(index)
                    if is_hard_negative and is_clean:
                        unacceptable_hard_negative_rows.add(index)
                        hard_unacceptable_count += 1
                if is_hard_negative and is_clean:
                    examples.append({
                        "sourceVideo": row.get("source_video"),
                        "labelFile": row.get("label_file"),
                        "recordingFile": row.get("recording_file"),
                        "repIndex": int_or_none(row.get("rep_index")),
                        "startMs": int_or_none(row.get("expected_start_ms")),
                        "endMs": int_or_none(row.get("expected_end_ms")),
                        "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
                        "strictFalsePositive": True,
                        "tolerantCategory": status["category"],
                        "reviewerNotes": status["reviewerNotes"],
                    })
        all_tp += group_tp
        all_fp += group_fp
        all_fn += group_fn
        strict_all_tp += strict_group_tp
        strict_all_fp += strict_group_fp
        strict_all_fn += strict_group_fn
        per_group[label_column] = {
            "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
            "strict": tolerant_metric_values(strict_group_tp, strict_group_fp, strict_group_fn),
            "tolerant": tolerant_metric_values(group_tp, group_fp, group_fn),
            "strictCleanFalsePositivePredictions": strict_clean_count,
            "strictHardNegativeFalsePositivePredictions": strict_hard_count,
            "acceptableBorderlinePredictions": acceptable_count,
            "hardNegativeAcceptableBorderlinePredictions": hard_acceptable_count,
            "unacceptableFalsePositivePredictions": unacceptable_count,
            "hardNegativeUnacceptableFalsePositivePredictions": hard_unacceptable_count,
        }

    clean_rows = int(clean.sum())
    hard_negative_clean_rows = int((clean & hard_negative).sum())
    return {
        "available": bool(review_annotations.get("provided")),
        "strictAggregate": tolerant_metric_values(strict_all_tp, strict_all_fp, strict_all_fn),
        "tolerantAggregate": tolerant_metric_values(all_tp, all_fp, all_fn),
        "strictCleanFalsePositiveRows": len(strict_clean_rows),
        "strictCleanFalsePositiveRate": 0.0 if clean_rows == 0 else len(strict_clean_rows) / clean_rows,
        "cleanUnacceptableFalsePositiveRows": len(unacceptable_clean_rows),
        "cleanUnacceptableFalsePositiveRate": 0.0 if clean_rows == 0 else len(unacceptable_clean_rows) / clean_rows,
        "cleanAcceptableBorderlineWarningRows": len(acceptable_clean_rows),
        "cleanAcceptableBorderlineWarningRate": 0.0 if clean_rows == 0 else len(acceptable_clean_rows) / clean_rows,
        "strictHardNegativeFalsePositiveRows": len(strict_hard_negative_rows),
        "strictHardNegativeFalsePositiveRate": 0.0 if hard_negative_clean_rows == 0 else len(strict_hard_negative_rows) / hard_negative_clean_rows,
        "hardNegativeUnacceptableFalsePositiveRows": len(unacceptable_hard_negative_rows),
        "hardNegativeUnacceptableFalsePositiveRate": 0.0 if hard_negative_clean_rows == 0 else len(unacceptable_hard_negative_rows) / hard_negative_clean_rows,
        "hardNegativeAcceptableBorderlineWarningRows": len(acceptable_hard_negative_rows),
        "hardNegativeAcceptableBorderlineWarningRate": 0.0 if hard_negative_clean_rows == 0 else len(acceptable_hard_negative_rows) / hard_negative_clean_rows,
        "possibleLabelAmbiguityRows": len(possible_ambiguity_rows),
        "needsVisualReviewRows": len(visual_review_rows),
        "cleanRows": clean_rows,
        "hardNegativeCleanRows": hard_negative_clean_rows,
        "perGroup": per_group,
        "hardNegativeExamples": examples[:30],
        "definition": "Product-tolerant metrics keep strict metrics unchanged, but remove manually annotated acceptable-borderline grouped warnings from the unacceptable false-positive count. Possible ambiguity and visual-review annotations are reported but remain unacceptable unless also marked acceptableBorderline.",
    }


def grouped_tolerant_policy_comparison(
    df: pd.DataFrame,
    grouped_labels: list[str],
    policy_columns: dict[str, dict[str, str]],
    review_annotations: dict[str, Any],
) -> dict[str, Any]:
    if not review_annotations.get("provided"):
        return {
            "available": False,
            "reason": "No --review-annotations sidecar provided.",
        }
    reports: dict[str, Any] = {}
    for split in ["train", "validation", "test"]:
        subset = df[df["split"] == split].copy()
        if len(subset) == 0:
            continue
        reports[split] = {
            policy_name: tolerant_grouped_policy_metrics(subset, grouped_labels, columns, review_annotations)
            for policy_name, columns in policy_columns.items()
        }
    return {
        "available": True,
        "selectionSplit": "validation",
        "testUsage": "final_reporting_only",
        "splits": reports,
    }


def grouped_feedback_label_columns(label_columns: list[str]) -> list[str]:
    return [
        label_column
        for label_column in BARBELL_CURL_GROUPED_FEEDBACK_TARGETS
        if label_column in label_columns
    ]


def grouped_feedback_probability_columns(grouped_labels: list[str], model: str) -> dict[str, str]:
    return {
        label_column: f"ml__{model}__{label_column}__prob"
        for label_column in grouped_labels
    }


def grouped_feedback_eligibility_columns(df: pd.DataFrame, label_column: str) -> list[str]:
    config = BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]
    columns: list[str] = []
    for child_label in config["childLabels"]:
        suffix = issue_suffix(child_label)
        for column in [
            f"feature__scorable.issue.{suffix}",
            f"feature__diagnostic.cue.{suffix}.eligible",
        ]:
            if column in df.columns:
                columns.append(column)
    return columns


def grouped_feedback_eligibility_mask(df: pd.DataFrame, label_column: str) -> pd.Series:
    mask = issue_prediction_scorable_mask(df)
    child_masks: list[pd.Series] = []
    config = BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]
    for child_label in config["childLabels"]:
        suffix = issue_suffix(child_label)
        child_mask = pd.Series([True] * len(df), index=df.index)
        found_child_feature = False
        for column in [
            f"feature__scorable.issue.{suffix}",
            f"feature__diagnostic.cue.{suffix}.eligible",
        ]:
            if column in df.columns:
                found_child_feature = True
                child_mask = child_mask & (numeric_float_series(df, column, 0.0) >= 0.5)
        if found_child_feature:
            child_masks.append(child_mask)
    if not child_masks:
        return mask
    child_eligible = child_masks[0]
    for child_mask in child_masks[1:]:
        child_eligible = child_eligible | child_mask
    return mask & child_eligible


def grouped_threshold_series(
    df: pd.DataFrame,
    label_column: str,
    probability_column: str,
    threshold: float | None,
) -> pd.Series:
    if threshold is None or probability_column not in df.columns:
        return pd.Series([0] * len(df), index=df.index)
    probabilities = numeric_float_series(df, probability_column)
    eligible = grouped_feedback_eligibility_mask(df, label_column)
    return ((probabilities >= threshold) & eligible).astype(int)


def materialize_grouped_policy_columns(
    df: pd.DataFrame,
    grouped_labels: list[str],
    model: str,
    policy_name: str,
    series_by_label: dict[str, pd.Series],
) -> dict[str, str]:
    column_prefix = safe_model_column_part(model)
    policy_part = safe_model_column_part(policy_name)
    columns: dict[str, str] = {}
    for label_column in grouped_labels:
        suffix = issue_suffix(label_column)
        output_column = f"eval_{column_prefix}__grouped_{policy_part}__{suffix}"
        df[output_column] = pd.to_numeric(series_by_label[label_column].reindex(df.index), errors="coerce").fillna(0).astype(int)
        columns[label_column] = output_column
    return columns


def collapsed_child_policy_series(
    df: pd.DataFrame,
    label_column: str,
    source_columns: dict[str, str],
) -> pd.Series:
    config = BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]
    result = pd.Series([0] * len(df), index=df.index)
    for child_label in config["childLabels"]:
        source_column = source_columns.get(child_label)
        if source_column and source_column in df.columns:
            result = (result | (numeric_int_series(df, source_column) == 1)).astype(int)
    return result.where(issue_prediction_scorable_mask(df), 0).astype(int)


def grouped_candidate_summary_from_series(
    validation: pd.DataFrame,
    label_column: str,
    heuristic: pd.Series,
    ml: pd.Series,
    candidate: pd.Series,
) -> dict[str, Any]:
    summary = issue_candidate_summary_from_series(validation, label_column, heuristic, ml, candidate)
    summary["severity"] = issue_policy_severity_summary(validation, label_column, candidate)
    return summary


def grouped_policy_allowed(summary: dict[str, Any], args: argparse.Namespace) -> bool:
    if int(summary["hardNegativeFalsePositiveRows"]) > args.grouped_policy_hard_negative_fp_row_cap:
        return False
    if int(summary["partialViewCleanFalsePositiveRows"]) > args.grouped_policy_partial_view_fp_row_cap:
        return False
    if int(summary["cleanFalsePositiveRows"]) > args.grouped_policy_clean_fp_row_cap:
        return False
    if int(summary["truePositives"]) <= 0:
        return False
    if float(summary["precision"]) < args.grouped_policy_min_precision:
        return False
    return True


def grouped_clear_recall(summary: dict[str, Any]) -> float:
    severity = summary.get("severity", {})
    clear = severity.get("clearModerateSevereIssues", {}) if isinstance(severity, dict) else {}
    return float(clear.get("recall", 0.0))


def disabled_grouped_candidate(
    validation: pd.DataFrame,
    label_column: str,
    heuristic: pd.Series,
    ml: pd.Series,
) -> dict[str, Any]:
    candidate = pd.Series([0] * len(validation), index=validation.index)
    summary = grouped_candidate_summary_from_series(validation, label_column, heuristic, ml, candidate)
    summary.update({
        "policy": "disabled",
        "threshold": None,
        "allowed": False,
        "disabledReason": "No validation threshold passed grouped safety gates with a true positive.",
    })
    return summary


def tolerant_grouped_candidate_summary_from_series(
    validation: pd.DataFrame,
    label_column: str,
    heuristic: pd.Series,
    ml: pd.Series,
    candidate: pd.Series,
    review_annotations: dict[str, Any],
) -> dict[str, Any]:
    strict_summary = grouped_candidate_summary_from_series(validation, label_column, heuristic, ml, candidate)
    candidate_column = f"__tolerant_candidate_{issue_suffix(label_column)}"
    tmp = validation.copy()
    tmp[candidate_column] = pd.to_numeric(candidate.reindex(validation.index), errors="coerce").fillna(0).astype(int)
    tolerant_summary = tolerant_grouped_policy_metrics(
        tmp,
        [label_column],
        {label_column: candidate_column},
        review_annotations,
    )
    per_group = tolerant_summary.get("perGroup", {}).get(label_column, {})
    tolerant_issue = per_group.get("tolerant", {}) if isinstance(per_group, dict) else {}
    strict_issue = per_group.get("strict", {}) if isinstance(per_group, dict) else {}
    merged = dict(strict_summary)
    merged.update({
        "strictMetrics": {
            "truePositives": strict_summary["truePositives"],
            "falsePositives": strict_summary["falsePositives"],
            "falseNegatives": strict_summary["falseNegatives"],
            "precision": strict_summary["precision"],
            "recall": strict_summary["recall"],
            "f1": strict_summary["f1"],
            "cleanFalsePositiveRows": strict_summary["cleanFalsePositiveRows"],
            "hardNegativeFalsePositiveRows": strict_summary["hardNegativeFalsePositiveRows"],
            "partialViewCleanFalsePositiveRows": strict_summary["partialViewCleanFalsePositiveRows"],
        },
        "tolerantMetrics": tolerant_summary,
        "tolerantTruePositives": int(tolerant_issue.get("truePositives", 0)),
        "tolerantFalsePositives": int(tolerant_issue.get("falsePositives", 0)),
        "tolerantFalseNegatives": int(tolerant_issue.get("falseNegatives", 0)),
        "tolerantPrecision": float(tolerant_issue.get("precision", 0.0)),
        "tolerantRecall": float(tolerant_issue.get("recall", 0.0)),
        "tolerantF1": float(tolerant_issue.get("f1", 0.0)),
        "strictTruePositives": int(strict_issue.get("truePositives", strict_summary["truePositives"])),
        "strictFalsePositives": int(strict_issue.get("falsePositives", strict_summary["falsePositives"])),
        "strictFalseNegatives": int(strict_issue.get("falseNegatives", strict_summary["falseNegatives"])),
        "strictPrecision": float(strict_issue.get("precision", strict_summary["precision"])),
        "strictRecall": float(strict_issue.get("recall", strict_summary["recall"])),
        "strictF1": float(strict_issue.get("f1", strict_summary["f1"])),
        "strictCleanFalsePositiveRows": int(tolerant_summary.get("strictCleanFalsePositiveRows", strict_summary["cleanFalsePositiveRows"])),
        "cleanUnacceptableFalsePositiveRows": int(tolerant_summary.get("cleanUnacceptableFalsePositiveRows", strict_summary["cleanFalsePositiveRows"])),
        "cleanAcceptableBorderlineWarningRows": int(tolerant_summary.get("cleanAcceptableBorderlineWarningRows", 0)),
        "strictHardNegativeFalsePositiveRows": int(tolerant_summary.get("strictHardNegativeFalsePositiveRows", strict_summary["hardNegativeFalsePositiveRows"])),
        "hardNegativeUnacceptableFalsePositiveRows": int(tolerant_summary.get("hardNegativeUnacceptableFalsePositiveRows", strict_summary["hardNegativeFalsePositiveRows"])),
        "hardNegativeAcceptableBorderlineWarningRows": int(tolerant_summary.get("hardNegativeAcceptableBorderlineWarningRows", 0)),
    })
    return merged


def grouped_tolerant_policy_allowed(summary: dict[str, Any], args: argparse.Namespace) -> bool:
    if int(summary["hardNegativeUnacceptableFalsePositiveRows"]) > args.grouped_policy_hard_negative_fp_row_cap:
        return False
    if int(summary["partialViewCleanFalsePositiveRows"]) > args.grouped_policy_partial_view_fp_row_cap:
        return False
    if int(summary["cleanUnacceptableFalsePositiveRows"]) > args.grouped_policy_clean_fp_row_cap:
        return False
    if int(summary["tolerantTruePositives"]) <= 0:
        return False
    if float(summary["tolerantPrecision"]) < args.grouped_policy_min_precision:
        return False
    return True


def grouped_threshold_candidates(
    validation: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    ml_column: str,
    probability_column: str,
    args: argparse.Namespace,
) -> list[dict[str, Any]]:
    heuristic = numeric_int_series(validation, heuristic_column)
    ml = numeric_int_series(validation, ml_column)
    candidates: list[dict[str, Any]] = []
    for threshold in [index / 100 for index in range(50, 100)]:
        prediction = grouped_threshold_series(validation, label_column, probability_column, threshold)
        summary = grouped_candidate_summary_from_series(validation, label_column, heuristic, ml, prediction)
        summary.update({
            "policy": "ml-threshold",
            "threshold": threshold,
            "allowed": grouped_policy_allowed(summary, args),
        })
        candidates.append(summary)
    candidates.append(disabled_grouped_candidate(validation, label_column, heuristic, ml))
    return candidates


def grouped_tolerant_threshold_candidates(
    validation: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    ml_column: str,
    probability_column: str,
    args: argparse.Namespace,
    review_annotations: dict[str, Any],
) -> list[dict[str, Any]]:
    heuristic = numeric_int_series(validation, heuristic_column)
    ml = numeric_int_series(validation, ml_column)
    candidates: list[dict[str, Any]] = []
    for threshold in [index / 100 for index in range(50, 100)]:
        prediction = grouped_threshold_series(validation, label_column, probability_column, threshold)
        summary = tolerant_grouped_candidate_summary_from_series(
            validation,
            label_column,
            heuristic,
            ml,
            prediction,
            review_annotations,
        )
        summary.update({
            "policy": "ml-threshold-tolerant-optimized",
            "threshold": threshold,
            "allowed": grouped_tolerant_policy_allowed(summary, args),
        })
        candidates.append(summary)
    disabled = disabled_grouped_candidate(validation, label_column, heuristic, ml)
    disabled.update({
        "tolerantMetrics": tolerant_grouped_policy_metrics(
            validation.assign(**{f"__disabled_{issue_suffix(label_column)}": 0}),
            [label_column],
            {label_column: f"__disabled_{issue_suffix(label_column)}"},
            review_annotations,
        ),
        "tolerantTruePositives": 0,
        "tolerantFalsePositives": 0,
        "tolerantFalseNegatives": disabled["falseNegatives"],
        "tolerantPrecision": 1.0,
        "tolerantRecall": 0.0,
        "tolerantF1": 0.0,
        "strictCleanFalsePositiveRows": 0,
        "cleanUnacceptableFalsePositiveRows": 0,
        "cleanAcceptableBorderlineWarningRows": 0,
        "strictHardNegativeFalsePositiveRows": 0,
        "hardNegativeUnacceptableFalsePositiveRows": 0,
        "hardNegativeAcceptableBorderlineWarningRows": 0,
    })
    candidates.append(disabled)
    return candidates


def choose_grouped_threshold_policy(
    validation: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    ml_column: str,
    probability_column: str,
    args: argparse.Namespace,
    mode: str,
) -> dict[str, Any]:
    candidates = grouped_threshold_candidates(
        validation,
        label_column,
        heuristic_column,
        ml_column,
        probability_column,
        args,
    )
    allowed = [candidate for candidate in candidates if bool(candidate.get("allowed"))]
    if not allowed:
        chosen = next(candidate for candidate in candidates if candidate["policy"] == "disabled")
    elif mode == "conservative":
        chosen = max(
            allowed,
            key=lambda item: (
                float(item["precision"]),
                -int(item["cleanFalsePositiveRows"]),
                -int(item["hardNegativeFalsePositiveRows"]),
                grouped_clear_recall(item),
                float(item["f1"]),
                float(item["recall"]),
                float(item["threshold"]),
            ),
        )
    elif mode == "strict":
        chosen = max(
            allowed,
            key=lambda item: (
                float(item["f1"]),
                grouped_clear_recall(item),
                float(item["recall"]),
                float(item["precision"]),
                -int(item["cleanFalsePositiveRows"]),
                -int(item["hardNegativeFalsePositiveRows"]),
                float(item["threshold"]),
            ),
        )
    else:
        raise ValueError(f"Unknown grouped threshold mode: {mode}")
    return {
        "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
        "labelColumn": label_column,
        "feedbackText": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackText"],
        "selected": chosen["policy"],
        "threshold": chosen["threshold"],
        "validationMetrics": chosen,
        "allowedCandidateCount": len(allowed),
        "candidateCount": len(candidates),
        "topValidationCandidates": sorted(
            candidates,
            key=lambda item: (
                bool(item.get("allowed")),
                float(item["f1"]),
                grouped_clear_recall(item),
                float(item["precision"]),
                -int(item["cleanFalsePositiveRows"]),
                -int(item["hardNegativeFalsePositiveRows"]),
                0.0 if item["threshold"] is None else float(item["threshold"]),
            ),
            reverse=True,
        )[:8],
    }


def choose_grouped_tolerant_threshold_policy(
    validation: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    ml_column: str,
    probability_column: str,
    args: argparse.Namespace,
    review_annotations: dict[str, Any],
) -> dict[str, Any]:
    candidates = grouped_tolerant_threshold_candidates(
        validation,
        label_column,
        heuristic_column,
        ml_column,
        probability_column,
        args,
        review_annotations,
    )
    allowed = [candidate for candidate in candidates if bool(candidate.get("allowed"))]
    if not allowed:
        chosen = next(candidate for candidate in candidates if candidate["policy"] == "disabled")
    else:
        chosen = max(
            allowed,
            key=lambda item: (
                float(item["tolerantF1"]),
                grouped_clear_recall(item),
                float(item["tolerantRecall"]),
                float(item["tolerantPrecision"]),
                -int(item["cleanUnacceptableFalsePositiveRows"]),
                -int(item["hardNegativeUnacceptableFalsePositiveRows"]),
                -int(item["cleanAcceptableBorderlineWarningRows"]),
                float(item["strictF1"]),
                0.0 if item["threshold"] is None else float(item["threshold"]),
            ),
        )
    return {
        "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
        "labelColumn": label_column,
        "feedbackText": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackText"],
        "selected": chosen["policy"],
        "threshold": chosen["threshold"],
        "validationMetrics": chosen,
        "allowedCandidateCount": len(allowed),
        "candidateCount": len(candidates),
        "selectionMetric": "validation tolerant F1 with unacceptable clean/hard-negative FP gates; test is final reporting only",
        "topValidationCandidates": sorted(
            candidates,
            key=lambda item: (
                bool(item.get("allowed")),
                float(item.get("tolerantF1", 0.0)),
                grouped_clear_recall(item),
                float(item.get("tolerantRecall", 0.0)),
                float(item.get("tolerantPrecision", 0.0)),
                -int(item.get("cleanUnacceptableFalsePositiveRows", 0)),
                -int(item.get("hardNegativeUnacceptableFalsePositiveRows", 0)),
                -int(item.get("cleanAcceptableBorderlineWarningRows", 0)),
                float(item.get("strictF1", item.get("f1", 0.0))),
                0.0 if item.get("threshold") is None else float(item["threshold"]),
            ),
            reverse=True,
        )[:8],
    }


def direct_evidence_thresholds(validation: pd.DataFrame, column: str, base_prediction: pd.Series) -> list[float]:
    values = pd.to_numeric(validation[column], errors="coerce")
    base_mask = pd.to_numeric(base_prediction.reindex(validation.index), errors="coerce").fillna(0).astype(int) == 1
    candidate_values = values[base_mask & values.notna()]
    if len(candidate_values) == 0:
        candidate_values = values[values.notna()]
    if len(candidate_values) == 0:
        return []
    unique_values = sorted({float(value) for value in candidate_values.tolist()})
    if len(unique_values) <= 25:
        return unique_values
    quantiles = candidate_values.quantile([index / 20 for index in range(0, 20)] + [0.975]).dropna()
    return sorted({float(value) for value in quantiles.tolist()})


def grouped_direct_evidence_candidates(
    validation: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    ml_column: str,
    base_prediction: pd.Series,
    args: argparse.Namespace,
    review_annotations: dict[str, Any],
) -> list[dict[str, Any]]:
    heuristic = numeric_int_series(validation, heuristic_column)
    ml = numeric_int_series(validation, ml_column)
    base = pd.to_numeric(base_prediction.reindex(validation.index), errors="coerce").fillna(0).astype(int)
    candidates: list[dict[str, Any]] = []
    for evidence_column in BARBELL_CURL_GROUPED_DIRECT_EVIDENCE_FEATURES.get(label_column, []):
        if evidence_column not in validation.columns:
            continue
        evidence = pd.to_numeric(validation[evidence_column], errors="coerce")
        for threshold in direct_evidence_thresholds(validation, evidence_column, base):
            prediction = (base == 1) & (evidence.fillna(float("-inf")) >= threshold)
            summary = tolerant_grouped_candidate_summary_from_series(
                validation,
                label_column,
                heuristic,
                ml,
                prediction.astype(int),
                review_annotations,
            )
            summary.update({
                "policy": "direct-evidence-gated",
                "threshold": threshold,
                "evidenceColumn": evidence_column,
                "allowed": grouped_tolerant_policy_allowed(summary, args),
            })
            candidates.append(summary)
    base_summary = tolerant_grouped_candidate_summary_from_series(
        validation,
        label_column,
        heuristic,
        ml,
        base,
        review_annotations,
    )
    base_summary.update({
        "policy": "no-direct-evidence-gate",
        "threshold": None,
        "evidenceColumn": None,
        "allowed": grouped_tolerant_policy_allowed(base_summary, args),
    })
    candidates.append(base_summary)
    return candidates


def choose_grouped_direct_evidence_gate_policy(
    validation: pd.DataFrame,
    label_column: str,
    heuristic_column: str,
    ml_column: str,
    base_prediction: pd.Series,
    args: argparse.Namespace,
    review_annotations: dict[str, Any],
) -> dict[str, Any]:
    if label_column not in BARBELL_CURL_GROUPED_DIRECT_EVIDENCE_FEATURES:
        base_summary = tolerant_grouped_candidate_summary_from_series(
            validation,
            label_column,
            numeric_int_series(validation, heuristic_column),
            numeric_int_series(validation, ml_column),
            pd.to_numeric(base_prediction.reindex(validation.index), errors="coerce").fillna(0).astype(int),
            review_annotations,
        )
        return {
            "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
            "labelColumn": label_column,
            "feedbackText": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackText"],
            "selected": "base-tolerant-optimized",
            "threshold": None,
            "evidenceColumn": None,
            "validationMetrics": base_summary,
            "allowedCandidateCount": 0,
            "candidateCount": 0,
            "selectionMetric": "No direct-evidence gate configured for this grouped feedback.",
            "topValidationCandidates": [],
        }
    candidates = grouped_direct_evidence_candidates(
        validation,
        label_column,
        heuristic_column,
        ml_column,
        base_prediction,
        args,
        review_annotations,
    )
    gated_allowed = [
        candidate
        for candidate in candidates
        if bool(candidate.get("allowed")) and candidate.get("policy") == "direct-evidence-gated"
    ]
    if gated_allowed:
        chosen = max(
            gated_allowed,
            key=lambda item: (
                float(item["tolerantF1"]),
                -int(item["cleanUnacceptableFalsePositiveRows"]),
                -int(item["hardNegativeUnacceptableFalsePositiveRows"]),
                grouped_clear_recall(item),
                float(item["tolerantRecall"]),
                float(item["tolerantPrecision"]),
                float(item["strictF1"]),
                0.0 if item["threshold"] is None else float(item["threshold"]),
            ),
        )
    else:
        chosen = next(candidate for candidate in candidates if candidate["policy"] == "no-direct-evidence-gate")
        chosen = dict(chosen)
        chosen["fallbackReason"] = "No direct-evidence gate passed validation safety gates."
    return {
        "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
        "labelColumn": label_column,
        "feedbackText": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackText"],
        "selected": chosen["policy"],
        "threshold": chosen.get("threshold"),
        "evidenceColumn": chosen.get("evidenceColumn"),
        "validationMetrics": chosen,
        "allowedCandidateCount": len(gated_allowed),
        "candidateCount": len(candidates),
        "selectionMetric": "Validation-selected direct evidence gate where configured; test is final reporting only.",
        "topValidationCandidates": sorted(
            candidates,
            key=lambda item: (
                bool(item.get("allowed")),
                item.get("policy") == "direct-evidence-gated",
                float(item.get("tolerantF1", 0.0)),
                -int(item.get("cleanUnacceptableFalsePositiveRows", 0)),
                -int(item.get("hardNegativeUnacceptableFalsePositiveRows", 0)),
                grouped_clear_recall(item),
                float(item.get("tolerantRecall", 0.0)),
                float(item.get("tolerantPrecision", 0.0)),
                float(item.get("strictF1", item.get("f1", 0.0))),
                0.0 if item.get("threshold") is None else float(item["threshold"]),
            ),
            reverse=True,
        )[:8],
    }


def apply_grouped_direct_evidence_gate(
    df: pd.DataFrame,
    label_column: str,
    base_prediction: pd.Series,
    choice: dict[str, Any],
) -> pd.Series:
    evidence_column = choice.get("evidenceColumn")
    threshold = choice.get("threshold")
    base = pd.to_numeric(base_prediction.reindex(df.index), errors="coerce").fillna(0).astype(int)
    if not evidence_column or threshold is None or evidence_column not in df.columns:
        return base
    evidence = pd.to_numeric(df[evidence_column], errors="coerce").fillna(float("-inf"))
    return ((base == 1) & (evidence >= float(threshold))).astype(int)


def group_source_series(df: pd.DataFrame) -> pd.Series:
    for column in ["source_video", "recording_file", "label_file"]:
        if column in df.columns:
            return df[column].fillna("unknown").astype(str)
    return pd.Series([str(index) for index in df.index], index=df.index)


def recording_family_name(value: Any) -> str:
    stem = Path(str(value or "unknown")).stem.lower()
    patterns = [
        ("hard-negative", "hard-negative"),
        ("clean-front", "clean-front"),
        ("clean", "clean"),
        ("focus-flex", "focus-flex"),
        ("focus-extend", "focus-extend"),
        ("focus-shoulder", "focus-shoulder"),
        ("focus-torso", "focus-torso"),
        ("tempo", "tempo"),
        ("multi-hard", "multi-hard"),
        ("multi", "multi"),
        ("combined", "combined"),
        ("partial", "partial-view"),
        ("occluded", "partial-view"),
    ]
    for token, family in patterns:
        if token in stem:
            return family
    return stem or "unknown"


def set_level_grouped_metrics(
    df: pd.DataFrame,
    grouped_labels: list[str],
    series_by_label: dict[str, pd.Series],
) -> dict[str, Any]:
    source_values = group_source_series(df)
    all_truth: list[int] = []
    all_pred: list[int] = []
    per_group: dict[str, Any] = {}
    rows: list[dict[str, Any]] = []
    clean = numeric_int_series(df, "label_clean") == 1
    hard_negative = hard_negative_mask(df)
    partial = partial_view_mask(df)
    for label_column in grouped_labels:
        truth_values: list[int] = []
        pred_values: list[int] = []
        clean_negative_groups = 0
        clean_false_positive_groups = 0
        all_clean_negative_groups = 0
        all_clean_false_positive_groups = 0
        hard_negative_groups = 0
        hard_negative_false_positive_groups = 0
        partial_negative_groups = 0
        partial_false_positive_groups = 0
        prediction = pd.to_numeric(series_by_label[label_column].reindex(df.index), errors="coerce").fillna(0).astype(int)
        for source, indexes in source_values.groupby(source_values).groups.items():
            index_list = list(indexes)
            truth = int(numeric_int_series(df.loc[index_list], label_column).sum() > 0)
            pred = int(prediction.loc[index_list].sum() > 0)
            truth_values.append(truth)
            pred_values.append(pred)
            all_truth.append(truth)
            all_pred.append(pred)
            group_clean = int(truth == 0)
            group_all_clean = bool(clean.loc[index_list].all())
            group_hard_negative = bool(hard_negative.loc[index_list].any())
            group_partial = bool(partial.loc[index_list].any())
            if group_clean:
                clean_negative_groups += 1
                clean_false_positive_groups += int(pred == 1)
            if group_clean and group_all_clean:
                all_clean_negative_groups += 1
                all_clean_false_positive_groups += int(pred == 1)
            if group_clean and group_hard_negative:
                hard_negative_groups += 1
                hard_negative_false_positive_groups += int(pred == 1)
            if group_clean and group_partial:
                partial_negative_groups += 1
                partial_false_positive_groups += int(pred == 1)
            if truth != pred:
                rows.append({
                    "sourceVideo": str(source),
                    "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
                    "truth": truth,
                    "predicted": pred,
                    "isAllCleanRecording": group_all_clean,
                    "isHardNegative": group_hard_negative,
                    "isPartialView": group_partial,
                })
        metrics = binary_metrics(truth_values, pred_values)
        per_group[label_column] = {
            **metrics,
            "feedbackId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
            "cleanNegativeGroups": clean_negative_groups,
            "cleanFalsePositiveGroups": clean_false_positive_groups,
            "cleanFalsePositiveRate": 0.0 if clean_negative_groups == 0 else clean_false_positive_groups / clean_negative_groups,
            "allCleanNegativeGroups": all_clean_negative_groups,
            "allCleanFalsePositiveGroups": all_clean_false_positive_groups,
            "allCleanFalsePositiveRate": 0.0 if all_clean_negative_groups == 0 else all_clean_false_positive_groups / all_clean_negative_groups,
            "hardNegativeCleanGroups": hard_negative_groups,
            "hardNegativeFalsePositiveGroups": hard_negative_false_positive_groups,
            "hardNegativeFalsePositiveRate": 0.0 if hard_negative_groups == 0 else hard_negative_false_positive_groups / hard_negative_groups,
            "partialViewNegativeGroups": partial_negative_groups,
            "partialViewFalsePositiveGroups": partial_false_positive_groups,
            "partialViewFalsePositiveRate": 0.0 if partial_negative_groups == 0 else partial_false_positive_groups / partial_negative_groups,
        }
    aggregate = binary_metrics(all_truth, all_pred)
    return {
        "aggregate": aggregate,
        "perGroup": per_group,
        "mismatchedGroups": rows[:30],
        "definition": "Set-level metrics treat each source-video/grouped-feedback pair as one target. cleanNegativeGroups means the source-video has no label for that grouped feedback; allCleanNegativeGroups also requires all reps in the source-video to be label_clean=1.",
    }


def set_backup_grouped_series(
    df: pd.DataFrame,
    grouped_labels: list[str],
    probability_columns: dict[str, str],
    threshold: float,
    min_reps: int,
) -> dict[str, pd.Series]:
    source_values = group_source_series(df)
    result: dict[str, pd.Series] = {}
    for label_column in grouped_labels:
        base = grouped_threshold_series(df, label_column, probability_columns[label_column], threshold)
        prediction = pd.Series([0] * len(df), index=df.index)
        for _source, indexes in source_values.groupby(source_values).groups.items():
            index_list = list(indexes)
            if int(base.loc[index_list].sum()) >= min_reps:
                prediction.loc[index_list] = 1
        result[label_column] = prediction.astype(int)
    return result


def combine_grouped_series(
    grouped_labels: list[str],
    left: dict[str, pd.Series],
    right: dict[str, pd.Series],
) -> dict[str, pd.Series]:
    return {
        label_column: (
            pd.to_numeric(left[label_column], errors="coerce").fillna(0).astype(int)
            | pd.to_numeric(right[label_column], errors="coerce").fillna(0).astype(int)
        ).astype(int)
        for label_column in grouped_labels
    }


def grouped_split_reports(
    df: pd.DataFrame,
    grouped_labels: list[str],
    policy_columns: dict[str, dict[str, str]],
    probability_columns: dict[str, str],
) -> dict[str, Any]:
    reports: dict[str, Any] = {}
    for split in ["train", "validation", "test"]:
        subset = df[df["split"] == split].copy()
        if len(subset) == 0:
            continue
        reports[split] = {
            policy_name: evaluate_prediction_set(subset, grouped_labels, columns, probability_columns)
            for policy_name, columns in policy_columns.items()
        }
    return reports


def grouped_policy_transition_reports(
    df: pd.DataFrame,
    grouped_labels: list[str],
    heuristic_columns: dict[str, str],
    ml_columns: dict[str, str],
    policy_columns: dict[str, dict[str, str]],
) -> dict[str, Any]:
    reports: dict[str, Any] = {}
    for split in ["train", "validation", "test"]:
        subset = df[df["split"] == split].copy()
        if len(subset) == 0:
            continue
        reports[split] = {
            policy_name: hybrid_transition_metrics(
                subset,
                grouped_labels,
                heuristic_columns,
                ml_columns,
                columns,
            )
            for policy_name, columns in policy_columns.items()
            if policy_name not in {"heuristicGrouped", "mlOnlyGrouped"}
        }
    return reports


def grouped_policy_feedback_row_reports(
    df: pd.DataFrame,
    policy_columns: dict[str, dict[str, str]],
) -> dict[str, Any]:
    reports: dict[str, Any] = {}
    clean = numeric_int_series(df, "label_clean") == 1
    for split in ["train", "validation", "test"]:
        subset = df[df["split"] == split].copy()
        if len(subset) == 0:
            continue
        split_clean = clean.loc[subset.index]
        reports[split] = {}
        for policy_name, columns in policy_columns.items():
            prediction_columns = [column for column in columns.values() if column in subset.columns]
            if not prediction_columns:
                reports[split][policy_name] = {
                    "rows": int(len(subset)),
                    "feedbackRows": 0,
                    "feedbackRate": 0.0,
                    "cleanFeedbackRows": 0,
                    "cleanFeedbackRate": 0.0,
                }
                continue
            predicted_any = (
                subset[prediction_columns]
                .apply(pd.to_numeric, errors="coerce")
                .fillna(0)
                .astype(int)
                .sum(axis=1)
                > 0
            )
            clean_rows = int(split_clean.sum())
            clean_feedback_rows = int((predicted_any & split_clean).sum())
            reports[split][policy_name] = {
                "rows": int(len(subset)),
                "feedbackRows": int(predicted_any.sum()),
                "feedbackRate": 0.0 if len(subset) == 0 else float(predicted_any.mean()),
                "cleanRows": clean_rows,
                "cleanFeedbackRows": clean_feedback_rows,
                "cleanFeedbackRate": 0.0 if clean_rows == 0 else clean_feedback_rows / clean_rows,
            }
    return reports


def quantile_from_sorted(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    index = min(len(values) - 1, max(0, int(len(values) * fraction)))
    return float(values[index])


def recording_bootstrap_grouped_metrics(
    df: pd.DataFrame,
    grouped_labels: list[str],
    prediction_columns: dict[str, str],
    iterations: int = 100,
) -> dict[str, Any]:
    if len(df) == 0:
        return {"available": False, "reason": "empty_split"}
    source_values = group_source_series(df)
    source_groups = {source: list(indexes) for source, indexes in source_values.groupby(source_values).groups.items()}
    sources = sorted(source_groups.keys())
    if len(sources) < 2:
        return {"available": False, "reason": "fewer_than_two_recordings", "recordingCount": len(sources)}
    rng = random.Random(42)
    f1_values: list[float] = []
    precision_values: list[float] = []
    recall_values: list[float] = []
    clean_fp_values: list[float] = []
    hard_negative_values: list[float] = []
    clear_recall_values: list[float] = []
    for _ in range(iterations):
        sample_indexes: list[int] = []
        for _source in sources:
            sampled_source = rng.choice(sources)
            sample_indexes.extend(source_groups[sampled_source])
        sample = df.loc[sample_indexes]
        report = evaluate_prediction_set(sample, grouped_labels, prediction_columns)
        aggregate = report["aggregate"]
        f1_values.append(float(aggregate["f1"]))
        precision_values.append(float(aggregate["precision"]))
        recall_values.append(float(aggregate["recall"]))
        clean_fp_values.append(float(report["cleanRepFalsePositiveRate"]))
        hard_negative_values.append(float(report["safety"]["slices"]["hardNegativeClean"]["falsePositiveRate"]))
        clear_recall_values.append(float(report["severity"]["groups"]["clearModerateSevereIssues"]["recall"]))
    summaries: dict[str, Any] = {}
    for name, values in [
        ("f1", f1_values),
        ("precision", precision_values),
        ("recall", recall_values),
        ("cleanFalsePositiveRate", clean_fp_values),
        ("hardNegativeFalsePositiveRate", hard_negative_values),
        ("clearRecall", clear_recall_values),
    ]:
        values.sort()
        summaries[name] = {
            "p05": quantile_from_sorted(values, 0.05),
            "p50": quantile_from_sorted(values, 0.50),
            "p95": quantile_from_sorted(values, 0.95),
        }
    return {
        "available": True,
        "iterations": iterations,
        "unit": "recording",
        "recordingCount": len(sources),
        **summaries,
    }


def leave_one_recording_out_grouped_metrics(
    df: pd.DataFrame,
    grouped_labels: list[str],
    prediction_columns: dict[str, str],
    review_annotations: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if len(df) == 0:
        return {"available": False, "reason": "empty_split"}
    source_values = group_source_series(df)
    source_groups = {source: list(indexes) for source, indexes in source_values.groupby(source_values).groups.items()}
    sources = sorted(source_groups.keys())
    if len(sources) < 2:
        return {"available": False, "reason": "fewer_than_two_recordings", "recordingCount": len(sources)}

    full_report = evaluate_prediction_set(df, grouped_labels, prediction_columns)
    full_aggregate = full_report["aggregate"]
    full_f1 = float(full_aggregate["f1"])
    rows: list[dict[str, Any]] = []
    for source in sources:
        omitted_indexes = source_groups[source]
        subset = df.drop(index=omitted_indexes).copy()
        if len(subset) == 0:
            continue
        report = evaluate_prediction_set(subset, grouped_labels, prediction_columns)
        aggregate = report["aggregate"]
        hard_negative = report["safety"]["slices"]["hardNegativeClean"]
        clean_slice = report["safety"]["slices"]["allClean"]
        clear = report["severity"]["groups"]["clearModerateSevereIssues"]
        tolerant: dict[str, Any] | None = None
        if review_annotations and review_annotations.get("provided"):
            tolerant = tolerant_grouped_policy_metrics(subset, grouped_labels, prediction_columns, review_annotations)
        rows.append({
            "omittedRecording": str(source),
            "remainingRows": int(len(subset)),
            "precision": float(aggregate["precision"]),
            "recall": float(aggregate["recall"]),
            "f1": float(aggregate["f1"]),
            "f1DeltaFromFull": float(aggregate["f1"]) - full_f1,
            "cleanFalsePositiveRate": float(report["cleanRepFalsePositiveRate"]),
            "cleanFalsePositiveRows": int(clean_slice["falsePositiveRows"]),
            "hardNegativeFalsePositiveRate": float(hard_negative["falsePositiveRate"]),
            "hardNegativeFalsePositiveRows": int(hard_negative["falsePositiveRows"]),
            "unacceptableCleanFalsePositiveRows": int(tolerant.get("cleanUnacceptableFalsePositiveRows", clean_slice["falsePositiveRows"])) if tolerant else int(clean_slice["falsePositiveRows"]),
            "unacceptableHardNegativeFalsePositiveRows": int(tolerant.get("hardNegativeUnacceptableFalsePositiveRows", hard_negative["falsePositiveRows"])) if tolerant else int(hard_negative["falsePositiveRows"]),
            "clearRecall": float(clear["recall"]),
        })

    def metric_stats(key: str) -> dict[str, Any]:
        values = sorted(float(row[key]) for row in rows)
        if not values:
            return {"min": 0.0, "p50": 0.0, "max": 0.0}
        return {
            "min": values[0],
            "p50": quantile_from_sorted(values, 0.50),
            "max": values[-1],
        }

    return {
        "available": True,
        "unit": "recording",
        "recordingCount": len(sources),
        "fullF1": full_f1,
        "f1": metric_stats("f1"),
        "precision": metric_stats("precision"),
        "recall": metric_stats("recall"),
        "cleanFalsePositiveRate": metric_stats("cleanFalsePositiveRate"),
        "hardNegativeFalsePositiveRate": metric_stats("hardNegativeFalsePositiveRate"),
        "clearRecall": metric_stats("clearRecall"),
        "maxUnacceptableCleanFalsePositiveRows": max((int(row["unacceptableCleanFalsePositiveRows"]) for row in rows), default=0),
        "maxUnacceptableHardNegativeFalsePositiveRows": max((int(row["unacceptableHardNegativeFalsePositiveRows"]) for row in rows), default=0),
        "mostSensitiveOmissions": sorted(rows, key=lambda row: (float(row["f1"]), float(row["precision"])))[:5],
    }


def grouped_policy_recording_concentration(
    df: pd.DataFrame,
    grouped_labels: list[str],
    prediction_columns: dict[str, str],
) -> dict[str, Any]:
    if len(df) == 0:
        return {"available": False, "reason": "empty_split"}
    source_values = group_source_series(df)
    family_values = source_values.map(recording_family_name)
    prediction_frame = (
        df[list(prediction_columns.values())]
        .apply(pd.to_numeric, errors="coerce")
        .fillna(0)
        .astype(int)
    )
    truth_frame = df[grouped_labels].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
    predicted_any = prediction_frame.sum(axis=1) > 0
    true_positive_any = ((prediction_frame.values == 1) & (truth_frame.values == 1)).any(axis=1)
    false_positive_any = ((prediction_frame.values == 1) & (truth_frame.values == 0)).any(axis=1)

    by_family: list[dict[str, Any]] = []
    for family in sorted(family_values.unique()):
        mask = family_values == family
        by_family.append({
            "family": str(family),
            "rows": int(mask.sum()),
            "feedbackRows": int((predicted_any & mask).sum()),
            "truePositiveRows": int((pd.Series(true_positive_any, index=df.index) & mask).sum()),
            "falsePositiveRows": int((pd.Series(false_positive_any, index=df.index) & mask).sum()),
        })
    feedback_total = int(predicted_any.sum())
    true_positive_total = int(pd.Series(true_positive_any, index=df.index).sum())
    by_feedback = sorted(by_family, key=lambda item: (-item["feedbackRows"], item["family"]))
    by_true_positive = sorted(by_family, key=lambda item: (-item["truePositiveRows"], item["family"]))
    return {
        "available": True,
        "familyCount": len(by_family),
        "feedbackRows": feedback_total,
        "truePositiveRows": true_positive_total,
        "topFeedbackFamily": by_feedback[0] if by_feedback else None,
        "topFeedbackFamilyShare": 0.0 if feedback_total == 0 or not by_feedback else by_feedback[0]["feedbackRows"] / feedback_total,
        "topTruePositiveFamily": by_true_positive[0] if by_true_positive else None,
        "topTruePositiveFamilyShare": 0.0 if true_positive_total == 0 or not by_true_positive else by_true_positive[0]["truePositiveRows"] / true_positive_total,
        "byFamily": by_family,
    }


def grouped_policy_stability_reports(
    df: pd.DataFrame,
    grouped_labels: list[str],
    policy_columns: dict[str, dict[str, str]],
    splits: list[str] | None = None,
    iterations: int = 100,
) -> dict[str, Any]:
    reports: dict[str, Any] = {}
    for split in (splits or ["train", "validation", "test"]):
        subset = df[df["split"] == split].copy()
        if len(subset) == 0:
            continue
        reports[split] = {}
        for policy_name, columns in policy_columns.items():
            reports[split][policy_name] = {
                "recordingBootstrap": recording_bootstrap_grouped_metrics(subset, grouped_labels, columns, iterations),
                "leaveOneRecordingOut": leave_one_recording_out_grouped_metrics(subset, grouped_labels, columns),
                "recordingFamilyConcentration": grouped_policy_recording_concentration(subset, grouped_labels, columns),
        }
    return reports


def grouped_policy_combination_candidate_specs(models_available: list[str]) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = [
        {
            "candidateId": "heuristicGrouped",
            "sourceModel": None,
            "policy": "heuristicGrouped",
            "description": "Current grouped heuristic baseline.",
        },
        {
            "candidateId": "disabledGroup",
            "sourceModel": None,
            "policy": "disabledGroup",
            "description": "No prediction for this grouped cue.",
        },
    ]
    available = set(models_available)
    rep_level_policies = [
        "repLevelConservative",
        "repLevelTolerantOptimized",
        "repLevelTolerantOptimizedDirectEvidenceGate",
    ]
    preferred_model_order = [
        "logistic",
        "logistic_l1",
        "logistic_l2_strong",
        "logistic_elasticnet",
        "random_forest",
        "hist_gradient",
    ]
    ordered_models = [
        model
        for model in preferred_model_order
        if model in available
    ] + [
        model
        for model in sorted(available)
        if model not in preferred_model_order
    ]
    for model in ordered_models:
        is_feature_subset_model = "group_subset" in model or "pruned_all" in model
        model_rep_level_policies = (
            ["repLevelConservative", "repLevelTolerantOptimized"]
            if is_feature_subset_model
            else rep_level_policies
        )
        for policy in model_rep_level_policies:
            specs.append({
                "candidateId": f"{model}.{policy}",
                "sourceModel": model,
                "policy": policy,
                "description": f"{model} grouped-feedback policy {policy}.",
            })
        if not is_feature_subset_model and model in {"logistic", "logistic_l1", "logistic_l2_strong", "logistic_elasticnet"}:
            specs.append({
                "candidateId": f"{model}.fineOptimizedCollapsedToGroups",
                "sourceModel": model,
                "policy": "fineOptimizedCollapsedToGroups",
                "description": f"{model} grouped-feedback policy fineOptimizedCollapsedToGroups.",
            })
        backup_policies = [] if is_feature_subset_model else ["repLevelPlusSetBackupBroadcast"]
        for policy in backup_policies:
            specs.append({
                "candidateId": f"{model}.{policy}",
                "sourceModel": model,
                "policy": policy,
                "description": f"{model} grouped-feedback secondary set-level/backup policy {policy}.",
            })
    return specs


def grouped_policy_column_name(model: str, policy_name: str, label_column: str) -> str:
    return (
        f"eval_{safe_model_column_part(model)}__grouped_"
        f"{safe_model_column_part(policy_name)}__{issue_suffix(label_column)}"
    )


def grouped_policy_probability_column(source_model: str | None, label_column: str, df: pd.DataFrame) -> str | None:
    if not source_model:
        return None
    column = f"ml__{source_model}__{label_column}__prob"
    return column if column in df.columns else None


def materialize_cross_model_grouped_policy_candidates(
    df: pd.DataFrame,
    label_columns: list[str],
    grouped_labels: list[str],
    args: argparse.Namespace,
    review_annotations: dict[str, Any],
    models_available: list[str],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    specs = grouped_policy_combination_candidate_specs(models_available)
    candidates: dict[str, dict[str, Any]] = {}
    warnings_out: list[dict[str, Any]] = []

    heuristic_columns: dict[str, str] = {}
    for label_column in grouped_labels:
        source_column = f"heuristic_issue__{label_column.removeprefix('label_issue__')}"
        if source_column not in df.columns:
            source_column = f"eval_combined__heuristic_missing__{issue_suffix(label_column)}"
            df[source_column] = 0
        heuristic_columns[label_column] = source_column
    candidates["heuristicGrouped"] = {
        "candidateId": "heuristicGrouped",
        "sourceModel": None,
        "policy": "heuristicGrouped",
        "columns": heuristic_columns,
        "probabilityColumns": {label_column: None for label_column in grouped_labels},
        "description": "Current grouped heuristic baseline.",
    }

    disabled_columns: dict[str, str] = {}
    for label_column in grouped_labels:
        disabled_column = f"eval_combined__grouped_disabled__{issue_suffix(label_column)}"
        df[disabled_column] = 0
        disabled_columns[label_column] = disabled_column
    candidates["disabledGroup"] = {
        "candidateId": "disabledGroup",
        "sourceModel": None,
        "policy": "disabledGroup",
        "columns": disabled_columns,
        "probabilityColumns": {label_column: None for label_column in grouped_labels},
        "description": "No prediction for this grouped cue.",
    }

    materialized_by_model: dict[str, pd.DataFrame | None] = {}
    materialization_errors: dict[str, str] = {}
    specs_by_model: dict[str, list[dict[str, Any]]] = {}
    for spec in specs:
        if spec.get("sourceModel"):
            specs_by_model.setdefault(str(spec["sourceModel"]), []).append(spec)
    for source_model in sorted({str(spec["sourceModel"]) for spec in specs if spec.get("sourceModel")}):
        model_specs = specs_by_model.get(source_model, [])
        needs_fine_policy = any(spec.get("policy") == "fineOptimizedCollapsedToGroups" for spec in model_specs)
        needs_direct_evidence = any(spec.get("policy") == "repLevelTolerantOptimizedDirectEvidenceGate" for spec in model_specs)
        missing_probabilities = [
            f"ml__{source_model}__{label_column}__prob"
            for label_column in grouped_labels
            if f"ml__{source_model}__{label_column}__prob" not in df.columns
        ]
        if missing_probabilities:
            warnings_out.append({
                "sourceModel": source_model,
                "reason": "missing_grouped_probability_columns",
                "missingColumns": missing_probabilities,
            })
            materialized_by_model[source_model] = None
            materialization_errors[source_model] = "missing_grouped_probability_columns"
            continue
        working = df.copy()
        try:
            model_columns = prepare_model_predictions(working, label_columns, source_model, args)
            # Fine-label optimized policy columns are required before grouped collapse.
            if needs_fine_policy:
                split_reports_for_model(working, label_columns, model_columns, args, source_model, include_bootstrap=False)
            build_grouped_feedback_report(
                working,
                label_columns,
                model_columns,
                args,
                source_model,
                review_annotations,
                include_bottleneck_analysis=False,
                include_direct_evidence_search=needs_direct_evidence,
                stability_splits=["validation"],
                stability_iterations=5,
                include_policy_combination=False,
            )
        except Exception as exc:  # pragma: no cover - defensive report generation path
            warnings_out.append({
                "sourceModel": source_model,
                "reason": "candidate_materialization_failed",
                "error": str(exc),
            })
            materialized_by_model[source_model] = None
            materialization_errors[source_model] = str(exc)
            continue
        materialized_by_model[source_model] = working

    for spec in specs:
        source_model = spec.get("sourceModel")
        policy_name = spec["policy"]
        candidate_id = spec["candidateId"]
        if not source_model:
            continue
        working = materialized_by_model.get(str(source_model))
        if working is None:
            warnings_out.append({
                "candidateId": candidate_id,
                "sourceModel": source_model,
                "reason": materialization_errors.get(str(source_model), "candidate_materialization_failed"),
            })
            continue
        columns: dict[str, str] = {}
        for label_column in grouped_labels:
            source_column = grouped_policy_column_name(source_model, policy_name, label_column)
            if source_column not in working.columns:
                warnings_out.append({
                    "candidateId": candidate_id,
                    "reason": "missing_materialized_policy_column",
                    "missingColumn": source_column,
                })
                columns = {}
                break
            df[source_column] = pd.to_numeric(working[source_column], errors="coerce").fillna(0).astype(int)
            columns[label_column] = source_column
        if not columns:
            continue
        candidates[candidate_id] = {
            "candidateId": candidate_id,
            "sourceModel": source_model,
            "policy": policy_name,
            "columns": columns,
            "probabilityColumns": {
                label_column: grouped_policy_probability_column(source_model, label_column, df)
                for label_column in grouped_labels
            },
            "description": spec.get("description"),
        }

    return candidates, warnings_out


def grouped_single_label_robust_assessment(summary: dict[str, Any]) -> dict[str, Any]:
    bootstrap = summary.get("recordingBootstrap", {})
    leave_one_out = summary.get("leaveOneRecordingOut", {})
    concentration = summary.get("recordingFamilyConcentration", {})
    bootstrap_f1 = bootstrap.get("f1", {}) if isinstance(bootstrap, dict) else {}
    bootstrap_precision = bootstrap.get("precision", {}) if isinstance(bootstrap, dict) else {}
    bootstrap_recall = bootstrap.get("recall", {}) if isinstance(bootstrap, dict) else {}
    bootstrap_clean = bootstrap.get("cleanFalsePositiveRate", {}) if isinstance(bootstrap, dict) else {}
    bootstrap_hard = bootstrap.get("hardNegativeFalsePositiveRate", {}) if isinstance(bootstrap, dict) else {}
    leave_one_f1 = leave_one_out.get("f1", {}) if isinstance(leave_one_out, dict) else {}
    leave_one_precision = leave_one_out.get("precision", {}) if isinstance(leave_one_out, dict) else {}
    leave_one_recall = leave_one_out.get("recall", {}) if isinstance(leave_one_out, dict) else {}
    family = grouped_policy_family(str(summary.get("policy") or summary.get("candidateId") or ""))

    validation_f1 = float(summary.get("tolerantF1", summary.get("f1", 0.0)))
    validation_precision = float(summary.get("tolerantPrecision", summary.get("precision", 0.0)))
    validation_recall = float(summary.get("tolerantRecall", summary.get("recall", 0.0)))
    clear_recall = float(summary.get("clearRecall", 0.0))
    bootstrap_f1_p05 = float(bootstrap_f1.get("p05", 0.0))
    bootstrap_precision_p05 = float(bootstrap_precision.get("p05", 0.0))
    bootstrap_recall_p05 = float(bootstrap_recall.get("p05", 0.0))
    bootstrap_clean_p95 = float(bootstrap_clean.get("p95", summary.get("cleanFalsePositiveRate", 0.0)))
    bootstrap_hard_p95 = float(bootstrap_hard.get("p95", summary.get("strictHardNegativeFalsePositiveRate", 0.0)))
    leave_one_f1_min = float(leave_one_f1.get("min", 0.0))
    leave_one_precision_min = float(leave_one_precision.get("min", 0.0))
    leave_one_recall_min = float(leave_one_recall.get("min", 0.0))
    top_feedback_share = float(concentration.get("topFeedbackFamilyShare", 0.0)) if isinstance(concentration, dict) else 0.0
    unacceptable_clean_rate = float(summary.get("cleanUnacceptableFalsePositiveRate", summary.get("cleanFalsePositiveRate", 0.0)))
    unacceptable_hard_rows = int(summary.get("hardNegativeUnacceptableFalsePositiveRows", summary.get("strictHardNegativeFalsePositiveRows", 0)))
    max_loro_unacceptable_clean = int(leave_one_out.get("maxUnacceptableCleanFalsePositiveRows", summary.get("cleanUnacceptableFalsePositiveRows", 0))) if isinstance(leave_one_out, dict) else int(summary.get("cleanUnacceptableFalsePositiveRows", 0))
    max_loro_unacceptable_hard = int(leave_one_out.get("maxUnacceptableHardNegativeFalsePositiveRows", unacceptable_hard_rows)) if isinstance(leave_one_out, dict) else unacceptable_hard_rows

    penalties = {
        "precisionBelow85": max(0.0, 0.85 - validation_precision) * 1.4,
        "bootstrapPrecisionBelow75": max(0.0, 0.75 - bootstrap_precision_p05) * 0.7,
        "bootstrapF1Below45": max(0.0, 0.45 - bootstrap_f1_p05) * 0.9,
        "leaveOneOutF1Below35": max(0.0, 0.35 - leave_one_f1_min) * 0.8,
        "unacceptableCleanAbove5Percent": max(0.0, unacceptable_clean_rate - 0.05) * 4.0,
        "bootstrapCleanP95Above5Percent": max(0.0, bootstrap_clean_p95 - 0.05) * 1.2,
        "unacceptableHardNegativeRows": 1.5 * unacceptable_hard_rows,
        "leaveOneOutUnacceptableHardNegativeRows": 0.8 * max_loro_unacceptable_hard,
        "bootstrapHardNegativeP95": 0.8 * bootstrap_hard_p95,
        "topFeedbackFamilyShareAbove65": max(0.0, top_feedback_share - 0.65) * 0.35,
        "zeroRecall": 0.35 if validation_recall <= 0.0 and int(summary.get("falseNegatives", 0)) > 0 else 0.0,
        "setLevelBackupForRepLevelSelection": 0.18 if family == "set_level_or_backup" else 0.0,
    }
    score = (
        0.22 * validation_f1
        + 0.18 * validation_precision
        + 0.14 * validation_recall
        + 0.18 * clear_recall
        + 0.12 * bootstrap_f1_p05
        + 0.05 * bootstrap_precision_p05
        + 0.04 * bootstrap_recall_p05
        + 0.07 * leave_one_f1_min
        + 0.04 * leave_one_precision_min
        + 0.03 * leave_one_recall_min
        - sum(penalties.values())
    )
    hard_safe = unacceptable_hard_rows == 0 and max_loro_unacceptable_hard == 0
    clean_safe = unacceptable_clean_rate <= 0.05 and max_loro_unacceptable_clean <= max(1, int(summary.get("cleanUnacceptableFalsePositiveRows", 0)))
    precision_safe = validation_precision >= 0.85
    reasons: list[str] = []
    if not hard_safe:
        reasons.append("unacceptable_hard_negative_instability")
    if not clean_safe:
        reasons.append("unacceptable_clean_fp_instability")
    if not precision_safe:
        reasons.append("precision_below_85_percent")
    if bootstrap_f1_p05 < 0.35:
        reasons.append("recording_bootstrap_f1_p05_low")
    if leave_one_f1_min < 0.25 and int(summary.get("truePositives", 0)) > 0:
        reasons.append("leave_one_recording_out_f1_min_low")
    if top_feedback_share > 0.65 and int(summary.get("feedbackRows", 0)) > 0:
        reasons.append("feedback_concentrated_in_one_recording_family")
    if family == "set_level_or_backup":
        reasons.append("secondary_set_level_backup_candidate")
    return {
        "score": score,
        "selectionUsesTest": False,
        "family": family,
        "passesPrimarySafety": hard_safe and clean_safe and precision_safe and int(summary.get("truePositives", 0)) > 0,
        "passesProductSafety": hard_safe and clean_safe and int(summary.get("truePositives", 0)) > 0,
        "reasons": reasons,
        "signals": {
            "validationF1": validation_f1,
            "validationPrecision": validation_precision,
            "validationRecall": validation_recall,
            "clearRecall": clear_recall,
            "recordingBootstrapF1P05": bootstrap_f1_p05,
            "recordingBootstrapPrecisionP05": bootstrap_precision_p05,
            "recordingBootstrapRecallP05": bootstrap_recall_p05,
            "recordingBootstrapCleanFpP95": bootstrap_clean_p95,
            "recordingBootstrapHardNegativeFpP95": bootstrap_hard_p95,
            "leaveOneRecordingOutF1Min": leave_one_f1_min,
            "leaveOneRecordingOutPrecisionMin": leave_one_precision_min,
            "leaveOneRecordingOutRecallMin": leave_one_recall_min,
            "topFeedbackFamilyShare": top_feedback_share,
            "maxLeaveOneOutUnacceptableCleanFalsePositiveRows": max_loro_unacceptable_clean,
            "maxLeaveOneOutUnacceptableHardNegativeFalsePositiveRows": max_loro_unacceptable_hard,
        },
        "penalties": penalties,
    }


def grouped_single_label_candidate_summary(
    df: pd.DataFrame,
    label_column: str,
    candidate: dict[str, Any],
    review_annotations: dict[str, Any],
) -> dict[str, Any]:
    column = candidate["columns"][label_column]
    prediction_columns = {label_column: column}
    probability_column = candidate.get("probabilityColumns", {}).get(label_column)
    probability_columns = {label_column: probability_column} if probability_column else None
    strict = evaluate_prediction_set(df, [label_column], prediction_columns, probability_columns)
    tolerant = tolerant_grouped_policy_metrics(df, [label_column], prediction_columns, review_annotations)
    prediction = numeric_int_series(df, column)
    feedback_rows = int(prediction.sum())
    strict_aggregate = strict["aggregate"]
    safety = strict["safety"]["slices"]
    clear = strict["severity"]["groups"]["clearModerateSevereIssues"]
    stability_bootstrap = recording_bootstrap_grouped_metrics(df, [label_column], prediction_columns, iterations=30)
    leave_one_out = leave_one_recording_out_grouped_metrics(df, [label_column], prediction_columns, review_annotations)
    concentration = grouped_policy_recording_concentration(df, [label_column], prediction_columns)
    summary = {
        "candidateId": candidate["candidateId"],
        "sourceModel": candidate.get("sourceModel"),
        "policy": candidate.get("policy"),
        "predictionColumn": column,
        "probabilityColumn": probability_column,
        "strict": strict,
        "tolerant": tolerant,
        "precision": float(strict_aggregate["precision"]),
        "recall": float(strict_aggregate["recall"]),
        "f1": float(strict_aggregate["f1"]),
        "truePositives": int(strict_aggregate["truePositives"]),
        "falsePositives": int(strict_aggregate["falsePositives"]),
        "falseNegatives": int(strict_aggregate["falseNegatives"]),
        "cleanFalsePositiveRate": float(strict["cleanRepFalsePositiveRate"]),
        "cleanFalsePositiveRows": int(safety["allClean"]["falsePositiveRows"]),
        "cleanRows": int(safety["allClean"]["cleanRows"]),
        "strictHardNegativeFalsePositiveRows": int(safety["hardNegativeClean"]["falsePositiveRows"]),
        "strictHardNegativeFalsePositiveRate": float(safety["hardNegativeClean"]["falsePositiveRate"]),
        "cleanUnacceptableFalsePositiveRows": int(tolerant.get("cleanUnacceptableFalsePositiveRows", 0)),
        "cleanUnacceptableFalsePositiveRate": float(tolerant.get("cleanUnacceptableFalsePositiveRate", 0.0)),
        "hardNegativeUnacceptableFalsePositiveRows": int(tolerant.get("hardNegativeUnacceptableFalsePositiveRows", 0)),
        "hardNegativeUnacceptableFalsePositiveRate": float(tolerant.get("hardNegativeUnacceptableFalsePositiveRate", 0.0)),
        "acceptableBorderlineWarningRows": int(tolerant.get("cleanAcceptableBorderlineWarningRows", 0)),
        "clearRecall": float(clear.get("recall", 0.0)),
        "clearPositiveSupport": int(clear.get("positiveSupport", 0)),
        "feedbackRows": feedback_rows,
        "strictCleanSafe": bool(float(strict["cleanRepFalsePositiveRate"]) <= 0.05),
        "productHardNegativeSafe": bool(int(tolerant.get("hardNegativeUnacceptableFalsePositiveRows", 0)) == 0),
        "precisionPassesTarget": bool(float(strict_aggregate["precision"]) >= 0.85),
        "recordingBootstrap": stability_bootstrap,
        "leaveOneRecordingOut": leave_one_out,
        "recordingFamilyConcentration": concentration,
    }
    summary["robustAssessment"] = grouped_single_label_robust_assessment(summary)
    summary["robustScore"] = float(summary["robustAssessment"]["score"])
    summary["candidateFamily"] = summary["robustAssessment"]["family"]
    return summary


def select_grouped_combination_candidate(label_column: str, summaries: list[dict[str, Any]]) -> tuple[dict[str, Any], str]:
    disabled = next((summary for summary in summaries if summary["candidateId"] == "disabledGroup"), summaries[0])
    rep_level_primary = [
        summary
        for summary in summaries
        if summary["candidateId"] != "disabledGroup"
        and summary.get("candidateFamily") != "set_level_or_backup"
        and bool(summary.get("robustAssessment", {}).get("passesPrimarySafety"))
    ]
    if rep_level_primary:
        return max(
            rep_level_primary,
            key=lambda item: (
                float(item.get("robustScore", float("-inf"))),
                float(item.get("clearRecall", 0.0)),
                float(item.get("f1", 0.0)),
                -int(item["feedbackRows"]),
                item["candidateId"],
            ),
        ), "selected_rep_level_candidate_by_validation_robust_score"
    rep_level_product_safe = [
        summary
        for summary in summaries
        if summary["candidateId"] != "disabledGroup"
        and summary.get("candidateFamily") != "set_level_or_backup"
        and bool(summary.get("robustAssessment", {}).get("passesProductSafety"))
    ]
    if rep_level_product_safe:
        return max(
            rep_level_product_safe,
            key=lambda item: (
                float(item.get("robustScore", float("-inf"))),
                float(item.get("precision", 0.0)),
                -int(item.get("cleanUnacceptableFalsePositiveRows", item.get("cleanFalsePositiveRows", 0))),
                float(item.get("clearRecall", 0.0)),
                -int(item["feedbackRows"]),
                item["candidateId"],
            ),
        ), "no_rep_level_candidate_reached_85_precision; selected_product_safe_rep_level_candidate_by_robust_score"
    backup_safe = [
        summary
        for summary in summaries
        if summary["candidateId"] != "disabledGroup"
        and bool(summary.get("robustAssessment", {}).get("passesProductSafety"))
    ]
    if backup_safe:
        return max(
            backup_safe,
            key=lambda item: (
                float(item.get("robustScore", float("-inf"))),
                float(item.get("precision", 0.0)),
                float(item.get("clearRecall", 0.0)),
                -int(item["feedbackRows"]),
                item["candidateId"],
            ),
        ), "no_rep_level_safe_candidate; selected_secondary_set_level_backup_candidate"
    return disabled, "no_safe_candidate_with_true_positives; disabled_group"


def grouped_policy_source_probabilities(row: pd.Series, label_column: str, candidates: dict[str, dict[str, Any]]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for candidate_id, candidate in candidates.items():
        probability_column = candidate.get("probabilityColumns", {}).get(label_column)
        if probability_column and probability_column in row.index and pd.notna(row.get(probability_column)):
            values[candidate_id] = float(row.get(probability_column))
    return values


def grouped_row_audit_example(
    row: pd.Series,
    grouped_labels: list[str],
    candidates: dict[str, dict[str, Any]],
    combined_columns: dict[str, str],
    selected_by_group: dict[str, dict[str, Any]],
    review_annotations: dict[str, Any],
) -> dict[str, Any]:
    source_value = row.get("source_video") or row.get("recording_file") or row.get("label_file")
    candidate_predictions: dict[str, list[str]] = {}
    for candidate_id, candidate in candidates.items():
        predicted = [
            BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"]
            for label_column in grouped_labels
            if int(row.get(candidate["columns"][label_column], 0) or 0) == 1
        ]
        candidate_predictions[candidate_id] = predicted
    combined_predictions: list[str] = []
    true_labels: list[str] = []
    group_rows: dict[str, Any] = {}
    for label_column in grouped_labels:
        issue_id = BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"]
        truth = int(row.get(label_column, 0) or 0)
        pred = int(row.get(combined_columns[label_column], 0) or 0)
        selected = selected_by_group[label_column]
        if truth == 1:
            true_labels.append(issue_id)
        if pred == 1:
            combined_predictions.append(issue_id)
        status = review_status_for_group(row, label_column, review_annotations)
        group_rows[label_column] = {
            "issueId": issue_id,
            "truth": truth,
            "prediction": pred,
            "outcome": "TP" if truth == 1 and pred == 1 else "FP" if truth == 0 and pred == 1 else "FN" if truth == 1 and pred == 0 else "TN",
            "selectedCandidateId": selected["candidateId"],
            "selectedPolicy": selected.get("policy"),
            "selectedSourceModel": selected.get("sourceModel"),
            "candidatePredictions": {
                candidate_id: int(row.get(candidate["columns"][label_column], 0) or 0)
                for candidate_id, candidate in candidates.items()
            },
            "candidateProbabilities": grouped_policy_source_probabilities(row, label_column, candidates),
            "reviewAnnotation": {
                "category": status["category"],
                "acceptableBorderline": status["acceptableBorderline"],
                "explicitUnacceptable": status["explicitUnacceptable"],
                "possibleLabelAmbiguity": status["possibleLabelAmbiguity"],
                "needsVisualReview": status["needsVisualReview"],
                "reviewerNotes": status["reviewerNotes"],
            },
            "severity": row.get(issue_severity_column(label_column)),
        }
    return {
        "recordingId": recording_id_for_review(source_value),
        "sourceVideo": row.get("source_video"),
        "recordingFile": row.get("recording_file"),
        "labelFile": row.get("label_file"),
        "split": row.get("split"),
        "repIndex": int_or_none(row.get("rep_index")),
        "startMs": int_or_none(row.get("expected_start_ms")) or int_or_none(row.get("start_ms")),
        "endMs": int_or_none(row.get("expected_end_ms")) or int_or_none(row.get("end_ms")),
        "isClean": bool(int(row.get("label_clean", 0) or 0) == 1),
        "isHardNegative": "hard-negative" in str(source_value).lower(),
        "isPartialView": bool("partial" in str(source_value).lower() or "occluded" in str(source_value).lower()),
        "labelView": row.get("label_view"),
        "labelScorable": row.get("label_scorable"),
        "heuristicScorable": row.get("heuristic_scorable"),
        "qualityStatus": row.get("heuristic_quality_status"),
        "trueGroupedLabels": true_labels,
        "candidatePolicyPredictions": candidate_predictions,
        "combinedPolicyPredictions": combined_predictions,
        "groups": group_rows,
    }


def grouped_recording_audit_summary(
    rows: list[dict[str, Any]],
    grouped_labels: list[str],
) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in rows:
        buckets.setdefault((str(row["split"]), str(row["recordingId"])), []).append(row)
    result: list[dict[str, Any]] = []
    for (split, recording_id), recording_rows in sorted(buckets.items()):
        tp = fp = fn = clean_feedback_rows = hard_negative_warnings = unacceptable_hard_negative_warnings = 0
        per_group: dict[str, Any] = {}
        for label_column in grouped_labels:
            group_tp = group_fp = group_fn = 0
            for row in recording_rows:
                outcome = row["groups"][label_column]["outcome"]
                if outcome == "TP":
                    tp += 1
                    group_tp += 1
                elif outcome == "FP":
                    fp += 1
                    group_fp += 1
                elif outcome == "FN":
                    fn += 1
                    group_fn += 1
            per_group[label_column] = {
                "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
                "truePositives": group_tp,
                "falsePositives": group_fp,
                "falseNegatives": group_fn,
            }
        for row in recording_rows:
            has_feedback = bool(row["combinedPolicyPredictions"])
            if row["isClean"] and has_feedback:
                clean_feedback_rows += 1
            if row["isClean"] and row["isHardNegative"] and has_feedback:
                hard_negative_warnings += 1
                for label_column in grouped_labels:
                    group = row["groups"][label_column]
                    if group["prediction"] == 1 and not group["reviewAnnotation"]["acceptableBorderline"]:
                        unacceptable_hard_negative_warnings += 1
        precision = 1.0 if tp + fp == 0 else tp / (tp + fp)
        recall = 1.0 if tp + fn == 0 else tp / (tp + fn)
        f1 = 0.0 if precision + recall == 0 else (2 * precision * recall) / (precision + recall)
        result.append({
            "recordingId": recording_id,
            "split": split,
            "rows": len(recording_rows),
            "truePositives": tp,
            "falsePositives": fp,
            "falseNegatives": fn,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "cleanFeedbackRows": clean_feedback_rows,
            "hardNegativeWarningRows": hard_negative_warnings,
            "unacceptableHardNegativePredictions": unacceptable_hard_negative_warnings,
            "perGroup": per_group,
        })
    return result


def grouped_combined_error_review(
    audit_rows: list[dict[str, Any]],
    grouped_labels: list[str],
    limit: int = 30,
) -> dict[str, Any]:
    false_positives: list[dict[str, Any]] = []
    false_negatives: list[dict[str, Any]] = []
    clean_feedback: list[dict[str, Any]] = []
    hard_negative_warnings: list[dict[str, Any]] = []
    acceptable_borderline: list[dict[str, Any]] = []
    clear_issues_missed: list[dict[str, Any]] = []
    combined_succeeds_over_individual: list[dict[str, Any]] = []
    combined_fails_against_individual: list[dict[str, Any]] = []

    for row in audit_rows:
        if row["isClean"] and row["combinedPolicyPredictions"]:
            clean_feedback.append(row)
        if row["isClean"] and row["isHardNegative"] and row["combinedPolicyPredictions"]:
            hard_negative_warnings.append(row)
        for label_column in grouped_labels:
            group = row["groups"][label_column]
            issue_id = group["issueId"]
            base = {
                "recordingId": row["recordingId"],
                "sourceVideo": row["sourceVideo"],
                "split": row["split"],
                "repIndex": row["repIndex"],
                "startMs": row["startMs"],
                "endMs": row["endMs"],
                "issueId": issue_id,
                "truth": group["truth"],
                "prediction": group["prediction"],
                "selectedCandidateId": group["selectedCandidateId"],
                "selectedSourceModel": group["selectedSourceModel"],
                "candidateProbabilities": group["candidateProbabilities"],
                "severity": group["severity"],
                "reviewAnnotation": group["reviewAnnotation"],
            }
            if group["outcome"] == "FP":
                false_positives.append(base)
                if group["reviewAnnotation"]["acceptableBorderline"]:
                    acceptable_borderline.append(base)
            elif group["outcome"] == "FN":
                false_negatives.append(base)
                severity = str(group.get("severity") or "").lower()
                if severity in {"clear", "moderate", "severe"}:
                    clear_issues_missed.append(base)
            candidate_predictions = group["candidatePredictions"]
            correct_candidates = [
                candidate_id
                for candidate_id, pred in candidate_predictions.items()
                if int(pred) == int(group["truth"])
            ]
            wrong_candidates = [
                candidate_id
                for candidate_id, pred in candidate_predictions.items()
                if int(pred) != int(group["truth"])
            ]
            combined_correct = int(group["prediction"]) == int(group["truth"])
            if combined_correct and wrong_candidates:
                combined_succeeds_over_individual.append({**base, "wrongIndividualCandidates": wrong_candidates[:8]})
            if not combined_correct and correct_candidates:
                combined_fails_against_individual.append({**base, "correctIndividualCandidates": correct_candidates[:8]})

    def trim(items: list[Any]) -> list[Any]:
        return items[:limit]

    return {
        "falsePositives": trim(false_positives),
        "falseNegatives": trim(false_negatives),
        "cleanRowsReceivingFeedback": trim(clean_feedback),
        "hardNegativeWarnings": trim(hard_negative_warnings),
        "acceptableBorderlineWarnings": trim(acceptable_borderline),
        "clearIssuesMissed": trim(clear_issues_missed),
        "combinedSucceedsOverIndividualPolicies": trim(combined_succeeds_over_individual),
        "combinedFailsWhereIndividualPolicySucceeded": trim(combined_fails_against_individual),
        "counts": {
            "falsePositives": len(false_positives),
            "falseNegatives": len(false_negatives),
            "cleanRowsReceivingFeedback": len(clean_feedback),
            "hardNegativeWarnings": len(hard_negative_warnings),
            "acceptableBorderlineWarnings": len(acceptable_borderline),
            "clearIssuesMissed": len(clear_issues_missed),
            "combinedSucceedsOverIndividualPolicies": len(combined_succeeds_over_individual),
            "combinedFailsWhereIndividualPolicySucceeded": len(combined_fails_against_individual),
        },
    }


def grouped_feature_subset_results(candidate_metrics_by_group: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "available": True,
        "scope": "offline_model_selection_diagnostics",
        "selectionSplit": "validation",
        "testUsage": "not_used",
        "groups": {},
    }
    for label_column, group_report in candidate_metrics_by_group.items():
        candidates = group_report.get("candidates", [])
        subset_candidates = [
            candidate
            for candidate in candidates
            if "group_subset" in str(candidate.get("sourceModel") or "")
        ]
        relview_candidates = [
            candidate
            for candidate in candidates
            if "group_subset_relview" in str(candidate.get("sourceModel") or "")
        ]
        pruned_candidates = [
            candidate
            for candidate in candidates
            if "pruned_all" in str(candidate.get("sourceModel") or "")
        ]
        all_feature_candidates = [
            candidate
            for candidate in candidates
            if candidate.get("sourceModel")
            and "group_subset" not in str(candidate.get("sourceModel"))
            and "pruned_all" not in str(candidate.get("sourceModel"))
        ]

        def compact(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [
                {
                    "candidateId": item.get("candidateId"),
                    "sourceModel": item.get("sourceModel"),
                    "policy": item.get("policy"),
                    "family": item.get("candidateFamily"),
                    "robustScore": item.get("robustScore"),
                    "precision": item.get("precision"),
                    "recall": item.get("recall"),
                    "f1": item.get("f1"),
                    "clearRecall": item.get("clearRecall"),
                    "cleanUnacceptableFalsePositiveRows": item.get("cleanUnacceptableFalsePositiveRows"),
                    "hardNegativeUnacceptableFalsePositiveRows": item.get("hardNegativeUnacceptableFalsePositiveRows"),
                    "recordingBootstrapF1P05": item.get("robustAssessment", {}).get("signals", {}).get("recordingBootstrapF1P05"),
                    "leaveOneRecordingOutF1Min": item.get("robustAssessment", {}).get("signals", {}).get("leaveOneRecordingOutF1Min"),
                }
                for item in sorted(items, key=lambda value: float(value.get("robustScore", float("-inf"))), reverse=True)[:5]
            ]

        result["groups"][label_column] = {
            "issueId": group_report.get("issueId"),
            "selectedCandidateId": group_report.get("selectedCandidateId"),
            "counts": {
                "allFeatureCandidates": len(all_feature_candidates),
                "prunedAllCandidates": len(pruned_candidates),
                "groupSubsetCandidates": len(subset_candidates),
                "groupSubsetReliabilityViewCandidates": len(relview_candidates),
            },
            "bestAllFeatures": compact(all_feature_candidates),
            "bestPrunedAllFeatures": compact(pruned_candidates),
            "bestGroupSubset": compact(subset_candidates),
            "bestGroupSubsetReliabilityView": compact(relview_candidates),
        }
    return result


def compact_grouped_combination_candidate_summary(summary: dict[str, Any]) -> dict[str, Any]:
    robust = summary.get("robustAssessment", {})
    return {
        "candidateId": summary.get("candidateId"),
        "sourceModel": summary.get("sourceModel"),
        "policy": summary.get("policy"),
        "candidateFamily": summary.get("candidateFamily"),
        "predictionColumn": summary.get("predictionColumn"),
        "probabilityColumn": summary.get("probabilityColumn"),
        "precision": summary.get("precision"),
        "recall": summary.get("recall"),
        "f1": summary.get("f1"),
        "truePositives": summary.get("truePositives"),
        "falsePositives": summary.get("falsePositives"),
        "falseNegatives": summary.get("falseNegatives"),
        "cleanFalsePositiveRows": summary.get("cleanFalsePositiveRows"),
        "cleanFalsePositiveRate": summary.get("cleanFalsePositiveRate"),
        "strictHardNegativeFalsePositiveRows": summary.get("strictHardNegativeFalsePositiveRows"),
        "cleanUnacceptableFalsePositiveRows": summary.get("cleanUnacceptableFalsePositiveRows"),
        "cleanUnacceptableFalsePositiveRate": summary.get("cleanUnacceptableFalsePositiveRate"),
        "hardNegativeUnacceptableFalsePositiveRows": summary.get("hardNegativeUnacceptableFalsePositiveRows"),
        "hardNegativeUnacceptableFalsePositiveRate": summary.get("hardNegativeUnacceptableFalsePositiveRate"),
        "acceptableBorderlineWarningRows": summary.get("acceptableBorderlineWarningRows"),
        "clearRecall": summary.get("clearRecall"),
        "clearPositiveSupport": summary.get("clearPositiveSupport"),
        "feedbackRows": summary.get("feedbackRows"),
        "strictCleanSafe": summary.get("strictCleanSafe"),
        "productHardNegativeSafe": summary.get("productHardNegativeSafe"),
        "precisionPassesTarget": summary.get("precisionPassesTarget"),
        "robustScore": summary.get("robustScore"),
        "robustAssessment": {
            "score": robust.get("score"),
            "family": robust.get("family"),
            "passesPrimarySafety": robust.get("passesPrimarySafety"),
            "passesProductSafety": robust.get("passesProductSafety"),
            "reasons": robust.get("reasons", []),
            "signals": robust.get("signals", {}),
            "penalties": robust.get("penalties", {}),
            "selectionUsesTest": robust.get("selectionUsesTest", False),
        },
    }


def build_grouped_policy_combination_report(
    df: pd.DataFrame,
    label_columns: list[str],
    args: argparse.Namespace,
    review_annotations: dict[str, Any],
    models_available: list[str],
) -> dict[str, Any]:
    grouped_labels = grouped_feedback_label_columns(label_columns)
    if args.exercise != "barbell-curl" or not grouped_labels:
        return {"available": False, "reason": "grouped_policy_combination_currently_scoped_to_barbell_curl"}
    candidates, warnings_out = materialize_cross_model_grouped_policy_candidates(
        df,
        label_columns,
        grouped_labels,
        args,
        review_annotations,
        models_available,
    )
    required_candidate_ids = {
        "logistic.repLevelTolerantOptimized",
        "logistic_l1.fineOptimizedCollapsedToGroups",
        "logistic_l1.repLevelTolerantOptimizedDirectEvidenceGate",
    }
    missing_required = sorted(required_candidate_ids - set(candidates.keys()))
    validation = df[df["split"] == "validation"].copy()
    if len(validation) == 0:
        return {"available": False, "reason": "no_validation_rows"}

    candidate_metrics_by_group: dict[str, Any] = {}
    selected_by_group: dict[str, Any] = {}
    combined_columns: dict[str, str] = {}
    selected_probability_columns: dict[str, str | None] = {}
    interesting_candidate_ids: set[str] = {"heuristicGrouped"}
    for label_column in grouped_labels:
        summaries = [
            grouped_single_label_candidate_summary(validation, label_column, candidate, review_annotations)
            for candidate in candidates.values()
            if label_column in candidate.get("columns", {})
        ]
        selected, reason = select_grouped_combination_candidate(label_column, summaries)
        sorted_summaries = sorted(
            summaries,
            key=lambda item: (
                bool(item.get("robustAssessment", {}).get("passesPrimarySafety")),
                bool(item.get("robustAssessment", {}).get("passesProductSafety")),
                item.get("candidateFamily") != "set_level_or_backup",
                float(item.get("robustScore", float("-inf"))),
                float(item["clearRecall"]),
                float(item["f1"]),
                float(item["precision"]),
                -int(item["feedbackRows"]),
            ),
            reverse=True,
        )
        candidate_metrics_by_group[label_column] = {
            "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
            "selectionReason": reason,
            "selectedCandidateId": selected["candidateId"],
            "candidateCount": len(summaries),
            "candidates": [
                compact_grouped_combination_candidate_summary(summary)
                for summary in sorted_summaries[:20]
            ],
        }
        selected_candidate = candidates[selected["candidateId"]]
        interesting_candidate_ids.add(selected["candidateId"])
        for summary in sorted_summaries[:3]:
            interesting_candidate_ids.add(str(summary["candidateId"]))
        selected_by_group[label_column] = {
            "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
            "candidateId": selected["candidateId"],
            "sourceModel": selected_candidate.get("sourceModel"),
            "policy": selected_candidate.get("policy"),
            "predictionColumn": selected_candidate["columns"][label_column],
            "probabilityColumn": selected_candidate.get("probabilityColumns", {}).get(label_column),
            "validationMetrics": compact_grouped_combination_candidate_summary(selected),
            "selectionReason": reason,
        }
        output_column = f"eval_combined__grouped_validationSelectedPerGroup__{issue_suffix(label_column)}"
        df[output_column] = numeric_int_series(df, selected_candidate["columns"][label_column])
        combined_columns[label_column] = output_column
        selected_probability_columns[label_column] = selected_candidate.get("probabilityColumns", {}).get(label_column)

    comparison_policy_columns = {
        candidate_id: candidate["columns"]
        for candidate_id, candidate in candidates.items()
        if candidate_id != "disabledGroup" and candidate_id in interesting_candidate_ids
    }
    comparison_policy_columns["validationSelectedPerGroupCombined"] = combined_columns
    split_reports = grouped_split_reports(df, grouped_labels, comparison_policy_columns, {})
    tolerant_policy_comparison = grouped_tolerant_policy_comparison(
        df,
        grouped_labels,
        comparison_policy_columns,
        review_annotations,
    )
    transition_reports = grouped_policy_transition_reports(
        df,
        grouped_labels,
        candidates["heuristicGrouped"]["columns"],
        candidates.get("logistic.repLevelTolerantOptimized", candidates["heuristicGrouped"])["columns"],
        comparison_policy_columns,
    )
    feedback_row_reports = grouped_policy_feedback_row_reports(df, comparison_policy_columns)
    stability_reports = grouped_policy_stability_reports(
        df,
        grouped_labels,
        {
            key: value
            for key, value in comparison_policy_columns.items()
            if key in {
                "logistic.repLevelTolerantOptimized",
                "logistic_l1.fineOptimizedCollapsedToGroups",
                "logistic_l1.repLevelTolerantOptimizedDirectEvidenceGate",
                "validationSelectedPerGroupCombined",
                "heuristicGrouped",
                "random_forest.repLevelPlusSetBackupBroadcast",
            }
        },
        splits=["validation"],
        iterations=100,
    )
    leaderboard_entries = grouped_feedback_leaderboard_entries(
        "combined_per_group",
        split_reports,
        tolerant_policy_comparison,
        {},
        transition_reports,
        feedback_row_reports,
        stability_reports,
    )

    audit_candidates = {
        candidate_id: candidate
        for candidate_id, candidate in candidates.items()
        if candidate_id in interesting_candidate_ids or candidate_id in {"heuristicGrouped", "disabledGroup"}
    }
    audit_rows = [
        grouped_row_audit_example(row, grouped_labels, audit_candidates, combined_columns, selected_by_group, review_annotations)
        for _index, row in df[df["split"].isin(["validation", "test"])].iterrows()
    ]
    per_recording = grouped_recording_audit_summary(audit_rows, grouped_labels)
    error_review = grouped_combined_error_review(audit_rows, grouped_labels)

    return {
        "available": True,
        "scope": "offline_report_only",
        "selectionSplit": "validation",
        "testUsage": "final_reporting_only",
        "liveBehaviorChanged": False,
        "candidateSources": {
            candidate_id: {
                "sourceModel": candidate.get("sourceModel"),
                "policy": candidate.get("policy"),
                "description": candidate.get("description"),
            }
            for candidate_id, candidate in candidates.items()
        },
        "missingRequiredCandidates": missing_required,
        "warnings": warnings_out,
        "selectionConstraints": {
            "unacceptableHardNegativeFalsePositiveRows": 0,
            "strictCleanFalsePositiveRateMax": 0.05,
            "precisionTarget": 0.85,
            "primarySelector": "validation-only robust score; rep-level candidates are preferred for immediate feedback and set-level backup remains secondary.",
            "robustSignals": [
                "validation precision/recall/F1",
                "clear/moderate/severe recall",
                "recording-bootstrap p05/p50/p95",
                "leave-one-recording-out minima",
                "clean false-positive stability",
                "hard-negative false-positive stability",
                "unacceptable hard-negative false-positive stability",
                "recording-family feedback concentration",
            ],
            "penalties": [
                "low bootstrap p05",
                "clean FP above 5%",
                "unacceptable hard-negative FP",
                "precision below 85%",
                "zero recall",
                "excessive clean feedback",
                "set-level backup selected for immediate rep-level feedback",
            ],
            "tieBreakers": ["robust score", "clear/moderate/severe recall", "F1", "lower feedback-row count"],
            "usesTestForSelection": False,
        },
        "selectedPolicyByGroup": selected_by_group,
        "candidateMetricsByGroup": candidate_metrics_by_group,
        "featureSubsetResults": grouped_feature_subset_results(candidate_metrics_by_group),
        "combinedPolicyColumns": combined_columns,
        "selectedProbabilityColumns": selected_probability_columns,
        "comparison": {
            "repLevelPolicyComparison": split_reports,
            "tolerantPolicyComparison": tolerant_policy_comparison,
            "policyTransitionComparison": transition_reports,
            "policyFeedbackRows": feedback_row_reports,
            "policyStability": stability_reports,
            "leaderboard": {
                "entries": leaderboard_entries,
                "recommendations": grouped_leaderboard_recommendations(leaderboard_entries),
            },
        },
        "combinedValidationMetrics": split_reports.get("validation", {}).get("validationSelectedPerGroupCombined"),
        "combinedTolerantValidationMetrics": (
            tolerant_policy_comparison.get("splits", {}).get("validation", {}).get("validationSelectedPerGroupCombined")
            if tolerant_policy_comparison.get("available")
            else None
        ),
        "combinedTestFinalOnlyMetrics": split_reports.get("test", {}).get("validationSelectedPerGroupCombined"),
        "combinedTolerantTestFinalOnlyMetrics": (
            tolerant_policy_comparison.get("splits", {}).get("test", {}).get("validationSelectedPerGroupCombined")
            if tolerant_policy_comparison.get("available")
            else None
        ),
        "bootstrapRobustness": stability_reports.get("validation", {}).get("validationSelectedPerGroupCombined"),
        "rowLevelAudit": {
            "available": True,
            "sidecar": True,
            "rowCount": len(audit_rows),
            "perRecordingCount": len(per_recording),
            "previewRows": audit_rows[:5],
            "previewPerRecording": per_recording[:10],
        },
        "rowLevelAuditData": {
            "scope": "offline_report_only",
            "selectionSplit": "validation",
            "testUsage": "final_reporting_only",
            "selectedPolicyByGroup": selected_by_group,
            "rows": audit_rows,
            "perRecording": per_recording,
            "errorReview": error_review,
            "liveBehaviorChanged": False,
        },
        "errorReview": error_review,
        "recommendation": {
            "summary": "Use this as an offline/shadow diagnostic only. Fresh holdout is still blocked until a validation-selected policy robustly meets internal targets.",
            "internalTargets": {
                "f1": 0.70,
                "precision": 0.85,
                "cleanFalsePositiveRate": 0.05,
                "unacceptableHardNegativeFalsePositiveRows": 0,
                "clearRecall": 0.70,
            },
            "selectionDoesNotUseTest": True,
        },
    }


def grouped_policy_family(policy_name: str) -> str:
    if policy_name == "validationSelectedPerGroupCombined":
        return "validation_selected_per_group_combination"
    if policy_name == "heuristicGrouped":
        return "heuristic"
    if policy_name == "mlOnlyGrouped":
        return "ml_only"
    if policy_name == "fineOptimizedCollapsedToGroups":
        return "fine_label_collapsed"
    if "SetBackup" in policy_name or policy_name == "setLevelOnlyBroadcast":
        return "set_level_or_backup"
    if "TorsoDisabled" in policy_name:
        return "torso_disabled"
    if "DirectEvidenceGate" in policy_name:
        return "direct_evidence_gate"
    return "rep_level_policy"


def compact_grouped_prediction_report(report: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(report, dict) or "aggregate" not in report:
        return None
    aggregate = report.get("aggregate", {})
    safety = report.get("safety", {}).get("slices", {}) if isinstance(report.get("safety"), dict) else {}
    all_clean = safety.get("allClean", {})
    hard_negative = safety.get("hardNegativeClean", {})
    partial_view = safety.get("partialViewClean", {})
    severity = report.get("severity", {}).get("groups", {}) if isinstance(report.get("severity"), dict) else {}
    mild = severity.get("mildIssues", {})
    clear = severity.get("clearModerateSevereIssues", {})
    return {
        "precision": float(aggregate.get("precision", 0.0)),
        "recall": float(aggregate.get("recall", 0.0)),
        "f1": float(aggregate.get("f1", 0.0)),
        "truePositives": int(aggregate.get("truePositives", 0)),
        "falsePositives": int(aggregate.get("falsePositives", 0)),
        "falseNegatives": int(aggregate.get("falseNegatives", 0)),
        "cleanFalsePositiveRate": float(report.get("cleanRepFalsePositiveRate", 0.0)),
        "cleanFalsePositiveRows": int(all_clean.get("falsePositiveRows", 0)),
        "cleanRows": int(all_clean.get("cleanRows", 0)),
        "hardNegativeFalsePositiveRate": float(hard_negative.get("falsePositiveRate", 0.0)),
        "hardNegativeFalsePositiveRows": int(hard_negative.get("falsePositiveRows", 0)),
        "hardNegativeCleanRows": int(hard_negative.get("cleanRows", 0)),
        "partialViewFalsePositiveRate": float(partial_view.get("falsePositiveRate", 0.0)),
        "partialViewFalsePositiveRows": int(partial_view.get("falsePositiveRows", 0)),
        "mildRecall": float(mild.get("recall", 0.0)),
        "mildPositiveSupport": int(mild.get("positiveSupport", 0)),
        "clearRecall": float(clear.get("recall", 0.0)),
        "clearPositiveSupport": int(clear.get("positiveSupport", 0)),
    }


def compact_tolerant_grouped_report(report: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(report, dict) or not bool(report.get("available", False)):
        return None
    strict = report.get("strictAggregate", {})
    tolerant = report.get("tolerantAggregate", {})
    return {
        "strictPrecision": float(strict.get("precision", 0.0)),
        "strictRecall": float(strict.get("recall", 0.0)),
        "strictF1": float(strict.get("f1", 0.0)),
        "tolerantPrecision": float(tolerant.get("precision", 0.0)),
        "tolerantRecall": float(tolerant.get("recall", 0.0)),
        "tolerantF1": float(tolerant.get("f1", 0.0)),
        "strictCleanFalsePositiveRows": int(report.get("strictCleanFalsePositiveRows", 0)),
        "strictCleanFalsePositiveRate": float(report.get("strictCleanFalsePositiveRate", 0.0)),
        "cleanUnacceptableFalsePositiveRows": int(report.get("cleanUnacceptableFalsePositiveRows", 0)),
        "cleanUnacceptableFalsePositiveRate": float(report.get("cleanUnacceptableFalsePositiveRate", 0.0)),
        "cleanAcceptableBorderlineWarningRows": int(report.get("cleanAcceptableBorderlineWarningRows", 0)),
        "strictHardNegativeFalsePositiveRows": int(report.get("strictHardNegativeFalsePositiveRows", 0)),
        "strictHardNegativeFalsePositiveRate": float(report.get("strictHardNegativeFalsePositiveRate", 0.0)),
        "hardNegativeUnacceptableFalsePositiveRows": int(report.get("hardNegativeUnacceptableFalsePositiveRows", 0)),
        "hardNegativeUnacceptableFalsePositiveRate": float(report.get("hardNegativeUnacceptableFalsePositiveRate", 0.0)),
        "hardNegativeAcceptableBorderlineWarningRows": int(report.get("hardNegativeAcceptableBorderlineWarningRows", 0)),
    }


def compact_grouped_set_report(report: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(report, dict) or "aggregate" not in report:
        return None
    aggregate = report.get("aggregate", {})
    clean_fp_groups = 0
    clean_negative_groups = 0
    hard_fp_groups = 0
    hard_negative_groups = 0
    for metrics in report.get("perGroup", {}).values():
        clean_fp_groups += int(metrics.get("allCleanFalsePositiveGroups", 0))
        clean_negative_groups += int(metrics.get("allCleanNegativeGroups", 0))
        hard_fp_groups += int(metrics.get("hardNegativeFalsePositiveGroups", 0))
        hard_negative_groups += int(metrics.get("hardNegativeCleanGroups", 0))
    return {
        "precision": float(aggregate.get("precision", 0.0)),
        "recall": float(aggregate.get("recall", 0.0)),
        "f1": float(aggregate.get("f1", 0.0)),
        "truePositives": int(aggregate.get("truePositives", 0)),
        "falsePositives": int(aggregate.get("falsePositives", 0)),
        "falseNegatives": int(aggregate.get("falseNegatives", 0)),
        "cleanFalsePositiveGroups": clean_fp_groups,
        "cleanNegativeGroups": clean_negative_groups,
        "cleanFalsePositiveRate": 0.0 if clean_negative_groups == 0 else clean_fp_groups / clean_negative_groups,
        "hardNegativeFalsePositiveGroups": hard_fp_groups,
        "hardNegativeCleanGroups": hard_negative_groups,
        "hardNegativeFalsePositiveRate": 0.0 if hard_negative_groups == 0 else hard_fp_groups / hard_negative_groups,
    }


def grouped_set_policy_name(policy_name: str) -> str | None:
    mapping = {
        "fineOptimizedCollapsedToGroups": "fineOptimizedCollapsedToGroups",
        "repLevelOnlyHighConfidence": "repLevelOnlyHighConfidence",
        "repLevelConservative": "repLevelConservative",
        "repLevelTolerantOptimized": "repLevelTolerantOptimized",
        "repLevelTolerantOptimizedDirectEvidenceGate": "repLevelTolerantOptimizedDirectEvidenceGate",
        "repLevelTolerantOptimizedTorsoDisabled": "repLevelTolerantOptimizedTorsoDisabled",
        "repLevelTolerantOptimizedTorsoSetBackupBroadcast": "repLevelTolerantOptimizedTorsoSetBackup",
        "repLevelPlusSetBackupBroadcast": "repLevelPlusSetBackup",
        "setLevelOnlyBroadcast": "setLevelOnly",
    }
    return mapping.get(policy_name)


def grouped_leaderboard_flags(validation: dict[str, Any] | None, tolerant_validation: dict[str, Any] | None) -> dict[str, Any]:
    if not validation:
        return {"strictSafe": False, "productTolerantSafe": False, "exploratoryHighRecallSafe": False}
    unacceptable_clean = (
        float(tolerant_validation.get("cleanUnacceptableFalsePositiveRate", validation["cleanFalsePositiveRate"]))
        if tolerant_validation
        else float(validation["cleanFalsePositiveRate"])
    )
    unacceptable_hard_rows = (
        int(tolerant_validation.get("hardNegativeUnacceptableFalsePositiveRows", validation["hardNegativeFalsePositiveRows"]))
        if tolerant_validation
        else int(validation["hardNegativeFalsePositiveRows"])
    )
    return {
        "strictSafe": bool(
            validation["precision"] >= 0.85
            and validation["cleanFalsePositiveRate"] <= 0.05
            and int(validation["hardNegativeFalsePositiveRows"]) == 0
        ),
        "productTolerantSafe": bool(
            validation["precision"] >= 0.85
            and unacceptable_clean <= 0.05
            and unacceptable_hard_rows == 0
        ),
        "exploratoryHighRecallSafe": bool(
            validation["precision"] >= 0.70
            and unacceptable_clean <= 0.10
            and unacceptable_hard_rows == 0
        ),
        "usesReviewAnnotations": bool(tolerant_validation is not None),
        "validationUnacceptableCleanFalsePositiveRate": unacceptable_clean,
        "validationUnacceptableHardNegativeFalsePositiveRows": unacceptable_hard_rows,
    }


def grouped_leaderboard_rank_score(validation: dict[str, Any] | None, tolerant_validation: dict[str, Any] | None) -> float:
    if not validation:
        return float("-inf")
    validation_f1 = float(validation["f1"])
    if tolerant_validation:
        validation_f1 = float(tolerant_validation.get("tolerantF1", validation_f1))
        clean_rate = float(tolerant_validation.get("cleanUnacceptableFalsePositiveRate", validation["cleanFalsePositiveRate"]))
        hard_rows = int(tolerant_validation.get("hardNegativeUnacceptableFalsePositiveRows", validation["hardNegativeFalsePositiveRows"]))
    else:
        clean_rate = float(validation["cleanFalsePositiveRate"])
        hard_rows = int(validation["hardNegativeFalsePositiveRows"])
    clean_penalty = max(0.0, clean_rate - 0.05) * 5.0
    return (
        validation_f1
        + 0.25 * float(validation["clearRecall"])
        + 0.10 * float(validation["precision"])
        - clean_penalty
        - 1.50 * hard_rows
    )


def grouped_per_group_floor_metrics(report: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(report, dict):
        return {
            "minPrecision": 0.0,
            "minRecall": 0.0,
            "zeroRecallGroups": [],
            "lowPrecisionGroups": [],
        }
    zero_recall_groups: list[str] = []
    low_precision_groups: list[str] = []
    precision_values: list[float] = []
    recall_values: list[float] = []
    for label_column, metrics in report.get("perIssue", {}).items():
        support = int(metrics.get("truePositives", 0)) + int(metrics.get("falseNegatives", 0))
        if support <= 0:
            continue
        precision = float(metrics.get("precision", 0.0))
        recall = float(metrics.get("recall", 0.0))
        precision_values.append(precision)
        recall_values.append(recall)
        if recall <= 0.0:
            zero_recall_groups.append(label_column)
        if precision < 0.70:
            low_precision_groups.append(label_column)
    return {
        "minPrecision": min(precision_values) if precision_values else 0.0,
        "minRecall": min(recall_values) if recall_values else 0.0,
        "zeroRecallGroups": zero_recall_groups,
        "lowPrecisionGroups": low_precision_groups,
    }


def robust_grouped_policy_assessment(
    validation: dict[str, Any] | None,
    tolerant_validation: dict[str, Any] | None,
    stability_validation: dict[str, Any] | None,
    feedback_validation: dict[str, Any] | None,
    validation_report: dict[str, Any] | None,
    test: dict[str, Any] | None = None,
    tolerant_test: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not validation:
        return {
            "score": float("-inf"),
            "category": "reject",
            "reasons": ["missing_validation_metrics"],
            "selectionUsesTest": False,
        }
    bootstrap = (stability_validation or {}).get("recordingBootstrap", {})
    concentration = (stability_validation or {}).get("recordingFamilyConcentration", {})
    per_group = grouped_per_group_floor_metrics(validation_report)
    validation_unacceptable_clean = (
        float(tolerant_validation.get("cleanUnacceptableFalsePositiveRate", validation["cleanFalsePositiveRate"]))
        if tolerant_validation
        else float(validation["cleanFalsePositiveRate"])
    )
    validation_unacceptable_hard_rows = (
        int(tolerant_validation.get("hardNegativeUnacceptableFalsePositiveRows", validation["hardNegativeFalsePositiveRows"]))
        if tolerant_validation
        else int(validation["hardNegativeFalsePositiveRows"])
    )
    validation_borderline_rows = int(tolerant_validation.get("cleanAcceptableBorderlineWarningRows", 0)) if tolerant_validation else 0
    bootstrap_f1 = bootstrap.get("f1", {}) if isinstance(bootstrap, dict) else {}
    bootstrap_p05 = float(bootstrap_f1.get("p05", 0.0))
    bootstrap_p50 = float(bootstrap_f1.get("p50", 0.0))
    top_feedback_share = float(concentration.get("topFeedbackFamilyShare", 0.0)) if isinstance(concentration, dict) else 0.0
    feedback_rows = int((feedback_validation or {}).get("feedbackRows", 0))
    clean_penalty = max(0.0, validation_unacceptable_clean - 0.05) * 4.0
    hard_penalty = 1.5 * validation_unacceptable_hard_rows
    precision_penalty = max(0.0, 0.85 - float(validation["precision"])) * 1.5
    stability_penalty = max(0.0, 0.45 - bootstrap_p05) * 1.0
    zero_recall_penalty = 0.08 * len(per_group["zeroRecallGroups"])
    concentration_penalty = max(0.0, top_feedback_share - 0.65) * 0.35
    score = (
        0.22 * float(validation["f1"])
        + 0.20 * float(validation["precision"])
        + 0.12 * float(validation["recall"])
        + 0.16 * float(validation["clearRecall"])
        + 0.15 * bootstrap_p05
        + 0.05 * bootstrap_p50
        + 0.05 * float(per_group["minPrecision"])
        + 0.05 * float(per_group["minRecall"])
        - clean_penalty
        - hard_penalty
        - precision_penalty
        - stability_penalty
        - zero_recall_penalty
        - concentration_penalty
    )
    reasons: list[str] = []
    if validation_unacceptable_hard_rows > 0:
        reasons.append("validation_unacceptable_hard_negative_fp")
    if validation_unacceptable_clean > 0.05:
        reasons.append("validation_clean_fp_above_5_percent")
    if float(validation["precision"]) < 0.85:
        reasons.append("validation_precision_below_85_percent")
    if float(validation["f1"]) < 0.70:
        reasons.append("validation_f1_below_70_percent")
    if float(validation["clearRecall"]) < 0.70:
        reasons.append("validation_clear_recall_below_70_percent")
    if bootstrap_p05 < 0.35:
        reasons.append("recording_bootstrap_p05_low")
    if top_feedback_share > 0.65 and feedback_rows > 0:
        reasons.append("feedback_concentrated_in_one_recording_family")
    if per_group["zeroRecallGroups"]:
        reasons.append("one_or_more_groups_have_zero_validation_recall")
    if per_group["lowPrecisionGroups"]:
        reasons.append("one_or_more_groups_have_low_validation_precision")

    if validation_unacceptable_hard_rows > 0 or validation_unacceptable_clean > 0.05:
        category = "reject"
    elif (
        float(validation["f1"]) >= 0.70
        and float(validation["precision"]) >= 0.85
        and float(validation["clearRecall"]) >= 0.70
        and bootstrap_p05 >= 0.50
        and not per_group["zeroRecallGroups"]
        and top_feedback_share <= 0.65
    ):
        category = "ready_for_future_holdout"
    elif float(validation["f1"]) >= 0.65 and (bootstrap_p05 < 0.35 or top_feedback_share > 0.70 or per_group["zeroRecallGroups"]):
        category = "fragile"
    else:
        category = "promising"

    dev_warnings: list[str] = []
    if test:
        test_unacceptable_clean = (
            float(tolerant_test.get("cleanUnacceptableFalsePositiveRate", test["cleanFalsePositiveRate"]))
            if tolerant_test
            else float(test["cleanFalsePositiveRate"])
        )
        test_unacceptable_hard_rows = (
            int(tolerant_test.get("hardNegativeUnacceptableFalsePositiveRows", test["hardNegativeFalsePositiveRows"]))
            if tolerant_test
            else int(test["hardNegativeFalsePositiveRows"])
        )
        if test_unacceptable_clean > 0.05:
            dev_warnings.append("dev_test_unacceptable_clean_fp_above_5_percent")
        if test_unacceptable_hard_rows > 0:
            dev_warnings.append("dev_test_unacceptable_hard_negative_fp")
        if float(test["precision"]) < 0.85:
            dev_warnings.append("dev_test_precision_below_85_percent")
        if float(test["f1"]) < 0.70:
            dev_warnings.append("dev_test_f1_below_70_percent")

    return {
        "score": score,
        "category": category,
        "reasons": reasons,
        "devSanityWarnings": dev_warnings,
        "selectionUsesTest": False,
        "targets": {
            "f1": 0.70,
            "precision": 0.85,
            "cleanFalsePositiveRate": 0.05,
            "unacceptableHardNegativeFalsePositiveRows": 0,
            "clearRecall": 0.70,
            "recordingBootstrapF1P05Minimum": 0.50,
        },
        "validationSafety": {
            "unacceptableCleanFalsePositiveRate": validation_unacceptable_clean,
            "unacceptableHardNegativeFalsePositiveRows": validation_unacceptable_hard_rows,
            "acceptableBorderlineWarningRows": validation_borderline_rows,
        },
        "recordingBootstrapF1": bootstrap_f1 if bootstrap.get("available") else {"available": False, "reason": bootstrap.get("reason")},
        "recordingFamilyConcentration": concentration,
        "perGroupFloors": per_group,
        "feedbackRows": feedback_rows,
    }


def grouped_leaderboard_recommendations(entries: list[dict[str, Any]]) -> dict[str, Any]:
    def best(predicate: Any, metric: str = "rankScore") -> dict[str, Any] | None:
        eligible = [entry for entry in entries if predicate(entry)]
        if not eligible:
            return None
        return max(eligible, key=lambda entry: float(entry.get(metric, float("-inf"))))

    def robust_best(predicate: Any) -> dict[str, Any] | None:
        eligible = [entry for entry in entries if predicate(entry)]
        if not eligible:
            return None
        return max(eligible, key=lambda entry: float(entry.get("robustAssessment", {}).get("score", float("-inf"))))

    def dev_best(predicate: Any) -> dict[str, Any] | None:
        eligible = [entry for entry in entries if predicate(entry) and entry.get("test")]
        if not eligible:
            return None
        return max(
            eligible,
            key=lambda entry: (
                float(entry["test"].get("f1", 0.0)),
                float(entry["test"].get("precision", 0.0)),
                -float(entry["test"].get("cleanFalsePositiveRate", 1.0)),
            ),
        )

    def tolerant_test_value(entry: dict[str, Any], key: str, fallback_key: str, default: float | int) -> Any:
        tolerant_test = entry.get("tolerantTest")
        test_report = entry.get("test") or {}
        if isinstance(tolerant_test, dict) and key in tolerant_test:
            return tolerant_test.get(key)
        return test_report.get(fallback_key, default)

    return {
        "selectionSplit": "validation",
        "testUsage": "final_reporting_only",
        "bestStrictSafe": best(lambda entry: bool(entry.get("validationFlags", {}).get("strictSafe"))),
        "bestProductTolerant": best(lambda entry: bool(entry.get("validationFlags", {}).get("productTolerantSafe"))),
        "bestExploratoryHighRecall": best(lambda entry: bool(entry.get("validationFlags", {}).get("exploratoryHighRecallSafe"))),
        "bestSetLevelBackup": best(
            lambda entry: entry.get("family") == "set_level_or_backup"
            and bool(entry.get("validationFlags", {}).get("productTolerantSafe"))
        ),
        "bestRobustValidationCandidate": robust_best(
            lambda entry: entry.get("robustAssessment", {}).get("category") in {"promising", "ready_for_future_holdout"}
        ),
        "readyForFutureHoldoutCandidate": robust_best(
            lambda entry: entry.get("robustAssessment", {}).get("category") == "ready_for_future_holdout"
        ),
        "currentBestDevDiagnosticCandidate": dev_best(
            lambda entry: (
                tolerant_test_value(entry, "cleanUnacceptableFalsePositiveRate", "cleanFalsePositiveRate", 1.0) <= 0.05
                and int(tolerant_test_value(entry, "hardNegativeUnacceptableFalsePositiveRows", "hardNegativeFalsePositiveRows", 99)) == 0
            )
        ),
        "categoryCounts": {
            category: sum(
                1
                for entry in entries
                if entry.get("robustAssessment", {}).get("category") == category
            )
            for category in ["reject", "fragile", "promising", "ready_for_future_holdout"]
        },
        "selectionDoesNotUseTest": True,
    }


def grouped_feedback_leaderboard_entries(
    model: str,
    split_reports: dict[str, Any],
    tolerant_policy_comparison: dict[str, Any],
    set_reports: dict[str, Any],
    transition_reports: dict[str, Any],
    feedback_row_reports: dict[str, Any],
    stability_reports: dict[str, Any],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    validation_policies = split_reports.get("validation", {})
    tolerant_splits = tolerant_policy_comparison.get("splits", {}) if tolerant_policy_comparison.get("available") else {}
    for policy_name in sorted(validation_policies.keys()):
        set_policy_name = grouped_set_policy_name(policy_name)
        validation = compact_grouped_prediction_report(split_reports.get("validation", {}).get(policy_name))
        tolerant_validation = compact_tolerant_grouped_report(tolerant_splits.get("validation", {}).get(policy_name))
        test = compact_grouped_prediction_report(split_reports.get("test", {}).get(policy_name))
        tolerant_test = compact_tolerant_grouped_report(tolerant_splits.get("test", {}).get(policy_name))
        robust_assessment = robust_grouped_policy_assessment(
            validation,
            tolerant_validation,
            stability_reports.get("validation", {}).get(policy_name),
            feedback_row_reports.get("validation", {}).get(policy_name),
            split_reports.get("validation", {}).get(policy_name),
            test,
            tolerant_test,
        )
        entry = {
            "candidateId": f"{model}.{policy_name}",
            "model": model,
            "policy": policy_name,
            "family": grouped_policy_family(policy_name),
            "selectionSplit": "validation",
            "testUsage": "final_reporting_only",
            "rankScore": grouped_leaderboard_rank_score(validation, tolerant_validation),
            "robustScore": robust_assessment["score"],
            "robustAssessment": robust_assessment,
            "validationFlags": grouped_leaderboard_flags(validation, tolerant_validation),
            "train": compact_grouped_prediction_report(split_reports.get("train", {}).get(policy_name)),
            "validation": validation,
            "test": test,
            "tolerantTrain": compact_tolerant_grouped_report(tolerant_splits.get("train", {}).get(policy_name)),
            "tolerantValidation": tolerant_validation,
            "tolerantTest": tolerant_test,
            "transitionTrain": transition_reports.get("train", {}).get(policy_name),
            "transitionValidation": transition_reports.get("validation", {}).get(policy_name),
            "transitionTest": transition_reports.get("test", {}).get(policy_name),
            "feedbackRowsTrain": feedback_row_reports.get("train", {}).get(policy_name),
            "feedbackRowsValidation": feedback_row_reports.get("validation", {}).get(policy_name),
            "feedbackRowsTest": feedback_row_reports.get("test", {}).get(policy_name),
            "stabilityTrain": stability_reports.get("train", {}).get(policy_name),
            "stabilityValidation": stability_reports.get("validation", {}).get(policy_name),
            "stabilityTest": stability_reports.get("test", {}).get(policy_name),
            "setTrain": compact_grouped_set_report(set_reports.get("train", {}).get(set_policy_name)) if set_policy_name else None,
            "setValidation": compact_grouped_set_report(set_reports.get("validation", {}).get(set_policy_name)) if set_policy_name else None,
            "setTest": compact_grouped_set_report(set_reports.get("test", {}).get(set_policy_name)) if set_policy_name else None,
        }
        entries.append(entry)
    entries.sort(
        key=lambda entry: (
            entry.get("robustAssessment", {}).get("category") == "ready_for_future_holdout",
            entry.get("robustAssessment", {}).get("category") == "promising",
            float(entry.get("robustScore", float("-inf"))),
        ),
        reverse=True,
    )
    return entries


def numeric_summary(values: pd.Series) -> dict[str, Any]:
    numeric = pd.to_numeric(values, errors="coerce").dropna()
    if len(numeric) == 0:
        return {"count": 0, "mean": None, "p10": None, "p50": None, "p90": None, "min": None, "max": None}
    return {
        "count": int(len(numeric)),
        "mean": float(numeric.mean()),
        "p10": float(numeric.quantile(0.10)),
        "p50": float(numeric.quantile(0.50)),
        "p90": float(numeric.quantile(0.90)),
        "min": float(numeric.min()),
        "max": float(numeric.max()),
    }


def grouped_bottleneck_example(
    row: pd.Series,
    label_column: str,
    probability_column: str,
    feature_columns: list[str],
) -> dict[str, Any]:
    suffix = issue_suffix(label_column)
    feature_values: dict[str, Any] = {}
    for column in feature_columns:
        if column in row.index:
            value = row.get(column)
            if pd.notna(value):
                try:
                    feature_values[column] = float(value)
                except (TypeError, ValueError):
                    feature_values[column] = value
    return {
        "sourceVideo": row.get("source_video"),
        "recording": recording_id_for_review(row.get("source_video") or row.get("recording_file") or row.get("label_file")),
        "recordingFamily": recording_family_name(row.get("source_video") or row.get("recording_file") or row.get("label_file")),
        "split": row.get("split"),
        "repIndex": int(row.get("rep_index", -1)) if pd.notna(row.get("rep_index", None)) else None,
        "startMs": row.get("start_ms"),
        "endMs": row.get("end_ms"),
        "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
        "probability": float(row.get(probability_column, 0.0)) if probability_column in row.index and pd.notna(row.get(probability_column)) else None,
        "severity": row.get(issue_severity_column(label_column)),
        "labelView": row.get("label_view"),
        "labelScorable": row.get("label_scorable"),
        "heuristicScorable": row.get("heuristic_scorable"),
        "diagnosticScorableFeature": row.get("feature__diagnostic.scorable"),
        "groupedCueEligible": row.get(f"feature__diagnostic.cue.{suffix}.eligible"),
        "featureValues": feature_values,
    }


def grouped_bottleneck_examples(
    df: pd.DataFrame,
    label_column: str,
    prediction_column: str,
    probability_column: str,
    feature_columns: list[str],
    kind: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    truth = numeric_int_series(df, label_column)
    prediction = numeric_int_series(df, prediction_column)
    clean = numeric_int_series(df, "label_clean") == 1
    if kind == "falseNegatives":
        mask = (truth == 1) & (prediction == 0)
        reverse = True
    elif kind == "falsePositives":
        mask = (truth == 0) & (prediction == 1)
        reverse = True
    elif kind == "cleanFalsePositives":
        mask = clean & (prediction == 1)
        reverse = True
    elif kind == "truePositives":
        mask = (truth == 1) & (prediction == 1)
        reverse = True
    else:
        return []
    rows = df[mask].copy()
    if len(rows) == 0:
        return []
    if probability_column in rows.columns:
        rows = rows.assign(__probability=pd.to_numeric(rows[probability_column], errors="coerce").fillna(0.0))
        rows = rows.sort_values("__probability", ascending=not reverse)
    return [
        grouped_bottleneck_example(row, label_column, probability_column, feature_columns)
        for _index, row in rows.head(limit).iterrows()
    ]


def grouped_feature_separation(
    df: pd.DataFrame,
    label_column: str,
    feature_columns: list[str],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    truth = numeric_int_series(df, label_column)
    for column in feature_columns:
        if column not in df.columns:
            continue
        values = pd.to_numeric(df[column], errors="coerce")
        positives = values[truth == 1].dropna()
        negatives = values[truth == 0].dropna()
        if len(positives) == 0 or len(negatives) == 0:
            continue
        pooled_std = float(pd.concat([positives, negatives]).std() or 0.0)
        separation = 0.0 if pooled_std == 0.0 else abs(float(positives.mean()) - float(negatives.mean())) / pooled_std
        result.append({
            "feature": column,
            "positiveCount": int(len(positives)),
            "negativeCount": int(len(negatives)),
            "positiveMean": float(positives.mean()),
            "negativeMean": float(negatives.mean()),
            "positiveMedian": float(positives.median()),
            "negativeMedian": float(negatives.median()),
            "absoluteMeanSeparationStd": separation,
        })
    return sorted(result, key=lambda item: item["absoluteMeanSeparationStd"], reverse=True)[:12]


def grouped_probability_bottleneck_summary(
    df: pd.DataFrame,
    label_column: str,
    prediction_column: str,
    probability_column: str,
) -> dict[str, Any]:
    truth = numeric_int_series(df, label_column)
    prediction = numeric_int_series(df, prediction_column)
    probabilities = numeric_float_series(df, probability_column)
    return {
        "positiveProbabilities": numeric_summary(probabilities[truth == 1]),
        "falseNegativeProbabilities": numeric_summary(probabilities[(truth == 1) & (prediction == 0)]),
        "falsePositiveProbabilities": numeric_summary(probabilities[(truth == 0) & (prediction == 1)]),
        "truePositiveProbabilities": numeric_summary(probabilities[(truth == 1) & (prediction == 1)]),
    }


def grouped_static_bottleneck_recommendation(label_column: str) -> dict[str, Any]:
    group_name = label_column.replace("label_issue__barbell_curl_", "")
    if group_name == "tempo_issue":
        return {
            "assessment": "Tempo is policy/feature limited: validation-safe thresholds are high and the direct-gate policy can leave the group with zero test/dev recall.",
            "nextFeatureWork": [
                "Add phase-duration features with explicit fast-concentric and fast-eccentric evidence directions.",
                "Add set-level repeated-brisk-tempo aggregation before rep-level user feedback.",
                "Separate tempo_up and tempo_down as severity/evidence subtypes before regrouping to tempo_issue.",
            ],
            "policySuggestion": "Keep tempo shadow-only or set-level-only until it has nonzero clear recall under safety gates.",
        }
    if group_name == "torso_issue":
        return {
            "assessment": "Torso is precision limited: raw torso-delta-like signals can produce high-confidence false positives in issue recordings.",
            "nextFeatureWork": [
                "Prefer robust sustained torso motion features over max/raw delta spikes in direct evidence gates.",
                "Require repeated evidence across frames or reps for torso feedback.",
                "Add contamination diagnostics separating camera/pose jitter from true torso lean.",
            ],
            "policySuggestion": "Evaluate torso as set-level or repeated-evidence feedback before rep-level user-facing use.",
        }
    if group_name == "shoulder_issue":
        return {
            "assessment": "Shoulder is both precision and recall limited, with mild warnings often product-borderline.",
            "nextFeatureWork": [
                "Improve phase-specific shoulder drift features around the concentric/top endpoint.",
                "Track selected-arm shoulder assistance separately from bilateral drift.",
                "Treat mild shoulder assistance as product-tolerant/low-severity until fresh holdout confirms precision.",
            ],
            "policySuggestion": "Use grouped shoulder_issue only in shadow mode; avoid warn/fail split for early product feedback.",
        }
    if group_name == "rom_issue":
        return {
            "assessment": "ROM is strongest but extension-focused reps remain a recall bottleneck.",
            "nextFeatureWork": [
                "Add bottom-endpoint extension evidence with sustained selected-arm support.",
                "Preserve selected-arm versus bilateral ROM evidence so one unreliable arm does not hide true misses.",
                "Evaluate an incomplete_extend subtype gate inside the grouped ROM policy.",
            ],
            "policySuggestion": "ROM is the closest grouped issue to holdout-readiness, but extension recall needs targeted feature work.",
        }
    return {
        "assessment": "No targeted recommendation configured.",
        "nextFeatureWork": [],
        "policySuggestion": "Keep offline/shadow until validated.",
    }


def build_grouped_bottleneck_analysis(
    df: pd.DataFrame,
    grouped_labels: list[str],
    policy_columns: dict[str, dict[str, str]],
    probability_columns: dict[str, str],
    direct_evidence_gate_choices: dict[str, Any],
) -> dict[str, Any]:
    focus_labels = [
        "label_issue__barbell_curl_tempo_issue",
        "label_issue__barbell_curl_torso_issue",
        "label_issue__barbell_curl_shoulder_issue",
        "label_issue__barbell_curl_rom_issue",
    ]
    focus_labels = [label for label in focus_labels if label in grouped_labels]
    policies_to_compare = [
        "heuristicGrouped",
        "fineOptimizedCollapsedToGroups",
        "repLevelConservative",
        "repLevelTolerantOptimized",
        "repLevelTolerantOptimizedDirectEvidenceGate",
        "repLevelPlusSetBackupBroadcast",
        "setLevelOnlyBroadcast",
    ]
    development = df[df["split"].isin(["train", "validation"])].copy()
    result: dict[str, Any] = {
        "scope": "offline_report_only",
        "selectionSplit": "validation",
        "testUsage": "final_development_diagnostics_only",
        "doesNotChangeLiveBehavior": True,
        "groups": {},
    }
    for label_column in focus_labels:
        probability_column = probability_columns[label_column]
        direct_feature_columns = [
            column
            for column in BARBELL_CURL_GROUPED_DIRECT_EVIDENCE_FEATURES.get(label_column, [])
            if column in df.columns
        ]
        child_support: dict[str, Any] = {}
        for child_label in BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["childLabels"]:
            child_support[issue_name(child_label)] = {
                split: int(numeric_int_series(df[df["split"] == split], child_label).sum())
                for split in ["train", "validation", "test"]
                if len(df[df["split"] == split]) > 0
            }
        split_support = {
            split: int(numeric_int_series(df[df["split"] == split], label_column).sum())
            for split in ["train", "validation", "test"]
            if len(df[df["split"] == split]) > 0
        }
        policy_metrics: dict[str, Any] = {}
        for policy_name in policies_to_compare:
            columns = policy_columns.get(policy_name)
            if not columns or label_column not in columns:
                continue
            policy_metrics[policy_name] = {
                split: evaluate_prediction_set(
                    df[df["split"] == split].copy(),
                    [label_column],
                    {label_column: columns[label_column]},
                    {label_column: probability_column},
                )
                for split in ["validation", "test"]
                if len(df[df["split"] == split]) > 0
            }
        direct_policy_column = policy_columns["repLevelTolerantOptimizedDirectEvidenceGate"][label_column]
        result["groups"][label_column] = {
            "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
            "childIssueSupportBySplit": child_support,
            "groupedSupportBySplit": split_support,
            "directEvidenceSelection": direct_evidence_gate_choices.get(label_column),
            "policyMetrics": policy_metrics,
            "probabilityBottleneck": {
                split: grouped_probability_bottleneck_summary(
                    df[df["split"] == split].copy(),
                    label_column,
                    direct_policy_column,
                    probability_column,
                )
                for split in ["train", "validation", "test"]
                if len(df[df["split"] == split]) > 0
            },
            "featureSeparationTrainValidation": grouped_feature_separation(development, label_column, direct_feature_columns),
            "examples": {
                split: {
                    kind: grouped_bottleneck_examples(
                        df[df["split"] == split].copy(),
                        label_column,
                        direct_policy_column,
                        probability_column,
                        direct_feature_columns,
                        kind,
                    )
                    for kind in ["falseNegatives", "falsePositives", "cleanFalsePositives", "truePositives"]
                }
                for split in ["validation", "test"]
                if len(df[df["split"] == split]) > 0
            },
            "recommendation": grouped_static_bottleneck_recommendation(label_column),
        }
    return result


def grouped_policy_test_summary(
    df: pd.DataFrame,
    grouped_labels: list[str],
    policy_columns: dict[str, str],
    probability_columns: dict[str, str],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for split in ["validation", "test"]:
        subset = df[df["split"] == split].copy()
        if len(subset) == 0:
            continue
        result[split] = evaluate_prediction_set(subset, grouped_labels, policy_columns, probability_columns)
    return result


def build_grouped_feedback_report(
    df: pd.DataFrame,
    label_columns: list[str],
    columns: tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, int]],
    args: argparse.Namespace,
    model: str,
    review_annotations: dict[str, Any] | None = None,
    include_bottleneck_analysis: bool = True,
    include_direct_evidence_search: bool = True,
    stability_splits: list[str] | None = None,
    stability_iterations: int = 100,
    include_policy_combination: bool = True,
) -> dict[str, Any]:
    if args.exercise != "barbell-curl":
        return {"available": False, "reason": "grouped_feedback_report_currently_scoped_to_barbell_curl"}
    grouped_labels = grouped_feedback_label_columns(label_columns)
    if not grouped_labels:
        return {"available": False, "reason": "no_grouped_barbell_curl_targets_present"}
    (
        heuristic_prediction_columns,
        ml_prediction_columns,
        _hybrid_prediction_columns,
        _suppression_prediction_columns,
        _additive_prediction_columns,
        _suppress_and_add_prediction_columns,
        ml_probability_columns,
        _candidate_counts,
    ) = columns
    missing_probability_columns = [
        column
        for column in grouped_feedback_probability_columns(grouped_labels, model).values()
        if column not in df.columns
    ]
    if missing_probability_columns:
        return {
            "available": False,
            "reason": "missing_grouped_probability_columns",
            "missingProbabilityColumns": missing_probability_columns,
        }

    validation = df[df["split"] == "validation"].copy()
    if len(validation) == 0:
        return {"available": False, "reason": "no_validation_rows"}
    review_annotations = review_annotations or load_review_annotations(None)

    column_prefix = safe_model_column_part(model)
    optimized_fine_columns = {
        label_column: f"eval_{column_prefix}__policy_optimizedIssueHybrid__{issue_suffix(label_column)}"
        for label_column in label_columns
        if f"eval_{column_prefix}__policy_optimizedIssueHybrid__{issue_suffix(label_column)}" in df.columns
    }
    heuristic_group_columns = {label_column: heuristic_prediction_columns[label_column] for label_column in grouped_labels}
    ml_group_columns = {label_column: ml_prediction_columns[label_column] for label_column in grouped_labels}
    probability_group_columns = {label_column: ml_probability_columns[label_column] for label_column in grouped_labels}

    strict_choices: dict[str, Any] = {}
    conservative_choices: dict[str, Any] = {}
    tolerant_optimized_choices: dict[str, Any] = {}
    direct_evidence_gate_choices: dict[str, Any] = {}
    strict_series: dict[str, pd.Series] = {}
    conservative_series: dict[str, pd.Series] = {}
    tolerant_optimized_series: dict[str, pd.Series] = {}
    direct_evidence_gate_series: dict[str, pd.Series] = {}
    high_confidence_series: dict[str, pd.Series] = {}
    collapsed_fine_series: dict[str, pd.Series] = {}
    for label_column in grouped_labels:
        strict_choice = choose_grouped_threshold_policy(
            validation,
            label_column,
            heuristic_group_columns[label_column],
            ml_group_columns[label_column],
            probability_group_columns[label_column],
            args,
            mode="strict",
        )
        conservative_choice = choose_grouped_threshold_policy(
            validation,
            label_column,
            heuristic_group_columns[label_column],
            ml_group_columns[label_column],
            probability_group_columns[label_column],
            args,
            mode="conservative",
        )
        tolerant_optimized_choice = choose_grouped_tolerant_threshold_policy(
            validation,
            label_column,
            heuristic_group_columns[label_column],
            ml_group_columns[label_column],
            probability_group_columns[label_column],
            args,
            review_annotations,
        )
        strict_choices[label_column] = strict_choice
        conservative_choices[label_column] = conservative_choice
        tolerant_optimized_choices[label_column] = tolerant_optimized_choice
        strict_series[label_column] = grouped_threshold_series(
            df,
            label_column,
            probability_group_columns[label_column],
            strict_choice["threshold"],
        )
        conservative_series[label_column] = grouped_threshold_series(
            df,
            label_column,
            probability_group_columns[label_column],
            conservative_choice["threshold"],
        )
        tolerant_optimized_series[label_column] = grouped_threshold_series(
            df,
            label_column,
            probability_group_columns[label_column],
            tolerant_optimized_choice["threshold"],
        )
        if include_direct_evidence_search:
            direct_evidence_gate_choice = choose_grouped_direct_evidence_gate_policy(
                validation,
                label_column,
                heuristic_group_columns[label_column],
                ml_group_columns[label_column],
                tolerant_optimized_series[label_column].reindex(validation.index),
                args,
                review_annotations,
            )
        else:
            base_summary = tolerant_grouped_candidate_summary_from_series(
                validation,
                label_column,
                numeric_int_series(validation, heuristic_group_columns[label_column]),
                numeric_int_series(validation, ml_group_columns[label_column]),
                tolerant_optimized_series[label_column].reindex(validation.index),
                review_annotations,
            )
            direct_evidence_gate_choice = {
                "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
                "labelColumn": label_column,
                "feedbackText": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackText"],
                "selected": "base-tolerant-optimized",
                "threshold": None,
                "evidenceColumn": None,
                "validationMetrics": base_summary,
                "allowedCandidateCount": 0,
                "candidateCount": 0,
                "selectionMetric": "Direct-evidence search skipped for nested unified leaderboard model report; selected-model report contains full search.",
                "topValidationCandidates": [],
            }
        direct_evidence_gate_choices[label_column] = direct_evidence_gate_choice
        direct_evidence_gate_series[label_column] = apply_grouped_direct_evidence_gate(
            df,
            label_column,
            tolerant_optimized_series[label_column],
            direct_evidence_gate_choice,
        )
        high_confidence_series[label_column] = grouped_threshold_series(
            df,
            label_column,
            probability_group_columns[label_column],
            0.95,
        )
        collapsed_fine_series[label_column] = collapsed_child_policy_series(
            df,
            label_column,
            optimized_fine_columns,
        )

    set_backup_series = set_backup_grouped_series(
        df,
        grouped_labels,
        probability_group_columns,
        args.grouped_set_threshold,
        args.grouped_set_min_reps,
    )
    rep_plus_set_series = combine_grouped_series(grouped_labels, conservative_series, set_backup_series)
    torso_label = "label_issue__barbell_curl_torso_issue"
    torso_disabled_series = {
        label_column: (
            pd.Series([0] * len(df), index=df.index)
            if label_column == torso_label
            else tolerant_optimized_series[label_column]
        )
        for label_column in grouped_labels
    }
    torso_set_backup_series = {
        label_column: (
            set_backup_series[label_column]
            if label_column == torso_label
            else tolerant_optimized_series[label_column]
        )
        for label_column in grouped_labels
    }

    policy_columns = {
        "heuristicGrouped": heuristic_group_columns,
        "mlOnlyGrouped": ml_group_columns,
        "fineOptimizedCollapsedToGroups": materialize_grouped_policy_columns(df, grouped_labels, model, "fineOptimizedCollapsedToGroups", collapsed_fine_series),
        "repLevelOnlyHighConfidence": materialize_grouped_policy_columns(df, grouped_labels, model, "repLevelOnlyHighConfidence", high_confidence_series),
        "repLevelConservative": materialize_grouped_policy_columns(df, grouped_labels, model, "repLevelConservative", conservative_series),
        "repLevelStrictF1": materialize_grouped_policy_columns(df, grouped_labels, model, "repLevelStrictF1", strict_series),
        "repLevelTolerantOptimized": materialize_grouped_policy_columns(df, grouped_labels, model, "repLevelTolerantOptimized", tolerant_optimized_series),
        "repLevelTolerantOptimizedDirectEvidenceGate": materialize_grouped_policy_columns(df, grouped_labels, model, "repLevelTolerantOptimizedDirectEvidenceGate", direct_evidence_gate_series),
        "repLevelTolerantOptimizedTorsoDisabled": materialize_grouped_policy_columns(df, grouped_labels, model, "repLevelTolerantOptimizedTorsoDisabled", torso_disabled_series),
        "repLevelTolerantOptimizedTorsoSetBackupBroadcast": materialize_grouped_policy_columns(df, grouped_labels, model, "repLevelTolerantOptimizedTorsoSetBackupBroadcast", torso_set_backup_series),
        "repLevelPlusSetBackupBroadcast": materialize_grouped_policy_columns(df, grouped_labels, model, "repLevelPlusSetBackupBroadcast", rep_plus_set_series),
        "setLevelOnlyBroadcast": materialize_grouped_policy_columns(df, grouped_labels, model, "setLevelOnlyBroadcast", set_backup_series),
    }
    split_reports = grouped_split_reports(df, grouped_labels, policy_columns, probability_group_columns)
    tolerant_policy_comparison = grouped_tolerant_policy_comparison(
        df,
        grouped_labels,
        policy_columns,
        review_annotations,
    )
    transition_reports = grouped_policy_transition_reports(
        df,
        grouped_labels,
        heuristic_group_columns,
        ml_group_columns,
        policy_columns,
    )
    feedback_row_reports = grouped_policy_feedback_row_reports(df, policy_columns)
    stability_reports = grouped_policy_stability_reports(
        df,
        grouped_labels,
        policy_columns,
        splits=stability_splits or ["validation"],
        iterations=stability_iterations,
    )

    set_reports: dict[str, Any] = {}
    for split in ["train", "validation", "test"]:
        subset = df[df["split"] == split].copy()
        if len(subset) == 0:
            continue
        subset_series = {
            "repLevelOnlyHighConfidence": {label: high_confidence_series[label].reindex(subset.index) for label in grouped_labels},
            "repLevelConservative": {label: conservative_series[label].reindex(subset.index) for label in grouped_labels},
            "repLevelTolerantOptimized": {label: tolerant_optimized_series[label].reindex(subset.index) for label in grouped_labels},
            "repLevelTolerantOptimizedDirectEvidenceGate": {label: direct_evidence_gate_series[label].reindex(subset.index) for label in grouped_labels},
            "repLevelTolerantOptimizedTorsoDisabled": {label: torso_disabled_series[label].reindex(subset.index) for label in grouped_labels},
            "repLevelTolerantOptimizedTorsoSetBackup": {label: torso_set_backup_series[label].reindex(subset.index) for label in grouped_labels},
            "repLevelPlusSetBackup": {label: rep_plus_set_series[label].reindex(subset.index) for label in grouped_labels},
            "setLevelOnly": {label: set_backup_series[label].reindex(subset.index) for label in grouped_labels},
            "fineOptimizedCollapsedToGroups": {label: collapsed_fine_series[label].reindex(subset.index) for label in grouped_labels},
        }
        set_reports[split] = {
            policy_name: set_level_grouped_metrics(subset, grouped_labels, series)
            for policy_name, series in subset_series.items()
        }

    per_target: dict[str, Any] = {}
    for label_column in grouped_labels:
        selected_policy_name = "repLevelTolerantOptimized" if review_annotations.get("provided") else "repLevelConservative"
        target_columns = {label_column: policy_columns[selected_policy_name][label_column]}
        target_probability = {label_column: probability_group_columns[label_column]}
        target_summary = grouped_policy_test_summary(df, [label_column], target_columns, target_probability)
        conservative_target_summary = grouped_policy_test_summary(
            df,
            [label_column],
            {label_column: policy_columns["repLevelConservative"][label_column]},
            target_probability,
        )
        validation_summary = target_summary.get("validation", {})
        validation_aggregate = validation_summary.get("aggregate", {}) if isinstance(validation_summary, dict) else {}
        validation_safety = validation_summary.get("safety", {}) if isinstance(validation_summary, dict) else {}
        validation_hard_negative_rows = (
            validation_safety.get("slices", {}).get("hardNegativeClean", {}).get("falsePositiveRows", 0)
            if isinstance(validation_safety, dict)
            else 0
        )
        validation_clean_rows = (
            validation_safety.get("slices", {}).get("allClean", {}).get("falsePositiveRows", 0)
            if isinstance(validation_safety, dict)
            else 0
        )
        per_target[label_column] = {
            "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
            "feedbackText": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackText"],
            "childIssues": [
                issue_name(child_label)
                for child_label in BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["childLabels"]
            ],
            "eligibilityFeaturesUsed": grouped_feedback_eligibility_columns(df, label_column),
            "strictSelection": strict_choices[label_column],
            "conservativeSelection": conservative_choices[label_column],
            "tolerantOptimizedSelection": tolerant_optimized_choices[label_column],
            "directEvidenceGateSelection": direct_evidence_gate_choices[label_column],
            "selectedRepPolicy": selected_policy_name,
            "validationAndTestMetrics": target_summary,
            "conservativeValidationAndTestMetrics": conservative_target_summary,
            "readyForShadowMode": bool(
                conservative_choices[label_column]["threshold"] is not None
                and float(validation_aggregate.get("f1", 0.0)) > 0
                and int(validation_clean_rows) <= args.grouped_policy_clean_fp_row_cap
                and int(validation_hard_negative_rows) <= args.grouped_policy_hard_negative_fp_row_cap
            ),
            "readyForUserFacingFeedback": False,
            "productionCaveat": "Requires fresh independent holdout and product review before live feedback.",
        }

    test_subset = df[df["split"] == "test"].copy()
    review_examples = {}
    if len(test_subset) > 0:
        review_examples["testRepLevelConservative"] = policy_review_examples(
            test_subset,
            grouped_labels,
            heuristic_group_columns,
            ml_group_columns,
            policy_columns["repLevelConservative"],
            probability_group_columns,
            conservative_choices,
        )
        review_examples["testFineOptimizedCollapsedToGroups"] = policy_review_examples(
            test_subset,
            grouped_labels,
            heuristic_group_columns,
            ml_group_columns,
            policy_columns["fineOptimizedCollapsedToGroups"],
            probability_group_columns,
            {},
        )
        review_examples["testRepLevelTolerantOptimized"] = policy_review_examples(
            test_subset,
            grouped_labels,
            heuristic_group_columns,
            ml_group_columns,
            policy_columns["repLevelTolerantOptimized"],
            probability_group_columns,
            tolerant_optimized_choices,
        )
        review_examples["testRepLevelTolerantOptimizedDirectEvidenceGate"] = policy_review_examples(
            test_subset,
            grouped_labels,
            heuristic_group_columns,
            ml_group_columns,
            policy_columns["repLevelTolerantOptimizedDirectEvidenceGate"],
            probability_group_columns,
            direct_evidence_gate_choices,
        )

    leaderboard_entries = grouped_feedback_leaderboard_entries(
        model,
        split_reports,
        tolerant_policy_comparison,
        set_reports,
        transition_reports,
        feedback_row_reports,
        stability_reports,
    )
    bottleneck_analysis = (
        build_grouped_bottleneck_analysis(
            df,
            grouped_labels,
            policy_columns,
            probability_group_columns,
            direct_evidence_gate_choices,
        )
        if include_bottleneck_analysis
        else {
            "available": False,
            "reason": "disabled_for_nested_unified_leaderboard_model_report",
            "doesNotChangeLiveBehavior": True,
        }
    )
    models_available = detected_models(df)
    per_group_policy_combination = (
        build_grouped_policy_combination_report(
            df,
            label_columns,
            args,
            review_annotations,
            models_available,
        )
        if include_policy_combination
        else {
            "available": False,
            "reason": "disabled_for_nested_grouped_feedback_report",
            "liveBehaviorChanged": False,
        }
    )

    return {
        "available": True,
        "scope": "offline_shadow_evaluation_only",
        "selectionSplit": "validation",
        "testUsage": "final_reporting_only",
        "model": model,
        "groupedTargets": {
            label_column: {
                "issueId": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackId"],
                "feedbackText": BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["feedbackText"],
                "childIssues": [
                    issue_name(child_label)
                    for child_label in BARBELL_CURL_GROUPED_FEEDBACK_TARGETS[label_column]["childLabels"]
                ],
            }
            for label_column in grouped_labels
        },
        "policyConfig": {
            "repHighConfidenceThreshold": 0.95,
            "setBackupThreshold": args.grouped_set_threshold,
            "setBackupMinReps": args.grouped_set_min_reps,
            "validationMinPrecision": args.grouped_policy_min_precision,
            "validationCleanFpRowCap": args.grouped_policy_clean_fp_row_cap,
            "validationHardNegativeFpRowCap": args.grouped_policy_hard_negative_fp_row_cap,
            "validationPartialViewFpRowCap": args.grouped_policy_partial_view_fp_row_cap,
            "tolerantOptimizedPolicy": "When --review-annotations is provided, validation selection may count acceptable-borderline grouped warnings separately from unacceptable false positives. Strict metrics are still reported unchanged.",
            "directEvidenceGatePolicy": "Offline diagnostic policy: grouped predictions from repLevelTolerantOptimized may be gated by validation-selected direct evidence features where configured. Test remains final-reporting only.",
            "torsoDisabledPolicy": "Offline comparison only: repLevelTolerantOptimizedTorsoDisabled suppresses the grouped torso issue while leaving other grouped policies unchanged.",
            "torsoSetBackupPolicy": "Offline comparison only: repLevelTolerantOptimizedTorsoSetBackupBroadcast uses tolerant optimized rep-level predictions for non-torso groups and set-level backup broadcast for torso.",
        },
        "reviewAnnotations": {
            "provided": bool(review_annotations.get("provided")),
            "path": review_annotations.get("path"),
            "schemaVersion": review_annotations.get("schemaVersion"),
            "annotationCount": review_annotations.get("annotationCount", 0),
            "warnings": review_annotations.get("warnings", []),
            "formatTemplate": review_annotations.get("template"),
        },
        "viewPoseCueSafety": {
            "repLevelScorableGate": "Uses heuristic_scorable and feature__diagnostic.scorable when exported.",
            "cueEligibilityGate": "Grouped ML additions require at least one child issue's exported scorable/cue eligibility feature to pass when those features exist.",
            "unscorableHandling": "Predictions are forced off when rep-level scorable gates fail.",
            "setLevelBackup": "Set-level backup is a summary-only policy in this report; it is not rep-completion-time feedback.",
        },
        "thresholdSelection": {
            "strictF1": strict_choices,
            "conservative": conservative_choices,
            "tolerantOptimized": tolerant_optimized_choices,
            "directEvidenceGate": direct_evidence_gate_choices,
        },
        "perTargetRecommendation": per_target,
        "repLevelPolicyComparison": split_reports,
        "tolerantPolicyComparison": tolerant_policy_comparison,
        "policyTransitionComparison": transition_reports,
        "policyFeedbackRows": feedback_row_reports,
        "policyStability": stability_reports,
        "setLevelPolicyComparison": set_reports,
        "leaderboard": {
            "entries": leaderboard_entries,
            "recommendations": grouped_leaderboard_recommendations(leaderboard_entries),
            "definition": "Ranks grouped-feedback candidates by validation-only robust score with strict/product-tolerant safety flags, per-group floors, recording-family concentration, and recording-bootstrap stability. Test metrics are included only for final development reporting.",
        },
        "bottleneckAnalysis": bottleneck_analysis,
        "perGroupPolicyCombination": per_group_policy_combination,
        "productPolicyComparison": {
            "A_repLevelOnlyHighConfidence": {
                "repLevelPolicy": "repLevelOnlyHighConfidence",
                "setLevelPolicy": "any high-confidence rep",
                "splits": {
                    split: {
                        "rep": split_reports[split]["repLevelOnlyHighConfidence"],
                        "set": set_reports[split]["repLevelOnlyHighConfidence"],
                    }
                    for split in split_reports
                    if split in set_reports
                },
            },
            "B_repLevelConservative": {
                "repLevelPolicy": "repLevelConservative",
                "setLevelPolicy": "any conservative rep",
                "splits": {
                    split: {
                        "rep": split_reports[split]["repLevelConservative"],
                        "set": set_reports[split]["repLevelConservative"],
                    }
                    for split in split_reports
                    if split in set_reports
                },
            },
            "C_repLevelPlusSetBackup": {
                "repLevelPolicy": "repLevelConservative for immediate rep feedback",
                "setLevelPolicy": f"backup if >= {args.grouped_set_min_reps} eligible reps have p >= {args.grouped_set_threshold}",
                "splits": {
                    split: {
                        "repImmediate": split_reports[split]["repLevelConservative"],
                        "repBroadcastForAnalysisOnly": split_reports[split]["repLevelPlusSetBackupBroadcast"],
                        "set": set_reports[split]["repLevelPlusSetBackup"],
                    }
                    for split in split_reports
                    if split in set_reports
                },
            },
            "D_repLevelTolerantOptimized": {
                "repLevelPolicy": "repLevelTolerantOptimized",
                "setLevelPolicy": "any tolerant-optimized rep",
                "selectionSplit": "validation",
                "usesReviewAnnotationsForSelection": bool(review_annotations.get("provided")),
                "splits": {
                    split: {
                        "rep": split_reports[split]["repLevelTolerantOptimized"],
                        "set": set_reports[split]["repLevelTolerantOptimized"],
                    }
                    for split in split_reports
                    if split in set_reports
                },
            },
            "E_repLevelTolerantOptimizedDirectEvidenceGate": {
                "repLevelPolicy": "repLevelTolerantOptimizedDirectEvidenceGate",
                "setLevelPolicy": "any tolerant-optimized rep after validation-selected direct-evidence gates",
                "selectionSplit": "validation",
                "usesTestForSelection": False,
                "splits": {
                    split: {
                        "rep": split_reports[split]["repLevelTolerantOptimizedDirectEvidenceGate"],
                        "set": set_reports[split]["repLevelTolerantOptimizedDirectEvidenceGate"],
                    }
                    for split in split_reports
                    if split in set_reports
                },
            },
            "F_repLevelTolerantOptimizedTorsoDisabled": {
                "repLevelPolicy": "repLevelTolerantOptimizedTorsoDisabled",
                "setLevelPolicy": "any tolerant-optimized rep with grouped torso issue disabled",
                "selectionSplit": "validation",
                "usesTestForSelection": False,
                "splits": {
                    split: {
                        "rep": split_reports[split]["repLevelTolerantOptimizedTorsoDisabled"],
                        "set": set_reports[split]["repLevelTolerantOptimizedTorsoDisabled"],
                    }
                    for split in split_reports
                    if split in set_reports
                },
            },
            "G_repLevelTolerantOptimizedTorsoSetBackup": {
                "repLevelPolicy": "repLevelTolerantOptimizedTorsoSetBackupBroadcast",
                "setLevelPolicy": f"torso uses backup if >= {args.grouped_set_min_reps} eligible reps have p >= {args.grouped_set_threshold}; other groups use tolerant-optimized reps",
                "selectionSplit": "validation",
                "usesTestForSelection": False,
                "splits": {
                    split: {
                        "repBroadcastForAnalysisOnly": split_reports[split]["repLevelTolerantOptimizedTorsoSetBackupBroadcast"],
                        "set": set_reports[split]["repLevelTolerantOptimizedTorsoSetBackup"],
                    }
                    for split in split_reports
                    if split in set_reports
                },
            },
            "H_setLevelOnly": {
                "repLevelPolicy": "none",
                "setLevelPolicy": f"show set summary if >= {args.grouped_set_min_reps} eligible reps have p >= {args.grouped_set_threshold}",
                "splits": {
                    split: {
                        "set": set_reports[split]["setLevelOnly"],
                    }
                    for split in set_reports
                },
            },
        },
        "reviewExamples": review_examples,
        "inferenceAndTimingFeasibility": {
            "repCompletionTime": "Rep-level high-confidence/conservative policies only need features and probabilities from the completed rep, plus exported scorable/cue eligibility gates.",
            "requiresFutureSetContext": ["setLevelOnly", "repLevelPlusSetBackup.setBackup"],
            "notIntegrated": True,
        },
        "freshHoldoutCaveat": "Preliminary: split audit still indicates leakage risk, so grouped feedback must remain offline/shadow until validated on a fresh independent holdout.",
        "liveBehaviorChanged": False,
    }


def split_reports_for_model(
    df: pd.DataFrame,
    label_columns: list[str],
    columns: tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, int]],
    args: argparse.Namespace,
    model: str,
    include_bootstrap: bool = True,
) -> dict[str, Any]:
    (
        heuristic_prediction_columns,
        ml_prediction_columns,
        hybrid_prediction_columns,
        suppression_prediction_columns,
        additive_prediction_columns,
        suppress_and_add_prediction_columns,
        ml_probability_columns,
        _candidate_counts,
    ) = columns
    policy_prediction_sets, policy_selection = build_policy_prediction_sets(
        df,
        label_columns,
        model,
        heuristic_prediction_columns,
        ml_prediction_columns,
        hybrid_prediction_columns,
        suppression_prediction_columns,
        additive_prediction_columns,
        suppress_and_add_prediction_columns,
        args,
    )
    split_reports: dict[str, Any] = {}
    present_splits = [split for split in ["train", "validation", "test"] if int((df["split"] == split).sum()) > 0]
    for split in present_splits:
        subset = df[df["split"] == split].copy()
        policy_reports = {
            policy_name: evaluate_prediction_set(subset, label_columns, prediction_columns)
            for policy_name, prediction_columns in policy_prediction_sets.items()
        }
        policy_deltas = {
            policy_name: hybrid_transition_metrics(
                subset,
                label_columns,
                heuristic_prediction_columns,
                ml_prediction_columns,
                prediction_columns,
            )
            for policy_name, prediction_columns in policy_prediction_sets.items()
            if policy_name not in {"heuristicOnly", "mlOnly"}
        }
        optimized_policy_columns = policy_prediction_sets.get("optimizedIssueHybrid")
        split_reports[split] = {
            "rowCount": len(subset),
            "heuristicOnly": evaluate_prediction_set(subset, label_columns, heuristic_prediction_columns),
            "currentOptimiserTunedHeuristic": evaluate_prediction_set(subset, label_columns, heuristic_prediction_columns),
            "mlOnly": evaluate_prediction_set(subset, label_columns, ml_prediction_columns, ml_probability_columns),
            "hybridConservative": evaluate_prediction_set(subset, label_columns, hybrid_prediction_columns),
            "heuristicWithMlSuppressions": evaluate_prediction_set(subset, label_columns, suppression_prediction_columns),
            "heuristicWithMlAdditionalFlags": evaluate_prediction_set(subset, label_columns, additive_prediction_columns),
            "heuristicWithMlSuppressAndAdd": evaluate_prediction_set(subset, label_columns, suppress_and_add_prediction_columns),
            "hybridPolicies": policy_reports,
            "hybridDeltas": hybrid_transition_metrics(
                subset,
                label_columns,
                heuristic_prediction_columns,
                ml_prediction_columns,
                hybrid_prediction_columns,
            ),
            "policyDeltas": policy_deltas,
            "policyReviewExamples": {
                "optimizedIssueHybrid": policy_review_examples(
                    subset,
                    label_columns,
                    heuristic_prediction_columns,
                    ml_prediction_columns,
                    optimized_policy_columns,
                    ml_probability_columns,
                    policy_selection.get("issueSpecificChoices", {}).get("optimizedIssueHybrid", {}),
                )
            } if optimized_policy_columns else {},
            "policySelection": policy_selection,
            "bootstrap": {
                "heuristicOnly": bootstrap_f1(subset, label_columns, heuristic_prediction_columns),
                "mlOnly": bootstrap_f1(subset, label_columns, ml_prediction_columns),
                "hybridConservative": bootstrap_f1(subset, label_columns, hybrid_prediction_columns),
            } if include_bootstrap else {"available": False, "reason": "disabled_for_nested_model_comparison"},
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
                **{
                    f"policy.{policy_name}": gate_results(
                        policy_report,
                        args.gate_validation_clean_fp_cap,
                        args.gate_validation_hard_negative_fp_cap,
                        args.gate_min_validation_recall,
                    )
                    for policy_name, policy_report in policy_reports.items()
                    if policy_name != "heuristicOnly"
                },
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
        split_reports = split_reports_for_model(working, label_columns, columns, args, model, include_bootstrap=False)
        for split, split_report in split_reports.items():
            split_bucket = comparison["splits"].setdefault(split, {})
            if "heuristicOnly" not in split_bucket:
                split_bucket["heuristicOnly"] = compact_prediction_summary(split_report["heuristicOnly"])
            split_bucket[f"{model}.mlOnly"] = compact_prediction_summary(split_report["mlOnly"])
            split_bucket[f"{model}.hybridConservative"] = compact_prediction_summary(split_report["hybridConservative"])
            for policy_name, policy_report in split_report.get("hybridPolicies", {}).items():
                if policy_name in {"heuristicOnly", "mlOnly"}:
                    continue
                split_bucket[f"{model}.policy.{policy_name}"] = compact_prediction_summary(policy_report)
            if split == "validation":
                split_bucket[f"{model}.gates"] = split_report["gateResults"]
    return comparison


def build_unified_grouped_feedback_leaderboard(
    df: pd.DataFrame,
    label_columns: list[str],
    models: list[str],
    args: argparse.Namespace,
    review_annotations: dict[str, Any],
    selected_model: str | None = None,
    selected_grouped_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if args.exercise != "barbell-curl":
        return {"available": False, "reason": "grouped_feedback_leaderboard_currently_scoped_to_barbell_curl"}
    grouped_labels = grouped_feedback_label_columns(label_columns)
    if not grouped_labels:
        return {"available": False, "reason": "no_grouped_barbell_curl_targets_present"}
    entries: list[dict[str, Any]] = []
    per_model: dict[str, Any] = {}
    warnings: list[dict[str, str]] = []
    for model in models:
        if selected_model == model and selected_grouped_report and selected_grouped_report.get("available"):
            model_entries = selected_grouped_report.get("leaderboard", {}).get("entries", [])
            entries.extend(model_entries)
            per_model[model] = {
                "available": True,
                "entryCount": len(model_entries),
                "recommendations": selected_grouped_report.get("leaderboard", {}).get("recommendations", {}),
                "source": "selected_model_full_grouped_report",
            }
            continue
        working = df.copy()
        try:
            columns = prepare_model_predictions(working, label_columns, model, args)
            # Materialize optimized fine-label policy columns before collapsing them into grouped feedback.
            split_reports_for_model(working, label_columns, columns, args, model, include_bootstrap=False)
            grouped_report = build_grouped_feedback_report(
                working,
                label_columns,
                columns,
                args,
                model,
                review_annotations,
                include_bottleneck_analysis=False,
                include_direct_evidence_search=False,
                stability_splits=["validation"],
                stability_iterations=100,
                include_policy_combination=False,
            )
        except Exception as exc:  # pragma: no cover - defensive report generation path
            warnings.append({"model": model, "warning": str(exc)})
            continue
        if not grouped_report.get("available"):
            per_model[model] = {
                "available": False,
                "reason": grouped_report.get("reason"),
            }
            continue
        model_entries = grouped_report.get("leaderboard", {}).get("entries", [])
        entries.extend(model_entries)
        per_model[model] = {
            "available": True,
            "entryCount": len(model_entries),
            "recommendations": grouped_report.get("leaderboard", {}).get("recommendations", {}),
        }
    entries.sort(
        key=lambda entry: (
            entry.get("robustAssessment", {}).get("category") == "ready_for_future_holdout",
            entry.get("robustAssessment", {}).get("category") == "promising",
            float(entry.get("robustScore", float("-inf"))),
        ),
        reverse=True,
    )
    validation_ranked_entries = sorted(
        entries,
        key=lambda entry: (
            bool(entry.get("validationFlags", {}).get("productTolerantSafe")),
            bool(entry.get("validationFlags", {}).get("strictSafe")),
            float(entry.get("rankScore", float("-inf"))),
        ),
        reverse=True,
    )
    return {
        "available": True,
        "scope": "offline_shadow_evaluation_only",
        "selectionSplit": "validation",
        "testUsage": "final_reporting_only",
        "models": models,
        "entryCount": len(entries),
        "entries": entries,
        "top50ByRobustRank": entries[:50],
        "top50ByValidationRank": validation_ranked_entries[:50],
        "recommendations": grouped_leaderboard_recommendations(entries),
        "perModel": per_model,
        "warnings": warnings,
        "definition": "Unified Barbell Curl grouped-feedback leaderboard. Robust candidate ranking and recommendations use validation-only metrics, product-tolerant validation safety, per-group floors, recording-family concentration, and validation recording-bootstrap stability. Test metrics are included as final-only development diagnostics, not proof of production generalization.",
        "liveBehaviorChanged": False,
    }


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


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "item") and callable(value.item):
        try:
            return json_safe(value.item())
        except (TypeError, ValueError):
            pass
    if isinstance(value, float) and pd.isna(value):
        return None
    if isinstance(value, str):
        return value
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


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
    split_reports = split_reports_for_model(df, label_columns, selected_columns, args, args.model)
    review_annotations = load_review_annotations(args.review_annotations)
    present_splits = [split for split in ["train", "validation", "test"] if split in split_reports]
    models_available = detected_models(pd.read_csv(predictions_path))
    primary_models_available = primary_models_for_general_comparison(models_available)
    grouped_feedback_report = build_grouped_feedback_report(df, label_columns, selected_columns, args, args.model, review_annotations)

    decision_split = "test" if "test" in split_reports else present_splits[-1] if present_splits else "none"
    output_dir = exercise_dir / "models"
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    report_path = output_dir / f"evaluation_{timestamp}.json"
    latest_path = output_dir / "latest_evaluation.json"
    combination_audit_payload = None
    combination_report = grouped_feedback_report.get("perGroupPolicyCombination")
    if isinstance(combination_report, dict) and combination_report.get("available"):
        combination_audit_payload = combination_report.pop("rowLevelAuditData", None)
        if combination_audit_payload:
            audit_path = output_dir / f"grouped_policy_combination_audit_{timestamp}.json"
            combination_audit_payload["evaluationReportPath"] = str(report_path)
            combination_report.setdefault("rowLevelAudit", {})["outputPath"] = str(audit_path)
            combination_report["rowLevelAudit"]["latestOutputPath"] = str(output_dir / "latest_grouped_policy_combination_audit.json")

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
            "issuePolicyMinPrecision": args.issue_policy_min_precision,
            "issuePolicyCleanFpRowCap": args.issue_policy_clean_fp_row_cap,
            "issuePolicyHardNegativeFpRowCap": args.issue_policy_hard_negative_fp_row_cap,
            "issuePolicyPartialViewFpRowCap": args.issue_policy_partial_view_fp_row_cap,
            "groupedPolicyMinPrecision": args.grouped_policy_min_precision,
            "groupedPolicyCleanFpRowCap": args.grouped_policy_clean_fp_row_cap,
            "groupedPolicyHardNegativeFpRowCap": args.grouped_policy_hard_negative_fp_row_cap,
            "groupedPolicyPartialViewFpRowCap": args.grouped_policy_partial_view_fp_row_cap,
            "groupedSetThreshold": args.grouped_set_threshold,
            "groupedSetMinReps": args.grouped_set_min_reps,
        },
        "rowCount": len(df),
        "candidateCounts": candidate_counts,
        "modelsAvailable": models_available,
        "generalModelComparisonModels": primary_models_available,
        "featureSubsetModelsComparedInGroupedReports": [
            model for model in models_available if model not in primary_models_available
        ],
        "issueSupportCounts": {column: int(pd.to_numeric(df[column], errors="coerce").fillna(0).sum()) for column in label_columns},
        "thresholdPolicyReport": threshold_policy_report(pd.read_csv(predictions_path), label_columns, args.model, args),
        "groupedFeedback": grouped_feedback_report,
        "modelComparison": build_model_comparison(pd.read_csv(predictions_path), label_columns, primary_models_available, args),
        "unifiedGroupedFeedbackLeaderboard": build_unified_grouped_feedback_leaderboard(
            pd.read_csv(predictions_path),
            label_columns,
            primary_models_available,
            args,
            review_annotations,
            selected_model=args.model,
            selected_grouped_report=grouped_feedback_report,
        ),
        "externalHoldoutWorkflow": {
            "status": "documented_only",
            "summary": "Export a separate reviewed holdout into a predictions CSV with the same feature/label columns, run trained models against it without fitting, then pass it with --predictions for evaluation. Do not copy holdout rows into train/validation/test used for threshold or policy selection.",
            "currentCliSupport": "ml:evaluate can read an explicit --predictions CSV; scoring a fresh external holdout still needs an export/predict command that reuses trained artifacts without refitting.",
        },
        "splits": split_reports,
    }
    report["integrationRecommendation"] = recommendation(report, label_columns, decision_split)
    report = json_safe(report)

    if combination_audit_payload:
        audit_payload = json_safe(combination_audit_payload)
        audit_path = Path(report["groupedFeedback"]["perGroupPolicyCombination"]["rowLevelAudit"]["outputPath"])
        latest_audit_path = Path(report["groupedFeedback"]["perGroupPolicyCombination"]["rowLevelAudit"]["latestOutputPath"])
        audit_path.write_text(json.dumps(audit_payload, indent=2) + "\n")
        latest_audit_path.write_text(json.dumps(audit_payload, indent=2) + "\n")
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
        optimized = split.get("hybridPolicies", {}).get("optimizedIssueHybrid")
        if optimized:
            print(f"Optimized issue hybrid F1: {optimized['aggregate']['f1']:.3f}")
    print(f"Recommendation: {decision['status']} ({decision['reason']})")
    combination = report.get("groupedFeedback", {}).get("perGroupPolicyCombination", {})
    if combination.get("available"):
        combined_validation = combination.get("combinedValidationMetrics", {}).get("aggregate", {})
        combined_test = combination.get("combinedTestFinalOnlyMetrics", {}).get("aggregate", {})
        if combined_validation:
            print(f"Combined grouped validation F1: {combined_validation.get('f1', 0):.3f}")
        if combined_test:
            print(f"Combined grouped test/dev F1: {combined_test.get('f1', 0):.3f}")
        audit_output = combination.get("rowLevelAudit", {}).get("outputPath")
        if audit_output:
            print(f"Grouped combination audit: {audit_output}")
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
