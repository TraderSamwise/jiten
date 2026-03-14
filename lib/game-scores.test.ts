import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { createTestDb } from "@/test/test-db";
import { getUserDrizzle } from "@/db/drizzle";
import { saveGameScore, getHighScore, getRecentScores } from "./game-scores";
import type { WrappedUserDb } from "@/db/user-db";
import type { UserDrizzle } from "@/db/drizzle";
import type { GameScoreRecord } from "./game-scores";

let rawDb: WrappedUserDb & { close: () => void };
let db: UserDrizzle;

beforeEach(() => {
  if (rawDb) rawDb.close();
  rawDb = createTestDb();
  db = getUserDrizzle(rawDb);
});

afterAll(() => {
  if (rawDb) rawDb.close();
});

function makeScore(overrides: Partial<GameScoreRecord> = {}): GameScoreRecord {
  return {
    listId: "list-1",
    gameType: "connect",
    gameMode: "timed",
    speedPreset: "normal",
    score: 100,
    matchesMade: 10,
    triplesMade: 2,
    maxCombo: 5,
    accuracy: 80,
    durationMs: 30000,
    ...overrides,
  };
}

// ─── saveGameScore ───

describe("saveGameScore", () => {
  test("inserts a game score record", async () => {
    await saveGameScore(db, makeScore({ score: 250 }));

    const rows = await rawDb.getAllAsync<{ score: number }>("SELECT score FROM game_scores");
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(250);
  });

  test("inserts multiple scores", async () => {
    await saveGameScore(db, makeScore({ score: 100 }));
    await saveGameScore(db, makeScore({ score: 200 }));
    await saveGameScore(db, makeScore({ score: 300 }));

    const rows = await rawDb.getAllAsync("SELECT * FROM game_scores");
    expect(rows).toHaveLength(3);
  });
});

// ─── getHighScore ───

describe("getHighScore", () => {
  test("returns null when no scores exist", async () => {
    const result = await getHighScore(db, "list-1", "connect", "timed", "normal");
    expect(result).toBeNull();
  });

  test("returns the highest score", async () => {
    await saveGameScore(db, makeScore({ score: 100 }));
    await saveGameScore(db, makeScore({ score: 300 }));
    await saveGameScore(db, makeScore({ score: 200 }));

    const result = await getHighScore(db, "list-1", "connect", "timed", "normal");
    expect(result).toBe(300);
  });

  test("filters by list, game type, mode, and speed", async () => {
    await saveGameScore(db, makeScore({ score: 500, listId: "list-2" }));
    await saveGameScore(db, makeScore({ score: 100, listId: "list-1" }));

    const result = await getHighScore(db, "list-1", "connect", "timed", "normal");
    expect(result).toBe(100);
  });

  test("filters by game mode", async () => {
    await saveGameScore(db, makeScore({ score: 500, gameMode: "zen" }));
    await saveGameScore(db, makeScore({ score: 100, gameMode: "timed" }));

    const result = await getHighScore(db, "list-1", "connect", "timed", "normal");
    expect(result).toBe(100);
  });
});

// ─── getRecentScores ───

describe("getRecentScores", () => {
  test("returns empty array when no scores exist", async () => {
    const result = await getRecentScores(db, "list-1", "connect");
    expect(result).toEqual([]);
  });

  test("returns scores ordered by played_at DESC", async () => {
    // Insert with explicit timestamps to guarantee ordering
    const base = new Date("2025-01-01T00:00:00Z");
    await rawDb.runAsync(
      `INSERT INTO game_scores (id, list_id, game_type, game_mode, speed_preset, score, matches_made, triples_made, max_combo, accuracy, duration_ms, played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "id-1",
        "list-1",
        "connect",
        "timed",
        "normal",
        100,
        10,
        2,
        5,
        80,
        30000,
        new Date(base.getTime()).toISOString(),
      ],
    );
    await rawDb.runAsync(
      `INSERT INTO game_scores (id, list_id, game_type, game_mode, speed_preset, score, matches_made, triples_made, max_combo, accuracy, duration_ms, played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "id-2",
        "list-1",
        "connect",
        "timed",
        "normal",
        200,
        10,
        2,
        5,
        80,
        30000,
        new Date(base.getTime() + 60000).toISOString(),
      ],
    );
    await rawDb.runAsync(
      `INSERT INTO game_scores (id, list_id, game_type, game_mode, speed_preset, score, matches_made, triples_made, max_combo, accuracy, duration_ms, played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "id-3",
        "list-1",
        "connect",
        "timed",
        "normal",
        300,
        10,
        2,
        5,
        80,
        30000,
        new Date(base.getTime() + 120000).toISOString(),
      ],
    );

    const result = await getRecentScores(db, "list-1", "connect");
    // Most recent first
    expect(result[0].score).toBe(300);
    expect(result[1].score).toBe(200);
    expect(result[2].score).toBe(100);
  });

  test("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await saveGameScore(db, makeScore({ score: i * 100 }));
    }

    const result = await getRecentScores(db, "list-1", "connect", 3);
    expect(result).toHaveLength(3);
  });

  test("filters by list and game type", async () => {
    await saveGameScore(db, makeScore({ listId: "list-1", gameType: "connect" }));
    await saveGameScore(db, makeScore({ listId: "list-1", gameType: "typing" }));
    await saveGameScore(db, makeScore({ listId: "list-2", gameType: "connect" }));

    const result = await getRecentScores(db, "list-1", "connect");
    expect(result).toHaveLength(1);
  });

  test("returns all expected fields", async () => {
    await saveGameScore(
      db,
      makeScore({
        score: 250,
        matchesMade: 15,
        triplesMade: 3,
        maxCombo: 7,
        accuracy: 90,
        durationMs: 45000,
      }),
    );

    const result = await getRecentScores(db, "list-1", "connect");
    expect(result[0]).toMatchObject({
      listId: "list-1",
      gameType: "connect",
      gameMode: "timed",
      speedPreset: "normal",
      score: 250,
      matchesMade: 15,
      triplesMade: 3,
      maxCombo: 7,
      accuracy: 90,
      durationMs: 45000,
    });
  });
});
