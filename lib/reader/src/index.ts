import { state } from "./state";
import { isJapanese } from "./japanese";
import { guessWordLength, guessWordStart } from "./japanese";
import { nodeOffsetToAbsolute, getTextFromPosition, getTextBeforePosition } from "./text";
import { clearHighlight, applyHighlight } from "./highlight";
import {
  setupContent,
  updateSizing,
  paginate,
  alignToTargetChar,
  goToPage,
  nextPage,
  prevPage,
} from "./pagination";
import { setupTouchHandlers } from "./touch";
import { setupMouseHandlers } from "./mouse";
import { setupMessageListener } from "./bridge";

declare const window: Window & {
  __READER_CONFIG__: {
    scrollPosition: number;
    targetLocalChar?: number;
    sliceCharOffset?: number;
    totalChars?: number;
  };
  ReactNativeWebView: { postMessage(msg: string): void };
};

(function () {
  // Grab DOM refs
  state.contentEl = document.getElementById("content");
  state.pageEl = document.getElementById("page");
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

  // Tap page number to jump to a page
  state.pageNumEl!.addEventListener("click", function (e: Event) {
    e.stopPropagation();
    const current = state.currentPage;
    const total = state.totalPages;
    const isMobile = !!(window as any).ReactNativeWebView;

    if (isMobile) {
      // Mobile: show top-anchored overlay bar above the keyboard
      const overlay = document.createElement("div");
      overlay.id = "page-jump-overlay";

      const label = document.createElement("span");
      label.textContent = "Go to page";
      label.className = "page-jump-label";

      const input = document.createElement("input");
      input.type = "number";
      input.inputMode = "numeric";
      input.pattern = "[0-9]*";
      input.value = String(current);
      input.min = "1";
      input.max = String(total);
      input.id = "page-jump";

      const totalLabel = document.createElement("span");
      totalLabel.textContent = " / " + total;
      totalLabel.className = "page-jump-label";

      const pill = document.createElement("div");
      pill.id = "page-jump-pill";
      pill.appendChild(label);
      pill.appendChild(input);
      pill.appendChild(totalLabel);
      overlay.appendChild(pill);
      document.body.appendChild(overlay);

      input.focus();
      input.select();

      function dismiss() {
        if (overlay.parentNode) overlay.remove();
      }

      function commit() {
        const val = parseInt(input.value, 10);
        if (!isNaN(val) && val >= 1 && val <= total) {
          goToPage(val);
        }
        dismiss();
      }

      input.addEventListener("keydown", function (ke: KeyboardEvent) {
        if (ke.key === "Enter") {
          ke.preventDefault();
          input.blur();
        }
      });
      input.addEventListener("blur", commit, { once: true });
      overlay.addEventListener("click", function (oe: Event) {
        if (oe.target === overlay) {
          input.blur();
        }
      });
    } else {
      // Web: inline input in the page-num element
      const el = state.pageNumEl!;

      const input = document.createElement("input");
      input.type = "number";
      input.inputMode = "numeric";
      input.pattern = "[0-9]*";
      input.value = String(current);
      input.min = "1";
      input.max = String(total);
      input.id = "page-jump";

      el.textContent = "";
      el.appendChild(input);
      input.focus();
      input.select();

      function commit() {
        const val = parseInt(input.value, 10);
        if (!isNaN(val) && val >= 1 && val <= total) {
          goToPage(val);
        } else {
          goToPage(current); // restores display
        }
        if (input.parentNode) input.remove();
      }

      input.addEventListener("keydown", function (ke: KeyboardEvent) {
        if (ke.key === "Enter") {
          ke.preventDefault();
          input.blur();
        }
      });
      input.addEventListener("blur", commit, { once: true });
    }
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

    const before = getTextBeforePosition(node, offset, 15);
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

  // Char-offset config
  state.sliceCharOffset = window.__READER_CONFIG__.sliceCharOffset || 0;
  state.totalChars = window.__READER_CONFIG__.totalChars || 0;
  const targetLocalChar = window.__READER_CONFIG__.targetLocalChar || 0;

  // Set canonical global offset — preserved until user navigates to a new page.
  // This prevents drift from spacer/prepend shifting column boundaries on reload.
  if (targetLocalChar > 0 || state.sliceCharOffset > 0) {
    state.canonicalCharOffset = state.sliceCharOffset + targetLocalChar;
  }

  // Initial setup
  setupContent();
  updateSizing();
  const savedPos = window.__READER_CONFIG__.scrollPosition;
  requestAnimationFrame(function () {
    updateSizing();
    paginate();
    if (targetLocalChar > 0) {
      alignToTargetChar(targetLocalChar);
    } else if (savedPos > 0 && state.totalPages > 1) {
      state.currentPage = Math.round(savedPos * (state.totalPages - 1)) + 1;
      goToPage(state.currentPage);
    } else {
      state.currentPage = 1;
      goToPage(state.currentPage);
    }
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
