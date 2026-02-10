export function isJapanese(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // Katakana
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0xff66 && code <= 0xff9f) || // Half-width katakana
    (code >= 0x3000 && code <= 0x303f) // CJK punctuation (々 etc.)
  );
}

export function isKana(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff);
}

export function isKanji(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

// Heuristic word boundary detection (instant, no dictionary).
// Finds approximate word end from a tap position by scanning forward.
// Rules: kanji runs together, kana after kanji is okurigana, pure kana
// runs together up to a particle boundary.
export function guessWordLength(text: string): number {
  if (!text || text.length === 0) return 0;
  let i = 0;
  // Leading kanji
  while (i < text.length && isKanji(text[i])) i++;
  if (i > 0) {
    // Okurigana: kana following kanji (e.g. 走って → 走 + って)
    while (i < text.length && isKana(text[i])) i++;
    return i;
  }
  // Pure kana word: scan until non-Japanese
  while (i < text.length && isKana(text[i])) i++;
  return Math.max(i, 1);
}

// Heuristic backward word boundary detection.
// Given text and tapOffset within it, scan backward through kanji/kana
// to find where the word likely starts.
export function guessWordStart(text: string, tapOffset: number): number {
  let i = tapOffset;
  // If tapped char is kana, scan back through kana, then kanji
  // If tapped char is kanji, scan back through kanji only
  if (isKanji(text[i])) {
    while (i > 0 && isKanji(text[i - 1])) i--;
  } else if (isKana(text[i])) {
    // Scan back through kana
    while (i > 0 && isKana(text[i - 1])) i--;
    // Then scan back through kanji (okurigana pattern: kanji + kana)
    while (i > 0 && isKanji(text[i - 1])) i--;
  }
  return i;
}
