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

/**
 * What that floor costs is two-kanji surnames, and the counts can pay it back:
 * 西條 is さいじょう in 24 sightings, while 田先 and 中電 — the straddles the
 * floor exists for — have never been observed as names at all.
 */
export const AUTO_NAME_OVERRIDE_COUNTED_LENGTH = 2;
export const AUTO_NAME_OVERRIDE_MIN_FREQ = 1;
/**
 * What a span carrying a numeral has to show instead. 二羽 is two birds, 三巻
 * is volume three and 三章 is chapter three, and each is also a name somebody
 * has been seen with once or twice — so a number is a count until the counts
 * say otherwise. 一郎 (393), 七海 (38) and 三郎 (334) clear this comfortably.
 */
export const AUTO_NAME_OVERRIDE_NUMERAL_MIN_FREQ = 3;

const KANJI_NUMERALS = new Set([..."一二三四五六七八九十百千万億〇零壱弐参"]);

export function nameMayOverrideShorterWord(
  matchedText: string,
  topFreq: number | null | undefined,
): boolean {
  const chars = [...matchedText];
  if (chars.length >= AUTO_NAME_OVERRIDE_MIN_LENGTH) return true;
  if (chars.length < AUTO_NAME_OVERRIDE_COUNTED_LENGTH) return false;
  const floor = chars.some((ch) => KANJI_NUMERALS.has(ch))
    ? AUTO_NAME_OVERRIDE_NUMERAL_MIN_FREQ
    : AUTO_NAME_OVERRIDE_MIN_FREQ;
  return (topFreq ?? 0) >= floor;
}

export interface AutoNameWordCandidate {
  matchedText: string;
  exactSurface: boolean;
  exactCommonWord: boolean;
  commonWord: boolean;
  deinflected: boolean;
  /**
   * The surface is this word spelled a way JMdict does NOT mark common. 杏子
   * belongs to the common entry for あんず, whose common spelling is 杏; 杏子
   * is a rare variant of it.
   */
  exactRareForm?: boolean;
}

export interface AutoNameNameCandidate {
  matchedText: string;
  exactSurface: boolean;
  candidateCount: number;
  nameType: string | null;
  hasTranslation: boolean;
  /**
   * The winning reading's share of everything observed for this spelling, and
   * how much was observed. Null where nothing was — which is most spellings,
   * and where the candidate-count penalty below still applies.
   */
  dominance?: { share: number; total: number } | null;
}

/**
 * What it takes for observed frequency to answer the candidate count.
 *
 * Many readings is normally a reason to doubt a name, and it still is — but
 * not when the readings have been counted and one of them is what people
 * actually use. 杏子 has thirteen readings and is きょうこ in 26 of 33
 * sightings; the thirteen are the dictionary being thorough, not the name
 * being uncertain.
 *
 * Both floors matter. Without a minimum share a bare plurality counts as
 * settled; without a minimum total, two sightings of an obscure surname would
 * be enough to write furigana over a common noun.
 */
export const NAME_DOMINANCE_MIN_SHARE = 0.6;
export const NAME_DOMINANCE_MIN_TOTAL = 5;

export function isDominantNameReading(
  dominance: { share: number; total: number } | null | undefined,
): boolean {
  if (!dominance) return false;
  return dominance.total >= NAME_DOMINANCE_MIN_TOTAL && dominance.share >= NAME_DOMINANCE_MIN_SHARE;
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

  const settled = isDominantNameReading(name.dominance);

  // How many readings the dictionary lists is a measure of doubt, and a
  // spelling whose readings have been counted and settled on one is not made
  // doubtful by it — 杏子's thirteen are the dictionary being thorough, not the
  // name being uncertain.
  //
  // A floor rather than a replacement, so a settled name with a single reading
  // keeps the 10 it already earned. 4 is the smallest floor that settles 杏子,
  // measured: 0 leaves it at 87 against a threshold of 90, and 10 changes
  // nothing 4 does not. The counts say WHICH reading, so they earn little on
  // the separate question of whether a name is what is on the page.
  let candidateTerm = 0;
  if (name.candidateCount === 1) candidateTerm = 10;
  else if (name.candidateCount <= 3) candidateTerm = 4;
  else if (name.candidateCount > 4) candidateTerm = -Math.min(name.candidateCount - 4, 6) * 4;
  if (settled) candidateTerm = Math.max(candidateTerm, 4);
  confidence += candidateTerm;

  if (name.hasTranslation) confidence += 4;

  if (word.matchedText !== text) confidence -= 18;
  if (word.matchedText.length > text.length) confidence -= 10;
  if (text.length > word.matchedText.length) confidence += 6;

  // A common word spelled exactly this way is normally decisive, and 28 is
  // what makes it so. Both halves of that have to hold: 杏子 is a spelling of
  // the common word あんず, but not one JMdict marks common — あんず is written
  // 杏 — and 26 sightings in 33 read 杏子 きょうこ. Only evidence that the
  // spelling really names people reopens the question; a rare spelling alone
  // does not, or 真面 would stop reading まとも for a surname nobody uses.
  const wordSpelledRarely = settled && word.exactRareForm === true;
  if (word.exactCommonWord && !wordSpelledRarely) confidence -= 28;
  else if (wordSpelledRarely) confidence -= 8;
  // Deeper when the name is UNSETTLED. 16 left 後味 at exactly 93 against a
  // threshold of 90, and the reader printed the surname ごみ over 後味が悪い;
  // 20 lands it at 89. Only for a name the counts have not settled on, or this
  // stops being a tie-break: 109 is the most this branch can score, so a flat
  // 20 would mean no name ever again beating a non-common exact word, and the
  // dominance floor above would have nothing left to decide.
  else if (word.exactSurface) confidence -= settled ? 16 : 20;
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
