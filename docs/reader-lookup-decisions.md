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
  every other tap landing inside their own span, currently **97.9%** (3760 taps,
  11343 pairwise checks, 129 disagreeing).
- **Furigana.** Resolve `resolveFuriganaBatch` over every kanji-initial
  substring of the corpus, up to 8 characters. ~54,900 surfaces.
- **Counters.** The `counter_readings` table is finite: resolve all 2728
  distinct `combined_kanji` forms and diff. This bounds any counter change
  exactly.

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
  sits straight on the stem (見とく, 食べとく) and is typed `V1` for the same
  reason — the masu-stem rules type their output `V5`, so the chain cannot reach
  it.
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

## Rejected

### Ranking a word's readings by frequency instead of taking JMdict's first

**Measured 2026-10-01 and rejected. `yarn check:reading-order` re-runs it.**

36,954 entries list more than one reading and the furigana pass always prints
the first row (`entryKana` keeps the first by rowid). The name-frequency work
made that look like the same defect names had — an arbitrary pick among
candidates — so it was checked rather than assumed.

**It is not the same defect.** JMdict orders an entry's readings editorially,
most prevalent first: 今日 is きょう / こんにち / こんち, 行く is いく / ゆく,
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
