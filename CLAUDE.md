# Jiten — agent instructions

Read [README.md](README.md) for a project overview, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the canonical deep-dive reference for repo
architecture and conventions — before changing files.

This file is the one an agent is handed: Claude Code loads it automatically and loads nothing a
pointer names, so anything an agent must know before touching this repo belongs here rather than
behind a link. `AGENTS.md` points here. The two documents above stay where they are because they
are written for people as well — the README is the open-source front page and ARCHITECTURE.md is
the contributor reference.

## Before building a mechanism, run the one that is already here

Measure the **existing** code path against the exact failing inputs, and report
what it already handles, before designing anything to replace or supplement it.
The scope of the work is the delta, not the whole problem.

This is not hypothetical. A set-phrase matcher — an anchor index, a slot
verifier, a coverage harness, ~500 lines — was built and reverted in one
session (`cef58de`) because `smartLookupWithOffset` already deinflects the whole
substring, so 腹が立った, 飯を食っていたら, 頭を下げなければ, あぐらを掻いて and
しらを切る all resolved on tap before a line was written. The real gap was
particle substitution, worth about fifty lines. A measurement in that same
session had already put the existing hit rate at 87%; it was reported and then
designed past.

- Run the shipping function on the failing case first. One command.
- A measurement showing the current system mostly works is a stop sign, not
  background. Whatever it misses is the whole brief.
- Do not invent a requirement to justify a design. If the task is lookup, a
  page-marking feature nobody asked for is not evidence that an index is needed.

## Reader lookup and furigana scoring is settled — measure before you touch it

Tap ranking, furigana resolution, counter readings and the deinflection rule
table have each been changed on measured evidence, and some tempting changes
have been measured and rejected. Read
[docs/reader-lookup-decisions.md](docs/reader-lookup-decisions.md) before
editing `packages/japanese-reader/src/{lookup,lookup-db,furigana,deinflect}.ts`.
It records what was decided, the numbers behind it, and — as importantly — what
does not work, so the same dead ends are not re-walked.

Both pipelines are deterministic given the built dictionaries, so changes there
are measured exhaustively rather than argued:

- **Taps** — resolve `smartLookupWithOffset` at every character of
  `test/corpus/bocchan.txt` with a 24-character window either side, before and
  after, and diff the matched span and the top entry (~11,250 taps). The
  committed gate over the same corpus is `yarn check:tap-consistency`, currently
  96.8%.
- **Furigana** — resolve `resolveFuriganaBatch` over every kanji-initial
  substring of the corpus up to 8 characters (~54,900 surfaces).
- **Counters** — `counter_readings` is finite; resolve all 2728 distinct
  `combined_kanji` forms, which bounds any counter change exactly.

Ship when every entry in the diff is an improvement or neutral. When it is not,
record the trade in that document rather than leaving it in a commit message.
