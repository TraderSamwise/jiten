/**
 * The name_freq column is only useful if the file behind it is actually read.
 *
 * Every failure here is silent by default: a missing file, a truncated file or
 * a comment line parsed as data all produce a dictionary that builds cleanly,
 * ships, and reads 杏子 as あんず again with nothing in the log to say why. So
 * the loader throws, and these pin that it does.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadNameFrequencies } from "./lib/name-frequency";

const SHIPPED = path.resolve(__dirname, "..", "data", "name-frequency.tsv");

/** A throwaway file, so no test can leave the shipped one damaged. */
const withFile = (contents: string | null): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "name-freq-"));
  const file = path.join(dir, "name-frequency.tsv");
  if (contents !== null) fs.writeFileSync(file, contents);
  return file;
};

describe("loadNameFrequencies", () => {
  it("reads the shipped file and ranks 杏子 towards きょうこ", () => {
    const counts = loadNameFrequencies(SHIPPED);
    expect(counts.get("杏子\tきょうこ") ?? 0).toBeGreaterThan(counts.get("杏子\tあんず") ?? 0);
  });

  it("keeps 高遠 counted and 後味 uncounted, which is what separates them", () => {
    const counts = loadNameFrequencies(SHIPPED);
    expect(counts.get("高遠\tたかとお") ?? 0).toBeGreaterThan(0);
    expect(counts.get("後味\tごみ")).toBeUndefined();
  });

  it("skips the header comments rather than parsing them as pairs", () => {
    for (const key of loadNameFrequencies(SHIPPED).keys()) {
      expect(key.startsWith("#")).toBe(false);
    }
  });

  it("throws when the file is missing instead of building without counts", () => {
    expect(() => loadNameFrequencies(withFile(null))).toThrow(/Run 'yarn build:name-freq'/);
  });

  it("throws when the file has comments but no counts", () => {
    expect(() => loadNameFrequencies(withFile("# derived 2026-10-01\n"))).toThrow(
      /holds no counts/,
    );
  });

  it("throws on a malformed line rather than dropping it", () => {
    expect(() => loadNameFrequencies(withFile("杏子\tきょうこ\t25\n杏子\tあんず\n"))).toThrow(
      /Malformed line/,
    );
  });

  it("throws on a non-positive count", () => {
    expect(() => loadNameFrequencies(withFile("杏子\tきょうこ\t0\n"))).toThrow(/Malformed line/);
  });

  it("parses a well-formed file", () => {
    const counts = loadNameFrequencies(withFile("# header\n杏子\tきょうこ\t25\n杏子\tあんず\t2\n"));
    expect([...counts]).toEqual([
      ["杏子\tきょうこ", 25],
      ["杏子\tあんず", 2],
    ]);
  });
});
