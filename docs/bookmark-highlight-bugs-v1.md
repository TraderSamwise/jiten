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

### 2. 一緒 (column 1, middle)

`yarn why:highlight` against Common: **nothing bookmarked matches this
surface.** Sam confirms 一緒 / いっしょ is not a bookmarked word of his at all.

So this span is painted with no bookmark behind it. Either another list holds
it — Common is not the only list, see finding 1 — or the matcher is marking a
word that was never saved. Not yet determined which.

### 3. 励み (column 1, bottom) — accepted, with one ask

```
entry 1331630  励む [はげむ]  common
  matched "励む" via masu-stem; entry written in kanji: yes
  pos v5m,vi — to work hard, to try hard, to strive, to endeavour
```

The span is exactly 励み and 励む is bookmarked. Sam: "acceptable ish."

**Open ask, not a bug in the highlight**: tapping it should show the dictionary
form 励む, not the inflected 励み as written on the page.

### 4. 通 (column 2, top, in スタジオに通い) — WRONG

```
entry 1432840  通 [つう]  common
  matched "通" as written; entry written in kanji: yes
  pos n,n-suf,adj-na,ctr — authority, expert, connoisseur, counter for letters
```

The page word is **通う / かよい**. The bookmark is 通 / つう, the noun for an
expert or connoisseur, and the matcher paints it because the single character
通 is an exact kanji match for that entry.

A kanji that is also a standalone noun lights up inside every compound and
every verb written with it, without asking whether the surrounding okurigana
makes it a different word. The span stops at 通 and leaves the い outside,
which is the visible tell.

### 5. おいしい (column 2, middle) — WRONG, nothing behind it

`yarn why:highlight` against Common: nothing bookmarked matches. Sam confirms
おいしい is not a bookmarked word of his.

Second span on this page painted with no bookmark behind it (see finding 2,
一緒). Two independent spans with no match in Common is no longer explainable
as "it must be another list" — something is marking words that were never
saved. The source of these two is the next thing to establish.

### 6. して (column 2, bottom, in チェックしては) — WRONG

```
1335520  汁/液 [しる]  matched "しる" via te-form   pos n,n-suf — juice, soup, broth
1400390  巣/栖 [す]    matched "す"  via te-form   pos n       — nest, hive
2069220  素 [す]       matched "す"  via te-form   pos n,adj-no,pref — one's nature
```

The page word is チェック**する**. して is accepted as the te-form of しる (汁,
a noun) and of す (巣 and 素, both nouns).

Two failures compound:

- **No part-of-speech check.** A verb inflection is applied to a noun and the
  result is accepted. Nothing asks whether the matched entry can take the rule
  that reached it.
- **Kana standing in for kanji.** して is pure kana; 汁, 巣 and 素 are written
  in kanji. The existing guard against exactly this is bypassed because an
  undone inflection sets `inflected: true`.

### 7. く (column 3, top, the okurigana of 行く) — WRONG

Sam corrected the reading of the screenshot: the box is not on 行く, it is on
the single kana **く**.

```
entry 1955830  堰/井堰 [せき/いせき/い]  common
  matched "い" via adverbial; entry written in kanji: yes
  pos n — dam, weir, barrier, sluice
```

く is taken as the adverbial form of い, a reading of 堰 (a dam, a noun).

Every failure so far at once, at the smallest possible span: a one-character
kana fragment, an inflection rule applied to a noun, a kana surface standing in
for a word written in kanji, and a span that begins inside 行く — it is that
verb's okurigana.

### 8. 岩盤 (column 3, middle, inside 岩盤浴) — accepted

```
entry 1217400  岩盤 [がんばん]  common
  matched "岩盤" as written; entry written in kanji: yes
  pos n — bedrock
```

The box covers 岩盤, not the whole 岩盤浴, because 岩盤 is the bookmarked word
and 岩盤浴 is not. Sam: "that's fine."

Worth recording that a bookmarked word marked inside a longer compound is
acceptable to him, since it is the same shape as finding 4 (通 inside 通い),
which is not. The difference is that 岩盤 keeps its meaning inside 岩盤浴 and
通 does not inside 通い.

### 9. し (column 3, bottom, the し of 汗にして) — WRONG

```
1929950  詩 [し]     matched "し" as written     pos n — poem, poetry, verse
1400390  巣/栖 [す]  matched "す" via masu-stem  pos n — nest, hive
2069220  素 [す]     matched "す" via masu-stem  pos n,adj-no,pref — one's nature
```

The page word is する. Three ways in: 詩 matched as a bare kana spelling of a
kanji word, and 巣 and 素 matched by applying a masu-stem rule to nouns.

Note that 詩 arrives **as written**, with no inflection, so this one should
already be caught by the existing kana guard. Whether the guard runs and loses,
or never runs, is not yet established.

### 10. 流し (column 4, top, in 汗にして流し、) — cuts the opposite way to 励み

```
entry 1552100  流し [ながし]  common
  matched "流し" as written; entry written in kanji: yes
  pos n,adj-no — sink (e.g. in a kitchen), cruising (taxi), washing area in a bath
```

Sam has **流し the noun** bookmarked. He does **not** have 流す. The page means
流す — sweat it out and wash it away — and 流し there is that verb's stem, not
the noun for a sink.

**This is the opposite of finding 3.** Put side by side:

|      | bookmarked     | on the page            | verdict  |
| ---- | -------------- | ---------------------- | -------- |
| 励み | 励む, the verb | 励み, its masu-stem    | accepted |
| 流し | 流し, the noun | 流し, the stem of 流す | wrong    |

Both are a surface that reaches a bookmarked entry by a legitimate-looking
path. In one the bookmark is the dictionary form and the page shows it
inflected; in the other the bookmark is a noun that is spelled identically to a
verb stem the page actually means. Telling them apart requires knowing which
word the sentence means, which the highlighter never determines.

Recorded without a proposal on purpose. Sam: "this cuts opposite to hagemu...
we have to understand all angles. i dont know what to do yet."

Open: whether the box covers 流し alone or て流し. Unresolved.

### 11. しめくくり (column 4, middle) — accepted, and it constrains the kana guard

```
1436580  締めくくり/締め括り [しめくくり]  matched "しめくくり" as written    pos n — conclusion, end, finish
1436610  締めくくる/締め括る [しめくくる]  matched "しめくくる" via masu-stem  pos v5r,vt — to bring to a finish
```

Both bookmarked. Sam: "this is good."

**It is a kana surface standing in for a kanji-written entry** — the same shape
as findings 1, 6, 7 and 9 — and here it is right. The book wrote しめくくり in
kana for a word the dictionary spells 締めくくり.

So "refuse a kana surface whose entry is written in kanji" cannot be applied
flatly: it would take this one out along with the junk. Whatever separates them
is not the presence of kanji in the entry. Noted as a constraint, not a
solution.

### 12. はたい (column 4, in しめくくりはたいてい) — WRONG

Missed on the first read of the screenshot; Sam caught it. The box is on
**はたい** — the particle は plus the first two kana of たいてい.

```
entry 1427900  張る/貼る [はる]  common
  matched "はる" via tai (want); entry written in kanji: yes
  pos v5r,vt,vi — to stick, to paste, to affix
```

はたい is read as 張りたい, "want to stick".

**The same bookmarked entry as finding 1**, reached by a different rule —
negative there, tai here. 張る is bookmarked, its reading はる is bare kana, and
は is one of the commonest particles in the language, so every は followed by
anything resembling a verb ending becomes a hit. This single bookmark is
responsible for at least two of the bad spans on one page.

### 13. 夜更け (column 4, bottom) — accepted

```
entry 1606010  夜更け/夜ふけ/夜深け [よふけ]  common
  matched "夜更け" as written; entry written in kanji: yes
  pos n — late at night, small hours of the morning
```

Bookmarked, exact match as written, span covers exactly the word, and the page
means that word.

### 14. というより (column 5) — WRONG, and it is several spans not one

Sam reads the box as covering the whole というより. No single surface matches
it; three adjacent pieces do:

```
とい  entry 1446740  塔 [とう]        matched "とう" via masu-stem  pos n — tower, pagoda
いう  entry 1254600  結う [ゆう/いう]  matched "いう" as written     pos v5u,vt — to do up (hair)
より  entry 1013190  (no kanji) [より] matched "より" as written     pos prt,adv — than, rather than
```

とい is the masu-stem of a noun again. いう is 結う, to tie up hair, which only
shares a reading with the 言う of という. **より is legitimate** — it is a
bookmarked particle, written in kana, correctly matched.

So a correct highlight sits immediately beside two wrong ones and the three
read as a single block.

**Open:** the greedy painter should produce とい + an unpainted う + より, not
one continuous box. Either the gap is there and hard to see at this size, or
the adjacent-highlight separation is not doing its job here. Unresolved.

### 15. からず (column 5, in 会ってからずっと) — WRONG

から plus the ず of ずっと.

```
からず  1209540  刈る/苅る [かる]  matched "かる" via negative  pos v5r,vt — to cut, to mow, to shear
から    1205740  殻/骸 [から]      matched "から" as written    pos n — shell, husk, pod
```

からず read as 刈らず, "without cutting". Same shape as はない and はたい: a
particle plus the head of the next word, kana standing in for a kanji verb.

### 16. している (column 5) — WRONG, same as finding 6

Sam: "another suru failure."

```
1335520  汁/液 [しる]  matched "しる" via te-iru              pos n — juice, soup
1400390  巣/栖 [す]    matched "す"  via te-iru < te-form    pos n — nest, hive
2069220  素 [す]       matched "す"  via te-iru < te-form    pos n — one's nature
```

### 17. ひた (column 5, in ひたすら) — WRONG, and the guard caused it

**The sharpest finding so far.**

```
ひた      1212010  干る/乾る [ひる]        matched "ひる" via past   pos v1,vi — to dry up, to ebb
ひたすら  1010530  只管/一向/頓 [ひたすら]  matched as written        pos adv — intently, single-mindedly
```

**ひたすら is bookmarked and correctly matched.** The painter still marked ひた.

The painter sorts surfaces longest first, so ひたすら would have won — it never
reached the painter. It matched **as written**, so `inflected` is false, and
the kana guard dropped it because 只管 is written in kanji. ひた matched **via
past**, so `inflected` is true and it passed.

The guard removed the right answer and kept the wrong one. This is finding 1b
again, now shown to cause an active substitution rather than just a false
positive.

### 18. 飽きない (column 6) — right word, broken into two boxes

Sam: "akinai is good except that there shouldnt be a separation between a and
kinai the whole highlight is akinai."

```
entry 1586250  飽きる/厭きる/倦きる [あきる]  common
  matched "飽きる" via negative; entry written in kanji: yes
```

The match is correct and the span is correct. The rendering splits it:
`renderHighlightedVisibleSegment` calls `flushHighlightChunk()` whenever it
meets an `<rt>`, so a highlighted word carrying furigana is emitted as separate
`<span class="bookmarked-word">` elements either side of the ruby — and 飽 has
あ over it.

That was invisible until the adjacent-highlight separation ring landed earlier
on 2026-10-01, which now draws a gap inside a single word. **A regression from
that change**, not from the bookmark work.

### 19. とい (column 6, in 八つという年の差) — WRONG, repeat of finding 14

Second occurrence on the page of とい matched as the masu-stem of とう, a
reading of 塔 (tower, a noun).

### 20. く (column 7, top, in 関係なく) — WRONG, repeat of finding 7

Second occurrence of the single kana く matched as the adverbial of い, a
reading of 堰 (a dam, a noun). Here it is the tail of 関係なく.

### 21. 互いに (column 7) — accepted

```
entry 1268780  互いに [たがいに]  common
  matched "互いに" as written; entry written in kanji: yes
  pos adv — mutually, with each other, reciprocally
```

Bookmarked, exact, correct. Sam: "good."

### 22. かし (column 7, inside 何かしら) — WRONG

Five bookmarked entries reach it:

```
1207690  樫/橿 [かし]  matched "かし" as written     pos n — evergreen oak
1195720  課す [かす]   matched "かす" via masu-stem  pos v5s,vt — to impose, to levy
1568780  滓/粕 [かす]  matched "かす" via masu-stem  pos n — dregs, sediment, lees
1577030  化す [かす]   matched "かす" via masu-stem  pos v5s — to change into
2406900  科す [かす]   matched "かす" via masu-stem  pos v5s — to inflict
```

何**かし**ら, cut out of the middle of a word. 樫 arrives as written, so the
kana guard should have stopped it; the four かす verbs arrive via masu-stem and
bypass it.

Note the shape: a short kana surface in a language with few syllables reaches
many bookmarked entries at once. Five here, three on して. The more words are
bookmarked, the denser this gets — and this list holds 8,586.

### 23. だち (column 8, in 女友だち) — WRONG

```
entry 2601360  脱 [だつ]
  matched "だつ" via masu-stem; entry written in kanji: yes
  pos pref — de- (indicating reversal, removal, etc.), post-
```

脱 is a **prefix** — だつ as in 脱水, 脱線 — and has no masu-stem, because it is
not a verb. The rule was applied regardless, produced だち, and that took the
tail off 女友だち.

Not a close call between two readings: an inflection applied to a part of
speech that cannot take one. The clearest case yet for checking the rule
against the matched entry's POS.

### 24. 欲しかった (column 8) — WRONG, and the gap is two spans not one word

Sam: "hoshii is not a bookmarked word. and if it was it would be one word. but
there is a space."

Both hold. 欲しかった matches nothing as a whole; it is painted as two adjacent
spans:

```
欲し    2410130  欲す [ほりす]  matched "欲す" via masu-stem  pos v5s,vt — to want, to desire
かった  1208840  且つ [かつ]    matched "かつ" via past       conj — and, moreover
        1209540  刈る [かる]    matched "かる" via past       v5r — to cut, to mow
        1253900  欠く [かく]    matched "かく" via past       v5k — to chip, to lack
        1399970  掻く [かく]    matched "かく" via past       v5k — to scratch
        1955830  堰 [い]        matched "い"  via past        n — dam, weir
```

欲しい is not involved at all. 欲し is the masu-stem of 欲す / ほりす, an
archaic verb; かった is the past of five different bookmarked entries.

**Two distinct gap mechanisms now seen.** In finding 18 (飽きない) the split
came from ruby flushing a single span. Here there is no ruby and the gap is
real: two separate matches painted back to back, with the separation ring
correctly drawn between them. The ring is working; what it separates is junk.

Also: the greedy painter picked 欲し (2 chars) at 欲 rather than any longer
span, because no longer span survived to reach it.

### 25. わた (column 8, in 十数年にわたる) — WRONG

わたる is not bookmarked. わた is.

```
1533340  綿/棉/草綿 [わた]  matched "わた" as written  pos n — cotton plant, batting, wadding
1208000  割る/破る [わる]    matched "わる" via past    pos v5r,vt — to divide, to split
```

The page means わたる (to span, to extend over). The box takes its first two
kana as 綿, cotton.

### 26. 欲し + かった (column 9, in 欲しくても) — repeat of finding 24

### 27. して, きた (column 9, in 我慢してきた) — repeats of findings 6 and 16

して from 汁 / 巣 / 素; きた from 繰る / 抉る via past. Note that 我慢 itself,
the word actually on the page, is not what is marked — the auxiliary tail is.

### 28. はい + いく (column 9, in はいくつか) — WRONG, two spans

```
はい  1201860  灰 [はい]    matched "はい" as written    pos n — ash, ashes
      1474200  這う [はう]  matched "はう" via masu-stem  pos v5u,vi — to crawl, to creep
いく  2856718  逝く [いく]  matched "いく" as written    pos v5k-s,vi — to die, to pass away
```

は + いくつ, repartitioned into 灰 (ash) or 這い (crawling), followed by 逝く
(to die).

### 29. けれ (column 9, in けれど) — WRONG

```
1333400  蹴る/蹶る [ける]  matched "ける" via imperative  pos v5r,vt — to kick
```

けれど read as 蹴れ, the imperative "kick!".

## Phase 0 resolution — 一緒 and おいしい are not a membership bug

Measured 2026-10-01 by running the real `resolveBookmarkedWordSurfacesInHtml`
over the page with Sam's Common list, and separately enumerating every
(candidate, deinflection, entry) that could produce each span.

**一緒 is not highlighted. `緒` is.** The only entry that can paint `緒` and is
in Common is 1311470 糸口/緒 [いとぐち], matched as written via the kanji table.
Nothing produces the surface `一緒`: entry 1163400 一緒 would, but it is in no
exported list. The box read as 一緒 on screen because the span sits against 一.

**おいしい is not one highlight. It is two: `おい` + `しい`.**

- `おい` — masu-stem of 追う (1432410), 負う (1497930), 生う (1378480), and of
  老いる (1560990). All four are in Common.
- `しい` — masu-stem of 強いる (1236100), in Common.

Adjacent `<span class="bookmarked-word">` elements have no gap between them, so
two spans render as one continuous box.

**Two consequences.**

1. Neither is a membership bug. `hasEntryId` is correct; both spans are the
   already-identified wrong-place-inflection class (an entirely legal masu-stem
   of a real verb, in a position where that verb is not what the text says).
   The fixture is valid as planned.
2. **The instrument must count spans, not boxes.** The page's full surface set
   is 49 entries, against the 29 boxes Sam walked. Short spans that abut are
   invisible as separate highlights, so the visual count understates the
   damage, and a fix that merges two wrong spans into one looks like progress
   while changing nothing.

The 49 surfaces resolved on this page, longest first:

```
しめくくり しかった している たいてい 飽きない かった しくて してい はない
はたい 夜更け いてい からず くくり しめく たいて 互いに 励み くて おい しく
しい して はた 岩盤 帰り 流し いて くく くり きた しめ とい ひた より 飽き
かし だち 欲し けれ はい わた 緒 通 く し 岩 数 欲
```
