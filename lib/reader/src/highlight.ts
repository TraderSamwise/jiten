import { state } from "./state";
import { animateResetShift } from "./pagination";

function isInsideRt(node: Node): boolean {
  let parent = node.parentNode;
  while (parent && parent !== state.contentEl) {
    if ((parent as Element).tagName === "RT") return true;
    parent = parent.parentNode;
  }
  return false;
}

// Clear existing highlights
export function clearHighlight(): void {
  const spans = state.contentEl!.querySelectorAll("span.highlight");
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const parent = span.parentNode!;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize();
  }

  // Animate page back to normal if shifted, but not during an active selection
  if (state.dragMode !== "selecting") {
    animateResetShift();
  }
}

// Apply highlight by startDelta + length from lastTapAbsOffset.
// startDelta is relative to lastTapAbsOffset (negative = match starts before tap)
export function applyHighlight(startDelta: number, len: number): void {
  highlightAbsRange(
    state.lastTapAbsOffset + (startDelta || 0),
    state.lastTapAbsOffset + (startDelta || 0) + len,
  );
}

// Apply highlight by absolute character offsets.
// Wraps each text node individually to avoid cross-element Range operations
// that destroy DOM structure when spanning multiple paragraphs.
export function highlightAbsRange(absStart: number, absEnd: number): void {
  if (absEnd <= absStart) return;
  if (absStart < 0) absStart = 0;

  const walker = document.createTreeWalker(state.contentEl!, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      return isInsideRt(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collect overlapping text nodes first (don't modify DOM while walking)
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
