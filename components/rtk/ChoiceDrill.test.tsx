// @vitest-environment jsdom

/**
 * The drill has to be honest about three things: it reports exactly one answer
 * per question however many times the learner taps, a miss shows the frame's
 * own story rather than just the right answer, and a question it cannot ask
 * (too few options) is handed back rather than shown with two choices.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChoiceDrill } from "@/components/rtk/ChoiceDrill";
import type { CourseFrame } from "@/lib/rtk-course";

vi.mock("react-native", () => ({
  Pressable: ({
    children,
    onPress,
    disabled,
    className,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button onClick={onPress} disabled={disabled} data-class={className}>
      {children}
    </button>
  ),
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/PrimitiveChips", () => ({ PrimitiveChips: () => <span>CHIPS</span> }));
vi.mock("@/components/MnemonicText", () => ({
  MnemonicText: ({ mnemonic }: { mnemonic?: string | null }) => <span>STORY:{mnemonic}</span>,
}));

afterEach(cleanup);

function frame(literal: string, index: number): CourseFrame {
  return { literal, index, keyword: `kw-${literal}`, lesson: 1 };
}

const answer = frame("日", 12);
const similar = [frame("目", 15), frame("白", 37), frame("田", 14)];

function drill(
  overrides: Partial<React.ComponentProps<typeof ChoiceDrill>> = {},
  handlers: {
    onAnswer?: ReturnType<typeof vi.fn>;
    onDone?: ReturnType<typeof vi.fn>;
    onUnaskable?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const props = {
    prompt: "kanji" as const,
    frame: answer,
    keyword: null,
    similar,
    unit: [],
    story: null,
    primitives: [],
    onAnswer: handlers.onAnswer ?? vi.fn(),
    onDone: handlers.onDone ?? vi.fn(),
    onUnaskable: handlers.onUnaskable ?? vi.fn(),
    ...overrides,
  };
  render(<ChoiceDrill {...(props as React.ComponentProps<typeof ChoiceDrill>)} />);
  return props;
}

describe("asking the question", () => {
  it("shows the kanji and four keywords when recognising", () => {
    drill();
    expect(screen.getByText("日")).toBeTruthy();
    expect(screen.getByText("What does this mean?")).toBeTruthy();
    for (const f of [answer, ...similar]) expect(screen.getByText(f.keyword)).toBeTruthy();
  });

  it("shows the keyword and four kanji when identifying", () => {
    drill({ prompt: "keyword" });
    expect(screen.getByText("Which one is this?")).toBeTruthy();
    for (const f of [answer, ...similar]) expect(screen.getByText(f.literal)).toBeTruthy();
  });

  it("prefers the learner's own keyword in the question", () => {
    drill({ prompt: "keyword", keyword: "sunshine" });
    expect(screen.getByText("sunshine")).toBeTruthy();
  });

  it("prefers it on the right answer too, so the two cannot disagree", () => {
    drill({ prompt: "kanji", keyword: "sunshine" });
    expect(screen.getByText("sunshine")).toBeTruthy();
    expect(screen.queryByText(answer.keyword)).toBeNull();
    // The distractors keep the dictionary's wording, which is all they have.
    expect(screen.getByText(similar[0].keyword)).toBeTruthy();
  });
});

describe("answering", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("reports a right answer and moves on by itself", () => {
    const onAnswer = vi.fn();
    const onDone = vi.fn();
    drill({}, { onAnswer, onDone });

    fireEvent.click(screen.getByText(answer.keyword));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ correct: true, picked: answer });
    expect(onDone).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(700));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("waits for the learner after a miss, and shows their story", () => {
    const onAnswer = vi.fn();
    const onDone = vi.fn();
    drill({ story: "a [sun] rises" }, { onAnswer, onDone });

    fireEvent.click(screen.getByText(similar[0].keyword));
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ correct: false, picked: similar[0] });
    expect(screen.getByText("STORY:a [sun] rises")).toBeTruthy();

    act(() => void vi.advanceTimersByTime(5000));
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Got it"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows the primitives when there is no story to show", () => {
    drill({ story: null });
    fireEvent.click(screen.getByText(similar[0].keyword));
    expect(screen.getByText("CHIPS")).toBeTruthy();
  });

  it("counts one answer however many times the learner taps", () => {
    const onAnswer = vi.fn();
    drill({}, { onAnswer });
    const option = screen.getByText(similar[1].keyword);
    const other = screen.getByText(answer.keyword);
    // One act, so every tap lands before a re-render — which is what a real
    // double-tap does, and why the guard is a ref rather than state.
    act(() => {
      fireEvent.click(option);
      fireEvent.click(option);
      fireEvent.click(other);
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});

describe("a question it cannot ask", () => {
  it("hands back a frame with no distractors at all", () => {
    const onUnaskable = vi.fn();
    drill({ similar: [], unit: [] }, { onUnaskable });
    expect(onUnaskable).toHaveBeenCalledTimes(1);
  });

  it("asks when there are enough options", () => {
    const onUnaskable = vi.fn();
    drill({ similar: [similar[0]], unit: [] }, { onUnaskable });
    expect(onUnaskable).not.toHaveBeenCalled();
  });
});
