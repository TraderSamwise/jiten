/**
 * Which bookmarked entries the reader should highlight.
 *
 * Every list at once marks about a third of a page — measured at 29.5% of a
 * 3,000-character slice against 12,000 list entries — so a list can be left
 * out. The setting stores the lists to EXCLUDE rather than the ones to include,
 * so a list made later is highlighted without having to be opted in.
 */
export function readerHighlightEntryIds(
  bookmarkedIds: ReadonlySet<string>,
  listIdsByKey: ReadonlyMap<string, ReadonlySet<string>>,
  excludedListIds: readonly string[],
): Set<number> {
  const excluded = new Set(excludedListIds);
  const ids = new Set<number>();
  for (const key of bookmarkedIds) {
    if (!key.startsWith("e:")) continue;
    const entryId = Number(key.slice(2));
    if (!Number.isFinite(entryId)) continue;
    if (excluded.size > 0 && !isInSomeIncludedList(listIdsByKey.get(key), excluded)) continue;
    ids.add(entryId);
  }
  return ids;
}

/** A key with no known list is kept: it was saved, and nothing says to drop it. */
function isInSomeIncludedList(
  lists: ReadonlySet<string> | undefined,
  excluded: ReadonlySet<string>,
): boolean {
  if (!lists) return true;
  for (const listId of lists) if (!excluded.has(listId)) return true;
  return false;
}
