# Reader Rendering Engine

Developer documentation for the ebook reader's WebView rendering system. The reader displays Japanese vertical text with JS-driven pagination, virtualized content loading, and character-level position tracking.

## Layout Model

The reader uses `writing-mode: vertical-rl` — text flows top-to-bottom within columns, columns flow right-to-left. Pagination is done by setting `overflow: hidden` on `#page` and controlling `scrollLeft` to show one column-width of content at a time.

```
┌──────────────────────────────┐
│  #content (padding: 16px)    │
│  ┌────────────────────────┐  │
│  │  #page (width: colW)   │  │
│  │  overflow: hidden      │  │
│  │                        │  │
│  │  ┌──┬──┬──┬──┬──┬──┐  │  │
│  │  │c6│c5│c4│c3│c2│c1│  │  │  ← columns (right-to-left)
│  │  │  │  │  │  │  │  │  │  │
│  │  │  │  │  │  │  │  │  │  │  ← text flows top-to-bottom
│  │  └──┴──┴──┴──┴──┴──┘  │  │
│  └────────────────────────┘  │
│  [◂ prev]   47.3%  [next ▸]  │  ← #page-controls (44px)
└──────────────────────────────┘
```

- **Column width**: `Math.floor(contentWidth / lineWidth) * lineWidth` where `lineWidth = fontSize * 1.5`. Snapped to whole lines so page boundaries never cut through text.
- **Page navigation**: `scrollLeft = -((page - 1) * columnWidth)`. Negative because vertical-rl content overflows leftward.
- **No CSS columns**: This is NOT a CSS multi-column layout. It's a single block of vertical-rl content with horizontal overflow, paginated by JS-controlled scroll position.

## Content Virtualization

The reader doesn't load the full book into the WebView. Instead, it loads a slice of content centered around the reading position and prefetches forward/backward as the user navigates.

**On load**: RN calculates a content slice:

```
startChar = max(0, charOffset - charsPerPage * 10)
budget = (charOffset - startChar) + charsPerPage * 3
slice = sliceContent(model, startChar, budget)
```

**Forward prefetch**: When `pageRendered` reports a `lastCharIndex` near the end of loaded content, RN sends `setNextContent` which calls `replaceOffscreenContent()` — replacing already-read content to the right with new content to the left.

**Backward prefetch**: When the user navigates to early pages, RN sends `setPrevContent` which calls `prependBackSlice()` — prepending earlier content to the right side of `#page` and adjusting the spacer/scroll to keep the current page stable.

### Slice char offset tracking

`state.sliceCharOffset` tracks the global char index of the first character in the WebView. When content is prepended, this decreases. The global position of any local char index is `sliceCharOffset + localIndex`.

## Text Walker

`textWalker()` in `text.ts` creates a `TreeWalker` that visits text nodes while **skipping `<rt>` elements** (ruby annotations / furigana). This is critical — without it, furigana text would be counted as visible characters and corrupt all char-offset calculations.

All char-offset functions use `state.pageEl` as the walker root (not `contentEl`). This was a significant bug fix — whitespace text nodes between `#content` and `#page` in the HTML caused char count mismatches between functions using different roots.

### Key functions (text.ts)

| Function                                   | Purpose                                |
| ------------------------------------------ | -------------------------------------- |
| `absoluteToNodeOffset(n)`                  | Resolve char index → DOM node + offset |
| `nodeOffsetToAbsolute(node, offset)`       | DOM position → char index              |
| `getTextFromPosition(node, offset, max)`   | Extract text forward from position     |
| `getTextBeforePosition(node, offset, max)` | Extract text backward from position    |
| `getAbsText(start, end)`                   | Extract text between absolute offsets  |

## Character Measurement

### measureFirstVisibleChar (MFVC)

Walks all text nodes via `textWalker`, measures each character's bounding rect, and returns the index of the first char whose horizontal center falls within `pageEl`'s viewport bounds. Used to determine the reading position on the current page.

**Important**: Uses `pageEl.getBoundingClientRect()` for viewport bounds, NOT `contentEl`. The 16px padding on `contentEl` extends beyond `pageEl`, and using `contentEl` bounds would pick up characters from adjacent clipped columns.

### measureLastVisibleChar (MLVC)

Same approach but returns the last visible char. Used to report reading progress for forward prefetch triggering.

### findRenderedChar

Some characters (Japanese brackets `「」`, whitespace, certain punctuation) have **zero-size bounding rects** when measured at `scrollLeft=0` but render fine at their actual scroll position. `findRenderedChar(absOffset)` scans forward then backward (up to 50 chars) to find the nearest character with a non-zero bounding rect. Used as a proxy during alignment.

## Alignment Algorithm (alignToTargetChar)

When the reader opens or font size changes, we need to place a specific character in the rightmost visible column. This is done by an iterative alignment loop.

### Phase 1: Spacer adjustment

A `<div class="back-spacer">` is prepended to `#page`. Its width shifts all text columns leftward. The algorithm adjusts the spacer width until the target character's distance from the right edge of `#page` (`D`) is a multiple of `columnWidth`:

```
remainder = D % columnWidth
if remainder < 5px → aligned (target is at a column boundary)
else → spacerWidth += ceil(columnWidth - remainder), retry
```

### Phase 2: Convergence verification

After spacer alignment, navigate to the target page and measure MFVC. The MFVC gives the actual column-top character. If `findRenderedChar(mfvc) === alignTarget`, the alignment converged — the target char's column is the rightmost column.

If not converged, re-align to the rendered proxy of MFVC and repeat (up to 5 rounds).

### Fallback

If Phase 1 can't measure the target (zero rect even after `findRenderedChar`), a ratio-based fallback estimates the page: `page = round((targetChar / totalChars) * totalPages)`.

### Why convergence uses rendered proxies

Consider: MFVC returns char 4780 (`「`), but our align target is 4781 (the first rendered char after `「`). Without proxy comparison, 4780 !== 4781 → round 1 tries to align 4780 → zero rect → fallback → wrong page. With proxies: `findRenderedChar(4780)` = 4781 = alignTarget → converged.

## Canonical Char Offset

`state.canonicalCharOffset` stores the global char position from the DB, preserved until the user navigates to a different page. This prevents position drift:

- Spacer insertion and backward prepend shift column boundaries, which can change MFVC by a few characters even though the visual position hasn't moved.
- `reportScroll()` uses `canonicalCharOffset` (if set) instead of re-measuring MFVC.
- Cleared (`-1`) when the user explicitly navigates (next/prev page, page jump).

## Backward Prepend Math

When earlier content is prepended to `#page`, the spacer must be recalculated to keep the current page aligned:

```
totalPrependWidth += newContentWidth
remainder = totalPrependWidth % columnWidth
spacerWidth = (remainder > 1) ? round(columnWidth - remainder) : 0
pagesAdded = newTotalPrepPages - oldPrepPages
currentPage += pagesAdded
```

`sliceCharOffset` decreases by the prepended char count to keep global positions correct.

## CSS Quirks

### text-indent in vertical-rl

CSS `text-indent: 1em` is **not used**. WebKit re-applies `text-indent` at every column break in vertical-rl overflow pagination, not just the actual first line of each `<p>`. This caused every page to appear indented even mid-paragraph. Instead, paragraph indentation comes from the source text's native full-width space characters (`　`), which is the standard Japanese typographic convention.

### Block boundaries are column boundaries

Each line of Aozora source text becomes its own `<p>` element. In vertical-rl, block element boundaries are always column boundaries — a `<p>` always starts at the top of a new column regardless of font size. This means:

- Font size changes preserve the first visible character's position when it's a `<p>` start (which is the common case for Japanese text with many short dialog lines).
- For long paragraphs spanning multiple columns, the column-top shifts by a few characters on resize, but `alignToTargetChar` handles this.

### HTML whitespace matters

The HTML template must have **no whitespace** between `#content` and `#page`:

```html
<!-- CORRECT -->
<div id="content"><div id="page"></div></div>

<!-- WRONG — creates text nodes that corrupt char counting -->
<div id="content">
  <div id="page"></div>
</div>
```

Whitespace text nodes between these elements are visited by `textWalker` and counted as characters, causing offset mismatches between `absoluteToNodeOffset` (which walks from `pageEl`) and the text content.

## Font Size Changes

On `setFontSize` message from RN:

1. Capture MFVC before the change
2. Apply new font size to `#content`
3. Re-paginate (new column width)
4. Run `alignToTargetChar(capturedMFVC)` to place the same char in the rightmost column

## File Map

| File                | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `reader.css`        | Styles with template variables (`__BG__`, `__FG__`, etc.)       |
| `src/index.ts`      | Init: DOM refs, event listeners, initial pagination + alignment |
| `src/state.ts`      | Shared mutable state object                                     |
| `src/pagination.ts` | Paginate, align, measure, navigate, prepend/replace content     |
| `src/text.ts`       | TreeWalker, char offset resolution, text extraction             |
| `src/bridge.ts`     | WebView ↔ RN message handler                                    |
| `src/highlight.ts`  | Word highlight (CSS Custom Highlight API with span fallback)    |
| `src/japanese.ts`   | Character classification, word boundary heuristics              |
| `src/touch.ts`      | Touch/swipe gesture handling                                    |
| `src/mouse.ts`      | Mouse drag-select (web)                                         |
| `build.ts`          | esbuild script → `bundle.ts`                                    |
| `bundle.ts`         | Built JS + CSS strings, imported by `reader-html.ts`            |

### RN-side files

| File                                                 | Purpose                                           |
| ---------------------------------------------------- | ------------------------------------------------- |
| `lib/reader-html.ts`                                 | Generates the full HTML document with config      |
| `lib/reader-model.ts`                                | App-side content parsing, char counting, slicing  |
| `packages/japanese-reader-core/src/aozora-parser.ts` | Aozora Bunko markup → HTML conversion             |
| `app/(tabs)/reader/[bookId].tsx`                     | Reader screen: WebView management, prefetch logic |
