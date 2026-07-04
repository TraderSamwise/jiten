// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { KanjiPrimitive } from "@/db/types";

afterEach(cleanup);

// The react-native mock has no Text; render it as a span that maps onPress→onClick.
vi.mock("@/components/ui/text", () => ({
  Text: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <span onClick={onPress}>{children}</span>
  ),
}));

// Imported after the mock so MnemonicText picks up the mocked Text.
import { MnemonicText } from "./MnemonicText";

const PRIMS: KanjiPrimitive[] = [
  { position: 0, glyph: null, primitiveId: 51, keyword: "house", isPrimitive: true },
  { position: 1, glyph: "亘", primitiveId: null, keyword: "span", isPrimitive: false },
];

describe("MnemonicText", () => {
  it("returns null when mnemonic is empty or null", () => {
    const { container: c1 } = render(
      <MnemonicText mnemonic="" selfKeyword="proclaim" primitives={PRIMS} />,
    );
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(
      <MnemonicText mnemonic={null} selfKeyword="proclaim" primitives={PRIMS} />,
    );
    expect(c2.firstChild).toBeNull();
  });

  it("renders {self} as the keyword and shows ref labels", () => {
    const { container } = render(
      <MnemonicText
        mnemonic="I {self} my [house] shall [span](亘)."
        selfKeyword="proclaim"
        primitives={PRIMS}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("proclaim");
    expect(text).toContain("house");
    expect(text).toContain("span");
    expect(text).toContain("I ");
  });

  it("navigates to a bare ref's resolved target and an explicit target", () => {
    const onNavigate = vi.fn();
    const { getByText } = render(
      <MnemonicText
        mnemonic="my [house] and [span](亘)"
        selfKeyword="proclaim"
        primitives={PRIMS}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(getByText("house")); // bare → resolved to p51
    fireEvent.click(getByText("span")); // explicit target 亘
    expect(onNavigate).toHaveBeenCalledWith("p51");
    expect(onNavigate).toHaveBeenCalledWith("亘");
  });

  it("does not throw when a primitive keyword is null", () => {
    const prims: KanjiPrimitive[] = [
      { position: 0, glyph: null, primitiveId: 7, keyword: null, isPrimitive: true },
    ];
    const { container } = render(
      <MnemonicText mnemonic="a [mystery] thing" selfKeyword={null} primitives={prims} />,
    );
    expect(container.textContent).toContain("mystery");
  });
});
