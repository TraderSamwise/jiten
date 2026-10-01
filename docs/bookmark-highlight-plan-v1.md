# Bookmark highlighting — repair plan v1

Written 2026-10-01 from the 29 findings in
[bookmark-highlight-bugs-v1.md](bookmark-highlight-bugs-v1.md), all diagnosed
against one real page of ダブル・ファンタジー 上 at 6.9% and Sam's "Common"
list of 8,586 entries, with his verdict recorded on each span.

**Those verdicts are the asset.** A labelled page is the only thing that can
say whether a change to this feature made it better, and nothing in the repo
has one today.

## The problem in one line

Tapping is a **resolver** — it walks spans, deinflects, scores, and decides
which word the sentence means. Highlighting is a **pattern matcher** — it
enumerates every substring up to 10 characters, accepts anything that hits a
bookmarked id, and paints. Two systems, one text, no agreement.

## What the 29 findings split into

| class                                                                                  | spans                                                                                                              | what fixes it                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| **Invalid candidate** — an inflection applied to a part of speech that cannot take one | く→堰(n), し→巣(n), して→汁(n), している→汁/巣/素(n), だち→脱(**prefix**), かし→樫(n)                              | POS validity                      |
| **Wrong place** — a real verb, a legal inflection, the wrong word boundary             | はない→張る, はたい→張る, けれ→蹴る, かった→刈る/欠く/掻く, からず→刈る, わた→綿, はい→灰/這う, いく→逝く, とい→塔 | Word boundaries                   |
| **Right characters, wrong word**                                                       | 通 in 通い, 流し vs 流す                                                                                           | Resolution, not matching          |
| **Rendering**                                                                          | 飽きない split by its own ruby                                                                                     | `renderHighlightedVisibleSegment` |
| **Unexplained**                                                                        | 一緒, おいしい — painted with nothing behind them                                                                  | unknown                           |
| **Correct**                                                                            | 励み, 岩盤, しめくくり, 夜更け, 互いに, より                                                                       | must not regress                  |

Two axes, not one. POS validity decides whether a candidate is a word at all;
boundaries decide whether it is _this_ word here. Neither alone is sufficient —
roughly half the findings fall to each.

## Phase 0 — Explain 一緒 and おいしい before building anything

Both are highlighted. Neither matches anything in Common, and Sam confirms he
has not bookmarked either.

If the highlighter marks words that are in no list, the membership set is
wrong, and that is a larger and simpler bug than everything else here. It could
also invalidate the fixture: a test built on "these entries are bookmarked"
means nothing if highlighting does not actually depend on that set.

- Trace `bookmarkedIds` and `listIdsByKey` from `stores/bookmarks.ts` through
  `readerHighlightEntryIds` to `ReaderBookmarkMembership.hasEntryId`.
- Determine whether 一緒 / いっしょ and おいしい reach `hasEntryId` as true, and
  from which entry id.
- Check whether another list holds them, by asking for the other list exports.

**Gate**: a one-line cause for each, or a measurement showing they come from a
list that was not exported.

## Phase 1 — The fixture and the instrument

Nothing is changed in this phase. It makes the current behaviour measurable and
pins Sam's verdicts, so every later phase is a diff against a labelled page.

### 1a. What can and cannot be committed

- **The novel page cannot be committed.** ダブル・ファンタジー is in copyright;
  `test/corpus/bocchan.txt` is in the repo because it is from 1906.
- **The 8,586-entry list should not be committed.** It is Sam's personal
  bookmark data, and this repo is public.

So the fixture is split:

- **Committed**: `test/fixtures/bookmark-highlight-cases.ts` — the ~44 entry
  ids actually involved, and **sentences written for the repo** that carry the
  identical constructions (ではない, 汗にして流し, 何かしら, 女友だち,
  にわたる, けれど, はいくつか, ひたすら, 関係なく). The constructions are
  ordinary Japanese and carry no rights; only the novel's exact prose does.
- **Local, gitignored**: the real page and the real list, as an acceptance
  check. `.cache/highlight-page.txt` and the `.jiten` export. Reproducible from
  the device at any time.

### 1b. The instrument

`yarn why:highlight --list <export.jiten> --text <page.txt>` — for a whole
page, print every painted span with the bookmarked entry and the deinflection
path that reached it, plus totals: distinct surfaces, spans, boxes, characters
covered, percentage of the page. `--json` saves a run and `--diff` compares
against one, the way `yarn sweep:furigana` does for furigana.

Built by extending `scripts/why-highlight.ts` rather than adding a second
script. It runs the shipping matcher
(`explainBookmarkedWordSurfacesInHtml`) and the shipping painter
(`packages/reader-webview/src/bookmarks.ts`, under jsdom) — see "the painter
is not the one in this package" below.

### 1c. The expectation table

Each case is a sentence, the entry ids bookmarked for it, and **both** lists:

```ts
{
  text: "彼女は毎日スタジオに通い、汗にして流した。",
  bookmarks: [1432840 /* 通 つう */, 1552100 /* 流し ながし */],
  mustHighlight: [],
  mustNotHighlight: ["通", "し", "流し"],
  note: "findings 4, 9, 10 — 通 is つう the connoisseur; the page means 通う",
}
```

**The `mustNotHighlight` half is the valuable one.** It is the regression net,
and it is what the repo has never had for this feature.

Cases to encode, one per finding, with Sam's verdict as the expectation:

- must highlight: 励み (励む), 岩盤 (in 岩盤浴), しめくくり, 夜更け, 互いに, より
- must not highlight: はない, はたい, からず, く, し, して, している, とい,
  だち, かし, けれ, わた, はい, いく, 欲し, かった, 通 (in 通い), 流し (as
  the stem of 流す)
- must highlight as **one** span: 飽きない, despite its ruby

### 1d. Gate for the phase

Run the suite against unmodified code. It must be **red in exactly the places
the findings say**, and green on the six accepted spans. A failing test that
fails for the wrong reason is worse than none, so each red case is checked
against its finding before moving on.

## Phase 2 — POS validity

A deinflection rule may only be accepted if the entry it landed on can take it.

- `deinflect` already carries POS type masks internally (`V1`, `V5`, `ADJ`,
  `SURU`…) for rule chaining. What is missing is the check **against the
  matched dictionary entry** — the rule's output type is never compared with
  the entry's `part_of_speech`.
- Entry POS is available: `senses.part_of_speech`, a JSON array of JMdict tags
  (`v5r`, `v1`, `n`, `pref`, `adj-i`…).
- The check belongs where the match is accepted, in
  `resolveBookmarkedWordSurfacesInHtml`, not inside `deinflect` — the tap path
  has its own scoring and must not change behaviour in this phase.

**Expected effect**: the six invalid-candidate findings go green. Nothing else
changes.

**Gate**: those six cases pass; the six accepted spans still pass; the
whole-page instrument shows coverage down with no accepted span lost.

**Risk to watch**: JMdict POS tags are per _sense_, and an entry can be both a
noun and a verb (`vs` entries especially — 勉強 is `n,vs`). The check must pass
if **any** sense admits the rule, or it will delete legitimate suru-verb
matches.

## Phase 3 — Boundaries, by confirming with the resolver

The remaining bad spans are well-formed inflections of real verbs in the wrong
place. Only knowing where the word boundary is removes them.

Chosen approach: **matcher proposes, resolver confirms.** Keep the cheap
substring scan to find candidate positions; at each one, run the same
resolution the tap uses, and keep the highlight only if the word the resolver
settles on is the bookmarked one.

Why this rather than guards or full segmentation:

- It makes **tap and highlight agree by construction** — the highlight exists
  because the resolver said that word is there, so tapping re-runs the same
  question and gets the same answer. That is the coherence Sam asked for, not a
  separate feature.
- It settles 励み against 流し with no special rule: 励み resolves to 励む, which
  is bookmarked; 流し resolves to 流す, which is not.
- It can be measured and shipped incrementally. Full slice segmentation becomes
  an optimisation afterwards rather than a prerequisite.

**Measure first, before writing it**: the cost of resolving every candidate
position on a real page against 8,586 bookmarks, compared with the current
single scan. With a list this dense the candidates are not sparse, and that
number decides whether this is viable as written or needs the segmentation
form. Slice results are already cached (`furiganaSliceHtmlCacheRef`), so the
cost is per slice, not per frame.

**Gate**: every remaining `mustNotHighlight` case green; all accepted spans
still green; the page instrument shows the coverage drop; resolution time per
slice recorded in the decisions doc.

## Phase 4 — Density

Correct highlights can still be unreadable. With 8,586 bookmarks including ある,
より and する, a page is carpeted even when every span is right.

- **The suru rule Sam asked for**: a suru verb marks the noun stem, not the
  inflection. 我慢してきた marks 我慢, not して and not きた.
- **Make list exclusion reachable.** Two bugs block it: `useListsStore` is only
  hydrated by the Lists tab, so the chips are invisible until that tab is
  visited; and `highlightableLists` filters out the default list, which for a
  single-list user is the only one there is.
- **Report the number.** The instrument prints percentage of characters covered;
  that is the figure to move, and Sam judges what is comfortable.

**Gate**: coverage on the real page, before and after, with Sam's verdict on
the result. There is no correct number to compute here — this one is taste, and
it is his.

## Phase 5 — The highlight inside the tap

Once the resolver owns both, the tap knows its span and can report which
bookmarked tokens sit inside it.

- Tapping 流して shows 流す as the headword, with 流し listed as a contained
  bookmark that opens to its own entry and SRS stats.
- The tap result is already a list — it returns word and name results together
  today — so this is an extra entry in that list rather than new machinery.
- Also closes the ask from finding 3: tapping 励み should show 励む, the
  dictionary form, not the inflected surface.

**Gate**: tapping each accepted span on the real page reaches the bookmarked
word; tapping a span inside an idiom offers both.

## Standing gates, every phase

- `yarn typecheck`, `yarn lint` 0 errors, prettier.
- Scoped `vitest` only.
- `yarn check:tap-consistency` ≥ **98.0% / 128 pairs** — phases 3 and 5 touch
  the resolver, so this is not a formality there.
- The furigana sweep over all 67,299 corpus surfaces unchanged, unless a phase
  deliberately touches furigana.
- Failing test first, prove-failed.
- Every accepted regression named in `reader-lookup-decisions.md`.

## Open questions, carried

1. **一緒 and おいしい.** Phase 0. Could invalidate the fixture.
2. **Does the box on 流し include the て?** Unresolved from finding 10; decides
   whether there is also a boundary bug on the left edge there.
3. **Is より worth highlighting?** It is correctly matched and bookmarked, and
   it is a particle that appears constantly. A density question, not a
   correctness one.
4. **Should auxiliary する / くる / いる ever highlight**, if bookmarked? Phase 4
   assumes not, on the strength of Sam's suru-stem ask, but it is not settled.

## Appendix A — the 44 entries the fixture needs

Every bookmarked entry named in the findings. Committing these ids is not
Sam's bookmark list; it is the subset the cases exercise.

| entry   | word           | reading        | POS                | findings                |
| ------- | -------------- | -------------- | ------------------ | ----------------------- |
| 1427900 | 張る/貼る      | はる           | v5r,vt,vi          | 1 はない, 12 はたい     |
| 1432840 | 通             | つう           | n,n-suf,adj-na,ctr | 4                       |
| 1335520 | 汁/液          | しる           | n,n-suf            | 6 して, 16 している, 27 |
| 1400390 | 巣/栖          | す             | n                  | 6, 9 し, 16             |
| 2069220 | 素             | す             | n,adj-no,pref      | 6, 9, 16                |
| 1929950 | 詩             | し             | n                  | 9                       |
| 1955830 | 堰/井堰        | せき/いせき/い | n                  | 7 く, 20 く, 24 かった  |
| 1552100 | 流し           | ながし         | n,adj-no           | 10                      |
| 1436580 | 締めくくり     | しめくくり     | n                  | 11 ✓                    |
| 1436610 | 締めくくる     | しめくくる     | v5r,vt             | 11 ✓                    |
| 1606010 | 夜更け         | よふけ         | n                  | 13 ✓                    |
| 1446740 | 塔             | とう           | n,n-suf            | 14 とい, 19 とい        |
| 1254600 | 結う           | ゆう/いう      | v5u,vt             | 14 いう                 |
| 1013190 | (no kanji)     | より           | prt,adv            | 14 より ✓               |
| 1209540 | 刈る/苅る      | かる           | v5r,vt             | 15 からず, 24 かった    |
| 1205740 | 殻/骸          | から           | n                  | 15                      |
| 1212010 | 干る/乾る      | ひる           | v1,vi              | 17 ひた                 |
| 1010530 | 只管/一向/頓   | ひたすら       | adv,adj-na         | 17 ✓ (suppressed)       |
| 1586250 | 飽きる/厭きる  | あきる         | v1,suf,vi          | 18 ✓                    |
| 1268780 | 互いに         | たがいに       | adv                | 21 ✓                    |
| 1207690 | 樫/橿/櫧/檍    | かし           | n                  | 22                      |
| 1195720 | 課す           | かす           | v5s,vt             | 22                      |
| 1568780 | 滓/粕/糟       | かす           | n                  | 22                      |
| 1577030 | 化す           | かす/けす      | v5s,vt,vi          | 22                      |
| 2406900 | 科す           | かす           | v5s                | 22                      |
| 2601360 | 脱             | だつ           | **pref**           | 23 だち                 |
| 1557390 | 励む           | はげむ         | v5m,vi             | 3 ✓                     |
| 1217400 | 岩盤           | がんばん       | n                  | 8 ✓                     |
| 2410130 | 欲す           | ほりす         | v5s,vt             | 24 欲し                 |
| 1208840 | 且つ/且        | かつ           | conj,adv           | 24 かった               |
| 1253900 | 欠く/闕く      | かく           | v5k,vt             | 24 かった               |
| 1399970 | 掻く/搔く      | かく           | v5k,vt             | 24 かった               |
| 1307090 | 四角           | しかく         | adj-na,adj-no,n    | 24 しかった             |
| 1312690 | 資格           | しかく         | n                  | 24 しかった             |
| 1309520 | 思惟           | しい/しゆい    | n,vs,vt,vi         | 24 しかった             |
| 1319580 | 叱る/𠮟る      | しかる         | v5r,vt             | 24 しかった             |
| 1533340 | 綿/棉/草綿     | わた           | n                  | 25                      |
| 1208000 | 割る/破る      | わる           | v5r,vt             | 25                      |
| 1247040 | 繰る           | くる           | v5r,vt             | 27 きた                 |
| 1585570 | 抉る/刳る/剔る | えぐる/くる    | v5r,vt             | 27 きた                 |
| 1201860 | 灰             | はい           | n                  | 28                      |
| 1474200 | 這う/匍う      | はう           | v5u,vi             | 28                      |
| 2856718 | 逝く           | いく/ゆく      | v5k-s,vi           | 28                      |

✓ = Sam accepted the highlight. 1010530 ひたすら is the case where the correct
entry matched and was then suppressed by the kana guard, letting ひた win.

## Appendix B — the page

Transcribed to `.cache/highlight-page.txt`, **gitignored**: ダブル・ファンタジー
is in copyright. Nine lines, one per column, right to left as read.

One uncertain character run in column 4, 「お茶」がら, probably 「お茶」がてら.
It carries no highlight, so it does not affect any case.

Regenerate at any time by screenshotting the same position; the fixture that
matters is the construction list, not the prose.

## Appendix C — Sam's verdicts, verbatim

Kept because the wording carries judgement the table flattens.

- 励み — "this is acceptable ish. note that on tap id like to see hagemu not hagemi"
- 通 — "the word is kayou. not good"
- おいしい — "no. failure."
- して — "lol. what a joke. failure."
- 行く — "no. its worse. its not iku. its highlighting ku"
- 岩盤 — "its just higlighting ganban but thats fine"
- 流し — "nagashi i have as a bookmarked word. nagasu i dont. this cuts opposite
  to hagemu. hence why i said dont get ahead of yourself we have to understand
  all angles. i dont know what to do yet."
- しめくくり — "this is good"
- はたい — "you skipped hatai which is ha taitei"
- からず — "karazu bad its kara zutto"
- している — "shiteiru another suru failure"
- ひた — "hita failing its hitasura"
- 飽きない — "akinai is good except that there shouldnt be a separation between
  a and kinai the whole highlight is akinai"
- 互いに — "tagaini good"
- かし — "kashi bad within nanikashira"
- だち — "onnatomodachi idk wht to say dachi whatever this idk"
- 欲しかった — "koshikatta bad for 2 reasons hoshii is not a bookmarked word.
  and if it was it would be one word. but there is a space"
- わた — "wataru not bookmarked word and wata is wrong"
- けれ — "kere no idea"

And the framing that produced this plan:

> "when a word is higlighted, if i tap the word the lookup should show me the
> highlighted word. except thats not coherent because selecting is largest
> possible match and highlihgt is smallest possible match. we need some system
> to show the highlight WITHIN the tap ideally. like if you ahve a word thats
> highlighted and part of an idiom, on tap the whole idiom shows, but the part
> that is the word you have bookmarked should somehow also be selectable to go
> to just that highlight so you can see stats on that highlighted word. and
> ALSO we should make sure that the highlighted word IS ACTUALLY that word to
> the best of our ability not just some pattern match."
