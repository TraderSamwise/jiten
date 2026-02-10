import { readerBundle, readerCss } from "./reader/bundle";

export interface ReaderOptions {
  fontSize: number;
  isDark: boolean;
  scrollPosition?: number;
}

export function generateReaderHtml(content: string, options: ReaderOptions): string {
  const { fontSize, isDark, scrollPosition = 0 } = options;
  const bg = isDark ? "#18181b" : "#fafaf9";
  const fg = isDark ? "#fafafa" : "#18181b";
  const rubyColor = isDark ? "#a1a1aa" : "#71717a";
  const highlightBg = isDark ? "rgba(100, 100, 255, 0.3)" : "rgba(100, 100, 255, 0.2)";

  const css = readerCss
    .replace(/__BG__/g, bg)
    .replace(/__FG__/g, fg)
    .replace(/__RUBY_COLOR__/g, rubyColor)
    .replace(/__HIGHLIGHT_BG__/g, highlightBg)
    .replace(/__FONT_SIZE__/g, String(fontSize));

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
<div id="content">
  <div id="buf-prev" class="buffer"></div>
  <div id="page"></div>
  <div id="buf-next" class="buffer"></div>
</div>
<div id="page-controls">
  <button id="btn-next" aria-label="Next page">\u2039</button>
  <span id="page-num"></span>
  <button id="btn-prev" aria-label="Previous page">\u203A</button>
</div>
<script>window.__READER_CONFIG__={scrollPosition:${scrollPosition}}</script>
<script>${readerBundle}</script>
</body>
</html>`;
}
