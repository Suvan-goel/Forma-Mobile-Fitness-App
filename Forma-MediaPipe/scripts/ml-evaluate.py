#!/usr/bin/env python3
"""Evaluate offline ML predictions against heuristic and hybrid baselines."""

from __future__ import annotations

import argparse
import json
import random
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
        ml_prob_column = f"ml__{args.model}__{label_column}__prob"
        ml_trained_pred_column = f"ml__{args.model}__{label_column}__pred"
        if heuristic_column not in df.columns:
            df[heuristic_column] = 0
        if ml_prob_column not in df.columns:
            raise SystemExit(f"Missing ML probability column for {label_column}: {ml_prob_column}")

        ml_pred_column = f"eval_ml__{suffix}"
        hybrid_column = f"eval_hybrid__{suffix}"
        suppression_column = f"eval_ml_suppression__{suffix}"
        additive_column = f"eval_ml_additive__{suffix}"
        heuristic_eval_column = f"eval_heuristic__{suffix}"

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
        "rowCount": len(df),
        "candidateCounts": candidate_counts,
        "issueSupportCounts": {column: int(pd.to_numeric(df[column], errors="coerce").fillna(0).sum()) for column in label_columns},
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
