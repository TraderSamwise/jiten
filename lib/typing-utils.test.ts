import { describe, test, expect } from "vitest";
import {
  romajiToKana,
  norm,
  toHira,
  getTargetReading,
  getDisplayText,
  getEnglishGloss,
  compareChars,
  isReadingComplete,
  isValidPrefix,
  getKanjiColor,
  type CharStatus,
} from "./typing-utils";
import type { DictEntry } from "@/db/types";

// ─── Test helpers ───

function makeEntry(opts: { kanji?: string[]; kana: string[]; glosses?: string[] }): DictEntry {
  return {
    id: 1,
    common: true,
    kanji: (opts.kanji ?? []).map((text) => ({ text, common: true, tags: [] })),
    kana: opts.kana.map((text) => ({ text, romaji: null, common: true, tags: [] })),
    senses:
      opts.glosses && opts.glosses.length > 0
        ? [
            {
              partOfSpeech: [],
              glosses: opts.glosses.map((text) => ({ lang: "eng", text })),
              field: null,
              misc: null,
              info: null,
            },
          ]
        : [],
    pitchAccents: [],
  };
}

// ─── romajiToKana ───

describe("romajiToKana", () => {
  test("converts basic romaji to hiragana", () => {
    expect(romajiToKana("ka")).toBe("か");
    expect(romajiToKana("sushi")).toBe("すし");
    expect(romajiToKana("tokyo")).toBe("ときょ");
  });

  test("IME mode: trailing consonant stays as ASCII", () => {
    expect(romajiToKana("k")).toBe("k");
    expect(romajiToKana("sh")).toBe("sh");
    expect(romajiToKana("suk")).toBe("すk");
  });

  test("double consonant: stays ASCII until mora completes", () => {
    // Incomplete double consonant stays as ASCII in IME mode
    expect(romajiToKana("kk")).toBe("kk");
    expect(romajiToKana("kitt")).toBe("きtt");
    // Complete mora triggers っ conversion
    expect(romajiToKana("cchi")).toBe("っち");
    expect(romajiToKana("tta")).toBe("った");
    expect(romajiToKana("kitte")).toBe("きって");
  });
});

// ─── toHira ───

describe("toHira", () => {
  test("converts katakana to hiragana", () => {
    expect(toHira("カタカナ")).toBe("かたかな");
    expect(toHira("ア")).toBe("あ");
    expect(toHira("ン")).toBe("ん");
  });

  test("leaves hiragana unchanged", () => {
    expect(toHira("ひらがな")).toBe("ひらがな");
  });

  test("handles mixed kana", () => {
    expect(toHira("ひらカナ")).toBe("ひらかな");
  });

  test("leaves non-kana characters unchanged", () => {
    expect(toHira("abc123")).toBe("abc123");
    expect(toHira("漢字")).toBe("漢字");
  });
});

// ─── norm ───

describe("norm", () => {
  test("NFC normalizes composed/decomposed forms", () => {
    // が (U+304C) vs か + ゙ (U+304B U+3099)
    const composed = "\u304C"; // が
    const decomposed = "\u304B\u3099"; // か + combining dakuten
    expect(norm(composed)).toBe(norm(decomposed));
  });
});

// ─── getTargetReading / getDisplayText / getEnglishGloss ───

describe("getTargetReading", () => {
  test("returns first kana reading", () => {
    const entry = makeEntry({ kanji: ["食べる"], kana: ["たべる", "タベル"] });
    expect(getTargetReading(entry)).toBe("たべる");
  });

  test("returns empty string for entry with no kana", () => {
    const entry = makeEntry({ kana: [] });
    expect(getTargetReading(entry)).toBe("");
  });
});

describe("getDisplayText", () => {
  test("returns first kanji when available", () => {
    const entry = makeEntry({ kanji: ["食べる"], kana: ["たべる"] });
    expect(getDisplayText(entry)).toBe("食べる");
  });

  test("falls back to kana when no kanji", () => {
    const entry = makeEntry({ kana: ["すし"] });
    expect(getDisplayText(entry)).toBe("すし");
  });
});

describe("getEnglishGloss", () => {
  test("returns first English gloss", () => {
    const entry = makeEntry({ kana: ["ねこ"], glosses: ["cat", "feline"] });
    expect(getEnglishGloss(entry)).toBe("cat");
  });

  test("returns empty string when no senses", () => {
    const entry = makeEntry({ kana: ["ねこ"] });
    expect(getEnglishGloss(entry)).toBe("");
  });
});

// ─── compareChars ───

describe("compareChars", () => {
  test("empty typed → all untyped", () => {
    expect(compareChars("", "ひらて")).toEqual(["untyped", "untyped", "untyped"]);
  });

  test("exact match → all correct", () => {
    expect(compareChars("ひらて", "ひらて")).toEqual(["correct", "correct", "correct"]);
  });

  test("partial correct → correct + untyped", () => {
    expect(compareChars("ひら", "ひらて")).toEqual(["correct", "correct", "untyped"]);
  });

  test("wrong character → wrong", () => {
    expect(compareChars("ひか", "ひらて")).toEqual(["correct", "wrong", "untyped"]);
  });

  test("all wrong → wrong + untyped", () => {
    expect(compareChars("か", "ひらて")).toEqual(["wrong", "untyped", "untyped"]);
  });

  test("over-typed → extra chars are wrong", () => {
    expect(compareChars("ひらてん", "ひらて")).toEqual(["correct", "correct", "correct", "wrong"]);
  });

  // ─── Trailing ASCII (pending romaji) ───

  test("trailing ASCII with correct kana prefix → pending", () => {
    // "ひr" = typed "hir" for target "ひらて"
    expect(compareChars("ひr", "ひらて")).toEqual(["correct", "pending", "untyped"]);
  });

  test("trailing ASCII at start → pending", () => {
    // "h" = just started typing, nothing converted yet
    expect(compareChars("h", "ひらて")).toEqual(["pending", "untyped", "untyped"]);
  });

  test("multiple trailing ASCII chars → all pending", () => {
    // "ひsh" typed = 3 chars, target "ひして" = 3 chars → no untyped
    expect(compareChars("ひsh", "ひして")).toEqual(["correct", "pending", "pending"]);
  });

  test("trailing ASCII after wrong kana → wrong (not pending)", () => {
    // "かr" for target "ひらて" — か is wrong, so trailing r is wrong too
    expect(compareChars("かr", "ひらて")).toEqual(["wrong", "wrong", "untyped"]);
  });

  // ─── Geminate consonants (っ) ───

  describe("geminate consonants", () => {
    test("single 'c' for っち target → pending (not wrong)", () => {
      // User types "ic" for いっちてん → wanakana: "いc"
      expect(compareChars("いc", "いっちてん")).toEqual([
        "correct",
        "pending",
        "untyped",
        "untyped",
        "untyped",
      ]);
    });

    test("'っc' for っち target → correct + pending", () => {
      // User types "icc" → wanakana: "いっc"
      expect(compareChars("いっc", "いっちてん")).toEqual([
        "correct",
        "correct",
        "pending",
        "untyped",
        "untyped",
      ]);
    });

    test("single 't' for った target → pending", () => {
      // User types "t" for った → wanakana: "t"
      expect(compareChars("t", "った")).toEqual(["pending", "untyped"]);
    });

    test("'っt' for った target → correct + pending", () => {
      expect(compareChars("っt", "った")).toEqual(["correct", "pending"]);
    });
  });

  // ─── Katakana normalization ───

  describe("katakana normalization", () => {
    test("hiragana typed matches katakana target", () => {
      expect(compareChars("かたかな", "カタカナ")).toEqual([
        "correct",
        "correct",
        "correct",
        "correct",
      ]);
    });

    test("katakana typed matches hiragana target", () => {
      expect(compareChars("カタ", "かたかな")).toEqual([
        "correct",
        "correct",
        "untyped",
        "untyped",
      ]);
    });

    test("partial katakana match", () => {
      expect(compareChars("カ", "カタカナ")).toEqual(["correct", "untyped", "untyped", "untyped"]);
    });
  });
});

// ─── isReadingComplete ───

describe("isReadingComplete", () => {
  test("exact kana match → complete", () => {
    const entry = makeEntry({ kanji: ["食べる"], kana: ["たべる"] });
    expect(isReadingComplete("たべる", entry)).toBe(true);
  });

  test("partial kana → not complete", () => {
    const entry = makeEntry({ kanji: ["食べる"], kana: ["たべる"] });
    expect(isReadingComplete("たべ", entry)).toBe(false);
  });

  test("wrong kana → not complete", () => {
    const entry = makeEntry({ kanji: ["食べる"], kana: ["たべる"] });
    expect(isReadingComplete("たかる", entry)).toBe(false);
  });

  test("matches any kana reading", () => {
    const entry = makeEntry({ kanji: ["明日"], kana: ["あした", "あす"] });
    expect(isReadingComplete("あした", entry)).toBe(true);
    expect(isReadingComplete("あす", entry)).toBe(true);
  });

  test("matches kanji text directly", () => {
    const entry = makeEntry({ kanji: ["食べる"], kana: ["たべる"] });
    expect(isReadingComplete("食べる", entry)).toBe(true);
  });

  // ─── Katakana normalization ───

  test("hiragana typed matches katakana reading", () => {
    const entry = makeEntry({ kana: ["カタカナ"] });
    expect(isReadingComplete("かたかな", entry)).toBe(true);
  });

  test("katakana typed matches hiragana reading", () => {
    const entry = makeEntry({ kanji: ["猫"], kana: ["ねこ"] });
    expect(isReadingComplete("ネコ", entry)).toBe(true);
  });

  test("kana-only entry (no kanji)", () => {
    const entry = makeEntry({ kana: ["すし"] });
    expect(isReadingComplete("すし", entry)).toBe(true);
    expect(isReadingComplete("スシ", entry)).toBe(true);
  });
});

// ─── isValidPrefix ───

describe("isValidPrefix", () => {
  test("empty string → always valid", () => {
    const entry = makeEntry({ kana: ["たべる"] });
    expect(isValidPrefix("", entry)).toBe(true);
  });

  test("correct prefix → valid", () => {
    const entry = makeEntry({ kana: ["たべる"] });
    expect(isValidPrefix("たべ", entry)).toBe(true);
    expect(isValidPrefix("た", entry)).toBe(true);
  });

  test("wrong prefix → invalid", () => {
    const entry = makeEntry({ kana: ["たべる"] });
    expect(isValidPrefix("か", entry)).toBe(false);
  });

  test("full match → valid", () => {
    const entry = makeEntry({ kana: ["たべる"] });
    expect(isValidPrefix("たべる", entry)).toBe(true);
  });

  test("matches any reading's prefix", () => {
    const entry = makeEntry({ kana: ["あした", "あす"] });
    expect(isValidPrefix("あし", entry)).toBe(true);
    expect(isValidPrefix("あす", entry)).toBe(true);
  });

  test("katakana prefix matches hiragana reading", () => {
    const entry = makeEntry({ kana: ["ねこ"] });
    expect(isValidPrefix("ネ", entry)).toBe(true);
  });

  test("hiragana prefix matches katakana reading", () => {
    const entry = makeEntry({ kana: ["カタカナ"] });
    expect(isValidPrefix("かた", entry)).toBe(true);
  });
});

// ─── getKanjiColor ───

describe("getKanjiColor", () => {
  // Helper: get colors for all display chars at once
  function allColors(
    display: string,
    statuses: CharStatus[],
    totalKana: number,
  ): ReturnType<typeof getKanjiColor>[] {
    const chars = [...display];
    return chars.map((_, i) => getKanjiColor(chars, statuses, totalKana, i));
  }

  describe("1:1 mapping (kana-only words)", () => {
    test("no input → all default", () => {
      expect(allColors("ひらて", ["untyped", "untyped", "untyped"], 3)).toEqual([
        "default",
        "default",
        "default",
      ]);
    });

    test("partial correct → green + pending for next + default for rest", () => {
      expect(allColors("ひらて", ["correct", "untyped", "untyped"], 3)).toEqual([
        "green",
        "pending",
        "default",
      ]);
    });

    test("all correct → all green", () => {
      expect(allColors("ひらて", ["correct", "correct", "correct"], 3)).toEqual([
        "green",
        "green",
        "green",
      ]);
    });

    test("wrong char → red at wrong position", () => {
      expect(allColors("ひらて", ["correct", "wrong", "untyped"], 3)).toEqual([
        "green",
        "red",
        "default",
      ]);
    });

    test("pending char → pending at position", () => {
      expect(allColors("ひらて", ["correct", "pending", "untyped"], 3)).toEqual([
        "green",
        "pending",
        "default",
      ]);
    });
  });

  describe("proportional mapping (kanji with more kana)", () => {
    // 平手 (2 kanji) ← ひらて (3 kana)
    // 平: needs ceil(1*3/2)=2 kana, 手: needs ceil(2*3/2)=3 kana

    test("no input → all default", () => {
      expect(allColors("平手", ["untyped", "untyped", "untyped"], 3)).toEqual([
        "default",
        "default",
      ]);
    });

    test("1/3 kana correct → first kanji pending (partially covered)", () => {
      expect(allColors("平手", ["correct", "untyped", "untyped"], 3)).toEqual([
        "pending",
        "default",
      ]);
    });

    test("2/3 kana correct → first kanji green, second pending", () => {
      expect(allColors("平手", ["correct", "correct", "untyped"], 3)).toEqual(["green", "pending"]);
    });

    test("3/3 kana correct → all green", () => {
      expect(allColors("平手", ["correct", "correct", "correct"], 3)).toEqual(["green", "green"]);
    });

    test("wrong at position 1 → first kanji red", () => {
      expect(allColors("平手", ["correct", "wrong", "untyped"], 3)).toEqual(["red", "default"]);
    });

    // 一致点 (3 kanji) ← いっちてん (5 kana)
    // 一: ceil(1*5/3)=2, 致: ceil(2*5/3)=4, 点: ceil(3*5/3)=5

    test("一致点: progressive coloring", () => {
      const display = "一致点";
      // 一: needs ceil(1*5/3)=2 kana, 致: needs ceil(2*5/3)=4, 点: needs ceil(3*5/3)=5
      expect(
        allColors(display, ["correct", "untyped", "untyped", "untyped", "untyped"], 5),
      ).toEqual(["pending", "default", "default"]);
      expect(
        allColors(display, ["correct", "correct", "untyped", "untyped", "untyped"], 5),
      ).toEqual(["green", "pending", "default"]);
      expect(
        allColors(display, ["correct", "correct", "correct", "untyped", "untyped"], 5),
      ).toEqual(["green", "pending", "default"]);
      expect(
        allColors(display, ["correct", "correct", "correct", "correct", "untyped"], 5),
      ).toEqual(["green", "green", "pending"]);
      expect(
        allColors(display, ["correct", "correct", "correct", "correct", "correct"], 5),
      ).toEqual(["green", "green", "green"]);
    });

    test("一致点: wrong kana in second kanji zone", () => {
      expect(allColors("一致点", ["correct", "correct", "wrong", "untyped", "untyped"], 5)).toEqual(
        ["green", "red", "default"],
      );
    });
  });

  describe("equal length (kanji count = kana count)", () => {
    // 漢字 (2 kanji) ← かんじ... wait, that's 3 kana
    // Let's use a simpler case: display "AB" with 2 kana
    test("2 display, 2 kana: 1:1 mapping", () => {
      expect(allColors("漢字", ["correct", "untyped"], 2)).toEqual(["green", "pending"]);
      expect(allColors("漢字", ["correct", "correct"], 2)).toEqual(["green", "green"]);
      expect(allColors("漢字", ["wrong", "untyped"], 2)).toEqual(["default", "default"]);
    });
  });

  describe("single kanji with long reading", () => {
    // 承る (1 kanji+2 okurigana... let's just do 1 display char with 5 kana)
    test("single display char needs all kana", () => {
      const display = "承";
      expect(
        allColors(display, ["correct", "correct", "correct", "untyped", "untyped"], 5),
      ).toEqual(["pending"]);
      expect(
        allColors(display, ["correct", "correct", "correct", "correct", "correct"], 5),
      ).toEqual(["green"]);
    });
  });

  describe("pending trailing ASCII propagation", () => {
    // When trailing ASCII produces "pending" in charStatuses, kanji should show pending too
    test("trailing ASCII pending → kanji pending", () => {
      // "ひr" for ひらて → statuses: [correct, pending, untyped]
      expect(allColors("平手", ["correct", "pending", "untyped"], 3)).toEqual([
        "pending",
        "default",
      ]);
    });
  });
});

// ─── Integration: romajiToKana + compareChars ───

describe("integration: romaji input → char statuses", () => {
  function typingStatuses(romaji: string, target: string): CharStatus[] {
    return compareChars(romajiToKana(romaji), target);
  }

  test("typing 'hirate' for ひらて step by step", () => {
    expect(typingStatuses("", "ひらて")).toEqual(["untyped", "untyped", "untyped"]);
    expect(typingStatuses("h", "ひらて")).toEqual(["pending", "untyped", "untyped"]);
    expect(typingStatuses("hi", "ひらて")).toEqual(["correct", "untyped", "untyped"]);
    expect(typingStatuses("hir", "ひらて")).toEqual(["correct", "pending", "untyped"]);
    expect(typingStatuses("hira", "ひらて")).toEqual(["correct", "correct", "untyped"]);
    expect(typingStatuses("hirat", "ひらて")).toEqual(["correct", "correct", "pending"]);
    expect(typingStatuses("hirate", "ひらて")).toEqual(["correct", "correct", "correct"]);
  });

  test("typing 'icchiten' for いっちてん step by step", () => {
    expect(typingStatuses("i", "いっちてん")).toEqual([
      "correct",
      "untyped",
      "untyped",
      "untyped",
      "untyped",
    ]);
    // "c" should be pending, not wrong (geminate consonant)
    expect(typingStatuses("ic", "いっちてん")).toEqual([
      "correct",
      "pending",
      "untyped",
      "untyped",
      "untyped",
    ]);
    expect(typingStatuses("icchi", "いっちてん")).toEqual([
      "correct",
      "correct",
      "correct",
      "untyped",
      "untyped",
    ]);
  });

  test("typing 'neko' for ネコ (katakana target)", () => {
    expect(typingStatuses("n", "ネコ")).toEqual(["pending", "untyped"]);
    expect(typingStatuses("ne", "ネコ")).toEqual(["correct", "untyped"]);
    expect(typingStatuses("nek", "ネコ")).toEqual(["correct", "pending"]);
    expect(typingStatuses("neko", "ネコ")).toEqual(["correct", "correct"]);
  });

  test("wrong input is detected once kana converts", () => {
    // Typing "ka" when target is "ひ" — か ≠ ひ
    expect(typingStatuses("ka", "ひらて")).toEqual(["wrong", "untyped", "untyped"]);
  });

  test("typing 'kitte' for きって (geminate t)", () => {
    expect(typingStatuses("ki", "きって")).toEqual(["correct", "untyped", "untyped"]);
    // "kit" → "きt" — single trailing ASCII, kana prefix correct → pending
    expect(typingStatuses("kit", "きって")).toEqual(["correct", "pending", "untyped"]);
    // "kitt" → "きtt" — wanakana keeps double consonant as ASCII until mora completes
    expect(typingStatuses("kitt", "きって")).toEqual(["correct", "pending", "pending"]);
    expect(typingStatuses("kitte", "きって")).toEqual(["correct", "correct", "correct"]);
  });

  test("typing 'zasshi' for ざっし (geminate s)", () => {
    expect(typingStatuses("za", "ざっし")).toEqual(["correct", "untyped", "untyped"]);
    expect(typingStatuses("zas", "ざっし")).toEqual(["correct", "pending", "untyped"]);
    // "zass" → "ざss" — stays ASCII until "shi" completes
    expect(typingStatuses("zass", "ざっし")).toEqual(["correct", "pending", "pending"]);
    expect(typingStatuses("zasshi", "ざっし")).toEqual(["correct", "correct", "correct"]);
  });

  test("typing 'nippon' for にっぽん (geminate p)", () => {
    expect(typingStatuses("ni", "にっぽん")).toEqual(["correct", "untyped", "untyped", "untyped"]);
    expect(typingStatuses("nip", "にっぽん")).toEqual(["correct", "pending", "untyped", "untyped"]);
    // "nipp" → "にpp" — stays ASCII
    expect(typingStatuses("nipp", "にっぽん")).toEqual([
      "correct",
      "pending",
      "pending",
      "untyped",
    ]);
    expect(typingStatuses("nippo", "にっぽん")).toEqual([
      "correct",
      "correct",
      "correct",
      "untyped",
    ]);
    // "nippon" → "にっぽn" — final n stays ASCII (could be ん or な/に/etc.)
    expect(typingStatuses("nippon", "にっぽん")).toEqual([
      "correct",
      "correct",
      "correct",
      "pending",
    ]);
    // Need nn or n + non-n to complete ん
    expect(typingStatuses("nipponn", "にっぽん")).toEqual([
      "correct",
      "correct",
      "correct",
      "correct",
    ]);
  });
});
