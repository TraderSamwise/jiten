// @vitest-environment jsdom

/**
 * Lives here, not beside the screen: expo-router's require.context treats every
 * .tsx under app/ as a route, so a test file there is bundled into the web
 * export and Metro dies on vitest's own dependency on vite.
 *
 * The runner's wiring, with the drills stubbed: they have their own tests, and
 * what goes wrong here is the queue. Two bugs this would have caught on sight —
 * an answer advancing the queue twice (which made the reveal unreachable), and a
 * choice drill mounted before its options loaded, skipping the whole node.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    // A test can narrow the node to one frame to reach a later step quickly.
    only: null as null | number,
    crown: 1,
    // Null is "this frame has no story"; a test can give it one to reach cloze.
    story: null as string | null,
    glyphOrigin: null as string | null,
    saveMnemonic: vi.fn(async () => {}),
    // A test can take the strokes tier away, as a user without it has.
    noStrokes: false,
    strokesStatus: null as string | null,
    // Stable identities: a fresh object each render would re-run the loaders'
    // effects forever, cancelling each in turn.
    primitives: [
      {
        position: 1,
        glyph: "宀",
        primitiveId: null,
        keyword: "house",
        isPrimitive: false,
        displayGlyph: null,
      },
      {
        position: 2,
        glyph: "亘",
        primitiveId: null,
        keyword: "span",
        isPrimitive: false,
        displayGlyph: null,
      },
    ],
    strokes: [{ type: "s", d: "M0,0L10,10" }],
    pieces: [
      { target: "木", glyph: "木", displayGlyph: null, keyword: "tree" },
      { target: "p1", glyph: null, displayGlyph: "促", keyword: "walking stick" },
    ],
    dictDb: {},
    strokesDb: {},
    userDb: {},
    drizzle: {},
    goBack: vi.fn(),
    markNodeSeen: vi.fn(async () => {}),
    awardCrown: vi.fn(async (..._args: unknown[]) => {}),
    graduateFrames: vi.fn(async (..._args: unknown[]) => []),
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
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) => (
    <button onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/CustomHeaderScreen", () => ({
  CustomHeaderScreen: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/navigation", () => ({ useSafeGoBack: () => h.goBack }));

vi.mock("@/lib/icons", () => ({ X: () => <span>X</span> }));

vi.mock("@/db/provider", () => ({
  useDatabase: () => ({
    dictDb: h.dictDb,
    strokesDb: h.noStrokes ? null : h.strokesDb,
    // What the runner reads to tell "the strokes tier is still coming" from
    // "this device has none": a test without it is a device with none.
    backgroundStatus: h.strokesStatus ? [{ key: "strokes", state: h.strokesStatus }] : [],
  }),
}));
vi.mock("@/db/user-provider", () => ({ useUserDb: () => h.userDb }));
vi.mock("@/db/sync-provider", () => ({ useSync: () => ({ markDirty: () => {} }) }));
vi.mock("@/db/drizzle", () => ({ getUserDrizzle: () => h.drizzle }));
vi.mock("@/db/kanji-search", () => ({ getSynonymsForKeywordAsync: async () => [] }));

/** One read per node rather than one per frame — see db/rtk-frames.ts. */
vi.mock("@/db/rtk-frames", () => ({
  loadUnitFrames: async () => (h.only ? h.frames.slice(0, h.only) : h.frames),
  // Deferred like the lookalikes, so "the tiles are not in yet" is a state the
  // test passes through rather than one it skips over.
  loadDecoyPieces: async () => h.pieces,
  loadPrimitivesForFrames: async (_db: unknown, literals: string[]) =>
    new Map(literals.map((literal) => [literal, h.primitives])),
  loadStrokesForFrames: async (_db: unknown, literals: string[]) =>
    new Map(literals.map((literal) => [literal, h.strokes])),
  // The glyph origin arrives with the node; absent until the dictionary carries
  // the prose, which is most devices until dict base v25.
  loadGlyphOrigins: async () =>
    new Map(h.glyphOrigin ? [[h.frames[0].literal, h.glyphOrigin]] : []),
  // Held a tick, so "the frames are in but the options are not" — the state
  // that used to skip the whole node — is one the test passes through.
  loadSimilarForFrames: (_db: unknown, literals: string[]) =>
    new Promise((resolve) =>
      setTimeout(() => resolve(new Map(literals.map((l) => [l, h.frames.slice(1)]))), 20),
    ),
}));

vi.mock("@/db/rtk-progress", () => ({
  getNodeProgress: async () => ({ crown: h.crown }),
  markNodeSeen: h.markNodeSeen,
  awardCrown: h.awardCrown,
}));

vi.mock("@/lib/rtk-graduate", () => ({ graduateFrames: h.graduateFrames }));

vi.mock("@/lib/practice-logger", () => ({
  logPracticeEvent: h.logPracticeEvent,
  recordConfusion: h.recordConfusion,
}));

vi.mock("@/hooks/useKanjiMnemonic", () => ({
  useKanjiMnemonic: () => ({
    mnemonic: h.story,
    keyword: null,
    loaded: true,
    saveMnemonic: h.saveMnemonic,
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
  MeetFrame: ({
    frame,
    onSave,
    canGenerate,
  }: {
    frame: CourseFrame;
    onSave: (s: string) => void;
    canGenerate: boolean;
  }) => (
    <div>
      <span>{`MEET:${frame.literal}`}</span>
      <span>{`CANGEN:${canGenerate}`}</span>
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

vi.mock("@/components/rtk/AssembleDrill", () => ({
  AssembleDrill: ({
    frame,
    pool,
    onAnswer,
    onDone,
  }: {
    frame: CourseFrame;
    pool: readonly { target: string }[];
    onAnswer: (r: { correct: boolean; responseMs: number }) => void;
    onDone: () => void;
  }) => (
    <div>
      <span>{`ASSEMBLE:${frame.literal}:${pool.length}`}</span>
      <button onClick={() => onAnswer({ correct: true, responseMs: 10 })}>built</button>
      <button onClick={onDone}>seen</button>
    </div>
  ),
}));

vi.mock("@/components/rtk/ClozeDrill", () => ({
  // Mirrors the real drill: a frame with no story hands the step back.
  ClozeDrill: ({
    frame,
    story,
    onUnaskable,
  }: {
    frame: CourseFrame;
    story: string | null;
    onUnaskable: () => void;
  }) => {
    React.useEffect(() => {
      if (!story) onUnaskable();
    }, [story, onUnaskable]);
    return <span>{`CLOZE:${frame.literal}`}</span>;
  },
}));

vi.mock("@/components/rtk/WriteDrill", () => ({
  WriteDrill: ({
    frame,
    strokes,
    onAnswer,
    onDone,
  }: {
    frame: CourseFrame;
    strokes: readonly { d: string }[];
    onAnswer: (r: { grade: string; responseMs: number }) => void;
    onDone: () => void;
  }) => (
    <div>
      <span>{`WRITE:${frame.literal}:${strokes.length}`}</span>
      <button
        onClick={() => {
          onAnswer({ grade: "got-it", responseMs: 10 });
          onDone();
        }}
      >
        wrote
      </button>
      <button
        onClick={() => {
          onAnswer({ grade: "missed", responseMs: 10 });
          onDone();
        }}
      >
        blank
      </button>
    </div>
  ),
}));

import LearnNodeScreen from "@/app/(tabs)/learn/node";

afterEach(() => {
  cleanup();
  h.only = null;
  h.noStrokes = false;
  h.strokesStatus = null;
  h.crown = 1;
  h.story = null;
});

beforeEach(() => {
  h.markNodeSeen.mockClear();
  h.awardCrown.mockClear();
  h.graduateFrames.mockClear();
  h.saveMnemonic.mockClear();
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

describe("a node's first visit", () => {
  it("offers a way out of the node, not a label", async () => {
    // It used to read "Path", which named a destination rather than an exit —
    // and named it in a word the screen it leads to does not use.
    h.crown = 0;
    render(<LearnNodeScreen />);
    await screen.findByText(/^MEET:/);
    fireEvent.click(screen.getByLabelText("Leave node"));
    expect(h.goBack).toHaveBeenCalled();
  });

  it("meets every frame before it asks anything", async () => {
    h.crown = 0;
    render(<LearnNodeScreen />);
    // Crown 0 opens on Meet, which no test used to reach at all.
    expect((await screen.findByText(/^MEET:/)).textContent).toBe("MEET:一");
    expect(screen.queryByText(/^DRILL:/)).toBeNull();
  });

  it("offers Generate on a device with no stroke data at all", async () => {
    // The bug this covers: generation was gated on the strokes tier, so every
    // frame read "needs stroke data" and the button did nothing — on a device
    // where the background download had never finished, which is most of them
    // on first run. The server grounds a story without the primitives.
    h.crown = 0;
    h.noStrokes = true;
    render(<LearnNodeScreen />);
    await screen.findByText(/^MEET:/);
    expect(screen.getByText("CANGEN:true")).toBeTruthy();
  });

  it("waits while the stroke data is still downloading", async () => {
    // Worth the wait: the primitives make a better story, and the story is saved.
    h.crown = 0;
    h.noStrokes = true;
    h.strokesStatus = "downloading";
    render(<LearnNodeScreen />);
    await screen.findByText(/^MEET:/);
    expect(screen.getByText("CANGEN:false")).toBeTruthy();
  });

  it("counts the steps it holds, and drops one when a step turns out unaskable", async () => {
    h.crown = 0;
    h.only = 1;
    render(<LearnNodeScreen />);
    await screen.findByText(/^MEET:/);
    // meet + recognise + identify + cloze, for one frame.
    expect(document.body.textContent).toContain("1 of 4");

    fireEvent.click(screen.getByText("save"));
    for (let i = 0; i < 2; i++) {
      fireEvent.click(await screen.findByText("right"));
      fireEvent.click(screen.getByText("seen"));
    }
    // The cloze had no story to blank, so it left: three were ever asked.
    expect(document.body.textContent).toContain("3 of 3");
  });

  it("moves on once the story is saved, and saves it once", async () => {
    h.crown = 0;
    h.only = 1;
    render(<LearnNodeScreen />);
    await screen.findByText(/^MEET:/);

    act(() => {
      fireEvent.click(screen.getByText("save"));
      fireEvent.click(screen.getByText("save"));
    });
    // Two taps on an async write would advance twice and skip the next frame.
    expect(h.saveMnemonic).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/^DRILL:/)).toBeTruthy();
  });
});

describe("the cloze step", () => {
  it("is asked when the frame has a story", async () => {
    h.crown = 0;
    h.only = 1;
    h.story = "a [needle] through a [tree] makes a {self}";
    render(<LearnNodeScreen />);
    await screen.findByText(/^MEET:/);
    fireEvent.click(screen.getByText("save"));

    for (let i = 0; i < 2; i++) {
      fireEvent.click(await screen.findByText("right"));
      fireEvent.click(screen.getByText("seen"));
    }
    // It used to hand itself back before the note had even been read.
    expect(screen.getByText("CLOZE:一")).toBeTruthy();
  });
});

describe("assembling", () => {
  it("comes after the choice questions, with the decoy pool in hand", async () => {
    h.only = 1;
    await open();

    // Crown 1 runs recognise, identify, then assemble over this one frame.
    expect(question()).toBe("DRILL:kanji:一");
    fireEvent.click(screen.getByText("right"));
    fireEvent.click(screen.getByText("seen"));
    expect(question()).toBe("DRILL:keyword:一");
    fireEvent.click(screen.getByText("right"));
    fireEvent.click(screen.getByText("seen"));

    expect(screen.getByText("ASSEMBLE:一:2")).toBeTruthy();
  });

  it("records an order mistake as practice, with no confusion pair", async () => {
    h.only = 1;
    await open();
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByText("right"));
      fireEvent.click(screen.getByText("seen"));
    }
    h.logPracticeEvent.mockClear();

    fireEvent.click(screen.getByText("built"));
    expect(h.logPracticeEvent).toHaveBeenCalledTimes(1);
    expect(h.logPracticeEvent.mock.calls[0][1]).toMatchObject({
      kanjiLiteral: "一",
      practiceMode: "rtk_assemble",
      correct: true,
    });
    // Tapping the parts out of order is not mistaking one kanji for another.
    expect(h.recordConfusion).not.toHaveBeenCalled();
  });
});

describe("writing", () => {
  it("comes last, with the frame's strokes to reveal", async () => {
    h.only = 1;
    h.crown = 2;
    await open();

    // Crown 2 runs identify, assemble, then write.
    expect(question()).toBe("DRILL:keyword:一");
    fireEvent.click(screen.getByText("right"));
    fireEvent.click(screen.getByText("seen"));

    expect(await screen.findByText(/^ASSEMBLE:/)).toBeTruthy();
    fireEvent.click(screen.getByText("built"));
    fireEvent.click(screen.getByText("seen"));

    expect(screen.getByText("WRITE:一:1")).toBeTruthy();
  });

  it("records the learner's own verdict, and a blank is a miss", async () => {
    h.only = 1;
    h.crown = 2;
    await open();
    fireEvent.click(screen.getByText("right"));
    fireEvent.click(screen.getByText("seen"));
    await screen.findByText(/^ASSEMBLE:/);
    fireEvent.click(screen.getByText("built"));
    fireEvent.click(screen.getByText("seen"));
    h.logPracticeEvent.mockClear();

    fireEvent.click(screen.getByText("blank"));
    expect(h.logPracticeEvent.mock.calls[0][1]).toMatchObject({
      practiceMode: "rtk_write",
      correct: false,
      typedAnswer: "missed",
    });
    // A miss comes back: the node is not finished.
    expect(screen.getByText("WRITE:一:1")).toBeTruthy();
  });
});

describe("without the strokes tier", () => {
  it("drops assembling from the pass rather than waiting for it", async () => {
    h.only = 1;
    h.noStrokes = true;
    await open();

    fireEvent.click(screen.getByText("right"));
    fireEvent.click(screen.getByText("seen"));
    fireEvent.click(screen.getByText("right"));
    fireEvent.click(screen.getByText("seen"));

    // The node is finished: there is no third question to wait for.
    expect(screen.queryByText(/^ASSEMBLE:/)).toBeNull();
    expect(screen.getByText("Back to the path")).toBeTruthy();
  });
});

describe("finishing a node", () => {
  it("awards the next crown and makes the cards", async () => {
    h.only = 1;
    h.crown = 1;
    await open();
    // recognise, identify, assemble, then the storyless cloze hands itself back.
    fireEvent.click(screen.getByText("right"));
    fireEvent.click(screen.getByText("seen"));
    fireEvent.click(screen.getByText("right"));
    fireEvent.click(screen.getByText("seen"));
    expect(await screen.findByText(/^ASSEMBLE:/)).toBeTruthy();
    fireEvent.click(screen.getByText("built"));
    fireEvent.click(screen.getByText("seen"));

    expect(screen.getByText("Crowned")).toBeTruthy();
    expect(h.awardCrown).toHaveBeenCalledTimes(1);
    expect(h.awardCrown.mock.calls[0][2]).toBe(2);
    expect(h.graduateFrames).toHaveBeenCalledTimes(1);
    expect(h.graduateFrames.mock.calls[0][2]).toBe(1);
  });

  it("awards nothing when every step was skipped", async () => {
    h.only = 1;
    h.crown = 1;
    h.noStrokes = true;
    await open();
    fireEvent.click(screen.getByText("unaskable"));
    fireEvent.click(screen.getByText("unaskable"));

    expect(h.awardCrown).not.toHaveBeenCalled();
    expect(h.graduateFrames).not.toHaveBeenCalled();
  });
});

describe("opening the node", () => {
  it("records it as seen", async () => {
    await open();
    expect(h.markNodeSeen).toHaveBeenCalledTimes(1);
  });
});
