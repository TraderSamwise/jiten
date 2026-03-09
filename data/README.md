# JLPT Word List (Waller + Frequency)

A JLPT-level classification for **all ~22,575 common JMdict entries**, using Jonathan Waller's community-verified JLPT vocab lists as the primary source and frequency-based ranking as a fallback for the remaining entries.

## Why a hybrid approach?

Waller's JLPT word lists (~7,738 words after deduplication) are the basis of virtually every free JLPT vocabulary list online. They're community-verified and well-trusted, but only cover about a third of common JMdict entries. Pure frequency-based ranking covers everything but has inherent corpus biases.

This list uses both: Waller levels for the ~7,738 words he covers, and frequency-based ranking for the remaining ~14,837 words.

## File format

`jlpt-words.csv` — a CSV with columns:

| Column           | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `jmdict_id`      | JMdict entry sequence ID                             |
| `kanji`          | Primary kanji form (empty for kana-only words)       |
| `reading`        | Primary kana reading                                 |
| `jlpt_level`     | Assigned JLPT level (5=N5 easiest, 1=N1 hardest)     |
| `frequency_rank` | Position in our frequency ranking (1=most frequent)  |
| `source`         | `waller` or `frequency` — how the level was assigned |

## Level distribution

| Level     | Waller     | Frequency   | Total       |
| --------- | ---------- | ----------- | ----------- |
| N5        | ~670       | ~130        | 800         |
| N4        | ~632       | ~868        | 1,500       |
| N3        | ~1,647     | ~2,053      | 3,700       |
| N2        | ~1,735     | ~4,265      | 6,000       |
| N1        | ~3,054     | ~7,521      | ~10,575     |
| **Total** | **~7,738** | **~14,837** | **~22,575** |

## Methodology

### Primary source: Waller JLPT vocab

Jonathan Waller's JLPT vocabulary lists, sourced via [mjuhanne/yomichan-jlpt-vocab](https://github.com/mjuhanne/yomichan-jlpt-vocab) (which maps them to JMdict sequence IDs). These cover ~7,738 unique JMdict entries across all five JLPT levels.

When the same JMdict entry appears at multiple levels (e.g. different kanji forms of the same word listed at different levels), the **easiest** (highest-numbered) level is used.

### Fallback: frequency-based ranking

For the ~14,837 common JMdict entries not covered by Waller, JLPT levels are assigned based on combined frequency data:

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

Some universally-basic vocabulary (電車/train, 駅/station, 天気/weather) ranks low in novel frequency because fiction rarely discusses daily-life topics. A small seed list of textbook-standard N5 words is pinned to ensure they land in N5. This only applies to non-Waller entries — Waller entries always keep their Waller level.

**Level assignment** (fallback entries):

Non-Waller entries are sorted by combined frequency rank and assigned cumulatively to fill remaining slots per level after accounting for Waller entries. Target sizes: N5=800, N4=1,500, N3=3,700, N2=6,000, N1=rest.

### Known limitations

- **Novel/media bias in fallback entries**: JPDB over-represents literary and media vocabulary. This only affects the ~14,837 frequency-assigned entries, not the Waller core.
- **Daily-life underrepresentation**: Words common in everyday conversation but rare in fiction are partially mitigated by the N5 seed list.
- **No grammar coverage**: JLPT tests grammar patterns as well as vocabulary. This list only covers words.

## Regenerating

If you have the Jiten source code:

```bash
yarn build:jlpt
```

This downloads the Waller CSVs and frequency data (cached in `.cache/`), processes them, and writes `data/jlpt-words.csv`.

## License

- **JMdict data**: CC-BY-SA 4.0 (Electronic Dictionary Research and Development Group)
- **Waller JLPT vocab**: via [mjuhanne/yomichan-jlpt-vocab](https://github.com/mjuhanne/yomichan-jlpt-vocab)
- **JPDB frequency data**: from [jpdb.io](https://jpdb.io) via [MarvNC/jpdb-freq-list](https://github.com/MarvNC/jpdb-freq-list)
- **This derived list**: CC-BY-SA 4.0
