import type { EnglishMatchEntry, GlossGroup } from "@/db/types";

/**
 * Groups English match entries by their matched gloss text.
 * Preserves first-seen ordering (i.e. highest-scored group appears first).
 */
export function groupByGloss(matches: EnglishMatchEntry[]): GlossGroup[] {
  const groupMap = new Map<string, GlossGroup>();
  const order: string[] = [];

  for (const m of matches) {
    const key = m.matchedGloss.toLowerCase();
    const existing = groupMap.get(key);
    if (existing) {
      existing.entries.push(m.entry);
    } else {
      const group: GlossGroup = { gloss: m.matchedGloss, entries: [m.entry] };
      groupMap.set(key, group);
      order.push(key);
    }
  }

  return order.map((key) => groupMap.get(key)!);
}
