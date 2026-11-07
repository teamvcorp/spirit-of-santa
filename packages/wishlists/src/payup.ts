/**
 * Pay-up window + the Dec 25 close (Phase 6 slice 4). SERVER-ONLY.
 *
 * User decisions 2026-11-06:
 *  - From the Dec 1 freeze DATE until 7 days before the close (Dec 18), a parent may pay the
 *    MISSING amount of an unfinished gift ($1.50 per point, the normal rate) to finish it; it then
 *    locks and ships like any other. (Checkout itself lives in @repo/families/payup: this package
 *    can't import @repo/payments, which imports it.)
 *  - At the close (Dec 25), every gift still not fully funded DROPS OFF ("unfunded") and the points
 *    already on it go to Spirit O Santa: ledger row "forfeit", the kid's escrow goes down by it.
 *    Nothing is ever taken from points the kid has spare (those are zeroed by the Jan 1 reset).
 */
import "server-only";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { connectDb, Item, Kid, Transaction, trusted, WishListItem, withTransaction } from "@repo/db";
import { MIN_STRIPE_CHARGE_CENTS, PAY_UP_CLOSES_DAYS_BEFORE_CLOSE } from "@repo/lib/limits";
import { centipointsToCents } from "@repo/lib/points";
import { startOfDayInZone } from "@repo/lib/season";
import { DAY_MS } from "@repo/lib/time";
import { getSeasonState } from "@repo/stores/season";

export type PayUpWindow = { open: boolean; seasonYear: number; opensAt: Date; closesAt: Date };

/**
 * Open from the freeze DATE (never the admin's reversible force-freeze switch) until
 * PAY_UP_CLOSES_DAYS_BEFORE_CLOSE days before the close date. Admin-set dates are respected.
 */
export async function payUpWindow(now = new Date()): Promise<PayUpWindow> {
  const s = await getSeasonState(now);
  const opensAt = startOfDayInZone(s.dates.freeze);
  const closesAt = new Date(startOfDayInZone(s.dates.close).getTime() - PAY_UP_CLOSES_DAYS_BEFORE_CLOSE * DAY_MS);
  const t = now.getTime();
  return { open: s.phase === "frozen" && t >= opensAt.getTime() && t < closesAt.getTime(), seasonYear: s.year, opensAt, closesAt };
}

export type PayUpOption = {
  wishId: string;
  kidId: string;
  kidName: string;
  itemName: string;
  missingCentipoints: number;
  /** What the parent pays: missing points at $1.50 (rounded up), at least Stripe's minimum. */
  cents: number;
};

/** Unfinished gifts of the parent's REGISTERED kids this season (shown only while the window is open). */
export async function payUpOptions(parent: Parent, now = new Date()): Promise<{ window: PayUpWindow; options: PayUpOption[] }> {
  const window = await payUpWindow(now);
  const fid = await ownFamilyId(parent);
  if (!fid || !window.open) return { window, options: [] };
  await connectDb();
  const kids = await Kid.find({ familyId: fid, archivedAt: null, "registration.status": "registered" }).select("firstName").lean<{ _id: unknown; firstName: string }[]>();
  if (kids.length === 0) return { window, options: [] };
  const rows = await WishListItem.find({ kidId: trusted({ $in: kids.map((k) => String(k._id)) }), seasonYear: window.seasonYear, status: "active" })
    .sort({ createdAt: 1, _id: 1 })
    .limit(200)
    .select("kidId itemId costCentipoints fundedCentipoints")
    .lean<{ _id: unknown; kidId: unknown; itemId: unknown; costCentipoints: number; fundedCentipoints: number }[]>();
  const items = await Item.find({ _id: trusted({ $in: [...new Set(rows.map((r) => String(r.itemId)))] }) }).select("name").lean<{ _id: unknown; name: string }[]>();
  const kidBy = new Map(kids.map((k) => [String(k._id), k.firstName]));
  const itemBy = new Map(items.map((i) => [String(i._id), i.name]));
  return {
    window,
    options: rows.map((r) => {
      const missing = r.costCentipoints - r.fundedCentipoints;
      return { wishId: String(r._id), kidId: String(r.kidId), kidName: kidBy.get(String(r.kidId)) ?? "", itemName: itemBy.get(String(r.itemId)) ?? "", missingCentipoints: missing, cents: payUpCents(missing) };
    }),
  };
}

/** Money for `missing` centipoints: $1.50/point rounded up, never below Stripe's minimum charge. */
export function payUpCents(missingCentipoints: number): number {
  return Math.max(MIN_STRIPE_CHARGE_CENTS, centipointsToCents(missingCentipoints));
}

export type CloseResult = { seasons: number[]; dropped: number; forfeitedCentipoints: number; failed: number };

/**
 * Dec 25 close (daily money job; does nothing before a season's close): every gift of a CLOSED
 * season still "active" (not fully funded) → "unfunded", and its points go to Spirit O Santa.
 * One short transaction per gift (compare-and-set on status + funded amount), so a partial run
 * simply continues the next day. Runs BEFORE the Jan 1 reset in the money job.
 */
export async function closeUnfunded(now = new Date()): Promise<CloseResult> {
  await connectDb();
  const s = await getSeasonState(now);
  // The newest season whose close has passed: this one once closed, otherwise last year's.
  const lastClosed = s.phase === "closed" ? s.year : s.year - 1;
  const rows = await WishListItem.find({ status: "active", seasonYear: trusted({ $lte: lastClosed }) })
    .select("kidId familyId seasonYear fundedCentipoints")
    .limit(5000)
    .lean<{ _id: unknown; kidId: unknown; familyId: unknown; seasonYear: number; fundedCentipoints: number }[]>();
  const result: CloseResult = { seasons: [...new Set(rows.map((r) => r.seasonYear))], dropped: 0, forfeitedCentipoints: 0, failed: 0 };
  for (const r of rows) {
    try {
      await withTransaction(async (session) => {
        const res = await WishListItem.updateOne(
          { _id: String(r._id), status: "active", fundedCentipoints: r.fundedCentipoints },
          { $set: { status: "unfunded", forfeitedAt: now, forfeitedCentipoints: r.fundedCentipoints } },
          { session },
        );
        if (res.modifiedCount !== 1) throw new Error("wish list item changed during close");
        if (r.fundedCentipoints > 0) {
          await Transaction.create(
            [
              {
                kidId: String(r.kidId),
                familyId: String(r.familyId),
                seasonYear: r.seasonYear,
                type: "forfeit",
                amountCentipoints: r.fundedCentipoints,
                wishListItemId: String(r._id),
                // Unique: a retried run can never forfeit the same gift twice.
                idempotencyKey: `forfeit:${String(r._id)}`,
              },
            ],
            { session },
          );
          const k = await Kid.updateOne(
            { _id: String(r.kidId), escrowedCentipoints: trusted({ $gte: r.fundedCentipoints }) },
            { $inc: { escrowedCentipoints: -r.fundedCentipoints } },
            { session },
          );
          // Kid deleted (COPPA deletion removes their list too) or escrow out of sync: stop, don't guess.
          if (k.modifiedCount !== 1) throw new Error("kid escrow out of sync during close");
        }
      });
      result.dropped += 1;
      result.forfeitedCentipoints += r.fundedCentipoints;
    } catch (err) {
      result.failed += 1;
      // Error TYPE only: driver messages can contain connection details.
      console.error("[wishlists] close of an unfunded gift failed (retried next run):", err instanceof Error ? err.name : "unknown");
    }
  }
  return result;
}
