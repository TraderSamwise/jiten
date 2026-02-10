import { state } from "./state";
import { clearHighlight, applyHighlight } from "./highlight";
import { paginate, goToPage } from "./pagination";

// Listen for messages from React Native
export function setupMessageListener(): void {
  window.addEventListener("message", function (e: MessageEvent) {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "setFontSize") {
        state.contentEl!.style.fontSize = msg.size + "px";
        requestAnimationFrame(function () {
          const ratio = state.totalPages > 1 ? (state.currentPage - 1) / (state.totalPages - 1) : 0;
          paginate();
          state.currentPage = Math.round(ratio * (state.totalPages - 1)) + 1;
          state.currentPage = Math.max(1, Math.min(state.currentPage, state.totalPages));
          goToPage(state.currentPage);
        });
      } else if (msg.type === "scrollTo") {
        paginate();
        const page = Math.round(msg.position * (state.totalPages - 1)) + 1;
        goToPage(page);
      } else if (msg.type === "highlight") {
        // Refine heuristic highlight with actual match length
        clearHighlight();
        applyHighlight(msg.start || 0, msg.length || 0);
      } else if (msg.type === "clearHighlight") {
        clearHighlight();
      }
    } catch {}
  });
}
