#!/usr/bin/env bash
# Run the full verification: build release APK with targetSdk 35, then run 16KB check.
# Execute from project root. Requires Java 17, Android NDK, and successful Gradle build.

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=============================================="
echo "targetSdk 35 + 16KB verification"
echo "=============================================="
echo ""

# 1) Ensure Android project exists
if [ ! -d "android" ]; then
    echo "No android/ found. Run: npx expo prebuild --platform android --clean"
    exit 1
fi

# 2) Build release APK
echo "Building release APK (targetSdk 35)..."
cd android
./gradlew assembleRelease
cd ..

APK="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
    echo "APK not found at $APK"
    exit 1
fi

echo ""
echo "Running 16KB compatibility check on APK..."
echo ""

# 3) Run 16KB checker (use script dir so ANDROID_HOME is available to it)
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
"$PROJECT_ROOT/scripts/check_16kb_compatibility.sh" "$APK"
result=$?

echo ""
if [ $result -eq 0 ]; then
    echo "=============================================="
    echo "Result: App is 16KB compliant and ready for targetSdk 35."
    echo "=============================================="
else
    echo "=============================================="
    echo "Result: 16KB check failed. Do not ship with targetSdk 35 until fixed."
    echo "=============================================="
fi
exit $result
