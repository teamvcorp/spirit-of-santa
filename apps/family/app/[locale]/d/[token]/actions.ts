"use server";
/**
 * Public QR-page actions (no account). Each is rate-limited per visitor and re-checks the code
 * (exists, unused, unexpired, registered kid, season) in @repo/deeds/public.
 */
import { headers } from "next/headers";
import { publicLimit, startTip, thankDeed, tipAmountCents, type TipStart } from "@repo/deeds/public";
import { localizePath } from "@repo/i18n/paths";
import { formString } from "@repo/lib/form";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";

export type ThankState = { status: "idle" | "done" | "error"; error?: string };
export type TipState = { status: "idle" } | TipStart | { ok: false; error: "rateLimited" };

export async function thankAction(_prev: ThankState, fd: FormData): Promise<ThankState> {
  if (!(await publicLimit(await headers(), "act", 30))) return { status: "error", error: "rateLimited" };
  const r = await thankDeed(formString(fd, "token"));
  return r.ok ? { status: "done" } : { status: "error", error: r.error };
}

export async function tipAction(_prev: TipState, fd: FormData): Promise<TipState> {
  if (!(await publicLimit(await headers(), "tip", 10))) return { ok: false, error: "rateLimited" };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const raw = fd.get("locale");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const amount = tipAmountCents(formString(fd, "amount"), formString(fd, "other"));
  return startTip(formString(fd, "token"), amount, origin, (p) => localizePath(p, locale));
}
