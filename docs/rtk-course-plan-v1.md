# RTK as a course — plan v1

A Duolingo-shaped path through Remembering the Kanji: 56 units, five frames at a time, one
**Continue** button. No deck to assemble, no faces to configure, no scheduler to tune.

This is an **introduction machine**. Retention stays with the SRS that already exists: a node,
once cracked, hands its frames to `srs_cards` on FSRS and they surface in `study.tsx` like any
other card. Nothing here is a second scheduler.

## What is already shipped

Measured against the committed assets on 2026-10-03, before any of this is written. The scope of
the work is the delta, so this list is the part that must **not** be rebuilt.

| asset                                                              | where                                                                               | size                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| Heisig frame number, keyword, lesson                               | `kanji_characters.heisig_{index,keyword,lesson}`                                    | 3,000 / 3,000 / 56 lessons (frames 1-2,200) |
| Primitive decomposition, ordered                                   | `kanji_primitives(literal, position, primitive_id, keyword)`                        | 6,644 edges                                 |
| Primitive inventory, with glyph substitutes for the invented ones  | `primitives`                                                                        | 244                                         |
| Visual confusables, ranked                                         | `kanji_similarity(literal, similar, score, rank)`                                   | 249,260 pairs                               |
| Stroke paths (KanjiVG 109×109)                                     | `kanji_strokes`                                                                     | 6,702 kanji                                 |
| Keyword synonyms, for accepting typed answers                      | `keyword_synonyms`                                                                  | 81,036 pairs                                |
| Stories with `[primitive]` markup + a custom keyword per kanji     | `user_kanji_notes`                                                                  | user data                                   |
| Personal primitive↔word index, learned from the user's own stories | `primitive_note_assoc`, `db/primitive-associations.ts`                              | user data                                   |
| Kanji SRS cards                                                    | `srs_cards` (`entry_id = 0`, `kanji_literal`) + FSRS                                | —                                           |
| A `mnemonic` card face, with primitive chips                       | `app/(tabs)/lists/study.tsx` (`FACE_ORDER`)                                         | —                                           |
| Per-item telemetry                                                 | `practice_events` (`practice_mode`, `assisted`, `response_ms`), `practice_sessions` | —                                           |
| Streak, daily activity, leeches, confusion pairs, card states      | `lib/practice-stats.ts` + `app/(tabs)/lists/stats.tsx`                              | —                                           |
| Lesson retrieval                                                   | `getKanjiByLessonAsync` in `db/kanji-search.ts`                                     | —                                           |
| Primitive lookup, stroke paths, synonyms, similar kanji            | `db/kanji-search.ts`                                                                | —                                           |
| Story editor with ambient auto-linking                             | `components/MnemonicEditor.tsx`, `hooks/useMnemonicSuggestor`                       | —                                           |
| Story rendering with tappable primitive glyphs                     | `components/MnemonicText.tsx`, `PrimitiveGlyph`, `PrimitiveChips`                   | —                                           |
| Stroke order diagram                                               | `components/StrokeOrderDiagram.tsx`                                                 | —                                           |
| Drawing primitives                                                 | `@shopify/react-native-skia`, `react-native-svg`, `react-native-gesture-handler`    | —                                           |

### Three things are built and have no caller

Each left with Kanji Arena in `7f75495` ("Move Kanji Arena out to its own repo") or was never
wired at all. The course adopts them rather than writing new ones.

- `POST /api/kanji/mnemonic` — auth + entitlement + zod + rate-limited + structured JSON
  (`server/routes/kanjiMnemonic.ts`), registered on `AppType` in `server/app.ts`.
- `requestKanjiMnemonic` — the typed `hc<AppType>` client for it (`lib/kanji-mnemonic-ai.ts`).
- `getKanjiByLessonAsync` — frames of one RTK lesson, ordered by frame number.

### What is genuinely missing

1. **Where you are on the path.** Everything else about progress is tracked; unit/node/crown
   position is not. One table.
2. **A path screen** and a **node runner**.
3. **Three of the six exercises** — assemble, write, story cloze. (Recognise and identify are
   multiple choice over existing data; the typed-answer, matching and cloze mechanics already
   exist in `typing-game.tsx`, `connect-game.tsx` and `fill-blank.tsx`.)
4. **The archive is not fed to the generator.** `kanjiMnemonicRequestSchema` is
   `{ kanji, keyword, primitives }` — the user's own stories and their learned vocabulary per
   primitive are never sent, and the story comes back as bare prose carrying no `[primitive]`
   markup, so a generated story renders without glyph chips and contributes nothing back to
   `primitive_note_assoc`.

## Decisions settled

- **The entry point is a tab of its own, `Learn`** — not a screen under `/lists`. The course is not
  a deck: it reads no list, it has no entry count, and nothing is added to or removed from it.
  Its root screen _is_ the path, so opening the app one tab over is the whole of "starting a
  session". Two incidental deep links in: the `Heisig <n>` badge already on `KanjiDetail`, and a
  kanji long-pressed in the reader — both jump to that frame's node.

- **The user chooses: write, or generate.** Nothing is generated silently and nothing is
  generated before it is asked for. A frame's Meet step offers **Write it**, **Generate** and
  **Skip**.
- **A generated story lands in the same editor, prefilled and editable**, with Regenerate. One
  surface to learn, and saving a tweaked story runs `updateAssociationsForNote` like any other,
  so accepted stories teach the generator the user's vocabulary.
- **Unit = RTK lesson** (56 of them), split into **nodes of 5 frames**. Lessons average 39 frames
  and peak at 142, which is far too large to be a session.
- **Crowns are production.** Level 1 = meet + recognise + identify. Level 2 adds assemble. Level 3
  adds write. The path advances at level 1; crowns are a second pass.
- **No hearts.** A miss re-queues that frame later in the same node and reveals its story. Nothing
  ends a session early.
- **Graduation, not a second scheduler.** A cracked node writes `srs_cards` rows and retention runs
  through the existing study screen.
- **The path is volume 1: 2,200 frames in 56 units.** Measured, not assumed — of the 3,000
  keyworded frames in `kanji_characters`, 800 carry no `heisig_lesson`, and the ones that do run
  contiguously from frame 1 to frame 2,200. Those 800 are volume 3 and have no unit to live in, so
  `lesson` is typed nullable and `unitsFromFrames` drops them rather than guessing a unit.
  The path is therefore **56 units, 2,200 frames, 461 nodes**. Coverage over those frames,
  measured: keyword 2,200/2,200, stroke paths 2,200/2,200, at least three visual confusables
  2,200/2,200, a primitive decomposition 2,194/2,200.
- **Gate on primitives.** A frame is introducible only when every component that is itself a kanji
  is already known. RTK's invented primitives are never gated — they have no Unicode glyph and no
  frame of their own, and the book teaches each one inside the frame that first uses it. RTK's own
  order nearly guarantees the condition, so this is a tripwire, not a reordering engine.

## Data model

One new table, in `db/user-migrations.ts` (append only — the array is ordered and already-run
statements must not move):

```sql
CREATE TABLE IF NOT EXISTS course_progress (
  id TEXT PRIMARY KEY,            -- `rtk:<unit>:<node>`, derived, so two devices cannot make two rows
  course TEXT NOT NULL,           -- 'rtk', so a second course needs no migration
  unit INTEGER NOT NULL,          -- heisig_lesson
  node INTEGER NOT NULL,          -- 0-based, 5 frames each
  crown INTEGER NOT NULL,         -- 0 = untouched, 1..3
  first_seen_at TEXT,
  cracked_at TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_course_progress_course ON course_progress(course, unit, node);
```

Sync posture: a row is three integers and two timestamps, and losing it would silently reset the
path on a second device, so it joins `MUTABLE_TABLES` in `db/sync-helpers.ts` with `pk: "id"` and
`timestampCol: "updated_at"`, unfiltered. The derived `id` makes the merge idempotent; `crown`
conflicts resolve last-write-wins like every other row, and the worst case is one node re-crowned.

Per-item results do **not** go here — they go to `practice_events` with new `practice_mode`
values (`rtk_recognise`, `rtk_identify`, `rtk_assemble`, `rtk_write`, `rtk_cloze`), which is free
telemetry and lands in the existing stats screen.

## The node script

Five frames, six steps. Each step reads data that already exists.

| step             | prompt → answer                                      | data behind it                                                         |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. **Meet**      | kanji, primitive chips, keyword; write/generate/skip | `getPrimitivesForKanjiAsync`, `requestKanjiMnemonic`, `MnemonicEditor` |
| 2. **Recognise** | kanji → keyword, 4-way choice                        | `heisig_keyword` + distractors                                         |
| 3. **Identify**  | keyword → kanji, 4-way choice                        | `kanji_similarity` (ranked lookalikes)                                 |
| 4. **Assemble**  | tap this kanji's primitives, in order                | `kanji_primitives.position`, `PrimitiveGlyph`                          |
| 5. **Write**     | keyword → draw it, self-graded                       | `kanji_strokes`, `StrokeOrderDiagram`, Skia                            |
| 6. **Cloze**     | your story, keyword blanked, typed                   | `user_kanji_notes.mnemonic`, `keyword_synonyms`                        |

A frame with no story (Skip) still drills steps 2–5 and drops step 6 — the same rule
`study.tsx` already applies when it hides the mnemonic face for a storyless kanji.

Distractors come from `getSimilarKanjiAsync` first (visual confusion is the real failure mode),
topped up from the same unit's other frames when the similarity rows are thin, and a wrong pick
records a `confusion_events` row through the path that `study.tsx` already uses.

## Phases

Each phase ends typecheck- and lint-clean and is committed on `master`.

### Phase 1 — The progress spine

- `db/user-migrations.ts`: the `course_progress` table + index.
- `db/schema.ts`: the drizzle table.
- `db/sync-helpers.ts`: the `MUTABLE_TABLES` entry.
- `lib/rtk-course.ts` (new, pure): frame list from `heisig_index`, node boundaries, `nodeIdFor`,
  next-node selection, crown transitions, and `introducible(frame, known)` implementing the
  primitive gate.
- Gates: `yarn typecheck`, `yarn lint`, `yarn vitest run lib/rtk-course.test.ts db/sync-helpers`.
  Prove-fail the gate by widening a node to 6 frames and watching the boundary test fail.

### Phase 2 — The path

- **A fifth tab, `Learn`**, between Lists and Reader in `app/(tabs)/_layout.tsx` — a `GraduationCap`
  from `lucide-react-native`, `headerShown: false`, matching the other stack tabs.
- `app/(tabs)/learn/_layout.tsx`: the stack, following the heavy-screen Shell pattern documented in
  `app/(tabs)/lists/_layout.tsx`.
- `app/(tabs)/learn/index.tsx`: the path itself — 56 units, node dots per unit, crown state, and a
  single Continue that resolves to the next node. This is the tab root, so the path is a home
  screen rather than something reached through a deck.
- Reads `course_progress` and `kanji_characters` only. **No list is read anywhere in the course**;
  frames come from `heisig_index`.
- Gates: typecheck, lint, a render test over a seeded progress fixture.

### Phase 3 — The node runner and the Meet step

- `app/(tabs)/learn/node.tsx`: the session container — frame queue, re-queue on miss, node
  completion writing `crown` and `cracked_at`.
- `components/rtk/MeetFrame.tsx`: kanji, `PrimitiveChips`, editable keyword, **Write it** /
  **Generate** / **Skip**.
- Generate calls the adopted `requestKanjiMnemonic` and prefills `MnemonicEditor`; Regenerate
  re-rolls; Save writes `user_kanji_notes` and runs `updateAssociationsForNote`.
- After the node's first Generate, prefetch the remaining four in the background. Nothing is
  prefetched before the user has asked for one — `kanji_mnemonic` costs 1 against the shared `ai`
  bucket, which defaults to 500 per user per day and 2,000 across all users
  (`api/_shared/rate-limit.ts`), so one 142-frame unit prefetched ahead would be 28% of a personal
  day in a single tap.
- Gates: typecheck, lint, tests for choose-write / choose-generate / skip / regenerate / quota
  error surfacing (never a silent failure).

### Phase 4 — Recognise and identify

- Measured: **all 2,200 path frames have at least three `kanji_similarity` rows**, none has
  zero, so the similarity source alone can fill a 4-way choice; the unit top-up is insurance.
- `lib/rtk-distractors.ts`: pick N distractors for a frame, similarity-first, unit-topped-up,
  never equal to the answer, deterministic under a seed so a test can pin it.
- `components/rtk/ChoiceDrill.tsx`: both directions, `practice_events` logging, `confusion_events`
  on a wrong pick.
- Gates: typecheck, lint, `yarn vitest run lib/rtk-distractors.test.ts` — including a frame with
  zero similarity rows and a unit with fewer than four frames.

### Phase 5 — Assemble

- Measured: 2,194 of the 2,200 path frames have a decomposition (2.19 components on average,
  8 at most); 隙 匕 喩 嗅 惧 箋 have none and 170 more have a single component, so the drill is
  skipped below two components rather than asking the learner to assemble one piece.
- `components/rtk/AssembleDrill.tsx`: tap the primitives in `position` order, decoys drawn from
  other frames' primitives, rendered with `PrimitiveGlyph` so invented primitives show their
  substitute glyph and keyword.
- Crown level 2 unlocks it.
- Gates: typecheck, lint, tests for order enforcement and decoy selection.

### Phase 6 — Write

- Skia is already compiled into build 23 (`react-native-skia` 2.4.21 in the iOS pod lock, and
  `yarn check:ota-native-deps` passes against that build), so the drill is OTA-shippable and
  needs no new binary. Re-run that check before shipping it anyway.
- `components/rtk/WriteDrill.tsx`: a Skia canvas, strokes recorded, **Show me** revealing
  `StrokeOrderDiagram`, then a three-way self-grade (missed it / close / got it) feeding the same
  rating scale as the SRS.
- Crown level 3 unlocks it.
- Gates: typecheck, lint, a test over the grade→crown transition. Self-grading is not machine
  graded, deliberately — recognition of one's own failure is the RTK exercise.

### Phase 7 — Graduation, cloze, and the archive in context

- Cracking a node creates `srs_cards` rows (`entry_id = 0`, `kanji_literal`, the existing kanji
  front/back modes) so retention lands in `study.tsx`.
- **The one place the course touches a deck.** `study.tsx` is only ever entered as
  `/lists/study?listId=…` — even `SmartReviewModal` builds an ephemeral list rather than studying
  list-less cards — so graduated frames need a list to live in. They get exactly one, auto-seeded
  like the JLPT lists: `makeDefaultListId("RTK")` → `default-rtk`, `is_default = 1`. The user never
  curates it. The list shell does not sync (`MUTABLE_TABLES`' `lists` pushFilter excludes
  `is_default = 1`) and is re-seeded deterministically per device; the `srs_cards` in it do sync,
  so scheduling state crosses devices. Same posture as `JLPT N5 Kanji`.
- `components/rtk/ClozeDrill.tsx`: the saved story with the keyword blanked, typed answer accepted
  through `keyword_synonyms` and `canonicalStem`.
- `lib/api-contract.ts` + `server/routes/kanjiMnemonic.ts`: extend the request with the user's
  dominant word per primitive (`getAssociationsForWordAsync`, `targetForPrimitive`), two or three
  of their own stories as style exemplars, and their custom keyword from `user_kanji_notes`; ask
  the prompt for the markup `lib/mnemonic-markup.ts` already parses — `{self}` for the kanji's
  own keyword, `[label]` for a bare primitive, `[label](p<id>|<glyph>)` for a targeted one —
  so the result renders with chips and feeds `primitive_note_assoc` back.
- Course progress on `app/(tabs)/lists/stats.tsx`, reusing `getCurrentStreak`.
- Gates: typecheck, lint, scoped vitest; the schema change gets a contract test pinning the new
  fields as optional so an older client keeps working.

## Open questions

- Whether the primitive gate should ever **reorder** frames to pull forward kanji from the book
  being read. Attractive, and the reader already extracts a page's kanji — but it breaks the
  story-dependency order RTK is built on, so v1 only gates and does not reorder.

## Not doing

- **Hearts, gems, or any failure currency.** They add friction to the thing whose whole purpose is
  to have none.
- **A second scheduler.** FSRS and the simple-SRS path already exist and are tuned.
- **Machine-graded handwriting.** Stroke-match scoring against KanjiVG is a project of its own and
  self-grading is closer to what the book asks of a reader.
- **Silently generating 3,000 stories.** Ruled out: the user chooses per frame.
