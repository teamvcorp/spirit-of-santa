"use server";
/**
 * Public QR-page actions (no account). Each is rate-limited per visitor, validates its form with
 * Zod, and re-checks the code (exists, unused, unexpired, registered kid, season) in
 * @repo/deeds/public.
 */
import { headers } from "next/headers";
import { z } from "zod";
import { publicLimit, startTip, thankDeed, tipAmountCents, type TipStart } from "@repo/deeds/public";
import { startPayLater, type PayLaterError } from "@repo/deeds/pay-later";
import { localizePath } from "@repo/i18n/paths";
import { THANK_NOTES } from "@repo/lib/thank-notes";
import { amountFormSchema, echoAmount, formFields, publicTokenSchema, type AmountEcho } from "../../../../lib/amount-form";

export type ThankState = { status: "idle" | "done" | "error"; error?: string };
export type TipState = ({ status: "idle" } | TipStart | { ok: false; error: "rateLimited" | "invalid" }) & AmountEcho;

// note: optional ready-made thank-you note KEY (never free text; @repo/lib/thank-notes). "" = no note.
const thankSchema = z.object({ token: publicTokenSchema, note: z.enum(THANK_NOTES).optional().or(z.literal("").transform(() => undefined)) });

export async function thankAction(_prev: ThankState, fd: FormData): Promise<ThankState> {
  if (!(await publicLimit(await headers(), "act", 30))) return { status: "error", error: "rateLimited" };
  const parsed = thankSchema.safeParse(formFields(fd));
  if (!parsed.success) return { status: "error", error: "invalid" };
  const r = await thankDeed(parsed.data.token, parsed.data.note);
  return r.ok ? { status: "done" } : { status: "error", error: r.error };
}

export async function tipAction(_prev: TipState, fd: FormData): Promise<TipState> {
  const echo = echoAmount(fd); // lets the form remount with what was typed (see lib/amount-form.ts)
  if (!(await publicLimit(await headers(), "tip", 10))) return { ok: false, error: "rateLimited", ...echo };
  const parsed = amountFormSchema.safeParse(formFields(fd));
  if (!parsed.success) return { ok: false, error: "invalid", ...echo };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const { locale } = parsed.data;
  return { ...(await startTip(parsed.data.token, tipAmountCents(parsed.data.amount, parsed.data.other), origin, (p) => localizePath(p, locale))), ...echo };
}

/** Pay later by text (Phase 5 slice 4b; registered flow, see @repo/deeds/pay-later). */
export type PayLaterState = ({ status: "idle" } | { ok: true; masked: string; expiresAt: string } | { ok: false; error: PayLaterError | "rateLimited" | "invalid" }) &
  AmountEcho & { phone?: string };

const payLaterSchema = amountFormSchema.extend({ phone: z.string().max(25), consent: z.enum(["yes"]).optional() });

export async function payLaterAction(_prev: PayLaterState, fd: FormData): Promise<PayLaterState> {
  const phoneRaw = fd.get("phone");
  const echo = { ...echoAmount(fd), phone: typeof phoneRaw === "string" ? phoneRaw.slice(0, 25) : "" };
  // 5 requests per 15 min per visitor (plus 1 per deed and 3 per number per day in the service).
  if (!(await publicLimit(await headers(), "paylater", 5))) return { ok: false, error: "rateLimited", ...echo };
  const parsed = payLaterSchema.safeParse(formFields(fd));
  if (!parsed.success) return { ok: false, error: "invalid", ...echo };
  const { token, amount, other, locale, phone, consent } = parsed.data;
  const r = await startPayLater(token, { phone, consent: consent === "yes", amountCents: tipAmountCents(amount, other), locale });
  return r.ok ? { ok: true, masked: r.masked, expiresAt: r.expiresAt.toISOString(), ...echo } : { ...r, ...echo };
}
