import { state } from "./state";
import { isJapanese } from "./japanese";
import { nodeOffsetToAbsolute, getAbsText } from "./text";
import { clearHighlight, highlightAbsRange } from "./highlight";
import { nextPage, prevPage, expandPageForHighlight, resetPageShift } from "./pagination";

declare const window: Window & {
  __READER_CONFIG__: { scrollPosition: number };
  ReactNativeWebView: { postMessage(msg: string): void };
};

export function setupMouseHandlers(): void {
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseStartAbs = -1;
  let mouseEndAbs = -1;

  const DECIDE_THRESHOLD = 15;

  state.contentEl!.addEventListener("mousedown", function (e: MouseEvent) {
    // Don't start a new gesture if touch already claimed it
    if (state.dragMode !== "idle" && state.dragMode !== "undecided") return;
    resetPageShift();
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseStartAbs = -1;
    mouseEndAbs = -1;
    state.dragMode = "undecided";
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      const ch = range.startContainer.textContent!.charAt(range.startOffset);
      if (isJapanese(ch)) {
        mouseStartAbs = nodeOffsetToAbsolute(range.startContainer, range.startOffset);
      }
    }
  });

  state.contentEl!.addEventListener("mousemove", function (e: MouseEvent) {
    if (!(e.buttons & 1)) return;
    // If touch handler already committed, don't interfere
    if (state.dragMode === "selecting" && mouseStartAbs < 0) return;
    if (state.dragMode === "swiping" && mouseStartAbs < 0) return;
    const dx = Math.abs(e.clientX - mouseStartX);
    const dy = Math.abs(e.clientY - mouseStartY);

    // Decide mode once moved enough
    if (state.dragMode === "undecided" && (dx > DECIDE_THRESHOLD || dy > DECIDE_THRESHOLD)) {
      if (dx > dy * 1.5) {
        state.dragMode = "swiping";
        mouseStartAbs = -1;
      } else if (mouseStartAbs >= 0) {
        state.dragMode = "selecting";
        state.suppressClick = true;
        clearHighlight();
      } else {
        state.dragMode = "swiping";
      }
    }

    if (state.dragMode === "selecting" && mouseStartAbs >= 0) {
      // Expand page if cursor is near the left edge (end of page in vertical-rl)
      const rect = state.contentEl!.getBoundingClientRect();
      const fontSize = parseFloat(getComputedStyle(state.contentEl!).fontSize);
      const edgeZone = rect.left + 16 + fontSize * 1.5;
      if (e.clientX < edgeZone) {
        expandPageForHighlight();
      }

      const endRange = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!endRange || endRange.startContainer.nodeType !== Node.TEXT_NODE) return;
      const endAbs = nodeOffsetToAbsolute(endRange.startContainer, endRange.startOffset);
      clearHighlight();
      const lo = Math.min(mouseStartAbs, endAbs);
      const hi = Math.max(mouseStartAbs, endAbs);
      mouseEndAbs = endAbs;
      if (hi > lo) highlightAbsRange(lo, hi);
    }
  });

  state.contentEl!.addEventListener("mouseup", function (e: MouseEvent) {
    const dx = e.clientX - mouseStartX;

    // Page swipe — only if we own this gesture
    if (state.dragMode === "swiping" && mouseStartAbs === -1 && Math.abs(dx) > 50) {
      state.swipeHandled = true;
      state.suppressClick = true;
      state.dragMode = "idle";
      setTimeout(function () {
        state.suppressClick = false;
      }, 50);
      if (dx > 0) nextPage();
      else prevPage();
      mouseEndAbs = -1;
      return;
    }

    // Highlight selection
    if (state.dragMode === "selecting" && mouseStartAbs >= 0 && mouseEndAbs >= 0) {
      const lo = Math.min(mouseStartAbs, mouseEndAbs);
      const hi = Math.max(mouseStartAbs, mouseEndAbs);
      if (hi > lo) {
        const text = getAbsText(lo, hi);
        if (text.length > 0 && text.length <= 1000) {
          const prefix = getAbsText(Math.max(0, lo - 10), lo);
          const suffix = getAbsText(hi, hi + 10);
          window.ReactNativeWebView.postMessage(
            JSON.stringify({
              type: "selection",
              text: text,
              prefix: prefix,
              suffix: suffix,
            }),
          );
        } else if (text.length > 1000) {
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: "error", message: "Selection too long" }),
          );
        }
      }
    }
    mouseStartAbs = -1;
    mouseEndAbs = -1;
    state.dragMode = "idle";
    setTimeout(function () {
      state.suppressClick = false;
    }, 50);
  });
}
