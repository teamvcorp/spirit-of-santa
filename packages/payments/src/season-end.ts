/**
 * Season end (Phase 5 slice 3), run by the daily money cron AFTER the split. SERVER-ONLY.
 * Roadmap: "Jan 1: unclaimed pooled funds retained by Spirit of Santa; point balances reset to zero".
 *
 * When: only in the OFF-SEASON (from Jan 1 Central Time until the next season opens), once per
 * ended season (SeasonReset record, unique per year), and NEVER while a donation split is still
 * crediting kids (that run must finish first, or kids would get points after being zeroed).
 * Between Dec 25 and Jan 1 nothing earns points, so every balance on Jan 1 belongs to the ended
 * season.
 *
 * What:
 *  1. Clean held community gifts of that season (cleanHeldDonations: the SAME rule as the split)
 *     → fulfilment "retained" (platform), totals on the SeasonReset record. Refunded / disputed /
 *     flagged gifts stay held for an admin and are not counted.
 *  2. Every kid with points → a `season_reset` ledger row (= the balance) and balance 0, BATCH kids
 *     per transaction. Inside the transaction the balances are re-read on the session, so a
 *     concurrent change aborts and retries the batch (no blind wipe). Ledger key per (season, kid).
 *  3. Marked "done" (inside the lock) only once NO kid has points left; otherwise it stays
 *     "running" and the next run continues. Escrowed points are NOT reset here: by Jan 1 a gift's escrow has
 *     left through spend (locked, Phase 8), forfeit (Dec 25 close) or release. What remains is only escrow of
 *     gifts PARKED for a human (bad data), and the daily money job keeps failing loudly while any exist.
 */
import "server-only";
import { connectDb, DonationSplit, ensureLock, Kid, Payment, SeasonReset, takeLock, Transaction, trusted, withTransaction } from "@repo/db";
import { getSeasonState } from "@repo/stores/season";
import { cleanHeldDonations } from "./split.ts";

const LOCK = "season-reset";
const BATCH = 500;
const resetKey = (season: number, kidId: string) => `season-reset:${season}:${kidId}`;

export type SeasonEndResult =
  | { ok: true; seasonYear: number; done: boolean; kidsReset: number; centipointsReset: number; retainedCents: number; retainedCount: number }
  | { ok: false; reason: "notOffseason" | "alreadyDone" | "splitUnfinished" };

/** `now` is injectable for tests; the cron always uses the real time. */
export async function runSeasonReset(now = new Date()): Promise<SeasonEndResult> {
  await connectDb();
  const season = await getSeasonState(now);
  if (season.phase !== "offseason") return { ok: false, reason: "notOffseason" };
  const ended = season.year - 1;
  const existing = await SeasonReset.findOne({ seasonYear: ended }).select("status").lean();
  if (existing?.status === "done") return { ok: false, reason: "alreadyDone" };
  // A split still crediting kids must finish first (the cron runs the split BEFORE this).
  if (await DonationSplit.exists({ status: "crediting" })) return { ok: false, reason: "splitUnfinished" };
  await ensureLock(LOCK); // outside the transaction (see lock.ts)

  // 1. Record + retain unshared, clean donation money (one transaction, behind the lock).
  await withTransaction(async (session) => {
    await takeLock(LOCK, session);
    await SeasonReset.updateOne({ seasonYear: ended }, { $setOnInsert: { seasonYear: ended, status: "running" } }, { upsert: true, session });
    const held = await Payment.find(cleanHeldDonations(ended)).select("amountCents").session(session).lean<{ _id: unknown; amountCents: number }[]>();
    if (held.length === 0) return;
    const r = await Payment.updateMany({ _id: trusted({ $in: held.map((h) => h._id) }), fulfilment: "held" }, { $set: { fulfilment: "retained" } }, { session });
    if (r.modifiedCount !== held.length) throw new Error("retained count mismatch"); // aborts: retried as a whole
    await SeasonReset.updateOne({ seasonYear: ended }, { $inc: { retainedCents: held.reduce((s, h) => s + h.amountCents, 0), retainedCount: held.length } }, { session });
  });

  // 2. Points to zero, BATCH kids per transaction (cursor by _id; kids already reset this season
  //    are skipped and left for an admin: a second reset row would hide a problem).
  let lastId: unknown = null;
  for (;;) {
    const ids = await Kid.find({ availableCentipoints: trusted({ $gt: 0 }), ...(lastId ? { _id: trusted({ $gt: lastId }) } : {}) })
      .select("_id")
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean<{ _id: unknown }[]>();
    if (ids.length === 0) break;
    lastId = ids[ids.length - 1]!._id;
    await withTransaction(async (session) => {
      await takeLock(LOCK, session);
      // Re-read ON THE SESSION: a concurrent change to these kids aborts + retries this batch.
      const kids = await Kid.find({ _id: trusted({ $in: ids.map((k) => k._id) }), availableCentipoints: trusted({ $gt: 0 }) })
        .select("_id familyId availableCentipoints")
        .session(session)
        .lean<{ _id: unknown; familyId: unknown; availableCentipoints: number }[]>();
      const already = new Set(
        (await Transaction.find({ idempotencyKey: trusted({ $in: kids.map((k) => resetKey(ended, String(k._id))) }) }).select("idempotencyKey").session(session).lean()).map(
          (t) => t.idempotencyKey,
        ),
      );
      const todo = kids.filter((k) => !already.has(resetKey(ended, String(k._id))));
      if (todo.length === 0) return;
      const res = await Kid.bulkWrite(
        todo.map((k) => ({ updateOne: { filter: { _id: String(k._id), availableCentipoints: k.availableCentipoints }, update: { $set: { availableCentipoints: 0 } } } })),
        { session },
      );
      if (res.matchedCount !== todo.length) throw new Error("balance changed during reset"); // abort + retry the batch
      await Transaction.insertMany(
        todo.map((k) => ({
          kidId: String(k._id),
          familyId: String(k.familyId),
          seasonYear: ended,
          type: "season_reset",
          amountCentipoints: k.availableCentipoints,
          idempotencyKey: resetKey(ended, String(k._id)),
        })),
        { session },
      );
      await SeasonReset.updateOne(
        { seasonYear: ended },
        { $inc: { kidsReset: todo.length, centipointsReset: todo.reduce((s, k) => s + k.availableCentipoints, 0) } },
        { session },
      );
    });
  }

  // 3. Done only if no kid has points left (inside the lock).
  const done = await withTransaction(async (session) => {
    await takeLock(LOCK, session);
    if (await Kid.exists({ availableCentipoints: trusted({ $gt: 0 }) }).session(session)) return false;
    await SeasonReset.updateOne({ seasonYear: ended, status: "running" }, { $set: { status: "done", finishedAt: new Date() } }, { session });
    return true;
  });
  const rec = await SeasonReset.findOne({ seasonYear: ended }).lean();
  return {
    ok: true,
    seasonYear: ended,
    done,
    kidsReset: rec?.kidsReset ?? 0,
    centipointsReset: rec?.centipointsReset ?? 0,
    retainedCents: rec?.retainedCents ?? 0,
    retainedCount: rec?.retainedCount ?? 0,
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
    startedAt: r.createdAt ?? null,
    finishedAt: r.finishedAt ?? null,
  }));
}
