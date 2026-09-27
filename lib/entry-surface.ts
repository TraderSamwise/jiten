/**
 * One entry often holds several spellings — 長い and 永い are the same word —
 * and the header shows the first. That is wrong when the reader is looking at
 * the other one: tapping 永かった opened an entry headed 長い, a spelling that
 * is not on the page.
 *
 * Pick the spelling that shares the most with the text actually tapped. An
 * inflected surface still agrees on its stem (永かった and 永い share 永), and a
 * kana-only surface agrees with none of them, which leaves the dictionary's own
 * order to stand.
 */
export function displayKanjiForSurface(
  kanjiForms: readonly { text: string }[],
  surface: string | null | undefined,
): string | undefined {
  const first = kanjiForms[0]?.text;
  if (!surface || kanjiForms.length < 2) return first;

  let best = first;
  let bestShared = sharedPrefixLength(first ?? "", surface);
  for (const form of kanjiForms.slice(1)) {
    const shared = sharedPrefixLength(form.text, surface);
    if (shared > bestShared) {
      best = form.text;
      bestShared = shared;
    }
  }
  return bestShared > 0 ? best : first;
}

function sharedPrefixLength(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  let i = 0;
  while (i < left.length && i < right.length && left[i] === right[i]) i++;
  return i;
}

/**
 * The spelling the page actually used, when the entry is headed by a different
 * one. 気をもたせる resolves to 気を持たせる and 目の玉の飛び出る to 目の玉が飛び出る
 * — both right, and both leave the reader looking at a phrase that is not the
 * one in front of them.
 *
 * An inflected match is not this case: the deinflection chip already says why
 * 食べた opened 食べる, and repeating the surface there would be noise.
 */
export function pageSpellingNote(
  spellings: readonly { text: string }[],
  surface: string | null | undefined,
  deinflectReasons: readonly string[],
): string | null {
  if (!surface || deinflectReasons.length > 0) return null;
  return spellings.some((form) => form.text === surface) ? null : surface;
}
