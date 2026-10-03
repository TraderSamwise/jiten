/**
 * The fixtures are real lines from the scrape, shortened only by cutting whole
 * stories off the end. What matters most here is what is NOT kept: columns 3
 * and 4 are Heisig's own text from the book.
 */
import { describe, expect, it } from "vitest";

import { cleanStoryText, parseCrowdStories, parseCrowdStoryRow } from "./parse-crowd-stories";

const ONE =
  "一;one;In Chinese characters, the number **one** is laid on its side.;* As a primitive element, the single horizontal stroke takes on the meaning of _floor_.;1) [[Piitaa](http://kanji.koohii.com/profile/Piitaa)] 29-6-2006(263): **One** down, 2041 to go.;2) [[findus](http://kanji.koohii.com/profile/findus)] 11-5-2008(98): A single horizontal bar is all that remains.;;;";

describe("reading a line of the scrape", () => {
  it("keeps only what learners wrote", () => {
    const row = parseCrowdStoryRow(ONE);
    expect(row?.literal).toBe("一");
    const all = row!.stories.map((s) => s.text).join(" ");
    // Heisig's own columns must not reach the output in any form.
    expect(all).not.toContain("laid on its side");
    expect(all).not.toContain("primitive element");
  });

  it("ranks by the crowd's own votes, not the order in the file", () => {
    const row = parseCrowdStoryRow(ONE);
    expect(row?.stories.map((s) => s.votes)).toEqual([263, 98]);
    expect(row?.stories[0].text).toBe("One down, 2041 to go.");
  });

  it("strips the attribution the scrape wraps each story in", () => {
    const row = parseCrowdStoryRow(ONE);
    expect(row?.stories[0].text).not.toContain("koohii.com");
    expect(row?.stories[0].text).not.toContain("29-6-2006");
  });

  it("skips a frame nobody wrote for", () => {
    expect(parseCrowdStoryRow("丁;street;Heisig's text;;;;;;")).toBeNull();
  });

  it("skips a line that is not one character", () => {
    expect(parseCrowdStoryRow("kanji;keyword;a;b;1) [[u](x)] 1-1-2000(5): a story here;;;;")).toBe(
      null,
    );
  });

  it("drops a story too short to be one", () => {
    expect(parseCrowdStoryRow("一;one;a;b;1) [[u](http://x)] 1-1-2000(5): ok;;;;")).toBeNull();
  });

  it("tolerates a line missing its last columns", () => {
    const row = parseCrowdStoryRow(
      "半;half;Heisig;;1) [[bspeaks](http://kanji.koohii.com/profile/bspeaks)] 26-1-2008(361): A needle splitting a hair in half.",
    );
    expect(row?.stories).toHaveLength(1);
  });

  it("reads a whole file and skips the unusable lines", () => {
    const rows = parseCrowdStories(`${ONE}\n\n丁;street;x;;;;;;\n`);
    expect(rows.map((r) => r.literal)).toEqual(["一"]);
  });
});

describe("cleaning a story", () => {
  it("unwraps markdown emphasis and links", () => {
    expect(
      cleanStoryText("To learn this **one** kanji, I [recommend](../v4/2000.html) a _bowl_."),
    ).toBe("To learn this one kanji, I recommend a bowl.");
  });

  it("unescapes the scrape's backslashes", () => {
    expect(cleanStoryText("a little needle \\- the kind used for splitting hairs")).toBe(
      "a little needle - the kind used for splitting hairs",
    );
  });

  it("collapses the whitespace markdown leaves behind", () => {
    expect(cleanStoryText("The  elements: _footprint_ . . .   _spoon_.")).toBe(
      "The elements: footprint . . . spoon.",
    );
  });
});
