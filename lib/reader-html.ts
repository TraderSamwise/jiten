export interface ReaderOptions {
  fontSize: number;
  isDark: boolean;
  scrollPosition?: number;
}

export function generateReaderHtml(
  content: string,
  options: ReaderOptions,
): string {
  const { fontSize, isDark, scrollPosition = 0 } = options;
  const bg = isDark ? "#18181b" : "#fafaf9";
  const fg = isDark ? "#fafafa" : "#18181b";
  const rubyColor = isDark ? "#a1a1aa" : "#71717a";
  const highlightBg = isDark
    ? "rgba(100, 100, 255, 0.3)"
    : "rgba(100, 100, 255, 0.2)";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    height: 100%;
    overflow: hidden;
    background: ${bg};
    color: ${fg};
    -webkit-text-size-adjust: none;
    -webkit-touch-callout: none;
  }

  #content {
    writing-mode: vertical-rl;
    font-family: "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif;
    font-size: ${fontSize}px;
    line-height: 1.8;
    padding: 16px;
    height: calc(100vh - 32px);
    column-width: calc(100vh - 32px);
    column-gap: 24px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  p {
    margin-block-end: 1em;
    text-indent: 1em;
  }

  ruby rt {
    font-size: 0.5em;
    color: ${rubyColor};
  }

  .bouten {
    font-style: normal;
    -webkit-text-emphasis: filled dot;
    text-emphasis: filled dot;
  }

  .highlight {
    background: ${highlightBg};
    border-radius: 2px;
  }

  .page-break {
    break-after: column;
    height: 0;
  }

  /* Hide scrollbar but keep scrollable */
  #content::-webkit-scrollbar {
    display: none;
  }
</style>
</head>
<body>
<div id="content">
${content}
</div>
<script>
(function() {
  var contentEl = document.getElementById('content');

  // ── Restore scroll position ──
  var initialPos = ${scrollPosition};
  if (initialPos > 0) {
    requestAnimationFrame(function() {
      var maxScroll = contentEl.scrollWidth - contentEl.clientWidth;
      contentEl.scrollLeft = initialPos * maxScroll;
    });
  }

  // ── TAP: get character at tap position and extract text forward ──
  contentEl.addEventListener('click', function(e) {
    // Ignore if there's an active selection
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    var range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;

    var node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;

    var offset = range.startOffset;
    var text = getTextFromPosition(node, offset, 20);

    if (!text || text.length === 0) return;

    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'tap',
      text: text,
      x: e.clientX,
      y: e.clientY
    }));
  });

  // ── SELECTION: capture selected text ──
  var selectionTimer;
  document.addEventListener('selectionchange', function() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(function() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      var text = sel.toString();
      if (text.length > 0 && text.length <= 100) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'selection',
          text: text
        }));
      }
    }, 300);
  });

  // ── SCROLL: debounced position reporting ──
  var scrollTimer;
  contentEl.addEventListener('scroll', function() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      var maxScroll = contentEl.scrollWidth - contentEl.clientWidth;
      var pos = maxScroll > 0 ? contentEl.scrollLeft / maxScroll : 0;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'scroll',
        position: pos
      }));
    }, 500);
  });

  // ── Extract text from position forward, walking through text nodes ──
  function getTextFromPosition(startNode, startOffset, maxChars) {
    var text = '';
    var node = startNode;
    var offset = startOffset;
    var walker = document.createTreeWalker(
      contentEl,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    // Position walker at startNode
    walker.currentNode = node;

    // Get remaining text from current node
    text += node.textContent.slice(offset);

    // Walk forward through text nodes
    while (text.length < maxChars && walker.nextNode()) {
      text += walker.currentNode.textContent;
    }

    return text.slice(0, maxChars);
  }

  // ── Listen for messages from React Native ──
  window.addEventListener('message', function(e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.type === 'setFontSize') {
        contentEl.style.fontSize = msg.size + 'px';
      } else if (msg.type === 'scrollTo') {
        var maxScroll = contentEl.scrollWidth - contentEl.clientWidth;
        contentEl.scrollLeft = msg.position * maxScroll;
      }
    } catch(err) {}
  });

  // Notify RN that the reader is ready
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
})();
</script>
</body>
</html>`;
}
