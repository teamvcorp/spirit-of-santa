/**
 * E2E: Stripe webhook against a RUNNING family app + the dev database.
 *
 *   1. npx turbo run build --filter=family
 *   2. (from apps/family) node ../../node_modules/next/dist/bin/next start -p 3100
 *   3. (from repo root)   node --conditions=react-server --env-file=apps/family/.env.local \
 *                           scripts/e2e/stripe-webhook.ts http://localhost:3100 [--real-stripe]
 *
 * What it does: creates a throwaway family/kid/deed in the *_dev* database, sends events
 * signed with STRIPE_WEBHOOK_SECRET (exactly like Stripe does), checks the database after
 * each one, then deletes everything it created. Refuses to run on a non-_dev database.
 * --real-stripe also makes one real TEST-MODE payment (pm_card_visa) and replays Stripe's
 * own event for it, to prove we handle the real payload shape (needs an sk_test_ key).
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { connectDb, Deed, Family, Kid, Payment, StripeEvent, Transaction } from "@repo/db";
import { buildPaymentMetadata } from "@repo/payments/metadata";

const base = process.argv[2];
const realStripe = process.argv.includes("--real-stripe");
if (!base) throw new Error("usage: stripe-webhook.ts <baseUrl> [--real-stripe]");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!secret.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");

const results: string[] = [];
const check = (name: string, ok: boolean, extra = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
const rid = () => randomBytes(8).toString("hex");

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");

// ── fixtures ────────────────────────────────────────────────────────────────────────
const family = await Family.create({ ownerUserId: new mongoose.Types.ObjectId(), familyName: "E2E Webhook Family" });
const kid = await Kid.create({ familyId: family._id, firstName: "E2E", birthYear: 2018, displayName: "E." });
const deed = await Deed.create({
  kidId: kid._id, familyId: family._id, seasonYear: new Date().getFullYear(),
  customDescription: "E2E deed", qrTokenHash: randomBytes(32).toString("hex"),
});
const otherFamily = await Family.create({ ownerUserId: new mongoose.Types.ObjectId(), familyName: "E2E Other Family" });
const kidId = String(kid._id), familyId = String(family._id);
const eventIds: string[] = [], piIds: string[] = [];

async function send(event: object, opts: { header?: string; rawBody?: string } = {}) {
  const body = opts.rawBody ?? JSON.stringify(event);
  const header = opts.header ?? Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  const post = () =>
    fetch(`${base}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": header },
      body,
    });
  let res: Response;
  try {
    res = await post();
  } catch (err) {
    // Keep-alive race: the server closed an idle pooled socket just as we reused it, so the
    // request never reached our code. Retry once, as Stripe would (the webhook is idempotent).
    // Oversized-body test excluded: there a reset IS the expected answer.
    if (opts.rawBody || (err as { cause?: { code?: string } }).cause?.code !== "ECONNRESET") throw err;
    res = await post();
  }
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
function piEvent(type: string, md: Record<string, string>, amount: number, extra: { piId?: string; livemode?: boolean } = {}) {
  const evtId = `evt_e2e${rid()}`, piId = extra.piId ?? `pi_e2e${rid()}`;
  eventIds.push(evtId); piIds.push(piId);
  return {
    piId,
    event: {
      id: evtId, object: "event", type, livemode: extra.livemode ?? false, created: Math.floor(Date.now() / 1000),
      data: { object: { id: piId, object: "payment_intent", amount, amount_received: type.endsWith("succeeded") ? amount : 0,
        currency: "usd", status: type.endsWith("succeeded") ? "succeeded" : "requires_payment_method",
        livemode: extra.livemode ?? false, metadata: md, created: Math.floor(Date.now() / 1000) } },
    },
  };
}
const balance = async () => (await Kid.findById(kid._id).lean())?.availableCentipoints ?? -1;
const ledgerRows = (piId: string) => Transaction.countDocuments({ stripePaymentIntentId: piId });
const tipMd = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: kidId, sos_family_id: familyId, sos_deed_id: String(deed._id) });

try {
  // 1. Requests Stripe didn't sign are refused before anything happens.
  const forged = piEvent("payment_intent.succeeded", tipMd, 500);
  check("unsigned/forged request → 400", (await send(forged.event, { header: "t=1,v1=deadbeef" })).status === 400);
  check("stale signature (10 min old) → 400", (await send(forged.event, {
    header: Stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(forged.event), secret, timestamp: Math.floor(Date.now() / 1000) - 600 }),
  })).status === 400);
  check("forged event changed nothing", (await balance()) === 0 && (await ledgerRows(forged.piId)) === 0);
  // The server answers 413 from Content-Length without reading the body and may close the
  // connection mid-upload, which the client sees as ECONNRESET. Both mean "refused early".
  const big = await send({}, { rawBody: "x".repeat(1024 * 1024 + 1), header: "t=1,v1=x" }).then(
    (r) => String(r.status),
    (e: unknown) => ((e as { cause?: { code?: string } }).cause?.code ?? "error"),
  );
  check("oversized body refused before reading (413 or reset)", big === "413" || big === "ECONNRESET", big);

  // 2. A $5 deed tip: +333 centipoints (3.33 pts), one ledger row, deed confirmed.
  const tip = piEvent("payment_intent.succeeded", tipMd, 500);
  const r1 = await send(tip.event);
  check("$5 tip → 200 processed", r1.status === 200 && r1.json.status === "processed", JSON.stringify(r1));
  check("kid credited 333 centipoints ($5 ÷ $1.50, rounded down)", (await balance()) === 333, String(await balance()));
  check("exactly one ledger row (earn_tip, cents=500)", (await Transaction.countDocuments({ stripePaymentIntentId: tip.piId, type: "earn_tip", cents: 500, amountCentipoints: 333 })) === 1);
  const d = await Deed.findById(deed._id).lean();
  check("deed confirmed with outcome=paid, tipCents=500", d?.status === "confirmed" && d.outcome === "paid" && d.tipCents === 500);
  const p = await Payment.findOne({ stripePaymentIntentId: tip.piId }).lean();
  check("Payment recorded as credited", p?.fulfilment === "credited" && p.amountCents === 500 && p.pointsCreditedCentipoints === 333);

  // 3. Duplicates: same event again, and a different event for the same PaymentIntent.
  const r2 = await send(tip.event);
  check("same event re-delivered → 200, no double credit", r2.status === 200 && (await balance()) === 333 && (await ledgerRows(tip.piId)) === 1);
  const again = piEvent("payment_intent.succeeded", tipMd, 500, { piId: tip.piId });
  await send(again.event);
  check("new event id for the same payment → still one credit", (await balance()) === 333 && (await ledgerRows(tip.piId)) === 1);
  const parallel = piEvent("payment_intent.succeeded", buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: kidId, sos_family_id: familyId }), 1500);
  const copies = await Promise.all([1, 2, 3].map(() => send(parallel.event)));
  check("3 simultaneous copies of a $15 bonus → credited once (+1000)", copies.every((c) => c.status === 200) && (await balance()) === 1333 && (await ledgerRows(parallel.piId)) === 1, `${await balance()} / ${copies.map((c) => c.status)}`);

  // 4. Things that must NOT credit.
  const notOurs = piEvent("payment_intent.succeeded", { order: "123" }, 2000);
  const r3 = await send(notOurs.event);
  check("payment without our metadata → 200 ignored", r3.status === 200 && r3.json.status === "ignored" && (await balance()) === 1333);
  const live = piEvent("payment_intent.succeeded", tipMd, 500, { livemode: true });
  const r4 = await send(live.event);
  check("live-mode event on a test key → ignored", r4.json.status === "ignored" && (await ledgerRows(live.piId)) === 0);
  const wrongFam = piEvent("payment_intent.succeeded", buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: kidId, sos_family_id: String(otherFamily._id) }), 1000);
  await send(wrongFam.event);
  const wf = await Payment.findOne({ stripePaymentIntentId: wrongFam.piId }).lean();
  check("kid/family mismatch → not credited, flagged for review", (await balance()) === 1333 && wf?.fulfilment === "review" && wf.needsReview === true, wf?.reviewReason ?? "");
  const huge = piEvent("payment_intent.succeeded", buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: kidId, sos_family_id: familyId }), 500_000);
  await send(huge.event);
  check("$5,000 bonus (over the $1,000 cap) → review, no points", (await balance()) === 1333 && (await Payment.findOne({ stripePaymentIntentId: huge.piId }).lean())?.fulfilment === "review");
  const donation = piEvent("payment_intent.succeeded", buildPaymentMetadata({ sos_purpose: "donation", sos_zip: "50588" }), 10_000);
  await send(donation.event);
  check("donation → recorded as held (split comes in Phase 5)", (await Payment.findOne({ stripePaymentIntentId: donation.piId }).lean())?.fulfilment === "held");

  // 5. Failed payment arriving AFTER success must not downgrade it.
  const late = piEvent("payment_intent.payment_failed", tipMd, 500, { piId: tip.piId });
  await send(late.event);
  check("late payment_failed doesn't downgrade a succeeded payment", (await Payment.findOne({ stripePaymentIntentId: tip.piId }).lean())?.status === "succeeded");

  // 6. No-refunds policy: refund + chargeback recorded and flagged; points stay.
  const evtR = `evt_e2e${rid()}`; eventIds.push(evtR);
  await send({ id: evtR, object: "event", type: "charge.refunded", livemode: false, created: 1,
    data: { object: { id: `ch_e2e${rid()}`, object: "charge", payment_intent: tip.piId, amount_refunded: 500 } } });
  const pr = await Payment.findOne({ stripePaymentIntentId: tip.piId }).lean();
  check("refund recorded + flagged, points NOT taken back", pr?.refundedCents === 500 && pr.needsReview === true && (await balance()) === 1333);
  const disputeId = `dp_e2e${rid()}`;
  for (const [type, status] of [["charge.dispute.closed", "lost"], ["charge.dispute.created", "needs_response"]] as const) {
    const id = `evt_e2e${rid()}`; eventIds.push(id);
    await send({ id, object: "event", type, livemode: false, created: 1,
      data: { object: { id: disputeId, object: "dispute", payment_intent: parallel.piId, amount: 1500, status } } });
  }
  const pd = await Payment.findOne({ stripePaymentIntentId: parallel.piId }).lean();
  check("chargeback 'lost' kept even when 'created' arrives late; points kept", pd?.dispute?.status === "lost" && (await balance()) === 1333, pd?.dispute?.status ?? "");

  // 6b. Review fixes (2026-11-05).
  // Declined card and successful retry on the SAME payment, processed at the same moment:
  // the credit must win and the money record must say succeeded.
  const racePi = `pi_e2e${rid()}`;
  const raceFailed = piEvent("payment_intent.payment_failed", buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: kidId, sos_family_id: familyId }), 300, { piId: racePi });
  const raceOk = piEvent("payment_intent.succeeded", buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: kidId, sos_family_id: familyId }), 300, { piId: racePi });
  const raced = await Promise.all([send(raceFailed.event), send(raceOk.event), send(raceFailed.event)]);
  const rp = await Payment.findOne({ stripePaymentIntentId: racePi }).lean();
  check("failed + succeeded at the same moment → credited once, record says succeeded",
    raced.every((r) => r.status === 200) && rp?.status === "succeeded" && rp.fulfilment === "credited" && (await balance()) === 1533 && (await ledgerRows(racePi)) === 1,
    `${raced.map((r) => r.status)} ${rp?.status}/${rp?.fulfilment} bal=${await balance()}`);
  // Refund for a PaymentIntent Stripe has never heard of → ignored (not retried forever).
  const ghost = `evt_e2e${rid()}`; eventIds.push(ghost);
  const rg = await send({ id: ghost, object: "event", type: "charge.refunded", livemode: false, created: 1,
    data: { object: { id: `ch_e2e${rid()}`, object: "charge", payment_intent: `pi_e2e${rid()}`, amount_refunded: 100 } } });
  check("refund for an unknown payment → 200 ignored", rg.status === 200 && rg.json.status === "ignored", JSON.stringify(rg));

  // 7. Event log: every handled event is logged once, with a non-secret note.
  check("StripeEvent log has the processed tip event", (await StripeEvent.findOne({ eventId: tip.event.id }).lean())?.status === "processed");

  // 8. Optional: Stripe's REAL event for a real test-mode payment.
  if (realStripe) {
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    const key = process.env.STRIPE_SECRET_KEY ?? "";
    if (!key.startsWith("sk_test_")) throw new Error("--real-stripe needs an sk_test_ key");
    const stripe = new Stripe(key);
    const since = Math.floor(Date.now() / 1000) - 5;
    const pi = await stripe.paymentIntents.create({
      amount: 1000, currency: "usd", payment_method: "pm_card_visa", confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: kidId, sos_family_id: familyId }),
      description: "Spirit O Santa E2E test (test mode)",
    });
    piIds.push(pi.id);
    let real: Stripe.Event | undefined;
    for (let i = 0; i < 20 && !real; i++) {
      const list = await stripe.events.list({ type: "payment_intent.succeeded", created: { gte: since }, limit: 20 });
      real = list.data.find((e) => (e.data.object as { id: string }).id === pi.id);
      if (!real) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!real) throw new Error("real event not found");
    eventIds.push(real.id);

    // Review fix: a refund that arrives BEFORE the payment is recorded must be retried, not lost.
    const early = `evt_e2e${rid()}`; eventIds.push(early);
    const earlyRefund = { id: early, object: "event", type: "charge.refunded", livemode: false, created: 1,
      data: { object: { id: `ch_e2e${rid()}`, object: "charge", payment_intent: pi.id, amount_refunded: 1000 } } };
    const re1 = await send(earlyRefund);
    check("refund before its payment is recorded → 500 (Stripe will retry)", re1.status === 500 && (await StripeEvent.findOne({ eventId: early }).lean())?.status === "failed", String(re1.status));

    const rr = await send(real); // re-signed with our secret, payload byte-for-byte Stripe's JSON
    check("REAL Stripe test payment ($10) → credited 666 centipoints", rr.status === 200 && (await balance()) === 2199, `${rr.status} ${await balance()} api=${real.api_version}`);

    const re2 = await send(earlyRefund); // Stripe's retry of the same event id
    const pRef = await Payment.findOne({ stripePaymentIntentId: pi.id }).lean();
    check("retried refund now recorded + flagged; points kept", re2.status === 200 && pRef?.refundedCents === 1000 && pRef.needsReview === true && (await balance()) === 2199);
  }
} catch (err) {
  console.log(results.join("\n"));
  console.error("CRASHED after the checks above:", err);
  throw err;
} finally {
  // Cleanup (dev DB only). Ledger rows are append-only through Mongoose, so remove the
  // test rows with the raw driver, scoped to this throwaway kid.
  await Transaction.collection.deleteMany({ kidId: kid._id });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await StripeEvent.collection.deleteMany({ eventId: { $in: eventIds } });
  await Deed.deleteOne({ _id: deed._id });
  await Kid.deleteOne({ _id: kid._id });
  await Family.collection.deleteMany({ _id: { $in: [family._id, otherFamily._id] } });
  await mongoose.disconnect();
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
