# Open defects, found 2026-10-01

Real defects found while shipping the name-reading frequency work and
diagnosing bookmark highlighting, which belong to neither. Written down so they
are not rediscovered from scratch. **Nothing here is fixed.**

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

## 3. Lists are lazy, and the reader depends on them

Recorded in full under "Related observations" in
[bookmark-highlight-bugs-v1.md](bookmark-highlight-bugs-v1.md). In short:
`app/(tabs)/reader/[bookId].tsx:479` reads `useListsStore`, but only the Lists
tab hydrates it, so the reader's list-exclusion chips are invisible until that
tab has been visited. `highlightableLists` additionally filters out the default
list, so a single-list user has nothing to exclude even once it hydrates.
