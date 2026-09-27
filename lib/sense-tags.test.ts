import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { KNOWN_MISC_CODES, formatSenseMisc, isAbbreviationSense } from "./sense-tags";
import { DICT_DB_PATH, hasDictDb } from "../test/dictionary-db";

describe("formatSenseMisc", () => {
  test("spells out a single code", () => {
    expect(formatSenseMisc("abbr")).toEqual(["abbreviation"]);
  });

  test("spells out several codes in dictionary order", () => {
    expect(formatSenseMisc("abbr, col")).toEqual(["abbreviation", "colloquial"]);
    expect(formatSenseMisc("uk,on-mim")).toEqual([
      "usually written in kana",
      "onomatopoeic or mimetic",
    ]);
  });

  test("passes an unknown code through rather than dropping it", () => {
    expect(formatSenseMisc("abbr, brand-new-code")).toEqual(["abbreviation", "brand-new-code"]);
  });

  test("returns nothing for an empty or missing field", () => {
    expect(formatSenseMisc(null)).toEqual([]);
    expect(formatSenseMisc(undefined)).toEqual([]);
    expect(formatSenseMisc("")).toEqual([]);
    expect(formatSenseMisc(" , ")).toEqual([]);
  });
});

describe("isAbbreviationSense", () => {
  test("matches the abbr code anywhere in the list", () => {
    expect(isAbbreviationSense("abbr")).toBe(true);
    expect(isAbbreviationSense("col, abbr")).toBe(true);
    expect(isAbbreviationSense("abbr, arch, fam")).toBe(true);
  });

  test("does not match a code that merely starts the same way", () => {
    expect(isAbbreviationSense("abbrev")).toBe(false);
    expect(isAbbreviationSense("uk")).toBe(false);
    expect(isAbbreviationSense(null)).toBe(false);
  });
});

/**
 * The label table has to cover what the built dictionary actually contains, or
 * a reader sees a raw JMdict code where a sentence should be.
 */
describe.skipIf(!hasDictDb)("against the built dictionary", () => {
  test("every misc code in the dictionary has a label", () => {
    const db = new Database(DICT_DB_PATH, { readonly: true });
    const rows = db
      .prepare("SELECT DISTINCT misc FROM senses WHERE misc IS NOT NULL AND misc != ''")
      .all() as { misc: string }[];
    db.close();

    const codes = new Set(rows.flatMap((row) => row.misc.split(",").map((c) => c.trim())));
    const unlabelled = [...codes].filter((code) => !KNOWN_MISC_CODES.has(code));
    expect(unlabelled).toEqual([]);
  });

  test("各停 is marked as an abbreviation", () => {
    const db = new Database(DICT_DB_PATH, { readonly: true });
    const row = db
      .prepare(
        `SELECT misc FROM senses WHERE entry_id IN (SELECT entry_id FROM kanji WHERE text = '各停')`,
      )
      .get() as { misc: string | null } | undefined;
    db.close();

    expect(isAbbreviationSense(row?.misc)).toBe(true);
    expect(formatSenseMisc(row?.misc)).toContain("abbreviation");
  });
});
