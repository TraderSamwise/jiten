import { state } from "./state";
import { clearHighlight, applyHighlight } from "./highlight";
import { absoluteToNodeOffset, getAbsRangeBounds } from "./text";
import {
  paginate,
  goToPage,
  measureFirstVisibleChar,
  alignToTargetChar,
  replaceOffscreenContent,
  prependBackSlice,
  expandPageForHighlight,
  contractPageForHighlight,
} from "./pagination";
import { resetBookmarkHighlightState, setBookmarkHighlights } from "./bookmarks";

function applyTheme(theme: {
  bg: string;
  fg: string;
  rubyColor: string;
  highlightBg: string;
  bookmarkBg?: string;
}): void {
  const root = document.documentElement;
  root.style.setProperty("--reader-bg", theme.bg);
  root.style.setProperty("--reader-fg", theme.fg);
  root.style.setProperty("--reader-ruby-color", theme.rubyColor);
  root.style.setProperty("--reader-highlight-bg", theme.highlightBg);
  if (theme.bookmarkBg) {
    root.style.setProperty("--reader-bookmark-bg", theme.bookmarkBg);
  }
}

// Check if a highlighted range extends off-screen and peek to reveal it.
function peekForHighlight(absStart: number, absEnd: number): void {
  if (absEnd <= absStart) return;
  const pageRect = state.pageEl!.getBoundingClientRect();
  const range = document.createRange();

  // Check start of highlight (could be off-screen to the right = earlier in book)
  const startPos = absoluteToNodeOffset(absStart);
  if (startPos) {
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(startPos.node, Math.min(startPos.offset + 1, startPos.node.textContent!.length));
    const r = range.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      const cx = (r.left + r.right) / 2;
      if (cx > pageRect.right) contractPageForHighlight();
    }
  }

  // Check end of highlight (could be off-screen to the left = later in book)
  const endChar = absEnd - 1;
  const endPos = absoluteToNodeOffset(endChar);
  if (endPos) {
    range.setStart(endPos.node, endPos.offset);
    range.setEnd(endPos.node, Math.min(endPos.offset + 1, endPos.node.textContent!.length));
    const r = range.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      const cx = (r.left + r.right) / 2;
      if (cx < pageRect.left) expandPageForHighlight();
    }
  }
}

function canonicalOrMFVC(): number {
  return state.canonicalCharOffset >= 0
    ? state.canonicalCharOffset - state.sliceCharOffset
    : measureFirstVisibleChar();
}

// Listen for messages from React Native
export function setupMessageListener(): void {
  window.addEventListener("message", function (e: MessageEvent) {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "setFontSize") {
        // Use canonical char to prevent drift on repeated font changes
        const charBefore = canonicalOrMFVC();
        state.contentEl!.style.fontSize = msg.size + "px";
        if (msg.lineHeight) state.contentEl!.style.lineHeight = String(msg.lineHeight);
        requestAnimationFrame(function () {
          paginate();
          alignToTargetChar(charBefore);
        });
      } else if (msg.type === "scrollTo") {
        state.canonicalCharOffset = -1; // user navigated — MFVC becomes truth
        paginate();
        const page = Math.round(msg.position * (state.totalPages - 1)) + 1;
        goToPage(page);
      } else if (msg.type === "highlight") {
        // Refine heuristic highlight with actual match length
        const start = msg.start ?? 0;
        const length = msg.length ?? 0;
        const absStart = state.lastTapAbsOffset + start;
        const absEnd = absStart + length;
        clearHighlight();
        applyHighlight(start, length);
        // Peek if highlight extends off-screen
        peekForHighlight(absStart, absEnd);
        requestAnimationFrame(function () {
          const bounds = getAbsRangeBounds(absStart, absEnd);
          const startBounds = getAbsRangeBounds(absStart, Math.min(absStart + 1, absEnd));
          if (!bounds || !startBounds) return;
          (window as any).ReactNativeWebView?.postMessage(
            JSON.stringify({
              type: "highlightBounds",
              placementId: msg.placementId,
              selectionX: bounds.centerX,
              selectionTop: startBounds.top,
            }),
          );
        });
      } else if (msg.type === "clearHighlight") {
        clearHighlight();
      } else if (msg.type === "setNextContent") {
        replaceOffscreenContent(msg.replaceFromChar, msg.html);
        resetBookmarkHighlightState();
      } else if (msg.type === "setPrevContent") {
        prependBackSlice(msg.html, msg.charCount);
        resetBookmarkHighlightState();
      } else if (msg.type === "reloadContent") {
        const charBefore = canonicalOrMFVC();
        if (msg.lineHeight) state.contentEl!.style.lineHeight = String(msg.lineHeight);
        state.pageEl!.classList.toggle("furigana-active", !!msg.hasFurigana);
        state.pageEl!.innerHTML = "";
        const temp = document.createElement("div");
        temp.innerHTML = msg.html;
        while (temp.firstChild) state.pageEl!.appendChild(temp.firstChild);
        if (msg.sliceCharOffset != null) state.sliceCharOffset = msg.sliceCharOffset;
        state.totalPrependWidth = 0;
        state.prependedPages = 0;
        resetBookmarkHighlightState();
        requestAnimationFrame(function () {
          paginate();
          alignToTargetChar(msg.targetLocalChar ?? charBefore);
        });
      } else if (msg.type === "setPageAnimations") {
        state.pageAnimations = !!msg.enabled;
      } else if (msg.type === "setTheme") {
        if (!msg.theme) return;
        applyTheme(msg.theme);
      } else if (msg.type === "setBookmarkHighlights") {
        setBookmarkHighlights({ version: msg.version, surfaces: msg.surfaces });
      } else if (msg.type === "copyToClipboard") {
        const text = msg.text as string;
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: "copied" }));
      }
    } catch {}
  });
}
