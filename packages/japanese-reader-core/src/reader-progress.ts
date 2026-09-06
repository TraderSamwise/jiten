export type ReaderProgressFlushMode = "skip" | "schedule" | "immediate";

export function getReaderProgressFlushMode(options: {
  initialScrollHandled: boolean;
  isLastPage: boolean;
  lastPersistedReadComplete: boolean;
}): ReaderProgressFlushMode {
  if (!options.initialScrollHandled) return "skip";
  if (options.isLastPage && !options.lastPersistedReadComplete) return "immediate";
  return "schedule";
}

// The webview only paginates the slice it holds, so its "last page" means the
// end of that window. A book is finished only when the window also reaches the
// end of the book — otherwise a degenerate measurement persists read_complete.
export function isBookFinished(options: {
  isLastPageOfWindow: boolean;
  loadedEndChar: number;
  totalChars: number;
}): boolean {
  if (!options.isLastPageOfWindow) return false;
  if (options.totalChars <= 0) return true;
  return options.loadedEndChar >= options.totalChars;
}
