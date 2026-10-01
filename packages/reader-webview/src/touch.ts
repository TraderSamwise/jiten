import { state } from "./state";
import { isJapanese } from "./japanese";
import { nodeOffsetToAbsolute, getAbsText, getAbsRangeBounds, resolveCaretAt } from "./text";
import { clearHighlight, highlightAbsRange } from "./highlight";
import {
  postFuriganaPinTarget,
  pressTargetAt,
  resolvePressedRun,
  type PressTarget,
} from "./furigana-pin";
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
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressFired = false;
  /**
   * The hit test is done when the finger lands, not when the timer fires: a
   * page animation or any reflow in between moves the text under the original
   * coordinates, and the run reported would be a character the user never
   * touched. Only the paragraph walk waits for the timer.
   */
  let pressTarget: PressTarget | null = null;

  const DECIDE_THRESHOLD = 15;
  /** Long enough not to fire on a tap, short enough to feel deliberate. */
  const LONG_PRESS_MS = 500;
  /** A finger is never still; this is the slack a press gets before it is a drag. */
  const LONG_PRESS_SLACK = 10;

  function cancelLongPress(): void {
    pressTarget = null;
    if (longPressTimer === null) return;
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  /**
   * Let go of the click guard the long press took.
   *
   * It must happen on touchcancel as well as touchend: the sheet the press
   * opens is a native modal, and presenting it while the finger is still down
   * cancels the WebView's touch, so touchend never arrives. Leaving the guard
   * set swallows every later tap in the book.
   */
  function releaseLongPressClickGuard(): void {
    if (!longPressFired) return;
    longPressFired = false;
    setTimeout(function () {
      state.suppressClick = false;
    }, 50);
  }

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

      // Hold still on a kanji run to be asked which reading it should carry.
      cancelLongPress();
      // A press that fired and never saw its own touchend — a second finger
      // arrived, or the platform swallowed it — must not leave the guard set,
      // or every later tap in the book is swallowed with it.
      releaseLongPressClickGuard();
      // A second finger is a pinch or a stray thumb, not a press.
      if (e.touches.length > 1) return;
      pressTarget = pressTargetAt(touchStartX, touchStartY, caret);
      if (!pressTarget) return;
      const pressX = touchStartX;
      const pressY = touchStartY;
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        if (state.dragMode === "selecting" || state.dragMode === "swiping") return;
        if (!pressTarget) return;
        const pressed = resolvePressedRun(pressTarget);
        if (!pressed) return;
        postFuriganaPinTarget(pressed, pressX, pressY);
        longPressFired = true;
        // The finger is still down; the click it ends with would otherwise
        // open the tap lookup on top of the picker.
        state.suppressClick = true;
        state.dragMode = "idle";
        // Paint the run the sheet is about, in the same colour a tap and a drag
        // select use. The app clears it when the sheet closes.
        clearHighlight();
        if (pressed.absEnd > pressed.absStart) {
          highlightAbsRange(pressed.absStart, pressed.absEnd);
        }
      }, LONG_PRESS_MS);
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

      if (dx > LONG_PRESS_SLACK || dy > LONG_PRESS_SLACK || e.touches.length > 1) {
        cancelLongPress();
      }

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
      cancelLongPress();
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
            const bounds = getAbsRangeBounds(lo, hi);
            window.ReactNativeWebView.postMessage(
              JSON.stringify({
                type: "selection",
                text: text,
                prefix: prefix,
                suffix: suffix,
                startX: touchStartX,
                startY: touchStartY,
                selectionX: bounds?.centerX,
                selectionTop: bounds?.top,
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
      releaseLongPressClickGuard();
    },
    { passive: true },
  );

  state.contentEl!.addEventListener(
    "touchcancel",
    function () {
      cancelLongPress();
      dragStartAbs = -1;
      dragEndAbs = -1;
      state.swipeHandled = false;
      state.dragMode = "idle";
      releaseLongPressClickGuard();
      // The drag-select branch sets the guard too, and its own release only
      // runs on touchend.
      setTimeout(function () {
        state.suppressClick = false;
      }, 50);
    },
    { passive: true },
  );
}
