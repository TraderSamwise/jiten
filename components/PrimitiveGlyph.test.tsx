// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);

// Render Text as a span that serializes its style so we can assert the font choice.
vi.mock("@/components/ui/text", () => ({
  Text: ({ children, style }: { children?: React.ReactNode; style?: unknown }) => (
    <span data-style={JSON.stringify(style ?? null)}>{children}</span>
  ),
}));

import { PrimitiveGlyph, RTK_PRIMITIVE_FONT } from "./PrimitiveGlyph";

describe("PrimitiveGlyph", () => {
  const styleOf = (c: HTMLElement) => c.querySelector("span")?.getAttribute("data-style") ?? "";

  it("renders a real Unicode glyph as-is, in the default font", () => {
    const { container } = render(<PrimitiveGlyph glyph="亘" displayGlyph="屆" />);
    expect(container.textContent).toBe("亘");
    expect(styleOf(container)).not.toContain(RTK_PRIMITIVE_FONT);
  });

  it("draws the substitute char in the RTK primitive font when there is no real glyph", () => {
    const { container } = render(<PrimitiveGlyph glyph={null} displayGlyph="屆" />);
    expect(container.textContent).toBe("屆");
    expect(styleOf(container)).toContain(RTK_PRIMITIVE_FONT);
  });

  it("renders nothing when there is no glyph to draw", () => {
    const { container } = render(<PrimitiveGlyph glyph={null} displayGlyph={null} />);
    expect(container.textContent).toBe("");
  });
});
