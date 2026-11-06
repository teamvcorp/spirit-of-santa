/**
 * Store item catalog (store app). SERVER-ONLY.
 *
 * Rules (SpiritOfSanta.md Phase 2 + user decisions 2026-11-05), all enforced HERE:
 *  - Who: the store's owner or a CURRENT rep (memberStore: checked in the DB every call).
 *  - Store status: pending or approved may edit; rejected/suspended are read-only
 *    (isStoreEditable: the same list the profile/reps gates use).
 *  - Season window: add/edit/price/archive only while the store item window is open
 *    (Jan 1 – Mar 31 by default; an admin Season.storeWindow "open"/"closed" overrides).
 *    Inventory can be updated any time (stock changes all year).
 *  - Season: only the CURRENT season's items can be viewed or changed. Earlier seasons are
 *    history (no editing/restoring a 2026 item in 2027 via its URL; review 2026-11-05).
 *  - Limit: STORE_ITEM_LIMIT (50) non-archived items per store per season. Add and restore run
 *    in a transaction that first bumps Store.itemLockSeq. MongoDB lets only one transaction
 *    write a document at a time, so concurrent adds take turns and each counts what the
 *    previous one committed (no "both accepted" or "both rejected" races; review 2026-11-05).
 *  - Pricing: only OWNERS set prices. A rep's new item is a "draft" until the owner prices it.
 *    Retail price in cents = the item's cost in centipoints (1 cent = 1 centipoint).
 *  - Wholesale (what we owe the store) is computed from the store's CURRENT discount for
 *    display; the amount is fixed on the item when it's funded/locked (Phase 6).
 *  - Archived items are read-only (only "restore" touches them).
 * Every change is audited.
 */
import "server-only";
import { AuditLog, connectDb, Item, Season, Store, trusted, withTransaction, type AuditAction, type DbSession } from "@repo/db";
import { STORE_ITEM_LIMIT } from "@repo/lib/limits";
import { getSeasonYear, isStoreItemWindowOpen } from "@repo/lib/season";
import { isStoreEditable, wholesaleCents } from "@repo/lib/store";
import { hitRateLimit } from "@repo/auth/rate-limit";
import { deletePublicImage, ImageUploadError, uploadPublicImage, type ImageUploadErrorCode } from "@repo/storage/images";
import { memberStore, type StoreActor } from "./owner.ts";
import { wishListTotals } from "./engagement.ts";
import { EMPTY_TOTALS, fundingPercent, sumTotals, type WishListTotals } from "./engagement-math.ts";
import type { ItemInput } from "./schemas.ts";

export type ItemResult =
  | { ok: true; itemId?: string }
  | { ok: false; error: "notFound" | "readOnly" | "windowClosed" | "limitReached" | "priceRequired" | "rateLimited" | ImageUploadErrorCode };

/** The store as loaded by memberStore() (dashboard pages get it from loadMember()). */
export type MemberStore = NonNullable<Awaited<ReturnType<typeof memberStore>>>;

/** `status` filter for listed items. A function: each query gets its own trusted() object. */
const NOT_ARCHIVED = () => trusted({ $ne: "archived" as const });

/** Is the store item window open now? Season doc override first, then the default calendar. */
export async function storeItemWindow(now = new Date()): Promise<{ open: boolean; seasonYear: number }> {
  await connectDb();
  const seasonYear = getSeasonYear(now);
  const season = await Season.findOne({ year: seasonYear }).select("storeWindow").lean();
  const override = season?.storeWindow;
  const open = override === "open" ? true : override === "closed" ? false : isStoreItemWindowOpen(now);
  return { open, seasonYear };
}

/** Shared gate for item changes. Membership and the window are looked up in parallel. */
async function gate(actor: StoreActor, needWindow: boolean): Promise<{ store: MemberStore; seasonYear: number } | { error: ItemResult & { ok: false } }> {
  const [store, win] = await Promise.all([memberStore(actor), storeItemWindow()]);
  if (!store) return { error: { ok: false, error: "notFound" } };
  if (!isStoreEditable(store.status)) return { error: { ok: false, error: "readOnly" } };
  if (needWindow && !win.open) return { error: { ok: false, error: "windowClosed" } };
  return { store, seasonYear: win.seasonYear };
}

/** Filter for "this store's items in the current season" (every query below starts here). */
const scopeOf = (g: { store: MemberStore; seasonYear: number }) => ({ storeId: g.store._id, seasonYear: g.seasonYear });

/**
 * Inside a transaction: take this store's item lock, then count its current-season items.
 * The lock write makes a concurrent add/restore wait (or retry) until we commit.
 */
async function lockAndCount(g: { store: MemberStore; seasonYear: number }, session: DbSession): Promise<number> {
  await Store.updateOne({ _id: g.store._id }, { $inc: { itemLockSeq: 1 } }, { session });
  return Item.countDocuments({ ...scopeOf(g), status: NOT_ARCHIVED() }).session(session);
}

async function audit(actorId: string, action: AuditAction, itemId: unknown, details: Record<string, unknown> = {}) {
  await AuditLog.create({ actorUserId: actorId, action, targetType: "item", targetId: String(itemId), details });
}

export type ItemRow = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  priceCents?: number;
  /** Owner-only display value (undefined for reps or when no discount is agreed yet). */
  wholesaleCents?: number;
  inventory: number;
  status: "draft" | "active" | "archived";
  photo?: { url: string; pathname: string };
  /** Engagement (slice 5): views counter + wish-list totals. Totals only, never who. */
  stats: ItemStats;
};

export type ItemStats = { views: number; onLists: number; fullyFunded: number; locked: number; fundingPercent: number };

function toStats(views: number, t: WishListTotals = EMPTY_TOTALS): ItemStats {
  return { views, onLists: t.onLists, fullyFunded: t.fullyFunded, locked: t.locked, fundingPercent: fundingPercent(t) };
}

function toRow(item: Record<string, unknown> & { _id: unknown }, isOwner: boolean, discountBps: number | null | undefined, lists?: WishListTotals): ItemRow {
  const price = item.priceCents as number | undefined;
  const photo = item.photo as { url: string; pathname: string } | undefined;
  const stats = (item.stats ?? {}) as { views?: number };
  return {
    id: String(item._id),
    name: item.name as string,
    description: (item.description as string) || undefined,
    category: (item.category as string) || undefined,
    priceCents: price ?? undefined,
    wholesaleCents: isOwner && price != null && discountBps != null ? wholesaleCents(price, discountBps) : undefined,
    inventory: (item.inventory as number) ?? 0,
    status: item.status as ItemRow["status"],
    photo: photo?.url ? { url: photo.url, pathname: photo.pathname } : undefined,
    stats: toStats(stats.views ?? 0, lists),
  };
}

/*
 * READ functions take the store the page ALREADY loaded with loadMember() (memberStore, fresh
 * from the DB for this request) instead of looking it up a second time (review 2026-11-05).
 * Only ever pass the result of memberStore() for the current request: never a store built
 * from user input.
 */

/** Everything the items page needs, for the store's current season. */
export async function listStoreItems(store: MemberStore, isOwner: boolean) {
  const now = new Date();
  // Listed items (drafts + active, never more than the limit) and archived items are loaded
  // separately, so a long archive history can never push drafts out of view (review 2026-11-05).
  const scope = { storeId: store._id, seasonYear: getSeasonYear(now) };
  const [win, current, archived, count, lists] = await Promise.all([
    storeItemWindow(now),
    Item.find({ ...scope, status: NOT_ARCHIVED() }).sort({ createdAt: 1 }).limit(STORE_ITEM_LIMIT + 10).lean(),
    Item.find({ ...scope, status: "archived" }).sort({ updatedAt: -1 }).limit(100).lean(),
    Item.countDocuments({ ...scope, status: NOT_ARCHIVED() }),
    wishListTotals(scope.storeId, scope.seasonYear),
  ]);
  // Drafts first so the owner sees what needs a price.
  const rows = [...current.filter((i) => i.status === "draft"), ...current.filter((i) => i.status !== "draft"), ...archived].map((i) =>
    toRow(i as never, isOwner, store.discountBps, lists.get(String(i._id))),
  );
  // Store-wide summary: every item this season, archived ones included (kids may still have them).
  const all = sumTotals(lists.values());
  const summary = toStats(
    [...current, ...archived].reduce((n, i) => n + ((i.stats as { views?: number } | undefined)?.views ?? 0), 0),
    all,
  );
  return {
    items: rows,
    summary,
    count,
    limit: STORE_ITEM_LIMIT,
    window: win,
    storeStatus: store.status,
    editable: isStoreEditable(store.status),
    isOwner,
    discountBps: isOwner ? (store.discountBps ?? undefined) : undefined,
  };
}

/** One current-season item of this store, or null (other stores' and older items look missing). */
export async function getStoreItem(store: MemberStore, isOwner: boolean, itemId: string) {
  const now = new Date();
  const [win, item] = await Promise.all([
    storeItemWindow(now),
    Item.findOne({ _id: itemId, storeId: store._id, seasonYear: getSeasonYear(now) }).lean(),
  ]);
  if (!item) return null;
  // item._id (an ObjectId from the DB), not the URL text: aggregations don't cast types.
  const lists = await wishListTotals(store._id, item.seasonYear, item._id);
  return {
    item: toRow(item as never, isOwner, store.discountBps, lists.get(String(item._id))),
    window: win,
    editable: isStoreEditable(store.status),
    isOwner,
  };
}

export async function createItem(actor: StoreActor, input: ItemInput): Promise<ItemResult> {
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  const isOwner = actor.role === "store_owner";
  if (isOwner && input.priceCents == null) return { ok: false, error: "priceRequired" };
  // Bounds create/archive churn (archived items are kept for history).
  if (!(await hitRateLimit(`item-create:store:${g.store._id}`, 100, 86_400))) return { ok: false, error: "rateLimited" };
  // Lock → count → insert, all-or-nothing. If another add commits first, MongoDB reports a
  // write conflict and withTransaction re-runs this function, which then counts its item too.
  const itemId = await withTransaction(async (session) => {
    if ((await lockAndCount(g, session)) >= STORE_ITEM_LIMIT) return null;
    const [doc] = await Item.create(
      [
        {
          ...scopeOf(g),
          name: input.name,
          description: input.description,
          category: input.category,
          inventory: input.inventory,
          // Reps never set prices: their items wait for the owner.
          ...(isOwner ? { priceCents: input.priceCents, status: "active" } : { status: "draft" }),
        },
      ],
      { session },
    );
    return String(doc!._id);
  });
  if (!itemId) return { ok: false, error: "limitReached" };
  await audit(actor.id, "item.create", itemId, { status: isOwner ? "active" : "draft" });
  return { ok: true, itemId };
}

export async function updateItem(actor: StoreActor, itemId: string, input: ItemInput): Promise<ItemResult> {
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  const isOwner = actor.role === "store_owner";
  const existing = await Item.findOne({ _id: itemId, ...scopeOf(g), status: NOT_ARCHIVED() }).select("status priceCents").lean();
  if (!existing) return { ok: false, error: "notFound" };
  const set: Record<string, unknown> = {
    name: input.name,
    description: input.description ?? "",
    inventory: input.inventory,
  };
  // Mongoose drops undefined keys from $set, so clearing the category must be an $unset.
  const unset: Record<string, 1> = {};
  if (input.category) set.category = input.category;
  else unset.category = 1;
  if (isOwner) {
    if (input.priceCents == null) return { ok: false, error: "priceRequired" };
    set.priceCents = input.priceCents;
    if (existing.status === "draft") set.status = "active"; // owner priced a rep's draft
  }
  // Status in the filter: a concurrent archive wins instead of being silently undone.
  const res = await Item.updateOne(
    { _id: itemId, ...scopeOf(g), status: existing.status },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { runValidators: true },
  );
  if (res.matchedCount !== 1) return { ok: false, error: "notFound" };
  await audit(actor.id, isOwner && existing.priceCents !== input.priceCents ? "item.price" : "item.update", itemId, {
    ...(isOwner && existing.priceCents !== input.priceCents ? { from: existing.priceCents ?? null, to: input.priceCents } : {}),
  });
  return { ok: true, itemId };
}

/** Stock count: allowed outside the item window (stock changes all year). */
export async function setInventory(actor: StoreActor, itemId: string, inventory: number): Promise<ItemResult> {
  const g = await gate(actor, false);
  if ("error" in g) return g.error;
  const res = await Item.updateOne({ _id: itemId, ...scopeOf(g), status: NOT_ARCHIVED() }, { $set: { inventory } }, { runValidators: true });
  if (res.matchedCount !== 1) return { ok: false, error: "notFound" };
  await audit(actor.id, "item.update", itemId, { inventory });
  return { ok: true, itemId };
}

/** Owner only. Archived items leave the list and free a slot (kept for history). */
export async function archiveItem(actor: StoreActor, itemId: string): Promise<ItemResult> {
  if (actor.role !== "store_owner") return { ok: false, error: "notFound" };
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  // TODO(Phase 6): refuse while the item is on a kid's wish list / funded.
  const res = await Item.updateOne({ _id: itemId, ...scopeOf(g), status: NOT_ARCHIVED() }, { $set: { status: "archived" } });
  if (res.matchedCount !== 1) return { ok: false, error: "notFound" };
  await audit(actor.id, "item.archive", itemId);
  return { ok: true, itemId };
}

/** Owner only. Brings an archived current-season item back (if there's room under the limit). */
export async function restoreItem(actor: StoreActor, itemId: string): Promise<ItemResult> {
  if (actor.role !== "store_owner") return { ok: false, error: "notFound" };
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  // Same lock as createItem; the update only succeeds if the item is STILL archived, so two
  // restores of one item can't both report success (or one undo the other).
  const outcome = await withTransaction(async (session): Promise<"ok" | "notFound" | "limitReached"> => {
    const count = await lockAndCount(g, session);
    const item = await Item.findOne({ _id: itemId, ...scopeOf(g), status: "archived" }).select("priceCents").session(session).lean();
    if (!item) return "notFound";
    if (count >= STORE_ITEM_LIMIT) return "limitReached";
    const res = await Item.updateOne({ _id: itemId, ...scopeOf(g), status: "archived" }, { $set: { status: item.priceCents ? "active" : "draft" } }, { session });
    return res.matchedCount === 1 ? "ok" : "notFound";
  });
  if (outcome !== "ok") return { ok: false, error: outcome };
  await audit(actor.id, "item.restore", itemId);
  return { ok: true, itemId };
}

/** Set or replace the item's photo (owner or rep). The old file is deleted after the swap. */
export async function setItemPhoto(actor: StoreActor, itemId: string, file: Blob): Promise<ItemResult> {
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  const storeId = String(g.store._id);
  const filter = { _id: itemId, ...scopeOf(g), status: NOT_ARCHIVED() };
  if (!(await Item.exists(filter))) return { ok: false, error: "notFound" };
  // Each upload re-encodes an image (CPU) and writes to Blob: shared per-store budget.
  if (!(await hitRateLimit(`photo:items:${storeId}`, 60, 3600))) return { ok: false, error: "rateLimited" };
  let image;
  try {
    image = await uploadPublicImage(file, { folder: "items", ownerId: storeId });
  } catch (err) {
    if (err instanceof ImageUploadError) return { ok: false, error: err.code };
    throw err;
  }
  // Same filter again (incl. "not archived"): the upload takes seconds, and an archive that
  // lands meanwhile must win (review 2026-11-05). A fresh trusted() object per query.
  const before = await Item.findOneAndUpdate(
    { _id: itemId, ...scopeOf(g), status: NOT_ARCHIVED() },
    { $set: { photo: { url: image.url, pathname: image.pathname } } },
    { runValidators: true },
  )
    .select("photo")
    .lean();
  if (!before) {
    await deletePublicImage(image.pathname, { folder: "items", ownerId: storeId });
    return { ok: false, error: "notFound" };
  }
  if (before.photo?.pathname) await deletePublicImage(before.photo.pathname, { folder: "items", ownerId: storeId }).catch(() => {});
  await audit(actor.id, "item.update", itemId, { photo: true });
  return { ok: true, itemId };
}

/** Item photos live under items/<storeId>/… so ownership is checked by store. */
export async function removeItemPhoto(actor: StoreActor, itemId: string): Promise<ItemResult> {
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  const storeId = String(g.store._id);
  const before = await Item.findOneAndUpdate({ _id: itemId, ...scopeOf(g), status: NOT_ARCHIVED() }, { $unset: { photo: 1 } })
    .select("photo")
    .lean();
  if (!before) return { ok: false, error: "notFound" };
  if (before.photo?.pathname) await deletePublicImage(before.photo.pathname, { folder: "items", ownerId: storeId }).catch(() => {});
  await audit(actor.id, "item.update", itemId, { photo: false });
  return { ok: true, itemId };
}
