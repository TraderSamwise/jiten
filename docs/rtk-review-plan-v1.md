# RTK: a Learn mode and a Review mode — plan v1

The Learn tab's RTK screen is one thing today: the path. Crowned nodes graduate into FSRS
cards and are then never seen again from inside the course — you have to go to the Lists
tab and open one of 56 lesson lists. This plan gives the course a **Review** mode beside
**Learn**, driven by the flashcard engine that already exists, asking RTK's own question
rather than the dictionary's.

## What is already here

Measured before designing anything, as `CLAUDE.md` asks.

| Thing             | State                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | --------------------------------------------------------------------------------- |
| Graduation        | `lib/rtk-graduate.ts` writes one `srs_cards` row per frame into `default-rtk-lesson-<N>`, `entry_id = 0`, `kanji_literal` set, `front_mode = "kanji"`, state 0 (new) |
| Lists             | 56 of them, seeded by `seedRtkLessonsIfNeeded`, `is_default = 1`, every one of the 2,200 frames already an entry                                                     |
| Engine            | `app/(tabs)/lists/study.tsx` — FSRS (`srs`), `simple_srs`, `add_order`; faces; typing, voice and (new) cloze input; confusion detection; mark-for-review; undo       |
| Faces             | `CardFace = kanji                                                                                                                                                    | kana | english | mnemonic`. A list's `front_faces`/`back_faces`default to`["kanji"]`/`["english"]` |
| Cross-list review | Exists for one source list only: `_smart_<id>` and `_marked_<id>` in `lib/smart-review.ts`                                                                           |
| Queue scope       | `list_id = ?` — 12 occurrences in the study screen, 8 of them `FROM srs_cards`                                                                                       |
| Practice log      | `logPracticeEvent` is called with the **screen's** `listId` at 4 sites; rating itself updates `srs_cards … WHERE id = ?`, so it is card-scoped already               |

### The two findings that decide the shape

**1. RTK cards currently ask the wrong question.** For a kanji card the `english` face is
`kanji.meanings.join(", ")` — KANJIDIC, not Heisig. So a graduated 日 is asked as
`日 → "day, sun, Japan, counter for days"`. The frame's keyword is not on any face, and
neither is the learner's own keyword override from `user_kanji_notes`. **There is no
keyword face.** Everything else in this plan is cosmetic next to that.

**2. A smart list is a parallel schedule, not a view.** `getOrCreateSmartList` inserts its
own `list_entries` and its own `srs_cards` rows under `_smart_<id>` and runs them in
`simple_srs`. That is right for "drill the things I keep failing" and wrong for RTK
review: two rows for one frame means two schedules, and FSRS stops being the one truth.
Any design that copies cards into an `_rtk_` list is rejected on that ground.

## Options for the review queue

### A — one aggregate RTK list

Graduate into a single `default-rtk` list instead of 56.

- Review is then just "open that list" — zero engine work.
- But: the 56 lists already hold cards on real devices, so it needs a migration that moves
  `srs_cards` between lists, and `lists`/`list_entries`/`srs_cards` all sync, so the
  migration has to be idempotent under last-write-wins across devices.
- Loses per-lesson study, which is a thing the Lists tab can do today.

### B — scope the queue to a set of lists (recommended)

A review session takes a **list scope** rather than a single id: `list_id = ?` becomes a
`{ clause, args }` from one helper, resolved from the route.

- The real cards keep their real FSRS state. Nothing is copied, nothing double-schedules.
- Per-lesson study still works; the 56 lists stay as they are; no data migration.
- Settings come from one real `lists` row, `default-rtk-review`, that holds **no entries and
  no cards** — only `front_faces` / `back_faces` / `flashcard_mode` / `mnemonic_cloze`. That
  reuses `FlashcardSettingsModal` unchanged and keeps RTK's answer in one place.
- Cost: the 8 `FROM srs_cards` queries, `review_marks` (which is per-list), and the 4
  `logPracticeEvent` call sites, which should pass the **card's** `listId` so a review of
  lesson 12 is recorded against lesson 12.

### C — a derived `_rtk_review_` list, like smart review

Rejected: see finding 2. It would duplicate 2,200 FSRS states.

## The RTK tailoring

Each of these is a separate, small change on top of option B.

1. **A `keyword` face** (the core of it). Renders the learner's keyword from
   `user_kanji_notes`, else `heisig_keyword`, else nothing. Needs: the `CardFace` union,
   `getKanjiFaceText`, `FACE_ORDER`, the settings modal's face list (gated on
   `hasKanjiEntries` like `mnemonic` already is), and `getFaceText` for word cards (where it
   has no meaning and renders empty, as `mnemonic` does).
2. **Heisig's direction by default.** `default-rtk-review` is created with
   `front_faces = ["keyword"]`, `back_faces = ["kanji", "mnemonic"]` — the keyword is the
   prompt and the character is the answer, which is what the book asks for. The learner can
   change it; nothing else in the app changes.
3. **Input mode.** Self-rated by default. Cloze is already an option and fits RTK exactly.
   A **write** mode is the honest Heisig exercise — the course already has `WriteDrill`
   (draw from memory, reveal the strokes, self-verdict), and it could become a fifth input
   mode. Worth its own phase, not this one.
4. **Scope = graduated frames.** No filter needed: a card exists only where a node was
   crowned, so the scope is exactly what the learner has finished.
5. **A due count on the Review tab**, summed across the 56 lists, so the mode says whether
   there is anything to do before you tap it.

## Phases

1. **The `keyword` face.** Union, both face-text functions, face order, settings list, and a
   test that a kanji card asks the learner's keyword, falling back to Heisig's. Nothing is
   wired to RTK yet; the face is immediately useful on any kanji list.
2. **The list scope.** One helper, the 8 queries, `review_marks`, and the practice log
   taking the card's own list. A test that a two-list scope queues cards from both and that
   a single-list scope is unchanged.
3. **The review entry.** `default-rtk-review` settings row (created on demand, never
   seeded), `/learn/rtk` gains a `SegmentedControl` — Learn | Review — with the path under
   one and, under the other, the due count and a Start that opens the engine with the RTK
   scope.
4. **Counts and empties.** Due today, cards in the course, and the two empty states that
   matter: nothing graduated yet (send them to Learn) and nothing due (say when the next
   card is).
5. **Write mode** (optional, separate). `WriteDrill` as a fifth input mode, available on any
   kanji list.

## Open questions

- **Does Review belong in the Lists tab as well?** A `default-rtk-review` row with no
  entries would look broken there. Simplest answer: it is `is_default = 1` and the Lists tab
  hides it, the way it already excludes default lists from push.
- **One scope or one list per lesson for `review_marks`?** Marks are keyed
  `(entry_id, kanji_literal, list_id)`; a cross-list session should mark against the card's
  own list, which makes a mark visible from the lesson list too. Worth doing in phase 2.
- **Confusion detection across 2,200 frames.** It compares against lookalikes within the
  list being studied. Scoped to the whole course it has far more to work with, which is
  probably better, but it is a behaviour change worth watching rather than assuming.

## Non-goals

- Changing how the course itself teaches. Learn mode is today's path, untouched.
- Moving cards between lists, or deleting the 56 lesson lists.
- A second FSRS schedule for RTK, in any form.
