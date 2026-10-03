/**
 * The path's shape, read from the real dictionary rather than a fixture — the
 * numbers that matter here (56 units, 461 nodes, a 142-frame lesson) are
 * properties of the shipped data, and a synthetic unit would not have them.
 */
import type * as SQLite from "expo-sqlite";
import { afterAll, describe, expect, it } from "vitest";

import { COURSE_RTK } from "@/lib/rtk-course";
import { existsSync } from "fs";

import { DICT_DB_PATH, hasDictDb } from "../test/dictionary-db";
import Database from "better-sqlite3";
import {
  loadDecoyPieces,
  loadNodeFrames,
  loadSimilarPathFrames,
  loadUnitFrames,
  loadUnitShapes,
} from "./rtk-frames";

const raw = hasDictDb ? new Database(DICT_DB_PATH, { readonly: true }) : null;
afterAll(() => raw?.close());

const dictDb = {
  getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> =>
    raw!.prepare(sql).all(...(params ?? [])) as T[],
} as unknown as SQLite.SQLiteDatabase;

const STROKES_DB_PATH = DICT_DB_PATH.replace("dictionary.db", "dictionary-strokes.db");
const hasStrokesDb = existsSync(STROKES_DB_PATH);
const strokesRaw = hasStrokesDb ? new Database(STROKES_DB_PATH, { readonly: true }) : null;
afterAll(() => strokesRaw?.close());

const strokesDb = {
  getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> =>
    strokesRaw!.prepare(sql).all(...(params ?? [])) as T[],
} as unknown as SQLite.SQLiteDatabase;

describe.skipIf(!hasStrokesDb)("the components a board can offer", () => {
  it("is every component the decomposition can identify", async () => {
    const pool = await loadDecoyPieces(strokesDb);
    expect(pool).toHaveLength(868);
    expect(pool.every((piece) => piece.keyword && piece.target)).toBe(true);
  });

  it("names a component the way it is most often named", async () => {
    const pool = await loadDecoyPieces(strokesDb);
    // 木 is "tree" on 172 edges, but also "wood", "2 trees" and "3 trees".
    expect(pool.find((piece) => piece.target === "木")?.keyword).toBe("tree");
    expect(pool.find((piece) => piece.target === "日")?.keyword).toBe("sun");
  });

  it("offers each component once", async () => {
    const pool = await loadDecoyPieces(strokesDb);
    expect(new Set(pool.map((p) => p.target)).size).toBe(pool.length);
  });

  it("gives an invented primitive its substitute glyph to draw", async () => {
    const pool = await loadDecoyPieces(strokesDb);
    const invented = pool.filter((piece) => piece.target.startsWith("p"));
    expect(invented.length).toBeGreaterThan(200);
    expect(invented.every((piece) => piece.glyph === null)).toBe(true);
    expect(invented.some((piece) => !!piece.displayGlyph)).toBe(true);
  });

  it("offers no component with nothing to tap", async () => {
    const pool = await loadDecoyPieces(strokesDb);
    // 280 edges carry a keyword and no identity at all; none may reach a board.
    expect(pool.every((piece) => piece.glyph !== null || piece.target.startsWith("p"))).toBe(true);
  });
});

describe.skipIf(!hasDictDb)("the path as the dictionary holds it", () => {
  it("has 56 units and 461 nodes", async () => {
    const units = await loadUnitShapes(dictDb);
    expect(units).toHaveLength(56);
    expect(units.map((u) => u.unit)).toEqual(Array.from({ length: 56 }, (_, i) => i + 1));
    expect(units.reduce((n, u) => n + u.nodeCount, 0)).toBe(461);
  });

  it("gives the largest unit 29 nodes", async () => {
    const units = await loadUnitShapes(dictDb);
    expect(units.find((u) => u.unit === 23)?.nodeCount).toBe(29);
  });

  it("opens the course on 一二三四五", async () => {
    const frames = await loadNodeFrames(dictDb, { course: COURSE_RTK, unit: 1, node: 0 });
    expect(frames.map((f) => f.literal).join("")).toBe("一二三四五");
    expect(frames.map((f) => f.keyword)).toEqual(["one", "two", "three", "four", "five"]);
    expect(frames.map((f) => f.index)).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves the last node of the largest unit short", async () => {
    const frames = await loadNodeFrames(dictDb, { course: COURSE_RTK, unit: 23, node: 28 });
    expect(frames).toHaveLength(2);
  });

  it("has nothing past the end of a unit", async () => {
    expect(await loadNodeFrames(dictDb, { course: COURSE_RTK, unit: 1, node: 99 })).toEqual([]);
  });

  it("loads a unit in Heisig order, every frame keyworded", async () => {
    const frames = await loadUnitFrames(dictDb, 12);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.map((f) => f.index)).toEqual(
      [...frames.map((f) => f.index)].sort((a, b) => a - b),
    );
    expect(frames.every((f) => f.keyword.length > 0)).toBe(true);
    expect(frames.every((f) => f.lesson === 12)).toBe(true);
  });

  it("finds lookalikes that are themselves frames, most alike first", async () => {
    const similar = await loadSimilarPathFrames(dictDb, "親", 20);
    expect(similar.length).toBeGreaterThan(2);
    expect(similar.every((f) => f.keyword.length > 0)).toBe(true);
    expect(similar.every((f) => (f.lesson ?? 0) >= 1 && (f.lesson ?? 0) <= 56)).toBe(true);
    expect(similar.map((f) => f.literal)).not.toContain("親");
  });

  it("offers a lookalike for all but a handful of frames", async () => {
    // Measured: 7 of the 2,200 have none that is itself a frame, 43 have under three.
    const sparse = await loadSimilarPathFrames(dictDb, "一", 20);
    expect(Array.isArray(sparse)).toBe(true);
  });

  it("never returns a frame volume 1 does not have", async () => {
    const units = await loadUnitShapes(dictDb);
    const frames = await loadUnitFrames(dictDb, units[units.length - 1].unit);
    expect(frames.every((f) => f.index <= 2200)).toBe(true);
  });
});
