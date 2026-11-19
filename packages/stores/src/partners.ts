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
 * Christmas Magic donor (North Star): `christmasMagicDonorStoreIds` is the ONE place that decides it. Slice 3 will
 * fill it from store-linked gifts (≥ the admin threshold, this season). Until then it returns nobody, so no store
 * can show the star by mistake. The star NEVER changes the order (hard rule): sorting below ignores it.
 */
import "server-only";
import { connectDb, Store, trusted, User } from "@repo/db";
import { LISTED_STORE_STATUSES, orderPartners, publicPartnerStatus, type PartnerStatus } from "@repo/lib/partners";

export type { PartnerStatus };
const MAX_PARTNERS = 500;

export type Partner = { slug: string; name: string; status: PartnerStatus; logoUrl?: string; donor: boolean };

/**
 * Stores that gave Christmas Magic at or above the badge threshold THIS season (badge resets Jan 1, owner).
 * TODO(founding partners slice 3): sum store-linked donation Payments (succeeded, not refunded/disputed) per store.
 */
export async function christmasMagicDonorStoreIds(): Promise<Set<string>> {
  return new Set();
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
