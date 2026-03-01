export type HighlightType = "plain" | "primary" | "component";

export interface HighlightSegment {
  text: string;
  type: HighlightType;
}

interface TaggedWord {
  word: string;
  pattern: RegExp;
  type: HighlightType;
}

/**
 * Generate simple English inflection variants for a base word.
 * Returns a regex pattern that matches the word and common inflected forms.
 */
function wordPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Match the base word plus common English suffixes
  // e.g. "box" matches "box", "boxes", "boxed", "boxing"
  // e.g. "leg" matches "leg", "legs", "legged", "legging"
  return new RegExp(`\\b${escaped}(?:s|es|ed|ing|er|ers|ied)?\\b`, "gi");
}

/**
 * Split keyword strings into individual words, filtering short/common words.
 */
function extractWords(keywords: string[]): string[] {
  const stopWords = new Set(["a", "an", "the", "of", "in", "on", "to", "is", "no"]);
  const words: string[] = [];
  for (const kw of keywords) {
    if (!kw) continue;
    for (const w of kw.split(/\s+/)) {
      const lower = w.toLowerCase();
      if (lower.length >= 2 && !stopWords.has(lower)) {
        words.push(lower);
      }
    }
  }
  return [...new Set(words)];
}

/**
 * Highlight keywords in mnemonic text.
 *
 * @param text - The mnemonic story text
 * @param primaryKeywords - Keywords for this kanji (user keyword, heisig keyword)
 * @param componentKeywords - Keywords for component primitives (1 layer deep)
 * @returns Array of segments with highlight types
 */
export function highlightKeywords(
  text: string,
  primaryKeywords: string[],
  componentKeywords: string[],
): HighlightSegment[] {
  if (!text) return [];

  const primaryWords = extractWords(primaryKeywords);
  const componentWords = extractWords(componentKeywords);

  if (primaryWords.length === 0 && componentWords.length === 0) {
    return [{ text, type: "plain" }];
  }

  // Build tagged word list — primary takes precedence
  const tagged: TaggedWord[] = [];
  const seen = new Set<string>();

  for (const w of primaryWords) {
    if (!seen.has(w)) {
      seen.add(w);
      tagged.push({ word: w, pattern: wordPattern(w), type: "primary" });
    }
  }
  for (const w of componentWords) {
    if (!seen.has(w)) {
      seen.add(w);
      tagged.push({ word: w, pattern: wordPattern(w), type: "component" });
    }
  }

  // Find all matches with positions
  type Match = { start: number; end: number; type: HighlightType };
  const matches: Match[] = [];

  for (const tw of tagged) {
    tw.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tw.pattern.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, type: tw.type });
    }
  }

  if (matches.length === 0) {
    return [{ text, type: "plain" }];
  }

  // Sort by start position, then prefer primary over component, then longer matches
  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.type !== b.type) return a.type === "primary" ? -1 : 1;
    return (b.end - b.start) - (a.end - a.start);
  });

  // Remove overlapping matches (first match wins due to sort order)
  const filtered: Match[] = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  // Build segments
  const segments: HighlightSegment[] = [];
  let pos = 0;

  for (const m of filtered) {
    if (m.start > pos) {
      segments.push({ text: text.slice(pos, m.start), type: "plain" });
    }
    segments.push({ text: text.slice(m.start, m.end), type: m.type });
    pos = m.end;
  }

  if (pos < text.length) {
    segments.push({ text: text.slice(pos), type: "plain" });
  }

  return segments;
}
