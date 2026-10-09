# Reader lookup and furigana — decisions

Every entry here is a question that has already been argued out with numbers.
Re-opening one is fine, but bring a new measurement, not a new opinion.

## How to measure a change here

Both the tap pipeline and the furigana pipeline are deterministic given the
built dictionaries, so any change to them can be measured exhaustively instead
of argued about.

- **Taps.** Resolve `smartLookupWithOffset` at every character of
  `test/corpus/bocchan.txt` (a 24-character window either side, matching the
  reader) before and after, and diff the matched span and top entry. ~11,250
  taps. `scripts/tap-consistency.ts` is the committed gate over the same corpus
  (`yarn check:tap-consistency`); it reports the share of taps that agree with
  every other tap landing inside their own span, currently **98.0%** (11,130
  agreeing, 128 disagreeing pairs).
- **Furigana.** Resolve `resolveFuriganaBatch` over every kanji-initial
  substring of the corpus, up to 8 characters. ~54,900 surfaces.
- **Counters.** The `counter_readings` table is finite: resolve all 2728
  distinct `combined_kanji` forms and diff. This bounds any counter change
  exactly.
- **Bookmark highlights.** Also run `yarn sweep:furigana --out <file>` before
  and after any change to `deinflect.ts`, because the furigana resolver reads
  the same candidates: the bookmark work of 2026-10-01 added nine kuru rules
  and changed 0 of 67,299 surfaces, which is how that was known rather than
  assumed. `yarn why:highlight --list <export.jiten> --text
<file> --json <out>` runs the shipping matcher and the shipping painter over
  a whole text and reports every painted span with its provenance, plus
  distinct surfaces, spans, boxes and the share of Japanese characters
  covered. `--diff` compares two runs. Measure on both
  `test/corpus/bocchan.txt` (1,926 surfaces against a real 8,586-entry list)
  and the local page fixture. The labelled cases are
  `test/fixtures/bookmark-highlight-cases.ts`, run by
  `packages/japanese-reader/src/bookmarks.cases.test.ts`; expectations the
  code does not meet yet are listed in each case's `knownRed` and run as
  `it.fails`, so the suite is green today and goes red the moment one is
  fixed.

**None of this runs in CI.** The dictionaries are build artifacts and the
workflow does not fetch them, so `test/dictionary-db.ts` makes every suite that
queries them `describe.skipIf` — three of the five files added for the lookup
work skip entirely there, and `yarn check:tap-consistency` is not a CI step at
all. The sweeps above and those suites are local gates. What CI does gate is
the pure rule table: `deinflect.*.test.ts` and the scoring helpers.

A change is shippable when the diff is enumerable and every entry in it is an
improvement, neutral, or a regression named and accepted in this document. A
regression nobody wrote down is not accepted, it is unnoticed.

**The gate is a tripwire, not the judge.** It counts taps that agree with each
other, and two taps agree perfectly well on a wrong answer — a junk span that
swallows its neighbours makes every tap inside it agree, so a regression can
_raise_ the number. That happened here: 倒してやった answered as してやった scored
better on the gate than answering やった, and a character cap chosen by the gate
alone picked the worse of two rules by four pairs. Read the corpus diff. The
gate's job is to catch what you did not look at.

## Taken

### Counter readings lose to a common word they contradict

`counter_readings` is a generated number × counter cross-product, so it holds a
reading for every spelling the product can make, including ones nobody writes.
It was consulted before the word lookup and returned unconditionally, so 一種
got いっくさ from 種/くさ "counter for varieties" while the tap lookup, which
never reads that table, said いっしゅ.

A counter now loses only when it contradicts a **common** entry for the **exact**
same spelling — no deinflection, same kanji form. A counter that agrees, or one
for a spelling the dictionary lacks, keeps its entry and its `isCounter` flag,
so the `showCounters` display gating is untouched.

Measured: 16 of 2728 counter forms change, all to the reading the dictionary
already held. 3 of 54,897 corpus surfaces change. Commit `ddd43b1`.

### A tap's entries rank by which one the spelling heads

JMdict lists an entry's spellings most-prevalent first, so a surface that is an
entry's headword spelling is better evidence than the same surface sitting in
someone else's variant list. 自ら heads みずから but is only a second spelling
of 自ずから/おのずから.

Measured: 282 of 11,256 taps change, 22 distinct, all improvements or lateral,
no span moves. Commit `3046072`.

### No JLPT term in tap entry ranking

`scoreEntryForMatchedSurface` used to pay `80 - jlptLevel * 10`, so between two
entries sharing a spelling the **harder** word won. A JLPT level says how hard a
word is to learn; it is not evidence about which word a sentence means. 止まらず
gave とどまる (N2) over とまる (N5).

The term is gone. What remains is commonness, headword spelling, exact surface
match and counter hints — all of them evidence about the text.

Measured: 895 of 11,256 taps change, 92 distinct. Wins include から 殻 → the
particle (96 taps), ある 或る → 有る (34), もっとも 尤も → 最も (24), のよう
載る → 乗る (21), なる 生る → 成る (16), なら 奈良 → the particle (14), とうとう
等々 → 到頭, 向う 向かう → 向こう, 居た おる → いる, ここ 個々 → 此処, なし 梨 →
無し, とまる 泊まる → 止まる, 解けた 溶ける → 解ける, そうじ 相似 → 掃除. Costs:
うち 内 → 家 (10 taps), 出来 でき → しゅったい (4), くらい 位 → 暗い (3), たくて
(3). The remainder is lateral churn on の and は, where no entry is right either
way. Commit `d7b84f0`.

**Rejected alternative: inverting the term** so the easier word wins. It fixes
more — 1500 taps, 159 distinct, including everything above plus 時, なんて, かも
— but regresses the particle と to 戸 on **118 taps**, plus 時 とき → じ and 二十
→ はたち. Dropping the term outright keeps the wins without that.

### ～ず / ～ずに deinflection

The rule table had ～ない in every conjugation class but not its written
counterpart ～ず, which is everywhere in prose. Tapping 止 in 一度も止まらずに
returned nothing at all and the popup fell back to JMnedict given names.

Measured: 15 of 11,256 taps change — 9 better (抜かさずに → 抜かす where the tap
gave 笠, 図, 荷 or nothing; もせずに → 燃やす over the whole form), 3 lateral, 3
worse (でまず reaching the rare 出丸/でまる instead of 先ず). Commit `8be8d03`.

### i-adjective ～そう

Added `{ from: "そう", to: "い", typeIn: ADJ }`, so 恥ずかしそう resolves
恥ずかしい instead of stopping at the noun 恥/はじ. Also 涼しそう, 旨そう, 強そう.

**Known cost, accepted:** だったそう resolves 脱退/だったい, because だったい is a
real kana reading and nothing checks the result is really an adjective (5 taps).
嬉しそう stops showing the dedicated but uncommon JMdict entry 嬉しそう
"glad-looking" and shows 嬉しい with an "appearance" reason instead (8 taps) —
arguably better for a learner. Net over the corpus: 10 clearly better, 8
arguable, 5 worse. Commit `d7b84f0`.

### A substituted match says what the page wrote

When a kana spelling or a particle swap wins, the entry shown carries a
different spelling from the text — 役には立たない headed by 役にも立たない — and
neither carries a deinflection reason, because a respelling is not an
inflection. The popup now shows a second chip beside the headword, `written
役には立たない`, whenever the tapped surface is none of the entry's own spellings
and no deinflection explains it (`pageSpellingNote` in `lib/entry-surface.ts`).
An inflected match keeps only its reason chip; repeating the surface there
would be noise.

### A span may not start inside a word

Kana straight after a kanji is usually that kanji's okurigana, not the start of
a new word, so a candidate beginning there is cutting a word in half: 死ぬまで
answered as ぬま, 消えぬ as えぬ, 白くって as くって, 云うから as うから,
囃したから as たから. The scorer had it backwards —
`tapCandidateStartsAtKanaRunStart` paid such a start +120 for looking like a
word boundary.

Looking like one is not enough to separate okurigana from a real particle after
a kanji (手 に), so the kanji run and the kana after it are looked up together
and the position only closes when they spell an **inflecting** word that
exists: 死ぬ (v5n), 消える (v1), 白い (adj-i). 手に resolves to nothing that
inflects, so に stays open. `findOkuriganaStarts` in `lookup.ts`, one batched
lookup per tap.

Three things this took, each measured:

- **Close the whole proved tail, not only its first kana.** 囃した covers し and
  た, so たから cannot start; から can. First-kana-only left 96 of the 158
  overlaps untouched.
- **Bound the tail by one inflection step.** 倒して is 倒す in its te-form, but
  倒してや reaches 倒す as well and would close や, handing the tap the
  straddling してやった. Chains through an auxiliary are a second word. Without
  the bound, 込んでい proves itself and closes the い that starts いい加減.
- **Refuse such a span outright rather than scoring it down.** A −140 penalty
  was not enough: the walk stops at the first span two characters longer than
  the best (`lengthDiff >= 2`), so してやった kept winning at 220 against
  やった's 340 because the walk never reached length 3. A span that begins
  inside a word is not a worse answer, it is not an answer.

Measured: 62 of the 158 overlapping disagreements had exactly one side starting
this way and never both, so the signal is clean. The gate moves 97.3% → 97.9%,
176 disagreeing pairs → 129. Over the corpus 352 taps change across 136
distinct transitions, all read: たから→から (50), ないか→から (22), いと→と
(17), ったって→って, たよう→ように, いながら→云い, きじゃけれ→好き,
しかねる→決し, せば→廃せば, ようか→尋ねよう.

**Accepted regressions**, all read in that diff and kept:

- 来たまえ → まえ (2 taps). 来た is a real inflected verb, so たまえ — the
  auxiliary 給え, correct here — starts inside it. An exemption would have to
  fire on exactly the forms this rule exists to catch.
- 居やがる → がる, 出来そうもない → もない, 同じような → な (5 taps between
  them). The auxiliary starts one kana early in each.
- Three taps now answer nothing — つきゃあがった, 睨めっくら, 卸しゃ — where
  every span containing them began inside a word. They get the empty-state
  message rather than a junk word, which is the honest answer.

### ～とく / ～どく, the spoken contraction of ～ておく

置いとくからだよ reached nothing as a word — 置い has no path to 置く — so the
furigana and the tap both fell through to JMnedict and offered the surname おき.
The contraction is rewritten to the te-form and the existing rules finish the
job: 置いとく → 置いて → 置く.

Two guards, both from measured failures:

- **The te-stem kana is part of the pattern** (いとく, っとく, んどく), not left to a
  stem-length floor. A bare ～とく also matches the _output_ of the masu-stem
  rules, which turned のとき into 乗る and 行くとき into 行い. The ichidan form
  sits straight on the stem (見とく, 食べとく). Three flags do three jobs:
  `typeIn: RAW` fires the rule only on the untouched surface, so it cannot
  chain off the masu-stem rules' output; `typeOut: V1` types what it produces,
  so only the ichidan chain continues from it; `minStem` stops it stripping the
  contraction off nothing.

  **Its imperative needed the same treatment, and the order matters.** The
  godan stems spell theirs out (いとけ, っとけ, んどけ) but the bare ichidan one
  was missing, so やめとけ was not a word at all, `segmentRun` read it as
  やめ + とけ — both real tokens — and a bookmarked 解ける lit up on the second
  half. The bare rule has to sit BELOW the godan ones: the first rule to reach
  a word owns its type, so placed above them it typed 置いとけ as ichidan and
  置いて never finished the journey to 置く. That regression passed every gate
  — the corpus has no とけ, so the tap sweep cannot see any of this — and was
  caught only by reading 置いとけ, やっとけ and 待っとけ by hand. They are now
  assertions in `deinflect.te-oku.test.ts`.

  **The price, accepted and pinned as case 42.** Making やめとけ a word also
  makes はやめとけ one — 早める contracted — and `segmentRun` maximises the
  square of each token's length, so one 5-character token (25) beats
  は + やめとけ (1 + 16) and the particle is swallowed. Nothing in the kana
  distinguishes the two. A tap is protected, because a reading that needs no
  guess wins first; the highlighter has no such guard, so a bookmarked 早める
  paints a box across the は. That is narrower than what it replaces — 解ける
  and 溶ける are commoner words than 早める, and both were painting on every
  ～とけ in the book.

- **A reading that needs no guess wins.** 書いとく is an entry of its own, and
  undoing the contraction reaches かいて → 買い手, the commoner of the two. The
  lookup already defers particle swaps to a literal reading; the contraction
  joins them.

Four corpus taps change, all of them 飼っとく reaching 飼う where the tap
previously found nothing or 解く. Gate unmoved at 97.9% / 129.

### A number spelled in kanji is never a name

JMdict carries the short numbers — 四十 is よんじゅう, 十三 is じゅうさん — and stops
well before prose does. 四十三 and 五十八 are in no dictionary, and both are real
given names in JMnedict, so a sentence counting someone's age was furigana'd
よそぞう and a tap on it offered Shitomi and Yosozou.

A kanji run written **only** in numerals is refused a name reading, in the
furigana pass and in `lookupExactName`, and the number is composed from its
parts instead (`numerals.ts`). Composition only runs where no dictionary entry
exists, so 四十 and 十三 keep the readings they already had. The sound changes
are the reason it cannot be done digit by digit: 三百 is さんびゃく, 六百 is
ろっぴゃく, 八千 is はっせん.

Measured over every kanji-initial corpus substring up to 8 characters (67,299
surfaces): 二十三 はたぞう→にじゅうさん and 六百 むお→ろっぴゃく are corrected, 五万,
十五万 and 二十五万 gain readings they had none for, and 五六 いつむ, 六七 むな,
十三四 とみよ lose name readings that were wrong anyway. 五十嵐 carries a
non-numeral, so this rule leaves it alone — it read いかざき until the name
reading counts below made it いがらし.

**Accepted regressions.** 一二三 no longer offers ひふみ, and 三四 loses さんし —
which was right for "three or four" — with nothing composed in its place, since
a bare run of digits with no power is not a number this reads. Two surfaces
against five corrected.

### ～ちゃう / ～じゃう and ～なさい

喋っちゃいなさいって came back as fragments — っち, ちゃい — because neither piece
existed: no ～ちゃう rule and no ～なさい rule. Both are now in, and both are
spelled out per stem rather than left to chain.

**～ちゃう** is ～てしまう, handled like ～とく. The rules carry
`NOT_MASU_STEM`, because with `typeIn: ANY` the masu-stem rule turns 云っちゃい
into 云っちゃう and then 言う, swallowing the いけない of 云っちゃいけない — which
is ～てはいけない, a different contraction. That mask also blocks the chain to
～ちゃった, so the past, te-form and ～なさい combinations are listed explicitly.
Zero corpus taps change: Bocchan is 1906 and has no ～ちゃう at all, so the gate
can only show this costs nothing. 喋っちゃった→喋る and 読んじゃった→読む are
checked directly instead.

**～なさい** is the polite imperative on the masu-stem, one rule per godan row
plus ichidan, する and くる. 45 corpus taps change: お使いなさい, お出しなさい,
お持ちなさいます, お上がりなさい and お買いなさい all resolve as one phrase where
the tap previously split them. Gate 97.9% → 98.0%, 129 pairs → 128.

**Accepted regression: ご覧なさい → 覧なさい** (8 taps). 覧る is a listed spelling
of 見る, which is common, while ご覧なさい as an entry is not, so the shorter span
wins on commonness. Left as is rather than raising the ichidan stem floor,
which would cost 見なさい.

### Bookmark highlighting: a chosen set of lists, deinflected while it is small

`bookmarkedIds` is every entry in every list. For one real library that is
RTK6th 2927, Hardest 153, Problems 736 and Common 8578, and measured against a
12,000-entry stand-in on a 3,000-character slice it marks **29.5% of the page
before any change** — which is why a word just saved did not stand out.

Deinflecting that same set was shipped in `caae544` and reverted in `fc28052`:
it took coverage to **57.1%**, half the page. The fix was the set, not the
matcher. Reader settings now show the lists as chips and a tap leaves one out;
the setting stores the **excluded** lists so a list made later is highlighted
without being opted in (`readerHighlightEntryIds`).

With the set under control, deinflection is back and gated on its size, because
what it costs depends entirely on that. Measured through the real function on
the same slice:

| entries | literal | deinflected |
| ------- | ------- | ----------- |
| 150     | 3.2%    | 3.6%        |
| 750     | 13.4%   | 15.4%       |
| 3000    | 13.5%   | 18.8%       |
| 12000   | 29.5%   | 57.1%       |

`MAX_ENTRIES_FOR_DEINFLECTION` is 3000. Below it the page stays readable and
のめりこんだ, 勧誘される, 退団した and やりこめてい all light up; above it the highlighter
stays literal, and a caller that does not say how big its set is gets literal
too. The kana guard carries over with one exception: a kana surface still loses
to the kanji its entry is written with **unless an inflection was undone to
reach it**, so a bookmarked 事 does not light up every こと.

Cost on the per-slice render path: 25ms and 71 queries literal, 71ms and 109
deinflected.

### A contraction fires on the surface as written, never on a rule's output

よっぽどほっとかれるか resolved as 弩砲, a crossbow. The span started inside よっぽど and
the chain ran どほっとかれる → passive → どほっとく → te-oku → どほって → te-form →
どほう. Three rules deep, each legal on its own.

Every contraction rule now carries `typeIn: RAW`, a bit only the untouched
surface has — every rule types its output as a real verb class, so nothing a
rule produces can satisfy it. Their own inflected forms are spelled out
instead: 置いといた, 置いといて, 置いとけ, 置いとこう, and the ～ちゃう equivalents.
This replaces the narrower `NOT_MASU_STEM` guard, which only closed the
masu-stem path and left passive open.

Zero corpus taps change, gate unmoved at 98.0% / 128. Checked directly:
よっぽどほっとかれるか now reads よっぽど and ほっとかれる → 放っとく, and 置いとく,
飼っとく, 読んどく, 見とく, 置いといた and 買っとこう all still resolve.

### Furigana picks the entry a word heads, and never writes over the book's own ruby

**Entry choice.** `batchLookup` took the first entry it found for a word, or
the first common one, with no ranking at all. 二度 is the headword kanji of にど
and a second spelling of ふたたび, whose headword is 再び; both are common, so
the tie fell to row order and the page read ふたたび in 二度くらいのペースで.
Entries are now ranked `common` then `heads this spelling` — the same evidence
the tap ranking has used since `3046072`.

Only for compounds. Every single-kanji entry is headed by its own kanji, so the
term is noise at length 1 and just reorders: unrestricted it turned 勢 from
いきおい into ぜい and 取 from とり into しゅ. With the restriction the sweep over
all 67,299 kanji-initial corpus substrings moves exactly 14 surfaces, 12 of
them better: 一二 じゅうに→いちに, 一向 ひたすら→いっこう, 一時 ひととき→いちじ,
上って あが→のぼ, 二度 ふたたび→にど, 御影 ごえい→みかげ, 極めた・極めてい・極めている
き→きわ, 目標 めじるし→もくひょう, 言付けた いいつ→ことづ, 黒人 くろうと→こくじん.

上って is a fix, not a wash: 上がる conjugates to 上**が**って, so the bare
string 上って can only be のぼって.

**Accepted regressions:** 真直 ますぐ→しんちょく and 身体 からだ→しんたい. In both
the rival entry genuinely uses that spelling — 身体 is a listed spelling of
体/からだ — so heading an entry is the wrong signal there, and in fiction からだ
is the commoner reading. 真直's true answer, まっすぐ, is unreachable either way.

76 multi-character spellings in the dictionary head two or more common entries,
so that many surfaces are still decided by row order. Not a problem anyone has
reported; recorded so the next person knows the term is a tiebreak, not a sort.

**Source ruby.** An imported EPUB brings its own `<ruby>`, and a surface could
match across one: 拍手`<ruby>`喝采`<rt>`かっさい`</rt></ruby>` matches 拍手喝采.
`advanceHtmlPastChars` skips tags while counting visible characters, so the
replacement swallowed the source `<ruby>` open tag and left `<rt>かっさい</rt>`
`</ruby>` dangling — stray kana on the page, reported as 拍手喝采 being
furigana'd っさい. `spanCrossesMarkup` now refuses any surface whose characters
straddle a tag, and a shorter one that stops before it is annotated instead —
拍手<b>喝采</b> gets 拍手 and 喝采 separately, with the bold intact. Ruby was
only the case that was reported; an EPUB puts `<em>`, `<span>` and `<a>`
mid-sentence and every one of them orphaned its close tag the same way. The
check runs before the settings filter so a span that will never be annotated
cannot mark shorter ones blocked on its way past. Zero sweep changes: the
corpus is plain text.

### Name readings, ranked by how often a spelling takes them

JMnedict lists every reading a spelling has ever taken and ranks none of them.
杏子 offers thirteen, `scoreFuriganaNameMatch` scores them identically, and
`pickBestNameMatch` kept whichever row SQLite returned first — あんず, the
apricot, for a character called きょうこ. Nothing in JMdict, JMnedict or
KANJIDIC separates a reading people use from one merely recorded.

`names.name_freq` now carries how often a spelling is read each way when it
names a person, derived offline from Wikidata and validated against JMnedict
itself, so it can only rank readings the dictionary already lists. Method,
sources and limits: [data/README.md](../data/README.md). 59,414 pairs over
50,410 spellings; 48.2% of the 47,711 ambiguous spellings get a number.

**The counts are undercounts, not probabilities.** Two rules follow, and both
are load-bearing:

- **Never compare them across spellings.** 高遠's 4 and 洋子's 282 say nothing
  about each other. `pickBestNameMatch` breaks ties only between readings that
  share a `kanjiForm`, and leaves the contest between spellings to the score
  exactly as before.
- **Zero is not evidence against a reading**, only the absence of evidence.
  Most readings have none.

#### What the ranking fixed

|        | was      | now                       |
| ------ | -------- | ------------------------- |
| 杏子   | あんず   | **きょうこ** (26 of 33)   |
| 京子   | あつこ   | **きょうこ** (150 of 153) |
| 洋子   | きよこ   | **ようこ** (282 of 293)   |
| 五十嵐 | いかざき | **いがらし** (179 of 185) |

五十嵐 moves, and the earlier note under the numeral rule saying it "is still
いかざき" recorded that rule leaving it alone, not a claim that いかざき was
right. いがらし is the surname.

#### The name-against-word contest

Ranking the readings was not enough for 杏子: the word あんず still won the
separate contest over whether a name is what is written. Two things were wrong
there, and the fix is deliberately narrow because this is where the feature
could have turned into wrong furigana everywhere.

**The candidate-count penalty was backwards.** Thirteen readings read as −24
uncertainty even when 26 of 33 sightings pick one. A settled reading — at least
5 observations with at least 60% of them on one reading — now scores +4
instead, the same as a name with two or three readings and no evidence. **4 is
the measured minimum**: 0 leaves 杏子 at 87 against a threshold of 90, and 10
changes nothing that 4 does not.

**`exactCommonWord` was too generous.** It meant "a common entry matched this
surface exactly", but JMdict marks commonness per _written form_, and 杏子 is a
rare spelling of the common word あんず — which is written 杏. A word is only
treated as exactly-and-commonly spelled this way when the form itself is
common; where it is not, and the name reading is settled, the −28 becomes −8.

Three conditions, and all three are load-bearing:

- A **settled name alone** cannot beat a commonly-spelled word. 希望 stays
  きぼう however many people are called のぞみ.
- A **rare spelling alone** cannot hand the surface to a name. 真面 stays
  まとも rather than becoming the surname さなつら, which has one listing and
  no sightings.
- The word must be **common in the first place** (`isExactRareForm`). A word
  JMdict marks common nowhere has no common spelling to be a rare variant of,
  so without this the test reduces to "not a common word" and quietly discounts
  every exact match. It cost 和音 かずね for the musical chord, 一矢 かずや and
  一花 いちか out of their idioms, 古池 こいけ, 土方 ひじかた and 真平 しんぺい
  before it was caught — 258 spellings' worth.

Removing any of the three fails a test.

#### Measured

Furigana resolved over all 67,299 kanji-initial corpus substrings up to 8
characters, before and after, by `yarn sweep:furigana` — now a committed
harness rather than a script rewritten every time.

**68 of 67,299 surfaces changed. None gained a reading and none lost one**; the
change is always which reading. 67 are name-to-name corrections — 吉川 きかわ→
よしかわ, 多田 おいだ→ただ, 小倉 おくら→おぐら, 小日向 おひなた→こひなた,
徹 あきら→とおる, 渡 とさき→わたる, 遥 うらら→はるか, 潔 いさお→きよし,
見上 けんじょう→みかみ. The rest swap one obscure reading of a single kanji for
another, where neither was right before. Exactly one touches a word: 容子
ようす→ようこ, and ようす is written 様子.

One novel is a weak bound for the name-against-word half, so the same sweep ran
over **every multi-character name spelling that is also a written word — all
9,110**. **11 change**, none gaining or losing a reading, and they are the whole
exposure:

| surface            | was        | now        |                                  |
| ------------------ | ---------- | ---------- | -------------------------------- |
| 杏子               | あんず     | きょうこ   | the target                       |
| 容子               | ようす     | ようこ     | ようす is written 様子           |
| 梨子               | なし       | りこ       | なし is written 梨               |
| 貴男               | あなた     | たかお     | あなた for 貴男 is archaic       |
| 風太郎             | ぷうたろう | ふうたろう | ぷうたろう is slang              |
| 愛敬 / 智恵 / 澁谷 | —          | —          | same reading, only tagged a name |
| 小形               | こがた     | おがた     | accepted regression              |
| 真白               | まっしろ   | ましろ     | accepted regression              |
| 米蔵               | こめぐら   | よねぞう   | accepted regression              |

**Accepted regressions: those three.** 小形 (small size), 真白 (a variant of
真っ白) and 米蔵 (rice storehouse) are real words that JMdict marks common as
entries but not in these spellings, and each has a settled surname reading.

Separating them needs a different measurement: not which reading a name takes,
but **how often a spelling is a word at all** — counted over running text
rather than over people. See "What word frequency would and would not fix"
below; the source exists and is already downloaded.

**Not taken: the -子 class.** An earlier, broader version of the rare-form test
also fixed 光子 こうし→みつこ, 冬子 どんこ→ふゆこ, 和子 わこ→かずこ, 伸子
しんし→のぶこ and 塔子 ターツ→とうこ — 197 changes, and real improvements for
reading novels. They are gone, because they rode on the broken condition above
rather than on anything true: every one of those entries is not common, so the
test that was supposed to mean "a rare spelling of a common word" was only
saying "not common".

#### What word frequency would and would not fix

The missing axis is how often a spelling is **the word**, and the source for it
is already in the repo: the JPDB list (`scripts/lib/novel-freq.ts`, cached at
`.cache/jpdb-freq.zip`), built from anime, novels and visual novels and already
downloaded for `yarn build:jlpt`. Measured against the disputed spellings:

| should stay a word | rank   | should become a name | rank    |
| ------------------ | ------ | -------------------- | ------- |
| 希望 きぼう        | 1,254  | 光子 こうし          | 32,309  |
| 丈夫 じょうぶ      | 6,886  | 杏子 あんず          | 42,308  |
| 後味 あとあじ      | 14,319 | 伸子 しんし          | 107,168 |
| 一矢 いっし        | 17,787 | 冬子 / 和子 / 塔子   | absent  |
| 真平 まっぴら      | 25,721 |                      |         |
| 真白 まっしろ      | 25,873 |                      |         |

A cutoff near 30,000 recovers the -子 class and keeps 希望, 丈夫, 後味, 一矢,
真平 and 真白 as words. It is **not** sufficient: 一花 ひとはな is 44,931,
rarer than 杏子's 42,308 and therefore on the wrong side of any cutoff that
settles 杏子, and 古池 and 米蔵 are absent from the list entirely — the same
signal as 冬子 and 和子. Both read as part of live idioms or compounds rather
than as standalone rare words, which rank alone cannot see.

**The cost is a main-dictionary bump.** Word frequency is per JMdict entry, so
it is a column on `entries` in `dictionary.db` — the 120 MB file — which means
`DICT_BASE_VERSION` and a full re-download for every user, not the extended
tier's. `jlpt_level` would have been free but is NULL on every one of these
entries, since levels were only assigned to common ones.

`yarn check:tap-consistency` unchanged at 98.0% / 128 disagreeing pairs.

#### Still not settled

**後味 reads the surname ごみ** instead of あとあじ. It has no counts at all,
and zero is not evidence against a reading, so nothing here separates it from
高遠, which keeps たかとお on 4 sightings. The feature that does not exist in
JMdict or JMnedict does not exist in the counts either — this would need
evidence about how often a spelling is a WORD, which is a different corpus.

#### The tap side

`lookupExactName` ordered by nothing, so a tap on 杏子 led with あこ while the
furigana said きょうこ. It orders by `name_freq` now, readings with no count
keeping their existing order behind the counted ones, and the tap's
name-against-word contest is handed the same dominance and rare-spelling
evidence as the furigana pass, so the two cannot reason from different pictures.
That second part is **neutral on measurement** — no change across the 37,411
corpus taps.

The ordering applies to a **kanji query only**, where every row returned is the
same spelling. A kana query matches several spellings at once and the counts say
nothing across spellings, so ranking あゆみ's 歩美 against 亜由美 by them would
be comparing two different measurements.

The two paths still hold different bars deliberately: a tap needs 96 when an
exact same-span word competes (`AUTO_NAME_ONLY_WITH_EXACT_WORD_CONFIDENCE`)
where furigana needs 90. Nothing in the probe set disagrees because of it, but
that is where a disagreement would come from, not from the counts.

#### The column may not be there

`names.name_freq` arrived in extended DB v4, and a client can run v4 code
against a v3 file: an OTA replaces the JavaScript at once while the 116 MB
download happens in the background, and the local-install path opens whatever
is on disk without comparing versions. A missing column makes the SELECT throw,
which would take down the whole furigana batch rather than just the ranking,
and makes the tap name lookup return no names at all. `hasNameFreqColumn` asks
once per handle instead (`ext-columns.ts`).

### A dead end: ranking readings by how generic they are

Before any corpus was fetched, a cheaper idea was measured and killed: rank a
spelling's readings by how many distinct kanji take that same kana as a name,
recoverable from the shipped table with a self-join and no new data. It ranks
きょうこ first for 杏子, which looked like the answer.

It is noise. Against names whose reading is not in doubt it picks けいこ for
京子, ひろこ for 洋子, さとみ for 恵子, ひろみ for 裕子, かずお for 一郎 and
あき for 愛 — wrong on about ten of the thirteen spellings with more than one
candidate, on margins of 140 against 135. Counting how many kanji share a
reading measures how **generic** the reading is, not whether it fits this
spelling, so よしみ and ひろみ float to the top everywhere.

Do not rebuild it. It is cheap to try and it looks right on whichever case is
being tested.

### A deinflection the entry's part of speech cannot take is not a highlight

The bookmark highlighter enumerates every substring of a slice, deinflects
each, and paints anything whose deinflected form is a bookmarked entry. It
never asked whether that entry could take the inflection, so a noun could be
conjugated: している matched 汁 as a te-iru, く matched the noun 堰 as an
adverbial, だち matched the **prefix** 脱 as a masu-stem.

`deinflect` already carried the answer and nothing read it. Every rule records
`typeOut`, and `DeinflectCandidate.typeMask` is the class the resulting word
must belong to. `posTagsToTypeMask` maps JMdict's tags onto the same bits, and
`explainBookmarkedWordSurfacesInHtml` now refuses a match whose entry does not
admit the rule. The check is in the highlighter only; the tap path has its own
scoring and is untouched.

**Two things the obvious version gets wrong.**

_Any sense is enough, not every sense._ JMdict tags part of speech per sense,
and 勉強 is `n,vs`. Requiring every sense to admit the rule would delete every
suru verb.

_`typeOut` is what the next rule may accept, not what the entry must be, and
one word is reachable by several rules._ `deinflect` keeps one candidate per
output word — `seen` is keyed on the word — so when two rules reach the same
word, the first rule in the table wins and the second is dropped. That was
invisible while nothing read the class. It is not invisible now:

- 叱られる is 叱ら + れる, and both the ichidan `られる` rule and the godan one
  strip onto 叱る. The ichidan rule is listed first, so the candidate said
  "ichidan" and a `v5r` entry was refused. Same for 受け取れば.
- 来て, 来た, 来ない, 来ます, 来ました, 来ている all have a kuru rule **and** an
  ichidan rule reaching 来る. The ichidan one is first, and 来る is `vk`, so a
  bookmarked 来る lost every conjugation.

So `DeinflectCandidate` now reports `entryMask` beside `typeMask`: the union
over every rule that reached the word, where `typeMask` stays the first one
and goes on governing which rule may chain next. Twelve more `entryType`
exceptions would have been the wrong fix for the same bug.

**Three kanji 来-rules were simply missing**, and the ichidan rules had been
covering for them: 来なかった, 来れば, 来たら, 来られる, 来させる, 来よう, 来たり,
来ている, 来てる. Each only adds `vk` to a candidate the other rules already
produce, so the corpus tap diff over every position whose window contains 来
(6,679 taps) is unchanged by them.

**来い is deliberately not among them.** It has its own entry — 2742070, "come!"
— and adding the rule did not add a reading, it replaced the exact one:
tapping 来い then answered 来る and dropped 来い from the result entirely. The
same diff showed the rule's only other effect was an improvement (意図 stopped
swallowing the い of 来いと), and it was still not worth losing the headword. A
bookmarked 来る therefore does not light up 来い; 来い can be bookmarked itself.

**`exp` is read over the whole entry, not per sense.** 違う carries three
`v5u` senses and one tagged only `exp`; mapping sense by sense would read that
one sense as "no class recorded" and leave the whole verb unconstrained.

Classical classes (`v2*`, `v4*`, `vn`, `vr`) and `vz` map to no bit on
purpose: no rule in the table produces those forms, so admitting them could
only let a wrong path through. They are still reachable as the surface as
written. An entry tagged only `exp` is left unconstrained, because JMdict does
not say which class its tail belongs to and かも知れない does take a past.

**Measured.** Over `test/corpus/bocchan.txt` against a real 8,586-entry list:

| measure                     | before | after |
| --------------------------- | ------ | ----- |
| distinct surfaces           | 1,926  | 1,641 |
| painted boxes               | 4,298  | 3,375 |
| share of characters painted | 30.5%  | 23.4% |

**279 surfaces removed, none added.** 123 of the removals are cross-class —
the entry is a verb or an adjective, so the drop could in principle be a real
loss — and each was read individually: every one is an ichidan rule landing on
a godan verb (はない on 張る, わない on 割る), an IKU rule landing on a plain
`v5k` (やった on 焼く), or an imperative fragment (帰ろ, 力になろ). The other
156 are inflections of nouns and prefixes, which is the point of the change.

On the labelled page the same change takes 49 surfaces to 32, 31 boxes to 21,
and coverage from 31.0% to 20.9%; 11 of the fixture's 25 red expectations go
green. `yarn check:tap-consistency` is unchanged at 98.0% / 128 pairs.

**Accepted regression: たいてい.** Removing the wrong span はたい exposes a
wrong span under it. たいてい reaches 炊く through a three-step chain —
masu-stem, te-iru, te-form — every step POS-legal, via an intermediate
たいている that is not a word. Part of speech cannot refuse it; only a word
boundary can. It is in `knownRed` and belongs to the boundary work. Nothing is
worse than before: the character was painted either way.

### A highlight has to be a word the page says, not one its characters spell

Part of speech removed the impossible candidates. What was left was worse to
look at: real inflections of real bookmarked verbs, in the wrong place. はない
inside ではない is a legal negative of 張る. からず inside からずっと is a legal
negative of 刈る. 緒 inside 一緒, かし inside 何かしら, ひた inside ひたすら,
欲し and かった inside 欲しかった, おい and しい inside おいしい. Every one is a
word. None of them is the word there.

**Segment the slice, and keep a bookmark only where the segmentation agrees.**

The segmenter costs almost nothing, because the matcher already does the
expensive part. It enumerates every substring of the slice up to ten
characters, deinflects each, and asks the dictionary about every result — then
throws away everything that is not bookmarked. Keeping those rows instead, and
fetching `part_of_speech` for **every** entry reached rather than only the
bookmarked ones, is enough to know what is a word anywhere on the page.

A run of Japanese characters is then split by a one-pass dynamic program that
maximises the sum of the **square** of each token's length, with an unknown
character scoring −1. Plain longest-match is not enough: からず is a word, so
it wins the first three characters and leaves っ and と behind. Squaring makes
から + ずっと (4 + 9) beat からず + っ + と (9 + 1 + 1), and the preference
generalises — in a dictionary of 170,000 entries almost any two characters are
_something_, and the square is what stops those somethings from winning. A tie
goes to the longer token: 台所 + で and 台 + 所で score the same, and the page
means 台所.

A bookmark is painted where it is a token, where it is the noun a suru verb
was built from (勧誘 in 勧誘される — the bookmark the reader saved), or where it
is the leading half of an all-kanji compound. That last rule is what keeps
岩盤 inside 岩盤浴 while refusing 欲し inside 欲しかった: a kanji compound
decomposes into words, an inflected adjective does not, and requiring both the
token and the head to be entirely kanji separates them. The head must be at
least **two** characters — allowing one put a bookmarked single kanji back
inside every compound beginning with it (弱 in 弱虫, 数 in 数学, 病 in 病気),
118 boxes of the corpus, which is the noise this whole change exists to stop.

**The tap resolver was tried first and is both slower and worse.** Calling
`smartLookupWithOffset` once per proposed position costs ~5 ms, which is
1.5–2 s for a real slice (`calcCharsPerPage * 13` ≈ 3,350 characters, and it
grows as the reader prefetches); a slice-wide query memo saved 13%, dropping
the extended DB 25%, narrowing the window from 24 to 8 half. Matching **and**
confirming the same slice costs 105 ms end to end, of which the segmentation
pass is about 2 ms — and the SQL round trips went _down_, from ~366 to ~132,
because the sense fetch moved out of the per-word batch loop. And the resolver is the worse judge: it rejects 励み,
帰り and しめくくり, because tapping 励み answers entry 1557360, the **noun**
励み, while the bookmark is 1557390, the **verb** 励む. Demanding the tap's
entry id would delete the highlight that was explicitly accepted.

**The kana guard had to be narrowed at the same time.** It drops a kana match
for an entry the dictionary writes in kanji, so that a bookmarked 事 does not
light every こと — segmentation does not fix that, because こと is a token. But
ひたすら's only kanji forms are 只管, 一向 and 頓, every one tagged `rK`:
JMdict is saying the word is written in kana. The guard now ignores an entry
whose kanji forms are all `rK` or `sK`. That is 1,128 of 174,388 entries with
kanji (0.6%), and 116 of the 8,586 bookmarks measured against.

**Measured** over `test/corpus/bocchan.txt` with a real 8,586-entry list:

| measure                     | before phase 2 | after phase 2 | after this |
| --------------------------- | -------------- | ------------- | ---------- |
| distinct surfaces           | 1,926          | 1,647         | 962        |
| painted boxes               | 4,298          | 3,375         | 2,757      |
| share of characters painted | 30.5%          | 23.4%         | 19.4%      |

699 surfaces removed and 14 added. Every addition is the kana guard: ようやく,
わざわざ, どころか, ついでに, ちっとも, よっぽど, とうとう, において, はたと,
わざと, ずるい, しかも, けち, バッタ — kana words whose only kanji spellings
are rare. Removals were read in two samples, longest and shortest. The long
ones are all a truncation replaced by the whole word — 考え込んで by
考え込んでいる, 腰をかけて by 腰をかけている, 減りました by 腹が減りました. The
short ones are all a single character inside a real word — 泉 in 温泉, 鉄 in
無鉄砲, 験 in 経験, 腰 in 腰を抜かした, 詩 in 新体詩.

On the labelled page it goes from 21 painted boxes to 9, and from 31% of the
characters to 10.5%. What is left is 励み, 帰り, 岩盤, 流し, しめくくり, 夜更け,
ひたすら, 飽きない, 互いに — every span the owner accepted, the two that were
right but unremarked, and ひたすら, which he had asked for. **Nothing wrong is
left on that page.** `yarn check:tap-consistency` is unchanged at 98.0% / 128
pairs; this touches no part of the tap path.

**Accepted regression: より.** The page says というより, which is one token, and
より is not its head, so the one span the owner accepted that boundary
confirmation takes away is this one. Whether より is worth highlighting was
already an open question — it is a particle, it appears constantly, and it was
listed under density rather than correctness.

**Not done: positional spans.** Confirmation is positional but the protocol
still ships a set of surfaces, so a surface confirmed in one place is painted
in every place. On the labelled page only two surfaces recur at all and both
were already wrong, but the slice is twelve times the page and short kana
surfaces will recur. Making it positional means agreeing on character offsets
between the React Native side, which holds slice HTML, and the webview, which
holds a DOM it splices during pagination — they disagree about entities,
surrogate pairs, comments, and text outside `<p>`. It needs its own change,
keyed per block rather than per slice.

### A tap offers the bookmarked word inside its own span

Tapping takes the longest match it can and highlighting marks the smallest, so
the two routinely name different words on the same characters. The clearest
case is the one the owner found: the page says 励み, the tap answers entry
1557360 — the **noun** 励み, "encouragement" — and the bookmark is 1557390, the
**verb** 励む. The box and the dictionary panel were looking at the same four
pixels and disagreeing.

The lookup now appends one more word to its result list for each bookmarked
word painted inside the span it resolved. `DictionaryPopup` already renders
the results as a row of pills to choose from, so there is no new interface;
the pill is labelled with the **dictionary form**, not the page's spelling,
because 励む is what was asked for and two pills both reading 励み say nothing.

Two things make it honest rather than approximate:

- **It asks where the reader painted, not what is in the set.** The device
  paints greedily, longest first, never overlapping, so a surface in the set
  can be unpainted at a given position because a longer neighbour took the
  characters. `paintedBookmarkSpans` reproduces that scan.
  `bookmarks.painter-parity.test.ts` runs it against the real webview painter
  under jsdom on six shapes and asserts the same offsets — the webview has no
  dependencies by design, so the two cannot share code and are pinned
  together instead.

  **What that parity does not cover**, and it is worth being exact: the two
  run the same algorithm on different text. The device scans each `<p>` from
  its first character; a tap carries a window of about 35 characters that
  begins mid-paragraph. Greedy matching is not translation-invariant, so a
  window starting inside what would have been a longer match can offer a
  bookmark the device did not paint — surfaces 大人しい and しい, with the
  window opening at 人, is the shape of it. Rare, and in the wrong direction
  only (an offer with no box, never a box with no offer). Closing it needs the
  absolute slice offsets, which is the same thing positional spans need.

- **It costs the tap nothing.** The entry lookup runs after the results are
  shown and appends to them, guarded by the tap's placement id, so an
  overlapping tap cannot cross-contaminate. The provenance it reads is the
  map the matcher already built for the current slice and the reader used to
  throw away; it is cleared when highlighting is off.

`results[0]` is never touched, so `yarn check:tap-consistency` cannot move,
and it did not: 98.0% / 128 pairs.

**Half-served, and worth knowing.** Choosing the pill opens that word's entry
and its SRS stats, which is what was asked for, but it does not shrink the box
drawn in the page to that word — the pill press calls `animateToWordIndex` and
sends no `highlight` message. Doing that needs the positional spans that are
still not done.

### A kanji word's kana reading loses to the word the characters already spell

Found on a second page of the same novel, 2026-10-01. Four highlights, one
cause:

| painted            | matching                     | the page actually says |
| ------------------ | ---------------------------- | ---------------------- |
| 東京**だけ**でも   | 抱く (だく), imperative だけ | the particle だけ      |
| 覗いていた**だけ** | the same                     | the same               |
| 「**いい**わ」     | 結う (いう), masu-stem いい  | 良い                   |
| 敷**きこんで**     | 着込む (きこむ), te-form     | 敷く + 込む            |

Each is a kanji-written verb reached through its **kana** reading plus an
inflection. The kana guard already refuses a bare kana match for a kanji word
— that is why a bookmarked 事 does not light every こと — but it lets an
inflected one through, because a page spelling a word in kana and inflecting
it is real evidence: のめりこんだ really is のめり込む, ふくれている really is
膨れている.

**The exception now stops where the characters already spell a different
common word.** だけ is the particle, いい is 良い, and reading either as the
kana of some kanji verb's inflection is the worse answer. "Different" is load
bearing: ついている is its own entry written out in full, the uninflected path
to it is already gone to the guard, and counting the entry against itself
would leave the word with no way to be painted at all.

Measured over `test/corpus/bocchan.txt` with a real 8,586-entry list: **962 →
919 surfaces, 44 removed and 1 added**, 2,757 → 2,141 painted boxes, 19.4% →
15.4% of characters. Every removal was read: あまり matching 余る where the
page means 余り, あれ matching 荒れる where it means 彼れ, かえって matching
帰る where it means 却って, つもり matching 積もる where it means 積もり, くれる
matching 繰る where it means 呉れる, いけない matching 逝く where it means
行けない — forty-three more of the same. The labelled first page is unchanged
at nine boxes.

**A correction to the `exp` rule came out of the same measurement.** An entry
with no word class of its own is left unconstrained, so that かも知れない can
take a past. That was reading **any** entry with an `exp` sense as classless,
and 棒 is `n,exp` — so ぼって was painted across the corpus as a te-form of the
noun 棒. `exp` now has to be the only class recorded.

### Negative ～ぬ, ～なく and ～なくて, and the guess they are

Reported from a novel: 広げた風呂敷を**畳まぬ**ようなもの printed じょう over 畳
and answered the tap with the mat たたみ, and 散歩に**誘わなく**なった printed
いざな — a girl's name out of JMnedict — and answered nothing at all. Neither
form was in the rule table.

- **～ぬ** is the ～ない of literary prose, parallel to the ～ず rules above and
  spelled out the same way per godan row, plus ichidan, する and くる.
- **～なく / ～なくて** is that negative's adverbial and its te-form, the half of
  誘わなくなった that is a verb. The adjective rule く→い already reaches 誘わない
  and stops there: nothing is spelled that way, and it types the result ADJ so
  no verb rule can follow it.

**Every one of them is a guess, and that is the load-bearing part.** The first
version of this change shipped the rules unmarked, and an adversarial review
found what that costs, over a population the corpus cannot reach — all 4,155
～ない-adverbial and ～ぬ dictionary surfaces, where **237 taps moved and 53 were
regressions**:

|                            | was               | became |
| -------------------------- | ----------------- | ------ |
| 問題**でなく**単なる誤解だ | で無い            | 出る   |
| **弛まぬ**努力             | 弛まぬ (たゆまぬ) | 緩む   |
| **卒なく**こなす           | 卒なく            | 終わる |
| 馬が**いななく**           | 嘶く              | 犬     |
| **せわしなく**歩き回る     | 忙しない          | 世話   |

Each of those surfaces is itself a dictionary entry, and the manufactured verb
beat it because `hasCommon` pays 100 against five points a reason. The repo
already had the answer — **a reading that needs no guess wins first**, the rule
that keeps にしては from being answered with にしても — so the rules now carry
`guess: true`, `deinflect` propagates a `guessed` flag (merging it, because a
word reachable without a guess is not one), and the gate was extended to the
three walks that never had it: the drag-selection expansion, `findFirstWord`
and `findBoundaryWord`. The furigana resolver asks the same question as a
**preference, not a weight** — commonness pays +120 there against −80 for a
deinflection, so a score could not express it.

Checked against every one of the 53: all fixed, and none of 畳まぬ, 知らぬ,
誘わなく, 出なく, 心配しなく, 消えぬ, 知れぬ is itself an entry, so every win
still speaks. Ordering cannot defeat the gate — the surface is candidate 0 and
the ADJ block precedes the negative block, measured over 747,558 surfaces with
zero counterexamples.

Three further guards, each from a measured failure:

- **`typeIn: RAW` on every rule.** ～ぬ is also a verb ending — the te-form rule
  んで→ぬ makes たくさんで a ぬ-verb — so without it a second pass strips the
  ending the first one produced: たくさんで answered 託す, んです answered 酢.
- **`stemEnd: V1_STEM` on the three bare ichidan rules**, a new field holding
  what the character before the ending has to be. お小遣い**が**なくて passes a
  length floor, so the bare rule reached がる.
- **`minStem: 1` on the row rules, and none on せぬ / こぬ / しなく / こなく**,
  which are whole words with no stem at all.

**A bit leak the same review found, fixed here:** `ANY` is `0xff` and `RAW` is
`0x80`, so a rule whose output is typed `ANY` re-granted RAW — よぎなくさせる
reached 余儀る through the suru-noun rule, three rules deep. Rules that emit
`ANY` now emit `ANY_OUTPUT`, which is `ANY & ~RAW`. Latent today (余儀る and
程る are not words) and found by sweeping 827,842 dictionary forms.

**Not shipped here, deliberately:** ～ん (読まん), ～ざる (行かざる) and ～なくちゃ
resolve to nothing at all. ～ん needs its own collision sweep before it goes
near the table — it collides with sentence-final ん, with のだ→んだ and with
every noun ending in ん, which is the over-broad shape that produced
たくさんで→託す in the first place.

### A kanji followed by a particle is the particle

花のつぼみのような printed **あや** over 花, and 水の流れ printed **にず** over
水. JMnedict holds 花の (Ayano) and 水の (Nizuno); the furigana path takes a
name outright when no word covers the surface, the renderer takes the longest
surface, and two characters beat one. Both spellings have no observed
frequency at all — nobody has been seen reading 水の as にずの.

The ruby that came out is the tell: `stripOkurigana` had already cut the の
off, so the page got a reading over 花 alone that only the whole name has.

**Refusing every kana-tailed name was too wide, and review caught it before
this shipped.** Two separate costs, neither visible in the corpus:

- **33 place and person names lost their ruby entirely** — 十勝ダム, 一戸トンネル,
  三輪ひとみ — because their kanji prefix is also a `counter_readings` form, and
  a counter rejected by the `showCounters` setting shadows the whole span. With
  counters on, 17 of them printed the counter instead: 一戸【いっこ】.
- **The ◯◯通り street class was garbled, which is worse than absent.**
  三条通【さんじょうどお】り became 三条通【さんじょうどおり】り — the reading
  absorbs the り and the page reprints it. 94 of the 101 通り spellings changed.

So the guard is what the bug actually was: a name is refused only when the
surface ends in a **single-kana particle** (の, が, を, に, は, へ, と, も, や, か)
directly after a kanji. り, め and み are the name.

Measured over the corpus: **13 of 67,299 surfaces change, every one a junk name
reading going away** — 上の, 仲の, 坂の, 夢か, 木の, 東の, 松の, 水の, 浜の, 理の,
育の, 高の, 魚の. Nothing gains or reads differently. Over the whole kana-tailed
population (7,467 spellings) the narrowed guard changes 308 and loses **none**,
against 2,785 changed and 33 lost for the wide one; 帝国ホテル, 龍ヶ嶽トンネル,
三条通り, お染め, 晴み and 鉞り are all back to what they read before.

**Accepted, and inherited rather than introduced:** a handful of single-kanji
given names spelled with one trailing particle still lose — 秋を (Akio) reads
秋【とき】を. All carry a frequency of 1 or 2, and the fallback is the kanji's
own word reading.

**One thing this does not reach:** a name entry short-circuits the JLPT level
filters and the word entry that replaces it does not, so under a restricted
level config 165 surfaces lose ruby that the name was carrying past the filter.
That is `entry.isName ||` in `shouldShowFuriganaForSurface`, not this guard.

五十嵐, 杏子, 丸木, 後味 and 西條 are unmoved — nothing written in kanji is
touched.

### A two-kanji name the counts have seen may override a one-kanji word

演じた**西條**さんがそばに来て: the furigana read さいじょう and the tap, on the
same two characters, answered 西/せい — "Spain". Tapping the second character
gave the name; tapping the first gave the word.

`AUTO_NAME_OVERRIDE_MIN_LENGTH` is 3, and the note beside it says what that
costs: "two-kanji surnames (渋沢, 山田), which still resolve to a single kanji".
The floor is there for two-kanji spans straddling a word boundary — 田先 out of
山田先生, 中電 out of 食事中電話 — and `names.name_freq` now separates those
cleanly: 西條 is さいじょう in **24** sightings, 山田 やまだ in 935, 渋沢 しぶさわ
in 34, while 田先 and 中電 have never been observed as names at all. A
two-kanji name with any observed frequency may now override
(`nameMayOverrideShorterWord`).

Measured over **11,296** auto-mode corpus taps: **12 change, all of them
names in the book that a tap used to answer with a single kanji** — 茂作 (was
作), 箱根 (箱, 根), 小倉 (小, 倉), 古賀 (古, 賀), 浅井 (井, three times) and
堀田 (堀, 田). Nothing else moves, in either direction.

The floor itself is untouched above two characters, and an uncounted two-kanji
spelling is still refused — which is the whole of what keeps 田先 out.

**A number is a count until the counts say otherwise.** Review found the
relaxation handing 鳥が**二羽**いた to ふたば, 全**三巻** to みつまき, 犬が**二戸**
to にと and 第**三章** to さんしょう — each a real span of the app's own
`counter_readings` table, each also a name somebody has been seen with once or
twice, and each returned as the _only_ result with no word to fall back to. A
span carrying a kanji numeral now needs **three** sightings rather than one
(`AUTO_NAME_OVERRIDE_NUMERAL_MIN_FREQ`). That clears every one of those at 1–2
and costs nothing real: 一郎 is 393, 三郎 334, 七海 38, and the corpus diff is
unmoved at 12. 1,334 of the 2,242 numeral-carrying two-kanji spellings lose the
override; 908 keep it.

**The bound, recorded because it is much wider than the two straddles above.**
**36,405** two-kanji spellings that are not dictionary words now outrank a
one-character word, **18,212 of them on a single sighting**. A synthetic frame
— `その{A}{B}を見た。` over the 11,248 pairs whose characters are each a common
standalone word and whose pair is not a word — flips **21,598 of 22,496 taps**
from word to name. Taken as shipped, because the frame is the thing being
measured there, not the language: two adjacent single-kanji words with no kana
between them is rare in real prose, which is why the same relaxation moves 12
taps in 11,296 of Bocchan and every one is a name in the book. If this ever
reads wrong in the wild, the fix is a frequency floor set from the
distribution, not another guard. `yarn check:tap-consistency` is word-mode and
cannot see any of this.

### A suru-verb noun proves its own kana tail, and the name walk refuses the same starts

海外へ赴任した**ため**だった answered したため — 認む, "to write down", in its
imperative — out of a span starting inside 赴任した.

"A span may not start inside a word" proves a position closed by looking the
kanji run and its kana up together and finding an **inflecting** word. 赴任した
deinflects to 赴任する, which no dictionary spells, and then to 赴任, which every
dictionary does — and that second step was counted as a chain through an
auxiliary and dropped. Stripping する off a suru-verb noun is not a second word,
so it no longer counts towards that bound, and an entry reached that way proves
the tail when it is tagged `vs`.

**Closing those starts exposed the other half.** The name walk had no such
guard, so with the word span refused, 注文したから came back as the surname
たから. Auto mode now computes the starts once and hands them to both walks
(`okuriganaStartsForTap`).

**And NAME mode, which review caught twice.** `autoLookupWithOffset`
computes the starts and hands them to both walks, but the reader calls
`nameLookupWithOffset` directly when the user switches to Names, and that call
had no starts at all — so name mode went on answering 注文したから with たから.
It computes them too now, when the word dictionary is open.

**And then the name walk's own hole.** A name may override a shorter word
outright when the surface is "an exact name match", and that accepted a match
on the name's **reading**: ためだった holds the reading of 為田, したから holds
多可良's. The override now asks that the surface be how the name is _written_ —
its kanji form, or the whole spelling for a name written in kana, so ひろし and
たけし still resolve (`nameSpellingIsSurface`).

Measured over 11,296 corpus taps. **Word mode: 15 change, all of them a span
that was cutting into a suru-verb** — 注文したから→から, 勉強してやろう→やろう,
合点したもの→もの, 紹介してやる→やる, 心配しなくって→って, 珍重してく→くれた.
**Auto mode: 489 change — 472 of them a kana run that was being answered with a
JMnedict name and is now answered with a word**: たから→から (24 taps),
いから→から (14), たのだ→のだ, ものか→もの, ぬから→から, なるの→なる, plus a
tail that reaches real words — いなが→云い, きなが→泣き, きでな→好き,
みもな→望み, しもなか→少しも, うがい→使う. Two are lateral (いなひと→ひとは,
junk either way). Gate 126 disagreeing pairs → **123**.

**What this does not fix:** めだった still answers 目立つ. ため is a noun, so
its め is not okurigana and nothing proves the position closed; separating that
from a real word boundary needs segmentation, not a rule.

### A drag selection is answered with what it selected, first

Selecting **展開** in チェーン展開の新古書店 answered チェーン展開. The expansion
step — which tries substrings of the selection plus ten characters either side,
longest first — runs before anything else and returns on its first hit, so a
selection that is itself a word was never asked about. Reported as: "when I
drag EXACTLY a region I want the lookup restricted to that region, the opposite
of greedy walking both directions when I just tap."

A tap has no boundary, so it has to guess one. A drag is the boundary. The
selection's own spelling is now looked up first and emitted first, and the
expansion still runs and lands under it:

| selected               | prefix / suffix       | was                          | now                         |
| ---------------------- | --------------------- | ---------------------------- | --------------------------- |
| 展開                   | チェーン / の新古書店 | チェーン展開                 | **展開**, then チェーン展開 |
| べた                   | 食 / 。               | 食べた                       | **べた**, then 食べた       |
| 色い                   | 茶 / シャツ           | 茶色い                       | 茶色い                      |
| くもない               | 若 / という           | 若くもない                   | 若くもない                  |
| 若くもないというのに姿 | / 勢がよく            | 若くもない・というのに・姿勢 | unchanged                   |

Nothing is lost: a selection that is not a word still reaches past its own
edges, and a long selection still walks word by word with the suffix attached,
which is what 姿 → 姿勢 depends on.

**The selection cases in `lib/smart-lookup.test.ts` re-implement the walk** in
the test file rather than calling it, so they cannot see this change at all —
they pass before and after. `lookup.selection.test.ts` runs the shipping
function — including `autoSelectionLookup`, which is what the reader's default
mode actually calls and which nothing covered until review said so.

**The expansion step had no literal-first gate either**, which is where the
negative rules above would have spoken over an entry on a drag. It has one now,
as do `findFirstWord` and `findBoundaryWord`.

## Rejected: scoring a kana-spelled kanji word below one the dictionary spells that way

The fourth case above, 敷きこんで, is not the guard. The dictionary has no
敷き込む, and きこんで (four characters, squared: 16) beats 敷き + こんで
(4 + 9), so the boundary lands after the 敷 and the kanji is left outside its
own highlight.

Scoring such a token as one character shorter — `(n-1)²` — fixes it, keeps
あぐらをかいた and もてあまし, and was still not worth shipping. On the corpus
it split longer kana-spelled words into fragments: だまっていれば became
まっていれば, ふくれている became くれている, 申し付けられた became けられ,
構いません became いません, and 居させる became いさせる — nine new wrong spans
against two fixed. The cheap variants are worse: weighting the token linearly
instead loses あぐらをかいた and もてあまし, which are the same shape and are
right.

敷きこんで stays wrong, pinned as `knownRed` in the fixture with あぐらをかいた
beside it as the case that rules the cheap fixes out.

**It is a dictionary gap, and that is checkable.** The same shape with the
compound present is right:

| text       | compound in JMdict | きこんで painted |
| ---------- | ------------------ | ---------------- |
| 敷きこんで | no 敷き込む        | **yes**          |
| 書きこんで | 書き込む           | no               |
| 持ちこんで | 持ち込む           | no               |

So nothing here needs a cleverer rule; it needs the entry. What it also
exposed is the cost of confirmation not being positional: put 敷きこんで and
書きこんで in one sentence and きこんで is painted **twice**, the second time
inside a token that is correct on its own, because the surface was confirmed
somewhere else on the page. That half survives a dictionary fix. Case 37.

### A reading the user pins, for one book, over everything the dictionary says

**Taken 2026-10-01**, as
[furigana-pin-plan-v1.md](furigana-pin-plan-v1.md).

Some readings no ranking settles. 杏子 is きょうこ in the novel Sam is reading
and the apricot in the next one; frequency got the automatic answer as far as
it goes (above) and cannot go further, because the page carries no evidence
either way. So the reader asks: long-press a kanji run, choose from every
reading the dictionaries know, and that book remembers it.

**The key is the kanji run as the page spells it** — the base of the ruby the
press landed in, or the run of kanji around the character under the finger. Not
an entry id: an id cannot say "show no furigana here", cannot hold a reading no
entry carries, and is not what the user pressed. The value is the reading, and
the empty reading is that suppression.

**A pin ignores the furigana settings.** Names are off by default, so a pinned
name reading that obeyed the filter would do nothing and look broken.

**The picker offers; it does not choose.** Nothing in `furiganaReadingCandidates`
filters a reading for being unlikely — that is the whole reason the user is
being asked. What it does do is rank, and the one rule there matters: **a name
reading leads only where the spelling has settled on it**, by the same two
thresholds `isDominantNameReading` already uses (a 0.6 share of at least 5
sightings). Without that floor every spelling that is also somebody's surname
leads with the surname, and the first row is what the sheet preselects:

| run  | first candidate without the floor | with it  |
| ---- | --------------------------------- | -------- |
| 杏子 | きょうこ (26 of 33)               | きょうこ |
| 後味 | ごみ (surname, uncounted)         | あとあじ |
| 大人 | やまと (1 sighting)               | おとな   |
| 一日 | いちひ                            | いちにち |

What the floor costs is 高遠: たかとお in 4 of 4 sightings, settled but under
the minimum of 5, so the picker leads with こうえん — 高遠 is also a word — and
たかとお is one row below it. Raising the floor to catch it would let a single
sighting decide, which is what the floor exists to prevent.

(**Corrected 2026-10-02**: this paragraph used to say the resolver still read
高遠 as たかとお. It does not, and had already stopped when the sentence was
written — `resolveFuriganaBatch` answers こうえん. The reason is the ordinary
scoring, not the multi-type hole recorded under "Rejected" below: with its
`surname` term restored 高遠 reaches 83, still under 90, because four listed
readings earn nothing on the question of whether a name is what is on the
page.)

**Every kana row of an entry is offered**, not the first: 今日 is きょう,
こんにち, こんち and こんじつ, and the one the resolver picked is exactly what
is being overruled. Katakana stays as written — 煙草 really is タバコ. What
JMdict's kana column holds that is _not_ a reading is refused: 16,774 rows
carry a non-kana character (粁 is listed キロ・メートル, and the interpunct
U+30FB sits inside the katakana block), 日 carries んち from a compound, and
JMnedict lists 日 as the place name にっ. The four single-kanji forms ending in
っ — 叱, 𠮟, 突, 吹 — go with them; each is a reading that only exists inside a
compound.

**Accepted limits**, each pinned by a test:

- JMdict restricts some readings to some spellings (`re_restr`) and
  `scripts/build-dictionary.ts` drops the field, so the picker offers ひるこ
  for 恵比寿 though it belongs to 蛭子. Harmless in a list the user chooses
  from; fixing it means rebuilding the dictionary.
- A pin matches its run **everywhere in that book**. 杏子 the character and 杏子
  the apricot in one novel cannot differ. The same unbuilt positional work as
  the bookmark spans above.
- A re-imported copy of a book is a new id and starts with no pins.

**The gate is `yarn sweep:render`**, added for this. `yarn sweep:furigana`
resolves readings and cannot see a change to the code that turns them into
ruby, which is where the pin pass lives. Over the whole corpus, with every rule
on and names and counters off so that surfaces are rejected and cast their
shadows, the pin pass changes **0 of 100 chunks** when no reading is pinned.
`check:tap-consistency` unchanged at 98.0% / 128.

Three things the renderer alone cannot get right, each with a test that fails
without it: one pin makes the page carry furigana, so the line height and how
many characters fit on a page change with it; the slice cache key and the
re-render snapshot carry the pins, or a pinned page keeps serving the reading it
had; and a slice with a pin but nothing extractable still has to be painted.

### A bookmark is painted where it was confirmed, not wherever its characters appear

The matcher used to hand the painter a flat SET of surfaces, and the painter
painted every occurrence of each. So a word confirmed in one place lit up in
another: つい, confirmed as the adverb at the head of a sentence, was painted
again inside について further along the same line; きこんで, confirmed inside
敷きこんで because the dictionary has no 敷き込む, was painted inside 書きこんで
as well. That was fixture case 37, named and left unbuilt since
2026-10-01.

The matcher now emits positions. `confirmRuns` records where each confirmable
surface sits inside its run, `placeAccepted` keeps the ones the accept loop
admitted — longest first at a shared start, so 助手席 still beats 助手 — and
the painter paints those offsets and nothing else.

**Positions are keyed by the run's text, not by a character index into the
page.** The matcher scans an HTML string and the painter walks the DOM, and
the two will not reliably count to the same number — one sees `&amp;amp;`, the
other sees `&amp;`; one sees the chunk the reader prefetched, the other the
part of it that is laid out. They do agree on what the characters ARE.
`segmentRun` is a pure function of the run, so identical run text always
segments identically and a lookup by text is exact wherever it succeeds.

Two consequences had to be handled rather than hoped away:

- **The tap's text window cannot be used to find a placement.** It is fifteen
  characters back and twenty forward and it concatenates across paragraphs, so
  the run it contains is clipped at both ends or fused with another. The
  webview now reports the tapped run and the tap's offset within it
  (`tappedRun`), and `bookmarksInsideSpan` takes run coordinates.
- **The matcher's copy of the page has to be cut where the DOM is cut.** The
  reader appended prefetched HTML to its copy while `replaceOffscreenContent`
  deleted the DOM from the last laid-out character, so the paragraph at the
  seam was a truncated prefix in the page and whole in the matcher — and an
  exact lookup silently drops every highlight in it. `truncateHtmlAtVisibleChars`
  makes the two the same string. Guessing instead — falling back to a
  placement whose run merely STARTS with the one on the page — was written and
  thrown away: a truncated 助手 prefix-matches an unrelated 助手を呼ぶ and
  paints a span the matcher never placed, which is the bug this whole change
  exists to remove.

Measured over `test/corpus/bocchan.txt` against the proxy list
(`yarn proxy:bookmarks` — the reader's own list is on the device):
**11,074 → 7,078 painted characters, 29.7% → 19.0%**, 5,655 → 3,592 boxes. The
accepted surface set is unchanged at 1,267; only where they are painted moved.
Every one of the 328 "added" boxes is the surviving half of a box that lost its
neighbour, and exactly **three characters** are newly painted, all three
extensions of a span that was being cut short: 正直 → 正直に twice, and
一つつい → 一つついて.

`check:tap-consistency` unchanged at 98.0% / 128. `sweep:furigana` and
`sweep:render` byte-identical.

**One trade, named and accepted.** 年 in 八つという年の差 is no longer painted,
because the page's segmentation reads 年の差 as the word. The 年 inside
十数年にわたる still is, because 十数年 is not in the dictionary and 十数 + 年
is how that run segments. The rule — the characters have to be a word HERE —
is the one that was already decided; positions are what finally enforce it.

### Saving a word shows it before it is written

Bookmarking in the reader got slow when highlighting learned to read the
page: every toggle re-ran the whole matcher, and the matcher is ~130ms per
4,000 characters on a laptop with a synchronous dictionary. Measured where it
goes: deinflecting every substring of the page is ~51ms and the four batched
SQL passes ~47ms, and **none of it depends on what is bookmarked**.

So the pass is split. `analyseHtmlForBookmarks` reads the page — what each
stretch of characters could be, which entries those words belong to, and
where the page says a word — and `matchAnalysedBookmarks` is the synchronous
remainder that asks which of them are saved. The reader holds the analysis
against the HTML it was taken from, so a toggle repaints without re-reading.
A test counts the queries: zero after the first pass.

That left the part the user was actually looking at. The button could not
change until the write had landed — a MAX(position), two INSERTs, and on the
way out two UPDATEs and a SELECT — so the stores now move first and an undo
puts them back if the write throws. The same for the list popover's tick,
which is the control that actually un-bookmarks.

Two things that forced themselves out of hiding:

- **The store had to learn which lists hold a key.** `remove` used to drop a
  key outright and a separate COUNT decided whether it should; now
  `listIdsByKey` is maintained on every add and remove, and a key stops being
  bookmarked when the last list lets it go. That also closed a quieter bug:
  the old COUNT spanned default and soft-deleted lists, which `load()`
  excludes, so an entry in a default list stayed "bookmarked" until the next
  hydrate silently flipped it off.
- **Reconciling against the database is only safe when nothing else is in
  flight.** Tap-remove from one list and tap-add to another, and the first
  write's reconcile reads the database before the second's insert lands and
  deletes a membership the user just asked for. A per-key in-flight count
  skips it; the test watches every store transition and fails if the word
  blinks off.

The ~8,500-id version string the reader rebuilt on every toggle — sorted and
joined, about 60KB — is now a 32-bit mix summed over the ids with the count in
front, one walk and no array.

### A word spelled exactly as the page spells it keeps the page

後味が悪い is the set phrase and ごみ is a JMnedict surname nobody has been
observed to use, and the reader printed ごみ over it. Queue `0cfac0-16`, which
is `0cfac0-10` met a second time.

The name wins on its type alone — `surname` is worth 18 — and the only thing
standing against it is the discount a word earns for being spelled exactly the
way the page spells it. That was 16, which left 後味 at exactly 93 against a
threshold of 90 — and the threshold is inclusive, so 17, 18 and 19 all still
print ごみ. It is now **20**, which lands 後味 at 89, and 20 only when the
counts have NOT settled on the name.

**The condition is what keeps this a tie-break.** 109 is the most this branch
can score — both candidates' matched text is the surface, so the length terms
never fire — so a flat 20 would mean no name could ever again beat a
non-common exact word in the furigana path, and the dominance floor above would
have nothing left to decide. A flat 20 was measured and rejected for that
reason, and because it cost 丸木: a real surname in the corpus
(丸木が芝の写真師で) that lost a `[name]` tag it should have kept.

Measured over all **67,299** corpus surfaces, **33 change**, none gained or
lost a reading, and every one was read:

- **19 only lose a `[name]` tag they should never have carried**, the reading
  unchanged: 万両 まんりょう, 別段 べつだん, 団子 だんご, 小間物 こまもの,
  敷石 しきいし, 旗本 はたもと, 木鉢 きばち, 毛頭 もうとう, 沙汰 さた,
  沙門 しゃもん, 沢庵 たくあん, 潮水 しおみず, 談義 だんぎ, 道楽 どうらく,
  釣竿 つりざお, 錠前 じょうまえ, 随行 ずいこう, 頭巾 ずきん, 鬼瓦 おにがわら.
- **10 change the printed reading to the word**: 人声 じんせい → ひとごえ,
  仰山 おおやま → ぎょうさん (無暗に仰山な音), 依怙 えご → えこ (依怙贔負),
  出立 でだち → しゅったつ, 田楽 たらが → でんがく, 船中 ふななか →
  せんちゅう, 船端 ふなば → ふなばた, 西日 にしにち → にしび, 遠国 とおくに →
  えんごく, 金満 かねみつ → きんまん (金満家).
- **3 are substring artefacts**, where the sweep's surface is not a word on the
  page at all: 本立 (the corpus says 栗の木が一本立っている), 階下
  (二階下に居た) and 間物 (inside 小間物). Neither reading is right because
  neither spelling is there.
- **One regression, named and accepted**: 肋骨 ろっこつ → あばらぼね. ろっこつ
  is the reading in practice and it was reaching it through JMnedict. The word
  entry lists あばらぼね first and the build keeps JMdict's order, so taking the
  word hands back the rarer of its two readings. The cause is the kana order,
  not this discount.

杏子 is unmoved at きょうこ — the frequency work's own case, and safe because
あんず is common, which takes the deeper `exactCommonWord` branch instead.

**The tap shares this scorer**, and `check:tap-consistency` cannot see a chip
appearing or disappearing — it counts whether two taps agree on a span. So the
354 surfaces the corpus reads as names were resolved through
`autoLookupWithOffset` before and after: **none of them changed**, in content
or order. Not a proof that no tap can move, but none does here.
`check:tap-consistency` itself is unmoved at 98.0% / 128, and `sweep:render`
moves 30 of 100 chunks, which is the 33 readings reaching the page.

## Rejected: scoring a kana-spelled kanji word below one the dictionary spells that way

The fourth case above, 敷きこんで, is not the guard. The dictionary has no
敷き込む, and きこんで (four characters, squared: 16) beats 敷き + こんで
(4 + 9), so the boundary lands after the 敷 and the kanji is left outside its
own highlight.

Scoring such a token as one character shorter — `(n-1)²` — fixes it, keeps
あぐらをかいた and もてあまし, and was still not worth shipping. On the corpus
it split longer kana-spelled words into fragments: だまっていれば became
まっていれば, ふくれている became くれている, 申し付けられた became けられ,
構いません became いません, and 居させる became いさせる — nine new wrong spans
against two fixed. The cheap variants are worse: weighting the token linearly
instead loses あぐらをかいた and もてあまし, which are the same shape and are
right.

敷きこんで stays wrong, pinned as `knownRed` in the fixture with あぐらをかいた
beside it as the case that rules the cheap fixes out.

**It is a dictionary gap, and that is checkable.** The same shape with the
compound present is right:

| text       | compound in JMdict | きこんで painted |
| ---------- | ------------------ | ---------------- |
| 敷きこんで | no 敷き込む        | **yes**          |
| 書きこんで | 書き込む           | no               |
| 持ちこんで | 持ち込む           | no               |

So nothing here needs a cleverer rule; it needs the entry. What it also
exposed is the cost of confirmation not being positional: put 敷きこんで and
書きこんで in one sentence and きこんで is painted **twice**, the second time
inside a token that is correct on its own, because the surface was confirmed
somewhere else on the page. That half survives a dictionary fix. Case 37.

### A reading the user pins, for one book, over everything the dictionary says

**Taken 2026-10-01**, as
[furigana-pin-plan-v1.md](furigana-pin-plan-v1.md).

Some readings no ranking settles. 杏子 is きょうこ in the novel Sam is reading
and the apricot in the next one; frequency got the automatic answer as far as
it goes (above) and cannot go further, because the page carries no evidence
either way. So the reader asks: long-press a kanji run, choose from every
reading the dictionaries know, and that book remembers it.

**The key is the kanji run as the page spells it** — the base of the ruby the
press landed in, or the run of kanji around the character under the finger. Not
an entry id: an id cannot say "show no furigana here", cannot hold a reading no
entry carries, and is not what the user pressed. The value is the reading, and
the empty reading is that suppression.

**A pin ignores the furigana settings.** Names are off by default, so a pinned
name reading that obeyed the filter would do nothing and look broken.

**The picker offers; it does not choose.** Nothing in `furiganaReadingCandidates`
filters a reading for being unlikely — that is the whole reason the user is
being asked. What it does do is rank, and the one rule there matters: **a name
reading leads only where the spelling has settled on it**, by the same two
thresholds `isDominantNameReading` already uses (a 0.6 share of at least 5
sightings). Without that floor every spelling that is also somebody's surname
leads with the surname, and the first row is what the sheet preselects:

| run  | first candidate without the floor | with it  |
| ---- | --------------------------------- | -------- |
| 杏子 | きょうこ (26 of 33)               | きょうこ |
| 後味 | ごみ (surname, uncounted)         | あとあじ |
| 大人 | やまと (1 sighting)               | おとな   |
| 一日 | いちひ                            | いちにち |

What the floor costs is 高遠: たかとお in 4 of 4 sightings, settled but under
the minimum of 5, so the picker leads with こうえん — 高遠 is also a word — and
たかとお is one row below it. Raising the floor to catch it would let a single
sighting decide, which is what the floor exists to prevent.

(**Corrected 2026-10-02**: this paragraph used to say the resolver still read
高遠 as たかとお. It does not, and had already stopped when the sentence was
written — `resolveFuriganaBatch` answers こうえん. The reason is the ordinary
scoring, not the multi-type hole recorded under "Rejected" below: with its
`surname` term restored 高遠 reaches 83, still under 90, because four listed
readings earn nothing on the question of whether a name is what is on the
page.)

**Every kana row of an entry is offered**, not the first: 今日 is きょう,
こんにち, こんち and こんじつ, and the one the resolver picked is exactly what
is being overruled. Katakana stays as written — 煙草 really is タバコ. What
JMdict's kana column holds that is _not_ a reading is refused: 16,774 rows
carry a non-kana character (粁 is listed キロ・メートル, and the interpunct
U+30FB sits inside the katakana block), 日 carries んち from a compound, and
JMnedict lists 日 as the place name にっ. The four single-kanji forms ending in
っ — 叱, 𠮟, 突, 吹 — go with them; each is a reading that only exists inside a
compound.

**Accepted limits**, each pinned by a test:

- JMdict restricts some readings to some spellings (`re_restr`) and
  `scripts/build-dictionary.ts` drops the field, so the picker offers ひるこ
  for 恵比寿 though it belongs to 蛭子. Harmless in a list the user chooses
  from; fixing it means rebuilding the dictionary.
- A pin matches its run **everywhere in that book**. 杏子 the character and 杏子
  the apricot in one novel cannot differ. The same unbuilt positional work as
  the bookmark spans above.
- A re-imported copy of a book is a new id and starts with no pins.

**The gate is `yarn sweep:render`**, added for this. `yarn sweep:furigana`
resolves readings and cannot see a change to the code that turns them into
ruby, which is where the pin pass lives. Over the whole corpus, with every rule
on and names and counters off so that surfaces are rejected and cast their
shadows, the pin pass changes **0 of 100 chunks** when no reading is pinned.
`check:tap-consistency` unchanged at 98.0% / 128.

Three things the renderer alone cannot get right, each with a test that fails
without it: one pin makes the page carry furigana, so the line height and how
many characters fit on a page change with it; the slice cache key and the
re-render snapshot carry the pins, or a pinned page keeps serving the reading it
had; and a slice with a pin but nothing extractable still has to be painted.

### A bookmark is painted where it was confirmed, not wherever its characters appear

The matcher used to hand the painter a flat SET of surfaces, and the painter
painted every occurrence of each. So a word confirmed in one place lit up in
another: つい, confirmed as the adverb at the head of a sentence, was painted
again inside について further along the same line; きこんで, confirmed inside
敷きこんで because the dictionary has no 敷き込む, was painted inside 書きこんで
as well. That was fixture case 37, named and left unbuilt since
2026-10-01.

The matcher now emits positions. `confirmRuns` records where each confirmable
surface sits inside its run, `placeAccepted` keeps the ones the accept loop
admitted — longest first at a shared start, so 助手席 still beats 助手 — and
the painter paints those offsets and nothing else.

**Positions are keyed by the run's text, not by a character index into the
page.** The matcher scans an HTML string and the painter walks the DOM, and
the two will not reliably count to the same number — one sees `&amp;amp;`, the
other sees `&amp;`; one sees the chunk the reader prefetched, the other the
part of it that is laid out. They do agree on what the characters ARE.
`segmentRun` is a pure function of the run, so identical run text always
segments identically and a lookup by text is exact wherever it succeeds.

Two consequences had to be handled rather than hoped away:

- **The tap's text window cannot be used to find a placement.** It is fifteen
  characters back and twenty forward and it concatenates across paragraphs, so
  the run it contains is clipped at both ends or fused with another. The
  webview now reports the tapped run and the tap's offset within it
  (`tappedRun`), and `bookmarksInsideSpan` takes run coordinates.
- **The matcher's copy of the page has to be cut where the DOM is cut.** The
  reader appended prefetched HTML to its copy while `replaceOffscreenContent`
  deleted the DOM from the last laid-out character, so the paragraph at the
  seam was a truncated prefix in the page and whole in the matcher — and an
  exact lookup silently drops every highlight in it. `truncateHtmlAtVisibleChars`
  makes the two the same string. Guessing instead — falling back to a
  placement whose run merely STARTS with the one on the page — was written and
  thrown away: a truncated 助手 prefix-matches an unrelated 助手を呼ぶ and
  paints a span the matcher never placed, which is the bug this whole change
  exists to remove.

Measured over `test/corpus/bocchan.txt` against the proxy list
(`yarn proxy:bookmarks` — the reader's own list is on the device):
**11,074 → 7,078 painted characters, 29.7% → 19.0%**, 5,655 → 3,592 boxes. The
accepted surface set is unchanged at 1,267; only where they are painted moved.
Every one of the 328 "added" boxes is the surviving half of a box that lost its
neighbour, and exactly **three characters** are newly painted, all three
extensions of a span that was being cut short: 正直 → 正直に twice, and
一つつい → 一つついて.

`check:tap-consistency` unchanged at 98.0% / 128. `sweep:furigana` and
`sweep:render` byte-identical.

**One trade, named and accepted.** 年 in 八つという年の差 is no longer painted,
because the page's segmentation reads 年の差 as the word. The 年 inside
十数年にわたる still is, because 十数年 is not in the dictionary and 十数 + 年
is how that run segments. The rule — the characters have to be a word HERE —
is the one that was already decided; positions are what finally enforce it.

### Saving a word shows it before it is written

Bookmarking in the reader got slow when highlighting learned to read the
page: every toggle re-ran the whole matcher, and the matcher is ~130ms per
4,000 characters on a laptop with a synchronous dictionary. Measured where it
goes: deinflecting every substring of the page is ~51ms and the four batched
SQL passes ~47ms, and **none of it depends on what is bookmarked**.

So the pass is split. `analyseHtmlForBookmarks` reads the page — what each
stretch of characters could be, which entries those words belong to, and
where the page says a word — and `matchAnalysedBookmarks` is the synchronous
remainder that asks which of them are saved. The reader holds the analysis
against the HTML it was taken from, so a toggle repaints without re-reading.
A test counts the queries: zero after the first pass.

That left the part the user was actually looking at. The button could not
change until the write had landed — a MAX(position), two INSERTs, and on the
way out two UPDATEs and a SELECT — so the stores now move first and an undo
puts them back if the write throws. The same for the list popover's tick,
which is the control that actually un-bookmarks.

Two things that forced themselves out of hiding:

- **The store had to learn which lists hold a key.** `remove` used to drop a
  key outright and a separate COUNT decided whether it should; now
  `listIdsByKey` is maintained on every add and remove, and a key stops being
  bookmarked when the last list lets it go. That also closed a quieter bug:
  the old COUNT spanned default and soft-deleted lists, which `load()`
  excludes, so an entry in a default list stayed "bookmarked" until the next
  hydrate silently flipped it off.
- **Reconciling against the database is only safe when nothing else is in
  flight.** Tap-remove from one list and tap-add to another, and the first
  write's reconcile reads the database before the second's insert lands and
  deletes a membership the user just asked for. A per-key in-flight count
  skips it; the test watches every store transition and fails if the word
  blinks off.

The ~8,500-id version string the reader rebuilt on every toggle — sorted and
joined, about 60KB — is now a 32-bit mix summed over the ids with the count in
front, one walk and no array.

### A word spelled exactly as the page spells it keeps the page

後味が悪い is the set phrase and ごみ is a JMnedict surname nobody has been
observed to use, and the reader printed ごみ over it. Queue `0cfac0-16`, which
is `0cfac0-10` met a second time.

The name wins on its type alone — `surname` is worth 18 — and the only thing
standing against it is the discount a word earns for being spelled exactly the
way the page spells it. That was 16, which left 後味 at exactly 93 against a
threshold of 90 — and the threshold is inclusive, so 17, 18 and 19 all still
print ごみ. **20** is the smallest number that fixes it, and it lands 後味 at 89.

That is a tie-break, not a rule about frequency. What it moves are spellings
where JMdict has an exact kanji form for a word and JMnedict has a name with no
observed use. Measured over all **67,299** corpus surfaces, **34 change**, none
gained or lost a reading, and every one was read:

- **16 only lose a `[name]` tag they should never have carried**, the reading
  unchanged: 団子 だんご, 沙汰 さた, 鬼瓦 おにがわら, 敷石 しきいし, 旗本
  はたもと, 沢庵 たくあん, 頭巾 ずきん, 道楽 どうらく, 釣竿 つりざお, 錠前
  じょうまえ, 談義 だんぎ, 潮水 しおみず, 沙門 しゃもん, 毛頭 もうとう, 木鉢
  きばち, 小間物 こまもの, 別段 べつだん, 万両 まんりょう, 丸木 まるき.
- **15 change the printed reading, all of them to the word**: 人声 じんせい →
  ひとごえ, 出立 でだち → しゅったつ, 田楽 たらが → でんがく, 階下 かいした →
  かいか, 西日 にしにち → にしび, 本立 もとだつ → ほんたて, 船中 ふななか →
  せんちゅう, 船端 ふなば → ふなばた, 遠国 とおくに → えんごく, 金満 かねみつ
  → きんまん, 仰山 おおやま → ぎょうさん, 依怙 えご → えこ.
- **One regression, named and accepted**: 肋骨 ろっこつ → あばらぼね. ろっこつ
  is the reading in practice and it was reaching it through JMnedict. The word
  entry lists あばらぼね first and the build keeps JMdict's order, so taking the
  word hands back the rarer of its two readings. The cause is the kana order,
  not this discount.
- **One artefact**: 間物 まもの → あいだもの, a substring of 小間物 that is not
  a word either way.

杏子 is unmoved at きょうこ — the frequency work's own case — and
`check:tap-consistency` is unmoved at 98.0% / 128. `sweep:render` moves 30 of
100 chunks, which is the 34 readings reaching the page.

## Rejected

### Rejected: a name-frequency floor in the furigana resolver

The standing ruling on 後味 was that nothing separated a name that should win
from one that should lose, because 高遠 → たかとお scored identically and had
to keep working. The frequency column built since looked like the missing
discriminator: 後味 → ごみ has no count at all, 高遠 → たかとお has 4 of 4.

It is not. The picker's floor is 0.6 share over 5 sightings, and **4 is under
5**, so the same floor rejects 高遠 as well. The only test that separates them
is "has any count at all", and that is the one thing already refused above:
zero is the absence of evidence, not evidence against a reading. Fixing 後味
this way would have been a single sighting deciding a reading.

What fixed it instead was the exact-spelling tie-break recorded above, which
needs no counts.

### Rejected: reading `name_type` as the comma-separated list it is

`computeAutoNameConfidence` compares JMnedict's `name_type` against one type at
a time — `topType === "surname"` — but the column holds every type the entry
carries. 23,669 of 743,184 rows are multi-typed, and 15,392 of those are
`place,surname`, so the commonest ambiguous shape in the dictionary scores as
though its type were unknown. `scoreFuriganaNameMatch` in `furigana.ts` splits the same
field correctly, so the two scorers disagree about the same data.

Correcting it, taking the lowest applicable term because a spelling that is both
a place and a surname is less certainly a person's name here: **one** of 67,299
surfaces changes, and it changes for the worse — 右左 みぎひだり → うさ, whose
type is `surname,given` and so earns the full 18 it was accidentally being
denied. Nothing improves.

So the zero a multi-typed name gets by accident is load-bearing, and the honest
state is a known inconsistency left in place. Whoever fixes it properly will
need the evidence this scoring does not have: 右左's うさ, like 後味's ごみ, has
no observed use, and that is the test nothing here is allowed to make.

### Ranking a word's readings by frequency instead of taking JMdict's first

**Measured 2026-10-01 and rejected. `yarn check:reading-order` re-runs it.**

36,954 entries list more than one reading and the furigana pass always prints
the first row (`entryKana` keeps the first by rowid). The name-frequency work
made that look like the same defect names had — an arbitrary pick among
candidates — so it was checked rather than assumed.

**It is not the same defect.** JMdict orders an entry's readings editorially,
most prevalent first: 今日 is きょう / こんにち / こんち / こんじつ, 行く is
いく / ゆく,
明日 is あした / あす, 昨日 is きのう / さくじつ. Taking the first inherits a
human judgement. JMnedict orders a spelling's readings in gojūon — alphabetical
— which inherits nothing, and that is the whole reason names needed a new data
source and words do not.

Two measurements:

- **Against JMdict's own per-reading `common` flags.** Of 36,954 multi-reading
  entries, **35** have a first row that is not common while a later one is, and
  all but a handful of those are the same reading written in two scripts —
  ズキズキ/ずきずき, クジラ/くじら, タコ/たこ, アジ/あじ. The ordering agrees
  with the flags 99.9% of the time.
- **Against usage**, via the JPDB frequency list (anime, novels, visual novels)
  already cached for `yarn build:jlpt`. Of 1,858 common multi-reading entries
  JPDB can speak to, the first-listed reading is the one it records in **1,809
  (97.4%)**. 29 of the rest differ only in script. That leaves **20 genuine
  disagreements, and they are the argument against switching**, not for it:
  JPDB records こかくまんぞく for 顧客満足 (こきゃく is correct), すいちょう for
  水鳥 (みずとり is far commoner), ろうまん for 浪漫 (ロマン, the ateji's whole
  point), けんきゅうしょ for 経済研究所 and しんりょうしょ for 診療所 (じょ in
  both). Ranking by it would regress every one of those.

**The data cannot answer the question anyway.** JPDB records exactly one reading
per spelling, so it can never say reading B beats reading A — only which reading
it happens to hold. For 水鳥 it holds すいちょう and nothing for みずとり. A
per-reading comparison needs a source that counts both, and no such source is in
the repo.

Where JPDB does have a point — 七 なな over しち, 四 よん over し, 皆 みんな over
みな — the right reading depends on whether the character stands alone or heads a
compound, which a fixed per-entry ranking cannot express either way.

**Do not re-derive this.** The first-listed reading is a real signal, the
obvious replacement is measurably worse, and the measurement is one command.

### Alternatives weighed on 2026-09-28 and not taken

Four reader bugs were fixed that day, and each had a wider option that was put
to Sam and declined. They are recorded so the wider one is not proposed again
as if it were new.

- **Numbers: refusing the name reading without composing one.** Would have left
  四十三 with no furigana at all and a tap on it finding nothing — a wrong answer
  replaced by no answer. Composing was chosen because it is the only option that
  leaves the number readable, at the price of 一二三 losing ひふみ.
- **置いとく: also refusing a name reading to any lone kanji followed by kana.**
  Would fix more of this class, but this novel is full of names and a
  single-kanji surname (林, 森) would lose its reading. The contraction rule
  alone settled the reported case, so the name path was left alone.
- **Bookmarks: matching the tap exactly.** Kana respellings and particle swaps
  as well as deinflection, so anything tappable would highlight. Declined for
  now as more work on the per-slice render path than the reported cases need;
  deinflection alone covers a bookmark saved from inflected text, which is
  nearly all of them.
- **たまらず: hunting for a rule that separates 堪る from 溜まる.** Declined before
  it was attempted — see **Not a bug** below. The measurement would likely have
  come back empty, and commonness is the right default.

### A character cap on how far a word's kana tail runs

The first attempt at closing okurigana tails bounded them by length —
`MAX_OKURIGANA` at 2, 3, 4, 5, 6 — and the gate reads 142, 136, 133, 131, 131.
Straight monotone improvement, and wrong: the longer caps score better precisely
because 倒してや proves itself a word, closes や, and lets してやった win every
tap inside it, which is six taps agreeing on junk. The bound that works is one
inflection step, not a character count (see above); the length cap survives only
as a cheap outer limit.

### A morphological analyzer for the remaining overlaps

Considered and declined for the reader: kuromoji.js with IPADic is 12MB+ of
dictionary shipped into the app and loaded per slice, for the last couple of
points of a self-consistency metric. The okurigana half of the problem turned
out not to need it at all — JMdict's own part-of-speech tags plus one lookup
settle whether kana is a tail or a word. Revisit only if reading throws up cases
a person actually hits.

### Instrumenting real taps to find out whether this matters

Proposed and dropped: logging where in a matched span the finger lands, over a
week of real reading, to learn whether the junk spans are ever reached. The
failing taps are things like the ま of 死ぬまで and the second kana of 囃した —
positions a reader has little reason to touch, since you tap the word you do not
know. Not worth a build and a week of attention.

### Gating deinflected candidates on JMdict part of speech

The obvious cure for だったそう → 脱退: a candidate reached by stripping an
i-adjective ending asserts its result is an i-adjective, so an entry tagged
`n, vs` should not satisfy it.

**It does not work.** The rule table's `typeIn`/`typeOut` masks are internal
chaining state, not claims about JMdict's classes. Passive, causative and
potential forms deliberately output `V1` because they conjugate like ichidan
verbs, so 叱られた reached 叱る (`v5r`) with a `V1` mask and the gate rejected it.
来る is `vk` but the generic past rule reaches 来た as `V1`. 236 taps changed and
most were worse: every passive, every ～ば conditional, 来た, 持って来た,
帰って来た, 出て来た, 連れて来た. Do not try this again without first making the
masks mean what JMdict means.

### An anchor index and slot matcher for set phrases

Built in `bd5d799` and `c700a80`, reverted in `cef58de`: ~500 lines indexing
every expression by a kanji pair and verifying it against typed slots. It was
unnecessary. The walk already deinflects, so most of what it "fixed" already
worked, and the part that did not — a respelled word and a swapped particle —
turned out to be about a hundred lines inside the walk. Its one unique ability
was scanning a slice with no tap, to mark phrases on the page, which nobody had
asked for. Measure the existing path first.

### DP segmentation of the tap span

Tried in an earlier pass. `findBoundaryWord` prefix expansion and suffix
extension are load-bearing — DP regressed 若い → くもる and 姿勢 → 姿, and
DP-snapping kana runs took tap consistency from 97.6% to 88.3% (measured
against the gate as it stood then).

### Tuning the kana-only suffix penalty

Claimed as the cause of a むくれている misparse and falsified: varying it 30/15/0
gives identical results, because both competitors extend the same distance past
the tap and the penalty cancels. The driver is `hasCommon` +120 against +100 per
character of length.

### Set phrases the book spells differently from the dictionary

A book writes a phrase the way the sentence wants it, so the text often carries
a spelling or a particle the entry does not.

**Inflection was never the gap.** The walk deinflects the whole substring, so
腹が立った, 飯を食っていたら, 頭を下げなければ, あぐらを掻いて and しらを切る all
resolved before any of this was written — 87% of the corpus's 411 multi-token
expression occurrences were already reachable from the phrase's first character,
89% from any character inside it. Measure before building here; see Rejected.

**A word spelled in kana** (`04a235e`). 気を持たせる appears as 気をもたせる, which
matches neither the entry's kanji form nor its kana form きをもたせる. A substring
holding exactly one kanji is also tried with that kanji written as its readings.
Guards: at least four characters, because 気が rewritten is きが, the common word
飢餓, and 中から is 中辛; and the entry found must contain the kanji that was
rewritten, without which the kana lands on whatever else shares the sound —
出てき on 水滴, 死んだん on 診断 — costing 1.6 points of consistency on its own.
Five corpus taps change, both distinct cases improvements.

**A swapped particle** (`7109607`). 目の玉が飛び出る appears as 目の玉の飛び出る,
役にも立たない as 役には立たない. One particle at a time is replaced by an
equivalent: の→が for a relative-clause subject, が/は/も among themselves, に↔へ.
Not を, で, と or から, which carry case rather than register. Guards, each from
a measured failure: the entry must be `exp`, or 1161 corpus spans reach a real
entry and 240 of those are common nouns sharing a sound (のか→画家, はい→害);
a literal reading of the same span wins outright, or にしては is answered with the
commoner にしても; at least four characters, a kanji somewhere in the span, and
never a swap at index 0, since a leading particle governs the phrase before the
span (宿屋へ連れて来た was reaching につれて). Thirty-seven corpus taps change, 19
distinct, every one a span rescued from junk into a phrase.

**JMdict's idiom tags are not a usable filter here.** 目の玉が飛び出る,
気を持たせる and 発破をかける are all plain `exp` with no `id` tag, and
`id`/`proverb`/`yoji` together fire five times in 40,000 characters of corpus,
catching none of the idioms that actually come up. `exp` is the tag that works.

## Open

### Kana-run junk in tap lookup

The disagreements left after the okurigana rule above are overlaps where
_neither_ side starts on a kanji's okurigana and both are ordinary kana:
おやじ/じが, ぐらい/いか, つば/ばかり, そうもない/いと. The junk span straddles a
boundary between two real words and wins on length alone, and with no kanji
anywhere near it there is nothing local to say so — JMdict tags the right side
`prt` often enough to be suggestive but not reliably. Ruling these out needs part-of-speech and
connection costs across the whole line, i.e. an analyzer. Leaving the last 2.1%.

## Not a bug

- **たまらず gives 溜まる, not 堪る.** The ～ず rule fires correctly and reaches
  たまる; the ranking then picks 溜まる ("to collect"), which is marked common,
  over 堪る ("to endure"), which is not. 溜まらず is ordinary Japanese too, so
  nothing in the span separates them — the only signal is commonness, and
  preferring the common word is right far more often than it is wrong here.
  Written 堪らず it resolves correctly. Left alone deliberately.

- **教れた** is not a Japanese conjugation, so the lookup has nothing to find and
  falls back to 教/きょう. The reader provably does not drop characters: applying
  furigana to 1266 sentences of the corpus changed the visible text zero times.
  The book's text really reads 教れた.
