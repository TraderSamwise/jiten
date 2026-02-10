import { state } from "./state";
import { isJapanese } from "./japanese";
import { guessWordLength, guessWordStart } from "./japanese";
import { nodeOffsetToAbsolute, getTextFromPosition, getTextBeforePosition } from "./text";
import { clearHighlight, applyHighlight } from "./highlight";
import { parseBlocks, updateSizing, paginate, goToPage, nextPage, prevPage } from "./pagination";
import { setupTouchHandlers } from "./touch";
import { setupMouseHandlers } from "./mouse";
import { setupMessageListener } from "./bridge";

declare const window: Window & {
  __READER_CONFIG__: { scrollPosition: number };
  ReactNativeWebView: { postMessage(msg: string): void };
};

(function () {
  // Grab DOM refs
  state.rawEl = document.getElementById("raw");
  state.contentEl = document.getElementById("content");
  state.pageEl = document.getElementById("page");
  state.bufPrevEl = document.getElementById("buf-prev");
  state.bufNextEl = document.getElementById("buf-next");
  state.pageNumEl = document.getElementById("page-num");
  state.btnNext = document.getElementById("btn-next") as HTMLButtonElement;
  state.btnPrev = document.getElementById("btn-prev") as HTMLButtonElement;

  // Button handlers
  state.btnNext.addEventListener("click", function (e: Event) {
    e.stopPropagation();
    nextPage();
  });
  state.btnPrev.addEventListener("click", function (e: Event) {
    e.stopPropagation();
    prevPage();
  });

  // Touch / swipe / drag-select
  setupTouchHandlers();

  // Keyboard
  document.addEventListener("keydown", function (e: KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      nextPage();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      prevPage();
    }
  });

  // Prevent mouse wheel / trackpad scrolling
  state.contentEl.addEventListener(
    "wheel",
    function (e: WheelEvent) {
      e.preventDefault();
    },
    { passive: false },
  );

  // Prevent native text selection (but caretRangeFromPoint still works)
  document.addEventListener("selectstart", function (e: Event) {
    e.preventDefault();
  });

  // Mouse drag-select (web)
  setupMouseHandlers();

  // TAP: word lookup (click on text)
  state.contentEl.addEventListener("click", function (e: MouseEvent) {
    if (state.swipeHandled) {
      state.swipeHandled = false;
      return;
    }
    if (state.suppressClick) return;

    clearHighlight();

    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const offset = range.startOffset;

    // Check we actually tapped on a Japanese character
    const charAtTap = node.textContent!.charAt(offset);
    if (!charAtTap || !isJapanese(charAtTap)) return;

    state.lastTapNode = node;
    state.lastTapOffset = offset;
    state.lastTapAbsOffset = nodeOffsetToAbsolute(node, offset);

    const before = getTextBeforePosition(node, offset, 10);
    const after = getTextFromPosition(node, offset, 20);
    if (!after || after.length === 0) return;

    const text = before + after;
    const tapOffset = before.length; // index of tapped char within combined window

    // Instant heuristic highlight
    const wordStart = guessWordStart(text, tapOffset);
    const guessLen = guessWordLength(text.slice(wordStart));
    applyHighlight(wordStart - tapOffset, guessLen);

    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        type: "tap",
        text: text,
        tapOffset: tapOffset,
        x: e.clientX,
        y: e.clientY,
      }),
    );
  });

  // Message listener (React Native bridge)
  setupMessageListener();

  // Initial setup
  parseBlocks();
  updateSizing();
  const savedPos = window.__READER_CONFIG__.scrollPosition;
  requestAnimationFrame(function () {
    updateSizing();
    paginate();
    if (savedPos > 0 && state.totalPages > 1) {
      state.currentPage = Math.round(savedPos * (state.totalPages - 1)) + 1;
    } else {
      state.currentPage = 1;
    }
    goToPage(state.currentPage);
  });

  // Resize handler
  window.addEventListener("resize", function () {
    const ratio = state.totalPages > 1 ? (state.currentPage - 1) / (state.totalPages - 1) : 0;
    updateSizing();
    requestAnimationFrame(function () {
      paginate();
      state.currentPage = Math.round(ratio * (state.totalPages - 1)) + 1;
      state.currentPage = Math.max(1, Math.min(state.currentPage, state.totalPages));
      goToPage(state.currentPage);
    });
  });

  // Notify RN that the reader is ready
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ready" }));
})();
