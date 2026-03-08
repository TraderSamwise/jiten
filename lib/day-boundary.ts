/**
 * Day boundary utilities for configurable study-day reset hour.
 * If the current time is before resetHour, the logical day is the previous calendar day.
 */

/** Returns the start of the logical day (midnight of the logical calendar day, UTC). */
export function getDayStart(date: Date, resetHour: number): Date {
  const d = new Date(date);
  if (d.getUTCHours() < resetHour) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Returns `YYYY-MM-DD` for the logical day (UTC-based, matching SQLite DATE()). */
export function getDayLabel(date: Date, resetHour: number): string {
  const d = getDayStart(date, resetHour);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns a SQL fragment that bins a timestamp column into logical days. */
export function sqlDayExpr(column: string, resetHour: number): string {
  if (resetHour === 0) return `DATE(${column})`;
  return `DATE(datetime(${column}, '-${resetHour} hours'))`;
}

/** Shortcut for `getDayLabel(new Date(), resetHour)`. */
export function getLogicalToday(resetHour: number): string {
  return getDayLabel(new Date(), resetHour);
}
