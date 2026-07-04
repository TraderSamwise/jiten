import type * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "./user-db";
import { STOP_WORDS } from "./search";
import { getPrimitivesForKanjiAsync } from "./kanji-search";
import type { KanjiPrimitive } from "./types";

/**
 * Personal primitive↔word co-occurrence index (local-only, rebuildable).
 *
 * For each stored mnemonic, we record which stemmed content words the user wrote
 * against which primitive targets of that kanji. The semantic auto-linker then
 * boosts "this word refers to that primitive" when the user has historically
 * used the word in stories for other kanji sharing the primitive — learning the
 * user's own vocabulary (e.g. they always say "home" for the house primitive).
 *
 * This is derived from user_kanji_notes and never synced.
 */

/** Stable link target for a component: `p<id>` for invented primitives, the glyph for real ones. */
export function targetForPrimitive(p: KanjiPrimitive): string | null {
  if (p.glyph != null) return p.glyph;
  if (p.primitiveId != null) return `p${p.primitiveId}`;
  return null;
}

/**
 * Inflection-stable canonical stem for indexing/matching. Both an inflected form
 * and its base must collapse to the SAME key, so we strip one inflectional suffix
 * then normalize a trailing silent-e and a doubled final consonant — otherwise
 * silent-e roots diverge (make→make vs making→mak). Deliberately fuzzy: a few
 * over-merges are fine given the auto-linker's confidence threshold + no-fight UX.
 */
export function canonicalStem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 2) return w;
  if (w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.endsWith("ing") && w.length > 4) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 3) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 3) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  if (w.length > 2 && w.endsWith("e")) w = w.slice(0, -1);
  if (w.length > 2 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
  return w;
}

/** Content-word stems of a mnemonic, deduped (stop words and <3-char tokens dropped). */
export function extractAssocWords(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue;
    out.add(canonicalStem(raw));
  }
  return [...out];
}

/**
 * Recompute one kanji's association rows. NOT transaction-wrapped, so it can run
 * inside rebuildAllAssociations' single transaction (SQLite has no nested txns).
 */
async function writeNoteAssociations(
  userDb: WrappedUserDb,
  strokesDb: SQLite.SQLiteDatabase | null,
  literal: string,
  mnemonic: string | null,
): Promise<void> {
  // Can't recompute without the primitives tier — leave existing rows intact
  // rather than wiping them until the strokes DB is available.
  if (mnemonic && !strokesDb) return;
  await userDb.runAsync("DELETE FROM primitive_note_assoc WHERE literal = ?", [literal]);
  if (!mnemonic || !strokesDb) return;

  const primitives = await getPrimitivesForKanjiAsync(strokesDb, literal);
  const targets = primitives.map(targetForPrimitive).filter((t): t is string => t != null);
  if (targets.length === 0) return;

  const words = extractAssocWords(mnemonic);
  if (words.length === 0) return;

  const values: string[] = [];
  for (const word of words) {
    for (const target of targets) values.push(literal, word, target);
  }
  // Chunk rows to stay well under SQLite's bound-variable limit for long mnemonics.
  const CHUNK_ROWS = 300;
  for (let i = 0; i < values.length; i += CHUNK_ROWS * 3) {
    const slice = values.slice(i, i + CHUNK_ROWS * 3);
    const placeholders = Array.from({ length: slice.length / 3 }, () => "(?, ?, ?)").join(", ");
    await userDb.runAsync(
      `INSERT OR IGNORE INTO primitive_note_assoc (literal, word, target) VALUES ${placeholders}`,
      slice,
    );
  }
}

/**
 * Recompute the association rows for a single kanji's note (incremental maintenance).
 * Deliberately not wrapped in its own transaction: the user DB is a single connection
 * shared with the sync engine's transactions, so a nested BEGIN would collide. The
 * index is best-effort and rebuildable, so unwrapped statements are safe here.
 */
export async function updateAssociationsForNote(
  userDb: WrappedUserDb,
  strokesDb: SQLite.SQLiteDatabase | null,
  literal: string,
  mnemonic: string | null,
): Promise<void> {
  await writeNoteAssociations(userDb, strokesDb, literal, mnemonic);
}

/** Rebuild the entire index from all stored mnemonics (initial population). */
export async function rebuildAllAssociations(
  userDb: WrappedUserDb,
  strokesDb: SQLite.SQLiteDatabase | null,
): Promise<void> {
  // Without the primitives tier we can't rebuild — leave the existing index intact
  // rather than wiping it while strokes is merely still downloading.
  if (!strokesDb) return;
  const notes = await userDb.getAllAsync<{ literal: string; mnemonic: string }>(
    "SELECT literal, mnemonic FROM user_kanji_notes WHERE mnemonic IS NOT NULL AND mnemonic != '' AND deleted_at IS NULL",
  );
  // Unwrapped (no transaction) to avoid a nested BEGIN on the sync engine's shared
  // connection; a partial rebuild self-heals on the next launch (the backfill flag is
  // only set after this resolves).
  await userDb.runAsync("DELETE FROM primitive_note_assoc");
  for (const note of notes) {
    await writeNoteAssociations(userDb, strokesDb, note.literal, note.mnemonic);
  }
}

/**
 * How strongly the user associates a word with each primitive target, measured as
 * the number of distinct other kanji-stories where the word co-occurred with the
 * target. Returns target → distinct-story count.
 */
export async function getAssociationsForWordAsync(
  userDb: WrappedUserDb,
  word: string,
  excludeLiteral?: string,
): Promise<Map<string, number>> {
  const stem = canonicalStem(word);
  const rows = excludeLiteral
    ? await userDb.getAllAsync<{ target: string; n: number }>(
        "SELECT target, COUNT(DISTINCT literal) AS n FROM primitive_note_assoc WHERE word = ? AND literal != ? GROUP BY target",
        [stem, excludeLiteral],
      )
    : await userDb.getAllAsync<{ target: string; n: number }>(
        "SELECT target, COUNT(DISTINCT literal) AS n FROM primitive_note_assoc WHERE word = ? GROUP BY target",
        [stem],
      );
  return new Map(rows.map((r) => [r.target, r.n]));
}

/**
 * Batch variant: for many words at once, returns canonicalStem → (target → count).
 * One query for the whole story, so the resolver doesn't fire a query per word.
 */
export async function getAssociationsForWordsAsync(
  userDb: WrappedUserDb,
  words: string[],
  excludeLiteral?: string,
): Promise<Map<string, Map<string, number>>> {
  const stems = [...new Set(words.map(canonicalStem))].filter((s) => s.length > 0);
  const result = new Map<string, Map<string, number>>();
  if (stems.length === 0) return result;

  const ph = stems.map(() => "?").join(",");
  const sql = excludeLiteral
    ? `SELECT word, target, COUNT(DISTINCT literal) AS n FROM primitive_note_assoc WHERE word IN (${ph}) AND literal != ? GROUP BY word, target`
    : `SELECT word, target, COUNT(DISTINCT literal) AS n FROM primitive_note_assoc WHERE word IN (${ph}) GROUP BY word, target`;
  const rows = await userDb.getAllAsync<{ word: string; target: string; n: number }>(
    sql,
    excludeLiteral ? [...stems, excludeLiteral] : stems,
  );
  for (const r of rows) {
    let inner = result.get(r.word);
    if (!inner) {
      inner = new Map();
      result.set(r.word, inner);
    }
    inner.set(r.target, r.n);
  }
  return result;
}
