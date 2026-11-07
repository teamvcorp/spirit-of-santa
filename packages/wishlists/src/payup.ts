/**
 * Pay-up window + the drop-off of unfinished gifts (Phase 6 slice 4; year-round slice 5). SERVER-ONLY.
 *
 * Owner decisions (2026-11-06, changed 2026-11-07 for the year-round season: gifts must arrive by Christmas):
 *  - Giving closes at the freeze DATE (Dec 1). Once the community donations are shared out (the split has
 *    LANDED: review 2026-11-07, so parents never pay for what donors would have covered), for PAY_UP_DAYS
 *    (Dec 1-3; a late split still gets its full 3 days after it), a parent may pay the MISSING amount of an unfinished gift ($1.50 per point, the
 *    normal rate) to finish it; it then locks and ships like any other. (Checkout itself lives in
 *    @repo/families/payup: this package can't import @repo/payments, which imports it.)
 *  - When pay-up ends (Dec 4 00:00), every gift still not fully funded DROPS OFF ("unfunded") and the points
 *    already on it go to Spirit of Santa: ledger row "forfeit", the kid's escrow goes down by it.
 *    Nothing is ever taken from points the kid has spare (those are zeroed by the Jan 1 reset).
 */
import "server-only";
import { classifyFailure, LedgerDataError, RowChangedError } from "./ledger-errors.ts";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { cleanHeldDonations, connectDb, DonationSplit, Item, Kid, Payment, Transaction, trusted, WishListItem, withTransaction } from "@repo/db";
import { MIN_STRIPE_CHARGE_CENTS } from "@repo/lib/limits";
import { centipointsToCents } from "@repo/lib/points";
import { calendarDateIn, isoDay, payUpPeriod } from "@repo/lib/season";
import { getSeasonState } from "@repo/stores/season";

/**
 * closesAt = the moment pay-ups stop AND unfinished gifts drop off (START of that day); lastPayDay = the last
 * day a parent can pay (the instant before: show THIS to people, "until December 3"). Admin-set-date aware.
 */
export type PayUpWindow = {
  open: boolean;
  seasonYear: number;
  opensAt: Date;
  closesAt: Date;
  lastPayDay: Date;
  /** Past the freeze date but this season's community share-out hasn't landed (fee missing, run stuck): pay-up and the drop-off WAIT. */
  waitingForSplit: boolean;
};

/**
 * Has this season's community split LANDED? Yes once a run exists and none is still crediting kids, or when
 * nothing was ever held to share. firstAt = the first run (a late one shifts the pay-up days after it).
 * Reads the models directly: @repo/payments imports this package, so no import back (no cycle).
 */
async function splitLanded(seasonYear: number): Promise<{ landed: boolean; firstAt: Date | null }> {
  const [first, crediting, held] = await Promise.all([
    DonationSplit.findOne({ seasonYear }).sort({ createdAt: 1 }).select("createdAt").lean<{ createdAt: Date }>(),
    DonationSplit.exists({ seasonYear, status: "crediting" }),
    Payment.exists(cleanHeldDonations(seasonYear)),
  ]);
  return { landed: !crediting && (Boolean(first) || !held), firstAt: first?.createdAt ?? null };
}

/**
 * Open from the freeze DATE (never the admin's reversible force-freeze switch) for PAY_UP_DAYS (payUpPeriod,
 * @repo/lib/season). Admin-set dates are respected.
 */
export async function payUpWindow(now = new Date()): Promise<PayUpWindow> {
  const s = await getSeasonState(now);
  const period = payUpPeriod(s.dates);
  const t = now.getTime();
  const afterFreeze = t >= period.opensAt.getTime();
  // Before the freeze date nothing to look up (the usual case all year: no extra queries).
  const split = afterFreeze && s.phase !== "closed" ? await splitLanded(s.year) : { landed: afterFreeze, firstAt: null };
  // A split that lands late (e.g. the fee was set on Dec 5) still gives parents PAY_UP_DAYS full days after it.
  const fromSplit = split.firstAt ? payUpPeriod({ freeze: isoDay(calendarDateIn(split.firstAt)) }).closesAt : period.closesAt;
  const closesAt = new Date(Math.max(period.closesAt.getTime(), fromSplit.getTime()));
  return {
    open: s.phase === "frozen" && afterFreeze && split.landed && t < closesAt.getTime(),
    seasonYear: s.year,
    opensAt: period.opensAt,
    closesAt,
    lastPayDay: new Date(closesAt.getTime() - 1),
    waitingForSplit: s.phase === "frozen" && afterFreeze && !split.landed,
  };
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
  if (!window.open) return { window, options: [] }; // the usual case: no family lookups at all
  const fid = await ownFamilyId(parent);
  if (!fid) return { window, options: [] };
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

/** Just the number of unfinished gifts (parent dashboard alert): cheap counts, no names. */
export async function payUpCount(parent: Parent, now = new Date()): Promise<{ window: PayUpWindow; count: number }> {
  const window = await payUpWindow(now);
  if (!window.open) return { window, count: 0 };
  const fid = await ownFamilyId(parent);
  if (!fid) return { window, count: 0 };
  const kids = await Kid.find({ familyId: fid, archivedAt: null, "registration.status": "registered" }).select("_id").lean<{ _id: unknown }[]>();
  if (kids.length === 0) return { window, count: 0 };
  const count = await WishListItem.countDocuments({ kidId: trusted({ $in: kids.map((k) => String(k._id)) }), seasonYear: window.seasonYear, status: "active" });
  return { window, count };
}

/** Money for `missing` centipoints: $1.50/point rounded up, never below Stripe's minimum charge. */
export function payUpCents(missingCentipoints: number): number {
  return Math.max(MIN_STRIPE_CHARGE_CENTS, centipointsToCents(missingCentipoints));
}

/**
 * failed = gifts that failed THIS run (alerts); needsAttention = gifts parked after a failure (their
 * data needs a human, e.g. kid escrow out of sync). Parked gifts are skipped, so one bad record
 * can't fail the daily job forever or crowd out the rest. Clearing closeNeedsAttentionAt retries it.
 */
export type CloseResult = {
  seasons: number[];
  dropped: number;
  forfeitedCentipoints: number;
  failed: number;
  needsAttention: number;
  /** This season's pay-up is over by the calendar but the community share-out hasn't landed: NOTHING dropped (alert). */
  waitingForSplit: boolean;
};

/**
 * Drop-off (daily money job; does nothing before a season's pay-up period has ended, Dec 4): every gift of
 * such a season still "active" (not fully funded) → "unfunded", and its points go to Spirit of Santa.
 * One short transaction per gift (compare-and-set on status + funded amount), so a partial run
 * simply continues the next day. Runs BEFORE the Jan 1 reset in the money job.
 */
export async function closeUnfunded(now = new Date()): Promise<CloseResult> {
  await connectDb();
  const s = await getSeasonState(now);
  // The newest season whose pay-up is over: this one once its (split-aware) pay-up window has ended, at the latest
  // when the season closes (Dec 26: nothing can fill a gift after that anyway); otherwise last year's.
  const win = await payUpWindow(now);
  const pastPayUp = now.getTime() >= win.closesAt.getTime();
  const waitingForSplit = pastPayUp && win.waitingForSplit;
  const lastClosed = s.phase === "closed" || (pastPayUp && !waitingForSplit) ? s.year : s.year - 1;
  const base = { status: "active" as const, seasonYear: trusted({ $lte: lastClosed }) };
  const [rows, needsAttention] = await Promise.all([
    WishListItem.find({ ...base, closeNeedsAttentionAt: null })
      .select("kidId familyId seasonYear fundedCentipoints")
      .sort({ _id: 1 })
      .limit(5000)
      .lean<{ _id: unknown; kidId: unknown; familyId: unknown; seasonYear: number; fundedCentipoints: number }[]>(),
    WishListItem.countDocuments({ ...base, closeNeedsAttentionAt: trusted({ $ne: null }) }),
  ]);
  const result: CloseResult = { seasons: [...new Set(rows.map((r) => r.seasonYear))], dropped: 0, forfeitedCentipoints: 0, failed: 0, needsAttention, waitingForSplit };
  for (const r of rows) {
    try {
      await withTransaction(async (session) => {
        const res = await WishListItem.updateOne(
          { _id: String(r._id), status: "active", fundedCentipoints: r.fundedCentipoints },
          { $set: { status: "unfunded", forfeitedAt: now, forfeitedCentipoints: r.fundedCentipoints } },
          { session },
        );
        if (res.modifiedCount !== 1) throw new RowChangedError("wish list item changed during close");
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
          if (k.modifiedCount !== 1) throw new LedgerDataError("kid escrow out of sync during close");
        }
      });
      result.dropped += 1;
      result.forfeitedCentipoints += r.fundedCentipoints;
    } catch (err) {
      // ledger-errors.ts: park ONLY on bad data; a concurrent change is skipped; a database blip stops this run
      // (tomorrow continues) instead of parking healthy gifts for good (Phase 8 review 2026-11-07).
      const kind = classifyFailure(err);
      if (kind === "changed") continue;
      if (kind === "transient") {
        console.error("[wishlists] close stopped (database unavailable), continues next run:", err instanceof Error ? err.name : "unknown");
        break;
      }
      result.failed += 1;
      result.needsAttention += 1;
      // Park it (outside the failed transaction) so tomorrow's run doesn't fail on it again.
      await WishListItem.updateOne({ _id: String(r._id), status: "active" }, { $set: { closeNeedsAttentionAt: new Date() } }).catch(() => undefined);
      // Error TYPE only: driver messages can contain connection details.
      console.error("[wishlists] close of an unfunded gift failed, parked for a human:", err instanceof Error ? err.name : "unknown");
    }
  }
  return result;
}
