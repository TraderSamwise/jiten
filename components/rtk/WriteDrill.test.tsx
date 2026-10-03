// @vitest-environment jsdom

/**
 * Writing is self-graded, so the thing to pin is that the learner cannot grade
 * before seeing the answer, cannot grade twice, and that what they drew is kept
 * in the same coordinate box as the real strokes it is compared against.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WriteDrill } from "@/components/rtk/WriteDrill";
import type { StrokePath } from "@/db/types";
import type { CourseFrame } from "@/lib/rtk-course";

vi.mock("react-native", () => ({
  Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  // The responder props are the drawing surface: a mock that drops them would
  // leave the whole stroke-capture path untested.
  View: ({
    children,
    onLayout,
    onResponderGrant,
    onResponderMove,
    onResponderRelease,
  }: {
    children?: React.ReactNode;
    onLayout?: (e: unknown) => void;
    onResponderGrant?: (e: unknown) => void;
    onResponderMove?: (e: unknown) => void;
    onResponderRelease?: () => void;
  }) => (
    <div
      data-canvas={onResponderGrant ? "yes" : "no"}
      onFocus={() => onLayout?.({ nativeEvent: { layout: { width: 109 } } })}
      onMouseDown={(e) =>
        onResponderGrant?.({
          nativeEvent: {
            locationX: Number(e.clientX),
            locationY: Number(e.clientY),
            touches: [{}],
          },
        })
      }
      onMouseMove={(e) =>
        onResponderMove?.({
          nativeEvent: {
            locationX: Number(e.clientX),
            locationY: Number(e.clientY),
            touches: e.buttons === 2 ? [{}, {}] : [{}],
          },
        })
      }
      onMouseUp={() => onResponderRelease?.()}
    >
      {children}
    </div>
  ),
}));

vi.mock("react-native-svg", () => ({
  default: ({ children, viewBox }: { children?: React.ReactNode; viewBox?: string }) => (
    <svg data-viewbox={viewBox}>{children}</svg>
  ),
  Path: ({ d, stroke }: { d?: string; stroke?: string }) => (
    <span data-stroke={stroke}>{`PATH:${d}`}</span>
  ),
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

afterEach(cleanup);

const frame: CourseFrame = { literal: "親", index: 1621, keyword: "parent", lesson: 39 };
const strokes: StrokePath[] = [
  { type: "s", d: "M10,10L90,10" },
  { type: "s", d: "M10,50L90,50" },
];

function drill(handlers: {
  onAnswer?: ReturnType<typeof vi.fn>;
  onDone?: ReturnType<typeof vi.fn>;
}) {
  const props = {
    frame,
    keyword: null,
    strokes,
    onAnswer: handlers.onAnswer ?? vi.fn(),
    onDone: handlers.onDone ?? vi.fn(),
  };
  render(<WriteDrill {...(props as React.ComponentProps<typeof WriteDrill>)} />);
  return props;
}

describe("the question", () => {
  it("asks for the keyword, not the kanji", () => {
    drill({});
    expect(screen.getByText("Write it")).toBeTruthy();
    expect(screen.getByText("parent")).toBeTruthy();
    expect(screen.queryByText("親")).toBeNull();
  });

  it("prefers the learner's own keyword", () => {
    render(
      <WriteDrill
        frame={frame}
        keyword="folks"
        strokes={strokes}
        onAnswer={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText("folks")).toBeTruthy();
  });

  it("draws in the same box as the strokes it will be compared against", () => {
    drill({});
    expect(document.querySelector("svg")?.getAttribute("data-viewbox")).toBe("0 0 109 109");
  });

  it("shows nothing of the answer until asked", () => {
    drill({});
    expect(screen.queryByText(`PATH:${strokes[0].d}`)).toBeNull();
    expect(screen.queryByText("How did that go?")).toBeNull();
  });
});

describe("drawing", () => {
  const canvas = () => document.querySelector('[data-canvas="yes"]')!;
  const mine = () =>
    Array.from(document.querySelectorAll('[data-stroke="#a1a1aa"]')).map((n) => n.textContent);

  function layout() {
    // One screen pixel is one unit of the 109 box, so the maths is readable.
    fireEvent.focus(canvas());
  }

  it("records a stroke in the box the real strokes are drawn in", () => {
    drill({});
    layout();
    fireEvent.mouseDown(canvas(), { clientX: 10, clientY: 20 });
    fireEvent.mouseMove(canvas(), { clientX: 30, clientY: 40 });
    fireEvent.mouseUp(canvas());
    expect(mine()).toEqual(["PATH:M10,20L30,40"]);
  });

  it("keeps each stroke as the finger lifts", () => {
    drill({});
    layout();
    fireEvent.mouseDown(canvas(), { clientX: 1, clientY: 1 });
    fireEvent.mouseMove(canvas(), { clientX: 9, clientY: 9 });
    fireEvent.mouseUp(canvas());
    fireEvent.mouseDown(canvas(), { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(canvas(), { clientX: 30, clientY: 30 });
    fireEvent.mouseUp(canvas());
    expect(mine()).toEqual(["PATH:M1,1L9,9", "PATH:M20,20L30,30"]);
  });

  it("clamps a stroke dragged outside the square", () => {
    drill({});
    layout();
    fireEvent.mouseDown(canvas(), { clientX: -40, clientY: 5 });
    fireEvent.mouseMove(canvas(), { clientX: 400, clientY: 5 });
    fireEvent.mouseUp(canvas());
    expect(mine()).toEqual(["PATH:M0,5L109,5"]);
  });

  it("ignores a second finger rather than drawing to it", () => {
    drill({});
    layout();
    fireEvent.mouseDown(canvas(), { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas(), { clientX: 90, clientY: 90, buttons: 2 });
    fireEvent.mouseUp(canvas());
    expect(mine()).toEqual(["PATH:M10,10l0,0"]);
  });

  it("throws the drawing away on Clear", () => {
    drill({});
    layout();
    fireEvent.mouseDown(canvas(), { clientX: 5, clientY: 5 });
    fireEvent.mouseUp(canvas());
    expect(mine()).toHaveLength(1);
    fireEvent.click(screen.getByText("Clear"));
    expect(mine()).toEqual([]);
  });
});

describe("grading", () => {
  it("cannot be graded before the answer is shown", () => {
    drill({});
    for (const label of ["Could not", "Close", "Got it"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("offers the three grades once the strokes are revealed", () => {
    drill({});
    fireEvent.click(screen.getByText("Show me"));
    expect(screen.getByText(`PATH:${strokes[0].d}`)).toBeTruthy();
    expect(screen.getByText("How did that go?")).toBeTruthy();
    expect(screen.getByText("親 · 2 strokes")).toBeTruthy();
  });

  it("reports the grade and moves on", () => {
    const onAnswer = vi.fn();
    const onDone = vi.fn();
    drill({ onAnswer, onDone });
    fireEvent.click(screen.getByText("Show me"));
    fireEvent.click(screen.getByText("Close"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ grade: "close" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("takes one grade however many times the learner taps", () => {
    const onAnswer = vi.fn();
    drill({ onAnswer });
    fireEvent.click(screen.getByText("Show me"));
    act(() => {
      fireEvent.click(screen.getByText("Could not"));
      fireEvent.click(screen.getByText("Got it"));
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ grade: "missed" });
  });
});
