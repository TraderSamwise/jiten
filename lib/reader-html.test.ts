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

  test("includes content in the document", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("テスト文章です。");
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

  test("includes column layout for pagination", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("column-width:");
    expect(html).toContain("column-gap:");
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

  test("includes page-break styling", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain(".page-break");
    expect(html).toContain("break-after: column");
  });

  // ── JS bridge tests ──

  test("includes tap handler with caretRangeFromPoint", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("caretRangeFromPoint");
    expect(html).toContain("type: 'tap'");
  });

  test("includes selection handler", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("selectionchange");
    expect(html).toContain("type: 'selection'");
  });

  test("includes scroll position tracking", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("type: 'scroll'");
    expect(html).toContain("scrollWidth");
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
    expect(html).toContain("addEventListener('message'");
  });

  test("includes ready notification", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("type: 'ready'");
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

  test("defaults scroll position to 0", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
    });
    expect(html).toContain("var initialPos = 0");
  });

  test("restores custom scroll position", () => {
    const html = generateReaderHtml(sampleContent, {
      fontSize: 22,
      isDark: false,
      scrollPosition: 0.75,
    });
    expect(html).toContain("var initialPos = 0.75");
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
});
