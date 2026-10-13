/**
 * The three queries that fill a simple-SRS session, in one place.
 *
 * They live here rather than inline in the study screen because the screen is
 * covered by no test: review proved that `newCap = UNLIMITED`, deleting the
 * learning `LIMIT`, and deleting `simple_run` from the persistence UPDATE each
 * left the whole suite green — the 8,000-card queue and the graduation fix both
 * fully revertable without a single failure. `db/simple-queue.test.ts` runs
 * THESE functions, so the SQL a session uses is the SQL a test gates.
 */

import { SRS_CARD_SELECT } from "./srs-card-columns";
import type { SrsCardRow } from "./types";
import { learningCapFor, UNLIMITED } from "@/stores/simple-srs";

/** Runs a parameterised query, the shape both `WrappedUserDb` and a test give. */
export type SimpleQueueQuerier = (sql: string, args: unknown[]) => Promise<SrsCardRow[]>;

/** The part of a `ListScope` these queries need. */
export interface SimpleQueueScope {
  clause: string;
  args: readonly unknown[];
}

export interface SimpleQueueRequest {
  query: SimpleQueueQuerier;
  scope: SimpleQueueScope;
  /** End of the logical day, in the epoch `simple_n` is stored in. */
  dueCutoffDays: number;
  /** Unseen cards this session may still introduce, or `UNLIMITED`. */
  newAllowance: number;
  /** Cards already answered in this session, which must not come back. */
  excludeIds?: ReadonlySet<string>;
}

export interface SimpleQueuePools {
  /** Cards in learning first, then graduated cards due today. */
  dueRows: SrsCardRow[];
  newRows: SrsCardRow[];
}

/** Graduated and due today. Never capped — this is the real review load. */
export const graduatedDueSql = (scopeClause: string) =>
  `${SRS_CARD_SELECT} FROM srs_cards
     WHERE ${scopeClause} AND simple_stage = 1 AND simple_n <= ? AND deleted_at IS NULL
     ORDER BY simple_n ASC`;

/**
 * Still in learning, capped. A deck left by the uncapped session has thousands
 * of these, every one due, which is the queue that came back unchanged every
 * day. Most recently answered first, so the cards already in hand get finished
 * before the backlog is reached.
 */
export const learningDueSql = (scopeClause: string) =>
  `${SRS_CARD_SELECT} FROM srs_cards
     WHERE ${scopeClause} AND simple_stage = 0 AND simple_n <= ? AND deleted_at IS NULL
     ORDER BY updated_at DESC, rowid ASC
     LIMIT ?`;

/** Never seen, capped at the list's `new_per_session`. */
export const unseenSql = (scopeClause: string) =>
  `${SRS_CARD_SELECT} FROM srs_cards
     WHERE ${scopeClause} AND simple_stage IS NULL AND deleted_at IS NULL
     ORDER BY created_at ASC, rowid ASC
     LIMIT ?`;

/**
 * A capped query cannot simply drop the excluded rows afterwards — the LIMIT
 * would have already spent its slots on them — so it asks for enough extra to
 * cover every exclusion and trims after filtering.
 */
function limitWith(cap: number, excluded: number): number {
  return cap === UNLIMITED ? UNLIMITED : cap + excluded;
}

function withoutExcluded(
  rows: SrsCardRow[],
  excludeIds: ReadonlySet<string> | undefined,
  cap: number,
): SrsCardRow[] {
  const kept = excludeIds?.size ? rows.filter((row) => !excludeIds.has(row.id)) : rows;
  return cap === UNLIMITED ? kept : kept.slice(0, cap);
}

/** Load the pools a simple-SRS session studies from. */
export async function loadSimpleQueuePools({
  query,
  scope,
  dueCutoffDays,
  newAllowance,
  excludeIds,
}: SimpleQueueRequest): Promise<SimpleQueuePools> {
  const excluded = excludeIds?.size ?? 0;
  const learningCap = learningCapFor(newAllowance);

  const graduated = await query(graduatedDueSql(scope.clause), [...scope.args, dueCutoffDays]);
  const learning = await query(learningDueSql(scope.clause), [
    ...scope.args,
    dueCutoffDays,
    limitWith(learningCap, excluded),
  ]);
  const unseen = await query(unseenSql(scope.clause), [
    ...scope.args,
    limitWith(newAllowance, excluded),
  ]);

  return {
    // Learning leads: a graduated load bigger than the learner's stamina would
    // otherwise mean nothing in learning or new ever advances.
    dueRows: [
      ...withoutExcluded(learning, excludeIds, learningCap),
      ...withoutExcluded(graduated, excludeIds, UNLIMITED),
    ],
    newRows: withoutExcluded(unseen, excludeIds, newAllowance),
  };
}
