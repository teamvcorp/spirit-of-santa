/**
 * Store item catalog (store app). SERVER-ONLY.
 *
 * Rules (SpiritOfSanta.md Phase 2 + user decisions 2026-11-05), all enforced HERE:
 *  - Who: the store's owner or a CURRENT rep (memberStore: checked in the DB every call).
 *  - Store status: pending or approved may edit; rejected/suspended are read-only.
 *  - Season window: add/edit/price/archive only while the store item window is open
 *    (Jan 1 – Mar 31 by default; an admin Season.storeWindow "open"/"closed" overrides).
 *    Inventory can be updated any time (stock changes all year).
 *  - Limit: STORE_ITEM_LIMIT (50) non-archived items per store per season. Checked after the
 *    insert (count includes the new item) so two simultaneous adds can't both slip past.
 *  - Pricing: only OWNERS set prices. A rep's new item is a "draft" until the owner prices it.
 *    Retail price in cents = the item's cost in centipoints (1 cent = 1 centipoint).
 *  - Wholesale (what we owe the store) is computed from the store's CURRENT discount for
 *    display; the amount is fixed on the item when it's funded/locked (Phase 6).
 * Every change is audited.
 */
import "server-only";
import { AuditLog, connectDb, Item, Season, Store, trusted, type AuditAction } from "@repo/db";
import { STORE_ITEM_LIMIT } from "@repo/lib/limits";
import { getSeasonYear, isStoreItemWindowOpen } from "@repo/lib/season";
import { wholesaleCents } from "@repo/lib/store";
import { hitRateLimit } from "@repo/auth/rate-limit";
import { deletePublicImage, ImageUploadError, uploadPublicImage, type ImageUploadErrorCode } from "@repo/storage/images";
import { memberStore, type StoreActor } from "./owner.ts";
import type { ItemInput } from "./schemas.ts";

export type ItemResult =
  | { ok: true; itemId?: string }
  | { ok: false; error: "notFound" | "readOnly" | "windowClosed" | "limitReached" | "priceRequired" | "rateLimited" | ImageUploadErrorCode };

const EDITABLE = ["pending", "approved"];

/** Is the store item window open now? Season doc override first, then the default calendar. */
export async function storeItemWindow(now = new Date()): Promise<{ open: boolean; seasonYear: number }> {
  await connectDb();
  const seasonYear = getSeasonYear(now);
  const season = await Season.findOne({ year: seasonYear }).select("storeWindow").lean();
  const override = season?.storeWindow;
  const open = override === "open" ? true : override === "closed" ? false : isStoreItemWindowOpen(now);
  return { open, seasonYear };
}

type MemberStore = NonNullable<Awaited<ReturnType<typeof memberStore>>>;

/** Shared gate for item changes. */
async function gate(actor: StoreActor, needWindow: boolean): Promise<{ store: MemberStore; seasonYear: number } | { error: ItemResult & { ok: false } }> {
  const store = await memberStore(actor);
  if (!store) return { error: { ok: false, error: "notFound" } };
  if (!EDITABLE.includes(store.status)) return { error: { ok: false, error: "readOnly" } };
  const win = await storeItemWindow();
  if (needWindow && !win.open) return { error: { ok: false, error: "windowClosed" } };
  return { store, seasonYear: win.seasonYear };
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
  stats: { impressions: number; wishListAdds: number };
};

function toRow(item: Record<string, unknown> & { _id: unknown }, isOwner: boolean, discountBps?: number | null): ItemRow {
  const price = item.priceCents as number | undefined;
  const photo = item.photo as { url: string; pathname: string } | undefined;
  const stats = (item.stats ?? {}) as { impressions?: number; wishListAdds?: number };
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
    stats: { impressions: stats.impressions ?? 0, wishListAdds: stats.wishListAdds ?? 0 },
  };
}

/** Everything the items page needs, for the store's current season. */
export async function listStoreItems(actor: StoreActor) {
  const store = await memberStore(actor);
  if (!store) return null;
  const win = await storeItemWindow();
  const isOwner = actor.role === "store_owner";
  // Listed items (drafts + active, never more than the limit) and archived items are loaded
  // separately, so a long archive history can never push drafts out of view (review 2026-11-05).
  const scope = { storeId: store._id, seasonYear: win.seasonYear };
  const [current, archived, count] = await Promise.all([
    Item.find({ ...scope, status: trusted({ $ne: "archived" }) }).sort({ createdAt: 1 }).limit(STORE_ITEM_LIMIT + 10).lean(),
    Item.find({ ...scope, status: "archived" }).sort({ updatedAt: -1 }).limit(100).lean(),
    Item.countDocuments({ ...scope, status: trusted({ $ne: "archived" }) }),
  ]);
  // Drafts first so the owner sees what needs a price.
  const rows = [...current.filter((i) => i.status === "draft"), ...current.filter((i) => i.status !== "draft"), ...archived].map((i) =>
    toRow(i as never, isOwner, store.discountBps),
  );
  return {
    items: rows,
    count,
    limit: STORE_ITEM_LIMIT,
    window: win,
    storeStatus: store.status,
    editable: EDITABLE.includes(store.status),
    isOwner,
    discountBps: isOwner ? (store.discountBps ?? undefined) : undefined,
  };
}

export async function getStoreItem(actor: StoreActor, itemId: string) {
  const store = await memberStore(actor);
  if (!store) return null;
  const item = await Item.findOne({ _id: itemId, storeId: store._id }).lean();
  if (!item) return null;
  const win = await storeItemWindow();
  return {
    item: toRow(item as never, actor.role === "store_owner", store.discountBps),
    window: win,
    editable: EDITABLE.includes(store.status),
    isOwner: actor.role === "store_owner",
  };
}

export async function createItem(actor: StoreActor, input: ItemInput): Promise<ItemResult> {
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  const isOwner = actor.role === "store_owner";
  if (isOwner && input.priceCents == null) return { ok: false, error: "priceRequired" };
  // Bounds create/archive churn (archived items are kept for history).
  if (!(await hitRateLimit(`item-create:store:${g.store._id}`, 100, 86_400))) return { ok: false, error: "rateLimited" };
  const doc = await Item.create({
    storeId: g.store._id,
    seasonYear: g.seasonYear,
    name: input.name,
    description: input.description,
    category: input.category,
    inventory: input.inventory,
    // Reps never set prices: their items wait for the owner.
    ...(isOwner ? { priceCents: input.priceCents, status: "active" } : { status: "draft" }),
  });
  // Limit check AFTER inserting, counting this item: simultaneous adds can't both pass.
  const count = await Item.countDocuments({ storeId: g.store._id, seasonYear: g.seasonYear, status: trusted({ $ne: "archived" }) });
  if (count > STORE_ITEM_LIMIT) {
    await Item.deleteOne({ _id: doc._id });
    return { ok: false, error: "limitReached" };
  }
  await audit(actor.id, "item.create", doc._id, { status: doc.status });
  return { ok: true, itemId: String(doc._id) };
}

export async function updateItem(actor: StoreActor, itemId: string, input: ItemInput): Promise<ItemResult> {
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  const isOwner = actor.role === "store_owner";
  const existing = await Item.findOne({ _id: itemId, storeId: g.store._id, status: trusted({ $ne: "archived" }) }).select("status priceCents").lean();
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
    { _id: itemId, storeId: g.store._id, status: existing.status },
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
  const res = await Item.updateOne({ _id: itemId, storeId: g.store._id, status: trusted({ $ne: "archived" }) }, { $set: { inventory } }, { runValidators: true });
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
  const res = await Item.updateOne({ _id: itemId, storeId: g.store._id, status: trusted({ $ne: "archived" }) }, { $set: { status: "archived" } });
  if (res.matchedCount !== 1) return { ok: false, error: "notFound" };
  await audit(actor.id, "item.archive", itemId);
  return { ok: true, itemId };
}

/** Owner only. Brings an archived item back (if there's room under the limit). */
export async function restoreItem(actor: StoreActor, itemId: string): Promise<ItemResult> {
  if (actor.role !== "store_owner") return { ok: false, error: "notFound" };
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  const item = await Item.findOne({ _id: itemId, storeId: g.store._id, status: "archived" }).select("priceCents seasonYear").lean();
  if (!item) return { ok: false, error: "notFound" };
  const status = item.priceCents ? "active" : "draft";
  await Item.updateOne({ _id: itemId, status: "archived" }, { $set: { status } });
  const count = await Item.countDocuments({ storeId: g.store._id, seasonYear: item.seasonYear, status: trusted({ $ne: "archived" }) });
  if (count > STORE_ITEM_LIMIT) {
    await Item.updateOne({ _id: itemId }, { $set: { status: "archived" } });
    return { ok: false, error: "limitReached" };
  }
  await audit(actor.id, "item.restore", itemId);
  return { ok: true, itemId };
}

/** Set or replace the item's photo (owner or rep). The old file is deleted after the swap. */
export async function setItemPhoto(actor: StoreActor, itemId: string, file: Blob): Promise<ItemResult> {
  const g = await gate(actor, true);
  if ("error" in g) return g.error;
  const storeId = String(g.store._id);
  const exists = await Item.exists({ _id: itemId, storeId, status: trusted({ $ne: "archived" }) });
  if (!exists) return { ok: false, error: "notFound" };
  // Each upload re-encodes an image (CPU) and writes to Blob: shared per-store budget.
  if (!(await hitRateLimit(`photo:items:${storeId}`, 60, 3600))) return { ok: false, error: "rateLimited" };
  let image;
  try {
    image = await uploadPublicImage(file, { folder: "items", ownerId: storeId });
  } catch (err) {
    if (err instanceof ImageUploadError) return { ok: false, error: err.code };
    throw err;
  }
  const before = await Item.findOneAndUpdate(
    { _id: itemId, storeId },
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
  const before = await Item.findOneAndUpdate({ _id: itemId, storeId, status: trusted({ $ne: "archived" }) }, { $unset: { photo: 1 } })
    .select("photo")
    .lean();
  if (!before) return { ok: false, error: "notFound" };
  if (before.photo?.pathname) await deletePublicImage(before.photo.pathname, { folder: "items", ownerId: storeId }).catch(() => {});
  await audit(actor.id, "item.update", itemId, { photo: false });
  return { ok: true, itemId };
}

/** Store discount for the items page (owner only). */
export async function storeDiscount(storeId: string): Promise<number | undefined> {
  const s = await Store.findById(storeId).select("discountBps").lean();
  return s?.discountBps ?? undefined;
}
