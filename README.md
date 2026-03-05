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
- **Pre-commit hook** (husky + lint-staged) runs eslint and prettier on staged files automatically

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

- **Lists and Reader tabs**: `SafeBackButton` is set as the default `headerLeft` in each tab's `_layout.tsx` via `screenOptions`. All non-index screens get a back button automatically — no per-screen code needed. It uses `useSafeGoBack()` which pops the stack if there's history, or navigates to the tab root on web refresh/deep link.
- **Dictionary tab**: Uses a fully custom `DictionaryHeader` component (search bar, mode toggle) which handles its own back button via `useSafeGoBack("/dictionary")`.
- **Fullscreen screens** (study, typing-game, reader): Have `headerShown: false` and implement their own back button using `useSafeGoBack()` directly.

### Key files

| File                              | Purpose                                               |
| --------------------------------- | ----------------------------------------------------- |
| `lib/navigation.ts`               | `useSafeGoBack()`, `SafeBackButton`, `useTabRouter()` |
| `app/(tabs)/lists/_layout.tsx`    | Lists stack with automatic `SafeBackButton`           |
| `app/(tabs)/reader/_layout.tsx`   | Reader stack with automatic `SafeBackButton`          |
| `components/DictionaryHeader.tsx` | Custom dictionary header with search + back button    |

## Scripts

### Dictionary Database

```bash
yarn migrate:dict  # Apply incremental dictionary migrations (the normal workflow)
yarn serve:dict    # Serve dictionary files locally (localhost:3001)
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

