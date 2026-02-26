/**
 * Single source of truth for the dictionary DB version.
 *
 * Bump this number whenever the dictionary schema or data changes
 * (new tables, columns, rebuilt audio, etc.). This forces all users
 * to re-download the dictionary on next app launch.
 *
 * Used by:
 *   - db/dict-download.ts  (app runtime — checks local vs expected)
 *   - scripts/build-dictionary.ts (build time — writes into manifest)
 */
export const DICT_VERSION = 11;
