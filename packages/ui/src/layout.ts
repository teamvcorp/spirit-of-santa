/**
 * Shared layout class strings (Phase 8.5.4). Plain strings, not components, because the fields inside
 * belong to each app's form (labels, errors, names).
 *
 * Teaching note — why "minmax(0, …)": a grid column written as "1fr" means minmax(auto, 1fr), and
 * "auto" lets the column refuse to shrink below its content's minimum width. A text <input> has a
 * built-in minimum (about 20 characters), so three inputs in one row forced the form wider than its
 * card and the fields slid under the next card. minmax(0, 1fr) lets the column shrink; the input's
 * w-full then fits it. Tailwind's numbered grid-cols-N already does this, custom [..] tracks do not.
 */

/**
 * City / State / ZIP on one row from the sm breakpoint; stacked on phones.
 * items-end: a label that wraps ("State (2 letters)" in a narrow column) would otherwise push its box
 * lower than its neighbours; aligning the bottoms keeps the three boxes level.
 */
export const CITY_STATE_ZIP_ROW = "grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-end";
