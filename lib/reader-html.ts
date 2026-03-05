import { readerBundle, readerCss } from "./reader/bundle";

export interface ReaderOptions {
  fontSize: number;
  isDark: boolean;
  scrollPosition?: number;
  targetLocalChar?: number;
  sliceCharOffset?: number;
  totalChars?: number;
  hasFurigana?: boolean;
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
  } = options;
  const bg = isDark ? "#18181b" : "#fafaf9";
  const fg = isDark ? "#fafafa" : "#18181b";
  const rubyColor = isDark ? "#a1a1aa" : "#71717a";
  const highlightBg = isDark ? "#2e2e5f" : "#d5d5eb";

  const lineHeight = hasFurigana ? `${fontSize * 2}px` : "1.5";

  const css = readerCss
    .replace(/__BG__/g, bg)
    .replace(/__FG__/g, fg)
    .replace(/__RUBY_COLOR__/g, rubyColor)
    .replace(/__HIGHLIGHT_BG__/g, highlightBg)
    .replace(/__FONT_SIZE__/g, String(fontSize))
    .replace(/__LINE_HEIGHT__/g, lineHeight);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
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
<script>window.__READER_CONFIG__={scrollPosition:${scrollPosition},targetLocalChar:${targetLocalChar},sliceCharOffset:${sliceCharOffset},totalChars:${totalChars},highlightBg:"${highlightBg}"}</script>
<script>${readerBundle}</script>
</body>
</html>`;
}
