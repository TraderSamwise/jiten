import { describe, test, expect } from "vitest";
import { parseListImport, type JitenExportFile } from "./list-transfer";

// ─── Helpers ───

function validExport(overrides?: Partial<JitenExportFile>): JitenExportFile {
  return {
    format: "jiten-list-v1",
    exportedAt: "2025-01-15T10:00:00.000Z",
    list: {
      name: "JLPT N5 Vocab",
      description: "Basic vocabulary",
      flashcardMode: "add_order",
      frontFaces: ["kanji"],
      backFaces: ["english"],
      autoPlayAudio: false,
    },
    entries: [
      { entryId: 1000, addedAt: "2025-01-15T10:00:00.000Z" },
      { entryId: 2000, addedAt: "2025-01-15T10:01:00.000Z" },
    ],
    ...overrides,
  };
}

// ─── parseListImport ───

describe("parseListImport", () => {
  describe("valid input", () => {
    test("parses a minimal valid export", () => {
      const data = validExport();
      const result = parseListImport(JSON.stringify(data));
      expect(result.format).toBe("jiten-list-v1");
      expect(result.list.name).toBe("JLPT N5 Vocab");
      expect(result.entries).toHaveLength(2);
    });

    test("preserves all list fields", () => {
      const data = validExport({
        list: {
          name: "Verbs",
          description: null,
          flashcardMode: "srs",
          frontFaces: ["kana", "kanji"],
          backFaces: ["english"],
          autoPlayAudio: true,
        },
      });
      const result = parseListImport(JSON.stringify(data));
      expect(result.list).toEqual(data.list);
    });

    test("preserves entry data", () => {
      const data = validExport();
      const result = parseListImport(JSON.stringify(data));
      expect(result.entries[0]).toEqual({
        entryId: 1000,
        addedAt: "2025-01-15T10:00:00.000Z",
      });
    });

    test("parses export with study history", () => {
      const data = validExport({
        studyHistory: {
          studyPosition: 5,
          srsCards: [
            {
              entryId: 1000,
              due: "2025-01-20T00:00:00.000Z",
              stability: 4.5,
              difficulty: 5.0,
              elapsedDays: 3,
              scheduledDays: 5,
              reps: 3,
              lapses: 0,
              state: 2,
              lastReview: "2025-01-15T10:00:00.000Z",
              frontMode: "kanji",
              backMode: "english",
              createdAt: "2025-01-10T10:00:00.000Z",
              updatedAt: "2025-01-15T10:00:00.000Z",
              reviewLogs: [
                {
                  rating: 3,
                  state: 2,
                  due: "2025-01-20T00:00:00.000Z",
                  stability: 4.5,
                  difficulty: 5.0,
                  elapsedDays: 3,
                  scheduledDays: 5,
                  reviewedAt: "2025-01-15T10:00:00.000Z",
                },
              ],
            },
          ],
        },
      });
      const result = parseListImport(JSON.stringify(data));
      expect(result.studyHistory).toBeDefined();
      expect(result.studyHistory!.studyPosition).toBe(5);
      expect(result.studyHistory!.srsCards).toHaveLength(1);
      expect(result.studyHistory!.srsCards![0].reviewLogs).toHaveLength(1);
    });

    test("accepts export with empty entries array", () => {
      const data = validExport({ entries: [] });
      const result = parseListImport(JSON.stringify(data));
      expect(result.entries).toHaveLength(0);
    });

    test("accepts export without studyHistory", () => {
      const data = validExport();
      delete (data as any).studyHistory;
      const result = parseListImport(JSON.stringify(data));
      expect(result.studyHistory).toBeUndefined();
    });
  });

  describe("invalid input", () => {
    test("rejects invalid JSON", () => {
      expect(() => parseListImport("{not json")).toThrow("Invalid JSON file");
    });

    test("rejects empty string", () => {
      expect(() => parseListImport("")).toThrow("Invalid JSON file");
    });

    test("rejects wrong format identifier", () => {
      const data = validExport();
      (data as any).format = "unknown-v2";
      expect(() => parseListImport(JSON.stringify(data))).toThrow("Unrecognized file format");
    });

    test("rejects missing format field", () => {
      const data = validExport();
      delete (data as any).format;
      expect(() => parseListImport(JSON.stringify(data))).toThrow("Unrecognized file format");
    });

    test("rejects missing list object", () => {
      const data = validExport();
      delete (data as any).list;
      expect(() => parseListImport(JSON.stringify(data))).toThrow("Missing list data");
    });

    test("rejects list without name", () => {
      const data = validExport();
      delete (data as any).list.name;
      expect(() => parseListImport(JSON.stringify(data))).toThrow("Missing list data");
    });

    test("rejects missing entries array", () => {
      const data = validExport();
      delete (data as any).entries;
      expect(() => parseListImport(JSON.stringify(data))).toThrow("Missing entries data");
    });

    test("rejects entries as non-array", () => {
      const data = validExport();
      (data as any).entries = "not an array";
      expect(() => parseListImport(JSON.stringify(data))).toThrow("Missing entries data");
    });
  });
});
