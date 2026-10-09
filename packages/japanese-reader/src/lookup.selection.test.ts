/**
 * What a drag selection is answered with.
 *
 * Selecting 展開 in チェーン展開の新古書店 answered チェーン展開: the expansion
 * step runs first and returns on its first hit, so a selection that is itself a
 * word never got asked about. A drag says where the word ends.
 *
 * These run the shipping function. The cases in lib/smart-lookup.test.ts
 * re-implement the walk to check its shape, which cannot see this.
 */
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, EXT_DB_PATH, hasBothDbs } from "../../../test/dictionary-db";
import { autoSelectionLookup as autoSelection, selectionLookup } from "./lookup";

async function autoSelectionLookup(
  dict: ReturnType<typeof wrap>,
  text: string,
  prefix: string,
  suffix: string,
) {
  return autoSelection(text, dict, wrap(ext!), { prefix, suffix });
}

const dict = hasBothDbs ? new Database(DICT_DB_PATH, { readonly: true }) : null;
const ext = hasBothDbs ? new Database(EXT_DB_PATH, { readonly: true }) : null;
afterAll(() => {
  dict?.close();
  ext?.close();
});

const wrap = (db: Database.Database) => ({
  async getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return db.prepare(sql).all(...(params ?? [])) as T[];
  },
  async getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null> {
    return (db.prepare(sql).get(...(params ?? [])) as T) ?? null;
  },
});

async function select(text: string, prefix = "", suffix = ""): Promise<string[]> {
  const out: string[] = [];
  await selectionLookup(text, wrap(dict!), (result) => out.push(result.matchedText), {
    prefix,
    suffix,
    extendedDb: wrap(ext!),
  });
  return out;
}

describe.skipIf(!hasBothDbs)("a selection that is itself a word", () => {
  it("is answered with itself, first", async () => {
    expect(await select("展開", "チェーン", "の新古書店")).toEqual(["展開", "チェーン展開"]);
  });

  it("keeps the longer word as the second answer, not the only one", async () => {
    expect(await select("べた", "食", "。")).toEqual(["べた", "食べた"]);
  });

  it("does not repeat itself when nothing longer is there", async () => {
    expect(await select("散歩", "の", "に誘わ")).toEqual(["散歩"]);
  });
});

describe.skipIf(!hasBothDbs)("auto mode, which is what a drag actually runs", () => {
  // The reader's default mode calls autoSelectionLookup, not selectionLookup,
  // and nothing covered it until review pointed that out.
  it("answers the selection first there too", async () => {
    const results = await autoSelectionLookup(wrap(dict!), "展開", "チェーン", "の新古書店");
    expect(results.map((r) => r.matchedText)).toEqual(["展開", "チェーン展開"]);
  });
});

describe.skipIf(!hasBothDbs)("a selection that is not a word", () => {
  it("still reaches past its edges", async () => {
    expect(await select("色い", "茶", "シャツ")).toEqual(["茶色い"]);
    expect(await select("くもない", "若", "という")).toEqual(["若くもない"]);
  });

  it("still walks a long selection word by word", async () => {
    expect(await select("若くもないというのに姿", "", "勢がよく")).toEqual([
      "若くもない",
      "というのに",
      "姿勢",
    ]);
  });
});
