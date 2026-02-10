import { state } from "./state";
import { isJapanese } from "./japanese";
import { nodeOffsetToAbsolute, getAbsText } from "./text";
import { clearHighlight, highlightAbsRange } from "./highlight";
import { nextPage, prevPage } from "./pagination";

declare const window: Window & {
  __READER_CONFIG__: { scrollPosition: number };
  ReactNativeWebView: { postMessage(msg: string): void };
};

export function setupTouchHandlers(): void {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isDragSelecting = false;
  let dragStartAbs = -1;
  let dragEndAbs = -1;

  state.contentEl!.addEventListener(
    "touchstart",
    function (e: TouchEvent) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      isDragSelecting = false;
      dragStartAbs = -1;
      dragEndAbs = -1;
      state.swipeHandled = false;

      // Get caret at touch point for potential drag selection
      const range = document.caretRangeFromPoint(touchStartX, touchStartY);
      if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
        const ch = range.startContainer.textContent!.charAt(range.startOffset);
        if (isJapanese(ch)) {
          dragStartAbs = nodeOffsetToAbsolute(range.startContainer, range.startOffset);
        }
      }
    },
    { passive: true },
  );

  state.contentEl!.addEventListener(
    "touchmove",
    function (e: TouchEvent) {
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const dx = Math.abs(cx - touchStartX);
      const dy = Math.abs(cy - touchStartY);

      // Enter drag-select mode once moved enough, but only if started on text
      if (!isDragSelecting && dragStartAbs >= 0 && (dx > 10 || dy > 10)) {
        isDragSelecting = true;
        state.suppressClick = true;
        clearHighlight();
      }

      if (isDragSelecting) {
        const endRange = document.caretRangeFromPoint(cx, cy);
        if (endRange && endRange.startContainer.nodeType === Node.TEXT_NODE) {
          // Compute end offset BEFORE clearing (node refs survive since abs is just a count)
          const endAbs = nodeOffsetToAbsolute(endRange.startContainer, endRange.startOffset);
          clearHighlight();
          const lo = Math.min(dragStartAbs, endAbs);
          const hi = Math.max(dragStartAbs, endAbs);
          dragEndAbs = endAbs;
          if (hi > lo) {
            highlightAbsRange(lo, hi);
          }
        }
      }
    },
    { passive: true },
  );

  state.contentEl!.addEventListener(
    "touchend",
    function (e: TouchEvent) {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      const dt = Date.now() - touchStartTime;

      // Check for swipe first — fast horizontal swipe always navigates pages
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50 && dt < 500) {
        if (isDragSelecting) {
          clearHighlight();
          isDragSelecting = false;
        }
        state.swipeHandled = true;
        dragStartAbs = -1;
        dragEndAbs = -1;
        state.suppressClick = true;
        setTimeout(function () {
          state.suppressClick = false;
        }, 50);
        if (dx < 0) nextPage();
        else prevPage();
        return;
      }

      if (isDragSelecting) {
        isDragSelecting = false;
        // Send the drag-selected text as a selection message
        const lo = Math.min(dragStartAbs, dragEndAbs);
        const hi = Math.max(dragStartAbs, dragEndAbs);
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
        dragStartAbs = -1;
        dragEndAbs = -1;
        setTimeout(function () {
          state.suppressClick = false;
        }, 50);
        return;
      }

      dragStartAbs = -1;
      state.swipeHandled = false;
    },
    { passive: true },
  );
}
