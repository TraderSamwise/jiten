import { eq, and, sql } from "drizzle-orm";
import { reviewMarks } from "@/db/schema";
import type { UserDrizzle } from "@/db/drizzle";
import { getLogicalToday, sqlDayExpr } from "./day-boundary";

// ─── Types ───

export interface MarkEntry {
  entryId: number;
  kanjiLiteral: string | null;
  listId: string | null;
  markedAt: string;
}

export interface MarkedDay {
  dayLabel: string;
  displayLabel: string;
  marks: MarkEntry[];
}

export interface MarkedWeek {
  weekLabel: string;
  displayLabel: string;
  marks: MarkEntry[];
}

export interface MarkedMonth {
  monthLabel: string;
  displayLabel: string;
  marks: MarkEntry[];
}

// ─── Helpers for db.all() raw array mapping ───

/** Maps raw array rows from db.all() to objects using column names. */
function mapRows<T extends Record<string, any>>(rows: unknown[][], columns: (keyof T)[]): T[] {
  return rows.map((row) => {
    const obj: any = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i];
    }
    return obj as T;
  });
}

// ─── Mark / Query ───

/**
 * Mark an entry for review. Deduplicates per entry per logical day.
 * Returns true if a new mark was inserted.
 */
export async function markForReview(
  db: UserDrizzle,
  entryId: number,
  kanjiLiteral: string | null,
  listId: string | null,
  resetHour: number,
): Promise<boolean> {
  const already = await isMarkedToday(db, entryId, kanjiLiteral, resetHour);
  if (already) return false;

  const id = `${entryId}-${kanjiLiteral ?? ""}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  await db
    .insert(reviewMarks)
    .values({
      id,
      entryId,
      kanjiLiteral,
      listId,
      markedAt: now,
    })
    .onConflictDoNothing();
  return true;
}

/** Remove today's mark for an entry. Returns true if a row was deleted. */
export async function unmarkForReview(
  db: UserDrizzle,
  entryId: number,
  kanjiLiteral: string | null,
  resetHour: number,
): Promise<boolean> {
  const today = getLogicalToday(resetHour);
  const dayExpr = sqlDayExpr("marked_at", resetHour);

  const kanjiFilter =
    kanjiLiteral != null
      ? sql`${reviewMarks.kanjiLiteral} = ${kanjiLiteral}`
      : sql`${reviewMarks.kanjiLiteral} IS NULL`;

  const existing = await db
    .select({ id: reviewMarks.id })
    .from(reviewMarks)
    .where(
      and(
        eq(reviewMarks.entryId, entryId),
        sql`${kanjiFilter}`,
        sql`${sql.raw(dayExpr)} = ${today}`,
      ),
    );

  if (existing.length === 0) return false;

  for (const row of existing) {
    await db.delete(reviewMarks).where(eq(reviewMarks.id, row.id));
  }
  return true;
}

/** Check if an entry is already marked for the current logical day. */
export async function isMarkedToday(
  db: UserDrizzle,
  entryId: number,
  kanjiLiteral: string | null,
  resetHour: number,
): Promise<boolean> {
  const today = getLogicalToday(resetHour);
  const dayExpr = sqlDayExpr("marked_at", resetHour);

  const kanjiFilter =
    kanjiLiteral != null
      ? sql`${reviewMarks.kanjiLiteral} = ${kanjiLiteral}`
      : sql`${reviewMarks.kanjiLiteral} IS NULL`;

  const rows = await db
    .select({ id: reviewMarks.id })
    .from(reviewMarks)
    .where(
      and(
        eq(reviewMarks.entryId, entryId),
        sql`${kanjiFilter}`,
        sql`${sql.raw(dayExpr)} = ${today}`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** Get marks grouped by logical day. */
export async function getMarkedByDay(
  db: UserDrizzle,
  resetHour: number,
  listId?: string | null,
  days: number = 7,
): Promise<MarkedDay[]> {
  const dayExpr = sqlDayExpr("marked_at", resetHour);
  const listFilter = listId ? sql` AND list_id = ${listId}` : sql``;

  const rawRows = (await db.all(
    sql`SELECT ${sql.raw(dayExpr)} as dayLabel, entry_id, kanji_literal,
            list_id, marked_at
     FROM review_marks
     WHERE ${sql.raw(dayExpr)} >= DATE('now', '-${sql.raw(String(resetHour))} hours', '-' || ${days} || ' days')
     ${listFilter}
     ORDER BY marked_at DESC`,
  )) as unknown[][];

  type Row = {
    dayLabel: string;
    entryId: number;
    kanjiLiteral: string | null;
    listId: string | null;
    markedAt: string;
  };
  const rows = mapRows<Row>(rawRows, ["dayLabel", "entryId", "kanjiLiteral", "listId", "markedAt"]);

  return groupByKey(rows, "dayLabel", (dayLabel, marks) => ({
    dayLabel,
    displayLabel: formatDayDisplay(dayLabel, resetHour),
    marks,
  }));
}

/** Get marks grouped by ISO week. */
export async function getMarkedByWeek(
  db: UserDrizzle,
  resetHour: number,
  listId?: string | null,
  weeks: number = 4,
): Promise<MarkedWeek[]> {
  const dayExpr = sqlDayExpr("marked_at", resetHour);
  const listFilter = listId ? sql` AND list_id = ${listId}` : sql``;
  const totalDays = weeks * 7;

  const rawRows = (await db.all(
    sql`SELECT strftime('%Y-W%W', ${sql.raw(dayExpr)}) as weekLabel,
            entry_id, kanji_literal,
            list_id, marked_at
     FROM review_marks
     WHERE ${sql.raw(dayExpr)} >= DATE('now', '-${sql.raw(String(resetHour))} hours', '-' || ${totalDays} || ' days')
     ${listFilter}
     ORDER BY marked_at DESC`,
  )) as unknown[][];

  type Row = {
    weekLabel: string;
    entryId: number;
    kanjiLiteral: string | null;
    listId: string | null;
    markedAt: string;
  };
  const rows = mapRows<Row>(rawRows, [
    "weekLabel",
    "entryId",
    "kanjiLiteral",
    "listId",
    "markedAt",
  ]);

  const today = getLogicalToday(resetHour);
  const thisWeek = getWeekLabel(today);

  return groupByKey(rows, "weekLabel", (weekLabel, marks) => ({
    weekLabel,
    displayLabel: weekLabel === thisWeek ? "This Week" : formatWeekDisplay(weekLabel),
    marks,
  }));
}

/** Get marks grouped by month. */
export async function getMarkedByMonth(
  db: UserDrizzle,
  resetHour: number,
  listId?: string | null,
  months: number = 3,
): Promise<MarkedMonth[]> {
  const dayExpr = sqlDayExpr("marked_at", resetHour);
  const listFilter = listId ? sql` AND list_id = ${listId}` : sql``;
  const totalDays = months * 31;

  const rawRows = (await db.all(
    sql`SELECT strftime('%Y-%m', ${sql.raw(dayExpr)}) as monthLabel,
            entry_id, kanji_literal,
            list_id, marked_at
     FROM review_marks
     WHERE ${sql.raw(dayExpr)} >= DATE('now', '-${sql.raw(String(resetHour))} hours', '-' || ${totalDays} || ' days')
     ${listFilter}
     ORDER BY marked_at DESC`,
  )) as unknown[][];

  type Row = {
    monthLabel: string;
    entryId: number;
    kanjiLiteral: string | null;
    listId: string | null;
    markedAt: string;
  };
  const rows = mapRows<Row>(rawRows, [
    "monthLabel",
    "entryId",
    "kanjiLiteral",
    "listId",
    "markedAt",
  ]);

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  return groupByKey(rows, "monthLabel", (monthLabel, marks) => ({
    monthLabel,
    displayLabel: monthNames[parseInt(monthLabel.slice(5), 10) - 1] ?? monthLabel,
    marks,
  }));
}

/** Get marked entry IDs within a date range (for building study queues). */
export async function getMarkedEntryIds(
  db: UserDrizzle,
  startDate: string,
  endDate: string,
  listId?: string | null,
): Promise<{ entryId: number; kanjiLiteral: string | null }[]> {
  const listFilter = listId ? sql` AND list_id = ${listId}` : sql``;

  const rawRows = (await db.all(
    sql`SELECT DISTINCT entry_id, kanji_literal
     FROM review_marks
     WHERE marked_at >= ${startDate} AND marked_at < ${endDate}
     ${listFilter}`,
  )) as unknown[][];

  return mapRows<{ entryId: number; kanjiLiteral: string | null }>(rawRows, [
    "entryId",
    "kanjiLiteral",
  ]);
}

/** Delete marks older than keepDays. Fire-and-forget on app init. */
export async function cleanupOldMarks(db: UserDrizzle, keepDays: number = 90): Promise<void> {
  await db.run(
    sql`DELETE FROM review_marks WHERE marked_at < datetime('now', '-' || ${keepDays} || ' days')`,
  );
}

// ─── Helpers ───

function groupByKey<TRow extends Record<string, any>, TResult>(
  rows: TRow[],
  keyField: string,
  mapper: (key: string, marks: MarkEntry[]) => TResult,
): TResult[] {
  const map = new Map<string, MarkEntry[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row[keyField] as string;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push({
      entryId: row.entryId,
      kanjiLiteral: row.kanjiLiteral,
      listId: row.listId,
      markedAt: row.markedAt,
    });
  }
  return order.map((key) => mapper(key, map.get(key)!));
}

function formatDayDisplay(dayLabel: string, resetHour: number): string {
  const today = getLogicalToday(resetHour);
  if (dayLabel === today) return "Today";

  const todayDate = new Date(today + "T00:00:00Z");
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  if (dayLabel === yesterdayDate.toISOString().slice(0, 10)) return "Yesterday";

  const d = new Date(dayLabel + "T00:00:00Z");
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return weekdays[d.getUTCDay()] ?? dayLabel;
}

/** Matches SQLite strftime('%W') — Monday-start week number (00-53). */
function getWeekLabel(dayLabel: string): string {
  const d = new Date(dayLabel + "T00:00:00Z");
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const daysSinceJan1 = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const jan1Dow = jan1.getUTCDay(); // 0=Sun
  const mondayOffset = jan1Dow === 0 ? 6 : jan1Dow - 1;
  const weekNum = Math.floor((daysSinceJan1 + mondayOffset) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function formatWeekDisplay(weekLabel: string): string {
  const parts = weekLabel.split("-W");
  if (parts.length !== 2) return weekLabel;
  return `Week ${parseInt(parts[1], 10)} (${parts[0]})`;
}
