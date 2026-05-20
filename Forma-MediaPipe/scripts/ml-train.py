#!/usr/bin/env python3
"""Train offline feature-based ML baselines from exported Forma rep features."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import joblib
    import pandas as pd
    from sklearn.ensemble import HistGradientBoostingClassifier
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
    parser.add_argument("--threshold", type=float, default=0.5, help="Probability threshold for binary predictions.")
    parser.add_argument(
        "--model-kinds",
        default="logistic,hist_gradient",
        help="Comma-separated model kinds: logistic,hist_gradient.",
    )
    return parser.parse_args()


def now_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


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


def make_model(kind: str) -> Pipeline:
    if kind == "logistic":
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                (
                    "classifier",
                    LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42),
                ),
            ],
        )
    if kind == "hist_gradient":
        return Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "classifier",
                    HistGradientBoostingClassifier(
                        max_iter=200,
                        learning_rate=0.05,
                        l2_regularization=0.01,
                        random_state=42,
                    ),
                ),
            ],
        )
    raise ValueError(f"Unknown model kind: {kind}")


def predict_probability(model: Pipeline, x_frame: pd.DataFrame) -> list[float]:
    classifier = model[-1]
    if hasattr(classifier, "predict_proba"):
        return [float(value) for value in model.predict_proba(x_frame)[:, 1]]
    return [float(value) for value in model.predict(x_frame)]


def feature_importance(model: Pipeline, feature_columns: list[str]) -> list[dict[str, Any]]:
    classifier = model[-1]
    values = getattr(classifier, "feature_importances_", None)
    if values is None:
        values = getattr(classifier, "coef_", None)
        if values is not None:
            values = values[0]
    if values is None:
        return []
    pairs = [
        {"feature": feature, "importance": float(abs(value))}
        for feature, value in zip(feature_columns, values)
    ]
    return sorted(pairs, key=lambda item: item["importance"], reverse=True)[:50]


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

    feature_columns = [column for column in df.columns if column.startswith("feature__")]
    label_columns = [column for column in df.columns if column.startswith("label_issue__")]
    if not feature_columns:
        raise SystemExit("No feature__ columns found in exported CSV.")

    df["target__has_issue"] = 1 - pd.to_numeric(df["label_clean"], errors="coerce").fillna(1).astype(int)
    target_columns = label_columns + ["target__has_issue"]
    x_all = df[feature_columns].apply(pd.to_numeric, errors="coerce")
    train_mask = df["split"] == "train"
    if int(train_mask.sum()) == 0:
        raise SystemExit("No train split rows found. Export reviewed train labels first.")

    model_kinds = [kind.strip() for kind in args.model_kinds.split(",") if kind.strip()]
    model_dir = exercise_dir / "models" / now_slug()
    model_dir.mkdir(parents=True, exist_ok=True)
    predictions = df.copy()
    report: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "exercise": args.exercise,
        "featuresCsv": str(csv_path),
        "manifest": str(manifest_path),
        "threshold": args.threshold,
        "featureCount": len(feature_columns),
        "rowCount": len(df),
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

            model = make_model(kind)
            model.fit(x_all[train_mask], y_train)
            probabilities = predict_probability(model, x_all)
            pred_column = f"ml__{kind}__{target}__pred"
            prob_column = f"ml__{kind}__{target}__prob"
            predictions[prob_column] = probabilities
            predictions[pred_column] = [1 if value >= args.threshold else 0 for value in probabilities]

            target_report: dict[str, Any] = {
                "trained": True,
                "positiveTrainRows": int(y_train.sum()),
                "trainRows": int(len(y_train)),
                "metrics": {},
                "topFeatures": feature_importance(model, feature_columns),
            }
            for split in sorted(df["split"].dropna().unique()):
                split_mask = df["split"] == split
                y_true = [int(value) for value in y_all[split_mask].tolist()]
                y_pred = [int(value) for value in predictions.loc[split_mask, pred_column].tolist()]
                target_report["metrics"][split] = binary_metrics(y_true, y_pred)

            model_path = model_dir / f"{kind}__{target}.joblib"
            joblib.dump(
                {
                    "model": model,
                    "modelKind": kind,
                    "target": target,
                    "featureColumns": feature_columns,
                    "threshold": args.threshold,
                },
                model_path,
            )
            target_report["modelPath"] = str(model_path)
            report["models"][kind][target] = target_report

    predictions_path = model_dir / "predictions.csv"
    metrics_path = model_dir / "metrics.json"
    predictions.to_csv(predictions_path, index=False)
    metrics_path.write_text(json.dumps(report, indent=2) + "\n")

    latest_predictions = exercise_dir / "models" / "latest_predictions.csv"
    latest_metrics = exercise_dir / "models" / "latest_metrics.json"
    shutil.copyfile(predictions_path, latest_predictions)
    shutil.copyfile(metrics_path, latest_metrics)

    print(f"Rows: {len(df)}")
    print(f"Features: {len(feature_columns)}")
    print(f"Model dir: {model_dir}")
    print(f"Predictions: {predictions_path}")
    print(f"Metrics: {metrics_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
