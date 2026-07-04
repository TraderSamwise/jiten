// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { KanjiPrimitive } from "@/db/types";

const hookMocks = vi.hoisted(() => ({ useMnemonicSuggestor: vi.fn() }));

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    onPressIn,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    onPressIn?: () => void;
  }) => (
    <button onMouseDown={onPressIn} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: (props: Record<string, unknown>) => (
    <textarea data-testid="input" value={props.value as string} readOnly />
  ),
}));
vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/hooks/useMnemonicSuggestor", () => ({
  useMnemonicSuggestor: hookMocks.useMnemonicSuggestor,
}));

import { MnemonicEditor } from "./MnemonicEditor";

const PRIMS: KanjiPrimitive[] = [
  {
    position: 0,
    glyph: null,
    primitiveId: 51,
    keyword: "house",
    isPrimitive: true,
    displayGlyph: "屆",
  },
  {
    position: 1,
    glyph: "亘",
    primitiveId: null,
    keyword: "span",
    isPrimitive: false,
    displayGlyph: null,
  },
];

afterEach(() => {
  cleanup();
  hookMocks.useMnemonicSuggestor.mockReset();
});

describe("MnemonicEditor", () => {
  it("renders the dropdown candidates and the unlinked-primitives bar", () => {
    hookMocks.useMnemonicSuggestor.mockReturnValue({
      ambient: null,
      dropdown: {
        start: 0,
        query: "",
        candidates: [{ target: "p51", keyword: "house", glyph: null, displayGlyph: "屆" }],
      },
      suppress: vi.fn(),
    });
    const { getAllByText, container } = render(
      <MnemonicEditor literal="安" initialValue="" primitives={PRIMS} onSave={vi.fn()} />,
    );
    // "house" shows in the dropdown and the unlinked bar; the dropdown draws the
    // primitive's shape after the arrow (its RTK substitute here) instead of "p51".
    expect(getAllByText("house").length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("→ 屆");
    // unlinked bar (nothing referenced) lists both primitive keywords
    expect(container.textContent).toContain("Not yet linked:");
    expect(container.textContent).toContain("span");
  });

  it("shows the ambient chip and dismiss suppresses without saving", () => {
    const suppress = vi.fn();
    const onSave = vi.fn();
    hookMocks.useMnemonicSuggestor.mockReturnValue({
      ambient: {
        span: { start: 3, end: 8, text: "house" },
        candidate: { target: "p51", keyword: "house", confidence: 1, source: "keyword" },
      },
      dropdown: null,
      suppress,
    });
    const { getByText } = render(
      <MnemonicEditor literal="安" initialValue="at house" primitives={PRIMS} onSave={onSave} />,
    );
    expect(getByText(/Link/)).toBeTruthy();
    fireEvent.click(getByText("✕"));
    expect(suppress).toHaveBeenCalledWith("house");
    expect(onSave).not.toHaveBeenCalled();
  });
});
