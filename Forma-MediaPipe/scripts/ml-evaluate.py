#!/usr/bin/env python3
"""Evaluate offline ML predictions against heuristic and hybrid baselines."""

from __future__ import annotations

import argparse
import json
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
    parser.add_argument("--threshold", type=float, default=0.5, help="ML prediction threshold.")
    parser.add_argument("--min-confidence", type=float, default=0.35, help="Hybrid confidence floor.")
    parser.add_argument("--suppress-threshold", type=float, default=0.25, help="Suppress heuristic issue when ML prob is at/below this value.")
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
    return {
        "count": len(y_true),
        "truePositives": tp,
        "falsePositives": fp,
        "falseNegatives": fn,
        "trueNegatives": tn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
    }


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
) -> dict[str, Any]:
    per_issue: dict[str, Any] = {}
    all_true: list[int] = []
    all_pred: list[int] = []
    for label_column in label_columns:
        prediction_column = prediction_columns[label_column]
        y_true = pd.to_numeric(df[label_column], errors="coerce").fillna(0).astype(int).tolist()
        y_pred = pd.to_numeric(df[prediction_column], errors="coerce").fillna(0).astype(int).tolist()
        all_true.extend(y_true)
        all_pred.extend(y_pred)
        per_issue[label_column] = binary_metrics(y_true, y_pred)
    return {
        "aggregate": binary_metrics(all_true, all_pred),
        "cleanRepFalsePositiveRate": clean_false_positive_rate(df, list(prediction_columns.values())),
        "perIssue": per_issue,
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
    candidate_counts = {"suppressedHeuristicIssues": 0, "mlOnlyIssues": 0}

    heuristic_scorable = pd.to_numeric(df.get("heuristic_scorable", 1), errors="coerce").fillna(1).astype(int)

    for label_column in label_columns:
      suffix = label_column.removeprefix("label_issue__")
      heuristic_column = f"heuristic_issue__{suffix}"
      ml_prob_column = f"ml__{args.model}__{label_column}__prob"
      if heuristic_column not in df.columns:
          df[heuristic_column] = 0
      if ml_prob_column not in df.columns:
          raise SystemExit(f"Missing ML probability column for {label_column}: {ml_prob_column}")

      ml_pred_column = f"eval_ml__{suffix}"
      hybrid_column = f"eval_hybrid__{suffix}"
      heuristic_eval_column = f"eval_heuristic__{suffix}"

      df[heuristic_eval_column] = pd.to_numeric(df[heuristic_column], errors="coerce").fillna(0).astype(int)
      probabilities = pd.to_numeric(df[ml_prob_column], errors="coerce").fillna(0)
      df[ml_pred_column] = (probabilities >= args.threshold).astype(int)

      hybrid_values: list[int] = []
      for index, probability in enumerate(probabilities.tolist()):
          heuristic_value = int(df.iloc[index][heuristic_eval_column])
          ml_value = 1 if probability >= args.threshold else 0
          confidence = abs(probability - 0.5) * 2
          if int(heuristic_scorable.iloc[index]) == 0:
              hybrid_values.append(0)
          elif confidence < args.min_confidence:
              hybrid_values.append(heuristic_value)
          elif heuristic_value == 1 and probability <= args.suppress_threshold:
              candidate_counts["suppressedHeuristicIssues"] += 1
              hybrid_values.append(0)
          elif heuristic_value == 1 and ml_value == 1:
              hybrid_values.append(1)
          elif heuristic_value == 0 and ml_value == 1:
              candidate_counts["mlOnlyIssues"] += 1
              hybrid_values.append(0)
          else:
              hybrid_values.append(heuristic_value)
      df[hybrid_column] = hybrid_values

      heuristic_prediction_columns[label_column] = heuristic_eval_column
      ml_prediction_columns[label_column] = ml_pred_column
      hybrid_prediction_columns[label_column] = hybrid_column

    report: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "exercise": args.exercise,
        "model": args.model,
        "predictionsCsv": str(predictions_path),
        "threshold": args.threshold,
        "minConfidence": args.min_confidence,
        "suppressThreshold": args.suppress_threshold,
        "rowCount": len(df),
        "candidateCounts": candidate_counts,
        "heuristicOnly": evaluate_prediction_set(df, label_columns, heuristic_prediction_columns),
        "mlOnly": evaluate_prediction_set(df, label_columns, ml_prediction_columns),
        "hybridConservative": evaluate_prediction_set(df, label_columns, hybrid_prediction_columns),
    }

    output_dir = exercise_dir / "models"
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    report_path = output_dir / f"evaluation_{timestamp}.json"
    latest_path = output_dir / "latest_evaluation.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    latest_path.write_text(json.dumps(report, indent=2) + "\n")

    print(f"Rows: {len(df)}")
    print(f"Heuristic F1: {report['heuristicOnly']['aggregate']['f1']:.3f}")
    print(f"ML F1: {report['mlOnly']['aggregate']['f1']:.3f}")
    print(f"Hybrid F1: {report['hybridConservative']['aggregate']['f1']:.3f}")
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
