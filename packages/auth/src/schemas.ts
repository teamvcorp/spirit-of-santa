/**
 * Input schemas (Next-free, unit-testable). Shared by Server Actions (the check that
 * counts) and forms (HTML attributes mirror these limits for quick feedback).
 *
 * Error messages are short CODES ("tooShort", "invalid"), not sentences: the form looks
 * them up in the user's language (Common.formErrors.<code>).
 */
import { z } from "zod";
import { US_STATES } from "@repo/lib/address";
import { STORE_CATEGORIES } from "@repo/lib/store";

/**
 * Must equal MAX_SECRET_LENGTH in password.ts (that file is server-only, this one isn't).
 * A unit test checks they match.
 */
export const MAX_PASSWORD_LENGTH = 256;
const MAX_PASSWORD = MAX_PASSWORD_LENGTH;

/** Parent PIN: 4–6 digits. Re-validated on the server for every attempt. */
export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, "PIN must be 4–6 digits");

/** NIST 800-63B: length over complexity rules. 10+ characters, any characters allowed. */
export const MIN_PASSWORD_LENGTH = 10;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "invalid")
  .pipe(z.email("invalid"));

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, "tooShort")
  .max(MAX_PASSWORD, "tooLong");

/**
 * Optional free text (e.g. a textarea). Browsers submit textarea line breaks as CRLF (2 chars)
 * while the field's maxLength counts them as 1, so normalise to LF before the length check:
 * otherwise text that fit in the box fails on the server (review finding 2026-11-05).
 */
const optionalText = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\r\n?/g, "\n"))
    .pipe(z.string().trim()
    .max(max, "tooLong"))
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/**
 * Store details shared by self-registration (/register) and the owner's profile editor
 * (/dashboard/profile): one set of rules, so both stay consistent.
 */
export const storeDetailsFields = {
  storeName: z.string().trim().min(2, "tooShort").max(120, "tooLong"),
  category: z.enum(STORE_CATEGORIES, "required"),
  description: optionalText(2000),
  phone: z
    .string()
    .trim()
    .max(30, "tooLong")
    .refine((v) => v === "" || /^[0-9+().\-\s]{7,30}$/.test(v), "invalid")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  website: z
    .string()
    .trim()
    .max(300, "tooLong")
    .refine((v) => v === "" || /^https:\/\/[^\s]+\.[^\s]+$/.test(v), "httpsOnly")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  line1: z.string().trim().min(1, "required").max(120, "tooLong"),
  city: z.string().trim().min(1, "required").max(60, "tooLong"),
  // Same list as the family delivery address: real US states only (the form offers exactly these).
  state: z.string().trim().toUpperCase().pipe(z.enum(US_STATES, "invalid")),
  zip: z.string().trim().regex(/^\d{5}$/, "invalid"),
};
export const storeDetailsSchema = z.object(storeDetailsFields);
export type StoreDetailsInput = z.infer<typeof storeDetailsSchema>;

/** Store self-registration form (store app /register). */
export const storeRegistrationSchema = z.object({
  ownerName: z.string().trim().min(1, "required").max(100, "tooLong"),
  email: emailSchema,
  password: newPasswordSchema,
  ...storeDetailsFields,
  agree: z.literal("on", "mustAgree"),
  /**
   * Honeypot: hidden from people, bots fill it in. Accepted here ON PURPOSE: the sign-up flow
   * sees it filled and fakes success, so a bot gets no signal that it was caught.
   */
  company_url: z.string().max(500).optional(),
});
export type StoreRegistrationInput = z.infer<typeof storeRegistrationSchema>;

/**
 * Parent sign-up (family app /register). Collects the minimum: the parent's name, email,
 * password, a PRIVATE family name and an optional ZIP (zip-targeted donations). Kids are added
 * after sign-in (first name + birth year only). `consent` must be ticked (COPPA record).
 */
export const parentRegistrationSchema = z.object({
  parentName: z.string().trim().min(1, "required").max(100, "tooLong"),
  email: emailSchema,
  password: newPasswordSchema,
  familyName: z.string().trim().min(1, "required").max(80, "tooLong"),
  zip: z.string().trim().regex(/^(\d{5})?$/, "invalid").optional(),
  consent: z.literal("on", "mustAgree"),
  /** Honeypot (see storeRegistrationSchema). */
  company_url: z.string().max(500).optional(),
});
export type ParentRegistrationInput = z.infer<typeof parentRegistrationSchema>;

/** Field → error code, for the form to translate. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    out[field] ??= issue.message.length <= 20 ? issue.message : "invalid";
  }
  return out;
}

/** Store app /accept-invite form (owner invited by an admin). */
export const acceptInviteSchema = z.object({
  token: z.string().max(100),
  ownerName: z.string().trim().min(1, "required").max(100, "tooLong"),
  password: newPasswordSchema,
  agree: z.literal("on", "mustAgree"),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
/** Store app /accept-rep-invite form (rep invited by a store owner). */
export const acceptRepInviteSchema = z.object({
  token: z.string().max(100),
  name: z.string().trim().min(1, "required").max(100, "tooLong"),
  password: newPasswordSchema,
});
export type AcceptRepInviteInput = z.infer<typeof acceptRepInviteSchema>;