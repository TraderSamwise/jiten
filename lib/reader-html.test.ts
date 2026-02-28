/**
 * Reader HTML template tests.
 *
 * Tests the generated HTML document for the WebView reader,
 * verifying CSS properties, JS bridge code, and theme handling.
 */

import { describe, test, expect } from "vitest";
import { generateReaderHtml } from "./reader-html";

describe("generateReaderHtml", () => {
  const sampleContent = "<p>テスト文章です。</p>";

  test("generates valid HTML document", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
  });

  test("includes content in raw div", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("テスト文章です。");
    expect(html).toContain('id="raw"');
    expect(html).toContain("display:none");
  });

  test("sets vertical writing mode", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("writing-mode: vertical-rl");
  });

  test("uses specified font size", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 28,
      isDark: false,
    });
    expect(html).toContain("font-size: 28px");
  });

  test("different font sizes produce different output", () => {
    const html14 = generateReaderHtml(sampleContent, {
      fontSize: 14,
      isDark: false,
    });
    const html32 = generateReaderHtml(sampleContent, {
      fontSize: 32,
      isDark: false,
    });
    expect(html14).toContain("font-size: 14px");
    expect(html32).toContain("font-size: 32px");
    expect(html14).not.toContain("font-size: 32px");
  });

  // ── Theme tests ──

  test("light theme uses light background", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("background: #fafaf9");
    expect(html).toContain("color: #18181b");
  });

  test("dark theme uses dark background", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: true,
    });
    expect(html).toContain("background: #18181b");
    expect(html).toContain("color: #fafafa");
  });

  // ── CSS structure tests ──

  test("uses overflow hidden on #content", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("overflow: hidden");
  });

  test("includes #page div for content rendering", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain('id="page"');
  });

  test("#page has overflow hidden for scroll-based pagination", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("#page");
    expect(html).toContain("overflow: hidden");
  });

  test("includes serif font family for Japanese", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("Hiragino Mincho ProN");
    expect(html).toContain("serif");
  });

  test("includes ruby rt styling", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("ruby rt");
    expect(html).toContain("font-size: 0.5em");
  });

  test("includes bouten styling", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain(".bouten");
    expect(html).toContain("text-emphasis: filled dot");
  });

  test("includes page-break styling (hidden)", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain(".page-break");
    expect(html).toContain("display: none");
  });

  // ── JS bridge tests ──

  test("includes tap handler with caretRangeFromPoint", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("caretRangeFromPoint");
    expect(html).toContain('type: "tap"');
  });

  test("includes selection handler", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("mousedown");
    expect(html).toContain('type: "selection"');
  });

  test("includes scroll position reporting", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain('type: "scroll"');
    expect(html).toContain("reportScroll");
  });

  test("includes postMessage bridge to React Native", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("ReactNativeWebView.postMessage");
  });

  test("includes message listener for font size changes", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("setFontSize");
    expect(html).toContain('addEventListener("message"');
  });

  test("includes ready notification", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain('type: "ready"');
  });

  test("includes getTextFromPosition helper", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("getTextFromPosition");
    expect(html).toContain("createTreeWalker");
  });

  // ── Scroll position restore ──

  test("defaults scroll position to 0 (start of book)", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("scrollPosition:0}");
  });

  test("restores custom scroll position", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
      scrollPosition: 0.75,
    });
    expect(html).toContain("scrollPosition:0.75}");
  });

  // ── Page controls ──

  test("includes page controls with arrows and page number", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain('id="page-controls"');
    expect(html).toContain('id="btn-next"');
    expect(html).toContain('id="btn-prev"');
    expect(html).toContain('id="page-num"');
  });

  test("includes page navigation functions", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("goToPage");
    expect(html).toContain("nextPage");
    expect(html).toContain("prevPage");
    expect(html).toContain("paginate");
  });

  test("includes swipe gesture handling", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("touchstart");
    expect(html).toContain("touchend");
    expect(html).toContain("swipeHandled");
  });

  test("includes keyboard arrow navigation", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("ArrowLeft");
    expect(html).toContain("ArrowRight");
    expect(html).toContain("keydown");
  });

  // ── CSS column pagination functions ──

  test("includes setupContent function", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("setupContent");
  });

  test("includes paginate function with column-width", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("function paginate()");
    expect(html).toContain("columnWidth");
    expect(html).toContain("scrollWidth");
  });

  test("includes goToPage function with scrollLeft", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("function goToPage(page)");
    expect(html).toContain("scrollLeft");
  });

  // ── Highlight commands ──

  test("includes highlight message handler", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain('msg.type === "highlight"');
    expect(html).toContain("lastTapNode");
    expect(html).toContain("lastTapOffset");
  });

  test("includes clearHighlight message handler", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain('msg.type === "clearHighlight"');
    expect(html).toContain("clearHighlight");
  });

  // ── Responsive sizing ──

  test("uses JS-based responsive sizing with resize listener", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("updateSizing");
    expect(html).toContain("clientHeight");
    expect(html).toContain("clientWidth");
    expect(html).toContain('addEventListener("resize"');
  });

  test("resize handler re-paginates and preserves position", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("resize");
    expect(html).toContain("paginate()");
    expect(html).toContain("ratio");
  });

  // ── Viewport meta ──

  test("disables user scaling", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("user-scalable=no");
  });

  test("sets UTF-8 charset", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain('charset="utf-8"');
  });

  // ── Scroll-based pagination ──

  test("uses scrollLeft-based pagination (no CSS columns)", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("scrollLeft");
    expect(html).toContain("scrollWidth");
    expect(html).not.toContain("animateScroll");
    expect(html).not.toContain("overflow-x: auto");
  });
});
