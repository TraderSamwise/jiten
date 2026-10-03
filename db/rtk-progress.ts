import { COURSE_RTK, CROWN_MAX, nodeId, type NodeCrowns, type NodeRef } from "@/lib/rtk-course";
import type { WrappedUserDb } from "./user-db";

/**
 * Where the learner is on a course path. One row per node, keyed by a derived
 * id, so two devices touching the same node converge on one row instead of two.
 */
export interface CourseProgressRow {
  id: string;
  course: string;
  unit: number;
  node: number;
  crown: number;
  firstSeenAt: string | null;
  crackedAt: string | null;
  updatedAt: string;
}

interface RawRow {
  id: string;
  course: string;
  unit: number;
  node: number;
  crown: number;
  first_seen_at: string | null;
  cracked_at: string | null;
  updated_at: string;
}

function toRow(raw: RawRow): CourseProgressRow {
  return {
    id: raw.id,
    course: raw.course,
    unit: raw.unit,
    node: raw.node,
    crown: raw.crown,
    firstSeenAt: raw.first_seen_at,
    crackedAt: raw.cracked_at,
    updatedAt: raw.updated_at,
  };
}

export async function loadCourseProgress(
  db: WrappedUserDb,
  course: string = COURSE_RTK,
): Promise<Map<string, CourseProgressRow>> {
  const rows = await db.getAllAsync<RawRow>(
    `SELECT id, course, unit, node, crown, first_seen_at, cracked_at, updated_at
       FROM course_progress
      WHERE course = ? AND deleted_at IS NULL`,
    [course],
  );
  return new Map(rows.map((raw) => [raw.id, toRow(raw)]));
}

export async function getNodeProgress(
  db: WrappedUserDb,
  ref: NodeRef,
): Promise<CourseProgressRow | null> {
  const raw = await db.getFirstAsync<RawRow>(
    `SELECT id, course, unit, node, crown, first_seen_at, cracked_at, updated_at
       FROM course_progress
      WHERE id = ? AND deleted_at IS NULL`,
    [nodeId(ref)],
  );
  return raw ? toRow(raw) : null;
}

/** A crown lookup for lib/rtk-course's nextNode and unitCrownTotal. */
export function crownsFromProgress(progress: Map<string, CourseProgressRow>): NodeCrowns {
  return { crownOf: (id) => progress.get(id)?.crown ?? 0 };
}

/** Records that a node has been opened, without touching a crown it already has. */
export async function markNodeSeen(db: WrappedUserDb, ref: NodeRef): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO course_progress
       (id, course, unit, node, crown, first_seen_at, cracked_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 0, ?, NULL, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       first_seen_at = COALESCE(course_progress.first_seen_at, excluded.first_seen_at),
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
    [nodeId(ref), ref.course, ref.unit, ref.node, now, now],
  );
}

/**
 * Awards a crown, clamped to CROWN_MAX. MAX() keeps a racing write on THIS
 * device from lowering it; sync is plain last-write-wins, so a newer remote row
 * still can — the cost is one node re-crowned, per db/sync-helpers.ts.
 */
export async function awardCrown(db: WrappedUserDb, ref: NodeRef, crown: number): Promise<void> {
  const next = Math.max(0, Math.min(Math.trunc(crown), CROWN_MAX));
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO course_progress
       (id, course, unit, node, crown, first_seen_at, cracked_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       crown = MAX(course_progress.crown, excluded.crown),
       first_seen_at = COALESCE(course_progress.first_seen_at, excluded.first_seen_at),
       cracked_at = COALESCE(course_progress.cracked_at, excluded.cracked_at),
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
    [nodeId(ref), ref.course, ref.unit, ref.node, next, now, next >= 1 ? now : null, now],
  );
}
