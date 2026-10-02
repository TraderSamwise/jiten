/**
 * A short name for one set of bookmarked entries.
 *
 * The reader re-highlights when this changes, so it has to be an identity of
 * the set and not merely of its size — but it is recomputed on every save,
 * and joining 8,500 ids into a 60KB string to do that is work on the path
 * between a finger and a painted button.
 *
 * Each id is mixed on its own and the mixes are summed, so the order the set
 * iterates in does not matter and no sort is needed — one walk, no array.
 * With the count in front, only a swap of two ids whose mixes are equal can
 * collide, and a collision would cost no more than a stale page until the
 * next slice.
 */
export function bookmarkSetVersion(entryIds: ReadonlySet<number>): string {
  let total = 0;
  for (const id of entryIds) total = (total + mix(id)) >>> 0;
  return `${entryIds.size}:${total.toString(36)}`;
}

/** FNV-1a over the four bytes, low first, so ids differing high up diverge. */
function mix(id: number): number {
  let hash = 0x811c9dc5;
  for (let shift = 0; shift < 32; shift += 8) {
    hash ^= (id >>> shift) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
