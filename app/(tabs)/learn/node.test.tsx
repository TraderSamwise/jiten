// @vitest-environment jsdom

/**
 * The runner's wiring, with the drills stubbed: they have their own tests, and
 * what goes wrong here is the queue. Two bugs this would have caught on sight —
 * an answer advancing the queue twice (which made the reveal unreachable), and a
 * choice drill mounted before its options loaded, skipping the whole node.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseFrame } from "@/lib/rtk-course";

// vi.mock factories are hoisted above every const in this file, so everything
// they touch has to be hoisted with them.
const h = vi.hoisted(() => {
  const frames = ["一", "二", "三", "四", "五"].map((literal, i) => ({
    literal,
    index: i + 1,
    keyword: ["one", "two", "three", "four", "five"][i],
    lesson: 1,
  }));
  return {
    frames,
    // Stable identities: a fresh object each render would re-run the loaders'
    // effects forever, cancelling each in turn.
    dictDb: {},
    strokesDb: {},
    userDb: {},
    drizzle: {},
    markNodeSeen: vi.fn(async () => {}),
    logPracticeEvent: vi.fn(async (..._args: unknown[]) => {}),
    recordConfusion: vi.fn(async (..._args: unknown[]) => {}),
  };
});

const FRAMES = h.frames as CourseFrame[];

vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ unit: "1", node: "0" }),
}));

vi.mock("react-native", () => ({
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/CustomHeaderScreen", () => ({
  CustomHeaderScreen: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/navigation", () => ({ useSafeGoBack: () => () => {} }));

vi.mock("@/db/provider", () => ({
  useDatabase: () => ({ dictDb: h.dictDb, strokesDb: h.strokesDb }),
}));
vi.mock("@/db/user-provider", () => ({ useUserDb: () => h.userDb }));
vi.mock("@/db/sync-provider", () => ({ useSync: () => ({ markDirty: () => {} }) }));
vi.mock("@/db/drizzle", () => ({ getUserDrizzle: () => h.drizzle }));
vi.mock("@/db/kanji-search", () => ({ getPrimitivesForKanjiAsync: async () => [] }));

vi.mock("@/db/rtk-frames", () => ({
  loadNodeFrames: async () => h.frames,
  loadUnitFrames: async () => h.frames,
  // Held until the test releases it, so "before the pool loads" is reachable.
  // Resolves a tick late, so "the frames are in but the options are not" — the
  // state that used to skip the whole node — is a state the test passes through.
  loadSimilarPathFrames: () =>
    new Promise((resolve) => setTimeout(() => resolve(h.frames.slice(1)), 20)),
}));

vi.mock("@/db/rtk-progress", () => ({
  getNodeProgress: async () => ({ crown: 1 }),
  markNodeSeen: h.markNodeSeen,
}));

vi.mock("@/lib/practice-logger", () => ({
  logPracticeEvent: h.logPracticeEvent,
  recordConfusion: h.recordConfusion,
}));

vi.mock("@/hooks/useKanjiMnemonic", () => ({
  useKanjiMnemonic: () => ({
    mnemonic: null,
    keyword: null,
    loaded: true,
    saveMnemonic: async () => {},
    saveNote: async () => {},
  }),
}));

vi.mock("@/hooks/useMnemonicGeneration", () => ({
  useMnemonicGeneration: () => ({
    state: { literal: null, story: null, attempt: 0, loading: false, message: null },
    generate: async () => null,
    prefetch: async () => {},
  }),
}));

// The drills, stubbed: a button per callback, and a label naming the question.
vi.mock("@/components/rtk/MeetFrame", () => ({
  MeetFrame: ({ frame, onSave }: { frame: CourseFrame; onSave: (s: string) => void }) => (
    <div>
      <span>{`MEET:${frame.literal}`}</span>
      <button onClick={() => onSave("a story")}>save</button>
    </div>
  ),
}));

vi.mock("@/components/rtk/ChoiceDrill", () => ({
  ChoiceDrill: ({
    frame,
    prompt,
    onAnswer,
    onDone,
    onUnaskable,
  }: {
    frame: CourseFrame;
    prompt: string;
    onAnswer: (r: { correct: boolean; picked: CourseFrame; responseMs: number }) => void;
    onDone: () => void;
    onUnaskable: () => void;
  }) => (
    <div>
      <span>{`DRILL:${prompt}:${frame.literal}`}</span>
      <button onClick={() => onAnswer({ correct: true, picked: frame, responseMs: 10 })}>
        right
      </button>
      <button
        onClick={() =>
          onAnswer({ correct: false, picked: h.frames[4] as CourseFrame, responseMs: 10 })
        }
      >
        wrong
      </button>
      <button onClick={onDone}>seen</button>
      <button onClick={onUnaskable}>unaskable</button>
    </div>
  ),
}));

import LearnNodeScreen from "./node";

afterEach(cleanup);

beforeEach(() => {
  h.markNodeSeen.mockClear();
  h.logPracticeEvent.mockClear();
  h.recordConfusion.mockClear();
});

/** Renders and waits for the first question, options and all. */
async function open() {
  render(<LearnNodeScreen />);
  return screen.findByText(/^DRILL:/);
}

function question(): string | null {
  return screen.queryByText(/^DRILL:/)?.textContent ?? null;
}

describe("before the options have loaded", () => {
  it("waits instead of skipping every question in the node", async () => {
    render(<LearnNodeScreen />);
    // Nothing has resolved yet, and crucially nothing has been skipped.
    expect(question()).toBeNull();
    expect(screen.getByText("loading")).toBeTruthy();

    // Crown 1 starts at recognise, on the node's first frame.
    expect((await screen.findByText(/^DRILL:/)).textContent).toBe("DRILL:kanji:一");
  });
});

describe("answering a question", () => {
  it("advances exactly once, and only once the result has been seen", async () => {
    await open();
    expect(question()).toBe("DRILL:kanji:一");

    fireEvent.click(screen.getByText("right"));
    // Still the same question: the learner has not moved on yet.
    expect(question()).toBe("DRILL:kanji:一");

    fireEvent.click(screen.getByText("seen"));
    expect(question()).toBe("DRILL:kanji:二");
  });

  it("writes one practice row per answer and no confusion row for a hit", async () => {
    await open();

    fireEvent.click(screen.getByText("right"));
    expect(h.logPracticeEvent).toHaveBeenCalledTimes(1);
    expect(h.logPracticeEvent.mock.calls[0][1]).toMatchObject({
      entryId: 0,
      kanjiLiteral: "一",
      practiceMode: "rtk_recognise",
      correct: true,
    });
    expect(h.recordConfusion).not.toHaveBeenCalled();
  });

  it("records which frame a miss was mistaken for", async () => {
    await open();

    fireEvent.click(screen.getByText("wrong"));
    expect(h.recordConfusion).toHaveBeenCalledTimes(1);
    const [, a, b, type] = h.recordConfusion.mock.calls[0] as unknown[];
    expect([a, b]).toEqual([
      { entryId: 0, kanjiLiteral: "一" },
      { entryId: 0, kanjiLiteral: "五" },
    ]);
    expect(type).toBe("visual_kanji");
  });

  it("brings a missed question back later in the node", async () => {
    await open();

    const seen: string[] = [];
    const answer = (how: "right" | "wrong") => {
      seen.push(question()!);
      fireEvent.click(screen.getByText(how));
      fireEvent.click(screen.getByText("seen"));
    };

    answer("wrong");
    answer("right");
    answer("right");
    seen.push(question()!);

    // Missed on the first frame; it comes back two questions later, not at once.
    expect(seen).toEqual(["DRILL:kanji:一", "DRILL:kanji:二", "DRILL:kanji:三", "DRILL:kanji:一"]);
  });
});

describe("a question the course cannot ask", () => {
  it("skips just that one", async () => {
    await open();
    expect(question()).toBe("DRILL:kanji:一");
    fireEvent.click(screen.getByText("unaskable"));
    expect(question()).toBe("DRILL:kanji:二");
  });
});

describe("opening the node", () => {
  it("records it as seen", async () => {
    await open();
    expect(h.markNodeSeen).toHaveBeenCalledTimes(1);
  });
});
