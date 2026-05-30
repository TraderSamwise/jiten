import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { createTestDb } from "@/test/test-db";
import type { WrappedUserDb } from "@/db/user-db";
import type { WordList } from "@/db/types";
import {
  smartListIdFor,
  isSmartListId,
  isMarkedListId,
  isEphemeralListId,
  countMarkedInWindow,
  rankSmartCandidates,
  getOrCreateSmartList,
  cleanupOrphanedSmartLists,
  PRIORITY_HALF_LIFE_DAYS,
} from "./smart-review";

let db: WrappedUserDb & { close: () => void };

function makeSourceList(overrides: Partial<WordList> = {}): WordList {
  return {
    id: "src-1",
    name: "My List",
    description: null,
    flashcardMode: "simple_srs",
    frontFaces: ["kanji"],
    backFaces: ["english"],
    configured: true,
    studyPosition: 0,
    autoPlayAudio: false,
    confusionDetection: true,
    voiceMode: false,
    typingMode: false,
    disableFlipAnimation: false,
    disableSwipeAnimation: false,
    learningSteps: null,
    relearningSteps: null,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function insertSourceListRow(d: WrappedUserDb, list: WordList) {
  await d.runAsync(
    `INSERT INTO lists (
       id, name, description, flashcard_mode, front_faces, back_faces,
       configured, study_position, auto_play_audio, confusion_detection,
       voice_mode, typing_mode, disable_flip_animation, disable_swipe_animation,
       is_default, learning_steps, relearning_steps, created_at, updated_at
     ) VALUES (?, ?, '', ?, ?, ?, 1, 0, 0, 1, 0, 0, 0, 0, 0, NULL, NULL, ?, ?)`,
    [
      list.id,
      list.name,
      list.flashcardMode,
      JSON.stringify(list.frontFaces),
      JSON.stringify(list.backFaces),
      list.createdAt,
      list.updatedAt,
    ],
  );
}

async function insertMark(
  d: WrappedUserDb,
  id: string,
  entryId: number,
  listId: string,
  markedAt: string,
  kanji: string | null = null,
) {
  await d.runAsync(
    `INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, entryId, kanji, listId, markedAt],
  );
}

async function insertSrsCard(
  d: WrappedUserDb,
  id: string,
  entryId: number,
  listId: string,
  kanji: string | null = null,
  createdAt: string = new Date().toISOString(),
) {
  await d.runAsync(
    `INSERT INTO srs_cards (
       id, entry_id, kanji_literal, list_id, due, stability, difficulty,
       elapsed_days, scheduled_days, reps, lapses, state, last_review,
       front_mode, back_mode, simple_stage, simple_n, simple_interval,
       last_confusion_check, learning_steps, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, NULL,
               'kanji', 'english', NULL, NULL, NULL, NULL, 0, ?, ?)`,
    [id, entryId, kanji, listId, createdAt, createdAt, createdAt],
  );
}

async function insertReviewLog(
  d: WrappedUserDb,
  id: string,
  cardId: string,
  rating: number,
  reviewedAt: string,
) {
  await d.runAsync(
    `INSERT INTO review_logs
       (id, card_id, rating, state, due, stability, difficulty,
        elapsed_days, scheduled_days, reviewed_at)
     VALUES (?, ?, ?, 0, ?, 0, 0, 0, 0, ?)`,
    [id, cardId, rating, reviewedAt, reviewedAt],
  );
}

function daysAgoIso(days: number, fromMs: number = Date.now()): string {
  return new Date(fromMs - days * 86_400_000).toISOString();
}

beforeEach(() => {
  if (db) db.close();
  db = createTestDb();
});

afterAll(() => {
  if (db) db.close();
});

describe("id helpers", () => {
  test("smartListIdFor prefixes source id", () => {
    expect(smartListIdFor("abc")).toBe("_smart_abc");
  });

  test("ephemeral detection", () => {
    expect(isSmartListId("_smart_abc")).toBe(true);
    expect(isSmartListId("abc")).toBe(false);
    expect(isMarkedListId("_marked_xyz")).toBe(true);
    expect(isMarkedListId("_smart_abc")).toBe(false);
    expect(isEphemeralListId("_smart_abc")).toBe(true);
    expect(isEphemeralListId("_marked_xyz")).toBe(true);
    expect(isEphemeralListId("normal-list")).toBe(false);
    expect(isEphemeralListId(null)).toBe(false);
    expect(isEphemeralListId(undefined)).toBe(false);
  });
});

describe("countMarkedInWindow", () => {
  test("returns 0 when nothing marked", async () => {
    expect(await countMarkedInWindow(db, "src-1", 7, 3)).toBe(0);
  });

  test("counts unique entry+kanji combos within window", async () => {
    const now = new Date().toISOString();
    await insertMark(db, "m1", 100, "src-1", now);
    await insertMark(db, "m2", 200, "src-1", now);
    await insertMark(db, "m3", 0, "src-1", now, "火");
    expect(await countMarkedInWindow(db, "src-1", 7, 3)).toBe(3);
  });

  test("ignores marks outside the window", async () => {
    await insertMark(db, "m-old", 100, "src-1", daysAgoIso(30));
    expect(await countMarkedInWindow(db, "src-1", 7, 3)).toBe(0);
    expect(await countMarkedInWindow(db, "src-1", 60, 3)).toBe(1);
  });

  test("filters by sourceListId", async () => {
    const now = new Date().toISOString();
    await insertMark(db, "m1", 100, "src-1", now);
    await insertMark(db, "m2", 200, "src-2", now);
    expect(await countMarkedInWindow(db, "src-1", 7, 3)).toBe(1);
    expect(await countMarkedInWindow(db, "src-2", 7, 3)).toBe(1);
  });
});

describe("rankSmartCandidates", () => {
  test("only includes cards flagged in window", async () => {
    await insertSourceListRow(db, makeSourceList());
    const now = new Date().toISOString();
    await insertMark(db, "m1", 100, "src-1", now);
    // Plant a fail for a card that wasn't flagged
    await insertSrsCard(db, "card-X", 999, "src-1");
    await insertReviewLog(db, "log-1", "card-X", 1, now);

    const ranked = await rankSmartCandidates(db, "src-1", 7, 3);
    expect(ranked.map((c) => c.entryId)).toEqual([100]);
  });

  test("multiple flags on the same card boost its score", async () => {
    const now = new Date().toISOString();
    await insertMark(db, "m1a", 100, "src-1", now);
    // Same card, different logical day → second mark allowed
    await insertMark(db, "m1b", 100, "src-1", daysAgoIso(3));
    await insertMark(db, "m1c", 100, "src-1", daysAgoIso(5));
    await insertMark(db, "m2", 200, "src-1", now);

    const ranked = await rankSmartCandidates(db, "src-1", 14, 3);
    expect(ranked[0].entryId).toBe(100);
    expect(ranked[1].entryId).toBe(200);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  test("fails (rating=1) boost score for flagged cards", async () => {
    await insertSourceListRow(db, makeSourceList());
    const now = new Date().toISOString();
    await insertMark(db, "m1", 100, "src-1", now);
    await insertMark(db, "m2", 200, "src-1", now);

    await insertSrsCard(db, "card-200", 200, "src-1");
    await insertReviewLog(db, "log-1", "card-200", 1, now);
    await insertReviewLog(db, "log-2", "card-200", 1, daysAgoIso(2));

    const ranked = await rankSmartCandidates(db, "src-1", 7, 3);
    expect(ranked[0].entryId).toBe(200);
    expect(ranked[1].entryId).toBe(100);
  });

  test("non-fail ratings (Good, Easy) do not contribute to score", async () => {
    await insertSourceListRow(db, makeSourceList());
    const now = new Date().toISOString();
    await insertMark(db, "m1", 100, "src-1", now);
    await insertMark(db, "m2", 200, "src-1", now);

    await insertSrsCard(db, "card-100", 100, "src-1");
    await insertReviewLog(db, "log-good", "card-100", 3, now);
    await insertReviewLog(db, "log-easy", "card-100", 4, now);

    const ranked = await rankSmartCandidates(db, "src-1", 7, 3);
    // Both candidates have just one flag of equal age — tie on score
    expect(ranked[0].score).toBeCloseTo(ranked[1].score, 5);
  });

  test("recent flag outweighs older flag with same count", async () => {
    // Card 100 flagged today; card 200 flagged 7 days ago. Same flag count (1).
    // The recent flag must rank higher because of time-decay.
    await insertMark(db, "m1", 100, "src-1", new Date().toISOString());
    await insertMark(db, "m2", 200, "src-1", daysAgoIso(PRIORITY_HALF_LIFE_DAYS));

    const ranked = await rankSmartCandidates(db, "src-1", 14, 3);
    expect(ranked[0].entryId).toBe(100);
    expect(ranked[1].entryId).toBe(200);
    // Half-life should make the older entry roughly half-weight
    expect(ranked[1].score).toBeCloseTo(ranked[0].score * 0.5, 2);
  });

  test("ignores fails from other lists", async () => {
    await insertSourceListRow(db, makeSourceList());
    await insertSourceListRow(db, makeSourceList({ id: "other-list", name: "Other" }));
    const now = new Date().toISOString();
    await insertMark(db, "m1", 100, "src-1", now);
    await insertMark(db, "m2", 200, "src-1", now);

    // Fail on card 100 — but the srs row is on a different list, so it should
    // not contribute to src-1's smart ranking.
    await insertSrsCard(db, "card-other", 100, "other-list");
    await insertReviewLog(db, "log-1", "card-other", 1, now);

    const ranked = await rankSmartCandidates(db, "src-1", 7, 3);
    expect(ranked[0].score).toBeCloseTo(ranked[1].score, 5);
  });

  test("returns empty when nothing flagged", async () => {
    expect(await rankSmartCandidates(db, "src-1", 7, 3)).toEqual([]);
  });
});

describe("getOrCreateSmartList", () => {
  test("creates the smart list forcing simple_srs but inheriting visual settings", async () => {
    const source = makeSourceList({
      flashcardMode: "srs", // should be overridden by smart list forcing simple_srs
      frontFaces: ["kanji", "kana"],
      backFaces: ["english"],
      autoPlayAudio: true,
      typingMode: true,
      learningSteps: ["1m", "10m"], // should not be copied
    });
    await insertSourceListRow(db, source);
    await insertMark(db, "m1", 100, "src-1", new Date().toISOString());

    const smartId = await getOrCreateSmartList(db, source, 7, 3);
    expect(smartId).toBe("_smart_src-1");

    const row = await db.getFirstAsync<any>(`SELECT * FROM lists WHERE id = ?`, [smartId]);
    expect(row).toBeTruthy();
    expect(row.name).toBe("Smart Review — My List");
    expect(row.flashcard_mode).toBe("simple_srs"); // forced
    expect(JSON.parse(row.front_faces)).toEqual(["kanji", "kana"]); // inherited
    expect(row.auto_play_audio).toBe(1); // inherited
    expect(row.typing_mode).toBe(1); // inherited
    expect(row.learning_steps).toBeNull(); // NOT inherited
    expect(row.is_default).toBe(0);
  });

  test("seeds list_entries and srs_cards in priority order", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);

    // Card 100: 3 flags, with fails. Should rank first.
    await insertMark(db, "m100a", 100, "src-1", new Date().toISOString());
    await insertMark(db, "m100b", 100, "src-1", daysAgoIso(2));
    await insertMark(db, "m100c", 100, "src-1", daysAgoIso(4));
    await insertSrsCard(db, "src-card-100", 100, "src-1");
    await insertReviewLog(db, "log-100", "src-card-100", 1, new Date().toISOString());

    // Card 200: 1 flag, no fails. Should rank last.
    await insertMark(db, "m200", 200, "src-1", new Date().toISOString());

    // Card 300: 1 flag + 1 fail. Should rank middle.
    await insertMark(db, "m300", 300, "src-1", new Date().toISOString());
    await insertSrsCard(db, "src-card-300", 300, "src-1");
    await insertReviewLog(db, "log-300", "src-card-300", 1, new Date().toISOString());

    await getOrCreateSmartList(db, source, 7, 3);

    const entries = await db.getAllAsync<{ entry_id: number; added_at: string }>(
      `SELECT entry_id, added_at FROM list_entries
       WHERE list_id = ? ORDER BY added_at ASC`,
      ["_smart_src-1"],
    );
    expect(entries.map((e) => e.entry_id)).toEqual([100, 300, 200]);

    const cards = await db.getAllAsync<{
      entry_id: number;
      created_at: string;
      simple_stage: number | null;
    }>(
      `SELECT entry_id, created_at, simple_stage FROM srs_cards
       WHERE list_id = ? ORDER BY created_at ASC`,
      ["_smart_src-1"],
    );
    expect(cards.map((c) => c.entry_id)).toEqual([100, 300, 200]);
    expect(cards.every((c) => c.simple_stage === null)).toBe(true);
  });

  test("priority timestamps are deterministic and well before 'now'", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    await insertMark(db, "m1", 100, "src-1", new Date().toISOString());

    await getOrCreateSmartList(db, source, 7, 3);

    const row = await db.getFirstAsync<{ added_at: string }>(
      `SELECT added_at FROM list_entries WHERE list_id = ?`,
      ["_smart_src-1"],
    );
    // Should be the 2000 epoch base, not a current timestamp
    expect(row?.added_at.startsWith("2000-01-01")).toBe(true);
  });

  test("is idempotent — repeated calls do not duplicate rows", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    const now = new Date().toISOString();
    await insertMark(db, "m1", 100, "src-1", now);
    await insertMark(db, "m2", 200, "src-1", now);

    await getOrCreateSmartList(db, source, 7, 3);
    await getOrCreateSmartList(db, source, 7, 3);

    const entries = await db.getAllAsync(`SELECT * FROM list_entries WHERE list_id = ?`, [
      "_smart_src-1",
    ]);
    const cards = await db.getAllAsync(`SELECT * FROM srs_cards WHERE list_id = ?`, [
      "_smart_src-1",
    ]);
    expect(entries).toHaveLength(2);
    expect(cards).toHaveLength(2);
  });

  test("additive refresh — new marks added, existing cards preserved", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    const now = new Date().toISOString();
    await insertMark(db, "m1", 100, "src-1", now);

    await getOrCreateSmartList(db, source, 7, 3);

    await insertMark(db, "m2", 200, "src-1", now);
    await getOrCreateSmartList(db, source, 7, 3);

    const entries = await db.getAllAsync<{ entry_id: number }>(
      `SELECT entry_id FROM list_entries WHERE list_id = ? ORDER BY entry_id`,
      ["_smart_src-1"],
    );
    expect(entries.map((e) => e.entry_id)).toEqual([100, 200]);
  });

  test("cards past 'new' (simple_stage NOT NULL) keep their created_at on refresh", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    await insertMark(db, "m1", 100, "src-1", new Date().toISOString());
    await getOrCreateSmartList(db, source, 7, 3);

    // Simulate the user studying the card past the new pool
    const studied = "2099-12-31T00:00:00.000Z";
    await db.runAsync(
      `UPDATE srs_cards SET simple_stage = 1, simple_n = 5, simple_interval = 5,
         created_at = ? WHERE list_id = ? AND entry_id = ?`,
      [studied, "_smart_src-1", 100],
    );

    // Refresh
    await getOrCreateSmartList(db, source, 7, 3);

    const row = await db.getFirstAsync<{ created_at: string; simple_stage: number | null }>(
      `SELECT created_at, simple_stage FROM srs_cards WHERE list_id = ? AND entry_id = 100`,
      ["_smart_src-1"],
    );
    expect(row?.simple_stage).toBe(1);
    expect(row?.created_at).toBe(studied);
  });

  test("entries no longer in window are NOT removed (additive)", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    await insertMark(db, "m1", 100, "src-1", new Date().toISOString());
    await getOrCreateSmartList(db, source, 7, 3);

    // Backdate the mark so it leaves the window
    await db.runAsync(
      `UPDATE review_marks SET marked_at = datetime('now', '-30 days') WHERE id = 'm1'`,
    );

    await getOrCreateSmartList(db, source, 7, 3);

    const entries = await db.getAllAsync<{ entry_id: number }>(
      `SELECT entry_id FROM list_entries WHERE list_id = ?`,
      ["_smart_src-1"],
    );
    expect(entries.map((e) => e.entry_id)).toEqual([100]);
  });

  test("bumps updated_at and clears deleted_at", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    await getOrCreateSmartList(db, source, 7, 3);

    await db.runAsync(
      `UPDATE lists SET updated_at = '2020-01-01T00:00:00Z', deleted_at = '2020-01-01T00:00:00Z'
       WHERE id = ?`,
      ["_smart_src-1"],
    );

    await getOrCreateSmartList(db, source, 7, 3);

    const row = await db.getFirstAsync<{ updated_at: string; deleted_at: string | null }>(
      `SELECT updated_at, deleted_at FROM lists WHERE id = ?`,
      ["_smart_src-1"],
    );
    expect(row?.deleted_at).toBeNull();
    expect(row?.updated_at).not.toBe("2020-01-01T00:00:00Z");
  });

  test("handles kanji marks", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    await insertMark(db, "k1", 0, "src-1", new Date().toISOString(), "火");

    await getOrCreateSmartList(db, source, 7, 3);

    const entries = await db.getAllAsync<any>(
      `SELECT entry_id, kanji_literal FROM list_entries WHERE list_id = ?`,
      ["_smart_src-1"],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_id).toBe(0);
    expect(entries[0].kanji_literal).toBe("火");

    const cards = await db.getAllAsync<any>(
      `SELECT entry_id, kanji_literal FROM srs_cards WHERE list_id = ?`,
      ["_smart_src-1"],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].kanji_literal).toBe("火");
  });
});

describe("cleanupOrphanedSmartLists", () => {
  test("drops smart lists older than idle threshold and their cards/entries", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    await insertMark(db, "m1", 100, "src-1", new Date().toISOString());
    await getOrCreateSmartList(db, source, 7, 3);

    await db.runAsync(`UPDATE lists SET updated_at = datetime('now', '-60 days') WHERE id = ?`, [
      "_smart_src-1",
    ]);

    await cleanupOrphanedSmartLists(db, 30);

    expect(
      await db.getFirstAsync(`SELECT id FROM lists WHERE id = ?`, ["_smart_src-1"]),
    ).toBeNull();
    expect(
      await db.getAllAsync(`SELECT id FROM srs_cards WHERE list_id = ?`, ["_smart_src-1"]),
    ).toHaveLength(0);
    expect(
      await db.getAllAsync(`SELECT id FROM list_entries WHERE list_id = ?`, ["_smart_src-1"]),
    ).toHaveLength(0);
  });

  test("keeps fresh smart lists", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    await insertMark(db, "m1", 100, "src-1", new Date().toISOString());
    await getOrCreateSmartList(db, source, 7, 3);

    await cleanupOrphanedSmartLists(db, 30);

    expect(
      await db.getFirstAsync(`SELECT id FROM lists WHERE id = ?`, ["_smart_src-1"]),
    ).toBeTruthy();
  });

  test("drops smart lists whose source has been deleted", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);
    await insertMark(db, "m1", 100, "src-1", new Date().toISOString());
    await getOrCreateSmartList(db, source, 7, 3);

    await db.runAsync(`DELETE FROM lists WHERE id = ?`, ["src-1"]);

    await cleanupOrphanedSmartLists(db, 30);

    expect(
      await db.getFirstAsync(`SELECT id FROM lists WHERE id = ?`, ["_smart_src-1"]),
    ).toBeNull();
  });

  test("leaves non-smart lists alone", async () => {
    const source = makeSourceList();
    await insertSourceListRow(db, source);

    await db.runAsync(`UPDATE lists SET updated_at = datetime('now', '-60 days') WHERE id = ?`, [
      "src-1",
    ]);

    await cleanupOrphanedSmartLists(db, 30);

    expect(await db.getFirstAsync(`SELECT id FROM lists WHERE id = ?`, ["src-1"])).toBeTruthy();
  });
});
