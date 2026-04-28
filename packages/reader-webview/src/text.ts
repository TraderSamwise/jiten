import { state } from "./state";

/** Check if a node is inside an <rt> (ruby annotation) element. */
function isInsideRt(node: Node): boolean {
  let parent = node.parentNode;
  while (parent && parent !== state.pageEl) {
    if ((parent as Element).tagName === "RT") return true;
    parent = parent.parentNode;
  }
  return false;
}

function isBookmarkedWordElement(node: Node | null): node is Element {
  return !!(
    node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).classList.contains("bookmarked-word")
  );
}

/** Find the base (non-rt) text node inside a <ruby> element. */
function firstVisibleTextNode(root: Node): { node: Node; offset: number } | null {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n: Node) {
      return isInsideRt(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  return w.nextNode() ? { node: w.currentNode, offset: 0 } : null;
}

/** Find the base (non-rt) text node inside a <ruby> element. */
function rubyBaseText(ruby: Element): { node: Node; offset: number } | null {
  return firstVisibleTextNode(ruby);
}

/**
 * Resolve a caret position that lands on a reader-injected wrapper span
 * back to the underlying visible text node so tap/drag selection remain
 * independent from bookmark highlighting.
 */
export function resolveCaretForBookmarkWrapper(
  node: Node,
  offset: number,
): { node: Node; offset: number } | null {
  if (isBookmarkedWordElement(node)) return firstVisibleTextNode(node);
  if (node.nodeType === Node.ELEMENT_NODE) {
    const child = node.childNodes[offset] ?? node.childNodes[Math.max(0, offset - 1)] ?? null;
    if (isBookmarkedWordElement(child)) return firstVisibleTextNode(child);
  }
  let parent = node.parentNode;
  while (parent && parent !== state.pageEl) {
    if (isBookmarkedWordElement(parent)) return { node, offset };
    parent = parent.parentNode;
  }
  return null;
}

/**
 * Resolve a caret position that may be inside <rt> or on a <ruby> element
 * to the base kanji text node. Returns null if no resolution needed or possible.
 */
export function resolveCaretForRuby(
  node: Node,
  offset: number,
): { node: Node; offset: number } | null {
  // Case 1: text node inside <rt> — map to the base text in parent <ruby>
  if (node.nodeType === Node.TEXT_NODE && isInsideRt(node)) {
    let ruby: Node | null = node.parentNode;
    while (ruby && (ruby as Element).tagName !== "RUBY") ruby = ruby.parentNode;
    if (ruby) return rubyBaseText(ruby as Element);
  }
  // Case 2: element node (e.g. <ruby> or <rt> element itself)
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = (node as Element).tagName;
    let ruby: Element | null = null;
    if (tag === "RUBY") ruby = node as Element;
    else if (tag === "RT") {
      ruby = node.parentElement;
      while (ruby && ruby.tagName !== "RUBY") ruby = ruby.parentElement;
    }
    if (ruby) return rubyBaseText(ruby);
  }
  return null;
}

/**
 * Resolve a caretRangeFromPoint result, using elementFromPoint as fallback
 * when caret lands at a text node boundary (offset === length) near ruby.
 */
export function resolveCaretAt(x: number, y: number): { node: Node; offset: number } | null {
  const range = document.caretRangeFromPoint(x, y);
  if (range) {
    const node = range.startContainer;
    const offset = range.startOffset;
    const bookmarkRes = resolveCaretForBookmarkWrapper(node, offset);
    if (bookmarkRes) return bookmarkRes;
    // Try ruby resolution first
    const res = resolveCaretForRuby(node, offset);
    if (res) return res;
    // If offset is at end of text node, caret may have snapped to boundary
    // next to a ruby element — check elementFromPoint
    if (node.nodeType === Node.TEXT_NODE && offset === node.textContent!.length) {
      const el = document.elementFromPoint(x, y);
      if (el) {
        const bookmark = el.closest(".bookmarked-word");
        if (bookmark) {
          const bookmarkText = firstVisibleTextNode(bookmark);
          if (bookmarkText) return bookmarkText;
        }
        const ruby = el.closest("ruby");
        if (ruby) return rubyBaseText(ruby);
      }
    }
    if (node.nodeType === Node.TEXT_NODE) return { node, offset };
  }
  // No range at all — try elementFromPoint
  const el = document.elementFromPoint(x, y);
  if (el) {
    const bookmark = el.closest(".bookmarked-word");
    if (bookmark) {
      const bookmarkText = firstVisibleTextNode(bookmark);
      if (bookmarkText) return bookmarkText;
    }
    const ruby = el.closest("ruby");
    if (ruby) return rubyBaseText(ruby);
  }
  return null;
}

/** Create a TreeWalker that skips text nodes inside <rt> elements. */
export function textWalker(root: Node): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      return isInsideRt(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
}

// Convert a node/offset to an absolute character offset within contentEl
export function nodeOffsetToAbsolute(targetNode: Node, targetOffset: number): number {
  const walker = textWalker(state.pageEl!);
  let abs = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === targetNode) return abs + targetOffset;
    abs += walker.currentNode.textContent!.length;
  }
  return abs + targetOffset;
}

// Resolve absolute offset to node/offset pair (survives DOM changes)
export function absoluteToNodeOffset(absOffset: number): { node: Node; offset: number } | null {
  const walker = textWalker(state.pageEl!);
  let remaining = absOffset;
  while (walker.nextNode()) {
    const len = walker.currentNode.textContent!.length;
    if (remaining <= len) return { node: walker.currentNode, offset: remaining };
    remaining -= len;
  }
  return null;
}

// Extract text between absolute offsets
export function getAbsText(absStart: number, absEnd: number): string {
  const walker = textWalker(state.pageEl!);
  let result = "";
  let pos = 0;
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent!;
    const nodeEnd = pos + t.length;
    if (nodeEnd > absStart && pos < absEnd) {
      const s = Math.max(0, absStart - pos);
      const e = Math.min(t.length, absEnd - pos);
      result += t.slice(s, e);
    }
    pos = nodeEnd;
    if (pos >= absEnd) break;
  }
  return result;
}

// Extract text from position forward, walking through text nodes
export function getTextFromPosition(
  startNode: Node,
  startOffset: number,
  maxChars: number,
): string {
  let text = "";
  const walker = textWalker(state.pageEl!);
  walker.currentNode = startNode;
  text += startNode.textContent!.slice(startOffset);
  while (text.length < maxChars && walker.nextNode()) {
    text += walker.currentNode.textContent;
  }
  return text.slice(0, maxChars);
}

// Extract text backward from position, walking through preceding text nodes
export function getTextBeforePosition(
  startNode: Node,
  startOffset: number,
  maxChars: number,
): string {
  let text = startNode.textContent!.slice(0, startOffset);
  const walker = textWalker(state.pageEl!);
  walker.currentNode = startNode;
  while (text.length < maxChars && walker.previousNode()) {
    text = walker.currentNode.textContent + text;
  }
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars);
  }
  return text;
}
