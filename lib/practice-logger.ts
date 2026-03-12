import type { WrappedUserDb } from "@/db/user-db";

export type PracticeMode = "flashcard" | "typing_game" | "typing_flashcard" | "voice";

interface PracticeEvent {
  entryId: number;
  kanjiLiteral?: string | null;
  listId?: string | null;
  practiceMode: PracticeMode;
  correct: boolean;
  assisted?: boolean;
  responseMs?: number | null;
  typedAnswer?: string | null;
  sessionId?: string | null;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export async function logPracticeEvent(userDb: WrappedUserDb, event: PracticeEvent): Promise<void> {
  await userDb.runAsync(
    `INSERT OR IGNORE INTO practice_events (id, entry_id, kanji_literal, list_id, practice_mode, correct, assisted, response_ms, typed_answer, reviewed_at, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      event.entryId,
      event.kanjiLiteral ?? null,
      event.listId ?? null,
      event.practiceMode,
      event.correct ? 1 : 0,
      event.assisted ? 1 : 0,
      event.responseMs ?? null,
      event.typedAnswer ?? null,
      new Date().toISOString(),
      event.sessionId ?? null,
    ],
  );
}

export async function logSessionSummary(
  userDb: WrappedUserDb,
  summary: {
    sessionId: string;
    listId: string;
    practiceMode: PracticeMode;
    startedAt: string;
    durationMs: number;
    totalItems: number;
    correctCount: number;
  },
): Promise<void> {
  await userDb.runAsync(
    `INSERT OR IGNORE INTO practice_sessions (id, session_id, list_id, practice_mode, started_at, duration_ms, total_items, correct_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      summary.sessionId,
      summary.listId,
      summary.practiceMode,
      summary.startedAt,
      summary.durationMs,
      summary.totalItems,
      summary.correctCount,
    ],
  );
}

export type ConfusionType = "visual_kanji" | "reading" | "meaning";

export async function recordConfusion(
  userDb: WrappedUserDb,
  entryA: { entryId: number; kanjiLiteral?: string | null },
  entryB: { entryId: number; kanjiLiteral?: string | null },
  confusionType: ConfusionType,
  listId?: string,
  practiceMode?: PracticeMode,
): Promise<void> {
  const now = new Date().toISOString();
  // Order consistently for dedup
  const [a, b] = entryA.entryId <= entryB.entryId ? [entryA, entryB] : [entryB, entryA];

  const result = await userDb.runAsync(
    `UPDATE confusion_pairs SET confusion_count = confusion_count + 1, last_confused_at = ?
     WHERE entry_id_a = ? AND entry_id_b = ? AND confusion_type = ?
       AND kanji_literal_a IS ? AND kanji_literal_b IS ?`,
    [now, a.entryId, b.entryId, confusionType, a.kanjiLiteral ?? null, b.kanjiLiteral ?? null],
  );

  if (result.changes === 0) {
    await userDb.runAsync(
      `INSERT OR IGNORE INTO confusion_pairs (id, entry_id_a, kanji_literal_a, entry_id_b, kanji_literal_b, confusion_type, confusion_count, last_confused_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        generateId(),
        a.entryId,
        a.kanjiLiteral ?? null,
        b.entryId,
        b.kanjiLiteral ?? null,
        confusionType,
        now,
        now,
      ],
    );
  }

  // Also log timestamped event
  await logConfusionEvent(userDb, a, b, confusionType, now, listId, practiceMode);
}

async function logConfusionEvent(
  userDb: WrappedUserDb,
  entryA: { entryId: number; kanjiLiteral?: string | null },
  entryB: { entryId: number; kanjiLiteral?: string | null },
  confusionType: ConfusionType,
  confusedAt: string,
  listId?: string,
  practiceMode?: PracticeMode,
): Promise<void> {
  await userDb.runAsync(
    `INSERT OR IGNORE INTO confusion_events (id, entry_id_a, kanji_literal_a, entry_id_b, kanji_literal_b, confusion_type, list_id, practice_mode, confused_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      entryA.entryId,
      entryA.kanjiLiteral ?? null,
      entryB.entryId,
      entryB.kanjiLiteral ?? null,
      confusionType,
      listId ?? null,
      practiceMode ?? null,
      confusedAt,
    ],
  );
}
