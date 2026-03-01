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
echo "✅ Published dictionary assets to $REPO release $TAG"
