import type * as SQLite from "expo-sqlite";
import { stemForFts, STOP_WORDS } from "./search";
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

/** Canonical stem for indexing/matching: the shortest base form so "relaxing" ≈ "relax". */
export function canonicalStem(word: string): string {
  const stems = stemForFts(word.toLowerCase());
  return stems.reduce((a, b) => (b.length < a.length ? b : a), word.toLowerCase());
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

/** Recompute the association rows for a single kanji's note (incremental maintenance). */
export async function updateAssociationsForNote(
  userDb: SQLite.SQLiteDatabase,
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

  for (const word of words) {
    for (const target of targets) {
      await userDb.runAsync(
        "INSERT OR IGNORE INTO primitive_note_assoc (literal, word, target) VALUES (?, ?, ?)",
        [literal, word, target],
      );
    }
  }
}

/** Rebuild the entire index from all stored mnemonics (initial population). */
export async function rebuildAllAssociations(
  userDb: SQLite.SQLiteDatabase,
  strokesDb: SQLite.SQLiteDatabase | null,
): Promise<void> {
  if (!strokesDb) {
    await userDb.runAsync("DELETE FROM primitive_note_assoc");
    return;
  }
  const notes = await userDb.getAllAsync<{ literal: string; mnemonic: string }>(
    "SELECT literal, mnemonic FROM user_kanji_notes WHERE mnemonic IS NOT NULL AND mnemonic != '' AND deleted_at IS NULL",
  );
  await userDb.withTransactionAsync(async () => {
    await userDb.runAsync("DELETE FROM primitive_note_assoc");
    for (const note of notes) {
      await updateAssociationsForNote(userDb, strokesDb, note.literal, note.mnemonic);
    }
  });
}

/**
 * How strongly the user associates a word with each primitive target, measured as
 * the number of distinct other kanji-stories where the word co-occurred with the
 * target. Returns target → distinct-story count.
 */
export async function getAssociationsForWordAsync(
  userDb: SQLite.SQLiteDatabase,
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
