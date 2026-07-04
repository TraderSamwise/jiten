import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "./user-db";
import { resolveKanjiWordCandidates } from "./mnemonic-resolver";
import { canonicalStem } from "./primitive-associations";
import { createPrimitivesTable } from "../test/strokes-schema";

function asyncAdapter(d: Database.Database): SQLite.SQLiteDatabase {
  return {
    getAllAsync: async (sql: string, params: unknown[] = []) => d.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, params: unknown[] = []) =>
      d.prepare(sql).get(...params) ?? null,
    runAsync: async (sql: string, params: unknown[] = []) => d.prepare(sql).run(...params),
  } as unknown as SQLite.SQLiteDatabase;
}

let strokesRaw: Database.Database;
let userRaw: Database.Database;
let strokesDb: SQLite.SQLiteDatabase;
let userDb: WrappedUserDb;

beforeEach(() => {
  strokesRaw = new Database(":memory:");
  createPrimitivesTable(strokesRaw);
  strokesRaw.exec(`
    CREATE TABLE kanji_primitives (literal TEXT, position INTEGER, glyph TEXT, primitive_id INTEGER, keyword TEXT, is_primitive INTEGER);
    CREATE TABLE keyword_synonyms (keyword TEXT NOT NULL, synonym TEXT NOT NULL);
    -- 安 (relax) = house[p51] + woman[女]
    INSERT INTO kanji_primitives VALUES
      ('安', 0, NULL, 51, 'house', 1),
      ('安', 1, '女', NULL, 'woman', 0);
    INSERT INTO keyword_synonyms (keyword, synonym) VALUES
      ('house', 'home'),
      ('house', 'dwelling'),
      ('woman', 'lady');
  `);
  userRaw = new Database(":memory:");
  userRaw.exec(`
    CREATE TABLE primitive_note_assoc (literal TEXT, word TEXT, target TEXT, PRIMARY KEY (literal, word, target));
    -- the user has, in two OTHER kanji stories, used "shelter" for the house primitive
    INSERT INTO primitive_note_assoc VALUES
      ('宣', 'shelter', 'p51'),
      ('宇', 'shelter', 'p51');
  `);
  strokesDb = asyncAdapter(strokesRaw);
  userDb = asyncAdapter(userRaw) as unknown as WrappedUserDb;
});

afterEach(() => {
  strokesRaw.close();
  userRaw.close();
});

describe("resolveKanjiWordCandidates", () => {
  it("matches a primitive's own keyword with top confidence", async () => {
    const res = await resolveKanjiWordCandidates(strokesDb, userDb, "安", ["house"]);
    const c = res.get("house");
    expect(c?.[0]).toMatchObject({ target: "p51", source: "keyword", confidence: 1 });
  });

  it("matches an official synonym (house→home) below keyword strength", async () => {
    const res = await resolveKanjiWordCandidates(strokesDb, userDb, "安", ["home"]);
    const c = res.get("home");
    expect(c?.[0]).toMatchObject({ target: "p51", source: "synonym" });
    expect(c?.[0].confidence).toBeCloseTo(0.7);
  });

  it("matches a real-kanji component by glyph target (woman→lady)", async () => {
    const res = await resolveKanjiWordCandidates(strokesDb, userDb, "安", ["lady"]);
    expect(res.get("lady")?.[0]).toMatchObject({ target: "女", source: "synonym" });
  });

  it("uses the personal archive for a word that is neither keyword nor synonym", async () => {
    // "shelter" isn't a WordNet synonym here, but the user has used it for p51 twice.
    const res = await resolveKanjiWordCandidates(strokesDb, userDb, "安", ["shelter"]);
    const c = res.get("shelter");
    expect(c?.[0]).toMatchObject({ target: "p51", source: "personal" });
    expect(c?.[0].confidence).toBeCloseTo(0.76); // 0.5 + 0.13*2
  });

  it("returns nothing for an unrelated word", async () => {
    const res = await resolveKanjiWordCandidates(strokesDb, userDb, "安", ["dragon"]);
    expect(res.has("dragon")).toBe(false);
  });

  it("excludeCurrentNote drops the edited kanji's own personal associations", async () => {
    userRaw.exec(`INSERT INTO primitive_note_assoc VALUES ('安', 'shelter', 'p51')`);
    const res = await resolveKanjiWordCandidates(strokesDb, userDb, "安", ["shelter"], {
      excludeCurrentNote: true,
    });
    // still 2 other stories (宣, 宇) → personal still fires
    expect(res.get("shelter")?.[0].confidence).toBeCloseTo(0.76);
  });

  it("returns empty when the strokes tier is unavailable", async () => {
    const res = await resolveKanjiWordCandidates(null, userDb, "安", ["house"]);
    expect(res.size).toBe(0);
  });

  it("a strong personal association overrides an official synonym on the same target", async () => {
    // "home" is an official synonym of house (0.7); the user has also used it for
    // p51 in two other stories → personal 0.76 wins, with source 'personal'.
    // The index stores canonical stems, so insert canonicalStem("home").
    const hs = canonicalStem("home");
    userRaw
      .prepare(`INSERT INTO primitive_note_assoc VALUES ('宣',?,'p51'),('宇',?,'p51')`)
      .run(hs, hs);
    const c = (await resolveKanjiWordCandidates(strokesDb, userDb, "安", ["home"])).get("home");
    expect(c?.[0]).toMatchObject({ target: "p51", source: "personal" });
    expect(c?.[0].confidence).toBeCloseTo(0.76);
  });

  it("still resolves keyword/synonym when userDb is null (personal skipped)", async () => {
    const res = await resolveKanjiWordCandidates(strokesDb, null, "安", ["house", "shelter"]);
    expect(res.get("house")?.[0]).toMatchObject({ source: "keyword" });
    expect(res.has("shelter")).toBe(false); // personal-only word has no signal without userDb
  });

  it("honors a custom threshold that filters out synonym-strength matches", async () => {
    const res = await resolveKanjiWordCandidates(strokesDb, userDb, "安", ["house", "home"], {
      threshold: 0.8,
    });
    expect(res.get("house")?.[0]).toMatchObject({ source: "keyword" }); // 1.0 passes
    expect(res.has("home")).toBe(false); // synonym 0.7 < 0.8
  });

  it("returns multiple candidates when a word matches two primitives", async () => {
    strokesRaw.exec(
      `INSERT INTO keyword_synonyms (keyword, synonym) VALUES ('house','helper'),('woman','helper')`,
    );
    const c = (await resolveKanjiWordCandidates(strokesDb, userDb, "安", ["helper"])).get("helper");
    expect(c).toHaveLength(2);
    expect(new Set(c?.map((x) => x.target))).toEqual(new Set(["p51", "女"]));
  });
});
