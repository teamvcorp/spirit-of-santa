/**
 * Kid form validation (family app parent area). CLIENT-SAFE (zod only).
 * COPPA (user decision 2026-11-05): first name + birth year; the display name is the ONLY thing
 * public pages show. Blank display name = first initial ("Maya" -> "M.").
 */
import { z } from "zod";
import { MAX_KID_AGE_YEARS } from "@repo/lib/limits";

/** Under 18 this calendar year. `now` is injectable for tests. */
export function birthYearRange(now = new Date()) {
  const y = now.getUTCFullYear();
  return { min: y - MAX_KID_AGE_YEARS, max: y };
}

/** "Maya" -> "M." (first letter, upper-cased; works for accented letters). */
export function defaultDisplayName(firstName: string): string {
  const first = [...firstName.trim()][0];
  return first ? `${first.toLocaleUpperCase()}.` : "";
}

export function kidSchema(now = new Date()) {
  const { min, max } = birthYearRange(now);
  return z
    .object({
      firstName: z.string().trim().min(1, "required").max(40, "tooLong"),
      birthYear: z.coerce.number("invalid").int("invalid").min(min, "invalidYear").max(max, "invalidYear"),
      displayName: z.string().trim().max(20, "tooLong"),
    })
    .transform((v) => ({ ...v, displayName: v.displayName || defaultDisplayName(v.firstName) }));
}
export type KidInput = z.infer<ReturnType<typeof kidSchema>>;
