import { isDominantNameReading } from "./auto-name";
import type { ReaderSqlDb } from "./backend";
import { nameReadingDominance, stripOkurigana } from "./furigana";
import { normalizeDigitsToKanji } from "./numerals";
import { lookupExactJapanese, lookupExactName } from "./lookup-db";
import type { NameMatch } from "./furigana";

/**
 * Every reading the dictionaries know for one kanji run, for the picker a long
 * press opens.
 *
 * The resolver's job is to choose; this one's job is to OFFER. Nothing here
 * filters a reading for being unlikely — 杏子 is きょうこ in one book and the
 * apricot in another, and that is the whole reason the user is being asked.
 */

export type FuriganaCandidateSource = "current" | "source" | "name" | "word" | "counter";

export interface FuriganaReadingCandidate {
  reading: string;
  source: FuriganaCandidateSource;
  /**
   * What this reading IS — a name, a word, a counter — as against `source`,
   * which is how it earned its place in the order. The reading already on the
   * page ranks as "current" and is still a word or a name, and the row has to
   * be able to say so.
   */
  kind?: Exclude<FuriganaCandidateSource, "current">;
  /** The name type, or the word's first glosses — what makes two readings tellable apart. */
  label?: string;
  /** How settled a name reading is: "26 of 33 sightings". */
  note?: string;
  common?: boolean;
}

export interface FuriganaReadingCandidateOptions {
  /** What the page shows over this run right now, if anything. */
  currentReading?: string | null;
  /** What the book's own ruby says, if it carries one. */
  sourceReading?: string | null;
}

/** The longest okurigana tail a form may carry and still be a reading of the run. */
const MAX_OKURIGANA = 3;

/** A long press is interactive — a list nobody can read is not an offer. */
const MAX_CANDIDATES = 20;

/** 一 prefixes 1,552 spellings. The list is capped at 20 either way. */
const MAX_SCAN_ROWS = 400;

/** How many senses of one reading a row may name before it stops being a label. */
const MAX_LABEL_PARTS = 3;

/** Code-point aware, so a surrogate-pair kanji like \u{20B9F} is one. */
function isKanji(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x20000 && code <= 0x2ebef)
  );
}

function isHiragana(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x3040 && code <= 0x309f;
}

/**
 * Hiragana or katakana. Nothing else is a reading.
 *
 * The katakana block contains the interpunct \u30fb, which is why \u7c81 is
 * listed as \u30ad\u30ed\u30fb\u30e1\u30fc\u30c8\u30eb and why a bare range
 * check is not enough.
 */
function isReadingChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (code === 0x30fb) return false;
  return (code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff);
}

/**
 * A reading no Japanese word has.
 *
 * JMdict's kana column is not only readings. 16,774 of its rows carry
 * something that is not kana at all — 粁 is listed as キロ・メートル — and 日
 * carries んち from a compound, while JMnedict lists 日 as the place name にっ.
 * No reading begins with ん, っ or ー, and only four single-kanji forms end in
 * っ (叱, 𠮟, 突, 吹), each a reading that only exists inside a compound.
 */
function isImpossibleReading(reading: string): boolean {
  const chars = [...reading];
  if (chars.length === 0) return true;
  if (!chars.every(isReadingChar)) return true;
  if (chars[0] === "\u3093" || chars[0] === "\u3063" || chars[0] === "\u30fc") return true;
  return chars[chars.length - 1] === "\u3063";
}

function hasKanji(text: string): boolean {
  for (const ch of text) {
    if (isKanji(ch)) return true;
  }
  return false;
}

/** The glosses of an entry, enough of them to tell two readings apart. */
function glossLabel(senses: { glosses: { lang: string; text: string }[] }[]): string | undefined {
  const texts: string[] = [];
  for (const sense of senses) {
    for (const gloss of sense.glosses) {
      if (gloss.lang && gloss.lang !== "eng") continue;
      texts.push(gloss.text);
      if (texts.length === 3) return texts.join(", ");
    }
  }
  return texts.length > 0 ? texts.join(", ") : undefined;
}

function nameLabel(nameType: string | null, translation: string | null): string | undefined {
  const parts = [nameType ?? "", translation ?? ""].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Name readings of this exact spelling, commonest first.
 *
 * `lookupExactName` already orders by the observed count and guards the column
 * for an extended DB that predates it, so this reuses it rather than asking the
 * names table a second way. It matches on kana too — a kana query finds several
 * spellings — so rows for another spelling are dropped here.
 */
async function nameCandidates(
  run: string,
  extendedDb: ReaderSqlDb,
): Promise<{ settled: FuriganaReadingCandidate[]; rest: FuriganaReadingCandidate[] }> {
  const rows = (await lookupExactName(extendedDb, run)).filter((row) => row.kanji === run);
  if (rows.length === 0) return { settled: [], rest: [] };

  const matches: NameMatch[] = rows.map((row) => ({
    kanjiForm: row.kanji ?? run,
    kanaForm: row.kana,
    nameType: row.nameType,
    translation: row.translation,
    freq: row.freq ?? null,
  }));

  const settled: FuriganaReadingCandidate[] = [];
  const rest: FuriganaReadingCandidate[] = [];
  rows.forEach((row, index) => {
    const dominance = nameReadingDominance(matches[index], matches);
    const candidate: FuriganaReadingCandidate = {
      reading: row.kana,
      source: "name",
      kind: "name",
      label: nameLabel(row.nameType, row.translation),
      // Zero is not evidence against a reading — an uncounted one has not been
      // observed, not observed never. So it carries no count at all.
      note:
        dominance && row.freq != null
          ? `${row.freq} of ${dominance.total} sighting${dominance.total === 1 ? "" : "s"}`
          : undefined,
    };
    // A name reading leads only where the spelling has SETTLED on it — 杏子
    // is きょうこ in 26 of its 33 sightings. Without that floor, every
    // spelling that is also somebody's surname leads with the surname, and
    // 後味 reads ごみ, 大人 reads やまと, 一日 reads いちひ. The thresholds
    // are the two the resolver already decided on.
    (isDominantNameReading(dominance) ? settled : rest).push(candidate);
  });
  return { settled, rest };
}

/** Readings of the run as a word spelled exactly that way. */
async function exactWordCandidates(
  run: string,
  dictDb: ReaderSqlDb,
): Promise<FuriganaReadingCandidate[]> {
  const entries = await lookupExactJapanese(dictDb, run);
  const out: FuriganaReadingCandidate[] = [];
  for (const entry of entries) {
    // Only a spelling of the run itself — lookupExactJapanese also matches on
    // kana, which for a kanji run would bring in homophones.
    if (!entry.kanji.some((form) => form.text === run)) continue;
    const label = glossLabel(entry.senses);
    // Every reading, not only the first: 今日 is きょう, こんにち, こんち and
    // こんじつ, and the resolver picking one of them is exactly what the user
    // is overruling. Katakana stays as written — 煙草 really is タバコ.
    for (const kana of entry.kana) {
      if (isImpossibleReading(kana.text)) continue;
      out.push({ reading: kana.text, source: "word", kind: "word", label, common: entry.common });
    }
  }
  return out.sort((a, b) => Number(b.common) - Number(a.common));
}

interface OkuriganaRow {
  text: string;
  common: number;
  kana: string | null;
}

/**
 * Readings of the run drawn from the longer forms that carry it — 読 is no word
 * on its own, but 読み and 読む both say it is よ.
 *
 * The range scan is what makes this affordable: `text >= run AND text < run +
 * U+10FFFF` uses `idx_kanji_text`, where `LIKE run || '%'` scans all 174,000
 * rows. The length cap keeps a one-character run like 日 from pulling its
 * fourteen hundred compounds.
 */
async function okuriganaWordCandidates(
  run: string,
  dictDb: ReaderSqlDb,
): Promise<FuriganaReadingCandidate[]> {
  const runChars = [...run];
  const rows = await dictDb.getAllAsync<OkuriganaRow>(
    `SELECT k.text AS text, e.common AS common,
            (SELECT text FROM kana WHERE entry_id = k.entry_id ORDER BY rowid LIMIT 1) AS kana
       FROM kanji k JOIN entries e ON e.id = k.entry_id
      WHERE k.text >= ? AND k.text < ? AND length(k.text) <= ?
      LIMIT ?`,
    [run, `${run}\u{10FFFF}`, runChars.length + MAX_OKURIGANA, MAX_SCAN_ROWS],
  );

  const out: FuriganaReadingCandidate[] = [];
  for (const row of rows) {
    if (!row.kana) continue;
    const chars = [...row.text];
    if (chars.length <= runChars.length) continue;
    // The tail after the run must be okurigana and nothing else: 読み and 読む
    // are readings of 読, 読者 and 読み方 are not. Hiragana specifically —
    // 日ソ is a katakana compound, and stripping its ソ reads 日 as にっ.
    if (!chars.slice(runChars.length).every(isHiragana)) continue;
    const { kanjiPart, reading } = stripOkurigana(row.text, row.kana);
    if (kanjiPart !== run || isImpossibleReading(reading)) continue;
    out.push({
      reading,
      source: "word",
      kind: "word",
      label: row.text,
      common: row.common === 1,
    });
  }
  return out.sort((a, b) => Number(b.common) - Number(a.common));
}

/** Counter readings, which exist for spellings no dictionary entry covers. */
async function counterCandidates(
  run: string,
  extendedDb: ReaderSqlDb,
): Promise<FuriganaReadingCandidate[]> {
  // counter_readings is keyed on the kanji numeral, and a page writes ３日 as
  // often as 三日 — the same normalization batchLookupCounters applies.
  const normalized = normalizeDigitsToKanji(run);
  const rows = await extendedDb.getAllAsync<{ reading: string; counter_gloss: string | null }>(
    `SELECT DISTINCT reading, counter_gloss FROM counter_readings WHERE combined_kanji IN (?, ?)`,
    [run, normalized],
  );
  return rows.map((row) => ({
    reading: row.reading,
    source: "counter" as const,
    kind: "counter" as const,
    // "counter for days" — a counter row would otherwise carry no definition.
    label: row.counter_gloss ?? undefined,
  }));
}

/**
 * Every reading on offer for `run`, best first and each one only once.
 *
 * The order is the order of the evidence: what the page already says, what the
 * book said, how this spelling is actually read as a name, what it is as a
 * word, and what it is as a counter.
 */
export async function furiganaReadingCandidates(
  run: string,
  dictDb: ReaderSqlDb,
  extendedDb?: ReaderSqlDb | null,
  options: FuriganaReadingCandidateOptions = {},
): Promise<FuriganaReadingCandidate[]> {
  const given: FuriganaReadingCandidate[] = [];
  if (options.currentReading) given.push({ reading: options.currentReading, source: "current" });
  if (options.sourceReading) {
    given.push({ reading: options.sourceReading, source: "source", kind: "source" });
  }

  // A digit run like ３日 has kanji after normalization even when it has none
  // as written, and that is exactly a counter.
  if (!hasKanji(run) && !hasKanji(normalizeDigitsToKanji(run))) return dedupe(given);

  const noNames: { settled: FuriganaReadingCandidate[]; rest: FuriganaReadingCandidate[] } = {
    settled: [],
    rest: [],
  };
  const [names, exactWords, okuriganaWords, counters] = await Promise.all([
    extendedDb ? nameCandidates(run, extendedDb) : Promise.resolve(noNames),
    exactWordCandidates(run, dictDb),
    okuriganaWordCandidates(run, dictDb),
    extendedDb ? counterCandidates(run, extendedDb) : Promise.resolve([]),
  ]);

  return dedupe([
    ...given,
    ...names.settled,
    ...exactWords,
    ...okuriganaWords,
    ...names.rest,
    ...counters,
  ]);
}

/**
 * One row per reading, ranked by its earliest source.
 *
 * A second sighting is not noise — あんず is both a reading of the name 杏子 and
 * the apricot, and "fem · apricot" tells them apart where either half alone
 * does not. So the row keeps the first source's rank and gathers the labels.
 */
function dedupe(candidates: FuriganaReadingCandidate[]): FuriganaReadingCandidate[] {
  const byReading = new Map<string, FuriganaReadingCandidate>();
  const labelParts = new Map<FuriganaReadingCandidate, string[]>();
  for (const candidate of candidates) {
    // Applied here rather than per source, because JMnedict has it too: 日 is
    // listed as the place name にっ.
    if (isImpossibleReading(candidate.reading)) continue;
    const already = byReading.get(candidate.reading);
    if (!already) {
      if (byReading.size === MAX_CANDIDATES) continue;
      const row = { ...candidate };
      byReading.set(candidate.reading, row);
      labelParts.set(row, candidate.label ? [candidate.label] : []);
      continue;
    }
    // Capped: 日 gathers fourteen labels and 180 characters of them.
    if (candidate.label && !labelParts.get(already)!.includes(candidate.label)) {
      labelParts.get(already)!.push(candidate.label);
      const parts = labelParts.get(already)!;
      already.label =
        parts.length > MAX_LABEL_PARTS
          ? `${parts.slice(0, MAX_LABEL_PARTS).join(" · ")} …`
          : parts.join(" · ");
    }
    already.kind ??= candidate.kind;
    already.note ??= candidate.note;
    already.common ||= candidate.common;
  }
  return [...byReading.values()];
}
