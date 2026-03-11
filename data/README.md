# JLPT Word List (Waller + Audit + Frequency)

A JLPT-level classification for **all ~22,575 common JMdict entries**, using three data sources in priority order:

1. **Manual audit overrides** — human + LLM reviewed corrections to Waller misclassifications
2. **Jonathan Waller's JLPT vocab lists** — community-verified, ~7,738 words
3. **Frequency-based ranking** — fallback for the remaining ~14,837 words

## Why a three-layer approach?

Waller's JLPT word lists (~7,738 words after deduplication) are the basis of virtually every free JLPT vocabulary list online. They're community-verified and well-trusted, but contain systematic errors — e.g. common words like 直ぐ (immediately) and 間違う (to make a mistake) classified as N1, or archaic terms like 字引 classified as N5.

The audit layer identifies these misclassifications by comparing Waller's levels against corpus frequency data, then manually reviewing each outlier to determine the correct level. Audit overrides are stored in separate CSV files (`jlpt-audit-*.csv`) for full provenance tracking.

Pure frequency-based ranking covers the ~14,837 entries not in Waller's lists, but has inherent corpus biases (fiction/anime over-represents literary vocabulary, under-represents daily-life vocabulary).

## Files

| File               | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `jlpt-words.csv`   | Final combined JLPT classifications (22,575 entries) |
| `jlpt-audit-*.csv` | Audit override records with reasoning                |

## File format

`jlpt-words.csv` — a CSV with columns:

| Column           | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `jmdict_id`      | JMdict entry sequence ID                                       |
| `kanji`          | Primary kanji form (empty for kana-only words)                 |
| `reading`        | Primary kana reading                                           |
| `jlpt_level`     | Assigned JLPT level (5=N5 easiest, 1=N1 hardest)               |
| `frequency_rank` | Position in our frequency ranking (1=most frequent)            |
| `source`         | `waller`, `audit`, or `frequency` — how the level was assigned |

`jlpt-audit-*.csv` — audit record files with columns:

| Column         | Description                         |
| -------------- | ----------------------------------- |
| `jmdict_id`    | JMdict entry sequence ID            |
| `kanji`        | Primary kanji form                  |
| `reading`      | Primary kana reading                |
| `waller_level` | Original Waller JLPT level          |
| `freq_rank`    | Position in frequency ranking       |
| `freq_level`   | What frequency data suggests        |
| `audit_level`  | Manually determined correct level   |
| `reason`       | Brief explanation of the assessment |

## Methodology

### 1. Primary source: Waller JLPT vocab

Jonathan Waller's JLPT vocabulary lists, sourced via [mjuhanne/yomichan-jlpt-vocab](https://github.com/mjuhanne/yomichan-jlpt-vocab) (which maps them to JMdict sequence IDs). These cover ~7,738 unique JMdict entries across all five JLPT levels.

When the same JMdict entry appears at multiple levels (e.g. different kanji forms of the same word listed at different levels), the **easiest** (highest-numbered) level is used.

### 2. Audit overrides

Waller's list contains misclassifications that are identified by comparing against corpus frequency data:

- **Finding outliers**: Words where Waller's level disagrees with frequency-derived level by 2+ JLPT levels are flagged for review.
- **Manual review**: Each flagged word is individually assessed considering: actual difficulty, when learners typically encounter it, standard textbook placement, and whether the frequency data is skewed by corpus bias.
- **Provenance**: Each audit round produces a dated CSV file (`jlpt-audit-*.csv`) with the original level, frequency data, audited level, and reasoning. These files are permanent records.

The audit process identified two systematic issues in Waller's data:

- **Waller too hard**: Common words misclassified at N1 (e.g. すぐ, 反応, 間違う) — these are corrected to appropriate levels
- **Waller too easy**: Daily-life vocabulary correctly at N5 despite low corpus frequency (e.g. 鉛筆, 辞書, 切手) — frequency data is biased here, Waller is usually right

**Audit statistics:**

| Round     | Disagreement | Words reviewed | Overrides | Kept as-is |
| --------- | ------------ | -------------- | --------- | ---------- |
| 4-step    | e.g. N1↔N5   | 130            | 53        | 77         |
| 3-step    | e.g. N1↔N4   | 292            | 114       | 178        |
| 2-step    | e.g. N1↔N3   | 1,326          | 347       | 979        |
| **Total** |              | **1,748**      | **514**   | **1,234**  |

An additional **2,791 words** have a 1-step disagreement between Waller and frequency (e.g. N3 vs N4). These are not audited — a single level of disagreement is normal variation, and Waller's community-verified levels are trusted in these cases.

Of the 7,212 unique Waller entries (after deduplication), 2,673 agree with frequency exactly, 2,791 disagree by 1 step (trusted), and 1,748 disagree by 2+ steps (all audited). Every Waller entry has been either verified or reviewed.

### 3. Fallback: frequency-based ranking

For the ~14,837 common JMdict entries not covered by Waller or audit, JLPT levels are assigned based on combined frequency data:

1. **JPDB frequency list** (primary signal) — frequency rankings from a corpus of anime, novels, visual novels, and other Japanese media. Lemma-based: all conjugations grouped under dictionary form.
   - Source: [MarvNC/jpdb-freq-list](https://github.com/MarvNC/jpdb-freq-list)

2. **JMdict XML frequency tags** (secondary signal) — newspaper frequency data from Mainichi Shimbun (`nf01`-`nf48` tags, plus `ichi1`/`news1` flags). Form-based: each conjugation counted separately.
   - Source: [EDRDG JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project)

3. **JMdict (jmdict-simplified)** — the base word list. Only entries tagged as "common" are included.
   - Source: [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified)

**POS-aware frequency combination** (fallback entries only):

JMdict newspaper frequency is form-based, so verbs/adjectives are systematically undercounted (食べる ranks ~12,000 because 食べた/食べて are separate entries). JPDB is lemma-based, so 食べる correctly ranks in the top 200.

- **Verbs and adjectives**: pure JPDB frequency rank (JMdict newspaper data ignored)
- **Nouns and other non-inflectable words**: JPDB as primary, with a bounded penalty for words disproportionately common in fiction vs. general usage

**N5 seed list** (~114 words, fallback entries only):

Some universally-basic vocabulary (電車/train, 駅/station, 天気/weather) ranks low in novel frequency because fiction rarely discusses daily-life topics. A small seed list of textbook-standard N5 words is pinned to ensure they land in N5. This only applies to frequency-assigned entries.

**Level assignment** (fallback entries):

Frequency entries are sorted by combined frequency rank and assigned cumulatively to fill remaining slots per level after accounting for Waller + audit entries. Target sizes: N5=800, N4=1,500, N3=3,700, N2=6,000, N1=rest.

### Known limitations

- **Novel/media bias in fallback entries**: JPDB over-represents literary and media vocabulary. This only affects frequency-assigned entries, not Waller or audit entries.
- **Daily-life underrepresentation**: Words common in everyday conversation but rare in fiction are partially mitigated by the N5 seed list.
- **No grammar coverage**: JLPT tests grammar patterns as well as vocabulary. This list only covers words.
- **Audit coverage**: All words with 2+ level disagreement between Waller and frequency have been audited (1,748 words across three rounds). Single-level disagreements (2,791 words) are unaudited — Waller is trusted for these.

## Regenerating

If you have the Jiten source code:

```bash
yarn build:jlpt
```

This downloads the Waller CSVs and frequency data (cached in `.cache/`), loads audit override files from `data/jlpt-audit-*.csv`, and writes `data/jlpt-words.csv`.

## License

- **JMdict data**: CC-BY-SA 4.0 (Electronic Dictionary Research and Development Group)
- **Waller JLPT vocab**: via [mjuhanne/yomichan-jlpt-vocab](https://github.com/mjuhanne/yomichan-jlpt-vocab)
- **JPDB frequency data**: from [jpdb.io](https://jpdb.io) via [MarvNC/jpdb-freq-list](https://github.com/MarvNC/jpdb-freq-list)
- **This derived list**: CC-BY-SA 4.0
