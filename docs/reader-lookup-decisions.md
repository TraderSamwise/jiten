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
  every other tap landing inside their own span, currently **96.8%**.
- **Furigana.** Resolve `resolveFuriganaBatch` over every kanji-initial
  substring of the corpus, up to 8 characters. ~54,900 surfaces.
- **Counters.** The `counter_readings` table is finite: resolve all 2728
  distinct `combined_kanji` forms and diff. This bounds any counter change
  exactly.

A change is shippable when the diff is enumerable and every entry in it is an
improvement or neutral. Where that is not true, the trade is recorded below.

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

## Rejected

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

### DP segmentation of the tap span

Tried in an earlier pass. `findBoundaryWord` prefix expansion and suffix
extension are load-bearing — DP regressed 若い → くもる and 姿勢 → 姿, and
DP-snapping kana runs took tap consistency from 97.6% to 88.3%.

### Tuning the kana-only suffix penalty

Claimed as the cause of a むくれている misparse and falsified: varying it 30/15/0
gives identical results, because both competitors extend the same distance past
the tap and the penalty cancels. The driver is `hasCommon` +120 against +100 per
character of length.

## Open, needs a design call

### Set phrases written with a different kanji/kana mix

JMdict holds 気を持たせる and きをもたせる; a book may write 気をもたせる, a third,
partly-kanji spelling that matches neither. The reader matches surfaces exactly
(plus katakana folding), so it finds nothing and falls back to 気/ぎ.

Fixing it needs kanji-to-reading alignment: either a morphological analyzer, or
a build-time index of the mixed variants of each expression. 12,385 of the
13,154 `exp` entries have both a kanji and a kana form and would need it.

The same mechanism covers particle variation. 目の玉の飛び出るような looks like
a coverage gap and is not: JMdict has **目の玉が飛び出る** (めのたまがとびでる,
"eye-popping; staggering"), and the text writes の for が, the ordinary
relative-clause subject substitution. 1436 exp entries contain が.

JMdict's own idiom tags are **not** a usable filter for this. 目の玉が飛び出る,
気を持たせる and 発破をかける are all plain `exp` with no `id` tag; the
`id`/`proverb`/`yoji` tags together fire 5 times in 40,000 characters of the
corpus and catch none of the idioms that actually come up.

How much of the problem is matching, measured over the corpus: 411 multi-token
expression occurrences in 40,000 characters, one per ~96. A tap on the phrase's
**first** character finds 87% of them; a tap on **any** character inside finds
89%. Matching is not the bottleneck — you have to already know it is a phrase
and where it starts.

### Kana-run junk in tap lookup

About 81% of the remaining tap-consistency disagreements are short kana runs
where an uncommon long match beats a common short one — でまず reaching 出丸,
があ/じが/さかば. These are genuine JMdict entries, so no dictionary-membership
rule can exclude them; it needs an analyzer with part-of-speech and connection
costs. Leaving the last ~3%.

## Not a bug

- **教れた** is not a Japanese conjugation, so the lookup has nothing to find and
  falls back to 教/きょう. The reader provably does not drop characters: applying
  furigana to 1266 sentences of the corpus changed the visible text zero times.
  The book's text really reads 教れた.
