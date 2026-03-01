#!/bin/bash

# Checks that the local dict version matches what's published on GitHub.
# Exits with code 1 if there's a mismatch (local is ahead of published).
#
# Usage:
#   ./scripts/check-dict-version.sh          # Check and warn
#   ./scripts/check-dict-version.sh --strict  # Check and fail on mismatch

set -e

REPO="TraderSamwise/jiten-data"
TAG="v1"
LOCAL_MANIFEST="$(cd "$(dirname "$0")/.." && pwd)/assets/dict-manifest.json"
STRICT=false

for arg in "$@"; do
  case $arg in
    --strict) STRICT=true ;;
  esac
done

if [ ! -f "$LOCAL_MANIFEST" ]; then
  echo "⚠️  Local dict-manifest.json not found"
  exit 0
fi

LOCAL_VERSION=$(grep -o '"version": [0-9]*' "$LOCAL_MANIFEST" | grep -o '[0-9]*')

# Fetch published manifest from GitHub release
PUBLISHED_JSON=$(curl -sL "https://github.com/$REPO/releases/download/$TAG/dict-manifest.json" 2>/dev/null || echo "")

if [ -z "$PUBLISHED_JSON" ] || echo "$PUBLISHED_JSON" | grep -q "Not Found"; then
  echo "⚠️  Could not fetch published dict manifest from $REPO"
  exit 0
fi

PUBLISHED_VERSION=$(echo "$PUBLISHED_JSON" | grep -o '"version": [0-9]*' | grep -o '[0-9]*')

if [ -z "$PUBLISHED_VERSION" ]; then
  echo "⚠️  Could not parse published dict version"
  exit 0
fi

if [ "$LOCAL_VERSION" != "$PUBLISHED_VERSION" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  ⚠️  DICT VERSION MISMATCH                                  ║"
  echo "║                                                              ║"
  echo "║  Local:     v$LOCAL_VERSION                                          ║"
  echo "║  Published: v$PUBLISHED_VERSION                                          ║"
  echo "║                                                              ║"
  echo "║  Run 'yarn publish:dict' to push local dict to GitHub.       ║"
  echo "║  Devices will get the wrong dict DB until this is resolved.  ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  if [ "$STRICT" = true ]; then
    exit 1
  fi
else
  echo "✅ Dict version matches (v$LOCAL_VERSION)"
fi
