# Simple SRS — decisions

`stores/simple-srs.ts` is a clone of Midori's scheduler, and `app/(tabs)/lists/study.tsx`
drives it. Every entry here is a question that was argued out with numbers. Re-opening one
is fine, but bring a measurement, not an opinion.

## How to measure a change here

The engine is a pure function of the card row: `nextSimpleReview(card, action)` decides one
answer, and nothing else in the session changes a card's schedule. So a scheduling change
is measured by simulating a deck through that exact function — not through a reimplementation
of the rules, which is how the first version of this measurement missed the bug entirely.

**`yarn simulate:srs` regenerates every number below**, from
`scripts/simulate-simple-srs.ts`. It ships for a reason: review could not reproduce an
earlier version of these tables from their prose description, because the answer-count
spread, the daily budget and the intra-day re-queue rule all change the result and none of
them were written down. A number nobody else can produce is not a measurement. Quote the
script's output, and if a figure here disagrees with it, the script is right.

Its assumptions, all of which matter: 8,000 cards (Sam's list), 90% accuracy on graduated
cards and 80% on cards in learning, a fixed daily answer budget, and a card that fails or
has not yet collected three correct answers pushed back into the same day's queue — because
the session re-queues it about ten cards away rather than ending. **The answers-per-day
figure decides more than any rule does**; see the repair decision.

Reference figures for the fixed engine, fresh deck, ten new cards a day: the queue settles
at 79 cards shown on d30 and 117 on d365, with 139 and 227 answers given. It does not grow.

## The lapse multiplier applies once (2026-10-13)

`simpleGraduate`'s third argument was `card.lapses > 0` — a lifetime counter nothing resets
— so every graduation after a card's first ever failure multiplied its interval by 0.5
instead of 1.9. A card climbed to 56 days, failed once, and then ratcheted 28 → 14 → 7 →
3.5 → … to the 8-hour floor, where it was due every day for the rest of its life. At 90%
accuracy, over 20,000 sampled cards, **92% sit at or below a one-day interval after 40
answers** and 96% after 45; under the corrected rule it is 0.1%, and 0.01% at 45. (An earlier
version of this line said 96% at 40, from a 400-card sample — `yarn simulate:srs ratchet`.)

The flag is now `simple_relearning`, a column, set on the failure and cleared by the
re-graduation that pays for it. Midori's own file is the check — 2,450 cards with a median
interval of 37 days, 187 at the 365-day cap and 107 below a day, which is the shape the
corrected rule produces and nothing like what the shipped one did. (Measured from Sam's own
Midori export, which is not in this repo, so that one figure is the only number here
`yarn simulate:srs` cannot reproduce.)

## The correct-in-a-row count lives on the card (2026-10-13)

A learning card needs three correct answers in a row. That count lived in a React ref, so
it died with the screen: at one pass per session a card never graduated, ever. It is
`simple_run` on the row now.

This mattered because of the next entry — with the whole list in one queue, one pass per
card per session was the only rate available.

## A session introduces ten unseen cards, not the whole list (2026-10-13)

The new pool was every unseen card in the list. On 8,000 words that is 8,000 cards in one
queue, which is also why nothing collected three consecutive answers. The cap is
`lists.new_per_session`, default 10 (Midori's number), clamped to 1–500 by
`resolveNewPerSession` — zero would send a list with nothing due straight to the done
screen.

Smart Review and the flagged-cards list are exempt: both are assembled on purpose and are
entirely new, so a cap would show ten of a deliberate selection and call that a session.
The RTK review list cannot reach the branch at all — `lib/rtk-review.ts` writes
`flashcard_mode 'srs'` and its multi-scope forces FSRS. That correction is worth recording
because the opposite was asserted before it was checked.

## Already-ratcheted decks are repaired, not left to recover (2026-10-13)

Fixing the rule does not fix the stored intervals. A deck the bug has flattened is 8,000
cards at the 8-hour floor, all due today and all due again tomorrow. Queue size by day,
every run driven by the shipped `nextSimpleReview`:

| answers/day | repair       | d1   | d7   | d30  | d90  | d180 | d365 |
| ----------- | ------------ | ---- | ---- | ---- | ---- | ---- | ---- |
| 1000        | none         | 8000 | 7338 | 5270 | 1328 | 81   | 18   |
| 1000        | spread 2–30d | 8000 | 3633 | 261  | 109  | 63   | 39   |
| 1000        | flat 7d      | 8000 | 3985 | 511  | 402  | 357  | 259  |
| 200         | none         | 8000 | 7874 | 7492 | 6699 | 5554 | 3567 |
| 200         | spread 2–30d | 8000 | 7096 | 5359 | 3388 | 1131 | 55   |
| 200         | flat 7d      | 8000 | 7128 | 6134 | 4886 | 2259 | 198  |
| 150         | none         | 8000 | 7888 | 7595 | 6990 | 6180 | 4661 |
| 150         | spread 2–30d | 8000 | 7332 | 6074 | 4581 | 2854 | 72   |

A four-digit cell is one sample of a stochastic process; `--seed=N` resamples. The
conclusions below hold across seeds, the exact numbers do not.

**At 1,000 answers a day the deck heals itself in about four months, and at 150–200 it does
not.** That single number is why the first conclusion here — natural recovery, no repair —
was wrong: it was measured at an effort nobody sustains. At 200 a day, 3,567 cards are still
queued a year later, because a card answered today returns within hours and takes tomorrow's
slot.

So there is a one-time repair: a migration that spreads the cards pinned at the floor over
the next month. The rows in the table above are simulated with every card repaired, which is the upper
bound; the clause below is narrower, and the stage split under **A learning card is bounded,
not repaired** says by how much. What was rejected,
and why:

- **No repair.** The numbers above, at the effort the deck is actually reviewed at.
- **A flat lift to 7 days.** Half the drain of the spread at every horizon — 2,259 still
  queued at d180 against 1,131 — and it re-synchronises the deck: at 1,000 answers a day the
  spread is down to 39 cards by d365 while the flat lift still shows 259, the same wave
  coming back together.
- **A narrower spread.** A shorter window drains more slowly for the same reason the flat
  lift does: more cards land on the same days. The backlog is the complaint, and a card
  given more days than it has earned costs one failed review when it comes back.

### Which rows the repair touches

`simple_stage = 1 AND simple_interval <= 0.34 AND lapses > 0 AND reps >= 12 AND deleted_at IS
NULL`, and the matched rows get both a new interval and a new due date inside the next
month.

`reps >= 12` is the discriminator, and it was measured rather than reasoned. Replaying
3,600 cards under each rule, counting `reps` the way `rateSimpleSrsCard` does:

The sample is 400 seeds × nine answer counts (4, 8, 12, 16, 24, 32, 48, 64, 96) = 3,600
cards under each rule, because `reps` only varies if cards have lived different lengths — a
fixed-length replay gives every card the same count and the clause then catches everything.

| clause                                | ratchet victims caught | honest floor cards lifted |
| ------------------------------------- | ---------------------- | ------------------------- |
| `interval <= 0.34, reps >= 3` @ 90%   | 2359 / 2359            | 111 / 111                 |
| `interval <= 0.34, reps >= 12` @ 90%  | 2127 / 2359            | 13 / 111                  |
| `interval <= 0.34, reps >= 20` @ 90%  | 1735 / 2359            | 0 / 111                   |
| `interval <= 0.34, lapses >= 3` @ 90% | 1568 / 2359            | 17 / 111                  |
| **the shipped clause** @ 90%          | 1589 / 2359            | —                         |
| `interval <= 0.34, reps >= 12` @ 75%  | 2543 / 3031            | 167 / 469                 |
| `interval <= 0.34, lapses >= 3` @ 75% | 2504 / 3031            | 259 / 469                 |
| **the shipped clause** @ 75%          | 1098 / 3031            | —                         |

The shipped clause also requires `simple_stage = 1`, so it reaches 1,589 of the 2,359 — 93%
of the 1,714 that are graduated, and none of the rest. **The `reps >= 12` row is the
discriminator's power, not the clause's reach**; quoting 2,127 for the clause overstates it
by a third.

A card the ratchet dragged down from 56 days has a median of 32 answers behind it; one
honestly at the floor has 4, and never more than 16 at 90% accuracy. **`lapses >= 3` is the
obvious guard and it is wrong**: under the bug a single lapse starts the ratchet, so it
catches only 1,568 of 2,359 victims — a third of the deck left flattened. That was proposed
in review, and the measurement is the only reason it was not shipped.

`simple_interval <= 1` rather than `<= 0.34` catches cards part-way down the ratchet at the
cost of lifting far more honest ones. A card at 0.88 days climbs on its own once the rule is
fixed — 1.67, 3.18, 6.04 — so only the cards pinned at the floor need the repair.

### A learning card is bounded, not repaired (2026-10-13)

**An earlier version of the repair rewrote stage-0 intervals too, and that was wrong.** A
stage-0 card sits at 1/3 because that is where every new card starts, not because of the
ratchet: `simpleReviewFail` preserves the interval and the learning path never multiplies
it. With the whole list loading as new and the correct-in-a-row count dying with the
screen, cards that never graduated at all are most of the stage-0 population — and they
have the reps to pass any threshold, because the bug made them answer the same words every
day. Lifting those would hand thousands of unlearned words a fortnight each.

Of 2,359 floored cards at 90% accuracy, 1,714 are graduated and 645 are in learning; at
75% the split inverts, 1,263 against 1,768. So the clause repairs 93% of the floored
graduated cards (87% at 75%) and none of the learning ones — 67% and 36% of the floored
population.

The learning ones are the real complaint, and no rewrite of a stored interval fixes them:
they are words with one pass each that never graduated, and they are all due, every day.
**Capping them is what fixes it.** The learning slice of the due pool is limited to
`learningCapFor(newPerSession)` — three learning answers are one new card's worth of work —
ordered most-recently-answered first, so the cards already in hand get finished before the
backlog is reached, and placed at the head of the queue so a graduated load bigger than the
learner's stamina cannot stop anything in learning from advancing. The list screen's "due
today" badge applies the same cap, or it promises 8,000 cards for a session that shows
thirty and then says it is done.

Cards shown per day on a legacy deck of 8,000 stage-0 cards, and two counts of what was
learned: cards that touched stage 1 at any point, and cards still graduated at the end on an
interval longer than a day — i.e. actually kept (`yarn simulate:srs learningCap`, seed 7):

| learning cap | answers/day | d1   | d7   | d30  | d180 | d365 | touched stage 1 | kept |
| ------------ | ----------- | ---- | ---- | ---- | ---- | ---- | --------------- | ---- |
| none         | 200         | 8000 | 8000 | 8000 | 8000 | 5447 | 8000            | 2665 |
| 30 (3 × 10)  | 200         | 30   | 102  | 91   | 108  | 123  | 3042            | 3008 |
| 10           | 200         | 10   | 46   | 80   | 107  | 113  | 3238            | 3221 |
| none         | 400         | 8000 | 8000 | 8000 | 5287 | 817  | 8000            | 7451 |
| 30 (3 × 10)  | 400         | 30   | 147  | 214  | 259  | 266  | 7042            | 7005 |
| 10           | 400         | 10   | 50   | 77   | 123  | 122  | 3650            | 3634 |

**Which column you read decides the answer, and an earlier version of this section read the
wrong one.** It said the cap cost thousands of words, counting cards that touched stage 1.
Uncapped, 8,000 do — and only 2,665 are still there at the end, because an uncapped deck
churns: a card graduates at 0.633 days, comes back the same day, fails, and sits at the
floor again. Capped, almost everything touched is kept (3,008 of 3,042). **On words actually
retained the cap wins**, 3,008 against 2,665, while showing 100 cards a day instead of 8,000.

The ×3 is what keeps it from starving a learner who does more: at 400 answers a day the
cap of thirty keeps 7,005 words against 3,634 for a cap of ten. At 200 a day the cap of ten
is marginally ahead (3,221 against 3,008), so the multiplier costs a little at low effort
and is worth several thousand words at high effort.

A genuinely ratcheted card currently in learning is the price of not repairing stage 0: it
re-graduates to the floor once and then climbs 0.33 → 0.63 → 1.2 by itself.

Accepted trades, written down because they are real:

- A card honestly at the floor with twelve or more answers behind it is lifted with the
  rest. Nothing in the row distinguishes "ratcheted down from 56 days" from "never
  climbed" — the simple path writes no `review_logs` entry, so there is no history to
  replay — and at 75% accuracy that is 167 cards in 2,700. The cost is one failed review
  each.
- `reps` is not per-mode. A list switched from FSRS to simple SRS brings its FSRS count
  with it, so its cards qualify after a single simple graduation lands them at the floor.
  Bounded and self-correcting; there is nothing in the row to tell them apart, and adding a
  per-mode counter for one migration is not worth it.
- The victims that stopped part-way down the ratchet, and every ratcheted card currently in
  learning, are missed. They climb on their own.
- A list moved from simple SRS to FSRS has its dormant `simple_*` columns rewritten and its
  `updated_at` bumped, so rows that no longer schedule anything get pushed. Harmless, and
  cheaper than a `flashcard_mode` join that would also skip a list switched back later.
- The spread is `2 + (rowid % 29)`, deterministic rather than random, so the repair is
  idempotent: a repaired row no longer matches the clause, which matters because every
  device runs the UPDATE against its own rowids. A stale second device re-spreads its own
  copies with its own offsets, which is harmless — they stay inside the same month.
- `isRemoteRelevant` keeps the UPDATE out of remote replay and the bumped `updated_at`
  carries the result by row sync.
- Cards imported later are never repaired: `lib/data-backup.ts` restore and
  `lib/list-transfer.ts` import run against an already-migrated database, so a floored row
  arriving afterwards stays floored. `simple_relearning`'s backfill has the same hole. Not
  worth a mechanism; worth knowing.
