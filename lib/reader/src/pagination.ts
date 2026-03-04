import { state } from "./state";
import { textWalker, absoluteToNodeOffset } from "./text";

declare const window: Window & {
  __READER_CONFIG__: {
    scrollPosition: number;
    targetLocalChar?: number;
    sliceCharOffset?: number;
    totalChars?: number;
  };
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
  const lineW = parseFloat(getComputedStyle(state.contentEl!).lineHeight) || fontSize * 1.5;
  // Snap page width to whole lines so page boundaries never cut through text
  state.columnWidth = Math.floor(cW / lineW) * lineW;
  state.pageEl!.style.width = state.columnWidth + "px";
  state.totalPages = Math.max(1, Math.round(state.pageEl!.scrollWidth / state.columnWidth));
}

// Find the nearest char to absOffset that has a non-zero bounding rect.
// Scans forward first (up to 50 chars), then backward.
function findRenderedChar(absOffset: number): number {
  const range = document.createRange();
  // Try forward
  for (let delta = 0; delta <= 50; delta++) {
    const pos = absoluteToNodeOffset(absOffset + delta);
    if (!pos) break;
    range.setStart(pos.node, pos.offset);
    range.setEnd(pos.node, Math.min(pos.offset + 1, pos.node.textContent!.length));
    const r = range.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return absOffset + delta;
  }
  // Try backward
  for (let delta = 1; delta <= 50; delta++) {
    if (absOffset - delta < 0) break;
    const pos = absoluteToNodeOffset(absOffset - delta);
    if (!pos) break;
    range.setStart(pos.node, pos.offset);
    range.setEnd(pos.node, Math.min(pos.offset + 1, pos.node.textContent!.length));
    const r = range.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return absOffset - delta;
  }
  return absOffset; // give up, use original
}

// Align so the column containing targetLocalChar is the rightmost visible column.
// Align the view so that targetLocalChar's column is the rightmost visible column.
// Scrolls to the nearest col-aligned offset that places the target char on screen.
export function alignToTargetChar(targetLocalChar: number): void {
  const cW = state.columnWidth;
  const fontSize = parseFloat(getComputedStyle(state.contentEl!).fontSize);
  const lineW = parseFloat(getComputedStyle(state.contentEl!).lineHeight) || fontSize * 1.5;
  const alignTarget = findRenderedChar(targetLocalChar);

  // Paginate from clean state (no spacer)
  const oldSpacer = state.pageEl!.querySelector(".back-spacer");
  if (oldSpacer) oldSpacer.remove();
  state.totalPages = Math.max(1, Math.round(state.pageEl!.scrollWidth / cW));
  state.prependedPages = 0;
  state.totalPrependWidth = 0;

  // Measure target char position at scrollLeft=0
  state.pageEl!.scrollLeft = 0;
  const pos = absoluteToNodeOffset(alignTarget);
  if (!pos) return;

  const range = document.createRange();
  range.setStart(pos.node, pos.offset);
  range.setEnd(pos.node, Math.min(pos.offset + 1, pos.node.textContent!.length));
  const charRect = range.getBoundingClientRect();
  const pageRight = state.pageEl!.getBoundingClientRect().right;

  if (charRect.right === 0 && charRect.left === 0) {
    const totalChars = state.pageEl!.textContent!.length;
    const ratio = totalChars > 0 ? alignTarget / totalChars : 0;
    state.currentPage = Math.max(1, Math.round(ratio * state.totalPages));
    goToPage(state.currentPage);
    return;
  }

  // D = distance from char to right edge, quantize to nearest col
  const D = pageRight - charRect.right;
  const linesFromRight = Math.round(D / lineW);
  const colOffset = (linesFromRight + 1) * lineW;

  // Scroll so the target char's col is the rightmost visible col
  state.pageEl!.scrollLeft = -colOffset;
  state.currentPage = Math.max(1, Math.round(colOffset / cW) + 1);
  state.canonicalCharOffset = state.sliceCharOffset + alignTarget;
  updatePageInfo();
  reportScroll();
}

// Measure the last visible character on the current page.
// Returns a 0-based char index within the WebView's current content,
// or -1 if nothing is measurable.
export function measureLastVisibleChar(): number {
  // Use pageEl (the actual visible column) not contentEl (which includes padding).
  const viewRect = state.pageEl!.getBoundingClientRect();
  const pageRect = viewRect;

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

    // Skip non-rendered nodes (whitespace between elements)
    // Use < 1 threshold for subpixel values that round to 0
    if (nodeRect.width < 1 && nodeRect.height < 1) {
      charCount += len;
      continue;
    }

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
      if (charRect.width < 1 && charRect.height < 1) continue; // skip non-rendered chars
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

// Measure the first visible character on the current page.
// Returns a 0-based char index within the WebView's current content,
// or 0 if nothing is measurable.
export function measureFirstVisibleChar(): number {
  // Use pageEl (the actual visible column) not contentEl (which includes padding
  // and would pick up chars from adjacent clipped columns).
  const viewRect = state.pageEl!.getBoundingClientRect();
  const pageRect = viewRect;

  const walker = textWalker(state.pageEl!);
  let charCount = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.textContent!.length;
    if (len === 0) {
      charCount += len;
      continue;
    }

    const range = document.createRange();
    range.selectNodeContents(node);
    const nodeRect = range.getBoundingClientRect();

    // Skip non-rendered nodes (whitespace between elements)
    if (nodeRect.width < 1 && nodeRect.height < 1) {
      charCount += len;
      continue;
    }

    // In vertical-rl, text flows right-to-left.
    // Entirely to the left of the viewport = past what we've read
    if (nodeRect.right < viewRect.left) {
      charCount += len;
      break;
    }

    // Entirely to the right of viewport = not yet visible
    if (nodeRect.left > viewRect.right) {
      charCount += len;
      continue;
    }

    // Node is at least partially visible — find first visible char
    for (let i = 0; i < len; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const charRect = range.getBoundingClientRect();
      if (charRect.width < 1 && charRect.height < 1) continue; // skip non-rendered chars
      const cx = (charRect.left + charRect.right) / 2;
      if (cx >= viewRect.left && cx <= viewRect.right) {
        return charCount + i;
      }
    }

    charCount += len;
  }

  return 0;
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

function updatePageInfo(): void {
  const firstChar = measureFirstVisibleChar();
  const globalChar = state.sliceCharOffset + firstChar;
  const pct = state.totalChars > 0 ? ((globalChar / state.totalChars) * 100).toFixed(1) : "0.0";
  state.pageNumEl!.textContent = pct + "%";
  state.btnNext!.disabled = state.currentPage >= state.totalPages;
  state.btnPrev!.disabled = state.currentPage <= 1;
}

// Navigation
export function goToPage(page: number): void {
  page = Math.max(1, Math.min(page, state.totalPages));
  // Clear canonical offset when navigating to a different page (user action).
  // Internal calls (alignment, prepend, resize) set currentPage first, so page === currentPage.
  if (page !== state.currentPage) {
    state.canonicalCharOffset = -1;
  }
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
  state.canonicalCharOffset = -1; // user navigated — use MFVC from now on
  goToPage(state.currentPage + 1);
}

export function prevPage(): void {
  state.canonicalCharOffset = -1; // user navigated — use MFVC from now on
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
  const firstChar = measureFirstVisibleChar();
  // Use canonical global offset (from DB) until user navigates to a new page.
  // This prevents drift from spacer/prepend shifting column boundaries.
  const globalChar =
    state.canonicalCharOffset >= 0 ? state.canonicalCharOffset : state.sliceCharOffset + firstChar;
  window.ReactNativeWebView.postMessage(
    JSON.stringify({
      type: "scroll",
      charOffset: globalChar,
    }),
  );
}

export function prependBackSlice(html: string, charCount?: number): void {
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

  // 5. Calculate spacer for page alignment (quantized to columnWidth)
  const remainder = state.totalPrependWidth % state.columnWidth;
  const spacerWidth = remainder > 1 ? state.columnWidth : 0;
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
  if (charCount != null) state.sliceCharOffset -= charCount;
  // NOTE: canonicalCharOffset is intentionally NOT cleared here — it's a global
  // value that stays valid regardless of slice offset changes.
  state.totalPages = Math.max(1, Math.round(state.pageEl!.scrollWidth / state.columnWidth));

  // 7. Scroll to correct position and notify
  goToPage(state.currentPage);

  // 8. Notify RN that prepend is done
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: "backPrefetchDone" }));
}
