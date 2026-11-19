"use server";
/**
 * Public community-donation action (no account): rate-limited per visitor, Zod-validated; the
 * amount, ZIP and season window are re-checked in @repo/payments/community. The webhook re-checks
 * the AMOUNT only: money already charged is never refused; a gift landing after the freeze goes
 * into the next split run (slice 2b).
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
  AmountEcho & { scope?: string; zip?: string; ack?: boolean };

const schema = z.object({
  scope: z.enum(["all", "zip"]),
  zip: z.string().max(10).optional().default(""),
  amount: z.string().max(10),
  other: z.string().max(10).optional().default(""),
  locale: z.enum(LOCALES).catch(DEFAULT_LOCALE),
  news: z.literal("on").optional().catch(undefined), // "keep me posted" box
  // The donor acknowledgment (owner 2026-11-18). REQUIRED: the browser disables the button until it is ticked,
  // but that is only a convenience; this is the real check (a missing box → the "ack" error, nothing charged).
  ack: z.literal("on").optional().catch(undefined),
  // A store's single-use gift link token (?store=), passed through the form. Only checked on the server.
  store: z.string().max(100).optional().catch(undefined),
});

export async function communityDonateAction(_prev: CommunityState, fd: FormData): Promise<CommunityState> {
  const raw = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).slice(0, 10) : "");
  const echo = { ...echoAmount(fd), scope: raw("scope"), zip: raw("zip"), ack: raw("ack") === "on" };
  if (!(await publicLimit(await headers(), "community", 10))) return { ok: false, error: "rateLimited", ...echo };
  const parsed = schema.safeParse(formFields(fd));
  if (!parsed.success) return { ok: false, error: "invalid", ...echo };
  const { scope, zip, amount, other, locale, news, ack, store } = parsed.data;
  // The fee must be stated on the page before anyone gives (user decision): no fee set → closed. The
  // acknowledgment names the charity, so no charity name → closed too (it could not be shown correctly).
  const settings = await getPlatformSettings();
  if (settings.donationFeeBps === null || settings.charity.legalName === "") return { ok: false, error: "closed", ...echo };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const r = await startCommunityDonation(
    { zip: scope === "zip" ? zip.trim() : null, amountCents: donationAmountCents(amount, other, !!store), locale, news: news === "on", ack: ack === "on", ...(store ? { storeToken: store } : {}) },
    origin,
    (p) => localizePath(p, locale),
  );
  return { ...r, ...echo };
}
