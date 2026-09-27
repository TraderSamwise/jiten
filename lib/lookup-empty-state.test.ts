import { describe, expect, test } from "vitest";
import { emptyLookupMessage } from "./lookup-empty-state";

describe("emptyLookupMessage", () => {
  test("names the text the lookup ran on", () => {
    expect(emptyLookupMessage("窮した")).toBe("No results for 「窮した」");
    expect(emptyLookupMessage("に発破をかけてたくらいだよ")).toBe(
      "No results for 「に発破をかけてたくらいだよ」",
    );
  });

  test("falls back when there is nothing to name", () => {
    expect(emptyLookupMessage(null)).toBe("No results found");
    expect(emptyLookupMessage(undefined)).toBe("No results found");
    expect(emptyLookupMessage("")).toBe("No results found");
    expect(emptyLookupMessage("   ")).toBe("No results found");
  });

  test("trims the whitespace a drag selection picks up", () => {
    expect(emptyLookupMessage("  窮した\n")).toBe("No results for 「窮した」");
  });
});
