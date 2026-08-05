# Japanese Reader Extraction Plan

## Goal

Extract Jiten's ebook reader into a reusable package **without** compromising the Jiten product in behavior, performance, or future maintainability.

This is **not** a plan to create a low-level ebook reader toolkit.

This **is** a plan to extract a:

- feature-rich
- highly opinionated
- Japanese learner reader

with built-in:

- vertical Japanese pagination
- tap lookup
- drag-selection lookup
- auto word/name behavior
- furigana generation
- bookmarked-word highlighting
- staged loading
- reader runtime bridge

The reusable package should be usable by third parties **if they provide Jiten-compatible data and storage semantics**.

Jiten remains the primary product. Extraction must flow **outward from Jiten**, not inward from a hypothetical generic library.

## Non-goals

This extraction should **not**:

- turn the reader into a generic ebook engine
- force consumers to reimplement lookup/furigana/bookmark logic
- degrade performance to satisfy prettier abstractions
- move product UI chrome into the reusable package
- make Jiten itself slower, more complex, or harder to evolve

## Product Boundary

The extracted reader should be a high-level package:

- `@tradersamwise/japanese-reader`

It should sit on top of:

- `@tradersamwise/japanese-reader-core`
- `@tradersamwise/reader-webview`

### What stays built in

These behaviors are part of the product value and should remain built in:

- word/name/counter-aware lookup heuristics
- tap and drag lookup orchestration
- furigana generation pipeline
- bookmarked-word highlight pipeline
- slice generation and transform ordering
- caching and invalidation behavior
- loading/reload orchestration
- theme/font/page-animation runtime bridge behavior

### What remains app-owned

These stay outside the reusable package:

- screen header/navigation chrome
- settings sheet UI
- dictionary popup UI
- library/source browsing UI
- sync/auth/product-specific screens

The package should provide the learner-reader engine and controller, not the full Jiten screen.

## Public API Shape

This must be decided before implementation.

The extracted package should be **headless controller first**, not a monolithic host component.

Target:

```ts
const reader = useJapaneseReader({
  bookId,
  bookSource,
  dataBackend,
  settings,
  lookupMode,
});
```

The controller should return enough state and handlers for the app shell to wire the screen without owning reader internals.

Expected return shape:

- `html`
- `book`
- `loadingState`
- `readerViewProps`
- `readerCommands`
- `settingsActions`
- `lookupState`
- `selectionState`
- `reloadAtChar`

More concretely:

```ts
type UseJapaneseReaderResult = {
  html: string | null;
  book: ReaderBookRecord | null;
  loading: {
    visible: boolean;
    title: string;
    detail: string;
    currentStep: number;
    totalSteps: number;
    stepDurationMs: number;
  };
  readerViewProps: {
    html: string;
    onMessage: (data: string) => void;
  };
  readerCommands: {
    setTheme(theme: ReaderTheme): void;
    setFontSize(size: number): void;
    setPageAnimations(enabled: boolean): void;
    clearHighlight(): void;
    focus(): void;
  };
  lookup: {
    loading: boolean;
    error: string | null;
    results: LookupResult[];
    clear(): void;
  };
  selection: {
    tooltip: SelectionTooltip | null;
    popupVisible: boolean;
    showJumpSlider: boolean;
  };
  reloadAtChar: (charOffset: number) => Promise<void>;
  applySettingsDraft: (draft: ReaderSettingsDraft) => Promise<void>;
};
```

This keeps:

- the package headless
- `ReaderView` reusable
- the Jiten screen in charge of UI shell only

We should **not** defer this API decision until later.

## Architecture Target

### 1. `@tradersamwise/japanese-reader-core`

Already exists.

Owns:

- text parsing
- content slicing
- HTML generation
- reading helpers
- shared pure utilities

Must remain free of app stores, Expo screens, and concrete DB modules.

### 2. `@tradersamwise/reader-webview`

Already exists.

Owns:

- pagination runtime
- gestures
- text hit testing
- highlight handling
- WebView bridge

Must remain free of app stores, Expo screens, and concrete DB modules.

### 3. `@tradersamwise/japanese-reader`

Implemented package. This is the reusable Jiten-compatible reader product.

Should own:

- reader controller/session orchestration
- reader load/reload flow
- slice caching layers
- transform pipeline orchestration
- theme/font/page-animation bridge integration
- staged loading model
- built-in lookup orchestration
- built-in furigana orchestration
- built-in bookmark-highlight orchestration

This package should be opinionated and batteries-included.

## Reactive Settings Contract

Settings are not a static config bag in the current app. They are reactive and affect:

- runtime bridge updates
- transform reloads
- lookup behavior
- bookmark highlighting

The package should therefore accept **controlled reactive values**, not a one-time config object and not a package-owned store.

Target shape:

```ts
type UseJapaneseReaderInput = {
  bookId: string;
  bookSource: ReaderBookSource;
  dataBackend: JapaneseReaderBackend;
  settings: ReaderSettingsValue;
  lookupMode: ReaderLookupMode;
};
```

Where:

- React drives updates through normal prop changes
- the controller computes diffs and invalidation scopes internally

We should **not** require a custom subscription adapter for settings unless React-controlled props prove insufficient.

## Bookmark Membership Contract

Bookmarks should not be modeled as a dictionary query capability.

In Jiten today, bookmark membership is an in-memory reactive set, not a DB lookup.

So bookmarks need their own contract slot.

Target shape:

```ts
type ReaderBookmarkMembership = {
  version: string;
  hasEntryId(entryId: number): boolean;
};
```

For React usage, the host app is responsible for supplying a new `version` and updated membership snapshot when bookmarks change.

The reader package should not import or know about Jotai/Zustand/store implementations.

This preserves:

- no polling
- no DB re-query requirement for bookmark membership itself
- deterministic cache invalidation keyed by bookmark version

## Jiten-first Performance Constraint

Performance regression is unacceptable.

That means extraction must preserve:

- current query shapes
- batching behavior
- cache layering
- slice-local transforms
- runtime-only updates for theme/font/page animations

Any public abstraction that causes:

- per-surface callbacks
- per-entry lookups
- row-by-row resolution
- hidden N+1 behavior
- loss of batching

is the wrong abstraction.

## Main Design Question

There are two broad options for data integration:

### Option A: high-level adapters

Example:

- `lookupWords(surfaces)`
- `lookupNames(surfaces)`
- `lookupCounters(surfaces)`
- `getKanjiMetadata(kanji)`

Pros:

- nicer public API
- easier to explain
- more backend-flexible

Cons:

- higher risk of hidden performance regressions
- easier to accidentally force JS-side recomposition or repeated round trips
- harder to guarantee parity with current Jiten query behavior

### Option B: SQL-like / schema-aware backend contract

Example:

```ts
type ReaderSqlDb = {
  getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
  getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
  runAsync?(sql: string, params?: any[]): Promise<any>;
};
```

Pros:

- closest to current Jiten behavior
- easiest to preserve batching and performance exactly
- smallest risk to current lookup/furigana/highlight logic

Cons:

- uglier public interface
- more schema-coupled
- less portable across arbitrary backends

## Recommended Direction

Favor a **Jiten-compatible backend contract** over a too-pretty abstraction.

This package is valuable because it is Jiten extracted outward, not because it is ultra-generic.

So the preferred model is:

- built-in Jiten reader behavior
- data backend contract close enough to current storage/query needs to preserve performance
- third parties can plug in if they provide compatible data/storage

This is a legitimate product decision.

### Portability statement

This package is **not** intended to support arbitrary backends with arbitrary schemas.

Third-party usability should be described honestly as:

- reusable if you provide a Jiten-compatible backend
- not “works with any database”

That should be reflected in docs and package positioning.

## Capability Model

The extracted package should support missing capabilities gracefully where possible.

Missing capabilities should disable dependent features, not break the whole reader.

Warnings should happen **in code**, not UI.

No silent fallthrough.

### Capability buckets

At minimum, think in terms of:

- `books`
- `progress`
- `sourceFurigana`
- `dictionaryWords`
- `dictionaryNames`
- `dictionaryCounters`
- `kanjiMetadata`
- `jlptKanji`
- `bookmarks`

### Core required capabilities

For the full packaged reader path, likely required:

- book content source
- word dictionary capability

### Optional capabilities

Optional:

- names
- counters
- kanji metadata
- JLPT kanji
- bookmarks
- progress persistence

### Graceful degradation rules

#### No bookmarks

- bookmarked-word highlight feature disabled
- no bookmark-aware reader styling
- reader still works

#### No names

- auto/name logic falls back to word-only behavior
- no name furigana

#### No counters

- counter-specific lookup/furigana disabled
- fallback to regular word behavior

#### No kanji metadata / JLPT data

- level-based furigana rules disabled
- source furigana still works
- basic non-level-dependent furigana paths may still work

#### No progress persistence

- reader works in-memory
- no saved reading position

#### No book storage

- packaged library loading cannot work
- direct raw-content mode may still be possible if we choose to support it later

## Warning Model

Warnings should be:

- emitted in code, not UI
- one-time
- capability-level
- deterministic
- outside hot loops

We should add a small `warnOnce(key, message)` utility and validate capabilities when constructing the reader/controller.

Capability validation must happen:

- at controller construction / first setup
- before any reader pipeline work begins

It must not wait until after a half-broken first render.

Example:

```ts
[japanese-reader] Name furigana requested, but no name dictionary capability was provided. Disabling name furigana.
```

The package should never silently pretend a requested feature is active when the backend cannot support it.

## Backend Contract Strategy

There are two realistic versions:

### Version 1: exact Jiten schema compatibility

Simplest and safest.

Third parties provide:

- a DB compatible with Jiten's required reader tables
- progress/book storage integration

This best preserves existing behavior and performance.

### Version 2: reduced reader-only schema

A smaller schema specifically for the extracted reader.

Still likely SQL-shaped and performance-oriented, but narrower than full Jiten.

This is potentially a better long-term public interface, but it should **not** be invented prematurely if it forces churn in Jiten.

### Recommendation

Start from **exact or near-exact Jiten compatibility**.

Only consider a reduced schema after extraction is stable and proven not to compromise Jiten.

## Extraction Strategy

Implementation work may be staged internally, but the delivered result must be a **single hard cut** once the seam is ready.

That means:

- no long-lived parallel old/new reader logic paths
- no compatibility re-export layer left behind
- no transitional adapter shims left behind
- no dead orchestration paths left in the app

Seam creation is incremental only as an execution strategy. The final architecture must be one path.

### Phase 1: backend contract refactors in isolation

First refactor the smallest, most testable modules onto the new backend contract:

- `smart-lookup`
- `reader-furigana`
- `reader-bookmarks`

This is lower risk than starting with a 2,000+ line screen extraction.

Goal:

- prove the backend contract
- preserve batching/performance
- keep unit-testable surface area small

### Phase 2: local Jiten backend modules

Create local Jiten-backed backend modules that wrap current DB/store access.

Examples:

- `lib/reader-backends/jiten-book-source.ts`
- `lib/reader-backends/jiten-reader-backend.ts`

Note:

- `lib/reader/` does not currently exist
- do **not** create a broad directory reshuffle as part of the first seam
- prefer flat `lib/reader-*.ts` or a narrowly introduced `lib/reader-backends/` only when needed

### Phase 3: local controller extraction

Before creating a new package, extract the orchestration out of:

- `app/(tabs)/reader/[bookId].tsx`

into a local hook first:

- `lib/use-japanese-reader-controller.ts`

This step should be treated as **behavior-preserving by verification**, not by assertion.

Goal:

- screen becomes a thin UI shell
- orchestration becomes separable
- Jiten remains fully functional during the transition

### Phase 4: move orchestration into package and cut over

Once the seam is proven locally, move the controller into:

- `packages/japanese-reader`

This package should expose:

- `useJapaneseReader(...)`
- relevant types
- maybe a thin host component later if it proves useful

### Phase 5: delete transitional paths and finish the hard cut

Before calling the extraction done:

- delete old local orchestration paths
- delete temporary compatibility helpers
- delete dead imports and dead caches
- ensure the app uses only the new extracted path

### Phase 6: document and example

Add:

- backend contract docs
- schema requirements
- capability matrix
- minimal integration example

Only then is the package meaningfully consumable by third parties.

## Verification Bar

“Should not change behavior” is not enough. Each phase needs a measurable bar.

### Required parity checks before controller extraction lands

For at least one known book and one known settings set:

- snapshot or golden-output parity for:
  - base slice HTML
  - furigana-applied slice HTML
  - bookmark-highlighted slice HTML
- lookup parity for:
  - tap lookup
  - selection lookup
  - name/counter edge cases already covered by tests

### Required performance checks

On device or simulator, capture before/after timings for:

- cold load
- closing settings after furigana change
- bookmark highlight toggle
- font size change

If any phase makes these materially worse, the extraction step fails.

## Current Responsibility Mapping

Today, `app/(tabs)/reader/[bookId].tsx` is still doing too much:

1. app screen UI
2. reader controller/session orchestration
3. Jiten-specific backend integration

The extraction should split those responsibilities into:

### Package-owned

- session orchestration
- transforms
- loading model
- cache invalidation
- bridge runtime coordination

### Jiten backend modules

- `userDb` book/progress persistence
- `dictDb` / `extendedDb` dictionary access
- bookmark membership state

### Jiten screen UI

- header controls
- settings panel UI
- popup UI
- source/library actions

The controller extraction should move orchestration out, but the screen should remain the owner of:

- `ReaderView` placement
- popup rendering
- settings overlay rendering
- header/actions

## Invariants That Must Hold

These are non-negotiable.

### Slice-local transforms

All optional post-processing after base slice generation must remain slice-local.

No work should scale with:

- total book size
- total bookmark count
- total dictionary size
- total library size

unless that work is explicitly part of parsing/model creation.

### Runtime-only settings stay runtime-only

These must not trigger heavy regeneration:

- theme
- page animations
- font size for visible-content updates

### Feature parity

The extracted package must preserve:

- current lookup behavior
- current furigana behavior
- current bookmark highlighting behavior
- current caching behavior
- current performance characteristics

### Jiten-first safety rule

If an extraction step makes Jiten:

- slower
- more complex
- harder to reason about
- harder to evolve

the extraction approach is wrong and should be rejected.

## Main Risks

### Risk 1: performance regression from abstraction

This is the biggest risk.

If the backend contract is too high-level or too callback-shaped, it will cause:

- hidden N+1 behavior
- repeated round trips
- JS-side recomposition of data that should stay query-local

### Risk 2: packaging too early

Moving code into a package before the seam is clean will freeze bad boundaries.

### Risk 3: over-generalization

If we over-abstract behavior, we destroy the differentiating value of the reader.

This package should remain strongly opinionated.

### Risk 4: wrong package naming / layering

`@tradersamwise/japanese-reader-core` and `@tradersamwise/reader-webview` are siblings, not a stack.

The current names are acceptable for now, but we should keep in mind:

- `@tradersamwise/japanese-reader` should likely be the public re-export surface
- `-core` may later deserve a narrower name if it causes confusion about layering

Do not rename packages in the first extraction pass. That is secondary to getting the seam right.

## Decision Summary

The recommended direction is:

- Jiten-first
- built-in learner-reader behavior
- data-backend contract shaped by performance needs
- graceful capability-based degradation
- warnings in code, not UI
- local seam extraction first
- package move second

This should be treated as:

- **Jiten extracted outward**

not:

- **a generic library designed inward**

## Next Concrete Design Pass

Before implementation, we should review:

1. the exact backend contract shape
2. required schema/tables/indexes
3. capability matrix per feature
4. the exact controller boundary to extract from `[bookId].tsx`
5. the public hook return shape
6. the verification bar for each phase

That review should happen before any large code move.
