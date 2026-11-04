/**
 * Money ↔ points conversion constants. SERVER-ONLY.
 *
 * `import "server-only"` makes the Next build FAIL if any Client Component imports this
 * file (directly or transitively). That's how we enforce CLAUDE.md's rule: the browser
 * never computes points, so a tampered client can't award itself extra points.
 *
 * Units used across the codebase (all plain integers, never floats):
 *   cents        – USD cents. $1.50 → 150. Floats can't represent 1.50 + 0.10 exactly.
 *   centipoints  – hundredths of a magic point. 1 point → 100. Lets a $5 tip be worth
 *                  exactly 3.33 points instead of rounding every tip down to 3.
 */
import "server-only";

/** Tips buy points at this rate (product rule). Kept for docs/readability. */
export const DOLLARS_PER_POINT = 1.5;

/** Same rate in integer cents. Use THIS in math, never DOLLARS_PER_POINT. */
export const CENTS_PER_POINT = 150;

/** Sub-units per point (centipoints). */
export const CENTIPOINTS_PER_POINT = 100;
