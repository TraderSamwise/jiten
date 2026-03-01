import { state } from "./state";
import { animateResetShift } from "./pagination";

declare const CSS: { highlights?: HighlightRegistry };
declare class Highlight {
  constructor(...ranges: Range[]);
  add(range: Range): void;
  clear(): void;
}
interface HighlightRegistry {
  set(name: string, highlight: Highlight): void;
  delete(name: string): boolean;
}

const useHighlightAPI = typeof CSS !== "undefined" && CSS.highlights !== undefined;
const HIGHLIGHT_NAME = "word-highlight";

// Keep references so we can clear ranges directly
let activeHighlight: Highlight | null = null;
let activeRanges: Range[] = [];

function isInsideRt(node: Node): boolean {
  let parent = node.parentNode;
  while (parent && parent !== state.contentEl) {
    if ((parent as Element).tagName === "RT") return true;
    parent = parent.parentNode;
  }
  return false;
}

function makeTextWalker(): TreeWalker {
  return document.createTreeWalker(state.contentEl!, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      return isInsideRt(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
}

// ---------- Clear ----------

export function clearHighlight(): void {
  if (useHighlightAPI) {
    // Detach each range and clear the highlight object
    for (let i = 0; i < activeRanges.length; i++) {
      activeRanges[i].detach();
    }
    activeRanges = [];
    if (activeHighlight) {
      activeHighlight.clear();
    }
    CSS.highlights!.delete(HIGHLIGHT_NAME);
  } else {
    clearHighlightSpan();
  }

  if (state.dragMode !== "selecting") {
    animateResetShift();
  }
}

function clearHighlightSpan(): void {
  const spans = state.contentEl!.querySelectorAll("span.highlight");
  if (spans.length === 0) return;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const parent = span.parentNode!;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize();
  }
  void state.contentEl!.offsetWidth;
}

// ---------- Apply ----------

export function applyHighlight(startDelta: number, len: number): void {
  highlightAbsRange(
    state.lastTapAbsOffset + (startDelta || 0),
    state.lastTapAbsOffset + (startDelta || 0) + len,
  );
}

export function highlightAbsRange(absStart: number, absEnd: number): void {
  if (absEnd <= absStart) return;
  if (absStart < 0) absStart = 0;

  if (useHighlightAPI) {
    highlightAbsRangeAPI(absStart, absEnd);
  } else {
    highlightAbsRangeSpan(absStart, absEnd);
  }
}

// ---------- CSS Custom Highlight API path ----------

function highlightAbsRangeAPI(absStart: number, absEnd: number): void {
  const walker = makeTextWalker();

  // Collect per-node Ranges (skip RT, match span approach's visual behavior)
  const ranges: Range[] = [];
  let pos = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.textContent!.length;
    if (pos + len > absStart && pos < absEnd) {
      const sliceStart = Math.max(0, absStart - pos);
      const sliceEnd = Math.min(len, absEnd - pos);
      const range = new Range();
      range.setStart(node, sliceStart);
      range.setEnd(node, sliceEnd);
      ranges.push(range);
    }
    pos += len;
    if (pos >= absEnd) break;
  }

  if (ranges.length === 0) return;
  activeRanges = ranges;
  activeHighlight = new Highlight(...ranges);
  CSS.highlights!.set(HIGHLIGHT_NAME, activeHighlight);
}

// ---------- Span fallback path ----------

function highlightAbsRangeSpan(absStart: number, absEnd: number): void {
  const walker = makeTextWalker();

  const nodes: { node: Text; start: number }[] = [];
  let pos = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.textContent!.length;
    if (pos + len > absStart && pos < absEnd) {
      nodes.push({ node, start: pos });
    }
    pos += len;
    if (pos >= absEnd) break;
  }

  for (const { node, start } of nodes) {
    const sliceStart = Math.max(0, absStart - start);
    const sliceEnd = Math.min(node.textContent!.length, absEnd - start);

    let target: Text = node;
    if (sliceStart > 0) {
      target = target.splitText(sliceStart);
    }
    if (sliceEnd - sliceStart < target.textContent!.length) {
      target.splitText(sliceEnd - sliceStart);
    }
    const span = document.createElement("span");
    span.className = "highlight";
    target.parentNode!.insertBefore(span, target);
    span.appendChild(target);
  }
}
