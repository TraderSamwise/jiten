# Jiten — Architecture &amp; Internals

> This is the deep-dive engineering reference for Jiten's internals. For a project
> overview, quick start, and contribution guide see the root [README](../README.md).
> For third-party data/asset attribution see [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).

Japanese ebook reader and dictionary app. Built with Expo (React Native) targeting iOS, Android, and web.

## Development

```bash
yarn              # install dependencies
cp .env.example .env
yarn web          # start web dev server
yarn ios          # build/install/open iOS simulator dev build
yarn android      # build/install/open Android emulator dev build
yarn test         # run tests
yarn lint         # check for lint errors
yarn lint:fix     # auto-fix lint errors
yarn format       # format all files with prettier
```

`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is optional for local development. When it
is blank, the app runs without Clerk-backed auth.

### Release Environment Safety

Release and OTA commands run `scripts/check-release-env.js` before bundling.
Release bundles require `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`; local override files
such as `.env.local` must not clear or replace release-required keys. If local
development needs auth disabled, keep that override local-only and verify
`yarn check:env` passes before `yarn update` or `yarn build`.

For an already-installed native dev build, start Metro directly:

```bash
yarn start --dev-client --port 8081 --clear
```

Only one Expo/Metro process can own port `8081`. If the simulator loads another
app's JavaScript bundle, stop that other Expo process and restart Jiten Metro.

### iOS Signing

Jiten has a native `ios/` directory and a share extension, so EAS uses bundle
IDs and capabilities from the Xcode project, not only from `app.config.js`.
When changing the iOS bundle ID or App Group:

- update the main app and share extension bundle IDs in native iOS project files
- keep both entitlements files on the same App Group
- ensure both Xcode targets have the App Groups capability enabled
- delete and regenerate the share extension provisioning profile after the App
  Group is linked, otherwise EAS can reuse a stale profile that does not support
  the group

Current personal-account identifiers:

- app: `tokyo.jiten.mobile`
- share extension: `tokyo.jiten.mobile.ShareExtension`
- app group: `group.tokyo.jiten.mobile`

## Monorepo Packages

The Expo app remains at the repository root. Reusable reader code lives in Yarn workspace packages:

| Package                                    | Path                            | Purpose                                                                 |
| ------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------- |
| `@tradersamwise/jiten-reader-webview`      | `packages/reader-webview`       | Vanilla TypeScript WebView pagination, selection, highlight, and bridge |
| `@tradersamwise/jiten-reader-core`         | `packages/japanese-reader-core` | Reader HTML, text slicing, progress, toolbar, and reading helpers       |
| `@tradersamwise/jiten-reader-react-native` | `packages/japanese-reader`      | Jiten-compatible reader controller, lookup, furigana, and ReaderView    |

Packages must not import app stores, Expo Router screens, or concrete app
database modules. The high-level reader package owns a SQL-shaped
Jiten-compatible adapter contract; hosts provide the actual SQLite/dictionary
implementations and dictionary data.

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
  → packages/japanese-reader-core/src/aozora-parser.ts (parse markup to HTML)
  → reader-furigana.ts (inject <ruby> tags based on JLPT level settings)
  → reader-model.ts (slice into streamable chunks by visible char count)
  → reader-html.ts (wrap in full HTML document with CSS + JS)
  → ReaderView.{native,web}.tsx (render in WebView/iframe)
  → packages/reader-webview/src/*.ts (pagination, gestures, highlight, dictionary lookup bridge)
```

### Pagination engine (`packages/reader-webview/src/`)

The reader uses **column-based vertical pagination** in a WebView:

1. Content is placed in a `vertical-rl` (right-to-left) writing-mode container
2. `paginate()` measures `scrollWidth` and divides by column width to get total pages
3. Navigation sets `scrollLeft` to show the target page (columns flow right-to-left)
4. `alignToTargetChar()` snaps the scroll position to show a specific character in the rightmost visible column — used to preserve reading position across font size changes and content reloads
5. Streaming prefetch: `replaceOffscreenContent()` swaps in next-slice HTML into the right (offscreen) side; `prependBackSlice()` prepends content for backward navigation

No virtual DOM or framework — vanilla TypeScript compiled to a single JS bundle embedded in the HTML.

#### Key modules

| File                                        | Purpose                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/reader-webview/src/pagination.ts` | Page measurement, navigation, scroll alignment, streaming content swap             |
| `packages/reader-webview/src/state.ts`      | Global state: current page, column width, char offsets, DOM refs                   |
| `packages/reader-webview/src/highlight.ts`  | CSS Highlight API (with Safari `.highlight` class fallback) for word selection     |
| `packages/reader-webview/src/text.ts`       | Tree walker for visible text (skips `<rt>`), caret resolution from tap position    |
| `packages/reader-webview/src/touch.ts`      | Swipe detection (page turns), tap (dictionary lookup), long-press drag select      |
| `packages/reader-webview/src/mouse.ts`      | Click select, drag select, alt-click for context menu                              |
| `packages/reader-webview/src/bridge.ts`     | `postMessage` listener: font size changes, scroll-to, highlight, content streaming |
| `packages/reader-webview/src/index.ts`      | Initialization: setup content, attach handlers, apply initial scroll               |
| `packages/reader-webview/reader.css`        | Vertical writing mode, ruby styling, highlight pseudo-element, page controls       |

### Content pipeline

#### Aozora parser (`packages/japanese-reader-core/src/aozora-parser.ts`)

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

#### Slice-local post-processing invariant

All optional reader post-processing after base content/slice generation must be **slice-local**.

Required:

- operate on the current slice HTML/text only
- cache by slice identity (`startChar`, `charCount`, format) plus relevant setting keys
- cost must scale with visible slice size, not total book size or total user data size

Allowed global work:

- book parse/model creation
- source-furigana / format detection
- static theme/config setup

Forbidden patterns:

- precomputing a global reader transform dataset from the entire bookmark library
- work on toggle/reload that scales with total bookmarks, total dictionary entries, total lists, or full book length
- full-book DOM scans in the WebView for optional transforms

If toggling a reader option can trigger work proportional to total bookmarks, total library size, or total book size, the implementation is wrong.

### Furigana system (`lib/reader-furigana.ts`)

Generates `<ruby>` annotations for kanji based on user's JLPT level settings. The pipeline:

1. **Build kanji set** — `buildFuriganaKanjiSet()` queries dictionary for kanji at enabled JLPT levels. Returns `{ all: true, chars }` or `{ all: false, chars, enabledLevels }` where `enabledLevels` is a `Set<number>` of which JLPT levels are toggled on (5=easiest, 1=hardest).

2. **Extract surfaces** — `extractSurfacesFromHtml()` scans visible text for kanji substrings (up to 10 chars). Also scans backward through preceding kana (up to 4 chars) to capture mixed kana-kanji words like しょう油, お寺, ご飯.

3. **Batch dictionary lookup** — `resolveFuriganaBatch()` → `batchLookup()` runs a three-phase query:
   - Phase A: Find entry IDs by kanji table search
   - Phase B: Batch fetch kanji forms, kana readings, common flags
   - Phase C: Select best match per surface (prefer common entries, deinflect conjugated forms)
   - Returns `FuriganaEntry` objects with `kanjiPart`, `reading`, `kanjiPartLen`, optional `wordJlpt` (word-level JLPT), and optional `irregularReading` flag.

4. **Strip okurigana** — `stripOkurigana()` isolates the kanji portion from inflected words (e.g., 食べる → kanji=食, reading=た) so `<ruby>` wraps only the kanji.

5. **Apply to HTML** — `applyFuriganaToHtml()` is a single-pass state machine that:
   - Skips HTML tags, existing `<ruby>` blocks, `<rt>` content
   - Uses longest-first matching (しょう油 wins over 油 alone)
   - Respects paragraph boundaries (never matches across `</p><p>`)
   - Applies three-tier word-level JLPT filtering (see below)

#### Level filtering algorithm

When `kanjiSet.all` is true (user selected "All"), every matched word gets furigana. Otherwise the algorithm uses three pieces of data — the kanji-level filter set, the word's `wordJlpt`, and the `irregularReading` flag — to decide per-word:

**1. Kanji match + word-level suppression (Category B)**

If any kanji in the surface matches the enabled kanji set, the word is a candidate. But if `wordJlpt` is easier (higher number) than all enabled levels, furigana is suppressed. Example: user enables N2, 綺麗 has N2 kanji but is N5 vocabulary — everyone knows this word, no furigana needed.

**2. No kanji match + irregular reading (Category A)**

If no kanji matches the filter but the word has `irregularReading: true` and its `wordJlpt` is in `enabledLevels`, furigana is shown. This catches jukujikun and non-standard readings where you can't sound out the word from the kanji. Example: 今朝 (けさ) — both kanji are N5 but the reading is unpredictable.

**3. No kanji match + standard reading (Category C)**

If no kanji matches and the reading is standard (derivable from on/kun readings), no furigana. The word may be hard vocabulary but you can read the kanji. Example: 世話 (せわ) — N5 kanji, standard reading, furigana wouldn't help.

**Fallback**: If `wordJlpt` is null (no JLPT data), the word falls back to kanji-level filtering only (show if any kanji matches, skip otherwise).

#### Partial level example

With only N3 enabled:

- 反省会 (反=N5, 省=N3, 会=N5) — 省 matches N3 → shows furigana (whole word gets はんせいかい)
- 今朝 (今=N5, 朝=N5, word=N3, irregular) — no kanji match but irregular + N3 word → shows furigana
- 世話 (世=N5, 話=N5, word=N3, standard) — no kanji match, standard reading → no furigana
- 綺麗 (綺=N2, 麗=N2, word=N5) with N2 enabled — kanji match but word is N5 (easier) → no furigana

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

#### Personal ebook OCR import

Jiten imports plain text files. For users who lawfully access ebooks through browser-based readers, the separate [Personal Ebook OCR Exporter](https://github.com/TraderSamwise/personal-ebook-ocr-exporter) project can OCR visible pages into a local `.txt` file for personal reading workflows.

The OCR helper does not include books, extracted text, screenshots, credentials, or DRM-circumvention tools. It is not affiliated with any ebook retailer. Users are responsible for complying with copyright law, platform terms, and local law.

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

### Deterministic swipe/card UI rule

For swipeable card, pager, carousel, or drawer content that is **not virtualized** and has a small, known number of visible items, do **not** implement the interaction as:

- one React subtree
- one selected index
- a gesture-driven translate
- then a state swap
- then a snap back to center

That model repeatedly causes one-frame flashes of the previous card/state after settle.

For deterministic swipe UI in this codebase, the required model is:

- the visible cards must have stable identity
- previous/current/next must be frozen payloads, not re-derived live during the swipe
- swiping must traverse stable nodes/cards, not mutate one card into another
- card-local UI must render from the frozen card payload, not from global selected state during the gesture
- if a reset/recenter boundary exists, the incoming card must bridge that boundary so the previous card can never reappear for one frame

If an implementation cannot satisfy those constraints, do not add swipe. Keep explicit tap controls instead.

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
- **Fullscreen screens** (study, typing-game, context-game, connect-game, kanji-arena, stats, marked-for-review): Have `headerShown: false` and implement their own back button using `useSafeGoBack()` directly.

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

**Always use `@shopify/flash-list` instead of React Native's `FlatList` or `SectionList`.** FlatList has cell recycling bugs with NativeWind where items render as empty shells after re-renders. FlashList handles recycling correctly and is used throughout the app (dictionary, lists, browse screens).

FlashList wraps RecyclerListView, which uses `useLayoutEffect` internally for cell measurement and viewport management. This creates a **critical pitfall on web** that must be understood.

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

## List Search

The list detail screen (`app/(tabs)/lists/[id].tsx`) supports searching within a list. Search queries persist via `?q=` URL param so they survive navigation.

### Cross-database search workaround

The dict DB and user DB are separate SQLite databases, so we can't do a cross-DB join. Instead, `searchListEntries()` in `db/search.ts` runs a normal dictionary search with a high limit (500 results), then intersects the results with the set of entry IDs in the list.

**Limitation:** If a list has thousands of entries and the search term matches many words in the dictionary but only a few are in the list, results may be incomplete if those few fall outside the top 500 dict results. If this becomes a problem, the fix would be to add an `entryIdFilter` parameter to each internal search function (`searchJapanese`, `searchRomaji`, `searchEnglish`) with `AND entry_id IN (...)` constraints pushed into the SQL queries.

Kanji entries in lists are searched separately via simple literal/meaning matching since kanji lists are small.

## Web Layout and Header System

On web, the app is capped at 960px content width (centered) with a full-bleed navbar backdrop behind the tab bar. This requires special handling for headers, layout dimensions, and screens that manage their own headers.

### How the web backdrop works

The tab bar renders at the top of the viewport via Expo Router's tab navigator. A CSS `::before` pseudo-element on `body.has-navbar` provides a full-width colored backdrop (137px tall) with a bottom border, so the gray/black bar extends edge-to-edge even though content is centered. The `has-navbar` class is toggled in `app/(tabs)/_layout.tsx` when the tab layout mounts/unmounts.

The backdrop colors are centralized in `lib/navigation.ts` as `WEB_BACKDROP_COLORS` (light: `rgb(242, 242, 242)`, dark: `rgb(1, 1, 1)`) and must match `global.css`.

### Three header categories

**1. Stack-managed headers** (most screens) — Expo Router's default `<Stack.Screen>` headers. On web, these get `headerStyle: { backgroundColor: "transparent" }` via `webHeaderStyle` from `lib/navigation.ts`, so the CSS backdrop shows through. No per-screen code needed.

**2. Custom React Nav header** (`DictionaryHeader`) — A custom header component passed to the stack navigator. Manages its own padding and backdrop color.

**3. `headerShown: false` screens** (study, typing-game, context-game, connect-game, kanji-arena, reader) — These render their own header inline. They need explicit backdrop colors and top padding to align with the CSS backdrop. Use the `CustomHeaderScreen` system (see below).

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

Runtime app code should read these through `lib/env.ts`. That file is the typed facade for runtime defaults and validation; `lib/envRuntime.ts` is the only app file that should read `process.env.EXPO_PUBLIC_*` directly.

| Variable                            | Purpose                                                     |
| ----------------------------------- | ----------------------------------------------------------- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public key (presence enables cloud mode)              |
| `EXPO_PUBLIC_TURSO_ORG`             | Turso organization slug                                     |
| `EXPO_PUBLIC_API_BASE_URL`          | API base URL for token minting (e.g. `https://jiten.tokyo`) |
| `EXPO_PUBLIC_DEV_SYNC`              | Set to `1` to enable sync in dev mode (disabled by default) |

`yarn check:env` enforces the env contract in `lib/envContract.js`, the declarations in `environment.d.ts`, and blocks direct public env reads outside `lib/envRuntime.ts`. Release scripts run this check before EAS build/update.

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

Background downloads are deferred until the first sync attempt completes. This ensures sync data is available before large downloads begin. Managed via `triggerBackgroundDownloads()` in the database provider, gated on `syncStatus` transitioning to `idle` or `error` with a non-null `lastSyncAt` or `lastError`. The sync provider uses a `bgDownloadsTriggered` ref to ensure it only fires once per mount.

The download queue runs sequentially in priority order:

1. **Full dictionary** — replaces the mini DB with the complete dictionary (~49MB compressed). Opens the new DB atomically before closing the old one to avoid null-flash. Marks `dict-db-full` in AsyncStorage only after successful open/swap.
2. **Audio** — word pronunciation MP3s (~190MB). Has resume support on native via `DownloadResumable` state persisted to AsyncStorage.
3. **Strokes** — kanji stroke order data (~10MB)
4. **Extended** — synonyms and names (~110MB)

On native, background downloads are WiFi-gated. On web, the visibility handler retries incomplete background downloads when the tab regains focus. The `bgInitStarted` ref prevents concurrent executions and resets in `.finally()` to allow re-triggering.

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

## AI API

Five routes call OpenAI. They live in `server/routes/`, are mounted on the single Hono app
(`server/app.ts`), and share one middleware chain:

```
bodyLimit → authMiddleware → entitlement(feature) → jsonBody(schema) → rateLimit(endpoint)
```

| Endpoint                       | Route file          | Quota cost | Returns                                                                               |
| ------------------------------ | ------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `/api/reader/explain-sentence` | `readerExplain.ts`  | 2          | Grammar/meaning breakdown of a selected sentence                                      |
| `/api/words/example-sentences` | `wordsExample.ts`   | 1          | Three example sentences for a dictionary headword                                     |
| `/api/kanji/mnemonic`          | `kanjiMnemonic.ts`  | 1          | A mnemonic built from a kanji's primitives                                            |
| `/api/words/context-sentences` | `wordsContext.ts`   | 2          | Sentences for **up to 5 words**, for the context game                                 |
| `/api/words/fill-blank`        | `wordsFillBlank.ts` | 2          | Cloze questions for **up to 4 words**, each with a candidate pool for its distractors |

Request schemas live in `lib/api-contract.ts` — shared by the routes and, through
`hc<AppType>`, by the typed RPC client (`lib/api-client.ts`). The zod helpers **truncate**
rather than reject (`reqTrimmed`, `optTrimmed`, `trimmedArray`), so an over-long field
shortens instead of failing the request.

### Quotas and entitlements

Two counters guard AI spend, both in `api/_shared/rate-limit.ts`, both stored in a small
shared Turso database (`TURSO_QUOTA_DB_URL` + `TURSO_QUOTA_DB_TOKEN`):

| Counter      | Table             | Limit                                                | Scope            |
| ------------ | ----------------- | ---------------------------------------------------- | ---------------- |
| Per user     | `ai_user_usage`   | `AI_DAILY_QUOTA`, default 500/day (capped at 10 000) | one Clerk user   |
| Service-wide | `ai_global_usage` | `AI_GLOBAL_DAILY_QUOTA`, default 2000/day            | everyone, summed |

All five endpoints share one weighted `ai` bucket. Cost is **per request**, charged _before_
the OpenAI call — so a request whose response turns out to be unusable still costs its units.
The service-wide counter exists because per-user limits bound nothing in aggregate: N
accounts cost N x their limit.

Both counters increment and test their limit in a **single conditional statement**, with
`RETURNING` handing back the new total in the same round trip:

```sql
INSERT INTO ai_user_usage (user_id, day, count) VALUES (:userId, :day, :cost)
ON CONFLICT(user_id, day) DO UPDATE SET count = count + :cost
WHERE count + :cost <= :limit
RETURNING count
```

No rows returned means the day is full. This matters: a read-then-write lets two concurrent
requests read the same total and both pass — exactly what an abusive client would ride. The
per-user counter used to live in Clerk `privateMetadata`, which cost two Clerk API calls per
request and was raceable for that reason.

Rows are keyed by UTC day, so counters reset without a job; stale rows are pruned once per
process. Two deliberate behaviours:

- **Fails closed.** If the counter database can't be reached, AI routes return 503 rather
  than running uncapped — every AI feature depends on it being up.
- **Inert when unconfigured.** With the env vars unset (local dev, self-hosters) both checks
  are skipped and log a warning once per process, meaning **no** limits are enforced. Setting
  them is what arms this in production — worth verifying after any env change.

The per-user counter is consumed first, so a request the caller's own limit already refuses
never spends from the shared budget.

`entitlement(feature)` (`api/_shared/entitlements.ts`) is a real seam that currently allows
everything; billing hooks in there without touching clients.

### Context sentences (`server/routes/wordsContext.ts`)

The context game shows a sentence with one word in red and grades the kana the player types.
That only works if the response satisfies invariants the model can't be trusted to hold, so
`lib/context-sentences.ts` filters every sentence — on the server, and again on the client
before it reaches the renderer:

- `targetSurface` occurs in `sentence` **exactly once** — the red span is found with
  `indexOf`, so a second occurrence would be ambiguous.
- `targetSurface` contains kanji — a kana-only target has nothing to read.
- `targetReading` is kana only — it is compared against what the player types.
- The surface belongs to the **requested** headword (`matchesHeadword`): it shares a kanji
  with it and, when the headword starts with kanji, opens with that same kanji (allowing a
  leading お/ご/御). Without this, a sentence targeting an unrelated word passes every other
  check.

Sentences that fail are dropped, not repaired. A word that loses all of its sentences simply
doesn't come back; only an entirely empty result is an error.

### No cache, by design

Nothing about generated sentences is persisted — no table, no sync, no reuse across
sessions. Consequences worth knowing before changing it:

- The context game requires a connection and a signed-in account. There is no offline path.
- `sentencesPerWord` is 1: an extra sentence would be paid for and thrown away.
- Failure classes are distinguished so quota is never spent twice on a settled answer.
  `AiQuotaError` and `AiUnusableResponseError` (a 200 whose sentences were all unplayable),
  both in `lib/ai-errors.ts`, are never retried; a transient failure is retried once.

### Prefetch pump (`hooks/useBatchPrefetch.ts`)

Generic over item and round type, so every AI game shares one copy of this logic;
`hooks/useContextSentences.ts` is a thin wrapper supplying a `fetchBatch`.

Batches of 5 words are fetched **sequentially** (parallel batches would race the quota
counter above), keeping 10 rounds ahead of the player. The first batch is awaited before
play starts; the rest arrive during play. A failed first batch keeps the player on the
select screen with the error; later on, two consecutive failed batches stop generation and
the round ends early with the reason shown on the done screen.

Model selection falls back through `OPENAI_CONTEXT_SENTENCES_MODEL` →
`OPENAI_WORD_EXAMPLES_MODEL` → `OPENAI_EXPLAIN_MODEL`. The OpenAI call is capped at 35s,
under the 60s Vercel function ceiling set by `vercel.json`.

### Shared typing core (`lib/typing-core.ts`)

`evaluateTypingInput()` grades one keystroke of kana typing — IME conversion, per-character
status, flick-keyboard intermediates, completion, and over-length. It takes a plain string
target, so it drives the typing game and study screen (target = a `DictEntry` reading) and
the context game (target = a conjugated surface reading inside a sentence) from one
implementation.

## Dev Server

For web development, run the dev server alongside Expo:

```bash
yarn serve:dev   # Start dev server on localhost:3001
yarn web         # Start Expo web dev server (separate terminal)
```

The dev server (`server/dev.ts`) runs the **same Hono app** as production (see `server/`) on port 3001, mirroring the prod topology (one origin for API + proxy + data). It provides three services:

1. **API** (`/api/*`) — the real backend routes (`server/routes/*`), run locally through the Hono app. Web dev talks to this automatically: `lib/env.ts` points `API_BASE_URL` at `http://localhost:3001` when `Platform.OS === "web"` and `__DEV__`, so the web app never hits the deployed API. **Requires `yarn serve:dev` to be running**, plus `CLERK_SECRET_KEY` and `OPENAI_API_KEY` in your `.env` for the AI routes. The Turso routes (`/api/turso-token`, `/api/provision-db`) are **forwarded to the deployed API** (`DEV_PROD_API_BASE`, default `https://jiten.tokyo`), so no Turso secrets are needed locally — Turso sync itself never goes through this server (the libsql client talks to Turso directly).

2. **Dictionary file server** — serves files directly from `assets/` (`dictionary.db`, `dictionary-extended.db`, `dict-manifest.json`, etc.) with CORS headers and Range support. The `.env` file points `EXPO_PUBLIC_DICT_MANIFEST_URL` to `http://localhost:3001/dict-manifest.json`. **Important**: since the dev server serves `assets/` live, corrupting or deleting any DB file there immediately breaks your local dev environment and simulator.

3. **External-API proxy** (`/proxy/*`) — proxies external APIs to avoid CORS issues on web. Same routes as the Vercel rewrites in `vercel.json`:

| Dev URL                              | Proxied to                    |
| ------------------------------------ | ----------------------------- |
| `localhost:3001/proxy/aozora/*`      | `https://www.aozora.gr.jp/*`  |
| `localhost:3001/proxy/syosetu-api/*` | `https://api.syosetu.com/*`   |
| `localhost:3001/proxy/syosetu/*`     | `https://ncode.syosetu.com/*` |

In dev mode (`__DEV__`), `lib/proxy.ts` automatically routes proxy URLs to `localhost:3001`. In production, it uses relative paths handled by Vercel rewrites.

The API is deployed to Vercel as a single catch-all function (`api/[...route].ts` → `getRequestListener(app.fetch)` on the Node runtime; a `vercel.json` rewrite routes nested `/api/*` paths to it). Native (iOS/Android) doesn't use the local proxy — it calls external APIs directly — and uses the configured `EXPO_PUBLIC_API_BASE_URL` for the backend.

## SRS and Day Boundary

### Day reset hour

The app uses a configurable "day reset hour" (default 3am, range 0–6) to define logical day boundaries. This affects:

- **SRS due cutoff** — both Simple SRS and FSRS show all cards due before the next reset hour as "due today". A card due at 11pm tonight shows as due even if you study at 9am. This matches expected's behavior of showing all cards due within the current day, so time-of-day doesn't affect which cards appear.
- **Stats and streaks** — daily activity, streaks, and heatmap data bin by logical day.
- **Review marks** — marks are deduplicated per logical day.

The cutoff is timezone-agnostic: it uses local time, so traveling across timezones shifts it naturally.

Setting: `stores/settings.ts` → `dayResetHourAtom`. UI: Settings → "Day Reset Time".

### Key functions

| Function                              | File                   | Purpose                                               |
| ------------------------------------- | ---------------------- | ----------------------------------------------------- |
| `endOfLogicalDayEpochDays(resetHour)` | `stores/simple-srs.ts` | Due cutoff for Simple SRS queries (epoch days)        |
| `endOfLogicalDayISO(resetHour)`       | `stores/simple-srs.ts` | Due cutoff for FSRS queries (ISO string)              |
| `getDayStart(date, resetHour)`        | `lib/day-boundary.ts`  | Start of logical day                                  |
| `sqlDayExpr(column, resetHour)`       | `lib/day-boundary.ts`  | SQL fragment for binning timestamps into logical days |
| `getLogicalToday(resetHour)`          | `lib/day-boundary.ts`  | Today's YYYY-MM-DD label                              |

### Simple SRS (`stores/simple-srs.ts`)

Simple spaced repetition with a day-based epoch and fixed interval multipliers.

**Card states:**

- `NULL` d → New (never seen)
- `s:0` → Learning/lapsed (in-session, needs 3 correct to graduate)
- `s:1` → Graduated (scheduled for future review)

**Interval parameters:**

- Initial interval: 1/3 day (~8 hours)
- Correct: interval × 1.9 (chain: 0.33 → 0.63 → 1.20 → 2.29 → 4.34 → 8.25 → 15.68 → 29.79 → 56.61 → 107.55 → 204.37 → 365)
- Easy: interval × 2.6125 (1.9 × 1.375 bonus)
- Lapse: interval × 0.5
- Max interval: 365 days
- Due dates stored as fractional days since 2001-01-01 (Mac/Core Foundation epoch)

**Session behavior (`app/(tabs)/lists/study.tsx`):**

- **Dynamic deque**: maintains ~10 active cards at a time, pulling from pools as needed
  - Two pools loaded at session start: due cards (priority) and new cards
  - When active deque drops below 10 pending cards, pulls more from due pool first, then new pool
  - This naturally introduces new cards as the deque thins out
- **Re-queue**: failed/learning cards push to back of the active deque (~10 cards away, not 300+)
- Graduated cards (stage 1) pass in 1 correct answer → recalculate interval, removed from session
- New/learning cards (stage 0) need 3 correct to graduate
- **Continuous session**: no checkpoint screen — session flows until all pools and deque are exhausted
- **Progress bar**: tracks only due cards (not new cards) — turns green when all due cards graduated
  - Counter: `completedDueCards / totalDueAtStart (totalInList)`
  - `simpleDueIdsRef` tracks which cards were due at start; `completedSrsIdsRef` tracks graduated due cards
- Session length is dynamic — failing cards extends the session, new cards trickle in continuously

### FSRS (`ts-fsrs` library)

Full FSRS 5.0 implementation via `ts-fsrs`. Uses the same logical day cutoff for due cards.

## Scripts

### Release Workflow

Releases use the shared `@tradersamwise/eas-release` CLI. Two paths, chosen by what
changed. Always bump the version first, then ship.

```bash
# OTA update — JavaScript / asset changes only
yarn version:bump-ota && yarn update              # testflight
yarn version:bump-ota && yarn update:production   # production

# Native build — native deps, Expo plugins, permissions, icons, splash, native config
yarn version:bump-build && yarn build:testflight   # testflight
yarn version:bump-build && yarn build:production    # production
```

Decision rule: OTA covers JavaScript and assets. A native rebuild is required for
native dependencies, Expo plugins, permissions, icons, splash screens, build
profiles, or any native configuration — anything that changes the native binary or
its Expo runtime fingerprint. `bump-ota` enforces this: it aborts if the Expo
runtime version changed since the last native build, because an OTA can only target
the runtime already installed on the device. `bump-build` increments the build
number, resets the OTA counter to 0, and updates native version files.

Dictionary deploys ride on this flow — see the OTA notes in the dictionary section
below, which additionally gate on `DICT_BASE_VERSION`.

### Dictionary Database

```bash
yarn migrate:dict  # Apply incremental dictionary migrations (the normal workflow)
yarn publish:dict  # Upload dictionary assets to GitHub release
```

The dictionary lives in `assets/` as five database files plus a manifest:

- `dictionary.db` — full dictionary (~120MB): all entries, kanji, kana, senses, pitch accents, FTS index
- `dictionary-mini.db` — mini dictionary (~32MB, ~13MB compressed): common entries (~22.5k) + all kanji tables. This is what users download at the gate — the full DB downloads in the background afterward.
- `dictionary-audio.db` — word audio (~190MB): MP3 BLOBs for pronunciation
- `dictionary-extended.db` — extended data (~110MB): synonyms (WordNet), names (JMnedict) with FTS5
- `dict-manifest.json` — version, file sizes (full + mini + compressed), and download URLs

#### Mini DB architecture

The mini DB is a **derived artifact** — never edited directly. It's rebuilt automatically from the full `dictionary.db` by both `yarn build:db` and `yarn migrate:dict` using the shared `buildMiniDb()` function in `scripts/lib/build-mini.ts`.

The mini DB contains:

- All entries with `common = 1` (~22.5k words) plus their kanji, kana, senses, and pitch accents
- All kanji tables verbatim (kanji_characters, kanji_radicals, kanji_similarity)
- FTS indexes for glosses and kanji meanings
- `dict_meta` table with version info

On first install, users download only the mini DB (~13MB compressed). The full dictionary (~49MB compressed) downloads as the first background task. Once the full DB is ready, the provider swaps it in atomically (open new → swap refs → close old) and marks it via `dict-db-full` in AsyncStorage. If the download is interrupted (app close, network drop), it retries on next app foreground via the visibility handler.

Words not in the mini DB show a placeholder message ("This entry will be available after the full dictionary downloads") in `WordDetail.tsx`.

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
2. Run `yarn migrate:dict` to apply it to your local `assets/dictionary.db` (this also rebuilds `dictionary-mini.db` and updates `dict-manifest.json` automatically)
3. Add a matching client migration in `db/dict-client-migrations.ts` with the SQL statements that will run on user devices
4. Bump `DICT_VERSION` in `db/dict-version.ts` (leave `DICT_BASE_VERSION` unchanged)
5. Deploy via OTA (`yarn update`) — devices apply the migration in-place, no download needed

**Major update (full re-download)** — for new tables with large data, FTS rebuilds, audio changes:

1. Create a build-time migration and run `yarn migrate:dict` (rebuilds mini DB + manifest)
2. Bump both `DICT_VERSION` and `DICT_BASE_VERSION` in `db/dict-version.ts`
3. Run `yarn publish:dict` to upload to GitHub (publishes both `dictionary.db` and `dictionary-mini.db`)
4. Deploy via OTA — devices re-download the mini dictionary at the gate, then full dictionary in background

#### How migrations work with the mini DB

The mini DB is always regenerated from the full DB — never migrated independently. The workflow:

1. Write a build-time migration that modifies `dictionary.db` (e.g., add a column, change data)
2. `yarn migrate:dict` applies the migration to the full DB, then calls `buildMiniDb()` to regenerate the mini DB from scratch
3. Both DBs are always in sync because the mini is derived from the full

If a migration adds a column to a table that exists in both DBs (e.g., `entries` or `kanji_characters`), you only write the migration once against the full DB. The mini rebuild copies the new column automatically. `buildMiniDb()` uses dynamic column detection via `PRAGMA table_info()` to handle schema differences gracefully — missing columns are filled with NULL.

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

The app downloads the mini DB first (blocking gate), then the full dictionary, audio, strokes, and extended data sequentially in the background (WiFi only on native). Not needed for minor updates (client migrations handle those via OTA).

#### Building extended data

> **Always patch the existing DB** — never run a full rebuild unless you have no base DB to patch. See the principle below.

To add new data to the extended DB (e.g. a new table), patch the existing `assets/dictionary-extended.db` directly using `better-sqlite3`:

```bash
# Example: add a table and seed data into the existing extended DB
node -e "
const Database = require('better-sqlite3');
const db = new Database('assets/dictionary-extended.db');
db.exec('CREATE TABLE IF NOT EXISTS ...');
// insert data...
db.prepare('INSERT OR REPLACE INTO ext_meta (key, value) VALUES (?, ?)').run('version', '2');
db.close();
"
```

The extended DB has no client migration system — when `manifest.extended.version` exceeds the device's local version, the app re-downloads the entire file. After patching, run `yarn publish:dict` to upload.

> **WARNING**: `yarn build:extended` is **destructive** — it deletes the existing `assets/dictionary-extended.db` before rebuilding (`fs.unlinkSync`). If the build is interrupted, the file is gone. Since `yarn serve:dev` serves directly from `assets/`, this immediately breaks your local dev environment.

`yarn build:extended` regenerates the entire extended DB from scratch (WordNet + JMnedict download). This is slow and should only be used if you don't have a base DB to patch. If you need a clean base, pull it from the GitHub release first:

```bash
cd assets && gh release download v1 --repo TraderSamwise/jiten-data --pattern 'dictionary-extended.db'
```

#### Full rebuild from scratch (almost never needed)

```bash
yarn build:db
```

> **WARNING**: This deletes the entire dictionary and regenerates everything from scratch, including TTS audio via Google Cloud API which costs real money (`GOOGLE_TTS_API_KEY` env var required). It takes 5-10+ minutes and should not be run without explicit instruction.
>
> You almost certainly want `yarn migrate:dict` instead. Only use `build:db` if the database is corrupted beyond repair or you need to regenerate from an entirely new JMDict release. The script will prompt for confirmation (bypass with `--force`).

#### Principle: always patch, never rebuild

> **Never run a full rebuild** of any database (`build:db`, `build:extended`) unless you literally have no base file to work with. Full rebuilds are slow, expensive (TTS audio costs real money), and unnecessary for incremental changes.
>
> The correct workflow is always: **patch the existing DB file** (via `yarn migrate:dict` for the main DB, or direct SQLite manipulation for extended/audio/strokes), then publish. If the local DB file is missing or corrupted, pull it from the GitHub release first and then patch — don't regenerate from scratch.

Both `yarn build:db` and `yarn migrate:dict` automatically rebuild `dictionary-mini.db` and update `dict-manifest.json` with current file sizes (full + mini + compressed).

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
