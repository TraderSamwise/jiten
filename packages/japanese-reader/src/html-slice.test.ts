import { describe, expect, it } from "vitest";

import { truncateHtmlAtVisibleChars } from "./html-slice";

describe("truncateHtmlAtVisibleChars", () => {
  it("keeps the first n visible characters", () => {
    expect(truncateHtmlAtVisibleChars("<p>あいうえお</p>", 3)).toBe("<p>あいう</p>");
  });

  it("closes what was still open at the cut", () => {
    expect(truncateHtmlAtVisibleChars("<p><em>あいうえお</em></p>", 3)).toBe(
      "<p><em>あいう</em></p>",
    );
  });

  it("keeps whole paragraphs that fit", () => {
    expect(truncateHtmlAtVisibleChars("<p>あい</p><p>うえ</p>", 3)).toBe("<p>あい</p><p>う</p>");
  });

  /** A text walker skips rt, so the reader's character offsets do too. */
  it("does not count furigana", () => {
    expect(truncateHtmlAtVisibleChars("<p><ruby>漢<rt>かん</rt></ruby>字です</p>", 3)).toBe(
      "<p><ruby>漢<rt>かん</rt></ruby>字で</p>",
    );
  });

  it("counts an entity as the one character it renders as", () => {
    expect(truncateHtmlAtVisibleChars("<p>あ&amp;いうえ</p>", 3)).toBe("<p>あ&amp;い</p>");
  });

  it("leaves a void element where it stands", () => {
    expect(truncateHtmlAtVisibleChars("<p>あ<br>いう</p>", 2)).toBe("<p>あ<br>い</p>");
  });

  it("returns the whole thing when nothing has to go", () => {
    expect(truncateHtmlAtVisibleChars("<p>あい</p>", 99)).toBe("<p>あい</p>");
  });

  it("returns nothing for a cut at zero", () => {
    expect(truncateHtmlAtVisibleChars("<p>あい</p>", 0)).toBe("");
  });
});
