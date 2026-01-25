#!/usr/bin/env python3
"""
Download MediaPipe Pose Lite model
This script downloads the MediaPipe Pose Lite model to assets/models/
"""

import os
import sys
import urllib.request
from pathlib import Path

MODEL_DIR = Path("assets/models")
MODEL_FILE = "pose_landmark_lite.tflite"
MODEL_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose_landmark_lite.tflite"

# Alternative URL (Google Cloud Storage - note: this is a .task file, not .tflite)
# MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"

def download_model():
    """Download the MediaPipe Pose Lite model"""
    # Create directory if it doesn't exist
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    
    model_path = MODEL_DIR / MODEL_FILE
    
    print(f"Downloading MediaPipe Pose Lite model...")
    print(f"URL: {MODEL_URL}")
    print(f"Destination: {model_path}")
    
    try:
        # Download the model
        def show_progress(block_num, block_size, total_size):
            downloaded = block_num * block_size
            percent = min(downloaded * 100 / total_size, 100) if total_size > 0 else 0
            print(f"\rProgress: {percent:.1f}% ({downloaded / 1024 / 1024:.2f} MB / {total_size / 1024 / 1024:.2f} MB)", end='', flush=True)
        
        urllib.request.urlretrieve(MODEL_URL, model_path, show_progress)
        print()  # New line after progress
        
        # Check file size
        file_size = model_path.stat().st_size
        print(f"✅ Successfully downloaded {MODEL_FILE}")
        print(f"   File size: {file_size / 1024 / 1024:.2f} MB")
        print(f"   Location: {model_path.absolute()}")
        
        return True
    except Exception as e:
        print(f"\n❌ Download failed: {e}")
        print(f"\nPlease download manually:")
        print(f"   URL: {MODEL_URL}")
        print(f"   Save to: {model_path.absolute()}")
        return False

if __name__ == "__main__":
    # Change to script directory
    script_dir = Path(__file__).parent.parent
    os.chdir(script_dir)
    
    success = download_model()
    sys.exit(0 if success else 1)
