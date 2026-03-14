import { and, desc, eq, max } from "drizzle-orm";
import { gameScores } from "@/db/schema";
import { generateId } from "@/db/helpers";
import type { UserDrizzle } from "@/db/drizzle";

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

export async function saveGameScore(db: UserDrizzle, record: GameScoreRecord): Promise<void> {
  await db
    .insert(gameScores)
    .values({
      id: generateId(),
      listId: record.listId,
      gameType: record.gameType,
      gameMode: record.gameMode,
      speedPreset: record.speedPreset,
      score: record.score,
      matchesMade: record.matchesMade,
      triplesMade: record.triplesMade,
      maxCombo: record.maxCombo,
      accuracy: record.accuracy,
      durationMs: record.durationMs,
      playedAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
}

export async function getHighScore(
  db: UserDrizzle,
  listId: string,
  gameType: string,
  gameMode: string,
  speedPreset: string,
): Promise<number | null> {
  const result = await db
    .select({ maxScore: max(gameScores.score) })
    .from(gameScores)
    .where(
      and(
        eq(gameScores.listId, listId),
        eq(gameScores.gameType, gameType),
        eq(gameScores.gameMode, gameMode),
        eq(gameScores.speedPreset, speedPreset),
      ),
    );
  return result[0]?.maxScore ?? null;
}

export async function getRecentScores(
  db: UserDrizzle,
  listId: string,
  gameType: string,
  limit = 10,
): Promise<GameScoreRecord[]> {
  const rows = await db
    .select({
      listId: gameScores.listId,
      gameType: gameScores.gameType,
      gameMode: gameScores.gameMode,
      speedPreset: gameScores.speedPreset,
      score: gameScores.score,
      matchesMade: gameScores.matchesMade,
      triplesMade: gameScores.triplesMade,
      maxCombo: gameScores.maxCombo,
      accuracy: gameScores.accuracy,
      durationMs: gameScores.durationMs,
    })
    .from(gameScores)
    .where(and(eq(gameScores.listId, listId), eq(gameScores.gameType, gameType)))
    .orderBy(desc(gameScores.playedAt))
    .limit(limit);
  return rows;
}
