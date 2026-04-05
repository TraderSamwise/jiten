/**
 * Extended data download — downloads the pre-built dictionary-extended.db.
 *
 * Replaces the old JSONL import pipeline. The DB is ready to use immediately
 * after download — no client-side parsing or importing needed.
 */

export {
  isExtendedReady,
  hasInstalledExtendedDb,
  downloadExtendedDb,
  setExtendedVersion,
} from "./dict-download";
