import { state } from "./state";
import { textWalker, absoluteToNodeOffset } from "./text";

declare const window: Window & {
  __READER_CONFIG__: { scrollPosition: number };
  ReactNativeWebView: { postMessage(msg: string): void };
};

function getContentW(): number {
  const cs = getComputedStyle(state.contentEl!);
  return (
    state.contentEl!.clientWidth -
    (parseFloat(cs.paddingLeft) || 0) -
    (parseFloat(cs.paddingRight) || 0)
  );
}

// Move raw content into #page and remove #raw staging element.
export function setupContent(): void {
  const raw = document.getElementById("raw")!;
  while (raw.firstChild) {
    state.pageEl!.appendChild(raw.firstChild);
  }
  raw.remove();
}

// Responsive sizing
export function updateSizing(): void {
  const h = document.documentElement.clientHeight - state.controlsH;
  const w = document.documentElement.clientWidth;
  if (h > 0) state.contentEl!.style.height = h + "px";
  if (w > 0) state.contentEl!.style.width = w + "px";
}

// Count total pages from natural vertical-rl overflow.
// In vertical-rl, text creates columns that overflow leftward;
// scrollWidth reflects the full content width.
export function paginate(): void {
  const cW = getContentW();
  const fontSize = parseFloat(getComputedStyle(state.contentEl!).fontSize);
  const lineW = fontSize * 1.5; // line-height is 1.5
  // Snap page width to whole lines so page boundaries never cut through text
  state.columnWidth = Math.floor(cW / lineW) * lineW;
  state.pageEl!.style.width = state.columnWidth + "px";
  state.totalPages = Math.max(1, Math.round(state.pageEl!.scrollWidth / state.columnWidth));
}

// Measure the last visible character on the current page.
// Returns a 0-based char index within the WebView's current content,
// or -1 if nothing is measurable.
export function measureLastVisibleChar(): number {
  const pageRect = state.pageEl!.getBoundingClientRect();
  // In vertical-rl the visible viewport is a horizontal strip:
  //   left edge  = pageRect.left + scrollLeft (but scrollLeft is negative)
  //   right edge = left edge + columnWidth
  // Because scrollLeft is negative, the visible right edge = pageRect.right + scrollLeft
  // But it's simpler to use the content element's rect which IS the visible viewport.
  const viewRect = state.contentEl!.getBoundingClientRect();

  const walker = textWalker(state.pageEl!);
  let charCount = 0;
  let lastVisible = -1;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.textContent!.length;
    if (len === 0) {
      charCount += len;
      continue;
    }

    // Get the bounding rect of the whole text node
    const range = document.createRange();
    range.selectNodeContents(node);
    const nodeRect = range.getBoundingClientRect();

    // In vertical-rl, text flows right-to-left. Nodes further in the document
    // have smaller left values. The visible area is bounded by viewRect.
    // Entirely to the left of the viewport = offscreen (past what we've read)
    if (nodeRect.right < viewRect.left) {
      charCount += len;
      // Past the visible area — all subsequent nodes are even further left
      break;
    }

    // Entirely to the right of viewport = not yet visible (before current page)
    if (nodeRect.left > viewRect.right) {
      charCount += len;
      continue;
    }

    // Node is at least partially visible — check each char
    for (let i = 0; i < len; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const charRect = range.getBoundingClientRect();
      // Character is visible if its horizontal center is within the viewport
      const cx = (charRect.left + charRect.right) / 2;
      if (cx >= viewRect.left && cx <= viewRect.right) {
        lastVisible = charCount + i;
      }
    }

    charCount += len;
  }

  return lastVisible;
}

// Replace content after localCharIndex with new HTML.
// localCharIndex is 0-based within the current WebView content.
export function replaceOffscreenContent(localCharIndex: number, newHtml: string): void {
  const pos = absoluteToNodeOffset(localCharIndex);
  if (!pos) return;

  // Delete everything from this position to end of #page
  const range = document.createRange();
  range.setStart(pos.node, pos.offset);
  range.setEndAfter(state.pageEl!.lastChild!);
  range.deleteContents();

  // Parse new HTML and append children to #page
  const temp = document.createElement("div");
  temp.innerHTML = newHtml;
  while (temp.firstChild) {
    state.pageEl!.appendChild(temp.firstChild);
  }

  // Recalculate pagination
  state.totalPages = Math.max(1, Math.round(state.pageEl!.scrollWidth / state.columnWidth));
  updatePageInfo();
}

function updateDebug(extra?: string): void {
  const el = document.getElementById("debug-overlay");
  if (!el) return;
  const lines = [
    `local: ${state.currentPage}/${state.totalPages}  offset: ${state.pageOffset}  display: ${state.currentPage + state.pageOffset}/${state.overrideTotalPages || state.totalPages}`,
    `colW: ${state.columnWidth}  scrollW: ${state.pageEl!.scrollWidth}  scrollL: ${state.pageEl!.scrollLeft}`,
    `prepW: ${state.totalPrependWidth}  prepPg: ${state.prependedPages}  spacer: ${state.pageEl!.querySelector(".back-spacer") ? (state.pageEl!.querySelector(".back-spacer") as HTMLElement).style.width : "none"}`,
  ];
  if (extra) lines.push(extra);
  el.textContent = lines.join("\n");
}

function updatePageInfo(): void {
  const displayPage = state.currentPage + state.pageOffset;
  const displayTotal = state.overrideTotalPages || state.totalPages;
  state.pageNumEl!.textContent = displayPage + " / " + displayTotal;
  state.btnNext!.disabled = state.currentPage >= state.totalPages;
  state.btnPrev!.disabled = state.currentPage <= 1;
  updateDebug();
}

// Navigation
export function goToPage(page: number): void {
  page = Math.max(1, Math.min(page, state.totalPages));
  state.currentPage = page;
  state.pageEl!.scrollLeft = -((page - 1) * state.columnWidth);
  updatePageInfo();
  reportScroll();

  // Report last visible char so RN can prefetch next content
  const lastChar = measureLastVisibleChar();
  if (lastChar >= 0) {
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        type: "pageRendered",
        lastCharIndex: lastChar,
        localPage: state.currentPage,
      }),
    );
  }
}

export function nextPage(): void {
  goToPage(state.currentPage + 1);
}

export function prevPage(): void {
  goToPage(state.currentPage - 1);
}

// During drag-select near left edge: scroll slightly to reveal next column.
export function expandPageForHighlight(): boolean {
  const now = Date.now();
  if (now - state.lastShiftTime < 300) return false;
  if (state.currentPage >= state.totalPages && state.shiftOffset === 0) return false;

  const fontSize = parseFloat(getComputedStyle(state.contentEl!).fontSize);
  state.shiftOffset += fontSize * 1.5;
  state.lastShiftTime = now;

  const base = (state.currentPage - 1) * state.columnWidth;
  state.pageEl!.scrollTo({ left: -(base + state.shiftOffset), behavior: "smooth" });
  return true;
}

// Animate back to column-aligned position after selection ends.
export function animateResetShift(): void {
  if (state.shiftOffset === 0) return;
  state.shiftOffset = 0;
  const target = -((state.currentPage - 1) * state.columnWidth);
  state.pageEl!.scrollTo({ left: target, behavior: "smooth" });
}

// Immediately reset shift (safety net for new gestures).
export function resetPageShift(): void {
  if (state.shiftOffset === 0) return;
  state.shiftOffset = 0;
  state.pageEl!.scrollLeft = -((state.currentPage - 1) * state.columnWidth);
}

export function reportScroll(): void {
  const displayPage = state.currentPage + state.pageOffset;
  const displayTotal = state.overrideTotalPages || state.totalPages;
  const pos = displayTotal > 1 ? (displayPage - 1) / (displayTotal - 1) : 0;
  window.ReactNativeWebView.postMessage(
    JSON.stringify({
      type: "scroll",
      position: pos,
    }),
  );
}

export function prependBackSlice(html: string): void {
  const savedPage = state.currentPage;

  // 1. Remove existing spacer (if any)
  const existingSpacer = state.pageEl!.querySelector(".back-spacer");
  if (existingSpacer) existingSpacer.remove();

  // 2. Record scrollWidth before prepending
  const swBefore = state.pageEl!.scrollWidth;

  // 3. Prepend HTML
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const frag = document.createDocumentFragment();
  while (temp.firstChild) frag.appendChild(temp.firstChild);
  state.pageEl!.insertBefore(frag, state.pageEl!.firstChild);

  // 4. Measure new content width
  const swAfter = state.pageEl!.scrollWidth;
  const newContentWidth = swAfter - swBefore;
  state.totalPrependWidth += newContentWidth;

  // 5. Calculate spacer for page alignment
  const remainder = state.totalPrependWidth % state.columnWidth;
  const spacerWidth = remainder > 1 ? Math.round(state.columnWidth - remainder) : 0;
  if (spacerWidth > 0) {
    const spacer = document.createElement("div");
    spacer.className = "back-spacer";
    spacer.style.width = spacerWidth + "px";
    spacer.style.overflow = "hidden";
    state.pageEl!.insertBefore(spacer, state.pageEl!.firstChild);
  }

  // 6. Update state
  const totalPrepPages = Math.round((state.totalPrependWidth + spacerWidth) / state.columnWidth);
  const pagesAdded = totalPrepPages - state.prependedPages;
  state.prependedPages = totalPrepPages;
  state.currentPage = savedPage + pagesAdded;
  state.pageOffset -= pagesAdded;
  state.totalPages = Math.max(1, Math.round(state.pageEl!.scrollWidth / state.columnWidth));

  // 7. Scroll to correct position and notify
  updateDebug(
    `prepend: +${newContentWidth}px  rem:${remainder}  spacer:${spacerWidth}  +${pagesAdded}pg`,
  );
  goToPage(state.currentPage);

  // 8. Notify RN that prepend is done
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: "backPrefetchDone" }));
}
