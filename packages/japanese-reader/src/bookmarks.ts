import type { ReaderSqlDb } from "./backend";
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

export async function resolveBookmarkedWordSurfacesInHtml(
  dictDb: ReaderSqlDb,
  html: string,
  bookmarks: ReaderBookmarkMembership | null | undefined,
): Promise<Set<string>> {
  if (!bookmarks) return new Set();

  const candidates = [...extractBookmarkCandidateSurfaces(html)];
  if (candidates.length === 0) return new Set();

  const surfaces = new Set<string>();
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
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

    for (const row of [...kanjiRows, ...kanaRows]) {
      if (bookmarks.hasEntryId(row.entry_id)) {
        surfaces.add(row.text);
      }
    }
  }

  return surfaces;
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
