import type { WrappedUserDb } from "@/db/user-db";
import type { CardFace, FlashcardMode } from "@/db/types";

// ─── Export file schema ───

export interface JitenExportFile {
  format: "jiten-list-v1";
  exportedAt: string;

  list: {
    name: string;
    description: string | null;
    flashcardMode: FlashcardMode;
    frontFaces: CardFace[];
    backFaces: CardFace[];
    autoPlayAudio: boolean;
  };

  entries: {
    entryId: number;
    addedAt: string;
  }[];

  studyHistory?: {
    studyPosition: number;
    srsCards?: {
      entryId: number;
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

  const entryRows = await userDb.getAllAsync<{ entry_id: number; added_at: string }>(
    "SELECT entry_id, added_at FROM list_entries WHERE list_id = ? ORDER BY added_at ASC",
    [listId],
  );

  const result: JitenExportFile = {
    format: "jiten-list-v1",
    exportedAt: new Date().toISOString(),
    list: {
      name: listRow.name,
      description: listRow.description ?? null,
      flashcardMode: listRow.flashcard_mode ?? listRow.flashcardMode ?? "add_order",
      frontFaces,
      backFaces,
      autoPlayAudio: Boolean(listRow.auto_play_audio ?? listRow.autoPlayAudio ?? 0),
    },
    entries: entryRows.map((r) => ({
      entryId: r.entry_id,
      addedAt: r.added_at,
    })),
  };

  if (includeStudyHistory) {
    const studyPosition = listRow.study_position ?? listRow.studyPosition ?? 0;

    const srsRows = await userDb.getAllAsync<any>("SELECT * FROM srs_cards WHERE list_id = ?", [
      listId,
    ]);

    const srsCards = [];
    for (const card of srsRows) {
      const logRows = await userDb.getAllAsync<any>(
        "SELECT * FROM review_logs WHERE card_id = ? ORDER BY reviewed_at ASC",
        [card.id],
      );

      srsCards.push({
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
      });
    }

    result.studyHistory = { studyPosition, srsCards };
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

  if (data.format !== "jiten-list-v1") {
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

export async function importListToDb(
  userDb: WrappedUserDb,
  data: JitenExportFile,
  importStudyHistory: boolean,
): Promise<string> {
  const listId = generateId();
  const now = new Date().toISOString();

  // Check for name conflicts
  let name = data.list.name;
  const existing = await userDb.getFirstAsync<{ id: string }>(
    "SELECT id FROM lists WHERE name = ?",
    [name],
  );
  if (existing) {
    name = `${name} (imported)`;
  }

  // Create list
  const studyPosition =
    importStudyHistory && data.studyHistory ? data.studyHistory.studyPosition : 0;
  const configured = importStudyHistory && data.studyHistory ? 1 : 0;

  await userDb.runAsync(
    `INSERT INTO lists (id, name, description, flashcard_mode, front_faces, back_faces, study_position, configured, auto_play_audio, created_at, updated_at)
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

  // Insert entries
  for (const entry of data.entries) {
    await userDb.runAsync(
      "INSERT INTO list_entries (id, list_id, entry_id, added_at) VALUES (?, ?, ?, ?)",
      [generateId(), listId, entry.entryId, entry.addedAt],
    );
  }

  // Import SRS data if requested
  if (importStudyHistory && data.studyHistory?.srsCards) {
    for (const card of data.studyHistory.srsCards) {
      const cardId = generateId();
      await userDb.runAsync(
        `INSERT INTO srs_cards (id, entry_id, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, front_mode, back_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cardId,
          card.entryId,
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
          `INSERT INTO review_logs (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
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

  return listId;
}
