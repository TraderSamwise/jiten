/**
 * Grounding is best-effort, and that is the whole contract: every failure here
 * has to degrade to "no grounding" rather than to a failed generation, because
 * the learner pressed Generate and is owed a story either way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crowdStoryFor, glyphOriginFor } from "./kanji-lore";

const PAGE = (wikitext: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ source: wikitext }),
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.TURSO_QUOTA_DB_URL;
  delete process.env.TURSO_QUOTA_DB_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the glyph origin lookup", () => {
  it("renders the section as prose", async () => {
    fetchMock.mockResolvedValue(
      PAGE(
        "==Chinese==\n===Glyph origin===\n{{Han compound|水|每|c1=s|c2=p|alt1=氵|t1=water|ls=psc}}.\n\n===Pronunciation===\nx",
      ),
    );
    expect(await glyphOriginFor("海")).toBe(
      "Phono-semantic compound: semantic 氵 (water) + phonetic 每.",
    );
  });

  it("returns nothing for a page without the section", async () => {
    fetchMock.mockResolvedValue(PAGE("==Japanese==\n===Kanji===\nstroke count"));
    expect(await glyphOriginFor("々")).toBeNull();
  });

  it("asks once for a character Wiktionary does not have", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    expect(await glyphOriginFor("𠆢")).toBeNull();
    expect(await glyphOriginFor("𠆢")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up quietly when Wiktionary is down", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    expect(await glyphOriginFor("霜")).toBeNull();
  });

  it("does not cache an outage as an answer", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await glyphOriginFor("露");
    fetchMock.mockResolvedValue(PAGE("===Glyph origin===\n{{liushu|p}}: dew."));
    expect(await glyphOriginFor("露")).toBe("Pictogram: dew.");
  });

  it("returns nothing when the request throws", async () => {
    fetchMock.mockRejectedValue(new Error("timed out"));
    await expect(glyphOriginFor("雹")).resolves.toBeNull();
  });
});

describe("the crowd story lookup", () => {
  it("returns nothing, and asks nothing, when no database is configured", async () => {
    await expect(crowdStoryFor("日")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
