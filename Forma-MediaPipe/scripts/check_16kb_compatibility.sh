#!/bin/bash

# Script to check 16KB page size compatibility for Google Play
# Usage: ./scripts/check_16kb_compatibility.sh [path-to-apk-or-aab]

set -e

echo "======================================"
echo "16KB Page Size Compatibility Checker"
echo "======================================"
echo ""

# Resolve llvm-objdump (allow ANDROID_HOME/NDK when not on PATH)
LLVM_OBJDUMP=""
if command -v llvm-objdump &> /dev/null; then
    LLVM_OBJDUMP="llvm-objdump"
elif [ -n "$ANDROID_HOME" ] && [ -d "$ANDROID_HOME/ndk" ]; then
    _found=$(find "$ANDROID_HOME/ndk" -name "llvm-objdump" -type f 2>/dev/null | head -1)
    if [ -n "$_found" ]; then
        LLVM_OBJDUMP="$_found"
    fi
fi
if [ -z "$LLVM_OBJDUMP" ] || ! "$LLVM_OBJDUMP" -v &>/dev/null; then
    echo "❌ llvm-objdump not found!"
    echo ""
    echo "Install Android NDK and either add it to PATH or set ANDROID_HOME:"
    echo "  - Android Studio: SDK Manager > SDK Tools > NDK"
    echo "  - Path: \$ANDROID_HOME/ndk/<version>/toolchains/llvm/prebuilt/<platform>/bin"
    echo ""
    exit 1
fi

# Check if file argument provided
if [ -z "$1" ]; then
    echo "Usage: $0 <path-to-apk-or-aab>"
    echo ""
    echo "No APK/AAB provided. Here's how to generate one:"
    echo ""
    echo "For APK:"
    echo "  cd android"
    echo "  ./gradlew assembleRelease"
    echo "  # APK will be in: android/app/build/outputs/apk/release/"
    echo ""
    echo "For AAB (recommended for Play Store):"
    echo "  cd android"
    echo "  ./gradlew bundleRelease"
    echo "  # AAB will be in: android/app/build/outputs/bundle/release/"
    echo ""
    exit 1
fi

BUILD_FILE="$1"

if [ ! -f "$BUILD_FILE" ]; then
    echo "❌ File not found: $BUILD_FILE"
    exit 1
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "📦 Extracting $BUILD_FILE..."

# Check file type and extract
if [[ "$BUILD_FILE" == *.apk ]]; then
    unzip -o -q "$BUILD_FILE" -d "$TEMP_DIR"
    LIB_DIR="$TEMP_DIR/lib"
elif [[ "$BUILD_FILE" == *.aab ]]; then
    # For AAB, we need bundletool (more complex)
    echo "⚠️  AAB files require bundletool to extract APKs"
    echo "   Download from: https://github.com/google/bundletool/releases"
    echo "   Then: java -jar bundletool.jar build-apks --bundle=<file>.aab --output=<file>.apks --mode=universal"
    exit 1
else
    echo "❌ Unknown file type. Expected .apk or .aab"
    exit 1
fi

# Check if lib directory exists
if [ ! -d "$LIB_DIR" ]; then
    echo "⚠️  No native libraries found in the APK"
    echo "   This might be okay if your app doesn't use native code"
    exit 0
fi

echo ""
echo "🔍 Checking 16KB alignment for arm64-v8a libraries..."
echo ""

# Focus on arm64-v8a (64-bit ARM, where 16KB requirement applies)
ARM64_DIR="$LIB_DIR/arm64-v8a"

if [ ! -d "$ARM64_DIR" ]; then
    echo "⚠️  No arm64-v8a libraries found"
    echo "   16KB requirement only applies to 64-bit architectures"
    exit 0
fi

FAIL_COUNT=0
PASS_COUNT=0
TOTAL_COUNT=0

# Check each .so file
for so_file in "$ARM64_DIR"/*.so; do
    if [ ! -f "$so_file" ]; then
        continue
    fi
    
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    LIB_NAME=$(basename "$so_file")
    
    # Check PT_LOAD alignment using llvm-objdump
    ALIGNMENT=$("$LLVM_OBJDUMP" -p "$so_file" | grep -A 2 "LOAD" | grep "align" | head -1 | awk '{print $NF}')
    
    # Convert hex alignment to decimal (e.g., 2**14 = 16384)
    # We're looking for 2**14 (16KB) or 2**16 (64KB) or higher
    if echo "$ALIGNMENT" | grep -q "2\*\*1[4-9]" || echo "$ALIGNMENT" | grep -q "2\*\*[2-9][0-9]"; then
        echo "✅ $LIB_NAME - 16KB compliant ($ALIGNMENT)"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "❌ $LIB_NAME - NOT 16KB compliant ($ALIGNMENT)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        
        # Show problematic library details
        if [[ "$LIB_NAME" == *mediapipe* ]]; then
            echo "   ⚠️  This is a MediaPipe library - requires package update from maintainer"
        fi
    fi
done

echo ""
echo "======================================"
echo "Summary"
echo "======================================"
echo "Total libraries checked: $TOTAL_COUNT"
echo "✅ Compliant: $PASS_COUNT"
echo "❌ Non-compliant: $FAIL_COUNT"
echo ""

if [ $FAIL_COUNT -gt 0 ]; then
    echo "❌ YOUR APP WILL LIKELY FAIL GOOGLE PLAY 16KB REQUIREMENT"
    echo ""
    echo "Next steps:"
    echo "1. Identify which package provides the non-compliant .so file"
    echo "2. Check if there's an updated version with 16KB support"
    echo "3. Contact the package maintainer if no update exists"
    echo "4. Consider alternative packages if maintainer is unresponsive"
    echo ""
    exit 1
else
    echo "✅ ALL LIBRARIES ARE 16KB COMPLIANT!"
    echo ""
    echo "Your app should pass Google Play's 16KB page size requirement."
    echo ""
    exit 0
fi
