/**
 * A pinned reading is the user overruling the dictionary for one book: 杏子 is
 * きょうこ in this novel and あんず in the next one, and no amount of corpus
 * frequency settles that. The store has to survive a re-pin, a removal, and a
 * re-pin after removal, and it has to keep two books apart.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@/test/test-db";
import { clearAllPins, clearPin, listPins, pinId, setPin } from "./furigana-pins";

type TestDb = ReturnType<typeof createTestDb>;

describe("furigana pins", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => db.close());

  it("remembers a reading for a book", async () => {
    await setPin(db, "book-1", "杏子", "きょうこ");
    expect(await listPins(db, "book-1")).toEqual(new Map([["杏子", "きょうこ"]]));
  });

  it("replaces a pin rather than adding a second row", async () => {
    await setPin(db, "book-1", "杏子", "あんず");
    await setPin(db, "book-1", "杏子", "きょうこ");

    expect(await listPins(db, "book-1")).toEqual(new Map([["杏子", "きょうこ"]]));
    const rows = await db.getAllAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM furigana_pins WHERE book_id = ?",
      ["book-1"],
    );
    expect(rows[0].n).toBe(1);
  });

  /**
   * The empty reading is a pin, not the absence of one — it is how "show no
   * furigana over this run" is stored. A store that cannot tell them apart
   * silently turns a suppression into a dictionary lookup.
   */
  it("keeps the empty reading as a pin of its own", async () => {
    await setPin(db, "book-1", "後味", "");

    const pins = await listPins(db, "book-1");
    expect(pins.has("後味")).toBe(true);
    expect(pins.get("後味")).toBe("");
  });

  it("stops listing a removed pin, and takes it back afterwards", async () => {
    await setPin(db, "book-1", "杏子", "きょうこ");
    await clearPin(db, "book-1", "杏子");
    expect(await listPins(db, "book-1")).toEqual(new Map());

    await setPin(db, "book-1", "杏子", "きょうこ");
    expect(await listPins(db, "book-1")).toEqual(new Map([["杏子", "きょうこ"]]));
  });

  it("clears a whole book without touching another", async () => {
    await setPin(db, "book-1", "杏子", "きょうこ");
    await setPin(db, "book-1", "後味", "あとあじ");
    await setPin(db, "book-2", "杏子", "あんず");

    await clearAllPins(db, "book-1");

    expect(await listPins(db, "book-1")).toEqual(new Map());
    expect(await listPins(db, "book-2")).toEqual(new Map([["杏子", "あんず"]]));
  });

  it("keeps two books' pins for the same run apart", async () => {
    await setPin(db, "book-1", "杏子", "きょうこ");
    await setPin(db, "book-2", "杏子", "あんず");

    expect(await listPins(db, "book-1")).toEqual(new Map([["杏子", "きょうこ"]]));
    expect(await listPins(db, "book-2")).toEqual(new Map([["杏子", "あんず"]]));
  });

  /**
   * The id has to be derived from the key, not generated: two devices pinning
   * the same run would otherwise create two rows, and last-write-wins has
   * nothing to collapse them with.
   */
  it("derives the row id from the book and the run", async () => {
    expect(pinId("book-1", "杏子")).toBe(pinId("book-1", "杏子"));
    expect(pinId("book-1", "杏子")).not.toBe(pinId("book-2", "杏子"));
    expect(pinId("book-1", "杏子")).not.toBe(pinId("book-1", "後味"));

    await setPin(db, "book-1", "杏子", "きょうこ");
    const row = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM furigana_pins WHERE book_id = ? AND surface = ?",
      ["book-1", "杏子"],
    );
    expect(row?.id).toBe(pinId("book-1", "杏子"));
  });

  it("has nothing to say about a book it has never seen", async () => {
    expect(await listPins(db, "no-such-book")).toEqual(new Map());
  });

  /**
   * There is deliberately no foreign key to `books` — sync pulls tables in
   * `MUTABLE_TABLES` order, and a pin must outlive a soft-deleted book — so a
   * pin on a book id the table has never heard of has to be writable.
   */
  it("pins a run for a book that is not in the books table", async () => {
    await setPin(db, "never-imported", "杏子", "きょうこ");
    expect(await listPins(db, "never-imported")).toEqual(new Map([["杏子", "きょうこ"]]));
  });

  it("refuses a key it could not tell apart from another", async () => {
    await expect(setPin(db, "book-1", "", "きょうこ")).rejects.toThrow(/surface/);
    // U+001F joins the two halves of the id, so a run containing one would
    // alias onto a different book's pin.
    await expect(setPin(db, "book-1", "杏子", "きょうこ")).rejects.toThrow(/U\+001F/);
    await expect(setPin(db, "book1", "杏子", "きょうこ")).rejects.toThrow(/U\+001F/);
  });

  it("marks a removed pin deleted rather than dropping the row, so the removal syncs", async () => {
    await setPin(db, "book-1", "杏子", "きょうこ");
    await clearPin(db, "book-1", "杏子");

    const row = await db.getFirstAsync<{ deleted_at: string | null; updated_at: string }>(
      "SELECT deleted_at, updated_at FROM furigana_pins WHERE id = ?",
      [pinId("book-1", "杏子")],
    );
    expect(row?.deleted_at).toBeTruthy();
    expect(row?.updated_at).toBe(row?.deleted_at);
  });
});
