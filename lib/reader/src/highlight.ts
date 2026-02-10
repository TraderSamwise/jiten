import { state } from "./state";
import { absoluteToNodeOffset } from "./text";

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
}

// Apply highlight by startDelta + length from lastTapAbsOffset.
// startDelta is relative to lastTapAbsOffset (negative = match starts before tap)
export function applyHighlight(startDelta: number, len: number): void {
  highlightAbsRange(
    state.lastTapAbsOffset + (startDelta || 0),
    state.lastTapAbsOffset + (startDelta || 0) + len,
  );
}

// Apply highlight by absolute character offsets
export function highlightAbsRange(absStart: number, absEnd: number): void {
  if (absEnd <= absStart) return;
  if (absStart < 0) absStart = 0;
  const start = absoluteToNodeOffset(absStart);
  const end = absoluteToNodeOffset(absEnd);
  if (!start || !end) return;
  try {
    const hlRange = document.createRange();
    hlRange.setStart(start.node, start.offset);
    hlRange.setEnd(end.node, end.offset);
    if (hlRange.collapsed) return;
    const span = document.createElement("span");
    span.className = "highlight";
    try {
      hlRange.surroundContents(span);
    } catch {
      const fragment = hlRange.extractContents();
      span.appendChild(fragment);
      hlRange.insertNode(span);
    }
  } catch {}
}
