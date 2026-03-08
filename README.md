# Jiten

Japanese ebook reader and dictionary app. Built with Expo (React Native) targeting iOS, Android, and web.

## Development

```bash
yarn            # install dependencies
yarn web        # start web dev server
yarn ios        # run on iOS
yarn android    # run on Android
yarn test       # run tests
yarn lint       # check for lint errors
yarn lint:fix   # auto-fix lint errors
yarn format     # format all files with prettier
```

## Testing

Tests use [vitest](https://vitest.dev/). Run with `yarn test` or `yarn test:watch`.

### SQLite test helper

`test/test-db.ts` provides `createTestDb()` — an in-memory SQLite database (via `better-sqlite3`) that implements the `WrappedUserDb` interface and runs all user DB migrations. This lets tests execute real SQL queries against the same schema the app uses.

```ts
import { createTestDb } from "@/test/test-db";

let db: ReturnType<typeof createTestDb>;

beforeEach(() => {
  db = createTestDb(); // fresh DB per test
});

afterAll(() => db.close());

test("example", async () => {
  await db.runAsync("INSERT INTO review_marks ...", [...]);
  const rows = await db.getAllAsync("SELECT ...");
  expect(rows).toHaveLength(1);
});
```

### Test mocks

| Mock             | Path                              | Purpose                                                         |
| ---------------- | --------------------------------- | --------------------------------------------------------------- |
| React Native     | `test/__mocks__/react-native.ts`  | Stubs `Platform.OS` and `AppState` with simulated state changes |
| AsyncStorage     | `test/__mocks__/async-storage.ts` | In-memory key-value store                                       |
| Env              | `test/__mocks__/env.ts`           | Environment stubs                                               |
| SQLite (user DB) | `test/test-db.ts`                 | In-memory SQLite with full migration schema                     |

### React component tests (jsdom)

Tests that render React components (hooks, providers) use `@testing-library/react` with jsdom. Add `@vitest-environment jsdom` as a doc comment at the top of the test file — vitest picks this up automatically.

`db/sync-provider.test.tsx` is the reference implementation. Key patterns:

**Fake timers + async React effects:** The SyncProvider has chained async effects (reconciliation → token fetch → dirty check → sync). With `vi.useFakeTimers()`, any `setTimeout` or `setInterval` is frozen. Use a `settle()` helper that repeatedly advances timers by 0 and yields to the microtask queue:

```tsx
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    vi.advanceTimersByTime(0);
    await act(async () => {
      await Promise.resolve();
    });
  }
}
```

**Advancing time:** Wrap `vi.advanceTimersByTime(ms)` in `act()`, then call `settle()`:

```tsx
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await settle(5);
}
```

**AppState simulation:** The react-native mock exposes `AppState._simulateChange(state)` to trigger foreground/background transitions:

```tsx
act(() => {
  (AppState as any)._simulateChange("background");
});
act(() => {
  (AppState as any)._simulateChange("active");
});
```

**Mocking heavy providers:** SyncProvider imports ~10 modules. Mock them all with `vi.mock()` before the import. Use `let mockUserDb` + `createTestDb()` for the real SQLite database (enables testing actual DB reads/writes in the provider). See `sync-provider.test.tsx` for the full mock setup.

**Platform-specific module resolution:** `user-provider` has `.native.tsx` and `.web.tsx` variants with no bare `.ts` file. Vitest can't resolve the bare import, so an alias is added in `vitest.config.ts` pointing to the web variant.

## Platform Polymorphism

This project runs on both native (iOS/Android) and web. React Native's `Alert.alert`, gesture handlers, and filesystem APIs behave differently (or don't work at all) across platforms.

**Rule: use polymorphic modules instead of `Platform.OS` switches.**

Polymorphic modules use Metro/webpack's platform extension resolution (`.web.ts` / `.native.ts`). The bundler picks the right file automatically — no runtime branching needed.

### Existing polymorphic modules

| Module                                   | Purpose                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `lib/confirm.{web,native}.ts`            | `confirm(title, msg)` and `alert(title, msg)` — wraps `window.confirm`/`window.alert` on web, `Alert.alert` on native |
| `db/user-provider.{web,native}.tsx`      | SQLite database provider — uses `expo-sqlite` web adapter vs native                                                   |
| `components/ReaderView.{web,native}.tsx` | WebView reader component                                                                                              |

### ESLint enforcement

Importing `Alert` from `react-native` is banned via `no-restricted-imports`. Use `confirm()` or `alert()` from `@/lib/confirm` instead. The polymorphic wrapper (`lib/confirm.native.ts`) is exempted from this rule.

## Linting and Formatting

- **ESLint** with TypeScript, React Hooks (exhaustive-deps), and Prettier rules
- **Prettier** for consistent formatting
- **Pre-commit hook** (husky + lint-staged) runs `tsc --noEmit`, eslint, and prettier on staged files automatically

Config files: `eslint.config.mjs`, `.prettierrc`

## Reader Architecture

The reader is a vertical Japanese ebook reader with interactive furigana, tap-to-lookup dictionary, and streaming pagination. It supports three content sources: Aozora Bunko (public domain literature), Syosetu (web novels), and plain text file imports.

### High-level flow

```
Book content (raw text / Aozora markup / HTML)
  → aozora-parser.ts (parse markup to HTML)
  → reader-furigana.ts (inject <ruby> tags based on JLPT level settings)
  → reader-model.ts (slice into streamable chunks by visible char count)
  → reader-html.ts (wrap in full HTML document with CSS + JS)
  → ReaderView.{native,web}.tsx (render in WebView/iframe)
  → reader/src/*.ts (pagination, gestures, highlight, dictionary lookup bridge)
```

### Pagination engine (`lib/reader/src/`)

The reader uses **column-based vertical pagination** in a WebView:

1. Content is placed in a `vertical-rl` (right-to-left) writing-mode container
2. `paginate()` measures `scrollWidth` and divides by column width to get total pages
3. Navigation sets `scrollLeft` to show the target page (columns flow right-to-left)
4. `alignToTargetChar()` snaps the scroll position to show a specific character in the rightmost visible column — used to preserve reading position across font size changes and content reloads
5. Streaming prefetch: `replaceOffscreenContent()` swaps in next-slice HTML into the right (offscreen) side; `prependBackSlice()` prepends content for backward navigation

No virtual DOM or framework — vanilla TypeScript compiled to a single JS bundle embedded in the HTML.

#### Key modules

| File                           | Purpose                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `lib/reader/src/pagination.ts` | Page measurement, navigation, scroll alignment, streaming content swap             |
| `lib/reader/src/state.ts`      | Global state: current page, column width, char offsets, DOM refs                   |
| `lib/reader/src/highlight.ts`  | CSS Highlight API (with Safari `.highlight` class fallback) for word selection     |
| `lib/reader/src/text.ts`       | Tree walker for visible text (skips `<rt>`), caret resolution from tap position    |
| `lib/reader/src/touch.ts`      | Swipe detection (page turns), tap (dictionary lookup), long-press drag select      |
| `lib/reader/src/mouse.ts`      | Click select, drag select, alt-click for context menu                              |
| `lib/reader/src/bridge.ts`     | `postMessage` listener: font size changes, scroll-to, highlight, content streaming |
| `lib/reader/src/index.ts`      | Initialization: setup content, attach handlers, apply initial scroll               |
| `lib/reader/src/reader.css`    | Vertical writing mode, ruby styling, highlight pseudo-element, page controls       |

### Content pipeline

#### Aozora parser (`lib/aozora-parser.ts`)

Converts Aozora Bunko markup to HTML:

- Ruby: `｜漢字《かんじ》` → `<ruby>漢字<rt>かんじ</rt></ruby>`
- Bouten (emphasis dots): `［＃「text」に傍点］` → `<em class="bouten">text</em>`
- Strips header/footer boilerplate, heading annotations, indent markers
- Halfwidth punctuation → fullwidth (for vertical text consistency)
- `hasAozoraMarkup()` detects format; `plainTextToHtml()` wraps plain text in `<p>` tags

#### Text model & slicing (`lib/reader-model.ts`)

Handles format-aware text measurement and slicing for streaming pagination:

- `parseBookContent()` → `TextModel` with total visible char count
- `visibleTextLength()` counts chars in HTML (skips tags, `<rt>` content, treats `&amp;` etc. as 1 char)
- `sliceContent()` extracts a chunk at a visible char offset with format-aware boundary snapping
- `calcCharsPerPage()` estimates viewport capacity from font size and furigana toggle
- `calcTotalPages()` derives total pages for the progress bar

#### HTML generation (`lib/reader-html.ts`)

`generateReaderHtml(content, options)` wraps content in a full HTML document:

- Injects CSS (theme colors, font size, line height)
- **Line height must ALWAYS be a whole number of pixels, set explicitly in px units.** Fractional or relative line heights (e.g. `1.5`) cause sub-pixel drift in `columnWidth`/`lineW` calculations, breaking page alignment. Non-furigana: `Math.round(fontSize * 1.5)px`. Furigana: `fontSize * 2px`. This invariant must hold in `reader-html.ts`, `[bookId].tsx` (both `reloadContent` and `setFontSize` messages), and the fallbacks in `pagination.ts`.
- Embeds content in `<div id="page">`
- Injects `window.__READER_CONFIG__` with scroll position, char offset, total chars, furigana state
- Appends the reader JS bundle

### Furigana system (`lib/reader-furigana.ts`)

Generates `<ruby>` annotations for kanji based on user's JLPT level settings. The pipeline:

1. **Build kanji set** — `buildFuriganaKanjiSet()` queries dictionary for kanji at enabled JLPT levels. Returns `{ all: true }` or a `Set<string>` of specific characters.

2. **Extract surfaces** — `extractSurfacesFromHtml()` scans visible text for kanji substrings (up to 10 chars). Also scans backward through preceding kana (up to 4 chars) to capture mixed kana-kanji words like しょう油, お寺, ご飯.

3. **Batch dictionary lookup** — `batchLookup()` runs a three-phase query:
   - Phase A: Find entry IDs by kanji table search
   - Phase B: Batch fetch kanji forms, kana readings, common flags
   - Phase C: Select best match per surface (prefer common entries, deinflect conjugated forms)

4. **Strip okurigana** — `stripOkurigana()` isolates the kanji portion from inflected words (e.g., 食べる → kanji=食, reading=た) so `<ruby>` wraps only the kanji.

5. **Apply to HTML** — `applyFuriganaToHtml()` is a single-pass state machine that:
   - Skips HTML tags, existing `<ruby>` blocks, `<rt>` content
   - Uses longest-first matching (しょう油 wins over 油 alone)
   - Respects paragraph boundaries (never matches across `</p><p>`)
   - Filters by kanji set (only annotates kanji at the user's selected JLPT levels, but if any kanji in a multi-kanji word matches, the whole word gets furigana)

#### Level filtering behavior

With partial JLPT levels enabled (e.g., only N3):

- A word like 反省会 (反=N5, 省=N3, 会=N5) gets furigana if **any** kanji in the word matches the filter
- The whole word gets a single `<ruby>` with the full reading, not individual kanji
- Words where **no** kanji matches the filter get no furigana

### Dictionary lookup in reader

#### Smart lookup (`lib/smart-lookup.ts`)

On tap in the reader:

1. `resolveCaretAt()` maps tap coordinates to a text node + offset (ruby-aware, skips `<rt>`)
2. Reader sends text window (context before/after tap point) to React Native via `postMessage`
3. `smartLookup()` finds the longest dictionary match from that position, using deinflection for conjugated verbs
4. `selectionLookup()` handles drag-selected text, expanding boundaries to find longer matches
5. `nameLookup()` searches the extended DB for proper nouns (when name mode is enabled)
6. Result displayed in `DictionaryPopup`; matched text highlighted in reader via bridge message

### Book storage

Books are stored in the user SQLite database:

```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'import',  -- 'aozora', 'syosetu', 'import'
  aozora_id INTEGER,
  source_id TEXT,
  raw_content TEXT,                        -- original text (Aozora markup or plain)
  html_content TEXT,                       -- cached parsed HTML (if pre-processed)
  scroll_position REAL NOT NULL DEFAULT 0, -- 0.0-1.0 percentage
  char_offset INTEGER NOT NULL DEFAULT 0,  -- absolute visible char index
  total_chars INTEGER NOT NULL DEFAULT 0,
  font_size INTEGER NOT NULL DEFAULT 22,   -- per-book font size (14-32)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_read_at TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);
```

Reading position is persisted as both a scroll percentage and an absolute char offset. On resume, `alignToTargetChar()` uses the char offset for pixel-accurate restoration regardless of viewport size changes.

### Reader settings (`stores/settings.ts`)

Persisted via Jotai atoms → AsyncStorage:

- **Furigana levels**: `readerFuriganaLevelsAtom` — toggles for N5, N4, N3, N2, N1, nonJouyou, all
- **Page animations**: `readerPageAnimationsAtom` — boolean for page turn transitions

Font size is per-book (stored in `books` table). Furigana levels and page animations are global.

### Book discovery

#### Aozora Bunko (`lib/aozora-api.ts`)

- Downloads CSV catalog ZIP (~20K public domain books), caches in memory
- `searchBooks()` — case-insensitive search on title/author
- `fetchBookContent()` — downloads XHTML, strips boilerplate, returns raw text

#### Syosetu (`lib/syosetu-api.ts`)

- `searchNovels()` — queries `api.syosetu.com` for web novels by title/author
- `fetchTableOfContents()` — paginated chapter list from `ncode.syosetu.com`
- `fetchChapterText()` — scrapes chapter text from novel HTML

#### File import

- Uses `DocumentPicker` (native) or file input (web) for `.txt` files
- Auto-detects UTF-8, falls back to Shift_JIS if garbled
- Saved as `raw_content` with `source: 'import'`

### Reader routing (`app/(tabs)/reader/`)

| Route             | Screen         | Purpose                                  |
| ----------------- | -------------- | ---------------------------------------- |
| `index`           | Library        | Book list with import/browse/delete      |
| `browse`          | Aozora search  | Search and download Aozora Bunko books   |
| `browse-syosetu`  | Syosetu search | Search and browse web novels             |
| `novel-syosetu`   | Chapter list   | Table of contents for a Syosetu novel    |
| `[bookId]`        | Reader         | Full-screen reading (headerShown: false) |
| `word/[id]`       | Word detail    | Dictionary entry from reader lookup      |
| `kanji/[literal]` | Kanji detail   | Kanji detail from reader lookup          |

### Platform split (`components/ReaderView.{native,web}.tsx`)

- **Native**: Wraps `react-native-webview` WebView
- **Web**: Creates sandboxed iframe, injects `ReactNativeWebView` shim so the same `postMessage` bridge works on both platforms
- Both expose `ReaderViewRef` with `postMessage()` for the parent `[bookId].tsx` screen to communicate with the reader JS

## Navigation

The app uses Expo Router with a **tab navigator** containing 4 tabs (Dictionary, Lists, Reader, Settings), each with its own **stack navigator**. This gives per-tab navigation history — switching tabs preserves each tab's position.

### Cross-tab navigation problem

Shared screens (kanji detail, word detail) exist under multiple tabs so that navigation stays within the current tab's stack. Without this, navigating from Lists to a kanji detail would switch to the Dictionary tab, and back would go to Dictionary root instead of the list.

### `useTabRouter()` — tab-aware navigation for shared screens

`lib/navigation.ts` exports `useTabRouter()` which provides `pushKanji(literal)` and `pushWord(id)` methods. These auto-detect the current tab and build the correct path (e.g., `/lists/kanji/X` when in the Lists tab).

**When adding a new shared screen:**

1. Create the route file under each tab that needs it (tiny wrapper rendering the shared component)
2. Register it in each tab's `_layout.tsx`
3. Add a method to `useTabRouter()` in `lib/navigation.ts`
4. Use that method instead of `router.push()` with a hardcoded path

Use `router.push()` directly only for intentional cross-tab navigation (e.g., radical search always goes to Dictionary).

### Back button handling

- **Lists and Reader tabs**: `SafeBackButton` is set as the default `headerLeft` in each tab's `_layout.tsx` via `screenOptions`. All non-index screens get a back button automatically — no per-screen code needed.
- **Dictionary tab**: Uses a fully custom `DictionaryHeader` component (search bar, mode toggle) which handles its own back button via `useSafeGoBack("/dictionary")`.
- **Fullscreen screens** (study, typing-game, connect-game, stats): Have `headerShown: false` and implement their own back button using `useSafeGoBack()` directly.

### Web navigation: back button and browser history

Expo Router syncs React Navigation state to browser history via `useLinking.js`. On web, this creates three problems:

1. **In-app back buttons cross tabs**: `router.back()` calls `window.history.go(-1)` which follows linear browser history. If the previous history entry was a tab switch, back escapes to a different tab.
2. **Browser back can exit the SPA**: If browser back goes past the initial history entry, the browser navigates away from the app entirely.
3. **Browser forward/back restores stale state**: Expo-router stores React Navigation state in each history entry. After in-app navigation changes the stack (especially `router.replace()`-based back), forward/back history entries contain stale state that no longer matches the current navigation tree, causing full page reloads.

#### How it's solved

**Popstate interceptor** (`app/_layout.tsx`): A capture-phase `popstate` listener intercepts ALL browser history navigation before expo-router can process it. This prevents expo-router from restoring stale React Navigation state from history entries. Instead, the handler calls `router.replace(url)` to cleanly navigate to the URL the browser moved to, giving a proper SPA transition. This single mechanism handles:

- Browser back/forward between routes (clean SPA navigation instead of stale state restoration)
- SPA exit guard (entries without expo-router state get a re-pushed guard entry)

**In-app back buttons** (`useSafeGoBack` in `lib/navigation.ts`): On web, never calls `router.back()`. Instead, reads the current stack's navigation state, computes the previous route's URL via `buildRoutePath()`, and calls `router.replace(path)`. Since REPLACE doesn't change stack depth, expo-router uses `history.replaceState()` (not `history.go(-1)`), so navigation stays within the current tab.

Trade-off: `router.replace()` swaps the top route instead of popping it, leaving a phantom duplicate in the stack (e.g., `[index, [id]]` → `[index, index]`). The phantom is invisible, gets cleaned up on the next forward push, and is detected by `SafeBackButton` which hides itself when back would be a no-op.

**Tap active tab to pop to root** (`app/(tabs)/_layout.tsx`): `screenListeners.tabPress` detects when the user taps the already-active tab and resets the child stack to index 0, providing a quick way to return to the tab root.

#### Rules for navigation on web

- **NEVER use `router.back()` on web** — always use `useSafeGoBack(fallback)` which handles the web case
- **NEVER use bare `router.back()`** in any component — always go through `useSafeGoBack`
- Use `router.push()` for forward navigation (pushes to both stack and browser history)
- Use `router.replace()` for redirects that shouldn't add history entries
- The `buildRoutePath()` helper in `lib/navigation.ts` converts a route's `name` + `params` into a URL path by substituting `[param]` segments and appending remaining params as query string
- Browser forward/back are handled by the popstate interceptor — they produce clean SPA navigations, not stale state restorations

### Key files

| File                              | Purpose                                                                   |
| --------------------------------- | ------------------------------------------------------------------------- |
| `lib/navigation.ts`               | `useSafeGoBack()`, `SafeBackButton`, `useTabRouter()`, `buildRoutePath()` |
| `app/_layout.tsx`                 | Popstate interceptor (browser back/forward + SPA exit guard)              |
| `app/(tabs)/_layout.tsx`          | Tabs config: `backBehavior="history"`, `freezeOnBlur`, tap-to-pop-root    |
| `app/(tabs)/lists/_layout.tsx`    | Lists stack with automatic `SafeBackButton`                               |
| `app/(tabs)/reader/_layout.tsx`   | Reader stack with automatic `SafeBackButton`                              |
| `components/DictionaryHeader.tsx` | Custom dictionary header with search + back button                        |

## Virtualized Lists (FlashList)

We use `@shopify/flash-list` for long scrollable lists (list detail screen, dictionary results). FlashList wraps RecyclerListView, which uses `useLayoutEffect` internally for cell measurement and viewport management. This creates a **critical pitfall on web** that must be understood.

### The layout effect feedback loop

FlashList's internal layout effects can trigger `onEndReached` during the React layout/commit phase (not just from user scrolling). If `onEndReached` calls a function that does `setState` (e.g., adding more items), FlashList re-renders and its layout effects fire again, creating a loop:

```
FlashList layout effect → onEndReached → loadMore → setItems
    → FlashList re-render → layout effect → onEndReached → ...
    → "Maximum update depth exceeded"
```

This is especially likely when:

- Restoring a large number of items from cache (hundreds at once)
- Programmatically scrolling to a deep offset (`scrollToOffset`)
- `estimatedItemSize` is missing or inaccurate (forces more dynamic measurement)

### Rules for FlashList on web

1. **Do NOT use `onEndReached` for pagination on web.** Instead, handle pagination in the `onScroll` handler by checking `distanceFromEnd` manually. Scroll events come from user interaction, not layout effects, breaking the feedback loop:

   ```tsx
   onEndReached={Platform.OS === "web" ? undefined : loadMore}
   onScroll={Platform.OS === "web" ? handleScroll : undefined}
   ```

2. **Always provide `estimatedItemSize`.** Measure your actual item height (inspect in devtools) and set it accurately. This reduces FlashList's dynamic measurement work.

3. **Never call `setState` (React or Zustand) inside a `setItems` updater.** Move side effects to a separate `useEffect` that runs after render, outside the layout phase.

4. **Use a ref for reentrancy guards**, not state. React batches state updates, so a `loadingMore` state variable can't prevent multiple `onEndReached` calls within the same render cycle:

   ```tsx
   const loadingMoreRef = useRef(false);
   // In loadMore:
   if (loadingMoreRef.current) return;
   loadingMoreRef.current = true;
   // ... async work ...
   loadingMoreRef.current = false;
   ```

5. **Cache mutations must avoid Zustand `set()`.** When updating scroll cache during scroll or inside state updaters, mutate the cached object directly instead of calling store actions that trigger `set()`.

### Web scroll position cache (`stores/lists.ts`)

On web, `router.replace()` unmounts the list screen on back navigation. To preserve scroll position, the list detail screen uses a write-through Zustand cache:

- **During usage:** `onScroll` writes `contentOffset.y` to cache (direct mutation). After each `setItems`, a `useEffect` syncs items to cache.
- **On remount:** `loadEntries()` checks cache first. If hit, hydrates items + refs from cache, skips DB query, and restores scroll position via `scrollToOffset`.
- **Staleness check:** Background query compares DB count to cached count; invalidates on mismatch.
- **In-memory only:** Lost on full page refresh (acceptable — user starts from top).

### Key files

| File                        | Purpose                                                   |
| --------------------------- | --------------------------------------------------------- |
| `app/(tabs)/lists/[id].tsx` | List detail with FlashList pagination + scroll cache      |
| `stores/lists.ts`           | `ListScrollCache` type + `scrollCache` map in lists store |

## Web Layout and Header System

On web, the app is capped at 960px content width (centered) with a full-bleed navbar backdrop behind the tab bar. This requires special handling for headers, layout dimensions, and screens that manage their own headers.

### How the web backdrop works

The tab bar renders at the top of the viewport via Expo Router's tab navigator. A CSS `::before` pseudo-element on `body.has-navbar` provides a full-width colored backdrop (137px tall) with a bottom border, so the gray/black bar extends edge-to-edge even though content is centered. The `has-navbar` class is toggled in `app/(tabs)/_layout.tsx` when the tab layout mounts/unmounts.

The backdrop colors are centralized in `lib/navigation.ts` as `WEB_BACKDROP_COLORS` (light: `rgb(242, 242, 242)`, dark: `rgb(1, 1, 1)`) and must match `global.css`.

### Three header categories

**1. Stack-managed headers** (most screens) — Expo Router's default `<Stack.Screen>` headers. On web, these get `headerStyle: { backgroundColor: "transparent" }` via `webHeaderStyle` from `lib/navigation.ts`, so the CSS backdrop shows through. No per-screen code needed.

**2. Custom React Nav header** (`DictionaryHeader`) — A custom header component passed to the stack navigator. Manages its own padding and backdrop color.

**3. `headerShown: false` screens** (study, typing-game, connect-game, reader) — These render their own header inline. They need explicit backdrop colors and top padding to align with the CSS backdrop. Use the `CustomHeaderScreen` system (see below).

### `CustomHeaderScreen` system (`components/CustomHeaderScreen.tsx`)

Reusable components for screens with `headerShown: false`:

| Export                    | Purpose                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useWebBackdrop(webTop?)` | Hook returning `{ webBgStyle, topPadding, insets, isDark }`. On web, computes backdrop background color and `paddingTop` (default `WEB_CUSTOM_HEADER_TOP = 7`). On native, uses safe area insets.                                            |
| `CustomHeaderScreen`      | `forwardRef` wrapper — applies `flex-1 bg-background` + backdrop styling. Accepts `webTop`, `style`, `className`, `onTouchStart`. Use this as the outermost container for `headerShown: false` screens.                                      |
| `HeaderPlaceholder`       | Renders an invisible spacer matching the real header height, with backdrop color and bottom border on web. Used during loading/shell states so the screen doesn't flash headerless. Props: `py` (`"py-2"` or `"py-3"`), `spacerHeight` (px). |
| `NavigatingOverlay`       | Full-screen overlay with `HeaderPlaceholder` + centered spinner. Shown when navigating away (exit animation). Props: `visible`, `py`, `spacerHeight`, `webTop`.                                                                              |

**Header height conventions:**

- Games (typing, connect): `py-3` + 32px spacer (matches `py-3` + 24px icon + `p-1` padding)
- Study/flashcards: `py-2` + 40px spacer (matches `py-2` + larger header content)
- Reader: uses `webTop={15}` (unique larger spacing)

**Adding a new `headerShown: false` screen:**

```tsx
import {
  CustomHeaderScreen,
  NavigatingOverlay,
  useWebBackdrop,
} from "@/components/CustomHeaderScreen";

export default function MyScreen() {
  const { webBgStyle } = useWebBackdrop();
  const [navigating, setNavigating] = useState(false);

  return (
    <CustomHeaderScreen>
      {/* Your header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border" style={webBgStyle}>
        {/* header content */}
      </View>
      {/* Screen content */}
      {/* ... */}
      <NavigatingOverlay visible={navigating} />
    </CustomHeaderScreen>
  );
}
```

### Container width (`lib/use-container-width.ts`)

`useContainerWidth()` returns `Math.min(windowWidth, 960)` on web, raw `windowWidth` on native. Use this instead of `useWindowDimensions().width` for layout calculations (card sizes, game field dimensions, etc.) so elements don't overflow the centered content area on wide screens.

### Modal width

All modal dialogs (`FlashcardSettingsModal`, `StudyStatisticsModal`, `ExportListModal`, `GamesModal`) cap their content width on web:

```tsx
style={Platform.OS === "web" ? { maxWidth: 500, width: "100%", alignSelf: "center" } : undefined}
```

### Key files

| File                                | Purpose                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `global.css`                        | `body.has-navbar::before` backdrop, dark mode variant                            |
| `lib/navigation.ts`                 | `WEB_CUSTOM_HEADER_TOP`, `WEB_BACKDROP_COLORS`, `webHeaderStyle`                 |
| `components/CustomHeaderScreen.tsx` | `useWebBackdrop`, `CustomHeaderScreen`, `HeaderPlaceholder`, `NavigatingOverlay` |
| `lib/use-container-width.ts`        | `useContainerWidth()` — capped width hook                                        |

## Cloud Sync

The app syncs user data (lists, flashcards, books, review history, kanji notes) across devices using Clerk for authentication and Turso (hosted SQLite) for remote storage. The system is offline-first — everything works locally, and sync happens in the background when connectivity is available.

### Architecture overview

```
User signs up (Clerk)
  → Clerk fires user.created webhook
  → Vercel serverless function (api/provision-db.ts)
  → Turso REST API creates per-user database
  → Client connects via libsql to [hash]-[org].turso.io
  → Sync engine pushes/pulls changes bidirectionally
```

The local SQLite database is the source of truth. The remote Turso database is a mirror used for cross-device sync. If sync is disabled or offline, the app functions identically — just without cloud backup.

### Authentication (`lib/auth.tsx`)

Uses Clerk (`@clerk/clerk-expo`) for email + password auth with optional email verification / MFA. If `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is not set, the app runs in local-only mode with `userId: "local"` — no sign-in screens, no sync.

Auth screens live at `app/sign-in.tsx` and `app/sign-up.tsx`. The root layout (`app/_layout.tsx`) gates tab access behind auth state.

**Always use `useAuth()` and `useUser()` from `@/lib/auth`** — never import directly from `@clerk/clerk-expo`. The wrappers handle local mode (no Clerk key) by returning safe defaults (`userId: "local"`, `user: null`) and avoid crashes when Clerk hooks are called outside `<ClerkProvider>` or when the user is not signed in.

### Database provisioning (`api/provision-db.ts`)

A Vercel serverless function handles Clerk's `user.created` webhook:

1. Verifies Svix signature (HMAC-SHA256) using `CLERK_WEBHOOK_SECRET`
2. Hashes the Clerk `userId` to a short alphanumeric string (base36)
3. Creates a Turso child database via `POST /v1/organizations/{org}/databases`
4. Returns 200 with `existing: true` if the DB already exists (409 from Turso = idempotent)

The same `hashUserId()` function is duplicated in `db/turso-client.ts` (client-side) so the app can derive its database URL without a server round-trip.

**Server-side env vars** (set in Vercel dashboard):

| Variable               | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `TURSO_API_TOKEN`      | Turso platform API token (from `turso auth api-tokens mint`)          |
| `TURSO_ORG`            | Turso organization slug                                               |
| `TURSO_GROUP`          | Database group name (cluster)                                         |
| `CLERK_SECRET_KEY`     | Clerk secret key (for verifying session JWTs in `api/turso-token.ts`) |
| `CLERK_WEBHOOK_SECRET` | Webhook signing secret from Clerk dashboard                           |

### Turso client (`db/turso-client.ts`)

`createTursoClient(userId)` builds a `@libsql/client/web` client pointing to `libsql://[hash]-[org].turso.io`. `isSyncEnabled()` returns false if env vars are missing or in dev mode without `EXPO_PUBLIC_DEV_SYNC=1`.

**Client-side env vars**:

| Variable                            | Purpose                                                     |
| ----------------------------------- | ----------------------------------------------------------- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public key (presence enables cloud mode)              |
| `EXPO_PUBLIC_TURSO_ORG`             | Turso organization slug                                     |
| `EXPO_PUBLIC_API_BASE_URL`          | API base URL for token minting (e.g. `https://jiten.tokyo`) |
| `EXPO_PUBLIC_DEV_SYNC`              | Set to `1` to enable sync in dev mode (disabled by default) |

### Sync engine (`db/sync-engine.ts`)

The `sync()` function runs a full bidirectional sync cycle:

1. **Ensure remote schema** — applies pending user DB migrations to the remote Turso database (tracked via `remote_schema_version` in `sync_meta`)
2. **Cache column metadata** — fetches `PRAGMA table_info()` for all tables, caches in `sync_meta.columns_cache` to avoid repeated discovery
3. **Version check** — compares remote `push_version` counter against `last_seen_push_version`. If unchanged and no schema change, skips pull entirely
4. **Pull (remote → local)** — fetches rows where `updated_at > last_sync_at`, applies using conflict resolution strategy per table type. LWW lookups are chunked (500 PKs per query) to stay within SQLite's parameter limit. Each table's inserts are wrapped in a transaction for performance.
5. **Push (local → remote)** — sends local changes since `last_sync_at` in 500-statement batches to avoid timeouts
6. **Blob column sync** — syncs large content columns (e.g. `books.raw_content`) separately. Pushes content once when remote is missing it; pulls when local is missing. Runs after the regular push so metadata rows exist on remote before content is attached.
7. **Save state** — updates `last_sync_at`, increments remote `push_version` if rows were pushed

#### Conflict resolution

**Mutable tables** (lists, list_entries, srs_cards, books, user_kanji_notes, confusion_pairs): Last-Write-Wins (LWW) based on `updated_at` timestamp. Both pull and push use `INSERT ... ON CONFLICT DO UPDATE SET` — this avoids DELETE+INSERT cycles that break FK cascades and preserves local-only columns (like `raw_content`) that aren't part of the regular sync.

**Append-only tables** (review_logs, practice_events, practice_sessions, confusion_events, game_scores): `INSERT OR IGNORE` in both directions. Primary key ensures idempotency — no conflicts possible.

#### Soft deletes

Mutable tables use `deleted_at IS NOT NULL` to mark deletions. The `deleted_at` timestamp syncs via the normal `updated_at` LWW mechanism. Queries throughout the app filter with `WHERE deleted_at IS NULL`.

#### Push filters

Default/seeded data is excluded from push to prevent overwriting other devices' seeds:

- `lists`: `is_default = 0` — default kanji/vocab lists are seeded locally
- `list_entries`: `list_id NOT LIKE 'default-%'` — entries in default lists excluded

Note: `books` has no push filter — all books (including default) sync metadata/progress. Content is handled separately via blob sync.

#### Column exclusions

`excludeCols` removes columns from the regular delta sync. These columns are never included in push/pull queries:

- `books.html_content` — generated HTML, re-created locally
- `books.raw_content` — large text content, synced via blob columns instead

#### Blob columns (`blobCols`)

Large columns that should sync once (not on every delta cycle) are configured as `blobCols` on table entries in `MUTABLE_TABLES`. Unlike regular columns, blob columns are synced by presence — pushed when remote is missing the value, pulled when local is missing it.

```ts
// Example: sync raw_content only for non-default books
{
  name: "books",
  blobCols: { cols: ["raw_content"], filter: "is_default = 0" },
}
```

This keeps progress updates lightweight (no megabytes re-pushed) while ensuring imported book content is available on all devices. The `filter` option restricts which rows participate — default books have content seeded locally so they don't need blob sync.

**Important for new INSERT/UPDATE statements:** Any INSERT into a synced table must set `updated_at` (or the table's `timestampCol`). If `updated_at` is NULL, the row will never sync (`NULL > timestamp` is always false in SQL). Similarly, any UPDATE that modifies synced columns must also update `updated_at`, or the change won't propagate to other devices.

#### Network error detection

`isNetworkError(err)` classifies fetch failures (CORS, DNS, connectivity) separately from application errors (auth, schema). Network errors trigger silent retry; application errors show an error banner.

### Sync provider (`db/sync-provider.tsx`)

Orchestrates when and how sync runs. Exposes `useSync()` hook with:

- `syncStatus` — `"disabled" | "idle" | "syncing" | "error"`
- `triggerSync(opts?)` — accepts `{ force?: boolean, silent?: boolean }` or legacy `boolean`
- `markDirty()` — marks data as changed, persists `sync_dirty` flag to `sync_meta`
- `isSilentSync` — true when the current sync should not show progress UI

#### Sync trigger rules

The sync system follows these rules exactly:

1. **Dirty flag** — `markDirty()` persists `sync_dirty=1` to `sync_meta` (survives app kills). On app background/unmount, if dirty, a silent sync is attempted. If it fails (e.g. not enough time), the flag persists and triggers a visible sync on next app load.
2. **Sync loop** — A single `setInterval` at `SYNC_INTERVAL_MS` (30s). Each tick increments a counter. If dirty, syncs silently. Every `FORCE_SYNC_EVERY_N` ticks (10 = 5 min), syncs unconditionally (catches remote-only changes). Both constants are factored out at the top of the file.
3. **Visible sync triggers** — Importing, creating, or deleting lists/books calls `triggerSync()` for immediate visible sync.
4. **markDirty actions** — Adding/removing a word from a list, changing ebook page (scroll), finishing a game, rating an SRS card, saving kanji notes, changing flashcard settings, clearing SRS statistics, renaming a list.
5. **Foreground handler** — On app return to foreground: if dirty OR elapsed since last sync >= `SYNC_INTERVAL_MS`, visible sync. Otherwise skip.
6. **Background handler** — On app going to background: if dirty, attempt silent sync (fire-and-forget).
7. **Any sync clears dirty** — After any successful sync (loop, explicit, foreground), `dirtyRef` and persisted `sync_dirty` are cleared.
8. **Any sync resets loop timer** — `resetInterval()` restarts the loop countdown and resets the tick counter.
9. **App load** — Init effect checks persisted `sync_dirty` flag (→ forced visible sync) and `last_sync_at` elapsed time (→ visible sync if > `SYNC_INTERVAL_MS`).
10. **Size-1 queue** — If a sync is in progress, exactly one more can be queued. `force` is sticky-true, `silent` is sticky-false. Queue drains in `finally`.

#### What calls what

| Action                            | Function                        | Visible?      |
| --------------------------------- | ------------------------------- | ------------- |
| Import/create/delete list or book | `triggerSync()`                 | Yes           |
| Add/remove word from list         | `markDirty()`                   | No (deferred) |
| Change ebook page / scroll        | `markDirty()`                   | No (deferred) |
| Finish a game                     | `markDirty()`                   | No (deferred) |
| Rate SRS card                     | `markDirty()`                   | No (deferred) |
| Save kanji note                   | `markDirty()`                   | No (deferred) |
| Change flashcard settings         | `markDirty()`                   | No (deferred) |
| Clear SRS statistics              | `markDirty()`                   | No (deferred) |
| Rename list                       | `markDirty()`                   | No (deferred) |
| Manual sync (settings)            | `triggerSync(true)`             | Yes           |
| Delete data modal                 | `triggerSync(true)`             | Yes           |
| Hard sync                         | `triggerSync(true)`             | Yes           |
| Loop tick (dirty)                 | `triggerSync({ silent: true })` | No            |
| Loop tick (force, every Nth)      | `triggerSync({ silent: true })` | No            |
| Return to foreground              | `triggerSync()`                 | Yes           |
| Go to background (dirty)          | `triggerSync({ silent: true })` | No            |

#### Writes that don't need sync

- `review_marks` — intentionally local (temp session UI flags)
- `seed-default-lists.ts` — deterministic seeding, excluded from push by filters (`is_default`, `list_id NOT LIKE 'default-%'`)
- `app_flags` — local seeding state
- `last_confusion_check` — local optimization flag

#### Silent sync

Loop and background syncs pass `silent: true` to suppress the progress banner. Foreground return, imports, deletes, and manual syncs show the progress UI. Errors always show regardless of the silent flag.

#### Sync queue

A length-1 queue handles overlapping sync requests. If a sync is in progress when a new request arrives:

- The request is queued (not dropped)
- `force` is sticky-true: if either the queued or new request is forced, the dequeued sync is forced
- `silent` is sticky-false: if either request is non-silent, the dequeued sync shows UI

The queue drains in the `finally` block after the current sync completes.

#### Offline resilience

Network errors set an `isOfflineRef` flag. While offline:

- Loop and background syncs skip silently (no error banner)
- Forced syncs still attempt (gives one shot)
- Foreground return clears the flag and retries

No external dependencies (NetInfo, exponential backoff) — offline detection is purely based on failed fetch errors, and the 30s loop + dirty flag provides natural retry.

#### Account change detection

On mount, compares current `userId` against `lastUser` stored in AsyncStorage:

| Scenario                     | Action                                |
| ---------------------------- | ------------------------------------- |
| Same user                    | Proceed to sync                       |
| First sign-in, no local data | Save user, proceed                    |
| First sign-in, has user data | Prompt: use cloud / use local / merge |
| Different user               | Prompt: wipe local data or sign out   |

The "merge" option proceeds with normal LWW + append sync — local and remote data coexist, with conflicts resolved by timestamp. `hasLocalData()` excludes default/seeded lists and books so they don't falsely trigger the prompt.

### Sync metadata (`sync_meta` table)

| Key                      | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| `last_sync_at`           | ISO timestamp of last successful sync           |
| `last_seen_push_version` | Remote version counter (skip pull if unchanged) |
| `remote_schema_version`  | Last applied remote migration version           |
| `columns_cache`          | Cached `PRAGMA table_info` results (JSON)       |
| `sync_dirty`             | `"1"` if unsaved changes exist since last sync  |

### Background downloads and sync ordering

Background downloads (audio DB, extended DB) are deferred until the first sync attempt completes. This ensures sync data is available before large downloads begin. Managed via `triggerBackgroundDownloads()` in the database provider, gated on `syncStatus` transitioning to `idle` or `error` with a non-null `lastSyncAt` or `lastError`.

### Sync UI (`components/BackgroundDownloadBanner.tsx`)

A slim progress bar + label displayed above the tab bar (native) or below the navbar (web):

- **Syncing**: blue progress bar with phase labels ("Syncing — Uploading lists...")
- **Background download**: progress bar with download label and percentage
- **Sync error**: red bar, auto-dismisses after 15 seconds
- **Session expired**: blue "Signed out — Sign in to sync" banner, auto-dismisses after 30 seconds
- **Silent sync**: progress bar hidden entirely (timer-based syncs)

Progress animates smoothly — moves 1% per 30ms tick toward the target, with snap-ahead logic if the target jumps more than 30%.

### Sync data reactivity

After sync pulls remote data, the UI needs to reflect the changes. Three patterns are used, each for different situations:

#### 1. Zustand store reload (`reloadStores()`)

**When to use:** For data shown on multiple screens simultaneously (bookmarks, list index).

After any successful pull, `sync-provider.tsx` awaits `reloadStores(userDb)` which reloads all registered Zustand stores in parallel via `Promise.all`. Components subscribed to those stores re-render automatically. `reloadStores` is also awaited after reconciliation, first-sync choice, and hard sync.

Current stores with `.load()`:

- `useBookmarkStore` — bookmark icons across all screens
- `useListsStore` — list index (names, entry counts, SRS progress)

**To add a new store:** Add a `.load(userDb)` method to the store, then add the call to `reloadStores()` in `sync-provider.tsx`.

#### 2. `lastSyncAt` dependency (`useSync().lastSyncAt`)

**When to use:** For screens that load data into local `useState` via `useEffect`. Adding `lastSyncAt` to the effect's dependency array triggers a reload when sync completes.

```ts
const { lastSyncAt } = useSync();
useEffect(() => {
  loadData();
}, [userDb, lastSyncAt]);
```

Screens using this pattern:

- `lists/[id].tsx` — list detail (entries + SRS counts)
- `lists/stats.tsx` — review statistics
- `lists/marked-for-review.tsx` — marked entries
- `reader/index.tsx` — book library
- `DueCardsSection.tsx` — SRS due card counts

#### 3. Load-on-open (no sync watcher needed)

**When to use:** For screens/components that always load fresh data when opened.

- `BookmarkPopover` — reloads every time the popover opens
- `lists/study.tsx` — loads cards fresh per study session
- Game screens — load word sets fresh per game session

#### When to use which

| Scenario                                               | Pattern                      |
| ------------------------------------------------------ | ---------------------------- |
| Data shown across many screens (bookmarks, list names) | Zustand store with `.load()` |
| Screen with local `useState` + `useEffect`             | Add `lastSyncAt` to deps     |
| Modal/popover that loads fresh on every open           | No sync watcher needed       |
| Session screen (study, games) that loads once          | No sync watcher needed       |

### Hard Sync (`components/HardSyncModal.tsx`)

Available in Settings > Data when signed in. Wipes all local user data (`resetLocalUserData()` — clears all tables, `sync_meta`, and `app_flags`), reloads in-memory stores, then forces a full sync pull from Turso. Since `app_flags` are cleared, default lists and books are re-seeded on next mount.

### Data deletion (`components/DeleteDataModal.tsx`)

Users can selectively delete data by category from Settings:

| Category   | Mutable tables      | Append tables                      |
| ---------- | ------------------- | ---------------------------------- |
| Lists      | lists, list_entries | —                                  |
| Flashcards | srs_cards           | review_logs                        |
| Books      | books               | —                                  |
| Notes      | user_kanji_notes    | —                                  |
| Practice   | —                   | practice_events, practice_sessions |
| Games      | —                   | game_scores                        |
| Confusion  | confusion_pairs     | confusion_events                   |

Mutable tables are soft-deleted (syncs to remote). Append tables are hard-deleted locally. A sync runs after deletion to propagate changes.

### Key files

| File                                      | Purpose                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `lib/auth.tsx`                            | Clerk auth provider, local mode fallback, `useAuth()` hook                  |
| `db/turso-client.ts`                      | Turso client factory, `isSyncEnabled()`                                     |
| `db/sync-engine.ts`                       | Core push/pull logic, LWW resolution, schema migrations, `isNetworkError()` |
| `db/sync-provider.tsx`                    | Sync orchestration, triggers, queue, dirty flag, offline detection          |
| `db/sync-helpers.ts`                      | `softDelete()`, `resetLocalUserData()`, push filters, data categories       |
| `api/provision-db.ts`                     | Vercel webhook: Clerk `user.created` → Turso DB creation                    |
| `components/BackgroundDownloadBanner.tsx` | Sync/download progress UI                                                   |
| `components/DeleteDataModal.tsx`          | Selective data deletion with category toggles                               |
| `components/HardSyncModal.tsx`            | Full wipe + re-pull from cloud                                              |
| `app/sign-in.tsx`                         | Email + password sign-in with MFA support                                   |
| `app/sign-up.tsx`                         | Email + password sign-up with email verification                            |

## Dev Server

For web development, run the dev server alongside Expo:

```bash
yarn serve:dev   # Start dev server on localhost:3001
yarn web         # Start Expo web dev server (separate terminal)
```

The dev server (`scripts/serve-dev.ts`) provides two services on port 3001:

1. **Dictionary file server** — serves `assets/dictionary.db`, `dict-manifest.json`, etc. with CORS headers. The `.env` file points `EXPO_PUBLIC_DICT_MANIFEST_URL` to `http://localhost:3001/dict-manifest.json`.

2. **API proxy** — proxies external APIs to avoid CORS issues on web. Same routes as the Vercel rewrites in `vercel.json`:

| Dev URL                              | Proxied to                    |
| ------------------------------------ | ----------------------------- |
| `localhost:3001/proxy/aozora/*`      | `https://www.aozora.gr.jp/*`  |
| `localhost:3001/proxy/syosetu-api/*` | `https://api.syosetu.com/*`   |
| `localhost:3001/proxy/syosetu/*`     | `https://ncode.syosetu.com/*` |

In dev mode (`__DEV__`), `lib/proxy.ts` automatically routes proxy URLs to `localhost:3001`. In production, it uses relative paths handled by Vercel rewrites.

Native (iOS/Android) doesn't need the proxy — it calls external APIs directly.

## Scripts

### Dictionary Database

```bash
yarn migrate:dict  # Apply incremental dictionary migrations (the normal workflow)
yarn publish:dict  # Upload dictionary assets to GitHub release
```

The dictionary lives in `assets/` as four files:

- `dictionary.db` — core dictionary (~185MB): entries, kanji, kana, senses, pitch accents, FTS index
- `dictionary-audio.db` — word audio (~190MB): MP3 BLOBs for pronunciation
- `dictionary-extended.db` — extended data (~110MB): synonyms (WordNet), names (JMnedict) with FTS5
- `dict-manifest.json` — version and file sizes for the download client

#### Two-tier versioning

The dictionary uses two version constants in `db/dict-version.ts`:

- **`DICT_BASE_VERSION`** — the version of the published `dictionary.db` on GitHub. Bump this only when a full re-download is required (large schema changes, new tables with blob data, FTS rebuilds).
- **`DICT_VERSION`** — the effective version after client-side migrations. Bump this ahead of `DICT_BASE_VERSION` for lightweight changes that can be applied on-device without re-downloading.

Client devices compare their local version against both constants:

| Local version                               | Action                                       |
| ------------------------------------------- | -------------------------------------------- |
| `== DICT_VERSION`                           | Ready, no action needed                      |
| `>= DICT_BASE_VERSION` but `< DICT_VERSION` | Run client-side SQL migrations (no download) |
| `< DICT_BASE_VERSION` or missing            | Full re-download from GitHub                 |

```bash
yarn check:dict   # Compare local vs published dict version
```

The pre-commit hook and `yarn update` (OTA) both block if `DICT_BASE_VERSION` is ahead of published — preventing deploys that would break devices.

#### Updating the dictionary

There are two types of dictionary updates:

**Minor update (client-side migration)** — for ADD COLUMN, small data updates, new indexes:

1. Create a build-time migration: `scripts/dict-migrations/NNN-description.ts`
2. Run `yarn migrate:dict` to apply it to your local `assets/dictionary.db`
3. Add a matching client migration in `db/dict-client-migrations.ts` with the SQL statements that will run on user devices
4. Bump `DICT_VERSION` in `db/dict-version.ts` (leave `DICT_BASE_VERSION` unchanged)
5. Deploy via OTA (`yarn update`) — devices apply the migration in-place, no download needed

**Major update (full re-download)** — for new tables with large data, FTS rebuilds, audio changes:

1. Create a build-time migration and run `yarn migrate:dict`
2. Bump both `DICT_VERSION` and `DICT_BASE_VERSION` in `db/dict-version.ts`
3. Run `yarn publish:dict` to upload to GitHub
4. Deploy via OTA — devices re-download the full dictionary

#### Client-side migrations

Client migrations live in `db/dict-client-migrations.ts` as an array of `{ version, description, sql[] }` objects. They run on-device after the app opens the dict DB, bridging the gap from `DICT_BASE_VERSION` to `DICT_VERSION`.

Guidelines for client migrations:

- Keep SQL simple: `ALTER TABLE`, `CREATE INDEX`, `UPDATE` with embedded data, small `INSERT` batches
- Embed data directly as SQL VALUES for small datasets (<10KB)
- Each migration runs in a transaction — if it fails, it rolls back and stops
- On web, the migrated DB is serialized back to IndexedDB automatically
- Test with `yarn test` (migration runner has dedicated vitest coverage)

#### jiten-data public repo

The [jiten-data](https://github.com/TraderSamwise/jiten-data) repo hosts published assets:

- **Dictionary releases** — `dictionary.db`, `dictionary-audio.db`, `dictionary-extended.db` published via GitHub Releases. Devices download from here.
- **[jlpt-words.csv](https://github.com/TraderSamwise/jiten-data/blob/main/jlpt-words.csv)** — frequency-based JLPT word classifications for all 22,575 common JMdict entries. Generated by `yarn build:jlpt` (see `data/README.md` for methodology). Open-source drop-in replacement for Jonathan Waller's JLPT word lists. Canonical copy lives in `data/jlpt-words.csv` in this repo; manually sync to jiten-data when updated.

#### Publishing dictionary updates

After a major update, upload to the [jiten-data](https://github.com/TraderSamwise/jiten-data) GitHub release (requires `gh` CLI):

```bash
yarn publish:dict
```

The app downloads core first (blocking), then audio and extended data silently in the background (WiFi only on mobile). Not needed for minor updates (client migrations handle those via OTA).

#### Building extended data

```bash
yarn build:extended  # Build dictionary-extended.db from WordNet + JMnedict
```

This generates `assets/dictionary-extended.db` containing synonyms and names. Run `yarn publish:dict` afterward to upload. The extended DB is a pre-built SQLite file — the app downloads and opens it directly with no client-side processing.

#### Full rebuild from scratch (almost never needed)

```bash
yarn build:db
```

> **WARNING**: This deletes the entire dictionary and regenerates everything from scratch, including TTS audio via Google Cloud API which costs real money (`GOOGLE_TTS_API_KEY` env var required). It takes 5-10+ minutes and should not be run without explicit instruction.
>
> You almost certainly want `yarn migrate:dict` instead. Only use `build:db` if the database is corrupted beyond repair or you need to regenerate from an entirely new JMDict release. The script will prompt for confirmation (bypass with `--force`).

### Midori Import

Migrate bookmarks and SRS progress from [Midori](https://apps.apple.com/app/midori-japanese-dictionary/id385231773) into jiten. Midori must be installed on the same Mac — the script reads its local SQLite database directly.

```bash
# Export all Midori folders
npx tsx scripts/midori-import.ts --output /tmp/midori-export

# Export a specific folder (1-4)
npx tsx scripts/midori-import.ts --folder 1 --output /tmp/midori-export

# With dictionary ID verification
npx tsx scripts/midori-import.ts --output /tmp/midori-export --verify
```

This produces `.jiten` files that can be imported via the "Import" button on the Lists screen. SRS progress is preserved — set the list to "Simple SRS" mode to continue studying with the same algorithm.

#### Importing .jiten files on iOS Simulator

The simulator can't open `file://` URLs from the Mac filesystem. To make a `.jiten` file appear in the Files app under "On My iPhone":

```bash
# Find the simulator's local file storage
DEVICE_ID=$(xcrun simctl list devices booted -j | python3 -c "import sys,json; print(list(d['udid'] for devs in json.loads(sys.stdin.read())['devices'].values() for d in devs if d['state']=='Booted')[0])")

# Find the LocalStorage File Provider path
LOCAL_STORAGE=$(find "/Users/$(whoami)/Library/Developer/CoreSimulator/Devices/$DEVICE_ID/data/Containers/Shared/AppGroup" -maxdepth 2 -name "File Provider Storage" -path "*LocalStorage*" 2>/dev/null | head -1)

# If the above doesn't find it, search by metadata instead:
# for dir in ~/Library/Developer/CoreSimulator/Devices/$DEVICE_ID/data/Containers/Shared/AppGroup/*/; do
#   id=$(defaults read "$dir/.com.apple.mobile_container_manager.metadata.plist" MCMMetadataIdentifier 2>/dev/null)
#   [ "$id" = "group.com.apple.FileProvider.LocalStorage" ] && LOCAL_STORAGE="$dir/File Provider Storage" && break
# done

# Copy the file
cp /path/to/file.jiten "$LOCAL_STORAGE/"
```

You may need to kill and reopen the Files app on the simulator for the file to appear.

