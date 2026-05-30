// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MnemonicText } from "./MnemonicText";

describe("MnemonicText", () => {
  it("returns null when mnemonic is empty", () => {
    const { container } = render(
      <MnemonicText mnemonic="" primaryKeywords={["guard"]} componentKeywords={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when mnemonic is null", () => {
    const { container } = render(
      <MnemonicText mnemonic={null} primaryKeywords={["guard"]} componentKeywords={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
