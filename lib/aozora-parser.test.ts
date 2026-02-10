/**
 * Aozora Bunko parser tests.
 *
 * Tests conversion of Aozora markup to HTML with ruby/furigana annotations.
 * Also tests plain text handling and markup detection.
 */

import { describe, test, expect } from "vitest";
import { parseAozoraToHtml, plainTextToHtml, hasAozoraMarkup } from "./aozora-parser";

// ═══════════════════════════════════════════════════════════════════
// 1. RUBY ANNOTATIONS (FURIGANA)
// ═══════════════════════════════════════════════════════════════════

describe("Ruby annotations", () => {
  test("basic kanji with furigana: 漢字《かんじ》", () => {
    const html = parseAozoraToHtml("漢字《かんじ》");
    expect(html).toContain("<ruby>漢字<rt>かんじ</rt></ruby>");
  });

  test("explicit delimiter: ｜難読語《なんどくご》", () => {
    const html = parseAozoraToHtml("｜難読語《なんどくご》");
    expect(html).toContain("<ruby>難読語<rt>なんどくご</rt></ruby>");
  });

  test("explicit delimiter with half-width pipe: |難読語《なんどくご》", () => {
    const html = parseAozoraToHtml("|難読語《なんどくご》");
    expect(html).toContain("<ruby>難読語<rt>なんどくご</rt></ruby>");
  });

  test("multiple rubies in one line", () => {
    const html = parseAozoraToHtml("私《わたし》は猫《ねこ》である");
    expect(html).toContain("<ruby>私<rt>わたし</rt></ruby>");
    expect(html).toContain("<ruby>猫<rt>ねこ</rt></ruby>");
    expect(html).toContain("は");
    expect(html).toContain("である");
  });

  test("longer kanji compound: 紫陽花《あじさい》", () => {
    const html = parseAozoraToHtml("紫陽花《あじさい》");
    expect(html).toContain("<ruby>紫陽花<rt>あじさい</rt></ruby>");
  });

  test("single kanji: 道《みち》", () => {
    const html = parseAozoraToHtml("道《みち》");
    expect(html).toContain("<ruby>道<rt>みち</rt></ruby>");
  });

  test("ruby with katakana reading: 珈琲《コーヒー》", () => {
    const html = parseAozoraToHtml("珈琲《コーヒー》");
    expect(html).toContain("<ruby>珈琲<rt>コーヒー</rt></ruby>");
  });

  test("explicit delimiter for mixed kanji-kana: ｜お母さん《おかあさん》", () => {
    const html = parseAozoraToHtml("｜お母さん《おかあさん》");
    expect(html).toContain("<ruby>お母さん<rt>おかあさん</rt></ruby>");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. EMPHASIS (BOUTEN)
// ═══════════════════════════════════════════════════════════════════

describe("Emphasis dots (bouten)", () => {
  test("basic bouten annotation", () => {
    const html = parseAozoraToHtml("これは［＃「重要」に傍点］な事だ");
    expect(html).toContain('<em class="bouten">重要</em>');
    expect(html).toContain("これは");
    expect(html).toContain("な事だ");
  });

  test("multiple bouten in one text", () => {
    const html = parseAozoraToHtml("［＃「絶対」に傍点］に［＃「必要」に傍点］です");
    expect(html).toContain('<em class="bouten">絶対</em>');
    expect(html).toContain('<em class="bouten">必要</em>');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. INDENT ANNOTATIONS
// ═══════════════════════════════════════════════════════════════════

describe("Indent annotations", () => {
  test("n-character indent", () => {
    const html = parseAozoraToHtml("［＃3字下げ］インデントされたテキスト");
    expect(html).toContain('style="margin-inline-start: 3em"');
    expect(html).toContain("インデントされたテキスト");
  });

  test("indent end marker", () => {
    const html = parseAozoraToHtml("テキスト［＃字下げ終わり］");
    expect(html).toContain("</span>");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. PAGE BREAKS
// ═══════════════════════════════════════════════════════════════════

describe("Page breaks", () => {
  test("full-width page break marker", () => {
    const html = parseAozoraToHtml("前のページ\n\n［＃改ページ］\n\n次のページ");
    expect(html).toContain('<div class="page-break"></div>');
    expect(html).toContain("前のページ");
    expect(html).toContain("次のページ");
  });

  test("half-width page break marker", () => {
    const html = parseAozoraToHtml("[#改ページ]");
    expect(html).toContain('<div class="page-break"></div>');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. HEADER/FOOTER STRIPPING
// ═══════════════════════════════════════════════════════════════════

describe("Header and footer stripping", () => {
  test("strips Aozora header between separators", () => {
    const text = [
      "タイトル",
      "著者名",
      "-------------------------------------------------------",
      "【テキスト中に現れる記号について】",
      "《》：ルビ",
      "-------------------------------------------------------",
      "本文がここから始まる",
    ].join("\n");
    const html = parseAozoraToHtml(text);
    expect(html).not.toContain("テキスト中に現れる記号について");
    expect(html).toContain("本文がここから始まる");
  });

  test("strips bibliographic footer", () => {
    const text = "本文テキスト\n\n底本：「何かの本」出版社、2000年";
    const html = parseAozoraToHtml(text);
    expect(html).toContain("本文テキスト");
    expect(html).not.toContain("底本：");
  });

  test("text without header/footer is preserved", () => {
    const text = "普通のテキストです。";
    const html = parseAozoraToHtml(text);
    expect(html).toContain("普通のテキストです。");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. PARAGRAPH HANDLING
// ═══════════════════════════════════════════════════════════════════

describe("Paragraph handling", () => {
  test("wraps text in <p> tags", () => {
    const html = parseAozoraToHtml("テスト文章です。");
    expect(html).toContain("<p>");
    expect(html).toContain("</p>");
  });

  test("blank lines create separate paragraphs", () => {
    const html = parseAozoraToHtml("第一段落\n\n第二段落");
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(2);
  });

  test("consecutive lines are separate paragraphs", () => {
    const html = parseAozoraToHtml("一行目\n二行目");
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(2);
    expect(html).toContain("<p>一行目</p>");
    expect(html).toContain("<p>二行目</p>");
  });

  test("blank lines only do not produce empty paragraphs", () => {
    const html = parseAozoraToHtml("\n\n\n\n");
    expect(html).not.toContain("<p>");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. HEADING AND UNKNOWN ANNOTATION STRIPPING
// ═══════════════════════════════════════════════════════════════════

describe("Annotation stripping", () => {
  test("heading annotations are removed", () => {
    const html = parseAozoraToHtml("タイトル［＃「タイトル」は大見出し］");
    expect(html).not.toContain("見出し");
    expect(html).toContain("タイトル");
  });

  test("unknown annotations are stripped", () => {
    const html = parseAozoraToHtml("テキスト［＃太字終わり］続き");
    expect(html).not.toContain("［＃");
    expect(html).not.toContain("太字終わり");
    expect(html).toContain("テキスト");
    expect(html).toContain("続き");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. CRLF HANDLING
// ═══════════════════════════════════════════════════════════════════

describe("Line ending handling", () => {
  test("handles CRLF line endings", () => {
    const html = parseAozoraToHtml("一行目\r\n\r\n二行目");
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(2);
  });

  test("handles LF line endings", () => {
    const html = parseAozoraToHtml("一行目\n\n二行目");
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. PLAIN TEXT CONVERSION
// ═══════════════════════════════════════════════════════════════════

describe("plainTextToHtml", () => {
  test("wraps paragraphs in <p> tags", () => {
    const html = plainTextToHtml("段落一\n\n段落二");
    expect(html).toContain("<p>段落一</p>");
    expect(html).toContain("<p>段落二</p>");
  });

  test("each line becomes its own paragraph", () => {
    const html = plainTextToHtml("一行目\n二行目");
    expect(html).toContain("<p>一行目</p>");
    expect(html).toContain("<p>二行目</p>");
  });

  test("filters out empty paragraphs", () => {
    const html = plainTextToHtml("テキスト\n\n\n\n他のテキスト");
    expect(html).not.toContain("<p></p>");
  });

  test("handles single paragraph", () => {
    const html = plainTextToHtml("単一の段落です。");
    expect(html).toBe("<p>単一の段落です。</p>");
  });

  test("handles empty input", () => {
    const html = plainTextToHtml("");
    expect(html).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. MARKUP DETECTION
// ═══════════════════════════════════════════════════════════════════

describe("hasAozoraMarkup", () => {
  test("detects ruby annotations", () => {
    expect(hasAozoraMarkup("漢字《かんじ》")).toBe(true);
  });

  test("detects annotation markers", () => {
    expect(hasAozoraMarkup("テキスト［＃改ページ］")).toBe(true);
  });

  test("plain text returns false", () => {
    expect(hasAozoraMarkup("普通のテキストです。")).toBe(false);
  });

  test("English text returns false", () => {
    expect(hasAozoraMarkup("Hello world")).toBe(false);
  });

  test("empty string returns false", () => {
    expect(hasAozoraMarkup("")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. REALISTIC AOZORA TEXT
// ═══════════════════════════════════════════════════════════════════

describe("Realistic Aozora text", () => {
  test("parses a passage from Natsume Soseki style", () => {
    const text = [
      "吾輩《わがはい》は猫《ねこ》である。名前《なまえ》はまだ無《な》い。",
      "",
      "どこで生《う》まれたかとんと見当《けんとう》がつかぬ。",
    ].join("\n");

    const html = parseAozoraToHtml(text);
    expect(html).toContain("<ruby>吾輩<rt>わがはい</rt></ruby>");
    expect(html).toContain("<ruby>猫<rt>ねこ</rt></ruby>");
    expect(html).toContain("<ruby>名前<rt>なまえ</rt></ruby>");
    expect(html).toContain("<ruby>無<rt>な</rt></ruby>");
    expect(html).toContain("<ruby>生<rt>う</rt></ruby>");
    expect(html).toContain("<ruby>見当<rt>けんとう</rt></ruby>");
    expect(html).toContain("は");
    expect(html).toContain("である。");

    // Should be two paragraphs
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(2);
  });

  test("parses mixed markup correctly", () => {
    const text = "｜彼女《かのじょ》は［＃「静か」に傍点］に微笑《ほほえ》んだ。";
    const html = parseAozoraToHtml(text);
    expect(html).toContain("<ruby>彼女<rt>かのじょ</rt></ruby>");
    expect(html).toContain('<em class="bouten">静か</em>');
    expect(html).toContain("<ruby>微笑<rt>ほほえ</rt></ruby>");
  });

  test("full document with header, body, footer", () => {
    const text = [
      "吾輩は猫である",
      "夏目漱石",
      "-------------------------------------------------------",
      "【テキスト中に現れる記号について】",
      "《》：ルビ",
      "-------------------------------------------------------",
      "",
      "吾輩《わがはい》は猫《ねこ》である。",
      "",
      "名前《なまえ》はまだ無い。",
      "",
      "底本：「吾輩は猫である」岩波書店",
    ].join("\n");

    const html = parseAozoraToHtml(text);

    // Header should be stripped
    expect(html).not.toContain("テキスト中に現れる記号について");
    // Footer should be stripped
    expect(html).not.toContain("底本：");
    // Body should be preserved with ruby
    expect(html).toContain("<ruby>吾輩<rt>わがはい</rt></ruby>");
    expect(html).toContain("<ruby>猫<rt>ねこ</rt></ruby>");
    expect(html).toContain("<ruby>名前<rt>なまえ</rt></ruby>");
  });
});
