# Sync Redesign

## Current Contract

- Live cloud sync is for canonical user state.
- Raw high-volume history stays local and is covered by backup/export.
- The app remains offline-first.

## Live-Synced Tables

- `lists`
- `list_entries`
- `srs_cards`
- `books`
- `user_kanji_notes`
- `confusion_pairs`
- `practice_sessions`

## Local-Only History Tables

- `review_logs`
- `practice_events`
- `confusion_events`
- `game_scores`

These tables are intentionally excluded from live cloud sync to avoid row-per-action write amplification.

## Cursor Model

- `last_pulled_at` tracks remote-to-local deltas.
- `last_pushed_at` tracks local-to-remote deltas.
- `last_sync_completed_at` is only for sync cadence and UI state.
- `last_seen_push_version` is only a pull-skip hint.

The old single-cursor model is removed.

## Reader Progress

- Reader scroll progress is coalesced locally before writing.
- Progress updates are flushed on a timer, on completion, and on unmount/background.

## Backup / Restore

Backup now includes the local-only history data needed to preserve the reduced-cloud model:

- `practice_events`
- `confusion_pairs`
- `confusion_events`
- existing `review_logs`, `practice_sessions`, and `game_scores`

## Follow-Up

- Add per-table sync counters to the settings debug block or sync logs if write-volume debugging is needed again.
- Decide whether `practice_sessions` should remain live-synced or also move to local-plus-backup.
