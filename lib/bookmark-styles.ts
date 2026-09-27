// Shared bookmark line highlight for dictionary/kanji surfaces.
// GlossGroupCard intentionally has additional local token logic because its
// English-grouped search chips need different conditional rendering.
export const BOOKMARK_HIGHLIGHT_CLASS = "self-start rounded px-1 py-0.5";

/**
 * Same highlight, full width. `self-start` makes the box shrink to its content,
 * and Yoga measures a flex-wrap child of a shrink-to-fit box at its one-line
 * width — so when the row does wrap at the real width, the second line paints
 * outside the already-fixed height and lands on whatever is below. That is the
 * JLPT chip sitting on top of the reading or the gloss. Use this wherever the
 * highlighted box contains a wrapping row; WordDetail already does.
 */
export const BOOKMARK_HIGHLIGHT_BLOCK_CLASS = "w-full rounded px-1 py-0.5";

export const BOOKMARK_HIGHLIGHT_STYLE = {
  backgroundColor: "rgba(180, 170, 98, 0.28)",
};
