// @vitest-environment jsdom

/**
 * The study screen's cloze front. What matters is that it is generous about the
 * answer — the exercise is recalling the hook, not spelling the keyword — and
 * that it reports exactly once, since the report pre-selects the rating.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  synonyms: [] as string[],
  strokesDb: {} as object | null,
  getSynonyms: vi.fn(),
}));

vi.mock("react-native", () => ({
  Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  TextInput: ({
    value,
    onChangeText,
    placeholder,
    onSubmitEditing,
  }: {
    value?: string;
    onChangeText?: (t: string) => void;
    placeholder?: string;
    onSubmitEditing?: () => void;
  }) => (
    <input
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChangeText?.(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onSubmitEditing?.()}
    />
  ),
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/MnemonicText", () => ({
  MnemonicText: ({ mnemonic }: { mnemonic?: string | null }) => <span>{`SHOWN:${mnemonic}`}</span>,
}));

vi.mock("@/db/provider", () => ({ useDatabase: () => ({ strokesDb: h.strokesDb }) }));

vi.mock("@/db/kanji-search", () => ({
  getSynonymsForKeywordAsync: (...args: unknown[]) => {
    h.getSynonyms(...args);
    return Promise.resolve(h.synonyms);
  },
}));

import { MnemonicClozeInput } from "@/components/MnemonicClozeInput";

const STORY = "A {self} standing on a [tree], watching their kid.";

function mount(props: Partial<React.ComponentProps<typeof MnemonicClozeInput>> = {}) {
  const onComplete = vi.fn();
  render(
    <MnemonicClozeInput
      keyword="parent"
      story={STORY}
      primitives={[]}
      onComplete={onComplete}
      {...props}
    />,
  );
  return onComplete;
}

function answer(text: string) {
  fireEvent.change(screen.getByPlaceholderText("the missing keyword"), { target: { value: text } });
  fireEvent.click(screen.getByText("Check"));
}

beforeEach(() => {
  h.synonyms = [];
  h.strokesDb = {};
  h.getSynonyms.mockClear();
});

afterEach(cleanup);

describe("the cloze front", () => {
  it("shows the story with the keyword blanked", () => {
    mount();
    expect(screen.getByText(/SHOWN:/).textContent).toContain("_____");
    expect(screen.getByText(/SHOWN:/).textContent).not.toContain("{self}");
  });

  it("passes a right answer", () => {
    const onComplete = mount();
    answer("parent");
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it("forgives a plural", () => {
    const onComplete = mount();
    answer("parents");
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it("accepts a synonym once they have loaded", async () => {
    h.synonyms = ["mother"];
    const onComplete = mount();
    // The lookup resolves on a microtask; the learner cannot type faster.
    await Promise.resolve();
    await Promise.resolve();
    answer("mother");
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it("fails a wrong answer", () => {
    const onComplete = mount();
    answer("tree");
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it("ignores an empty answer rather than failing the card", () => {
    const onComplete = mount();
    fireEvent.click(screen.getByText("Check"));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("reports once, however many times Check is pressed", () => {
    const onComplete = mount();
    answer("parent");
    fireEvent.click(screen.getByText("Check"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("counts giving up as a miss", () => {
    const onComplete = mount();
    fireEvent.click(screen.getByText("Give up"));
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it("answers on Enter", () => {
    const onComplete = mount();
    const input = screen.getByPlaceholderText("the missing keyword");
    fireEvent.change(input, { target: { value: "parent" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it("still asks when the synonym tier is missing", () => {
    h.strokesDb = null;
    const onComplete = mount();
    expect(h.getSynonyms).not.toHaveBeenCalled();
    answer("parent");
    expect(onComplete).toHaveBeenCalledWith(true);
  });
});
