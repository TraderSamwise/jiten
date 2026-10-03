/**
 * Every fixture here is real wikitext from the English Wiktionary's "Glyph
 * origin" section for that kanji, pasted unedited. Three of them are the
 * defects the first pass had: a gloss that swallowed its own glyph, and two
 * image captions that rendered as prose.
 */
import { describe, expect, it } from "vitest";

import { firstSentences, wikitextToPlain } from "./wikitext";

describe("rendering a glyph origin", () => {
  it("names both halves of a phono-semantic compound", () => {
    expect(
      wikitextToPlain("{{Han etym}}\n{{Han compound|水|每|c1=s|c2=p|alt1=氵|t1=water|ls=psc}}."),
    ).toBe("Phono-semantic compound: semantic 氵 (water) + phonetic 每.");
  });

  it("keeps the glyph a shorthand link points at, not only its gloss", () => {
    // 間. The bug: och-l's second parameter is the gloss, and reading it as an
    // alternative spelling left "Variant form of space, gap with moon replaced
    // by day" — every character gone from a sentence about characters.
    expect(
      wikitextToPlain(
        "{{Han etym}}\nVariant form of {{och-l|閒|space, gap}} with {{och-l|*月|moon}} replaced by {{och-l|*日|day}}.",
      ),
    ).toBe("Variant form of 閒 (space, gap) with 月 (moon) replaced by 日 (day).");
  });

  it("reads a language-first link the other way round", () => {
    expect(wikitextToPlain("Compare {{m|zh|鹿|t=deer}} and {{l|zh|口}}.")).toBe(
      "Compare 鹿 (deer) and 口.",
    );
  });

  it("drops an image and its caption", () => {
    // 虫: the caption is not prose about the glyph, and it led the entry.
    expect(
      wikitextToPlain(
        "[[File:Britannica Rattlesnake.jpg|thumb|120px|A venomous snake, from which this character originated.]]\n{{Han etyl}}\n{{liushu|p}}: a snake.",
      ),
    ).toBe("Pictogram: a snake.");
  });

  it("drops an image whose caption nests a template and a link", () => {
    // 車. A naive bracket match stops at the inner ]] and leaks the rest.
    expect(
      wikitextToPlain(
        "[[File:x.svg|class=skin-invert-image|thumb|right|Chariots and the Bronze Script of {{zh-l|*車}} in [[Guangdong]]]]\n{{liushu|p}} – a carriage.",
      ),
    ).toBe("Pictogram – a carriage.");
  });

  it("drops a footnote whole", () => {
    expect(
      wikitextToPlain(
        "{{liushu|p}} – a horse.<ref>{{cite-web |title=Evolution}}</ref> Later, dots.",
      ),
    ).toBe("Pictogram – a horse. Later, dots.");
  });

  it("lowercases the type when the template says to", () => {
    expect(wikitextToPlain("also {{liushu|ic|adj=yes|nocap=y}}: {{zh-l|*雨}}.")).toBe(
      "also ideogrammic compound: 雨.",
    );
  });

  it("says what a simplification came from", () => {
    expect(wikitextToPlain("{{Han simp|氣|f=米|t=㐅}} in the 1946 {{w|Tōyō kanji}} list.")).toBe(
      "Simplified from 氣 (米 → 㐅) in the 1946 Tōyō kanji list.",
    );
  });

  it("drops a template it does not know rather than printing it", () => {
    expect(
      wikitextToPlain("{{etystub|zh|ancient glyph form images}}\n{{liushu|p}}: a snake."),
    ).toBe("Pictogram: a snake.");
  });

  it("never leaks markup from unbalanced braces", () => {
    const out = wikitextToPlain("{{liushu|p}} – a tree {{broken");
    expect(out).not.toContain("{{");
    expect(out).not.toContain("}}");
  });

  it("unwraps links and emphasis", () => {
    expect(wikitextToPlain("See [[sun|the sun]] and [[moon]], per ''Shuowen''.")).toBe(
      "See the sun and moon, per Shuowen.",
    );
  });

  it("keeps a list's lead-in with its items", () => {
    // 小: the lead-in alone ("Two possible interpretations:") says nothing.
    const plain = wikitextToPlain(
      "Two possible interpretations:\n* {{liushu|i}} – three small dots.\n* {{liushu|p}} – three granules of sand.",
    );
    expect(firstSentences(plain, 200)).toBe(
      "Two possible interpretations: Ideogram – three small dots. Pictogram – three granules of sand.",
    );
  });
});

describe("shortening it for a card", () => {
  it("leaves a short entry alone", () => {
    expect(firstSentences("Pictogram: a gate.", 200)).toBe("Pictogram: a gate.");
  });

  it("cuts on a sentence boundary", () => {
    const text = "Pictogram: a snake. The character originally meant a venomous snake entirely.";
    expect(firstSentences(text, 40)).toBe("Pictogram: a snake.");
  });

  it("never cuts a word in half when no sentence ends in time", () => {
    const out = firstSentences("Pictogrammatic representation of an extremely long mane", 20);
    expect(out).toBe("Pictogrammatic…");
  });
});
