# Bookmark highlighting — observed bugs, v1

Opened 2026-10-01 while reading ダブル・ファンタジー 上 at 6.9% with the whole
Common list highlighted. Sam: "every single highlight is wrong."

**This file records findings only. No fix is proposed in it yet.** Each
highlight is diagnosed one at a time against the real bookmark set, and the
mechanism is written down before anything is changed.

## Setup

- **Bookmark set**: the "Common" list, exported from the device as
  `jiten-list-v2`. **8,586 entries**, imported originally from a Midori folder.
- **Every list is active.** The list chips that would let a list be left out
  are at `app/(tabs)/reader/[bookId].tsx:1162` and were not reachable — see
  "Related observations" below — so the page is being marked against all 8,586.
- **Diagnostic**: `yarn why:highlight --list <export.jiten> <surface>` reports
  every bookmarked entry that can produce a span, with the deinflection path
  that reached it. It reproduces the question
  `resolveBookmarkedWordSurfacesInHtml` asks.

## How the highlighter decides (as built)

`packages/japanese-reader/src/bookmarks.ts`:

1. `extractBookmarkCandidateSurfaces` walks the slice HTML and emits **every
   substring up to 10 characters starting at every Japanese character**. There
   is no notion of a word boundary and no look at what precedes a start.
2. Each candidate is run through `deinflect`, giving (word, reasons) pairs.
3. Each word is looked up in `kanji` and `kana`. A hit on a bookmarked
   `entry_id` adds the **candidate as written** to the highlight set.
4. A guard on the kana side: "a bare kana reading of a word the dictionary
   writes in kanji is not evidence the page means that word — a bookmarked 事
   would light up every こと. An undone inflection is." So a kana candidate
   whose entry has kanji is skipped **unless `inflected` is true**, where
   `inflected` means deinflection applied at least one rule.
5. `applyBookmarkHighlightsToHtml` then paints greedily, longest surface first,
   from every position.

## Findings

### 1. はない in 「で|はない|。」 (column 1, top)

The box covers **はない**, not ではない — the で is outside it.

```
=== はない ===
  entry 1427900  張る/貼る [はる]  common
    matched "はる" via negative; entry written in kanji: yes
    pos v5r,vt,vi — to stick, to paste, to affix, to stretch, to spread, to strain
```

The chain: candidate `はない` → the **negative** rule strips ない → `はる` →
entry 1427900 張る/貼る is bookmarked → paint `はない`.

Two independent defects produce it.

**1a. The span begins on a particle.** The は belongs to `では`. Candidate
generation starts a substring at every character without asking what precedes
it, so a span may begin in the middle of a word or on a grammatical particle.
The tap path already refuses this class — `smartLookupWithOffset` rejects a
span starting inside a word's okurigana, recorded in
`reader-lookup-decisions.md` — and the highlighter has no equivalent.

**1b. The kana guard is inverted by deinflection.** 張る is written in kanji and
never spelled はる in this sentence, so step 4's guard exists precisely to
refuse it. It does not fire, because the negative rule set `inflected: true`
and an undone inflection is treated as _stronger_ evidence than a bare kana
match.

That treatment is backwards here. A kana-only surface that reached a
kanji-written word **by deinflection** is weaker evidence than a bare kana
match, not stronger, because the deinflection step is itself a guess that can
be wrong — and here it was: ない is not an inflection of 張る in this sentence,
it is the negative of です.

## Related observations

Not highlights, but found while diagnosing and worth not re-deriving.

- **The list chips never appeared.** `app/(tabs)/reader/[bookId].tsx:479` reads
  `useListsStore((state) => state.lists)`, but only the Lists tab ever hydrates
  that store. Until Lists is visited, `allLists` is empty, `highlightableLists`
  is empty, and the chip block at :1162 collapses — so the "Bookmarked words"
  toggle sits directly above "Page animations" with nothing between them.
  Confirmed by Sam: visiting Lists and returning makes the chips appear.
- **The chips also hide the default list.** `highlightableLists` filters
  `!list.isDefault`, so a user whose bookmarks all live in the default list has
  nothing to exclude even after the store hydrates.

## Still to diagnose

The remaining highlights on that page, in reading order. None of these has been
measured yet; the list is here so the walkthrough can resume where it stopped.

| column | spans                                                    |
| ------ | -------------------------------------------------------- |
| 1      | 一緒, 励み                                               |
| 2      | 通, おいしい, して                                       |
| 3      | 行く, 岩盤浴, し                                         |
| 4      | て流し, しめくくり, 夜更け                               |
| 5      | という, している                                         |
| 6      | 飽きない                                                 |
| 7      | 互いに, 引き                                             |
| 8      | だち, 欲しかった, わたる                                 |
| 9      | 欲しくても, 我慢して, きた, もの, はいくつ, ある, けれど |
