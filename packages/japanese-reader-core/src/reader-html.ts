import { readerBundle, readerCss } from "@jiten/reader-webview/bundle";

export interface ReaderOptions {
  fontSize: number;
  isDark: boolean;
  scrollPosition?: number;
  targetLocalChar?: number;
  sliceCharOffset?: number;
  totalChars?: number;
  hasFurigana?: boolean;
  pageAnimations?: boolean;
}

function getReaderTheme(isDark: boolean) {
  return {
    bg: isDark ? "#18181b" : "#fafaf9",
    fg: isDark ? "#fafafa" : "#18181b",
    rubyColor: isDark ? "#a1a1aa" : "#71717a",
    highlightBg: isDark ? "#2e2e5f" : "#d5d5eb",
    bookmarkBg: "rgba(180, 170, 98, 0.28)",
  };
}

export function generateReaderHtml(content: string, options: ReaderOptions): string {
  const {
    fontSize,
    isDark,
    scrollPosition = 0,
    targetLocalChar = 0,
    sliceCharOffset = 0,
    totalChars = 0,
    hasFurigana = false,
    pageAnimations = true,
  } = options;
  const theme = getReaderTheme(isDark);

  const lineHeight = hasFurigana ? `${fontSize * 2}px` : `${Math.round(fontSize * 1.5)}px`;

  const css = readerCss
    .replace(/__FONT_SIZE__/g, String(fontSize))
    .replace(/__LINE_HEIGHT__/g, lineHeight);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
:root {
  --reader-bg: ${theme.bg};
  --reader-fg: ${theme.fg};
  --reader-ruby-color: ${theme.rubyColor};
  --reader-highlight-bg: ${theme.highlightBg};
  --reader-bookmark-bg: ${theme.bookmarkBg};
}
${css}</style>
</head>
<body>
<div id="raw" style="display:none">${content}</div>
<div id="content"><div id="page"${hasFurigana ? ' class="furigana-active"' : ""}></div></div>
<div id="page-controls">
  <button id="btn-next" aria-label="Next page">\u2039</button>
  <span id="page-num"></span>
  <button id="btn-prev" aria-label="Previous page">\u203A</button>
</div>
<script>window.__READER_CONFIG__={scrollPosition:${scrollPosition},targetLocalChar:${targetLocalChar},sliceCharOffset:${sliceCharOffset},totalChars:${totalChars},theme:${JSON.stringify(theme)},pageAnimations:${pageAnimations}}</script>
<script>${readerBundle}</script>
</body>
</html>`;
}
