# Reader defects from the 2026-10-02 reading session — plan v2

Supersedes [reader-defects-plan-v1.md](reader-defects-plan-v1.md), which was
written from screenshots before the shipping matcher had been run on them. v1
stays on disk as the record of what was believed; this file is what the
measurements say.

## What changed between v1 and v2

v1 grouped four reports as one job on the premise that they share the accept
loop's first guard in `packages/japanese-reader/src/bookmarks.ts`. Running the
shipping matcher (`explainBookmarkedWordSurfacesInHtml`) and the shipping
painter (`packages/reader-webview/src/bookmarks.ts`, under jsdom, through
`yarn why:highlight`) against the real `assets/dictionary.db` and a realistic
8,593-entry bookmark list says otherwise:

| queue       | report                       | reproduces? | what the code actually does                                   |
| ----------- | ---------------------------- | ----------- | ------------------------------------------------------------- |
| `0cfac0-14` | とけ inside やめとけ         | **yes**     | painted via とく imperative and とける masu-stem              |
| `0cfac0-15` | つい inside について         | **yes**     | painted only when つい is confirmed **elsewhere** on the page |
| `0cfac0-17` | もてあます not painted       | **no**      | もてあまして paints, end to end, on the real page text        |
| `0cfac0-13` | what is this タマ            | **no**      | nothing paints タマ; 魂 1579170 paints, correctly             |
| `0cfac0-12` | くどき highlighted not saved | n/a         | two different entries — see below                             |

So they are not one job, and v1's claim that "the first line is the whole of
`0cfac0-17`" is false: もてあます is not refused by that guard, because the page
writes it inflected.

## The measurements, so they can be re-run

A bookmark list in the export shape is all `yarn why:highlight` needs.
`yarn proxy:bookmarks` writes one: the top 8,586 entries by `entries.priority`
plus the ids named in these reports. An entry carrying any
particle, copula, auxiliary, conjunction, interjection, prefix or suffix sense
is left out, because nobody saves を. It is **a proxy, not the reader's own
list** — it paints 11.6% of the labelled page where the real list paints
10.5%. Its value is the diff across a change, not its absolute
coverage, and the numbers recorded in
[reader-lookup-decisions.md](reader-lookup-decisions.md) were taken against the
real list and are not comparable to it.

```
yarn proxy:bookmarks
yarn why:highlight --list .cache/proxy-list.jiten --text <page.txt>
```

### The gates, and where they stood on 2026-10-02

Every one of these was run before any change in this plan, so the baselines
are comparable within it.

| gate                                                                | baseline                           |
| ------------------------------------------------------------------- | ---------------------------------- |
| `yarn check:tap-consistency`                                        | 98.0%, 128 disagreeing pairs       |
| `yarn sweep:furigana --out <f>`                                     | 5,282 of 67,299 surfaces annotated |
| `yarn sweep:render --out <f>`                                       | 100 chunk hashes                   |
| `yarn why:highlight --list .cache/proxy-list.jiten --text <corpus>` | 1,267 surfaces, 5,655 boxes, 29.7% |
| …after positional spans                                             | 1,267 surfaces, 3,592 boxes, 19.0% |
| `yarn vitest run packages/japanese-reader/src/bookmarks`            | 96 tests                           |

### `0cfac0-14` とけ — reproduces

`そんなことはやめとけと言われた。` paints とけ, reached five ways: 解く/梳く,
説く and 溶く as an imperative, 解ける and 溶ける as a masu-stem.

The cause is in `deinflect.ts`, not in `bookmarks.ts`. ～とく, the spoken
contraction of ～ておく, is already modelled — including `いとけ`, `っとけ` and
`んどけ` for the godan te-stems — and a bare `とく → て` typed `V1` carries the
ichidan stems (見とく, 食べとく). The bare `とけ` of that pair is missing, so
やめとけ reaches nothing, `segmentRun` reads it as やめ + とけ (4 + 4) and both
halves are real tokens.

### `0cfac0-15` つい — reproduces, and it is case 37

`つい笑ってしまった。その件について話をした。` paints つい twice: once where it
is the adverb, and once inside について. Remove the first sentence and the
second つい is not painted at all. This is the flat-set shape already written
down as fixture case 37 — the matcher hands the painter a set of surfaces with
no positions, and the painter paints every occurrence of each.

### `0cfac0-17` もてあます — does not reproduce

`.cache/page2.txt`, the page Sam reported it from, transcribed as a single
paragraph (the column breaks are layout, not DOM), paints もてあまして from
1315750 via the te-form. Both the matcher and the painter agree. Nothing here
is broken, so nothing can be fixed without knowing what differed on the device
— the candidates are a bookmark on some other entry, or a slice boundary.

### `0cfac0-13` タマ — does not reproduce

No entry in the dictionary paints the surface タマ: 魂 1579170 has the kana rows
たましい and たま, and the matcher paints a surface **as the page writes it**, so
a katakana タマ is never produced by a hiragana kana row. Confirming たま
elsewhere on the page does not produce it either.

What 魂 1579170 does do is paint 魂, correctly, because it is bookmarked. The
reading Sam saw is therefore ruby over a correctly painted kanji, and the
resolver gives 魂 → たましい, so it is the book's own ruby. That makes the
report an answer, not a defect — subject to Sam confirming the page prints
魂《タマ》.

### `0cfac0-12` くどき — answered

口説く is 1276490 and 口説き is 2521460: two entries. The box is painted from
the bookmarked verb via its masu-stem; the popup's first chip is the noun,
which is a different entry and is not saved. Working as designed, and the
general form of it — a painted span whose provenance entry is not the tap's top
entry — is the coherence gap `paintedBookmarkSpans` was written to narrow.

## The iOS callout — `0cfac0-18`

Four things have now been tried, and the first two are written down so they
are not tried again.

- **23.22 — `user-select: none` always on `#content`.** Killed the bar and
  broke two things: a tap found its word and showed no purple, except on words
  carrying furigana, and the long press stopped finding its run at all. The
  purple half points at `::highlight()`, because ruby is painted with a
  `.highlight` CLASS instead and ruby kept working. The long-press half is
  **not** explained by that, and is not explained by the caret either — the
  tap uses the same `resolveCaretAt`, and the tap still found its word.
  Neither half was ever proven.
- **23.23 — the same rule behind a class the press turns on.** Tap, highlight
  and long press came back; the bar did not go away. The class goes on at
  `touchstart`, and WebKit has decided on its gesture before that runs — the
  page's touch listeners are all `{ passive: true }`, so it could not have
  refused the gesture even if it had been in time.
- **Now — `textInteractionEnabled={false}`.** WebKit's own text interaction,
  off at the preference: no selection, so no bar to raise over one. This is a
  `WKPreferences` value rather than a style, so `caretRangeFromPoint` is
  untouched — which is what 23.22 was approximating and getting wrong — and
  the reader's selection is its own code and untouched with it.
- **Also `suppressMenuItems`.** Second line of defence. It is a
  `canPerformAction:` filter over a fixed selector map, so it reaches Copy,
  Cut and Paste but not Look Up, Explain or Open in, which are menu elements
  rather than actions. On its own it would not have been enough.

**If the bar still comes, in order:**

1. **`menuItems={[]}`.** Makes `canPerformAction:` refuse everything and
   strips `UIMenuLookup` — but the library also installs its own long-press
   recogniser when it is set, which presents an edit menu of its own, so this
   is not the first thing to reach for.
2. **A non-passive `touchstart` with `preventDefault()`.** The mechanical
   reason 23.23 was too late. The risk is the synthetic `click` the reader's
   tap depends on, so the tap has to be re-checked on the device.
3. **Always-on `user-select: none`, with the caret fallback widened first.**
   `resolveCaretAt` rescues an element container only for `.bookmarked-word`
   and `ruby`; it would have to descend to the text node under the point.
   Only then is 23.22's arrangement survivable, and only then is it worth
   settling whether `::highlight()` really stops painting — which desktop
   Safari can answer from this machine, since the bundle is a plain page.

**Verification is Sam's device.** jsdom has no gesture recogniser. Ship one
change at a time and ask.

## Order

1. ~~**Positional spans**~~ (`0cfac0-15`, fixture case 37) — **done**. The
   matcher hands the painter offsets within each visible run instead of a bare
   set. Written up in
   [reader-lookup-decisions.md](reader-lookup-decisions.md), "A bookmark is
   painted where it was confirmed".
2. ~~**The missing `とけ`**~~ (`0cfac0-14`) — **done**, with its cost pinned
   as fixture case 42.
3. **The iOS callout** (`0cfac0-18`) — `suppressMenuItems` shipped; the ladder
   above is what to try if it is not enough.
4. **The furigana name floor** (`0cfac0-16`, `0cfac0-10`). Unchanged from v1.

`0cfac0-13` and `0cfac0-17` are answered rather than fixed, and both are pinned
as fixture cases so that a later change to either is a decision and not a
surprise.
