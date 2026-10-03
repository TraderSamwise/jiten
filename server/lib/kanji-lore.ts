/**
 * What is known about a character before the model writes anything: where the
 * glyph came from, and the best story the crowd wrote for it.
 *
 * Both are grounding, not content. The glyph origin is Wiktionary's (CC BY-SA
 * 4.0, credited in THIRD_PARTY_NOTICES.md); the crowd story is a learner's, and
 * neither is returned to the device — the model is asked to write its own story
 * with them in view, which is what a tutor who had read them would do.
 *
 * Every lookup here is best-effort. A mnemonic generated without them is a
 * worse mnemonic, not a failed request, so a timeout or an outage degrades to
 * the behaviour this endpoint had before: keyword and primitives alone.
 */
import { createClient, type Client } from "@libsql/client/web";

import { glyphOriginSection, wikitextToPlain } from "../../lib/wikitext";

const WIKTIONARY = "https://en.wiktionary.org/w/rest.php/v1/page/";
const USER_AGENT = "jiten/1.0 (https://github.com/TraderSamwise/jiten)";
const LOOKUP_TIMEOUT_MS = 2_500;
/** One instance serves many requests; a frame looked up twice is common. */
const CACHE_LIMIT = 500;
const CROWD_TABLE = "rtk_crowd_story";

const glyphCache = new Map<string, string | null>();

function remember(literal: string, value: string | null): string | null {
  if (glyphCache.size >= CACHE_LIMIT) glyphCache.clear();
  glyphCache.set(literal, value);
  return value;
}

/** Where the character came from, in Wiktionary's words, rendered as prose. */
export async function glyphOriginFor(literal: string): Promise<string | null> {
  if (glyphCache.has(literal)) return glyphCache.get(literal) ?? null;
  try {
    const res = await fetch(WIKTIONARY + encodeURIComponent(literal), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 404 is an answer — this character has no page — and worth caching.
      if (res.status === 404) return remember(literal, null);
      console.warn(`[kanji-lore] Wiktionary said ${res.status} for ${literal}`);
      return null;
    }
    const body = (await res.json()) as { source?: string };
    const section = glyphOriginSection(body.source ?? "");
    return remember(literal, section ? wikitextToPlain(section) || null : null);
  } catch (err) {
    console.warn(`[kanji-lore] Could not read the glyph origin of ${literal}:`, err);
    return null;
  }
}

let crowdClient: Client | null = null;

function isCrowdDbConfigured(): boolean {
  return !!(process.env.TURSO_QUOTA_DB_URL && process.env.TURSO_QUOTA_DB_TOKEN);
}

/**
 * The best-voted story the crowd wrote for this frame, loaded by
 * `yarn load:crowd-stories`. Absent until that has been run, and absent for a
 * character outside Heisig's index.
 */
export async function crowdStoryFor(literal: string): Promise<string | null> {
  if (!isCrowdDbConfigured()) return null;
  try {
    crowdClient ??= createClient({
      url: process.env.TURSO_QUOTA_DB_URL!,
      authToken: process.env.TURSO_QUOTA_DB_TOKEN!,
    });
    const result = await Promise.race([
      crowdClient.execute({
        sql: `SELECT story FROM ${CROWD_TABLE} WHERE literal = ?`,
        args: [literal],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("crowd story lookup timed out")), LOOKUP_TIMEOUT_MS),
      ),
    ]);
    const story = result.rows[0]?.story;
    return typeof story === "string" && story.length > 0 ? story : null;
  } catch (err) {
    // A missing table is the normal state before the loader has ever run.
    console.warn(`[kanji-lore] Could not read a crowd story for ${literal}:`, err);
    return null;
  }
}
