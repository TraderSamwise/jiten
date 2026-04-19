// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EntrySummary } from "@/components/EntrySummary";
import type { DictEntry } from "@/db/types";

vi.mock("react-native", () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ label }: { label: string }) => <span>{label}</span>,
}));

vi.mock("@/components/PitchAccent", () => ({
  PitchAccent: ({ accent }: { accent: { reading: string; pitchNumber: number } }) => (
    <span>{`PA:${accent.reading}:${accent.pitchNumber}`}</span>
  ),
}));

vi.mock("@/stores/bookmarks", () => ({
  useBookmarkStore: (selector: (state: { bookmarkedIds: Set<string> }) => unknown) =>
    selector({ bookmarkedIds: new Set() }),
}));

function makeEntry(overrides?: Partial<DictEntry>): DictEntry {
  return {
    id: 1,
    common: true,
    jlptLevel: 1,
    kanji: [{ text: "珍妙", common: true, tags: [] }],
    kana: [{ text: "ちんみょう", romaji: null, common: true, tags: [] }],
    senses: [
      {
        partOfSpeech: ["adj-na", "n"],
        glosses: [{ lang: "eng", text: "queer; odd; fantastic" }],
        field: null,
        misc: null,
        info: null,
      },
    ],
    pitchAccents: [{ reading: "ちんみょう", pitchNumber: 2 }],
    ...overrides,
  };
}

describe("EntrySummary", () => {
  it("renders all kana readings in the default summary variant", () => {
    const entry = makeEntry({
      kana: [
        { text: "ちんみょう", romaji: null, common: true, tags: [] },
        { text: "くじける", romaji: null, common: false, tags: [] },
      ],
      pitchAccents: [{ reading: "ちんみょう", pitchNumber: 2 }],
    });

    render(<EntrySummary entry={entry} />);

    expect(screen.getByText("珍妙")).toBeTruthy();
    expect(screen.getByText("PA:ちんみょう:2")).toBeTruthy();
    expect(screen.getByText("くじける")).toBeTruthy();
  });

  it("keeps the primary reading present while only stacking alternate readings", () => {
    const entry = makeEntry({
      kana: [
        { text: "あた", romaji: null, common: true, tags: [] },
        { text: "た", romaji: null, common: false, tags: [] },
      ],
      pitchAccents: [],
      kanji: [{ text: "咫", common: false, tags: [] }],
    });

    render(<EntrySummary entry={entry} />);

    expect(screen.getByText("咫")).toBeTruthy();
    expect(screen.getByText("あた")).toBeTruthy();
    expect(screen.getByText("た")).toBeTruthy();
  });
});
