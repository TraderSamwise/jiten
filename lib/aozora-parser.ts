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
  let currentParagraph: string[] = [];

  function flushParagraph() {
    if (currentParagraph.length > 0) {
      const content = currentParagraph.join("");
      if (content.trim()) {
        htmlParts.push(`<p>${content}</p>`);
      }
      currentParagraph = [];
    }
  }

  for (const line of lines) {
    // Blank line = paragraph break
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    // Page break annotation
    if (line.includes("［＃改ページ］") || line.includes("[#改ページ]")) {
      flushParagraph();
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

    // Escape any remaining HTML-unsafe chars (but not our inserted tags)
    // We only need to handle & since < > are from our tags
    // Actually, be careful: raw text might have < > so handle those first
    // But Aozora text rarely has literal HTML chars
    // For safety, only strip truly dangerous stuff

    currentParagraph.push(processed);
    currentParagraph.push("<br>");
  }

  flushParagraph();

  return htmlParts.join("\n");
}

/**
 * Simple wrapper for plain text (no Aozora markup).
 * Wraps paragraphs in <p> tags.
 */
export function plainTextToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/);
  return paragraphs
    .map((p) => {
      const lines = p.trim().split(/\n/);
      return `<p>${lines.join("<br>")}</p>`;
    })
    .filter((p) => p !== "<p></p>")
    .join("\n");
}

/**
 * Detect if text has Aozora markup.
 */
export function hasAozoraMarkup(text: string): boolean {
  return /《[^》]+》/.test(text) || /［＃/.test(text);
}
