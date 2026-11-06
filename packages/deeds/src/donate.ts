/**
 * Outside donations (Phase 4 slice 6): a kid's shareable link/QR with NO deed attached, so family
 * friends can give to the kid's Christmas wish list. SERVER-ONLY.
 *
 *  - Link token = HMAC(DEED_QR_KEY, "donate|kidId|version") (qr.ts); only its hash is stored on the
 *    Kid. The parent can replace the link (version+1): the old link stops working immediately.
 *  - Public page /k/<token>: the kid's DISPLAY NAME (+ approved family nickname) only. Registered
 *    kids only; donations while the season is open or frozen.
 *  - Money: Stripe Embedded Checkout, purpose "tip" WITHOUT a deed id → the existing webhook credits
 *    points (CENTS_PER_POINT). Checkout expires at season close or after 23.5 h.
 */
import "server-only";
import { AuditLog, connectDb, Family, Kid, Payment, withTransaction } from "@repo/db";
import { ownFamilyId, type Parent } from "@repo/families/kids";
import { normalizeObjectId } from "@repo/lib/ids";
import { startOfDayInZone } from "@repo/lib/season";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { getSeasonState } from "@repo/stores/season";
import { MAX_CHECKOUT_MS, MIN_CHECKOUT_MS } from "./public.ts";
import { donationToken, hashDeedToken, isDeedToken } from "./qr.ts";

type KidLite = { _id: unknown; familyId: unknown; displayName: string; registration?: { status?: string | null } | null; donationLinkVersion?: number | null };

// ── Parent side ────────────────────────────────────────────────────────────────────────
/**
 * The kid's current donation link (creating its stored hash on first use). Registered kids only.
 * `origin` = the family app's public URL.
 */
export async function donationLink(parent: Parent, rawKidId: string, origin: string): Promise<string | null> {
  const kidId = normalizeObjectId(rawKidId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !fid) return null;
  const kid = await Kid.findOne({ _id: kidId, familyId: fid, archivedAt: null }).select("registration.status donationLinkVersion +donationTokenHash").lean();
  if (!kid || kid.registration?.status !== "registered") return null;
  const version = kid.donationLinkVersion ?? 1;
  const token = donationToken(kidId, version);
  const hash = hashDeedToken(token);
  if (kid.donationTokenHash !== hash) await Kid.updateOne({ _id: kidId, familyId: fid }, { $set: { donationTokenHash: hash, donationLinkVersion: version } });
  return new URL(`/k/${token}`, origin).toString();
}

/** "Make a new link": the old one stops working at once. Audited. (Caller checks the PIN.) */
export async function resetDonationLink(parent: Parent, rawKidId: string): Promise<{ ok: boolean }> {
  const kidId = normalizeObjectId(rawKidId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !fid) return { ok: false };
  return withTransaction(async (session) => {
    const kid = await Kid.findOne({ _id: kidId, familyId: fid, archivedAt: null }).select("donationLinkVersion").session(session).lean();
    if (!kid) return { ok: false };
    const version = (kid.donationLinkVersion ?? 1) + 1;
    await Kid.updateOne({ _id: kidId }, { $set: { donationLinkVersion: version, donationTokenHash: hashDeedToken(donationToken(kidId, version)) } }, { session });
    await AuditLog.create([{ actorUserId: parent.id, action: "kid.donation_link_reset", targetType: "kid", targetId: kidId, details: {} }], { session });
    return { ok: true };
  });
}

// ── Public side ────────────────────────────────────────────────────────────────────────
async function findKid(token: unknown): Promise<KidLite | null> {
  if (!isDeedToken(token)) return null;
  await connectDb();
  return Kid.findOne({ donationTokenHash: hashDeedToken(token), archivedAt: null })
    .select("familyId displayName registration.status donationLinkVersion")
    .lean<KidLite>();
}

export type DonationPage = { state: "invalid" } | { state: "open"; kidName: string; familyAlias?: string; seasonOpen: boolean; seasonCloseAt: Date };

async function view(token: unknown): Promise<{ page: DonationPage; kid: KidLite | null }> {
  const kid = await findKid(token);
  if (!kid || kid.registration?.status !== "registered") return { page: { state: "invalid" }, kid: null };
  const [fam, season] = await Promise.all([Family.findById(kid.familyId).select("alias showAliasPublicly aliasReview").lean(), getSeasonState()]);
  return {
    page: {
      state: "open",
      kidName: kid.displayName,
      familyAlias: fam?.showAliasPublicly && fam.alias && fam.aliasReview === "approved" ? fam.alias : undefined,
      seasonOpen: season.phase === "open" || season.phase === "frozen",
      seasonCloseAt: startOfDayInZone(season.dates.close),
    },
    kid,
  };
}

export async function getDonationPage(token: unknown): Promise<DonationPage> {
  return (await view(token)).page;
}

export type DonationStart = { ok: true; clientSecret: string; amountCents: number } | { ok: false; error: "invalid" | "seasonClosed" | "amount" | "stripe" };

export async function startDonation(token: unknown, amountCents: number | null, origin: string, localePath: (p: string) => string): Promise<DonationStart> {
  if (amountCents == null) return { ok: false, error: "amount" };
  const { page, kid } = await view(token);
  if (page.state !== "open" || !kid) return { ok: false, error: "invalid" };
  if (!page.seasonOpen) return { ok: false, error: "seasonClosed" };
  const endsAt = Math.min(page.seasonCloseAt.getTime(), Date.now() + MAX_CHECKOUT_MS);
  if (endsAt - Date.now() < MIN_CHECKOUT_MS) return { ok: false, error: "seasonClosed" };
  const metadata = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: String(kid._id), sos_family_id: String(kid.familyId) });
  try {
    const session = await getStripe().checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      submit_type: "donate",
      expires_at: Math.floor(endsAt / 1000),
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: `Christmas gift for ${page.kidName}` } } }],
      metadata,
      payment_intent_data: { metadata },
      return_url: new URL(localePath(`/k/${token as string}/thanks`), origin).toString() + "?session_id={CHECKOUT_SESSION_ID}",
    });
    return session.client_secret ? { ok: true, clientSecret: session.client_secret, amountCents } : { ok: false, error: "stripe" };
  } catch (err) {
    console.error("[donate] checkout session failed:", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "stripe" };
  }
}

/** After paying: "credited" / "processing" / "review" / "open" / null (only this kid's session). */
export async function donationStatus(token: unknown, sessionId: string): Promise<"credited" | "processing" | "review" | "open" | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return null;
  const kid = await findKid(token);
  if (!kid) return null;
  try {
    const s = await getStripe().checkout.sessions.retrieve(sessionId);
    if (s.metadata?.sos_purpose !== "tip" || s.metadata?.sos_kid_id !== String(kid._id) || s.metadata?.sos_deed_id) return null;
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

/** QR image (PNG data URL) for a link, shown on the kid's page. */
export async function qrImage(url: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 220 });
}
