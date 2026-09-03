export const AUTO_DUAL_MIN_MATCH_LENGTH = 2;
export const AUTO_NAME_ONLY_CONFIDENCE = 90;
export const AUTO_NAME_ONLY_WITH_EXACT_WORD_CONFIDENCE = 96;
export const AUTO_NAME_DUAL_CONFIDENCE = 45;

/**
 * Shortest exact name allowed to override a shorter word match on its own.
 *
 * The confidence score is built for the ambiguous case where a name and a word
 * cover the SAME span (歩 the given name vs 歩 the noun), and it penalises a
 * competing common word hard. When the name is strictly longer the word is not
 * a competitor but a fragment of it, and those penalties cap a place name at 75
 * against a threshold of 90 — 大泉学園 could never win against 泉.
 *
 * The override is mostly self-limiting: a name can only be strictly longer than
 * the best word match when no word covers that span. What leaks through is
 * two-kanji spans straddling a word boundary — 田先 out of 山田先生, 中電 out of
 * 食事中電話 — so three characters is the floor. That costs two-kanji surnames
 * (渋沢, 山田), which still resolve to a single kanji.
 */
export const AUTO_NAME_OVERRIDE_MIN_LENGTH = 3;

export interface AutoNameWordCandidate {
  matchedText: string;
  exactSurface: boolean;
  exactCommonWord: boolean;
  commonWord: boolean;
  deinflected: boolean;
}

export interface AutoNameNameCandidate {
  matchedText: string;
  exactSurface: boolean;
  candidateCount: number;
  nameType: string | null;
  hasTranslation: boolean;
}

function hasKana(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff)) return true;
  }
  return false;
}

function hasKanji(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0xf900 && c <= 0xfaff)
    ) {
      return true;
    }
  }
  return false;
}

function countKanjiChars(text: string): number {
  return [...text].filter((ch) => {
    const c = ch.codePointAt(0)!;
    return (
      (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff)
    );
  }).length;
}

export function computeAutoNameConfidence(
  name: AutoNameNameCandidate,
  word: AutoNameWordCandidate,
): number {
  const text = name.matchedText;
  const topType = name.nameType ?? null;
  const kanjiCount = countKanjiChars(text);

  let confidence = 55;

  if (kanjiCount >= 2) confidence += 22;
  else if (kanjiCount === 1) confidence -= 14;

  if (hasKana(text) && !hasKanji(text)) confidence -= 40;
  if ([...text].length === 1) confidence -= 28;

  if (topType === "given" || topType === "surname" || topType === "person") confidence += 18;
  else if (topType === "fem" || topType === "masc") confidence += 14;
  else if (topType === "place" || topType === "station") confidence -= 16;
  else if (
    topType === "organization" ||
    topType === "company" ||
    topType === "product" ||
    topType === "unclass"
  ) {
    confidence -= 12;
  }

  if (name.candidateCount === 1) confidence += 10;
  else if (name.candidateCount <= 3) confidence += 4;
  else if (name.candidateCount > 4) confidence -= Math.min(name.candidateCount - 4, 6) * 4;

  if (name.hasTranslation) confidence += 4;

  if (word.matchedText !== text) confidence -= 18;
  if (word.matchedText.length > text.length) confidence -= 10;
  if (text.length > word.matchedText.length) confidence += 6;

  if (word.exactCommonWord) confidence -= 28;
  else if (word.exactSurface) confidence -= 16;
  else if (word.commonWord) confidence -= 8;

  if (word.deinflected) confidence += 10;

  return Math.max(0, Math.min(100, confidence));
}

export function shouldShowBothAutoResults(
  bestWord: AutoNameWordCandidate,
  bestName: AutoNameNameCandidate,
  nameConfidence: number,
): boolean {
  if (bestWord.matchedText !== bestName.matchedText) return false;
  if (bestWord.matchedText.length < AUTO_DUAL_MIN_MATCH_LENGTH) return false;
  if (!bestWord.exactSurface || !bestName.exactSurface) return false;
  return nameConfidence >= AUTO_NAME_DUAL_CONFIDENCE && nameConfidence < AUTO_NAME_ONLY_CONFIDENCE;
}
