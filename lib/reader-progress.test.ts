import { describe, expect, it } from "vitest";
import { getReaderProgressFlushMode } from "./reader-progress";

describe("getReaderProgressFlushMode", () => {
  it("skips the initial restored scroll event", () => {
    expect(
      getReaderProgressFlushMode({
        initialScrollHandled: false,
        isLastPage: false,
        lastPersistedReadComplete: false,
      }),
    ).toBe("skip");
  });

  it("schedules a normal flush for regular page changes", () => {
    expect(
      getReaderProgressFlushMode({
        initialScrollHandled: true,
        isLastPage: false,
        lastPersistedReadComplete: false,
      }),
    ).toBe("schedule");
  });

  it("flushes immediately when the reader first reaches completion", () => {
    expect(
      getReaderProgressFlushMode({
        initialScrollHandled: true,
        isLastPage: true,
        lastPersistedReadComplete: false,
      }),
    ).toBe("immediate");
  });

  it("schedules instead of forcing immediate flush after completion was already persisted", () => {
    expect(
      getReaderProgressFlushMode({
        initialScrollHandled: true,
        isLastPage: true,
        lastPersistedReadComplete: true,
      }),
    ).toBe("schedule");
  });
});
