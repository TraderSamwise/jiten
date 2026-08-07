import { describe, test, expect } from "vitest";

import { applyFlickPendingOverride, evaluateTypingInput } from "./typing-core";
import type { CharStatus } from "./typing-utils";

const base = {
  target: "たべる",
  acceptedReadings: ["たべる", "食べる"],
  isKanaInput: false,
};

describe("evaluateTypingInput", () => {
  test("marks a fully typed reading correct", () => {
    const result = evaluateTypingInput({ ...base, raw: "taberu" });
    expect(result.converted).toBe("たべる");
    expect(result.isCorrect).toBe(true);
    expect(result.overrun).toBe(false);
  });

  test("accepts the raw kanji form typed directly", () => {
    const result = evaluateTypingInput({ ...base, raw: "食べる" });
    expect(result.isCorrect).toBe(true);
  });

  test("matches the pre-conversion raw text when conversion would miss it", () => {
    const result = evaluateTypingInput({
      target: "たべる",
      acceptedReadings: ["taberu"],
      isKanaInput: false,
      raw: "taberu",
    });
    expect(result.converted).toBe("たべる");
    expect(result.isCorrect).toBe(true);
  });

  test("partial input is neither correct nor overrun", () => {
    const result = evaluateTypingInput({ ...base, raw: "tabe" });
    expect(result.converted).toBe("たべ");
    expect(result.isCorrect).toBe(false);
    expect(result.overrun).toBe(false);
    expect(result.statuses).toEqual<CharStatus[]>(["correct", "correct", "untyped"]);
  });

  test("wrong answer of target length is overrun", () => {
    const result = evaluateTypingInput({ ...base, raw: "tabemi" });
    expect(result.converted).toBe("たべみ");
    expect(result.isCorrect).toBe(false);
    expect(result.overrun).toBe(true);
  });

  test("a correct answer at full length on a kana keyboard is correct, not overrun", () => {
    const result = evaluateTypingInput({
      target: "かばん",
      acceptedReadings: ["かばん"],
      isKanaInput: true,
      raw: "かばん",
    });
    expect(result.isCorrect).toBe(true);
    expect(result.overrun).toBe(false);
  });

  test("only kana count toward overrun, so a long ASCII-laden string can still be short", () => {
    const result = evaluateTypingInput({ ...base, raw: "tabxe" });
    const kanaCount = [...result.converted].filter(
      (ch) => ch.charCodeAt(0) >= 0x3040 && ch.charCodeAt(0) <= 0x30ff,
    ).length;
    expect(result.converted.length).toBeGreaterThan(kanaCount);
    expect(kanaCount).toBeLessThan(3);
    expect(result.overrun).toBe(false);
  });

  test("trailing unconverted romaji does not count toward overrun", () => {
    const result = evaluateTypingInput({ ...base, raw: "taber" });
    expect(result.converted).toBe("たべr");
    expect(result.overrun).toBe(false);
    expect(result.statuses[2]).toBe<CharStatus>("pending");
  });

  test("a settled wrong kana overruns, but its flick intermediate does not", () => {
    const result = evaluateTypingInput({
      target: "かばん",
      acceptedReadings: ["かばん"],
      isKanaInput: true,
      raw: "かはん",
    });
    expect(result.flickPending).toBe(false);
    expect(result.overrun).toBe(true);

    const midFlick = evaluateTypingInput({
      target: "かばん",
      acceptedReadings: ["かばん"],
      isKanaInput: true,
      raw: "かは",
    });
    expect(midFlick.flickPending).toBe(true);
    expect(midFlick.overrun).toBe(false);
    expect(midFlick.statuses[1]).toBe<CharStatus>("pending");
  });

  test("flick transitions are ignored on a romaji keyboard", () => {
    const result = evaluateTypingInput({
      target: "かばん",
      acceptedReadings: ["かばん"],
      isKanaInput: false,
      raw: "かは",
    });
    expect(result.flickPending).toBe(false);
    expect(result.statuses[1]).toBe<CharStatus>("wrong");
  });

  test("empty target never reports overrun", () => {
    const result = evaluateTypingInput({
      target: "",
      acceptedReadings: [],
      isKanaInput: false,
      raw: "あいう",
    });
    expect(result.overrun).toBe(false);
    expect(result.isCorrect).toBe(false);
  });

  test("empty input is inert", () => {
    const result = evaluateTypingInput({ ...base, raw: "" });
    expect(result.converted).toBe("");
    expect(result.isCorrect).toBe(false);
    expect(result.overrun).toBe(false);
    expect(result.flickPending).toBe(false);
  });
});

describe("applyFlickPendingOverride", () => {
  test("rewrites only the trailing wrong char", () => {
    const statuses: CharStatus[] = ["correct", "wrong", "untyped"];
    expect(applyFlickPendingOverride(statuses, "かは", true)).toEqual<CharStatus[]>([
      "correct",
      "pending",
      "untyped",
    ]);
  });

  test("returns the input untouched when not flick-pending", () => {
    const statuses: CharStatus[] = ["correct", "wrong"];
    expect(applyFlickPendingOverride(statuses, "かは", false)).toBe(statuses);
  });

  test("leaves a correct trailing char alone", () => {
    const statuses: CharStatus[] = ["correct", "correct"];
    expect(applyFlickPendingOverride(statuses, "かば", true)).toBe(statuses);
  });

  test("handles empty statuses", () => {
    expect(applyFlickPendingOverride([], "", true)).toEqual([]);
  });
});
