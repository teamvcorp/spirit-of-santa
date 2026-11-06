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
 *  - Runs only while the season is FROZEN (Dec 1-25), and only after an admin chose the fee.
 *  - A Lock document serializes runs (cron + an admin click at the same moment can't both split
 *    the same money). Planning + settling the gifts is ONE short transaction; kids are then
 *    credited in batches of 500 (each its own transaction), resumable if interrupted.
 *  - Ledger rows carry an idempotency key per (run, pool, kid): a retried write can't double-credit.
 *  - Only the server decides amounts: nothing here comes from a browser.
 */
import "server-only";
import { AuditLog, connectDb, DonationSplit, ensureLock, Family, Kid, Payment, takeLock, Transaction, trusted, withTransaction, type DbSession } from "@repo/db";
import { centsToCentipoints } from "@repo/lib/points";
import { getSeasonState } from "@repo/stores/season";
import { sweepAllocations } from "@repo/wishlists/engine";
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

/**
 * Held community donations of a season, grouped by ZIP (null = "all kids"). Gifts that were
 * refunded, disputed or flagged for review are NOT shared (they stay held for an admin): we never
 * hand out points for money we no longer have (review 2026-11-06).
 */
/**
 * THE rule for a held community gift that may be shared (split) or retained (season end): paid,
 * still held, never refunded, not disputed, not flagged. Anything else stays held for an admin.
 * Single source: used by split.ts AND season-end.ts.
 */
export const cleanHeldDonations = (seasonYear: number) => ({
  purpose: "donation" as const,
  status: "succeeded" as const,
  fulfilment: "held" as const,
  seasonYear,
  refundedCents: 0,
  "dispute.stripeDisputeId": null,
  needsReview: trusted({ $ne: true }),
});

async function heldPools(seasonYear: number, session?: DbSession): Promise<HeldPool[]> {
  const rows = await Payment.find(cleanHeldDonations(seasonYear))
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

/** Registered (consent-verified), non-deleted kids, also grouped by their family's ZIP. Sequential reads (one session). */
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
    const list = byZip.get(zip);
    if (list) list.push(k);
    else byZip.set(zip, [k]);
  }
  return { all, byZip };
}

/**
 * Why a split can't run now. Only while the season is FROZEN (Dec 1 → Dec 25): points credited
 * after the close would be wiped by the Jan 1 reset days later (same rule as bonuses). Gifts still
 * held after the close are handled by the season-end job (roadmap: unclaimed pooled funds retained).
 */
function blockedReason(phase: string, feeBps: number | null): "notYet" | "seasonOver" | "feeMissing" | undefined {
  if (phase === "closed") return "seasonOver";
  if (phase !== "frozen") return "notYet";
  if (feeBps === null) return "feeMissing";
  return undefined;
}

export type SplitPreview = {
  seasonYear: number;
  canRun: boolean;
  reason?: "notYet" | "seasonOver" | "feeMissing";
  feeBps: number | null;
  pools: PoolSummary[];
};

/** What a run would do right now (admin page). No writes. With no fee set yet, fee/points are not meaningful (page shows "—"). */
export async function previewDonationSplit(): Promise<SplitPreview> {
  await connectDb();
  const [season, settings] = await Promise.all([getSeasonState(), getPlatformSettings()]);
  const reason = blockedReason(season.phase, settings.donationFeeBps);
  const [pools, kids] = await Promise.all([heldPools(season.year), eligibleKids()]); // no session: parallel is fine
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
  | { ok: true; splitId: string | null; kidsCredited: number; creditedCentipoints: number; totalCents: number; feeCents: number; resumed: number }
  | { ok: false; error: "notYet" | "seasonOver" | "feeMissing"; resumed: number };

/** Kids credited per transaction: small enough to stay well inside MongoDB/Vercel time limits. */
const BATCH = 500;

/**
 * Share every held pool of the current season. Safe to call daily and to retry:
 *  1. FIRST finish any run that was interrupted (e.g. a timeout) — see creditSplit.
 *  2. Plan + settle in ONE short transaction behind the lock: the DonationSplit record (with the
 *     exact recipient list, so a resumed run credits the same kids), the gifts marked credited,
 *     the audit row. Season phase + fee are read AFTER taking the lock (never stale).
 *  3. Credit the kids in batches (creditSplit).
 */
export async function runDonationSplit(opts: { trigger: "cron" | "admin"; adminUserId?: string }): Promise<SplitResult> {
  await connectDb();
  await ensureLock(LOCK); // outside the transaction (see lock.ts)
  let resumed = 0;
  for (const s of await DonationSplit.find({ status: "crediting" }).select("_id").lean()) resumed += await creditSplit(String(s._id));

  type Planned =
    | { reason: "notYet" | "seasonOver" | "feeMissing" }
    | { splitId: string | null; kidsCredited: number; creditedCentipoints: number; totalCents: number; feeCents: number };
  const planned = await withTransaction(async (session): Promise<Planned> => {
    await takeLock(LOCK, session); // one run at a time
    const [season, settings] = await Promise.all([getSeasonState(), getPlatformSettings()]); // own reads, not on the session
    const reason = blockedReason(season.phase, settings.donationFeeBps);
    if (reason) return { reason };
    const feeBps = settings.donationFeeBps!;
    // Sequential: a transaction session must not run operations in parallel.
    const pools = await heldPools(season.year, session);
    const kids = await eligibleKids(session);
    const plans = planSplit(pools, kids.byZip, kids.all, feeBps);
    const shared = plans.filter((p) => p.status === "split");
    if (shared.length === 0) return { splitId: null, kidsCredited: 0, creditedCentipoints: 0, totalCents: 0, feeCents: 0 };

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
          status: "crediting",
          pools: plans.map((p) => ({ ...summary(p), recipients: p.recipients.map((k) => ({ k: k.id, f: k.familyId })) })),
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
      // Settle exactly the payments planned (still "held": compare-and-set inside the lock).
      await Payment.updateMany({ _id: trusted({ $in: p.paymentIds }), fulfilment: "held" }, { $set: { fulfilment: "credited", splitId } }, { session });
    }
    if (opts.trigger === "admin" && opts.adminUserId) {
      await AuditLog.create(
        [{ actorUserId: opts.adminUserId, action: "donations.split", targetType: "donation_split", targetId: splitId, details: { totalCents, feeCents, kidsCredited } }],
        { session },
      );
    }
    return { splitId, kidsCredited, creditedCentipoints, totalCents, feeCents };
  });

  if ("reason" in planned) return { ok: false, error: planned.reason, resumed };
  if (planned.splitId) await creditSplit(planned.splitId);
  // Phase 6: the shared points flow onto each kid's oldest unfunded wish-list item.
  if (planned.splitId || resumed > 0) await sweepAllocations();
  return { ok: true, ...planned, resumed };
}

/**
 * Credit a planned run's kids, BATCH at a time, each batch its own transaction (lock taken so
 * runs/resumes never overlap). Idempotent: a ledger row's unique key (run, pool, kid) says a kid
 * was already credited, so an interrupted run can be finished any number of times without
 * doubling. Returns how many kids were credited now.
 */
async function creditSplit(splitId: string): Promise<number> {
  type Pool = { zip?: string | null; status: string; perKidCentipoints: number; recipients?: { k: unknown; f: unknown }[] };
  const split = await DonationSplit.findById(splitId).select("seasonYear status pools").lean<{ seasonYear: number; status?: string; pools: Pool[] }>();
  if (!split || split.status !== "crediting") return 0;
  let credited = 0;
  for (const pool of split.pools.filter((p) => p.status === "split")) {
    const key = (kidId: string) => `donation-split:${splitId}:${pool.zip ?? "all"}:${kidId}`;
    const recipients = (pool.recipients ?? []).map((r) => ({ kidId: String(r.k), familyId: String(r.f) }));
    for (let i = 0; i < recipients.length; i += BATCH) {
      const chunk = recipients.slice(i, i + BATCH);
      credited += await withTransaction(async (session) => {
        await takeLock(LOCK, session);
        const keys = chunk.map((r) => key(r.kidId));
        const done = new Set(
          (await Transaction.find({ idempotencyKey: trusted({ $in: keys }) }).select("idempotencyKey").session(session).lean()).map((t) => t.idempotencyKey),
        );
        const todo = chunk.filter((r) => !done.has(key(r.kidId)));
        if (todo.length === 0) return 0;
        await Transaction.insertMany(
          todo.map((r) => ({
            kidId: r.kidId,
            familyId: r.familyId,
            seasonYear: split.seasonYear,
            type: "earn_donation",
            amountCentipoints: pool.perKidCentipoints,
            idempotencyKey: key(r.kidId),
          })),
          { session },
        );
        await Kid.bulkWrite(
          todo.map((r) => ({ updateOne: { filter: { _id: r.kidId }, update: { $inc: { availableCentipoints: pool.perKidCentipoints } } } })),
          { session },
        );
        return todo.length;
      });
    }
  }
  await DonationSplit.updateOne({ _id: splitId, status: "crediting" }, { $set: { status: "done" } });
  return credited;
}

/** Past runs for the admin page (newest first). */
export async function listDonationSplits(limit = 20) {
  await connectDb();
  // Without the recipient lists (can be thousands of kids per run).
  const rows = await DonationSplit.find({}).select("-pools.recipients").sort({ createdAt: -1 }).limit(limit).lean();
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
