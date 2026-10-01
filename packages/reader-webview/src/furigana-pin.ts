import { isDigit, isKanji } from "./japanese";
import { nodeOffsetToAbsolute, resolveCaretAt, textWalker } from "./text";
import { state } from "./state";

declare const window: Window & {
  ReactNativeWebView: { postMessage(msg: string): void };
};

/**
 * What a long press is aimed at.
 *
 * The pinned reading is keyed on the kanji run as the page spells it, so the
 * press has to report exactly that run — the base of the ruby it landed in, or
 * the run of kanji around the character under the finger when the page carries
 * no ruby there.
 */

/** The longest run a pin may cover. Beyond this the press is on a sentence. */
export const MAX_RUN_LENGTH = 8;

export interface PressedRun {
  run: string;
  /** The reading the page is showing over it, if any. */
  currentReading: string;
  /** Where the run sits, so the reader can paint it while the sheet is open. */
  absStart: number;
  absEnd: number;
}

/**
 * Where the kanji run containing `index` begins and ends, in code points, or
 * null when that character is not kanji.
 *
 * Digits count as part of a run because the reader's own furigana does the
 * same — ３日 is a counter, and its reading belongs to the whole thing.
 */
export function kanjiRunRangeAt(
  text: string,
  index: number,
): { start: number; end: number } | null {
  const chars = [...text];
  if (index < 0 || index >= chars.length) return null;
  const inRun = (ch: string) => isKanji(ch) || isDigit(ch);
  if (!inRun(chars[index])) return null;

  let start = index;
  while (start > 0 && inRun(chars[start - 1])) start--;
  let end = index;
  while (end + 1 < chars.length && inRun(chars[end + 1])) end++;

  // A run longer than the cap is trimmed around the pressed character rather
  // than from one end, so a press in the middle of 大日本帝国憲法第九条 still
  // reports the part it landed on.
  if (end - start + 1 > MAX_RUN_LENGTH) {
    const half = Math.floor(MAX_RUN_LENGTH / 2);
    start = Math.max(start, Math.min(index - half, end - MAX_RUN_LENGTH + 1));
    end = start + MAX_RUN_LENGTH - 1;
  }
  return { start, end: end + 1 };
}

/** The kanji run containing `index`, or "" when that character is not kanji. */
export function kanjiRunAt(text: string, index: number): string {
  const range = kanjiRunRangeAt(text, index);
  if (!range) return "";
  return [...text].slice(range.start, range.end).join("");
}

/** The base text and reading of the ruby an element sits in, if it sits in one. */
export function rubyUnder(element: Element | null): PressedRun | null {
  const ruby = element?.closest("ruby");
  if (!ruby) return null;

  let base = "";
  let reading = "";
  let firstBaseText: Node | null = null;
  let lastBaseText: Node | null = null;
  for (const node of Array.from(ruby.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      base += node.textContent ?? "";
      // Same reason as textNodesIn: the newline between <ruby> and its base is
      // not part of the run.
      if ((node.textContent ?? "").trim().length === 0) continue;
      firstBaseText ??= node;
      lastBaseText = node;
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = (node as Element).tagName;
    if (tag === "RT") reading += node.textContent ?? "";
    else if (tag !== "RP") {
      const inner = firstTextNodeIn(node);
      firstBaseText ??= inner;
      lastBaseText = lastTextNodeIn(node) ?? lastBaseText;
      base += node.textContent ?? "";
    }
  }
  base = base.trim();
  // The same two limits the plain-text path enforces. Aozora's 群ルビ puts a
  // whole phrase in one ruby, and a kana base is not a run anybody can pin.
  const baseChars = [...base];
  if (baseChars.length === 0 || baseChars.length > MAX_RUN_LENGTH) return null;
  if (!baseChars.some((ch) => isKanji(ch) || isDigit(ch))) return null;

  // -1 means "nowhere to paint": the run is still reported, it just carries no
  // range. Absolute offsets are measured from the page element.
  const canMeasure =
    firstBaseText != null && lastBaseText != null && state.pageEl?.contains(firstBaseText) === true;
  if (!canMeasure) {
    return { run: base, currentReading: reading.trim(), absStart: -1, absEnd: -1 };
  }
  // From the first base character to the last, rather than start + length: a
  // mono-ruby base is several nodes with the fallback parentheses between them,
  // so the base's characters are not contiguous in the page's offsets. Those
  // parentheses are hidden whenever ruby renders at all, so spanning them shows
  // nothing extra.
  // Trimmed at each end, so a node of "  杏子 " contributes only its characters.
  const firstText = firstBaseText!.textContent ?? "";
  const lastText = lastBaseText!.textContent ?? "";
  const absStart = nodeOffsetToAbsolute(
    firstBaseText!,
    firstText.length - firstText.trimStart().length,
  );
  const absEnd = nodeOffsetToAbsolute(lastBaseText!, lastText.trimEnd().length);
  return { run: base, currentReading: reading.trim(), absStart, absEnd };
}

/**
 * Text nodes that hold something, in document order.
 *
 * Whitespace-only nodes are skipped: `base` is trimmed, so counting the newline
 * an EPUB puts between `<ruby>` and its base would paint a cell either side of
 * the run.
 */
function textNodesIn(root: Node): Node[] {
  const walker = textWalker(root);
  const nodes: Node[] = [];
  while (walker.nextNode()) {
    if ((walker.currentNode.textContent ?? "").trim().length > 0) nodes.push(walker.currentNode);
  }
  return nodes;
}

function firstTextNodeIn(root: Node): Node | null {
  return textNodesIn(root)[0] ?? null;
}

function lastTextNodeIn(root: Node): Node | null {
  const nodes = textNodesIn(root);
  return nodes[nodes.length - 1] ?? null;
}

/** The paragraph a text node sits in. A run never crosses one. */
function blockAncestor(node: Node): Element | null {
  let element = node.parentElement;
  while (element && element !== state.pageEl) {
    const tag = element.tagName;
    if (tag === "P" || tag === "DIV" || tag === "LI" || tag === "BLOCKQUOTE") return element;
    element = element.parentElement;
  }
  return element;
}

/**
 * The paragraph's text, and where in it the caret is.
 *
 * One text node is not enough. Bookmark highlighting wraps words in spans and
 * furigana wraps kanji in ruby, so 杏子 can be two text nodes with a span
 * boundary between them, and reading only the caret's own node reports 杏
 * where the page says 杏子. The walk stops at the paragraph, because a run that
 * crossed one would be a pin that never matches anything.
 */
function paragraphTextAroundCaret(node: Node, offset: number): { text: string; index: number } {
  const block = blockAncestor(node);
  if (!block) return { text: node.textContent ?? "", index: offset };

  const walker = textWalker(block);
  let text = "";
  let index = -1;
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current === node) index = text.length + offset;
    text += current.textContent ?? "";
  }
  if (index < 0) return { text: node.textContent ?? "", index: offset };
  // kanjiRunAt counts code points; one surrogate pair earlier in the paragraph
  // would otherwise shift the run by a character.
  return { text, index: [...text.slice(0, index)].length };
}

/**
 * Whether a rect sits on the column the reader is showing.
 *
 * Pagination keeps the neighbouring columns laid out and clipped, so a caret
 * can resolve to text that is off-screen. The tap handler refuses those for the
 * same reason: pinning a run nobody can see is pinning the wrong run.
 */
function isOnVisiblePage(rect: DOMRect): boolean {
  const pageRect = state.pageEl!.getBoundingClientRect();
  const centre = (rect.left + rect.right) / 2;
  return centre >= pageRect.left && centre <= pageRect.right;
}

/**
 * What the finger is on, without working out the run yet.
 *
 * This runs on every touchstart — every tap and every swipe begins with one —
 * so it does the cheap half: the hit test and one layout read, the same ones
 * the tap handler already does. The paragraph walk waits until the press has
 * actually been held.
 */
export interface PressTarget {
  /** Answered outright when the press landed in a ruby. */
  ruby: PressedRun | null;
  caretNode: Node | null;
  caretOffset: number;
  /** The character that was there, so a repaint cannot move the offset under it. */
  caretChar: string;
}

export function pressTargetAt(
  x: number,
  y: number,
  caret?: { node: Node; offset: number } | null,
): PressTarget | null {
  const element = document.elementFromPoint(x, y);
  const inRuby = element?.closest("ruby") ?? null;
  if (inRuby) {
    // Either the ruby answers or nothing does. Falling through to the text
    // under a ruby this refused would pin a run that cannot line up with the
    // reading the page is already showing over it.
    const fromRuby = rubyUnder(inRuby);
    if (!fromRuby) return null;
    if (!isOnVisiblePage(inRuby.getBoundingClientRect())) return null;
    return { ruby: fromRuby, caretNode: null, caretOffset: 0, caretChar: "" };
  }

  // The caller has usually resolved this already for its own gesture.
  const resolved = caret ?? resolveCaretAt(x, y);
  if (!resolved || resolved.node.nodeType !== Node.TEXT_NODE) return null;

  const text = resolved.node.textContent ?? "";
  if (resolved.offset >= text.length) return null;

  const charRange = document.createRange();
  charRange.setStart(resolved.node, resolved.offset);
  charRange.setEnd(resolved.node, resolved.offset + 1);
  if (!isOnVisiblePage(charRange.getBoundingClientRect())) return null;

  return {
    ruby: null,
    caretNode: resolved.node,
    caretOffset: resolved.offset,
    caretChar: text.charAt(resolved.offset),
  };
}

/**
 * The run that target names.
 *
 * Deferred from the hit test, and safe to defer: a reflow moves pixels, not
 * text nodes, so the caret this walks from still points at the character the
 * finger landed on.
 */
export function resolvePressedRun(target: PressTarget): PressedRun | null {
  if (target.ruby) return target.ruby;
  if (!target.caretNode) return null;
  // The page may have been replaced under the finger — a reload, or a slice
  // swapped in. The node is then detached and still carries its old text, so
  // the run would be one the page no longer shows.
  if (!state.pageEl?.contains(target.caretNode)) return null;
  // Bookmark highlighting and tap highlighting both splitText, which shortens
  // the node in place while it is still attached. The offset would then point
  // at a different character, or past the end.
  if ((target.caretNode.textContent ?? "").charAt(target.caretOffset) !== target.caretChar) {
    return null;
  }
  const { text, index } = paragraphTextAroundCaret(target.caretNode, target.caretOffset);
  const range = kanjiRunRangeAt(text, index);
  if (!range) return null;
  const chars = [...text];
  const run = chars.slice(range.start, range.end).join("");

  // The range is in code points within the paragraph; the reader paints by
  // UTF-16 offset across the whole page. Measure the gap in UTF-16 units so a
  // surrogate pair earlier in the paragraph cannot shift the highlight.
  const beforeRun = chars.slice(range.start, index).join("").length;
  const absStart = nodeOffsetToAbsolute(target.caretNode, target.caretOffset) - beforeRun;
  return { run, currentReading: "", absStart, absEnd: absStart + run.length };
}

/** Both halves at once, for the mouse path where nothing is held. */
export function pressedRunAt(x: number, y: number): PressedRun | null {
  const target = pressTargetAt(x, y);
  return target ? resolvePressedRun(target) : null;
}

/** Tell the app a long press is asking for this run's reading. */
export function postFuriganaPinTarget(pressed: PressedRun, x: number, y: number): void {
  window.ReactNativeWebView.postMessage(
    JSON.stringify({
      type: "furiganaPin",
      run: pressed.run,
      currentReading: pressed.currentReading,
      x,
      y,
    }),
  );
}

/**
 * Resolve and report in one go. Only for the mouse path, where the gesture is
 * a right-click and nothing has moved between press and report.
 */
export function reportFuriganaPinTarget(x: number, y: number): PressedRun | null {
  const pressed = pressedRunAt(x, y);
  if (!pressed) return null;
  postFuriganaPinTarget(pressed, x, y);
  return pressed;
}
