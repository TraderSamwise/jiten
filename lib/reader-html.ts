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
    width: 100%;
    height: calc(100vh - 44px);
    overflow: hidden;
    touch-action: none;
    position: relative;
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

  ::selection {
    background: ${highlightBg};
  }

  .page-break {
    display: none;
  }

  .buffer {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
  }

  #page-controls {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
    z-index: 100;
  }

  #page-controls button {
    background: none;
    border: none;
    color: ${fg};
    font-size: 28px;
    padding: 6px 16px;
    cursor: pointer;
    opacity: 0.5;
    line-height: 1;
    -webkit-tap-highlight-color: transparent;
  }

  #page-controls button:active {
    opacity: 0.8;
  }

  #page-controls button:disabled {
    opacity: 0.15;
    cursor: default;
  }

  #page-num {
    font-size: 13px;
    font-family: -apple-system, "Helvetica Neue", sans-serif;
    color: ${fg};
    opacity: 0.4;
    user-select: none;
  }

  #content::-webkit-scrollbar {
    display: none;
  }
</style>
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
<script>
(function() {
  var rawEl = document.getElementById('raw');
  var contentEl = document.getElementById('content');
  var pageEl = document.getElementById('page');
  var bufPrevEl = document.getElementById('buf-prev');
  var bufNextEl = document.getElementById('buf-next');
  var pageNumEl = document.getElementById('page-num');
  var btnNext = document.getElementById('btn-next');
  var btnPrev = document.getElementById('btn-prev');
  var controlsH = 44;

  // ── State ──
  var blockHtmls = [];
  var pages = [];
  var currentPage = 1;
  var totalPages = 1;
  var lastTapNode = null;
  var lastTapOffset = 0;
  var swipeHandled = false;

  // ── Parse blocks from raw content ──
  function parseBlocks() {
    var children = rawEl.children;
    blockHtmls = [];
    for (var i = 0; i < children.length; i++) {
      blockHtmls.push(children[i].outerHTML);
    }
    rawEl.parentNode.removeChild(rawEl);
  }

  // ── Responsive sizing ──
  function updateSizing() {
    var h = document.documentElement.clientHeight - controlsH;
    var w = document.documentElement.clientWidth;
    if (h > 0) {
      contentEl.style.height = h + 'px';
    }
    if (w > 0) {
      contentEl.style.width = w + 'px';
    }
  }

  // ── Pagination: measure which blocks fit per page ──
  function paginate() {
    pages = [];
    if (blockHtmls.length === 0) {
      pages = [{ start: 0, end: 0 }];
      totalPages = 1;
      return;
    }

    var measure = document.createElement('div');
    var cs = window.getComputedStyle(contentEl);
    measure.style.writingMode = cs.writingMode;
    measure.style.fontFamily = cs.fontFamily;
    measure.style.fontSize = cs.fontSize;
    measure.style.lineHeight = cs.lineHeight;
    measure.style.padding = cs.padding;
    measure.style.width = contentEl.clientWidth + 'px';
    measure.style.height = contentEl.clientHeight + 'px';
    measure.style.overflow = 'auto';
    measure.style.visibility = 'hidden';
    measure.style.position = 'absolute';
    measure.style.left = '-9999px';
    document.body.appendChild(measure);

    var pageStart = 0;
    for (var i = 0; i < blockHtmls.length; i++) {
      measure.insertAdjacentHTML('beforeend', blockHtmls[i]);
      if (measure.scrollWidth > measure.clientWidth) {
        // This block caused overflow
        if (i === pageStart) {
          // Single block overflows — give it its own page
          pages.push({ start: pageStart, end: i });
          pageStart = i + 1;
          measure.innerHTML = '';
        } else {
          // Previous blocks fit, this one doesn't
          pages.push({ start: pageStart, end: i - 1 });
          pageStart = i;
          measure.innerHTML = blockHtmls[i];
          // Check if this single block also overflows on its own
          if (measure.scrollWidth > measure.clientWidth) {
            pages.push({ start: i, end: i });
            pageStart = i + 1;
            measure.innerHTML = '';
          }
        }
      }
    }
    // Remaining blocks form the last page
    if (pageStart < blockHtmls.length) {
      pages.push({ start: pageStart, end: blockHtmls.length - 1 });
    }

    document.body.removeChild(measure);
    totalPages = pages.length;
  }

  // ── Render a specific page ──
  function renderPage(pageNum) {
    if (pageNum < 1 || pageNum > totalPages) return;
    var p = pages[pageNum - 1];
    var html = '';
    for (var i = p.start; i <= p.end; i++) {
      html += blockHtmls[i];
    }
    pageEl.innerHTML = html;

    // Buffer: previous page's last 2 blocks
    if (pageNum > 1) {
      var prev = pages[pageNum - 2];
      var bufStart = Math.max(prev.start, prev.end - 1);
      var bufHtml = '';
      for (var i = bufStart; i <= prev.end; i++) {
        bufHtml += blockHtmls[i];
      }
      bufPrevEl.innerHTML = bufHtml;
    } else {
      bufPrevEl.innerHTML = '';
    }

    // Buffer: next page's first 2 blocks
    if (pageNum < totalPages) {
      var next = pages[pageNum];
      var bufEnd = Math.min(next.end, next.start + 1);
      var bufHtml = '';
      for (var i = next.start; i <= bufEnd; i++) {
        bufHtml += blockHtmls[i];
      }
      bufNextEl.innerHTML = bufHtml;
    } else {
      bufNextEl.innerHTML = '';
    }

    updatePageInfo();
    reportScroll();
  }

  // ── Page info display ──
  function updatePageInfo() {
    pageNumEl.textContent = currentPage + ' / ' + totalPages;
    btnNext.disabled = (currentPage >= totalPages);
    btnPrev.disabled = (currentPage <= 1);
  }

  // ── Navigation ──
  function goToPage(page) {
    page = Math.max(1, Math.min(page, totalPages));
    currentPage = page;
    renderPage(currentPage);
  }

  function nextPage() { goToPage(currentPage + 1); }
  function prevPage() { goToPage(currentPage - 1); }

  function reportScroll() {
    var pos = totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'scroll',
      position: pos
    }));
  }

  // ── Button handlers ──
  btnNext.addEventListener('click', function(e) { e.stopPropagation(); nextPage(); });
  btnPrev.addEventListener('click', function(e) { e.stopPropagation(); prevPage(); });

  // ── Touch / swipe ──
  var touchStartX = 0;
  var touchStartY = 0;
  var touchStartTime = 0;

  contentEl.addEventListener('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  contentEl.addEventListener('touchend', function(e) {
    swipeHandled = false;
    if (isDragging) return; // Don't swipe during drag selection
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;
    var dt = Date.now() - touchStartTime;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50 && dt < 500) {
      swipeHandled = true;
      clearTimeout(longPressTimer); // Cancel any pending long press
      if (dx < 0) nextPage();   // Swipe left = forward
      else prevPage();           // Swipe right = back
    }
  }, { passive: true });

  // ── Keyboard ──
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); nextPage(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); prevPage(); }
  });

  // ── Prevent mouse wheel / trackpad scrolling ──
  contentEl.addEventListener('wheel', function(e) {
    e.preventDefault();
  }, { passive: false });

  // ── Clear existing highlights ──
  function clearHighlight() {
    var spans = contentEl.querySelectorAll('span.highlight');
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];
      var parent = span.parentNode;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    }
  }

  // Check if a character is Japanese (CJK, hiragana, katakana)
  function isJapanese(ch) {
    if (!ch) return false;
    var code = ch.charCodeAt(0);
    return (code >= 0x3040 && code <= 0x309F) || // Hiragana
           (code >= 0x30A0 && code <= 0x30FF) || // Katakana
           (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified
           (code >= 0x3400 && code <= 0x4DBF) || // CJK Extension A
           (code >= 0xFF66 && code <= 0xFF9F) || // Half-width katakana
           (code >= 0x3000 && code <= 0x303F);   // CJK punctuation (々 etc.)
  }

  function isKana(ch) {
    if (!ch) return false;
    var code = ch.charCodeAt(0);
    return (code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF);
  }

  function isKanji(ch) {
    if (!ch) return false;
    var code = ch.charCodeAt(0);
    return (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF);
  }

  // ── Heuristic word boundary detection (instant, no dictionary) ──
  // Finds approximate word end from a tap position by scanning forward.
  // Rules: kanji runs together, kana after kanji is okurigana, pure kana
  // runs together up to a particle boundary.
  function guessWordLength(text) {
    if (!text || text.length === 0) return 0;
    var i = 0;
    // Leading kanji
    while (i < text.length && isKanji(text[i])) i++;
    if (i > 0) {
      // Okurigana: kana following kanji (e.g. 走って → 走 + って)
      while (i < text.length && isKana(text[i])) i++;
      return i;
    }
    // Pure kana word: scan until non-Japanese
    while (i < text.length && isKana(text[i])) i++;
    return Math.max(i, 1);
  }

  // ── Heuristic backward word boundary detection ──
  // Given text and tapOffset within it, scan backward through kanji/kana
  // to find where the word likely starts.
  function guessWordStart(text, tapOffset) {
    var i = tapOffset;
    // If tapped char is kana, scan back through kana, then kanji
    // If tapped char is kanji, scan back through kanji only
    if (isKanji(text[i])) {
      while (i > 0 && isKanji(text[i - 1])) i--;
    } else if (isKana(text[i])) {
      // Scan back through kana
      while (i > 0 && isKana(text[i - 1])) i--;
      // Then scan back through kanji (okurigana pattern: kanji + kana)
      while (i > 0 && isKanji(text[i - 1])) i--;
    }
    return i;
  }

  // Convert a node/offset to an absolute character offset within contentEl
  var lastTapAbsOffset = 0;

  function nodeOffsetToAbsolute(targetNode, targetOffset) {
    var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null, false);
    var abs = 0;
    while (walker.nextNode()) {
      if (walker.currentNode === targetNode) return abs + targetOffset;
      abs += walker.currentNode.textContent.length;
    }
    return abs + targetOffset;
  }

  // Resolve absolute offset to node/offset pair (survives DOM changes)
  function absoluteToNodeOffset(absOffset) {
    var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null, false);
    var remaining = absOffset;
    while (walker.nextNode()) {
      var len = walker.currentNode.textContent.length;
      if (remaining <= len) return { node: walker.currentNode, offset: remaining };
      remaining -= len;
    }
    return null;
  }

  // ── Apply highlight by startDelta + length from lastTapAbsOffset ──
  // startDelta is relative to lastTapAbsOffset (negative = match starts before tap)
  function applyHighlight(startDelta, len) {
    if (len <= 0) return;
    var absStart = lastTapAbsOffset + (startDelta || 0);
    if (absStart < 0) absStart = 0;
    var start = absoluteToNodeOffset(absStart);
    var end = absoluteToNodeOffset(absStart + len);
    if (!start || !end) return;
    try {
      var hlRange = document.createRange();
      hlRange.setStart(start.node, start.offset);
      hlRange.setEnd(end.node, end.offset);
      if (hlRange.collapsed) return;
      var span = document.createElement('span');
      span.className = 'highlight';
      try { hlRange.surroundContents(span); } catch(ex) {
        var fragment = hlRange.extractContents();
        span.appendChild(fragment);
        hlRange.insertNode(span);
      }
    } catch(e) {}
  }

  // ── SELECTION: capture selected text via native selection ──
  var selectionTimer;
  document.addEventListener('selectionchange', function() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(function() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      var text = sel.toString();
      if (text.length > 0 && text.length <= 100) {
        // Grab prefix/suffix context around the selection
        var range = sel.getRangeAt(0);
        var prefix = getTextBeforePosition(range.startContainer, range.startOffset, 10);
        var suffix = getTextFromPosition(range.endContainer, range.endOffset, 10);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'selection',
          text: text,
          prefix: prefix,
          suffix: suffix
        }));
      }
    }, 300);
  });

  // ── TAP: word lookup (click on text) ──
  contentEl.addEventListener('click', function(e) {
    if (swipeHandled) { swipeHandled = false; return; }

    // If there's a native selection, let it be (user is selecting text)
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    clearHighlight();

    var range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    var node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    var offset = range.startOffset;

    // Check we actually tapped on a Japanese character
    var charAtTap = node.textContent.charAt(offset);
    if (!charAtTap || !isJapanese(charAtTap)) return;

    lastTapNode = node;
    lastTapOffset = offset;
    lastTapAbsOffset = nodeOffsetToAbsolute(node, offset);

    var before = getTextBeforePosition(node, offset, 10);
    var after = getTextFromPosition(node, offset, 20);
    if (!after || after.length === 0) return;

    var text = before + after;
    var tapOffset = before.length; // index of tapped char within combined window

    // Instant heuristic highlight
    var wordStart = guessWordStart(text, tapOffset);
    var guessLen = guessWordLength(text.slice(wordStart));
    applyHighlight(wordStart - tapOffset, guessLen);

    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'tap',
      text: text,
      tapOffset: tapOffset,
      x: e.clientX,
      y: e.clientY
    }));
  });

  // ── Extract text from position forward, walking through text nodes ──
  function getTextFromPosition(startNode, startOffset, maxChars) {
    var text = '';
    var node = startNode;
    var walker = document.createTreeWalker(
      contentEl,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    walker.currentNode = node;
    text += node.textContent.slice(startOffset);
    while (text.length < maxChars && walker.nextNode()) {
      text += walker.currentNode.textContent;
    }
    return text.slice(0, maxChars);
  }

  // ── Extract text backward from position, walking through preceding text nodes ──
  function getTextBeforePosition(startNode, startOffset, maxChars) {
    var text = startNode.textContent.slice(0, startOffset);
    var walker = document.createTreeWalker(
      contentEl,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    walker.currentNode = startNode;
    while (text.length < maxChars && walker.previousNode()) {
      text = walker.currentNode.textContent + text;
    }
    if (text.length > maxChars) {
      text = text.slice(text.length - maxChars);
    }
    return text;
  }

  // ── Listen for messages from React Native ──
  window.addEventListener('message', function(e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.type === 'setFontSize') {
        contentEl.style.fontSize = msg.size + 'px';
        requestAnimationFrame(function() {
          var ratio = totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0;
          paginate();
          currentPage = Math.round(ratio * (totalPages - 1)) + 1;
          currentPage = Math.max(1, Math.min(currentPage, totalPages));
          goToPage(currentPage);
        });
      } else if (msg.type === 'scrollTo') {
        paginate();
        var page = Math.round(msg.position * (totalPages - 1)) + 1;
        goToPage(page);
      } else if (msg.type === 'highlight') {
        // Refine heuristic highlight with actual match length
        clearHighlight();
        applyHighlight(msg.start || 0, msg.length || 0);
      } else if (msg.type === 'clearHighlight') {
        clearHighlight();
      }
    } catch(err) {}
  });

  // ── Initial setup ──
  parseBlocks();
  updateSizing();
  var savedPos = ${scrollPosition};
  requestAnimationFrame(function() {
    updateSizing();
    paginate();
    if (savedPos > 0 && totalPages > 1) {
      currentPage = Math.round(savedPos * (totalPages - 1)) + 1;
    } else {
      currentPage = 1;
    }
    goToPage(currentPage);
  });

  // ── Resize handler ──
  window.addEventListener('resize', function() {
    var ratio = totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0;
    updateSizing();
    requestAnimationFrame(function() {
      paginate();
      currentPage = Math.round(ratio * (totalPages - 1)) + 1;
      currentPage = Math.max(1, Math.min(currentPage, totalPages));
      goToPage(currentPage);
    });
  });

  // Notify RN that the reader is ready
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
})();
</script>
</body>
</html>`;
}
