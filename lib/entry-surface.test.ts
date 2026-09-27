import { describe, expect, test } from "vitest";
import { displayKanjiForSurface } from "./entry-surface";

const forms = (...texts: string[]) => texts.map((text) => ({ text }));

describe("displayKanjiForSurface", () => {
  test("shows the spelling the reader tapped, not the entry's first one", () => {
    expect(displayKanjiForSurface(forms("長い", "永い"), "永かった")).toBe("永い");
    expect(displayKanjiForSurface(forms("長い", "永い"), "長かった")).toBe("長い");
  });

  test("works on the dictionary form itself", () => {
    expect(displayKanjiForSurface(forms("長い", "永い"), "永い")).toBe("永い");
  });

  test("picks the longest agreement, not merely the first that matches", () => {
    expect(displayKanjiForSurface(forms("止まる", "留まる", "停まる"), "留まらず")).toBe("留まる");
    expect(displayKanjiForSurface(forms("止まる", "留まる", "停まる"), "止まらず")).toBe("止まる");
  });

  test("keeps the dictionary's order when the surface shares nothing", () => {
    expect(displayKanjiForSurface(forms("長い", "永い"), "ながかった")).toBe("長い");
    expect(displayKanjiForSurface(forms("長い", "永い"), "")).toBe("長い");
    expect(displayKanjiForSurface(forms("長い", "永い"), null)).toBe("長い");
  });

  test("leaves a single-spelling entry alone", () => {
    expect(displayKanjiForSurface(forms("一種"), "一種")).toBe("一種");
    expect(displayKanjiForSurface(forms("一種"), "べつのことば")).toBe("一種");
  });

  test("returns nothing for a kana-only entry", () => {
    expect(displayKanjiForSurface([], "ひらがな")).toBeUndefined();
  });
});
