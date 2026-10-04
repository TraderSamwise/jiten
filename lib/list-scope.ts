import { lessonListId } from "./rtk-graduate";
import { RTK_LESSON_COUNT } from "./rtk-course";

/**
 * Which lists a study session draws its cards from.
 *
 * A session used to mean exactly one list, which is why reviewing RTK meant
 * opening 56 of them in turn. A scope lets one session cover a set of lists
 * while the cards stay where they are — the alternative, copying them into a
 * derived list the way `lib/smart-review.ts` does, would give 2,200 frames two
 * FSRS schedules each.
 */

export interface ListScope {
  /**
   * A literal, never built from a list id — ids are always bound as `args`.
   * Typed as a closed union so no caller can interpolate one in later.
   */
  readonly clause: "list_id = ?" | `list_id IN (${string})`;
  readonly args: readonly string[];
  /** More than one list, so anything that writes back to "the list" is wrong. */
  readonly multi: boolean;
}

export function singleList(id: string): ListScope {
  return { clause: "list_id = ?", args: [id], multi: false };
}

/**
 * An exact set rather than a name pattern. A LIKE prefix looked simpler and was
 * worse: it sweeps up the list whose id IS the prefix, it is
 * ASCII-case-insensitive (so a restored `default-RTK-lesson-5` matches), and a
 * case-insensitive LIKE cannot use the index on `srs_cards.list_id`. A pattern
 * containing `_` has a fourth problem — it is a single-character wildcard —
 * which does not bite this prefix but would bite the next one.
 */
export function listSet(ids: readonly string[]): ListScope {
  if (ids.length === 0) throw new Error("a list scope needs at least one list");
  if (ids.length === 1) return singleList(ids[0]);
  const placeholders = ids.map(() => "?").join(", ");
  return { clause: `list_id IN (${placeholders})`, args: [...ids], multi: true };
}

/** The 56 lists the course graduates its frames into. */
export function rtkLessonListIds(): string[] {
  return Array.from({ length: RTK_LESSON_COUNT }, (_, i) => lessonListId(i + 1));
}

export function rtkReviewScope(): ListScope {
  return listSet(rtkLessonListIds());
}
