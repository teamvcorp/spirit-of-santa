/**
 * Season end (Phase 5 slice 3), run by the daily money cron. SERVER-ONLY.
 * Roadmap: "Jan 1: unclaimed pooled funds retained by Spirit O Santa; point balances reset to zero".
 *
 * When: only in the OFF-SEASON (from Jan 1 Central Time until the next season opens), once per
 * ended season (SeasonReset record, unique per year). Between Dec 25 and Jan 1 nothing can earn
 * points (tips/bonus/donation links stop at the close, the split stops at the close), so every
 * balance on Jan 1 belongs to the ended season.
 *
 * What:
 *  1. Community-donation gifts of that season still HELD (never shared, e.g. arrived after the last
 *     split or flagged) → fulfilment "retained" (platform), totals on the SeasonReset record.
 *  2. Every kid with available points → a `season_reset` ledger row (amount = the balance) and the
 *     balance set to 0, BATCH kids per transaction. Compare-and-set on the balance: a balance that
 *     changed meanwhile is skipped, never wiped blindly. Idempotency key per (season, kid).
 *     Escrowed points (wish lists) are left to Phase 6.
 * Safe to run every day: a finished season is skipped; an interrupted one is resumed.
 */
import "server-only";
import { connectDb, ensureLock, Kid, Payment, SeasonReset, takeLock, Transaction, trusted, withTransaction } from "@repo/db";
import { getSeasonState } from "@repo/stores/season";

const LOCK = "season-reset";
const BATCH = 500;

export type SeasonEndResult =
  | { ok: true; seasonYear: number; kidsReset: number; centipointsReset: number; retainedCents: number; retainedCount: number }
  | { ok: false; reason: "notOffseason" | "alreadyDone" };

/** `now` is injectable for tests; the cron always uses the real time. */
export async function runSeasonReset(now = new Date()): Promise<SeasonEndResult> {
  await connectDb();
  const season = await getSeasonState(now);
  if (season.phase !== "offseason") return { ok: false, reason: "notOffseason" };
  const ended = season.year - 1;
  const existing = await SeasonReset.findOne({ seasonYear: ended }).select("status").lean();
  if (existing?.status === "done") return { ok: false, reason: "alreadyDone" };
  await ensureLock(LOCK); // outside the transaction (see lock.ts)

  // 1. Record + retain unshared donation money (one transaction, behind the lock).
  await withTransaction(async (session) => {
    await takeLock(LOCK, session);
    await SeasonReset.updateOne({ seasonYear: ended }, { $setOnInsert: { seasonYear: ended, status: "running" } }, { upsert: true, session });
    const held = await Payment.find({ purpose: "donation", fulfilment: "held", seasonYear: ended })
      .select("amountCents")
      .session(session)
      .lean<{ _id: unknown; amountCents: number }[]>();
    if (held.length === 0) return;
    const r = await Payment.updateMany(
      { _id: trusted({ $in: held.map((h) => h._id) }), fulfilment: "held" },
      { $set: { fulfilment: "retained" } },
      { session },
    );
    if (r.modifiedCount !== held.length) throw new Error("retained count mismatch"); // aborts: retried as a whole
    await SeasonReset.updateOne(
      { seasonYear: ended },
      { $inc: { retainedCents: held.reduce((s, h) => s + h.amountCents, 0), retainedCount: held.length } },
      { session },
    );
  });

  // 2. Points to zero, BATCH kids per transaction (cursor by _id: each kid visited once per run).
  let lastId: unknown = null;
  for (;;) {
    const batch = await Kid.find({ availableCentipoints: trusted({ $gt: 0 }), ...(lastId ? { _id: trusted({ $gt: lastId }) } : {}) })
      .select("_id familyId availableCentipoints")
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean<{ _id: unknown; familyId: unknown; availableCentipoints: number }[]>();
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]!._id;
    await withTransaction(async (session) => {
      await takeLock(LOCK, session);
      let kids = 0;
      let cp = 0;
      for (const k of batch) {
        // Compare-and-set: only the exact balance we read is zeroed.
        const res = await Kid.updateOne({ _id: k._id, availableCentipoints: k.availableCentipoints }, { $set: { availableCentipoints: 0 } }, { session });
        if (res.modifiedCount === 0) continue;
        await Transaction.create(
          [
            {
              kidId: String(k._id),
              familyId: String(k.familyId),
              seasonYear: ended,
              type: "season_reset",
              amountCentipoints: k.availableCentipoints,
              idempotencyKey: `season-reset:${ended}:${String(k._id)}:${k.availableCentipoints}`,
            },
          ],
          { session },
        );
        kids++;
        cp += k.availableCentipoints;
      }
      if (kids > 0) await SeasonReset.updateOne({ seasonYear: ended }, { $inc: { kidsReset: kids, centipointsReset: cp } }, { session });
    });
  }

  const done = await SeasonReset.findOneAndUpdate(
    { seasonYear: ended },
    { $set: { status: "done", finishedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  return {
    ok: true,
    seasonYear: ended,
    kidsReset: done?.kidsReset ?? 0,
    centipointsReset: done?.centipointsReset ?? 0,
    retainedCents: done?.retainedCents ?? 0,
    retainedCount: done?.retainedCount ?? 0,
  };
}

/** Last season-end runs for the admin page (newest first). */
export async function listSeasonResets(limit = 5) {
  await connectDb();
  const rows = await SeasonReset.find({}).sort({ seasonYear: -1 }).limit(limit).lean();
  return rows.map((r) => ({
    seasonYear: r.seasonYear,
    status: r.status,
    kidsReset: r.kidsReset,
    centipointsReset: r.centipointsReset,
    retainedCents: r.retainedCents,
    retainedCount: r.retainedCount,
    finishedAt: r.finishedAt ?? null,
  }));
}
