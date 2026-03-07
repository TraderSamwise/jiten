import type { WrappedUserDb } from "@/db/user-db";
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

// ─── Mark / Query ───

/**
 * Mark an entry for review. Deduplicates per entry per logical day.
 * Returns true if a new mark was inserted.
 */
export async function markForReview(
  userDb: WrappedUserDb,
  entryId: number,
  kanjiLiteral: string | null,
  listId: string | null,
  resetHour: number,
): Promise<boolean> {
  const already = await isMarkedToday(userDb, entryId, kanjiLiteral, resetHour);
  if (already) return false;

  const id = `${entryId}-${kanjiLiteral ?? ""}-${Date.now()}`;
  const now = new Date().toISOString();
  await userDb.runAsync(
    `INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)`,
    [id, entryId, kanjiLiteral, listId, now],
  );
  return true;
}

/** Remove today's mark for an entry. Returns true if a row was deleted. */
export async function unmarkForReview(
  userDb: WrappedUserDb,
  entryId: number,
  kanjiLiteral: string | null,
  resetHour: number,
): Promise<boolean> {
  const today = getLogicalToday(resetHour);
  const dayExpr = sqlDayExpr("marked_at", resetHour);
  const result = await userDb.runAsync(
    `DELETE FROM review_marks
     WHERE entry_id = ? AND ${kanjiLiteral != null ? "kanji_literal = ?" : "kanji_literal IS NULL"}
     AND ${dayExpr} = ?`,
    kanjiLiteral != null ? [entryId, kanjiLiteral, today] : [entryId, today],
  );
  return result.changes > 0;
}

/** Check if an entry is already marked for the current logical day. */
export async function isMarkedToday(
  userDb: WrappedUserDb,
  entryId: number,
  kanjiLiteral: string | null,
  resetHour: number,
): Promise<boolean> {
  const today = getLogicalToday(resetHour);
  const dayExpr = sqlDayExpr("marked_at", resetHour);
  const row = await userDb.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM review_marks
     WHERE entry_id = ? AND ${kanjiLiteral != null ? "kanji_literal = ?" : "kanji_literal IS NULL"}
     AND ${dayExpr} = ?`,
    kanjiLiteral != null ? [entryId, kanjiLiteral, today] : [entryId, today],
  );
  return (row?.cnt ?? 0) > 0;
}

/** Get marks grouped by logical day. */
export async function getMarkedByDay(
  userDb: WrappedUserDb,
  resetHour: number,
  listId?: string | null,
  days: number = 7,
): Promise<MarkedDay[]> {
  const dayExpr = sqlDayExpr("marked_at", resetHour);
  const listFilter = listId ? "AND list_id = ?" : "";
  const params: any[] = listId ? [days, listId] : [days];

  const rows = await userDb.getAllAsync<{
    dayLabel: string;
    entryId: number;
    kanjiLiteral: string | null;
    listId: string | null;
    markedAt: string;
  }>(
    `SELECT ${dayExpr} as dayLabel, entry_id as entryId, kanji_literal as kanjiLiteral,
            list_id as listId, marked_at as markedAt
     FROM review_marks
     WHERE ${dayExpr} >= DATE('now', '-${resetHour} hours', '-' || ? || ' days')
     ${listFilter}
     ORDER BY marked_at DESC`,
    params,
  );

  return groupByKey(rows, "dayLabel", (dayLabel, marks) => ({
    dayLabel,
    displayLabel: formatDayDisplay(dayLabel, resetHour),
    marks,
  }));
}

/** Get marks grouped by ISO week. */
export async function getMarkedByWeek(
  userDb: WrappedUserDb,
  resetHour: number,
  listId?: string | null,
  weeks: number = 4,
): Promise<MarkedWeek[]> {
  const dayExpr = sqlDayExpr("marked_at", resetHour);
  const listFilter = listId ? "AND list_id = ?" : "";
  const days = weeks * 7;
  const params: any[] = listId ? [days, listId] : [days];

  const rows = await userDb.getAllAsync<{
    weekLabel: string;
    entryId: number;
    kanjiLiteral: string | null;
    listId: string | null;
    markedAt: string;
  }>(
    `SELECT strftime('%Y-W%W', ${dayExpr}) as weekLabel,
            entry_id as entryId, kanji_literal as kanjiLiteral,
            list_id as listId, marked_at as markedAt
     FROM review_marks
     WHERE ${dayExpr} >= DATE('now', '-${resetHour} hours', '-' || ? || ' days')
     ${listFilter}
     ORDER BY marked_at DESC`,
    params,
  );

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
  userDb: WrappedUserDb,
  resetHour: number,
  listId?: string | null,
  months: number = 3,
): Promise<MarkedMonth[]> {
  const dayExpr = sqlDayExpr("marked_at", resetHour);
  const listFilter = listId ? "AND list_id = ?" : "";
  const days = months * 31;
  const params: any[] = listId ? [days, listId] : [days];

  const rows = await userDb.getAllAsync<{
    monthLabel: string;
    entryId: number;
    kanjiLiteral: string | null;
    listId: string | null;
    markedAt: string;
  }>(
    `SELECT strftime('%Y-%m', ${dayExpr}) as monthLabel,
            entry_id as entryId, kanji_literal as kanjiLiteral,
            list_id as listId, marked_at as markedAt
     FROM review_marks
     WHERE ${dayExpr} >= DATE('now', '-${resetHour} hours', '-' || ? || ' days')
     ${listFilter}
     ORDER BY marked_at DESC`,
    params,
  );

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
  userDb: WrappedUserDb,
  startDate: string,
  endDate: string,
  listId?: string | null,
): Promise<{ entryId: number; kanjiLiteral: string | null }[]> {
  const listFilter = listId ? "AND list_id = ?" : "";
  const params: any[] = [startDate, endDate, ...(listId ? [listId] : [])];

  return userDb.getAllAsync<{ entryId: number; kanjiLiteral: string | null }>(
    `SELECT DISTINCT entry_id as entryId, kanji_literal as kanjiLiteral
     FROM review_marks
     WHERE marked_at >= ? AND marked_at < ?
     ${listFilter}`,
    params,
  );
}

/** Delete marks older than keepDays. Fire-and-forget on app init. */
export async function cleanupOldMarks(userDb: WrappedUserDb, keepDays: number = 90): Promise<void> {
  await userDb.runAsync(
    `DELETE FROM review_marks WHERE marked_at < datetime('now', '-' || ? || ' days')`,
    [keepDays],
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

  const todayDate = new Date(today + "T00:00:00");
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (dayLabel === yesterdayDate.toISOString().slice(0, 10)) return "Yesterday";

  const d = new Date(dayLabel + "T00:00:00");
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return weekdays[d.getDay()] ?? dayLabel;
}

function getWeekLabel(dayLabel: string): string {
  const d = new Date(dayLabel + "T00:00:00");
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
  const weekNum = Math.floor((dayOfYear + jan1.getDay() - 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function formatWeekDisplay(weekLabel: string): string {
  const parts = weekLabel.split("-W");
  if (parts.length !== 2) return weekLabel;
  return `Week ${parseInt(parts[1], 10)} (${parts[0]})`;
}
