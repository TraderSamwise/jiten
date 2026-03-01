#!/bin/bash

# Publishes dictionary assets to the jiten-data GitHub release.
# Usage: yarn publish:dict
#
# Uploads dict-manifest.json, dictionary.db, and dictionary-audio.db
# to the v1 release on TraderSamwise/jiten-data, replacing existing assets.

set -e

REPO="TraderSamwise/jiten-data"
TAG="v1"
ASSETS_DIR="$(cd "$(dirname "$0")/.." && pwd)/assets"

FILES=(
  "$ASSETS_DIR/dict-manifest.json"
  "$ASSETS_DIR/dictionary.db"
  "$ASSETS_DIR/dictionary-audio.db"
  "$ASSETS_DIR/dictionary-extended.db"
)

# Verify all files exist
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "❌ Missing: $f"
    echo "   Run 'yarn build:db' first."
    exit 1
  fi
  SIZE=$(du -h "$f" | cut -f1)
  echo "  $(basename "$f")  $SIZE"
done

echo ""
echo "Uploading to $REPO release $TAG..."

gh release upload "$TAG" "${FILES[@]}" --repo "$REPO" --clobber

echo ""
echo "Upload complete. Waiting for GitHub CDN to propagate..."

# Read expected version from local manifest
EXPECTED_VERSION=$(grep -o '"version": [0-9]*' "$ASSETS_DIR/dict-manifest.json" | head -1 | grep -o '[0-9]*')
CDN_URL="https://github.com/$REPO/releases/download/$TAG/dict-manifest.json"
MAX_ATTEMPTS=36  # 36 * 5s = 3 minutes
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  PUBLISHED=$(curl -sL "$CDN_URL" 2>/dev/null | grep -o '"version": [0-9]*' | head -1 | grep -o '[0-9]*' || echo "")

  if [ "$PUBLISHED" = "$EXPECTED_VERSION" ]; then
    echo "✅ Published dictionary assets to $REPO release $TAG (v$EXPECTED_VERSION, CDN live after ${ATTEMPT}x5s)"
    exit 0
  fi

  printf "  CDN shows v%s, waiting for v%s... (%d/%d)\r" "${PUBLISHED:-?}" "$EXPECTED_VERSION" "$ATTEMPT" "$MAX_ATTEMPTS"
  sleep 5
done

echo ""
echo "⚠️  Upload succeeded but CDN still shows v${PUBLISHED:-?} after 3 minutes."
echo "   Expected v$EXPECTED_VERSION. CDN may need more time to propagate."
echo "   The pre-commit hook may fail — retry in a few minutes."
exit 1
