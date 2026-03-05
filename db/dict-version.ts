/**
 * Two-tier dictionary versioning:
 *
 * DICT_BASE_VERSION — the version of the published dictionary.db file.
 *   Bump this only when a full re-download is required (large schema changes,
 *   rebuilt audio, new data imports that can't be expressed as SQL).
 *   Must match the version in the published dict-manifest.json.
 *
 * DICT_VERSION — the effective version after client-side migrations.
 *   Bump this (ahead of DICT_BASE_VERSION) when adding lightweight
 *   client-side SQL migrations (ADD COLUMN, small data updates).
 *   Client migrations bridge the gap from DICT_BASE_VERSION to DICT_VERSION.
 *
 * Invariant: DICT_VERSION >= DICT_BASE_VERSION
 *
 * Used by:
 *   - db/dict-download.ts       (compares DICT_BASE_VERSION against manifest)
 *   - db/dict-client-migrations  (applies migrations from base → DICT_VERSION)
 *   - scripts/build-dictionary.ts (build time — writes base version into manifest)
 *   - scripts/check-dict-version.sh (compares base version against published)
 */
export const DICT_BASE_VERSION = 19;
export const DICT_VERSION = 19;
