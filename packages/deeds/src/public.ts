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
import { clientIp, hitRateLimit, ipKey } from "@repo/auth/rate-limit";
import { connectDb, Deed, DeedType, Family, Kid, trusted } from "@repo/db";
import { parseDollarsToCents } from "@repo/lib/format";
import { MAX_CHECKOUT_MS, MAX_TIP_CENTS, MIN_CHECKOUT_MS, MIN_TIP_CENTS, TIP_PRESETS_CENTS } from "@repo/lib/limits";
import { buildPaymentMetadata, checkoutReturnStatus, creditReturnState, getStripe } from "@repo/payments/checkout";
import { giftWindow } from "@repo/stores/season";
import { localized } from "./catalog.ts";
import { hashDeedToken, isDeedToken } from "./qr.ts";

export type PublicDeed =
  | { state: "invalid" }
  | { state: "used"; outcome?: string }
  | { state: "expired" }
  | { state: "open"; kidName: string; familyAlias?: string; deed?: string; seasonOpen: boolean; seasonCloseAt: Date };

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
  return hitRateLimit(`qr-${scope}:${ipKey(clientIp(headers))}`, limit, 900);
}

async function findDeed(token: unknown): Promise<DeedLite | null> {
  if (!isDeedToken(token)) return null;
  await connectDb();
  return Deed.findOne({ qrTokenHash: hashDeedToken(token) })
    .select("kidId familyId deedTypeId customDescription customReview status outcome qrUsedAt expiresAt")
    .lean<DeedLite>();
}

type View = { view: PublicDeed; deed: DeedLite | null };

/** One lookup → what the page shows + the deed (for actions). A missing expiry counts as expired. */
async function view(token: unknown, locale: string): Promise<View> {
  const d = await findDeed(token);
  if (!d) return { view: { state: "invalid" }, deed: null };
  if (d.status === "confirmed" || d.qrUsedAt) return { view: { state: "used", outcome: d.outcome ?? undefined }, deed: d };
  if (d.status !== "pending") return { view: { state: "invalid" }, deed: d };
  if (!d.expiresAt || new Date(d.expiresAt).getTime() <= Date.now()) return { view: { state: "expired" }, deed: d };
  const [kid, fam, type, season] = await Promise.all([
    Kid.findOne({ _id: String(d.kidId), familyId: String(d.familyId), archivedAt: null })
      .select("displayName registration.status")
      .lean<{ displayName: string; registration?: { status?: string | null } | null }>(),
    Family.findById(d.familyId).select("alias showAliasPublicly aliasReview").lean(),
    d.deedTypeId ? DeedType.findById(d.deedTypeId).select("title").lean() : null,
    publicSeason(),
  ]);
  // Only registered kids (consent verified) ever appear publicly.
  if (!kid || kid.registration?.status !== "registered") return { view: { state: "invalid" }, deed: d };
  const deed = type ? localized(type.title ?? undefined, locale) : d.customReview === "approved" ? (d.customDescription ?? undefined) : undefined;
  return {
    view: {
      state: "open",
      kidName: kid.displayName,
      familyAlias: publicFamilyAlias(fam),
      deed,
      ...season,
    },
    deed: d,
  };
}

/** What the public page shows for this token. `locale` = the visitor's language. */
export async function getPublicDeed(token: unknown, locale: string): Promise<PublicDeed> {
  return (await view(token, locale)).view;
}

export type ThankResult = { ok: true } | { ok: false; error: "invalid" | "used" | "expired" | "seasonClosed" };
const viewError = (v: PublicDeed) => (v.state === "used" ? "used" : v.state === "expired" ? "expired" : "invalid") as "used" | "expired" | "invalid";

/** "Say thank you": confirm the deed (no money, no points). Single use: one atomic update. */
export async function thankDeed(token: unknown): Promise<ThankResult> {
  const { view: v } = await view(token, "en");
  if (v.state !== "open") return { ok: false, error: viewError(v) };
  if (!v.seasonOpen) return { ok: false, error: "seasonClosed" };
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

/** Family nickname shown publicly ONLY when switched on AND approved by an admin (single source of truth). */
export function publicFamilyAlias(fam: { alias?: string | null; showAliasPublicly?: boolean | null; aliasReview?: string | null } | null): string | undefined {
  return fam?.showAliasPublicly && fam.alias && fam.aliasReview === "approved" ? fam.alias : undefined;
}

/** Public thanks/tips/donations run while the season is open or frozen; checkouts end by season close. */
export async function publicSeason(): Promise<{ seasonOpen: boolean; seasonCloseAt: Date }> {
  const w = await giftWindow(); // shared rule (@repo/stores/season)
  return { seasonOpen: w.open, seasonCloseAt: w.closeAt };
}


/**
 * Start a tip: Embedded Checkout for the chosen amount. The QR is NOT used up here (an abandoned
 * checkout mustn't burn the code); the webhook confirms a still-pending deed when the money
 * arrives. The checkout EXPIRES with the code (or at season close, or after 23.5 h), so it can't
 * be paid after the code stopped working (review 2026-11-05).
 */
export type TipTarget =
  | { ok: true; deedId: string; kidId: string; familyId: string; kidName: string; payableUntil: number }
  | { ok: false; error: "invalid" | "used" | "expired" | "seasonClosed" };

/**
 * THE check for "can this deed take money right now, and until when?" (single source: the tip
 * checkout AND pay-later texts). Open deed, registered kid, season open or frozen; payable until
 * the deed's QR expiry or the season close, whichever is first.
 */
export async function tipTarget(token: unknown): Promise<TipTarget> {
  const { view: v, deed: d } = await view(token, "en");
  if (!d || v.state !== "open") return { ok: false, error: viewError(v) };
  if (!v.seasonOpen) return { ok: false, error: "seasonClosed" };
  return {
    ok: true,
    deedId: String(d._id),
    kidId: String(d.kidId),
    familyId: String(d.familyId),
    kidName: v.kidName,
    payableUntil: Math.min(new Date(d.expiresAt!).getTime(), v.seasonCloseAt.getTime()),
  };
}

export async function startTip(token: unknown, amountCents: number | null, origin: string, localePath: (p: string) => string): Promise<TipStart> {
  if (amountCents == null) return { ok: false, error: "amount" };
  const target = await tipTarget(token);
  if (!target.ok) return target;
  // Stripe: expires_at must be 30 min .. STRICTLY under 24 h from creation (exactly 24 h is refused).
  const endsAt = Math.min(target.payableUntil, Date.now() + MAX_CHECKOUT_MS);
  if (endsAt - Date.now() < MIN_CHECKOUT_MS) return { ok: false, error: "expired" };
  const metadata = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: target.kidId, sos_family_id: target.familyId, sos_deed_id: target.deedId });
  try {
    const session = await getStripe().checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      submit_type: "donate",
      expires_at: Math.floor(endsAt / 1000),
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: `Thank-you tip for ${target.kidName}` } } }],
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
/** After paying: "credited" / "processing" / "review" / "open" / null (only this deed's tip sessions). */
export async function tipStatus(token: unknown, sessionId: string): Promise<"credited" | "processing" | "review" | "open" | null> {
  const d = await findDeed(token);
  if (!d) return null;
  return creditReturnState(await checkoutReturnStatus(sessionId, (md) => md.sos_purpose === "tip" && md.sos_deed_id === String(d._id)));
}
