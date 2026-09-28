/**
 * Numbers spelled in kanji.
 *
 * JMdict carries the short ones — 四十 is よんじゅう, 十三 is じゅうさん — and
 * stops well before prose does. 四十三 and 五十八 are in no dictionary, so the
 * reader fell through to JMnedict, where both are real given names: 四十三 was
 * furigana'd よそぞう in a sentence counting someone's age.
 *
 * A number is composed, not looked up, so compose it.
 */

const DIGITS: Record<string, string> = {
  一: "いち",
  二: "に",
  三: "さん",
  四: "よん",
  五: "ご",
  六: "ろく",
  七: "なな",
  八: "はち",
  九: "きゅう",
};

/** Powers within a myriad group, largest first, with their sound changes. */
const POWERS: { kanji: string; base: string; euphonic: Record<string, string> }[] = [
  { kanji: "千", base: "せん", euphonic: { 三: "さんぜん", 八: "はっせん", 一: "いっせん" } },
  {
    kanji: "百",
    base: "ひゃく",
    euphonic: { 三: "さんびゃく", 六: "ろっぴゃく", 八: "はっぴゃく" },
  },
  { kanji: "十", base: "じゅう", euphonic: {} },
];

const MYRIADS: { kanji: string; reading: string }[] = [
  { kanji: "兆", reading: "ちょう" },
  { kanji: "億", reading: "おく" },
  { kanji: "万", reading: "まん" },
];

const NUMERAL_CHARS = new Set([
  ...Object.keys(DIGITS),
  ...POWERS.map((power) => power.kanji),
  ...MYRIADS.map((myriad) => myriad.kanji),
  "〇",
  "零",
]);

/** True when every character is a numeral, so no name reading can be right. */
export function isKanjiNumeralRun(text: string): boolean {
  const chars = [...text];
  return chars.length > 0 && chars.every((char) => NUMERAL_CHARS.has(char));
}

/**
 * The reading of a kanji-spelled number, or null when it is not one or is
 * written in a shape this does not compose (十十, a myriad out of order).
 */
export function kanjiNumeralReading(text: string): string | null {
  if (!isKanjiNumeralRun(text)) return null;
  if (text === "〇" || text === "零") return "れい";

  let rest = text;
  let reading = "";
  for (const { kanji, reading: myriadReading } of MYRIADS) {
    const at = rest.indexOf(kanji);
    if (at < 0) continue;
    const head = readMyriadGroup(rest.slice(0, at));
    if (head === null) return null;
    reading += (head === "" ? "いち" : head) + myriadReading;
    rest = rest.slice(at + 1);
  }

  const tail = readMyriadGroup(rest);
  if (tail === null) return null;
  return reading + tail === "" ? null : reading + tail;
}

/** One group below 万: up to 千, 百, 十 and a digit, each at most once. */
function readMyriadGroup(text: string): string | null {
  if (text === "") return "";
  let rest = text;
  let reading = "";

  for (const { kanji, base, euphonic } of POWERS) {
    const at = rest.indexOf(kanji);
    if (at < 0) continue;
    const multiplier = rest.slice(0, at);
    if (multiplier === "") {
      reading += base;
    } else if ([...multiplier].length === 1 && DIGITS[multiplier]) {
      reading += euphonic[multiplier] ?? DIGITS[multiplier] + base;
    } else {
      return null;
    }
    rest = rest.slice(at + 1);
  }

  if (rest === "") return reading;
  if ([...rest].length === 1 && DIGITS[rest]) return reading + DIGITS[rest];
  return null;
}
