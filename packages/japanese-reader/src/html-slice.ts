/**
 * Cutting the reader's own copy of the page where the WebView cut the DOM.
 *
 * When the reader prefetches forward it sends the next slice with
 * `replaceFromChar`, and the WebView deletes everything after that character
 * before appending. Appending the new HTML to the old without the same cut
 * leaves the matcher looking at a paragraph the page no longer shows — and
 * since a bookmark placement is keyed by the text of the run it sits in, a
 * paragraph the two disagree about loses its highlights until the slice is
 * reloaded.
 */

/** Elements that never hold content, so they never go on the open stack. */
const VOID_TAGS = new Set(["area", "br", "col", "hr", "img", "input", "wbr"]);

/**
 * The first `keep` visible characters of `html`, left well formed.
 *
 * "Visible" counts what a DOM text walker counts: `<rt>` is furigana rather
 * than text and is not counted, an entity is the one character it renders as,
 * and markup is free. Elements still open at the cut are closed, because the
 * WebView's own `deleteContents` leaves a well-formed tree and this has to
 * match it.
 */
export function truncateHtmlAtVisibleChars(html: string, keep: number): string {
  if (keep <= 0) return "";
  const open: string[] = [];
  let out = "";
  let seen = 0;
  let rtDepth = 0;
  let i = 0;

  while (i < html.length) {
    const ch = html[i];

    if (ch === "<") {
      const close = html.indexOf(">", i);
      const end = close >= 0 ? close + 1 : html.length;
      const tag = html.slice(i, end);
      const name = /^<\/?\s*([a-zA-Z0-9]+)/.exec(tag)?.[1]?.toLowerCase();
      if (name === "rt") rtDepth = tag.startsWith("</") ? Math.max(0, rtDepth - 1) : rtDepth + 1;
      if (name && !VOID_TAGS.has(name) && !tag.endsWith("/>")) {
        if (tag.startsWith("</")) {
          const at = open.lastIndexOf(name);
          if (at >= 0) open.splice(at, 1);
        } else {
          open.push(name);
        }
      }
      out += tag;
      i = end;
      continue;
    }

    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi >= 0 && semi - i <= 8) {
        if (rtDepth === 0) {
          if (seen >= keep) break;
          seen++;
        }
        out += html.slice(i, semi + 1);
        i = semi + 1;
        continue;
      }
    }

    if (rtDepth === 0) {
      if (seen >= keep) break;
      seen++;
    }
    out += ch;
    i++;
  }

  for (let at = open.length - 1; at >= 0; at--) out += `</${open[at]}>`;
  return out;
}
