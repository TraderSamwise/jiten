# Open defects, found 2026-10-01

Real defects found while shipping the name-reading frequency work and
diagnosing bookmark highlighting, which belong to neither. Written down so they
are not rediscovered from scratch. **A heading says so where one has since been
fixed; the rest are open.**

Bookmark highlighting has its own files:
[bookmark-highlight-bugs-v1.md](bookmark-highlight-bugs-v1.md) and
[bookmark-highlight-plan-v1.md](bookmark-highlight-plan-v1.md).

## 1. Furigana does not re-resolve when the extended DB changes under a session

**Symptom.** Extended DB v4 shipped with `name_freq`; the device downloaded and
loaded it (`Extended: yes (v4) / loaded: yes`), and 杏子 still read あんず. A
hard restart of the app fixed it.

**Cause.** `packages/japanese-reader/src/use-japanese-reader.ts` clears
`furiganaEntryCacheRef` and `furiganaSliceHtmlCacheRef` on exactly two events:

- opening a book (`clearBaseAndTransformCaches`, ~line 964)
- a furigana **setting** changing (`clearFuriganaCaches`, ~line 1171)

`extendedDb` is an input to resolution (it is in the dependency list of the
resolve callback, ~line 747) but **no path invalidates the caches when it
changes identity**. Slices resolved before the swap keep their old readings.

**Why it matters beyond this release.** The extended DB downloads in the
background on first install. Any user who is reading while that finishes gets
no name or counter furigana until they reopen the book or restart — and
nothing tells them why. This has presumably always been true.

**Not yet decided**: whether to treat an extended-DB identity change as a
settings change (reusing the existing clear-then-`reloadAtChar` path, which is
proven) or to add a separate effect. A boolean `!!extendedDb` is not enough —
a v3→v4 swap is truthy both sides, so it needs the handle identity or a
counter.

**Still open, and the first option now has a worked example.** The pinned-reading
work (`572f627`) needed the same thing for a different input: a pin is not a
furigana setting, but it changes what the page shows, so it joins
`ReaderTransformSettingsSnapshot` as `furiganaPinsKey` and the existing
clear-then-reload effect does the rest. An extended-DB identity would go in the
same place. Pins also give the user a way around this defect by hand — pin the
reading and it appears whatever the DB is doing — which is a workaround, not a
fix.

## 2. `publish-dict.sh` reports success without waiting when only a sub-tier changed

**Symptom.** `yarn publish:dict` printed
`✅ Published ... (v23, CDN live after 1x5s)` while the CDN was still serving
`extended.version: 3`. A cache-busted fetch a moment later showed 4.

**Cause.** `scripts/publish-dict.sh` polls the published manifest and compares
only the **top-level** `version`:

```sh
EXPECTED_VERSION=$(grep -o '"version": [0-9]*' "$ASSETS_DIR/dict-manifest.json" | head -1 ...)
```

`head -1` takes the base dictionary version. When only `extended` or `strokes`
changed, the top-level version is unchanged, so the first poll matches
immediately and the loop exits having waited for nothing.

**Consequence.** The script's propagation guarantee is void for every
extended-tier or strokes-tier release — exactly the releases where it matters,
since those are the ones that ship without a base DB bump. An OTA sent straight
afterwards can reach devices before the DB does.

**Also worth knowing**: the script uploads all six DB files with `--clobber`
every time, roughly 580 MB, even when one changed. Before a publish it is worth
comparing local file sizes against the published manifest to confirm nothing
else has drifted locally — on 2026-10-01 only `dictionary-extended.db` differed
and the other four matched byte counts exactly.

## 3. Lists are lazy, and the reader depends on them — **fixed**

`app/(tabs)/reader/[bookId].tsx` reads `useListsStore` for the chips that let a
list be left out of highlighting, and only the Lists tab hydrated it, so the
chips were invisible until that tab had been visited.

**One part of the original note was wrong**: bookmarks were never affected.
`app/(tabs)/_layout.tsx` has always loaded `useBookmarkStore` in an effect
keyed on the user database, and the tab layout is an ancestor of the reader —
so highlighting itself worked on a cold start. Only the lists were missing.

Fixed by `lib/hydrate-user-stores.ts`, which loads both, called from that same
effect and from `db/sync-provider.tsx` in place of its own copy of the pair.
Pinned by `lib/hydrate-user-stores.test.ts` (prove-failed).

**Still open, and the owner's call**: `highlightableLists` filters out the
default list, and `useBookmarkStore.load` filters `l.is_default = 0`, so words
saved only to the default list are never highlighted and nothing says why. The
two filters agree with each other, so this is a deliberate design that has
never been stated rather than a bug — but a user with one list, the default
one, sees a highlighting setting that does nothing at all.
