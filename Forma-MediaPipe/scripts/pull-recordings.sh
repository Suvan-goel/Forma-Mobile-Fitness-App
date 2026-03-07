#!/usr/bin/env bash
#
# Pull landmark recording JSON files from a connected device/simulator
# into scripts/recordings/ for use with the replay test system.
#
# Usage:
#   ./scripts/pull-recordings.sh              # auto-detect platform
#   ./scripts/pull-recordings.sh --android    # pull from Android device via adb
#   ./scripts/pull-recordings.sh --ios-sim    # pull from iOS Simulator
#   ./scripts/pull-recordings.sh --ios        # pull from physical iOS via Finder
#
# Physical iOS: plug in iPhone, open Finder, select device > Files > Forma.
# iTunes File Sharing is enabled via UIFileSharingEnabled in app.json.
# This script copies from the Finder-mounted path automatically.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/recordings"
BUNDLE_ID="com.forma.app"
APP_NAME="Forma"

mkdir -p "$DEST_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────

copy_recordings_from_dir() {
  local src_dir="$1"
  local label="$2"

  if [ ! -d "$src_dir" ]; then
    echo "No directory found at $src_dir"
    return 1
  fi

  local count=0
  for file in "$src_dir"/recording_*.json; do
    [ -e "$file" ] || continue
    local filename
    filename=$(basename "$file")
    echo "  Copying $filename..."
    cp "$file" "$DEST_DIR/$filename"
    count=$((count + 1))
  done

  if [ "$count" -eq 0 ]; then
    echo "No recording files found in $label"
  else
    echo "Pulled $count recording(s) to $DEST_DIR"
  fi
}

pull_android() {
  if ! command -v adb &>/dev/null; then
    echo "Error: adb not found. Install Android SDK platform-tools." >&2
    exit 1
  fi

  echo "Pulling recordings from Android device..."
  local app_dir="/data/user/0/$BUNDLE_ID/files"

  local files
  files=$(adb shell "ls '$app_dir'/recording_*.json 2>/dev/null" 2>/dev/null || true)

  if [ -z "$files" ]; then
    echo "No recording files found on Android device at $app_dir"
    return
  fi

  local count=0
  while IFS= read -r remote_path; do
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

  local container
  container=$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null || true)

  if [ -z "$container" ]; then
    echo "Error: Could not find app container for $BUNDLE_ID on booted simulator."
    echo "Make sure the simulator is running and the app is installed."
    exit 1
  fi

  copy_recordings_from_dir "$container/Documents" "$container/Documents"
}

pull_ios_device() {
  echo "Pulling recordings from physical iOS device (Finder file sharing)..."
  echo ""
  echo "  1. Plug in your iPhone"
  echo "  2. Open Finder > select your device > Files > $APP_NAME"
  echo "  3. Drag recording_*.json files into this folder:"
  echo "     $DEST_DIR"
  echo ""

  # Check if any were already dragged in
  local existing=0
  for file in "$DEST_DIR"/recording_*.json; do
    [ -e "$file" ] || continue
    existing=$((existing + 1))
  done

  if [ "$existing" -gt 0 ]; then
    echo "Found $existing recording(s) already in $DEST_DIR — ready to replay."
  else
    echo "Waiting... drop files then press Enter."
    read -r
    local count=0
    for file in "$DEST_DIR"/recording_*.json; do
      [ -e "$file" ] || continue
      count=$((count + 1))
    done
    echo "Found $count recording(s) — ready to replay."
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
  --ios)
    pull_ios_device
    ;;
  "")
    # Auto-detect: try iOS simulator first, then Android, fallback to physical iOS instructions
    if [[ "$(uname)" == "Darwin" ]] && command -v xcrun &>/dev/null; then
      if xcrun simctl get_app_container booted "$BUNDLE_ID" data &>/dev/null; then
        pull_ios_sim
        exit 0
      fi
    fi
    if command -v adb &>/dev/null && adb get-state &>/dev/null 2>&1; then
      pull_android
      exit 0
    fi
    # Default to physical iOS guide on macOS
    if [[ "$(uname)" == "Darwin" ]]; then
      pull_ios_device
      exit 0
    fi
    echo "No connected device or booted simulator found."
    echo "Usage: $0 [--android | --ios-sim | --ios]"
    exit 1
    ;;
  *)
    echo "Usage: $0 [--android | --ios-sim | --ios]"
    exit 1
    ;;
esac
