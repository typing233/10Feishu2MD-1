#!/bin/bash
# Build script for Feishu2MD browser extension
# Creates separate packages for Chrome/Edge and Firefox

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/chrome" "$BUILD_DIR/firefox"

COMMON_FILES="converter.js content.js background.js popup.html popup.css popup.js icons"

# Chrome/Edge build
echo "Building Chrome/Edge package..."
for f in $COMMON_FILES; do
  cp -r "$SCRIPT_DIR/$f" "$BUILD_DIR/chrome/"
done
cp "$SCRIPT_DIR/manifest.json" "$BUILD_DIR/chrome/manifest.json"

# Firefox build
echo "Building Firefox package..."
for f in $COMMON_FILES; do
  cp -r "$SCRIPT_DIR/$f" "$BUILD_DIR/firefox/"
done
cp "$SCRIPT_DIR/manifest_firefox.json" "$BUILD_DIR/firefox/manifest.json"

# Create zip packages
cd "$BUILD_DIR"
(cd chrome && zip -r ../feishu2md-chrome.zip . -x ".*")
(cd firefox && zip -r ../feishu2md-firefox.zip . -x ".*")

echo ""
echo "Build complete!"
echo "  Chrome/Edge: build/feishu2md-chrome.zip"
echo "  Firefox:     build/feishu2md-firefox.zip"
echo ""
echo "For developer mode loading:"
echo "  Chrome/Edge: load unpacked from build/chrome/"
echo "  Firefox:     load temporary add-on from build/firefox/manifest.json"
