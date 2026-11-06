/**
 * What each Stripe event DOES to our data. Called by webhook.ts only after the signature,
 * mode and duplicate checks have passed.
 *
 * Rules (CLAUDE.md + user decisions):
 *  - Points are computed HERE from the money actually received, at $1.50/point, never from
 *    anything a client sent (centsToCentipoints rounds down).
 *  - Ledger row + kid balance (+ deed confirmation) change in ONE DB transaction.
 *  - Idempotent: replaying any event, in any order, changes nothing the second time.
 *    Guards: Payment.stripePaymentIntentId is unique; the ledger idempotencyKey is unique.
 *  - NO REFUNDS (user, 2026-11-05): refunds and chargebacks are recorded on Payment and
 *    flagged for admin; points are never taken back.
 *  - Credit only from payment_intent.succeeded. Checkout/Payment Link payments also fire
 *    that event (the PaymentIntent carries our metadata), so checkout.session.* events
 *    never credit, which removes any chance of double-crediting the same money.
 */
import "server-only";
import type Stripe from "stripe";
import { Deed, Kid, PayLaterRequest, Payment, Transaction, trusted, withTransaction } from "@repo/db";
import { MAX_DONATION_CENTS, MAX_TIP_CENTS, MIN_DONATION_CENTS, MIN_TIP_CENTS, REGISTRATION_FEE_CENTS } from "@repo/lib/limits";
import { centsToCentipoints } from "@repo/lib/points";
import { getSeasonYear } from "@repo/lib/season";
import { getStripe } from "./client.ts";
import { parsePaymentMetadata, type PaymentMetadata } from "./metadata.ts";
import { closePayLaterForDeed } from "./pay-later-links.ts";
import { ensureDonationReceipt, sendPendingReceipts } from "./receipts.ts";

export type Outcome = { status: "processed" | "ignored"; note: string };
const processed = (note: string): Outcome => ({ status: "processed", note });
const ignored = (note: string): Outcome => ({ status: "ignored", note });

/** Stripe fields can be an id string or an expanded object; we only need the id. */
const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);

/** Plain sanity checks on the money itself (independent of the database). */
function moneyProblem(pi: Stripe.PaymentIntent, meta: PaymentMetadata): string | null {
  if (pi.currency !== "usd") return "currency_not_usd";
  if (pi.amount_received !== pi.amount) return "partial_amount_received";
  if (!Number.isSafeInteger(pi.amount_received) || pi.amount_received <= 0) return "bad_amount";
  if (
    (meta.sos_purpose === "tip" || meta.sos_purpose === "bonus") &&
    (pi.amount_received < MIN_TIP_CENTS || pi.amount_received > MAX_TIP_CENTS)
  ) {
    return "amount_out_of_bounds"; // creation code should have blocked this: a human checks
  }
  if (meta.sos_purpose === "donation" && (pi.amount_received < MIN_DONATION_CENTS || pi.amount_received > MAX_DONATION_CENTS)) {
    return "amount_out_of_bounds";
  }
  if (meta.sos_purpose === "registration") {
    // The amount we asked for: $5 x kids, or one $5 with the promo code.
    const kids = meta.sos_kid_ids.split(",").length;
    const expected = meta.sos_promo === "1" ? REGISTRATION_FEE_CENTS : REGISTRATION_FEE_CENTS * kids;
    if (pi.amount_received !== expected) return "registration_amount_mismatch";
  }
  return null;
}

/** MongoDB duplicate-key error (a unique index said "this already exists"). */
const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;

// ── payment_intent.succeeded ─────────────────────────────────────────────────────────
export async function onPaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<Outcome> {
  let outcome: Outcome;
  try {
    outcome = await creditPaymentIntent(pi);
  } catch (err) {
    // A unique index fired inside the transaction (it aborted, nothing was written):
    //  - another copy of this event credited it first → the re-run sees "already_recorded";
    //  - a concurrent payment_failed inserted the Payment row first → the re-run updates
    //    that row and credits. (Review finding 2026-11-05: never treat this as "done".)
    if (!isDuplicateKey(err)) throw err;
    outcome = await creditPaymentIntent(pi);
  }
  const meta = parsePaymentMetadata(pi.metadata);
  if (outcome.status === "processed" && meta?.sos_purpose === "donation") await afterDonationRecorded(pi.id);
  // A deed tipped (pay now OR its texted link): close any OTHER live pay-later link for it, so the
  // same deed can't be paid twice by mistake. Best-effort, after the money transaction.
  if (outcome.status === "processed" && meta?.sos_purpose === "tip" && meta.sos_deed_id) {
    await closePayLaterForDeed(meta.sos_deed_id).catch((e: unknown) => console.error("[pay-later] close after tip failed:", e instanceof Error ? e.name : "unknown"));
  }
  return outcome;
}

/**
 * Community donation recorded → its tax receipt (created once, emailed if receipts are on).
 * AFTER the money transaction and best-effort: an email problem must never fail or roll back the
 * payment record; the daily cron sends anything still pending. Runs in the family app (webhook +
 * return page), so NEXTAUTH_URL is the family site where /donate lives.
 */
async function afterDonationRecorded(piId: string): Promise<void> {
  try {
    await ensureDonationReceipt(piId, new URL("/donate", process.env.NEXTAUTH_URL ?? "https://spiritofsanta.com").toString());
    await sendPendingReceipts({ onlyPiId: piId });
  } catch (err) {
    console.error("[receipts] after donation failed:", err instanceof Error ? err.name : "unknown");
  }
}

async function creditPaymentIntent(pi: Stripe.PaymentIntent): Promise<Outcome> {
  const meta = parsePaymentMetadata(pi.metadata);
  if (!meta) return ignored("not_ours"); // e.g. `stripe trigger` fixtures, other products

  const now = new Date();
  // Points join the kid's CURRENT balance, so the ledger row uses the season we're in now
  // (a pay-later link paid on Jan 2 counts toward the new season, after the Jan 1 reset).
  const seasonYear = getSeasonYear(now);
  const ids = {
    kidId: "sos_kid_id" in meta ? meta.sos_kid_id : undefined,
    familyId: "sos_family_id" in meta ? meta.sos_family_id : undefined,
    deedId: "sos_deed_id" in meta ? meta.sos_deed_id : undefined,
    wishListItemId: "sos_wish_list_item_id" in meta ? meta.sos_wish_list_item_id : undefined,
  };

  return withTransaction(async (session) => {
    const existing = await Payment.findOne({ stripePaymentIntentId: pi.id }).session(session).lean();
    if (existing?.status === "succeeded") return processed("already_recorded");

    const record = async (fulfilment: "credited" | "held" | "review" | "fulfilled", extra: object = {}) => {
      await Payment.findOneAndUpdate(
        { stripePaymentIntentId: pi.id },
        {
          $set: {
            livemode: pi.livemode,
            purpose: meta.sos_purpose,
            status: "succeeded",
            succeededAt: now,
            seasonYear,
            ...ids,
            amountCents: pi.amount_received,
            currency: pi.currency,
            fulfilment,
            ...extra,
          },
        },
        { upsert: true, session, runValidators: true, setDefaultsOnInsert: true },
      );
    };
    const review = async (reason: string) => {
      await record("review", { needsReview: true, reviewReason: `Not credited: ${reason}` });
      return processed(`review:${reason}`);
    };

    const problem = moneyProblem(pi, meta);
    if (problem) return review(problem);

    // Child registration: mark the listed kids of THIS family "registered" (consent verified).
    // Kids already registered or deleted meanwhile are skipped; if none was left the payment is
    // flagged for an admin (e.g. paid twice by double-clicking). The money is platform revenue.
    if (meta.sos_purpose === "registration") {
      const listed = meta.sos_kid_ids.split(",");
      // Which listed kids of THIS family are still awaiting (not deleted/archived/registered)?
      const awaiting = await Kid.find({ _id: trusted({ $in: listed }), familyId: meta.sos_family_id, archivedAt: null, "registration.status": "awaiting" })
        .select("_id")
        .session(session)
        .lean();
      // Keep the paid-for order: the FIRST kid actually registered is the one the card covered.
      const ids = listed.filter((id) => awaiting.some((k) => String(k._id) === id));
      if (ids.length === 0) return review("registration_no_awaiting_kids");
      const [first, ...rest] = ids;
      const promo = meta.sos_promo === "1";
      const reg = (method: "card" | "promo") => ({ $set: { "registration.status": "registered", "registration.registeredAt": now, "registration.method": method } });
      await Kid.updateOne({ _id: first }, reg("card"), { session });
      if (rest.length) await Kid.updateMany({ _id: trusted({ $in: rest }) }, reg(promo ? "promo" : "card"), { session });
      // Paid for more kids than could be registered (e.g. two tabs, a kid deleted meanwhile):
      // the registered ones stay registered (the card DID verify the parent), but an admin looks
      // at the extra money. With the promo one $5 is right for any number of kids.
      if (!promo && ids.length < listed.length) {
        await record("review", { kidIds: ids, needsReview: true, reviewReason: `Registered ${ids.length} of ${listed.length} kids paid for` });
        return processed(`review:registration_partial`);
      }
      await record("fulfilled", { kidIds: ids });
      return processed(`registered:${ids.length}`);
    }

    // Community donation: HELD in its pool (zip or "all kids") until the Dec 1 split (Phase 5 slice 2b).
    if (meta.sos_purpose === "donation") {
      await record("held", meta.sos_zip ? { zip: meta.sos_zip } : {});
      return processed("held:donation");
    }
    // Pay-ups (item lock) are handled with wish lists (Phase 6).
    if (meta.sos_purpose === "payup") {
      await record("held");
      return processed("held:payup");
    }

    // tip | bonus → credit points to the kid. Only a REGISTERED kid of that family (consent
    // verified): every checkout already requires it; this is the second layer (review 2026-11-06).
    const kid = await Kid.findOne({ _id: meta.sos_kid_id, familyId: meta.sos_family_id, archivedAt: null, "registration.status": "registered" })
      .select({ _id: 1 })
      .session(session)
      .lean();
    if (!kid) return review("kid_not_found_wrong_family_or_unregistered");

    let confirmDeed = false;
    if (meta.sos_purpose === "tip" && meta.sos_deed_id) {
      const deed = await Deed.findOne({ _id: meta.sos_deed_id })
        .select({ kidId: 1, familyId: 1, status: 1 })
        .session(session)
        .lean();
      if (!deed || String(deed.kidId) !== meta.sos_kid_id || String(deed.familyId) !== meta.sos_family_id) {
        return review("deed_mismatch");
      }
      if (deed.status !== "pending" && deed.status !== "confirmed") return review(`deed_${deed.status}`);
      // Only a still-pending deed is confirmed by this payment. A second tip (two visitors paid at
      // once, or a thank-you came first) is credited, but the FIRST confirmation stands.
      confirmDeed = deed.status === "pending";
    }

    const centipoints = centsToCentipoints(pi.amount_received);
    if (centipoints < 1) return review("amount_too_small_for_a_point");

    await Transaction.create(
      [
        {
          kidId: meta.sos_kid_id,
          familyId: meta.sos_family_id,
          seasonYear,
          type: meta.sos_purpose === "tip" ? "earn_tip" : "earn_bonus",
          amountCentipoints: centipoints,
          cents: pi.amount_received,
          deedId: ids.deedId,
          stripePaymentIntentId: pi.id,
          // Unique index: a second credit for this PaymentIntent fails instead of doubling.
          idempotencyKey: `stripe:pi:${pi.id}`,
        },
      ],
      { session },
    );
    await Kid.updateOne({ _id: meta.sos_kid_id }, { $inc: { availableCentipoints: centipoints } }, { session });

    if (confirmDeed) {
      // Paying IS the recipient confirming the deed ("pay now" outcome on the QR page).
      // Compare-and-set on "pending": a thank-you landing at the same moment wins, never overwritten.
      await Deed.updateOne(
        { _id: ids.deedId, status: "pending" },
        { $set: { status: "confirmed", outcome: "paid", tipCents: pi.amount_received, confirmedAt: now, qrUsedAt: now } },
        { session },
      );
    }

    await record("credited", { pointsCreditedCentipoints: centipoints });
    return processed(`credited:${meta.sos_purpose}`);
  });
}

// ── payment_intent.payment_failed / .canceled ────────────────────────────────────────
export async function onPaymentIntentNotPaid(
  pi: Stripe.PaymentIntent,
  status: "failed" | "canceled",
): Promise<Outcome> {
  const meta = parsePaymentMetadata(pi.metadata);
  if (!meta) return ignored("not_ours");
  // Events can arrive out of order or at the same moment: never downgrade a payment that
  // already succeeded. The guard is IN the write's filter so check + write are one atomic
  // step (a separate findOne-then-update could interleave with the credit transaction).
  // If a succeeded row exists, the filter misses, the upsert tries to insert a second row
  // for this PaymentIntent, and the unique index rejects it (11000) = already succeeded.
  try {
    await writeNotPaid(pi, meta, status);
  } catch (err) {
    if (isDuplicateKey(err)) return ignored("already_succeeded");
    throw err;
  }
  return processed(`recorded:${status}`);
}

async function writeNotPaid(pi: Stripe.PaymentIntent, meta: PaymentMetadata, status: "failed" | "canceled") {
  await Payment.findOneAndUpdate(
    // trusted(): our own operator; the global sanitizeFilter would otherwise neutralise $ne.
    { stripePaymentIntentId: pi.id, status: trusted({ $ne: "succeeded" }) },
    {
      $set: {
        livemode: pi.livemode,
        purpose: meta.sos_purpose,
        status,
        seasonYear: getSeasonYear(),
        kidId: "sos_kid_id" in meta ? meta.sos_kid_id : undefined,
        familyId: "sos_family_id" in meta ? meta.sos_family_id : undefined,
        amountCents: 0, // nothing was received
        currency: "usd", // we only ever create USD payments; nothing was received anyway
        fulfilment: "none",
      },
    },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

/** Thrown to make Stripe redeliver an event later (→ 500). Message holds ids only. */
export class RetryLaterError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RetryLaterError";
  }
}

/**
 * A refund/dispute arrived for a PaymentIntent we have no Payment row for. Two cases:
 *  - not our payment (no sos_ metadata) → nothing to record, ignore;
 *  - OUR payment whose payment_intent.succeeded hasn't been processed yet (it failed once
 *    and is waiting on Stripe's retry, or events arrived out of order) → we must NOT
 *    acknowledge, or the refund/chargeback would be lost and the later credit unflagged
 *    (review finding 2026-11-05). Throw → 500 → Stripe retries this event after the
 *    payment is recorded (retries run for up to 3 days in live mode).
 */
async function onMissingPayment(piId: string): Promise<Outcome> {
  let pi: Stripe.PaymentIntent;
  try {
    pi = await getStripe().paymentIntents.retrieve(piId);
  } catch (err) {
    if ((err as { code?: string }).code === "resource_missing") return ignored("unknown_payment_intent");
    throw err; // Stripe API trouble: retry later
  }
  if (!parsePaymentMetadata(pi.metadata)) return ignored("not_ours");
  throw new RetryLaterError(`payment_not_recorded_yet:${piId}`);
}

// ── charge.refunded ──────────────────────────────────────────────────────────────────
export async function onChargeRefunded(charge: Stripe.Charge): Promise<Outcome> {
  const piId = idOf(charge.payment_intent);
  if (!piId) return ignored("no_payment_intent");
  const updated = await Payment.findOneAndUpdate(
    { stripePaymentIntentId: piId },
    {
      // amount_refunded is cumulative; $max keeps the largest even if events arrive out of order.
      $max: { refundedCents: charge.amount_refunded },
      $set: {
        needsReview: true,
        reviewReason: "Refund issued in Stripe. Policy is no refunds; points were NOT taken back.",
      },
    },
    { runValidators: true },
  );
  return updated ? processed("refund_recorded") : onMissingPayment(piId);
}

// ── charge.dispute.created / .closed ─────────────────────────────────────────────────
const TERMINAL_DISPUTE = new Set(["won", "lost", "warning_closed", "prevented"]);

export async function onDispute(dispute: Stripe.Dispute): Promise<Outcome> {
  const piId = idOf(dispute.payment_intent);
  if (!piId) return ignored("no_payment_intent");
  const existing = await Payment.findOne({ stripePaymentIntentId: piId }).select({ dispute: 1 }).lean();
  if (!existing) return onMissingPayment(piId);
  // Out-of-order safety: a late "created" must not overwrite a final won/lost result.
  const current = existing.dispute?.status;
  if (current && TERMINAL_DISPUTE.has(current) && !TERMINAL_DISPUTE.has(dispute.status)) {
    return ignored("stale_dispute_status");
  }
  await Payment.updateOne(
    { stripePaymentIntentId: piId },
    {
      $set: {
        dispute: { stripeDisputeId: dispute.id, status: dispute.status, amountCents: dispute.amount },
        needsReview: true,
        reviewReason: `Chargeback ${dispute.status}. Points were NOT taken back (no-refunds policy).`,
      },
    },
    { runValidators: true },
  );
  return processed(`dispute:${dispute.status}`);
}

// ── checkout.session.* (Payment Links for pay-later) ─────────────────────────────────
export async function onCheckoutSessionPaid(cs: Stripe.Checkout.Session): Promise<Outcome> {
  const meta = parsePaymentMetadata(cs.metadata);
  if (!meta) return ignored("not_ours");
  // "completed" with payment_status "unpaid" = a delayed method (bank debit) still pending;
  // async_payment_succeeded follows. Points are credited by payment_intent.succeeded.
  if (cs.payment_status !== "paid" && cs.payment_status !== "no_payment_required") {
    return ignored("awaiting_async_payment");
  }
  const linkId = idOf(cs.payment_link);
  if (!linkId) return processed("paid_no_link");
  // Only per-deed pay-later links are single-use. A reusable link (e.g. a family's
  // donation QR or a corporate donation page) must stay active after each payment.
  if (meta.sos_purpose !== "tip" || !meta.sos_deed_id) return processed("reusable_link_kept");
  // Pay-later links are one per deed: switch it off so it can't be paid twice.
  // Idempotent (deactivating twice is fine). A failure throws → 500 → Stripe retries.
  await getStripe().paymentLinks.update(linkId, { active: false });
  // The pay-later text request for this link is now paid (Phase 5 slice 4b).
  await PayLaterRequest.updateOne({ paymentLinkId: linkId, status: trusted({ $in: ["creating", "sending", "sent", "expired", "closed"] }) }, { $set: { status: "paid" }, $unset: { active: 1 } });
  const piId = idOf(cs.payment_intent);
  if (piId) {
    await Payment.updateOne({ stripePaymentIntentId: piId }, { $set: { checkoutSessionId: cs.id, paymentLinkId: linkId } });
  }
  return processed("payment_link_deactivated");
}
