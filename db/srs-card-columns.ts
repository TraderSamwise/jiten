/**
 * The columns a queued SRS card is read with, aliased to `SrsCardRow`.
 *
 * Shared so a test can hydrate a row exactly as the study screen does. The
 * lapse fix turns on `simple_relearning` surviving this list: drop the alias
 * and `card.simpleRelearning` is `undefined`, the halving never fires, and
 * every unit test still passes.
 */
export const SRS_CARD_SELECT = `SELECT id, entry_id as entryId, kanji_literal as kanjiLiteral, list_id as listId, due,
    stability, difficulty, elapsed_days as elapsedDays,
    scheduled_days as scheduledDays, reps, lapses, state,
    last_review as lastReview, front_mode as frontMode,
    back_mode as backMode, created_at as createdAt,
    updated_at as updatedAt,
    simple_stage as simpleStage, simple_n as simpleN,
    simple_interval as simpleInterval,
    simple_relearning as simpleRelearning,
    simple_run as simpleRun,
    last_confusion_check as lastConfusionCheck,
    learning_steps as learningSteps`;
