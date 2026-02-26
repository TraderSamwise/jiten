import { unzipSync } from "fflate";
import Encoding from "encoding-japanese";
import { proxyUrl } from "./proxy";

const CATALOG_ZIP_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip";

export interface AozoraBook {
  bookId: number;
  title: string;
  authors: { lastName: string; firstName: string }[];
  xhtmlUrl: string | null;
}

let catalogCache: AozoraBook[] | null = null;

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      current.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") i++;
      current.push(field);
      field = "";
      if (current.length > 1) rows.push(current);
      current = [];
    } else {
      field += ch;
    }
  }
  if (field || current.length > 0) {
    current.push(field);
    if (current.length > 1) rows.push(current);
  }
  return rows;
}

async function loadCatalog(): Promise<AozoraBook[]> {
  if (catalogCache) return catalogCache;

  const resp = await fetch(proxyUrl(CATALOG_ZIP_URL));
  if (!resp.ok) throw new Error(`Failed to download Aozora catalog: ${resp.status}`);

  const buf = new Uint8Array(await resp.arrayBuffer());
  const unzipped = unzipSync(buf);

  // Find the CSV file in the zip
  const csvFileName = Object.keys(unzipped).find((name) => name.endsWith(".csv"));
  if (!csvFileName) throw new Error("No CSV file found in catalog zip");

  const csvText = new TextDecoder("utf-8").decode(unzipped[csvFileName]);
  const rows = parseCSV(csvText);

  // Skip header row
  const dataRows = rows.slice(1);

  // Deduplicate by book ID (keep first row per book)
  const seen = new Set<number>();
  const books: AozoraBook[] = [];

  for (const cols of dataRows) {
    const bookId = parseInt(cols[0], 10);
    if (isNaN(bookId) || seen.has(bookId)) continue;
    seen.add(bookId);

    const title = cols[1] ?? "";
    const lastName = cols[15] ?? "";
    const firstName = cols[16] ?? "";
    const xhtmlUrl = cols[50]?.trim() || null;

    books.push({
      bookId,
      title,
      authors: [{ lastName, firstName }],
      xhtmlUrl,
    });
  }

  catalogCache = books;
  return books;
}

export async function searchBooks(query: string): Promise<AozoraBook[]> {
  const catalog = await loadCatalog();
  const q = query.toLowerCase();

  const matches = catalog.filter((book) => {
    const title = book.title.toLowerCase();
    const author = book.authors
      .map((a) => `${a.lastName}${a.firstName}`)
      .join("")
      .toLowerCase();
    return title.includes(q) || author.includes(q);
  });

  return matches.slice(0, 50);
}

export async function fetchBookContent(xhtmlUrl: string): Promise<string> {
  const resp = await fetch(proxyUrl(xhtmlUrl));
  if (!resp.ok) throw new Error(`Failed to download book: ${resp.status}`);

  const buffer = await resp.arrayBuffer();
  // Aozora XHTML files are Shift-JIS encoded — use encoding-japanese
  // since Hermes's TextDecoder doesn't support shift-jis
  const uint8 = new Uint8Array(buffer);
  const unicodeArray = Encoding.convert(uint8, { to: "UNICODE", from: "SJIS" });
  const html = Encoding.codeToString(unicodeArray);

  // Extract <div class="main_text"> content
  const mainTextMatch = html.match(
    /<div[^>]+class="main_text"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]+class="bibliographical_information"/,
  );
  if (mainTextMatch) {
    return mainTextMatch[1].trim();
  }

  // Fallback: try to find main_text div without the bibliographical boundary
  const fallbackMatch = html.match(/<div[^>]+class="main_text"[^>]*>([\s\S]*?)<\/div>\s*$/m);
  if (fallbackMatch) {
    return fallbackMatch[1].trim();
  }

  // Last resort: return the body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  return bodyMatch ? bodyMatch[1].trim() : html;
}

export function getAuthorName(book: AozoraBook): string {
  if (book.authors.length === 0) return "";
  const a = book.authors[0];
  return `${a.lastName} ${a.firstName}`.trim();
}
