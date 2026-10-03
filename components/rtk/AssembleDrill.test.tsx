// @vitest-environment jsdom

/**
 * Assembling is the drill with an order, so the two things worth pinning are
 * that a right order is only right in that order, and that a wrong tap ends the
 * question immediately and shows what the order was.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssembleDrill } from "@/components/rtk/AssembleDrill";
import type { KanjiPrimitive } from "@/db/types";
import type { AssemblePiece } from "@/lib/rtk-assemble";
import type { CourseFrame } from "@/lib/rtk-course";

vi.mock("react-native", () => ({
  Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/PrimitiveGlyph", () => ({
  PrimitiveGlyph: ({
    glyph,
    displayGlyph,
  }: {
    glyph?: string | null;
    displayGlyph?: string | null;
  }) => <span>{glyph ?? displayGlyph ?? "?"}</span>,
}));

afterEach(cleanup);

const frame: CourseFrame = { literal: "宣", index: 180, keyword: "proclaim", lesson: 5 };

function component(position: number, glyph: string, keyword: string): KanjiPrimitive {
  return { position, glyph, primitiveId: null, keyword, isPrimitive: false, displayGlyph: null };
}

const primitives = [component(1, "宀", "house"), component(2, "亘", "span")];

const pool: AssemblePiece[] = [
  { target: "木", glyph: "木", displayGlyph: null, keyword: "tree" },
  { target: "日", glyph: "日", displayGlyph: null, keyword: "sun" },
  { target: "田", glyph: "田", displayGlyph: null, keyword: "rice field" },
];

function drill(handlers: {
  onAnswer?: ReturnType<typeof vi.fn>;
  onDone?: ReturnType<typeof vi.fn>;
  onUnaskable?: ReturnType<typeof vi.fn>;
  primitives?: KanjiPrimitive[];
}) {
  const props = {
    frame,
    keyword: null,
    primitives: handlers.primitives ?? primitives,
    pool,
    onAnswer: handlers.onAnswer ?? vi.fn(),
    onDone: handlers.onDone ?? vi.fn(),
    onUnaskable: handlers.onUnaskable ?? vi.fn(),
  };
  render(<AssembleDrill {...(props as React.ComponentProps<typeof AssembleDrill>)} />);
  return props;
}

describe("the board", () => {
  it("offers the parts and some decoys", () => {
    drill({});
    expect(screen.getByText("house")).toBeTruthy();
    expect(screen.getByText("span")).toBeTruthy();
    expect(screen.getByText("tree")).toBeTruthy();
  });

  it("asks nothing of a frame with one component", () => {
    const onUnaskable = vi.fn();
    drill({ primitives: [component(1, "宀", "house")], onUnaskable });
    expect(onUnaskable).toHaveBeenCalledTimes(1);
  });

  it("asks nothing of a frame whose decomposition has a gap", () => {
    // A named component with neither a glyph nor an id: 231 frames carry one,
    // and a board missing a part would teach a wrong decomposition.
    const onUnaskable = vi.fn();
    const unlinked: KanjiPrimitive = {
      position: 3,
      glyph: null,
      primitiveId: null,
      keyword: "fireplace",
      isPrimitive: true,
      displayGlyph: null,
    };
    drill({ primitives: [...primitives, unlinked], onUnaskable });
    expect(onUnaskable).toHaveBeenCalledTimes(1);
  });

  it("asks nothing of a frame with no components", () => {
    // 隙 匕 喩 嗅 惧 箋 have none at all.
    const onUnaskable = vi.fn();
    drill({ primitives: [], onUnaskable });
    expect(onUnaskable).toHaveBeenCalledTimes(1);
  });
});

describe("tapping", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("accepts the parts in writing order and moves on", () => {
    const onAnswer = vi.fn();
    const onDone = vi.fn();
    drill({ onAnswer, onDone });

    fireEvent.click(screen.getByText("house"));
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("span"));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ correct: true }));

    act(() => void vi.advanceTimersByTime(700));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ends the question on the first out-of-order tap", () => {
    const onAnswer = vi.fn();
    drill({ onAnswer });
    fireEvent.click(screen.getByText("span"));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ correct: false }));
    expect(screen.getByText("In writing order:")).toBeTruthy();
  });

  it("ends the question on a decoy", () => {
    const onAnswer = vi.fn();
    drill({ onAnswer });
    fireEvent.click(screen.getByText("tree"));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ correct: false }));
  });

  it("keeps both taps when two land in one batch", () => {
    // Both handlers would read the same stale `picked` and the first tap would
    // be lost, scoring a miss for a learner who tapped in the right order.
    const onAnswer = vi.fn();
    drill({ onAnswer });
    act(() => {
      fireEvent.click(screen.getByText("house"));
      fireEvent.click(screen.getByText("span"));
    });
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ correct: true }));
  });

  it("counts one answer however many times the learner taps", () => {
    const onAnswer = vi.fn();
    drill({ onAnswer });
    act(() => {
      fireEvent.click(screen.getByText("tree"));
      fireEvent.click(screen.getByText("house"));
      fireEvent.click(screen.getByText("span"));
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("waits for a tap after a miss rather than moving on", () => {
    const onDone = vi.fn();
    drill({ onDone });
    fireEvent.click(screen.getByText("span"));
    act(() => void vi.advanceTimersByTime(5000));
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Got it"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
