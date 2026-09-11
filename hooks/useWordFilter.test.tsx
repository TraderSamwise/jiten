/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestDb } from "@/test/test-db";

let userDb: ReturnType<typeof createTestDb>;

vi.mock("@/db/user-provider", () => ({
  useUserDb: () => userDb,
}));

import { useWordFilter } from "./useWordFilter";

const LIST_ID = "list-1";

async function addListEntry(
  id: string,
  entryId: number,
  opts: { kanjiLiteral?: string; deletedAt?: string } = {},
) {
  await userDb.runAsync(
    `INSERT INTO list_entries (id, list_id, entry_id, added_at, kanji_literal, deleted_at)
     VALUES (?, ?, ?, '2026-01-01', ?, ?)`,
    [id, LIST_ID, entryId, opts.kanjiLiteral ?? null, opts.deletedAt ?? null],
  );
}

beforeEach(async () => {
  userDb = createTestDb();
  await userDb.runAsync(
    `INSERT INTO lists (id, name, created_at, updated_at) VALUES (?, 'Common', '2026-01-01', '2026-01-01')`,
    [LIST_ID],
  );
});

afterEach(() => {
  userDb.close();
});

describe("useWordFilter", () => {
  test("returns the list's word entries", async () => {
    await addListEntry("a", 1000001);
    await addListEntry("b", 1000002);

    const { result } = renderHook(() => useWordFilter(LIST_ID));

    await waitFor(() => expect(result.current.allCount).toBe(2));
    expect(result.current.getFilteredEntryIds("all").sort()).toEqual([1000001, 1000002]);
  });

  /**
   * Kanji entries live in the same list table with the character in
   * kanji_literal and entry_id = 0. The word games look their ids up in the
   * dictionary, which has no row for 0, so including them used to put a blank,
   * untypable word in the game and inflate the word count on the select screen.
   */
  test("excludes kanji entries", async () => {
    await addListEntry("a", 1000001);
    await addListEntry("b", 0, { kanjiLiteral: "政" });
    await addListEntry("c", 0, { kanjiLiteral: "権" });

    const { result } = renderHook(() => useWordFilter(LIST_ID));

    await waitFor(() => expect(result.current.allCount).toBe(1));
    expect(result.current.getFilteredEntryIds("all")).toEqual([1000001]);
  });

  test("excludes a kanji entry whose kanji_literal was lost", async () => {
    await addListEntry("a", 1000001);
    await addListEntry("b", 0);

    const { result } = renderHook(() => useWordFilter(LIST_ID));

    await waitFor(() => expect(result.current.allCount).toBe(1));
    expect(result.current.getFilteredEntryIds("all")).toEqual([1000001]);
  });

  test("excludes deleted entries", async () => {
    await addListEntry("a", 1000001);
    await addListEntry("b", 1000002, { deletedAt: "2026-02-01" });

    const { result } = renderHook(() => useWordFilter(LIST_ID));

    await waitFor(() => expect(result.current.allCount).toBe(1));
    expect(result.current.getFilteredEntryIds("all")).toEqual([1000001]);
  });

  test("splits review and learn by srs progress", async () => {
    await addListEntry("a", 1000001);
    await addListEntry("b", 1000002);
    await addListEntry("c", 0, { kanjiLiteral: "政" });
    await userDb.runAsync(
      `INSERT INTO srs_cards (id, entry_id, list_id, state, due, stability, difficulty,
         elapsed_days, scheduled_days, reps, lapses, last_review, created_at, updated_at)
       VALUES ('s1', 1000001, ?, 2, '2026-01-02', 1, 5, 0, 1, 1, 0, '2026-01-01', '2026-01-01', '2026-01-01')`,
      [LIST_ID],
    );

    const { result } = renderHook(() => useWordFilter(LIST_ID));

    await waitFor(() => expect(result.current.allCount).toBe(2));
    expect(result.current.reviewCount).toBe(1);
    expect(result.current.learnCount).toBe(1);
    expect(result.current.getFilteredEntryIds("review")).toEqual([1000001]);
    expect(result.current.getFilteredEntryIds("learn")).toEqual([1000002]);
  });
});
