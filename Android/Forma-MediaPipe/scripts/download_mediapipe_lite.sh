#!/bin/bash

# Download MediaPipe Pose Lite model
# This script downloads the MediaPipe Pose Lite model to assets/models/

MODEL_DIR="assets/models"
MODEL_FILE="pose_landmark_lite.tflite"
MODEL_URL="https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose_landmark_lite.tflite"

# Alternative URL (Google Cloud Storage)
# MODEL_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"

echo "Downloading MediaPipe Pose Lite model..."
echo "URL: $MODEL_URL"
echo "Destination: $MODEL_DIR/$MODEL_FILE"

# Create directory if it doesn't exist
mkdir -p "$MODEL_DIR"

# Try curl first
if command -v curl &> /dev/null; then
    echo "Using curl..."
    curl -L -o "$MODEL_DIR/$MODEL_FILE" "$MODEL_URL"
    if [ $? -eq 0 ]; then
        echo "✅ Successfully downloaded $MODEL_FILE"
        ls -lh "$MODEL_DIR/$MODEL_FILE"
        exit 0
    fi
fi

# Try wget if curl failed
if command -v wget &> /dev/null; then
    echo "Using wget..."
    wget -O "$MODEL_DIR/$MODEL_FILE" "$MODEL_URL"
    if [ $? -eq 0 ]; then
        echo "✅ Successfully downloaded $MODEL_FILE"
        ls -lh "$MODEL_DIR/$MODEL_FILE"
        exit 0
    fi
fi

# Try Python if both failed
if command -v python3 &> /dev/null; then
    echo "Using Python..."
    python3 -c "
import urllib.request
import sys
try:
    urllib.request.urlretrieve('$MODEL_URL', '$MODEL_DIR/$MODEL_FILE')
    print('✅ Successfully downloaded $MODEL_FILE')
    import os
    size = os.path.getsize('$MODEL_DIR/$MODEL_FILE')
    print(f'File size: {size / 1024 / 1024:.2f} MB')
    sys.exit(0)
except Exception as e:
    print(f'❌ Download failed: {e}')
    sys.exit(1)
"
    if [ $? -eq 0 ]; then
        exit 0
    fi
fi

echo "❌ All download methods failed. Please download manually:"
echo "   URL: $MODEL_URL"
echo "   Save to: $MODEL_DIR/$MODEL_FILE"
exit 1
