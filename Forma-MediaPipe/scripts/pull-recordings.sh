#!/usr/bin/env bash
#
# Pull landmark recording JSON files from a connected device/simulator
# into scripts/recordings/ for use with the replay test system.
#
# Usage:
#   ./scripts/pull-recordings.sh              # auto-detect platform
#   ./scripts/pull-recordings.sh --android    # pull from Android device via adb
#   ./scripts/pull-recordings.sh --ios-sim    # pull from iOS Simulator
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/recordings"
BUNDLE_ID="com.forma.app"

mkdir -p "$DEST_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────

pull_android() {
  if ! command -v adb &>/dev/null; then
    echo "Error: adb not found. Install Android SDK platform-tools." >&2
    exit 1
  fi

  echo "Pulling recordings from Android device..."
  local app_dir="/data/user/0/$BUNDLE_ID/files"

  # List recording files on device
  local files
  files=$(adb shell "ls '$app_dir'/recording_*.json 2>/dev/null" 2>/dev/null || true)

  if [ -z "$files" ]; then
    echo "No recording files found on Android device at $app_dir"
    return
  fi

  local count=0
  while IFS= read -r remote_path; do
    # Trim carriage return from adb output
    remote_path=$(echo "$remote_path" | tr -d '\r')
    [ -z "$remote_path" ] && continue
    local filename
    filename=$(basename "$remote_path")
    echo "  Pulling $filename..."
    adb pull "$remote_path" "$DEST_DIR/$filename" >/dev/null
    count=$((count + 1))
  done <<< "$files"

  echo "Pulled $count recording(s) to $DEST_DIR"
}

pull_ios_sim() {
  if ! command -v xcrun &>/dev/null; then
    echo "Error: xcrun not found. Install Xcode command line tools." >&2
    exit 1
  fi

  echo "Pulling recordings from iOS Simulator..."

  # Get the app container for the booted simulator
  local container
  container=$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null || true)

  if [ -z "$container" ]; then
    echo "Error: Could not find app container for $BUNDLE_ID on booted simulator."
    echo "Make sure the simulator is running and the app is installed."
    exit 1
  fi

  local docs_dir="$container/Documents"

  if [ ! -d "$docs_dir" ]; then
    echo "No Documents directory found at $docs_dir"
    return
  fi

  local count=0
  for file in "$docs_dir"/recording_*.json; do
    [ -e "$file" ] || continue
    local filename
    filename=$(basename "$file")
    echo "  Copying $filename..."
    cp "$file" "$DEST_DIR/$filename"
    count=$((count + 1))
  done

  if [ "$count" -eq 0 ]; then
    echo "No recording files found in $docs_dir"
  else
    echo "Pulled $count recording(s) to $DEST_DIR"
  fi
}

# ── Auto-detect or use explicit flag ─────────────────────────────────────────

case "${1:-}" in
  --android)
    pull_android
    ;;
  --ios-sim)
    pull_ios_sim
    ;;
  "")
    # Auto-detect: try iOS simulator first (macOS-only), then Android
    if [[ "$(uname)" == "Darwin" ]] && command -v xcrun &>/dev/null; then
      # Check if a simulator is booted
      if xcrun simctl get_app_container booted "$BUNDLE_ID" data &>/dev/null; then
        pull_ios_sim
        exit 0
      fi
    fi
    if command -v adb &>/dev/null && adb get-state &>/dev/null 2>&1; then
      pull_android
      exit 0
    fi
    echo "No connected device or booted simulator found."
    echo "Usage: $0 [--android | --ios-sim]"
    exit 1
    ;;
  *)
    echo "Usage: $0 [--android | --ios-sim]"
    exit 1
    ;;
esac
