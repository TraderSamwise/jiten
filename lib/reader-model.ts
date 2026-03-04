export type BookFormat = "aozora" | "plain" | "html";

export interface TextModel {
  rawText: string;
  totalChars: number;
  format: BookFormat;
}

/**
 * Count visible characters in an HTML string.
 * Skips tags and <rt> content. Treats HTML entities as single characters.
 */
export function visibleTextLength(html: string): number {
  let count = 0;
  let inTag = false;
  let rtDepth = 0;
  let i = 0;

  while (i < html.length) {
    const ch = html[i];

    if (ch === "<") {
      if (html.startsWith("<rt>", i) || html.startsWith("<rt ", i)) {
        rtDepth++;
        const close = html.indexOf(">", i);
        i = close >= 0 ? close + 1 : i + 1;
        continue;
      }
      if (html.startsWith("</rt>", i)) {
        rtDepth = Math.max(0, rtDepth - 1);
        i += 5;
        continue;
      }
      inTag = true;
      i++;
      continue;
    }

    if (ch === ">") {
      inTag = false;
      i++;
      continue;
    }

    if (!inTag && rtDepth === 0) {
      if (ch === "&") {
        const semi = html.indexOf(";", i);
        if (semi >= 0 && semi - i <= 8) {
          count++;
          i = semi + 1;
          continue;
        }
      }
      count++;
    }

    i++;
  }

  return count;
}

/**
 * Count visible characters in raw Aozora markup text.
 * Skips 《...》 (ruby readings), ｜ (group marker), and ［＃...］ (formatting directives).
 * Produces the same counts as visibleTextLength(parseAozoraToHtml(line)).
 */
export function visibleAozoraTextLength(text: string): number {
  let count = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // Skip ruby reading: 《...》
    if (ch === "《") {
      const close = text.indexOf("》", i + 1);
      i = close >= 0 ? close + 1 : i + 1;
      continue;
    }

    // Skip group marker: ｜ or |
    if (ch === "｜" || ch === "|") {
      // Only skip if followed by text + 《》 (actual ruby delimiter usage)
      const rubyStart = text.indexOf("《", i + 1);
      if (rubyStart !== -1) {
        i++;
        continue;
      }
    }

    // Skip formatting directive: ［＃...］
    if (ch === "［" && i + 1 < text.length && text[i + 1] === "＃") {
      const close = text.indexOf("］", i + 2);
      i = close >= 0 ? close + 1 : i + 1;
      continue;
    }

    count++;
    i++;
  }

  return count;
}

/**
 * Parse book content into a TextModel with total visible char count.
 *
 * For "aozora" and "plain" formats: splits by newline, filters blanks,
 * counts with format-appropriate counter.
 *
 * For "html" format: counts with visibleTextLength.
 */
export function parseBookContent(text: string, format: BookFormat = "html"): TextModel {
  let totalChars = 0;

  if (format === "aozora" || format === "plain") {
    const counter = format === "aozora" ? visibleAozoraTextLength : (s: string) => s.length;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim() === "") continue;
      const len = counter(line);
      if (len > 0) totalChars += len;
    }
  } else {
    totalChars = visibleTextLength(text);
  }

  return { rawText: text, totalChars, format };
}

/**
 * Walk raw text with format-specific skip rules to find the raw byte position
 * of the Nth visible character.
 */
function visibleCharToRawIndex(
  text: string,
  format: BookFormat,
  targetVisibleChar: number,
): number {
  if (targetVisibleChar <= 0) return 0;

  let visibleCount = 0;
  let i = 0;

  if (format === "aozora") {
    // Walk lines, skipping blank lines and newlines (they aren't visible chars)
    const lines = text.split(/\r?\n/);
    let rawPos = 0;

    for (const line of lines) {
      if (line.trim() === "") {
        rawPos += line.length + 1; // +1 for \n
        continue;
      }

      let j = 0;
      while (j < line.length) {
        if (visibleCount >= targetVisibleChar) {
          return rawPos + j;
        }

        const ch = line[j];

        // Skip ruby reading: 《...》
        if (ch === "《") {
          const close = line.indexOf("》", j + 1);
          j = close >= 0 ? close + 1 : j + 1;
          continue;
        }

        // Skip group marker: ｜ or |
        if (ch === "｜" || ch === "|") {
          const rubyStart = line.indexOf("《", j + 1);
          if (rubyStart !== -1) {
            j++;
            continue;
          }
        }

        // Skip formatting directive: ［＃...］
        if (ch === "［" && j + 1 < line.length && line[j + 1] === "＃") {
          const close = line.indexOf("］", j + 2);
          j = close >= 0 ? close + 1 : j + 1;
          continue;
        }

        visibleCount++;
        j++;
      }

      rawPos += line.length + 1; // +1 for \n
    }

    return text.length;
  }

  if (format === "plain") {
    const lines = text.split(/\r?\n/);
    let rawPos = 0;

    for (const line of lines) {
      if (line.trim() === "") {
        rawPos += line.length + 1;
        continue;
      }

      for (let j = 0; j < line.length; j++) {
        if (visibleCount >= targetVisibleChar) {
          return rawPos + j;
        }
        visibleCount++;
      }

      rawPos += line.length + 1;
    }

    return text.length;
  }

  // HTML format: skip tags and <rt> content
  let inTag = false;
  let rtDepth = 0;

  while (i < text.length) {
    if (visibleCount >= targetVisibleChar) return i;

    const ch = text[i];

    if (ch === "<") {
      if (text.startsWith("<rt>", i) || text.startsWith("<rt ", i)) {
        rtDepth++;
        const close = text.indexOf(">", i);
        i = close >= 0 ? close + 1 : i + 1;
        continue;
      }
      if (text.startsWith("</rt>", i)) {
        rtDepth = Math.max(0, rtDepth - 1);
        i += 5;
        continue;
      }
      inTag = true;
      i++;
      continue;
    }

    if (ch === ">") {
      inTag = false;
      i++;
      continue;
    }

    if (!inTag && rtDepth === 0) {
      if (ch === "&") {
        const semi = text.indexOf(";", i);
        if (semi >= 0 && semi - i <= 8) {
          visibleCount++;
          i = semi + 1;
          continue;
        }
      }
      visibleCount++;
    }

    i++;
  }

  return text.length;
}

/**
 * Snap a raw index to a clean markup boundary for Aozora format.
 * If rawIndex lands inside 《...》, skip forward past 》.
 * If rawIndex is between ｜ and its 《》, snap back to before ｜.
 */
function snapToCleanBoundary(text: string, rawIndex: number, direction: "start" | "end"): number {
  if (rawIndex <= 0) return 0;
  if (rawIndex >= text.length) return text.length;

  // Check if inside 《...》
  // Find the nearest 《 before rawIndex
  let searchFrom = Math.max(0, rawIndex - 200);
  let pos = searchFrom;
  while (pos < rawIndex) {
    const openIdx = text.indexOf("《", pos);
    if (openIdx === -1 || openIdx >= rawIndex) break;
    const closeIdx = text.indexOf("》", openIdx + 1);
    if (closeIdx === -1) break;
    if (rawIndex > openIdx && rawIndex <= closeIdx) {
      // Inside ruby reading
      if (direction === "start") {
        // For start: skip forward past 》
        return closeIdx + 1;
      } else {
        // For end: extend to include 》
        return closeIdx + 1;
      }
    }
    pos = closeIdx + 1;
  }

  // Check if between ｜ and 《
  // Look backwards for ｜
  for (let k = rawIndex - 1; k >= Math.max(0, rawIndex - 100); k--) {
    const ch = text[k];
    if (ch === "｜" || ch === "|") {
      // Check if there's a 《 between here and ahead
      const rubyOpen = text.indexOf("《", k + 1);
      if (rubyOpen !== -1 && rubyOpen >= rawIndex) {
        const rubyClose = text.indexOf("》", rubyOpen + 1);
        if (rubyClose !== -1) {
          if (direction === "start") {
            // Snap to the ｜ position (include the whole ruby group)
            return k;
          } else {
            // Extend to include the full ruby group
            return rubyClose + 1;
          }
        }
      }
      break;
    }
    // If we hit a newline or other break, stop looking
    if (ch === "\n") break;
  }

  // Check if inside ［＃...］
  searchFrom = Math.max(0, rawIndex - 200);
  pos = searchFrom;
  while (pos < rawIndex) {
    const openIdx = text.indexOf("［＃", pos);
    if (openIdx === -1 || openIdx >= rawIndex) break;
    const closeIdx = text.indexOf("］", openIdx + 2);
    if (closeIdx === -1) break;
    if (rawIndex > openIdx && rawIndex <= closeIdx) {
      if (direction === "start") {
        return closeIdx + 1;
      } else {
        return closeIdx + 1;
      }
    }
    pos = closeIdx + 1;
  }

  return rawIndex;
}

/**
 * Slice content at exact visible char offset.
 * Returns the raw text slice and the actual char offset it starts at.
 */
export function sliceContent(
  model: TextModel,
  startVisibleChar: number,
  charBudget: number,
): { text: string; charOffset: number } {
  const rawStart = visibleCharToRawIndex(model.rawText, model.format, startVisibleChar);
  const endChar = Math.min(startVisibleChar + charBudget, model.totalChars);
  const rawEnd = visibleCharToRawIndex(model.rawText, model.format, endChar);

  // Snap to clean markup boundaries for aozora format
  let snappedStart = rawStart;
  let snappedEnd = rawEnd;
  if (model.format === "aozora") {
    snappedStart = snapToCleanBoundary(model.rawText, rawStart, "start");
    snappedEnd = snapToCleanBoundary(model.rawText, rawEnd, "end");
  }

  return {
    text: model.rawText.slice(snappedStart, snappedEnd),
    charOffset: startVisibleChar,
  };
}

/**
 * Estimate visible characters per page from viewport dimensions and font size.
 */
export function calcCharsPerPage(
  W: number,
  H: number,
  fontSize: number,
  hasFurigana: boolean,
): number {
  const lineW = fontSize * (hasFurigana ? 2.0 : 1.5);
  const cols = Math.floor((W - 32) / lineW);
  const charsPerCol = Math.floor((H - 32) / fontSize);
  return Math.floor(cols * charsPerCol * (hasFurigana ? 0.6 : 0.8));
}

/**
 * Estimate total pages from total chars and chars per page.
 */
export function calcTotalPages(totalChars: number, charsPerPage: number): number {
  if (charsPerPage <= 0) return 1;
  return Math.max(1, Math.ceil(totalChars / charsPerPage));
}
