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

/** A crown lookup for lib/rtk-course's nextNode and pathSummary. */
export function crownsFromProgress(progress: Map<string, CourseProgressRow>): NodeCrowns {
  return { crownOf: (id) => progress.get(id)?.crown ?? 0 };
}

/**
 * Records that a node has been opened. Deliberately does NOT touch
 * `updated_at` on a row that already exists: opening a node is not progress,
 * and sync merges whole rows last-write-wins — so a bump here would let a stale
 * device's mere look at a node overwrite a crown earned on another one.
 *
 * A soft-deleted row is revived as genuinely new: the learner asked for the
 * course progress to be deleted, and reopening a node must not resurrect the
 * crown they threw away.
 */
export async function markNodeSeen(db: WrappedUserDb, ref: NodeRef): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO course_progress
       (id, course, unit, node, crown, first_seen_at, cracked_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 0, ?, NULL, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       crown = CASE WHEN course_progress.deleted_at IS NULL THEN course_progress.crown ELSE 0 END,
       cracked_at = CASE WHEN course_progress.deleted_at IS NULL THEN course_progress.cracked_at ELSE NULL END,
       first_seen_at = CASE
         WHEN course_progress.deleted_at IS NULL
           THEN COALESCE(course_progress.first_seen_at, excluded.first_seen_at)
         ELSE excluded.first_seen_at END,
       updated_at = CASE
         WHEN course_progress.deleted_at IS NULL THEN course_progress.updated_at
         ELSE excluded.updated_at END,
       deleted_at = NULL`,
    [nodeId(ref), ref.course, ref.unit, ref.node, now, now],
  );
}

/**
 * Awards a crown, clamped to CROWN_MAX. MAX() keeps a racing write on THIS
 * device from lowering it; sync is plain last-write-wins, so a newer remote row
 * still can — the cost is one node re-crowned, per db/sync-helpers.ts. A
 * soft-deleted row takes the new crown rather than the maximum, or a deleted
 * course would come back at whatever it was before.
 */
export async function awardCrown(db: WrappedUserDb, ref: NodeRef, crown: number): Promise<void> {
  const next = Math.max(0, Math.min(Math.trunc(crown), CROWN_MAX));
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO course_progress
       (id, course, unit, node, crown, first_seen_at, cracked_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       crown = CASE
         WHEN course_progress.deleted_at IS NULL
           THEN MAX(course_progress.crown, excluded.crown)
         ELSE excluded.crown END,
       first_seen_at = COALESCE(course_progress.first_seen_at, excluded.first_seen_at),
       cracked_at = CASE
         WHEN course_progress.deleted_at IS NULL
           THEN COALESCE(course_progress.cracked_at, excluded.cracked_at)
         ELSE excluded.cracked_at END,
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
    [nodeId(ref), ref.course, ref.unit, ref.node, next, now, next >= 1 ? now : null, now],
  );
}
