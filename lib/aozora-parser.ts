/**
 * Converts Aozora Bunko markup to HTML with ruby annotations.
 * Also handles plain text gracefully.
 */
export function parseAozoraToHtml(rawText: string): string {
  // Strip Aozora bibliographic header (before first horizontal rule)
  let text = rawText;
  const headerSep = text.indexOf("-------------------------------------------------------");
  if (headerSep !== -1) {
    // Find the second separator (end of header section)
    const secondSep = text.indexOf(
      "-------------------------------------------------------",
      headerSep + 1,
    );
    if (secondSep !== -1) {
      text = text.slice(
        secondSep + "-------------------------------------------------------".length,
      );
    }
  }

  // Strip trailing bibliographic footer
  const footerSep = text.lastIndexOf("底本：");
  if (footerSep !== -1) {
    text = text.slice(0, footerSep);
  }

  text = text.trim();

  const lines = text.split(/\r?\n/);
  const htmlParts: string[] = [];

  for (const line of lines) {
    // Blank line = skip
    if (line.trim() === "") continue;

    // Page break annotation
    if (line.includes("［＃改ページ］") || line.includes("[#改ページ]")) {
      htmlParts.push('<div class="page-break"></div>');
      continue;
    }

    let processed = line;

    // ── Ruby annotations ──

    // Pattern 1: ｜漢字《かんじ》 (explicit ruby base with ｜ delimiter)
    processed = processed.replace(/[｜|]([^《]+)《([^》]+)》/g, "<ruby>$1<rt>$2</rt></ruby>");

    // Pattern 2: 漢字《かんじ》 (implicit: kanji sequence before 《》)
    // Match one or more kanji (CJK Unified Ideographs) followed by furigana
    processed = processed.replace(
      /([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+)《([^》]+)》/g,
      "<ruby>$1<rt>$2</rt></ruby>",
    );

    // ── Emphasis dots (bouten) ──
    // ［＃「text」に傍点］
    processed = processed.replace(/［＃「([^」]+)」に傍点］/g, '<em class="bouten">$1</em>');

    // ── Indent annotations ──
    // ［＃n字下げ］
    processed = processed.replace(
      /［＃(\d+)字下げ］/g,
      (_match, n) => `<span style="margin-inline-start: ${n}em">`,
    );
    // ［＃字下げ終わり］
    processed = processed.replace(/［＃字下げ終わり］/g, "</span>");

    // ── Heading annotations ──
    processed = processed.replace(/［＃[^］]*見出し］/g, "");

    // ── Strip other Aozora annotations we don't handle ──
    processed = processed.replace(/［＃[^］]*］/g, "");

    htmlParts.push(`<p>${processed}</p>`);
  }

  return htmlParts.join("\n");
}

/**
 * Simple wrapper for plain text (no Aozora markup).
 * Wraps paragraphs in <p> tags.
 */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => `<p>${line}</p>`)
    .join("\n");
}

/**
 * Detect if text has Aozora markup.
 */
export function hasAozoraMarkup(text: string): boolean {
  return /《[^》]+》/.test(text) || /［＃/.test(text);
}
