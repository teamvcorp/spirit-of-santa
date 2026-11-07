/**
 * Store payouts + season money summary (Phase 6 slice 5). SERVER-ONLY.
 *
 * Roadmap: "Store payouts recorded by admin (paid by check/outside the app; no Stripe Connect)" and
 * "Platform profit tracked". User decisions (2026-11-04, docs/CODEMAP.md "Platform margin"): margin =
 * conversion ($1.50/point in vs $1/point retail out) + wholesale (retail − store payout) + breakage
 * (points never spent), all kept; season total = money collected − store payouts − refunds/disputes.
 *
 * A store is OWED for a gift once Spirit of Santa received it (amount fixed then: payoutOwedCents).
 * Recording a payout covers ALL gifts owed to that store at that moment, in one transaction
 * (compare-and-set on payoutId), so a double click or two admins can never pay a gift twice.
 *
 * CALLERS: admin functions require requireRole("admin") in the page AND the Server Action;
 * storePayoutView takes a storeId that MUST come from memberStore() (the caller's own store).
 */
import "server-only";
import { z } from "zod";
import { AuditLog, connectDb, Payment, PAYOUT_METHODS, Store, StorePayout, Transaction, trusted, WishListItem, withTransaction } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { centipointsToCents } from "@repo/lib/points";
import { parseIsoDay } from "@repo/lib/season";
import { owedAt } from "./payout-amount.ts";

/** Gifts received by Spirit of Santa and not yet paid for. */
const OWED = { receivedAt: trusted({ $ne: null }), payoutId: null };

/**
 * Gifts received before their store had a discount on record have no amount yet: fill them in for
 * every store that HAS a discount now (same formula as markReceived). Stores still without a
 * discount are skipped entirely, so they can never crowd out the others. One discount lookup per
 * store, one bulk write per store; idempotent (compare-and-set on "still null, still unpaid").
 */
async function fillMissingAmounts(storeId?: string): Promise<void> {
  const missing = { receivedAt: trusted({ $ne: null }), payoutId: null, payoutOwedCents: null, ...(storeId ? { storeId } : {}) };
  const storeIds = (await WishListItem.distinct("storeId", missing)) as unknown[];
  if (storeIds.length === 0) return;
  const priced = await Store.find({ _id: trusted({ $in: storeIds.map(String) }), discountBps: trusted({ $ne: null }) })
    .select("discountBps")
    .lean<{ _id: unknown; discountBps: number }[]>();
  for (const s of priced) {
    const rows = await WishListItem.find({ ...missing, storeId: String(s._id) }).select("costCentipoints").limit(5000).lean<{ _id: unknown; costCentipoints: number }[]>();
    if (rows.length === 0) continue;
    await WishListItem.bulkWrite(
      rows.map((r) => ({
        updateOne: { filter: { _id: r._id, payoutOwedCents: null, payoutId: null }, update: { $set: { payoutOwedCents: owedAt(s.discountBps, r.costCentipoints) } } },
      })) as never,
    );
  }
}

/** Thrown inside the payout transaction to roll it back and answer "changed" (not a 500). */
class PayoutChanged extends Error {}

export type OwedRow = { storeId: string; storeName: string; storeEmail: string; giftCount: number; owedCents: number; missingAmount: number };

/** What each store is owed right now (largest first). */
export async function owedByStore(): Promise<OwedRow[]> {
  await connectDb();
  await fillMissingAmounts();
  const groups = await WishListItem.aggregate<{ _id: unknown; giftCount: number; owedCents: number; missingAmount: number }>([
    { $match: { receivedAt: { $ne: null }, payoutId: null } },
    {
      $group: {
        _id: "$storeId",
        giftCount: { $sum: 1 },
        owedCents: { $sum: { $ifNull: ["$payoutOwedCents", 0] } },
        missingAmount: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$payoutOwedCents", null] }, null] }, 1, 0] } },
      },
    },
    { $sort: { owedCents: -1 } },
    { $limit: 1000 },
  ]);
  const stores = await Store.find({ _id: trusted({ $in: groups.map((g) => String(g._id)) }) }).select("name contact.email").lean<{ _id: unknown; name: string; contact?: { email?: string } }[]>();
  const by = new Map(stores.map((s) => [String(s._id), s]));
  return groups.map((g) => ({
    storeId: String(g._id),
    storeName: by.get(String(g._id))?.name ?? "",
    storeEmail: by.get(String(g._id))?.contact?.email ?? "",
    giftCount: g.giftCount,
    owedCents: g.owedCents,
    missingAmount: g.missingAmount,
  }));
}

export const payoutInputSchema = z.object({
  method: z.enum(PAYOUT_METHODS),
  reference: z.string().trim().max(60).regex(/^[^<>\p{Cc}\p{Cf}]*$/u),
  paidOn: z.string().refine((d) => parseIsoDay(d) !== null),
  note: z.string().trim().max(300).regex(/^[^<>\p{Cc}\p{Cf}]*$/u),
});
export type PayoutInput = z.infer<typeof payoutInputSchema>;

export type PayoutResult =
  | { ok: true; payoutId: string; amountCents: number; giftCount: number }
  | { ok: false; error: "notFound" | "invalid" | "nothingOwed" | "missingAmount" | "changed"; field?: string };

/**
 * Record that the admin paid a store (outside the app) for EVERYTHING it is owed right now.
 * The amount is computed here from the gifts, never typed. Refused while any of the store's owed
 * gifts has no amount (store discount missing): fix the discount first, so nothing is paid wrong.
 * `expectedCents` = the amount the admin confirmed sending: compared INSIDE the transaction, so a
 * gift received a moment earlier can never slip into a payout for a different sum ("changed").
 */
export async function recordPayout(adminId: string, rawStoreId: string, raw: Record<string, unknown>, expectedCents?: number): Promise<PayoutResult> {
  const storeId = normalizeObjectId(rawStoreId);
  if (!storeId) return { ok: false, error: "notFound" };
  const parsed = payoutInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", field: String(parsed.error.issues[0]?.path[0] ?? "") };
  await connectDb();
  if (!(await Store.exists({ _id: storeId }))) return { ok: false, error: "notFound" };
  await fillMissingAmounts(storeId);
  const v = parsed.data;
  try {
    return await withTransaction(async (session): Promise<PayoutResult> => {
    const gifts = await WishListItem.find({ ...OWED, storeId })
      .select("payoutOwedCents seasonYear")
      .sort({ receivedAt: 1, _id: 1 })
      .session(session)
      .lean<{ _id: unknown; payoutOwedCents?: number | null; seasonYear: number }[]>();
    if (gifts.length === 0) return { ok: false, error: "nothingOwed" };
    if (gifts.some((g) => typeof g.payoutOwedCents !== "number")) return { ok: false, error: "missingAmount" };
    const amountCents = gifts.reduce((s, g) => s + (g.payoutOwedCents ?? 0), 0);
    if (amountCents < 1) return { ok: false, error: "nothingOwed" };
    if (expectedCents !== undefined && expectedCents !== amountCents) return { ok: false, error: "changed" };
    // A payout may cover gifts of more than one season (e.g. unpaid since last year): keep them all.
    const seasonYears = [...new Set(gifts.map((g) => g.seasonYear))].sort();
    const [p] = await StorePayout.create(
      [{ storeId, seasonYear: seasonYears[seasonYears.length - 1]!, seasonYears, amountCents, giftCount: gifts.length, method: v.method, reference: v.reference || undefined, paidOn: v.paidOn, note: v.note || undefined, createdByUserId: adminId }],
      { session },
    );
    const ids = gifts.map((g) => String(g._id));
    // Compare-and-set: every gift must still be unpaid, or the whole payout rolls back.
    const res = await WishListItem.updateMany({ _id: trusted({ $in: ids }), payoutId: null }, { $set: { payoutId: p!._id } }, { session });
    if (res.modifiedCount !== ids.length) throw new PayoutChanged(); // another payout got there first: roll back
    await AuditLog.create(
      [{ actorUserId: adminId, action: "payout.record", targetType: "store", targetId: storeId, details: { payoutId: String(p!._id), amountCents, giftCount: ids.length, method: v.method } }],
      { session },
    );
    return { ok: true, payoutId: String(p!._id), amountCents, giftCount: ids.length };
    });
  } catch (err) {
    if (err instanceof PayoutChanged) return { ok: false, error: "changed" };
    throw err;
  }
}

export type PayoutRow = { id: string; storeId: string; storeName: string; amountCents: number; giftCount: number; method: string; reference: string; paidOn: string; note: string };

/** Payout history, newest first (one store, or all). */
export async function listPayouts(storeId?: string, limit = 100): Promise<PayoutRow[]> {
  await connectDb();
  const rows = await StorePayout.find(storeId ? { storeId } : {})
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean<{ _id: unknown; storeId: unknown; amountCents: number; giftCount: number; method: string; reference?: string; paidOn: string; note?: string }[]>();
  const stores = await Store.find({ _id: trusted({ $in: [...new Set(rows.map((r) => String(r.storeId)))] }) }).select("name").lean<{ _id: unknown; name: string }[]>();
  const name = new Map(stores.map((s) => [String(s._id), s.name]));
  return rows.map((r) => ({ id: String(r._id), storeId: String(r.storeId), storeName: name.get(String(r.storeId)) ?? "", amountCents: r.amountCents, giftCount: r.giftCount, method: r.method, reference: r.reference ?? "", paidOn: r.paidOn, note: r.note ?? "" }));
}

/** For the STORE app: what this store is owed now + what it has been paid. */
export async function storePayoutView(storeId: unknown): Promise<{ owedCents: number; owedCount: number; pendingCount: number; payouts: PayoutRow[] }> {
  await connectDb();
  const sid = String(storeId);
  await fillMissingAmounts(sid);
  const owed = await WishListItem.find({ ...OWED, storeId: sid }).select("payoutOwedCents").lean<{ payoutOwedCents?: number | null }[]>();
  const priced = owed.filter((g) => typeof g.payoutOwedCents === "number");
  return {
    owedCents: priced.reduce((s, g) => s + (g.payoutOwedCents ?? 0), 0),
    owedCount: priced.length,
    pendingCount: owed.length - priced.length, // received, amount waits for the store's discount
    payouts: await listPayouts(sid, 50),
  };
}

// ── Season money summary ───────────────────────────────────────────────────────────────

export type SeasonMoney = {
  seasonYear: number;
  /** Money collected through Stripe this season, by purpose (cents). */
  collected: Record<string, number>;
  collectedTotal: number;
  /** Refunded + chargebacks lost (cents): money we had to give back. */
  givenBack: number;
  /** Gifts Spirit of Santa received from stores this season. */
  gifts: { count: number; retailCents: number; wholesaleOwedCents: number; wholesalePaidCents: number; withoutAmount: number };
  /** Wholesale margin on received gifts = retail − wholesale. */
  wholesaleMarginCents: number;
  /** Breakage: points that were never spent, and their money value at $1.50/point. */
  breakage: { resetCentipoints: number; forfeitCentipoints: number; valueCents: number };
  /**
   * Net so far = collected − given back − all wholesale for received gifts (paid or still owed).
   * Gifts whose store has no discount yet (withoutAmount) are left OUT of the wholesale figures and
   * of the margin (retail counted only for priced gifts), never counted as $0: the page warns.
   */
  netCents: number;
  /** Not yet included: card processing fees (see the Stripe dashboard). */
};

export async function seasonMoney(seasonYear: number): Promise<SeasonMoney> {
  await connectDb();
  await fillMissingAmounts();
  const [pay, gifts, ledger] = await Promise.all([
    Payment.aggregate<{ _id: string; cents: number; refunded: number; lost: number }>([
      { $match: { seasonYear, status: "succeeded" } },
      {
        $group: {
          _id: "$purpose",
          cents: { $sum: "$amountCents" },
          refunded: { $sum: { $ifNull: ["$refundedCents", 0] } },
          lost: { $sum: { $cond: [{ $eq: ["$dispute.status", "lost"] }, { $ifNull: ["$dispute.amountCents", 0] }, 0] } },
        },
      },
    ]),
    WishListItem.aggregate<{ count: number; retail: number; owed: number; paid: number; withoutAmount: number }>([
      { $match: { seasonYear, receivedAt: { $ne: null } } },
      { $set: { priced: { $ne: [{ $ifNull: ["$payoutOwedCents", null] }, null] } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          withoutAmount: { $sum: { $cond: ["$priced", 0, 1] } },
          retail: { $sum: { $cond: ["$priced", "$costCentipoints", 0] } },
          owed: { $sum: { $ifNull: ["$payoutOwedCents", 0] } },
          paid: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$payoutId", null] }, null] }, { $ifNull: ["$payoutOwedCents", 0] }, 0] } },
        },
      },
    ]),
    Transaction.aggregate<{ _id: string; centipoints: number }>([
      { $match: { seasonYear, type: { $in: ["season_reset", "forfeit"] } } },
      { $group: { _id: "$type", centipoints: { $sum: "$amountCentipoints" } } },
    ]),
  ]);
  const collected = Object.fromEntries(pay.map((p) => [p._id, p.cents]));
  const collectedTotal = pay.reduce((s, p) => s + p.cents, 0);
  const givenBack = pay.reduce((s, p) => s + p.refunded + p.lost, 0);
  const g = gifts[0] ?? { count: 0, retail: 0, owed: 0, paid: 0, withoutAmount: 0 };
  const reset = ledger.find((l) => l._id === "season_reset")?.centipoints ?? 0;
  const forfeit = ledger.find((l) => l._id === "forfeit")?.centipoints ?? 0;
  return {
    seasonYear,
    collected,
    collectedTotal,
    givenBack,
    gifts: { count: g.count, retailCents: g.retail, wholesaleOwedCents: g.owed - g.paid, wholesalePaidCents: g.paid, withoutAmount: g.withoutAmount },
    wholesaleMarginCents: g.retail - g.owed,
    breakage: { resetCentipoints: reset, forfeitCentipoints: forfeit, valueCents: centipointsToCents(reset + forfeit) },
    netCents: collectedTotal - givenBack - g.owed,
  };
}
