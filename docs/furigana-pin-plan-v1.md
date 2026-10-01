# Pinned furigana readings — plan v1

**Status: planned, not started.** Queue item `0cfac0-11`.

Long-press a kanji run in the reader, pick the reading you meant from a list of
every reading the dictionaries know for it, and that book remembers the choice.
A pinned reading always wins, and can be removed again.

The motivating case is names — 杏子 is きょうこ in the book you are reading and
あんず in the next one, and no amount of corpus frequency settles that for you
([name-reading-frequency-plan-v1.md](name-reading-frequency-plan-v1.md) got the
automatic answer as far as it goes). But nothing about the mechanism is about
names: 後味 reading ごみ, a counter reading the wrong way, a compound the
resolver splits wrongly — all the same lever, so it is built generic.

## What it is, precisely

- **The key is a kanji run**, as the page spells it — the text inside
  `<ruby>…<rt>` that the reader already renders, or the contiguous
  kanji/digit run under the finger when there is no ruby there. Not a
  dictionary entry, not a deinflected word. What the user long-presses is what
  gets pinned, which is the only key they can predict.
- **The value is the reading string**, plus the empty string meaning _show no
  furigana here_.
- **The scope is one book.** A re-import of the same text is a new book id and
  starts clean; noted, not solved.
- A pin **bypasses the furigana settings filter**. Pinning a name reading with
  "show names" off must show the reading, or the gesture does nothing and looks
  broken.

## Why a separate pass, not an entry in the furigana map

`resolveFuriganaBatch` is keyed on _surfaces_ as `extractSurfacesFromHtml`
generates them — up to 10 characters, including trailing kana, generated at
every position. `applyFuriganaToHtml` then matches those keys longest-first and
emits `<ruby>` over `entry.kanjiPartLen` characters. Overriding through that map
would mean the user's key (what they pressed) and the map's key (a surface that
may extend past it) are different strings, and a pin would mis-fire whenever a
longer surface also matched.

So pins are **checked first, at each position, longest pin first**, before the
surface loop. Same `spanCrossesMarkup` refusal, same advance. The furigana map
is untouched, which also means **the sweep gate can prove pins change nothing
when no pin is set**.

## Phases

Each phase ends typecheck-clean, lint-clean, with its own tests, and is
committed on its own.

### Phase 1 — Storage

- `furigana_pins` table appended to `USER_DB_MIGRATIONS`:
  `id TEXT PRIMARY KEY, book_id TEXT NOT NULL, surface TEXT NOT NULL,
reading TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
deleted_at TEXT` plus `CREATE INDEX … (book_id)` and
  `CREATE INDEX … idx_furigana_pins_updated ON furigana_pins(updated_at)` —
  that one named for `_updated` because `isRemoteRelevant` in
  `db/sync-engine.ts` is what decides whether an index reaches the remote at
  all, and the delta pull scans `updated_at`. **No UNIQUE index on
  (book_id, surface):** the deterministic id already enforces it, and a second
  constraint would abort a whole pull transaction if a row ever arrived under a
  different id.
- **`id` is deterministic — `${book_id}${surface}`.** A random id would
  let two devices create two rows for one pin and last-write-wins would never
  collapse them.
- `db/schema.ts`: the drizzle table.
- `db/sync-helpers.ts`: a `MUTABLE_TABLES` entry (`pk: "id"`,
  `timestampCol: "updated_at"`), and the table added to the `books` entry of
  `DATA_CATEGORIES` so export/delete-my-data cover it.
- `lib/furigana-pins.ts`: `listPins(db, bookId)`, `setPin(db, bookId, surface,
reading)` (upsert, clears `deleted_at`), `clearPin(db, bookId, surface)`
  (soft delete), `clearAllPins(db, bookId)`.

**Tests** — `lib/furigana-pins.test.ts` on `createTestDb`: upsert replaces
rather than duplicates; a cleared pin stops being listed; the empty-string
reading round-trips and is not confused with "no pin"; two books do not see
each other's pins. Nothing in the repo hard-codes the migration count —
`db/sync-engine.test.ts` computes it from `USER_DB_MIGRATIONS.length` — so
appending needs no test updated.

`lib/data-backup.ts` gets the table too (`BACKUP_TABLES`, `TABLE_COLUMNS`,
`IMPORT_ORDER`), `deleted_at` included, because a pin is durable user data.
`review_marks` and `primitive_note_assoc` are absent from backup on purpose —
one is pruned after 30 days, the other is rebuildable.

### Phase 2 — Candidates

New `packages/japanese-reader/src/furigana-pins.ts`:

```ts
export type FuriganaCandidateSource = "current" | "source" | "name" | "word" | "counter";
export interface FuriganaReadingCandidate {
  reading: string;
  source: FuriganaCandidateSource;
  label?: string; // 女性名 / surname / the gloss, for names
  note?: string; // "26 of 33 sightings", from nameReadingDominance
  common?: boolean;
}
export async function furiganaReadingCandidates(
  run: string,
  dictDb: ReaderSqlDb,
  extendedDb: ReaderSqlDb | null | undefined,
  options: { currentReading?: string | null; sourceReading?: string | null },
): Promise<FuriganaReadingCandidate[]>;
```

Gathered from, in order:

1. The reading currently on the page, and the book's own ruby if it had one.
2. **Names** — every `names` row whose `kanji` equals the run, ordered by the
   `freq` column the name-frequency work added, annotated with the share
   `nameReadingDominance` computes. This is the list the whole feature exists
   for: 杏子's thirteen readings, best first.
3. **Words** — entries whose kanji form equals the run exactly (kana form as
   the reading), and entries whose kanji form is the run followed only by kana
   (verbs and adjectives: 読み → 読 + み), reading via the existing
   `stripOkurigana`. Common forms first.
4. **Counters** — `counter_readings` for the run.

De-duplicated by reading, keeping the highest-ranked source. Capped at ~20.

**Tests** — `furigana-pins.candidates.test.ts`, real dictionary, `describe.skipIf`
on `hasDictDb` like the neighbours: 杏子 offers きょうこ first and あんず
somewhere; 後味 offers both あとあじ and ごみ; 高遠 offers たかとお; a run with
nothing known returns only the current reading; the list never contains a
duplicate reading.

### Phase 3 — Rendering

- `FuriganaPinMap = Map<string, string>` threaded into `applyFuriganaToHtml`
  through its settings argument (new optional `pins` field, so no call site
  changes shape).
- At each position, before the surface loop: longest matching pin wins. A
  non-empty reading emits `<ruby>run<rt>reading</rt></ruby>`; the empty string
  emits the run bare. Either way the run's characters are consumed, so no
  shorter surface annotates inside a pinned run. `spanCrossesMarkup` refuses a
  pin that would straddle the book's own markup, exactly as a surface is
  refused.
- Books that ship their own ruby never reach `applyFuriganaToHtml`'s text path
  (`rubyDepth > 0` passes through). A second small function,
  `applyFuriganaPinsToSourceRuby(html, pins)`, rewrites `<rt>` where the ruby
  base is pinned, and is called from `renderPreformattedReaderContent`.

**Tests** — extend `lib/reader-furigana.test.ts`: a pin beats a longer
competing surface; a pin shows through a settings filter that would otherwise
hide the word; the empty reading suppresses an annotation that would otherwise
appear; a pin straddling an `<em>` is refused; a pin rewrites a source ruby.

**Gate** — the furigana sweep over all 67,299 kanji-initial corpus surfaces
with **no pins set: 0 changed**. That is the whole claim this phase has to make
about the existing pipeline.

### Phase 4 — The gesture

`packages/reader-webview/src/touch.ts`:

- A 500 ms timer armed on `touchstart`, cancelled by `touchmove` past 10 px,
  by `touchend`, and by any page shift.
- On fire: `state.suppressClick = true` (the tap lookup must not also open),
  and post
  `{ type: "furiganaPin", run, currentReading, sourceReading, x, y }`.
- Finding the run — two pure helpers, so they are testable without a gesture:
  - `rubyUnder(el)` → `{ base, reading }` from `closest("ruby")`.
  - `kanjiRunAt(text, index)` → the contiguous kanji/digit run containing
    `index`, capped at 8 characters, empty when the character is not kanji.
- `mouse.ts` gets the same on `contextmenu` (right-click) for the web reader.
- Haptics fire on the native side when the message arrives, not in the webview.

**Tests** — `packages/reader-webview/src/furigana-pin.test.ts` (jsdom, the
house pattern): `kanjiRunAt` at the run's start, middle, end, across a kana
boundary, on a non-kanji character, and at the 8-character cap; `rubyUnder` for
a press on the base, on the `<rt>`, and outside any ruby.

### Phase 5 — The sheet and the wiring

- `backend.furiganaPins?: ReaderFuriganaPins` — a port shaped like
  `bookmarks`, with `list/set/clear/clearAll`, implemented in the app against
  `lib/furigana-pins.ts`. The package keeps knowing nothing about the user DB.
- `useJapaneseReader` holds `furiganaPinsRef` (the map) and a
  `furiganaPinsKey` string (sorted `surface=reading` pairs) added to
  `ReaderTransformSettingsSnapshot` and to
  `transformSettingsSnapshotsEqual`. Setting a pin bumps the key, the existing
  re-transform effect sees `furiganaChanged`, clears the furigana caches and
  reloads at the current character. **No new re-render path.** The key also
  joins the `getFuriganaSliceHtml` cache key.
- A `furiganaPin` message loads the candidates and sets
  `furiganaPinTarget: { run, candidates, pinned }`.
- `components/FuriganaPinSheet.tsx` — the run large at the top, then the
  candidate rows (reading, source label, note; the active one check-marked),
  then **No furigana** and, when a pin exists, **Remove pin**. Choosing writes
  and closes.
- The reader's furigana settings panel gains one line: _Pinned readings (n)_
  with a clear-all, so a book can be reset without hunting for each run.

**Tests** — `use-japanese-reader.pins.test.tsx` alongside the existing
`use-japanese-reader.tap.test.tsx`: the message produces candidates; choosing
one calls `set` with the run and reading; the snapshot key changes; removing
calls `clear`. `FuriganaPinSheet` render test: the active reading is marked,
and the remove row only appears when pinned.

### Phase 6 — Write it down

[reader-lookup-decisions.md](reader-lookup-decisions.md) gains a "Taken"
section: pins are a kanji-run → reading map scoped to a book, checked before
the surface loop, bypassing the settings filter, with the sweep showing 0
changed when unset. Close `0cfac0-11` with that proof.

## Gates

- `yarn typecheck`, `yarn lint` 0 errors, prettier.
- Scoped `vitest run <path>` only — never the full suite.
- Furigana sweep: 0 of 67,299 changed with no pins set.
- `yarn check:tap-consistency` ≥ 98.0% / 128 pairs (pins do not touch the tap
  resolver; the gate is there to prove it).

## Decided, so it is not re-argued

- **Per book, not global.** Sam asked for per-book, and a name reading is a
  property of a book, not of Japanese. A later "everywhere" row in the same
  sheet is a small addition if it is wanted; it is not built now.
- **Keyed on the run, not on an entry id.** An entry id cannot express "show no
  furigana here", cannot express a reading no entry carries, and is not what
  the user pressed.
- **A pin overrides the settings filter.** Otherwise the gesture silently does
  nothing whenever the word is one the settings hide — which, for names, is the
  default.
- **No automatic learning from pins.** Pinning 杏子 in one book does not
  reweight the resolver anywhere. That is a separate idea and a much larger
  blast radius.

## Known limits, going in

- A re-imported copy of the same book has a new id and no pins.
- A pin matches the run **everywhere in that book**. 杏子 the character and
  杏子 the apricot in one novel cannot differ. Positional pins are the same
  unbuilt work as positional bookmark spans.
- A pinned run inside markup the book supplied (`<em>`, `<a>`) is refused
  rather than mis-rendered.
