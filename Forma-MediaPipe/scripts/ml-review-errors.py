#!/usr/bin/env python3
"""Export review packs for heuristic/ML disagreements and high-value examples."""

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
    parser.add_argument("--run", default="latest", help="Experiment id, latest, or path to predictions CSV.")
    parser.add_argument("--model", default="hist_gradient", help="Model kind to review.")
    parser.add_argument("--threshold", type=float, default=0.5, help="Fallback ML threshold.")
    parser.add_argument("--suppress-threshold", type=float, default=0.25, help="Suppression candidate threshold.")
    parser.add_argument("--add-threshold", type=float, default=0.75, help="ML-only candidate threshold.")
    parser.add_argument("--high-confidence", type=float, default=0.8, help="High confidence mistake cutoff.")
    return parser.parse_args()


def prediction_path(args: argparse.Namespace) -> Path:
    candidate = Path(args.run)
    if candidate.exists():
        return candidate
    exercise_dir = Path(args.ml_dir) / args.exercise / "models"
    if args.run == "latest":
        return exercise_dir / "latest_predictions.csv"
    return exercise_dir / args.run / "predictions.csv"


def text(row: pd.Series, column: str) -> str:
    value = row.get(column, "")
    if pd.isna(value):
        return ""
    return str(value)


def number(row: pd.Series, column: str, fallback: float = 0.0) -> float:
    try:
        value = row.get(column, fallback)
        if pd.isna(value):
            return fallback
        return float(value)
    except (TypeError, ValueError):
        return fallback


def key_feature_values(row: pd.Series) -> dict[str, Any]:
    keys = [
        column for column in row.index
        if column in {
            "feature__heuristic.score",
            "feature__pose.confidence",
            "feature__rep.duration_ms",
            "feature__rep.frame_count",
        }
        or column.endswith(".margin")
        or ".velocity_spike_count" in column
        or ".elbow_angle.range" in column
        or ".torso.lean_deg.range" in column
    ]
    result: dict[str, Any] = {}
    for key in keys[:40]:
        value = row.get(key)
        if pd.isna(value):
            continue
        result[key] = value.item() if hasattr(value, "item") else value
    return result


def category_for(truth: int, heuristic: int, ml: int, probability: float, pose_confidence: float, view: str, args: argparse.Namespace) -> str:
    if heuristic == 1 and truth == 0 and probability <= args.suppress_threshold:
        return "heuristic_false_positive_suppressed_by_ml"
    if heuristic == 0 and probability >= args.add_threshold:
        return "ml_only_issue_candidate"
    if heuristic != ml and (pose_confidence < 0.55 or view in {"", "unknown"}):
        return "low_pose_view_confidence_disagreement"
    if ml != truth and abs(probability - 0.5) * 2 >= args.high_confidence:
        return "high_confidence_model_mistake"
    if heuristic != truth and ml == truth:
        return "heuristic_wrong_ml_right"
    if ml != truth and heuristic == truth:
        return "ml_wrong_heuristic_right"
    if ml != truth and heuristic != truth:
        return "both_wrong"
    return "both_correct"


def main() -> int:
    args = parse_args()
    path = prediction_path(args)
    if not path.exists():
        raise SystemExit(f"Predictions CSV not found: {path}. Run npm run ml:train first.")

    df = pd.read_csv(path)
    label_columns = [column for column in df.columns if column.startswith("label_issue__")]
    if not label_columns:
        raise SystemExit("No label_issue__ columns found in predictions CSV.")

    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        for label_column in label_columns:
            suffix = label_column.removeprefix("label_issue__")
            heuristic_column = f"heuristic_issue__{suffix}"
            probability_column = f"ml__{args.model}__{label_column}__prob"
            ml_pred_column = f"ml__{args.model}__{label_column}__pred"
            if probability_column not in row.index:
                continue
            probability = number(row, probability_column)
            truth = int(number(row, label_column))
            heuristic = int(number(row, heuristic_column))
            ml = int(number(row, ml_pred_column, 1 if probability >= args.threshold else 0))
            pose_confidence = number(row, "heuristic_confidence", 0.0)
            view = text(row, "label_view")
            category = category_for(truth, heuristic, ml, probability, pose_confidence, view, args)
            if category == "both_correct":
                continue
            rows.append({
                "category": category,
                "issueColumn": label_column,
                "sourceVideo": text(row, "source_video"),
                "landmarkFile": text(row, "landmark_file"),
                "labelFile": text(row, "label_file"),
                "repIndex": int(number(row, "rep_index")),
                "split": text(row, "split"),
                "subjectId": text(row, "subject_id") or text(row, "participant_id"),
                "sessionId": text(row, "session_id"),
                "cameraSetupId": text(row, "camera_setup_id"),
                "labelView": view,
                "expectedStartMs": number(row, "expected_start_ms"),
                "expectedEndMs": number(row, "expected_end_ms"),
                "humanLabel": truth,
                "heuristicPrediction": heuristic,
                "mlPrediction": ml,
                "mlProbability": probability,
                "heuristicIssueIds": text(row, "heuristic_issue_ids"),
                "humanIssueIds": text(row, "label_issue_ids"),
                "heuristicScore": number(row, "heuristic_score"),
                "poseConfidence": pose_confidence,
                "poseQualityStatus": text(row, "heuristic_quality_status"),
                "keyFeatureValues": key_feature_values(row),
            })

    output_dir = Path(args.ml_dir) / args.exercise / "models"
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    base = output_dir / f"error_review_{args.run}_{timestamp}"
    json_path = base.with_suffix(".json")
    csv_path = base.with_suffix(".csv")
    json_path.write_text(json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(), "predictionsCsv": str(path), "rows": rows}, indent=2) + "\n")
    pd.DataFrame([{**row, "keyFeatureValues": json.dumps(row["keyFeatureValues"], sort_keys=True)} for row in rows]).to_csv(csv_path, index=False)

    print(f"Rows exported: {len(rows)}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
