import { describe, expect, it } from "vitest";
import { CLOUD_APPEND_TABLES, LOCAL_APPEND_TABLES } from "./sync-helpers";

describe("sync helper table contracts", () => {
  it("keeps only practice session summaries in live cloud append sync", () => {
    expect(CLOUD_APPEND_TABLES.map((table) => table.name)).toEqual(["practice_sessions"]);
  });

  it("retains the raw history tables locally", () => {
    expect(LOCAL_APPEND_TABLES.map((table) => table.name)).toEqual([
      "review_logs",
      "practice_events",
      "practice_sessions",
      "confusion_events",
      "game_scores",
    ]);
  });
});
