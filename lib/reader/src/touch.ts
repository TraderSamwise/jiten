import { state } from "./state";
import { isJapanese } from "./japanese";
import { nodeOffsetToAbsolute, getAbsText, resolveCaretAt } from "./text";
import { clearHighlight, highlightAbsRange } from "./highlight";
import {
  nextPage,
  prevPage,
  expandPageForHighlight,
  contractPageForHighlight,
  resetPageShift,
} from "./pagination";

declare const window: Window & {
  __READER_CONFIG__: { scrollPosition: number };
  ReactNativeWebView: { postMessage(msg: string): void };
};

export function setupTouchHandlers(): void {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let dragStartAbs = -1;
  let dragEndAbs = -1;
  let prevTouchX = 0;

  const DECIDE_THRESHOLD = 15;

  state.contentEl!.addEventListener(
    "touchstart",
    function (e: TouchEvent) {
      resetPageShift();
      touchStartX = e.touches[0].clientX;
      prevTouchX = touchStartX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      dragStartAbs = -1;
      dragEndAbs = -1;
      state.swipeHandled = false;
      state.dragMode = "undecided";

      // Get caret at touch point for potential drag selection
      const caret = resolveCaretAt(touchStartX, touchStartY);
      if (caret && caret.node.nodeType === Node.TEXT_NODE) {
        const ch = caret.node.textContent!.charAt(caret.offset);
        if (isJapanese(ch)) {
          dragStartAbs = nodeOffsetToAbsolute(caret.node, caret.offset);
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

      // Decide mode once finger has moved enough
      if (state.dragMode === "undecided" && (dx > DECIDE_THRESHOLD || dy > DECIDE_THRESHOLD)) {
        if (dx > dy * 1.5) {
          state.dragMode = "swiping";
          dragStartAbs = -1;
        } else if (dragStartAbs >= 0) {
          state.dragMode = "selecting";
          state.suppressClick = true;
          clearHighlight();
        } else {
          state.dragMode = "swiping";
        }
      }

      if (state.dragMode === "selecting") {
        // Peek page only if finger is in edge zone AND moving toward that edge
        const rect = state.contentEl!.getBoundingClientRect();
        const fontSize = parseFloat(getComputedStyle(state.contentEl!).fontSize);
        const edgeZone = 16 + fontSize * 1.5;
        const PEEK_THRESHOLD = 10;
        if (cx < rect.left + edgeZone && prevTouchX - cx > PEEK_THRESHOLD) {
          expandPageForHighlight();
          prevTouchX = cx;
        } else if (cx > rect.right - edgeZone && cx - prevTouchX > PEEK_THRESHOLD) {
          contractPageForHighlight();
          prevTouchX = cx;
        }

        const endCaret = resolveCaretAt(cx, cy);
        if (endCaret && endCaret.node.nodeType === Node.TEXT_NODE) {
          const endAbs = nodeOffsetToAbsolute(endCaret.node, endCaret.offset);
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
      const dt = Date.now() - touchStartTime;

      // Page swipe — only if not selecting
      if (state.dragMode !== "selecting" && Math.abs(dx) > 50 && dt < 500) {
        state.swipeHandled = true;
        dragStartAbs = -1;
        dragEndAbs = -1;
        state.suppressClick = true;
        state.dragMode = "idle";
        setTimeout(function () {
          state.suppressClick = false;
        }, 50);
        if (dx > 0) nextPage();
        else prevPage();
        return;
      }

      if (state.dragMode === "selecting") {
        const lo = Math.min(dragStartAbs, dragEndAbs);
        const hi = Math.max(dragStartAbs, dragEndAbs);
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
                startX: touchStartX,
                startY: touchStartY,
              }),
            );
          } else if (text.length > 1000) {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: "error", message: "Selection too long" }),
            );
          }
        }
        dragStartAbs = -1;
        dragEndAbs = -1;
        state.dragMode = "idle";
        setTimeout(function () {
          state.suppressClick = false;
        }, 50);
        return;
      }

      dragStartAbs = -1;
      state.swipeHandled = false;
      state.dragMode = "idle";
    },
    { passive: true },
  );
}
