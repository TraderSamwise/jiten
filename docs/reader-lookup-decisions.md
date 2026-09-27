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
  every other tap landing inside their own span, currently **97.6%** (3760 taps,
  11383 pairwise checks, 155 disagreeing).
- **Furigana.** Resolve `resolveFuriganaBatch` over every kanji-initial
  substring of the corpus, up to 8 characters. ~54,900 surfaces.
- **Counters.** The `counter_readings` table is finite: resolve all 2728
  distinct `combined_kanji` forms and diff. This bounds any counter change
  exactly.

A change is shippable when the diff is enumerable and every entry in it is an
improvement, neutral, or a regression named and accepted in this document. A
regression nobody wrote down is not accepted, it is unnoticed.

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

### A span may not start in a word's okurigana

Kana straight after a kanji is usually that kanji's okurigana, not the start of
a new word, so a candidate beginning there is cutting a word in half: 死ぬまで
answered as ぬま, 消えぬ as えぬ, 白くって as くって, 云うから as うから. The
scorer had it backwards — `tapCandidateStartsAtKanaRunStart` paid such a start
+120 for looking like a word boundary.

Looking like one is not enough to separate okurigana from a real particle after
a kanji (手 に), so the kanji run and that kana are looked up together and the
position only counts when they spell an **inflecting** word that exists:
死ぬ (v5n), 消える (v1), 白い (adj-i). 手に resolves to nothing that inflects, so
に keeps its bonus. One extra batched lookup per tap; `findOkuriganaStarts` in
`lookup.ts`. A candidate starting at such a position is charged −140, the same
as starting mid-kanji-run, because the claim is the same and the word was
proved.

Measured: 62 of the 158 overlapping disagreements had exactly one side starting
this way and never both, so the signal is clean. The gate moves 97.3% → 97.6%,
176 disagreeing pairs → 155. Over the corpus 366 taps change, 139 distinct
transitions, all read: うから→から, いながら→ながら, たから→から, ぬま→まで,
してやった→やった, せば→廃せば, つべ→べき, にやし→やしない.

**The one accepted regression: 来たまえ.** 来た is a real inflected verb, so た
counts as okurigana and たまえ — the auxiliary 給え, which is the correct
reading here — is charged for starting inside it. The tap now answers まえ. Two
taps in the corpus. Not worth an auxiliary exemption: the exemption would have
to fire on exactly the forms the rule is there to catch.

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
おやじ/じが, ぐらい/いか, つば/ばかり, たから out of 囃した + から. The junk span
straddles a boundary between two real words and wins on length alone, and
nothing local to it says so — JMdict tags the right side `prt` often enough to
be suggestive but not reliably. Ruling these out needs part-of-speech and
connection costs across the whole line, i.e. an analyzer. Leaving the last 2.4%.

## Not a bug

- **教れた** is not a Japanese conjugation, so the lookup has nothing to find and
  falls back to 教/きょう. The reader provably does not drop characters: applying
  furigana to 1266 sentences of the corpus changed the visible text zero times.
  The book's text really reads 教れた.
