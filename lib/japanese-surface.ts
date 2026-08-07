/**
 * Surface-form helpers shared by the AI games, which all have to reconcile a
 * conjugated form the model wrote against the headword it was asked about.
 *
 * Dependency-free on purpose: this is imported by Vercel function code under
 * `server/`, which resolves relative paths only.
 */

export const KANA_ONLY = /^[ぁ-ゖァ-ヺーヽヾゝゞ]+$/;
export const HAS_KANJI = /[一-鿿々]/;

export function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

/**
 * A conjugated surface keeps the headword's kanji: 食べる → 食べました, 新しい →
 * 新しかった. Requiring a shared kanji (and the same opening kanji, when the
 * headword starts with one) rejects a surface that belongs to some other word
 * entirely — which passes every self-contained check on its own.
 */
export function matchesHeadword(targetSurface: string, headword: string): boolean {
  const headwordKanji = [...headword].filter((ch) => HAS_KANJI.test(ch));
  if (headwordKanji.length === 0) return true;

  if (!headwordKanji.some((ch) => targetSurface.includes(ch))) return false;

  const firstChar = [...headword][0];
  if (HAS_KANJI.test(firstChar)) {
    // お待ちください / ご飯 — an honorific prefix is part of the surface, not the headword.
    const stripped = targetSurface.replace(/^[おご御]/, "");
    if ([...stripped][0] !== firstChar) return false;
  }

  return true;
}
