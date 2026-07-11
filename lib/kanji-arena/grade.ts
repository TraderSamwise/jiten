import type { Card as FsrsCard } from "ts-fsrs";

import { generateId } from "@/db/helpers";
import type { WrappedUserDb } from "@/db/user-db";
import { getFsrsInstance, Rating, reviewCard } from "@/stores/srs";
import {
  SIMPLE_SRS_REQUIRED_CORRECT,
  simpleGraduate,
  simpleInitCard,
  simpleReviewFail,
} from "@/stores/simple-srs";
import type { SrsCardRow } from "@/db/types";

interface GradeRow extends SrsCardRow {
  flashcardMode: string;
  listLearningSteps: string | null;
  listRelearningSteps: string | null;
}

// Consecutive-correct count per card id, replicating study.tsx's in-memory
// simpleCorrectCountRef (session-scoped, resets on reload — same as the screen).
const simpleCorrect = new Map<string, number>();

function parseSteps(json: string | null): string[] | undefined {
  if (!json) return undefined;
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : undefined;
  } catch {
    return undefined;
  }
}

const CARD_SQL = `SELECT c.id, c.entry_id as entryId, c.kanji_literal as kanjiLiteral, c.list_id as listId,
    c.due, c.stability, c.difficulty, c.elapsed_days as elapsedDays,
    c.scheduled_days as scheduledDays, c.reps, c.lapses, c.state,
    c.last_review as lastReview, c.learning_steps as learningSteps,
    c.simple_stage as simpleStage, c.simple_n as simpleN, c.simple_interval as simpleInterval,
    l.flashcard_mode as flashcardMode,
    l.learning_steps as listLearningSteps, l.relearning_steps as listRelearningSteps
  FROM srs_cards c JOIN lists l ON l.id = c.list_id
  WHERE c.kanji_literal = ? AND c.list_id = ? AND c.deleted_at IS NULL
    AND l.flashcard_mode IN ('srs', 'simple_srs')`;

// Grade the drilled kanji's card in the list being played, by that list's
// algorithm. A new kanji has no srs_cards row yet, so graded mode enrolls it
// first (mirrors study.tsx's lazy INSERT) — playing a fresh lesson list actually
// starts learning it. correct -> Good/pass, wrong -> Again/fail.
export async function gradeKanjiCard(
  userDb: WrappedUserDb,
  kanjiLiteral: string,
  correct: boolean,
  listId: string,
): Promise<void> {
  let rows = await userDb.getAllAsync<GradeRow>(CARD_SQL, [kanjiLiteral, listId]);
  if (rows.length === 0) {
    const list = await userDb.getFirstAsync<{ flashcardMode: string }>(
      `SELECT flashcard_mode as flashcardMode FROM lists WHERE id = ?`,
      [listId],
    );
    if (!list || list.flashcardMode === "add_order") return;
    const now = new Date().toISOString();
    await userDb.runAsync(
      `INSERT OR IGNORE INTO srs_cards (id, entry_id, kanji_literal, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, front_mode, back_mode, created_at, updated_at)
       VALUES (?, 0, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 'kanji', 'english', ?, ?)`,
      [generateId(), kanjiLiteral, listId, now, now, now],
    );
    rows = await userDb.getAllAsync<GradeRow>(CARD_SQL, [kanjiLiteral, listId]);
  }
  for (const row of rows) {
    if (row.flashcardMode === "srs") await gradeFsrs(userDb, row, correct);
    else await gradeSimple(userDb, row, correct);
  }
}

async function gradeFsrs(userDb: WrappedUserDb, card: GradeRow, correct: boolean): Promise<void> {
  const rating = correct ? Rating.Good : Rating.Again;
  const instance = getFsrsInstance(
    parseSteps(card.listLearningSteps),
    parseSteps(card.listRelearningSteps),
  );
  const fsrsCard: FsrsCard = {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
    learning_steps: card.learningSteps,
  };
  const updated = reviewCard(fsrsCard, rating, undefined, instance).card;
  const now = new Date().toISOString();

  await userDb.runAsync(
    `UPDATE srs_cards SET
       due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
       reps = ?, lapses = ?, state = ?, last_review = ?, learning_steps = ?, updated_at = ?
     WHERE id = ?`,
    [
      updated.due.toISOString(),
      updated.stability,
      updated.difficulty,
      updated.elapsed_days,
      updated.scheduled_days,
      updated.reps,
      updated.lapses,
      updated.state,
      updated.last_review?.toISOString() ?? now,
      updated.learning_steps,
      now,
      card.id,
    ],
  );

  // review_logs snapshots the PRE-review values (matches study.tsx).
  await userDb.runAsync(
    `INSERT OR IGNORE INTO review_logs
       (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      card.id,
      rating,
      card.state,
      card.due,
      card.stability,
      card.difficulty,
      card.elapsedDays,
      card.scheduledDays,
      now,
    ],
  );
}

async function gradeSimple(userDb: WrappedUserDb, card: GradeRow, correct: boolean): Promise<void> {
  const now = new Date().toISOString();
  const isNew = card.simpleStage == null;
  let updates: { simpleStage: number; simpleN: number; simpleInterval: number };

  if (!correct) {
    updates = isNew ? simpleInitCard() : simpleReviewFail(card);
    simpleCorrect.set(card.id, 0);
  } else if (isNew) {
    updates = simpleInitCard();
    simpleCorrect.set(card.id, 1);
  } else if (card.simpleStage === 1) {
    updates = simpleGraduate(card, false, card.lapses > 0);
    simpleCorrect.delete(card.id);
  } else {
    const count = (simpleCorrect.get(card.id) ?? 0) + 1;
    simpleCorrect.set(card.id, count);
    if (count >= SIMPLE_SRS_REQUIRED_CORRECT) {
      updates = simpleGraduate(card, false, card.lapses > 0);
      simpleCorrect.delete(card.id);
    } else {
      updates = { simpleStage: 0, simpleN: 0, simpleInterval: card.simpleInterval ?? 0 };
    }
  }

  await userDb.runAsync(
    `UPDATE srs_cards SET simple_stage = ?, simple_n = ?, simple_interval = ?,
       reps = reps + 1, lapses = lapses + ?, updated_at = ? WHERE id = ?`,
    [updates.simpleStage, updates.simpleN, updates.simpleInterval, correct ? 0 : 1, now, card.id],
  );
}
