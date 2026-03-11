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

/** Ceil that snaps to the nearest integer when within sub-pixel tolerance. */
function ceilPages(scrollW: number, colW: number): number {
  const raw = scrollW / colW;
  return raw - Math.floor(raw) < 0.01 ? Math.round(raw) : Math.ceil(raw);
}

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
  const lineW =
    parseFloat(getComputedStyle(state.contentEl!).lineHeight) || Math.round(fontSize * 1.5);
  // Snap page width to whole lines so page boundaries never cut through text
  state.columnWidth = Math.floor(cW / lineW) * lineW;
  state.pageEl!.style.width = state.columnWidth + "px";
  // Remove stale spacers before measuring (content changed)
  removeSpacers();
  state.totalPages = Math.max(1, ceilPages(state.pageEl!.scrollWidth, state.columnWidth));
  padEndToGrid();
}

// ---------------------------------------------------------------------------
// Edge spacers: keep scrollWidth an exact multiple of columnWidth so the page
// grid never produces partial-page scrolls at either end.
// ---------------------------------------------------------------------------

function removeSpacers(): void {
  document.getElementById("end-spacer")?.remove();
  document.getElementById("begin-spacer")?.remove();
}

/** Pad the END (left side in vertical-rl) so the last page is reachable. */
function padEndToGrid(): void {
  const cW = state.columnWidth;
  const target = state.totalPages * cW;
  const current = state.pageEl!.scrollWidth;
  if (current >= target) return;
  let spacer = document.getElementById("end-spacer");
  if (!spacer) {
    spacer = document.createElement("div");
    spacer.id = "end-spacer";
    spacer.style.minHeight = "1px";
    state.pageEl!.appendChild(spacer);
  }
  spacer.style.width = target - current + "px";
}

/** Pad the BEGINNING (right side in vertical-rl) so the first page aligns
 *  to the grid. Called once from prevPage when the grid would go below offset 0.
 *  Inserts a spacer and shifts scrollLeft to compensate. */
function padBeginToGrid(deficit: number): void {
  // Already padded — grid is aligned, nothing to do.
  if (document.getElementById("begin-spacer")) return;
  // deficit = how far past 0 the grid would go (= cW - currentOffset).
  // Pad by deficit so that (currentOffset + deficit) is a multiple of cW,
  // making offset 0 a clean grid position.
  const pad = deficit;
  if (pad <= 0) return;
  const spacer = document.createElement("div");
  spacer.id = "begin-spacer";
  spacer.style.minHeight = "1px";
  spacer.style.width = pad + "px";
  state.pageEl!.insertBefore(spacer, state.pageEl!.firstChild);
  // Compensate scroll so the visible content doesn't jump
  state.pageEl!.scrollLeft -= pad;
  // Recalculate pagination with the new spacer
  state.totalPages = Math.max(1, ceilPages(state.pageEl!.scrollWidth, state.columnWidth));
  padEndToGrid(); // end spacer might need updating too
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
// Sets canonicalCharOffset to prevent drift on repeated layout changes.
// scrollLeft is set to a line-aligned value (multiple of lineW).
// currentPage is derived from scrollLeft for display only.
export function alignToTargetChar(targetLocalChar: number): void {
  const alignTarget = findRenderedChar(targetLocalChar);
  const pos = absoluteToNodeOffset(alignTarget);
  if (!pos) {
    goToPage(1);
    state.canonicalCharOffset = -1;
    return;
  }

  // Reset prepend tracking
  state.totalPrependWidth = 0;
  state.prependedPages = 0;

  // Measure char position with scrollLeft reset to 0
  state.pageEl!.scrollLeft = 0;
  const range = document.createRange();
  range.setStart(pos.node, pos.offset);
  range.setEnd(pos.node, Math.min(pos.offset + 1, pos.node.textContent!.length));
  const charRect = range.getBoundingClientRect();

  if (charRect.width < 1 && charRect.height < 1) {
    goToPage(1);
    state.canonicalCharOffset = -1;
    return;
  }

  const pageRect = state.pageEl!.getBoundingClientRect();
  const D = pageRect.right - charRect.right;
  const fontSize = parseFloat(getComputedStyle(state.contentEl!).fontSize);
  const lineW =
    parseFloat(getComputedStyle(state.contentEl!).lineHeight) || Math.round(fontSize * 1.5);
  const offset = Math.floor(D / lineW) * lineW;

  state.pageEl!.scrollLeft = -offset;
  state.currentPage = Math.round(offset / state.columnWidth) + 1;
  state.currentPage = Math.max(1, Math.min(state.currentPage, state.totalPages));
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

  // Recalculate pagination (remove end spacer first so scrollWidth is accurate)
  document.getElementById("end-spacer")?.remove();
  state.totalPages = Math.max(1, ceilPages(state.pageEl!.scrollWidth, state.columnWidth));
  padEndToGrid();
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

// Helper: report last visible char to RN for streaming prefetch.
function reportPageRendered(): void {
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

// Navigate to an explicit page number. Used for percent-jump and initial load.
// Sets scrollLeft from page number (page-grid aligned).
export function goToPage(page: number): void {
  page = Math.max(1, Math.min(page, state.totalPages));
  state.pageEl!.scrollLeft = -((page - 1) * state.columnWidth);
  state.currentPage = page;
  updatePageInfo();
  reportScroll();
  reportPageRendered();
}

let animTargetScroll = 0;
let animTimer: ReturnType<typeof setTimeout> | null = null;
const isSafari = /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

// Scroll to an absolute offset (positive distance from right edge).
// Handles animated vs instant, derives currentPage, reports to RN.
function scrollToOffset(offset: number): void {
  const cW = state.columnWidth;
  const maxScroll = (state.totalPages - 1) * cW;
  offset = Math.max(0, Math.min(offset, maxScroll));
  animTargetScroll = offset;

  state.currentPage = Math.round(offset / cW) + 1;
  state.currentPage = Math.max(1, Math.min(state.currentPage, state.totalPages));

  if (state.pageAnimations) {
    // JS animation for all browsers — Safari's scrollend doesn't fire on
    // overflow:hidden elements, so native smooth scroll breaks prefetch.
    const startScroll = -state.pageEl!.scrollLeft;
    const distance = offset - startScroll;
    const steps = isSafari ? 14 : 12;
    let step = 0;
    function tick() {
      step++;
      const t = step / steps;
      const ease = 1 - (1 - t) * (1 - t);
      state.pageEl!.scrollLeft = -(startScroll + distance * ease);
      if (step < steps) {
        animTimer = setTimeout(tick, 16);
      } else {
        animTimer = null;
        state.pageEl!.scrollLeft = -offset;
        updatePageInfo();
        reportScroll();
        reportPageRendered();
      }
    }
    animTimer = setTimeout(tick, 16);
    updatePageInfo();
  } else {
    state.pageEl!.scrollLeft = -offset;
    updatePageInfo();
    reportScroll();
    reportPageRendered();
  }
}

// Page turns: scroll-relative (+-columnWidth from current scrollLeft).
// Clears canonicalCharOffset — after a page turn, MFVC becomes the new anchor.
function cancelPageAnimation(): void {
  if (animTimer !== null) {
    clearTimeout(animTimer);
    animTimer = null;
    state.pageEl!.scrollLeft = -animTargetScroll;
  }
}

export function nextPage(): void {
  cancelPageAnimation();
  state.canonicalCharOffset = -1;
  const cW = state.columnWidth;
  const maxScroll = (state.totalPages - 1) * cW;
  const target = Math.min(-state.pageEl!.scrollLeft + cW, maxScroll);
  scrollToOffset(target);
}

export function prevPage(): void {
  cancelPageAnimation();
  state.canonicalCharOffset = -1;
  const cW = state.columnWidth;
  const raw = -state.pageEl!.scrollLeft - cW;
  if (raw < 0) {
    // Grid doesn't reach offset 0 — pad the beginning so it does
    padBeginToGrid(-raw);
  }
  const target = Math.max(-state.pageEl!.scrollLeft - cW, 0);
  scrollToOffset(target);
}

// During drag-select near left edge: scroll forward to reveal next column.
// Uses actual scrollLeft as base, stores pre-shift position.
export function expandPageForHighlight(): boolean {
  const fontSize = parseFloat(getComputedStyle(state.contentEl!).fontSize);
  const lineW =
    parseFloat(getComputedStyle(state.contentEl!).lineHeight) || Math.round(fontSize * 1.5);
  const cW = state.columnWidth;
  const maxScroll = (state.totalPages - 1) * cW;
  if (Date.now() - state.lastShiftTime < 200) return false;
  if (state.shiftOffset >= cW) return false;
  if (state.shiftOffset === 0) {
    state.preShiftScroll = -state.pageEl!.scrollLeft;
  }
  const currentOffset = -state.pageEl!.scrollLeft;
  const newOffset = Math.min(currentOffset + lineW, maxScroll);
  if (newOffset === currentOffset) return false;
  state.shiftOffset += newOffset - currentOffset;
  state.lastShiftTime = Date.now();
  state.pageEl!.scrollTo({ left: -newOffset, behavior: "smooth" });
  return true;
}

// During drag-select near right edge: scroll backward to reveal previous column.
export function contractPageForHighlight(): boolean {
  const fontSize = parseFloat(getComputedStyle(state.contentEl!).fontSize);
  const lineW =
    parseFloat(getComputedStyle(state.contentEl!).lineHeight) || Math.round(fontSize * 1.5);
  const cW = state.columnWidth;
  if (Date.now() - state.lastShiftTime < 200) return false;
  if (state.shiftOffset <= -cW) return false;
  if (state.shiftOffset === 0) {
    state.preShiftScroll = -state.pageEl!.scrollLeft;
  }
  const currentOffset = -state.pageEl!.scrollLeft;
  const newOffset = Math.max(currentOffset - lineW, 0);
  if (newOffset === currentOffset) return false;
  state.shiftOffset -= currentOffset - newOffset;
  state.lastShiftTime = Date.now();
  state.pageEl!.scrollTo({ left: -newOffset, behavior: "smooth" });
  return true;
}

// Animate back to pre-shift position after selection ends.
export function animateResetShift(): void {
  if (state.shiftOffset === 0) return;
  const target = state.preShiftScroll;
  state.shiftOffset = 0;
  const current = -state.pageEl!.scrollLeft;
  const distance = current - target;
  const steps = 8;
  let step = 0;
  function tick() {
    step++;
    const t = step / steps;
    const ease = 1 - (1 - t) * (1 - t);
    state.pageEl!.scrollLeft = -(current - distance * ease);
    if (step < steps) {
      setTimeout(tick, 16);
    } else {
      state.pageEl!.scrollLeft = -target;
      state.preShiftScroll = 0;
    }
  }
  setTimeout(tick, 16);
}

// Immediately reset shift (safety net for new gestures).
export function resetPageShift(): void {
  if (state.shiftOffset === 0) return;
  state.pageEl!.scrollLeft = -state.preShiftScroll;
  state.shiftOffset = 0;
  state.preShiftScroll = 0;
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

// Prepend content for backward navigation.
// Adjusts scrollLeft by the exact prepend width to keep content stable.
export function prependBackSlice(html: string, charCount?: number): void {
  // Remove spacers before measuring — they'll be re-added after
  removeSpacers();
  const prevScrollWidth = state.pageEl!.scrollWidth;
  const prevScrollLeft = state.pageEl!.scrollLeft;

  // Prepend HTML to #page
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const frag = document.createDocumentFragment();
  while (temp.firstChild) frag.appendChild(temp.firstChild);
  state.pageEl!.insertBefore(frag, state.pageEl!.firstChild);

  // Compensate scrollLeft for the added width
  const newContentWidth = state.pageEl!.scrollWidth - prevScrollWidth;
  state.pageEl!.scrollLeft = prevScrollLeft - newContentWidth;

  // Update slice tracking
  if (charCount != null) state.sliceCharOffset -= charCount;
  state.totalPrependWidth += newContentWidth;

  // Recalculate pagination
  state.totalPages = Math.max(1, ceilPages(state.pageEl!.scrollWidth, state.columnWidth));
  padEndToGrid();
  state.currentPage = Math.round(-state.pageEl!.scrollLeft / state.columnWidth) + 1;
  state.currentPage = Math.max(1, Math.min(state.currentPage, state.totalPages));
  updatePageInfo();
  reportPageRendered();

  window.ReactNativeWebView.postMessage(JSON.stringify({ type: "backPrefetchDone" }));
}
