import type { ReaderSqlDb } from "./backend";
import { ANY_TYPE_MASK, SURU_NOUN_REASON, deinflect, posTagsToTypeMask } from "./deinflect";
import type { ReaderBookmarkMembership } from "./types";

const BATCH_SIZE = 500;
const MAX_SURFACE_LENGTH = 10;

function isJapaneseTextChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xff10 && code <= 0xff19) ||
    (code >= 0x0030 && code <= 0x0039)
  );
}

function getVisibleCharsSkippingRt(html: string, start: number, maxChars: number): string[] {
  const chars: string[] = [];
  let i = start;
  let rtDepth = 0;

  while (i < html.length && chars.length < maxChars) {
    const ch = html[i];
    if (ch === "<") {
      if (html.startsWith("</p>", i) || html.startsWith("</div>", i)) break;
      if (html.startsWith("<rt>", i) || html.startsWith("<rt ", i)) {
        const close = html.indexOf(">", i);
        i = close >= 0 ? close + 1 : i + 1;
        rtDepth++;
        continue;
      }
      if (html.startsWith("</rt>", i)) {
        i += 5;
        rtDepth = Math.max(0, rtDepth - 1);
        continue;
      }
      const close = html.indexOf(">", i);
      i = close >= 0 ? close + 1 : i + 1;
      continue;
    }
    if (rtDepth > 0) {
      i++;
      continue;
    }
    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi >= 0 && semi - i <= 8) {
        chars.push(html.slice(i, semi + 1));
        i = semi + 1;
        continue;
      }
    }
    chars.push(ch);
    i++;
  }

  return chars;
}

/**
 * The visible text, as runs of Japanese characters that a word could span.
 *
 * A run stops at a non-Japanese character and at the end of a block, because
 * no word crosses either. `<rt>` is skipped — furigana is not text on the
 * page — and an entity counts as the one character it renders as.
 */
function extractVisibleRuns(html: string): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  let rtDepth = 0;
  let i = 0;

  const endRun = () => {
    if (run.length > 0) runs.push(run);
    run = [];
  };

  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      if (html.startsWith("</p>", i) || html.startsWith("</div>", i)) endRun();
      if (html.startsWith("<rt>", i) || html.startsWith("<rt ", i)) {
        const close = html.indexOf(">", i);
        i = close >= 0 ? close + 1 : i + 1;
        rtDepth++;
        continue;
      }
      if (html.startsWith("</rt>", i)) {
        i += 5;
        rtDepth = Math.max(0, rtDepth - 1);
        continue;
      }
      const close = html.indexOf(">", i);
      i = close >= 0 ? close + 1 : i + 1;
      continue;
    }
    if (rtDepth > 0) {
      i++;
      continue;
    }
    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi >= 0 && semi - i <= 8) {
        endRun();
        i = semi + 1;
        continue;
      }
    }
    if (!isJapaneseTextChar(ch)) {
      endRun();
      i++;
      continue;
    }
    run.push(ch);
    i++;
  }
  endRun();

  return runs;
}

function extractBookmarkCandidateSurfaces(runs: string[][]): Set<string> {
  const surfaces = new Set<string>();
  for (const run of runs) {
    for (let i = 0; i < run.length; i++) {
      const end = Math.min(run.length, i + MAX_SURFACE_LENGTH);
      for (let j = i + 1; j <= end; j++) surfaces.add(run.slice(i, j).join(""));
    }
  }
  return surfaces;
}

type BookmarkSurfaceRow = {
  text: string;
  entry_id: number;
};

type KanjiFormRow = {
  entry_id: number;
  tags: string | null;
};

type EntryCommonRow = {
  id: number;
  common: number;
};

type SensePosRow = {
  entry_id: number;
  part_of_speech: string | null;
};

/** `senses.part_of_speech` and `kanji.tags` are both JSON arrays of tags. */
function readPosTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function isKanjiChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

/** A one-character stretch that is no word at all still has to be crossed. */
const UNKNOWN_CHAR_SCORE = -1;

/**
 * Split a run into words, left to right, by the split that explains the most
 * characters with the fewest words.
 *
 * Longest-match alone is not enough — it reads 会ってからずっと as から|ず + っ
 * + と, because からず is the negative of 刈る and so "a word". Scoring a token
 * by the SQUARE of its length makes から + ずっと (4 + 9) beat からず + っ + と
 * (9 + 1 + 1), and the preference generalises: two long words beat three
 * short ones that happen to exist in a dictionary of 170,000 entries.
 */
export function segmentRun(run: string[], isWord: (surface: string) => boolean): number[] {
  const n = run.length;
  // Joined once: slicing the array and joining per candidate is most of the
  // cost of the pass, and a run holds no surrogate pairs to misalign.
  const text = run.join("");
  const best = new Array<number>(n + 1).fill(Number.NEGATIVE_INFINITY);
  const take = new Array<number>(n + 1).fill(1);
  best[n] = 0;

  for (let i = n - 1; i >= 0; i--) {
    // Longest first, so that a tie goes to the longer word: 台所 + で and
    // 台 + 所で score the same, and the page means 台所.
    for (let length = Math.min(MAX_SURFACE_LENGTH, n - i); length >= 1; length--) {
      const piece = text.slice(i, i + length);
      let score: number;
      if (isWord(piece)) score = length * length;
      else if (length === 1) score = UNKNOWN_CHAR_SCORE;
      else continue;
      const total = score + best[i + length];
      if (total > best[i]) {
        best[i] = total;
        take[i] = length;
      }
    }
  }

  const lengths: number[] = [];
  for (let i = 0; i < n; i += take[i]) lengths.push(take[i]);
  return lengths;
}

/**
 * The surfaces the page actually says, as opposed to the ones its characters
 * could spell.
 *
 * A bookmark is painted only if it is one of these. Three shapes count: the
 * word itself; the noun a suru verb was built from, because that is the
 * bookmark the reader saved (勧誘 in 勧誘される); and the leading half of an
 * all-kanji compound, because 岩盤浴 contains the word 岩盤 while 欲しかった
 * does not contain 欲し.
 */
function confirmableSurfaces(runs: string[][], isWord: (surface: string) => boolean): Set<string> {
  const confirmed = new Set<string>();
  for (const run of runs) {
    let at = 0;
    for (const length of segmentRun(run, isWord)) {
      const token = run.slice(at, at + length).join("");
      at += length;
      confirmed.add(token);

      for (const { word, reasons } of deinflect(token)) {
        if (!reasons.includes(SURU_NOUN_REASON)) continue;
        if (token.startsWith(word) && word.length < token.length) confirmed.add(word);
      }

      // From two characters, never one: a single bookmarked kanji would
      // otherwise light inside every compound that starts with it — 弱 in
      // 弱虫, 数 in 数学, 病 in 病気 — which is the noise this is here to stop.
      if (length > 2 && [...token].every(isKanjiChar)) {
        for (let head = 2; head < length; head++) {
          const prefix = token.slice(0, head);
          if (isWord(prefix)) confirmed.add(prefix);
        }
      }
    }
  }
  return confirmed;
}

/** Why one surface is highlighted: the bookmarked entry and the path to it. */
export interface BookmarkSurfaceProvenance {
  entryId: number;
  /** The deinflected form that was found in the dictionary. */
  word: string;
  /** The deinflection path, outermost first. Empty when matched as written. */
  reasons: string[];
  /** Which table the word was found in. */
  via: "kanji" | "kana";
}

/**
 * Whether the entry can take the inflection that reached it.
 *
 * This is the difference between "these characters could be that word" and
 * "these characters are that word inflected": している is a legal te-iru only
 * if the entry is a verb, and 汁 is a noun, so the page's する is not 汁.
 */
function entryAdmitsInflection(candidateMask: number, entryMask: number): boolean {
  return candidateMask === ANY_TYPE_MASK || (candidateMask & entryMask) !== 0;
}

/**
 * The matcher, with its reasoning. `resolveBookmarkedWordSurfacesInHtml` is
 * this function's keys — one implementation, so a tool that explains a
 * highlight cannot drift from the one that paints it.
 */
export async function explainBookmarkedWordSurfacesInHtml(
  dictDb: ReaderSqlDb,
  html: string,
  bookmarks: ReaderBookmarkMembership | null | undefined,
): Promise<Map<string, BookmarkSurfaceProvenance[]>> {
  if (!bookmarks) return new Map();

  const runs = extractVisibleRuns(html);
  const candidates = [...extractBookmarkCandidateSurfaces(runs)];
  if (candidates.length === 0) return new Map();

  // A bookmark is nearly always saved from an inflected form, because that is
  // what the page says and what the tap resolved. Ask the dictionary about the
  // forms behind each candidate, then highlight the candidate as written.
  const wordToSurfaces = new Map<
    string,
    { surface: string; inflected: boolean; reasons: string[]; typeMask: number }[]
  >();
  // The same walk from the other side: what each candidate could be. The
  // segmentation needs this to ask whether a stretch of the page is a word.
  const surfaceCandidates = new Map<string, { word: string; entryMask: number }[]>();
  for (const candidate of candidates) {
    for (const { word, reasons, entryMask } of deinflect(candidate)) {
      const seenForSurface = surfaceCandidates.get(candidate);
      if (seenForSurface) seenForSurface.push({ word, entryMask });
      else surfaceCandidates.set(candidate, [{ word, entryMask }]);
      const found = wordToSurfaces.get(word);
      // A noun that takes する keeps its own extent: 勧誘される is marked on 勧誘,
      // because the word saved was the noun and the conjugation is not part of
      // it. Only this reason, not any prefix: ている and でる also leave a
      // prefix, and trimming those cuts 当|てる out of 当てる.
      const trimmed =
        reasons.includes(SURU_NOUN_REASON) &&
        candidate.startsWith(word) &&
        word.length < candidate.length;
      // A trimmed surface IS the dictionary form, so it is not evidence of an
      // inflection and must not bypass the kana guard below — ことにする would
      // otherwise light every ことに on the page.
      const entry = {
        surface: trimmed ? word : candidate,
        inflected: !trimmed && reasons.length > 0,
        reasons,
        typeMask: entryMask,
      };
      if (found) found.push(entry);
      else wordToSurfaces.set(word, [entry]);
    }
  }
  const words = [...wordToSurfaces.keys()];

  // Which entries each candidate word belongs to. Unfiltered by bookmark:
  // the segmentation below has to know what IS a word, not only what is
  // saved, and these are the same rows the bookmark filter used to consume.
  const wordRows = new Map<string, { entryId: number; via: "kanji" | "kana" }[]>();
  const allEntryIds = new Set<number>();
  const noteRow = (text: string, entryId: number, via: "kanji" | "kana") => {
    allEntryIds.add(entryId);
    const found = wordRows.get(text);
    if (found) found.push({ entryId, via });
    else wordRows.set(text, [{ entryId, via }]);
  };
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = words.slice(i, i + BATCH_SIZE);
    const ph = batch.map(() => "?").join(",");
    const [kanjiRows, kanaRows] = await Promise.all([
      dictDb.getAllAsync<BookmarkSurfaceRow>(
        `SELECT text, entry_id FROM kanji WHERE text IN (${ph})`,
        batch,
      ),
      dictDb.getAllAsync<BookmarkSurfaceRow>(
        `SELECT text, entry_id FROM kana WHERE text IN (${ph})`,
        batch,
      ),
    ]);
    for (const row of kanjiRows) noteRow(row.text, row.entry_id, "kanji");
    for (const row of kanaRows) noteRow(row.text, row.entry_id, "kana");
  }

  // The part of speech of every entry any candidate reached. Any sense
  // licensing the inflection is enough: 勉強 is n,vs, and asking every sense
  // to admit it would delete every suru verb. The tags are gathered first and
  // mapped once, because `exp` alone means "no class is recorded" and that is
  // only true of a whole entry — 違う has three v5u senses and one exp.
  const entryIdList = [...allEntryIds];
  const tagsByEntry = new Map<number, string[]>();
  for (let i = 0; i < entryIdList.length; i += BATCH_SIZE) {
    const batch = entryIdList.slice(i, i + BATCH_SIZE);
    const ph = batch.map(() => "?").join(",");
    const senseRows = await dictDb.getAllAsync<SensePosRow>(
      `SELECT entry_id, part_of_speech FROM senses WHERE entry_id IN (${ph})`,
      batch,
    );
    for (const row of senseRows) {
      const tags = tagsByEntry.get(row.entry_id);
      if (tags) tags.push(...readPosTags(row.part_of_speech));
      else tagsByEntry.set(row.entry_id, readPosTags(row.part_of_speech));
    }
  }
  const entryTypeMasks = new Map<number, number>();
  for (const [entryId, tags] of tagsByEntry) entryTypeMasks.set(entryId, posTagsToTypeMask(tags));

  // Which entries the dictionary marks common. Used below to ask whether a
  // run of kana is already an ordinary word as it stands.
  const commonEntryIds = new Set<number>();
  for (let i = 0; i < entryIdList.length; i += BATCH_SIZE) {
    const batch = entryIdList.slice(i, i + BATCH_SIZE);
    const ph = batch.map(() => "?").join(",");
    const rows = await dictDb.getAllAsync<EntryCommonRow>(
      `SELECT id, common FROM entries WHERE id IN (${ph})`,
      batch,
    );
    for (const row of rows) if (row.common) commonEntryIds.add(row.id);
  }

  /**
   * Are these characters already some OTHER common word, spelled exactly as
   * they are?
   *
   * If they are, reading them instead as the kana spelling of a kanji word's
   * inflection is the worse answer: だけ is the particle, not the imperative
   * of 抱く, and いい is 良い, not the masu-stem of 結う. "Other" matters —
   * ついている is its own entry written out in full, and the plain guard above
   * has already taken the uninflected path away from it, so counting itself
   * here would leave the word with no way to be painted at all.
   */
  const isOtherCommonWordAsWritten = (surface: string, entryId: number): boolean =>
    (wordRows.get(surface) ?? []).some(
      (row) => row.entryId !== entryId && commonEntryIds.has(row.entryId),
    );

  // Which bookmarked entries the dictionary really writes in kanji. An entry
  // whose every kanji form is tagged rK or sK — rare, or search-only — is a
  // kana word with a historical spelling attached, and ひたすら is one: 只管,
  // 一向 and 頓 are all rK. Treating those as "written in kanji" is what let
  // ひた beat the ひたすら the reader had actually saved.
  const entryIdsWithKanji = new Set<number>();
  for (let i = 0; i < entryIdList.length; i += BATCH_SIZE) {
    const batch = entryIdList.slice(i, i + BATCH_SIZE);
    const ph = batch.map(() => "?").join(",");
    const rows = await dictDb.getAllAsync<KanjiFormRow>(
      `SELECT entry_id, tags FROM kanji WHERE entry_id IN (${ph})`,
      batch,
    );
    for (const row of rows) {
      const tags = readPosTags(row.tags);
      if (tags.includes("rK") || tags.includes("sK")) continue;
      entryIdsWithKanji.add(row.entry_id);
    }
  }

  const isWord = (surface: string): boolean => {
    for (const { word, entryMask } of surfaceCandidates.get(surface) ?? []) {
      for (const { entryId } of wordRows.get(word) ?? []) {
        if (entryAdmitsInflection(entryMask, entryTypeMasks.get(entryId) ?? 0)) return true;
      }
    }
    return false;
  };

  const confirmed = confirmableSurfaces(runs, isWord);

  const provenance = new Map<string, BookmarkSurfaceProvenance[]>();
  const record = (surface: string, entry: BookmarkSurfaceProvenance) => {
    const found = provenance.get(surface);
    if (found) found.push(entry);
    else provenance.set(surface, [entry]);
  };

  for (const [text, rows] of wordRows) {
    for (const { entryId, via } of rows) {
      if (!bookmarks.hasEntryId(entryId)) continue;
      const entryMask = entryTypeMasks.get(entryId) ?? 0;
      for (const { surface, inflected, reasons, typeMask } of wordToSurfaces.get(text) ?? []) {
        // A bare kana reading of a word the dictionary writes in kanji is not
        // evidence the page means that word — a bookmarked 事 would light up
        // every こと. An undone inflection is.
        if (via === "kana" && entryIdsWithKanji.has(entryId) && !inflected) continue;
        // …and an undone inflection is not evidence either, when the page's
        // characters already spell a different common word as they stand.
        if (
          via === "kana" &&
          entryIdsWithKanji.has(entryId) &&
          isOtherCommonWordAsWritten(surface, entryId)
        ) {
          continue;
        }
        if (!entryAdmitsInflection(typeMask, entryMask)) continue;
        // And the characters have to be a word HERE, not merely somewhere.
        if (!confirmed.has(surface)) continue;
        record(surface, { entryId, word: text, reasons, via });
      }
    }
  }

  return provenance;
}

export interface ContainedBookmark {
  /** The characters as the page writes them. */
  surface: string;
  /** The dictionary form behind them — 励む for 励み. */
  word: string;
  /** How the one became the other. Empty when the page used the headword. */
  reasons: string[];
  entryIds: number[];
}

interface PaintedSpan {
  start: number;
  end: number;
  surface: string;
}

/**
 * Where the reader actually paints, over a piece of its visible text.
 *
 * This mirrors `findMatches` in `packages/reader-webview/src/bookmarks.ts` —
 * greedy, longest first, never overlapping — because that is what the device
 * does with the surface set. Asking "is this surface in the set" instead
 * would offer a bookmark on a tap where no box is drawn, which is the
 * incoherence this exists to remove. `bookmarks.painter-parity.test.ts` pins
 * the two together; the webview is standalone by design and shares no code.
 */
export function paintedBookmarkSpans(text: string, surfaces: Iterable<string>): PaintedSpan[] {
  const sorted = [...surfaces]
    .filter((surface) => surface.length > 0)
    .sort((a, b) => b.length - a.length);
  const spans: PaintedSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const matched = sorted.find((surface) => text.startsWith(surface, i));
    if (!matched) {
      i++;
      continue;
    }
    spans.push({ start: i, end: i + matched.length, surface: matched });
    i += matched.length;
  }
  return spans;
}

/**
 * The bookmarked words painted inside one tapped span.
 *
 * Tapping resolves the longest thing it can and highlighting marks the
 * smallest, so the two name different words on the same characters: the page
 * says 励み, the tap answers the noun 励み, and the bookmark is the verb 励む.
 * This is what lets the lookup offer the second one.
 */
export function bookmarksInsideSpan(
  text: string,
  spanStart: number,
  spanEnd: number,
  provenance: ReadonlyMap<string, BookmarkSurfaceProvenance[]>,
): ContainedBookmark[] {
  if (provenance.size === 0 || spanEnd <= spanStart) return [];
  const contained: ContainedBookmark[] = [];
  for (const span of paintedBookmarkSpans(text, provenance.keys())) {
    if (span.start < spanStart || span.end > spanEnd) continue;
    // One surface can stand for several words — group by the word, because
    // that is what the lookup shows.
    const byWord = new Map<string, ContainedBookmark>();
    for (const entry of provenance.get(span.surface) ?? []) {
      const found = byWord.get(entry.word);
      if (found) {
        if (!found.entryIds.includes(entry.entryId)) found.entryIds.push(entry.entryId);
      } else {
        byWord.set(entry.word, {
          surface: span.surface,
          word: entry.word,
          reasons: entry.reasons,
          entryIds: [entry.entryId],
        });
      }
    }
    contained.push(...byWord.values());
  }
  return contained;
}

export async function resolveBookmarkedWordSurfacesInHtml(
  dictDb: ReaderSqlDb,
  html: string,
  bookmarks: ReaderBookmarkMembership | null | undefined,
): Promise<Set<string>> {
  return new Set((await explainBookmarkedWordSurfacesInHtml(dictDb, html, bookmarks)).keys());
}

export async function applyResolvedBookmarkHighlightsToHtml(
  dictDb: ReaderSqlDb,
  html: string,
  bookmarks: ReaderBookmarkMembership | null | undefined,
): Promise<string> {
  const surfaces = await resolveBookmarkedWordSurfacesInHtml(dictDb, html, bookmarks);
  if (surfaces.size === 0) return html;
  return applyBookmarkHighlightsToHtml(html, surfaces);
}

function wrapHighlightedChunk(chunk: string): string {
  return chunk.length > 0 ? `<span class="bookmarked-word">${chunk}</span>` : "";
}

function renderHighlightedVisibleSegment(
  html: string,
  start: number,
  visibleCount: number,
): {
  html: string;
  end: number;
} {
  let i = start;
  let consumed = 0;
  let rtDepth = 0;
  let out = "";
  let highlightChunk = "";

  const flushHighlightChunk = () => {
    if (highlightChunk.length > 0) {
      out += wrapHighlightedChunk(highlightChunk);
      highlightChunk = "";
    }
  };

  while (i < html.length && consumed < visibleCount) {
    const ch = html[i];
    if (ch === "<") {
      if (html.startsWith("<rt>", i) || html.startsWith("<rt ", i)) {
        flushHighlightChunk();
        const close = html.indexOf(">", i);
        const next = close >= 0 ? close + 1 : i + 1;
        out += html.slice(i, next);
        i = next;
        rtDepth++;
        continue;
      }
      if (html.startsWith("</rt>", i)) {
        const next = i + 5;
        out += "</rt>";
        i = next;
        rtDepth = Math.max(0, rtDepth - 1);
        continue;
      }
      const close = html.indexOf(">", i);
      const next = close >= 0 ? close + 1 : i + 1;
      out += html.slice(i, next);
      i = next;
      continue;
    }
    if (rtDepth > 0) {
      out += ch;
      i++;
      continue;
    }
    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi >= 0 && semi - i <= 8) {
        highlightChunk += html.slice(i, semi + 1);
        consumed++;
        i = semi + 1;
        continue;
      }
    }
    highlightChunk += ch;
    consumed++;
    i++;
  }

  flushHighlightChunk();
  return { html: out, end: i };
}

export function applyBookmarkHighlightsToHtml(html: string, surfaces: Set<string>): string {
  if (surfaces.size === 0) return html;

  const sortedSurfaces = [...surfaces].sort((a, b) => [...b].length - [...a].length);
  let out = "";
  let i = 0;
  let rtDepth = 0;

  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      if (html.startsWith("<rt>", i) || html.startsWith("<rt ", i)) {
        const close = html.indexOf(">", i);
        const next = close >= 0 ? close + 1 : i + 1;
        out += html.slice(i, next);
        i = next;
        rtDepth++;
        continue;
      }
      if (html.startsWith("</rt>", i)) {
        out += "</rt>";
        i += 5;
        rtDepth = Math.max(0, rtDepth - 1);
        continue;
      }
      const close = html.indexOf(">", i);
      const next = close >= 0 ? close + 1 : i + 1;
      out += html.slice(i, next);
      i = next;
      continue;
    }
    if (rtDepth > 0 || !isJapaneseTextChar(ch)) {
      out += ch;
      i++;
      continue;
    }

    let matched: string | null = null;
    for (const surface of sortedSurfaces) {
      const chars = [...surface];
      const visible = getVisibleCharsSkippingRt(html, i, chars.length);
      if (visible.length !== chars.length) continue;
      if (visible.join("") === surface) {
        matched = surface;
        break;
      }
    }

    if (!matched) {
      out += ch;
      i++;
      continue;
    }

    const rendered = renderHighlightedVisibleSegment(html, i, [...matched].length);
    out += rendered.html;
    i = rendered.end;
  }

  return out;
}
