/**
 * Mnemonic markup language — pure parser/serializer.
 *
 * Grammar (author-facing, but usually written by the editor, not by hand):
 *   {self}            → the kanji's own keyword
 *   [label]           → a bare primitive reference, resolved by keyword at render
 *   [label](target)   → a reference with a stable target: `p<id>` or a single CJK glyph
 *   \[ \] \{ \} \\    → literal characters
 *   anything else     → literal text
 *
 * Robust by construction: a single-pass scanner that never throws and degrades
 * malformed markup (unclosed brackets, invalid targets) to literal text.
 */

export type MarkupNode =
  | { type: "text"; value: string }
  | { type: "self" }
  | { type: "ref"; label: string; target: string | null };

const SELF_TOKEN = "{self}";
// `(` is escapable so a literal paren right after a bare ref can be disambiguated
// from a `(target)` — see serializeMnemonicMarkup.
const ESCAPABLE = "[]{}\\(";

/** A single CJK ideograph (code-point aware, so astral Ext-B glyphs count as one). */
function isSingleCJKGlyph(s: string): boolean {
  const cps = Array.from(s);
  if (cps.length !== 1) return false;
  const cp = cps[0].codePointAt(0) ?? 0;
  return (
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2a6df)
  );
}

/** A target is only valid as `p<digits>` or a single CJK glyph — else `(...)` is literal prose. */
export function isValidTarget(s: string): boolean {
  return /^p\d+$/.test(s) || isSingleCJKGlyph(s);
}

export function parseMnemonicMarkup(src: string): MarkupNode[] {
  const nodes: MarkupNode[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      nodes.push({ type: "text", value: text });
      text = "";
    }
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];

    if (ch === "\\" && i + 1 < n && ESCAPABLE.includes(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    if (ch === "{" && src.startsWith(SELF_TOKEN, i)) {
      flush();
      nodes.push({ type: "self" });
      i += SELF_TOKEN.length;
      continue;
    }

    if (ch === "[") {
      // Scan a label up to the next unescaped ']'. A nested '[' aborts (treat '[' as literal).
      let j = i + 1;
      let label = "";
      let closed = false;
      let aborted = false;
      while (j < n) {
        if (src[j] === "\\" && j + 1 < n && ESCAPABLE.includes(src[j + 1])) {
          label += src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === "]") {
          closed = true;
          break;
        }
        if (src[j] === "[") {
          aborted = true;
          break;
        }
        label += src[j];
        j += 1;
      }
      if (!closed || aborted) {
        text += ch;
        i += 1;
        continue;
      }

      // Optional `(target)` immediately after ']'.
      let next = j + 1;
      let target: string | null = null;
      if (src[next] === "(") {
        let m = next + 1;
        let t = "";
        let tClosed = false;
        while (m < n) {
          if (src[m] === ")") {
            tClosed = true;
            break;
          }
          t += src[m];
          m += 1;
        }
        if (tClosed && isValidTarget(t)) {
          target = t;
          next = m + 1;
        }
      }

      flush();
      nodes.push({ type: "ref", label, target });
      i = next;
      continue;
    }

    text += ch;
    i += 1;
  }

  flush();
  return nodes;
}

function escapeText(s: string): string {
  return s.replace(/[\\[\]{}]/g, (m) => "\\" + m);
}

export function escapeLabel(s: string): string {
  return s.replace(/[\\[\]]/g, (m) => "\\" + m);
}

/** Serialize an AST back to markup such that parse(serialize(nodes)) yields the same AST. */
export function serializeMnemonicMarkup(nodes: MarkupNode[]): string {
  let out = "";
  for (let idx = 0; idx < nodes.length; idx++) {
    const nd = nodes[idx];
    if (nd.type === "self") {
      out += SELF_TOKEN;
    } else if (nd.type === "ref") {
      const label = escapeLabel(nd.label);
      out += nd.target ? `[${label}](${nd.target})` : `[${label}]`;
    } else {
      let value = escapeText(nd.value);
      // A literal '(' right after a bare ref would be misread as a target — escape it.
      const prev = nodes[idx - 1];
      if (prev?.type === "ref" && prev.target === null && value.startsWith("(")) {
        value = "\\" + value;
      }
      out += value;
    }
  }
  return out;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);

/**
 * Convert the legacy hand-rolled markup to the new grammar:
 *   **x** → {self}   (the primary keyword; {self} renders the current keyword)
 *   *x*   → [x]       (a primitive reference by keyword)
 *
 * A markdown-style flanking scanner: a delimiter opens only when not preceded by an
 * alphanumeric and immediately followed by non-space, and closes on the nearest
 * same-line partner that is space-hugged and not followed by an alphanumeric. This
 * keeps stray/unbalanced stars and prose like `3*4=12 and 5*6` literal instead of
 * pairing distant, unrelated asterisks — critical because the migration is one-shot.
 */
export function convertLegacySigils(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] === "*" && !isWordChar(src[i - 1])) {
      const double = src[i + 1] === "*";
      const open = double ? i + 2 : i + 1;
      if (open < n && !/\s/.test(src[open])) {
        let j = open;
        let found = -1;
        while (j < n && src[j] !== "\n") {
          const isClose = src[j] === "*" && (double ? src[j + 1] === "*" : true);
          if (isClose && src[j - 1] !== "*" && !/\s/.test(src[j - 1])) {
            found = j;
            break;
          }
          j += 1;
        }
        const closeEnd = double ? found + 2 : found + 1;
        const content = found > open ? src.slice(open, found) : "";
        if (found > open && !content.includes("*") && !isWordChar(src[closeEnd])) {
          out += double ? SELF_TOKEN : `[${escapeLabel(content)}]`;
          i = closeEnd;
          continue;
        }
      }
    }
    out += src[i];
    i += 1;
  }
  return out;
}
