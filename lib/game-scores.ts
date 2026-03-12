import type { WrappedUserDb } from "@/db/user-db";

export interface GameScoreRecord {
  listId: string;
  gameType: string; // "connect" | "typing" etc.
  gameMode: string; // "timed" | "zen"
  speedPreset: string; // "easy" | "normal" | "hard"
  score: number;
  matchesMade: number;
  triplesMade: number;
  maxCombo: number;
  accuracy: number; // 0-100
  durationMs: number;
}

export async function saveGameScore(userDb: WrappedUserDb, record: GameScoreRecord): Promise<void> {
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  await userDb.runAsync(
    `INSERT OR IGNORE INTO game_scores (id, list_id, game_type, game_mode, speed_preset, score, matches_made, triples_made, max_combo, accuracy, duration_ms, played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      record.listId,
      record.gameType,
      record.gameMode,
      record.speedPreset,
      record.score,
      record.matchesMade,
      record.triplesMade,
      record.maxCombo,
      record.accuracy,
      record.durationMs,
      new Date().toISOString(),
    ],
  );
}

export async function getHighScore(
  userDb: WrappedUserDb,
  listId: string,
  gameType: string,
  gameMode: string,
  speedPreset: string,
): Promise<number | null> {
  const row = await userDb.getFirstAsync<{ max_score: number | null }>(
    `SELECT MAX(score) as max_score FROM game_scores WHERE list_id = ? AND game_type = ? AND game_mode = ? AND speed_preset = ?`,
    [listId, gameType, gameMode, speedPreset],
  );
  return row?.max_score ?? null;
}

export async function getRecentScores(
  userDb: WrappedUserDb,
  listId: string,
  gameType: string,
  limit = 10,
): Promise<GameScoreRecord[]> {
  return userDb.getAllAsync<GameScoreRecord>(
    `SELECT list_id as listId, game_type as gameType, game_mode as gameMode, speed_preset as speedPreset, score, matches_made as matchesMade, triples_made as triplesMade, max_combo as maxCombo, accuracy, duration_ms as durationMs FROM game_scores WHERE list_id = ? AND game_type = ? ORDER BY played_at DESC LIMIT ?`,
    [listId, gameType, limit],
  );
}
