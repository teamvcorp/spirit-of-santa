"use server";
/**
 * Public community-donation action (no account): rate-limited per visitor, Zod-validated; the
 * amount, ZIP and season window are re-checked in @repo/payments/community (and by the webhook).
 */
import { headers } from "next/headers";
import { z } from "zod";
import { publicLimit } from "@repo/deeds/public";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";
import { donationAmountCents, startCommunityDonation, type CommunityStart } from "@repo/payments/community";
import { getPlatformSettings } from "@repo/payments/settings";
import { echoAmount, formFields, type AmountEcho } from "../../../lib/amount-form";

/** scope + zip are echoed with the amount so the form remounts with what was typed. */
export type CommunityState = ({ status: "idle" } | CommunityStart | { ok: false; error: "rateLimited" | "invalid" }) &
  AmountEcho & { scope?: string; zip?: string };

const schema = z.object({
  scope: z.enum(["all", "zip"]),
  zip: z.string().max(10).optional().default(""),
  amount: z.string().max(10),
  other: z.string().max(10).optional().default(""),
  locale: z.enum(LOCALES).catch(DEFAULT_LOCALE),
});

export async function communityDonateAction(_prev: CommunityState, fd: FormData): Promise<CommunityState> {
  const raw = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).slice(0, 10) : "");
  const echo = { ...echoAmount(fd), scope: raw("scope"), zip: raw("zip") };
  if (!(await publicLimit(await headers(), "community", 10))) return { ok: false, error: "rateLimited", ...echo };
  const parsed = schema.safeParse(formFields(fd));
  if (!parsed.success) return { ok: false, error: "invalid", ...echo };
  const { scope, zip, amount, other, locale } = parsed.data;
  // The fee must be stated on the page before anyone gives (user decision): no fee set → closed.
  if ((await getPlatformSettings()).donationFeeBps === null) return { ok: false, error: "closed", ...echo };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const r = await startCommunityDonation(
    { zip: scope === "zip" ? zip.trim() : null, amountCents: donationAmountCents(amount, other), locale },
    origin,
    (p) => localizePath(p, locale),
  );
  return { ...r, ...echo };
}
