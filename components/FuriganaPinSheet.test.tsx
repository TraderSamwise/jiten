// @vitest-environment jsdom

/**
 * The sheet carries one distinction that is easy to lose: no pin at all is
 * `null`, and a pin that says "show nothing here" is the empty string. A falsy
 * check anywhere between the hook and these rows turns the second into the
 * first, and the user cannot tell the reader to leave a run alone.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FuriganaPinSheet } from "@/components/FuriganaPinSheet";
import type { FuriganaReadingCandidate } from "@tradersamwise/jiten-reader-react-native";

vi.mock("react-native", () => ({
  ActivityIndicator: () => <span>loading</span>,
  Modal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? <div>{children}</div> : null,
  Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/icons", () => ({
  Check: () => <span>CHECK</span>,
  Trash2: () => <span>TRASH</span>,
  X: () => <span>X</span>,
}));

afterEach(cleanup);

const CANDIDATES: FuriganaReadingCandidate[] = [
  { reading: "きょうこ", source: "name", kind: "name", label: "fem", note: "26 of 33 sightings" },
  { reading: "あんず", source: "word", kind: "word", label: "apricot" },
];

/**
 * What the page is already showing ranks as "current" and is still a word or a
 * name — `kind` is what the row says it is, so the active row keeps its category.
 */
const WITH_ACTIVE: FuriganaReadingCandidate[] = [
  { reading: "あんず", source: "current", kind: "word", label: "apricot" },
  { reading: "きょうこ", source: "name", kind: "name", label: "fem" },
];

function sheet(props: Partial<React.ComponentProps<typeof FuriganaPinSheet>> = {}) {
  return render(
    <FuriganaPinSheet
      visible
      run="杏子"
      candidates={CANDIDATES}
      loading={false}
      pinnedReading={null}
      onChoose={() => {}}
      onRemove={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("FuriganaPinSheet", () => {
  it("lists every reading with where it came from", () => {
    sheet();
    expect(screen.getByText("きょうこ")).toBeTruthy();
    expect(screen.getByText(/Name · fem · 26 of 33 sightings/)).toBeTruthy();
    expect(screen.getByText(/Word · apricot/)).toBeTruthy();
  });

  it("marks the reading that is pinned", () => {
    sheet({ pinnedReading: "きょうこ" });
    expect(screen.getAllByText("CHECK")).toHaveLength(1);
  });

  /**
   * Which furigana is active is shown by marking its row, not by writing "on
   * the page" in the row's detail line — the mark says it in the place the eye
   * is already looking.
   */
  it("marks the reading the page is showing, with nothing pinned", () => {
    sheet({ candidates: WITH_ACTIVE, pinnedReading: null });
    expect(screen.getAllByText("CHECK")).toHaveLength(1);
    expect(screen.queryByText(/On the page/)).toBeNull();
    // And it still says what it is, rather than only that it is active.
    expect(screen.getByText(/Word · apricot/)).toBeTruthy();
  });

  it("marks nothing when the run carries no furigana at all", () => {
    sheet({ candidates: CANDIDATES, pinnedReading: null });
    expect(screen.queryAllByText("CHECK")).toHaveLength(0);
  });

  it("marks one row when the pin is also what the page shows", () => {
    sheet({ candidates: WITH_ACTIVE, pinnedReading: "あんず" });
    expect(screen.getAllByText("CHECK")).toHaveLength(1);
  });

  /** The whole point of the distinction. */
  it("marks No furigana when the pin is the empty reading, and still offers removal", () => {
    sheet({ pinnedReading: "" });
    expect(screen.getAllByText("CHECK")).toHaveLength(1);
    expect(screen.getByText("Remove pinned reading")).toBeTruthy();
  });

  it("offers removal only when something is pinned", () => {
    sheet({ pinnedReading: null });
    expect(screen.queryByText("Remove pinned reading")).toBeNull();
    expect(screen.queryAllByText("CHECK")).toHaveLength(0);
  });

  /** A row with a reading and nothing else does not tell the user anything. */
  it("gives every row a category", () => {
    sheet({
      candidates: [
        ...CANDIDATES,
        { reading: "みっか", source: "counter", kind: "counter", label: "counter for days" },
      ],
    });
    expect(screen.getByText(/^Name · /)).toBeTruthy();
    expect(screen.getByText(/^Word · /)).toBeTruthy();
    expect(screen.getByText("Counter · counter for days")).toBeTruthy();
  });

  it("always offers to show no furigana", () => {
    sheet();
    expect(screen.getByText("No furigana")).toBeTruthy();
  });

  it("says so when the dictionaries know no reading", () => {
    sheet({ candidates: [], loading: false });
    expect(screen.getByText(/No reading is known for 杏子/)).toBeTruthy();
    // Even then, suppressing the run is still a choice.
    expect(screen.getByText("No furigana")).toBeTruthy();
  });

  it("shows it is still asking", () => {
    sheet({ candidates: [], loading: true });
    expect(screen.getByText("loading")).toBeTruthy();
  });

  it("hands back a removal", () => {
    let removed = 0;
    sheet({ pinnedReading: "きょうこ", onRemove: () => removed++ });
    screen.getByText("Remove pinned reading").closest("button")!.click();
    expect(removed).toBe(1);
  });

  it("hands back a dismissal", () => {
    let closed = 0;
    sheet({ onClose: () => closed++ });
    screen.getByText("X").closest("button")!.click();
    expect(closed).toBeGreaterThan(0);
  });

  it("hands back the reading that was chosen", () => {
    const chosen: string[] = [];
    sheet({ onChoose: (reading) => chosen.push(reading) });
    screen.getByText("あんず").closest("button")!.click();
    expect(chosen).toEqual(["あんず"]);

    screen.getByText("No furigana").closest("button")!.click();
    expect(chosen).toEqual(["あんず", ""]);
  });
});
