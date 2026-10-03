/**
 * The crowd's RTK stories, from the published scrape of Kanji Koohii
 * (github.com/Arthur944/remembering-the-kanji-stories, itself credited to
 * hochanh.github.io/rtk).
 *
 * Two of that file's nine columns are Heisig's own text from the book. They are
 * dropped here and never leave this parser: the book is in print, and the only
 * columns worth keeping are the ones learners wrote. What survives is used as
 * raw material for a freshly generated story, never shown to a learner as is —
 * see server/lib/kanji-lore.ts.
 */

export interface CrowdStory {
  text: string;
  /** Koohii's star count, the crowd's own ranking. */
  votes: number;
}

export interface CrowdStoryRow {
  literal: string;
  stories: CrowdStory[];
}

/** `1) [[user](url)] 29-6-2006(263): the story` — the scrape's own framing. */
const ATTRIBUTION = /^\s*\d+\)\s*\[\[[^\]]*\]\([^)]*\)\]\s*([\d-]*)\((\d+)\):\s*/;

/** Markdown the stories carry, which a prompt does not need. */
export function cleanStoryText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\\([-_*[\]()])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseStory(cell: string): CrowdStory | null {
  const match = ATTRIBUTION.exec(cell);
  if (!match) return null;
  const text = cleanStoryText(cell.slice(match[0].length));
  if (text.length < 15) return null;
  return { text, votes: Number(match[2]) };
}

const FIELDS = 9;
const FIRST_CROWD_FIELD = 4;

/**
 * One line of the scrape. Returns null for a line that carries no usable
 * story — a header, a blank, or a frame nobody wrote for. Stories come back
 * best-voted first, since only the best one is ever used.
 */
export function parseCrowdStoryRow(line: string): CrowdStoryRow | null {
  if (!line.trim()) return null;
  const cells = line.split(";");
  // Nine columns, the last few sometimes missing entirely.
  if (cells.length < FIRST_CROWD_FIELD + 1 || cells.length > FIELDS) return null;
  const literal = cells[0].trim();
  if ([...literal].length !== 1) return null;

  const stories = cells
    .slice(FIRST_CROWD_FIELD)
    .map(parseStory)
    .filter((story): story is CrowdStory => story !== null)
    .sort((a, b) => b.votes - a.votes);

  return stories.length > 0 ? { literal, stories } : null;
}

export function parseCrowdStories(csv: string): CrowdStoryRow[] {
  return csv
    .split("\n")
    .map(parseCrowdStoryRow)
    .filter((row): row is CrowdStoryRow => row !== null);
}
