# Frequency-Based JLPT Word List

A JLPT-level classification for **all 22,575 common JMdict entries**, generated from real frequency data. Intended as a drop-in replacement for Jonathan Waller's JLPT word lists (~7,200 words), which are the basis of virtually every free JLPT vocabulary list online.

## Why?

Every freely available JLPT word list traces back to the same source (Waller's lists from the old pre-2010 JLPT). Problems:

- Only covers ~7,200 of the ~22,500 common JMdict entries (32%)
- Misclassifies basic vocabulary: 言う (to say) → N3, 町 (town) → N3, 魚 (fish) → N3
- No updates since the JLPT format changed in 2010

This list covers **all** common entries and uses frequency data to assign levels.

## File format

`jlpt-words.csv` — a CSV with columns:

| Column           | Description                                         |
| ---------------- | --------------------------------------------------- |
| `jmdict_id`      | JMdict entry sequence ID                            |
| `kanji`          | Primary kanji form (empty for kana-only words)      |
| `reading`        | Primary kana reading                                |
| `jlpt_level`     | Assigned JLPT level (5=N5 easiest, 1=N1 hardest)    |
| `frequency_rank` | Position in our frequency ranking (1=most frequent) |

## Level distribution

| Level     | Count      | Description                           |
| --------- | ---------- | ------------------------------------- |
| N5        | 800        | Most frequent — beginner essentials   |
| N4        | 1,500      | Common everyday vocabulary            |
| N3        | 3,700      | Intermediate vocabulary               |
| N2        | 6,000      | Upper-intermediate                    |
| N1        | 10,575     | Advanced — all remaining common words |
| **Total** | **22,575** |                                       |

## Methodology

### Data sources

1. **JPDB frequency list** (primary) — frequency rankings from a corpus of anime, novels, visual novels, and other Japanese media (~500K entries). Lemma-based: all conjugations of a verb are grouped under its dictionary form.
   - Source: [MarvNC/jpdb-freq-list](https://github.com/MarvNC/jpdb-freq-list)

2. **JMdict XML frequency tags** (secondary) — newspaper frequency data embedded in the raw JMdict XML (`nf01`–`nf48` tags from Mainichi Shimbun, plus `ichi1`/`news1` flags). Form-based: each conjugation counted separately.
   - Source: [EDRDG JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project)

3. **JMdict (jmdict-simplified)** — the base word list. Only entries tagged as "common" are included.
   - Source: [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified)

### Algorithm

**POS-aware frequency combination:**

JMdict newspaper frequency is _form-based_ — it counts each conjugation separately. This means 食べる (to eat, dictionary form) has a low newspaper rank (~12,000) even though 食べた/食べて/食べました are all extremely common. JPDB is _lemma-based_ — all forms are grouped, so 食べる correctly ranks in the top 200.

- **Verbs and adjectives** (inflectable words): pure JPDB frequency rank. JMdict newspaper data is ignored because form-based counting systematically undercounts these.
- **Nouns and other non-inflectable words**: JPDB frequency rank as primary signal, with a bounded penalty from JMdict newspaper data for words that appear disproportionately in fiction vs. general usage. The penalty only pushes words _down_ (toward less common), never up — so newspaper-common words aren't penalized.

**N5 seed list (~114 words):**

Some universally-basic vocabulary (電車/train, 駅/station, 天気/weather, 安い/cheap, etc.) ranks low in novel frequency because fiction rarely discusses daily-life topics like transportation, weather, and prices. A small seed list of textbook-standard N5 words is pinned to ensure they don't fall below N5 regardless of corpus frequency. These are hand-curated from standard beginner curriculum categories: transport, food, family, body parts, time, directions, seasons, school vocabulary.

**Level assignment:**

All entries are sorted by combined frequency rank, then assigned JLPT levels by cumulative position: the top 800 = N5, next 1,500 = N4, next 3,700 = N3, next 6,000 = N2, remainder = N1. These band sizes roughly match the real JLPT's vocabulary expectations at each level.

### Known limitations

- **Novel/media bias**: JPDB over-represents literary and media vocabulary. Words like 姿 (figure/form) and 人間 (human being) rank very high because they're ubiquitous in fiction, even though they may feel "advanced" to learners.
- **Daily-life underrepresentation**: Words common in everyday conversation but rare in fiction (切符/ticket, 天気/weather) are partially mitigated by the N5 seed list but may still rank lower than traditional JLPT at N4+ levels.
- **No grammar coverage**: JLPT tests grammar patterns as well as vocabulary. This list only covers words.
- **Seed list is hand-curated**: The ~114 pinned N5 words are selected based on standard beginner curriculum, not a deterministic algorithm.

## Regenerating

If you have the Jiten source code:

```bash
yarn build:jlpt
```

This downloads the frequency data (cached in `.cache/`), processes it, and writes `data/jlpt-words.csv`.

## License

- **JMdict data**: CC-BY-SA 4.0 (Electronic Dictionary Research and Development Group)
- **JPDB frequency data**: from [jpdb.io](https://jpdb.io) via [MarvNC/jpdb-freq-list](https://github.com/MarvNC/jpdb-freq-list)
- **This derived list**: CC-BY-SA 4.0
