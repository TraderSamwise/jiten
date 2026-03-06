import { state } from "./state";
import { clearHighlight, applyHighlight } from "./highlight";
import {
  paginate,
  goToPage,
  measureFirstVisibleChar,
  alignToTargetChar,
  replaceOffscreenContent,
  prependBackSlice,
} from "./pagination";

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
        clearHighlight();
        applyHighlight(msg.start || 0, msg.length || 0);
      } else if (msg.type === "clearHighlight") {
        clearHighlight();
      } else if (msg.type === "setNextContent") {
        replaceOffscreenContent(msg.replaceFromChar, msg.html);
      } else if (msg.type === "setPrevContent") {
        prependBackSlice(msg.html, msg.charCount);
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
        requestAnimationFrame(function () {
          paginate();
          alignToTargetChar(msg.targetLocalChar ?? charBefore);
        });
      } else if (msg.type === "setPageAnimations") {
        state.pageAnimations = !!msg.enabled;
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
