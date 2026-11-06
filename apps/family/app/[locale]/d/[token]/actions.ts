"use server";
/**
 * Public QR-page actions (no account). Each is rate-limited per visitor, validates its form with
 * Zod, and re-checks the code (exists, unused, unexpired, registered kid, season) in
 * @repo/deeds/public.
 */
import { headers } from "next/headers";
import { z } from "zod";
import { publicLimit, startTip, thankDeed, tipAmountCents, type TipStart } from "@repo/deeds/public";
import { localizePath } from "@repo/i18n/paths";
import { amountFormSchema, echoAmount, formFields, publicTokenSchema, type AmountEcho } from "../../../../lib/amount-form";

export type ThankState = { status: "idle" | "done" | "error"; error?: string };
export type TipState = ({ status: "idle" } | TipStart | { ok: false; error: "rateLimited" | "invalid" }) & AmountEcho;

const thankSchema = z.object({ token: publicTokenSchema });

export async function thankAction(_prev: ThankState, fd: FormData): Promise<ThankState> {
  if (!(await publicLimit(await headers(), "act", 30))) return { status: "error", error: "rateLimited" };
  const parsed = thankSchema.safeParse(formFields(fd));
  if (!parsed.success) return { status: "error", error: "invalid" };
  const r = await thankDeed(parsed.data.token);
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
