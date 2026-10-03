/**
 * The English Wiktionary's "Glyph origin" for a set of kanji, as plain prose.
 *
 * Wiktionary is CC BY-SA 4.0 (see THIRD_PARTY_NOTICES.md) — the same licence as
 * the dictionary data this build already ships. One request per character, so
 * the responses are cached on disk: a re-run costs nothing, and a rebuild does
 * not hammer the API.
 */
import * as fs from "fs";
import * as path from "path";

import { wikitextToPlain } from "../../lib/wikitext";
import { CACHE_DIR } from "../lib/download";

const CACHE_PATH = path.join(CACHE_DIR, "wiktionary-glyph-origin.json");
const ENDPOINT = "https://en.wiktionary.org/w/rest.php/v1/page/";
const USER_AGENT = "jiten-dictionary-build/1.0 (https://github.com/TraderSamwise/jiten)";
const CONCURRENCY = 4;

/** The section sits at several heading depths, and not every kanji has one. */
export function glyphOriginSection(source: string): string | null {
  const match = /^=+\s*Glyph origin\s*=+[ \t]*$\n([\s\S]*?)(?=^=|$(?![\s\S]))/m.exec(source);
  return match ? match[1].trim() : null;
}

async function fetchOne(literal: string): Promise<string | null> {
  const url = ENDPOINT + encodeURIComponent(literal);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { source?: string };
    const section = glyphOriginSection(body.source ?? "");
    if (!section) return null;
    return wikitextToPlain(section) || null;
  }
  return null;
}

type Cache = Record<string, string | null>;

function readCache(): Cache {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as Cache;
  } catch {
    return {};
  }
}

/**
 * A plain-prose glyph origin per literal, absent for the characters Wiktionary
 * has no section for. A failed request caches nothing, so the next run retries
 * it rather than recording a gap that is really an outage.
 */
export async function fetchGlyphOrigins(literals: string[]): Promise<Map<string, string>> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = readCache();
  const missing = literals.filter((literal) => !(literal in cache));

  if (missing.length > 0) {
    console.log(`  Fetching ${missing.length} glyph origins from Wiktionary...`);
    let done = 0;
    const queue = [...missing];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      for (let literal = queue.pop(); literal; literal = queue.pop()) {
        try {
          cache[literal] = await fetchOne(literal);
        } catch (err) {
          console.warn(`    ${literal}: ${String(err)}`);
        }
        if (++done % 200 === 0) {
          console.log(`    ${done}/${missing.length}`);
          fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
        }
      }
    });
    await Promise.all(workers);
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  }

  const out = new Map<string, string>();
  for (const literal of literals) {
    const text = cache[literal];
    if (text) out.set(literal, text);
  }
  return out;
}
