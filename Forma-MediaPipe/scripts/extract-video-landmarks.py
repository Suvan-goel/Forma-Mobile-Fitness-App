#!/usr/bin/env python3
"""Extract MediaPipe pose landmarks from a prerecorded video.

The output matches CameraScreen's landmark recording JSON shape, so it can be
replayed through the existing TypeScript exercise heuristics.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MEDIAPIPE_LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky",
    "left_index", "right_index", "left_thumb", "right_thumb",
    "left_hip", "right_hip", "left_knee", "right_knee",
    "left_ankle", "right_ankle", "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def default_model_path() -> Path:
    root = repo_root()
    ios_model = root / "modules/expo-pose-detection/ios/Models/pose_landmarker_heavy.task"
    android_model = root / "modules/expo-pose-detection/android/src/main/assets/pose_landmarker_heavy.task"
    return ios_model if ios_model.exists() else android_model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exercise", required=True, help="Exercise name exactly as registered in the app.")
    parser.add_argument("--video", required=True, type=Path, help="Path to an MP4/MOV source video.")
    parser.add_argument("--out", required=True, type=Path, help="Destination landmark JSON path.")
    parser.add_argument("--model", type=Path, default=default_model_path(), help="MediaPipe .task model path.")
    parser.add_argument("--expected-reps", type=int, default=0, help="Optional metadata hint; labels remain source of truth.")
    parser.add_argument("--description", default="", help="Optional metadata description.")
    parser.add_argument("--frame-stride", type=int, default=1, help="Process every Nth frame.")
    return parser.parse_args()


def landmark_to_keypoint(landmark: Any, index: int) -> dict[str, Any]:
    visibility = 1.0
    if getattr(landmark, "visibility", None) is not None:
        visibility_value = landmark.visibility
        visibility = float(visibility_value) if visibility_value is not None else 0.0
    return {
        "name": MEDIAPIPE_LANDMARK_NAMES[index] if index < len(MEDIAPIPE_LANDMARK_NAMES) else f"landmark_{index}",
        "x": float(landmark.x),
        "y": float(landmark.y),
        "z": float(getattr(landmark, "z", 0.0) or 0.0),
        "score": visibility,
    }


def main() -> int:
    args = parse_args()
    if args.frame_stride < 1:
        raise SystemExit("--frame-stride must be >= 1")
    if not args.video.exists():
        raise SystemExit(f"Video not found: {args.video}")
    if not args.model.exists():
        raise SystemExit(f"MediaPipe model not found: {args.model}")

    try:
        import cv2
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
    except ImportError as exc:
        raise SystemExit(
            "Missing Python dependencies. Run: python3 -m pip install -r scripts/requirements-dataset.txt"
        ) from exc

    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        raise SystemExit(f"Could not open video: {args.video}")

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    if not math.isfinite(fps) or fps <= 0:
        fps = 30.0
    source_frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    base_options = python.BaseOptions(model_asset_path=str(args.model))
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.35,
        min_pose_presence_confidence=0.35,
        min_tracking_confidence=0.35,
    )

    frames: list[dict[str, Any]] = []
    processed_frame_count = 0
    frame_index = 0

    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        while True:
            ok, bgr = capture.read()
            if not ok:
                break
            if frame_index % args.frame_stride != 0:
                frame_index += 1
                continue

            timestamp_ms = int(round((frame_index / fps) * 1000.0))
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect_for_video(mp_image, timestamp_ms)
            processed_frame_count += 1

            if not result.pose_landmarks:
                frame_index += 1
                continue

            image_landmarks = result.pose_landmarks[0]
            world_landmarks = result.pose_world_landmarks[0] if result.pose_world_landmarks else None
            primary_landmarks = world_landmarks if world_landmarks else image_landmarks
            frame = {
                "timestamp": timestamp_ms,
                "keypoints": [
                    landmark_to_keypoint(landmark, index)
                    for index, landmark in enumerate(primary_landmarks)
                ],
                "imageKeypoints": [
                    landmark_to_keypoint(landmark, index)
                    for index, landmark in enumerate(image_landmarks)
                ],
            }
            if world_landmarks:
                frame["worldKeypoints"] = [
                    landmark_to_keypoint(landmark, index)
                    for index, landmark in enumerate(world_landmarks)
                ]
            frames.append(frame)
            frame_index += 1

    capture.release()

    duration = 0.0 if source_frame_count <= 0 else source_frame_count / fps
    recording = {
        "exerciseName": args.exercise,
        "metadata": {
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            "duration": duration,
            "description": args.description,
            "expectedReps": args.expected_reps,
            "expectedScoreRange": [0, 100],
            "sourceVideo": str(args.video),
            "modelName": args.model.stem,
            "modelPath": str(args.model),
            "fps": fps,
            "frameCount": source_frame_count,
            "processedFrameCount": processed_frame_count,
        },
        "frames": frames,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(recording, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(frames)} pose frames from {processed_frame_count} processed frames to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
