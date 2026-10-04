// @vitest-environment jsdom

/**
 * The course path. It had no test at all, which is how it shipped with a
 * 24x24 tap target inside a scrolling list — so this covers what the tiles
 * replaced it with: the frames each one names, the cap on a 29-node lesson,
 * and the fact that one tap opens one node.
 *
 * Lives here rather than beside the screen because expo-router bundles every
 * .tsx under app/ as a route.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CROWN_MAX, unitSpan, type PathSummary, type UnitRow } from "@/lib/rtk-course";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  /** What the list was last told to watch besides its data. */
  extraData: [] as unknown[],
  path: { summary: null as PathSummary | null, unavailable: false },
  counts: { due: 0, unseen: 0, scheduled: 0, nextDueAt: null as string | null, dueThrough: "" },
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: h.push }),
  // The screen clears its opening state on focus; running the effect once is
  // what a focused screen does.
  useFocusEffect: (effect: () => void | (() => void)) => {
    React.useEffect(effect, [effect]);
  },
}));

vi.mock("@/hooks/useRtkPath", () => ({ useRtkPath: () => h.path }));

vi.mock("@/lib/rtk-review", () => ({
  RTK_REVIEW_LIST_ID: "default-rtk-review",
  ensureRtkReviewList: async () => {},
  rtkReviewCounts: async () => h.counts,
  nextCardLine: () => "Every crowned frame is scheduled.",
}));

// Stable: a fresh object each render would re-run the Review pane's focus
// effect every render, and its count would land after the test had finished.
const userDb = {};
vi.mock("@/db/user-provider", () => ({ useUserDb: () => userDb }));
vi.mock("jotai", () => ({ useAtomValue: () => 3 }));
vi.mock("@/stores/settings", () => ({ dayResetHourAtom: {} }));

vi.mock("react-native", () => ({
  ActivityIndicator: () => <span>spinner</span>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    accessibilityState?: { busy?: boolean; disabled?: boolean };
  }) => (
    <button onClick={onPress} aria-label={accessibilityLabel} aria-busy={accessibilityState?.busy}>
      {children}
    </button>
  ),
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

/**
 * Renders the header and every row, so renderItem is exercised, and records
 * every `extraData` it is handed.
 *
 * It cannot simulate recycling: the real list memoises a cell on `renderItem`
 * among other things, and this screen's `renderItem` is a fresh arrow each
 * render, so rows re-render there too — by accident. That accident is why the
 * contract is asserted directly below instead.
 */
vi.mock("@shopify/flash-list", () => {
  const Row = React.memo(function Row({
    item,
    index,
    render,
  }: {
    item: UnitRow;
    index: number;
    extraData?: unknown;
    render: (info: { item: UnitRow; index: number }) => React.ReactNode;
  }) {
    return <div>{render({ item, index })}</div>;
  });
  return {
    FlashList: ({
      data,
      renderItem,
      ListHeaderComponent,
      keyExtractor,
      extraData,
    }: {
      data: UnitRow[];
      renderItem: (info: { item: UnitRow; index: number }) => React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      keyExtractor: (row: UnitRow) => string;
      extraData?: unknown;
    }) => {
      h.extraData.push(extraData);
      return (
        <div>
          {ListHeaderComponent}
          {data.map((item, index) => (
            <Row
              key={keyExtractor(item)}
              item={item}
              index={index}
              extraData={extraData}
              render={renderItem}
            />
          ))}
        </div>
      );
    },
  };
});

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    options,
    onChange,
  }: {
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

import RtkScreen from "@/app/(tabs)/learn/rtk";

/** Lesson 2 of the real course: frames 16-34, four nodes. */
function lesson(unit: number, frames: number, firstFrame: number, crowns: number[]): UnitRow {
  const span = unitSpan(frames, firstFrame);
  return {
    unit,
    ...span,
    crowns,
    earned: crowns.reduce((a, b) => a + b, 0),
    possible: crowns.length * CROWN_MAX,
  };
}

function summaryOf(rows: UnitRow[], next: PathSummary["next"] = null): PathSummary {
  return {
    rows,
    next,
    earned: rows.reduce((a, row) => a + row.earned, 0),
    possible: rows.reduce((a, row) => a + row.possible, 0),
  };
}

const LESSON_2 = lesson(2, 19, 16, [3, 1, 0, 0]);

beforeEach(() => {
  h.push.mockClear();
  h.extraData = [];
  h.path = { summary: summaryOf([LESSON_2]), unavailable: false };
  h.counts = { due: 0, unseen: 0, scheduled: 0, nextDueAt: null, dueThrough: "" };
});

afterEach(cleanup);

describe("a node tile", () => {
  it("names the frames it will ask about", () => {
    render(<RtkScreen />);
    expect(screen.getByText("16–20")).toBeTruthy();
    expect(screen.getByText("21–25")).toBeTruthy();
    // 19 frames over four nodes: the last holds four.
    expect(screen.getByText("31–34")).toBeTruthy();
  });

  it("says its crown in a word, not only a shade", () => {
    render(<RtkScreen />);
    expect(screen.getByText("done")).toBeTruthy();
    expect(screen.getByText("crown 1")).toBeTruthy();
    expect(screen.getAllByText("new")).toHaveLength(2);
  });

  it("tells a screen reader which frames and what state", () => {
    render(<RtkScreen />);
    expect(screen.getByLabelText("Frames 16 to 20, done")).toBeTruthy();
    expect(screen.getByLabelText(`Frames 21 to 25, crown 1 of ${CROWN_MAX}`)).toBeTruthy();
    expect(screen.getByLabelText("Frames 26 to 30, not started")).toBeTruthy();
  });

  it("opens its own node", () => {
    render(<RtkScreen />);
    fireEvent.click(screen.getByLabelText("Frames 21 to 25, crown 1 of 3"));
    expect(h.push).toHaveBeenCalledWith("/learn/node?unit=2&node=1");
  });

  it("opens one node however many times it is tapped", () => {
    // The spinner says a push is under way; a second tap used to push again.
    render(<RtkScreen />);
    const tile = screen.getByLabelText("Frames 16 to 20, done");
    fireEvent.click(tile);
    fireEvent.click(tile);
    fireEvent.click(screen.getByLabelText("Frames 26 to 30, not started"));
    expect(h.push).toHaveBeenCalledTimes(1);
  });

  it("marks the tile it is opening as busy", () => {
    render(<RtkScreen />);
    fireEvent.click(screen.getByLabelText("Frames 16 to 20, done"));
    expect(screen.getByLabelText("Frames 16 to 20, done").getAttribute("aria-busy")).toBe("true");
  });
});

describe("the lesson card", () => {
  it("states the lesson's own frames", () => {
    render(<RtkScreen />);
    expect(screen.getByText("frames 16–34")).toBeTruthy();
  });

  it("says nothing about frames it cannot vouch for", () => {
    // A span wider than the frame count: the tiles fall back and so must the
    // header, rather than printing a range nobody can stand behind.
    // Synthetic: every shipped lesson is one unbroken run, and a test is the
    // only way to see what happens if one is not. `frames` and `nodeCount`
    // stay consistent with each other — only the span is wider than its frames.
    const gapped: UnitRow = { ...LESSON_2, lastFrame: 40 };
    h.path = { summary: summaryOf([gapped]), unavailable: false };
    render(<RtkScreen />);
    expect(screen.queryByText(/^frames /)).toBeNull();
    expect(screen.getByText("node 1")).toBeTruthy();
    expect(screen.getByLabelText("Node 1, done")).toBeTruthy();
  });
});

describe("a lesson with more nodes than fit", () => {
  // Lesson 23: 142 frames, 29 nodes — 8 rows of tiles if they all showed.
  const big = lesson(
    23,
    142,
    1000,
    Array.from({ length: 29 }, () => 0),
  );

  beforeEach(() => {
    h.path = { summary: summaryOf([big]), unavailable: false };
  });

  it("shows the first eight and offers the rest", () => {
    render(<RtkScreen />);
    expect(screen.getAllByLabelText(/^Frames /)).toHaveLength(8);
    expect(screen.getByText("+21")).toBeTruthy();
  });

  it("shows them all once asked", () => {
    render(<RtkScreen />);
    fireEvent.click(screen.getByLabelText("Show the remaining 21 nodes of lesson 23"));
    expect(screen.getAllByLabelText(/^Frames /)).toHaveLength(29);
    expect(screen.queryByText("+21")).toBeNull();
  });

  it("tells the list that expansion is state it has to watch", () => {
    // The list memoises a cell on its props. Expansion works today only
    // because renderItem happens to be a fresh arrow every render — wrap that
    // in useCallback, as any tidy-up would, and expanding stops doing anything
    // unless the state is declared. So the declaration itself is the assertion.
    render(<RtkScreen />);
    expect(h.extraData.at(-1)).toBeInstanceOf(Set);
    const before = h.extraData.at(-1);
    fireEvent.click(screen.getByLabelText("Show the remaining 21 nodes of lesson 23"));
    expect(h.extraData.at(-1)).not.toBe(before);
    expect(h.extraData.at(-1)).toEqual(new Set([23]));
  });

  it("can be folded back up", () => {
    // An accidental tap used to leave a 556pt card open for the session.
    render(<RtkScreen />);
    fireEvent.click(screen.getByLabelText("Show the remaining 21 nodes of lesson 23"));
    fireEvent.click(screen.getByLabelText("Show fewer nodes of lesson 23"));
    expect(screen.getAllByLabelText(/^Frames /)).toHaveLength(8);
  });

  it("labels a four-digit lesson without losing the range", () => {
    render(<RtkScreen />);
    expect(screen.getByText("1000–1004")).toBeTruthy();
  });
});

describe("the quick way on", () => {
  it("continues into the next node without going via a lesson", () => {
    h.path = {
      summary: summaryOf([LESSON_2], { course: "rtk", unit: 2, node: 2 }),
      unavailable: false,
    };
    render(<RtkScreen />);
    fireEvent.click(screen.getByText("Continue"));
    expect(h.push).toHaveBeenCalledWith("/learn/node?unit=2&node=2");
  });

  it("gives way to Review, which has its own content", async () => {
    render(<RtkScreen />);
    fireEvent.click(screen.getByText("Review"));
    expect(screen.queryByText("16–20")).toBeNull();
    expect(await screen.findByText("Nothing to review yet")).toBeTruthy();
  });

  it("says so when every frame is crowned", () => {
    const done = lesson(2, 19, 16, [3, 3, 3, 3]);
    h.path = { summary: summaryOf([done]), unavailable: false };
    render(<RtkScreen />);
    expect(screen.getByText("Every frame is crowned")).toBeTruthy();
    expect(screen.queryByText("Continue")).toBeNull();
  });

  it("counts the crowns and the lessons", () => {
    render(<RtkScreen />);
    expect(screen.getByText(/4 of 12 crowns/)).toBeTruthy();
  });

  it("says the dictionary is missing rather than drawing an empty path", () => {
    h.path = { summary: null, unavailable: true };
    render(<RtkScreen />);
    expect(screen.getByText(/needs the dictionary/)).toBeTruthy();
  });
});
