import type { WrappedUserDb } from "@/db/user-db";
import type { WordList } from "@/db/types";
import { getLogicalToday } from "./day-boundary";

export const SMART_PREFIX = "_smart_";
export const MARKED_PREFIX = "_marked_";

// 7-day half-life for time-decay of flag/fail events. Flagged-today events
// dominate; week-old events contribute half; older still drops off fast.
export const PRIORITY_HALF_LIFE_DAYS = 7;

// Base epoch for synthesised list_entries.added_at / srs_cards.created_at
// timestamps. Picking 2000-01-01 puts all priority-ordered rows safely before
// any "real" timestamps the user could observe, and gives 68 years of 1-second
// rank slots before overflowing into the present.
const PRIORITY_BASE_ISO = "2000-01-01T00:00:00.000Z";
const PRIORITY_BASE_MS = Date.parse(PRIORITY_BASE_ISO);

export function smartListIdFor(sourceListId: string): string {
  return `${SMART_PREFIX}${sourceListId}`;
}

export function sourceListIdFromSmart(smartListId: string): string | null {
  return smartListId.startsWith(SMART_PREFIX) ? smartListId.slice(SMART_PREFIX.length) : null;
}

export function isSmartListId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(SMART_PREFIX);
}

export function isMarkedListId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(MARKED_PREFIX);
}

export function isEphemeralListId(id: string | null | undefined): boolean {
  return isSmartListId(id) || isMarkedListId(id);
}

function windowStartIso(days: number, resetHour: number): string {
  const today = getLogicalToday(resetHour);
  const start = new Date(`${today}T00:00:00Z`);
  // Inclusive window: "7 days" means today + the previous 6 logical days.
  // Subtracting `days` directly would yield an 8-day span.
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  return start.toISOString();
}

function decayWeight(eventIso: string, nowMs: number): number {
  const dt = Math.max(0, nowMs - Date.parse(eventIso));
  const days = dt / 86_400_000;
  return Math.pow(0.5, days / PRIORITY_HALF_LIFE_DAYS);
}

export interface SmartCandidate {
  entryId: number;
  kanjiLiteral: string | null;
  score: number;
  mostRecentMs: number;
}

/**
 * Count distinct cards flagged on `sourceListId` within the last `days` logical
 * days. Cheap probe for the UI to decide whether to surface the CTA.
 */
export async function countMarkedInWindow(
  userDb: WrappedUserDb,
  sourceListId: string,
  days: number,
  resetHour: number,
): Promise<number> {
  const start = windowStartIso(days, resetHour);
  const row = await userDb.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT entry_id || ':' || COALESCE(kanji_literal, '')) as n
     FROM review_marks
     WHERE list_id = ? AND marked_at >= ?`,
    [sourceListId, start],
  );
  return row?.n ?? 0;
}

/**
 * Rank the cards eligible for a smart-review session of `sourceListId`.
 *
 * Selection: distinct cards flagged on `sourceListId` within the window.
 * Score: time-decayed sum of flag events (within window) + fail events
 *   (all-time, from review_logs joined via srs_cards on the source list with
 *   rating=1 "Again"). Half-life is PRIORITY_HALF_LIFE_DAYS.
 * Sort: score DESC, tie-break by most recent flag DESC.
 *
 * Exported for testability; callers normally use `getOrCreateSmartList`.
 */
export async function rankSmartCandidates(
  userDb: WrappedUserDb,
  sourceListId: string,
  days: number,
  resetHour: number,
  nowMs: number = Date.now(),
): Promise<SmartCandidate[]> {
  const startIso = windowStartIso(days, resetHour);

  const flagRows = await userDb.getAllAsync<{
    entry_id: number;
    kanji_literal: string | null;
    marked_at: string;
  }>(
    `SELECT entry_id, kanji_literal, marked_at FROM review_marks
     WHERE list_id = ? AND marked_at >= ?`,
    [sourceListId, startIso],
  );
  if (flagRows.length === 0) return [];

  const failRows = await userDb.getAllAsync<{
    entry_id: number;
    kanji_literal: string | null;
    reviewed_at: string;
  }>(
    `SELECT c.entry_id, c.kanji_literal, l.reviewed_at
     FROM review_logs l
     JOIN srs_cards c ON c.id = l.card_id
     WHERE c.list_id = ? AND l.rating = 1 AND c.deleted_at IS NULL`,
    [sourceListId],
  );

  type Bucket = {
    entryId: number;
    kanjiLiteral: string | null;
    score: number;
    mostRecentMs: number;
  };
  const map = new Map<string, Bucket>();
  const keyOf = (eid: number, kl: string | null) => `${eid}|${kl ?? ""}`;

  for (const r of flagRows) {
    const k = keyOf(r.entry_id, r.kanji_literal);
    const b = map.get(k) ?? {
      entryId: r.entry_id,
      kanjiLiteral: r.kanji_literal,
      score: 0,
      mostRecentMs: 0,
    };
    b.score += decayWeight(r.marked_at, nowMs);
    const t = Date.parse(r.marked_at);
    if (t > b.mostRecentMs) b.mostRecentMs = t;
    map.set(k, b);
  }

  // Fails only contribute for cards already in the candidate set — fails on
  // cards that haven't been flagged don't pull them in.
  for (const r of failRows) {
    const k = keyOf(r.entry_id, r.kanji_literal);
    const b = map.get(k);
    if (!b) continue;
    b.score += decayWeight(r.reviewed_at, nowMs);
  }

  return [...map.values()].sort((a, b) => b.score - a.score || b.mostRecentMs - a.mostRecentMs);
}

function makeId(prefix: string, entryId: number, kanji: string | null): string {
  return `${prefix}-${entryId}-${kanji ?? ""}-${Math.random().toString(36).slice(2, 8)}`;
}

function priorityTimestamp(rank: number): string {
  return new Date(PRIORITY_BASE_MS + rank * 1000).toISOString();
}

/**
 * Idempotent create/refresh of a per-source smart-review list.
 *
 * Behavior:
 * - Creates `_smart_${sourceListId}` if missing, inheriting visual settings
 *   (front/back faces, audio, animations) from the source list but always
 *   using `simple_srs` mode so the pass/fail UX is available.
 * - Computes priority ranking via {@link rankSmartCandidates}, then upserts
 *   list_entries and srs_cards so the new-card pool surfaces highest-priority
 *   cards first. `list_entries.added_at` and `srs_cards.created_at` get
 *   synthesised timestamps ordered by rank.
 * - Cards already past the "new" stage (simple_stage IS NOT NULL) are not
 *   re-ranked — their SRS state and queue position is preserved.
 * - Cards present in the smart list but no longer in the current window remain;
 *   they just don't get re-ranked. (Additive refresh.)
 *
 * Returns the smart list id.
 */
export async function getOrCreateSmartList(
  userDb: WrappedUserDb,
  sourceList: WordList,
  days: number,
  resetHour: number,
): Promise<string> {
  const smartId = smartListIdFor(sourceList.id);
  const now = new Date().toISOString();

  const existing = await userDb.getFirstAsync<{ id: string }>(`SELECT id FROM lists WHERE id = ?`, [
    smartId,
  ]);

  if (!existing) {
    await userDb.runAsync(
      `INSERT OR IGNORE INTO lists (
         id, name, description, flashcard_mode,
         front_faces, back_faces, configured,
         study_position, auto_play_audio, confusion_detection,
         voice_mode, typing_mode,
         disable_flip_animation, disable_swipe_animation,
         is_default, learning_steps, relearning_steps,
         created_at, updated_at
       ) VALUES (?, ?, '', 'simple_srs', ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
      [
        smartId,
        `Smart Review — ${sourceList.name}`,
        JSON.stringify(sourceList.frontFaces),
        JSON.stringify(sourceList.backFaces),
        sourceList.autoPlayAudio ? 1 : 0,
        sourceList.confusionDetection ? 1 : 0,
        sourceList.voiceMode ? 1 : 0,
        sourceList.typingMode ? 1 : 0,
        sourceList.disableFlipAnimation ? 1 : 0,
        sourceList.disableSwipeAnimation ? 1 : 0,
        now,
        now,
      ],
    );
  } else {
    await userDb.runAsync(`UPDATE lists SET updated_at = ?, deleted_at = NULL WHERE id = ?`, [
      now,
      smartId,
    ]);
  }

  const ranked = await rankSmartCandidates(userDb, sourceList.id, days, resetHour);
  if (ranked.length === 0) return smartId;

  const existingEntries = await userDb.getAllAsync<{
    entry_id: number;
    kanji_literal: string | null;
  }>(
    `SELECT entry_id, kanji_literal FROM list_entries
     WHERE list_id = ? AND deleted_at IS NULL`,
    [smartId],
  );
  const existingEntryKeys = new Set(
    existingEntries.map((r) => `${r.entry_id}|${r.kanji_literal ?? ""}`),
  );

  const existingCards = await userDb.getAllAsync<{
    id: string;
    entry_id: number;
    kanji_literal: string | null;
    simple_stage: number | null;
  }>(
    `SELECT id, entry_id, kanji_literal, simple_stage
     FROM srs_cards WHERE list_id = ? AND deleted_at IS NULL`,
    [smartId],
  );
  const cardByKey = new Map<string, { id: string; simple_stage: number | null }>(
    existingCards.map((c) => [`${c.entry_id}|${c.kanji_literal ?? ""}`, c]),
  );

  for (let rank = 0; rank < ranked.length; rank++) {
    const cand = ranked[rank];
    const key = `${cand.entryId}|${cand.kanjiLiteral ?? ""}`;
    const ts = priorityTimestamp(rank);

    if (existingEntryKeys.has(key)) {
      await userDb.runAsync(
        `UPDATE list_entries SET added_at = ?, updated_at = ?, deleted_at = NULL
         WHERE list_id = ? AND entry_id = ?
           AND ((kanji_literal IS NULL AND ? IS NULL) OR kanji_literal = ?)`,
        [ts, now, smartId, cand.entryId, cand.kanjiLiteral, cand.kanjiLiteral],
      );
    } else {
      await userDb.runAsync(
        `INSERT OR IGNORE INTO list_entries (id, list_id, entry_id, kanji_literal, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          makeId(smartId, cand.entryId, cand.kanjiLiteral),
          smartId,
          cand.entryId,
          cand.kanjiLiteral,
          ts,
          now,
        ],
      );
    }

    const card = cardByKey.get(key);
    if (!card) {
      // New card — insert as "new" (simple_stage NULL). created_at carries
      // priority so the new-card pool's ORDER BY created_at ASC surfaces
      // highest priority first.
      await userDb.runAsync(
        `INSERT OR IGNORE INTO srs_cards (
           id, entry_id, kanji_literal, list_id,
           due, stability, difficulty, elapsed_days, scheduled_days,
           reps, lapses, state, front_mode, back_mode,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 'kanji', 'english', ?, ?)`,
        [
          makeId(`${smartId}-srs`, cand.entryId, cand.kanjiLiteral),
          cand.entryId,
          cand.kanjiLiteral,
          smartId,
          ts,
          ts,
          now,
        ],
      );
    } else if (card.simple_stage == null) {
      // Existing but still in "new" pool — update created_at to new rank so
      // priority reflects the latest signal.
      await userDb.runAsync(`UPDATE srs_cards SET created_at = ?, updated_at = ? WHERE id = ?`, [
        ts,
        now,
        card.id,
      ]);
    }
    // Past-new cards (simple_stage NOT NULL): leave alone. Their queue
    // position is now driven by simple_n / due time.
  }

  return smartId;
}

/**
 * Drop stale (`updated_at < now - idleDays`) and orphaned (source list missing)
 * `_smart_%` lists, along with their srs_cards and list_entries.
 *
 * Order matters: srs_cards.list_id is `ON DELETE SET NULL`, so we delete the
 * cards *before* their parent smart list. Otherwise the FK trigger nulls the
 * link and we can't reach the rows afterward.
 */
export async function cleanupOrphanedSmartLists(
  userDb: WrappedUserDb,
  idleDays: number = 30,
): Promise<void> {
  const targets = `
    SELECT id FROM lists
    WHERE id LIKE '\\_smart\\_%' ESCAPE '\\'
      AND (
        updated_at < datetime('now', '-' || ? || ' days')
        OR substr(id, ?) NOT IN (SELECT id FROM lists)
      )
  `;
  const args = [idleDays, SMART_PREFIX.length + 1];

  await userDb.runAsync(`DELETE FROM srs_cards WHERE list_id IN (${targets})`, args);
  await userDb.runAsync(`DELETE FROM list_entries WHERE list_id IN (${targets})`, args);
  await userDb.runAsync(`DELETE FROM lists WHERE id IN (${targets})`, args);

  // Belt-and-braces: drop orphans left by an earlier code path that deleted a
  // smart list without cascading. srs_cards.list_id SET NULL hides the
  // link once the parent is gone, so we can only catch rows whose list_id
  // still references a missing _smart_ id (e.g. deletes from list_entries).
  await userDb.runAsync(
    `DELETE FROM list_entries
     WHERE list_id LIKE '\\_smart\\_%' ESCAPE '\\'
       AND list_id NOT IN (SELECT id FROM lists)`,
  );
}
