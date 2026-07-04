import { escapeLabel, isValidTarget } from "@/lib/mnemonic-markup";
import { canonicalStem, targetForPrimitive } from "@/db/primitive-associations";
import type { KanjiPrimitive } from "@/db/types";

/**
 * Pure text-level engine for the mnemonic editor. It operates on the raw markup string
 * and a cursor offset — no React, no async — so the editor hook can drive it and it can
 * be exhaustively unit-tested. All mutations are fail-safe: they never produce markup
 * that reparses into something other than intended.
 */

export interface Span {
  start: number;
  end: number;
  text: string;
}

const WORD_CHAR = /[A-Za-z'-]/;

/** True if the char at `pos` is escaped by an odd run of preceding backslashes. */
function isEscaped(text: string, pos: number): boolean {
  let count = 0;
  for (let i = pos - 1; i >= 0 && text[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

/**
 * Whether the cursor sits inside an unclosed, unescaped `[`, `{`, or `(` region.
 * Uses last-open-vs-last-close per pair; markup targets are single-level so this needs
 * no nesting stack. Fail-safe: a misread only suppresses a suggestion, never mutates.
 */
function cursorInOpenDelimiter(text: string, cursor: number): boolean {
  const pairs: [string, string][] = [
    ["[", "]"],
    ["{", "}"],
    ["(", ")"],
  ];
  for (const [open, close] of pairs) {
    const lo = text.lastIndexOf(open, cursor - 1);
    const lc = text.lastIndexOf(close, cursor - 1);
    if (lo > lc && !isEscaped(text, lo)) return true;
  }
  return false;
}

/**
 * The plain-text word whose trailing edge is at the cursor, or null when the cursor is
 * not immediately after a word char or sits inside an existing [ref]/{self}/(target).
 */
export function wordEndingAtCursor(text: string, cursor: number): Span | null {
  if (cursor < 1 || !WORD_CHAR.test(text[cursor - 1])) return null;
  if (cursorInOpenDelimiter(text, cursor)) return null;
  let start = cursor;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  const word = text.slice(start, cursor);
  if (!/[A-Za-z]/.test(word)) return null;
  return { start, end: cursor, text: word };
}

/** The in-progress `[query` at the cursor (last unclosed, unescaped `[`), for the dropdown. */
export function activeBracketQuery(
  text: string,
  cursor: number,
): { query: string; start: number } | null {
  if (cursor < 1) return null;
  const lb = text.lastIndexOf("[", cursor - 1);
  if (lb < 0 || isEscaped(text, lb)) return null;
  const rb = text.lastIndexOf("]", cursor - 1);
  if (lb <= rb) return null;
  return { query: text.slice(lb + 1, cursor), start: lb };
}

function buildRef(label: string, target: string | null): string {
  const safe = escapeLabel(label);
  return target && isValidTarget(target) ? `[${safe}](${target})` : `[${safe}]`;
}

/** Escape a leading `(` in the trailing text so a bare ref doesn't swallow it as a target. */
function guardTail(tail: string, target: string | null): string {
  const bare = !(target && isValidTarget(target));
  return bare && tail.startsWith("(") ? "\\" + tail : tail;
}

/**
 * Wrap `span` as a ref, returning the updated text and the cursor placed after the ref.
 * No-ops (returns the text unchanged) if the span is stale/out of range — the editor may
 * apply an async result after the text has already moved on.
 */
export function wrapAsRef(
  text: string,
  span: Span,
  target: string | null,
): { text: string; cursor: number } {
  if (span.start < 0 || span.end > text.length || span.start >= span.end) {
    return { text, cursor: Math.min(span.end, text.length) };
  }
  const ref = buildRef(span.text, target);
  const newText = text.slice(0, span.start) + ref + guardTail(text.slice(span.end), target);
  return { text: newText, cursor: span.start + ref.length };
}

/**
 * Replace the open `[query` (from `start` to `cursor`) with a finished ref. No-ops if the
 * range is stale/out of range (see wrapAsRef).
 */
export function completeBracket(
  text: string,
  start: number,
  cursor: number,
  label: string,
  target: string | null,
): { text: string; cursor: number } {
  if (start < 0 || cursor > text.length || start > cursor) {
    return { text, cursor: Math.min(cursor, text.length) };
  }
  const ref = buildRef(label, target);
  const newText = text.slice(0, start) + ref + guardTail(text.slice(cursor), target);
  return { text: newText, cursor: start + ref.length };
}

/** Session-suppression key: the canonical stem, so rejecting a word backs off for the session. */
export function suppressionKey(word: string): string {
  return canonicalStem(word);
}

export interface PrimitiveChoice {
  target: string;
  keyword: string;
}

/**
 * The kanji's linkable primitives (those with a target and a keyword) whose keyword
 * contains `query`, for the `[`-triggered dropdown. Empty query returns all of them.
 */
export function filterPrimitivesByQuery(
  primitives: KanjiPrimitive[],
  query: string,
): PrimitiveChoice[] {
  const q = query.trim().toLowerCase();
  const out: PrimitiveChoice[] = [];
  for (const p of primitives) {
    const target = targetForPrimitive(p);
    if (!target || p.keyword == null) continue;
    if (q === "" || p.keyword.toLowerCase().includes(q)) out.push({ target, keyword: p.keyword });
  }
  return out;
}
