#!/bin/bash

# Checks that all user DB INSERT statements use safe conflict handling
# (INSERT OR IGNORE, INSERT OR REPLACE, or ON CONFLICT).
#
# Plain "INSERT INTO" will crash on duplicate keys — use INSERT OR IGNORE INTO
# for fire-and-forget inserts where duplicates should be silently skipped.
#
# Exits with code 1 if any unsafe INSERT INTO statements are found.
#
# Usage:
#   ./scripts/check-safe-inserts.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Directories/globs to scan for user DB writes
SCAN_PATHS=(
  "$PROJECT_ROOT/lib"
  "$PROJECT_ROOT/app"
  "$PROJECT_ROOT/components"
  "$PROJECT_ROOT/stores"
  "$PROJECT_ROOT/hooks"
)

# Specific db/ files to scan (user DB related, not dict build pipelines)
SCAN_DB_GLOBS=(
  "$PROJECT_ROOT/db/user-provider*"
  "$PROJECT_ROOT/db/user-db*"
  "$PROJECT_ROOT/db/sync-engine*"
  "$PROJECT_ROOT/db/sync-helpers*"
  "$PROJECT_ROOT/db/rtk-progress*"
)

FOUND=0
VIOLATIONS=""

check_file() {
  local file="$1"

  # Skip test files
  case "$file" in
    *.test.ts|*.test.tsx) return ;;
  esac

  # Find lines with INSERT INTO that lack safe conflict handling.
  # We look for "INSERT INTO" (case-insensitive) that is NOT preceded by
  # "OR IGNORE" or "OR REPLACE", and has no "ON CONFLICT" anywhere in the rest
  # of the same SQL statement — read as the lines up to the one closing the
  # template literal, so a readable multi-line upsert is not a false positive.
  #
  # Strategy: use grep to find INSERT INTO lines, then filter out safe ones.
  local lines
  lines=$(grep -n -i 'INSERT INTO' "$file" 2>/dev/null || true)
  [ -z "$lines" ] && return

  while IFS= read -r line; do
    # Skip lines that already have OR IGNORE or OR REPLACE
    if echo "$line" | grep -qi 'INSERT OR IGNORE\|INSERT OR REPLACE'; then
      continue
    fi
    # Skip lines that have ON CONFLICT on the same line
    if echo "$line" | grep -qi 'ON CONFLICT'; then
      continue
    fi

    # Check the rest of this statement for ON CONFLICT (multi-line SQL): the
    # lines after it, stopping at the backtick that closes the template literal.
    local lineno
    lineno=$(echo "$line" | cut -d: -f1)
    local rest
    rest=$(awk -v s="$((lineno + 1))" 'NR >= s && NR < s + 12 { print; if (index($0, "`")) exit }' "$file" 2>/dev/null || true)
    if echo "$rest" | grep -qi 'ON CONFLICT'; then
      continue
    fi

    # This is an unsafe INSERT
    local relpath="${file#$PROJECT_ROOT/}"
    VIOLATIONS="${VIOLATIONS}  ${relpath}:${lineno}: $(echo "$line" | cut -d: -f2-)"$'\n'
    FOUND=$((FOUND + 1))
  done <<< "$lines"
}

# Scan directories
for dir in "${SCAN_PATHS[@]}"; do
  [ -d "$dir" ] || continue
  while IFS= read -r -d '' file; do
    check_file "$file"
  done < <(find "$dir" -type f \( -name '*.ts' -o -name '*.tsx' \) -print0)
done

# Scan specific db/ file globs
for pattern in "${SCAN_DB_GLOBS[@]}"; do
  for file in $pattern; do
    [ -f "$file" ] || continue
    # Skip dict-* files (read-only bundled tables)
    case "$(basename "$file")" in
      dict-*) continue ;;
    esac
    check_file "$file"
  done
done

if [ "$FOUND" -gt 0 ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  UNSAFE INSERT STATEMENTS FOUND                            ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Found $FOUND plain INSERT INTO statement(s) without conflict handling."
  echo "Use INSERT OR IGNORE INTO (or INSERT OR REPLACE / ON CONFLICT) instead."
  echo ""
  echo "$VIOLATIONS"
  exit 1
fi

echo "✅ All INSERT statements use safe conflict handling"
