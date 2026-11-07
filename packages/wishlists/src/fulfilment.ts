/**
 * Gift fulfilment (Phase 6 slice 3). SERVER-ONLY.
 *
 *   fully_funded ──(lock: 30 days or the Dec 1 freeze; engine.lockFundedItems)──▶ locked
 *   locked ──(store marks shipped: markShipped)──▶ shipped ──(admin: received)──▶ shipped+receivedAt
 *   ──(admin: sent to family + parent emailed)──▶ delivered                         [admin part: slice 3b]
 *   needsSubstitute ──(admin: substitute arranged with the store)──▶ back in the store's queue
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
import { AuditLog, connectDb, Family, Item, Kid, PlatformSettings, Store, trusted, User, WishListItem, withTransaction } from "@repo/db";
import { sendEmail } from "@repo/email";
import { normalizeObjectId } from "@repo/lib/ids";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { DAY_MS } from "@repo/lib/time";
import { getSeasonState } from "@repo/stores/season";
import { memberStore, type StoreActor } from "@repo/stores/owner";
import { familyAppOrigin, storeAppOrigin } from "@repo/stores/urls";
import { unsealJson } from "@repo/auth/sealed";
import { addressLines, type DeliveryAddress } from "@repo/lib/address";
import { hitRateLimit } from "@repo/auth/rate-limit";
import { ADDRESS_KEY, clearAddress, familyAwaitingDelivery } from "./delivery.ts";
import { owedForGift } from "./payout-amount.ts";

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
/** Open orders (set aside / ready / out of stock) and shipped history are capped SEPARATELY. */
const MAX_OPEN_ROWS = 1000;
const MAX_SHIPPED_ROWS = 200;

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
  const since = new Date(now.getTime() - SHIPPED_HISTORY_DAYS * DAY_MS);
  const fields = "itemId status needsSubstitute fullyFundedAt lockedAt shippedAt trackingNote";
  // Two queries so a long shipped history can never push open orders off the page.
  const [open, shipped] = await Promise.all([
    WishListItem.find({ storeId: store._id, status: trusted({ $in: ["fully_funded", "locked"] }) })
      .select(fields)
      .sort({ fullyFundedAt: 1, _id: 1 })
      .limit(MAX_OPEN_ROWS)
      .lean<RawWish[]>(),
    WishListItem.find({ storeId: store._id, status: "shipped", shippedAt: trusted({ $gte: since }) })
      .select(fields)
      .sort({ shippedAt: -1, _id: 1 })
      .limit(MAX_SHIPPED_ROWS)
      .lean<RawWish[]>(),
  ]);
  const rows = [...open, ...shipped];
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
  return out;
}

/**
 * Just the two numbers for the dashboard overview alert (cheap counts).
 * `storeId` MUST come from memberStore() (the caller's own store), never from user input.
 */
export async function orderCounts(storeId: unknown): Promise<{ ready: number; setAside: number }> {
  await connectDb();
  const base = { storeId: String(storeId), needsSubstitute: trusted({ $ne: true }) };
  const [ready, setAside] = await Promise.all([
    WishListItem.countDocuments({ ...base, status: "locked" }),
    WishListItem.countDocuments({ ...base, status: "fully_funded" }),
  ]);
  return { ready, setAside };
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

export type DigestResult = {
  stores: number;
  emails: number;
  /** Stores whose email couldn't go out at all (retried next run). */
  failed: number;
  /** Single recipients that failed while others of the same store got it (not retried). */
  failedRecipients: number;
  /** Stores left for the next run because this run's time budget ran out. */
  deferred: number;
  skipped?: "noAddress";
};

/** Resend's default limit is 2 requests/second: stay under it. */
const SEND_GAP_MS = 600;
/** Leave the rest of the daily job (5 min max) its time: unsent stores go out on the next run. */
const DIGEST_BUDGET_MS = 150_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Email each store its NEW gifts to set aside and gifts now ready to ship (owner + active reps).
 * Waits (sends nothing) until the admin has saved Spirit O Santa's shipping address.
 * Gifts waiting for a substitute are left out (the admin deals with them; once a substitute is
 * arranged they appear in the next digest).
 */
export async function sendStoreDigests(now = new Date()): Promise<DigestResult> {
  const started = Date.now();
  await connectDb();
  const empty = { stores: 0, emails: 0, failed: 0, failedRecipients: 0, deferred: 0 };
  const address = await shippingAddress();
  if (!address) return { ...empty, skipped: "noAddress" };
  // THIS season only: older seasons' gifts (e.g. before this feature existed) are never re-announced.
  const { year } = await getSeasonState(now);
  const pending = await WishListItem.find({
    seasonYear: year,
    needsSubstitute: trusted({ $ne: true }),
    $or: [
      { status: "fully_funded", setAsideNotifiedAt: null },
      { status: "locked", readyNotifiedAt: null },
    ],
  })
    .select("storeId itemId status")
    .limit(5000)
    .lean<DigestWish[]>();
  if (pending.length === 0) return empty;
  const names = await itemNames(pending.map((p) => p.itemId));
  const byStore = new Map<string, DigestWish[]>();
  for (const p of pending) byStore.set(String(p.storeId), [...(byStore.get(String(p.storeId)) ?? []), p]);
  const link = `${storeAppOrigin()}/dashboard/orders`;

  const r: DigestResult = { ...empty, stores: byStore.size };
  for (const [storeId, rows] of byStore) {
    if (Date.now() - started > DIGEST_BUDGET_MS) {
      r.deferred += 1; // stays pending: next run
      continue;
    }
    try {
      const store = await Store.findById(storeId).select("name ownerUserId repUserIds").lean<{ name: string; ownerUserId?: unknown; repUserIds?: unknown[] }>();
      const memberIds = store ? [store.ownerUserId, ...(store.repUserIds ?? [])].filter(Boolean).map(String) : [];
      const people = memberIds.length ? await User.find({ _id: trusted({ $in: memberIds }), status: "active" }).select("email locale").lean<{ _id: unknown; email: string; locale?: string }[]>() : [];
      if (!store || people.length === 0) {
        // Gifts are owed but nobody can be told: count it so the job reports a failure (admin follows up).
        r.failed += 1;
        console.error("[fulfilment] store has funded gifts but no active owner/rep to email:", storeId);
        continue;
      }
      const setAside = rows.filter((w) => w.status === "fully_funded");
      const ready = rows.filter((w) => w.status === "locked");
      const values = { link, storeName: store.name, setAside: listLines(setAside, names), readyToShip: listLines(ready, names), address };
      // Key = the exact email CONTENT (gift ids + statuses + address): same news is never sent twice,
      // different news never collides with an old key (review 2026-11-06).
      const batch = createHash("sha256")
        .update(rows.map((w) => `${String(w._id)}:${w.status}`).sort().join(","))
        .update(`|${address}`)
        .digest("base64url")
        .slice(0, 16);
      let sent = 0;
      for (const person of people) {
        try {
          await sendEmail({ to: person.email, locale: person.locale ?? DEFAULT_LOCALE, template: "storeOrders", values, idempotencyKey: `store-orders/${storeId}/${batch}/${String(person._id)}` });
          sent += 1;
          r.emails += 1;
        } catch (err) {
          r.failedRecipients += 1;
          console.error("[fulfilment] store digest recipient failed:", err instanceof Error ? err.name : "unknown");
        }
        await sleep(SEND_GAP_MS);
      }
      // Nobody got it → retry next run. At least one person got it → done (no daily repeats for
      // the others because of one bad address; the Orders page always shows everything).
      if (sent === 0) {
        r.failed += 1;
        continue;
      }
      const at = new Date();
      // Ready-to-ship also counts as "told to set aside" (a gift locked at the freeze skips that step).
      await WishListItem.updateMany({ _id: trusted({ $in: setAside.map((w) => w._id) }) }, { $set: { setAsideNotifiedAt: at } });
      await WishListItem.updateMany({ _id: trusted({ $in: ready.map((w) => w._id) }) }, { $set: { readyNotifiedAt: at, setAsideNotifiedAt: at } });
    } catch (err) {
      r.failed += 1;
      console.error("[fulfilment] store digest failed:", err instanceof Error ? err.name : "unknown");
    }
  }
  return r;
}

// ── Admin side (slice 3b) ──────────────────────────────────────────────────────────────
// CALLERS MUST be admins (requireRole "admin" in the page AND the Server Action). These functions
// trust the caller's role, but still check every state transition (compare-and-set) and audit it.
// Admins see who a gift is for (child's first name, family, parent email): they deliver it.

/** Missed "on its way" emails are retried by the daily job for this long after delivery. */
export const FAMILY_NOTICE_RETRY_DAYS = 14;

/**
 * Parent email state of a delivered gift (admin page):
 * emailed · pending (retried daily) · failed (retries over: contact the parent) · none (child or
 * family deleted, nobody to tell).
 */
export type FamilyNotice = "emailed" | "pending" | "failed" | "none";

export type AdminFulfilmentRow = {
  id: string;
  ref: string;
  itemName: string;
  storeName: string;
  storeEmail: string;
  status: string;
  fullyFundedAt: Date | null;
  shippedAt: Date | null;
  trackingNote: string;
  receivedAt: Date | null;
  deliveredAt: Date | null;
  /** Only for gifts Spirit O Santa has (received / delivered): who it goes to. */
  kidName?: string;
  familyName?: string;
  parentEmail?: string;
  familyNotice?: FamilyNotice;
  /**
   * "To send" only: the family's delivery address as label lines (decrypted for this admin view and
   * audited), "missing" (the parent hasn't entered one yet) or "unreadable" (key changed/corrupted).
   */
  address?: string[] | "missing" | "unreadable";
};
/** Each list is the OLDEST `ADMIN_LIMIT` rows (work in order); `total` is the real count. */
export type AdminList = { rows: AdminFulfilmentRow[]; total: number };
export type AdminFulfilment = {
  /** Funded, store had none left: arrange a substitute with the store. */
  substitutes: AdminList;
  /** Store shipped, not received yet. */
  inTransit: AdminList;
  /** Received, to send on to the family. */
  toSend: AdminList;
  /** Sent to families in the last 30 days (newest first). */
  delivered: AdminList;
  limit: number;
};

type AdminRaw = RawWish & {
  storeId: unknown;
  kidId: unknown;
  familyId: unknown;
  receivedAt?: Date | null;
  deliveredAt?: Date | null;
  familyNotifiedAt?: Date | null;
  familyNoticeSkippedAt?: Date | null;
};
export const ADMIN_LIMIT = 300;

/** Who a gift is for, loaded in bulk (a handful of queries for any number of gifts). */
async function recipients(rows: { kidId: unknown; familyId: unknown }[]) {
  const [kids, families] = await Promise.all([
    Kid.find({ _id: trusted({ $in: [...new Set(rows.map((r) => String(r.kidId)))] }) }).select("firstName").lean<{ _id: unknown; firstName: string }[]>(),
    Family.find({ _id: trusted({ $in: [...new Set(rows.map((r) => String(r.familyId)))] }) }).select("familyName ownerUserId").lean<{ _id: unknown; familyName: string; ownerUserId: unknown }[]>(),
  ]);
  const owners = await User.find({ _id: trusted({ $in: families.map((f) => String(f.ownerUserId)) }) })
    .select("email locale status")
    .lean<{ _id: unknown; email: string; locale?: string; status: string }[]>();
  const kidBy = new Map(kids.map((k) => [String(k._id), k.firstName]));
  const famBy = new Map(families.map((f) => [String(f._id), f]));
  const ownerBy = new Map(owners.map((u) => [String(u._id), u]));
  return (r: { kidId: unknown; familyId: unknown }) => {
    const fam = famBy.get(String(r.familyId));
    return { kidName: kidBy.get(String(r.kidId)), familyName: fam?.familyName, parent: fam ? ownerBy.get(String(fam.ownerUserId)) : undefined };
  };
}

/**
 * `adminId` = the admin looking: decrypting a family's address is recorded in the audit log
 * ("family.address_view", one row per family shown, never the address itself).
 */
export async function adminFulfilment(adminId: string, now = new Date()): Promise<AdminFulfilment> {
  await connectDb();
  const fields = "itemId storeId kidId familyId status needsSubstitute fullyFundedAt shippedAt trackingNote receivedAt deliveredAt familyNotifiedAt familyNoticeSkippedAt";
  const filters = {
    substitutes: { needsSubstitute: true, status: trusted({ $in: ["fully_funded", "locked"] }) },
    inTransit: { status: "shipped", receivedAt: null },
    toSend: { status: "shipped", receivedAt: trusted({ $ne: null }) },
    delivered: { status: "delivered", deliveredAt: trusted({ $gte: new Date(now.getTime() - 30 * DAY_MS) }) },
  };
  const q = (filter: Record<string, unknown>, sort: Record<string, 1 | -1>) =>
    Promise.all([WishListItem.find(filter).select(fields).sort(sort).limit(ADMIN_LIMIT).lean<AdminRaw[]>(), WishListItem.countDocuments(filter)]);
  const [substitutes, inTransit, toSend, delivered] = await Promise.all([
    q(filters.substitutes, { fullyFundedAt: 1, _id: 1 }),
    q(filters.inTransit, { shippedAt: 1, _id: 1 }),
    q(filters.toSend, { receivedAt: 1, _id: 1 }),
    q(filters.delivered, { deliveredAt: -1, _id: 1 }),
  ]);
  const all = [...substitutes[0], ...inTransit[0], ...toSend[0], ...delivered[0]];
  const [names, stores, whoFor, addresses] = await Promise.all([
    itemNames(all.map((r) => r.itemId)),
    Store.find({ _id: trusted({ $in: [...new Set(all.map((r) => String(r.storeId)))] }) }).select("name contact.email").lean<{ _id: unknown; name: string; contact?: { email?: string } }[]>(),
    recipients([...toSend[0], ...delivered[0]]),
    deliveryAddresses(adminId, toSend[0].map((r) => String(r.familyId))),
  ]);
  const storeBy = new Map(stores.map((x) => [String(x._id), x]));
  const retryUntil = (d: Date | null | undefined) => (d ? new Date(d).getTime() + FAMILY_NOTICE_RETRY_DAYS * DAY_MS : 0);
  const notice = (r: AdminRaw): FamilyNotice =>
    r.familyNotifiedAt ? "emailed" : r.familyNoticeSkippedAt ? "none" : retryUntil(r.deliveredAt) > now.getTime() ? "pending" : "failed";
  const toRow = (r: AdminRaw, who: boolean): AdminFulfilmentRow => {
    const st = storeBy.get(String(r.storeId));
    const w = who ? whoFor(r) : null;
    return {
      id: String(r._id),
      ref: orderRef(String(r._id)),
      itemName: names.get(String(r.itemId)) ?? "",
      storeName: st?.name ?? "",
      storeEmail: st?.contact?.email ?? "",
      status: r.status,
      fullyFundedAt: r.fullyFundedAt ?? null,
      shippedAt: r.shippedAt ?? null,
      trackingNote: r.trackingNote ?? "",
      receivedAt: r.receivedAt ?? null,
      deliveredAt: r.deliveredAt ?? null,
      ...(w ? { kidName: w.kidName ?? "", familyName: w.familyName ?? "", parentEmail: w.parent?.email ?? "", familyNotice: notice(r) } : {}),
      ...(r.status === "shipped" && r.receivedAt ? { address: addresses.get(String(r.familyId)) ?? "missing" } : {}),
    };
  };
  const list = ([rows, total]: [AdminRaw[], number], who: boolean): AdminList => ({ rows: rows.map((r) => toRow(r, who)), total });
  return { substitutes: list(substitutes, false), inTransit: list(inTransit, false), toSend: list(toSend, true), delivered: list(delivered, true), limit: ADMIN_LIMIT };
}

export type AdminStepResult = { ok: true } | { ok: false; error: "notFound" | "changed" };

/** One audited compare-and-set step on an ALREADY-normalised id. Anything not in `from` = "changed". */
async function adminStep(
  adminId: string,
  id: string,
  from: Record<string, unknown>,
  set: Record<string, unknown>,
  unset: Record<string, 1>,
  action: "wish.substitute" | "wish.receive" | "wish.deliver",
  details: Record<string, unknown>,
): Promise<AdminStepResult> {
  await connectDb();
  return withTransaction(async (session): Promise<AdminStepResult> => {
    const res = await WishListItem.updateOne({ _id: id, ...from }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session, runValidators: true });
    if (res.modifiedCount !== 1) return { ok: false, error: (await WishListItem.exists({ _id: id }).session(session)) ? "changed" : "notFound" };
    await AuditLog.create([{ actorUserId: adminId, action, targetType: "wish_list_item", targetId: id, details }], { session });
    return { ok: true };
  });
}
const notFound: AdminStepResult = { ok: false, error: "notFound" };

/**
 * The admin agreed a substitute with the store (note says what, e.g. "red bike instead of blue").
 * Clears needsSubstitute, so the gift returns to the store's Orders page and the next daily email.
 */
export function arrangeSubstitute(adminId: string, rawId: string, note: string, now = new Date()): Promise<AdminStepResult> {
  const id = normalizeObjectId(rawId);
  if (!id) return Promise.resolve(notFound);
  return adminStep(
    adminId,
    id,
    { needsSubstitute: true, status: trusted({ $in: ["fully_funded", "locked"] }) },
    { substituteArrangedAt: now, substituteNote: note, setAsideNotifiedAt: null, readyNotifiedAt: null },
    { needsSubstitute: 1 },
    "wish.substitute",
    { noteLength: note.length },
  );
}

/**
 * Spirit O Santa received the store's package. From now on the store is OWED for it (slice 5): the
 * amount is fixed here (payoutOwedCents) so a later discount change never rewrites the debt.
 */
export async function markReceived(adminId: string, rawId: string, now = new Date()): Promise<AdminStepResult> {
  const id = normalizeObjectId(rawId);
  if (!id) return notFound;
  await connectDb();
  const w = await WishListItem.findById(id).select("storeId costCentipoints").lean<{ storeId: unknown; costCentipoints: number }>();
  if (!w) return notFound;
  const owed = await owedForGift(w.storeId, w.costCentipoints);
  return adminStep(adminId, id, { status: "shipped", receivedAt: null }, { receivedAt: now, receivedByUserId: adminId, ...(owed !== null ? { payoutOwedCents: owed } : {}) }, {}, "wish.receive", { owedCents: owed });
}

/**
 * Sent on to the family → "delivered", then the parent is emailed right away (best effort: a
 * failed email is retried by the daily job; the delivery itself stands either way).
 */
export async function markSentToFamily(adminId: string, rawId: string, now = new Date()): Promise<AdminStepResult> {
  const id = normalizeObjectId(rawId);
  if (!id) return notFound;
  const r = await adminStep(adminId, id, { status: "shipped", receivedAt: trusted({ $ne: null }) }, { status: "delivered", deliveredAt: now, deliveredByUserId: adminId }, {}, "wish.deliver", {});
  if (r.ok) {
    await notifyFamilies([id]);
    await deleteAddressIfDone(adminId, id);
  }
  return r;
}

// ── Delivery addresses (slice 4b) ─────────────────────────────────────────────────────

/**
 * Decrypt the addresses of these families for an admin. Each view is audited ("family.address_view",
 * never the address), at most ONCE per admin, family and day: refreshing the queue after every
 * "Sent" click must not flood the append-only audit log.
 */
async function deliveryAddresses(adminId: string, familyIds: string[]): Promise<Map<string, string[] | "unreadable">> {
  const ids = [...new Set(familyIds)];
  if (ids.length === 0) return new Map();
  const fams = await Family.find({ _id: trusted({ $in: ids }), deliveryAddressEnc: trusted({ $exists: true }) })
    .select("+deliveryAddressEnc")
    .lean<{ _id: unknown; deliveryAddressEnc: string }[]>();
  const out = new Map<string, string[] | "unreadable">();
  for (const f of fams) {
    const a = unsealJson<DeliveryAddress>(f.deliveryAddressEnc, String(f._id), ADDRESS_KEY);
    out.set(String(f._id), a ? addressLines(a) : "unreadable");
  }
  const toAudit: string[] = [];
  for (const fid of out.keys()) if (await hitRateLimit(`address-view-audit:${adminId}:${fid}`, 1, 86_400)) toAudit.push(fid);
  if (toAudit.length > 0) {
    await AuditLog.insertMany(toAudit.map((fid) => ({ actorUserId: adminId, action: "family.address_view", targetType: "family", targetId: fid, details: {} })));
  }
  return out;
}

/** After a gift goes out: no gift left on its way to that family → its address is deleted. */
async function deleteAddressIfDone(adminId: string, wishId: string): Promise<void> {
  try {
    const w = await WishListItem.findById(wishId).select("familyId").lean<{ familyId: unknown }>();
    if (!w) return;
    const fid = String(w.familyId);
    const fam = await Family.findById(fid).select("deliveryAddressUpdatedAt").lean<{ deliveryAddressUpdatedAt?: Date | null }>();
    if (await familyAwaitingDelivery(fid)) return;
    await clearAddress(fid, "delivered", adminId, fam?.deliveryAddressUpdatedAt ?? null);
  } catch (err) {
    // The daily purge catches anything missed here.
    console.error("[fulfilment] address cleanup failed (daily job retries):", err instanceof Error ? err.name : "unknown");
  }
}

/** Daily safety net (money cron). Lives in delivery.ts (the ONE place); re-exported for the cron. */
export { purgeUnneededAddresses } from "./delivery.ts";

type NoticeTotals = { sent: number; failed: number; none: number };

/**
 * Email parents that these delivered gifts are on their way (paced under Resend's limit; all
 * lookups in bulk). familyNotifiedAt is set ONLY when an email really went out. Child or family
 * deleted (COPPA deletion) = nobody to tell → familyNoticeSkippedAt (never retried). A parent
 * account that isn't active right now counts as failed: retried while the retry window lasts.
 * Never throws for one gift; `budgetMs` stops early (the rest waits for the next run).
 */
async function notifyFamilies(ids: string[], budgetMs = Infinity): Promise<NoticeTotals> {
  const started = Date.now();
  const totals: NoticeTotals = { sent: 0, failed: 0, none: 0 };
  const rows = await WishListItem.find({ _id: trusted({ $in: ids }), status: "delivered", familyNotifiedAt: null, familyNoticeSkippedAt: null })
    .select("kidId familyId itemId")
    .lean<{ _id: unknown; kidId: unknown; familyId: unknown; itemId: unknown }[]>();
  if (rows.length === 0) return totals;
  const [names, whoFor] = await Promise.all([itemNames(rows.map((r) => r.itemId)), recipients(rows)]);
  for (const [i, r] of rows.entries()) {
    if (Date.now() - started > budgetMs) break;
    const wishId = String(r._id);
    const w = whoFor(r);
    try {
      if (!w.kidName || !w.familyName) {
        await WishListItem.updateOne({ _id: wishId, familyNotifiedAt: null }, { $set: { familyNoticeSkippedAt: new Date() } });
        totals.none += 1;
        continue;
      }
      if (!w.parent || w.parent.status !== "active") {
        totals.failed += 1; // retried tomorrow (the account may be re-activated)
        continue;
      }
      if (i > 0) await sleep(SEND_GAP_MS);
      const locale = isLocale(w.parent.locale) ? w.parent.locale : DEFAULT_LOCALE;
      await sendEmail({
        to: w.parent.email,
        locale,
        template: "giftOnItsWay",
        values: { link: `${familyAppOrigin()}${localizePath(`/kids/${String(r.kidId)}`, locale)}`, kidName: w.kidName, itemName: names.get(String(r.itemId)) ?? "" },
        idempotencyKey: `gift-on-its-way/${wishId}`,
      });
      await WishListItem.updateOne({ _id: wishId, familyNotifiedAt: null }, { $set: { familyNotifiedAt: new Date() } });
      totals.sent += 1;
    } catch (err) {
      totals.failed += 1;
      console.error("[fulfilment] family notice failed (daily job retries):", err instanceof Error ? err.name : "unknown");
    }
  }
  return totals;
}

const FAMILY_NOTICE_BUDGET_MS = 60_000;

/**
 * Daily retry (money cron) for "on its way" emails that didn't go out, for FAMILY_NOTICE_RETRY_DAYS
 * after delivery. `failed` > 0 makes the cron report a partial failure (so someone is alerted).
 */
export async function sendFamilyNotices(now = new Date()): Promise<NoticeTotals> {
  await connectDb();
  const rows = await WishListItem.find({
    status: "delivered",
    familyNotifiedAt: null,
    familyNoticeSkippedAt: null,
    deliveredAt: trusted({ $gte: new Date(now.getTime() - FAMILY_NOTICE_RETRY_DAYS * DAY_MS) }),
  })
    .select("_id")
    .sort({ deliveredAt: 1 })
    .limit(100)
    .lean<{ _id: unknown }[]>();
  return notifyFamilies(rows.map((r) => String(r._id)), FAMILY_NOTICE_BUDGET_MS);
}
