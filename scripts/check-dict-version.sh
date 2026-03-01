#!/bin/bash

# Checks that the local dict base version matches what's published on GitHub.
# Uses two-tier versioning: DICT_BASE_VERSION (download) vs DICT_VERSION (client migrations).
#
# Exits with code 1 (in --strict mode) if DICT_BASE_VERSION > published version,
# meaning a new dict DB needs to be published.
#
# DICT_VERSION > DICT_BASE_VERSION is fine — client migrations handle the gap.
#
# Usage:
#   ./scripts/check-dict-version.sh          # Check and warn
#   ./scripts/check-dict-version.sh --strict  # Check and fail on mismatch

set -e

REPO="TraderSamwise/jiten-data"
TAG="v1"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_MANIFEST="$PROJECT_ROOT/assets/dict-manifest.json"
DICT_VERSION_FILE="$PROJECT_ROOT/db/dict-version.ts"
STRICT=false

for arg in "$@"; do
  case $arg in
    --strict) STRICT=true ;;
  esac
done

# Read DICT_BASE_VERSION and DICT_VERSION from dict-version.ts
DICT_BASE_VERSION=$(grep 'export const DICT_BASE_VERSION' "$DICT_VERSION_FILE" | grep -o '[0-9]*')
DICT_VERSION=$(grep 'export const DICT_VERSION' "$DICT_VERSION_FILE" | grep -o '[0-9]*')

if [ -z "$DICT_BASE_VERSION" ]; then
  echo "⚠️  Could not read DICT_BASE_VERSION from $DICT_VERSION_FILE"
  exit 0
fi

if [ -z "$DICT_VERSION" ]; then
  echo "⚠️  Could not read DICT_VERSION from $DICT_VERSION_FILE"
  exit 0
fi

# Check local manifest version matches DICT_BASE_VERSION
if [ -f "$LOCAL_MANIFEST" ]; then
  LOCAL_MANIFEST_VERSION=$(grep -o '"version": [0-9]*' "$LOCAL_MANIFEST" | grep -o '[0-9]*')
  if [ -n "$LOCAL_MANIFEST_VERSION" ] && [ "$LOCAL_MANIFEST_VERSION" != "$DICT_BASE_VERSION" ]; then
    echo ""
    echo "⚠️  Local manifest version (v$LOCAL_MANIFEST_VERSION) != DICT_BASE_VERSION (v$DICT_BASE_VERSION)"
    echo "   Run 'yarn migrate:dict' to sync manifest, or update DICT_BASE_VERSION."
    echo ""
  fi
else
  echo "⚠️  Local dict-manifest.json not found"
fi

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

# Report version info
if [ "$DICT_VERSION" -gt "$DICT_BASE_VERSION" ]; then
  echo "ℹ️  Two-tier versioning active: base=v$DICT_BASE_VERSION, effective=v$DICT_VERSION (client migrations bridge the gap)"
fi

if [ "$DICT_BASE_VERSION" -gt "$PUBLISHED_VERSION" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  ⚠️  DICT BASE VERSION AHEAD OF PUBLISHED                   ║"
  echo "║                                                              ║"
  echo "║  DICT_BASE_VERSION: v$DICT_BASE_VERSION                                     ║"
  echo "║  Published:         v$PUBLISHED_VERSION                                     ║"
  echo "║                                                              ║"
  echo "║  Run 'yarn publish:dict' to push local dict to GitHub.       ║"
  echo "║  Devices will re-download the dict DB once published.        ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  if [ "$STRICT" = true ]; then
    exit 1
  fi
elif [ "$DICT_BASE_VERSION" -lt "$PUBLISHED_VERSION" ]; then
  echo ""
  echo "⚠️  Published version (v$PUBLISHED_VERSION) is ahead of DICT_BASE_VERSION (v$DICT_BASE_VERSION)"
  echo "   This shouldn't normally happen. Check dict-version.ts."
  echo ""
else
  echo "✅ Dict base version matches published (v$DICT_BASE_VERSION)"
fi
