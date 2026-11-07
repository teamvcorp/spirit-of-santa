/**
 * Wish-list points engine (Phase 6 slice 1). SERVER-ONLY. Decisions: CODEMAP "Phase 6" + memory
 * phase6-plan. Every point movement is a ledger row (`escrow` available→item, `release` item→
 * available) written in the SAME transaction as the balances it changes.
 *
 *  - Allocation (allocateForKid): the kid's available points fill their OLDEST unfunded item
 *    first (planAllocation). Runs when an item is added, removed, and inside every credit
 *    transaction (tips/bonuses in the webhook; donation splits via the daily sweep). An item that
 *    reaches 100% → "fully_funded" (secured: no longer removable; locked at the next daily job) and reserves ONE unit of store stock;
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
import {
  connectDb,
  Item,
  Kid,
  Store,
  Transaction,
  trusted,
  WishListItem,
  withTransaction,
  type DbSession,
} from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { MIN_CENTIPOINTS_TO_ADD_ITEM } from "@repo/lib/limits";
import { itemPriceCentsToCentipoints } from "@repo/lib/points";
import { getSeasonState } from "@repo/stores/season";
import { planAllocation } from "./plan.ts";
import { CAP_STATUSES, isRemovable } from "./rules.ts";
import { classifyFailure, LedgerDataError, RowChangedError } from "./ledger-errors.ts";


/**
 * Points move onto items only while the season is OPEN or FROZEN (December tips + the Dec 1
 * donation split still fill lists), and only onto THIS season's items. After the close
 * (Dec 25) nothing moves: leftover available points are zeroed by the Jan 1 reset instead of
 * slipping into escrow, and last season's unfinished items never absorb next season's points
 * (review 2026-11-06). Escrow already on unfinished items at Dec 25 → slice 4 (unfunded + pay-up).
 */
async function fundingSeason(now: Date): Promise<number | null> {
  const s = await getSeasonState(now);
  return s.phase === "open" || s.phase === "frozen" ? s.year : null;
}

/**
 * Move the kid's available points onto their unfunded items, oldest first, inside `session`.
 * Returns centipoints moved. Safe to call any time: outside open/frozen, or nothing to fund = no-op.
 * `firstId` (pay-ups): fill THAT item first, then the rest oldest first (the parent paid for it).
 */
export async function allocateForKid(
  kidId: string,
  session: DbSession,
  now = new Date(),
  firstId?: string,
): Promise<number> {
  const seasonYear = await fundingSeason(now);
  if (seasonYear === null) return 0;
  const kid = await Kid.findById(kidId)
    .select("availableCentipoints familyId")
    .session(session)
    .lean<{ _id: unknown; availableCentipoints: number; familyId: unknown }>();
  if (!kid || kid.availableCentipoints <= 0) return 0;
  const items = await WishListItem.find({ kidId, status: "active", seasonYear })
    .sort({ createdAt: 1, _id: 1 })
    .select("costCentipoints fundedCentipoints itemId seasonYear")
    .session(session)
    .lean<
      {
        _id: unknown;
        costCentipoints: number;
        fundedCentipoints: number;
        itemId: unknown;
        seasonYear: number;
      }[]
    >();
  // Stable sort: the paid-for item moves to the front, everything else keeps its oldest-first order.
  if (firstId) items.sort((a, b) => Number(String(b._id) === firstId) - Number(String(a._id) === firstId));
  const { steps } = planAllocation(
    kid.availableCentipoints,
    items.map((i) => ({
      id: String(i._id),
      costCentipoints: i.costCentipoints,
      fundedCentipoints: i.fundedCentipoints,
    })),
  );
  let moved = 0;
  for (const st of steps) {
    const it = items.find((i) => String(i._id) === st.id)!;
    const res = await WishListItem.updateOne(
      { _id: st.id, status: "active", fundedCentipoints: it.fundedCentipoints },
      {
        $inc: { fundedCentipoints: st.take },
        ...(st.complete
          ? { $set: { status: "fully_funded", fullyFundedAt: now } }
          : {}),
      },
      { session },
    );
    if (res.modifiedCount !== 1)
      throw new Error("wish list changed during allocation"); // aborts the whole transaction
    await Transaction.create(
      [
        {
          kidId,
          familyId: String(kid.familyId),
          seasonYear: it.seasonYear,
          type: "escrow",
          amountCentipoints: st.take,
          wishListItemId: st.id,
        },
      ],
      { session },
    );
    if (st.complete) {
      // Fully funded: reserve one unit of stock now (user decision), or flag for a substitute.
      const took = await Item.updateOne(
        { _id: String(it.itemId), inventory: trusted({ $gt: 0 }) },
        { $inc: { inventory: -1 } },
        { session },
      );
      await WishListItem.updateOne(
        { _id: st.id },
        {
          $set:
            took.modifiedCount === 1
              ? { inventoryReserved: true }
              : { needsSubstitute: true },
        },
        { session },
      );
    }
    moved += st.take;
  }
  if (moved > 0) {
    const res = await Kid.updateOne(
      { _id: kidId, availableCentipoints: kid.availableCentipoints },
      { $inc: { availableCentipoints: -moved, escrowedCentipoints: moved } },
      { session },
    );
    if (res.modifiedCount !== 1)
      throw new Error("balance changed during allocation");
  }
  return moved;
}

/** Thrown inside a transaction to roll it back when the season froze mid-request. */
class SeasonChanged extends Error {}

export type AddResult =
  | {
      ok: true;
      wishListItemId: string;
      fundedCentipoints: number;
      costCentipoints: number;
    }
  | {
      ok: false;
      error:
        | "notFound"
        | "seasonNotOpen"
        | "itemUnavailable"
        | "soldOut"
        | "alreadyListed"
        | "cap"
        | "noPoints";
    };

/** A kid adds a store item to their list (family device, no PIN). */
export async function addToList(
  parent: Parent,
  rawKidId: string,
  rawItemId: string,
  now = new Date(),
): Promise<AddResult> {
  const kidId = normalizeObjectId(rawKidId);
  const itemId = normalizeObjectId(rawItemId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !itemId || !fid) return { ok: false, error: "notFound" };
  await connectDb();
  const season = await getSeasonState(now);
  if (season.phase !== "open") return { ok: false, error: "seasonNotOpen" };

  try {
    return await withTransaction(async (session): Promise<AddResult> => {
      const kid = await Kid.findOne({
        _id: kidId,
        familyId: fid,
        archivedAt: null,
        "registration.status": "registered",
      })
        .select("availableCentipoints itemCap")
        .session(session)
        .lean<{ availableCentipoints: number; itemCap?: number | null }>();
      if (!kid) return { ok: false, error: "notFound" };
      const item = await Item.findOne({
        _id: itemId,
        status: "active",
        seasonYear: season.year,
      })
        .select("storeId priceCents inventory")
        .session(session)
        .lean<{
          storeId: unknown;
          priceCents?: number | null;
          inventory?: number | null;
        }>();
      if (
        !item ||
        !item.priceCents ||
        !(await Store.exists({
          _id: String(item.storeId),
          status: "approved",
        }).session(session))
      )
        return { ok: false, error: "itemUnavailable" };
      if ((item.inventory ?? 0) <= 0) return { ok: false, error: "soldOut" };
      if (
        await WishListItem.exists({
          kidId,
          itemId,
          seasonYear: season.year,
          status: trusted({ $in: [...CAP_STATUSES] }),
        }).session(session)
      )
        return { ok: false, error: "alreadyListed" };
      const onList = await WishListItem.countDocuments({
        kidId,
        seasonYear: season.year,
        status: trusted({ $in: [...CAP_STATUSES] }),
      }).session(session);
      if (onList >= (kid.itemCap ?? 5)) return { ok: false, error: "cap" };
      if (kid.availableCentipoints < MIN_CENTIPOINTS_TO_ADD_ITEM)
        return { ok: false, error: "noPoints" };

      const cost = itemPriceCentsToCentipoints(item.priceCents);
      const [w] = await WishListItem.create(
        [
          {
            kidId,
            familyId: fid,
            itemId,
            storeId: String(item.storeId),
            seasonYear: season.year,
            costCentipoints: cost,
          },
        ],
        { session },
      );
      await allocateForKid(kidId, session, now); // writes the kid document → concurrent adds conflict + retry
      if ((await getSeasonState(new Date())).phase !== "open")
        throw new SeasonChanged(); // freeze landed mid-request: undo
      const after = await WishListItem.findById(w!._id)
        .select("fundedCentipoints")
        .session(session)
        .lean();
      return {
        ok: true,
        wishListItemId: String(w!._id),
        fundedCentipoints: after?.fundedCentipoints ?? 0,
        costCentipoints: cost,
      };
    });
  } catch (err) {
    if (err instanceof SeasonChanged)
      return { ok: false, error: "seasonNotOpen" };
    throw err;
  }
}

/** A gift row as releaseGiftInSession needs it. */
export type ReleasableGift = {
  _id: unknown;
  kidId: unknown;
  familyId: unknown;
  itemId: unknown;
  /** Only gifts not yet locked can be released. */
  status: "active" | "fully_funded";
  fundedCentipoints: number;
  inventoryReserved?: boolean | null;
  seasonYear: number;
};

/**
 * THE one way a not-yet-locked gift leaves a wish list (shared by the parent's "Remove" and account/child
 * deletion, Phase 8): status → removed, its points back from escrow to available (ledger "release"), and a
 * unit the store set aside goes back to the store's stock. Runs inside the caller's transaction; the caller
 * decides what happens to the released points next (re-allocate to the next gift, or forfeit on deletion).
 * Compare-and-set on status + funded amount: throws if the row changed meanwhile (the transaction retries).
 */
export async function releaseGiftInSession(w: ReleasableGift, session: DbSession, now = new Date()): Promise<void> {
  const id = String(w._id);
  const kidId = String(w.kidId);
  const res = await WishListItem.updateOne(
    { _id: id, status: w.status, fundedCentipoints: w.fundedCentipoints },
    { $set: { status: "removed", removedAt: now } },
    { session },
  );
  if (res.modifiedCount !== 1) throw new Error("wish list item changed during removal");
  if (w.fundedCentipoints > 0) {
    const k = await Kid.updateOne(
      { _id: kidId, escrowedCentipoints: trusted({ $gte: w.fundedCentipoints }) },
      { $inc: { availableCentipoints: w.fundedCentipoints, escrowedCentipoints: -w.fundedCentipoints } },
      { session },
    );
    if (k.modifiedCount !== 1) throw new Error("escrow balance mismatch");
    await Transaction.create(
      [{ kidId, familyId: String(w.familyId), seasonYear: w.seasonYear, type: "release", amountCentipoints: w.fundedCentipoints, wishListItemId: id }],
      { session },
    );
  }
  if (w.inventoryReserved) await Item.updateOne({ _id: String(w.itemId) }, { $inc: { inventory: 1 } }, { session }); // unit back to the store
}

export type RemoveResult =
  | { ok: true; releasedCentipoints: number; kidId: string }
  | { ok: false; error: "notFound" | "seasonNotOpen" | "locked" };

/** Parent removes an item (caller checks the PIN). Only before the item locks, while the season is open. */
export async function removeFromList(
  parent: Parent,
  rawWishListItemId: string,
  now = new Date(),
): Promise<RemoveResult> {
  const id = normalizeObjectId(rawWishListItemId);
  const fid = await ownFamilyId(parent);
  if (!id || !fid) return { ok: false, error: "notFound" };
  await connectDb();
  const season = await getSeasonState(now);
  if (season.phase !== "open") return { ok: false, error: "seasonNotOpen" };

  try {
    return await withTransaction(async (session): Promise<RemoveResult> => {
      const w = await WishListItem.findOne({ _id: id, familyId: fid })
        .select(
          "kidId itemId status fundedCentipoints inventoryReserved seasonYear fullyFundedAt",
        )
        .session(session)
        .lean<{
          kidId: unknown;
          itemId: unknown;
          status: string;
          fundedCentipoints: number;
          inventoryReserved?: boolean;
          seasonYear: number;
          fullyFundedAt?: Date | null;
        }>();
      // Shared rule: only "active" gifts come off. Fully funded = secured (locks at the next daily job).
      if (!w || !isRemovable(w.status)) {
        return {
          ok: false,
          error:
            w && ["fully_funded", "locked", "shipped", "delivered"].includes(w.status)
              ? "locked"
              : "notFound",
        };
      }
      const kidId = String(w.kidId);
      // Status narrowed by the check above (only "active" reaches here).
      await releaseGiftInSession({ ...w, status: "active", _id: id, familyId: fid }, session, now);
      await allocateForKid(kidId, session, now); // released points flow to the next oldest item
      if ((await getSeasonState(new Date())).phase !== "open")
        throw new SeasonChanged(); // freeze landed mid-request: undo
      return { ok: true, releasedCentipoints: w.fundedCentipoints, kidId };
    });
  } catch (err) {
    if (err instanceof SeasonChanged)
      return { ok: false, error: "seasonNotOpen" };
    throw err;
  }
}

/** A gift picked for locking. */
type LockCandidate = { _id: unknown; kidId: unknown; familyId: unknown; seasonYear: number; fundedCentipoints: number; costCentipoints: number };

/**
 * failed = gifts parked THIS run (data problems: alert); needsAttention = all gifts parked so far (a human must
 * fix their data, then clear lockNeedsAttentionAt); remaining = gifts left for the next run (time budget used
 * up, or the database was briefly unreachable).
 */
export type LockResult = { locked: number; spentCentipoints: number; failed: number; needsAttention: number; remaining: number };

/** Gifts per run (a partial run just continues the next day) and the run's time budget (cron limit is 300 s). */
const LOCK_BATCH = 5000;
const LOCK_TIME_BUDGET_MS = 120_000;

/**
 * Lock these gifts of ONE kid and SPEND their magic, inside the caller's transaction (Phase 8, owner decision
 * 2026-11-07: "record magic as spend or we will be spending the same money twice").
 * Per gift: compare-and-set fully_funded → locked, plus one ledger "spend" row with the unique key
 * `spend:<giftId>` (the database refuses a second one, so a gift can never be spent twice: cron retries, two
 * runs at once, the one-off correction script). Then the kid's escrow goes down by the total, guarded so it can
 * never go negative. A spend is FINAL: there is no "unspend" (after lock the money and present are secured).
 */
export async function lockGiftsInSession(gifts: LockCandidate[], session: DbSession, now: Date): Promise<number> {
  const kidId = String(gifts[0]!.kidId);
  let total = 0;
  for (const w of gifts) {
    const id = String(w._id);
    const f = w.fundedCentipoints;
    // A gift is only ever fully_funded when funded === cost (planAllocation); anything else is bad data.
    if (f < 1 || f !== w.costCentipoints) throw new LedgerDataError("lock: funded != cost");
    const res = await WishListItem.updateOne(
      { _id: id, status: "fully_funded", fundedCentipoints: f, costCentipoints: f },
      { $set: { status: "locked", lockedAt: now } },
      { session },
    );
    if (res.modifiedCount !== 1) throw new RowChangedError("gift changed during lock");
    await Transaction.create(
      [{ kidId, familyId: String(w.familyId), seasonYear: w.seasonYear, type: "spend", amountCentipoints: f, wishListItemId: id, idempotencyKey: `spend:${id}` }],
      { session },
    );
    total += f;
  }
  const k = await Kid.updateOne({ _id: kidId, escrowedCentipoints: trusted({ $gte: total }) }, { $inc: { escrowedCentipoints: -total } }, { session });
  // Kid missing (deleted) or escrow lower than what these gifts hold: the records disagree. Don't guess.
  if (k.modifiedCount !== 1) throw new LedgerDataError("kid escrow out of sync during lock");
  return total;
}

/**
 * Daily: EVERY fully funded item → LOCKED and its magic SPENT (owner 2026-11-07, year-round season:
 * "lock when secured"). Locked does NOT mean "ship now": the store HOLDS it until the December ship
 * window (canShipGift in @repo/lib/season, used by fulfilment). Not done inside allocateForKid on purpose:
 * that would put spend + ledger writes inside every credit transaction. Removal is already refused from
 * the moment a gift is fully funded (isRemovable), so the gap until this job runs changes nothing.
 *
 * One transaction per KID (freeze day locks thousands of gifts: per kid is about 5x fewer round trips and
 * free of write conflicts on the same kid), within a time budget so the rest of the daily job still runs.
 * If a kid's group fails, its gifts are retried ONE BY ONE so only a bad gift is parked.
 */
export async function lockFundedItems(now = new Date(), opts: { timeBudgetMs?: number } = {}): Promise<LockResult> {
  await connectDb();
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > (opts.timeBudgetMs ?? LOCK_TIME_BUDGET_MS);
  const base = { status: "fully_funded" as const };
  const [rows, needsAttention] = await Promise.all([
    WishListItem.find({ ...base, lockNeedsAttentionAt: null })
      .select("kidId familyId seasonYear fundedCentipoints costCentipoints")
      .sort({ kidId: 1, _id: 1 })
      .limit(LOCK_BATCH)
      .lean<LockCandidate[]>(),
    WishListItem.countDocuments({ ...base, lockNeedsAttentionAt: trusted({ $ne: null }) }),
  ]);
  const out: LockResult = { locked: 0, spentCentipoints: 0, failed: 0, needsAttention, remaining: 0 };
  // A full batch means more are waiting (freeze day): count them so `remaining` tells the truth.
  if (rows.length === LOCK_BATCH) out.remaining += Math.max(0, (await WishListItem.countDocuments({ ...base, lockNeedsAttentionAt: null })) - rows.length);
  const byKid = new Map<string, LockCandidate[]>();
  for (const r of rows) byKid.set(String(r.kidId), [...(byKid.get(String(r.kidId)) ?? []), r]);
  const groups = [...byKid.values()];
  const left = (from: number) => groups.slice(from).reduce((n, x) => n + x.length, 0);

  for (let g = 0; g < groups.length; g++) {
    const gifts = groups[g]!;
    if (outOfTime()) {
      out.remaining += left(g);
      break;
    }
    try {
      // Counted only AFTER the commit (a retried transaction callback must not count twice).
      const spent = await withTransaction((session) => lockGiftsInSession(gifts, session, now));
      out.locked += gifts.length;
      out.spentCentipoints += spent;
      continue;
    } catch (err) {
      if (classifyFailure(err) === "transient") {
        console.error("[wishlists] lock stopped (database unavailable), continues next run:", err instanceof Error ? err.name : "unknown");
        out.remaining += left(g);
        break;
      }
    }
    // Bad data or a concurrent change somewhere in this kid's group: one gift at a time.
    for (const r of gifts) {
      try {
        const spent = await withTransaction((session) => lockGiftsInSession([r], session, now));
        out.locked += 1;
        out.spentCentipoints += spent;
      } catch (err) {
        const kind = classifyFailure(err);
        if (kind === "changed") continue; // removed / deleted meanwhile: nothing to do
        if (kind === "transient") {
          out.remaining += 1;
          continue;
        }
        // Error TYPE only: driver messages can contain connection details.
        console.error("[wishlists] lock+spend failed, gift parked for a human:", err instanceof Error ? err.name : "unknown");
        out.failed += 1;
        out.needsAttention += 1;
        await WishListItem.updateOne({ _id: String(r._id), status: "fully_funded" }, { $set: { lockNeedsAttentionAt: new Date() } }).catch(() => undefined);
      }
    }
  }
  return out;
}

/**
 * Daily safety net (and right after a donation split): any kid with available points AND
 * unfunded items gets them allocated. One transaction per kid; one failure doesn't stop the rest.
 */
export async function sweepAllocations(
  now = new Date(),
): Promise<{ kids: number; moved: number; failed: number }> {
  await connectDb();
  const seasonYear = await fundingSeason(now);
  if (seasonYear === null) return { kids: 0, moved: 0, failed: 0 };
  // Kids with spare points (few: allocation is eager), then only those with an unfunded item.
  const withPoints = await Kid.find({
    availableCentipoints: trusted({ $gt: 0 }),
    archivedAt: null,
  })
    .select("_id")
    .limit(5000)
    .lean();
  const funded: typeof withPoints = [];
  for (const k of withPoints)
    if (
      await WishListItem.exists({
        kidId: String(k._id),
        seasonYear,
        status: "active",
      })
    )
      funded.push(k);
  let moved = 0;
  let failed = 0;
  for (const k of funded) {
    try {
      moved += await withTransaction((session) =>
        allocateForKid(String(k._id), session, now),
      );
    } catch (err) {
      failed++;
      console.error(
        "[wishlist] sweep failed for a kid:",
        err instanceof Error ? err.name : "unknown",
      );
    }
  }
  return { kids: funded.length, moved, failed };
}
