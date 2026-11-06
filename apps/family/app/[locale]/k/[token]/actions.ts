"use server";
/** Public donation action (no account): rate-limited per visitor, Zod-validated, re-checked in @repo/deeds/donate. */
import { headers } from "next/headers";
import { startDonation, type DonationStart } from "@repo/deeds/donate";
import { publicLimit, tipAmountCents } from "@repo/deeds/public";
import { localizePath } from "@repo/i18n/paths";
import { amountFormSchema, echoAmount, formFields, type AmountEcho } from "../../../../lib/amount-form";

export type DonateState = ({ status: "idle" } | DonationStart | { ok: false; error: "rateLimited" | "invalid" }) & AmountEcho;

export async function donateAction(_prev: DonateState, fd: FormData): Promise<DonateState> {
  const echo = echoAmount(fd); // lets the form remount with what was typed (see lib/amount-form.ts)
  if (!(await publicLimit(await headers(), "donate", 10))) return { ok: false, error: "rateLimited", ...echo };
  const parsed = amountFormSchema.safeParse(formFields(fd));
  if (!parsed.success) return { ok: false, error: "invalid", ...echo };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const { token, amount, other, locale } = parsed.data;
  return { ...(await startDonation(token, tipAmountCents(amount, other), origin, (p) => localizePath(p, locale))), ...echo };
}
