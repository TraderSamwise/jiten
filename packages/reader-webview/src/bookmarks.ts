import { state } from "./state";
import { textWalker } from "./text";
import { withPreservedHighlight } from "./highlight";

type TextRun = {
  node: Text;
  start: number;
  end: number;
};

type BookmarkMatch = {
  start: number;
  end: number;
};

let appliedVersion = "";
let appliedSurfacesKey = "";

function unwrapBookmarkSpans(): void {
  const spans = Array.from(state.pageEl!.querySelectorAll("span.bookmarked-word"));
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize();
  }
}

function collectRuns(root: Node): { text: string; runs: TextRun[] } {
  const walker = textWalker(root);
  const runs: TextRun[] = [];
  let text = "";

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nodeText = node.textContent ?? "";
    if (nodeText.length === 0) continue;
    const start = text.length;
    text += nodeText;
    runs.push({ node, start, end: text.length });
  }

  return { text, runs };
}

function findMatches(text: string, surfaces: string[]): BookmarkMatch[] {
  const matches: BookmarkMatch[] = [];
  if (text.length === 0 || surfaces.length === 0) return matches;

  let i = 0;
  while (i < text.length) {
    let matched: string | null = null;
    for (const surface of surfaces) {
      if (surface.length === 0) continue;
      if (text.startsWith(surface, i)) {
        matched = surface;
        break;
      }
    }
    if (!matched) {
      i++;
      continue;
    }
    matches.push({ start: i, end: i + matched.length });
    i += matched.length;
  }

  return matches;
}

function wrapTextSlice(node: Text, start: number, end: number): void {
  if (end <= start) return;

  let target = node;
  if (start > 0) target = target.splitText(start);
  const length = end - start;
  if (length < target.textContent!.length) target.splitText(length);

  const span = document.createElement("span");
  span.className = "bookmarked-word";
  target.parentNode!.insertBefore(span, target);
  span.appendChild(target);
}

function applyMatch(match: BookmarkMatch, runs: TextRun[]): void {
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    if (run.end <= match.start || run.start >= match.end) continue;
    const start = Math.max(0, match.start - run.start);
    const end = Math.min(run.end, match.end) - run.start;
    wrapTextSlice(run.node, start, end);
  }
}

function applyBookmarkSurfaces(surfaces: string[]): void {
  unwrapBookmarkSpans();
  if (surfaces.length === 0) return;

  const sortedSurfaces = [...surfaces].sort((a, b) => b.length - a.length);
  const blocks = Array.from(state.pageEl!.querySelectorAll("p"));
  const roots: Node[] = blocks.length > 0 ? blocks : [state.pageEl!];

  for (const root of roots) {
    const { text, runs } = collectRuns(root);
    const matches = findMatches(text, sortedSurfaces);
    for (let i = matches.length - 1; i >= 0; i--) {
      applyMatch(matches[i], runs);
    }
  }
}

function forceBookmarkRepaint(): void {
  const page = state.pageEl;
  if (!page) return;

  // iOS WebKit can defer painting newly inserted inline backgrounds in
  // vertical text until the next interaction. This forces the affected layer
  // to repaint without changing pagination or scroll alignment.
  void page.offsetWidth;
  page.style.webkitTransform = "translateZ(0)";
  requestAnimationFrame(() => {
    page.style.webkitTransform = "";
  });
}

export function setBookmarkHighlights(input: { version?: string; surfaces?: string[] }): void {
  const surfaces = input.surfaces ?? [];
  const surfacesKey = surfaces.slice().sort().join("\u0001");
  const version = input.version ?? "";
  if (version === appliedVersion && surfacesKey === appliedSurfacesKey) return;

  withPreservedHighlight(() => {
    applyBookmarkSurfaces(surfaces);
  });
  forceBookmarkRepaint();

  appliedVersion = version;
  appliedSurfacesKey = surfacesKey;
}

export function resetBookmarkHighlightState(): void {
  appliedVersion = "\u0000";
  appliedSurfacesKey = "\u0000";
}
