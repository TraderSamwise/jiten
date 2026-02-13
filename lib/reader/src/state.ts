export const state = {
  blockHtmls: [] as string[],
  pages: [] as { start: number; end: number }[],
  currentPage: 1,
  totalPages: 1,
  lastTapNode: null as Node | null,
  lastTapOffset: 0,
  lastTapAbsOffset: 0,
  swipeHandled: false,
  suppressClick: false,
  dragMode: "idle" as "idle" | "undecided" | "swiping" | "selecting",

  // DOM element refs — set during init
  rawEl: null as HTMLElement | null,
  contentEl: null as HTMLElement | null,
  pageEl: null as HTMLElement | null,
  bufPrevEl: null as HTMLElement | null,
  bufNextEl: null as HTMLElement | null,
  pageNumEl: null as HTMLElement | null,
  btnNext: null as HTMLButtonElement | null,
  btnPrev: null as HTMLButtonElement | null,

  controlsH: 44,
};
