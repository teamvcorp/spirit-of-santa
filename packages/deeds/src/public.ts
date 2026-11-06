/**
 * The PUBLIC deed page behind a QR code (/d/<token>, family app). SERVER-ONLY. No account needed.
 *
 * What a stranger can learn (Phase 4 decisions): the deed (catalog title, or "Other" text ONLY
 * if an admin approved it), the kid's DISPLAY NAME and the family alias if the parent switched it
 * on. Never a first name, age, town or anything else.
 * Rules: code must exist (hash lookup), be unused, unexpired, the kid registered, the season open
 * or frozen. "Thank you" confirms the deed (single use, atomic). Tips use Stripe Embedded
 * Checkout; the existing webhook credits points ($1.50 = 1 point) and marks the deed paid.
 */
import "server-only";
import { hitRateLimit } from "@repo/auth/rate-limit";
import { clientIp, ipKey } from "@repo/auth/rate-limit";
import { connectDb, Deed, DeedType, Family, Kid, Payment, trusted } from "@repo/db";
import { parseDollarsToCents } from "@repo/lib/format";
import { MAX_TIP_CENTS, MIN_TIP_CENTS, TIP_PRESETS_CENTS } from "@repo/lib/limits";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { getSeasonState } from "@repo/stores/season";
import { localized } from "./catalog.ts";
import { hashDeedToken, isDeedToken } from "./qr.ts";

export type PublicDeed =
  | { state: "invalid" }
  | { state: "used"; outcome?: string }
  | { state: "expired" }
  | { state: "open"; kidName: string; familyAlias?: string; deed?: string; seasonOpen: boolean };

type DeedLite = {
  _id: unknown;
  kidId: unknown;
  familyId: unknown;
  deedTypeId?: unknown;
  customDescription?: string | null;
  customReview?: string | null;
  status: string;
  outcome?: string | null;
  qrUsedAt?: Date | null;
  expiresAt?: Date | null;
};

/** Visitor-level limit on QR lookups/actions (tokens are unguessable; this just blunts scripts). */
export async function publicLimit(headers: Headers, scope: string, limit: number): Promise<boolean> {
  // This page is often the FIRST thing a fresh server instance runs: connect explicitly here
  // (nothing else has yet), or the query waits forever for a connection (found by E2E).
  await connectDb();
  return hitRateLimit(`qr-${scope}:${ipKey(clientIp(headers))}`, limit, 900);
}

async function findDeed(token: unknown): Promise<DeedLite | null> {
  if (!isDeedToken(token)) return null;
  await connectDb();
  return Deed.findOne({ qrTokenHash: hashDeedToken(token) })
    .select("kidId familyId deedTypeId customDescription customReview status outcome qrUsedAt expiresAt")
    .lean<DeedLite>();
}

/** What the public page shows for this token. `locale` = the visitor's language. */
export async function getPublicDeed(token: unknown, locale: string): Promise<PublicDeed> {
  const d = await findDeed(token);
  if (!d) return { state: "invalid" };
  if (d.status === "confirmed" || d.qrUsedAt) return { state: "used", outcome: d.outcome ?? undefined };
  if (d.status !== "pending") return { state: "invalid" };
  if (d.expiresAt && new Date(d.expiresAt).getTime() <= Date.now()) return { state: "expired" };
  const [kid, fam, type, season] = await Promise.all([
    Kid.findOne({ _id: String(d.kidId), familyId: String(d.familyId), archivedAt: null })
      .select("displayName registration.status")
      .lean<{ displayName: string; registration?: { status?: string | null } | null }>(),
    Family.findById(d.familyId).select("alias showAliasPublicly").lean(),
    d.deedTypeId ? DeedType.findById(d.deedTypeId).select("title").lean() : null,
    getSeasonState(),
  ]);
  // Only registered kids (consent verified) ever appear publicly.
  if (!kid || kid.registration?.status !== "registered") return { state: "invalid" };
  const deed = type ? localized(type.title ?? undefined, locale) : d.customReview === "approved" ? (d.customDescription ?? undefined) : undefined;
  return {
    state: "open",
    kidName: kid.displayName,
    familyAlias: fam?.showAliasPublicly && fam.alias ? fam.alias : undefined,
    deed,
    seasonOpen: season.phase === "open" || season.phase === "frozen",
  };
}

export type ThankResult = { ok: true } | { ok: false; error: "invalid" | "used" | "expired" | "seasonClosed" };

/** "Say thank you": confirm the deed (no money, no points). Single use: one atomic update. */
export async function thankDeed(token: unknown): Promise<ThankResult> {
  const view = await getPublicDeed(token, "en");
  if (view.state !== "open") return { ok: false, error: view.state === "used" ? "used" : view.state === "expired" ? "expired" : "invalid" };
  if (!view.seasonOpen) return { ok: false, error: "seasonClosed" };
  const now = new Date();
  const res = await Deed.updateOne(
    { qrTokenHash: hashDeedToken(token as string), status: "pending", qrUsedAt: null, expiresAt: trusted({ $gt: now }) },
    { $set: { status: "confirmed", outcome: "thanked", qrUsedAt: now, confirmedAt: now } },
  );
  return res.modifiedCount === 1 ? { ok: true } : { ok: false, error: "used" };
}

/** Tip amount from the form: a preset ("500") or "other" + dollars ("12.50"). Server-side bounds. */
export function tipAmountCents(choice: string, otherDollars: string): number | null {
  if (choice === "other") {
    const c = parseDollarsToCents(otherDollars.trim());
    return c != null && c >= MIN_TIP_CENTS && c <= MAX_TIP_CENTS ? c : null;
  }
  const preset = Number(choice);
  return (TIP_PRESETS_CENTS as readonly number[]).includes(preset) ? preset : null;
}

export type TipStart = { ok: true; clientSecret: string; amountCents: number } | { ok: false; error: "invalid" | "used" | "expired" | "seasonClosed" | "amount" | "stripe" };

/**
 * Start a tip: Embedded Checkout for the chosen amount. The QR is NOT used up here (an abandoned
 * checkout mustn't burn the code); the webhook confirms the deed when the money arrives.
 */
export async function startTip(token: unknown, amountCents: number | null, origin: string, localePath: (p: string) => string): Promise<TipStart> {
  if (amountCents == null) return { ok: false, error: "amount" };
  const d = await findDeed(token);
  const view = await getPublicDeed(token, "en");
  if (!d || view.state !== "open") return { ok: false, error: view.state === "used" ? "used" : view.state === "expired" ? "expired" : "invalid" };
  if (!view.seasonOpen) return { ok: false, error: "seasonClosed" };
  const metadata = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: String(d.kidId), sos_family_id: String(d.familyId), sos_deed_id: String(d._id) });
  try {
    const session = await getStripe().checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      submit_type: "donate",
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: `Thank-you tip for ${view.kidName}` } } }],
      metadata,
      payment_intent_data: { metadata },
      return_url: new URL(localePath(`/d/${token as string}/thanks`), origin).toString() + "?session_id={CHECKOUT_SESSION_ID}",
    });
    return session.client_secret ? { ok: true, clientSecret: session.client_secret, amountCents } : { ok: false, error: "stripe" };
  } catch (err) {
    console.error("[tip] checkout session failed:", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "stripe" };
  }
}

/** After paying: "credited" (points added), "processing" (webhook pending), "review", "open", or null. */
export async function tipStatus(token: unknown, sessionId: string): Promise<"credited" | "processing" | "review" | "open" | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return null;
  const d = await findDeed(token);
  if (!d) return null;
  try {
    const s = await getStripe().checkout.sessions.retrieve(sessionId);
    if (s.metadata?.sos_purpose !== "tip" || s.metadata?.sos_deed_id !== String(d._id)) return null;
    if (s.status === "open") return "open";
    if (s.status !== "complete") return null;
    const piId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
    const pay = piId ? await Payment.findOne({ stripePaymentIntentId: piId }).select("fulfilment").lean() : null;
    if (!pay) return "processing";
    return pay.fulfilment === "credited" ? "credited" : "review";
  } catch {
    return null;
  }
}
