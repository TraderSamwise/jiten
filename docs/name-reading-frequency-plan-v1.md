# Name reading frequency — plan v1

Status: Phase 1 done (source settled, 2026-10-01). Phases 2-4 pending.

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

Adding a populated `INTEGER` column to `names` and `VACUUM`ing takes
`assets/dictionary-extended.db` from 116,617,216 to 116,703,232 bytes —
**+86 KB, +0.07%**. Only 58,209 of 661,719 kanji-bearing rows carry a number;
the rest are `NULL` and cost a byte of record header each.

**Do not add an index on it.** `names(kanji)` already exists and
`batchLookupNames` selects whole rows by `kanji IN (...)`, so reading one more
column is free. A `names(kanji, name_freq DESC)` index costs **+12.78 MB**
— 150x the column — and buys nothing.

## Phase 1 — source settled (2026-10-01)

**Chosen: Wikidata, `instance of: human` + `name in kana` (P1814), with the
item's Japanese `rdfs:label` as the spelling.** Not the 4.7 GB article dump.

### How the pairs are derived

Four queries, pooled:

1. **Whole people** — `?h wdt:P31 wd:Q5 ; wdt:P1814 ?kana ; rdfs:label ?l`
   (lang ja). 213,503 rows.
2. **Fictional characters** — the same against
   `wdt:P31/wdt:P279* wd:Q95074`. Only 2,101 rows, but fiction is the actual
   use case: `P31 wd:Q5` excludes every character in every novel.
3. **Given-name items** — `?h wdt:P735 ?gn . ?gn rdfs:label ?gl ; wdt:P1814 ?k`,
   grouped and counted. 4,128 rows.
4. **Family-name items** — the same via `P734`. 6,621 rows.

(1) and (2) give a whole-name reading (`まつやま ちはる`) against an unspaced
label (`松山千春`), so the pair means nothing until it is split. The split
validates itself against the shipped table: for each split of the spelling into
A+B, accept it only if `names` already holds A→kana1 **and** B→kana2. Exactly
one consistent split counts; zero or several are dropped. The enumeration tries
every boundary and never early-returns, which is why "several" is a real
measurement rather than an artifact.

This cannot invent a reading — it only counts readings JMnedict already lists —
and it discards pen names for free (石崎 寿夫 read すしお has no consistent
split). (3) and (4) need no split at all: the name item already is one
component, which is why they are worth pooling in despite being small.

Rows are not deduplicated. Collapsing identical name-and-reading pairs would
suppress exactly the readings common enough to have namesakes. Deduping on the
Wikidata entity instead would be strictly right, but selecting `?h` triples the
response payload and the large shards stop coming back within the endpoint's
timeout; duplicate items for one person are rarer than shared names and fall on
no particular reading.

### Measured

|                                         |            |
| --------------------------------------- | ---------- |
| rows in                                 | 215,604    |
| split uniquely                          | 159,177    |
| mononyms                                | 965        |
| direct name-item counts                 | 10,117     |
| no consistent split                     | 44,223     |
| genuinely ambiguous split               | 4          |
| malformed / non-kana                    | 5,374      |
| **distinct (spelling, reading, count)** | **59,215** |
| **distinct spellings**                  | **50,245** |

Against the 47,638 person spellings that have more than one reading — the only
ones where a tie exists to break — **22,968 (48.2%) get a count**, and in
**21,598 of those (94.0%) one reading strictly beats the rest**. The other 51.8%
keep today's behaviour exactly: no counts means no change, not a worse answer.

Requiring `P1559` (`name in native language`) instead of the Japanese label
halves the input for nothing — 125,442 rows and 38.5% coverage — because most
Japanese people on Wikidata carry a label without that statement.

### What the counts are and are not

They are **undercounts, not probabilities.** A fifth of the input finds no
consistent split and contributes nothing, and that loss is uncorrelated with
which reading a spelling took. Two consequences, both load-bearing:

- **Never compare counts across spellings.** 高遠's 4 and 洋子's 267 say
  nothing about each other.
- **Zero is not evidence against a reading.** It is the absence of evidence,
  and most readings have it.

### Why not ja.wikipedia

`page_props` carries DEFAULTSORT for every article — 231 MB of SQL dumps rather
than a 4.7 GB article parse, and roughly twice Wikidata's person count. It is
still the wrong source: **ja.wikipedia sort keys are stripped of dakuten and
small kana.** 生物 sorts as せいふつ, ヨーロッパ as よおろつは, 五十嵐 as
いからし. That collapses きょうこ with きようこ and いがらし with いからし —
exactly the pairs the ranking has to separate. More rows, less signal.

`jawiki-latest-abstract.xml.gz`, which would have been the cheap lead-sentence
source, **404s** — it is no longer produced.

### The result on the cases that mattered

Every spelling that killed the structural heuristic resolves correctly:

| spelling | heuristic picked | correct  | counts                        |
| -------- | ---------------- | -------- | ----------------------------- |
| 京子     | けいこ ✗         | きょうこ | きょうこ 145, けいこ 2        |
| 洋子     | ひろこ ✗         | ようこ   | ようこ 267, ひろこ 11         |
| 恵子     | さとみ ✗         | けいこ   | けいこ 158, あやこ 1          |
| 裕子     | ひろみ ✗         | ゆうこ   | ゆうこ 182, ひろこ 49         |
| 由美     | よしみ ✗         | ゆみ     | ゆみ 100, よしみ 2            |
| 美咲     | みき ✗           | みさき   | みさき 93                     |
| 花子     | みつき ✗         | はなこ   | はなこ 21                     |
| 一郎     | かずお ✗         | いちろう | いちろう 326                  |
| 翼       | たすく ✗         | つばさ   | つばさ 322, よく 12, たすく 3 |
| 愛       | あき ✗           | あい     | あい 179, めぐみ 23           |
| 杏子     | きょうこ ✓       | きょうこ | **きょうこ 25, あんず 2**     |

Eleven of eleven, against roughly one of eleven for the heuristic.

The two canaries and the second target:

- **高遠 → たかとお = 4**, every other reading 0. Keeps working, and now on
  evidence rather than a tie.
- **後味 → no counts at all**, against 高遠's 4. The feature recorded in
  `reader-lookup-decisions.md` as existing in neither dictionary exists here.
  Still to be proved through the scorer in Phase 4 and not claimed before.
- **五十嵐 → いがらし 170, いからし 5, いそあらし 1, いかざき 0.** This moves.
  The canary line in `reader-lookup-decisions.md` says 五十嵐 "is still
  いかざき", but that recorded the numeral rule leaving it alone, not a claim
  that いかざき is right. いがらし is the correct surname reading. Treat the
  change as a fix and record it; do not defend いかざき.

### Reproducibility

The SPARQL endpoint is live, so the query is not a pinned artifact. The derived
pairs are: 59,215 lines, about 1.2 MB. Commit them as **plain TSV in `data/`**,
the way `data/jlpt-words.csv` (1.0 MB) and `data/rtk-primitives.json` already
are — a derived build _input_, committed precisely because regenerating it
needs a network round trip to a source that drifts. Plain, not gzipped, so it
stays diffable. Record the four queries and the fetch date beside it.

Deep `OFFSET` paging times out on this endpoint; shard query (1) by the first
character of the kana instead. Queries (3) and (4) group server-side and need
no sharding.

### Considered and not taken

- **ja.wikipedia DEFAULTSORT as a fallback** for spellings Wikidata leaves
  uncounted, matching on dakuten-stripped keys where exactly one `names`
  reading collides. Sound in principle and pure coverage gain. Not built: 48.2%
  coverage already settles every reported case, and a second source with a
  lossy key is a way to print いからし for 五十嵐 the first time the collision
  check is wrong. Revisit only if real misses demand it.
- **An index on `name_freq`.** Measured at +12.78 MB for no gain. See above.

## Phases

### Phase 1 — Settle the source — **done**

See "Phase 1 — source settled" above. Wikidata, four queries, pooled and
split-validated against the shipped `names` table.

### Phase 2 — The derivation script

`scripts/build-name-frequency.ts`, run manually by `yarn build:name-freq`,
never by the app.

- Input: the four SPARQL queries above, against the live endpoint. Nothing is
  downloaded to the repo and no dump is fetched.
- Output: `data/name-frequency.tsv`, `kanji \t kana \t count`, sorted, with a
  header comment carrying the fetch date.
- Validation: against `assets/dictionary-extended.db`'s own `names` table, so
  the script needs the extended DB present and says so if it is missing.
- Sanity output on every run: rows in, each rejection bucket, pairs out,
  distinct spellings, ambiguous-spelling coverage, and the counts for 杏子,
  京子, 洋子, 一郎, 高遠, 五十嵐, 後味.

Gate: re-running the script on the same day reproduces the same file, and the
sanity line matches the numbers recorded above.

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
  `name_freq` alongside the existing columns. No new query, no new index.
- `scoreFuriganaNameMatch` uses it to separate readings **of one spelling**.
  Because counts are undercounts and not comparable across spellings, this must
  be a rank within the candidate set, not a term added to an absolute score.
- `computeAutoNameConfidence` (`packages/japanese-reader/src/auto-name.ts`):
  the `candidateCount` penalty is backwards when one reading dominates. 13
  readings currently reads as −24 uncertainty even when 26 of 33 observations
  pick one of them. Dominance should raise confidence, not lower it.
- **A floor, both absolute and relative.** 杏子 beats a _common_ JMdict word on
  27 observations. Without a minimum count and a minimum winner share, one
  noisy pair starts furigana-ing common nouns as names. Pick both on the sweep,
  not by taste, and write the chosen numbers down.
- Re-measure 後味 against 高遠. 後味 has no counts and 高遠 has 4, so they can
  finally separate — but say so only once the sweep says so.

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
