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
import { AuditLog, connectDb, Family, Kid, withTransaction } from "@repo/db";
import { ownFamilyId, type Parent } from "@repo/families/kids";
import { normalizeObjectId } from "@repo/lib/ids";
import { buildPaymentMetadata, checkoutReturnStatus, creditReturnState, getStripe } from "@repo/payments/checkout";
import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_CHECKOUT_MS, MIN_CHECKOUT_MS } from "@repo/lib/limits";
import { publicFamilyAlias, publicSeason } from "./public.ts";
import { donationToken, hashDeedToken, isDeedToken, qrDataUrl } from "./qr.ts";

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
  if (kid.donationTokenHash !== hash) {
    // Compare-and-set on the version we read: if "Make a new link" ran in between, don't write
    // the OLD link's hash back (that would revive a revoked link). Show no link this time instead.
    const r = await Kid.updateOne({ _id: kidId, familyId: fid, donationLinkVersion: version }, { $set: { donationTokenHash: hash } });
    if (r.matchedCount === 0) return null;
  }
  return new URL(`/k/${token}`, origin).toString();
}

/**
 * "Make a new link": the old link stops opening the page at once. Audited. (Caller checks the PIN.)
 * A checkout someone ALREADY opened from the old link can still finish (up to 23.5 h); that money
 * still goes to this kid, and refusing it after payment would only mean refunds.
 */
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
  const [fam, season] = await Promise.all([Family.findById(kid.familyId).select("alias showAliasPublicly aliasReview").lean(), publicSeason()]);
  return {
    page: { state: "open", kidName: kid.displayName, familyAlias: publicFamilyAlias(fam), ...season },
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

const sha = (s: string) => createHash("sha256").update(s).digest();

/**
 * Was `token` EVER this kid's donation link (any version up to the current one)? Used only after
 * paying: a donor who started checkout before the parent made a new link must still see "thank
 * you", not "invalid". Constant-time compare; versions only grow via PIN-gated resets (capped).
 */
async function wasKidsLink(token: string, rawKidId: unknown): Promise<boolean> {
  const kidId = normalizeObjectId(rawKidId);
  if (!kidId) return false;
  await connectDb();
  const kid = await Kid.findOne({ _id: kidId, archivedAt: null }).select("donationLinkVersion").lean();
  const current = kid?.donationLinkVersion ?? 0;
  const want = sha(token);
  let match = false;
  for (let v = Math.max(1, current - 499); v <= current; v++) match = timingSafeEqual(sha(donationToken(kidId, v)), want) || match;
  return match;
}

/**
 * After paying: "credited" / "processing" / "review" / "open" / null (only this kid's deed-less
 * tip sessions). A donor whose checkout began on an OLDER link (replaced since) still gets an
 * answer: wasKidsLink checks the token against this kid's earlier link versions.
 */
export async function donationStatus(token: unknown, sessionId: string): Promise<"credited" | "processing" | "review" | "open" | null> {
  if (!isDeedToken(token)) return null;
  const kid = await findKid(token); // current link (fast path); else maybe an older link
  return creditReturnState(
    await checkoutReturnStatus(sessionId, async (md) =>
      md.sos_purpose === "tip" && !md.sos_deed_id && (kid ? md.sos_kid_id === String(kid._id) : await wasKidsLink(token, md.sos_kid_id)),
    ),
  );
}

/** QR image (PNG data URL) for a link, shown on the kid's page. */
/** QR image for a donation link (shared look with deed codes). */
export const qrImage = qrDataUrl;
