/**
 * Wish-list points engine (Phase 6 slice 1). SERVER-ONLY. Decisions: CODEMAP "Phase 6" + memory
 * phase6-plan. Every point movement is a ledger row (`escrow` available→item, `release` item→
 * available) written in the SAME transaction as the balances it changes.
 *
 *  - Allocation (allocateForKid): the kid's available points fill their OLDEST unfunded item
 *    first (planAllocation). Runs when an item is added, removed, and inside every credit
 *    transaction (tips/bonuses in the webhook; donation splits via the daily sweep). An item that
 *    reaches 100% → "fully_funded" (30-day lock clock starts) and reserves ONE unit of store stock;
 *    none left → `needsSubstitute` (store/admin find a substitute).
 *  - Add (kid, on the family device, no PIN): season OPEN (no list changes after the Dec 1
 *    freeze), registered kid of this family, active item of an approved store this season, in
 *    stock, not already listed, under the parent's item cap, ≥ 1 available point.
 *  - Remove (parent PIN, checked by the caller): only before the item LOCKS and while the season
 *    is open; escrow comes back and flows on to the next item; a reserved unit goes back to stock.
 *  - Concurrency: every change writes the kid document inside a transaction, so two changes to
 *    one kid conflict and one is retried (MongoDB write conflict) instead of double-spending.
 */
import "server-only";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { connectDb, Item, Kid, Store, Transaction, trusted, WishListItem, withTransaction, type DbSession } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { ITEM_LOCK_DAYS } from "@repo/lib/limits";
import { itemPriceCentsToCentipoints } from "@repo/lib/points";
import { getSeasonState } from "@repo/stores/season";
import { planAllocation } from "./plan.ts";

/** Statuses that count as "on the list" (item cap, no duplicates). */
const ON_LIST = ["active", "fully_funded", "locked", "shipped", "delivered"] as const;
const DAY_MS = 86_400_000;
/** Adding needs at least 1 available point (roadmap). */
const MIN_POINTS_TO_ADD = 100;

/**
 * Move the kid's available points onto their unfunded items, oldest first, inside `session`.
 * Returns centipoints moved. Safe to call any time (nothing available / nothing to fund = no-op).
 */
export async function allocateForKid(kidId: string, session: DbSession, now = new Date()): Promise<number> {
  const kid = await Kid.findById(kidId).select("availableCentipoints familyId").session(session).lean<{ _id: unknown; availableCentipoints: number; familyId: unknown }>();
  if (!kid || kid.availableCentipoints <= 0) return 0;
  const items = await WishListItem.find({ kidId, status: "active" })
    .sort({ createdAt: 1, _id: 1 })
    .select("costCentipoints fundedCentipoints itemId seasonYear")
    .session(session)
    .lean<{ _id: unknown; costCentipoints: number; fundedCentipoints: number; itemId: unknown; seasonYear: number }[]>();
  const { steps } = planAllocation(
    kid.availableCentipoints,
    items.map((i) => ({ id: String(i._id), costCentipoints: i.costCentipoints, fundedCentipoints: i.fundedCentipoints })),
  );
  let moved = 0;
  for (const st of steps) {
    const it = items.find((i) => String(i._id) === st.id)!;
    const res = await WishListItem.updateOne(
      { _id: st.id, status: "active", fundedCentipoints: it.fundedCentipoints },
      { $inc: { fundedCentipoints: st.take }, ...(st.complete ? { $set: { status: "fully_funded", fullyFundedAt: now } } : {}) },
      { session },
    );
    if (res.modifiedCount !== 1) throw new Error("wish list changed during allocation"); // aborts the whole transaction
    await Transaction.create(
      [{ kidId, familyId: String(kid.familyId), seasonYear: it.seasonYear, type: "escrow", amountCentipoints: st.take, wishListItemId: st.id }],
      { session },
    );
    if (st.complete) {
      // Fully funded: reserve one unit of stock now (user decision), or flag for a substitute.
      const took = await Item.updateOne({ _id: String(it.itemId), inventory: trusted({ $gt: 0 }) }, { $inc: { inventory: -1 } }, { session });
      await WishListItem.updateOne({ _id: st.id }, { $set: took.modifiedCount === 1 ? { inventoryReserved: true } : { needsSubstitute: true } }, { session });
    }
    moved += st.take;
  }
  if (moved > 0) {
    const res = await Kid.updateOne(
      { _id: kidId, availableCentipoints: kid.availableCentipoints },
      { $inc: { availableCentipoints: -moved, escrowedCentipoints: moved } },
      { session },
    );
    if (res.modifiedCount !== 1) throw new Error("balance changed during allocation");
  }
  return moved;
}

export type AddResult =
  | { ok: true; wishListItemId: string; fundedCentipoints: number; costCentipoints: number }
  | { ok: false; error: "notFound" | "seasonNotOpen" | "itemUnavailable" | "soldOut" | "alreadyListed" | "cap" | "noPoints" };

/** A kid adds a store item to their list (family device, no PIN). */
export async function addToList(parent: Parent, rawKidId: string, rawItemId: string, now = new Date()): Promise<AddResult> {
  const kidId = normalizeObjectId(rawKidId);
  const itemId = normalizeObjectId(rawItemId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !itemId || !fid) return { ok: false, error: "notFound" };
  await connectDb();
  const season = await getSeasonState(now);
  if (season.phase !== "open") return { ok: false, error: "seasonNotOpen" };

  return withTransaction(async (session): Promise<AddResult> => {
    const kid = await Kid.findOne({ _id: kidId, familyId: fid, archivedAt: null, "registration.status": "registered" })
      .select("availableCentipoints itemCap")
      .session(session)
      .lean<{ availableCentipoints: number; itemCap?: number | null }>();
    if (!kid) return { ok: false, error: "notFound" };
    const item = await Item.findOne({ _id: itemId, status: "active", seasonYear: season.year })
      .select("storeId priceCents inventory")
      .session(session)
      .lean<{ storeId: unknown; priceCents?: number | null; inventory?: number | null }>();
    if (!item || !item.priceCents || !(await Store.exists({ _id: String(item.storeId), status: "approved" }).session(session))) return { ok: false, error: "itemUnavailable" };
    if ((item.inventory ?? 0) <= 0) return { ok: false, error: "soldOut" };
    if (await WishListItem.exists({ kidId, itemId, seasonYear: season.year, status: trusted({ $in: [...ON_LIST] }) }).session(session)) return { ok: false, error: "alreadyListed" };
    const onList = await WishListItem.countDocuments({ kidId, seasonYear: season.year, status: trusted({ $in: [...ON_LIST] }) }).session(session);
    if (onList >= (kid.itemCap ?? 5)) return { ok: false, error: "cap" };
    if (kid.availableCentipoints < MIN_POINTS_TO_ADD) return { ok: false, error: "noPoints" };

    const cost = itemPriceCentsToCentipoints(item.priceCents);
    const [w] = await WishListItem.create(
      [{ kidId, familyId: fid, itemId, storeId: String(item.storeId), seasonYear: season.year, costCentipoints: cost }],
      { session },
    );
    await allocateForKid(kidId, session, now); // writes the kid document → concurrent adds conflict + retry
    const after = await WishListItem.findById(w!._id).select("fundedCentipoints").session(session).lean();
    return { ok: true, wishListItemId: String(w!._id), fundedCentipoints: after?.fundedCentipoints ?? 0, costCentipoints: cost };
  });
}

export type RemoveResult = { ok: true; releasedCentipoints: number } | { ok: false; error: "notFound" | "seasonNotOpen" | "locked" };

/** Parent removes an item (caller checks the PIN). Only before the item locks, while the season is open. */
export async function removeFromList(parent: Parent, rawWishListItemId: string, now = new Date()): Promise<RemoveResult> {
  const id = normalizeObjectId(rawWishListItemId);
  const fid = await ownFamilyId(parent);
  if (!id || !fid) return { ok: false, error: "notFound" };
  await connectDb();
  const season = await getSeasonState(now);
  if (season.phase !== "open") return { ok: false, error: "seasonNotOpen" };

  return withTransaction(async (session): Promise<RemoveResult> => {
    const w = await WishListItem.findOne({ _id: id, familyId: fid })
      .select("kidId itemId status fundedCentipoints inventoryReserved seasonYear")
      .session(session)
      .lean<{ kidId: unknown; itemId: unknown; status: string; fundedCentipoints: number; inventoryReserved?: boolean; seasonYear: number }>();
    if (!w || (w.status !== "active" && w.status !== "fully_funded")) {
      return { ok: false, error: w && ["locked", "shipped", "delivered"].includes(w.status) ? "locked" : "notFound" };
    }
    const kidId = String(w.kidId);
    const res = await WishListItem.updateOne({ _id: id, status: w.status, fundedCentipoints: w.fundedCentipoints }, { $set: { status: "removed", removedAt: now } }, { session });
    if (res.modifiedCount !== 1) throw new Error("wish list item changed during removal");
    if (w.fundedCentipoints > 0) {
      const k = await Kid.updateOne(
        { _id: kidId, escrowedCentipoints: trusted({ $gte: w.fundedCentipoints }) },
        { $inc: { availableCentipoints: w.fundedCentipoints, escrowedCentipoints: -w.fundedCentipoints } },
        { session },
      );
      if (k.modifiedCount !== 1) throw new Error("escrow balance mismatch");
      await Transaction.create([{ kidId, familyId: fid, seasonYear: w.seasonYear, type: "release", amountCentipoints: w.fundedCentipoints, wishListItemId: id }], { session });
    }
    if (w.inventoryReserved) await Item.updateOne({ _id: String(w.itemId) }, { $inc: { inventory: 1 } }, { session }); // unit back to the store
    await allocateForKid(kidId, session, now); // released points flow to the next oldest item
    return { ok: true, releasedCentipoints: w.fundedCentipoints };
  });
}

/** Daily: fully funded for ITEM_LOCK_DAYS → locked (can't be removed any more). */
export async function lockFundedItems(now = new Date()): Promise<number> {
  await connectDb();
  const res = await WishListItem.updateMany(
    { status: "fully_funded", fullyFundedAt: trusted({ $lte: new Date(now.getTime() - ITEM_LOCK_DAYS * DAY_MS) }) },
    { $set: { status: "locked", lockedAt: now } },
  );
  return res.modifiedCount;
}

/**
 * Daily safety net (and right after a donation split): any kid with available points AND
 * unfunded items gets them allocated. One transaction per kid; one failure doesn't stop the rest.
 */
export async function sweepAllocations(now = new Date()): Promise<{ kids: number; moved: number; failed: number }> {
  await connectDb();
  const kidIds = (await WishListItem.distinct("kidId", { status: "active" })) as unknown[];
  const funded = await Kid.find({ _id: trusted({ $in: kidIds }), availableCentipoints: trusted({ $gt: 0 }) }).select("_id").limit(5000).lean();
  let moved = 0;
  let failed = 0;
  for (const k of funded) {
    try {
      moved += await withTransaction((session) => allocateForKid(String(k._id), session, now));
    } catch (err) {
      failed++;
      console.error("[wishlist] sweep failed for a kid:", err instanceof Error ? err.name : "unknown");
    }
  }
  return { kids: funded.length, moved, failed };
}
