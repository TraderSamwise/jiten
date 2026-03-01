import type { WrappedUserDb } from "@/db/user-db";

export interface LeechCard {
  entryId: number;
  kanjiLiteral: string | null;
  totalAttempts: number;
  correctCount: number;
  accuracy: number;
}

export async function getLeechCards(
  userDb: WrappedUserDb,
  listId: string,
  minAttempts: number = 10,
  maxAccuracy: number = 0.5,
): Promise<LeechCard[]> {
  return userDb.getAllAsync<LeechCard>(
    `SELECT entry_id as entryId, kanji_literal as kanjiLiteral,
            COUNT(*) as totalAttempts,
            SUM(correct) as correctCount,
            CAST(SUM(correct) AS REAL) / COUNT(*) as accuracy
     FROM (
       SELECT entry_id, kanji_literal, correct FROM practice_events WHERE list_id = ?
       UNION ALL
       SELECT sc.entry_id, sc.kanji_literal, CASE WHEN rl.rating > 1 THEN 1 ELSE 0 END as correct
       FROM review_logs rl
       JOIN srs_cards sc ON sc.id = rl.card_id
       WHERE sc.list_id = ?
     )
     GROUP BY entry_id, kanji_literal
     HAVING totalAttempts >= ? AND accuracy < ?
     ORDER BY accuracy ASC`,
    [listId, listId, minAttempts, maxAccuracy],
  );
}

export async function getLapseBasedLeeches(
  userDb: WrappedUserDb,
  listId: string,
  minLapses: number = 8,
) {
  return userDb.getAllAsync<{ entryId: number; kanjiLiteral: string | null; lapses: number }>(
    `SELECT entry_id as entryId, kanji_literal as kanjiLiteral, lapses
     FROM srs_cards WHERE list_id = ? AND lapses >= ?
     ORDER BY lapses DESC`,
    [listId, minLapses],
  );
}

export async function getEntryPracticeStats(userDb: WrappedUserDb, entryId: number) {
  const row = await userDb.getFirstAsync<{
    total: number;
    correct: number;
    accuracy: number;
    lastPracticed: string | null;
  }>(
    `SELECT COUNT(*) as total,
            SUM(correct) as correct,
            CASE WHEN COUNT(*) > 0 THEN CAST(SUM(correct) AS REAL) / COUNT(*) ELSE 0 END as accuracy,
            MAX(reviewed_at) as lastPracticed
     FROM (
       SELECT correct, reviewed_at FROM practice_events WHERE entry_id = ?
       UNION ALL
       SELECT CASE WHEN rl.rating > 1 THEN 1 ELSE 0 END, rl.reviewed_at
       FROM review_logs rl
       JOIN srs_cards sc ON sc.id = rl.card_id
       WHERE sc.entry_id = ?
     )`,
    [entryId, entryId],
  );
  return row ?? { total: 0, correct: 0, accuracy: 0, lastPracticed: null };
}
