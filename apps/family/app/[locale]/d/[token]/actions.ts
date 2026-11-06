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
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";

export type ThankState = { status: "idle" | "done" | "error"; error?: string };
export type TipState = { status: "idle" } | TipStart | { ok: false; error: "rateLimited" | "invalid" };

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const thankSchema = z.object({ token });
const tipSchema = z.object({
  token,
  amount: z.string().max(10),
  other: z.string().max(10).optional().default(""),
  locale: z.enum(LOCALES).catch(DEFAULT_LOCALE),
});
const fields = (fd: FormData) => Object.fromEntries([...fd].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")));

export async function thankAction(_prev: ThankState, fd: FormData): Promise<ThankState> {
  if (!(await publicLimit(await headers(), "act", 30))) return { status: "error", error: "rateLimited" };
  const parsed = thankSchema.safeParse(fields(fd));
  if (!parsed.success) return { status: "error", error: "invalid" };
  const r = await thankDeed(parsed.data.token);
  return r.ok ? { status: "done" } : { status: "error", error: r.error };
}

export async function tipAction(_prev: TipState, fd: FormData): Promise<TipState> {
  if (!(await publicLimit(await headers(), "tip", 10))) return { ok: false, error: "rateLimited" };
  const parsed = tipSchema.safeParse(fields(fd));
  if (!parsed.success) return { ok: false, error: "invalid" };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const { locale } = parsed.data;
  return startTip(parsed.data.token, tipAmountCents(parsed.data.amount, parsed.data.other), origin, (p) => localizePath(p, locale));
}
