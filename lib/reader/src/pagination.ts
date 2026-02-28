import { state } from "./state";

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

function updatePageInfo(): void {
  state.pageNumEl!.textContent = state.currentPage + " / " + state.totalPages;
  state.btnNext!.disabled = state.currentPage >= state.totalPages;
  state.btnPrev!.disabled = state.currentPage <= 1;
}

// Navigation
export function goToPage(page: number): void {
  page = Math.max(1, Math.min(page, state.totalPages));
  state.currentPage = page;
  state.pageEl!.scrollLeft = -((page - 1) * state.columnWidth);
  updatePageInfo();
  reportScroll();
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
  state.pageEl!.scrollLeft = -(base + state.shiftOffset);
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
  const pos = state.totalPages > 1 ? (state.currentPage - 1) / (state.totalPages - 1) : 0;
  window.ReactNativeWebView.postMessage(
    JSON.stringify({
      type: "scroll",
      position: pos,
    }),
  );
}
