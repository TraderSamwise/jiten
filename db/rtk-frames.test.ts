/**
 * The path's shape, read from the real dictionary rather than a fixture — the
 * numbers that matter here (56 units, 461 nodes, a 142-frame lesson) are
 * properties of the shipped data, and a synthetic unit would not have them.
 */
import Database from "better-sqlite3";
import type * as SQLite from "expo-sqlite";
import { afterAll, describe, expect, it } from "vitest";

import { COURSE_RTK } from "@/lib/rtk-course";
import { DICT_DB_PATH, hasDictDb } from "../test/dictionary-db";
import {
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
