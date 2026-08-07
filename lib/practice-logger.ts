import { and, eq, sql } from "drizzle-orm";
import { practiceEvents, practiceSessions, confusionPairs, confusionEvents } from "@/db/schema";
import { generateId } from "@/db/helpers";
import type { UserDrizzle } from "@/db/drizzle";

export type PracticeMode =
  | "flashcard"
  | "typing_game"
  | "typing_flashcard"
  | "voice"
  | "context_game"
  | "fill_blank_game";

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

export async function logPracticeEvent(db: UserDrizzle, event: PracticeEvent): Promise<void> {
  await db
    .insert(practiceEvents)
    .values({
      id: generateId(),
      entryId: event.entryId,
      kanjiLiteral: event.kanjiLiteral ?? null,
      listId: event.listId ?? null,
      practiceMode: event.practiceMode,
      correct: event.correct ? 1 : 0,
      assisted: event.assisted ? 1 : 0,
      responseMs: event.responseMs ?? null,
      typedAnswer: event.typedAnswer ?? null,
      reviewedAt: new Date().toISOString(),
      sessionId: event.sessionId ?? null,
    })
    .onConflictDoNothing();
}

export async function logSessionSummary(
  db: UserDrizzle,
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
  await db
    .insert(practiceSessions)
    .values({
      id: generateId(),
      sessionId: summary.sessionId,
      listId: summary.listId,
      practiceMode: summary.practiceMode,
      startedAt: summary.startedAt,
      durationMs: summary.durationMs,
      totalItems: summary.totalItems,
      correctCount: summary.correctCount,
    })
    .onConflictDoNothing();
}

export type ConfusionType = "visual_kanji" | "reading" | "meaning";

export async function recordConfusion(
  db: UserDrizzle,
  entryA: { entryId: number; kanjiLiteral?: string | null },
  entryB: { entryId: number; kanjiLiteral?: string | null },
  confusionType: ConfusionType,
  listId?: string,
  practiceMode?: PracticeMode,
): Promise<void> {
  const now = new Date().toISOString();
  // Order consistently for dedup
  const [a, b] = entryA.entryId <= entryB.entryId ? [entryA, entryB] : [entryB, entryA];

  // Check if pair already exists
  const existing = await db
    .select({ id: confusionPairs.id })
    .from(confusionPairs)
    .where(
      and(
        eq(confusionPairs.entryIdA, a.entryId),
        eq(confusionPairs.entryIdB, b.entryId),
        eq(confusionPairs.confusionType, confusionType),
        a.kanjiLiteral
          ? eq(confusionPairs.kanjiLiteralA, a.kanjiLiteral)
          : sql`${confusionPairs.kanjiLiteralA} IS NULL`,
        b.kanjiLiteral
          ? eq(confusionPairs.kanjiLiteralB, b.kanjiLiteral)
          : sql`${confusionPairs.kanjiLiteralB} IS NULL`,
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(confusionPairs)
      .set({
        confusionCount: sql`${confusionPairs.confusionCount} + 1`,
        lastConfusedAt: now,
      })
      .where(eq(confusionPairs.id, existing[0].id));
  } else {
    await db
      .insert(confusionPairs)
      .values({
        id: generateId(),
        entryIdA: a.entryId,
        kanjiLiteralA: a.kanjiLiteral ?? null,
        entryIdB: b.entryId,
        kanjiLiteralB: b.kanjiLiteral ?? null,
        confusionType,
        confusionCount: 1,
        lastConfusedAt: now,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  // Also log timestamped event
  await logConfusionEvent(db, a, b, confusionType, now, listId, practiceMode);
}

async function logConfusionEvent(
  db: UserDrizzle,
  entryA: { entryId: number; kanjiLiteral?: string | null },
  entryB: { entryId: number; kanjiLiteral?: string | null },
  confusionType: ConfusionType,
  confusedAt: string,
  listId?: string,
  practiceMode?: PracticeMode,
): Promise<void> {
  await db
    .insert(confusionEvents)
    .values({
      id: generateId(),
      entryIdA: entryA.entryId,
      kanjiLiteralA: entryA.kanjiLiteral ?? null,
      entryIdB: entryB.entryId,
      kanjiLiteralB: entryB.kanjiLiteral ?? null,
      confusionType,
      listId: listId ?? null,
      practiceMode: practiceMode ?? null,
      confusedAt,
    })
    .onConflictDoNothing();
}
