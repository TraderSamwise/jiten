import type { WrappedUserDb } from "@/db/user-db";
import type { CardFace, FlashcardMode } from "@/db/types";

// ─── Export file schema ───

export type JitenExportEntry =
  | { entryId: number; addedAt: string }
  | { kanjiLiteral: string; addedAt: string };

export interface JitenExportFile {
  format: "jiten-list-v1" | "jiten-list-v2";
  exportedAt: string;

  list: {
    name: string;
    description: string | null;
    flashcardMode: FlashcardMode;
    frontFaces: CardFace[];
    backFaces: CardFace[];
    autoPlayAudio: boolean;
  };

  entries: JitenExportEntry[];

  studyHistory?: {
    studyPosition: number;
    srsCards?: {
      entryId: number;
      kanjiLiteral?: string;
      due: string;
      stability: number;
      difficulty: number;
      elapsedDays: number;
      scheduledDays: number;
      reps: number;
      lapses: number;
      state: number;
      lastReview: string | null;
      frontMode: string;
      backMode: string;
      createdAt: string;
      updatedAt: string;
      reviewLogs: {
        rating: number;
        state: number;
        due: string;
        stability: number;
        difficulty: number;
        elapsedDays: number;
        scheduledDays: number;
        reviewedAt: string;
      }[];
    }[];
  };

  simpleSrsData?: {
    studyPosition: number;
    cards: {
      entryId: number;
      kanjiLiteral?: string;
      stage: number;
      n: number;
      interval: number;
    }[];
  };
}

// ─── Export ───

export async function buildListExport(
  userDb: WrappedUserDb,
  listId: string,
  includeStudyHistory: boolean,
): Promise<JitenExportFile> {
  const listRow = await userDb.getFirstAsync<any>("SELECT * FROM lists WHERE id = ?", [listId]);
  if (!listRow) throw new Error("List not found");

  const rawFront = listRow.front_faces ?? listRow.frontFaces;
  const rawBack = listRow.back_faces ?? listRow.backFaces;
  const frontFaces: CardFace[] =
    typeof rawFront === "string" ? JSON.parse(rawFront) : (rawFront ?? ["kanji"]);
  const backFaces: CardFace[] =
    typeof rawBack === "string" ? JSON.parse(rawBack) : (rawBack ?? ["english"]);

  const flashcardMode = listRow.flashcard_mode ?? listRow.flashcardMode ?? "add_order";

  const result: JitenExportFile = {
    format: "jiten-list-v2",
    exportedAt: new Date().toISOString(),
    list: {
      name: listRow.name,
      description: listRow.description ?? null,
      flashcardMode,
      frontFaces,
      backFaces,
      autoPlayAudio: Boolean(listRow.auto_play_audio ?? listRow.autoPlayAudio ?? 0),
    },
    entries: [],
  };

  const entryRows = await userDb.getAllAsync<{
    entry_id: number;
    kanji_literal: string | null;
    added_at: string;
  }>(
    "SELECT entry_id, kanji_literal, added_at FROM list_entries WHERE list_id = ? ORDER BY position ASC, added_at ASC, id ASC",
    [listId],
  );
  result.entries = entryRows.map((r) => {
    if (r.kanji_literal != null) {
      return { kanjiLiteral: r.kanji_literal, addedAt: r.added_at };
    }
    return { entryId: r.entry_id, addedAt: r.added_at };
  });

  if (includeStudyHistory) {
    const studyPosition = listRow.study_position ?? listRow.studyPosition ?? 0;

    if (flashcardMode === "simple_srs") {
      // Export simple SRS data
      const srsRows = await userDb.getAllAsync<any>(
        "SELECT entry_id, kanji_literal, simple_stage, simple_n, simple_interval FROM srs_cards WHERE list_id = ? AND simple_stage IS NOT NULL",
        [listId],
      );

      result.simpleSrsData = {
        studyPosition,
        cards: srsRows.map((card: any) => {
          const base: any = {
            entryId: card.entry_id,
            stage: card.simple_stage,
            n: card.simple_n,
            interval: card.simple_interval,
          };
          if (card.kanji_literal != null) base.kanjiLiteral = card.kanji_literal;
          return base;
        }),
      };
    } else {
      // Export FSRS data
      const srsRows = await userDb.getAllAsync<any>("SELECT * FROM srs_cards WHERE list_id = ?", [
        listId,
      ]);

      const srsCards = [];
      for (const card of srsRows) {
        const logRows = await userDb.getAllAsync<any>(
          "SELECT * FROM review_logs WHERE card_id = ? ORDER BY reviewed_at ASC",
          [card.id],
        );

        const srsCard: any = {
          entryId: card.entry_id,
          due: card.due,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsedDays: card.elapsed_days,
          scheduledDays: card.scheduled_days,
          reps: card.reps,
          lapses: card.lapses,
          state: card.state,
          lastReview: card.last_review ?? null,
          frontMode: card.front_mode,
          backMode: card.back_mode,
          createdAt: card.created_at,
          updatedAt: card.updated_at,
          reviewLogs: logRows.map((log: any) => ({
            rating: log.rating,
            state: log.state,
            due: log.due,
            stability: log.stability,
            difficulty: log.difficulty,
            elapsedDays: log.elapsed_days,
            scheduledDays: log.scheduled_days,
            reviewedAt: log.reviewed_at,
          })),
        };
        if (card.kanji_literal != null) srsCard.kanjiLiteral = card.kanji_literal;
        srsCards.push(srsCard);
      }

      result.studyHistory = { studyPosition, srsCards };
    }
  }

  return result;
}

// ─── Parse / validate ───

export function parseListImport(json: string): JitenExportFile {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON file");
  }

  if (data.format !== "jiten-list-v1" && data.format !== "jiten-list-v2") {
    throw new Error("Unrecognized file format");
  }
  if (!data.list || !data.list.name) {
    throw new Error("Missing list data");
  }
  if (!Array.isArray(data.entries)) {
    throw new Error("Missing entries data");
  }

  return data as JitenExportFile;
}

// ─── Import ───

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function isKanjiEntry(entry: JitenExportEntry): entry is { kanjiLiteral: string; addedAt: string } {
  return "kanjiLiteral" in entry;
}

export async function importListToDb(
  userDb: WrappedUserDb,
  data: JitenExportFile,
  importStudyHistory: boolean,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const listId = generateId();
  const now = new Date().toISOString();

  // Check for name conflicts
  let name = data.list.name;
  const existing = await userDb.getFirstAsync<{ id: string }>(
    "SELECT id FROM lists WHERE name = ? AND deleted_at IS NULL",
    [name],
  );
  if (existing) {
    name = `${name} (imported)`;
  }

  // Create list
  const hasStudyData = importStudyHistory && (data.studyHistory || data.simpleSrsData);
  const studyPosition = hasStudyData
    ? (data.simpleSrsData?.studyPosition ?? data.studyHistory?.studyPosition ?? 0)
    : 0;
  const configured = hasStudyData ? 1 : 0;

  await userDb.runAsync(
    `INSERT OR IGNORE INTO lists (id, name, description, flashcard_mode, front_faces, back_faces, study_position, configured, auto_play_audio, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      listId,
      name,
      data.list.description,
      data.list.flashcardMode,
      JSON.stringify(data.list.frontFaces),
      JSON.stringify(data.list.backFaces),
      studyPosition,
      configured,
      data.list.autoPlayAudio ? 1 : 0,
      now,
      now,
    ],
  );

  // Wrap all inserts in a single transaction to avoid per-statement journal syncs
  await userDb.runAsync("BEGIN");
  try {
    // Insert entries
    const totalEntries = data.entries.length;
    for (let i = 0; i < totalEntries; i++) {
      const entry = data.entries[i];
      if (isKanjiEntry(entry)) {
        await userDb.runAsync(
          "INSERT OR IGNORE INTO list_entries (id, list_id, entry_id, kanji_literal, added_at, position, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)",
          [generateId(), listId, entry.kanjiLiteral, entry.addedAt, i, now],
        );
      } else {
        await userDb.runAsync(
          "INSERT OR IGNORE INTO list_entries (id, list_id, entry_id, added_at, position, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [generateId(), listId, entry.entryId, entry.addedAt, i, now],
        );
      }
      if (onProgress && i % 100 === 0) {
        onProgress(totalEntries > 0 ? i / totalEntries : 0);
      }
    }

    // Import simple SRS data
    if (importStudyHistory && data.simpleSrsData?.cards) {
      for (const card of data.simpleSrsData.cards) {
        const cardId = generateId();
        const kanjiLiteral = "kanjiLiteral" in card ? ((card as any).kanjiLiteral ?? null) : null;
        const entryId = kanjiLiteral != null ? 0 : card.entryId;
        await userDb.runAsync(
          `INSERT OR IGNORE INTO srs_cards (id, entry_id, kanji_literal, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, front_mode, back_mode, simple_stage, simple_n, simple_interval, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cardId,
            entryId,
            kanjiLiteral,
            listId,
            now, // due (placeholder for FSRS, not used in simple mode)
            0, // stability
            0, // difficulty
            0, // elapsed_days
            0, // scheduled_days
            0, // reps
            0, // lapses
            0, // state
            "kanji", // front_mode
            "english", // back_mode
            card.stage,
            card.n,
            card.interval,
            now,
            now,
          ],
        );
      }

      // Also create srs_cards for entries without SRS data (unseen cards)
      const srsEntryKeys = new Set(
        data.simpleSrsData.cards.map((c) =>
          "kanjiLiteral" in c && (c as any).kanjiLiteral
            ? `k:${(c as any).kanjiLiteral}`
            : `e:${c.entryId}`,
        ),
      );
      for (const entry of data.entries) {
        const key = isKanjiEntry(entry) ? `k:${entry.kanjiLiteral}` : `e:${entry.entryId}`;
        if (!srsEntryKeys.has(key)) {
          const kanjiLiteral = isKanjiEntry(entry) ? entry.kanjiLiteral : null;
          const entryId = isKanjiEntry(entry) ? 0 : entry.entryId;
          await userDb.runAsync(
            `INSERT OR IGNORE INTO srs_cards (id, entry_id, kanji_literal, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, front_mode, back_mode, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              generateId(),
              entryId,
              kanjiLiteral,
              listId,
              now,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              "kanji",
              "english",
              now,
              now,
            ],
          );
        }
      }
    }

    // Import FSRS SRS data
    if (importStudyHistory && data.studyHistory?.srsCards) {
      for (const card of data.studyHistory.srsCards) {
        const cardId = generateId();
        const kanjiLiteral = card.kanjiLiteral ?? null;
        const entryId = kanjiLiteral != null ? 0 : card.entryId;
        await userDb.runAsync(
          `INSERT OR IGNORE INTO srs_cards (id, entry_id, kanji_literal, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, front_mode, back_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cardId,
            entryId,
            kanjiLiteral,
            listId,
            card.due,
            card.stability,
            card.difficulty,
            card.elapsedDays,
            card.scheduledDays,
            card.reps,
            card.lapses,
            card.state,
            card.lastReview,
            card.frontMode,
            card.backMode,
            card.createdAt,
            card.updatedAt,
          ],
        );

        for (const log of card.reviewLogs) {
          await userDb.runAsync(
            `INSERT OR IGNORE INTO review_logs (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              generateId(),
              cardId,
              log.rating,
              log.state,
              log.due,
              log.stability,
              log.difficulty,
              log.elapsedDays,
              log.scheduledDays,
              log.reviewedAt,
            ],
          );
        }
      }
    }

    onProgress?.(1);
    await userDb.runAsync("COMMIT");
  } catch (e) {
    await userDb.runAsync("ROLLBACK");
    throw e;
  }

  return listId;
}
