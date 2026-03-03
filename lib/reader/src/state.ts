export const state = {
  currentPage: 1,
  totalPages: 1,
  columnWidth: 0,
  lastTapNode: null as Node | null,
  lastTapOffset: 0,
  lastTapAbsOffset: 0,
  swipeHandled: false,
  suppressClick: false,
  dragMode: "idle" as "idle" | "undecided" | "swiping" | "selecting",

  // Highlight-scroll: extra shift when dragging near page edge
  shiftOffset: 0,
  lastShiftTime: 0,

  // DOM element refs — set during init
  contentEl: null as HTMLElement | null,
  pageEl: null as HTMLElement | null,
  pageNumEl: null as HTMLElement | null,
  btnNext: null as HTMLButtonElement | null,
  btnPrev: null as HTMLButtonElement | null,

  controlsH: 44,

  // Virtual pagination: offset so WebView reports global page numbers
  pageOffset: 0, // 0-based: local page 1 = global page (pageOffset + 1)
  overrideTotalPages: 0, // if >0, use this instead of measured totalPages for display/scroll

  // Backward prepend tracking
  totalPrependWidth: 0, // accumulated width of all backward prepends (no spacer)
  prependedPages: 0, // total pages occupied by prepends + spacer
};
