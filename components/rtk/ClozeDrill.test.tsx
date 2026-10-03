// @vitest-environment jsdom

/**
 * The cloze is the only drill that tests the hook rather than the frame, so what
 * matters is that it is generous about the answer (a plural, a synonym) and that
 * it says plainly whose fault a miss is: the story's.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClozeDrill } from "@/components/rtk/ClozeDrill";
import type { CourseFrame } from "@/lib/rtk-course";

vi.mock("react-native", () => ({
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    placeholder,
  }: {
    value?: string;
    onChangeText?: (t: string) => void;
    placeholder?: string;
  }) => (
    <input
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChangeText?.(e.target.value)}
    />
  ),
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/MnemonicText", () => ({
  MnemonicText: ({ mnemonic }: { mnemonic?: string | null }) => <span>{`CLOZE:${mnemonic}`}</span>,
}));

afterEach(cleanup);

const frame: CourseFrame = { literal: "親", index: 1621, keyword: "parent", lesson: 39 };

function drill(
  overrides: Partial<React.ComponentProps<typeof ClozeDrill>> = {},
  handlers: {
    onAnswer?: ReturnType<typeof vi.fn>;
    onDone?: ReturnType<typeof vi.fn>;
    onUnaskable?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const props = {
    frame,
    keyword: null,
    story: "a [needle] through a [tree] makes a {self}",
    primitives: [],
    synonyms: [] as string[],
    onAnswer: handlers.onAnswer ?? vi.fn(),
    onDone: handlers.onDone ?? vi.fn(),
    onUnaskable: handlers.onUnaskable ?? vi.fn(),
    ...overrides,
  };
  render(<ClozeDrill {...(props as React.ComponentProps<typeof ClozeDrill>)} />);
  return props;
}

const type = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText("the missing keyword"), { target: { value: text } });

describe("the question", () => {
  it("shows the story with the keyword blanked", () => {
    drill();
    expect(screen.getByText(/^CLOZE:/).textContent).toBe(
      "CLOZE:a [needle] through a [tree] makes a _____",
    );
  });

  it("hands back a frame with no story", () => {
    const onUnaskable = vi.fn();
    drill({ story: null }, { onUnaskable });
    expect(onUnaskable).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^CLOZE:/)).toBeNull();
  });

  it("hands back a story that never names the keyword", () => {
    const onUnaskable = vi.fn();
    drill({ story: "a needle and a tree" }, { onUnaskable });
    expect(onUnaskable).toHaveBeenCalledTimes(1);
  });
});

describe("answering", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("takes the keyword and moves on by itself", () => {
    const onAnswer = vi.fn();
    const onDone = vi.fn();
    drill({}, { onAnswer, onDone });
    type("parent");
    fireEvent.click(screen.getByText("Check"));
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ correct: true, typed: "parent" });
    act(() => void vi.advanceTimersByTime(700));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("forgives a plural", () => {
    const onAnswer = vi.fn();
    drill({}, { onAnswer });
    type("parents");
    fireEvent.click(screen.getByText("Check"));
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ correct: true });
  });

  it("takes a synonym the dictionary knows", () => {
    const onAnswer = vi.fn();
    drill({ synonyms: ["folks"] }, { onAnswer });
    type("folks");
    fireEvent.click(screen.getByText("Check"));
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ correct: true });
  });

  it("blames the story on a miss, and waits to be read", () => {
    const onAnswer = vi.fn();
    const onDone = vi.fn();
    drill({}, { onAnswer, onDone });
    type("needle");
    fireEvent.click(screen.getByText("Check"));
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ correct: false });
    expect(screen.getByText("親 · parent")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(5000));
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Got it"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does nothing on an empty answer", () => {
    const onAnswer = vi.fn();
    drill({}, { onAnswer });
    fireEvent.click(screen.getByText("Check"));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("takes one answer however many times Check is tapped", () => {
    const onAnswer = vi.fn();
    drill({}, { onAnswer });
    type("parent");
    act(() => {
      fireEvent.click(screen.getByText("Check"));
      fireEvent.click(screen.getByText("Check"));
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("checks against the learner's own keyword when they set one", () => {
    const onAnswer = vi.fn();
    drill({ keyword: "folks", story: "the {self} arrive" }, { onAnswer });
    type("folks");
    fireEvent.click(screen.getByText("Check"));
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ correct: true });
  });
});
