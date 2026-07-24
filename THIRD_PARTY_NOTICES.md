# Third-Party Notices

Jiten is built on open Japanese-language data and a few third-party assets. Jiten's own
source code is licensed under AGPL-3.0 (see [LICENSE](LICENSE)), but the data and assets
below retain **their own licenses**, and those licenses require the attribution reproduced
here.

Most of these datasets are **not committed to this repository** — they are downloaded from
their upstream sources by the build scripts in `scripts/` and compiled into the SQLite
databases the app ships. This notice therefore also applies to any distribution of those
built databases (e.g. the `jiten-data` release artifacts).

---

## Dictionary data — JMdict, JMnedict, KANJIDIC2, KRADFILE

© Electronic Dictionary Research and Development Group (EDRDG).

The Japanese–English dictionary (JMdict), proper-name dictionary (JMnedict), kanji
dictionary (KANJIDIC2), and radical decomposition data (KRADFILE) are the property of the
EDRDG and are used in conformance with the group's licence.

- Licence: **Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)**
- <https://www.edrdg.org/edrdg/licence.html>
- <https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project>

The JSON conversion is sourced via **jmdict-simplified**
(<https://github.com/scriptin/jmdict-simplified>), which redistributes the EDRDG data under
CC BY-SA and its own code under Apache-2.0.

## Kanji stroke order — KanjiVG

© Ulrich Apel and the KanjiVG project.

- Licence: **Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)**
- <https://kanjivg.tagaini.net/>
- <https://github.com/KanjiVG/kanjivg>

## Pitch-accent data — Kanjium

Pitch-accent information is derived from the **Kanjium** project by Toshiro Mifune (`mifunetoshiro`).

- <https://github.com/mifunetoshiro/kanjium>

## English synonyms — WordNet

Keyword synonyms are derived from Princeton University's **WordNet**.

> WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
>
> THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO
> REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. By way of example, but not
> limitation, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT-
> ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE,
> DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS,
> TRADEMARKS OR OTHER RIGHTS.

- <https://wordnet.princeton.edu/>

## JLPT vocabulary classification

The bundled JLPT word-level classification (`data/jlpt-words.csv`) is a derived work — see
[`data/README.md`](data/README.md) for the full methodology — combining:

- **Jonathan Waller's JLPT vocabulary lists**, sourced via
  [`mjuhanne/yomichan-jlpt-vocab`](https://github.com/mjuhanne/yomichan-jlpt-vocab)
- **JPDB frequency data** via [`MarvNC/jpdb-freq-list`](https://github.com/MarvNC/jpdb-freq-list)
- JMdict frequency tags (EDRDG, above)

The resulting derived list is released under **CC BY-SA 4.0**.

## Pronunciation audio

Word pronunciation audio is **synthesized with Google Cloud Text-to-Speech (WaveNet)** at
build time; it is not scraped from human-recording services. Use is subject to the
[Google Cloud Platform Terms of Service](https://cloud.google.com/terms).

## Bundled literature — Aozora Bunko

`assets/starter-book.txt` is 夏目漱石『夢十夜』(Natsume Sōseki, _Ten Nights of Dreams_), a
**public-domain** work obtained from [Aozora Bunko](https://www.aozora.gr.jp/). Additional
Aozora and Syosetu texts are fetched at runtime, not bundled.

## Fonts

- **Space Mono** — © Colophon Foundry, licensed under the
  [SIL Open Font License 1.1](https://scripts.sil.org/OFL). (`assets/fonts/SpaceMono-Regular.ttf`)

## Acknowledgements

The kanji keyword and primitive-decomposition study features are inspired by and credit
James W. Heisig's _Remembering the Kanji_ method.
