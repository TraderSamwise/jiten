# Jiten (辞典)

An offline-first Japanese **dictionary**, **ebook reader**, and **study app** built with
Expo / React Native. One codebase runs on iOS, Android, and the web.

Jiten pairs a fast local dictionary with a vertical-writing ebook reader, tap-to-lookup,
JLPT-aware furigana, an SRS study system, and kanji learning tools — all working fully
offline, with optional encrypted cloud sync across devices.

> **Status:** open-sourced from a working private codebase. It builds and runs, but
> expect rough edges around first-run setup and the data pipeline. Issues and PRs welcome.

## Features

- **Dictionary** — fast local search across Japanese, romaji, and English, with
  deinflection for conjugated verbs/adjectives and proper-noun (name) lookup.
- **Ebook reader** — vertical right-to-left (`vertical-rl`) pagination in a WebView,
  interactive furigana, tap-to-lookup, and streaming pagination for long books.
  Sources: Aozora Bunko (public-domain literature), Syosetu (web novels), and `.txt` import.
- **JLPT-aware furigana** — per-word ruby annotations filtered by the JLPT levels you've
  learned, using a word-level classification of every common JMdict entry.
- **Study / SRS** — spaced-repetition flashcards (FSRS algorithm) for vocabulary and kanji,
  with custom lists and review statistics.
- **Kanji tools** — stroke-order, radical search, and primitive-based mnemonic study.
- **Mini-games** — typing, connection, a kanji "arena" for drilling readings, and two games
  built on AI-generated sentences: Read in Context (type the reading of a word in a sentence)
  and Fill in the Blank (choose which of your words completes a sentence).
- **Cloud sync (optional)** — offline-first; when signed in, user data (lists, cards, books,
  review history) syncs across devices. Runs identically with sync disabled.

## Platforms

| Platform | Status                                                            |
| -------- | ----------------------------------------------------------------- |
| iOS      | Native build (Expo prebuild + `ios/`), includes a share extension |
| Android  | Native build (Expo prebuild)                                      |
| Web      | React Native Web (single-page app)                                |

## Quick start

```bash
yarn                 # install dependencies
cp .env.example .env # all keys optional — blank = local-only mode
yarn web             # start the web dev server
```

The app runs fully **local-only** with an empty `.env` — no accounts, no backend, no sync.
Cloud sync and AI features are opt-in and require your own keys (see below).

For native development:

```bash
yarn ios       # build/install/open the iOS simulator dev build
yarn android   # build/install/open the Android emulator dev build
```

Other useful scripts:

```bash
yarn test        # run the test suite (vitest)
yarn typecheck   # tsc --noEmit
yarn lint        # eslint
yarn format      # prettier --write .
```

### Dictionary data

The dictionary, audio, stroke, and extended databases are **large binaries built from
upstream open data** — they are not committed to the repo. On first run the app downloads
prebuilt databases from a release; to build them yourself from source, see
[`data/README.md`](data/README.md) and the `build:*` scripts in `package.json`.

Attribution for all bundled data and assets is in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Optional cloud features (bring your own keys)

Sync and the AI-assisted features are disabled unless you supply your own credentials.
Nothing is hardcoded — every secret is read from the environment at runtime.

| Feature                                                   | What you need                                                                                                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth + sync                                               | A [Clerk](https://clerk.com) app and a [Turso](https://turso.tech) org (`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_TURSO_ORG`, server-side `CLERK_SECRET_KEY` / `TURSO_API_TOKEN`) |
| AI mnemonics, reader-explain, example + context sentences | An OpenAI API key on the backend                                                                                                                                                          |
| Pronunciation audio (build)                               | A Google Cloud TTS key (`GOOGLE_TTS_API_KEY`)                                                                                                                                             |
| Error reporting                                           | A Sentry DSN (`EXPO_PUBLIC_SENTRY_DSN`)                                                                                                                                                   |

See [Cloud Sync](docs/ARCHITECTURE.md#cloud-sync) in the architecture doc for the full
backend design. The `api/` and `server/` directories contain the reference backend
(Clerk webhooks, per-user Turso provisioning, AI endpoints).

## Project structure

```
app/            Expo Router screens (tabs: Dictionary, Lists, Reader, Settings)
components/     Shared React Native components
db/             SQLite access, migrations, sync engine, providers
lib/            Reader model, furigana, lookup, navigation, env, helpers
stores/         Jotai / Zustand state
packages/       Yarn workspaces:
  reader-webview/         @tradersamwise/jiten-reader-webview WebView runtime + bridge
  japanese-reader-core/   @tradersamwise/jiten-reader-core HTML/parsing/slicing
  japanese-reader/        @tradersamwise/jiten-reader-react-native reader controller + adapters
  kanji-arena-webview/    Phaser kanji-arena mini-game
api/ , server/  Reference backend (Vercel functions / Hono server)
scripts/        Dictionary + kanji + audio build pipeline
data/           Committed source data (JLPT lists, etc.) — see data/README.md
docs/           Architecture reference and design docs
```

Deep dive: [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) — the reader engine, furigana
algorithm, navigation model, virtualized lists, sync protocol, and platform-polymorphism
conventions are all documented there.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow, and
coding conventions, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security reports:
[SECURITY.md](SECURITY.md).

## License

Jiten is licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

In short: you may use, modify, and self-host it, but if you run a modified version as a
network service, you must make your source available under the same license.

Third-party data and assets retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
