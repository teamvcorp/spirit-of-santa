/**
 * PUBLIC PARTNERS PAGE data (owner 2026-11-18, docs/plans/founding-partners.md "Slice P"). SERVER-ONLY.
 *
 * ONE source: the same Store collection the store app and admin use (no second list of companies).
 * What the public may see, per store:
 *   invited  → "pending"     (we invited them, no answer yet)
 *   pending  → "processing"  (they signed up; in review)
 *   approved → "approved"    (live for families)
 *   declined → "declined"    (they said no: NAME ONLY, never their logo)
 *   rejected / suspended → NOT LISTED (our own decisions are not published)
 * Logos come only from the store's own upload (Store.logo, store app) = their permission.
 *
 * Christmas Magic donor (North Star): `christmasMagicDonorStoreIds` is the ONE place that decides it, from store-linked
 * gifts (≥ the admin threshold, this season). The star NEVER changes the order (hard rule): sorting ignores it.
 */
import "server-only";
import { connectDb, Payment, PlatformSettings, Store, toObjectId, trusted, User } from "@repo/db";
import { getSeasonYear } from "@repo/lib/season";
import { LISTED_STORE_STATUSES, orderPartners, publicPartnerStatus, type PartnerStatus } from "@repo/lib/partners";

export type { PartnerStatus };
const MAX_PARTNERS = 500;

export type Partner = { slug: string; name: string; status: PartnerStatus; logoUrl?: string; donor: boolean };

/**
 * THE North Star rule (founding partners slice 3; one source of truth): stores whose store-linked Christmas Magic
 * gifts THIS season (badge resets Jan 1, owner) total at least the admin's threshold (Settings; none = no badges).
 * Counts only money that really arrived and stayed: succeeded, in the pool / shared / kept, never refunded, never
 * disputed. Recognition only: it never changes order, ranking or anything else (hard rule).
 */
/** Which store gifts COUNT (badge and admin totals): arrived and stayed, this season. Aggregate stage (not sanitized). */
function countedStoreGifts(now: Date, storeId?: string) {
  return {
    purpose: "donation",
    status: "succeeded",
    seasonYear: getSeasonYear(now),
    storeId: storeId ? toObjectId(storeId) : { $exists: true, $ne: null },
    fulfilment: { $in: ["held", "credited", "retained"] },
    refundedCents: 0,
    "dispute.stripeDisputeId": { $exists: false },
  };
}

/** One store's counted Christmas Magic gifts this season (admin store page). */
export async function storeSeasonGiftCents(storeId: string, now = new Date()): Promise<number> {
  await connectDb();
  const [row] = await Payment.aggregate<{ cents: number }>([{ $match: countedStoreGifts(now, storeId) }, { $group: { _id: null, cents: { $sum: "$amountCents" } } }]);
  return row?.cents ?? 0;
}

export async function christmasMagicDonorStoreIds(now = new Date()): Promise<Set<string>> {
  await connectDb();
  const settings = await PlatformSettings.findOne({ key: "platform" }).select("donorBadgeCents").lean();
  const threshold = settings?.donorBadgeCents;
  if (typeof threshold !== "number" || threshold < 1) return new Set();
  const rows = await Payment.aggregate<{ _id: unknown }>([
    { $match: countedStoreGifts(now) },
    { $group: { _id: "$storeId", cents: { $sum: "$amountCents" } } },
    { $match: { cents: { $gte: threshold } } },
  ]);
  return new Set(rows.map((r) => String(r._id)));
}

type Raw = { _id: unknown; slug: string; name: string; status: string; ownerUserId?: unknown; logo?: { url?: string } | null };
const FIELDS = "slug name status ownerUserId logo.url";

/**
 * Safety (review 2026-11-18): anyone can self-sign-up a store with ANY name. Such a "pending" store is listed only
 * once its owner has CONFIRMED their email (unconfirmed sign-ups are purged after 48 h and never shown). Logos show
 * only for APPROVED stores, so nothing an admin hasn't reviewed puts a picture on this children's site.
 */
async function publicRows(rows: Raw[]): Promise<Raw[]> {
  const owners = rows.filter((s) => s.status === "pending" && s.ownerUserId).map((s) => s.ownerUserId);
  const active = owners.length
    ? new Set((await User.find({ _id: trusted({ $in: owners }), status: "active" }).select("_id").lean()).map((u) => String(u._id)))
    : new Set<string>();
  return rows.filter((s) => s.status !== "pending" || (s.ownerUserId != null && active.has(String(s.ownerUserId))));
}

function toPartner(s: Raw, donors: Set<string>): Partner {
  const status = publicPartnerStatus(s.status) ?? "pending"; // the query only returns listed statuses
  return {
    slug: s.slug,
    name: s.name,
    status,
    // Logo only once approved (reviewed by an admin); a company that declined never shows one (owner 2026-11-18).
    ...(s.status === "approved" && s.logo?.url ? { logoUrl: s.logo.url } : {}),
    donor: status !== "declined" && donors.has(String(s._id)),
  };
}

/** Every listed company: approved first, then processing, pending, declined; A→Z inside each. Never by donor. */
export async function listPartners(): Promise<Partner[]> {
  await connectDb();
  const [rows, donors] = await Promise.all([
    Store.find({ status: trusted({ $in: [...LISTED_STORE_STATUSES] }) })
      .select(FIELDS)
      .sort({ name: 1 })
      .limit(MAX_PARTNERS)
      .lean<Raw[]>(),
    christmasMagicDonorStoreIds(),
  ]);
  // One ordering rule (@repo/lib/partners, unit-tested: the donor star never changes it).
  return orderPartners((await publicRows(rows)).map((s) => toPartner(s, donors)));
}

/** One listed company by its slug (the tile's link), or null (unknown, rejected, suspended). */
export async function partnerBySlug(rawSlug: string): Promise<Partner | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(rawSlug)) return null;
  await connectDb();
  const [s, donors] = await Promise.all([
    Store.findOne({ slug: rawSlug, status: trusted({ $in: [...LISTED_STORE_STATUSES] }) }).select(FIELDS).lean<Raw>(),
    christmasMagicDonorStoreIds(),
  ]);
  const [shown] = s ? await publicRows([s]) : [];
  return shown ? toPartner(shown, donors) : null;
}
