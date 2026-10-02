// @vitest-environment jsdom

/**
 * The reader answers a long press itself. iOS answering the same gesture with
 * its own bar is queue 0cfac0-18, and two attempts to refuse it from inside
 * the page have already shipped and failed — so the one assertion worth
 * having is that the platform's own switch is actually thrown.
 */
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const props: Record<string, unknown>[] = [];

vi.mock("react-native-webview", () => ({
  WebView: (given: Record<string, unknown>) => {
    props.push(given);
    return <div />;
  },
}));

const { ReaderView } = await import("./reader-view.native");

describe("ReaderView", () => {
  /**
   * The one that should settle it: WebKit's own text interaction off, so
   * there is no selection for a bar to be raised over. A WKPreferences value,
   * so `caretRangeFromPoint` and the reader's own selection are untouched.
   */
  it("turns off the platform's text interaction", () => {
    render(<ReaderView html="<p>本</p>" onMessage={() => {}} />);
    expect(props.at(-1)?.textInteractionEnabled).toBe(false);
  });

  it("refuses every menu item iOS would put in a long press's bar", () => {
    render(<ReaderView html="<p>本</p>" onMessage={() => {}} />);
    const suppressed = props.at(-1)?.suppressMenuItems as string[] | undefined;
    expect(suppressed).toBeDefined();
    // The whole of react-native-webview's SuppressMenuItem union, so that a
    // newly offered item is a deliberate omission rather than an oversight.
    expect([...suppressed!].sort()).toEqual(
      [
        "bold",
        "copy",
        "cut",
        "italic",
        "lookup",
        "paste",
        "replace",
        "select",
        "selectAll",
        "share",
        "translate",
        "underline",
      ].sort(),
    );
  });
});
