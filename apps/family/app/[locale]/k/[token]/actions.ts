"use server";
/** Public donation action (no account): rate-limited per visitor, Zod-validated, re-checked in @repo/deeds/donate. */
import { headers } from "next/headers";
import { z } from "zod";
import { startDonation, type DonationStart } from "@repo/deeds/donate";
import { publicLimit, tipAmountCents } from "@repo/deeds/public";
import { localizePath } from "@repo/i18n/paths";
import { echoAmount, type AmountEcho } from "../../../../lib/amount-echo";
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";

export type DonateState = ({ status: "idle" } | DonationStart | { ok: false; error: "rateLimited" | "invalid" }) & AmountEcho;

const schema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  amount: z.string().max(10),
  other: z.string().max(10).optional().default(""),
  locale: z.enum(LOCALES).catch(DEFAULT_LOCALE),
});

export async function donateAction(_prev: DonateState, fd: FormData): Promise<DonateState> {
  const echo = echoAmount(fd); // lets the form remount with what was typed (see amount-echo.ts)
  if (!(await publicLimit(await headers(), "donate", 10))) return { ok: false, error: "rateLimited", ...echo };
  const parsed = schema.safeParse(Object.fromEntries([...fd].filter(([k, v]) => typeof v === "string" && !k.startsWith("$"))));
  if (!parsed.success) return { ok: false, error: "invalid", ...echo };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const { token, amount, other, locale } = parsed.data;
  return { ...(await startDonation(token, tipAmountCents(amount, other), origin, (p) => localizePath(p, locale))), ...echo };
}
