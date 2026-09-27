/**
 * "No results found" gives a reader nothing to act on or report. Name what was
 * searched, so an empty popup says which text the dictionary had no answer for.
 */
export function emptyLookupMessage(query: string | null | undefined): string {
  const trimmed = query?.trim();
  return trimmed ? `No results for 「${trimmed}」` : "No results found";
}
