# Name reading frequency — plan v1

Status: not started. Written 2026-10-01 so the work survives a context compaction.

## The problem

The reader furigana's a Japanese name with the wrong reading, and no amount of
scoring fixes it, because the dictionaries contain nothing that says which
reading is right.

The reported case: 杏子, a character in ダブル・ファンタジー, reads **あんず**
(apricot) and should read **きょうこ**.

Two separate contests decide it, and both are currently lost:

1. **Which name reading wins.** JMnedict lists 13 readings for 杏子 — あこ, あん,
   あんこ, あんず, あんずこ, きょうこ, きょうし, きようこ, ちょうこ, なつこ, ももこ,
   ようこ, りょうこ. `scoreFuriganaNameMatch` scores them identically, so
   `pickBestNameMatch` keeps whichever row SQLite returns first.
2. **Name against word.** JMdict has 杏子 = あんず, common. The name scores 2455
   and the word 2380, but `computeAutoNameConfidence` subtracts for candidate
   count — 13 readings reads as −24 uncertainty — so the word wins at
   confidence 43.

A second case, recorded as unfixable in `reader-lookup-decisions.md`: **後味**
reads the surname ごみ instead of あとあじ. It scores identically to **高遠 →
たかとお**, which is wanted, so nothing in JMdict or JMnedict separates "name
that should win" from "name that should lose".

## What was already measured and found dead

Ranking a spelling's readings by **how many distinct kanji use that same kana as
a personal name** — recoverable from the shipped table with a self-join, no new
data. It ranks きょうこ first for 杏子 (112 uses, against ようこ 97), which looked
promising.

It is noise. Tested against names whose reading is not in doubt:

| spelling | heuristic picks | correct        |
| -------- | --------------- | -------------- |
| 京子     | けいこ (140)    | きょうこ (135) |
| 洋子     | ひろこ (135)    | ようこ         |
| 恵子     | さとみ (225)    | けいこ         |
| 裕子     | ひろみ (281)    | ゆうこ         |
| 由美     | よしみ (276)    | ゆみ (145)     |
| 美咲     | みき (250)      | みさき (248)   |
| 花子     | みつき (118)    | はなこ (93)    |
| 一郎     | かずお (98)     | いちろう (37)  |
| 翼       | たすく (28)     | つばさ         |
| 愛       | あき (280)      | あい           |
| 杏子     | きょうこ (112)  | きょうこ ✓     |

Wrong on roughly ten of the thirteen spellings that have more than one
candidate; right only where there is a single candidate, plus 杏子 and 真由美 by
luck. The margins are noise (140 vs 135, 281 vs 258, 250 vs 248) and the
mechanism is wrong: counting how many kanji share a reading measures how
**generic** a reading is, not whether it fits this spelling. Generic readings
like よしみ and ひろみ attach to hundreds of rare kanji and float to the top
everywhere.

**Do not rebuild this.** It is cheap to try and it looks right on the one case
you are testing.

## What the fix has to be

Real evidence of how a spelling is read when it names a person, derived once,
offline, from a corpus that is **never shipped**, and stored as a number on the
row.

### Constraints (Sam, 2026-10-01)

- **Do not ship the corpus.** Derive offline; the built DB carries only counts.
- **No in-app migration.** Bump the whole extended DB and let clients
  re-download. Do not serialise a migration into app code.
- **Size is acceptable but not unbounded** — don't grow the shipped DB by more
  than the feature needs.

### Measured size cost

`assets/dictionary-extended.db` is 116,617,216 bytes with 743,184 `names` rows.
Adding a populated `INTEGER` column and `VACUUM`ing takes it to 119,029,760 —
**+2.4 MB, +2.1%**. Acceptable, and it can be smaller: only 134,574 rows need a
number at all (370,968 person rows, of which 47,638 spellings are ambiguous).
A `NULL` on the other 608,610 rows costs a byte of record header each.

## Open question to settle first

**Which corpus.** Not yet decided; settle it before building anything else.

- **ja.wikipedia `pages-articles.xml.bz2` — 4.4 GB.** Person articles open with
  a near-universal pattern, 「山田 太郎（やまだ たろう、1950年…」, giving
  spelling → reading for hundreds of thousands of real people. Richest, heaviest.
  `jawiki-latest-abstract.xml.gz` would have been the cheap version of this and
  **404s** — it is no longer produced.
- **Wikidata.** 140,748 items are `instance of: human` with a Japanese native
  label (P1559). Whether they carry an actual kana reading (P1814) is
  **unknown** — the count query returned empty, timed out or unsupported. Settle
  this first: if P1814 coverage is six figures, Wikidata is far cheaper than a
  4.4 GB parse and needs no HTML heuristics.

Decide on coverage, not preference. The question each source answers is the same:
_when this spelling names a person, how is it read?_

## Phases

### Phase 1 — Settle the source

Re-run the Wikidata P1814 coverage query (paginate or use the dump if SPARQL
times out). If coverage is weak, take the Wikipedia dump. Produce a short
written comparison: rows obtained, distinct spellings covered, and whether
高遠/杏子/京子/後味 appear.

Gate: a decision with numbers behind it.

### Phase 2 — The derivation script

`scripts/build-name-frequency.ts`, run manually, never by the app.

- Input: the chosen dump, downloaded to a scratch path outside the repo.
- Output: a small TSV or JSON of `kanji \t kana \t count`, committed **only if
  small**; otherwise written to a release asset. The dump itself is never
  committed and never shipped.
- Extraction rule for Wikipedia: lead-sentence pattern, full-width parens,
  kana-only reading, discard entries whose kanji is not in `names`.
- Sanity output: total pairs, distinct spellings, and the counts for 杏子, 京子,
  洋子, 一郎, 高遠, 五十嵐, 後味.

Gate: the script is idempotent and its output is reproducible from the recorded
dump date.

### Phase 3 — The column

- `scripts/build-extended-data.ts`: add `name_freq INTEGER` to the `names`
  schema and populate it from the Phase 2 output during the build.
- Bump the extended DB version to **4**. The version lives in the published
  manifest (`ExtendedManifest.version`, `db/dict-download.ts:13`) and is compared
  against the `ext-db-version` key in AsyncStorage (`db/dict-download.ts:627`).
  `isExtendedReady(version)` returning false is what triggers the re-download —
  **no app-side migration exists or should be added.**
- Rebuild and publish with `scripts/publish-dict.sh`.

Gate: the rebuilt DB is within ~3 MB of the old one, and a spot query returns
the expected counts.

### Phase 4 — Use it, measured

- `batchLookupNames` (`packages/japanese-reader/src/furigana.ts`) selects
  `name_freq` alongside the existing columns.
- `scoreFuriganaNameMatch` uses it to separate readings of one spelling.
- `computeAutoNameConfidence` (`packages/japanese-reader/src/auto-name.ts`):
  the candidate-count penalty is backwards when one reading dominates. Dominance
  should raise confidence, not lower it.
- Re-measure 後味 against 高遠 — with real counts they may finally separate. Do
  not claim it until the sweep says so.

## Gates — every phase

- `yarn typecheck`, `yarn lint` 0 errors, prettier.
- Scoped `vitest` only; never the full suite.
- `yarn check:tap-consistency` ≥ **98.0% / 128 disagreeing pairs**.
- Furigana sweep over **all 67,299** kanji-initial corpus substrings up to 8
  characters, diffed against the baseline, **read entry by entry**. Every entry
  an improvement, neutral, or a regression named and accepted in
  `reader-lookup-decisions.md`.
- Failing test first, prove-failed.

### Canaries — must not break

- 高遠 → たかとお
- 五十嵐 → いかざき
- 四十三 → よんじゅうさん (the numeral rule, already shipped)

### Target

- 杏子 → きょうこ
- 後味 → あとあじ, if and only if the measurement supports it

## Queue

- `0cfac0-8` (杏子) and `0cfac0-10` (後味) sit at `wontdo` awaiting Sam's ruling.
  If this lands, requeue and close with proof.
- The long-press per-book override is queued separately. Sam: "maybe useful but
  certainly not preferred over solving the real problem." It stays queued as the
  fallback for whatever ranking still gets wrong.

## For posterity, when it lands

- `docs/reader-lookup-decisions.md` — the decision, the numbers, every accepted
  regression, and the dead heuristic above so nobody tries it twice.
- `docs/ARCHITECTURE.md` §dictionary build — the dump URL and **date**, the
  extraction pattern, rows in and out, the measured size delta, and the command
  to regenerate, so the column can be rebuilt from scratch years later without
  guessing what produced it.
