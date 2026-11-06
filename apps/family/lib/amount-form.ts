/**
 * Shared server pieces for the tip (/d) and donation (/k) amount forms. Plain module (not
 * "use client"/"use server") so both actions can import it.
 *
 * Echo: after a form action finishes, React 19 RESETS the form (radios back to their default,
 * text boxes emptied). If the picker kept its own "which radio" state, screen and state would
 * drift apart (an empty, required "Other" box silently blocked the next submit). So every result
 * carries the submitted values + a fresh `nonce`; the form is keyed by it and remounts with those
 * values as DEFAULTS, so a reset restores exactly what the visitor typed.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";

/** A public QR/link token (base64url HMAC, 43 chars). */
export const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Amount form fields; the amount itself is re-checked by tipAmountCents (presets / min / max). */
export const amountFormSchema = z.object({
  token: publicTokenSchema,
  amount: z.string().max(10),
  other: z.string().max(10).optional().default(""),
  locale: z.enum(LOCALES).catch(DEFAULT_LOCALE),
});

/** FormData → plain object of string fields (drops files and React's internal "$ACTION_…" keys). */
export const formFields = (fd: FormData) => Object.fromEntries([...fd].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")));

export type AmountEcho = { values?: { amount: string; other: string }; nonce?: string };

const field = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.slice(0, 10) : ""; // same 10-char cap as the schema
};

export function echoAmount(fd: FormData): Required<AmountEcho> {
  return { values: { amount: field(fd, "amount"), other: field(fd, "other") }, nonce: randomUUID() };
}
