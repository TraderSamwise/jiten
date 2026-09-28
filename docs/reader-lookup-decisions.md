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
non-numeral, so it is still いかざき.

**Accepted regressions.** 一二三 no longer offers ひふみ, and 三四 loses さんし —
which was right for "three or four" — with nothing composed in its place, since
a bare run of digits with no power is not a number this reads. Two surfaces
against five corrected.

### Bookmark highlighting follows the same deinflection the tap does

The highlighter matched spellings literally, so a bookmark saved while reading
almost never lit up again: you tap the text in front of you, which is inflected,
and 縁がある then failed to find 縁があったら, やり込める failed to find やりこめてい.
Only a bookmark saved from a plain dictionary form — 表札 — ever highlighted.

The candidate substrings the pass already cuts out of the page are now
deinflected before they are looked up, and the candidate is highlighted as
written rather than the dictionary form. One guard carried over and one added:
a kana surface still loses to the kanji its entry is written with, **unless an
inflection was undone to reach it** — otherwise a bookmarked 事 lights up every
こと, while やりこめてい stays specific enough to mean what it says.

Cost on the per-slice render path, measured over a 3,000-character slice:
29ms and 71 queries to 68ms and 109. Over-highlighting is small and mostly
correct — a bookmarked する lights up して, した, している, しなければ, which are
する.

## Rejected

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
