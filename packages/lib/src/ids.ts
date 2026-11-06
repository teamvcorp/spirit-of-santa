/**
 * Database id helpers. CLIENT-SAFE.
 *
 * MongoDB ObjectIds are 24 hex characters. The database treats "6A1B…" and "6a1b…" as the SAME
 * id, so any code that COMPARES ids as text (e.g. "is this my own account?") must compare the
 * normalised form: an upper-case copy of your own id once slipped past such a check
 * (review 2026-11-05). Normalise every id that comes from a request with this.
 */
export const OBJECT_ID_RE = /^[0-9a-f]{24}$/;

/** Lower-case, trimmed ObjectId string, or null if it isn't one. */
export function normalizeObjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  return OBJECT_ID_RE.test(s) ? s : null;
}
