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

/**
 * Where to paint inside one visible run, as the matcher worked it out.
 *
 * Positions, not a set of surfaces: a word confirmed in one place used to be
 * painted in every other place the same characters appeared — つい inside
 * について, きこんで inside 書きこんで. Keyed by the run's text because the
 * matcher scans HTML and this walks the DOM, and the two can be trusted to
 * agree on what the characters ARE long before they can be trusted to agree
 * on how many of them came before.
 */
type BookmarkRunPlacements = {
  run: string;
  /** `[start, length]` pairs in UTF-16 units from the start of the run. */
  spans: [number, number][];
};

let appliedVersion = "";
let appliedRunsKey = "";

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

/**
 * The same character class the matcher uses to cut a page into runs. Copied
 * rather than imported: this bundle is standalone and has no dependencies.
 */
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

/**
 * Offsets are UTF-16 units throughout, which is what a DOM text node counts
 * in — so this scan indexes with `[i]` and never iterates with `for...of`.
 */
function findMatches(text: string, byRun: Map<string, [number, number][]>): BookmarkMatch[] {
  const matches: BookmarkMatch[] = [];
  if (text.length === 0 || byRun.size === 0) return matches;

  let i = 0;
  while (i < text.length) {
    if (!isJapaneseTextChar(text[i])) {
      i++;
      continue;
    }
    let end = i;
    while (end < text.length && isJapaneseTextChar(text[end])) end++;
    for (const span of byRun.get(text.slice(i, end)) ?? []) {
      const start = i + span[0];
      if (span[1] <= 0 || start + span[1] > end) continue;
      matches.push({ start: start, end: start + span[1] });
    }
    i = end;
  }

  return matches;
}

/**
 * The visible run the tap landed in, and where in it the tap was.
 *
 * The tap's own text window is fifteen characters back and twenty forward, so
 * it clips runs at both ends and fuses paragraphs — it cannot be used to look
 * a placement up. This reports the run itself.
 */
export function tappedRun(node: Node, offset: number): { run: string; offset: number } | null {
  let block: Node = node;
  while (block.parentNode && !(block.nodeType === 1 && (block as Element).tagName === "P")) {
    block = block.parentNode;
    if (block === state.pageEl) break;
  }

  const walker = textWalker(block);
  let text = "";
  let at = -1;
  while (walker.nextNode()) {
    const current = walker.currentNode as Text;
    if (current === node) at = text.length + offset;
    text += current.textContent ?? "";
  }
  if (at < 0 || at >= text.length || !isJapaneseTextChar(text[at])) return null;

  let start = at;
  while (start > 0 && isJapaneseTextChar(text[start - 1])) start--;
  let end = at;
  while (end < text.length && isJapaneseTextChar(text[end])) end++;
  return { run: text.slice(start, end), offset: at - start };
}

/**
 * Where a span sits in the word it belongs to, so the ring that parts two
 * adjacent words is not drawn through the middle of one.
 *
 * A word is more than one span whenever furigana splits it: the kanji is
 * inside the <ruby> element and the okurigana after it, so 飽きない is 飽 and
 * きない. With the ring on every span that word was painted with a seam down
 * the middle of itself.
 */
type MatchPart = "only" | "start" | "middle" | "end";

function wrapTextSlice(node: Text, start: number, end: number, part: MatchPart): void {
  if (end <= start) return;

  let target = node;
  if (start > 0) target = target.splitText(start);
  const length = end - start;
  if (length < target.textContent!.length) target.splitText(length);

  const span = document.createElement("span");
  span.className = part === "only" ? "bookmarked-word" : `bookmarked-word bookmarked-word-${part}`;
  target.parentNode!.insertBefore(span, target);
  span.appendChild(target);
}

function applyMatch(match: BookmarkMatch, runs: TextRun[]): void {
  const touched: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.end <= match.start || run.start >= match.end) continue;
    touched.push(i);
  }

  // Back to front, because wrapping splits the text node and would move every
  // offset after it.
  for (let at = touched.length - 1; at >= 0; at--) {
    const run = runs[touched[at]];
    const start = Math.max(0, match.start - run.start);
    const end = Math.min(run.end, match.end) - run.start;
    const part: MatchPart =
      touched.length === 1
        ? "only"
        : at === 0
          ? "start"
          : at === touched.length - 1
            ? "end"
            : "middle";
    wrapTextSlice(run.node, start, end, part);
  }
}

function applyBookmarkPlacements(placements: BookmarkRunPlacements[]): void {
  unwrapBookmarkSpans();
  if (placements.length === 0) return;

  const byRun = new Map<string, [number, number][]>();
  for (const placement of placements) byRun.set(placement.run, placement.spans);
  const blocks = Array.from(state.pageEl!.querySelectorAll("p"));
  const roots: Node[] = blocks.length > 0 ? blocks : [state.pageEl!];

  for (const root of roots) {
    const { text, runs } = collectRuns(root);
    const matches = findMatches(text, byRun);
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

export function setBookmarkHighlights(input: {
  version?: string;
  runs?: BookmarkRunPlacements[];
}): void {
  const placements = input.runs ?? [];
  const runsKey = placements
    .map((placement) => placement.run + "\u0002" + placement.spans.join(","))
    .sort()
    .join("\u0001");
  const version = input.version ?? "";
  if (version === appliedVersion && runsKey === appliedRunsKey) return;

  withPreservedHighlight(() => {
    applyBookmarkPlacements(placements);
  });
  forceBookmarkRepaint();

  appliedVersion = version;
  appliedRunsKey = runsKey;
}

export function resetBookmarkHighlightState(): void {
  appliedVersion = "\u0000";
  appliedRunsKey = "\u0000";
}
