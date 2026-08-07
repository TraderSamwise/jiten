import { beforeEach, describe, expect, test } from "vitest";

import {
  hasNavigatedThisSession,
  markSessionNavigated,
  resetSessionNavigation,
} from "./session-navigation";

beforeEach(() => {
  resetSessionNavigation();
});

describe("session navigation", () => {
  test("a fresh session has not navigated — the app opening onto a screen isn't a return", () => {
    expect(hasNavigatedThisSession()).toBe(false);
  });

  test("stays true once marked, so every later visit counts as a return", () => {
    markSessionNavigated();
    expect(hasNavigatedThisSession()).toBe(true);
    markSessionNavigated();
    expect(hasNavigatedThisSession()).toBe(true);
  });
});

describe("dictionary focus decision", () => {
  // Mirrors DictionaryHeader: read first, then mark, so the focus that opened the
  // app is a non-return while the next one is a return.
  function visit(): boolean {
    const isReturnVisit = hasNavigatedThisSession();
    markSessionNavigated();
    return isReturnVisit;
  }

  test("cold start onto the dictionary does not focus, returning to it does", () => {
    expect(visit()).toBe(false);
    expect(visit()).toBe(true);
  });

  test("a cold start deeper in the stack makes the trip back to the index a return", () => {
    // e.g. a deep link straight to a word: that screen's focus marks the session
    visit();
    expect(visit()).toBe(true);
  });

  test("arriving from another tab focuses, because the tab press marked the session", () => {
    markSessionNavigated();
    expect(visit()).toBe(true);
  });
});
