const API_BASE = "https://www.aozorahack.org/api/v0.1";

export interface AozoraBook {
  bookId: number;
  title: string;
  authors: { lastName: string; firstName: string }[];
  textUrl: string | null;
  cardUrl: string;
}

interface AozoraApiBook {
  book_id: number;
  title: string;
  authors: {
    last_name: string;
    first_name: string;
  }[];
  text_url?: string;
  card_url?: string;
}

function mapBook(raw: AozoraApiBook): AozoraBook {
  return {
    bookId: raw.book_id,
    title: raw.title,
    authors: (raw.authors ?? []).map((a) => ({
      lastName: a.last_name ?? "",
      firstName: a.first_name ?? "",
    })),
    textUrl: raw.text_url ?? null,
    cardUrl: raw.card_url ?? "",
  };
}

export async function searchBooks(query: string): Promise<AozoraBook[]> {
  const url = `${API_BASE}/books?title=${encodeURIComponent(query)}&limit=30`;
  const resp = await fetch(url);
  if (!resp.ok) {
    // Try author search as fallback
    const authorUrl = `${API_BASE}/books?author=${encodeURIComponent(query)}&limit=30`;
    const authorResp = await fetch(authorUrl);
    if (!authorResp.ok) throw new Error(`Aozora API error: ${authorResp.status}`);
    const authorData: AozoraApiBook[] = await authorResp.json();
    return authorData.map(mapBook);
  }
  const data: AozoraApiBook[] = await resp.json();

  // Also search by author and merge
  try {
    const authorUrl = `${API_BASE}/books?author=${encodeURIComponent(query)}&limit=15`;
    const authorResp = await fetch(authorUrl);
    if (authorResp.ok) {
      const authorData: AozoraApiBook[] = await authorResp.json();
      const existingIds = new Set(data.map((b) => b.book_id));
      for (const book of authorData) {
        if (!existingIds.has(book.book_id)) {
          data.push(book);
        }
      }
    }
  } catch {}

  return data.map(mapBook);
}

export async function fetchBookMetadata(
  bookId: number,
): Promise<AozoraBook> {
  const resp = await fetch(`${API_BASE}/books/${bookId}`);
  if (!resp.ok) throw new Error(`Aozora API error: ${resp.status}`);
  const raw: AozoraApiBook = await resp.json();
  return mapBook(raw);
}

export async function fetchBookContent(
  textUrl: string,
): Promise<string> {
  // Aozora texts can be Shift-JIS encoded
  const resp = await fetch(textUrl);
  if (!resp.ok) throw new Error(`Failed to download book: ${resp.status}`);

  const buffer = await resp.arrayBuffer();

  // Try UTF-8 first
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return utf8;
  } catch {
    // Fallback to Shift-JIS
    const sjis = new TextDecoder("shift-jis").decode(buffer);
    return sjis;
  }
}

export function getAuthorName(book: AozoraBook): string {
  if (book.authors.length === 0) return "";
  const a = book.authors[0];
  return `${a.lastName} ${a.firstName}`.trim();
}
