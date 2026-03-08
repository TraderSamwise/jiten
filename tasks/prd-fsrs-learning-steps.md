# PRD: FSRS Learning Steps & Anki-aligned Review

## Introduction

Align jiten's FSRS implementation with Anki's review model by adding learning/relearning steps, a 4-button rating UI for review cards, and intra-session timers for learning cards. Currently FSRS in jiten skips learning steps entirely — cards go from New straight to Review with a single continuous interval. This misses Anki's key UX: short-term repetition (1m, 10m) for new/failed cards before graduating to spaced review.

The "Hard" rating doubles as a "mark for review" action, connecting the existing review marks system to the FSRS flow.

## Goals

- Add configurable learning steps (default [1m, 10m]) and relearning steps (default [10m]) per list
- Show 4 rating buttons (Again/Hard/Good/Easy) for review cards, 2 (Fail/Pass) for learning/relearning
- Learning/relearning cards use exact-time due comparison (intraday), review cards use day cutoff
- Intra-session timer: learning cards auto-reinsert into the queue when their step timer fires
- Hard rating on review cards also marks the entry for review (via existing review marks system)
- No schema changes — all fields already exist in `srs_cards`

## User Stories

### US-001: Per-list learning step configuration

**Description:** As a user, I want to configure learning and relearning steps per list so different lists can have different step schedules.

**Acceptance Criteria:**

- [ ] Add `learningSteps` and `relearningSteps` fields to list settings (stored as JSON arrays of minutes)
- [ ] Defaults: learningSteps = [1, 10], relearningSteps = [10]
- [ ] UI in list flashcard config screen to edit steps (only shown for FSRS mode lists)
- [ ] Steps displayed as human-readable labels (e.g. "1m, 10m")
- [ ] Validation: at least 1 step, each step > 0
- [ ] Typecheck passes

### US-002: Learning step progression on rating

**Description:** As a developer, I need the rating handler to advance or reset the learning step counter so cards cycle through steps before graduating.

**Acceptance Criteria:**

- [ ] On Pass (Good): advance `learning_steps` to next step. If at final step, graduate to Review (state 2) using FSRS scheduling
- [ ] On Fail (Again): reset `learning_steps` to 0, stay in Learning/Relearning state, due = now + first step interval
- [ ] On Easy: skip remaining steps, graduate immediately to Review (state 2) with FSRS Easy scheduling
- [ ] New card first review: state 0 → state 1 (Learning), `learning_steps` = 0, due = now + step[0]
- [ ] Lapsed review card: state 2 → state 3 (Relearning), `learning_steps` = 0, due = now + relearningStep[0]
- [ ] `learning_steps` field in DB tracks current step index (already exists, currently always 0)
- [ ] Typecheck passes

### US-003: 4-button rating UI for review cards

**Description:** As a user, I want to see Again/Hard/Good/Easy buttons when reviewing graduated cards so I have more granular control over scheduling.

**Acceptance Criteria:**

- [ ] Review cards (state 2) show 4 buttons: Again (red), Hard (amber), Good (green), Easy (blue)
- [ ] Learning/Relearning cards (state 1, 3) show 2 buttons: Fail (red), Pass (green)
- [ ] New cards (state 0, first review) show 2 buttons: Fail (red), Pass (green)
- [ ] Each button shows the next interval as a label (e.g. "1m", "3d", "7d") — computed from FSRS scheduling
- [ ] Long-press behavior removed for FSRS mode (replaced by explicit Easy button)
- [ ] Simple SRS mode keeps existing 2-button UI unchanged
- [ ] Typecheck passes
- [ ] Verify button layout on device

### US-004: Hard rating marks for review

**Description:** As a user, when I rate a card "Hard" it should also mark it for review so I can find it later in the Marked for Review screen.

**Acceptance Criteria:**

- [ ] Tapping Hard on a review card calls `markForReview()` in addition to rating with `Rating.Hard`
- [ ] Flag icon on card turns amber after Hard rating (same as manual flag tap)
- [ ] Card appears in Marked for Review screen for that day
- [ ] Deduplication: if card is already marked today, don't double-mark
- [ ] Manual flag toggle still works independently (user can unflag after Hard if they want)
- [ ] Typecheck passes

### US-005: Dual due-check (intraday + day cutoff)

**Description:** As a developer, the queue loader needs to use exact-time comparison for learning/relearning cards and day cutoff for review cards so intraday steps work correctly.

**Acceptance Criteria:**

- [ ] loadQueue "due" mode runs two queries: (1) learning/relearning cards where `due <= now` (exact ISO time), (2) review cards where `due <= endOfLogicalDay` (day cutoff)
- [ ] Results merged and sorted: learning/relearning cards first (most overdue first), then review cards by due ASC
- [ ] Checkpoint "early" count: learning/relearning cards where `due > now`, review cards where `due > endOfLogicalDay`
- [ ] DueCardsSection bucket calculation: learning/relearning use exact time, review uses day cutoff
- [ ] Header count reflects merged total
- [ ] Typecheck passes

### US-006: Intra-session learning timer

**Description:** As a user, when I review a learning card and it's due again in 10 minutes, I want to keep reviewing other cards and have the learning card automatically reappear when ready.

**Acceptance Criteria:**

- [ ] After rating a learning/relearning card, schedule a timer for when it's next due
- [ ] When timer fires, insert card back into the active queue (at the front, after any other overdue learning cards)
- [ ] If no other cards to review while waiting, show a countdown screen: "Next card in Xm Xs" with a progress ring or simple timer
- [ ] "Review Now" button on countdown screen to review the card early
- [ ] Multiple learning cards can be pending simultaneously (each with its own timer)
- [ ] Timers cancelled when exiting the study session
- [ ] If app is backgrounded and returned, recalculate which pending cards are now due
- [ ] Typecheck passes
- [ ] Verify timer UX on device

### US-007: Interval preview on buttons

**Description:** As a user, I want to see what interval each button will produce before I tap it, so I can make an informed choice.

**Acceptance Criteria:**

- [ ] Each rating button shows the resulting interval below the label (e.g. "Good — 3d", "Easy — 7d")
- [ ] For learning cards: show step time (e.g. "Pass — 10m")
- [ ] Intervals computed by calling `fsrs.repeat()` for each rating and reading the result
- [ ] Intervals formatted: <1h as minutes ("10m"), <1d as hours ("4h"), <31d as days ("3d"), ≥31d as months ("2mo")
- [ ] Preview computed once when card is shown (not on every render)
- [ ] Typecheck passes
- [ ] Verify interval labels on device

## Functional Requirements

- FR-1: Store `learningSteps` (number[], minutes) and `relearningSteps` (number[], minutes) as JSON columns on the `lists` table. Default [1, 10] and [10] respectively.
- FR-2: On first review of a new card (state 0): set state to 1 (Learning), `learning_steps` to 0, `due` to now + learningSteps[0] minutes.
- FR-3: On Pass for a learning card: increment `learning_steps`. If `learning_steps >= learningSteps.length`, graduate: call `fsrs.repeat(card, Rating.Good)`, set state to 2, use FSRS-computed due date. Otherwise, set `due` to now + learningSteps[learning_steps] minutes.
- FR-4: On Fail for a learning card: reset `learning_steps` to 0, set `due` to now + learningSteps[0] minutes.
- FR-5: On Easy for a learning card: skip all steps, call `fsrs.repeat(card, Rating.Easy)`, graduate to state 2.
- FR-6: On Again for a review card (state 2): set state to 3 (Relearning), `learning_steps` to 0, `due` to now + relearningSteps[0] minutes. Also call `fsrs.repeat(card, Rating.Again)` to update stability/difficulty (but override `due` with the step interval).
- FR-7: On Hard for a review card: call `fsrs.repeat(card, Rating.Hard)` for scheduling AND call `markForReview()` to flag the card.
- FR-8: On Good/Easy for a review card: call `fsrs.repeat(card, Rating.Good/Easy)` normally — standard FSRS scheduling.
- FR-9: On Pass for a relearning card: increment `learning_steps`. If done, graduate back to state 2 using FSRS scheduling. Otherwise, set `due` to now + relearningSteps[learning_steps] minutes.
- FR-10: On Fail for a relearning card: reset `learning_steps` to 0, set `due` to now + relearningSteps[0] minutes.
- FR-11: Queue loading splits into intraday (state 1, 3: exact time) and day-level (state 2: day cutoff). Merged, learning/relearning sorted first.
- FR-12: Intra-session timer schedules pending learning cards and auto-inserts them when due. Countdown shown if no other cards available.
- FR-13: 4 buttons (Again/Hard/Good/Easy) for review cards. 2 buttons (Fail/Pass) for learning/relearning/new cards.
- FR-14: Each button displays the resulting interval as a label.

## Non-Goals

- No configurable request retention, max interval, or FSRS weights (future phase)
- No global default learning steps (per-list only)
- No changes to Simple SRS mode
- No "bury" or "suspend" card features
- No undo last review (future)
- No audio autoplay timing changes based on learning steps

## Technical Considerations

- **No schema migration needed.** `srs_cards.learning_steps` already exists (integer, currently always 0). `lists` table needs `learning_steps` and `relearning_steps` JSON columns (one ALTER TABLE ADD COLUMN migration).
- **ts-fsrs `repeat()` still does the scheduling math.** We use FSRS for stability/difficulty/interval computation but override `due` for learning steps. On graduation, we use the full FSRS result.
- **Timer implementation:** Use `setTimeout` refs stored in a `Map<string, NodeJS.Timeout>` keyed by card ID. Clear all on unmount. On app resume (`AppState` change), recalculate which timers have elapsed.
- **Button interval preview:** Call `fsrs.repeat(card, new Date())` once per card reveal — it returns a `RecordLog` with results for all 4 ratings. Read `.card.due` from each to compute intervals.
- **Hard + mark for review:** The `markForReview()` call is fire-and-forget alongside the FSRS rating. Uses existing `dayResetHourAtom` for dedup.
- **Existing FSRS cards:** Cards already in state 1 or 3 with `learning_steps = 0` will behave as if on step 0 of the new step config. No migration needed.

## Success Metrics

- FSRS due count matches what Anki would show for the same card data
- Learning cards reappear at correct step intervals within a session
- Users can complete a full new-card → learning → review lifecycle without confusion
- No regression in Simple SRS behavior

## Open Questions

- Should the countdown/waiting screen show a summary of today's session stats while waiting?
- When all review cards are done but learning cards are pending (e.g. 8 minutes away), should we offer "Study New Cards" as an option while waiting?
- Should Hard auto-mark be opt-out (setting to disable)?
