import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COURSE_RTK, CROWN_MAX, nextNode, nodeId, unitSpan } from "@/lib/rtk-course";
import { createTestDb } from "@/test/test-db";
import { USER_DB_MIGRATIONS } from "./user-migrations";
import { MUTABLE_TABLES } from "./sync-helpers";
import type { WrappedUserDb } from "./user-db";
import {
  awardCrown,
  crownsFromProgress,
  getNodeProgress,
  loadCourseProgress,
  markNodeSeen,
} from "./rtk-progress";

let db: WrappedUserDb & { close: () => void };

const ref = { course: COURSE_RTK, unit: 1, node: 0 };

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

describe("the table reaches the remote", () => {
  // isRemoteRelevant in db/sync-engine.ts ships a CREATE INDEX only when its SQL
  // contains `_updated`, so renaming this index silently stops delta sync.
  it("indexes updated_at under a name the sync engine will ship", () => {
    const shipped = USER_DB_MIGRATIONS.filter(
      (sql) => sql.includes("course_progress") && /CREATE INDEX/i.test(sql),
    ).filter((sql) => sql.includes("_updated"));
    expect(shipped).toHaveLength(1);
    expect(shipped[0]).toContain("(updated_at)");
  });

  it("is registered for sync, keyed by id and timestamped by updated_at", () => {
    const entry = MUTABLE_TABLES.find((t) => t.name === "course_progress");
    expect(entry).toMatchObject({ pk: "id", timestampCol: "updated_at" });
  });
});

describe("course progress", () => {
  it("has nothing before the first node is opened", async () => {
    expect(await loadCourseProgress(db)).toEqual(new Map());
    expect(await getNodeProgress(db, ref)).toBeNull();
  });

  it("records a node as seen at crown 0", async () => {
    await markNodeSeen(db, ref);
    const row = await getNodeProgress(db, ref);
    expect(row).toMatchObject({ id: "rtk:1:0", course: COURSE_RTK, unit: 1, node: 0, crown: 0 });
    expect(row?.firstSeenAt).toBeTruthy();
    expect(row?.crackedAt).toBeNull();
  });

  it("keeps the original first_seen_at when the node is reopened", async () => {
    await markNodeSeen(db, ref);
    const first = (await getNodeProgress(db, ref))?.firstSeenAt;
    await markNodeSeen(db, ref);
    expect((await getNodeProgress(db, ref))?.firstSeenAt).toBe(first);
  });

  it("makes one row per node, not one per visit", async () => {
    await markNodeSeen(db, ref);
    await markNodeSeen(db, ref);
    await awardCrown(db, ref, 1);
    const rows = await db.getAllAsync<{ n: number }>("SELECT COUNT(*) as n FROM course_progress");
    expect(rows[0].n).toBe(1);
  });

  it("awards a crown and stamps cracked_at", async () => {
    await awardCrown(db, ref, 1);
    const row = await getNodeProgress(db, ref);
    expect(row?.crown).toBe(1);
    expect(row?.crackedAt).toBeTruthy();
  });

  it("never lowers a crown already earned", async () => {
    await awardCrown(db, ref, 2);
    await awardCrown(db, ref, 1);
    expect((await getNodeProgress(db, ref))?.crown).toBe(2);
  });

  it("clamps a crown to the cap", async () => {
    await awardCrown(db, ref, 99);
    expect((await getNodeProgress(db, ref))?.crown).toBe(CROWN_MAX);
  });

  it("keeps the first cracked_at across later crowns", async () => {
    await awardCrown(db, ref, 1);
    const cracked = (await getNodeProgress(db, ref))?.crackedAt;
    await awardCrown(db, ref, 2);
    expect((await getNodeProgress(db, ref))?.crackedAt).toBe(cracked);
  });

  it("does not stamp cracked_at for a crown-0 write", async () => {
    await awardCrown(db, ref, 0);
    expect((await getNodeProgress(db, ref))?.crackedAt).toBeNull();
  });

  it("keeps courses apart", async () => {
    await awardCrown(db, ref, 1);
    await awardCrown(db, { course: "other", unit: 1, node: 0 }, 3);
    const rtk = await loadCourseProgress(db, COURSE_RTK);
    expect([...rtk.keys()]).toEqual([nodeId(ref)]);
    expect(rtk.get(nodeId(ref))?.crown).toBe(1);
  });

  it("hides a soft-deleted row", async () => {
    await awardCrown(db, ref, 1);
    await db.runAsync("UPDATE course_progress SET deleted_at = ? WHERE id = ?", [
      new Date().toISOString(),
      nodeId(ref),
    ]);
    expect(await loadCourseProgress(db)).toEqual(new Map());
    expect(await getNodeProgress(db, ref)).toBeNull();
  });

  it("does not touch updated_at when a known node is merely reopened", async () => {
    // Sync merges whole rows last-write-wins, so a bump here would let a stale
    // device's look at a node overwrite a crown earned on another one.
    await awardCrown(db, ref, 3);
    const stamped = (await getNodeProgress(db, ref))?.updatedAt;
    await markNodeSeen(db, ref);
    const after = await getNodeProgress(db, ref);
    expect(after?.updatedAt).toBe(stamped);
    expect(after?.crown).toBe(CROWN_MAX);
  });

  it("starts a deleted node over rather than resurrecting its crown", async () => {
    // The learner asked for the progress to be deleted; reopening a node must
    // not hand back the crown they threw away.
    await awardCrown(db, ref, 3);
    await db.runAsync("UPDATE course_progress SET deleted_at = ? WHERE id = ?", [
      new Date().toISOString(),
      nodeId(ref),
    ]);
    await markNodeSeen(db, ref);
    const after = await getNodeProgress(db, ref);
    expect(after?.crown).toBe(0);
    expect(after?.crackedAt).toBeNull();
  });

  it("gives a deleted node the new crown, not the old maximum", async () => {
    await awardCrown(db, ref, 3);
    await db.runAsync("UPDATE course_progress SET deleted_at = ? WHERE id = ?", [
      new Date().toISOString(),
      nodeId(ref),
    ]);
    await awardCrown(db, ref, 1);
    expect((await getNodeProgress(db, ref))?.crown).toBe(1);
  });

  it("revives a soft-deleted row rather than colliding with it", async () => {
    await awardCrown(db, ref, 1);
    await db.runAsync("UPDATE course_progress SET deleted_at = ? WHERE id = ?", [
      new Date().toISOString(),
      nodeId(ref),
    ]);
    await awardCrown(db, ref, 2);
    expect((await getNodeProgress(db, ref))?.crown).toBe(2);
  });

  it("drives nextNode from stored crowns", async () => {
    await awardCrown(db, ref, CROWN_MAX);
    const crowns = crownsFromProgress(await loadCourseProgress(db));
    expect(nextNode([{ unit: 1, ...unitSpan(10, 1) }], crowns)).toEqual({
      course: COURSE_RTK,
      unit: 1,
      node: 1,
    });
  });
});
