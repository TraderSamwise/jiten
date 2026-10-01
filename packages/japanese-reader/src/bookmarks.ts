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

function extractBookmarkCandidateSurfaces(html: string): Set<string> {
  const surfaces = new Set<string>();
  let i = 0;
  let rtDepth = 0;

  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
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
    if (!isJapaneseTextChar(ch)) {
      i++;
      continue;
    }

    const remaining = getVisibleCharsSkippingRt(html, i, MAX_SURFACE_LENGTH);
    for (let len = 1; len <= remaining.length; len++) {
      const surface = remaining.slice(0, len).join("");
      if ([...surface].every(isJapaneseTextChar)) {
        surfaces.add(surface);
      } else {
        break;
      }
    }
    i++;
  }

  return surfaces;
}

type BookmarkSurfaceRow = {
  text: string;
  entry_id: number;
};

type EntryIdRow = {
  entry_id: number;
};

type SensePosRow = {
  entry_id: number;
  part_of_speech: string | null;
};

/** `senses.part_of_speech` is a JSON array of JMdict tags. */
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

  const candidates = [...extractBookmarkCandidateSurfaces(html)];
  if (candidates.length === 0) return new Map();

  // A bookmark is nearly always saved from an inflected form, because that is
  // what the page says and what the tap resolved. Ask the dictionary about the
  // forms behind each candidate, then highlight the candidate as written.
  const wordToSurfaces = new Map<
    string,
    { surface: string; inflected: boolean; reasons: string[]; typeMask: number }[]
  >();
  for (const candidate of candidates) {
    for (const { word, reasons, entryMask } of deinflect(candidate)) {
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

  // Built once, across every batch: one surface is often reached from several
  // words, and those words can fall in different batches.
  const provenance = new Map<string, BookmarkSurfaceProvenance[]>();
  const record = (surface: string, entry: BookmarkSurfaceProvenance) => {
    const found = provenance.get(surface);
    if (found) found.push(entry);
    else provenance.set(surface, [entry]);
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

    const bookmarkedEntryIds = new Set<number>();
    for (const row of [...kanjiRows, ...kanaRows]) {
      if (bookmarks.hasEntryId(row.entry_id)) bookmarkedEntryIds.add(row.entry_id);
    }

    let entryIdsWithKanji = new Set<number>();
    const entryTypeMasks = new Map<number, number>();
    if (bookmarkedEntryIds.size > 0) {
      const entryBatch = [...bookmarkedEntryIds];
      const entryPh = entryBatch.map(() => "?").join(",");
      const [kanjiEntryRows, senseRows] = await Promise.all([
        dictDb.getAllAsync<EntryIdRow>(
          `SELECT DISTINCT entry_id FROM kanji WHERE entry_id IN (${entryPh})`,
          entryBatch,
        ),
        dictDb.getAllAsync<SensePosRow>(
          `SELECT entry_id, part_of_speech FROM senses WHERE entry_id IN (${entryPh})`,
          entryBatch,
        ),
      ]);
      entryIdsWithKanji = new Set(kanjiEntryRows.map((row) => row.entry_id));
      // Any sense licensing the inflection is enough: 勉強 is n,vs, and asking
      // every sense to admit it would delete every suru verb. The tags are
      // gathered first and mapped once, because `exp` on its own means "no
      // class is recorded" — and that is only true of the whole entry. 違う
      // has three v5u senses and one exp, and mapping per sense would read
      // that one sense as if the verb had no class at all.
      const tagsByEntry = new Map<number, string[]>();
      for (const row of senseRows) {
        const tags = tagsByEntry.get(row.entry_id);
        if (tags) tags.push(...readPosTags(row.part_of_speech));
        else tagsByEntry.set(row.entry_id, readPosTags(row.part_of_speech));
      }
      for (const [entryId, tags] of tagsByEntry) {
        entryTypeMasks.set(entryId, posTagsToTypeMask(tags));
      }
    }

    for (const row of kanjiRows) {
      if (!bookmarks.hasEntryId(row.entry_id)) continue;
      const entryMask = entryTypeMasks.get(row.entry_id) ?? 0;
      for (const { surface, reasons, typeMask } of wordToSurfaces.get(row.text) ?? []) {
        if (!entryAdmitsInflection(typeMask, entryMask)) continue;
        record(surface, { entryId: row.entry_id, word: row.text, reasons, via: "kanji" });
      }
    }
    for (const row of kanaRows) {
      if (!bookmarks.hasEntryId(row.entry_id)) continue;
      const entryMask = entryTypeMasks.get(row.entry_id) ?? 0;
      for (const { surface, inflected, reasons, typeMask } of wordToSurfaces.get(row.text) ?? []) {
        // A bare kana reading of a word the dictionary writes in kanji is not
        // evidence the page means that word — a bookmarked 事 would light up
        // every こと. An undone inflection is.
        if (entryIdsWithKanji.has(row.entry_id) && !inflected) continue;
        if (!entryAdmitsInflection(typeMask, entryMask)) continue;
        record(surface, { entryId: row.entry_id, word: row.text, reasons, via: "kana" });
      }
    }
  }

  return provenance;
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
