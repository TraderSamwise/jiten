import { state } from "./state";
import { isJapanese } from "./japanese";
import { nodeOffsetToAbsolute, getAbsText } from "./text";
import { clearHighlight, highlightAbsRange } from "./highlight";

declare const window: Window & {
  __READER_CONFIG__: { scrollPosition: number };
  ReactNativeWebView: { postMessage(msg: string): void };
};

export function setupMouseHandlers(): void {
  let mouseStartAbs = -1;
  let mouseEndAbs = -1;
  let isMouseDragging = false;

  state.contentEl!.addEventListener("mousedown", function (e: MouseEvent) {
    mouseStartAbs = -1;
    mouseEndAbs = -1;
    isMouseDragging = false;
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      const ch = range.startContainer.textContent!.charAt(range.startOffset);
      if (isJapanese(ch)) {
        mouseStartAbs = nodeOffsetToAbsolute(range.startContainer, range.startOffset);
      }
    }
  });

  state.contentEl!.addEventListener("mousemove", function (e: MouseEvent) {
    if (mouseStartAbs < 0 || !(e.buttons & 1)) return;
    const endRange = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!endRange || endRange.startContainer.nodeType !== Node.TEXT_NODE) return;
    const endAbs = nodeOffsetToAbsolute(endRange.startContainer, endRange.startOffset);
    if (endAbs === mouseStartAbs) return;
    if (!isMouseDragging) {
      isMouseDragging = true;
      state.suppressClick = true;
      clearHighlight();
    }
    clearHighlight();
    const lo = Math.min(mouseStartAbs, endAbs);
    const hi = Math.max(mouseStartAbs, endAbs);
    mouseEndAbs = endAbs;
    if (hi > lo) highlightAbsRange(lo, hi);
  });

  state.contentEl!.addEventListener("mouseup", function () {
    if (isMouseDragging && mouseStartAbs >= 0 && mouseEndAbs >= 0) {
      const lo = Math.min(mouseStartAbs, mouseEndAbs);
      const hi = Math.max(mouseStartAbs, mouseEndAbs);
      if (hi > lo) {
        const text = getAbsText(lo, hi);
        if (text.length > 0 && text.length <= 100) {
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
        }
      }
    }
    isMouseDragging = false;
    mouseStartAbs = -1;
    mouseEndAbs = -1;
    setTimeout(function () {
      state.suppressClick = false;
    }, 50);
  });
}
