/**
 * Gift fulfilment (Phase 6 slice 3). SERVER-ONLY.
 *
 *   fully_funded ──(lock: 30 days or the Dec 1 freeze; engine.lockFundedItems)──▶ locked
 *   locked ──(store marks shipped: markShipped)──▶ shipped ──(admin: received)──▶ shipped+receivedAt
 *   ──(admin: sent to family + parent emailed)──▶ delivered                         [admin part: slice 3b]
 *
 * User decisions 2026-11-06: the store is told to SET ASIDE a gift at full funding but ships only
 * once it's LOCKED (it can't be removed any more); the family is emailed only when the admin sends
 * the gift on to them.
 *
 * Privacy (kids are minors; COPPA): stores see ONLY the item, a reference code and Spirit O Santa's
 * address. Never a child's or family's name, and never which family a gift is for.
 *
 * Stores are told by a DAILY DIGEST (sendStoreDigests, from the family app's money cron) instead
 * of an email per gift: fewer emails, and nothing is sent from inside a money transaction.
 * A gift is marked as "told" only AFTER its store's email went out, so a failed send is retried
 * the next day.
 */
import "server-only";
import { createHash } from "node:crypto";
import { AuditLog, connectDb, Item, PlatformSettings, Store, trusted, User, WishListItem, withTransaction } from "@repo/db";
import { sendEmail } from "@repo/email";
import { normalizeObjectId } from "@repo/lib/ids";
import { DEFAULT_LOCALE } from "@repo/lib/locales";
import { memberStore, type StoreActor } from "@repo/stores/owner";
import { storeAppOrigin } from "@repo/stores/urls";

/** Short reference printed on the package (last 6 hex of the id, upper case). Not secret, not guessable-useful. */
export const orderRef = (id: string) => id.slice(-6).toUpperCase();

/**
 * Spirit O Santa's shipping address (admin Settings). Read from the model directly because
 * @repo/payments (which owns the settings service) imports this package: no import cycle.
 */
export async function shippingAddress(): Promise<string> {
  await connectDb();
  const s = await PlatformSettings.findOne({ key: "platform" }).select("shippingAddress").lean();
  return s?.shippingAddress ?? "";
}

// ── Store side ─────────────────────────────────────────────────────────────────────────

export type OrderRow = {
  id: string;
  ref: string;
  itemName: string;
  fullyFundedAt: Date | null;
  lockedAt: Date | null;
  shippedAt: Date | null;
  trackingNote: string;
};
export type StoreOrders = {
  /** Fully funded, may still be removed by the parent: keep one aside, don't ship. */
  setAside: OrderRow[];
  /** Locked: ship now. */
  ready: OrderRow[];
  /** Funded but the store had none left: Spirit O Santa arranges a substitute (admin). */
  outOfStock: OrderRow[];
  /** Shipped in the last 60 days (newest first). */
  shipped: OrderRow[];
  shippingAddress: string;
};

const SHIPPED_HISTORY_DAYS = 60;
const MAX_ROWS = 500;

type RawWish = {
  _id: unknown;
  itemId: unknown;
  status: string;
  needsSubstitute?: boolean | null;
  fullyFundedAt?: Date | null;
  lockedAt?: Date | null;
  shippedAt?: Date | null;
  trackingNote?: string | null;
};

/** Item names by id (one query). */
async function itemNames(ids: unknown[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) return new Map();
  const items = await Item.find({ _id: trusted({ $in: unique }) }).select("name").lean<{ _id: unknown; name: string }[]>();
  return new Map(items.map((i) => [String(i._id), i.name]));
}

/** The signed-in owner's / rep's orders (membership re-checked in the DB). null = no store. */
export async function storeOrders(actor: StoreActor, now = new Date()): Promise<StoreOrders | null> {
  const store = await memberStore(actor);
  if (!store) return null;
  const since = new Date(now.getTime() - SHIPPED_HISTORY_DAYS * 86_400_000);
  const rows = await WishListItem.find({
    storeId: store._id,
    $or: [{ status: trusted({ $in: ["fully_funded", "locked"] }) }, { status: "shipped", shippedAt: trusted({ $gte: since }) }],
  })
    .select("itemId status needsSubstitute fullyFundedAt lockedAt shippedAt trackingNote")
    .sort({ fullyFundedAt: 1, _id: 1 })
    .limit(MAX_ROWS)
    .lean<RawWish[]>();
  const names = await itemNames(rows.map((r) => r.itemId));
  const toRow = (r: RawWish): OrderRow => ({
    id: String(r._id),
    ref: orderRef(String(r._id)),
    itemName: names.get(String(r.itemId)) ?? "",
    fullyFundedAt: r.fullyFundedAt ?? null,
    lockedAt: r.lockedAt ?? null,
    shippedAt: r.shippedAt ?? null,
    trackingNote: r.trackingNote ?? "",
  });
  const out: StoreOrders = { setAside: [], ready: [], outOfStock: [], shipped: [], shippingAddress: await shippingAddress() };
  for (const r of rows) {
    if (r.status === "shipped") out.shipped.push(toRow(r));
    else if (r.needsSubstitute) out.outOfStock.push(toRow(r));
    else if (r.status === "locked") out.ready.push(toRow(r));
    else out.setAside.push(toRow(r));
  }
  out.shipped.sort((a, b) => (b.shippedAt?.getTime() ?? 0) - (a.shippedAt?.getTime() ?? 0));
  return out;
}

export type ShipResult = { ok: true } | { ok: false; error: "notFound" | "notReady" };

/**
 * Store marks one gift shipped to Spirit O Santa. Only LOCKED gifts of the actor's OWN store that
 * don't wait for a substitute; compare-and-set on the status, so a double click ships once.
 */
export async function markShipped(actor: StoreActor, rawWishId: string, trackingNote: string, now = new Date()): Promise<ShipResult> {
  const id = normalizeObjectId(rawWishId);
  const store = await memberStore(actor);
  if (!id || !store) return { ok: false, error: "notFound" };
  return withTransaction(async (session): Promise<ShipResult> => {
    const res = await WishListItem.updateOne(
      { _id: id, storeId: store._id, status: "locked", needsSubstitute: trusted({ $ne: true }) },
      { $set: { status: "shipped", shippedAt: now, shippedByUserId: actor.id, ...(trackingNote ? { trackingNote } : {}) } },
      { session, runValidators: true },
    );
    if (res.modifiedCount !== 1) {
      const exists = await WishListItem.exists({ _id: id, storeId: store._id }).session(session);
      return { ok: false, error: exists ? "notReady" : "notFound" };
    }
    await AuditLog.create(
      [{ actorUserId: actor.id, action: "wish.ship", targetType: "wish_list_item", targetId: id, details: { storeId: String(store._id), tracking: Boolean(trackingNote) } }],
      { session },
    );
    return { ok: true };
  });
}

// ── Daily store digest ─────────────────────────────────────────────────────────────────

type DigestWish = { _id: unknown; storeId: unknown; itemId: unknown; status: string };

/** "2 × Bike (refs AB12CD, EF34GH)" lines, one per item; "-" when empty. */
function listLines(rows: DigestWish[], names: Map<string, string>): string {
  if (rows.length === 0) return "-";
  const byItem = new Map<string, string[]>();
  for (const r of rows) byItem.set(String(r.itemId), [...(byItem.get(String(r.itemId)) ?? []), orderRef(String(r._id))]);
  return [...byItem.entries()].map(([itemId, refs]) => `${refs.length} × ${names.get(itemId) ?? "?"} (${refs.join(", ")})`).join("\n");
}

export type DigestResult = { stores: number; emails: number; failed: number; skipped?: "noAddress" };

/**
 * Email each store its NEW gifts to set aside and gifts now ready to ship (owner + active reps).
 * Waits (sends nothing) until the admin has saved Spirit O Santa's shipping address.
 * Gifts waiting for a substitute are left out (the admin deals with them; once a substitute is
 * arranged they appear in the next digest).
 */
export async function sendStoreDigests(): Promise<DigestResult> {
  await connectDb();
  const address = await shippingAddress();
  if (!address) return { stores: 0, emails: 0, failed: 0, skipped: "noAddress" };
  const pending = await WishListItem.find({
    needsSubstitute: trusted({ $ne: true }),
    $or: [
      { status: "fully_funded", setAsideNotifiedAt: null },
      { status: "locked", readyNotifiedAt: null },
    ],
  })
    .select("storeId itemId status")
    .limit(5000)
    .lean<DigestWish[]>();
  if (pending.length === 0) return { stores: 0, emails: 0, failed: 0 };
  const names = await itemNames(pending.map((p) => p.itemId));
  const byStore = new Map<string, DigestWish[]>();
  for (const p of pending) byStore.set(String(p.storeId), [...(byStore.get(String(p.storeId)) ?? []), p]);
  const link = `${storeAppOrigin()}/dashboard/orders`;

  let emails = 0;
  let failed = 0;
  for (const [storeId, rows] of byStore) {
    try {
      const store = await Store.findById(storeId).select("name ownerUserId repUserIds").lean<{ name: string; ownerUserId?: unknown; repUserIds?: unknown[] }>();
      if (!store) continue;
      const memberIds = [store.ownerUserId, ...(store.repUserIds ?? [])].filter(Boolean).map(String);
      const people = await User.find({ _id: trusted({ $in: memberIds }), status: "active" }).select("email locale").lean<{ _id: unknown; email: string; locale?: string }[]>();
      if (people.length === 0) continue; // nobody to tell yet: stays pending, retried tomorrow
      const setAside = rows.filter((r) => r.status === "fully_funded");
      const ready = rows.filter((r) => r.status === "locked");
      // Same set of gifts = same key: a re-run (or a retry) never emails the same news twice.
      const batch = createHash("sha256").update(rows.map((r) => String(r._id)).sort().join(",")).digest("base64url").slice(0, 16);
      for (const person of people) {
        await sendEmail({
          to: person.email,
          locale: person.locale ?? DEFAULT_LOCALE,
          template: "storeOrders",
          values: { link, storeName: store.name, setAside: listLines(setAside, names), readyToShip: listLines(ready, names), address },
          idempotencyKey: `store-orders/${storeId}/${batch}/${String(person._id)}`,
        });
        emails += 1;
      }
      const now = new Date();
      // Ready-to-ship also counts as "told to set aside" (a gift locked at the freeze skips that step).
      await WishListItem.updateMany({ _id: trusted({ $in: setAside.map((r) => r._id) }) }, { $set: { setAsideNotifiedAt: now } });
      await WishListItem.updateMany({ _id: trusted({ $in: ready.map((r) => r._id) }) }, { $set: { readyNotifiedAt: now, setAsideNotifiedAt: now } });
    } catch (err) {
      failed += 1;
      console.error("[fulfilment] store digest failed:", err instanceof Error ? err.name : "unknown");
    }
  }
  return { stores: byStore.size, emails, failed };
}
