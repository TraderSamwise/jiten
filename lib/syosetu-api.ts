import { proxyUrl } from "./proxy";

export interface SyosetuNovel {
  ncode: string;
  title: string;
  writer: string;
  story: string;
  totalChapters: number;
  length: number;
  isComplete: boolean;
}

export interface SyosetuChapter {
  number: number;
  title: string;
}

export interface SyosetuTocSection {
  volumeTitle: string | null;
  chapters: SyosetuChapter[];
}

export async function searchNovels(query: string): Promise<SyosetuNovel[]> {
  const params = new URLSearchParams({
    word: query,
    out: "json",
    lim: "30",
    of: "t-n-w-s-ga-l-e",
  });

  const resp = await fetch(proxyUrl(`https://api.syosetu.com/novelapi/api/?${params}`));
  if (!resp.ok) throw new Error(`Syosetu API error: ${resp.status}`);

  const data = await resp.json();

  // First element is the metadata (allcount), rest are novels
  if (!Array.isArray(data) || data.length < 2) return [];

  return data.slice(1).map((item: any) => ({
    ncode: (item.ncode as string).toLowerCase(),
    title: item.title as string,
    writer: item.writer as string,
    story: item.story as string,
    totalChapters: item.general_all_no as number,
    length: item.length as number,
    isComplete: item.end === 1,
  }));
}

export async function fetchChapterText(ncode: string, chapter: number): Promise<string> {
  const url = `https://ncode.syosetu.com/${ncode}/${chapter}/`;
  const resp = await fetch(proxyUrl(url));
  if (!resp.ok) throw new Error(`Failed to fetch chapter ${chapter}: ${resp.status}`);

  const html = await resp.text();

  // Extract main text from <div class="js-novel-text p-novel__text"> (without --preface/--afterword modifiers)
  const match = html.match(/<div\s+class="js-novel-text p-novel__text">([\s\S]*?)<\/div>/);
  if (!match) return "";

  // Convert <br> tags to newlines, strip other HTML tags, decode entities
  let text = match[1];
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
  text = text.trim();

  return text;
}

export async function fetchTableOfContents(ncode: string): Promise<SyosetuTocSection[]> {
  const sections: SyosetuTocSection[] = [];
  let page = 1;

  while (true) {
    const url =
      page === 1
        ? `https://ncode.syosetu.com/${ncode}/`
        : `https://ncode.syosetu.com/${ncode}/?p=${page}`;

    const resp = await fetch(proxyUrl(url));
    if (!resp.ok) throw new Error(`Failed to fetch ToC page ${page}: ${resp.status}`);

    const html = await resp.text();

    // Parse chapter entries: volume titles and chapter links
    // Volume title: <div class="p-eplist__chapter-title">Title</div>
    // Chapter link: <a href="/ncode/123/" class="p-eplist__subtitle">Chapter Title</a>
    const entryPattern =
      /<div\s+class="p-eplist__chapter-title">([\s\S]*?)<\/div>|<a\s+href="\/[^/]+\/(\d+)\/"[^>]*class="p-eplist__subtitle"[^>]*>([\s\S]*?)<\/a>/g;

    let currentSection: SyosetuTocSection | null = null;
    let match: RegExpExecArray | null;
    let foundEntries = false;

    while ((match = entryPattern.exec(html)) !== null) {
      foundEntries = true;
      if (match[1] !== undefined) {
        // Volume title
        currentSection = {
          volumeTitle: match[1].replace(/<[^>]+>/g, "").trim(),
          chapters: [],
        };
        sections.push(currentSection);
      } else if (match[2] !== undefined && match[3] !== undefined) {
        // Chapter link
        const chapterNum = parseInt(match[2], 10);
        const chapterTitle = match[3].replace(/<[^>]+>/g, "").trim();

        if (!currentSection) {
          currentSection = { volumeTitle: null, chapters: [] };
          sections.push(currentSection);
        }
        currentSection.chapters.push({ number: chapterNum, title: chapterTitle });
      }
    }

    if (!foundEntries) break;

    // Check for next page link
    const hasNextPage = html.includes(`?p=${page + 1}`);
    if (!hasNextPage) break;
    page++;
  }

  return sections;
}
