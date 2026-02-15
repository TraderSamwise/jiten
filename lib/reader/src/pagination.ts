import { state } from "./state";

declare const window: Window & {
  __READER_CONFIG__: { scrollPosition: number };
  ReactNativeWebView: { postMessage(msg: string): void };
};

// Compute the translateX value for the current page's scroll offset (multi-page blocks).
function getPageScrollTransform(): string {
  const p = state.pages[state.currentPage - 1];
  if (!p || !p.scrollOffset) return "";
  const cs = getComputedStyle(state.contentEl!);
  const cW =
    state.contentEl!.clientWidth -
    (parseFloat(cs.paddingLeft) || 0) -
    (parseFloat(cs.paddingRight) || 0);
  return "translateX(" + p.scrollOffset * cW + "px)";
}

// Parse blocks from raw content
export function parseBlocks(): void {
  const children = state.rawEl!.children;
  state.blockHtmls = [];
  for (let i = 0; i < children.length; i++) {
    state.blockHtmls.push(children[i].outerHTML);
  }
  state.rawEl!.parentNode!.removeChild(state.rawEl!);
}

// Responsive sizing
export function updateSizing(): void {
  const h = document.documentElement.clientHeight - state.controlsH;
  const w = document.documentElement.clientWidth;
  if (h > 0) {
    state.contentEl!.style.height = h + "px";
  }
  if (w > 0) {
    state.contentEl!.style.width = w + "px";
  }
}

// Pagination: measure which blocks fit per page
export function paginate(): void {
  state.pages = [];
  if (state.blockHtmls.length === 0) {
    state.pages = [{ start: 0, end: 0 }];
    state.totalPages = 1;
    return;
  }

  const measure = document.createElement("div");
  const cs = window.getComputedStyle(state.contentEl!);
  measure.style.writingMode = cs.writingMode;
  measure.style.fontFamily = cs.fontFamily;
  measure.style.fontSize = cs.fontSize;
  measure.style.lineHeight = cs.lineHeight;
  measure.style.padding = cs.padding;
  measure.style.width = state.contentEl!.clientWidth + "px";
  measure.style.height = state.contentEl!.clientHeight + "px";
  measure.style.overflow = "hidden";
  var padL = parseFloat(cs.paddingLeft) || 0;
  var padR = parseFloat(cs.paddingRight) || 0;
  var contentW = state.contentEl!.clientWidth - padL - padR;
  measure.style.visibility = "hidden";
  measure.style.position = "absolute";
  measure.style.left = "-9999px";
  document.body.appendChild(measure);

  let pageStart = 0;
  for (let i = 0; i < state.blockHtmls.length; i++) {
    measure.insertAdjacentHTML("beforeend", state.blockHtmls[i]);
    if (measure.scrollWidth > measure.clientWidth) {
      // This block caused overflow
      if (i === pageStart) {
        // Single block overflows — split across scrolled pages
        var np = 1 + Math.ceil((measure.scrollWidth - measure.clientWidth) / contentW);
        for (var pi = 0; pi < np; pi++) {
          state.pages.push({ start: pageStart, end: i, scrollOffset: pi });
        }
        pageStart = i + 1;
        measure.innerHTML = "";
      } else {
        // Previous blocks fit, this one doesn't
        state.pages.push({ start: pageStart, end: i - 1 });
        pageStart = i;
        measure.innerHTML = state.blockHtmls[i];
        // Check if this single block also overflows on its own
        if (measure.scrollWidth > measure.clientWidth) {
          var np2 = 1 + Math.ceil((measure.scrollWidth - measure.clientWidth) / contentW);
          for (var pi2 = 0; pi2 < np2; pi2++) {
            state.pages.push({ start: i, end: i, scrollOffset: pi2 });
          }
          pageStart = i + 1;
          measure.innerHTML = "";
        }
      }
    }
  }
  // Remaining blocks form the last page
  if (pageStart < state.blockHtmls.length) {
    state.pages.push({ start: pageStart, end: state.blockHtmls.length - 1 });
  }

  document.body.removeChild(measure);
  state.totalPages = state.pages.length;
}

// Render a specific page
export function renderPage(pageNum: number): void {
  if (pageNum < 1 || pageNum > state.totalPages) return;
  const p = state.pages[pageNum - 1];
  let html = "";
  for (let i = p.start; i <= p.end; i++) {
    html += state.blockHtmls[i];
  }
  state.pageEl!.innerHTML = html;

  // Apply scroll transform for multi-page blocks
  state.pageEl!.style.transform = getPageScrollTransform();

  // Buffer: previous page's last 2 blocks
  if (pageNum > 1) {
    const prev = state.pages[pageNum - 2];
    const bufStart = Math.max(prev.start, prev.end - 1);
    let bufHtml = "";
    for (let i = bufStart; i <= prev.end; i++) {
      bufHtml += state.blockHtmls[i];
    }
    state.bufPrevEl!.innerHTML = bufHtml;
  } else {
    state.bufPrevEl!.innerHTML = "";
  }

  // Buffer: next page's first 2 blocks
  if (pageNum < state.totalPages) {
    const next = state.pages[pageNum];
    const bufEnd = Math.min(next.end, next.start + 1);
    let bufHtml = "";
    for (let i = next.start; i <= bufEnd; i++) {
      bufHtml += state.blockHtmls[i];
    }
    state.bufNextEl!.innerHTML = bufHtml;
  } else {
    state.bufNextEl!.innerHTML = "";
  }

  updatePageInfo();
  reportScroll();
}

// Page info display
function updatePageInfo(): void {
  state.pageNumEl!.textContent = state.currentPage + " / " + state.totalPages;
  state.btnNext!.disabled = state.currentPage >= state.totalPages;
  state.btnPrev!.disabled = state.currentPage <= 1;
}

// Navigation
export function goToPage(page: number): void {
  page = Math.max(1, Math.min(page, state.totalPages));
  state.currentPage = page;
  renderPage(state.currentPage);
}

export function nextPage(): void {
  goToPage(state.currentPage + 1);
}

export function prevPage(): void {
  goToPage(state.currentPage - 1);
}

// Append one more block from the next page and shift content right by one column,
// so the user can continue highlighting across the page boundary.
export function expandPageForHighlight(): boolean {
  const now = Date.now();
  if (now - state.lastShiftTime < 300) return false;

  const page = state.pages[state.currentPage - 1];
  if (page.scrollOffset) return false; // No expansion on continuation pages
  const nextIdx = page.end + 1 + state.extraBlocks;
  if (nextIdx >= state.blockHtmls.length) return false;

  state.pageEl!.insertAdjacentHTML("beforeend", state.blockHtmls[nextIdx]);
  state.extraBlocks++;

  const fontSize = parseFloat(getComputedStyle(state.contentEl!).fontSize);
  const colWidth = fontSize * 1.5; // line-height is 1.5
  state.shiftOffset += colWidth;
  state.lastShiftTime = now;

  state.pageEl!.style.transition = "transform 0.25s ease-out";
  state.pageEl!.style.transform = "translateX(" + state.shiftOffset + "px)";
  return true;
}

let shiftResetTimeout: ReturnType<typeof setTimeout> | null = null;

// Animate back to normal page position after a highlight-scroll selection ends.
// Preserves highlight spans on the original page content.
export function animateResetShift(): void {
  if (state.extraBlocks === 0) return;

  const extraCount = state.extraBlocks;
  state.extraBlocks = 0;
  state.shiftOffset = 0;

  state.pageEl!.style.transition = "transform 0.25s ease-out";
  state.pageEl!.style.transform = "translateX(0)";

  shiftResetTimeout = setTimeout(function () {
    shiftResetTimeout = null;
    state.pageEl!.style.transition = "";
    state.pageEl!.style.transform = getPageScrollTransform();
    // Remove only the extra appended blocks, preserving highlights in original content
    for (let i = 0; i < extraCount; i++) {
      if (state.pageEl!.lastChild) {
        state.pageEl!.removeChild(state.pageEl!.lastChild);
      }
    }
  }, 260);
}

// Immediately reset any highlight-scroll shift (safety net for new gestures).
export function resetPageShift(): void {
  if (state.extraBlocks === 0 && !shiftResetTimeout) return;

  if (shiftResetTimeout) {
    clearTimeout(shiftResetTimeout);
    shiftResetTimeout = null;
  }

  state.extraBlocks = 0;
  state.shiftOffset = 0;
  state.pageEl!.style.transition = "";
  state.pageEl!.style.transform = getPageScrollTransform();

  // Re-render just #page to remove extra blocks
  const p = state.pages[state.currentPage - 1];
  let html = "";
  for (let i = p.start; i <= p.end; i++) {
    html += state.blockHtmls[i];
  }
  state.pageEl!.innerHTML = html;
}

export function reportScroll(): void {
  const pos = state.totalPages > 1 ? (state.currentPage - 1) / (state.totalPages - 1) : 0;
  window.ReactNativeWebView.postMessage(
    JSON.stringify({
      type: "scroll",
      position: pos,
    }),
  );
}
