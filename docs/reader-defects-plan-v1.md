# Reader defects from the 2026-10-02 reading session — plan v1

**Status: planned, not started.** Nothing in here has been attempted.

Seven reports from Sam reading ダブル・ファンタジー 上 on 23.24. They are three
pieces of work, not seven, and the grouping is the point of this document: four
of them share one guard and one gate, so fixing them one at a time means
re-running the same measurement four times and watching each fix undo the last.

| queue       | report                                            | category |
| ----------- | ------------------------------------------------- | -------- |
| `0cfac0-12` | くどき highlighted but not bookmarked?            | answered |
| `0cfac0-13` | what is this タマ?                                | 1        |
| `0cfac0-14` | とけ painted inside やめとけ                      | 1        |
| `0cfac0-15` | つい inside について                              | 1        |
| `0cfac0-17` | もてあます bookmarked but not painted             | 1        |
| `0cfac0-16` | 後味 — ごみ or あとあじ, and why do they disagree | 2        |
| `0cfac0-18` | long press still raises the iOS Copy/Explain bar  | 3        |

Related and already on the board: `0cfac0-10` (後味 furigana, at `wontdo`
awaiting a ruling) and `0cfac0-11` (the pinned-reading feature, `done`).

## What was already measured, 2026-10-02

Run against the real `assets/dictionary.db` through
`explainBookmarkedWordSurfacesInHtml` — the shipping matcher — with only the
named entry bookmarked:

| run        | bookmarked              | painted?                      |
| ---------- | ----------------------- | ----------------------------- |
| とけ       | とける 1198910, 1546070 | **yes** — via kana, masu-stem |
| くどき     | 口説く 1276490          | **yes** — via kana, masu-stem |
| タマ       | 魂 1579170              | no                            |
| つい       | つい 1008030            | no                            |
| もてあます | もて余す 1315750        | no                            |

Dictionary facts established at the same time:

- 魂 1579170 has kana rows たましい and たま only. **タマ is not a kana headword
  anywhere in JMdict**, so the katakana on the page is reaching たま through
  normalisation. Other たま entries: 1240530 (玉, 球, 珠, 弾, 璧), 2068840
  (偶, 適).
- もて余す 1315750 has kanji forms もて余す and 持て余す, kana もてあます, and
  **no `uk` in `senses.misc`** — so "usually written in kana" cannot be the
  discriminator.
- 後味: the JMnedict surname ごみ scores 2455, the non-common word あとあじ
  2260, and 高遠 → たかとお — which must keep working — scores identically
  (non-common word, strong-type name, kanji-only surface).

## Blocked on one thing

**Sam's bookmark list, exported.** Two of the four in category 1 could not be
reproduced from the dictionary alone, which means the entry that paints タマ and
つい is some saved word I have not guessed. The Lists tab exports a `.jiten`
file (`components/ExportListModal.tsx`), and
`yarn why:highlight --list <file> --text <page.txt>` then names the exact entry
and deinflection path behind every painted span on that page.

Until that lands, category 1 can be started — the guard work below does not
depend on it — but it cannot be _finished_, because two of its four cases have
no reproduction to pin as a fixture.

---

## Category 1 — what gets painted

`0cfac0-13`, `0cfac0-14`, `0cfac0-15`, `0cfac0-17`.

### Why these are one job

All four land in the accept loop of
`packages/japanese-reader/src/bookmarks.ts`:

```ts
if (via === "kana" && entryIdsWithKanji.has(entryId) && !inflected) continue;
if (
  via === "kana" &&
  entryIdsWithKanji.has(entryId) &&
  isOtherCommonWordAsWritten(surface, entryId)
)
  continue;
if (!entryAdmitsInflection(typeMask, entryMask)) continue;
if (!confirmed.has(surface)) continue;
```

The **first line is the whole of `0cfac0-17`**: any uninflected kana surface of
an entry that has kanji forms is refused, so もてあます — written in kana by the
book, kanji in the dictionary — never paints. It is also what correctly refuses
タマ. Loosen it for もてあます and `0cfac0-13` comes back; leave it and
もてあます stays invisible. One decision, two reports.

`0cfac0-14` and `0cfac0-15` are the other half: a short bookmarked word painted
where a longer word stands. とけ is a legal masu-stem of とける and やめとけ is
not in JMdict, so `segmentRun` sees やめ + とけ, both real tokens, and confirms
とけ. つい inside について is the same shape, except that について **is** a
dictionary word and wins the DP — so if つい is painted there at all it is the
known non-positional confirmation (a surface confirmed anywhere on the page is
painted everywhere on it), which is fixture case 37 and the unbuilt
positional-spans work.

### Plan

1. **Reproduce all four as fixture cases** in
   `test/fixtures/bookmark-highlight-cases.ts`, using the real entry ids from
   Sam's export. Two will be `knownRed`. Nothing is changed in this step — the
   point is that the four stop being screenshots.
2. **Separate the two kana cases on evidence, not taste.** The question is what
   distinguishes もてあます (should paint) from タマ (should not). Candidates to
   measure, in order of cheapness:
   - the surface's script: タマ is katakana standing for a hiragana kana row,
     もてあます is the kana row as written. A katakana surface matching a
     hiragana kana form of a kanji entry is a different thing from a kana
     spelling of a kana-written verb.
   - `isOtherCommonWordAsWritten` alone, with the unconditional first guard
     dropped — たま is also 玉/球, a common word; もてあます spells nothing
     else. This is what the second guard was written for, and the first may
     simply be redundant with it.
   - entry `common` and the kana row's own `common` flag.
3. **Decide とけ.** There is a solution and it is not cheap: やめとけ is a
   contraction of やめておけ, which the deinflector does not model. The honest
   options are (a) teach `deinflect` the ～とけ/～とく contraction so やめとけ
   becomes a token and とけ stops being one, or (b) accept it. (a) touches the
   tap resolver too and must be measured against `check:tap-consistency`.
4. **Leave つい to positional spans** unless the export shows otherwise. It is
   already written down as case 37 and in
   `reader-lookup-decisions.md`; do not re-derive it.

### Gates, all of which must be run together

- The labelled page: 9 boxes, 10.5% of characters. `yarn why:highlight --list
<export> --text <page>` before and after, read **every** entry in the diff.
- Corpus surface count over `test/corpus/bocchan.txt`: 919 surfaces, 2,141
  boxes, 15.4%. A guard change moves this; the number alone is not a verdict,
  the diff is.
- `yarn check:tap-consistency` ≥ 98.0% / 128 pairs.
- `yarn sweep:furigana` — a guard in `bookmarks.ts` should not move it at all;
  if it does, something is wired wrong.
- Scoped `vitest` over `packages/japanese-reader/src/bookmarks*`,
  `lib/reader-furigana.test.ts`, `packages/reader-webview`.

### Decided already, do not re-litigate

- The tap resolver is not the boundary judge: measured, 10× slower, and it
  rejects 励み / 帰り / しめくくり.
- Weighting kana-spelled kanji words lower: measured, fixes きこんで, costs nine
  fragments.
- Positional spans are the right answer to the "confirmed here, painted there"
  family and are not built. Named, measured, pinned as case 37.

---

## Category 2 — furigana name versus word

`0cfac0-16`, which is `0cfac0-10` seen a second time.

**The answer to the question asked**: 後味 is あとあじ. 後味が悪い is the set
phrase; ごみ is a surname and wrong here. The two disagree because they are two
resolvers — `resolveFuriganaBatch` scores the name above the word,
`smartLookupWithOffset` does not — and that is by design, not drift.

**Already ruled**: no feature in JMdict or JMnedict separates "name that should
win" from "name that should lose" for this pair, because 高遠 → たかとお scores
identically and must keep working. That is why `0cfac0-10` sits at `wontdo`.

**What changed since that ruling**: the pinned-reading feature shipped
(`0cfac0-11`). Long-press 後味, pin あとあじ, and that book reads it correctly
for good — and the picker now leads with あとあじ rather than ごみ, because a
name reading only leads where the spelling has settled on it.

**Plan**: fold `0cfac0-16` into `0cfac0-10` rather than track the same defect
twice, and leave the ruling to Sam. If he wants it pursued, the only untried
lever is a name-frequency floor applied to the _furigana resolver_ the way the
picker now applies one — 後味 → ごみ has no observed count at all, 高遠 →
たかとお has 4 of 4. That is a real difference and it was not available when the
original ruling was made. It would need the full furigana sweep over all 67,299
corpus surfaces, every entry in the diff read.

---

## Category 3 — the iOS callout

`0cfac0-18`.

**State**: still raising the Copy | Explain | Open in bar on 23.24, and I do not
know why. The suppression is a class, `suppress-native-selection`, that
`touch.ts` toggles on at `touchstart` and off again before anything is painted;
on paper it is on for the whole press.

**What the previous two attempts established**, so neither is retried:

- 23.22 put `user-select: none` on `#content` permanently. It killed the bar but
  broke two things: `::highlight()` stopped painting, so a tap found its word
  and showed no purple — except on words carrying furigana, which are painted
  with the `.highlight` class instead, and that split is what identified the
  cause — and the long press stopped finding its run at all, which leaves
  `caretRangeFromPoint` no longer answering with a text node as the only
  candidate.
- 23.23 moved it behind the class. Tap, highlight and long press all came back.
  The bar did not go away.

**So the constraint is sharp**: the rule cannot be on when the reader resolves a
caret or paints a highlight, and it apparently is not on early enough to stop
WebKit's gesture when it is only applied at `touchstart`.

**Plan — in order, stopping at the first that works**:

1. Confirm the class is actually applied on the device. Nothing yet proves it
   reaches the DOM on iOS; a one-line debug log through the existing bridge
   settles it, and if the class is missing the rest of this list is moot.
2. If it is applied and the bar still comes: the gesture recogniser is reading
   the style before `touchstart` runs. Then the rule has to be on _by default_
   and lifted only where the reader needs it — the inverse of today — which
   means lifting it around the click handler's caret resolution and around
   every `highlightAbsRange`. More invasive and testable only on the device.
3. `-webkit-touch-callout: none` is already always-on and does not stop this
   bar; the bar follows a text _selection_, not the callout.

**Verification is Sam's device.** Nothing in jsdom can see this, and the two
shipped attempts are the evidence that reasoning about WebKit from here is not
reliable. Ship one change at a time and ask.

---

## Order

**1, then 3, then 2.** Category 1 is where the real damage is — a bookmarked
word that never paints is worse than one that paints twice. Category 3 is the
one he hits most often, but every iteration costs a release and his attention.
Category 2 is survivable today and has a workaround.

`0cfac0-12` (くどき) should be closed before any of this starts: it is answered
and working as designed — 口説く is bookmarked, くどき is its masu-stem, and the
popup's first chip is the noun 口説き, a different entry that is not saved.
