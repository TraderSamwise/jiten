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
  preShiftScroll: 0, // scrollLeft before highlight shift, as positive offset

  // DOM element refs — set during init
  contentEl: null as HTMLElement | null,
  pageEl: null as HTMLElement | null,
  pageNumEl: null as HTMLElement | null,
  btnNext: null as HTMLButtonElement | null,
  btnPrev: null as HTMLButtonElement | null,

  controlsH: 44,

  // Char-offset tracking for percentage display
  sliceCharOffset: 0, // global char index of first char in WebView
  totalChars: 0, // total chars in book (for percentage)

  // Backward prepend tracking
  totalPrependWidth: 0, // accumulated width of all backward prepends (no spacer)
  prependedPages: 0, // total pages occupied by prepends + spacer

  // Global char offset from DB, preserved until user navigates to a new page.
  // Prevents drift: spacer/prepend shift column boundaries, but we save this
  // stable value instead of MFVC until the user explicitly moves.
  canonicalCharOffset: -1,

  // Page animation setting
  pageAnimations: true,
};
