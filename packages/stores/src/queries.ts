/**
 * Read-side queries for store screens. SERVER-ONLY. Return plain objects (lean + mapped)
 * that are safe to pass to Client Components: no password hashes, no internal fields
 * beyond what the screen needs.
 */
import "server-only";
import { AuditLog, connectDb, Item, Store, STORE_STATUSES, trusted, User } from "@repo/db";

export type StoreStatus = (typeof STORE_STATUSES)[number];

export type StoreListRow = {
  id: string;
  name: string;
  category: string;
  status: StoreStatus;
  city?: string;
  state?: string;
  ownerEmail?: string;
  discountBps?: number;
  createdAt: string;
};

export const STORES_PAGE_SIZE = 50;

/** Counts per status for the queue tabs (one aggregation). */
export async function storeStatusCounts(): Promise<Record<StoreStatus, number>> {
  await connectDb();
  const rows = await Store.aggregate<{ _id: StoreStatus; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]);
  const counts = Object.fromEntries(STORE_STATUSES.map((s) => [s, 0])) as Record<StoreStatus, number>;
  for (const r of rows) if (r._id in counts) counts[r._id] = r.n;
  return counts;
}

/** Stores in one status, oldest first (first come, first reviewed). */
export async function listStores(status: StoreStatus, page = 0): Promise<StoreListRow[]> {
  await connectDb();
  const stores = await Store.find({ status })
    .sort({ createdAt: 1 })
    .skip(Math.max(0, page) * STORES_PAGE_SIZE)
    .limit(STORES_PAGE_SIZE)
    .select("name category status contact.address.city contact.address.state contact.email ownerUserId discountBps createdAt")
    .lean();
  const owners = await User.find({ _id: trusted({ $in: stores.map((s) => s.ownerUserId).filter(Boolean) }) })
    .select("email")
    .lean();
  const emailById = new Map(owners.map((o) => [String(o._id), o.email]));
  return stores.map((s) => ({
    id: String(s._id),
    name: s.name,
    category: s.category,
    status: s.status,
    city: s.contact?.address?.city ?? undefined,
    state: s.contact?.address?.state ?? undefined,
    ownerEmail: (s.ownerUserId && emailById.get(String(s.ownerUserId))) || s.contact?.email,
    discountBps: s.discountBps ?? undefined,
    createdAt: s.createdAt.toISOString(),
  }));
}

export type StoreDetail = StoreListRow & {
  slug: string;
  description?: string;
  phone?: string;
  website?: string;
  address?: { line1?: string; city?: string; state?: string; zip?: string };
  ownerName?: string;
  ownerVerified: boolean;
  repCount: number;
  itemCount: number;
  agreement?: { version?: string; acceptedAt?: string };
  rejectionReason?: string;
  reviewedAt?: string;
  history: { action: string; at: string; actorEmail?: string; details?: Record<string, unknown> }[];
};

export async function getStoreDetail(storeId: string): Promise<StoreDetail | null> {
  await connectDb();
  const s = await Store.findById(storeId).lean();
  if (!s) return null;
  const [owner, itemCount, logs] = await Promise.all([
    s.ownerUserId ? User.findById(s.ownerUserId).select("email name status").lean() : null,
    Item.countDocuments({ storeId: s._id }),
    AuditLog.find({ targetType: "store", targetId: s._id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  // System audit rows (daily jobs) have no actor: never put undefined into the query.
  const actors = await User.find({ _id: trusted({ $in: logs.map((l) => l.actorUserId).filter((id) => id != null) }) }).select("email").lean();
  const actorEmail = new Map(actors.map((a) => [String(a._id), a.email]));
  return {
    id: String(s._id),
    name: s.name,
    slug: s.slug,
    category: s.category,
    status: s.status,
    description: s.description ?? undefined,
    phone: s.contact?.phone ?? undefined,
    website: s.contact?.website ?? undefined,
    address: s.contact?.address
      ? { line1: s.contact.address.line1 ?? undefined, city: s.contact.address.city ?? undefined, state: s.contact.address.state ?? undefined, zip: s.contact.address.zip ?? undefined }
      : undefined,
    city: s.contact?.address?.city ?? undefined,
    state: s.contact?.address?.state ?? undefined,
    ownerEmail: owner?.email ?? s.contact?.email,
    ownerName: owner?.name ?? undefined,
    ownerVerified: owner?.status === "active",
    repCount: s.repUserIds?.length ?? 0,
    itemCount,
    discountBps: s.discountBps ?? undefined,
    agreement: s.discountAgreement?.acceptedAt
      ? { version: s.discountAgreement.version ?? undefined, acceptedAt: s.discountAgreement.acceptedAt.toISOString() }
      : undefined,
    rejectionReason: s.rejectionReason ?? undefined,
    reviewedAt: s.reviewedAt?.toISOString(),
    createdAt: s.createdAt.toISOString(),
    history: logs.map((l) => ({
      action: l.action,
      at: l.createdAt.toISOString(),
      actorEmail: actorEmail.get(String(l.actorUserId)),
      details: (l.details as Record<string, unknown>) ?? undefined,
    })),
  };
}
