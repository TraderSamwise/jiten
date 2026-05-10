/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { clearHighlight, highlightAbsRange } from "./highlight";
import { state } from "./state";

function setPageHtml(html: string) {
  document.body.innerHTML = `<div id="page">${html}</div>`;
  state.pageEl = document.getElementById("page");
  state.contentEl = state.pageEl;
}

describe("highlightAbsRange", () => {
  beforeEach(() => {
    setPageHtml("");
  });

  it("temporarily unwraps overlapping bookmarked ruby base text", () => {
    setPageHtml(
      '<p><ruby><span class="bookmarked-word">胸像</span><rt>きょうぞう</rt></ruby>に</p>',
    );

    highlightAbsRange(0, 2);

    expect(state.pageEl!.innerHTML).toContain(">胸像<rt");
    expect(state.pageEl!.querySelector("span.bookmarked-word")).toBeNull();

    clearHighlight();

    const restored = state.pageEl!.querySelector("ruby > span.bookmarked-word");
    expect(restored?.textContent).toBe("胸像");
  });

  it("does not unwrap non-overlapping bookmarked ruby base text", () => {
    setPageHtml(
      '<p><ruby><span class="bookmarked-word">空席</span><rt>くうせき</rt></ruby><ruby>胸像<rt>きょうぞう</rt></ruby></p>',
    );

    highlightAbsRange(2, 4);

    expect(state.pageEl!.innerHTML).toContain(
      '<ruby><span class="bookmarked-word">空席</span><rt>くうせき</rt></ruby>',
    );
  });
});
