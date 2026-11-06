/**
 * Kid form validation (family app parent area). CLIENT-SAFE (zod only).
 * COPPA (user decision 2026-11-05): first name + birth year; the display name is the ONLY thing
 * public pages show. Blank display name = first initial ("Maya" -> "M.").
 */
import { z } from "zod";
import { KID_VOTES } from "@repo/lib/family";
import { MAX_KID_AGE_YEARS } from "@repo/lib/limits";
import { getSeasonYear } from "@repo/lib/season";

/** Family nickname for public QR pages ("From the {alias} family"). Blank = none. */
export const familyAliasSchema = z.object({
  alias: z.string().trim().max(40, "tooLong"),
  show: z.enum(["on", "off"]),
});

/** Today's Naughty/Nice vote form. */
export const voteSchema = z.object({ kidId: z.string().min(1).max(40), vote: z.enum(KID_VOTES) });

/**
 * Allowed birth years for someone under 18 THIS year (in the season time zone, not UTC, so the
 * range doesn't change at 6 pm on Dec 31 in Iowa). A 17-year-old can be born in year - 18 (birthday
 * still to come), hence the extra year (review 2026-11-05). `now` is injectable for tests.
 */
export function birthYearRange(now = new Date()) {
  const y = getSeasonYear(now);
  return { min: y - MAX_KID_AGE_YEARS - 1, max: y };
}

/** "Maya" -> "M." (first letter, upper-cased; works for accented letters). */
export function defaultDisplayName(firstName: string): string {
  const first = [...firstName.trim()][0];
  return first ? `${first.toLocaleUpperCase()}.` : "";
}

/**
 * `keepYear`: the kid's CURRENT birth year when editing: always accepted, so a child who has
 * just turned 18 (or after Jan 1) can still have their display name edited or be deleted.
 */
export function kidSchema(now = new Date(), keepYear?: number) {
  const { min, max } = birthYearRange(now);
  return z
    .object({
      firstName: z.string().trim().min(1, "required").max(40, "tooLong"),
      birthYear: z.coerce
        .number("invalid")
        .int("invalid")
        .refine((y) => y === keepYear || (y >= min && y <= max), "invalidYear"),
      displayName: z.string().trim().max(20, "tooLong"),
      /** Max items on this child's wish list (enforced when wish lists arrive, Phase 6). */
      // Blank / missing → 5 (z.coerce would turn "" into 0: a silent "no items allowed").
      itemCap: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number("invalid").int("invalid").min(0, "invalidCap").max(50, "invalidCap").default(5)),
    })
    .transform((v) => ({ ...v, displayName: v.displayName || defaultDisplayName(v.firstName) }));
}
export type KidInput = z.infer<ReturnType<typeof kidSchema>>;
