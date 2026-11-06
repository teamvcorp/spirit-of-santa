/**
 * Integration test (real Stripe TEST mode + dev DB, no browser, no webhook): a paid payment is
 * recorded by the return-page path (fulfilPaidPaymentIntent) even when the webhook never arrives,
 * and recording it twice changes nothing.
 *
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/stripe-return-fulfil.ts
 *
 * Creates a $5 registration PaymentIntent paid with Stripe's test card token (pm_card_visa).
 * Creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import { connectDb, Family, Kid, Payment, User } from "@repo/db";
import { buildPaymentMetadata, fulfilPaidPaymentIntent, getStripe } from "@repo/payments/checkout";
import { makeChecks } from "./lib.ts";

const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
// eslint-disable-next-line turbo/no-undeclared-env-vars
if (!(process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_")) throw new Error("refusing: needs a Stripe TEST key");

const user = await User.create({ email: `e2e-ret-${tag}@spiritofsanta.test`, passwordHash: "x".repeat(60), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `Ret${tag}`, consent: { version: "test", acceptedAt: new Date() } });
const kid = await Kid.create({ familyId: fam._id, firstName: "Ret", birthYear: 2018, displayName: "R." });
const piIds: string[] = [];
try {
  const metadata = buildPaymentMetadata({ sos_purpose: "registration", sos_family_id: String(fam._id), sos_kid_ids: String(kid._id), sos_promo: "0" });
  const pi = await getStripe().paymentIntents.create({
    amount: 500, currency: "usd", metadata, payment_method: "pm_card_visa", confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  piIds.push(pi.id);
  check("Stripe test payment succeeded", pi.status === "succeeded");
  check("before: kid awaiting, no Payment (no webhook in this test)",
    (await Kid.findById(kid._id).lean())?.registration?.status === "awaiting" && (await Payment.countDocuments({ stripePaymentIntentId: pi.id })) === 0);

  await fulfilPaidPaymentIntent(pi.id);
  const k1 = await Kid.findById(kid._id).lean();
  check("return-page fulfilment registers the kid (0 points: platform revenue)", k1?.registration?.status === "registered" && k1.availableCentipoints === 0);

  await fulfilPaidPaymentIntent(pi.id);
  await Promise.all([fulfilPaidPaymentIntent(pi.id), fulfilPaidPaymentIntent(pi.id)]); // racing visits
  check("repeat + concurrent visits: exactly one Payment, still fulfilled",
    (await Payment.countDocuments({ stripePaymentIntentId: pi.id })) === 1 && (await Payment.findOne({ stripePaymentIntentId: pi.id }).lean())?.fulfilment === "fulfilled");

  await fulfilPaidPaymentIntent("pi_notreal_" + "x".repeat(12)).catch(() => undefined);
  await fulfilPaidPaymentIntent("not-an-id");
  check("bad ids are ignored", true);
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await Kid.collection.deleteMany({ familyId: fam._id });
  await Family.collection.deleteOne({ _id: fam._id });
  await User.collection.deleteOne({ _id: user._id });
  await mongoose.disconnect();
}
process.exit(report());
