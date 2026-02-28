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

## Scripts

### Dictionary Database

```bash
yarn build:db      # Build dictionary from JMDict sources + audio
yarn serve:dict    # Serve dictionary files locally (localhost:3001)
yarn publish:dict  # Upload dictionary assets to GitHub release
```

`build:db` downloads JMdict and pitch accent data, generates Google Cloud TTS audio for common entries (`GOOGLE_TTS_API_KEY` env var, cached in `.cache/tts-audio/`), and outputs three files to `assets/`:

- `dictionary.db` — core dictionary (~170MB): entries, kanji, kana, senses, pitch accents, FTS index, synonyms
- `dictionary-audio.db` — word audio (~190MB): MP3 BLOBs for pronunciation
- `dict-manifest.json` — version and file sizes for the download client

`publish:dict` uploads all three to the [jiten-data](https://github.com/TraderSamwise/jiten-data) GitHub release (requires `gh` CLI). The app downloads core first (blocking), then audio silently in the background.

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

