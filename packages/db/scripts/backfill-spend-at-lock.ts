/**
 * ONE-OFF DATA CORRECTION (Phase 8, 2026-11-07): book the "spend" that lock never booked before this fix.
 *
 * The bug: until Phase 8, locking a gift wrote no ledger "spend" and never lowered the kid's escrow, so
 * escrowedCentipoints kept growing with every gift ever locked (the same money counted twice in the records).
 * The engine now spends at lock (packages/wishlists/src/engine.ts lockGiftsInSession). This script fixes the
 * gifts that were locked BEFORE that: one "spend" row per such gift (same unique key `spend:<giftId>` the engine
 * uses, so it can never be booked twice) and the kid's escrow lowered to what its open gifts really hold.
 *
 *   npm run db:backfill-spend                         DRY RUN (default): prints what it WOULD do, writes nothing
 *   npm run db:backfill-spend -- --apply              writes (only on a *_dev database)
 *   npm run db:backfill-spend -- --apply --apply-production   writes on a non-dev database (production)
 *   add --include-no-history to also book gifts that have NO escrow history in the ledger (review first!)
 *   add --kid <kidId> (repeatable) to check/fix ONLY those kids (tests, or one family's fix); the verify pass
 *     then also covers only them
 *
 * Production: put MONGODB_URI (+ MONGODB_DB) in a TEMPORARY env file OUTSIDE the repo, run with
 * `node --conditions=react-server --env-file=<that file> packages/db/scripts/backfill-spend-at-lock.ts ...`,
 * then delete the file. Never commit or paste it. Run a dry run first and read the report.
 *
 * Safety (teaching notes):
 *  - Each kid is fixed in ONE transaction, recomputed INSIDE it (a lock happening meanwhile can't confuse it).
 *  - The escrow update is compare-and-set on the exact value read; if it misses, the transaction is ABORTED
 *    (throw), never committed half-way (spends without the escrow change could never be fixed by a re-run).
 *  - Results are recorded only after a transaction commits (a retried transaction must not count twice).
 *  - A kid whose numbers don't add up is REPORTED and left alone: a human decides (never guess with money).
 *  - Re-running is safe: already-booked gifts are skipped, so a second --apply changes nothing.
 *  - Only kid ids and numbers are printed, never names.
 */
import mongoose from "mongoose";
import * as db from "../src/index.ts";

const argv = process.argv.slice(2);
const args = new Set(argv);
/** --kid <id> (repeatable): limit to these kids. Ids are checked to be 24-hex (never passed into a query raw). */
const ONLY_KIDS = argv.flatMap((a, i) => (a === "--kid" && /^[0-9a-f]{24}$/.test(argv[i + 1] ?? "") ? [argv[i + 1]!] : []));
const APPLY = args.has("--apply");
const PRODUCTION_OK = args.has("--apply-production");
const INCLUDE_NO_HISTORY = args.has("--include-no-history");
const SPENT_STATES = ["locked", "shipped", "delivered"] as const;
const OPEN_STATES = ["active", "fully_funded"] as const;
const NOTE = "backfill: spend not booked at lock before Phase 8 (2026-11)";

type Status = "FIXED" | "ORPHAN_SPENT" | "NOTHING_TO_DO" | "NO_ESCROW_HISTORY" | "UNEXPLAINED_EXTRA" | "SHORT" | "RETRY";
type KidResult = { kidId: string; status: Status; before: number | null; expected: number; booked: number; spendCentipoints: number; after: number | null };
type Gift = { _id: unknown; kidId: unknown; familyId: unknown; seasonYear: number; status: string; fundedCentipoints: number };

/** Fix (or, in a dry run, just evaluate) one kid. Runs inside a transaction; throws to abort. */
async function fixKid(kidId: string, session: mongoose.mongo.ClientSession): Promise<KidResult> {
  const { Kid, Transaction, WishListItem, trusted } = db;
  const kid = await Kid.findById(kidId).select("escrowedCentipoints").session(session).lean<{ escrowedCentipoints: number } | null>();
  const gifts = await WishListItem.find({ kidId, status: trusted({ $in: [...SPENT_STATES, ...OPEN_STATES] }) })
    .select("kidId familyId seasonYear status fundedCentipoints")
    .session(session)
    .lean<Gift[]>();
  const spentGifts = gifts.filter((g) => (SPENT_STATES as readonly string[]).includes(g.status) && g.fundedCentipoints >= 1);
  const booked = new Set(
    (await Transaction.find({ idempotencyKey: trusted({ $in: spentGifts.map((g) => `spend:${String(g._id)}`) }) }).select("idempotencyKey").session(session).lean()).map(
      (t) => t.idempotencyKey,
    ),
  );
  const unbooked = spentGifts.filter((g) => !booked.has(`spend:${String(g._id)}`));
  const expected = gifts.filter((g) => (OPEN_STATES as readonly string[]).includes(g.status)).reduce((n, g) => n + g.fundedCentipoints, 0);
  const base = { kidId, before: kid?.escrowedCentipoints ?? null, expected, booked: 0, spendCentipoints: 0, after: kid?.escrowedCentipoints ?? null };
  if (unbooked.length === 0) return { ...base, status: "NOTHING_TO_DO" };

  // Each gift's ledger history must show its magic went INTO escrow (escrow − release == funded); otherwise a spend
  // would take out money that never went in (raw test rows, imported data): report, don't book.
  for (const g of unbooked) {
    const rows = await Transaction.find({ wishListItemId: String(g._id), type: trusted({ $in: ["escrow", "release"] }) }).select("type amountCentipoints").session(session).lean();
    const net = rows.reduce((n, r) => n + (r.type === "escrow" ? r.amountCentipoints : -r.amountCentipoints), 0);
    if (net !== g.fundedCentipoints && !INCLUDE_NO_HISTORY) return { ...base, status: "NO_ESCROW_HISTORY" };
  }
  const L = unbooked.reduce((n, g) => n + g.fundedCentipoints, 0);
  const book = async () => {
    await Transaction.create(
      unbooked.map((g) => ({
        kidId,
        familyId: String(g.familyId),
        seasonYear: g.seasonYear, // the gift's OWN season (past seasons' money reports stay correct)
        type: "spend",
        amountCentipoints: g.fundedCentipoints,
        wishListItemId: String(g._id),
        idempotencyKey: `spend:${String(g._id)}`,
        note: NOTE,
      })),
      { session, ordered: true },
    );
  };

  if (!kid) {
    // The child was deleted (COPPA): no balance to fix, just the missing ledger rows.
    if (APPLY) await book();
    return { ...base, status: "ORPHAN_SPENT", booked: unbooked.length, spendCentipoints: L };
  }
  const excess = kid.escrowedCentipoints - expected;
  if (excess > L) return { ...base, status: "UNEXPLAINED_EXTRA" };
  if (excess < L) return { ...base, status: "SHORT" };
  if (APPLY) {
    await book();
    const res = await Kid.updateOne({ _id: kidId, escrowedCentipoints: kid.escrowedCentipoints }, { $inc: { escrowedCentipoints: -L } }, { session });
    if (res.modifiedCount !== 1) throw new Error("escrow changed during the fix"); // aborts the transaction
  }
  return { ...base, status: "FIXED", booked: unbooked.length, spendCentipoints: L, after: kid.escrowedCentipoints - L };
}

async function main() {
  const conn = await db.connectDb();
  const name = conn.connection.name;
  const isDev = name.endsWith("_dev");
  console.log(`[backfill-spend] database: ${name} · ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  if (APPLY && !isDev && !PRODUCTION_OK) {
    console.error("[backfill-spend] refusing to write to a non-dev database without --apply-production");
    await conn.disconnect();
    process.exitCode = 2;
    return;
  }

  // Pass A: which kids have locked/shipped/delivered gifts with no spend row yet?
  const { Kid, Transaction, WishListItem, trusted, AuditLog } = db;
  const kidFilter = ONLY_KIDS.length ? { kidId: trusted({ $in: ONLY_KIDS.map((k) => new mongoose.Types.ObjectId(k)) }) } : {};
  if (ONLY_KIDS.length) console.log(`[backfill-spend] limited to ${ONLY_KIDS.length} kid(s)`);
  const spent = await WishListItem.find({ status: trusted({ $in: SPENT_STATES }), fundedCentipoints: trusted({ $gte: 1 }), ...kidFilter }).select("kidId").lean<{ _id: unknown; kidId: unknown }[]>();
  const bookedKeys = new Set<string>();
  for (let i = 0; i < spent.length; i += 1000) {
    const keys = spent.slice(i, i + 1000).map((g) => `spend:${String(g._id)}`);
    for (const t of await Transaction.find({ idempotencyKey: trusted({ $in: keys }) }).select("idempotencyKey").lean()) bookedKeys.add(String(t.idempotencyKey));
  }
  const kidIds = [...new Set(spent.filter((g) => !bookedKeys.has(`spend:${String(g._id)}`)).map((g) => String(g.kidId)))];
  console.log(`[backfill-spend] gifts locked or later: ${spent.length} · without a spend row: ${spent.length - bookedKeys.size} · kids to check: ${kidIds.length}`);

  // Pass B: one transaction per kid; record the result only AFTER it commits.
  const results: KidResult[] = [];
  for (const kidId of kidIds) {
    try {
      results.push(await db.withTransaction((session) => fixKid(kidId, session)));
    } catch (err) {
      results.push({ kidId, status: "RETRY", before: null, expected: 0, booked: 0, spendCentipoints: 0, after: null });
      console.error(`[backfill-spend] ${kidId}: aborted, run again (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  console.log("kidId                     before   expected  booked  spend      after  status");
  for (const r of results) {
    console.log(`${r.kidId}  ${String(r.before ?? "-").padStart(7)}  ${String(r.expected).padStart(8)}  ${String(r.booked).padStart(6)}  ${String(r.spendCentipoints).padStart(6)}  ${String(r.after ?? "-").padStart(9)}  ${r.status}`);
  }
  const totals = results.reduce<Record<string, number>>((t, r) => ({ ...t, [r.status]: (t[r.status] ?? 0) + 1 }), {});
  const spendRows = results.reduce((n, r) => n + r.booked, 0);
  const spendCentipoints = results.reduce((n, r) => n + r.spendCentipoints, 0);
  console.log(`[backfill-spend] ${APPLY ? "booked" : "would book"} ${spendRows} spend row(s), ${spendCentipoints} centipoints · ${JSON.stringify(totals)}`);

  if (APPLY && spendRows > 0) {
    await AuditLog.create({ action: "ledger.backfill_spend", targetType: "settings", targetId: new mongoose.Types.ObjectId(), details: { spendRows, spendCentipoints, ...totals } });
  }

  // Verify pass (always): every kid's escrow == what its open gifts hold; every spent gift has exactly one spend row.
  const open = await WishListItem.aggregate<{ _id: unknown; funded: number }>([
    { $match: { status: { $in: [...OPEN_STATES] }, ...(ONLY_KIDS.length ? { kidId: { $in: ONLY_KIDS.map((k) => new mongoose.Types.ObjectId(k)) } } : {}) } },
    { $group: { _id: "$kidId", funded: { $sum: "$fundedCentipoints" } } },
  ]);
  const openBy = new Map(open.map((o) => [String(o._id), o.funded]));
  const off = (await Kid.find(ONLY_KIDS.length ? { _id: trusted({ $in: ONLY_KIDS }) } : {}).select("escrowedCentipoints").lean()).filter((k) => (k.escrowedCentipoints ?? 0) !== (openBy.get(String(k._id)) ?? 0));
  const stillUnbooked = spent.length - (await Transaction.countDocuments({ type: "spend", idempotencyKey: trusted({ $in: spent.map((g) => `spend:${String(g._id)}`) }) }));
  console.log(`[backfill-spend] verify: kids whose escrow != open gifts: ${off.length} · spent gifts without a spend row: ${stillUnbooked}`);
  for (const k of off.slice(0, 50)) console.log(`  escrow mismatch: ${String(k._id)} escrow=${k.escrowedCentipoints} open=${openBy.get(String(k._id)) ?? 0}`);
  await conn.disconnect();
}

main().catch((err) => {
  console.error("[backfill-spend] failed:", err instanceof Error ? err.message : "unknown");
  process.exitCode = 1;
});
