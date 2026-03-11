export function isJapanese(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // Katakana
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0xff66 && code <= 0xff9f) || // Half-width katakana
    (code >= 0x0030 && code <= 0x0039) || // ASCII digits 0-9
    (code >= 0xff10 && code <= 0xff19) || // Fullwidth digits ０-９
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

export function isDigit(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 0x0030 && code <= 0x0039) || (code >= 0xff10 && code <= 0xff19);
}

// Heuristic word boundary detection (instant, no dictionary).
// Finds approximate word end from a tap position by scanning forward.
// Rules: kanji runs together, kana after kanji is okurigana, pure kana
// runs together up to a particle boundary.
export function guessWordLength(text: string): number {
  if (!text || text.length === 0) return 0;
  let i = 0;
  // Leading fullwidth digits (e.g. ３匹, １日)
  while (i < text.length && isDigit(text[i])) i++;
  // Leading kanji (or kanji after digits)
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
  // If tapped char is kana, scan back through kana, then kanji, then digits
  // If tapped char is kanji, scan back through kanji, then digits
  // If tapped char is fullwidth digit, scan back through digits only
  if (isKanji(text[i])) {
    while (i > 0 && isKanji(text[i - 1])) i--;
    while (i > 0 && isDigit(text[i - 1])) i--;
  } else if (isKana(text[i])) {
    while (i > 0 && isKana(text[i - 1])) i--;
    while (i > 0 && isKanji(text[i - 1])) i--;
    while (i > 0 && isDigit(text[i - 1])) i--;
  } else if (isDigit(text[i])) {
    while (i > 0 && isDigit(text[i - 1])) i--;
  }
  return i;
}
