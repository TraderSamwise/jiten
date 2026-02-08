/** Human-readable labels for JMdict kanji/kana info tags */
export const TAG_LABELS: Record<string, string> = {
  ateji: "ateji",
  io: "irregular okurigana",
  iK: "irregular kanji",
  ik: "irregular kana",
  oK: "outdated kanji",
  ok: "outdated kana",
  rK: "rare kanji",
  rk: "rare kana",
  sK: "search-only",
  sk: "search-only",
  gikun: "gikun",
};

/** Tags that indicate a form should be visually de-emphasized */
const DE_EMPHASIZED_TAGS = new Set(["oK", "ok", "rK", "rk", "sK", "sk"]);

export function shouldDeEmphasize(tags: string[]): boolean {
  return tags.some((t) => DE_EMPHASIZED_TAGS.has(t));
}

export function getTagLabel(tag: string): string {
  return TAG_LABELS[tag] ?? tag;
}
