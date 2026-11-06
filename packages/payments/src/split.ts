/**
 * Community-donation split (Phase 5 slice 2b). SERVER-ONLY.
 * User decisions 2026-11-06 (CODEMAP "Phase 5"):
 *  - At the season freeze (Dec 1) every pool ("all kids" + each ZIP) is shared ONCE, in EQUAL
 *    shares among REGISTERED kids (a ZIP pool: kids whose family ZIP matches).
 *  - The admin-set platform fee is taken off the top (floor); the rest becomes points at the
 *    server constant ($1.50 = 1 point). Rounding leftovers stay with the platform.
 *  - A ZIP pool with no registered kids rolls into "all kids" (the /donate page says so).
 *  - Gifts recorded after a run stay "held" and are shared by the NEXT run: the cron runs daily
 *    from the freeze to the end of the season, so late gifts are never stranded.
 *
 * Safety:
 *  - Runs only once the season is frozen or closed, and only after an admin chose the fee.
 *  - A Lock document serializes runs (cron + an admin click at the same moment can't both split
 *    the same money). Everything (kid balances, ledger rows, Payments, the DonationSplit record)
 *    changes in ONE transaction: all or nothing.
 *  - Ledger rows carry an idempotency key per (run, pool, kid): a retried write can't double-credit.
 *  - Only the server decides amounts: nothing here comes from a browser.
 */
import "server-only";
import { AuditLog, connectDb, DonationSplit, ensureLock, Family, Kid, Payment, takeLock, Transaction, trusted, withTransaction, type DbSession } from "@repo/db";
import { centsToCentipoints } from "@repo/lib/points";
import { getSeasonState } from "@repo/stores/season";
import { getPlatformSettings } from "./settings.ts";

const LOCK = "donation-split";

export type KidRef = { id: string; familyId: string };
export type HeldPool = { zip: string | null; cents: number; paymentIds: string[] };
export type PoolSummary = Omit<PoolPlan, "recipients" | "paymentIds">;
export type PoolPlan = {
  zip: string | null;
  status: "split" | "rolled" | "tooSmall";
  paymentCount: number;
  totalCents: number;
  feeCents: number;
  kids: number;
  perKidCentipoints: number;
  leftoverCentipoints: number;
  /** Who gets perKidCentipoints (only for status "split"). */
  recipients: KidRef[];
  /** Payments this pool settles (a rolled ZIP's payments are settled by the "all kids" pool). */
  paymentIds: string[];
};

/** Fee off the top (floor), then equal shares in centipoints; leftover = platform. Pure. */
export function shareOf(cents: number, feeBps: number, kids: number): { feeCents: number; per: number; leftover: number } {
  const feeCents = Math.floor((cents * feeBps) / 10_000);
  const netCp = centsToCentipoints(cents - feeCents);
  const per = kids > 0 ? Math.floor(netCp / kids) : 0;
  return { feeCents, per, leftover: netCp - per * kids };
}

/**
 * Plan a split from the held pools and the eligible kids. PURE (unit-tested): no database.
 * `kidsByZip` = registered kids grouped by their family's ZIP; `allKids` = every registered kid.
 */
export function planSplit(pools: HeldPool[], kidsByZip: Map<string, KidRef[]>, allKids: KidRef[], feeBps: number): PoolPlan[] {
  const plans: PoolPlan[] = [];
  const all: HeldPool = { zip: null, cents: 0, paymentIds: [] };
  for (const p of pools) {
    if (p.zip === null) {
      all.cents += p.cents;
      all.paymentIds.push(...p.paymentIds);
      continue;
    }
    const kids = kidsByZip.get(p.zip) ?? [];
    if (kids.length === 0) {
      // No registered kids in this ZIP: the money goes to "all kids" (fee taken there, once).
      plans.push({ zip: p.zip, status: "rolled", paymentCount: p.paymentIds.length, totalCents: p.cents, feeCents: 0, kids: 0, perKidCentipoints: 0, leftoverCentipoints: 0, recipients: [], paymentIds: [] });
      all.cents += p.cents;
      all.paymentIds.push(...p.paymentIds);
      continue;
    }
    plans.push(planOne(p, kids, feeBps));
  }
  if (all.paymentIds.length > 0) plans.push(planOne(all, allKids, feeBps));
  return plans;
}

/** A plan without the recipient list / payment ids (what we store and show). */
const summary = (p: PoolPlan): PoolSummary => ({
  zip: p.zip,
  status: p.status,
  paymentCount: p.paymentCount,
  totalCents: p.totalCents,
  feeCents: p.feeCents,
  kids: p.kids,
  perKidCentipoints: p.perKidCentipoints,
  leftoverCentipoints: p.leftoverCentipoints,
});

function planOne(p: HeldPool, kids: KidRef[], feeBps: number): PoolPlan {
  const { feeCents, per, leftover } = shareOf(p.cents, feeBps, kids.length);
  const ok = per >= 1;
  return {
    zip: p.zip,
    status: ok ? "split" : "tooSmall", // tooSmall: stays held for a later run (more gifts) or the season end
    paymentCount: p.paymentIds.length,
    totalCents: p.cents,
    feeCents: ok ? feeCents : 0,
    kids: kids.length,
    perKidCentipoints: ok ? per : 0,
    leftoverCentipoints: ok ? leftover : 0,
    recipients: ok ? kids : [],
    paymentIds: ok ? p.paymentIds : [],
  };
}

/** Held community donations of a season, grouped by ZIP (null = "all kids"). */
async function heldPools(seasonYear: number, session?: DbSession): Promise<HeldPool[]> {
  const rows = await Payment.find({ purpose: "donation", status: "succeeded", fulfilment: "held", seasonYear })
    .select("zip amountCents")
    .session(session ?? null)
    .lean<{ _id: unknown; zip?: string | null; amountCents: number }[]>();
  const byZip = new Map<string | null, HeldPool>();
  for (const r of rows) {
    const zip = r.zip ?? null;
    const pool = byZip.get(zip) ?? { zip, cents: 0, paymentIds: [] };
    pool.cents += r.amountCents;
    pool.paymentIds.push(String(r._id));
    byZip.set(zip, pool);
  }
  return [...byZip.values()];
}

/** Registered (consent-verified), non-deleted kids, also grouped by their family's ZIP. */
async function eligibleKids(session?: DbSession): Promise<{ all: KidRef[]; byZip: Map<string, KidRef[]> }> {
  const kids = await Kid.find({ archivedAt: null, "registration.status": "registered" })
    .select("_id familyId")
    .session(session ?? null)
    .lean<{ _id: unknown; familyId: unknown }[]>();
  const famIds = [...new Set(kids.map((k) => String(k.familyId)))];
  const fams = await Family.find({ _id: trusted({ $in: famIds }) })
    .select("zip")
    .session(session ?? null)
    .lean<{ _id: unknown; zip?: string | null }[]>();
  const zipOf = new Map(fams.map((f) => [String(f._id), f.zip ?? null]));
  const all: KidRef[] = kids.map((k) => ({ id: String(k._id), familyId: String(k.familyId) }));
  const byZip = new Map<string, KidRef[]>();
  for (const k of all) {
    const zip = zipOf.get(k.familyId);
    if (!zip) continue;
    byZip.set(zip, [...(byZip.get(zip) ?? []), k]);
  }
  return { all, byZip };
}

export type SplitPreview = {
  seasonYear: number;
  canRun: boolean;
  reason?: "notYet" | "feeMissing";
  feeBps: number | null;
  pools: PoolSummary[];
};

/** What a run would do right now (admin page). No writes. */
export async function previewDonationSplit(): Promise<SplitPreview> {
  await connectDb();
  const [season, settings] = await Promise.all([getSeasonState(), getPlatformSettings()]);
  const reason = season.phase !== "frozen" && season.phase !== "closed" ? "notYet" : settings.donationFeeBps === null ? "feeMissing" : undefined;
  const [pools, kids] = await Promise.all([heldPools(season.year), eligibleKids()]);
  const plans = planSplit(pools, kids.byZip, kids.all, settings.donationFeeBps ?? 0);
  return {
    seasonYear: season.year,
    canRun: !reason,
    ...(reason ? { reason } : {}),
    feeBps: settings.donationFeeBps,
    pools: plans.map(summary),
  };
}

export type SplitResult =
  | { ok: true; splitId: string | null; kidsCredited: number; creditedCentipoints: number; totalCents: number; feeCents: number }
  | { ok: false; error: "notYet" | "feeMissing" };

/** Share every held pool of the current season. Safe to call daily: nothing held = nothing done. */
export async function runDonationSplit(opts: { trigger: "cron" | "admin"; adminUserId?: string }): Promise<SplitResult> {
  await connectDb();
  const [season, settings] = await Promise.all([getSeasonState(), getPlatformSettings()]);
  if (season.phase !== "frozen" && season.phase !== "closed") return { ok: false, error: "notYet" };
  const feeBps = settings.donationFeeBps;
  if (feeBps === null) return { ok: false, error: "feeMissing" };
  await ensureLock(LOCK); // outside the transaction (see lock.ts)

  return withTransaction(async (session) => {
    await takeLock(LOCK, session); // one run at a time
    const [pools, kids] = await Promise.all([heldPools(season.year, session), eligibleKids(session)]);
    const plans = planSplit(pools, kids.byZip, kids.all, feeBps);
    const shared = plans.filter((p) => p.status === "split");
    if (shared.length === 0) return { ok: true, splitId: null, kidsCredited: 0, creditedCentipoints: 0, totalCents: 0, feeCents: 0 };

    const totalCents = shared.reduce((s, p) => s + p.totalCents, 0);
    const feeCents = shared.reduce((s, p) => s + p.feeCents, 0);
    const creditedCentipoints = shared.reduce((s, p) => s + p.perKidCentipoints * p.recipients.length, 0);
    const kidsCredited = new Set(shared.flatMap((p) => p.recipients.map((k) => k.id))).size;
    const [split] = await DonationSplit.create(
      [
        {
          seasonYear: season.year,
          trigger: opts.trigger,
          adminUserId: opts.adminUserId,
          feeBps,
          pools: plans.map(summary),
          totalCents,
          feeCents,
          creditedCentipoints,
          kidsCredited,
        },
      ],
      { session },
    );
    const splitId = String(split!._id);

    for (const p of shared) {
      const poolKey = p.zip ?? "all";
      await Transaction.insertMany(
        p.recipients.map((k) => ({
          kidId: k.id,
          familyId: k.familyId,
          seasonYear: season.year,
          type: "earn_donation",
          amountCentipoints: p.perKidCentipoints,
          idempotencyKey: `donation-split:${splitId}:${poolKey}:${k.id}`,
        })),
        { session },
      );
      await Kid.bulkWrite(
        p.recipients.map((k) => ({ updateOne: { filter: { _id: k.id }, update: { $inc: { availableCentipoints: p.perKidCentipoints } } } })),
        { session },
      );
      // Settle exactly the payments planned (still "held": compare-and-set inside the lock).
      await Payment.updateMany({ _id: trusted({ $in: p.paymentIds }), fulfilment: "held" }, { $set: { fulfilment: "credited", splitId } }, { session });
    }
    if (opts.trigger === "admin" && opts.adminUserId) {
      await AuditLog.create(
        [{ actorUserId: opts.adminUserId, action: "donations.split", targetType: "donation_split", targetId: splitId, details: { totalCents, feeCents, kidsCredited } }],
        { session },
      );
    }
    return { ok: true, splitId, kidsCredited, creditedCentipoints, totalCents, feeCents };
  });
}

/** Past runs for the admin page (newest first). */
export async function listDonationSplits(limit = 20) {
  await connectDb();
  const rows = await DonationSplit.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((r) => ({
    id: String(r._id),
    at: r.createdAt,
    trigger: r.trigger,
    feeBps: r.feeBps,
    totalCents: r.totalCents,
    feeCents: r.feeCents,
    kidsCredited: r.kidsCredited,
    creditedCentipoints: r.creditedCentipoints,
  }));
}
