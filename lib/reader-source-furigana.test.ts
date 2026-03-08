/**
 * Tests for source furigana helpers used in the ebook reader.
 *
 * These helpers live in [bookId].tsx but are pure functions,
 * so we duplicate the logic here for unit testing.
 */
import { describe, it, expect } from "vitest";
import { hasAozoraMarkup } from "./aozora-parser";
import type { FuriganaLevel } from "@/stores/settings";

// ── Duplicated helpers (same logic as [bookId].tsx) ──

function bookHasSourceFurigana(rawContent: string): boolean {
  return /<ruby[\s>]/.test(rawContent) || hasAozoraMarkup(rawContent);
}

function hasFuriganaActive(
  levels: Record<FuriganaLevel, boolean>,
  bookHasSource: boolean,
): boolean {
  if (bookHasSource && levels.default) return true;
  return Object.entries(levels).some(([k, v]) => k !== "default" && v);
}

function stripRubyTags(html: string): string {
  return html.replace(/<ruby>([\s\S]*?)<rt>[\s\S]*?<\/rt><\/ruby>/g, "$1");
}

// ── Helpers ──

const allOff: Record<FuriganaLevel, boolean> = {
  default: false,
  n5: false,
  n4: false,
  n3: false,
  n2: false,
  n1: false,
  nonJouyou: false,
  all: false,
};

const defaultOnly: Record<FuriganaLevel, boolean> = { ...allOff, default: true };
const n3Only: Record<FuriganaLevel, boolean> = { ...allOff, n3: true };
const defaultAndN3: Record<FuriganaLevel, boolean> = { ...allOff, default: true, n3: true };

// ── Tests ──

describe("bookHasSourceFurigana", () => {
  it("detects Aozora 《》 markup", () => {
    expect(bookHasSourceFurigana("坐《すわ》っている")).toBe(true);
  });

  it("detects XHTML <ruby> tags", () => {
    expect(bookHasSourceFurigana("<ruby>漢字<rt>かんじ</rt></ruby>")).toBe(true);
  });

  it("detects Aozora annotations ［＃", () => {
    expect(bookHasSourceFurigana("text ［＃改ページ］")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(bookHasSourceFurigana("これは普通のテキストです")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(bookHasSourceFurigana("")).toBe(false);
  });
});

describe("hasFuriganaActive", () => {
  describe("book WITH source furigana", () => {
    const hasSource = true;

    it("returns true when only default is on", () => {
      expect(hasFuriganaActive(defaultOnly, hasSource)).toBe(true);
    });

    it("returns true when default + JLPT level is on", () => {
      expect(hasFuriganaActive(defaultAndN3, hasSource)).toBe(true);
    });

    it("returns true when JLPT level is on but default is off", () => {
      expect(hasFuriganaActive(n3Only, hasSource)).toBe(true);
    });

    it("returns false when everything is off", () => {
      expect(hasFuriganaActive(allOff, hasSource)).toBe(false);
    });
  });

  describe("book WITHOUT source furigana", () => {
    const hasSource = false;

    it("returns false when only default is on (irrelevant for plain text)", () => {
      expect(hasFuriganaActive(defaultOnly, hasSource)).toBe(false);
    });

    it("returns true when a JLPT level is on", () => {
      expect(hasFuriganaActive(n3Only, hasSource)).toBe(true);
    });

    it("returns true when default + JLPT level is on", () => {
      expect(hasFuriganaActive(defaultAndN3, hasSource)).toBe(true);
    });

    it("returns false when everything is off", () => {
      expect(hasFuriganaActive(allOff, hasSource)).toBe(false);
    });
  });
});

describe("stripRubyTags", () => {
  it("strips simple ruby tags keeping base text", () => {
    expect(stripRubyTags("<ruby>漢字<rt>かんじ</rt></ruby>")).toBe("漢字");
  });

  it("strips multiple ruby tags", () => {
    const html = "<p><ruby>坐<rt>すわ</rt></ruby>っている<ruby>女<rt>おんな</rt></ruby></p>";
    expect(stripRubyTags(html)).toBe("<p>坐っている女</p>");
  });

  it("preserves non-ruby HTML", () => {
    const html = '<p class="indent">普通のテキスト</p>';
    expect(stripRubyTags(html)).toBe(html);
  });

  it("handles empty base text", () => {
    expect(stripRubyTags("<ruby><rt>test</rt></ruby>")).toBe("");
  });

  it("handles text with no ruby at all", () => {
    expect(stripRubyTags("plain text")).toBe("plain text");
  });

  it("strips ruby from mixed content", () => {
    const html = "前<ruby>漢字<rt>かんじ</rt></ruby>後";
    expect(stripRubyTags(html)).toBe("前漢字後");
  });
});
