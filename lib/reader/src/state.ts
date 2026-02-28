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
};
