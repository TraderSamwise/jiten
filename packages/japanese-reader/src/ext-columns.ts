import type { ReaderSqlDb } from "./backend";

/**
 * Whether this extended DB carries `names.name_freq`, asked once per handle.
 *
 * The column arrived in extended DB v4, and a client can be running v4 code
 * against a v3 file: an OTA replaces the JavaScript at once while the 116 MB
 * download happens in the background, and the local-install path opens
 * whatever is on disk without comparing versions.
 *
 * Selecting a column that is not there throws, and both callers would swallow
 * it badly — the furigana batch fails whole rather than losing just the
 * ranking, and the tap name lookup catches and returns no names at all. So it
 * is asked rather than assumed.
 */
const probes = new WeakMap<object, Promise<boolean>>();

export function hasNameFreqColumn(extDb: ReaderSqlDb): Promise<boolean> {
  let probe = probes.get(extDb);
  if (!probe) {
    // A failed probe is not cached: the answer would be wrong for the life of
    // the handle on one unlucky query.
    probe = extDb
      .getAllAsync<{ name: string }>("PRAGMA table_info(names)")
      .then((columns) => columns.some((column) => column.name === "name_freq"))
      .catch(() => {
        probes.delete(extDb);
        return false;
      });
    probes.set(extDb, probe);
  }
  return probe;
}
