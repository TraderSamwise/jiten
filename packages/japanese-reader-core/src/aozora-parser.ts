/**
 * Convert halfwidth punctuation to fullwidth equivalents for proper
 * upright display in vertical (vertical-rl) typesetting.
 */
function toFullwidthPunctuation(text: string): string {
  return text
    .replace(/\?/g, "？")
    .replace(/!/g, "！")
    .replace(/~/g, "〜")
    .replace(
      /([^<]*?)(<[^>]*>|$)/g,
      (_, textPart, tag) =>
        textPart.replace(/[0-9]/g, (ch: string) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)) +
        (tag ?? ""),
    );
}

/**
 * Strip Aozora bibliographic header and footer.
 */
export function stripAozoraBoilerplate(rawText: string): string {
  let text = rawText;
  const headerSep = text.indexOf("-------------------------------------------------------");
  if (headerSep !== -1) {
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
  const footerSep = text.lastIndexOf("底本：");
  if (footerSep !== -1) {
    text = text.slice(0, footerSep);
  }
  return text.trim();
}

/**
 * Converts Aozora Bunko markup to HTML with ruby annotations.
 * Also handles plain text gracefully.
 */
export function parseAozoraToHtml(rawText: string, { strip = true } = {}): string {
  const text = strip ? stripAozoraBoilerplate(rawText) : rawText;

  const lines = text.split(/\r?\n/);
  const htmlParts: string[] = [];

  for (const line of lines) {
    if (line.trim() === "") continue;

    if (line.includes("［＃改ページ］") || line.includes("[#改ページ]")) {
      htmlParts.push('<div class="page-break"></div>');
      continue;
    }

    let processed = line;

    processed = processed.replace(/[｜|]([^《]+)《([^》]+)》/g, "<ruby>$1<rt>$2</rt></ruby>");
    processed = processed.replace(
      /([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+)《([^》]+)》/g,
      "<ruby>$1<rt>$2</rt></ruby>",
    );
    processed = processed.replace(/［＃「([^」]+)」に傍点］/g, '<em class="bouten">$1</em>');
    processed = processed.replace(
      /［＃(\d+)字下げ］/g,
      (_match, n) => `<span style="margin-inline-start: ${n}em">`,
    );
    processed = processed.replace(/［＃字下げ終わり］/g, "</span>");
    processed = processed.replace(/［＃[^］]*見出し］/g, "");
    processed = processed.replace(/［＃[^］]*］/g, "");

    htmlParts.push(`<p>${toFullwidthPunctuation(processed)}</p>`);
  }

  return htmlParts.join("");
}

/**
 * Simple wrapper for plain text (no Aozora markup).
 * Wraps each non-empty line in a <p> tag.
 */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => `<p>${toFullwidthPunctuation(line)}</p>`)
    .join("");
}

/**
 * Detect if text has Aozora markup.
 */
export function hasAozoraMarkup(text: string): boolean {
  return /《[^》]+》/.test(text) || /［＃/.test(text);
}
