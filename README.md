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

The ebook reader uses **JS-measured virtualized pagination** (not CSS columns):

1. Full HTML content is embedded in a hidden `<div id="raw">` element
2. On init, JS extracts child elements into a `blockHtmls[]` array
3. `paginate()` measures which blocks fit per page using an off-screen div
4. `renderPage(n)` swaps only the current page's blocks into the DOM
5. Hidden buffer divs (`#buf-prev`, `#buf-next`) hold adjacent page text for word lookup at boundaries

No scrolling is involved — page navigation directly swaps DOM content.

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

