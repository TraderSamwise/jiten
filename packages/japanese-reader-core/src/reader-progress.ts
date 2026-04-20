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
